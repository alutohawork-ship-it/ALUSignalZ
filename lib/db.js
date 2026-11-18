// lib/db.js — koneksi Postgres (Neon / Supabase)
// Env yang dibutuhkan: DATABASE_URL
import pg from 'pg';

let pool = null;

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi di Vercel');
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 2,
    });
  }
  return pool;
}

export const db = {
  query: (text, params) => getPool().query(text, params),
  close: () => (pool ? pool.end() : Promise.resolve()),
};
