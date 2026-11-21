// api/bot-signals.js — daftar sinyal bot untuk browser (dipakai untuk rekap & tampilan)
//   GET ?email=...  -> sinyal bot yang boleh dilihat email itu
// Aturan: trial hanya mendapat 2 sinyal bot (dicatat di bot_deliveries); monthly/lifetime semua.
import { db } from '../lib/db.js';
import { checkAccess } from '../lib/access.js';

const TRIAL_LIMIT = 2;

async function ensureTables() {
  await db.query(`create table if not exists bot_deliveries (
    email text not null, signal_id int not null, primary key (email, signal_id))`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, msg: 'Method not allowed' });

  const email = String(req.query?.email || '').trim().toLowerCase();
  const access = await checkAccess(email, false);
  if (!access.ok) return res.status(403).json({ ok: false, msg: 'Akses ditolak.' });

  try {
    await ensureTables();
    if (access.status === 'trial') {
      const have = await db.query(`select count(*)::int as n from bot_deliveries where email = $1`, [email]);
      const left = TRIAL_LIMIT - have.rows[0].n;
      if (left > 0) {
        // Catat sinyal terbaru yang belum pernah dikirim ke email ini, sampai batas trial
        await db.query(
          `insert into bot_deliveries (email, signal_id)
           select $1, id from bot_signals
           where id not in (select signal_id from bot_deliveries where email = $1)
           order by id asc limit $2
           on conflict do nothing`,
          [email, left]
        );
      }
      const r = await db.query(
        `select s.* from bot_signals s
         join bot_deliveries d on d.signal_id = s.id and d.email = $1
         order by s.id asc`, [email]);
      return res.status(200).json({ ok: true, signals: r.rows, trial: true });
    }
    const r = await db.query(`select * from bot_signals order by id desc limit 50`);
    return res.status(200).json({ ok: true, signals: r.rows.reverse(), trial: false });
  } catch (err) {
    console.error('bot-signals error:', err);
    return res.status(500).json({ ok: false, msg: 'Server error: ' + err.message });
  }
}
