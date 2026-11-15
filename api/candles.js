// api/candles.js
// Versi: Cache Redis + mapping simbol TickerLayer yang benar

const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';
const API_KEY = process.env.TICKERLAYER_API_KEY;

// Mapping simbol app -> asset class dan simbol di TickerLayer
// XAUUSD termasuk commodities (bukan forex). Crypto pakai BTCUSD (bukan BTCUSDT)
const SYMBOL_MAP = {
  XAUUSD:  { asset: 'commodities', sym: 'XAUUSD' },
  GOLD:    { asset: 'commodities', sym: 'XAUUSD' },
  BTCUSD:  { asset: 'crypto', sym: 'BTCUSD' },
  BTCUSDT: { asset: 'crypto', sym: 'BTCUSD' },
  BTC:     { asset: 'crypto', sym: 'BTCUSD' },
};

const UNIT = {
  m: { span: 'minute', ms: 60 * 1000 },
  h: { span: 'hour', ms: 60 * 60 * 1000 },
  d: { span: 'day', ms: 24 * 60 * 60 * 1000 },
};

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

const fmtDate = d => d.toISOString().slice(0, 10);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { symbol, interval, limit } = req.body || {};
  if (!symbol || !interval) return res.status(400).json({ error: 'Symbol & interval required' });

  // Normalisasi simbol: buang prefix (OANDA:XAUUSD), slash (XAU/USD), dan huruf kecil
  const key = String(symbol).toUpperCase().replace(/^[A-Z]+:/, '').replace(/[^A-Z0-9]/g, '');
  const target = SYMBOL_MAP[key];
  if (!target) return res.status(400).json({ error: `Simbol tidak dikenal: ${symbol}` });

  const mult = parseInt(interval, 10);
  const unit = UNIT[interval.slice(-1)];
  if (!mult || !unit) return res.status(400).json({ error: `Interval tidak valid: ${interval}` });

  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 10), 1000);

  // TTL cache berdasarkan timeframe
  const TTL_MAP = { '1m': 30, '5m': 60, '15m': 180, '30m': 300, '1h': 600, '4h': 1200, '1d': 3600 };
  const ttl = TTL_MAP[interval] || 60;

  // Key versi v2 supaya cache hasil endpoint lama tidak terpakai lagi
  const cacheKey = `candles_v2_${target.asset}_${target.sym}_${interval}_${lim}`;

  // 1. Cek cache
  const cachedData = await kvGetJSON(cacheKey);
  if (Array.isArray(cachedData) && cachedData.length > 0) {
    return res.status(200).json({ ok: true, candles: cachedData, source: 'cache' });
  }

  // 2. Ambil dari TickerLayer
  try {
    const now = new Date();
    const start = new Date(now.getTime() - lim * mult * unit.ms);

    // sort=desc supaya yang diambil adalah bar TERBARU, lalu diurutkan naik di bawah
    const url = `${TICKERLAYER_BASE_URL}/${target.asset}/agg/${target.sym}/${mult}/${unit.span}/${fmtDate(start)}/${fmtDate(now)}?sort=desc&limit=${lim}`;

    const response = await fetch(url, {
      headers: { 'x-api-key': API_KEY }
    });

    if (!response.ok) {
      if (cachedData) return res.status(200).json({ ok: true, candles: cachedData, source: 'cache-fallback' });
      const detail = await response.text().catch(() => '');
      return res.status(response.status).json({
        error: `TickerLayer HTTP ${response.status}`,
        detail: detail.slice(0, 300),
      });
    }

    const rawData = await response.json();
    const rows = (Array.isArray(rawData) ? rawData : rawData.results || []).map(bar => ({
      t: Number(bar.t ?? bar.timestamp ?? bar.time),
      o: Number(bar.o ?? bar.open),
      h: Number(bar.h ?? bar.high),
      l: Number(bar.l ?? bar.low),
      c: Number(bar.c ?? bar.close)
    }))
      .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite))
      .sort((a, b) => a.t - b.t);

    if (rows.length > 0) {
      await kvSetJSON(cacheKey, rows, ttl);
      return res.status(200).json({ ok: true, candles: rows, source: 'tickerlayer' });
    }

    return res.status(200).json({ ok: true, candles: [], source: 'empty' });

  } catch (err) {
    if (cachedData) return res.status(200).json({ ok: true, candles: cachedData, source: 'cache-fallback-err' });
    return res.status(500).json({ error: err.message });
  }
}
