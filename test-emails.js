// Test Email Sending with Resend
require('dotenv').config();
const { Resend } = require('resend');

const FROM_EMAIL = 'CBC Social Planner <onboarding@resend.dev>';

async function testEmails() {
  console.log('🧪 Testing Resend Email Service...\n');

  const resendApiKey = process.env.RESEND_API_KEY;

  console.log('Credentials:');
  console.log(`  API Key: ${resendApiKey ? resendApiKey.substring(0, 15) + '...' : 'MISSING'}\n`);

  if (!resendApiKey) {
    console.error('❌ RESEND_API_KEY not found in environment');
    return;
  }

  const resend = new Resend(resendApiKey);

  // Test 1: Send test email
  console.log('Test 1: Send approval request email simulation');
  console.log('Recipient: YOUR_EMAIL_HERE'); // Replace with your test email

  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: 'YOUR_EMAIL_HERE', // Replace with your email
      subject: '🧪 TEST: Approval Request Email',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0050cb;">🧪 TEST: Nueva Solicitud de Aprobación</h1>
          <p>This is a test email from Social Planner backend.</p>
          <p>If you receive this, email notifications are working correctly!</p>

          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Post Caption:</strong> Test post for approval</p>
            <p><strong>Platforms:</strong> LinkedIn</p>
            <p><strong>Scheduled:</strong> 2026-01-28 10:00 AM</p>
          </div>

          <p>This is what approvers will see when someone submits a post.</p>
        </div>
      `
    });

    console.log('✅ Email sent successfully!');
    console.log('Response:', result);
    console.log('\nCheck your inbox for the test email.');
  } catch (error) {
    console.error('❌ Email failed:', error);
  }

  console.log('\n🎉 Email test complete');
}

testEmails().catch(console.error);
