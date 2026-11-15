// api/candles.js
// Versi: Cache Redis untuk mencegah Rate Limit 429 saat user banyak

const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';
const API_KEY = process.env.TICKERLAYER_API_KEY;

// Fungsi Helper Vercel KV
async function kv(command) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  try {
    const r = await fetch(process.env.KV_REST_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    const data = await r.json();
    return data.result;
  } catch (e) { return null; }
}

async function kvGetJSON(key) {
  try {
    const raw = await kv(['GET', key]);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function kvSetJSON(key, value, ttlSec) {
  try { await kv(['SET', key, JSON.stringify(value), 'EX', ttlSec]); } catch (e) {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body || {};
  const { symbol, interval, limit } = body;
  
  if (!symbol || !interval) return res.status(400).json({ error: 'Symbol & interval required' });

  // Tentukan TTL (Time-To-Live) cache berdasarkan timeframe
  // 1m = 30 detik, 5m = 60 detik, 15m = 180 detik, dst.
  const TTL_MAP = { '1m': 30, '5m': 60, '15m': 180, '30m': 300, '1h': 600, '4h': 1200, '1d': 3600 };
  const ttl = TTL_MAP[interval] || 60;
  
  const cacheKey = `candles_v1_${symbol}_${interval}`;

  // 1. Cek apakah data ada di Cache (KV)
  const cachedData = await kvGetJSON(cacheKey);
  if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
    // console.log(`[CACHE HIT] ${cacheKey}`);
    return res.status(200).json({ ok: true, candles: cachedData, source: 'cache' });
  }

  // 2. Jika tidak ada di cache, ambil ke TickerLayer
  // console.log(`[CACHE MISS] ${cacheKey} -> Hit TickerLayer API`);
  
  try {
    const asset = symbol === 'BTCUSD' ? 'crypto' : 'forex';
    const sym = symbol === 'BTCUSD' ? 'BTCUSDT' : symbol;
    
    // Format URL TickerLayer (Sesuaikan dengan dokumentasi terbaru TickerLayer)
    // Asumsi menggunakan endpoint standard: /{asset}/agg/{symbol}/{mult}/{span}
    const mult = parseInt(interval);
    const span = interval.includes('h') ? 'hour' : interval.includes('d') ? 'day' : 'minute';
    
    const now = new Date();
    const start = new Date(now.getTime() - (limit * mult * (span === 'hour' ? 60 : span === 'day' ? 1440 : 1) * 60000));
    
    const fmtDate = d => d.toISOString().slice(0, 10);
    const url = `${TICKERLAYER_BASE_URL}/${asset}/agg/${sym}/${mult}/${span}/${fmtDate(start)}/${fmtDate(now)}?sort=asc&limit=${limit}`;

    const response = await fetch(url, {
      headers: { 'x-api-key': API_KEY }
    });

    if (!response.ok) {
      // Jika TickerLayer error (misal 429), dan kita punya cache lama, gunakan cache lama sebagai fallback
      if (cachedData) return res.status(200).json({ ok: true, candles: cachedData, source: 'cache-fallback' });
      return res.status(response.status).json({ error: `TickerLayer HTTP ${response.status}` });
    }

    const rawData = await response.json();
    const rows = (Array.isArray(rawData) ? rawData : rawData.results || []).map(bar => ({
      t: Number(bar.t ?? bar.timestamp ?? bar.time),
      o: Number(bar.o ?? bar.open),
      h: Number(bar.h ?? bar.high),
      l: Number(bar.l ?? bar.low),
      c: Number(bar.c ?? bar.close)
    })).filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite));

    if (rows.length > 0) {
      // 3. Simpan hasil ke Cache KV agar user lain bisa pakai
      await kvSetJSON(cacheKey, rows, ttl);
      return res.status(200).json({ ok: true, candles: rows, source: 'tickerlayer' });
    }

    return res.status(200).json({ ok: true, candles: [], source: 'empty' });

  } catch (err) {
    if (cachedData) return res.status(200).json({ ok: true, candles: cachedData, source: 'cache-fallback-err' });
    return res.status(500).json({ error: err.message });
  }
}
