// api/candles.js
// v8: FIX akses (frontend mengirim { value: email } -> sekarang menerima value ATAU email).
//     satu tarikan M1 dipakai untuk semua interval di bawah 1 hari (5m, 15m, 30m, 1h, 4h),
//     lalu tiap interval disimpan di cache sendiri. 1m dan 1d native (satu panggilan).
//     Cek akses klien (fail closed). Slot key tetap, cooldown kompatibel dengan generate.js v106.
//
// Env: TICKERLAYER_API_KEY, TICKERLAYER_API_KEY_1 .. _19, KV_REST_API_URL, KV_REST_API_TOKEN
// Opsional: TICKERLAYER_MAX_TRY (default 6), TICKERLAYER_DISABLED=1

export const config = { maxDuration: 60 };

const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';
const KV_KEY = 'alu_clients';

// Slot tetap seperti generate.js v106: key kosong di tengah tidak menggeser cooldown
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
const PAGE_LIMIT = 5000;   // kalau API membatasi lebih kecil, samakan dengan batas itu
const MAX_PAGES = 4;
const WINDOW_DAYS = 10;    // satu tarikan M1 per miss, dipakai untuk semua interval turunan
const FALLBACK_DAYS = 3;   // dipakai kalau API menolak rentang (HTTP 400)

const DERIVED = { '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240 }; // menit
const NATIVE = { '1m': { span: 'minute' }, '1d': { span: 'day' } };
const TTL = { '1m': 60, '5m': 120, '15m': 180, '30m': 240, '1h': 300, '4h': 600, '1d': 3600 };
const VALID = new Set(Object.keys(TTL));

const CD = { quota: 600, rate: 5, invalid: 6 * 3600 };
const memCooldown = new Map();

const fmtDate = d => d.toISOString().slice(0, 10);

// ── KV ──
async function kvRaw(command) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || `KV HTTP ${r.status}`);
  return data.result;
}

const kvSafe = async cmd => { try { return await kvRaw(cmd); } catch { return null; } };

async function cacheGet(key) {
  const raw = await kvSafe(['GET', key]);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

async function cacheSet(key, value, ttl) {
  await kvSafe(['SET', key, JSON.stringify(value), 'EX', ttl]);
}

// ── Akses (sama dengan generate.js, tapi gagal membaca KV = ditolak) ──
async function checkAccess(email) {
  if (!email) return { ok: false, status: 401, msg: 'Email tidak ditemukan. Silakan login ulang.' };
  try {
    const raw = await kvRaw(['GET', KV_KEY]);
    if (!raw) return { ok: true };
    const c = JSON.parse(raw).find(x => x.email === email);
    if (!c) return { ok: false, status: 403, msg: 'Email ini belum terdaftar sebagai klien.' };
    if (new Date(c.expires_at) <= new Date()) return { ok: false, status: 403, msg: 'Masa akses sudah berakhir. Hubungi admin.' };
    return { ok: true };
  } catch {
    return { ok: false, status: 503, msg: 'Akses tidak bisa diverifikasi. Coba lagi.' };
  }
}

// ── Cooldown key (slot tetap, prefix sama dengan generate.js) ──
function cooldownFor(status, body, retryAfter) {
  if (status === 401) return CD.invalid;
  if (status === 429) {
    if (body && body.code === 'REST_QUOTA_EXCEEDED') return CD.quota;
    const ra = Number((body && body.retry_after) || retryAfter);
    return Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : CD.rate;
  }
  return 0;
}

async function setCooldown(idx, sec) {
  if (sec <= 0) return;
  const name = `tl_cd_${idx}`;
  memCooldown.set(name, Date.now() + sec * 1000);
  await kvSafe(['SET', name, '1', 'EX', sec]);
}

async function usableSlots() {
  const names = TL_KEY_NAMES.map((_, i) => `tl_cd_${i}`);
  const raw = await kvSafe(['MGET', ...names]);
  const vals = Array.isArray(raw) ? raw : names.map(() => null);
  const now = Date.now();
  return API_KEYS
    .map((_, i) => i)
    .filter(i => API_KEYS[i] && !vals[i] && (memCooldown.get(names[i]) || 0) <= now);
}

// ── Satu panggilan ke TickerLayer, dengan timeout ──
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
        if (Number.isFinite(t) && t < 1e12) t *= 1000; // detik -> milidetik
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

// Rotasi key: 429/401 -> cooldown lalu coba key berikutnya; 403 lanjut; lainnya berhenti
async function fetchBars(target, p) {
  if (TL_DISABLED) throw httpError(503, 'TickerLayer dinonaktifkan (TICKERLAYER_DISABLED=1).');
  if (!API_KEYS.some(Boolean)) throw httpError(500, 'Tidak ada TICKERLAYER_API_KEY di env');

  const order = await usableSlots();
  if (!order.length) throw httpError(429, 'Semua key TickerLayer sedang cooldown');

  let last = { status: 500, detail: '' };
  for (const idx of order.slice(0, TL_MAX_TRY)) {
    const r = await requestBars(API_KEYS[idx], target, p);
    if (r.ok) return { rows: r.rows, keyNo: idx + 1 };

    last = r;
    if (r.status === 429 || r.status === 401) {
      await setCooldown(idx, cooldownFor(r.status, r.body, r.retryAfter));
      continue;
    }
    if (r.status === 403) continue;
    break; // 400, 404, 5xx, timeout: key lain tidak akan membantu
  }
  throw httpError(last.status, `TickerLayer HTTP ${last.status}`, last.detail);
}

// ── Tarikan M1 mundur (paging), satu kali per miss ──
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
      // 400 di halaman pertama: rentang kemungkinan terlalu panjang, coba lebih pendek sekali
      if (!all.size && e.status === 400 && !retried) {
        retried = true;
        spanDays = FALLBACK_DAYS;
        from = fmtDate(new Date(now.getTime() - spanDays * DAY_MS));
        page--;
        continue;
      }
      if (!all.size) throw e;
      break; // halaman lanjutan gagal: pakai yang sudah ada
    }

    keyNo = r.keyNo;
    if (!r.rows.length) break;
    for (const b of r.rows) all.set(b.t, b);
    if (r.rows.length < PAGE_LIMIT) break;

    // rows sudah urut naik, jadi rows[0] adalah bar tertua di halaman ini
    let next = new Date(r.rows[0].t);
    if (fmtDate(next) >= fmtDate(to)) next = new Date(r.rows[0].t - DAY_MS);
    if (fmtDate(next) < from) break;
    to = next;
  }

  return { rows: [...all.values()].sort((a, b) => a.t - b.t), keyNo };
}

