// migrate.mjs — pindahkan backup alu_clients (JSON) ke tabel `clients` di Postgres.
// Pemakaian:  DATABASE_URL="postgresql://..." node migrate.mjs alu_clients_backup.json
// Aman dijalankan ulang (upsert berdasarkan email).
import fs from 'fs';
import pg from 'pg';

const file = process.argv[2];
if (!file || !process.env.DATABASE_URL) {
  console.error('Pakai: DATABASE_URL="..." node migrate.mjs <file-backup.json>');
  process.exit(1);
}

const clients = JSON.parse(fs.readFileSync(file, 'utf8'));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

await pool.query(`
  create table if not exists clients (
    email text primary key,
    status text,
    expires_at timestamptz,
    trial_bot_used boolean not null default false,
    data jsonb
  )
`);

let moved = 0, skipped = 0;
for (const c of clients) {
  // bersihkan email yang rusak, mis. "email: kbanjo37@gmail.com"
  const email = String(c.email || '').trim().toLowerCase().replace(/^email:\s*/, '');
  if (!email) { skipped++; continue; }
  await pool.query(
    `insert into clients (email, status, expires_at, trial_bot_used, data)
     values ($1, $2, $3, $4, $5)
     on conflict (email) do update set
       status = excluded.status,
       expires_at = excluded.expires_at,
       trial_bot_used = excluded.trial_bot_used,
       data = excluded.data`,
    [email, c.status || null, c.expires_at || null, !!c.trialBotUsed, JSON.stringify(c)]
  );
  moved++;
}

const { rows } = await pool.query('select count(*)::int as n from clients');
console.log(`Selesai. Dipindah: ${moved}, dilewati: ${skipped}. Total di database: ${rows[0].n}`);
await pool.end();
