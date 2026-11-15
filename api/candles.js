// api/candles.js
// TickerLayer + cache KV.
// XAUUSD = commodities, BTC = crypto (BTCUSD).
// 30m dibentuk dari bar 5m karena TickerLayer tidak punya bar 30 menit.

const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';
const API_KEY = process.env.TICKERLAYER_API_KEY;

// Mapping simbol app -> asset class dan simbol TickerLayer
const SYMBOL_MAP = {
  XAUUSD:  { asset: 'commodities', sym: 'XAUUSD' },
  GOLD:    { asset: 'commodities', sym: 'XAUUSD' },
  BTCUSD:  { asset: 'crypto', sym: 'BTCUSD' },
  BTCUSDT: { asset: 'crypto', sym: 'BTCUSD' },
  BTC:     { asset: 'crypto', sym: 'BTCUSD' },
};

// TTL cache (detik) per interval
const TTL_MAP = { '1m': 30, '5m': 60, '15m': 180, '30m': 300, '1h': 600, '4h': 1200, '1d': 3600 };

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

// Rencana pengambilan bar untuk tiap interval yang dipakai app
function planFor(interval) {
  if (interval === '30m') return { mult: 5, span: 'minute', barMs: 5 * 60000, factor: 6 };
  const mult = parseInt(interval, 10);
  const unit = UNIT[interval.slice(-1)];
  if (!mult || !unit) return null;
  return { mult, span: unit.span, barMs: mult * unit.ms, factor: 1 };
}

// Ambil `count` bar terbaru (sort=desc), hasilnya diurutkan naik
async function fetchBars(target, plan, count) {
  const now = new Date();
  const start = new Date(now.getTime() - count * plan.barMs);
  const url = `${TICKERLAYER_BASE_URL}/${target.asset}/agg/${target.sym}/${plan.mult}/${plan.span}/${fmtDate(start)}/${fmtDate(now)}?sort=desc&limit=${count}`;

  const response = await fetch(url, { headers: { 'x-api-key': API_KEY } });
  if (!response.ok) {
    const err = new Error(`TickerLayer HTTP ${response.status}`);
    err.status = response.status;
    err.detail = (await response.text().catch(() => '')).slice(0, 300);
    throw err;
  }

  const raw = await response.json();
  return (Array.isArray(raw) ? raw : raw.results || [])
    .map(bar => ({
      t: Number(bar.t ?? bar.timestamp ?? bar.time),
      o: Number(bar.o ?? bar.open),
      h: Number(bar.h ?? bar.high),
      l: Number(bar.l ?? bar.low),
      c: Number(bar.c ?? bar.close),
    }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite))
    .sort((a, b) => a.t - b.t);
}

// Gabungkan bar kecil menjadi bar lebih besar (dipakai untuk 30m dari 5m)
function aggregate(rows, bucketMs) {
  const map = new Map();
  for (const r of rows) {
    const bt = Math.floor(r.t / bucketMs) * bucketMs;
    const b = map.get(bt);
    if (!b) map.set(bt, { t: bt, o: r.o, h: r.h, l: r.l, c: r.c });
    else {
      b.h = Math.max(b.h, r.h);
      b.l = Math.min(b.l, r.l);
      b.c = r.c;
    }
  }
  return [...map.values()];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { symbol, interval, limit } = req.body || {};
  if (!symbol || !interval) return res.status(400).json({ error: 'Symbol & interval required' });

  // Normalisasi simbol: buang prefix (OANDA:XAUUSD), slash (XAU/USD), dan huruf kecil
  const key = String(symbol).toUpperCase().replace(/^[A-Z]+:/, '').replace(/[^A-Z0-9]/g, '');
  const target = SYMBOL_MAP[key];
  if (!target) return res.status(400).json({ error: `Simbol tidak dikenal: ${symbol}` });

  const plan = planFor(interval);
  if (!plan) return res.status(400).json({ error: `Interval tidak valid: ${interval}` });

  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 10), 1000);
  const ttl = TTL_MAP[interval] || 60;

  // Key v3: cache dari logika lama tidak dipakai lagi
  const cacheKey = `candles_v3_${target.asset}_${target.sym}_${interval}_${lim}`;

  // 1. Cek cache
  const cachedData = await kvGetJSON(cacheKey);
  if (Array.isArray(cachedData) && cachedData.length > 0) {
    return res.status(200).json({ ok: true, candles: cachedData, source: 'cache' });
  }

  // 2. Ambil dari TickerLayer
  try {
    const raw = await fetchBars(target, plan, lim * plan.factor);
    const rows = (plan.factor > 1 ? aggregate(raw, 30 * 60000) : raw).slice(-lim);

    if (rows.length > 0) {
      // 3. Simpan ke cache agar pengguna lain bisa memakainya
      await kvSetJSON(cacheKey, rows, ttl);
      return res.status(200).json({ ok: true, candles: rows, source: 'tickerlayer' });
    }

    return res.status(200).json({ ok: true, candles: [], source: 'empty' });

  } catch (err) {
    if (cachedData) return res.status(200).json({ ok: true, candles: cachedData, source: 'cache-fallback' });
    return res.status(err.status || 500).json({ error: err.message, detail: err.detail || '' });
  }
}
