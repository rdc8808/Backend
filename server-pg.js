// Hybrid Database Layer - Works with BOTH PostgreSQL and JSON
// This allows gradual migration from JSON to PostgreSQL

const fs = require('fs').promises;
const path = require('path');

// Try to use PostgreSQL if DATABASE_URL is set
let usePostgres = false;
let pgDb = null;

if (process.env.DATABASE_URL) {
  try {
    pgDb = require('./database-pg');
    usePostgres = true;
    console.log('🔵 PostgreSQL mode enabled (Supabase)');
  } catch (err) {
    console.warn('⚠️ PostgreSQL not available, falling back to JSON:', err.message);
  }
}

// JSON database fallback
const DB_FILE = process.env.NODE_ENV === 'production'
  ? '/opt/render/project/data/database.json'
  : path.join(__dirname, 'database.json');

// Initialize database
async function initDB() {
  if (usePostgres && pgDb) {
    return pgDb.initDB();
  } else {
    // JSON fallback
    try {
      const dbDir = path.dirname(DB_FILE);
      await fs.mkdir(dbDir, { recursive: true });
      await fs.access(DB_FILE);
      console.log(`✓ JSON database file found at: ${DB_FILE}`);
    } catch {
      await fs.writeFile(DB_FILE, JSON.stringify({
        users: {},
        posts: [],
        tokens: {}
      }));
      console.log(`✓ New JSON database file created at: ${DB_FILE}`);
    }
  }
}

// Read entire database
async function readDB() {
  if (usePostgres && pgDb) {
    const [users, posts, tokens] = await Promise.all([
      pgDb.getUsers(),
      pgDb.getPosts(),
      pgDb.getAllTokens()
    ]);
    return { users, posts, tokens };
  } else {
    const data = await fs.readFile(DB_FILE, 'utf8');
    return JSON.parse(data);
  }
}

// Write entire database (JSON only, deprecated for PostgreSQL)
async function writeDB(data) {
  if (usePostgres && pgDb) {
    // For PostgreSQL, we need to sync individual records
    // This is a transitional helper
    console.log('💾 Syncing to PostgreSQL...');

    // Sync users
    for (const email in data.users) {
      const user = data.users[email];
      try {
        const existing = await pgDb.getUser(email);
        if (!existing) {
          await pgDb.createUser(email, user.fullName, user.password, user.role);
        } else {
          if (user.password !== existing.password) {
            await pgDb.updateUserPassword(email, user.password);
          }
          if (user.role !== existing.role) {
            await pgDb.updateUserRole(email, user.role);
          }
        }
      } catch (err) {
        console.error(`Error syncing user ${email}:`, err.message);
      }
    }

    // Sync posts
    for (const post of data.posts) {
      try {
        const existing = await pgDb.getPost(post.id);
        if (!existing) {
          await pgDb.createPost(post);
        } else {
          await pgDb.updatePost(post.id, post);
        }
      } catch (err) {
        console.error(`Error syncing post ${post.id}:`, err.message);
      }
    }

    // Sync tokens
    for (const userId in data.tokens) {
      const userTokens = data.tokens[userId];
      try {
        if (userTokens.facebook) {
          await pgDb.saveTokens(userId, 'facebook', userTokens.facebook);
        }
        if (userTokens.linkedin) {
          await pgDb.saveTokens(userId, 'linkedin', userTokens.linkedin);
        }
      } catch (err) {
        console.error(`Error syncing tokens for ${userId}:`, err.message);
      }
    }
  } else {
    // JSON fallback
    await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
  }
}

module.exports = {
  initDB,
  readDB,
  writeDB,
  usePostgres,
  // Export PostgreSQL functions if available
  pgDb
};
