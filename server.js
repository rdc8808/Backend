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
    `&scope=pages_manage_posts,pages_read_engagement,pages_show_list` +
    `&state=facebook_${userId}`;
  
  res.redirect(authUrl);
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

      // Save tokens
      const db = await readDB();
      if (!db.tokens[userId]) db.tokens[userId] = {};
      db.tokens[userId].facebook = {
        accessToken: accessToken,
        pages: pagesResponse.data.data,
        connectedAt: new Date().toISOString()
      };
      await writeDB(db);

    } else if (platform === 'linkedin') {
      // Exchange code for access token
      const tokenResponse = await axios.post(`https://www.linkedin.com/oauth/v2/accessToken`, null, {
        params: {
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: CONFIG.REDIRECT_URI,
          client_id: CONFIG.LINKEDIN_CLIENT_ID,
          client_secret: CONFIG.LINKEDIN_CLIENT_SECRET
        }
      });

      const accessToken = tokenResponse.data.access_token;

      // Get user profile
      const profileResponse = await axios.get(`https://api.linkedin.com/v2/me`, {
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
    const tempFile = path.join('uploads', `temp_${Date.now()}.jpg`);
    await fs.writeFile(tempFile, mediaBuffer);

    const form = new FormData();
    form.append('source', await fs.readFile(tempFile));
    form.append('access_token', pageToken);
    form.append('message', postData.caption);

    const uploadResponse = await axios.post(
      `https://graph.facebook.com/v18.0/${pageId}/photos`,
      form,
      { headers: form.getHeaders() }
    );

    await fs.unlink(tempFile);
    return uploadResponse.data;
  }

  // Text-only post
  const response = await axios.post(
    `https://graph.facebook.com/v18.0/${pageId}/feed`,
    postParams
  );

  return response.data;
}

// ============ POST TO LINKEDIN ============
async function postToLinkedIn(userId, postData) {
  const db = await readDB();
  const liToken = db.tokens[userId]?.linkedin;
  
  if (!liToken) throw new Error('LinkedIn not connected');

  const personURN = `urn:li:person:${liToken.profile.id}`;

  const postBody = {
    author: personURN,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: postData.caption
        },
        shareMediaCategory: postData.media ? 'IMAGE' : 'NONE'
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
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
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
      }
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