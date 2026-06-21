const fs = require('fs');
const path = require('path');
const db = require('./db');

async function runMigration() {
  console.log('[Migration] Starting database schema migration...');
  const schemaPath = path.resolve(__dirname, '../../database/schema.sql');
  
  if (!fs.existsSync(schemaPath)) {
    console.error(`[Migration] Error: Schema file not found at ${schemaPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');
  
  // Strip SQL comments line-by-line
  const cleanSql = sql
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('--') || trimmed.startsWith('#')) {
        return '';
      }
      return line;
    })
    .join('\n');
  
  // Split statements by semicolon
  const statements = cleanSql
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0);

  const connection = await db.getConnection();
  try {
    for (let statement of statements) {
      // Remove inline comments
      statement = statement
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .trim();

      if (!statement) continue;

      console.log(`[Migration] Executing statement:\n${statement.substring(0, 80)}...`);
      try {
        await connection.query(statement);
        console.log('[Migration] Statement completed successfully.');
      } catch (err) {
        if (statement.toLowerCase().includes('set global')) {
          console.warn(`[Migration] Warning: Could not set global variable: "${err.message}". Skipping...`);
        } else {
          throw err;
        }
      }
    }
    console.log('[Migration] Database schema migration completed successfully.');
  } catch (error) {
    console.error('[Migration] Migration failed with error:', error.message);
    process.exit(1);
  } finally {
    connection.release();
    process.exit(0);
  }
}

runMigration();
