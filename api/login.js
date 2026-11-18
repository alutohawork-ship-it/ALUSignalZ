// api/login.js — logika sama dengan login asli, datanya dibaca dari Postgres (tabel clients)
// Env: DATABASE_URL, ADMIN_CODE (opsional)
import { getClient } from '../lib/access.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const input = String(body.value || '').trim();
    if (!input) return res.status(200).json({ ok: false, msg: 'Input tidak boleh kosong.' });

    const adminCode = process.env.ADMIN_CODE;
    if (adminCode && input === adminCode) {
      return res.status(200).json({ ok: true, role: 'admin' });
    }

    const email = input.toLowerCase();
    const c = await getClient(email);

    if (!c) {
      return res.status(200).json({ ok: false, msg: 'Email belum terdaftar. Silakan hubungi admin untuk pendaftaran.' });
    }
    if (new Date(c.expires_at) < new Date()) {
      return res.status(200).json({ ok: false, msg: 'Masa aktif akses email ini sudah berakhir. Hubungi admin untuk perpanjangan.' });
    }
    return res.status(200).json({ ok: true, role: 'client', email });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ ok: false, msg: 'Server error: ' + err.message });
  }
}
