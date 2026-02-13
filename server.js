const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
const { Resend } = require('resend');
const rateLimit = require('express-rate-limit');

// Import PostgreSQL database (direct queries only - no more readDB/writeDB)
const pgDb = require('./database-pg');

// Import Supabase Storage
const storage = require('./storage');

// Import health monitoring
const healthCheck = require('./health-check');

const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting - prevent abuse (10 requests per minute per IP)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: 'Demasiadas solicitudes. Por favor intenta más tarde.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(limiter); // Apply rate limiting to all routes

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

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  const stats = healthCheck.getHealthStats();
  const isHealthy = healthCheck.checkMemoryHealth();

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    ...stats
  });
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

// Email to admin when a post is published (scheduled or immediate)
async function sendPostPublishedEmail(post, publishedPlatforms) {
  try {
    // Get all admin users
    const users = await pgDb.getUsers();
    const admins = Object.values(users).filter(u => u.role === 'admin');

    if (admins.length === 0) {
      console.log('⚠️ No admins to notify about published post');
      return;
    }

    const platformsList = Object.keys(publishedPlatforms).filter(p => publishedPlatforms[p]).join(', ');
    const postCreator = await pgDb.getUser(post.userId);
    const creatorName = postCreator?.fullName || post.userId;

    for (const admin of admins) {
      console.log(`📧 Sending post published notification to admin ${admin.email}...`);
      await resend.emails.send({
        from: FROM_EMAIL,
        to: admin.email,
        subject: `✅ Publicación realizada en ${platformsList}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #28a745;">✅ Publicación Exitosa</h1>
            <p>Hola <strong>${admin.fullName}</strong>,</p>
            <p>Una publicación ha sido publicada exitosamente.</p>

            <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Plataformas:</strong> ${platformsList}</p>
              <p><strong>Creador:</strong> ${creatorName}</p>
              <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })}</p>
            </div>

            <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Contenido:</strong></p>
              <p style="white-space: pre-wrap;">${post.caption?.substring(0, 500)}${post.caption?.length > 500 ? '...' : ''}</p>
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
      console.log(`✅ Post published email sent to ${admin.email}`);
    }
  } catch (error) {
    console.error('❌ Failed to send post published email:', error);
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

    const users = await pgDb.getUsers();

    // Only allow registration if NO users exist (first user setup)
    if (Object.keys(users).length > 0) {
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
    await pgDb.createUser(email, fullName, password, 'admin');

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

    // Check if user already exists
    const existingUser = await pgDb.getUser(email);
    if (existingUser) {
      return res.status(400).json({ error: 'El correo electrónico ya existe' });
    }

    const userRole = role || 'collaborator';

    // Create user
    await pgDb.createUser(email, fullName, password, userRole);

    const newUser = await pgDb.getUser(email);

    // Send welcome email with credentials
    await sendWelcomeEmail(newUser, password);

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

    // Check if user exists
    const userToDelete = await pgDb.getUser(emailToDelete);
    if (!userToDelete) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Prevent deletion if it's the only admin
    const allUsers = await pgDb.getUsers();
    const admins = Object.values(allUsers).filter(u => u.role === 'admin');
    if (userToDelete.role === 'admin' && admins.length === 1) {
      return res.status(400).json({ error: 'No puedes eliminar el único administrador del sistema' });
    }

    // Delete user's posts (soft delete)
    const userPosts = await pgDb.getPosts(emailToDelete);
    for (const post of userPosts) {
      await pgDb.softDeletePost(post.id);
    }

    // Delete user's tokens
    await pgDb.deleteTokens(emailToDelete);

    // Delete user
    await pgDb.deleteUser(emailToDelete);

    console.log(`🗑️ User deleted: ${emailToDelete} (${userToDelete.fullName})`);

    res.json({
      success: true,
      message: `Usuario ${userToDelete.fullName} eliminado exitosamente`,
      deletedUser: {
        email: userToDelete.email,
        fullName: userToDelete.fullName,
        role: userToDelete.role
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

    const user = await pgDb.getUser(email);

    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    res.json({
      success: true,
      user: {
        fullName: user.fullName,
        email: user.email,
        password: user.password,
        role: user.role || 'admin'
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

    const user = await pgDb.getUser(email);

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
    await pgDb.updateUserPassword(email, newPassword);

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
      await pgDb.saveTokens('app', 'facebook', {
        accessToken: accessToken,
        pages: pagesResponse.data.data || [],
        connectedAt: new Date().toISOString(),
        connectedBy: userId
      });

      console.log('Saved Facebook tokens at app level. Connected by:', userId, 'Pages count:', (pagesResponse.data.data || []).length);

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
      await pgDb.saveTokens('app', 'linkedin', {
        accessToken: accessToken,
        profile: profileResponse.data,
        organizations: organizations,
        connectedAt: new Date().toISOString(),
        connectedBy: userId
      });

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
  // Use APP-LEVEL tokens (shared by all users)
  const appTokens = await pgDb.getTokens('app');
  const fbToken = appTokens.facebook;

  if (!fbToken) throw new Error('Facebook no está conectado');
  if (!fbToken.pages || fbToken.pages.length === 0) {
    throw new Error('No Facebook pages found. Please reconnect your Facebook account.');
  }

  const pageToken = fbToken.pages[0].access_token; // Use first page
  const pageId = fbToken.pages[0].id;

  // Get media items (new format) or fall back to single media (legacy)
  const mediaItems = postData.mediaItems || [];
  const images = mediaItems.filter(m => m.type === 'image' && m.base64Data);
  const videos = mediaItems.filter(m => m.type === 'video' && m.base64Data);
  const pdfs = mediaItems.filter(m => m.type === 'pdf');

  // Warn about PDFs - Facebook doesn't support them
  if (pdfs.length > 0) {
    console.warn('⚠️ Facebook does not support PDF uploads, skipping PDFs');
  }

  // MULTI-IMAGE POST (2+ images)
  if (images.length > 1) {
    console.log(`📸 Uploading ${images.length} images to Facebook as multi-image post`);
    const attachedMedia = [];

    for (const img of images) {
      const mediaBuffer = Buffer.from(img.base64Data.split(',')[1], 'base64');
      const tempFile = path.join('uploads', `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`);

      await fs.writeFile(tempFile, mediaBuffer);

      const form = new FormData();
      form.append('source', await fs.readFile(tempFile), {
        filename: 'image.jpg',
        contentType: img.mimeType || 'image/jpeg'
      });
      form.append('access_token', pageToken);
      form.append('published', 'false'); // Upload as unpublished

      try {
        const uploadResponse = await axios.post(
          `https://graph.facebook.com/v18.0/${pageId}/photos`,
          form,
          {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          }
        );

        attachedMedia.push({ media_fbid: uploadResponse.data.id });
        await fs.unlink(tempFile);
        console.log(`✅ Uploaded image ${attachedMedia.length}/${images.length}`);
      } catch (error) {
        await fs.unlink(tempFile).catch(() => {});
        console.error('❌ Failed to upload image:', error.response?.data || error.message);
        throw new Error(`Facebook image upload failed: ${error.response?.data?.error?.message || error.message}`);
      }
    }

    // Create post with all attached media
    try {
      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${pageId}/feed`,
        {
          message: postData.caption,
          attached_media: attachedMedia,
          access_token: pageToken
        }
      );
      console.log(`✅ Facebook multi-image post created with ${attachedMedia.length} images`);
      return response.data;
    } catch (error) {
      console.error('❌ Facebook multi-image post error:', error.response?.data);
      throw new Error(`Facebook multi-image post failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  // SINGLE IMAGE/VIDEO (legacy behavior)
  // Use first image, or first video, or legacy single media
  let singleMedia = null;
  if (images.length === 1) {
    singleMedia = images[0].base64Data;
  } else if (videos.length > 0) {
    singleMedia = videos[0].base64Data;
  } else if (postData.media) {
    singleMedia = postData.media;
  }

  if (singleMedia) {
    const mediaBuffer = Buffer.from(singleMedia.split(',')[1], 'base64');
    const mediaType = singleMedia.split(';')[0].split(':')[1];
    const isVideo = mediaType.startsWith('video/');
    const extension = isVideo ? 'mp4' : 'jpg';
    const tempFile = path.join('uploads', `temp_${Date.now()}.${extension}`);

    await fs.writeFile(tempFile, mediaBuffer);

    const form = new FormData();
    form.append('source', await fs.readFile(tempFile), {
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
      await fs.unlink(tempFile).catch(() => {});
      console.error(`Facebook ${isVideo ? 'video' : 'photo'} upload error:`, JSON.stringify(error.response?.data, null, 2));
      throw new Error(`Facebook ${isVideo ? 'video' : 'photo'} upload failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  // Text-only post
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${pageId}/feed`,
      {
        message: postData.caption,
        access_token: pageToken
      }
    );
    return response.data;
  } catch (error) {
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
async function postToLinkedIn(userId, postData, organizationId = null) {
  // Use APP-LEVEL tokens (shared by all users)
  const appTokens = await pgDb.getTokens('app');
  const liToken = appTokens.linkedin;

  if (!liToken) throw new Error('LinkedIn no está conectado');

  // Find specific organization or use first as fallback
  let organization;
  if (organizationId) {
    organization = liToken.organizations.find(org => org.id === organizationId);
    if (!organization) {
      throw new Error(`Organización LinkedIn no encontrada: ${organizationId}`);
    }
  } else {
    // Fallback to first organization if none specified
    if (!liToken.organizations || liToken.organizations.length === 0) {
      throw new Error('No se encontraron páginas de LinkedIn. Por favor, reconecta tu cuenta de LinkedIn.');
    }
    organization = liToken.organizations[0];
  }

  const organizationURN = `urn:li:organization:${organization.id}`;

  // Get media items (new format) or fall back to single media (legacy)
  const mediaItems = postData.mediaItems || [];
  console.log(`🔵 LinkedIn postToLinkedIn received ${mediaItems.length} mediaItems:`, mediaItems.map(m => ({ type: m.type, mimeType: m.mimeType, hasBase64: !!m.base64Data, base64Start: m.base64Data?.substring(0, 30) })));

  // Detect type from multiple sources (type field, mimeType field, or base64 header)
  const getMediaType = (m) => {
    if (m.type === 'pdf' || m.mimeType === 'application/pdf') return 'pdf';
    if (m.base64Data?.startsWith('data:application/pdf')) return 'pdf';
    if (m.type === 'video' || m.mimeType?.startsWith('video/')) return 'video';
    if (m.base64Data?.startsWith('data:video/')) return 'video';
    return 'image';
  };

  const images = mediaItems.filter(m => getMediaType(m) === 'image' && m.base64Data);
  const videos = mediaItems.filter(m => getMediaType(m) === 'video' && m.base64Data);
  const pdfs = mediaItems.filter(m => getMediaType(m) === 'pdf' && m.base64Data);
  console.log(`🔵 LinkedIn detected: ${images.length} images, ${videos.length} videos, ${pdfs.length} PDFs`);

  // Helper function to upload a single media to LinkedIn
  async function uploadLinkedInMedia(base64Data, recipe) {
    const mediaBuffer = Buffer.from(base64Data.split(',')[1], 'base64');

    const registerResponse = await axios.post(
      'https://api.linkedin.com/v2/assets?action=registerUpload',
      {
        registerUploadRequest: {
          recipes: [recipe],
          owner: organizationURN,
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

    await axios.put(uploadUrl, mediaBuffer, {
      headers: {
        Authorization: `Bearer ${liToken.accessToken}`,
        'Content-Type': 'application/octet-stream'
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    return asset;
  }

  // PDF DOCUMENT POST (takes priority - LinkedIn documents are special)
  if (pdfs.length > 0) {
    console.log(`📄 Uploading PDF document to LinkedIn`);
    const pdf = pdfs[0]; // LinkedIn only supports 1 document per post
    const pdfBuffer = Buffer.from(pdf.base64Data.split(',')[1], 'base64');

    try {
      // Step 1: Initialize document upload
      const initResponse = await axios.post(
        'https://api.linkedin.com/rest/documents?action=initializeUpload',
        {
          initializeUploadRequest: {
            owner: organizationURN
          }
        },
        {
          headers: {
            Authorization: `Bearer ${liToken.accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
            'LinkedIn-Version': '202601'
          }
        }
      );

      const uploadUrl = initResponse.data.value.uploadUrl;
      const documentUrn = initResponse.data.value.document;

      // Step 2: Upload the PDF binary
      await axios.put(uploadUrl, pdfBuffer, {
        headers: {
          Authorization: `Bearer ${liToken.accessToken}`,
          'Content-Type': 'application/octet-stream'
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      // Step 3: Create post with document
      const documentPostBody = {
        author: organizationURN,
        commentary: postData.caption,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: []
        },
        content: {
          media: {
            title: postData.pdfTitle || pdf.fileName || 'Documento',
            id: documentUrn
          }
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false
      };

      const response = await axios.post(
        'https://api.linkedin.com/rest/posts',
        documentPostBody,
        {
          headers: {
            Authorization: `Bearer ${liToken.accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
            'LinkedIn-Version': '202601'
          }
        }
      );

      console.log('✅ LinkedIn PDF document post successful');
      return response.data;
    } catch (error) {
      console.error('❌ LinkedIn PDF upload error:', JSON.stringify(error.response?.data, null, 2) || error.message);
      console.error('❌ Full error details:', error.response?.status, error.response?.statusText);
      // THROW the error - don't silently fall back to text-only
      throw new Error(`LinkedIn PDF upload failed: ${JSON.stringify(error.response?.data) || error.message}`);
    }
  }

  // MULTI-IMAGE POST (2+ images)
  if (images.length > 1) {
    console.log(`📸 Uploading ${images.length} images to LinkedIn as multi-image post`);

    const uploadedAssets = [];
    for (const img of images) {
      try {
        const asset = await uploadLinkedInMedia(img.base64Data, 'urn:li:digitalmediaRecipe:feedshare-image');
        uploadedAssets.push({ status: 'READY', media: asset });
        console.log(`✅ Uploaded image ${uploadedAssets.length}/${images.length} to LinkedIn`);
      } catch (error) {
        console.error('❌ Failed to upload image to LinkedIn:', error.response?.data || error.message);
        throw new Error(`LinkedIn image upload failed: ${error.response?.data?.message || error.message}`);
      }
    }

    const multiImagePostBody = {
      author: organizationURN,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {
            text: postData.caption
          },
          shareMediaCategory: 'IMAGE',
          media: uploadedAssets
        }
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
      }
    };

    try {
      const response = await axios.post(
        'https://api.linkedin.com/v2/ugcPosts',
        multiImagePostBody,
        {
          headers: {
            Authorization: `Bearer ${liToken.accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0'
          }
        }
      );
      console.log(`✅ LinkedIn multi-image post created with ${uploadedAssets.length} images`);
      return response.data;
    } catch (error) {
      console.error('❌ LinkedIn multi-image post error:', error.response?.data);
      throw new Error(`LinkedIn multi-image post failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // SINGLE IMAGE/VIDEO (legacy behavior)
  let singleMedia = null;
  let mediaCategory = 'NONE';
  let recipe = null;

  if (images.length === 1) {
    singleMedia = images[0].base64Data;
    mediaCategory = 'IMAGE';
    recipe = 'urn:li:digitalmediaRecipe:feedshare-image';
  } else if (videos.length > 0) {
    singleMedia = videos[0].base64Data;
    mediaCategory = 'VIDEO';
    recipe = 'urn:li:digitalmediaRecipe:feedshare-video';
  } else if (postData.media) {
    singleMedia = postData.media;
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

  // If there's single media, upload it
  if (singleMedia && recipe) {
    try {
      const asset = await uploadLinkedInMedia(singleMedia, recipe);
      postBody.specificContent['com.linkedin.ugc.ShareContent'].media = [{
        status: 'READY',
        media: asset
      }];
    } catch (error) {
      console.error('❌ LinkedIn media upload error:', error.response?.data || error.message);
      throw new Error(`LinkedIn media upload failed: ${error.response?.data?.message || error.message}`);
    }
  }

  try {
    console.log('🔵 Posting to LinkedIn organization:', organizationURN);

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

    const postId = postData.id || Date.now().toString();

    // Handle multiple media items (new format) or single media (legacy format)
    let uploadedMediaItems = [];
    let mediaUrl = null;

    // New format: mediaItems array
    if (postData.mediaItems && postData.mediaItems.length > 0) {
      try {
        uploadedMediaItems = await storage.uploadMultipleMedia(postData.mediaItems, userId);
        // Filter out failed uploads
        uploadedMediaItems = uploadedMediaItems.filter(item => item.url);
        console.log(`✅ ${uploadedMediaItems.length} media files uploaded for draft ${postId}`);
        // For backwards compatibility, set mediaUrl to first image
        if (uploadedMediaItems.length > 0) {
          mediaUrl = uploadedMediaItems[0].url;
        }
      } catch (uploadError) {
        console.error('❌ Media upload failed:', uploadError);
        return res.status(500).json({ error: 'Error al subir los archivos' });
      }
    }
    // Legacy format: single media string
    else if (postData.media) {
      try {
        mediaUrl = await storage.uploadMedia(postData.media, userId);
        console.log(`✅ Media uploaded for draft ${postId}: ${mediaUrl}`);
        // Convert to new format for storage
        const mediaType = postData.media.split(';')[0].split(':')[1];
        uploadedMediaItems = [{
          url: mediaUrl,
          type: mediaType === 'application/pdf' ? 'pdf' : mediaType.startsWith('video/') ? 'video' : 'image',
          mimeType: mediaType
        }];
      } catch (uploadError) {
        console.error('❌ Media upload failed:', uploadError);
        return res.status(500).json({ error: 'Error al subir la imagen/video' });
      }
    }

    const post = {
      id: postId,
      userId: userId || 'default_user',
      caption: postData.caption,
      mediaUrl: mediaUrl,
      platforms: postData.platforms,
      linkedInOrganizationId: postData.linkedInOrganizationId,
      pdfTitle: postData.pdfTitle || null,
      scheduleDate: postData.scheduleDate,
      scheduleTime: postData.scheduleTime,
      status: 'draft',
      approvalStatus: postData.approvalStatus || null,
      createdAt: postData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Check if post exists
    const existingPost = await pgDb.getPost(postId);
    if (existingPost) {
      // Update existing
      await pgDb.updatePost(postId, post);
      // Update media items
      if (uploadedMediaItems.length > 0) {
        await pgDb.updatePostMedia(postId, uploadedMediaItems);
      }
    } else {
      // Create new
      await pgDb.createPost(post);
      // Create media items
      if (uploadedMediaItems.length > 0) {
        await pgDb.createPostMedia(postId, uploadedMediaItems);
      }
    }

    // Get media items for response
    const mediaItems = await pgDb.getPostMedia(postId);

    res.json({ success: true, post: { ...post, hasMedia: !!mediaUrl, mediaItems } });
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

    const postId = postData.id || `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`📤 Send for approval - postId: ${postId}, mediaItems: ${postData.mediaItems?.length || 0}`);

    // Upload all media items to Supabase Storage
    const uploadedMediaItems = [];
    if (postData.mediaItems && postData.mediaItems.length > 0) {
      for (const item of postData.mediaItems) {
        if (item.base64Data) {
          try {
            const url = await storage.uploadMedia(item.base64Data, userId);
            uploadedMediaItems.push({
              url: url,
              type: item.type,  // 'image', 'video', or 'pdf'
              fileName: item.fileName,
              fileSize: item.fileSize,
              mimeType: item.mimeType
            });
            console.log(`✅ Uploaded ${item.type} for approval: ${url}`);
          } catch (uploadError) {
            console.error(`❌ Failed to upload ${item.type}:`, uploadError.message);
          }
        }
      }
    }

    // Fallback: upload single media if no mediaItems
    let mediaUrl = null;
    if (uploadedMediaItems.length === 0 && postData.media) {
      try {
        mediaUrl = await storage.uploadMedia(postData.media, userId);
        console.log(`✅ Legacy media uploaded for approval ${postId}: ${mediaUrl}`);
      } catch (uploadError) {
        console.error('❌ Media upload failed:', uploadError);
        return res.status(500).json({ error: 'Error al subir la imagen/video' });
      }
    } else if (uploadedMediaItems.length > 0) {
      mediaUrl = uploadedMediaItems[0].url;  // First item for backwards compatibility
    }

    const post = {
      id: postId,
      userId: userId || 'default_user',
      caption: postData.caption,
      mediaUrl: mediaUrl,
      platforms: postData.platforms,
      linkedInOrganizationId: postData.linkedInOrganizationId,
      pdfTitle: postData.pdfTitle,
      scheduleDate: postData.scheduleDate,
      scheduleTime: postData.scheduleTime,
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

    // Check if post exists
    const existingPost = await pgDb.getPost(postId);
    if (existingPost) {
      await pgDb.updatePost(postId, post);
    } else {
      await pgDb.createPost(post);
    }

    // Save media items with correct types
    if (uploadedMediaItems.length > 0) {
      await pgDb.updatePostMedia(postId, uploadedMediaItems);
      console.log(`✅ Saved ${uploadedMediaItems.length} media items with types:`, uploadedMediaItems.map(m => m.type));
    }

    // Send email notifications
    const approver = await pgDb.getUser(approverId);
    const requester = await pgDb.getUser(userId);
    if (approver && requester) {
      await sendApprovalRequestEmail(approver, requester, post);
      await sendCollaboratorConfirmationEmail(requester, approver, post);
    }

    res.json({ success: true, post: { ...post, hasMedia: !!mediaUrl, mediaItems: uploadedMediaItems } });
  } catch (error) {
    console.error('Send for approval error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ GET PENDING APPROVALS ============
app.get('/api/posts/pending-approval', async (req, res) => {
  try {
    const { userId } = req.query;
    console.log(`📋 Loading pending approvals for user: ${userId}`);

    // Direct query - only get posts with status = pending_approval for this approver
    const result = await pgDb.pool.query(
      `SELECT id, user_id, caption, media_url, platforms_facebook, platforms_linkedin,
       linkedin_organization_id, schedule_date, schedule_time, status, approval_status,
       created_at, updated_at
       FROM posts
       WHERE status = 'pending_approval'
       AND approval_status->>'approverId' = $1
       AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [userId]
    );
    console.log(`📋 Found ${result.rows.length} pending posts`);

    const posts = await Promise.all(result.rows.map(async row => {
      // Load media items for this post
      const mediaItems = await pgDb.getPostMedia(row.id);
      console.log(`📋 Post ${row.id} mediaItems:`, JSON.stringify(mediaItems));

      return {
        id: row.id,
        userId: row.user_id,
        caption: row.caption,
        mediaUrl: row.media_url,
        hasMedia: !!row.media_url || mediaItems.length > 0,
        mediaItems: mediaItems,
        platforms: {
          facebook: row.platforms_facebook,
          linkedin: row.platforms_linkedin
        },
        linkedInOrganizationId: row.linkedin_organization_id,
        scheduleDate: row.schedule_date,
        scheduleTime: row.schedule_time,
        status: row.status,
        approvalStatus: row.approval_status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }));

    res.json(posts);
  } catch (error) {
    console.error('Get pending approvals error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ GET MY PENDING APPROVALS (Collaborator's own posts) ============
app.get('/api/posts/my-pending-approvals', async (req, res) => {
  try {
    const { userId } = req.query;

    // Direct query - only get posts this user sent for approval
    const result = await pgDb.pool.query(
      `SELECT id, user_id, caption, media_url, platforms_facebook, platforms_linkedin,
       linkedin_organization_id, schedule_date, schedule_time, status, approval_status,
       created_at, updated_at
       FROM posts
       WHERE status = 'pending_approval'
       AND approval_status->>'requestedBy' = $1
       AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [userId]
    );

    const posts = await Promise.all(result.rows.map(async row => {
      // Load media items for this post
      const mediaItems = await pgDb.getPostMedia(row.id);

      return {
        id: row.id,
        userId: row.user_id,
        caption: row.caption,
        mediaUrl: row.media_url,
        hasMedia: !!row.media_url || mediaItems.length > 0,
        mediaItems: mediaItems,
        platforms: {
          facebook: row.platforms_facebook,
          linkedin: row.platforms_linkedin
        },
        linkedInOrganizationId: row.linkedin_organization_id,
        scheduleDate: row.schedule_date,
        scheduleTime: row.schedule_time,
        status: row.status,
        approvalStatus: row.approval_status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }));

    res.json(posts);
  } catch (error) {
    console.error('Get my pending approvals error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ APPROVE POST ============
app.post('/api/posts/approve', async (req, res) => {
  try {
    const { postId, approverId, scheduledDate, scheduledTime } = req.body;

    // Get post - direct query, no full DB load
    const post = await pgDb.getPost(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post no encontrado' });
    }

    if (post.approvalStatus?.approverId !== approverId) {
      return res.status(403).json({ error: 'No tienes permiso para aprobar este post' });
    }

    // Update approval status
    const updatedApprovalStatus = {
      ...post.approvalStatus,
      approved: true,
      approvedAt: new Date().toISOString()
    };

    // Check if scheduled time has already passed
    const finalScheduleDate = scheduledDate || post.scheduleDate;
    const finalScheduleTime = scheduledTime || post.scheduleTime;

    // Get current time in Lima timezone
    const now = new Date();
    const limaFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const limaParts = limaFormatter.formatToParts(now);
    const limaDate = `${limaParts.find(p => p.type === 'year').value}-${limaParts.find(p => p.type === 'month').value}-${limaParts.find(p => p.type === 'day').value}`;
    const limaHour = limaParts.find(p => p.type === 'hour').value;
    const limaMinute = limaParts.find(p => p.type === 'minute').value;
    const limaTimeStr = `${limaHour}:${limaMinute}`;

    console.log(`🔍 Approve check - Post ${postId}:`);
    console.log(`   Scheduled: ${finalScheduleDate} ${finalScheduleTime}`);
    console.log(`   Lima now: ${limaDate} ${limaTimeStr}`);
    console.log(`   Platforms:`, post.platforms);

    // Compare dates and times as strings (both are in Lima timezone)
    const scheduledStr = `${finalScheduleDate} ${finalScheduleTime}`;
    const limaStr = `${limaDate} ${limaTimeStr}`;
    const shouldPublishNow = scheduledStr <= limaStr;
    console.log(`   Should publish now: ${shouldPublishNow}`);

    if (shouldPublishNow) {
      // Scheduled time has passed - publish immediately!
      console.log(`⏰ Post ${postId} scheduled time has passed, publishing immediately...`);

      try {
        // Load media items
        const mediaItems = await pgDb.getPostMedia(postId);
        console.log(`📥 Loading ${mediaItems.length} media items for post ${postId}:`, mediaItems.map(m => ({ type: m.type, mimeType: m.mimeType, url: m.url })));
        const mediaItemsWithBase64 = [];

        for (const item of mediaItems) {
          try {
            console.log(`📥 Downloading media: ${item.url} (type: ${item.type}, mimeType: ${item.mimeType})`);
            const base64 = await storage.downloadMediaAsBase64(item.url);
            console.log(`✅ Downloaded media, base64 length: ${base64?.length || 0}, starts with: ${base64?.substring(0, 50)}`);
            mediaItemsWithBase64.push({ ...item, base64Data: base64 });
          } catch (err) {
            console.error(`❌ Could not download media ${item.url}:`, err.message);
          }
        }

        // Also handle legacy single media
        if (mediaItemsWithBase64.length === 0 && post.mediaUrl) {
          try {
            post.media = await storage.downloadMediaAsBase64(post.mediaUrl);
          } catch (err) {
            console.warn(`⚠️ Could not download media for post ${post.id}:`, err.message);
          }
        }

        post.mediaItems = mediaItemsWithBase64;
        if (mediaItemsWithBase64.length > 0 && !post.media) {
          post.media = mediaItemsWithBase64[0].base64Data;
        }

        const results = {};
        let hasError = false;

        if (post.platforms.facebook) {
          try {
            results.facebook = await postToFacebook(post.userId, post);
            console.log(`✅ Facebook publish result:`, results.facebook);
          } catch (fbError) {
            console.error(`❌ Facebook publish error:`, fbError.message);
            results.facebook = { error: fbError.message };
            hasError = true;
          }
        }

        if (post.platforms.linkedin) {
          try {
            results.linkedin = await postToLinkedIn(post.userId, post, post.linkedInOrganizationId);
            console.log(`✅ LinkedIn publish result:`, results.linkedin);
            if (results.linkedin?.error) {
              hasError = true;
            }
          } catch (liError) {
            console.error(`❌ LinkedIn publish error:`, liError.message);
            results.linkedin = { error: liError.message };
            hasError = true;
          }
        }

        // Check if at least one platform was successful
        const fbSuccess = post.platforms.facebook && results.facebook && !results.facebook.error;
        const liSuccess = post.platforms.linkedin && results.linkedin && !results.linkedin.error;
        const anySuccess = fbSuccess || liSuccess;

        // Update post status based on results
        const finalStatus = anySuccess ? 'published' : 'failed';
        await pgDb.updatePost(postId, {
          status: finalStatus,
          publishedAt: anySuccess ? new Date().toISOString() : null,
          results: results,
          approvalStatus: updatedApprovalStatus
        });

        console.log(`${anySuccess ? '✅' : '❌'} Post ${postId} ${finalStatus} after late approval. Results:`, results);

        // Get updated post for response
        const updatedPost = await pgDb.getPost(postId);

        // Send email notification to requester
        const requester = await pgDb.getUser(post.approvalStatus.requestedBy);
        const approverUser = await pgDb.getUser(approverId);
        if (requester && approverUser) {
          await sendApprovalDecisionEmail(requester, approverUser, updatedPost, true);
        }

        // Send email notification to all admins about successful publication (only if success)
        if (anySuccess) {
          await sendPostPublishedEmail(updatedPost, post.platforms);
        }

        // Return with details about what worked and what didn't
        if (!anySuccess) {
          return res.status(500).json({
            success: false,
            error: 'Error al publicar en las plataformas',
            post: updatedPost,
            results: results,
            publishedImmediately: true
          });
        }

        return res.json({
          success: true,
          post: updatedPost,
          publishedImmediately: true,
          results: results,
          warnings: hasError ? 'Algunas plataformas tuvieron errores' : null
        });
      } catch (publishError) {
        console.error(`❌ Failed to publish post ${postId} immediately:`, publishError.message);
        // Fall back to scheduled status if publishing fails
        await pgDb.updatePost(postId, {
          status: 'failed',
          approvalStatus: updatedApprovalStatus
        });
        return res.status(500).json({ error: `Error al publicar: ${publishError.message}` });
      }
    } else {
      // Scheduled time hasn't passed yet - just mark as scheduled
      await pgDb.updatePost(postId, {
        status: 'scheduled',
        scheduleDate: finalScheduleDate,
        scheduleTime: finalScheduleTime,
        approvalStatus: updatedApprovalStatus
      });

      // Get updated post for response
      const updatedPost = await pgDb.getPost(postId);

      // Send email notification to requester
      const requester = await pgDb.getUser(post.approvalStatus.requestedBy);
      const approverUser = await pgDb.getUser(approverId);
      if (requester && approverUser) {
        await sendApprovalDecisionEmail(requester, approverUser, updatedPost, true);
      }

      res.json({ success: true, post: updatedPost, publishedImmediately: false });
    }
  } catch (error) {
    console.error('Approve post error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ REJECT POST ============
app.post('/api/posts/reject', async (req, res) => {
  try {
    const { postId, approverId, reason } = req.body;

    // Get post - direct query
    const post = await pgDb.getPost(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post no encontrado' });
    }

    if (post.approvalStatus?.approverId !== approverId) {
      return res.status(403).json({ error: 'No tienes permiso para rechazar este post' });
    }

    // Get user info BEFORE deleting (for email)
    const requester = await pgDb.getUser(post.approvalStatus.requestedBy);
    const approver = await pgDb.getUser(approverId);

    // Add rejection info for the email
    const rejectedPost = {
      ...post,
      approvalStatus: {
        ...post.approvalStatus,
        approved: false,
        approvedAt: new Date().toISOString(),
        rejectedReason: reason || 'Sin motivo especificado'
      }
    };

    // Send email notification to requester
    if (requester && approver) {
      await sendApprovalDecisionEmail(requester, approver, rejectedPost, false);
    }

    // CRITICAL: Delete the post completely (hard delete)
    // Rejected posts should NOT remain in the system or be published
    await pgDb.deletePost(postId);

    // Also delete media from storage if exists
    if (post.mediaUrl) {
      try {
        await storage.deleteMedia(post.mediaUrl);
      } catch (err) {
        console.warn('⚠️ Could not delete media:', err.message);
      }
    }

    console.log(`🗑️ Post ${postId} rejected and deleted permanently`);

    res.json({ success: true, message: 'Post rechazado y eliminado' });
  } catch (error) {
    console.error('Reject post error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ SCHEDULE POST ============
app.post('/api/schedule', async (req, res) => {
  try {
    const { userId, postData } = req.body;

    const postId = postData.id || Date.now().toString();

    // Handle multiple media items (new format) or single media (legacy format)
    let uploadedMediaItems = [];
    let mediaUrl = null;

    // New format: mediaItems array
    if (postData.mediaItems && postData.mediaItems.length > 0) {
      try {
        uploadedMediaItems = await storage.uploadMultipleMedia(postData.mediaItems, userId);
        uploadedMediaItems = uploadedMediaItems.filter(item => item.url);
        console.log(`✅ ${uploadedMediaItems.length} media files uploaded for schedule ${postId}`);
        if (uploadedMediaItems.length > 0) {
          mediaUrl = uploadedMediaItems[0].url;
        }
      } catch (uploadError) {
        console.error('❌ Media upload failed:', uploadError);
        return res.status(500).json({ error: 'Error al subir los archivos' });
      }
    }
    // Legacy format: single media string
    else if (postData.media) {
      try {
        mediaUrl = await storage.uploadMedia(postData.media, userId);
        console.log(`✅ Media uploaded for schedule ${postId}: ${mediaUrl}`);
        const mediaType = postData.media.split(';')[0].split(':')[1];
        uploadedMediaItems = [{
          url: mediaUrl,
          type: mediaType === 'application/pdf' ? 'pdf' : mediaType.startsWith('video/') ? 'video' : 'image',
          mimeType: mediaType
        }];
      } catch (uploadError) {
        console.error('❌ Media upload failed:', uploadError);
        return res.status(500).json({ error: 'Error al subir la imagen/video' });
      }
    }

    const post = {
      id: postId,
      userId: userId || 'default_user',
      caption: postData.caption,
      mediaUrl: mediaUrl,
      platforms: postData.platforms,
      linkedInOrganizationId: postData.linkedInOrganizationId,
      pdfTitle: postData.pdfTitle || null,
      scheduleDate: postData.scheduleDate,
      scheduleTime: postData.scheduleTime,
      status: 'scheduled',
      approvalStatus: postData.approvalStatus || null,
      createdAt: postData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Check if post exists
    const existingPost = await pgDb.getPost(postId);
    if (existingPost) {
      await pgDb.updatePost(postId, post);
      if (uploadedMediaItems.length > 0) {
        await pgDb.updatePostMedia(postId, uploadedMediaItems);
      }
    } else {
      await pgDb.createPost(post);
      if (uploadedMediaItems.length > 0) {
        await pgDb.createPostMedia(postId, uploadedMediaItems);
      }
    }

    const mediaItems = await pgDb.getPostMedia(postId);

    res.json({ success: true, post: { ...post, hasMedia: !!mediaUrl, mediaItems } });
  } catch (error) {
    console.error('Schedule error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ POST NOW ============
app.post('/api/post-now', async (req, res) => {
  try {
    const { userId, postData } = req.body;

    const postId = postData.id || Date.now().toString();

    // Handle multiple media items (new format) or single media (legacy format)
    let uploadedMediaItems = [];
    let mediaUrl = null;

    // New format: mediaItems array
    if (postData.mediaItems && postData.mediaItems.length > 0) {
      try {
        uploadedMediaItems = await storage.uploadMultipleMedia(postData.mediaItems, userId);
        uploadedMediaItems = uploadedMediaItems.filter(item => item.url);
        console.log(`✅ ${uploadedMediaItems.length} media files uploaded for post-now ${postId}`);
        if (uploadedMediaItems.length > 0) {
          mediaUrl = uploadedMediaItems[0].url;
        }
      } catch (uploadError) {
        console.error('❌ Media upload failed:', uploadError);
        return res.status(500).json({ error: 'Error al subir los archivos' });
      }
    }
    // Legacy format: single media string
    else if (postData.media) {
      try {
        mediaUrl = await storage.uploadMedia(postData.media, userId);
        console.log(`✅ Media uploaded for post-now ${postId}: ${mediaUrl}`);
        const mediaType = postData.media.split(';')[0].split(':')[1];
        uploadedMediaItems = [{
          url: mediaUrl,
          type: mediaType === 'application/pdf' ? 'pdf' : mediaType.startsWith('video/') ? 'video' : 'image',
          mimeType: mediaType
        }];
      } catch (uploadError) {
        console.error('❌ Media upload failed:', uploadError);
        return res.status(500).json({ error: 'Error al subir la imagen/video' });
      }
    }

    // Prepare media items with base64 for social APIs
    const mediaItemsWithBase64 = [];
    for (const item of uploadedMediaItems) {
      try {
        const base64 = await storage.downloadMediaAsBase64(item.url);
        mediaItemsWithBase64.push({ ...item, base64Data: base64 });
      } catch (err) {
        console.warn(`⚠️ Could not download media ${item.url}:`, err.message);
      }
    }

    // For backwards compatibility, also set single media
    let mediaBase64 = postData.media;
    if (mediaItemsWithBase64.length > 0 && !mediaBase64) {
      mediaBase64 = mediaItemsWithBase64[0].base64Data;
    }

    const postDataWithMedia = {
      ...postData,
      media: mediaBase64,
      mediaItems: mediaItemsWithBase64
    };

    const results = {};

    if (postData.platforms.facebook) {
      results.facebook = await postToFacebook(userId || 'default_user', postDataWithMedia);
    }

    if (postData.platforms.linkedin) {
      results.linkedin = await postToLinkedIn(userId || 'default_user', postDataWithMedia, postData.linkedInOrganizationId);
    }

    // Save to database as published (with mediaUrl, not base64)
    const post = {
      id: postId,
      userId: userId || 'default_user',
      caption: postData.caption,
      mediaUrl: mediaUrl,
      platforms: postData.platforms,
      linkedInOrganizationId: postData.linkedInOrganizationId,
      pdfTitle: postData.pdfTitle || null,
      scheduleDate: postData.scheduleDate,
      scheduleTime: postData.scheduleTime,
      status: 'published',
      publishedAt: new Date().toISOString(),
      results: results,
      createdAt: postData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Check if post exists
    const existingPost = await pgDb.getPost(postId);
    if (existingPost) {
      await pgDb.updatePost(postId, post);
      if (uploadedMediaItems.length > 0) {
        await pgDb.updatePostMedia(postId, uploadedMediaItems);
      }
    } else {
      await pgDb.createPost(post);
      if (uploadedMediaItems.length > 0) {
        await pgDb.createPostMedia(postId, uploadedMediaItems);
      }
    }

    const mediaItems = await pgDb.getPostMedia(postId);

    // Send email notification to admins
    await sendPostPublishedEmail(post, postData.platforms);

    res.json({ success: true, results, post: { ...post, hasMedia: !!mediaUrl, mediaItems } });
  } catch (error) {
    console.error('Post error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ GET POSTS ============
app.get('/api/posts', async (req, res) => {
  try {
    const userId = req.query.userId || null;

    // Get posts with media items
    const posts = await pgDb.getPostsWithMedia(userId);

    res.json(posts);
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ GET MEDIA FOR SPECIFIC POST ============
app.get('/api/posts/:postId/media', async (req, res) => {
  try {
    const post = await pgDb.getPostWithMedia(req.params.postId);

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Return both legacy mediaUrl and new mediaItems array
    res.json({
      mediaUrl: post.mediaUrl || null,
      mediaItems: post.mediaItems || []
    });
  } catch (error) {
    console.error('Get media error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ DELETE POST ============
app.delete('/api/posts/:postId', async (req, res) => {
  try {
    const postId = req.params.postId;

    // Get post with media items
    const post = await pgDb.getPostWithMedia(postId);

    if (post) {
      // Delete all media items from storage
      if (post.mediaItems && post.mediaItems.length > 0) {
        const mediaUrls = post.mediaItems.map(item => item.url).filter(Boolean);
        if (mediaUrls.length > 0) {
          try {
            await storage.deleteMultipleMedia(mediaUrls);
            console.log(`🗑️ Deleted ${mediaUrls.length} media files for post ${postId}`);
          } catch (err) {
            console.warn('⚠️ Could not delete some media files:', err.message);
          }
        }
      }
      // Fallback: delete legacy single media if exists
      else if (post.mediaUrl) {
        try {
          await storage.deleteMedia(post.mediaUrl);
          console.log(`🗑️ Media deleted: ${post.mediaUrl}`);
        } catch (err) {
          console.warn('⚠️ Could not delete media:', err.message);
        }
      }

      // Delete media records from database (cascade should handle this, but be explicit)
      await pgDb.deletePostMedia(postId);

      // Delete post from database
      await pgDb.deletePost(postId);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ CHECK CONNECTION STATUS ============
app.get('/api/connections', async (req, res) => {
  try {
    // Check APP-LEVEL tokens (shared by all users)
    const appTokens = await pgDb.getTokens('app');

    res.json({
      facebook: !!appTokens.facebook,
      linkedin: !!appTokens.linkedin,
      linkedinOrganizations: appTokens.linkedin?.organizations || [],
      instagram: false
    });
  } catch (error) {
    console.error('Get connections error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ DISCONNECT ACCOUNT ============
app.post('/api/disconnect', async (req, res) => {
  try {
    const { userId, platform } = req.body;

    // Check if user is admin
    const user = await pgDb.getUser(userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden desconectar cuentas' });
    }

    // Disconnect at APP-LEVEL (affects all users)
    await pgDb.deleteTokens('app', platform);

    res.json({ success: true, message: `${platform} desconectado para todos los usuarios` });
  } catch (error) {
    console.error('Disconnect error:', error);
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

    const user = await pgDb.getUser(email);

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Reset password
    await pgDb.updateUserPassword(email, newPassword);

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
    const users = await pgDb.getUsers();
    const userList = Object.values(users).map(u => ({
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
    console.error('Get users error:', error);
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

    const users = await pgDb.getUsers();
    const userList = Object.values(users).map(u => ({
      email: u.email,
      fullName: u.fullName,
      password: u.password,
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

    const user = await pgDb.getUser(email);

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Update role
    await pgDb.updateUserRole(email, role);

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
    const users = await pgDb.getUsers();
    const userList = Object.values(users).map(u => ({
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
    const user = await pgDb.getUser(email);

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
    const tokens = await pgDb.getTokens(userId);

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
    // Get current time in Lima, Peru timezone (UTC-5)
    const now = new Date();
    const limaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));

    // Direct query - ONLY get scheduled posts (no full DB load!)
    const result = await pgDb.pool.query(
      `SELECT * FROM posts
       WHERE status = 'scheduled'
       AND deleted_at IS NULL
       ORDER BY schedule_date, schedule_time`
    );

    for (const row of result.rows) {
      const post = {
        id: row.id,
        userId: row.user_id,
        caption: row.caption,
        media: row.media,
        mediaUrl: row.media_url,
        platforms: {
          facebook: row.platforms_facebook,
          linkedin: row.platforms_linkedin
        },
        linkedInOrganizationId: row.linkedin_organization_id,
        scheduleDate: row.schedule_date,
        scheduleTime: row.schedule_time,
        status: row.status,
        approvalStatus: row.approval_status
      };

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
        console.log(`📅 Publishing scheduled post: ${post.id}`);

        try {
          // Load media items from post_media table
          const mediaItems = await pgDb.getPostMedia(post.id);
          console.log(`📎 Post ${post.id} has ${mediaItems.length} media items from DB:`, mediaItems.map(m => ({ type: m.type, url: m.url?.substring(0, 50) })));

          // Download media as base64 for social APIs
          const mediaItemsWithBase64 = [];
          for (const item of mediaItems) {
            try {
              const base64 = await storage.downloadMediaAsBase64(item.url);
              mediaItemsWithBase64.push({ ...item, base64Data: base64 });
            } catch (err) {
              console.warn(`⚠️ Could not download media ${item.url}:`, err.message);
            }
          }

          // Also handle legacy single media
          if (mediaItemsWithBase64.length === 0 && post.mediaUrl && !post.media) {
            try {
              post.media = await storage.downloadMediaAsBase64(post.mediaUrl);
            } catch (err) {
              console.warn(`⚠️ Could not download media for post ${post.id}:`, err.message);
            }
          }

          // Add mediaItems to post object
          post.mediaItems = mediaItemsWithBase64;
          console.log(`📎 Post ${post.id} mediaItemsWithBase64:`, mediaItemsWithBase64.map(m => ({ type: m.type, hasBase64: !!m.base64Data })));

          // For backwards compatibility, set single media from first item
          if (mediaItemsWithBase64.length > 0 && !post.media) {
            post.media = mediaItemsWithBase64[0].base64Data;
          }

          const results = {};

          if (post.platforms.facebook) {
            results.facebook = await postToFacebook(post.userId, post);
          }

          if (post.platforms.linkedin) {
            results.linkedin = await postToLinkedIn(post.userId, post, post.linkedInOrganizationId);
          }

          // Update post status - ONLY this post
          await pgDb.updatePost(post.id, {
            status: 'published',
            publishedAt: limaTime.toISOString(),
            results: results
          });

          console.log(`✅ Successfully published post ${post.id}`);

          // Send email notification to admins
          await sendPostPublishedEmail(post, post.platforms);
        } catch (error) {
          console.error(`❌ Failed to publish post ${post.id}:`, error.message);
          await pgDb.updatePost(post.id, {
            status: 'failed'
          });
        }
      }
    }
  } catch (error) {
    console.error('❌ Cron job error:', error);
  }
});

// ============ START SERVER ============
pgDb.initDB().then(() => {
  // Initialize Supabase Storage
  const storageReady = storage.initStorage();

  app.listen(PORT, () => {
    console.log(`🚀 Social Planner API running on port ${PORT}`);
    console.log(`📊 Database: PostgreSQL (Supabase) ✅`);
    console.log(`📦 Storage: ${storageReady ? 'Supabase Storage ✅' : 'Disabled ⚠️'}`);
    console.log(`🛡️  Rate Limiting: 60 req/min ✅`);
    console.log(`🔵 Facebook OAuth: http://localhost:${PORT}/auth/facebook`);
    console.log(`🔵 LinkedIn OAuth: http://localhost:${PORT}/auth/linkedin`);

    // Start health monitoring
    healthCheck.startHealthMonitoring();
    const initialStats = healthCheck.getHealthStats();
    console.log(`💚 Health monitoring active (Initial: RSS=${initialStats.memory.rss}MB)`);
  });
}).catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});