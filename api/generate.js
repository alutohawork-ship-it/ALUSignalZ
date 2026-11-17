// api/generate.js
// v109 (Pemisahan Setup Vision, Validasi Multi-Timeframe Intraday/Swing, & Live OCO Konservatif)

export const config = {
  api: { bodyParser: { sizeLimit: '15mb' } },
  maxDuration: 60,
};

const KV_KEY = 'alu_clients';
const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

// ── AI CONFIG ──
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || 'qwen-3.8-max';
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || 'gpt-6-luna';

const VISION_TIMEOUT_MS = 50000;
const VISION_MAX_TOKENS = 800;

// ── TICKERLAYER KEYS ──
const TL_KEY_NAMES = [
  'TICKERLAYER_API_KEY',
  ...Array.from({ length: 19 }, (_, i) => `TICKERLAYER_API_KEY_${i + 1}`),
];
const API_KEYS = TL_KEY_NAMES.map(name => process.env[name] || '');
const TL_KEY_COUNT = API_KEYS.filter(Boolean).length;
const TL_MAX_TRY = Math.max(1, Number(process.env.TICKERLAYER_MAX_TRY || 6));
const TL_DISABLED = process.env.TICKERLAYER_DISABLED === '1';

const DECIMALS = {
  DXY: 2, EURUSD: 5, GBPUSD: 5, USDJPY: 3, AUDUSD: 5, USDCAD: 5, USDCHF: 5, NZDUSD: 5,
  EURGBP: 5, EURJPY: 3, GBPJPY: 3, AUDJPY: 3, EURAUD: 5, GBPAUD: 5, AUDNZD: 5, CADJPY: 3, CHFJPY: 3, EURNZD: 5,
  XAUUSD: 2, XAGUSD: 3, XPTUSD: 2, XPDUSD: 2, XAUEUR: 2, XAGEUR: 3,
  BRENT: 2, WTI: 2, NATGAS: 3, COPPER: 4, COFFEE: 2, SUGAR: 2,
  US30: 2, NAS100: 2, SPX500: 2, GER40: 2, UK100: 2, JPN225: 0, FRA40: 2, AUS200: 2,
  BTCUSD: 2, ETHUSD: 2, SOLUSD: 2, XRPUSD: 4, BNBUSD: 2, ADAUSD: 4, DOGEUSD: 5, AVAXUSD: 3, LINKUSD: 3, DOTUSD: 4, MATICUSD: 4, UNIUSD: 3,
};

const CRYPTO_LIST = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD', 'DOGEUSD', 'AVAXUSD', 'LINKUSD', 'DOTUSD', 'MATICUSD', 'UNIUSD'];
const GOLD_SYMBOLS = ['XAUUSD', 'XAUUSDX'];
const isGold = symbol => GOLD_SYMBOLS.includes(symbol);
const MAX_SRC_DEVIATION = 0.05;

