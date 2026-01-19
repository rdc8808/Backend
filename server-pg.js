// This is a helper module to wrap PostgreSQL operations
// and make migration from JSON easier

const db = require('./database-pg');

// Wrapper to simulate old readDB() but with PostgreSQL
async function readDB() {
  const [users, posts, tokens] = await Promise.all([
    db.getUsers(),
    db.getPosts(),
    db.getAllTokens()
  ]);

  return {
    users,
    posts,
    tokens
  };
}

// Wrapper to simulate old writeDB() but with PostgreSQL
// NOTE: This is a transitional helper. Eventually all code
// should call db.createUser(), db.updatePost(), etc directly
async function writeDB(data) {
  // This is intentionally a no-op because with PostgreSQL
  // we update records directly, not save entire file
  console.warn('⚠️ writeDB() called - this is deprecated with PostgreSQL');
  console.warn('   Use specific db.create/update/delete functions instead');
}

module.exports = {
  readDB,
  writeDB,
  ...db  // Export all db functions too
};
