const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');

async function checkSchema() {
  try {
    console.log('🔍 Checking database schema...');
    
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL not found in environment variables');
    }
    
    const client = postgres(connectionString, {
      ssl: connectionString.includes('render.com') ? 'require' : false,
      max: 1,
    });
    
    // Check if tables exist
    const tables = await client`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
    
    console.log('📋 Tables in database:');
    tables.forEach(table => {
      console.log(`  - ${table.table_name}`);
    });
    
    // Check users table structure if it exists
    const userTable = tables.find(t => t.table_name === 'users');
    if (userTable) {
      console.log('\n👤 Users table columns:');
      const columns = await client`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'users' AND table_schema = 'public'
        ORDER BY ordinal_position;
      `;
      
      columns.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : '(NULLABLE)'}`);
      });
    }
    
    await client.end();
    console.log('✅ Schema check complete');
    
  } catch (error) {
    console.error('❌ Schema check failed:', error.message);
    process.exit(1);
  }
}

checkSchema();
