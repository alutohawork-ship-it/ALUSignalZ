import { db } from '../lib/db.js';
import { sendPush } from '../lib/push.js';

// ── push-key ──
// api/push-key.js — kirim public key VAPID ke browser (public key memang tidak rahasia)
function pushKey(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const key = process.env.VAPID_PUBLIC_KEY || '';
  if (!key) return res.status(500).json({ ok: false, msg: 'VAPID_PUBLIC_KEY belum diisi di Vercel.' });
  return res.status(200).json({ ok: true, key });
}

// ── push-subscribe ──
// api/push-subscribe.js — simpan langganan push dari browser klien

async function pushSubscribe(req, res) {
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

// ── push-send ──
// api/push-send.js — kirim notifikasi push manual (admin): POST { title, body, url }

function isAdmin(req) {
  const code = process.env.ADMIN_CODE;
  return !!code && req.headers['x-admin-code'] === code;
}

async function pushSend(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-code');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!isAdmin(req)) return res.status(401).json({ ok: false, msg: 'Kode admin salah.' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  try {
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const out = await sendPush({
      title: String(body.title || 'Alu Signal Z').slice(0, 120),
      body: String(body.body || '').slice(0, 300),
      url: String(body.url || '/'),
    });
    return res.status(200).json({ ok: true, ...out });
  } catch (err) {
    console.error('push-send error:', err);
    return res.status(500).json({ ok: false, msg: 'Server error: ' + err.message });
  }
}

// Router: /api/push?a=key | subscribe | send  (URL lama tetap jalan lewat vercel.json rewrites)
export default async function handler(req, res) {
  const a = String(req.query?.a || '');
  if (a === 'key') return pushKey(req, res);
  if (a === 'subscribe') return pushSubscribe(req, res);
  if (a === 'send') return pushSend(req, res);
  return res.status(404).json({ ok: false, msg: 'Unknown action' });
}
