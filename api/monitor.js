// api/monitor.js — mulai pemantauan Intraday/Swing di server (berjalan walaupun browser tertutup)
//   POST { email, style, symbol }  -> mulai memantau
//   GET  ?email=...                -> daftar pemantauan + sinyal menunggu milik email itu
// Env: DATABASE_URL
import { db } from '../lib/db.js';
import { checkAccess } from '../lib/access.js';

const WAIT_MS = { Intraday: 8 * 3600e3, Swing: 24 * 3600e3 };
const EVERY_MS = { Intraday: 5 * 60e3, Swing: 15 * 60e3 };
const SYMBOLS = ['XAUUSD', 'BTCUSD'];
const MAX_ACTIVE_PER_EMAIL = 6;

async function ensureTable() {
  await db.query(`create table if not exists monitors (
    id serial primary key,
    email text not null,
    style text not null,
    symbol text not null,
    status text not null default 'watch',
    created_at timestamptz not null default now(),
    until_at timestamptz not null,
    next_at timestamptz not null,
    pending jsonb,
    pending_until timestamptz
  )`);
}

// Cek berikutnya: kelipatan interval + 20 detik (candle sudah tutup dan terkirim)
export function nextSlot(style, fromMs) {
  const e = EVERY_MS[style];
  return Math.ceil(fromMs / e) * e + 20000;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    await ensureTable();

    if (req.method === 'GET') {
      const email = String(req.query?.email || '').trim().toLowerCase();
      if (!email) return res.status(200).json({ ok: false, msg: 'Email kosong.' });
      const r = await db.query(
        `select id, style, symbol, status, until_at, pending, pending_until
         from monitors where email = $1 and status in ('watch','pending') order by id desc limit 20`,
        [email]
      );
      return res.status(200).json({ ok: true, monitors: r.rows });
    }

    if (req.method === 'POST') {
      let body = req.body || {};
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const email = String(body.email || body.value || '').trim().toLowerCase();
      const style = String(body.style || '');
      const symbol = String(body.symbol || '').toUpperCase();

      const access = await checkAccess(email, false);
      if (!access.ok) return res.status(403).json({ ok: false, msg: 'Akses ditolak.' });
      if (!WAIT_MS[style]) return res.status(200).json({ ok: false, msg: 'Pemantauan hanya untuk Intraday dan Swing.' });
      if (!SYMBOLS.includes(symbol)) return res.status(200).json({ ok: false, msg: 'Pair tidak didukung.' });

      // Satu pemantauan aktif per email + style + symbol
      const dup = await db.query(
        `select id from monitors where email = $1 and style = $2 and symbol = $3 and status = 'watch'`,
        [email, style, symbol]
      );
      if (dup.rows.length) return res.status(200).json({ ok: true, msg: 'Sudah dipantau.', id: dup.rows[0].id });

      const cnt = await db.query(
        `select count(*)::int as n from monitors where email = $1 and status in ('watch','pending')`,
        [email]
      );
      if (cnt.rows[0].n >= MAX_ACTIVE_PER_EMAIL) {
        return res.status(200).json({ ok: false, msg: 'Batas pemantauan aktif tercapai.' });
      }

      const now = Date.now();
      const ins = await db.query(
        `insert into monitors (email, style, symbol, until_at, next_at)
         values ($1, $2, $3, $4, $5) returning id`,
        [email, style, symbol, new Date(now + WAIT_MS[style]), new Date(nextSlot(style, now))]
      );
      return res.status(200).json({ ok: true, msg: 'Pemantauan dimulai.', id: ins.rows[0].id });
    }

    return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  } catch (err) {
    console.error('monitor error:', err);
    return res.status(500).json({ ok: false, msg: 'Server error: ' + err.message });
  }
}
