// api/stream-token.js — v2 (FXOpen). Stream XBTFX sudah dinonaktifkan; harga live lewat POST /api/candles { mode:'live' }.
// Endpoint ini dipertahankan sebagai shim: cek akses saja, TIDAK mengirim token apa pun.
// Env: DATABASE_URL, ADMIN_CODE (opsional). XBTFX_TOKEN tidak lagi diperlukan.
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
      if (access.key === 'kvError') return res.status(503).json({ msg: 'Layanan akses sedang gangguan, coba lagi sebentar.' });
      return res.status(401).json({ msg: 'Sesi tidak valid, silakan login ulang.' });
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, mode: 'fxopen-poll', live: '/api/candles', note: 'Stream XBTFX dinonaktifkan. Gunakan POST /api/candles dengan mode:"live".' });
}
