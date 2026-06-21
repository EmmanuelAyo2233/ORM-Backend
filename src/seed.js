const db = require('./db');
const bcrypt = require('bcryptjs');

async function seedAdmin() {
  console.log('[Seeding] Checking database for existing admin user...');
  try {
    // Clean up legacy admin user if exists
    await db.query('DELETE FROM users WHERE username = ?', ['admin']);

    // Check if new admin user exists
    const [rows] = await db.query('SELECT * FROM users WHERE username = ?', ['adminORM@gmail.com']);
    
    if (rows.length > 0) {
      console.log('[Seeding] Admin user adminORM@gmail.com already exists. Skipping seed.');
      process.exit(0);
    }

    const defaultUsername = 'adminORM@gmail.com';
    const defaultPassword = 'password123';
    const defaultRole = 'Admin';

    // Hash the default password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(defaultPassword, salt);

    // Insert admin user
    await db.query(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [defaultUsername, hashedPassword, defaultRole]
    );

    console.log('[Seeding] Default Admin user created successfully.');
    console.log(`[Seeding] Username: "${defaultUsername}"`);
    console.log(`[Seeding] Password: "${defaultPassword}"`);
    process.exit(0);
  } catch (error) {
    console.error('[Seeding] Error seeding admin user:', error.message);
    process.exit(1);
  }
}

seedAdmin();
