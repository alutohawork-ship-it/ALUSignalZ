// api/push-send.js — kirim notifikasi push manual (admin): POST { title, body, url }
import { sendPush } from '../lib/push.js';

function isAdmin(req) {
  const code = process.env.ADMIN_CODE;
  return !!code && req.headers['x-admin-code'] === code;
}

export default async function handler(req, res) {
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
