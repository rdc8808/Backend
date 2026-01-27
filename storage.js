// Supabase Storage Helper - Upload/Download Media Files
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Initialize Supabase client (will be configured once user provides credentials)
let supabase = null;

function initStorage() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️ Supabase credentials not found. Storage features disabled.');
    return false;
  }

  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('✅ Supabase Storage initialized');
  return true;
}

/**
 * Upload media file to Supabase Storage
 * @param {string} base64Data - Base64 encoded media (data:image/jpeg;base64,...)
 * @param {string} userId - User ID for organizing files
 * @returns {Promise<string>} - Public URL of uploaded file
 */
async function uploadMedia(base64Data, userId = 'default') {
  if (!supabase) {
    console.warn('⚠️ Supabase Storage not initialized, skipping upload');
    return null; // Return null, caller will use base64 instead
  }

  try {
    // Parse base64 data
    const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 data format');
    }

    const mimeType = matches[1];
    const base64Content = matches[2];
    const buffer = Buffer.from(base64Content, 'base64');

    const fileSizeMB = (buffer.length / 1024 / 1024).toFixed(2);
    console.log(`📤 Uploading ${fileSizeMB} MB file (${mimeType})`);

    // Supabase free tier has 1GB storage, 2GB bandwidth
    // But individual file upload limit is typically 50MB
    if (buffer.length > 50 * 1024 * 1024) {
      throw new Error(`File too large: ${fileSizeMB} MB (max 50 MB)`);
    }

    // Determine file extension
    const extension = mimeType.split('/')[1].split(';')[0];

    // Generate unique filename
    const timestamp = Date.now();
    const randomHash = crypto.randomBytes(8).toString('hex');
    const fileName = `${userId}/${timestamp}-${randomHash}.${extension}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('social-planner-media')
      .upload(fileName, buffer, {
        contentType: mimeType,
        upsert: false
      });

    if (error) {
      console.error('❌ Supabase upload error:', {
        message: error.message,
        statusCode: error.statusCode,
        error: error.error,
        details: error
      });
      throw new Error(`Upload failed: ${error.message}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('social-planner-media')
      .getPublicUrl(fileName);

    console.log(`✅ Media uploaded: ${fileName}`);
    return urlData.publicUrl;
  } catch (error) {
    console.error('❌ Upload media error:', error);
    throw error;
  }
}

/**
 * Download media file from Supabase Storage as base64
 * @param {string} mediaUrl - Public URL of the file
 * @returns {Promise<string>} - Base64 encoded media
 */
async function downloadMediaAsBase64(mediaUrl) {
  if (!supabase) {
    throw new Error('Supabase Storage not initialized');
  }

  try {
    // Extract file path from URL
    const urlObj = new URL(mediaUrl);
    const pathParts = urlObj.pathname.split('/');
    const fileName = pathParts.slice(-2).join('/'); // userId/filename.ext

    // Download from Supabase Storage
    const { data, error } = await supabase.storage
      .from('social-planner-media')
      .download(fileName);

    if (error) {
      console.error('❌ Supabase download error:', error);
      throw new Error(`Download failed: ${error.message}`);
    }

    // Convert blob to base64
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');

    // Get mime type from blob
    const mimeType = data.type || 'image/jpeg';

    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('❌ Download media error:', error);
    throw error;
  }
}

/**
 * Delete media file from Supabase Storage
 * @param {string} mediaUrl - Public URL of the file to delete
 * @returns {Promise<boolean>} - Success status
 */
async function deleteMedia(mediaUrl) {
  if (!supabase) {
    throw new Error('Supabase Storage not initialized');
  }

  try {
    // Extract file path from URL
    const urlObj = new URL(mediaUrl);
    const pathParts = urlObj.pathname.split('/');
    const fileName = pathParts.slice(-2).join('/'); // userId/filename.ext

    // Delete from Supabase Storage
    const { error } = await supabase.storage
      .from('social-planner-media')
      .remove([fileName]);

    if (error) {
      console.error('❌ Supabase delete error:', error);
      throw new Error(`Delete failed: ${error.message}`);
    }

    console.log(`🗑️ Media deleted: ${fileName}`);
    return true;
  } catch (error) {
    console.error('❌ Delete media error:', error);
    throw error;
  }
}

/**
 * Soft-delete old posts (mark as deleted without removing from DB)
 * This is handled at the application level, not storage level
 */
async function cleanupOldMedia(olderThanMonths = 3) {
  // This will be implemented in database-pg.js
  // Just a placeholder for now
  console.log(`🧹 Cleanup triggered for media older than ${olderThanMonths} months`);
}

module.exports = {
  initStorage,
  uploadMedia,
  downloadMediaAsBase64,
  deleteMedia,
  cleanupOldMedia
};
