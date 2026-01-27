// Start script: Run migration then start server
const { spawn } = require('child_process');

console.log('🔄 Running database migrations...');

// Run migration
const migrate = spawn('node', ['migrate-soft-delete.js'], {
  stdio: 'inherit',
  env: process.env
});

migrate.on('close', (code) => {
  if (code !== 0) {
    console.error('❌ Migration failed with code:', code);
    process.exit(1);
  }

  console.log('🚀 Starting server...');

  // Start server
  const server = spawn('node', ['server.js'], {
    stdio: 'inherit',
    env: process.env
  });

  server.on('close', (code) => {
    process.exit(code);
  });
});
