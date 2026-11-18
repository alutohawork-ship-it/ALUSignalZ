// api/clients.js — dashboard admin: daftar, tambah, dan hapus klien (Postgres, tabel clients)
// Dipanggil dari index.html dengan header x-admin-code.
// Env: DATABASE_URL, ADMIN_CODE
import { db } from '../lib/db.js';
import { invalidate } from '../lib/access.js';

const DURATION_DAYS = { trial: 3, monthly: 30 };
const LIFETIME_YEARS = 10;

function isAdmin(req) {
  const code = process.env.ADMIN_CODE;
  return !!code && req.headers['x-admin-code'] === code;
}

function expiryFor(status) {
  const d = new Date();
  if (status === 'lifetime') d.setFullYear(d.getFullYear() + LIFETIME_YEARS);
  else d.setDate(d.getDate() + (DURATION_DAYS[status] || 3));
  return d.toISOString();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-code');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!isAdmin(req)) return res.status(401).json({ ok: false, msg: 'Kode admin salah.' });

  try {
    // ── DAFTAR KLIEN ──
    if (req.method === 'GET') {
      const r = await db.query(
        'select email, status, expires_at from clients order by expires_at desc'
      );
      // id = email, karena frontend memakai id untuk menghapus
      return res.status(200).json(r.rows.map(x => ({
        id: x.email, email: x.email, status: x.status, expires_at: x.expires_at,
      })));
    }

    // ── TAMBAH KLIEN ──
    if (req.method === 'POST') {
      let body = req.body || {};
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const email = String(body.email || '').trim().toLowerCase().replace(/^email:\s*/, '');
      const status = ['trial', 'monthly', 'lifetime'].includes(body.status) ? body.status : 'trial';
      if (!email || !email.includes('@')) return res.status(200).json({ ok: false, msg: 'Email tidak valid.' });

      const expires = expiryFor(status);
      const r = await db.query(
        `insert into clients (email, status, expires_at, trial_bot_used)
         values ($1, $2, $3, false)
         on conflict (email) do nothing
         returning email`,
        [email, status, expires]
      );
      if (!r.rows.length) return res.status(200).json({ ok: false, msg: 'Email sudah terdaftar.' });
      invalidate(email);
      return res.status(200).json({ ok: true, msg: 'Klien berhasil didaftarkan.' });
    }

    // ── HAPUS KLIEN ──
    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '').trim().toLowerCase();
      if (!id) return res.status(200).json({ ok: false, msg: 'ID klien kosong.' });
      await db.query('delete from clients where email = $1', [id]);
      invalidate(id);
      return res.status(200).json({ ok: true, msg: 'Klien dihapus.' });
    }

    return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  } catch (err) {
    console.error('clients error:', err);
    return res.status(500).json({ ok: false, msg: 'Server error: ' + err.message });
  }
}