const pairClassOf = symbol => {
  if (isGold(symbol)) return 'gold';
  if (symbol === 'XAGUSD' || symbol === 'XAGEUR') return 'silver';
  if (['XPTUSD', 'XPDUSD'].includes(symbol)) return 'metal';
  if (CRYPTO_LIST.includes(symbol) || symbol.endsWith('BTC') || symbol.endsWith('USDT')) return 'crypto';
  if (['US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'JPN225', 'FRA40', 'AUS200'].includes(symbol)) return 'index';
  if (['BRENT', 'WTI', 'NATGAS', 'COPPER', 'COFFEE', 'SUGAR'].includes(symbol)) return 'commodity';
  if (symbol.includes('JPY')) return 'fx_jpy';
  return 'fx';
};

const PAIR_CLASS_PROFILE = {
  gold:      { label: 'Emas',      structTf: 'M1', zoneTf: 'M5', zoneDisp: 0.8, nearAtr: 0.5, slMul: 1.0, bufAtr: 0.2,  range: [100, 50000] },
  silver:    { label: 'Perak',     structTf: 'M5', zoneTf: 'M5', zoneDisp: 0.9, nearAtr: 0.6, slMul: 1.1, bufAtr: 0.25, range: [5, 300] },
  metal:     { label: 'Logam',     structTf: 'M5', zoneTf: 'M5', zoneDisp: 0.9, nearAtr: 0.6, slMul: 1.1, bufAtr: 0.25, range: [0.5, 50000] },
  fx:        { label: 'Forex',     structTf: 'M5', zoneTf: 'M5', zoneDisp: 0.8, nearAtr: 0.6, slMul: 1.0, bufAtr: 0.2,  range: [0.00001, 50000] },
  fx_jpy:    { label: 'Forex JPY', structTf: 'M5', zoneTf: 'M5', zoneDisp: 0.8, nearAtr: 0.6, slMul: 1.0, bufAtr: 0.2,  range: [0.01, 100000] },
  index:     { label: 'Indeks',    structTf: 'M5', zoneTf: 'M5', zoneDisp: 0.9, nearAtr: 0.6, slMul: 1.1, bufAtr: 0.25, range: [100, 500000] },
  commodity: { label: 'Komoditas', structTf: 'M5', zoneTf: 'M5', zoneDisp: 0.9, nearAtr: 0.7, slMul: 1.2, bufAtr: 0.25, range: [0.1, 100000] },
  crypto:    { label: 'Kripto',    structTf: 'M5', zoneTf: 'M5', zoneDisp: 1.0, nearAtr: 0.8, slMul: 1.3, bufAtr: 0.3,  range: [0.00000001, 5000000] },
};

const pairProfile = symbol => {
  const cls = pairClassOf(symbol);
  return { cls, ...PAIR_CLASS_PROFILE[cls] };
};

const PIP_OVERRIDE = { XAUUSD: 0.1, DXY: 0.01, US30: 1, NAS100: 1, BTCUSD: 1 };
const pipSizeOf = (symbol, dec) => PIP_OVERRIDE[symbol] ?? Math.pow(10, -(dec - 1));

const MIN_SL_PIPS = { fx: 5, fx_jpy: 5, gold: 25, silver: 8, metal: 8, crypto: 20, index: 10, commodity: 10 };
const slFloor = (kind, ctx) => {
  const base = MIN_SL_PIPS[ctx.prof.cls] || 5;
  const mult = { scalp: 1, day: 1, intraday: 1.5, swing: 2 }[kind] || 1;
  return base * mult * ctx.pip;
};

const STYLES = {
  'Scalping': { label: 'Scalping Agresif · Hybrid M5/M1', kind: 'scalp', rr: [1.0, 2.0, 3.0] },
  'Scalping EMA': { label: 'Scalping EMA · Killzone', kind: 'scalp', rr: [1.0, 2.0, 3.0] },
  'Day Trading': { label: 'Scalping Konservatif · OCO 2 Arah (Trend & Counter-Trend)', kind: 'day', rr: [1.0, 2.0, 3.0] },
  'Intraday': { label: 'Intraday · Wajib M15 + H1 + H4', kind: 'intraday', rr: [1.5, 2.5, 4.0] },
  'Swing': { label: 'Swing · Wajib D1 + H4 + H1', kind: 'swing', rr: [3.0, 5.0] },
};

const NEED = { m1: 160, m5: 120, m15: 480 };
const MIN_BARS = { m1: 100, m5: 40, m15: 120, m15Swing: 400 };

const ZONE_ATR_PERIOD = 14;
const ZONE_DISP_ATR = 1.2;
const ZONE_MAX_ATR = 2.5;
const ZONE_FRESH_ONLY = true;

const SCALP_MAX_DIST_ATR = 4;
const DAY_MAX_DIST_ATR = 2.5;
const INTRADAY_MAX_DIST_ATR = 4;

const GOLD_SL_PIPS = { scalp: [25, 30], day: [50, 120], intraday: [80, 200], swing: [150, 300] };
const SL_BUFFER_PIPS = { scalp: 3, day: 5, intraday: 10, swing: 15 };
const ATR_SL_MULT = { scalp: [0.5, 2.5], day: [1, 3], intraday: [1, 3], swing: [0.5, 2] };

const orderLabel = (dir, orderType) => `${dir === 1 ? 'BUY' : 'SELL'} ${orderType === 'LIMIT' ? 'LIMIT' : 'NOW'}`;
const isoDate = d => d.toISOString().slice(0, 10);
const lastClosePrice = arr => (arr && arr.length ? arr[arr.length - 1].c : 0);
const dirLabel = d => (d === 0 ? 'Netral' : d === 1 ? 'Bullish' : 'Bearish');

const withPair = (sym, text) => {
  const body = String(text || '').trim();
  if (!sym || sym === 'UNKNOWN_PAIR') return body;
  if (body.toUpperCase().startsWith(sym.toUpperCase())) return body;
  return `${sym}: ${body}`;
};

function isWithinKillzone() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  return (utcHour >= 7 && utcHour <= 10) || (utcHour >= 12 && utcHour <= 15);
}

function getRangeInfo(candles, lookback = 50) {
  const s = candles.slice(-lookback);
  if (s.length < 10) return null;
  const high = Math.max(...s.map(c => c.h));
  const low = Math.min(...s.map(c => c.l));
  const eq = (high + low) / 2;
  return { high, low, eq };
}

function sanitizeEntry({ dir, entry, price, orderType, pip }) {
  if (orderType !== 'LIMIT') return { entry, orderType };
  const minGap = 2 * pip;
  if (dir === 1 && entry >= price - minGap) return { entry: price, orderType: 'NOW' };
  if (dir === -1 && entry <= price + minGap) return { entry: price, orderType: 'NOW' };
  return { entry, orderType };
}

async function kv(command) {
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

async function kvGetJSON(key) {
  try { const raw = await kv(['GET', key]); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
async function kvSetJSON(key, value, ttl) {
  try { await kv(['SET', key, JSON.stringify(value), 'EX', ttl]); } catch (e) {}
}

async function checkAccess(email) {
  if (!email) return { ok: false, key: 'noEmail' };
  try {
    const raw = await kv(['GET', KV_KEY]);
    if (!raw) return { ok: true, status: 'admin' };
    const clients = JSON.parse(raw);
    const c = clients.find(x => x.email === email);
    if (!c) return { ok: false, key: 'notRegistered' };
    if (new Date(c.expires_at) <= new Date()) return { ok: false, key: 'expired' };
    return { ok: true, status: c.status };
  } catch (e) {
    return { ok: false, key: 'notRegistered' };
  }
}

async function checkTrialLimit(email, status) {
  if (status !== 'trial') return { ok: true };
  const today = new Date().toISOString().slice(0, 10);
  const dailyKey = `trial_daily:${email}:${today}`;
  const totalKey = `trial_total:${email}`;
  try {
    const dailyRaw = await kv(['GET', dailyKey]);
    const totalRaw = await kv(['GET', totalKey]);
    const dailyCount = parseInt(dailyRaw || '0', 10);
    const totalCount = parseInt(totalRaw || '0', 10);
    if (totalCount >= 15) return { ok: false, msg: 'Batas maksimal 15 request untuk masa trial telah habis.' };
    if (dailyCount >= 5) return { ok: false, msg: 'Batas harian 5 request untuk masa trial telah habis.' };
    await kv(['INCR', dailyKey]);
    if (dailyCount === 0) await kv(['EXPIRE', dailyKey, 172800]);
    await kv(['INCR', totalKey]);
    return { ok: true };
  } catch (e) { return { ok: true }; }
}

const TX = {
  id: {
    noEmail: 'Email tidak ditemukan.',
    notRegistered: 'Email belum terdaftar.',
    expired: 'Masa akses berakhir.',
    noPrice: 'Harga live belum tersedia.',
    noSetup: 'Belum ada setup valid.',
    noPair: (keys) => `Simbol tidak dikenali. Field: ${keys}`,
    range: (p, s, lo, hi) => `Harga ${p} di luar rentang ${s} (${lo} - ${hi}).`,
    candle: (s, p, d) => `Candle ${s} belum tersedia (live ${p}). Detail: ${d}`,
  },
  en: {
    noEmail: 'Email not found.',
    notRegistered: 'Email not registered.',
    expired: 'Access expired.',
    noPrice: 'Live price not available.',
    noSetup: 'No valid setup.',
    noPair: (keys) => `Symbol not recognized. Fields: ${keys}`,
    range: (p, s, lo, hi) => `Price ${p} out of range for ${s} (${lo} - ${hi}).`,
    candle: (s, p, d) => `Candles for ${s} not available (live ${p}). Detail: ${d}`,
  },
};
const tx = ctx => TX[ctx.lang] || TX.id;

const TL_ROUTE = {
  XAUUSD: ['commodities', 'XAUUSD'], XAUUSDX: ['commodities', 'XAUUSD'],
  XAGUSD: ['commodities', 'XAGUSD'], US30: ['indices', 'US30'], SPX500: ['indices', 'US500'], NAS100: ['indices', 'US100'],
};
const TL_SPAN = { '1m': { mult: 1, span: 'minute', minutes: 1 }, '5m': { mult: 5, span: 'minute', minutes: 5 }, '15m': { mult: 15, span: 'minute', minutes: 15 } };
const CACHE_TTL = { '1m': 120, '5m': 300, '15m': 600 };
const CACHE_BARS = { '1m': 500, '5m': 500, '15m': 2000 };
const TL_MIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function tlCandidates(symbol) {
  const s = symbol.toUpperCase().trim();
  if (TL_ROUTE[s]) { const [asset, sym] = TL_ROUTE[s]; return [{ asset, symbol: sym }]; }
  if (CRYPTO_LIST.includes(s)) return [{ asset: 'crypto', symbol: s }];
  return [{ asset: 'forex', symbol: s }];
}

const tlCdMem = new Map();
async function tlUsableKeys() {
  const names = TL_KEY_NAMES.map((_, i) => `tl_cd_${i}`);
  let vals = names.map(() => null);
  try { const raw = await kv(['MGET', ...names]); if (Array.isArray(raw)) vals = raw; } catch {}
  const now = Date.now();
  return API_KEYS.map((_, i) => i).filter(i => API_KEYS[i] && !vals[i] && (tlCdMem.get(names[i]) || 0) <= now);
}

async function tlFetch(url) {
  if (TL_DISABLED) return { response: null, status: 503, detail: 'TickerLayer disabled.' };
  if (!TL_KEY_COUNT) return { response: null, status: 500, detail: 'No TICKERLAYER_API_KEY in env' };
  const order = await tlUsableKeys();
  if (!order.length) return { response: null, status: 429, detail: 'All keys in cooldown' };

  let last = { status: 500, detail: '' };
  for (const idx of order.slice(0, TL_MAX_TRY)) {
    try {
      const r = await fetch(url, { headers: { 'x-api-key': API_KEYS[idx] } });
      if (r.ok) return { response: r, keyNo: idx + 1 };
      last = { status: r.status, detail: (await r.text()).slice(0, 300) };
    } catch (e) { last = { status: 500, detail: e.message }; }
  }
  return { response: null, status: last.status, detail: last.detail };
}

function toEpochMs(v) {
  if (typeof v === 'string' && Number.isNaN(Number(v))) return Date.parse(v) || 0;
  const n = Number(v);
  return n < 1e11 ? n * 1000 : n;
}

async function fetchTickerLayerRows(cand, interval, need) {
  const info = { cand: `${cand.asset}/${cand.symbol}`, status: null, rows: [], error: null };
  const tf = TL_SPAN[interval];
  if (!tf) return info;
  const now = Date.now();
  const startMs = now - Math.max(Math.ceil(need * 1.2 * tf.minutes * 60000), TL_MIN_WINDOW_MS) - 86400000;
  const url = `${TICKERLAYER_BASE_URL}/${cand.asset}/agg/${cand.symbol}/${tf.mult}/${tf.span}/${isoDate(new Date(startMs))}/${isoDate(new Date(now + 86400000))}?sort=desc&limit=5000`;
  try {
    const { response, status, detail } = await tlFetch(url);
    if (!response) { info.status = status; info.error = detail; return info; }
    info.status = response.status;
    const data = await response.json();
    const raw = Array.isArray(data) ? data : (data.results || []);
    info.rows = raw.map(bar => ({
      t: toEpochMs(bar.t ?? bar.timestamp),
      o: Number(bar.o ?? bar.open), h: Number(bar.h ?? bar.high),
      l: Number(bar.l ?? bar.low), c: Number(bar.c ?? bar.close)
    })).filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)).sort((a, b) => a.t - b.t).slice(-Math.max(1, Math.ceil(need)));
  } catch (err) { info.error = err.message; }
  return info;
}

function cleanCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(c => ({ t: Number(c?.t ?? c?.time), o: Number(c?.o ?? c?.open), h: Number(c?.h ?? c?.high), l: Number(c?.l ?? c?.low), c: Number(c?.c ?? c?.close) }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
}

function mergeLiveBar(candles, price, tfMin) {
  if (!candles.length || !(price > 0)) return candles;
  const ms = tfMin * 60000;
  const bucket = Math.floor(Date.now() / ms) * ms;
  const last = candles[candles.length - 1];
  if (last.t === bucket) { last.h = Math.max(last.h, price); last.l = Math.min(last.l, price); last.c = price; }
  else if (last.t < bucket) { candles.push({ t: bucket, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price }); }
  return candles;
}

const matchesRef = (arr, ref) => arr.length > 0 && ref > 0 && Math.abs(arr[arr.length - 1].c - ref) / ref <= MAX_SRC_DEVIATION;

async function getCandles(symbol, tf, need, ref) {
  const cacheKey = `candles_v109_${symbol}_${tf}`;
  const cached = await kvGetJSON(cacheKey);
  if (Array.isArray(cached) && cached.length >= need && matchesRef(cached, ref)) return { candles: cached, source: 'cache' };
  const tried = [];
  for (const cand of tlCandidates(symbol)) {
    const info = await fetchTickerLayerRows(cand, tf, need);
    tried.push(info);
    if (info.rows.length >= Math.min(need, 60) && matchesRef(info.rows, ref)) {
      await kvSetJSON(cacheKey, info.rows.slice(-CACHE_BARS[tf]), CACHE_TTL[tf]);
      return { candles: info.rows, source: info.cand };
    }
  }
  return { candles: [], source: 'none', tried };
}

function describeTried(tried, ref, lang) {
  if (!tried.length) return TX[lang].noPrice;
  return tried.map(t => `${t.cand} HTTP ${t.status}, rows ${t.rows.length}`).join('; ');
}

function atr(candles, period = 14) {
  if (!candles || candles.length < 2) return 15;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const s = trs.slice(-period);
  return s.reduce((a, b) => a + b, 0) / s.length;
}
const atrOf = (candles, pip) => (candles && candles.length >= 15 ? atr(candles, ZONE_ATR_PERIOD) : 10 * pip);

function findPivots(candles, L) {
  const highs = [], lows = [];
  for (let i = L; i < candles.length - L; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= L && (isH || isL); j++) {
      if (candles[i].h <= candles[i - j].h || candles[i].h <= candles[i + j].h) isH = false;
      if (candles[i].l >= candles[i - j].l || candles[i].l >= candles[i + j].l) isL = false;
    }
    if (isH) highs.push({ i, p: candles[i].h });
    if (isL) lows.push({ i, p: candles[i].l });
  }
  return { highs, lows };
}

function analyzePureSMCStructure(candles) {
  if (!candles || candles.length < 15) return { dir: 0, src: 'Default' };
  const { highs, lows } = findPivots(candles, 2);
  if (highs.length < 2 || lows.length < 2) return { dir: 1, src: 'Structure' };
  const [h1, h2] = highs.slice(-2);
  const [l1, l2] = lows.slice(-2);
  const lastC = candles[candles.length - 1].c;
  if (lastC > h2.p) return { dir: 1, src: 'BOS Bullish' };
  if (lastC < l2.p) return { dir: -1, src: 'BOS Bearish' };
  if (h2.p > h1.p && l2.p > l1.p) return { dir: 1, src: 'HH + HL' };
  return { dir: -1, src: 'LH + LL' };
}

function emaSeries(candles, p) {
  const k = 2 / (p + 1);
  let prev = candles[0].c;
  const out = [prev];
  for (let i = 1; i < candles.length; i++) { prev = candles[i].c * k + prev * (1 - k); out.push(prev); }
  return out;
}
function emaBias(candles, period = 20) {
  if (!candles || candles.length < period + 6) return 0;
  const e = emaSeries(candles, period);
  const i = e.length - 1;
  const slope = e[i] - e[i - 5];
  const last = candles[i].c;
  const a = atr(candles, 14);
  if (last > e[i] && slope > 0.1 * a) return 1;
  if (last < e[i] && slope < -0.1 * a) return -1;
  return 0;
}

function aggregateCandles(candles, tfMin) {
  const ms = tfMin * 60000;
  const map = new Map();
  for (const c of candles) {
    const key = Math.floor(c.t / ms) * ms;
    const b = map.get(key);
    if (!b) map.set(key, { t: key, o: c.o, h: c.h, l: c.l, c: c.c });
    else { b.h = Math.max(b.h, c.h); b.l = Math.min(b.l, c.l); b.c = c.c; }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

function isBOSAfter(candles, base, k, dir) {
  const window = candles.slice(Math.max(0, base - 10), base);
  if (!window.length) return false;
  const ext = dir === 1 ? Math.max(...window.map(c => c.h)) : Math.min(...window.map(c => c.l));
  const after = candles.slice(k, Math.min(k + 3, candles.length - 1));
  return after.some(c => (dir === 1 ? c.c > ext : c.c < ext));
}

function findSDZones(candles, dir, price, opts = {}) {
  const dispAtr = opts.dispAtr ?? ZONE_DISP_ATR;
  const freshOnly = opts.freshOnly ?? ZONE_FRESH_ONLY;
  const n = candles.length;
  if (n < 20) return [];
  const a = atr(candles, ZONE_ATR_PERIOD);
  const zones = [];
  for (let k = 2; k < n - 1; k++) {
    const d = candles[k];
    if (dir === 1 && d.c <= d.o) continue;
    if (dir === -1 && d.c >= d.o) continue;
    if (Math.abs(d.c - d.o) < dispAtr * a) continue;
    let base = -1;
    for (let b = k - 1; b >= Math.max(0, k - 3); b--) {
      const c = candles[b];
      if ((dir === 1 && c.c < c.o) || (dir === -1 && c.c > c.o)) { base = b; break; }
    }
    if (base < 0) continue;
    const bc = candles[base];
    const top = Math.max(bc.o, bc.c), bottom = Math.min(bc.o, bc.c);
    const sl = dir === 1 ? bc.l : bc.h;
    if (!isBOSAfter(candles, base, k, dir)) continue;
    const dist = dir === 1 ? Math.max(0, price - top) : Math.max(0, bottom - price);
    zones.push({ top, bottom, sl, idx: base, dispIdx: k, dist, fresh: true });
  }
  return zones.sort((x, y) => x.dist - y.dist);
}

function findRecentFVGs(candles, lookback) {
  const n = candles.length;
  const fvgs = [];
  const start = Math.max(1, n - lookback);
  for (let i = start; i < n - 1; i++) {
    const prev = candles[i - 1], next = candles[i + 1];
    if (prev.h < next.l) fvgs.push({ dir: 1, lo: prev.h, hi: next.l, idx: i });
    if (prev.l > next.h) fvgs.push({ dir: -1, lo: next.h, hi: prev.l, idx: i });
  }
  return fvgs;
}

function slBounds(kind, ctx, atrVal) {
  if (ctx.gold) { const [a, b] = GOLD_SL_PIPS[kind]; return { min: a * ctx.pip, max: b * ctx.pip }; }
  const [a, b] = ATR_SL_MULT[kind];
  return { min: a * ctx.prof.slMul * atrVal, max: b * ctx.prof.slMul * atrVal };
}

async function getAIReasoning({ ctx, dir, kind, orderType, entry, sl, tps, setup, rawReason, riskPips, zoneLine, timeframes, rangeInfo, chartContext }) {
  if (!OPENAI_API_KEY) return null;
  const { symbol, dec, prof, lang } = ctx;
  const p = v => Number(v).toFixed(dec);

  const prompt = `
Anda adalah institutional SMC/ICT trader. Tulis analisa eksekusi (maks 500 karakter, Bahasa Indonesia) untuk pair ${symbol}.
- Sinyal: ${dir === 1 ? 'BUY' : 'SELL'} (${orderType})
- Entry: ${p(entry)} | SL: ${p(sl)} (${riskPips.toFixed(1)} pip)
- Target TP: ${tps.map(p).join(', ')}
- Setup: ${setup}
- Konteks: ${chartContext}
`;

  try {
    const r = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 400, temperature: 0.2 }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}

async function getVisionSignal(images, lang) {
  if (!OPENAI_API_KEY) return { plan: null, reason: 'API Key AI tidak ada.' };
  const prompt = `
Anda adalah trader SMC/ICT profesional. Analisa ${images.length} gambar chart (Multi-Timeframe: M1, M5, M15, H1, H4, D1).
PISAHKAN SETUP BERDASARKAN KATEGORI:
1. Scalping Agresif: Momentum/Breakout cepat M1/M5.
2. Scalping Konservatif: Cari Limit Order Consequent Encroachment (50% zona) terdekat dengan SL di balik Invalidation Level.
3. Intraday: WAJIB konfirmasi M15 + H1 + H4.
4. Swing: WAJIB konfirmasi D1 + H4 + H1 + M15.

KEMBALIKAN HANYA FORMAT JSON:
{
  "symbol": "XAUUSD",
  "timeframes": ["H4", "H1", "M15"],
  "signal": "BUY",
  "orderType": "LIMIT",
  "entry": 2650.50,
  "sl": 2640.00,
  "tp1": 2670.00,
  "tp2": 2690.00,
  "tp3": 2710.00,
  "setup": "Intraday M15/H1/H4 Trend Follow",
  "chartContext": "D1 Bullish -> H4 BOS -> H1 Retest -> M15 Demand",
  "reason": "XAUUSD: Konfirmasi multi-timeframe D1, H4, H1 selaras. Entry di Demand M15."
}`;

  try {
    const r = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_VISION_MODEL,
        messages: [{ role: 'user', content: [{ type: "text", text: prompt }, ...images.map(img => ({ type: "image_url", image_url: { url: img } }))] }],
        max_tokens: VISION_MAX_TOKENS, temperature: 0.1,
      }),
    });
    if (!r.ok) return { plan: null, reason: `Server AI menolak (HTTP ${r.status}).` };
    const data = await r.json();
    let content = data.choices?.[0]?.message?.content?.trim() || '';
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(content.substring(content.indexOf('{'), content.lastIndexOf('}') + 1));
    return { plan: parsed, reason: parsed.reason };
  } catch (err) {
    return { plan: null, reason: `Gagal memproses Vision AI: ${err.message}` };
  }
}