// Gabung bar M1 (urut naik) ke bucket UTC
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

// Dari satu tarikan M1, bangun semua interval turunan dan simpan cache masing-masing
async function cacheDerived(sym, m1) {
  const out = {};
  for (const [tf, mins] of Object.entries(DERIVED)) {
    const bars = aggregate(m1, mins * MIN_MS).slice(-1000);
    out[tf] = bars;
    if (bars.length) await cacheSet(`candles_v7_${sym}_${tf}`, bars, TTL[tf]);
  }
  return out;
}

// Native: 1m dan 1d, satu panggilan
async function fetchNative(target, interval, lim) {
  const now = new Date();
  const days = interval === '1m' ? WINDOW_DAYS : Math.ceil(lim * 1.6);
  const from = fmtDate(new Date(now.getTime() - days * DAY_MS));
  const r = await fetchBars(target, {
    mult: 1, span: NATIVE[interval].span, from, to: fmtDate(now), limit: lim,
  });
  return { rows: r.rows.slice(-lim), keyNo: r.keyNo };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  // FIX: frontend mengirim "value" (email), bukan "email"
  const access = await checkAccess(String(body.email || body.value || '').trim());
  if (!access.ok) return res.status(access.status).json({ error: access.msg });

  const { symbol, interval, limit } = body;
  if (!symbol || !interval) return res.status(400).json({ error: 'Symbol & interval required' });
  if (!VALID.has(interval)) return res.status(400).json({ error: `Interval tidak valid: ${interval}` });

  const key = String(symbol).toUpperCase().replace(/^[A-Z]+:/, '').replace(/[^A-Z0-9]/g, '');
  const target = SYMBOL_MAP[key];
  if (!target) return res.status(400).json({ error: `Simbol tidak dikenal: ${symbol}` });

  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 10), 1000);
  const cacheKey = `candles_v7_${target.sym}_${interval}`;
  const minOk = Math.min(lim, 60);

  // 1. Cache per interval (dipakai bersama semua client)
  const hit = await cacheGet(cacheKey);
  if (Array.isArray(hit) && hit.length >= minOk) {
    return res.status(200).json({ ok: true, candles: hit.slice(-lim), source: 'cache' });
  }

  // 2. TickerLayer
  try {
    if (NATIVE[interval]) {
      const n = await fetchNative(target, interval, lim);
      if (n.rows.length) await cacheSet(cacheKey, n.rows, TTL[interval]);
      return res.status(200).json({ ok: true, candles: n.rows, source: 'tickerlayer', keyNo: n.keyNo });
    }

    const w = await fetchM1Window(target);
    const derived = await cacheDerived(target.sym, w.rows);
    const bars = (derived[interval] || []).slice(-lim);
    return res.status(200).json({ ok: true, candles: bars, source: 'tickerlayer-m1', keyNo: w.keyNo });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, detail: err.detail || '' });
  }
}
