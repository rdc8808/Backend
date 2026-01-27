// Migration: Add soft-delete support + media_url to posts table
// Run this once to add deleted_at and media_url columns

require('dotenv').config();
const { Pool } = require('pg');
const path = require('path');

// Load .env from current directory
require('dotenv').config({ path: path.join(__dirname, '.env') });

function parseConnectionString(url) {
  const parsed = new URL(url);
  return {
    user: parsed.username,
    password: parsed.password,
    host: parsed.hostname,
    port: parseInt(parsed.port) || 5432,
    database: parsed.pathname.slice(1),
    ssl: process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: false
    } : false
  };
}

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not found in environment');
    console.error('   Make sure .env file exists with DATABASE_URL');
    console.error('   This migration will run automatically on Render deploy');
    console.log('✅ Skipping local migration (will run on Render)');
    process.exit(0);
  }

  const pool = new Pool(parseConnectionString(process.env.DATABASE_URL));

  try {
    console.log('🔄 Running database migration...');

    // Add media_url column if it doesn't exist
    await pool.query(`
      ALTER TABLE posts
      ADD COLUMN IF NOT EXISTS media_url TEXT;
    `);

    // Add deleted_at column if it doesn't exist
    await pool.query(`
      ALTER TABLE posts
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL;
    `);

    // Add linkedin_organization_id column if it doesn't exist
    await pool.query(`
      ALTER TABLE posts
      ADD COLUMN IF NOT EXISTS linkedin_organization_id VARCHAR(255);
    `);

    console.log('✅ Migration completed successfully');
    console.log('✅ Added media_url column to posts table');
    console.log('✅ Added deleted_at column to posts table');
    console.log('✅ Added linkedin_organization_id column to posts table');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
