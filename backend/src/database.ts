import { Pool, PoolClient } from 'pg';
import path from 'path';

// Load .env when running in development
if (process.env.NODE_ENV !== 'production') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  } catch { /* dotenv optional */ }
}

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'site_survey',
  user:     process.env.DB_USER     || 'survey_user',
  password: process.env.DB_PASSWORD || 'survey_pass_2024',
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max:      10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
});

export { pool };
export type { PoolClient };
