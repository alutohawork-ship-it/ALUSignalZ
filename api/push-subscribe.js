// api/push-subscribe.js — simpan langganan push dari browser klien
import { db } from '../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, msg: 'Method not allowed' });

  try {
    await db.query(`create table if not exists push_subs (
      endpoint text primary key, p256dh text not null, auth text not null,
      email text, created_at timestamptz not null default now())`);
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const s = body.subscription || {};
    const email = String(body.email || '').trim().toLowerCase();
    const endpoint = String(s.endpoint || '');
    const p256dh = s.keys && s.keys.p256dh;
    const auth = s.keys && s.keys.auth;
    if (!endpoint || !p256dh || !auth) return res.status(200).json({ ok: false, msg: 'Langganan tidak valid.' });
    await db.query(
      `insert into push_subs (endpoint, p256dh, auth, email) values ($1, $2, $3, $4)
       on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, email = excluded.email`,
      [endpoint, p256dh, auth, email]
    );
    return res.status(200).json({ ok: true, msg: 'Notifikasi aktif di perangkat ini.' });
  } catch (err) {
    console.error('push-subscribe error:', err);
    return res.status(500).json({ ok: false, msg: 'Server error: ' + err.message });
  }
}
