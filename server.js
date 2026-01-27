const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
const { Resend } = require('resend');

// Import hybrid database layer (works with PostgreSQL or JSON)
const { initDB, readDB, writeDB, usePostgres, pgDb } = require('./server-pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Root endpoint for Facebook verification
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Rubicon Core - Social Planner API</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
        <h1 style="color: #0050cb;">Rubicon Core Social Planner API</h1>
        <p>This is the backend API for Core Business Corp's social media scheduling platform.</p>
        <p style="color: #666;">Status: <strong style="color: #22c55e;">Active</strong></p>
      </body>
    </html>
  `);
});

// robots.txt to allow Facebook crawler
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: Facebookbot
Allow: /

User-agent: facebookexternalhit
Allow: /

User-agent: *
Allow: /
`);
});

// Storage setup
const upload = multer({ dest: 'uploads/' });

// ============ DATABASE SETUP ============
// Using PostgreSQL (Supabase) for persistent storage
// Old JSON database code commented out below

/* OLD JSON DATABASE (NO LONGER USED)
const DB_FILE = process.env.NODE_ENV === 'production'
  ? '/opt/render/project/data/database.json'
  : path.join(__dirname, 'database.json');

async function initDB() { ... }
async function readDB() { ... }
async function writeDB(data) { ... }
*/

// ============ CONFIGURATION ============
// Add these to your .env file
const CONFIG = {
  FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID || 'YOUR_FACEBOOK_APP_ID',
  FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET || 'YOUR_FACEBOOK_APP_SECRET',
  LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID || 'YOUR_LINKEDIN_CLIENT_ID',
  LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET || 'YOUR_LINKEDIN_CLIENT_SECRET',
  REDIRECT_URI: process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173'
};

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@updates.rubiconcore.com';

// ============ EMAIL FUNCTIONS ============
async function sendWelcomeEmail(user, password) {
  try {
    console.log(`📧 Attempting to send welcome email to ${user.email}...`);
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: user.email,
      subject: 'Bienvenido a CBC Social Planner',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0050cb;">¡Bienvenido a CBC Social Planner!</h1>
          <p>Hola <strong>${user.fullName}</strong>,</p>
          <p>Tu cuenta ha sido creada exitosamente. Aquí están tus credenciales de acceso:</p>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Email:</strong> ${user.email}</p>
            <p><strong>Contraseña:</strong> ${password}</p>
            <p><strong>Rol:</strong> ${user.role === 'admin' ? 'Administrador' : 'Colaborador'}</p>
          </div>
          <p>Accede a la plataforma en: <a href="${CONFIG.CLIENT_URL}">${CONFIG.CLIENT_URL}</a></p>
          <p style="color: #666; font-size: 12px; margin-top: 30px;">
            💡 Por seguridad, te recomendamos cambiar tu contraseña después del primer inicio de sesión.
          </p>
        </div>
      `
    });
    console.log(`✅ Welcome email sent successfully to ${user.email}`, result);
  } catch (error) {
    console.error('❌ Failed to send welcome email:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
  }
}

async function sendApprovalRequestEmail(approver, requester, post) {
  try {
    console.log(`📧 Sending approval request email to admin ${approver.email}...`);
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: approver.email,
      subject: `Nueva solicitud de aprobación de ${requester.fullName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0050cb;">Nueva Solicitud de Aprobación</h1>
          <p>Hola <strong>${approver.fullName}</strong>,</p>
          <p><strong>${requester.fullName}</strong> ha enviado una publicación para tu aprobación.</p>

          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Detalles de la Publicación:</h3>
            <p><strong>Caption:</strong></p>
            <p style="white-space: pre-wrap;">${post.caption}</p>

            ${post.scheduleDate && post.scheduleTime ? `
              <p><strong>Programado para:</strong> ${post.scheduleDate} a las ${post.scheduleTime}</p>
            ` : ''}

            ${post.approvalStatus?.note ? `
              <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px; margin-top: 10px;">
                <p style="margin: 0;"><strong>Nota:</strong> ${post.approvalStatus.note}</p>
              </div>
            ` : ''}
          </div>

          <p>
            <a href="${CONFIG.CLIENT_URL}"
               style="background: #0050cb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Revisar Solicitud
            </a>
          </p>
        </div>
      `
    });
    console.log(`✅ Approval request email sent successfully to ${approver.email}`, result);
  } catch (error) {
    console.error('❌ Failed to send approval request email:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
  }
}

async function sendApprovalDecisionEmail(requester, approver, post, approved) {
  try {
    console.log(`📧 Sending ${approved ? 'approval' : 'rejection'} email to ${requester.email}...`);
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: requester.email,
      subject: approved ? '✅ Tu publicación fue aprobada' : '❌ Tu publicación fue rechazada',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: ${approved ? '#28a745' : '#dc3545'};">
            ${approved ? '✅ Publicación Aprobada' : '❌ Publicación Rechazada'}
          </h1>
          <p>Hola <strong>${requester.fullName}</strong>,</p>
          <p><strong>${approver.fullName}</strong> ha ${approved ? 'aprobado' : 'rechazado'} tu publicación.</p>

          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Caption:</strong></p>
            <p style="white-space: pre-wrap;">${post.caption}</p>

            ${approved && post.scheduleDate && post.scheduleTime ? `
              <p style="color: #28a745;"><strong>✓ Se publicará el:</strong> ${post.scheduleDate} a las ${post.scheduleTime}</p>
            ` : ''}

            ${!approved && post.approvalStatus?.rejectedReason ? `
              <div style="background: #f8d7da; border-left: 4px solid #dc3545; padding: 10px; margin-top: 10px;">
                <p style="margin: 0; color: #721c24;"><strong>Motivo:</strong> ${post.approvalStatus.rejectedReason}</p>
              </div>
            ` : ''}
          </div>

          <p>
            <a href="${CONFIG.CLIENT_URL}"
               style="background: #0050cb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Ver en la Plataforma
            </a>
          </p>
        </div>
      `
    });
    console.log(`✅ ${approved ? 'Approval' : 'Rejection'} email sent successfully to ${requester.email}`, result);
  } catch (error) {
    console.error(`❌ Failed to send ${approved ? 'approval' : 'rejection'} email:`, error);
    console.error('Error details:', JSON.stringify(error, null, 2));
  }
}

