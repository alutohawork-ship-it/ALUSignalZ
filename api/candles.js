// api/candles.js
// Endpoint untuk menyimpan dan melayani history candle OHLC terpusat

async function kv(command) {
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || `KV HTTP ${r.status}`);
  return data.result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { symbol, interval, limit = 100 } = body;

    if (!symbol || !interval) {
      return res.status(400).json({ error: 'Symbol dan interval wajib diisi.' });
    }

    const kvKey = `candles_${symbol.toUpperCase()}_${interval}`;
    
    // Ambil data candle yang tersimpan di server
    const raw = await kv(['GET', kvKey]);
    let candles = raw ? JSON.parse(raw) : [];

    // Jika server belum punya data, kembalikan array kosong agar frontend memicu fallback
    return res.status(200).json({
      ok: true,
      candles: candles.slice(-limit)
    });

  } catch (err) {
    console.error('candles api error:', err);
    return res.status(200).json({ ok: false, candles: [], error: err.message });
  }
}
