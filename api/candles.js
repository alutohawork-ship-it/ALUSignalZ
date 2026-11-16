// api/candles.js
// v6: Semua interval di bawah 1 hari dibangun dari bar M1 (data M1 lengkap),
// lalu digabung (aggregate) ke M5/M15/M30/H1/H4. M1 dan 1D tetap native.
// Tetap: cache KV + rotasi key (utama lalu cadangan, urutan tetap).
//
// Env vars di Vercel:
//   TICKERLAYER_API_KEY, TICKERLAYER_API_KEY_1, _2, _3, _4
//   KV_REST_API_URL, KV_REST_API_TOKEN (opsional: cache & cooldown bersama)

const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

const KEYS = [
  process.env.TICKERLAYER_API_KEY,
  process.env.TICKERLAYER_API_KEY_1,
  process.env.TICKERLAYER_API_KEY_2,
  process.env.TICKERLAYER_API_KEY_3,
  process.env.TICKERLAYER_API_KEY_4,
].filter(Boolean);

const SYMBOL_MAP = {
  XAUUSD:  { asset: 'commodities', sym: 'XAUUSD' },
  GOLD:    { asset: 'commodities', sym: 'XAUUSD' },
  BTCUSD:  { asset: 'crypto', sym: 'BTCUSD' },
  BTCUSDT: { asset: 'crypto', sym: 'BTCUSD' },
  BTC:     { asset: 'crypto', sym: 'BTCUSD' },
};

// TTL cache (detik). Dipendekkan karena sekarang dibangun dari M1.
// Naikkan kalau kuota API terasa boros.
const TTL_MAP = { '1m': 45, '5m': 60, '15m': 90, '30m': 120, '1h': 180, '4h': 300, '1d': 3600 };

const UNIT = {
  m: { span: 'minute', ms: 60 * 1000 },
  h: { span: 'hour', ms: 60 * 60 * 1000 },
  d: { span: 'day', ms: 24 * 60 * 60 * 1000 },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_WINDOW_MS = 7 * DAY_MS;

// Paging M1. Kalau API menolak limit sebesar ini, turunkan PAGE_LIMIT
// (mis. 1000) dan naikkan MAX_PAGES.
const PAGE_LIMIT = 5000;
const MAX_PAGES = 6;

// Rentang tanggal M1 per permintaan dibatasi, karena TickerLayer menolak (HTTP 400)
// rentang yang terlalu panjang. Kalau masih 400, otomatis turun ke FALLBACK_SPAN_DAYS.
const MAX_SPAN_DAYS = 14;
const FALLBACK_SPAN_DAYS = 7;

const CD = { quota: 600, rate: 5, invalid: 6 * 3600 };
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

// Rencana: interval < 1 hari (selain 1m) dibangun dari M1
function planFor(interval) {
  const mult = parseInt(interval, 10);
  const unit = UNIT[String(interval).slice(-1)];
  if (!mult || !unit) return null;
  const barMs = mult * unit.ms;
  const fromM1 = barMs > 60000 && barMs < DAY_MS;
  return { mult, span: unit.span, barMs, fromM1 };
}

// Gabungkan bar M1 (urut naik) ke bucket yang lebih besar
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
  return [...map.values()].sort((a, b) => a.t - b.t);
}

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

async function usableKeyOrder() {
  const names = KEYS.map((_, i) => `tl_cd_${i}`);
  const kvVals = await kvMGet(names);
  const now = Date.now();
  return KEYS.map((_, i) => i).filter(i =>
    !kvVals[i] && (memCooldown.get(names[i]) || 0) <= now
  );
}

// Satu panggilan ke TickerLayer. p = { mult, span, from, to, limit }
async function requestBars(apiKey, target, p) {
  const url = `${TICKERLAYER_BASE_URL}/${target.asset}/agg/${target.sym}/${p.mult}/${p.span}/${p.from}/${p.to}?sort=desc&limit=${p.limit}`;

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
    .map(bar => {
      let t = Number(bar.t ?? bar.timestamp ?? bar.time);
      if (Number.isFinite(t) && t < 1e12) t *= 1000; // detik -> ms
      return {
        t,
        o: Number(bar.o ?? bar.open),
        h: Number(bar.h ?? bar.high),
        l: Number(bar.l ?? bar.low),
        c: Number(bar.c ?? bar.close),
      };
    })
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite))
    .sort((a, b) => a.t - b.t);

  return { ok: true, rows };
}

