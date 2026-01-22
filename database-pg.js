// PostgreSQL Database Handler - PERSISTENT STORAGE
const { Pool } = require('pg');

// Parse the DATABASE_URL to extract components and force IPv4
function parseConnectionString(url) {
  const parsed = new URL(url);
  return {
    user: parsed.username,
    password: parsed.password,
    host: parsed.hostname, // This is the key - use hostname not the full URL
    port: parseInt(parsed.port) || 5432,
    database: parsed.pathname.slice(1), // Remove leading slash
    ssl: process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: false
    } : false,
    // Connection stability
    keepAlive: true,
    connectionTimeoutMillis: 10000,
    max: 2, // CRITICAL: Render Free = 512MB RAM, limit connections to save memory
    idleTimeoutMillis: 30000
  };
}

// Create PostgreSQL connection pool
const pool = new Pool(
  process.env.DATABASE_URL
    ? parseConnectionString(process.env.DATABASE_URL)
    : {}
);

// Initialize database tables
async function initDB() {
  const client = await pool.connect();
  try {
    console.log('🔄 Initializing PostgreSQL database...');

    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        email VARCHAR(255) PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create posts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        caption TEXT,
        media TEXT,
        platforms_facebook BOOLEAN DEFAULT false,
        platforms_linkedin BOOLEAN DEFAULT false,
        schedule_date VARCHAR(50),
        schedule_time VARCHAR(50),
        status VARCHAR(50) DEFAULT 'draft',
        approval_status JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        published_at TIMESTAMP,
        results JSONB
      )
    `);

    // Create tokens table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tokens (
        user_id VARCHAR(255) PRIMARY KEY,
        facebook_data JSONB,
        linkedin_data JSONB,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ PostgreSQL database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// User operations
async function getUsers() {
  const result = await pool.query('SELECT * FROM users');
  const users = {};
  result.rows.forEach(row => {
    users[row.email] = {
      email: row.email,
      fullName: row.full_name,
      password: row.password,
      role: row.role,
      createdAt: row.created_at
    };
  });
  return users;
}

async function getUser(email) {
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    email: row.email,
    fullName: row.full_name,
    password: row.password,
    role: row.role,
    createdAt: row.created_at
  };
}

async function createUser(email, fullName, password, role = 'admin') {
  await pool.query(
    'INSERT INTO users (email, full_name, password, role) VALUES ($1, $2, $3, $4)',
    [email, fullName, password, role]
  );
}

async function updateUserPassword(email, newPassword) {
  await pool.query(
    'UPDATE users SET password = $1 WHERE email = $2',
    [newPassword, email]
  );
}

async function updateUserRole(email, role) {
  await pool.query(
    'UPDATE users SET role = $1 WHERE email = $2',
    [role, email]
  );
}

async function deleteUser(email) {
  await pool.query('DELETE FROM users WHERE email = $1', [email]);
}

// Post operations
async function getPosts(userId = null) {
  let query = 'SELECT * FROM posts';
  let params = [];

  if (userId) {
    query += ' WHERE user_id = $1';
    params = [userId];
  }

  query += ' ORDER BY created_at DESC';

  const result = await pool.query(query, params);
  return result.rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    caption: row.caption,
    media: row.media,
    platforms: {
      facebook: row.platforms_facebook,
      linkedin: row.platforms_linkedin
    },
    scheduleDate: row.schedule_date,
    scheduleTime: row.schedule_time,
    status: row.status,
    approvalStatus: row.approval_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    results: row.results
  }));
}

async function getPost(id) {
  const result = await pool.query('SELECT * FROM posts WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    caption: row.caption,
    media: row.media,
    platforms: {
      facebook: row.platforms_facebook,
      linkedin: row.platforms_linkedin
    },
    scheduleDate: row.schedule_date,
    scheduleTime: row.schedule_time,
    status: row.status,
    approvalStatus: row.approval_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    results: row.results
  };
}

async function createPost(post) {
  await pool.query(
    `INSERT INTO posts (
      id, user_id, caption, media,
      platforms_facebook, platforms_linkedin,
      schedule_date, schedule_time, status, approval_status,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      post.id,
      post.userId,
      post.caption,
      post.media,
      post.platforms?.facebook || false,
      post.platforms?.linkedin || false,
      post.scheduleDate,
      post.scheduleTime,
      post.status,
      JSON.stringify(post.approvalStatus || null),
      post.createdAt || new Date().toISOString(),
      post.updatedAt || new Date().toISOString()
    ]
  );
}