// Email to collaborator confirming their post was sent for approval
async function sendCollaboratorConfirmationEmail(collaborator, approver, post) {
  try {
    console.log(`📧 Sending confirmation email to collaborator ${collaborator.email}...`);
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: collaborator.email,
      subject: '📬 Tu publicación ha sido enviada para aprobación',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #0050cb;">📬 Solicitud de Aprobación Enviada</h1>
          <p>Hola <strong>${collaborator.fullName}</strong>,</p>
          <p>Tu publicación ha sido enviada a <strong>${approver.fullName}</strong> para su aprobación.</p>

          <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Caption:</strong></p>
            <p style="white-space: pre-wrap;">${post.caption}</p>

            ${post.scheduleDate && post.scheduleTime ? `
              <p><strong>Fecha programada:</strong> ${post.scheduleDate} a las ${post.scheduleTime}</p>
            ` : ''}

            ${post.approvalStatus?.note ? `
              <div style="background: #e7f3ff; border-left: 4px solid #0050cb; padding: 10px; margin-top: 10px;">
                <p style="margin: 0; color: #004085;"><strong>Tu nota:</strong> ${post.approvalStatus.note}</p>
              </div>
            ` : ''}
          </div>

          <p>Recibirás una notificación cuando ${approver.fullName} revise tu publicación.</p>

          <p>
            <a href="${CONFIG.CLIENT_URL}"
               style="background: #0050cb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Ver en la Plataforma
            </a>
          </p>
        </div>
      `
    });
    console.log(`✅ Confirmation email sent successfully to ${collaborator.email}`, result);
  } catch (error) {
    console.error('❌ Failed to send collaborator confirmation email:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
  }
}

// ============ FACEBOOK OAUTH ============
app.get('/auth/facebook', (req, res) => {
  const userId = req.query.userId || 'default_user';
  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
    `client_id=${CONFIG.FACEBOOK_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(CONFIG.REDIRECT_URI)}` +
    `&scope=pages_show_list,business_management,pages_read_engagement,pages_manage_posts` +
    `&state=facebook_${userId}`;
  
  res.redirect(authUrl);
});

// ============ USER REGISTRATION - FIRST USER ONLY ============
app.post('/api/register', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    const db = await readDB();

    // Only allow registration if NO users exist (first user setup)
    if (Object.keys(db.users).length > 0) {
      return res.status(403).json({
        error: 'El registro público está deshabilitado. Solo administradores pueden crear nuevos usuarios.'
      });
    }

    // Validate required fields
    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    // Validate corporate email
    const allowedDomains = ['@corebusinesscorp.com', '@rubicondigitalcorp.com'];
    const emailDomain = email.substring(email.indexOf('@'));
    if (!allowedDomains.includes(emailDomain)) {
      return res.status(400).json({ error: 'Solo se permiten correos corporativos' });
    }

    // First user is always admin
    db.users[email] = {
      fullName,
      email,
      password, // In production, hash this with bcrypt!
      role: 'admin',
      createdAt: new Date().toISOString()
    };

    await writeDB(db);

    res.json({
      success: true,
      message: 'Primer administrador creado exitosamente',
      user: {
        fullName,
        email,
        role: 'admin'
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

// ============ ADMIN - CREATE USER (INVITE) ============
app.post('/api/admin/create-user', async (req, res) => {
  try {
    const { fullName, email, password, role, adminKey } = req.body;

    // Verify admin key
    if (adminKey !== 'rubicon2026admin') {
      return res.status(403).json({ error: 'Acceso denegado. Solo administradores pueden crear usuarios.' });
    }

    // Validate required fields
    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    // Validate role
    if (role && !['admin', 'collaborator'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    // Validate corporate email
    const allowedDomains = ['@corebusinesscorp.com', '@rubicondigitalcorp.com'];
    const emailDomain = email.substring(email.indexOf('@'));
    if (!allowedDomains.includes(emailDomain)) {
      return res.status(400).json({ error: 'Solo se permiten correos corporativos' });
    }

    const db = await readDB();

    // Check if user already exists
    if (db.users[email]) {
      return res.status(400).json({ error: 'El correo electrónico ya existe' });
    }

    const userRole = role || 'collaborator';

    // Create user
    db.users[email] = {
      fullName,
      email,
      password, // In production, hash this with bcrypt!
      role: userRole,
      createdAt: new Date().toISOString()
    };

    await writeDB(db);

    // Send welcome email with credentials
    await sendWelcomeEmail(db.users[email], password);

    res.json({
      success: true,
      message: `Usuario ${userRole === 'admin' ? 'administrador' : 'colaborador'} creado exitosamente. Email de bienvenida enviado.`,
      user: {
        fullName,
        email,
        role: userRole
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// ============ ADMIN - DELETE USER ============
app.delete('/api/admin/delete-user', async (req, res) => {
  try {
    const { emailToDelete, adminKey } = req.body;

    // Verify admin key
    if (adminKey !== 'rubicon2026admin') {
      return res.status(403).json({ error: 'Acceso denegado. Solo administradores pueden eliminar usuarios.' });
    }

    if (!emailToDelete) {
      return res.status(400).json({ error: 'Email del usuario a eliminar es requerido' });
    }

    const db = await readDB();

    // Check if user exists
    if (!db.users[emailToDelete]) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Prevent deletion if it's the only admin
    const admins = Object.values(db.users).filter(u => u.role === 'admin');
    if (db.users[emailToDelete].role === 'admin' && admins.length === 1) {
      return res.status(400).json({ error: 'No puedes eliminar el único administrador del sistema' });
    }

    const deletedUser = db.users[emailToDelete];

    // Delete user
    delete db.users[emailToDelete];

    // Delete user's tokens
    if (db.tokens[emailToDelete]) {
      delete db.tokens[emailToDelete];
    }

    // Delete user's posts
    db.posts = db.posts.filter(p => p.userId !== emailToDelete);

    await writeDB(db);

    console.log(`🗑️ User deleted: ${emailToDelete} (${deletedUser.fullName})`);

    res.json({
      success: true,
      message: `Usuario ${deletedUser.fullName} eliminado exitosamente`,
      deletedUser: {
        email: deletedUser.email,
        fullName: deletedUser.fullName,
        role: deletedUser.role
      }
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

// ============ USER LOGIN ============
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    const db = await readDB();
    const user = db.users[email];

    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    res.json({
      success: true,
      user: {
        fullName: user.fullName,
        email: user.email,
        password: user.password,
        role: user.role || 'admin' // Default to admin for existing users
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// ============ UPDATE PASSWORD ============
app.post('/api/update-password', async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body;

    if (!email || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    const db = await readDB();
    const user = db.users[email];

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (user.password !== currentPassword) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }

    // Update password
    db.users[email].password = newPassword;
    await writeDB(db);

    res.json({
      success: true,
      user: {
        fullName: user.fullName,
        email: user.email,
        password: newPassword,
        role: user.role || 'admin'
      }
    });
  } catch (error) {
    console.error('Password update error:', error);
    res.status(500).json({ error: 'Error al actualizar contraseña' });
  }
});

// ============ LINKEDIN OAUTH ============
app.get('/auth/linkedin', (req, res) => {
  const userId = req.query.userId || 'default_user';
  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?` +
    `response_type=code` +
    `&client_id=${CONFIG.LINKEDIN_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(CONFIG.REDIRECT_URI)}` +
    `&scope=openid,profile,email,w_member_social,w_organization_social,r_organization_social,r_organization_admin` +
    `&state=linkedin_${userId}`;

  res.redirect(authUrl);
});

