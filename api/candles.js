// api/candles.js — v10
// - Tahan 429/quota/cooldown: serve last-known-good cache (stale:true) agar chart tidak kosong.
// - Sanitasi candle: dedupe timestamp kembar + validasi OHLC (fix anomali M1 reconnect).
// - Memory guard: cache expired di-evict otomatis.
// - Cek cooldown proaktif: semua key cooldown → langsung stale (hemat latensi).
// - Kontrak request/response sama dengan v9; frontend tidak wajib diubah.
//
// Env: TICKERLAYER_API_KEY, TICKERLAYER_API_KEY_1 .. _19, DATABASE_URL
// Opsional: TICKERLAYER_MAX_TRY (default 6), TICKERLAYER_DISABLED=1

import { checkAccess } from '../lib/access.js';

export const config = { maxDuration: 60 };

const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

const TL_KEY_NAMES = [
  'TICKERLAYER_API_KEY',
  ...Array.from({ length: 19 }, (_, i) => `TICKERLAYER_API_KEY_${i + 1}`),
];
const API_KEYS = TL_KEY_NAMES.map(n => process.env[n] || '');
const TL_MAX_TRY = Math.max(1, Number(process.env.TICKERLAYER_MAX_TRY || 6));
const TL_DISABLED = process.env.TICKERLAYER_DISABLED === '1';
const TL_TIMEOUT_MS = 4000;

const SYMBOL_MAP = {
  XAUUSD:  { asset: 'commodities', sym: 'XAUUSD' },
  GOLD:    { asset: 'commodities', sym: 'XAUUSD' },
  BTCUSD:  { asset: 'crypto', sym: 'BTCUSD' },
  BTCUSDT: { asset: 'crypto', sym: 'BTCUSD' },
  BTC:     { asset: 'crypto', sym: 'BTCUSD' },
};

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;
const PAGE_LIMIT = 5000;
const MAX_PAGES = 4;
const WINDOW_DAYS = 10;
const FALLBACK_DAYS = 3;

const DERIVED = { '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240 };
const NATIVE = { '1m': { span: 'minute' }, '1d': { span: 'day' } };
const TTL = { '1m': 60, '5m': 120, '15m': 180, '30m': 240, '1h': 300, '4h': 600, '1d': 3600 };
const VALID = new Set(Object.keys(TTL));

const CD = { quota: 600, rate: 5, invalid: 6 * 3600 };

const memCache = new Map();
const memCooldown = new Map();
const lastGood = new Map(); // [v10] rows terakhir yang valid untuk fallback 429

function cacheGet(key) {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) { memCache.delete(key); return null; }
  return hit.value;
}

function cacheSet(key, value, ttlSec) {
  if (memCache.size > 400) {
    const now = Date.now();
    for (const [k, v] of memCache) if (now > v.exp) memCache.delete(k);
  }
  memCache.set(key, { exp: Date.now() + ttlSec * 1000, value });
  if (Array.isArray(value) && value.length) lastGood.set(key, value);
}

function staleResponse(cacheKey, lim, reason, retryInSec = 30) {
  const good = lastGood.get(cacheKey);
  if (Array.isArray(good) && good.length) {
    return { ok: true, candles: good.slice(-lim), source: 'stale-cache', stale: true, retryInSec, note: reason };
  }
  return null;
}

const fmtDate = d => d.toISOString().slice(0, 10);

function cooldownFor(status, body, retryAfter) {
  if (status === 401) return CD.invalid;
  if (status === 429) {
    if (body && body.code === 'REST_QUOTA_EXCEEDED') return CD.quota;
    const ra = Number((body && body.retry_after) || retryAfter);
    return Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : CD.rate;
  }
  return 0;
}

function setCooldown(idx, sec) {
  if (sec <= 0) return;
  memCooldown.set(`tl_cd_${idx}`, Date.now() + sec * 1000);
}

function usableSlots() {
  const now = Date.now();
  return API_KEYS
    .map((_, i) => i)
    .filter(i => API_KEYS[i] && (memCooldown.get(`tl_cd_${i}`) || 0) <= now);
}

// [v10] Sanitasi: validasi OHLC + dedupe timestamp kembar (latest wins)
function sanitizeRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const valid = rows.filter(c =>
    [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite) &&
    c.h >= Math.max(c.o, c.c, c.l) &&
    c.l <= Math.min(c.o, c.c, c.h)
  );
  const out = [];
  for (const c of valid) {
    if (out.length && out[out.length - 1].t === c.t) out[out.length - 1] = c;
    else out.push(c);
  }
  return out;
}

