const { Pool } = require('pg');

async function checkTableStructure() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false,
  });

  try {
    console.log('🔍 Checking database structure...\n');

    // Check if users table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);

    if (!tableExists.rows[0].exists) {
      console.error('❌ Table "users" does not exist!');
      console.log('💡 Run migrations: npm run db:migrate:prod');
      process.exit(1);
    }

    console.log('✅ Table "users" exists\n');

    // Get table structure
    const structure = await pool.query(`
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position;
    `);

    console.log('📋 Table structure:');
    console.table(structure.rows);

    // Check constraints
    const constraints = await pool.query(`
      SELECT 
        constraint_name,
        constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'users';
    `);

    console.log('\n🔒 Constraints:');
    console.table(constraints.rows);

    // Check indexes
    const indexes = await pool.query(`
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes
      WHERE tablename = 'users';
    `);

    console.log('\n📇 Indexes:');
    console.table(indexes.rows);

    // Test insert (will rollback)
    console.log('\n🧪 Testing insert (will rollback)...');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const testResult = await client.query(`
        INSERT INTO "users" ("username", "email", "password_hash", "role")
        VALUES ($1, $2, $3, $4)
        RETURNING "id", "username", "email", "role"
      `, ['test_user_' + Date.now(), 'test@example.com', '$2b$10$test', 'student']);
      
      console.log('✅ Insert test successful:', testResult.rows[0]);
      await client.query('ROLLBACK');
      console.log('✅ Rollback successful\n');
    } catch (insertError) {
      await client.query('ROLLBACK');
      console.error('❌ Insert test failed:', insertError.message);
      console.error('Error code:', insertError.code);
      console.error('Error constraint:', insertError.constraint);
      throw insertError;
    } finally {
      client.release();
    }

    console.log('✅ All checks passed!');
  } catch (error) {
    console.error('❌ Error checking table structure:', error.message);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkTableStructure();





