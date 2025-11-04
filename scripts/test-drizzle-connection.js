const { drizzle } = require('drizzle-orm/postgres-js');
const postgres = require('postgres');
const { users } = require('../src/db/schema');

async function testDrizzleConnection() {
  try {
    console.log('🔌 Testing Drizzle ORM connection...');
    
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL not found in environment variables');
    }
    
    const client = postgres(connectionString, {
      ssl: connectionString.includes('render.com') ? 'require' : false,
      max: 1,
    });
    
    const db = drizzle(client);
    
    // Test Drizzle query
    console.log('Testing Drizzle query...');
    const result = await db.select().from(users).limit(1);
    console.log('✅ Drizzle connection successful!');
    console.log('Sample query result:', result.length, 'rows');
    
    await client.end();
    console.log('✅ Connection closed properly');
    
  } catch (error) {
    console.error('❌ Drizzle connection failed:', error.message);
    process.exit(1);
  }
}

testDrizzleConnection();
