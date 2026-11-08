// api/tl-test.js — SEMENTARA, hapus setelah dipakai
const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

export default async function handler(req, res) {
  const key = String(process.env.TICKERLAYER_API_KEY || '').trim();
  if (!key) return res.status(200).json({ error: 'TICKERLAYER_API_KEY kosong di environment' });

  const symbol = String(req.query.symbol || 'BTCUSD').toUpperCase();
  const interval = String(req.query.interval || '1h');
  const asset = String(req.query.asset || 'crypto');
  const url = `${TICKERLAYER_BASE_URL}/${asset}/agg/${symbol}/prev?interval=${interval}&limit=5`;

  try {
    const r = await fetch(url, {
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    });
    const text = await r.text();
    return res.status(200).json({
      url_dipanggil: url,
      status: r.status,
      panjang_body: text.length,
      cuplikan: text.slice(0, 1500),
    });
  } catch (e) {
    return res.status(200).json({ error: String(e.message || e) });
  }
}
