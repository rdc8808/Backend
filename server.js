const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');

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

// Database file (using JSON for simplicity - use real DB in production)
const DB_FILE = 'database.json';

// Initialize database
async function initDB() {
  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify({
      users: {},
      posts: [],
      tokens: {}
    }));
  }
}

async function readDB() {
  const data = await fs.readFile(DB_FILE, 'utf8');
  return JSON.parse(data);
}

async function writeDB(data) {
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

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

// ============ FACEBOOK OAUTH ============
app.get('/auth/facebook', (req, res) => {
  const userId = req.query.userId || 'default_user';
  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
    `client_id=${CONFIG.FACEBOOK_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(CONFIG.REDIRECT_URI)}` +
    `&scope=pages_manage_posts,pages_read_engagement,pages_show_list,publish_video` +
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

    // TODO: Send welcome email with credentials

    res.json({
      success: true,
      message: `Usuario ${userRole === 'admin' ? 'administrador' : 'colaborador'} creado exitosamente`,
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
    `&scope=openid,profile,w_member_social,email` +
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

      // Save tokens
      const db = await readDB();
      if (!db.tokens[userId]) db.tokens[userId] = {};
      db.tokens[userId].facebook = {
        accessToken: accessToken,
        pages: pagesResponse.data.data || [],
        connectedAt: new Date().toISOString()
      };
      await writeDB(db);

      console.log('Saved Facebook tokens for user:', userId, 'Pages count:', db.tokens[userId].facebook.pages.length);

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

      // Save tokens
      const db = await readDB();
      if (!db.tokens[userId]) db.tokens[userId] = {};
      db.tokens[userId].linkedin = {
        accessToken: accessToken,
        profile: profileResponse.data,
        connectedAt: new Date().toISOString()
      };
      await writeDB(db);
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
  const fbToken = db.tokens[userId]?.facebook;

  if (!fbToken) throw new Error('Facebook not connected');
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
  const liToken = db.tokens[userId]?.linkedin;

  if (!liToken) throw new Error('LinkedIn not connected');

  // Use 'sub' field from OpenID Connect userinfo response
  const personURN = `urn:li:person:${liToken.profile.sub}`;

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
    author: personURN,
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
          owner: personURN,
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

  return response.data;
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

    // TODO: Send notification to approver

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

    res.json(pendingPosts);
  } catch (error) {
    console.error('Get pending approvals error:', error);
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

    // TODO: Send notification to requester

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

    const post = db.posts.find(p => p.id === postId);
    if (!post) {
      return res.status(404).json({ error: 'Post no encontrado' });
    }

    if (post.approvalStatus?.approverId !== approverId) {
      return res.status(403).json({ error: 'No tienes permiso para rechazar este post' });
    }

    // Update post status
    post.status = 'rejected';
    post.approvalStatus.approved = false;
    post.approvalStatus.approvedAt = new Date().toISOString();
    post.approvalStatus.rejectedReason = reason || 'Sin motivo especificado';
    post.updatedAt = new Date().toISOString();

    await writeDB(db);

    // TODO: Send notification to requester

    res.json({ success: true, post });
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
    const userId = req.query.userId || 'default_user';
    const db = await readDB();
    const posts = db.posts.filter(p => p.userId === userId);
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ DELETE POST ============
app.delete('/api/posts/:postId', async (req, res) => {
  try {
    const db = await readDB();
    db.posts = db.posts.filter(p => p.id !== req.params.postId);
    await writeDB(db);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ CHECK CONNECTION STATUS ============
app.get('/api/connections', async (req, res) => {
  try {
    const userId = req.query.userId || 'default_user';
    const db = await readDB();
    const tokens = db.tokens[userId] || {};

    res.json({
      facebook: !!tokens.facebook,
      linkedin: !!tokens.linkedin,
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

    if (!db.tokens[userId]) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (platform === 'facebook' && db.tokens[userId].facebook) {
      delete db.tokens[userId].facebook;
    } else if (platform === 'linkedin' && db.tokens[userId].linkedin) {
      delete db.tokens[userId].linkedin;
    }

    await writeDB(db);
    res.json({ success: true, message: `${platform} disconnected successfully` });
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
      if (post.status !== 'scheduled') continue;
      
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
    console.log(`Social Planner API running on port ${PORT}`);
    console.log(`Facebook OAuth: http://localhost:${PORT}/auth/facebook`);
    console.log(`LinkedIn OAuth: http://localhost:${PORT}/auth/linkedin`);
  });
});