async function updatePost(id, updates) {
  const setClauses = [];
  const values = [];
  let paramCount = 1;

  if (updates.caption !== undefined) {
    setClauses.push(`caption = $${paramCount++}`);
    values.push(updates.caption);
  }
  if (updates.media !== undefined) {
    setClauses.push(`media = $${paramCount++}`);
    values.push(updates.media);
  }
  if (updates.platforms) {
    if (updates.platforms.facebook !== undefined) {
      setClauses.push(`platforms_facebook = $${paramCount++}`);
      values.push(updates.platforms.facebook);
    }
    if (updates.platforms.linkedin !== undefined) {
      setClauses.push(`platforms_linkedin = $${paramCount++}`);
      values.push(updates.platforms.linkedin);
    }
  }
  if (updates.scheduleDate !== undefined) {
    setClauses.push(`schedule_date = $${paramCount++}`);
    values.push(updates.scheduleDate);
  }
  if (updates.scheduleTime !== undefined) {
    setClauses.push(`schedule_time = $${paramCount++}`);
    values.push(updates.scheduleTime);
  }
  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramCount++}`);
    values.push(updates.status);
  }
  if (updates.approvalStatus !== undefined) {
    setClauses.push(`approval_status = $${paramCount++}`);
    values.push(JSON.stringify(updates.approvalStatus));
  }
  if (updates.publishedAt !== undefined) {
    setClauses.push(`published_at = $${paramCount++}`);
    values.push(updates.publishedAt);
  }
  if (updates.results !== undefined) {
    setClauses.push(`results = $${paramCount++}`);
    values.push(JSON.stringify(updates.results));
  }

  setClauses.push(`updated_at = $${paramCount++}`);
  values.push(new Date().toISOString());

  values.push(id);

  await pool.query(
    `UPDATE posts SET ${setClauses.join(', ')} WHERE id = $${paramCount}`,
    values
  );
}

async function deletePost(id) {
  await pool.query('DELETE FROM posts WHERE id = $1', [id]);
}

// Token operations
async function getTokens(userId) {
  const result = await pool.query('SELECT * FROM tokens WHERE user_id = $1', [userId]);
  if (result.rows.length === 0) return {};

  const row = result.rows[0];
  const tokens = {};
  if (row.facebook_data) tokens.facebook = row.facebook_data;
  if (row.linkedin_data) tokens.linkedin = row.linkedin_data;
  return tokens;
}

async function getAllTokens() {
  const result = await pool.query('SELECT * FROM tokens');
  const tokens = {};
  result.rows.forEach(row => {
    tokens[row.user_id] = {};
    if (row.facebook_data) tokens[row.user_id].facebook = row.facebook_data;
    if (row.linkedin_data) tokens[row.user_id].linkedin = row.linkedin_data;
  });
  return tokens;
}

async function saveTokens(userId, platform, tokenData) {
  const existing = await pool.query('SELECT * FROM tokens WHERE user_id = $1', [userId]);

  if (existing.rows.length === 0) {
    // Insert new
    if (platform === 'facebook') {
      await pool.query(
        'INSERT INTO tokens (user_id, facebook_data) VALUES ($1, $2)',
        [userId, JSON.stringify(tokenData)]
      );
    } else if (platform === 'linkedin') {
      await pool.query(
        'INSERT INTO tokens (user_id, linkedin_data) VALUES ($1, $2)',
        [userId, JSON.stringify(tokenData)]
      );
    }
  } else {
    // Update existing
    if (platform === 'facebook') {
      await pool.query(
        'UPDATE tokens SET facebook_data = $1, updated_at = $2 WHERE user_id = $3',
        [JSON.stringify(tokenData), new Date().toISOString(), userId]
      );
    } else if (platform === 'linkedin') {
      await pool.query(
        'UPDATE tokens SET linkedin_data = $1, updated_at = $2 WHERE user_id = $3',
        [JSON.stringify(tokenData), new Date().toISOString(), userId]
      );
    }
  }
}

async function deleteTokens(userId, platform = null) {
  if (platform) {
    const column = platform === 'facebook' ? 'facebook_data' : 'linkedin_data';
    await pool.query(
      `UPDATE tokens SET ${column} = NULL WHERE user_id = $1`,
      [userId]
    );
  } else {
    await pool.query('DELETE FROM tokens WHERE user_id = $1', [userId]);
  }
}

module.exports = {
  initDB,
  getUsers,
  getUser,
  createUser,
  updateUserPassword,
  updateUserRole,
  deleteUser,
  getPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  getTokens,
  getAllTokens,
  saveTokens,
  deleteTokens,
  pool
};