// ============ OAUTH CALLBACK ============
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const [platform, userId] = state.split('_');

  try {
    if (platform === 'facebook') {
      // Exchange code for access token
      const tokenResponse = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
        params: {
          client_id: CONFIG.FACEBOOK_APP_ID,
          client_secret: CONFIG.FACEBOOK_APP_SECRET,
          redirect_uri: CONFIG.REDIRECT_URI,
          code: code
        }
      });

      const accessToken = tokenResponse.data.access_token;

      // Get user's pages
      const pagesResponse = await axios.get(`https://graph.facebook.com/v18.0/me/accounts`, {
        params: { access_token: accessToken }
      });

      console.log('Facebook pages response:', pagesResponse.data);

      // Save tokens at APP-LEVEL (shared by all users)
      const db = await readDB();
      if (!db.tokens['app']) db.tokens['app'] = {};
      db.tokens['app'].facebook = {
        accessToken: accessToken,
        pages: pagesResponse.data.data || [],
        connectedAt: new Date().toISOString(),
        connectedBy: userId // Track who connected it
      };
      await writeDB(db);

      console.log('Saved Facebook tokens at app level. Connected by:', userId, 'Pages count:', db.tokens['app'].facebook.pages.length);

    } else if (platform === 'linkedin') {
      // Exchange code for access token
      const tokenResponse = await axios.post(`https://www.linkedin.com/oauth/v2/accessToken`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: CONFIG.REDIRECT_URI,
          client_id: CONFIG.LINKEDIN_CLIENT_ID,
          client_secret: CONFIG.LINKEDIN_CLIENT_SECRET
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const accessToken = tokenResponse.data.access_token;

      // Get user profile using OpenID Connect
      const profileResponse = await axios.get(`https://api.linkedin.com/v2/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      // Get organization pages (like Facebook pages) - wrapped in try-catch
      let organizations = [];
      try {
        const organizationsResponse = await axios.get(
          `https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organizationalTarget~(localizedName,vanityName)))`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'X-Restli-Protocol-Version': '2.0.0'
            }
          }
        );

        console.log('LinkedIn organizations response:', JSON.stringify(organizationsResponse.data, null, 2));

        // Extract organization pages
        organizations = organizationsResponse.data.elements?.map(element => {
          const org = element['organizationalTarget~'];
          const orgId = element.organizationalTarget?.split(':').pop(); // Extract ID from URN

          console.log('Organization object:', JSON.stringify(org, null, 2));

          return {
            id: orgId,
            name: org?.localizedName || org?.['localizedName'] || 'Unknown Organization',
            vanityName: org?.vanityName || org?.['vanityName']
          };
        }) || [];

        console.log('Extracted organizations:', JSON.stringify(organizations, null, 2));
      } catch (orgError) {
        console.warn('⚠️ Could not fetch LinkedIn organizations:', orgError.response?.data || orgError.message);
        console.warn('⚠️ Will save tokens without organization pages. User may need admin permissions on LinkedIn page.');
      }

      // Save tokens at APP-LEVEL (shared by all users)
      const db = await readDB();
      if (!db.tokens['app']) db.tokens['app'] = {};
      db.tokens['app'].linkedin = {
        accessToken: accessToken,
        profile: profileResponse.data,
        organizations: organizations, // Store organization pages
        connectedAt: new Date().toISOString(),
        connectedBy: userId // Track who connected it
      };
      await writeDB(db);

      console.log('Saved LinkedIn tokens at app level. Connected by:', userId, 'Organizations count:', organizations.length);
    }

    res.redirect(`${CONFIG.CLIENT_URL}?connected=${platform}`);
  } catch (error) {
    console.error('OAuth error:', error.response?.data || error.message);
    res.redirect(`${CONFIG.CLIENT_URL}?error=auth_failed`);
  }
});

// ============ POST TO FACEBOOK ============
async function postToFacebook(userId, postData) {
  const db = await readDB();
  // Use APP-LEVEL tokens (shared by all users)
  const fbToken = db.tokens['app']?.facebook;

  if (!fbToken) throw new Error('Facebook no está conectado');
  if (!fbToken.pages || fbToken.pages.length === 0) {
    throw new Error('No Facebook pages found. Please reconnect your Facebook account.');
  }

  const pageToken = fbToken.pages[0].access_token; // Use first page
  const pageId = fbToken.pages[0].id;

  const postParams = {
    message: postData.caption,
    access_token: pageToken
  };

  // Upload media if exists
  if (postData.media) {
    const mediaBuffer = Buffer.from(postData.media.split(',')[1], 'base64');

    // Detect media type from base64 header
    const mediaType = postData.media.split(';')[0].split(':')[1];
    const isVideo = mediaType.startsWith('video/');
    const extension = isVideo ? 'mp4' : 'jpg';
    const tempFile = path.join('uploads', `temp_${Date.now()}.${extension}`);

    await fs.writeFile(tempFile, mediaBuffer);

    const form = new FormData();
    form.append('source', (await fs.readFile(tempFile)), {
      filename: `media.${extension}`,
      contentType: mediaType
    });
    form.append('access_token', pageToken);
    form.append(isVideo ? 'description' : 'message', postData.caption);

    try {
      const endpoint = isVideo ? 'videos' : 'photos';
      const uploadResponse = await axios.post(
        `https://graph.facebook.com/v18.0/${pageId}/${endpoint}`,
        form,
        {
          headers: form.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );

      await fs.unlink(tempFile);
      return uploadResponse.data;
    } catch (error) {
      await fs.unlink(tempFile).catch(() => {}); // Clean up file even on error
      console.error(`Facebook ${isVideo ? 'video' : 'photo'} upload error:`, JSON.stringify(error.response?.data, null, 2));
      throw new Error(`Facebook ${isVideo ? 'video' : 'photo'} upload failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  // Text-only post
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${pageId}/feed`,
      postParams
    );
    return response.data;
  } catch (error) {
    // Log FULL detailed error for debugging
    console.error('Facebook API Error - Full Details:');
    console.error('Status:', error.response?.status);
    console.error('Error Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('Page ID:', pageId);
    console.error('Has Page Token:', !!pageToken);

    const fbError = error.response?.data?.error;
    const errorMessage = fbError?.message || error.message;
    const errorCode = fbError?.code;
    const errorType = fbError?.type;

    throw new Error(`Facebook API error (${errorCode} - ${errorType}): ${errorMessage}`);
  }
}

