import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

// Test connection on startup
pool.on('error', (err) => {
  console.error('❌ Database pool error:', err.message);
});

pool.on('connect', () => {
  console.log('✅ Database connected');
});

export const db = drizzle(pool, { schema });
