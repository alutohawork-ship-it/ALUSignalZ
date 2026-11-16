// api/candles.js
// v5: TickerLayer + cache KV + rotasi key (utama lalu cadangan, urutan tetap).
// Jendela waktu minimal 7 hari supaya awal pekan (Senin pagi) tetap dapat bar yang cukup.
//
// Env vars di Vercel (sudah ada):
//   TICKERLAYER_API_KEY, TICKERLAYER_API_KEY_1, _2, _3, _4
//   KV_REST_API_URL, KV_REST_API_TOKEN (opsional: cache & cooldown bersama)

const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

// Urutan tetap: utama dulu, lalu cadangan
const KEYS = [
  process.env.TICKERLAYER_API_KEY,
  process.env.TICKERLAYER_API_KEY_1,
  process.env.TICKERLAYER_API_KEY_2,
  process.env.TICKERLAYER_API_KEY_3,
  process.env.TICKERLAYER_API_KEY_4,
].filter(Boolean);

// Mapping simbol app -> asset class dan simbol TickerLayer
// XAUUSD termasuk commodities. Crypto memakai BTCUSD (bukan BTCUSDT)
const SYMBOL_MAP = {
  XAUUSD:  { asset: 'commodities', sym: 'XAUUSD' },
  GOLD:    { asset: 'commodities', sym: 'XAUUSD' },
  BTCUSD:  { asset: 'crypto', sym: 'BTCUSD' },
  BTCUSDT: { asset: 'crypto', sym: 'BTCUSD' },
  BTC:     { asset: 'crypto', sym: 'BTCUSD' },
};

// TTL cache (detik), disamakan dengan CANDLE_TTL di client
const TTL_MAP = { '1m': 60, '5m': 120, '15m': 300, '30m': 600, '1h': 900, '4h': 1800, '1d': 3600 };

const UNIT = {
  m: { span: 'minute', ms: 60 * 1000 },
  h: { span: 'hour', ms: 60 * 60 * 1000 },
  d: { span: 'day', ms: 24 * 60 * 60 * 1000 },
};

// Jendela minimal untuk setiap permintaan (ms)
const MIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Lama cooldown per key (detik)
const CD = { quota: 600, rate: 5, invalid: 6 * 3600 };

// Cooldown di memori, dipakai jika KV tidak aktif (berlaku per instance)
const memCooldown = new Map();

// ── KV helper ──
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

async function kvMGet(keys) {
  try {
    const raw = await kv(['MGET', ...keys]);
    return Array.isArray(raw) ? raw : keys.map(() => null);
  } catch { return keys.map(() => null); }
}

const fmtDate = d => d.toISOString().slice(0, 10);

// Rencana pengambilan bar untuk tiap interval
function planFor(interval) {
  if (interval === '30m') return { mult: 5, span: 'minute', barMs: 5 * 60000, factor: 6 };
  const mult = parseInt(interval, 10);
  const unit = UNIT[interval.slice(-1)];
  if (!mult || !unit) return null;
  return { mult, span: unit.span, barMs: mult * unit.ms, factor: 1 };
}

// Gabungkan bar kecil menjadi bar lebih besar (30m dari 5m)
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

// Cooldown per key: 429 kuota habis / rate limit, 401 key tidak valid
function cooldownSeconds(status, body, retryAfterHeader) {
  if (status === 401) return CD.invalid;
  if (status === 429) {
    if (body && body.code === 'REST_QUOTA_EXCEEDED') return CD.quota;
    const ra = Number((body && body.retry_after) || retryAfterHeader);
    return Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : CD.rate;
  }
  return 0;
}

async function setCooldown(idx, seconds) {
  if (seconds <= 0) return;
  const name = `tl_cd_${idx}`;
  memCooldown.set(name, Date.now() + seconds * 1000);
  try { await kv(['SET', name, '1', 'EX', seconds]); } catch (e) {}
}