// ============ POST TO LINKEDIN ============
async function postToLinkedIn(userId, postData) {
  const db = await readDB();
  // Use APP-LEVEL tokens (shared by all users)
  const liToken = db.tokens['app']?.linkedin;

  if (!liToken) throw new Error('LinkedIn no está conectado');

  // Use organization (company page) instead of personal profile
  if (!liToken.organizations || liToken.organizations.length === 0) {
    throw new Error('No se encontraron páginas de LinkedIn. Por favor, reconecta tu cuenta de LinkedIn.');
  }

  // Use first organization (company page)
  const organization = liToken.organizations[0];
  const organizationURN = `urn:li:organization:${organization.id}`;

  // Detect media type
  let mediaCategory = 'NONE';
  let recipe = null;

  if (postData.media) {
    const mediaType = postData.media.split(';')[0].split(':')[1];
    const isVideo = mediaType.startsWith('video/');
    mediaCategory = isVideo ? 'VIDEO' : 'IMAGE';
    recipe = isVideo ? 'urn:li:digitalmediaRecipe:feedshare-video' : 'urn:li:digitalmediaRecipe:feedshare-image';
  }

  const postBody = {
    author: organizationURN,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: postData.caption
        },
        shareMediaCategory: mediaCategory
      }
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
    }
  };

  // If there's media, upload it first
  if (postData.media) {
    const mediaBuffer = Buffer.from(postData.media.split(',')[1], 'base64');

    // Register upload
    const registerResponse = await axios.post(
      'https://api.linkedin.com/v2/assets?action=registerUpload',
      {
        registerUploadRequest: {
          recipes: [recipe],
          owner: organizationURN, // Upload media as organization
          serviceRelationships: [{
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent'
          }]
        }
      },
      {
        headers: {
          Authorization: `Bearer ${liToken.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const uploadUrl = registerResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const asset = registerResponse.data.value.asset;

    // Upload media
    await axios.put(uploadUrl, mediaBuffer, {
      headers: {
        Authorization: `Bearer ${liToken.accessToken}`,
        'Content-Type': 'application/octet-stream'
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    // Add media to post
    postBody.specificContent['com.linkedin.ugc.ShareContent'].media = [{
      status: 'READY',
      media: asset
    }];
  }

  try {
    console.log('🔵 Posting to LinkedIn organization:', organizationURN);
    console.log('🔵 Post body:', JSON.stringify(postBody, null, 2));

    const response = await axios.post(
      'https://api.linkedin.com/v2/ugcPosts',
      postBody,
      {
        headers: {
          Authorization: `Bearer ${liToken.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        }
      }
    );

    console.log('✅ LinkedIn post successful:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ LinkedIn posting error:', error.response?.data || error.message);
    console.error('❌ Full error:', JSON.stringify(error.response?.data, null, 2));
    throw new Error(`LinkedIn posting failed: ${error.response?.data?.message || error.message}`);
  }
}

