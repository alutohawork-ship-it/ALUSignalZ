// api/candles.js
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
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { action = 'get', symbol, interval, candles, limit = 100 } = body;

    if (!symbol || !interval) {
      return res.status(400).json({ ok: false, error: 'Symbol dan interval wajib diisi.' });
    }

    const kvKey = `candles_${symbol.toUpperCase()}_${interval}`;

    // Jika ingin menyimpan/update array candle dari server/worker
    if (req.method === 'POST' && action === 'save' && Array.isArray(candles)) {
      await kv(['SET', kvKey, JSON.stringify(candles)]);
      return res.status(200).json({ ok: true, saved: candles.length });
    }

    // Default: Ambil data candle untuk klien
    const raw = await kv(['GET', kvKey]);
    let storedCandles = raw ? JSON.parse(raw) : [];

    return res.status(200).json({
      ok: true,
      candles: storedCandles.slice(-limit)
    });

  } catch (err) {
    console.error('candles api error:', err);
    return res.status(500).json({ ok: false, candles: [], error: err.message });
  }
}