// Index key yang tidak sedang cooldown, dalam urutan tetap (utama dulu)
async function usableKeyOrder() {
  const names = KEYS.map((_, i) => `tl_cd_${i}`);
  const kvVals = await kvMGet(names);
  const now = Date.now();
  return KEYS.map((_, i) => i).filter(i =>
    !kvVals[i] && (memCooldown.get(names[i]) || 0) <= now
  );
}

// Satu panggilan ke TickerLayer dengan satu key
async function requestBars(apiKey, target, plan, count) {
  const now = new Date();
  // Minimal 7 hari ke belakang, supaya Senin pagi tetap dapat bar yang cukup
  const start = new Date(now.getTime() - Math.max(count * plan.barMs, MIN_WINDOW_MS));
  const url = `${TICKERLAYER_BASE_URL}/${target.asset}/agg/${target.sym}/${plan.mult}/${plan.span}/${fmtDate(start)}/${fmtDate(now)}?sort=desc&limit=${count}`;

  const response = await fetch(url, { headers: { 'x-api-key': apiKey } });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let body = {};
    try { body = JSON.parse(text); } catch (e) {}
    return {
      ok: false,
      status: response.status,
      body,
      detail: text.slice(0, 300),
      retryAfter: response.headers.get('retry-after'),
    };
  }

  const raw = await response.json();
  const rows = (Array.isArray(raw) ? raw : raw.results || [])
    .map(bar => ({
      t: Number(bar.t ?? bar.timestamp ?? bar.time),
      o: Number(bar.o ?? bar.open),
      h: Number(bar.h ?? bar.high),
      l: Number(bar.l ?? bar.low),
      c: Number(bar.c ?? bar.close),
    }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite))
    .sort((a, b) => a.t - b.t);

  return { ok: true, rows };
}

// Coba key berurutan. 429 dan 401 memicu cooldown lalu lanjut ke cadangan.
// 403 (paket key tidak memuat data ini) juga lanjut ke cadangan.
// 404, 400, 5xx langsung berhenti karena bukan masalah key.
async function fetchBarsRotated(target, plan, count) {
  if (!KEYS.length) {
    const e = new Error('Tidak ada TICKERLAYER_API_KEY di env');
    e.status = 500;
    throw e;
  }

  const order = await usableKeyOrder();
  if (!order.length) {
    const e = new Error('Semua API key TickerLayer sedang cooldown');
    e.status = 429;
    throw e;
  }

  let last = null;
  for (const idx of order) {
    const r = await requestBars(KEYS[idx], target, plan, count);
    if (r.ok) return { rows: r.rows, keyNo: idx + 1 };

    last = r;
    if (r.status === 429 || r.status === 401) {
      await setCooldown(idx, cooldownSeconds(r.status, r.body, r.retryAfter));
      continue;
    }
    if (r.status === 403) continue;
    break;
  }

  const e = new Error(`TickerLayer HTTP ${last.status}`);
  e.status = last.status;
  e.detail = last.detail;
  throw e;
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
  // v4: cache dari versi sebelumnya (jendela pendek) tidak dipakai lagi
  const cacheKey = `candles_v4_${target.asset}_${target.sym}_${interval}_${lim}`;

  // 1. Cek cache
  const cachedData = await kvGetJSON(cacheKey);
  if (Array.isArray(cachedData) && cachedData.length > 0) {
    return res.status(200).json({ ok: true, candles: cachedData, source: 'cache' });
  }

  // 2. Ambil dari TickerLayer dengan rotasi key
  try {
    const { rows: raw, keyNo } = await fetchBarsRotated(target, plan, lim * plan.factor);
    const rows = (plan.factor > 1 ? aggregate(raw, 30 * 60000) : raw).slice(-lim);

    if (rows.length > 0) {
      await kvSetJSON(cacheKey, rows, ttl);
      return res.status(200).json({ ok: true, candles: rows, source: 'tickerlayer', keyNo });
    }

    return res.status(200).json({ ok: true, candles: [], source: 'empty' });

  } catch (err) {
    if (cachedData) return res.status(200).json({ ok: true, candles: cachedData, source: 'cache-fallback' });
    return res.status(err.status || 500).json({ error: err.message, detail: err.detail || '' });
  }
}
