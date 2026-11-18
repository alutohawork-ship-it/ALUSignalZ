// api/stream-token.js — token XBTFX untuk klien yang aksesnya valid.
// Sekarang langsung cek ke lib/access.js (tidak lagi memanggil /api/login).
// Env: XBTFX_TOKEN, DATABASE_URL, ADMIN_CODE (opsional)
import { checkAccess } from '../lib/access.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ msg: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const value = String(body.value || '').trim();
  if (!value) return res.status(401).json({ msg: 'Sesi tidak valid, silakan login ulang.' });

  const isAdmin = !!process.env.ADMIN_CODE && value === process.env.ADMIN_CODE;
  if (!isAdmin) {
    const access = await checkAccess(value.toLowerCase(), false);
    if (!access.ok) {
      // gangguan database dibalas 503, bukan 401 (agar tidak dianggap sesi invalid)
      if (access.key === 'kvError') return res.status(503).json({ msg: 'Layanan akses sedang gangguan, coba lagi sebentar.' });
      return res.status(401).json({ msg: 'Sesi tidak valid, silakan login ulang.' });
    }
  }

  const token = process.env.XBTFX_TOKEN;
  if (!token) return res.status(500).json({ msg: 'XBTFX_TOKEN belum diisi di Vercel.' });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ token });
}
