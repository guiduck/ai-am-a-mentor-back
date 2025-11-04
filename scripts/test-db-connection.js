const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');

async function testConnection() {
  try {
    console.log('🔌 Testing PostgreSQL connection...');
    
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL not found in environment variables');
    }
    
    console.log('Connection string:', connectionString.replace(/:[^:@]*@/, ':***@'));
    
    const client = postgres(connectionString, {
      ssl: connectionString.includes('render.com') ? 'require' : false,
      max: 1,
    });
    
    const db = drizzle(client);
    
    // Test basic query
    const result = await client`SELECT version()`;
    console.log('✅ Connection successful!');
    console.log('PostgreSQL version:', result[0].version);
    
    await client.end();
    console.log('✅ Connection closed properly');
    
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  }
}

testConnection();