// Rotasi key: 429/401 -> cooldown lalu lanjut; 403 lanjut; lainnya berhenti.
async function fetchBarsRotated(target, params) {
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
    const r = await requestBars(KEYS[idx], target, params);
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

// Ambil M1 mundur (paging) sampai jumlah bucket hasil gabungan cukup
async function fetchM1ForBuckets(target, barMs, lim) {
  const now = new Date();
  const spanMs = Math.min(
    Math.max(lim * barMs * 1.6, MIN_WINDOW_MS),
    MAX_SPAN_DAYS * DAY_MS
  );
  let fromStr = fmtDate(new Date(now.getTime() - spanMs));
  let retried = false;

  const all = new Map();
  let to = now;
  let keyNo = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    let r;
    try {
      r = await fetchBarsRotated(target, {
        mult: 1, span: 'minute', from: fromStr, to: fmtDate(to), limit: PAGE_LIMIT,
      });
    } catch (e) {
      // 400 di halaman pertama: kemungkinan rentang terlalu panjang -> coba lebih pendek
      if (!all.size && e.status === 400 && !retried) {
        retried = true;
        fromStr = fmtDate(new Date(now.getTime() - FALLBACK_SPAN_DAYS * DAY_MS));
        page--;
        continue;
      }
      if (!all.size) throw e; // halaman pertama gagal -> error
      break;                  // halaman lanjutan gagal -> pakai yang ada
    }

    keyNo = r.keyNo;
    if (!r.rows.length) break;
    for (const b of r.rows) all.set(b.t, b);

    const buckets = new Set();
    for (const t of all.keys()) buckets.add(Math.floor(t / barMs));
    if (buckets.size > lim) break;           // sudah cukup
    if (r.rows.length < PAGE_LIMIT) break;   // sudah sampai awal jendela

    const oldest = r.rows[0].t;
    let nextTo = new Date(oldest);
    if (fmtDate(nextTo) >= fmtDate(to)) nextTo = new Date(oldest - DAY_MS);
    if (fmtDate(nextTo) < fromStr) break;
    to = nextTo;
  }

  return { rows: [...all.values()].sort((a, b) => a.t - b.t), keyNo };
}

// Native (1m dan 1d)
async function fetchNative(target, plan, lim) {
  const now = new Date();
  const start = new Date(now.getTime() - Math.max(lim * plan.barMs * 1.6, MIN_WINDOW_MS));
  return fetchBarsRotated(target, {
    mult: plan.mult, span: plan.span, from: fmtDate(start), to: fmtDate(now), limit: lim,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { symbol, interval, limit } = req.body || {};
  if (!symbol || !interval) return res.status(400).json({ error: 'Symbol & interval required' });

  const key = String(symbol).toUpperCase().replace(/^[A-Z]+:/, '').replace(/[^A-Z0-9]/g, '');
  const target = SYMBOL_MAP[key];
  if (!target) return res.status(400).json({ error: `Simbol tidak dikenal: ${symbol}` });

  const plan = planFor(interval);
  if (!plan) return res.status(400).json({ error: `Interval tidak valid: ${interval}` });

  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 10), 1000);
  const ttl = TTL_MAP[interval] || 60;
  // v5: cache lama (bar native yang bolong) tidak dipakai lagi
  const cacheKey = `candles_v5_${target.asset}_${target.sym}_${interval}_${lim}`;

  // 1. Cek cache
  const cachedData = await kvGetJSON(cacheKey);
  if (Array.isArray(cachedData) && cachedData.length > 0) {
    return res.status(200).json({ ok: true, candles: cachedData, source: 'cache' });
  }

  // 2. Ambil dari TickerLayer
  try {
    let rows, keyNo;
    if (plan.fromM1) {
      const m1 = await fetchM1ForBuckets(target, plan.barMs, lim);
      keyNo = m1.keyNo;
      rows = aggregate(m1.rows, plan.barMs).slice(-lim);
    } else {
      const n = await fetchNative(target, plan, lim);
      keyNo = n.keyNo;
      rows = n.rows.slice(-lim);
    }

    if (rows.length > 0) {
      await kvSetJSON(cacheKey, rows, ttl);
      return res.status(200).json({
        ok: true, candles: rows,
        source: plan.fromM1 ? 'tickerlayer-m1' : 'tickerlayer', keyNo,
      });
    }

    return res.status(200).json({ ok: true, candles: [], source: 'empty' });

  } catch (err) {
    if (cachedData) return res.status(200).json({ ok: true, candles: cachedData, source: 'cache-fallback' });
    return res.status(err.status || 500).json({ error: err.message, detail: err.detail || '' });
  }
}
