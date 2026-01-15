// Migration script to add roles to existing users
// Run this once to update existing users in database.json

const fs = require('fs').promises;
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');

async function migrateAddRoles() {
  try {
    console.log('Starting migration: Adding roles to existing users...');

    // Read database
    const data = await fs.readFile(DB_FILE, 'utf8');
    const db = JSON.parse(data);

    let updatedCount = 0;

    // Update all existing users without a role
    for (const email in db.users) {
      if (!db.users[email].role) {
        db.users[email].role = 'admin'; // Set existing users as admin
        updatedCount++;
        console.log(`✓ Updated ${email} -> role: admin`);
      } else {
        console.log(`- ${email} already has role: ${db.users[email].role}`);
      }
    }

    // Write updated database
    await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));

    console.log(`\n✅ Migration complete!`);
    console.log(`   Updated ${updatedCount} user(s)`);
    console.log(`   Total users: ${Object.keys(db.users).length}`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateAddRoles();