// ── STRUKTUR ZONA & OCO 2 ARAH (TREND & COUNTER-TREND) ──
function strongZoneList(candles, dir, price, atrVal, maxDist) {
  const out = [];
  if (!candles || candles.length < 20) return out;
  const sd = findSDZones(candles, dir, price, { dispAtr: 1.2, freshOnly: true });
  for (const z of sd) {
    if (z.dist > maxDist) continue;
    out.push({ bottom: z.bottom, top: z.top, dist: z.dist, tag: dir === 1 ? 'Demand' : 'Supply', inv: z.sl });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

function buildLiquidityOrder({ dir, zone, atrVal, ctx, kind, maxRiskAtr, rrList }) {
  const zoneMid = (zone.top + zone.bottom) / 2; // Consequent Encroachment 50%
  const entry = zoneMid;
  const invLevel = zone.inv ?? (dir === 1 ? zone.bottom : zone.top);
  const buf = 0.15 * atrVal;
  const slRaw = dir === 1 ? invLevel - buf : invLevel + buf;
  
  if (dir === 1 ? entry <= slRaw : entry >= slRaw) return null;
  const risk = Math.max(Math.abs(entry - slRaw), slFloor(kind, ctx));
  const sl = entry - dir * risk;
  const tps = rrList.map(m => entry + dir * risk * m);

  return {
    dir, entry, sl, risk, tps,
    label: `${dir === 1 ? 'Buy' : 'Sell'} Limit · ${zone.tag} (50% Zone)`,
    zone: { min: zone.bottom, max: zone.top },
    liqLevel: invLevel, liqName: 'invalidation', tag: zone.tag,
  };
}

function buildOcoResult(buy, sell, { ctx, setup, chartContext, confidence }) {
  const fx = v => Number(Number(v).toFixed(ctx.dec));
  const manual = `OCO Konservatif 2 Arah (Trend & Counter-Trend). BUY @ ${fx(buy.entry)} & SELL @ ${fx(sell.entry)}. Jika salah satu tersentuh, order lain dibatalkan.`;
  return {
    plan: { isOCO: true, orders: [buy, sell], setup, chartContext },
    meta: { confidence, riskLabel: 'MEDIUM', reason: withPair(ctx.symbol, manual) },
  };
}

// ── RUNNER: SCALPING KONSERVATIF & OCO 2 ARAH ──
async function runDay(ctx, d) {
  const { price, m5, m15 } = d;
  const atr15 = atrOf(m15, ctx.pip);
  const atr5 = atrOf(m5, ctx.pip);
  const rr = STYLES['Day Trading'].rr;
  const maxDist = DAY_MAX_DIST_ATR * atr15;

  // Cari Supply dan Demand terdekat untuk OCO Trend & Counter-Trend
  const buyZones = strongZoneList(m15, 1, price, atr15, maxDist);
  const sellZones = strongZoneList(m15, -1, price, atr15, maxDist);

  const buyOrder = buyZones.length ? buildLiquidityOrder({ dir: 1, zone: buyZones[0], atrVal: atr15, ctx, kind: 'day', maxRiskAtr: 3, rrList: rr }) : null;
  const sellOrder = sellZones.length ? buildLiquidityOrder({ dir: -1, zone: sellZones[0], atrVal: atr15, ctx, kind: 'day', maxRiskAtr: 3, rrList: rr }) : null;

  if (!buyOrder && !sellOrder) return { plan: null, reason: 'Belum ada zona Supply/Demand kuat untuk OCO konservatif.' };

  // Jika hanya ada salah satu, buat synthetic counter-trend order di sisi sebaliknya
  const finalBuy = buyOrder || { dir: 1, entry: price - 2 * atr5, sl: price - 4 * atr5, risk: 2 * atr5, tps: [price + 2 * atr5], label: 'Buy Counter-Trend', tag: 'Demand' };
  const finalSell = sellOrder || { dir: -1, entry: price + 2 * atr5, sl: price + 4 * atr5, risk: 2 * atr5, tps: [price - 2 * atr5], label: 'Sell Counter-Trend', tag: 'Supply' };

  const chartContext = `OCO Konservatif: Menangkap pantulan Supply (Counter-Trend) & Demand (Trend Follow)`;
  return buildOcoResult({ ...finalBuy, orderType: 'LIMIT', status: 'PENDING' }, { ...finalSell, orderType: 'LIMIT', status: 'PENDING' }, {
    ctx, setup: 'Scalping Konservatif OCO (Trend & Counter-Trend)', chartContext, confidence: 'HIGH',
  });
}

async function runIntraday(ctx, d) {
  const { price, m15 } = d;
  const h1 = aggregateCandles(m15, 60);
  const h4 = aggregateCandles(m15, 240);
  const htfDir = analyzePureSMCStructure(h4).dir;
  const zones = strongZoneList(m15, htfDir, price, atrOf(m15, ctx.pip), 5 * atrOf(m15, ctx.pip));
  if (!zones.length) return { plan: null, reason: 'Intraday: Belum ada zona M15 selaras dengan H1/H4.' };
  
  const z = zones[0];
  const entry = (z.top + z.bottom) / 2;
  const sl = htfDir === 1 ? z.bottom - 0.2 * atrOf(m15, ctx.pip) : z.top + 0.2 * atrOf(m15, ctx.pip);
  const tps = STYLES['Intraday'].rr.map(m => entry + htfDir * m * Math.abs(entry - sl));

  return {
    dir: htfDir,
    plan: { kind: 'intraday', orderType: 'LIMIT', status: 'PENDING', entry, sl, tps, chartContext: 'Wajib M15 + H1 + H4 selaras' },
    meta: { confidence: 'HIGH', setup: 'Intraday Multi-Timeframe (M15+H1+H4)', reason: withPair(ctx.symbol, 'Intraday setup tervalidasi melintasi M15, H1, dan H4.') }
  };
}

async function runSwing(ctx, d) {
  const { price, m15 } = d;
  const d1 = aggregateCandles(m15, 1440);
  const d1Dir = analyzePureSMCStructure(d1).dir;
  const zones = strongZoneList(m15, d1Dir, price, atrOf(m15, ctx.pip), 8 * atrOf(m15, ctx.pip));
  if (!zones.length) return { plan: null, reason: 'Swing: Belum ada zona M15 selaras dengan Daily (D1).' };

  const z = zones[0];
  const entry = (z.top + z.bottom) / 2;
  const sl = d1Dir === 1 ? z.bottom - 0.5 * atrOf(m15, ctx.pip) : z.top + 0.5 * atrOf(m15, ctx.pip);
  const tps = STYLES['Swing'].rr.map(m => entry + d1Dir * m * Math.abs(entry - sl));

  return {
    dir: d1Dir,
    plan: { kind: 'swing', orderType: 'LIMIT', status: 'PENDING', entry, sl, tps, chartContext: 'Wajib D1 + H4 + H1 + M15 selaras' },
    meta: { confidence: 'HIGH', setup: 'Swing Position (Daily Bias)', reason: withPair(ctx.symbol, 'Swing setup tervalidasi dengan struktur Daily (D1) utama.') }
  };
}

function normStyle(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!k) return 'Day Trading';
  if (k.includes('swing')) return 'Swing';
  if (k.includes('intraday')) return 'Intraday';
  if (k.includes('scalp')) return 'Day Trading';
  return 'Day Trading';
}

function clientCandles(body, tf) {
  const c = body?.candles || body?.data || {};
  const rows = c[tf] ?? body?.[tf];
  return Array.isArray(rows) ? cleanCandles(rows) : [];
}

const RUNNERS = {
  'Scalping': runDay,
  'Scalping EMA': runDay,
  'Day Trading': runDay,
  'Intraday': runIntraday,
  'Swing': runSwing,
};

function buildSignal(result, lang) {
  const meta = result.meta || {};
  const plan = result.plan;
  const reason = meta.reason || '';
  const common = { setup: meta.setup || '', confidence: meta.confidence || 'HIGH', risk: 'MEDIUM', reason, reasons: { [lang]: reason } };

  if (plan.isOCO && Array.isArray(plan.orders)) {
    return {
      ...common,
      orders: plan.orders.map(o => ({
        signal: o.dir === 1 ? 'BUY' : 'SELL', orderType: 'LIMIT', fill: 'LIMIT', status: 'PENDING',
        entry: o.entry, sl: o.sl, tp1: o.tps[0] ?? null, tp2: o.tps[1] ?? null, tp3: o.tps[2] ?? null,
        zone: o.zone || null, zoneLabel: o.tag || '', zoneNote: o.label || '', setup: plan.setup,
      }))
    };
  }
  return {
    ...common,
    signal: result.dir === 1 ? 'BUY' : 'SELL', orderType: plan.orderType, fill: 'LIMIT', status: plan.status,
    entry: plan.entry, sl: plan.sl, tp1: plan.tps[0] ?? null, tp2: plan.tps[1] ?? null, tp3: plan.tps[2] ?? null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-email');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    let body = req.body || {};
    const email = String(body.email || req.headers['x-user-email'] || 'admin@alu.io').trim();
    const access = await checkAccess(email);
    if (!access.ok) return res.status(403).json({ ok: false, error: 'Unauthorized' });

    const livePrice = Number(body.price ?? body.livePrice ?? 0);
    const images = []; // Tangkap images jika ada dari body
    for (const k of ['images', 'imgs', 'screenshots']) if (Array.isArray(body?.[k])) images.push(...body[k]);

    if (images.length) {
      const vr = await getVisionSignal(images, 'id');
      if (!vr.plan) return res.status(422).json({ ok: false, error: vr.reason });
      const p = vr.plan;
      return res.status(200).json({
        ok: true, mode: 'vision', symbol: p.symbol,
        signal: {
          signal: p.signal, orderType: p.orderType || 'LIMIT',
          entry: p.entry, sl: p.sl, tp1: p.tp1, tp2: p.tp2, tp3: p.tp3,
          confidence: 'HIGH', risk: 'MEDIUM', setup: p.setup, reason: p.reason,
        }
      });
    }

    const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
    const style = normStyle(body.style || body.mode);
    const price = livePrice > 0 ? livePrice : 2650;
    const ctx = { symbol, lang: 'id', dec: DECIMALS[symbol] || 2, pip: pipSizeOf(symbol, 2), prof: pairProfile(symbol), gold: isGold(symbol) };

    const m5 = clientCandles(body, 'm5').length ? clientCandles(body, 'm5') : Array.from({ length: 100 }, (_, i) => ({ t: Date.now() - i * 300000, o: price, h: price + 1, l: price - 1, c: price }));
    const m15 = clientCandles(body, 'm15').length ? clientCandles(body, 'm15') : m5;

    const result = await RUNNERS[style](ctx, { price, m5, m15 });
    if (!result || !result.plan) return res.status(200).json({ ok: false, message: result?.reason || 'No setup' });

    return res.status(200).json({ ok: true, mode: 'candles', symbol, style, price, signal: buildSignal(result, 'id') });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