// ============ SAVE DRAFT ============
app.post('/api/drafts', async (req, res) => {
  try {
    const { userId, postData } = req.body;
    const db = await readDB();

    const post = {
      id: postData.id || Date.now().toString(),
      userId: userId || 'default_user',
      ...postData,
      status: 'draft',
      createdAt: postData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Update if exists, otherwise add
    const index = db.posts.findIndex(p => p.id === post.id);
    if (index !== -1) {
      db.posts[index] = post;
    } else {
      db.posts.push(post);
    }

    await writeDB(db);
    res.json({ success: true, post });
  } catch (error) {
    console.error('Draft error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ SEND POST FOR APPROVAL ============
app.post('/api/posts/send-for-approval', async (req, res) => {
  try {
    const { userId, postData, approverId, note } = req.body;

    if (!approverId) {
      return res.status(400).json({ error: 'Debe seleccionar un aprobador' });
    }

    const db = await readDB();

    const post = {
      id: postData.id || Date.now().toString(),
      userId: userId || 'default_user',
      ...postData,
      status: 'pending_approval',
      approvalStatus: {
        approverId,
        requestedBy: userId,
        requestedAt: new Date().toISOString(),
        note: note || '',
        approved: null,
        approvedAt: null,
        rejectedReason: null
      },
      createdAt: postData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Update if exists, otherwise add
    const index = db.posts.findIndex(p => p.id === post.id);
    if (index !== -1) {
      db.posts[index] = post;
    } else {
      db.posts.push(post);
    }

    await writeDB(db);

    // Send email notifications
    const approver = db.users[approverId];
    const requester = db.users[userId];
    if (approver && requester) {
      // Email to approver about the request
      await sendApprovalRequestEmail(approver, requester, post);
      // Email to collaborator confirming submission
      await sendCollaboratorConfirmationEmail(requester, approver, post);
    }

    res.json({ success: true, post });
  } catch (error) {
    console.error('Send for approval error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ GET PENDING APPROVALS ============
app.get('/api/posts/pending-approval', async (req, res) => {
  try {
    const { userId } = req.query;
    const db = await readDB();

    // Get posts pending approval for this user (as approver)
    const pendingPosts = db.posts.filter(p =>
      p.status === 'pending_approval' &&
      p.approvalStatus?.approverId === userId
    );

    // Strip media to reduce egress
    const postsWithoutMedia = pendingPosts.map(post => {
      const { media, ...postWithoutMedia } = post;
      return {
        ...postWithoutMedia,
        hasMedia: !!media
      };
    });

    res.json(postsWithoutMedia);
  } catch (error) {
    console.error('Get pending approvals error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ GET MY PENDING APPROVALS (Collaborator's own posts) ============
app.get('/api/posts/my-pending-approvals', async (req, res) => {
  try {
    const { userId } = req.query;
    const db = await readDB();

    // Get posts that this user sent for approval (rejected posts are deleted, so only pending)
    const myPendingPosts = db.posts.filter(p =>
      p.status === 'pending_approval' &&
      p.approvalStatus?.requestedBy === userId
    );

    // Strip media to reduce egress
    const postsWithoutMedia = myPendingPosts.map(post => {
      const { media, ...postWithoutMedia } = post;
      return {
        ...postWithoutMedia,
        hasMedia: !!media
      };
    });

    res.json(postsWithoutMedia);
  } catch (error) {
    console.error('Get my pending approvals error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ APPROVE POST ============
app.post('/api/posts/approve', async (req, res) => {
  try {
    const { postId, approverId, scheduledDate, scheduledTime } = req.body;
    const db = await readDB();

    const post = db.posts.find(p => p.id === postId);
    if (!post) {
      return res.status(404).json({ error: 'Post no encontrado' });
    }

    if (post.approvalStatus?.approverId !== approverId) {
      return res.status(403).json({ error: 'No tienes permiso para aprobar este post' });
    }

    // Update post status
    post.status = 'scheduled';
    post.scheduleDate = scheduledDate || post.scheduleDate;
    post.scheduleTime = scheduledTime || post.scheduleTime;
    post.approvalStatus.approved = true;
    post.approvalStatus.approvedAt = new Date().toISOString();
    post.updatedAt = new Date().toISOString();

    await writeDB(db);

    // Send email notification to requester
    const requester = db.users[post.approvalStatus.requestedBy];
    const approver = db.users[approverId];
    if (requester && approver) {
      await sendApprovalDecisionEmail(requester, approver, post, true);
    }

    res.json({ success: true, post });
  } catch (error) {
    console.error('Approve post error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ REJECT POST ============
app.post('/api/posts/reject', async (req, res) => {
  try {
    const { postId, approverId, reason } = req.body;
    const db = await readDB();

    const postIndex = db.posts.findIndex(p => p.id === postId);
    if (postIndex === -1) {
      return res.status(404).json({ error: 'Post no encontrado' });
    }

    const post = db.posts[postIndex];

    if (post.approvalStatus?.approverId !== approverId) {
      return res.status(403).json({ error: 'No tienes permiso para rechazar este post' });
    }

    // Get user info BEFORE deleting the post (for email)
    const requester = db.users[post.approvalStatus.requestedBy];
    const approver = db.users[approverId];

    // Add rejection info for the email
    post.approvalStatus.approved = false;
    post.approvalStatus.approvedAt = new Date().toISOString();
    post.approvalStatus.rejectedReason = reason || 'Sin motivo especificado';

    // Send email notification to requester
    if (requester && approver) {
      await sendApprovalDecisionEmail(requester, approver, post, false);
    }

    // CRITICAL: Remove the post completely from database
    // Rejected posts should NOT remain in the system or be published
    db.posts.splice(postIndex, 1);

    await writeDB(db);

    console.log(`🗑️ Post ${postId} rejected and deleted permanently`);

    res.json({ success: true, message: 'Post rechazado y eliminado', post });
  } catch (error) {
    console.error('Reject post error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ SCHEDULE POST ============
app.post('/api/schedule', async (req, res) => {
  try {
    const { userId, postData } = req.body;
    const db = await readDB();

    const post = {
      id: postData.id || Date.now().toString(),
      userId: userId || 'default_user',
      ...postData,
      status: 'scheduled',
      createdAt: postData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Update if exists, otherwise add
    const index = db.posts.findIndex(p => p.id === post.id);
    if (index !== -1) {
      db.posts[index] = post;
    } else {
      db.posts.push(post);
    }

    await writeDB(db);
    res.json({ success: true, post });
  } catch (error) {
    console.error('Schedule error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ POST NOW ============
app.post('/api/post-now', async (req, res) => {
  try {
    const { userId, postData } = req.body;
    const results = {};

    if (postData.platforms.facebook) {
      results.facebook = await postToFacebook(userId || 'default_user', postData);
    }

    if (postData.platforms.linkedin) {
      results.linkedin = await postToLinkedIn(userId || 'default_user', postData);
    }

    // Save to database as published
    const db = await readDB();
    const post = {
      id: postData.id || Date.now().toString(),
      userId: userId || 'default_user',
      ...postData,
      status: 'published',
      publishedAt: new Date().toISOString(),
      results: results
    };

    // Update if exists, otherwise add
    const index = db.posts.findIndex(p => p.id === post.id);
    if (index !== -1) {
      db.posts[index] = post;
    } else {
      db.posts.push(post);
    }

    await writeDB(db);

    res.json({ success: true, results, post });
  } catch (error) {
    console.error('Post error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ GET POSTS ============
app.get('/api/posts', async (req, res) => {
  try {
    // Log request for debugging excessive API calls
    const userId = req.query.userId || 'unknown';
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    console.log(`📊 GET /api/posts - User: ${userId} - IP: ${ip} - Time: ${new Date().toISOString()}`);

    const db = await readDB();
    const posts = db.posts || [];

    // Strip media field to reduce Supabase egress (media is base64 encoded images/videos)
    // A 5MB image = ~6.7MB in base64. Removing media reduces response from ~70MB to ~100KB
    const postsWithoutMedia = posts.map(post => {
      const { media, ...postWithoutMedia } = post;
      return {
        ...postWithoutMedia,
        hasMedia: !!media // Boolean flag to indicate if post has media
      };
    });

    res.json(postsWithoutMedia);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ GET MEDIA FOR SPECIFIC POST ============
app.get('/api/posts/:postId/media', async (req, res) => {
  try {
    const db = await readDB();
    const post = db.posts.find(p => p.id === req.params.postId);

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json({ media: post.media || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ DELETE POST ============
app.delete('/api/posts/:postId', async (req, res) => {
  try {
    // Use PostgreSQL direct delete if available
    if (usePostgres && pgDb) {
      await pgDb.deletePost(req.params.postId);
    } else {
      // Fallback to JSON
      const db = await readDB();
      db.posts = db.posts.filter(p => p.id !== req.params.postId);
      await writeDB(db);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ CHECK CONNECTION STATUS ============
app.get('/api/connections', async (req, res) => {
  try {
    const db = await readDB();
    // Check APP-LEVEL tokens (shared by all users)
    const appTokens = db.tokens['app'] || {};

    res.json({
      facebook: !!appTokens.facebook,
      linkedin: !!appTokens.linkedin,
      linkedinOrganization: appTokens.linkedin?.organizations?.[0] || null, // First organization
      instagram: false // We'll add this later if needed
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ DISCONNECT ACCOUNT ============
app.post('/api/disconnect', async (req, res) => {
  try {
    const { userId, platform } = req.body;
    const db = await readDB();

    // Check if user is admin
    const user = db.users[userId];
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden desconectar cuentas' });
    }

    // Disconnect at APP-LEVEL (affects all users)
    if (usePostgres && pgDb) {
      // Use PostgreSQL direct delete
      await pgDb.deleteTokens('app', platform);
    } else {
      // Fallback to JSON
      if (!db.tokens['app']) {
        return res.status(404).json({ error: 'No hay conexiones' });
      }

      if (platform === 'facebook' && db.tokens['app'].facebook) {
        delete db.tokens['app'].facebook;
      } else if (platform === 'linkedin' && db.tokens['app'].linkedin) {
        delete db.tokens['app'].linkedin;
      }

      await writeDB(db);
    }

    res.json({ success: true, message: `${platform} desconectado para todos los usuarios` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ADMIN: Reset User Password ============
app.post('/api/admin/reset-password', async (req, res) => {
  try {
    const { email, newPassword, adminKey } = req.body;

    // Simple admin authentication - in production use proper auth
    if (adminKey !== 'rubicon2026admin') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    if (!email || !newPassword) {
      return res.status(400).json({ error: 'Email y nueva contraseña son requeridos' });
    }

    const db = await readDB();
    const user = db.users[email];

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Reset password
    db.users[email].password = newPassword;
    await writeDB(db);

    res.json({
      success: true,
      message: `Contraseña actualizada para ${email}`,
      newPassword: newPassword
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Error al resetear contraseña' });
  }
});

// ============ USER MANAGEMENT - Get all users (admin only) ============
app.get('/api/users', async (req, res) => {
  try {
    const db = await readDB();
    const userList = Object.values(db.users).map(u => ({
      email: u.email,
      fullName: u.fullName,
      role: u.role || 'admin',
      createdAt: u.createdAt
    }));

    res.json({
      totalUsers: userList.length,
      users: userList
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ GET ALL USERS WITH PASSWORDS (Admin only) ============
app.get('/api/admin/users-with-passwords', async (req, res) => {
  try {
    const { adminKey } = req.query;

    // Verify admin key
    if (adminKey !== 'rubicon2026admin') {
      return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
    }

    const db = await readDB();
    const userList = Object.values(db.users).map(u => ({
      email: u.email,
      fullName: u.fullName,
      password: u.password, // Include password for admin
      role: u.role || 'admin',
      createdAt: u.createdAt
    }));

    res.json({
      totalUsers: userList.length,
      users: userList
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ USER MANAGEMENT - Update user role (admin only) ============
app.post('/api/users/update-role', async (req, res) => {
  try {
    const { email, role, adminKey } = req.body;

    // Simple admin verification
    if (adminKey !== 'rubicon2026admin') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    if (!email || !role) {
      return res.status(400).json({ error: 'Email y rol son requeridos' });
    }

    if (!['admin', 'collaborator'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido. Debe ser "admin" o "collaborator"' });
    }

    const db = await readDB();
    const user = db.users[email];

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Update role
    db.users[email].role = role;
    await writeDB(db);

    res.json({
      success: true,
      message: `Rol actualizado para ${email}`,
      user: {
        email: user.email,
        fullName: user.fullName,
        role: role
      }
    });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: 'Error al actualizar rol' });
  }
});

// ============ DEBUG ENDPOINT - Check all users ============
app.get('/api/debug/users', async (req, res) => {
  try {
    const db = await readDB();
    const userList = Object.values(db.users).map(u => ({
      email: u.email,
      fullName: u.fullName,
      role: u.role || 'admin',
      createdAt: u.createdAt
    }));

    res.json({
      totalUsers: userList.length,
      users: userList
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ DEBUG ENDPOINT - Get user with password ============
app.get('/api/debug/user/:email', async (req, res) => {
  try {
    const email = req.params.email;
    const db = await readDB();
    const user = db.users[email];

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({
      email: user.email,
      fullName: user.fullName,
      password: user.password,
      createdAt: user.createdAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ DEBUG ENDPOINT - Check stored tokens ============
app.get('/api/debug/tokens/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const db = await readDB();
    const tokens = db.tokens[userId] || {};

    res.json({
      userId,
      hasFacebook: !!tokens.facebook,
      facebookPages: tokens.facebook?.pages?.length || 0,
      hasLinkedIn: !!tokens.linkedin,
      linkedInProfile: tokens.linkedin?.profile ? {
        sub: tokens.linkedin.profile.sub,
        name: tokens.linkedin.profile.name
      } : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ CRON JOB FOR SCHEDULED POSTS ============
cron.schedule('* * * * *', async () => {
  // Runs every minute
  try {
    const db = await readDB();

    // Get current time in Lima, Peru timezone (UTC-5)
    const now = new Date();
    const limaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));

    for (const post of db.posts) {
      // CRITICAL: Only publish posts that are scheduled AND approved (or have no approval workflow)
      if (post.status !== 'scheduled') continue;

      // Skip rejected posts - they should NEVER be published
      if (post.approvalStatus?.approved === false) {
        console.log(`⚠️ Skipping rejected post: ${post.id}`);
        continue;
      }

      // If post went through approval workflow, ensure it was actually approved
      if (post.approvalStatus && post.approvalStatus.approved !== true) {
        console.log(`⚠️ Skipping non-approved post: ${post.id}`);
        continue;
      }
      
      // Parse the scheduled time in Lima timezone
      const scheduledDateTime = new Date(`${post.scheduleDate}T${post.scheduleTime}`);
      
      if (scheduledDateTime <= limaTime) {
        console.log(`Publishing scheduled post: ${post.id}`);
        
        try {
          const results = {};
          
          if (post.platforms.facebook) {
            results.facebook = await postToFacebook(post.userId, post);
          }
          
          if (post.platforms.linkedin) {
            results.linkedin = await postToLinkedIn(post.userId, post);
          }
          
          // Update post status
          post.status = 'published';
          post.publishedAt = limaTime.toISOString();
          post.results = results;
          
          await writeDB(db);
          console.log(`Successfully published post ${post.id}`);
        } catch (error) {
          console.error(`Failed to publish post ${post.id}:`, error.message);
          post.status = 'failed';
          post.error = error.message;
          await writeDB(db);
        }
      }
    }
  } catch (error) {
    console.error('Cron job error:', error);
  }
});

// ============ START SERVER ============
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Social Planner API running on port ${PORT}`);
    console.log(`📊 Database: ${usePostgres ? 'PostgreSQL (Supabase) ✅' : 'JSON (fallback) ⚠️'}`);
    console.log(`🔵 Facebook OAuth: http://localhost:${PORT}/auth/facebook`);
    console.log(`🔵 LinkedIn OAuth: http://localhost:${PORT}/auth/linkedin`);
  });
}).catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});