async function requestBars(apiKey, target, p) {
  const url = `${TICKERLAYER_BASE_URL}/${target.asset}/agg/${target.sym}/${p.mult}/${p.span}/${p.from}/${p.to}?sort=desc&limit=${p.limit}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TL_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'x-api-key': apiKey }, signal: controller.signal });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      let body = {};
      try { body = JSON.parse(text); } catch {}
      return { ok: false, status: r.status, body, detail: text.slice(0, 300), retryAfter: r.headers.get('retry-after') };
    }
    const raw = await r.json();
    const rows = (Array.isArray(raw) ? raw : raw.results || [])
      .map(bar => {
        let t = Number(bar.t ?? bar.timestamp ?? bar.time);
        if (Number.isFinite(t) && t < 1e12) t *= 1000;
        return {
          t,
          o: Number(bar.o ?? bar.open),
          h: Number(bar.h ?? bar.high),
          l: Number(bar.l ?? bar.low),
          c: Number(bar.c ?? bar.close),
        };
      })
      .sort((a, b) => a.t - b.t);
    return { ok: true, rows: sanitizeRows(rows) };
  } catch (e) {
    return { ok: false, status: 500, body: {}, detail: e.name === 'AbortError' ? 'timeout' : e.message, retryAfter: null };
  } finally {
    clearTimeout(timer);
  }
}

function httpError(status, message, detail = '') {
  const e = new Error(message);
  e.status = status;
  e.detail = detail;
  return e;
}

async function fetchBars(target, p) {
  if (TL_DISABLED) throw httpError(503, 'TickerLayer dinonaktifkan (TICKERLAYER_DISABLED=1).');
  if (!API_KEYS.some(Boolean)) throw httpError(500, 'Tidak ada TICKERLAYER_API_KEY di env');

  const order = usableSlots();
  if (!order.length) throw httpError(429, 'Semua key TickerLayer sedang cooldown');

  let last = { status: 500, detail: '' };
  for (const idx of order.slice(0, TL_MAX_TRY)) {
    const r = await requestBars(API_KEYS[idx], target, p);
    if (r.ok) return { rows: r.rows, keyNo: idx + 1 };

    last = r;
    if (r.status === 429 || r.status === 401) {
      setCooldown(idx, cooldownFor(r.status, r.body, r.retryAfter));
      continue;
    }
    if (r.status === 403) continue;
    break;
  }
  throw httpError(last.status, `TickerLayer HTTP ${last.status}`, last.detail);
}

async function fetchM1Window(target) {
  const now = new Date();
  let spanDays = WINDOW_DAYS;
  let from = fmtDate(new Date(now.getTime() - spanDays * DAY_MS));
  let retried = false;

  const all = new Map();
  let to = now;
  let keyNo = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    let r;
    try {
      r = await fetchBars(target, { mult: 1, span: 'minute', from, to: fmtDate(to), limit: PAGE_LIMIT });
    } catch (e) {
      if (!all.size && e.status === 400 && !retried) {
        retried = true;
        spanDays = FALLBACK_DAYS;
        from = fmtDate(new Date(now.getTime() - spanDays * DAY_MS));
        page--;
        continue;
      }
      if (!all.size) throw e;
      break;
    }

    keyNo = r.keyNo;
    if (!r.rows.length) break;
    for (const b of r.rows) all.set(b.t, b);
    if (r.rows.length < PAGE_LIMIT) break;

    let next = new Date(r.rows[0].t);
    if (fmtDate(next) >= fmtDate(to)) next = new Date(r.rows[0].t - DAY_MS);
    if (fmtDate(next) < from) break;
    to = next;
  }

  return { rows: [...all.values()].sort((a, b) => a.t - b.t), keyNo };
}

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

function cacheDerived(sym, m1) {
  const out = {};
  for (const [tf, mins] of Object.entries(DERIVED)) {
    const bars = aggregate(m1, mins * MIN_MS).slice(-1000);
    out[tf] = bars;
    if (bars.length) cacheSet(`candles_v10_${sym}_${tf}`, bars, TTL[tf]);
  }
  return out;
}

async function fetchNative(target, interval, lim) {
  const now = new Date();
  const days = interval === '1m' ? WINDOW_DAYS : Math.ceil(lim * 1.6);
  const from = fmtDate(new Date(now.getTime() - days * DAY_MS));
  const r = await fetchBars(target, {
    mult: 1, span: NATIVE[interval].span, from, to: fmtDate(now), limit: lim,
  });
  return { rows: r.rows.slice(-lim), keyNo: r.keyNo };
}

const ACCESS_MSG = {
  noEmail: { status: 401, msg: 'Email tidak ditemukan. Silakan login ulang.' },
  notRegistered: { status: 403, msg: 'Email ini belum terdaftar sebagai klien.' },
  expired: { status: 403, msg: 'Masa akses sudah berakhir. Hubungi admin.' },
  kvError: { status: 503, msg: 'Akses tidak bisa diverifikasi. Coba lagi.' },
  trialLimit: { status: 403, msg: 'Batas trial habis.' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const email = String(body.email || body.value || '').trim().toLowerCase();
  const access = await checkAccess(email, false);
  if (!access.ok) {
    const m = ACCESS_MSG[access.key] || { status: 403, msg: 'Akses ditolak.' };
    return res.status(m.status).json({ error: m.msg });
  }

  const { symbol, interval, limit } = body;
  if (!symbol || !interval) return res.status(400).json({ error: 'Symbol & interval required' });
  if (!VALID.has(interval)) return res.status(400).json({ error: `Interval tidak valid: ${interval}` });

  const key = String(symbol).toUpperCase().replace(/^[A-Z]+:/, '').replace(/[^A-Z0-9]/g, '');
  const target = SYMBOL_MAP[key];
  if (!target) return res.status(400).json({ error: `Simbol tidak dikenal: ${symbol}` });

  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 10), 1000);
  const cacheKey = `candles_v10_${target.sym}_${interval}`;
  const minOk = Math.min(lim, 60);

  const hit = cacheGet(cacheKey);
  if (Array.isArray(hit) && hit.length >= minOk) {
    return res.status(200).json({ ok: true, candles: hit.slice(-lim), source: 'cache', stale: false });
  }
  const thin = Array.isArray(hit) && hit.length ? hit : null;

  if (!TL_DISABLED && API_KEYS.some(Boolean) && !usableSlots().length) {
    const st = staleResponse(cacheKey, lim, 'Semua key TickerLayer sedang cooldown. Menampilkan data terakhir yang valid.', 30);
    if (st) return res.status(200).json(st);
    if (thin && thin.length) return res.status(200).json({ ok: true, candles: thin.slice(-lim), source: 'cache-thin', stale: true });
    return res.status(429).json({ error: 'Semua key TickerLayer sedang cooldown', detail: '' });
  }

  try {
    if (NATIVE[interval]) {
      const n = await fetchNative(target, interval, lim);
      if (n.rows.length) {
        cacheSet(cacheKey, n.rows, TTL[interval]);
        return res.status(200).json({ ok: true, candles: n.rows, source: 'tickerlayer', keyNo: n.keyNo, stale: false });
      }
      const st = staleResponse(cacheKey, lim, 'Upstream mengembalikan data kosong. Menampilkan data terakhir yang valid.', 20);
      if (st) return res.status(200).json(st);
      return res.status(200).json({ ok: true, candles: [], source: 'tickerlayer-empty', stale: true });
    }

    const w = await fetchM1Window(target);
    if (!w.rows.length) {
      const st = staleResponse(cacheKey, lim, 'Upstream mengembalikan data kosong. Menampilkan data terakhir yang valid.', 20);
      if (st) return res.status(200).json(st);
      return res.status(200).json({ ok: true, candles: [], source: 'tickerlayer-empty', stale: true });
    }
    const derived = cacheDerived(target.sym, w.rows);
    const bars = (derived[interval] || []).slice(-lim);
    if (bars.length) {
      return res.status(200).json({ ok: true, candles: bars, source: 'tickerlayer-m1', keyNo: w.keyNo, stale: false });
    }
    const st2 = staleResponse(cacheKey, lim, 'Interval turunan kosong. Menampilkan data terakhir yang valid.', 20);
    if (st2) return res.status(200).json(st2);
    return res.status(200).json({ ok: true, candles: [], source: 'tickerlayer-empty', stale: true });
  } catch (err) {
    const isRate = err.status === 429 || /quota|cooldown|429/i.test(err.message || '');
    const reason = isRate
      ? 'Upstream rate-limit (429). Menampilkan data terakhir yang valid.'
      : `Upstream error (${err.status || 500}). Menampilkan data terakhir yang valid.`;
    const st = staleResponse(cacheKey, lim, reason, isRate ? 60 : 20);
    if (st) return res.status(200).json(st);
    if (thin && thin.length) return res.status(200).json({ ok: true, candles: thin.slice(-lim), source: 'cache-thin', stale: true });
    return res.status(err.status || 500).json({ error: err.message, detail: err.detail || '' });
  }
}
