// Test Supabase Storage Upload
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function testStorage() {
  console.log('🧪 Testing Supabase Storage...\n');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  console.log('Credentials:');
  console.log(`  URL: ${supabaseUrl}`);
  console.log(`  Key: ${supabaseKey ? supabaseKey.substring(0, 20) + '...' : 'MISSING'}\n`);

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing credentials');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Test 1: List buckets
  console.log('Test 1: List buckets');
  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
  if (bucketsError) {
    console.error('❌ Failed:', bucketsError);
  } else {
    console.log('✅ Buckets:', buckets.map(b => b.name));
  }

  // Test 2: Check if social-planner-media bucket exists
  console.log('\nTest 2: Check bucket');
  const bucket = buckets?.find(b => b.name === 'social-planner-media');
  if (bucket) {
    console.log('✅ Bucket exists:', bucket);
  } else {
    console.error('❌ Bucket "social-planner-media" not found');
    return;
  }

  // Test 3: Try to upload a small test file
  console.log('\nTest 3: Upload test file');
  const testData = Buffer.from('test content');
  const testFileName = `test/test-${Date.now()}.txt`;

  const { data, error } = await supabase.storage
    .from('social-planner-media')
    .upload(testFileName, testData, {
      contentType: 'text/plain',
      upsert: false
    });

  if (error) {
    console.error('❌ Upload failed:', {
      message: error.message,
      statusCode: error.statusCode,
      error: error.error,
      details: error
    });
  } else {
    console.log('✅ Upload successful:', data);

    // Test 4: Get public URL
    console.log('\nTest 4: Get public URL');
    const { data: urlData } = supabase.storage
      .from('social-planner-media')
      .getPublicUrl(testFileName);
    console.log('✅ Public URL:', urlData.publicUrl);

    // Test 5: Clean up test file
    console.log('\nTest 5: Delete test file');
    const { error: deleteError } = await supabase.storage
      .from('social-planner-media')
      .remove([testFileName]);
    if (deleteError) {
      console.error('❌ Delete failed:', deleteError);
    } else {
      console.log('✅ Delete successful');
    }
  }

  console.log('\n🎉 Storage test complete');
}

testStorage().catch(console.error);
