const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const connectionConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'results_management',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// Configure SSL if DB_SSL_CA is specified and exists
if (process.env.DB_SSL_CA) {
  const caPath = path.resolve(process.env.DB_SSL_CA);
  if (fs.existsSync(caPath)) {
    connectionConfig.ssl = {
      ca: fs.readFileSync(caPath),
      minVersion: 'TLSv1.2',
    };
    console.log(`[Database] SSL enabled using CA: ${caPath}`);
  } else {
    console.warn(`[Database] SSL certificate specified at ${caPath} but file was not found. Connecting without SSL.`);
  }
} else {
  console.log('[Database] Connecting without SSL (local MySQL mode).');
}

const pool = mysql.createPool(connectionConfig);

// Test database connection and ensure schema updates
(async () => {
  try {
    const connection = await pool.getConnection();
    console.log('[Database] Connection pool initialized successfully.');
    
    // Ensure avatar column exists in users table
    try {
      await connection.query('ALTER TABLE users ADD COLUMN avatar LONGTEXT NULL');
      console.log('[Database] Successfully verified/added avatar column to users table.');
    } catch (err) {
      // Ignore error if column already exists
    }
    
    connection.release();
  } catch (error) {
    console.error('[Database] Error connecting to the database:', error.message);
    console.error('[Database] Please verify your database server is running and .env settings are correct.');
  }
})();

module.exports = pool;
