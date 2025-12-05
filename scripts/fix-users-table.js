/**
 * Script to fix users table - add missing Stripe columns
 * Run with: node scripts/fix-users-table.js
 */

const { Pool } = require('pg');

async function fixUsersTable() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not found');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log('🔄 Adding missing columns to users table...');

    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_account_id VARCHAR(255);
    `);
    console.log('✅ Added stripe_account_id column');

    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_onboarding_complete INTEGER DEFAULT 0;
    `);
    console.log('✅ Added stripe_onboarding_complete column');

    // Verify
    const result = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users' 
      ORDER BY ordinal_position;
    `);
    
    console.log('\n📋 Users table columns:');
    result.rows.forEach(row => console.log('  -', row.column_name));

    console.log('\n✅ Done! Users table is fixed.');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

fixUsersTable();

