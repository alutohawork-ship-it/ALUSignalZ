// api/generate.js
// v121 — Top-down SMC/ICT + SMA20. Style-aware. Bot dipaksa SMA20.

export const config = { maxDuration: 60 };

const KV_KEY = 'alu_clients';
const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

// ── AI (vision) ──
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/$/, '');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || 'claude-sonnet-5.5';
const VISION_TIMEOUT_MS = 50000;
const VISION_MAX_TOKENS = 900;

// ── TICKERLAYER ──
const TL_KEY_NAMES = ['TICKERLAYER_API_KEY', ...Array.from({ length: 19 }, (_, i) => `TICKERLAYER_API_KEY_${i + 1}`)];
const API_KEYS = TL_KEY_NAMES.map(n => process.env[n] || '');
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

const pairProfile = symbol => ({ cls: pairClassOf(symbol), ...PAIR_CLASS_PROFILE[pairClassOf(symbol)] });

const PIP_OVERRIDE = { XAUUSD: 0.1, DXY: 0.01, US30: 1, NAS100: 1, BTCUSD: 1 };
const pipSizeOf = (symbol, dec) => PIP_OVERRIDE[symbol] ?? Math.pow(10, -(dec - 1));

const MIN_SL_PIPS = { fx: 5, fx_jpy: 5, gold: 25, silver: 8, metal: 8, crypto: 20, index: 10, commodity: 10 };
const slFloor = (kind, ctx) => {
  const base = MIN_SL_PIPS[ctx.prof.cls] || 5;
  const mult = { scalp: 1, scalp_cons: 1, day: 1, intraday: 1.5, swing: 2, bot: 1 }[kind] || 1;
  return base * mult * ctx.pip;
};

const STYLES = {
  'Scalping':      { label: 'Scalping Agresif · SMA20 + M1/M5/M15/M30', kind: 'scalp',       rr: [1, 2, 3], tfs: ['m30', 'm15', 'm5', 'm1'] },
  'Scalping EMA':  { label: 'Scalping Agresif · SMA20 + M1/M5/M15/M30', kind: 'scalp',       rr: [1, 2, 3], tfs: ['m30', 'm15', 'm5', 'm1'] },
  'Day Trading':   { label: 'Scalping Konservatif · H1/M15/M5',         kind: 'scalp_cons',  rr: [1, 2, 3], tfs: ['h1', 'm15', 'm5'] },
  'Intraday':      { label: 'Intraday · H4/H1/M15/M5',                  kind: 'intraday',    rr: [1, 2, 3], tfs: ['h4', 'h1', 'm15', 'm5'] },
  'Swing':         { label: 'Swing · D1/H4/H1/M15',                     kind: 'swing',       rr: [1, 2, 3], tfs: ['d1', 'h4', 'h1', 'm15'] },
};

const MIN_BARS = { m1: 100, m5: 40, m15: 60, m30: 40, h1: 40, h4: 30, d1: 20 };
const ZONE_ATR_PERIOD = 14;
const ZONE_DISP_ATR = 1.2;
const ZONE_FRESH_ONLY = true;
const MAX_DIST_ATR = { scalp: 3.0, scalp_cons: 4.0, day: 4.0, intraday: 6, swing: 10, bot: 2.0 };
const GOLD_SL_PIPS = { scalp: [25, 60], scalp_cons: [40, 120], day: [50, 120], intraday: [80, 200], swing: [150, 300], bot: [25, 80] };
const ATR_SL_MULT = { scalp: [0.8, 3], scalp_cons: [1, 3], day: [1, 3], intraday: [1, 3.5], swing: [1, 4], bot: [0.8, 2.5] };

// TickerLayer timeframe map (espansi multi-TF)
const TL_SPAN = {
  '1m':  { mult: 1,  span: 'minute', minutes: 1    },
  '5m':  { mult: 5,  span: 'minute', minutes: 5    },
  '15m': { mult: 15, span: 'minute', minutes: 15   },
  '30m': { mult: 30, span: 'minute', minutes: 30   },
  '1h':  { mult: 1,  span: 'hour',   minutes: 60   },
  '4h':  { mult: 4,  span: 'hour',   minutes: 240  },
  '1d':  { mult: 1,  span: 'day',    minutes: 1440 },
};
const TL_MIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TL_ROUTE = {
  XAUUSD: ['commodities', 'XAUUSD'], XAUUSDX: ['commodities', 'XAUUSD'],
  XAGUSD: ['commodities', 'XAGUSD'], US30: ['indices', 'US30'], SPX500: ['indices', 'US500'], NAS100: ['indices', 'US100'],
};

const msg = (lang, key) => ((MSG[lang] || MSG.id)[key] || key);
const MSG = {
  id: {
    noEmail: 'Email tidak ditemukan. Login ulang.',
    notRegistered: 'Email belum terdaftar.',
    expired: 'Masa akses berakhir.',
    kvError: 'Layanan akses sedang bermasalah. Coba lagi sebentar.',
    trialLimit: 'Batas trial habis: akun trial hanya 1x signal bot.',
    noPrice: 'Harga live belum tersedia. Tunggu stream XBTFX aktif.',
    noCandles: 'Data candle belum tersedia. Tunggu beberapa detik lalu coba lagi.',
    noSetup: 'Belum ada setup valid.',
    noKey: 'OPENAI_API_KEY belum diatur di Vercel.',
    badImage: 'Gambar tidak valid. Gunakan JPG atau PNG.',
  },
  en: {
    noEmail: 'Email not found. Please log in again.',
    notRegistered: 'Email not registered.',
    expired: 'Access expired.',
    kvError: 'Access service is having issues. Please try again shortly.',
    trialLimit: 'Trial limit reached: trial accounts are limited to 1 bot signal.',
    noPrice: 'Live price not available. Wait for the XBTFX stream.',
    noCandles: 'Candle data not available yet. Wait a few seconds and try again.',
    noSetup: 'No valid setup yet.',
    noKey: 'OPENAI_API_KEY is not set in Vercel.',
    badImage: 'Invalid image. Please use JPG or PNG.',
  },
};

const isoDate = d => d.toISOString().slice(0, 10);
const withPair = (sym, text) => {
  const body = String(text || '').trim();
  if (!sym || sym === 'UNKNOWN_PAIR') return body;
  if (body.toUpperCase().startsWith(sym.toUpperCase())) return body;
  return `${sym}: ${body}`;
};

function fail(res, reason, status = 200) {
  return res.status(status).json({ ok: false, reason, message: reason, msg: reason, error: reason });
}

async function httpJson(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, data, text };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timeout: layanan eksternal terlalu lama merespons');
    throw e;
  } finally { clearTimeout(timer); }
}

// ── KV ──
const kvEnabled = () => !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

async function kvCmd(command) {
  const r = await httpJson(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  }, 5000);
  if (!r.ok || !r.data || r.data.error) throw new Error((r.data && r.data.error) || `KV HTTP ${r.status}`);
  return r.data.result;
}

async function checkAccess(email, isAutoBot) {
  if (!email) return { ok: false, key: 'noEmail' };
  if (!kvEnabled()) return { ok: true, status: 'dev' };

  let raw;
  try { raw = await kvCmd(['GET', KV_KEY]); }
  catch (e) { console.error('KV access error:', e.message); return { ok: false, key: 'kvError' }; }
  if (!raw) return { ok: false, key: 'notRegistered' };

  let clients;
  try { clients = JSON.parse(raw); } catch { return { ok: false, key: 'kvError' }; }
  const c = clients.find(x => String(x.email || '').toLowerCase() === email);
  if (!c) return { ok: false, key: 'notRegistered' };
  if (new Date(c.expires_at) <= new Date()) return { ok: false, key: 'expired' };
  if (c.status === 'trial' && isAutoBot && c.trialBotUsed) return { ok: false, key: 'trialLimit' };
  return { ok: true, status: c.status };
}

async function markTrialAsUsed(email) {
  try {
    const raw = await kvCmd(['GET', KV_KEY]);
    if (!raw) return;
    const clients = JSON.parse(raw);
    const idx = clients.findIndex(x => String(x.email || '').toLowerCase() === email);
    if (idx !== -1 && clients[idx].status === 'trial') {
      clients[idx].trialBotUsed = true;
      await kvCmd(['SET', KV_KEY, JSON.stringify(clients)]);
    }
  } catch (e) { console.error('markTrialAsUsed:', e.message); }
}

// ── TICKERLAYER ──
const tlCooldown = new Map();

async function tlGet(url) {
  if (TL_DISABLED) return null;
  const now = Date.now();
  const usable = API_KEYS
    .map((_, i) => i)
    .filter(i => API_KEYS[i] && (tlCooldown.get(i) || 0) <= now)
    .slice(0, TL_MAX_TRY);

  for (const i of usable) {
    try {
      const r = await httpJson(url, { headers: { 'x-api-key': API_KEYS[i] } }, 8000);
      if (r.status === 429) { tlCooldown.set(i, Date.now() + 60000); continue; }
      if (r.ok && r.data) return r.data;
    } catch (e) { console.warn(`TL key ${i}:`, e.message); }
  }
  return null;
}

function tlCandidate(symbol) {
  const s = symbol.toUpperCase().trim();
  if (TL_ROUTE[s]) { const [asset, sym] = TL_ROUTE[s]; return { asset, symbol: sym }; }
  if (CRYPTO_LIST.includes(s)) return { asset: 'crypto', symbol: s };
  return { asset: 'forex', symbol: s };
}

function toEpochMs(v) {
  if (typeof v === 'string' && Number.isNaN(Number(v))) return Date.parse(v) || 0;
  const n = Number(v);
  return n < 1e11 ? n * 1000 : n;
}

async function fetchTickerLayerRows(symbol, interval, need) {
  const tf = TL_SPAN[interval];
  if (!tf) return [];
  const cand = tlCandidate(symbol);
  const now = Date.now();
  const windowMs = Math.max(need * 1.2 * tf.minutes * 60000, TL_MIN_WINDOW_MS) + 86400000;
  const startMs = now - windowMs;
  const url = `${TICKERLAYER_BASE_URL}/${cand.asset}/agg/${cand.symbol}/${tf.mult}/${tf.span}/${isoDate(new Date(startMs))}/${isoDate(new Date(now + 86400000))}?sort=desc&limit=5000`;

  const data = await tlGet(url);
  if (!data) return [];
  const raw = Array.isArray(data) ? data : (data.results || []);
  const rows = raw.map(bar => ({
    t: toEpochMs(bar.t ?? bar.timestamp),
    o: bar.o ?? bar.open, h: bar.h ?? bar.high, l: bar.l ?? bar.low, c: bar.c ?? bar.close,
  }));
  return cleanCandles(rows).slice(-Math.max(1, Math.ceil(need)));
}

// ── CANDLE & INDIKATOR ──
function cleanCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(c => ({
      t: Number(c?.t ?? c?.time), o: Number(c?.o ?? c?.open), h: Number(c?.h ?? c?.high),
      l: Number(c?.l ?? c?.low), c: Number(c?.c ?? c?.close),
    }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite))
    .sort((a, b) => a.t - b.t);
}

function clientCandles(body, tf) {
  const c = body?.candles || {};
  const rows = c[tf] ?? body?.[tf];
  return Array.isArray(rows) ? cleanCandles(rows) : [];
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

// SMA 20
function smaLast(values, period = 20) {
  if (!values || values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

// ── Struktur & Zona ──
function findSwings(c, L = 2) {
  const highs = [], lows = [];
  for (let i = L; i < c.length - L; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= L; j++) {
      if (!(c[i].h > c[i - j].h && c[i].h >= c[i + j].h)) isH = false;
      if (!(c[i].l < c[i - j].l && c[i].l <= c[i + j].l)) isL = false;
    }
    if (isH) highs.push({ i, p: c[i].h });
    if (isL) lows.push({ i, p: c[i].l });
  }
  return { highs, lows };
}

function readStructure(c, price) {
  if (!c || c.length < 20) return null;
  const { highs, lows } = findSwings(c, 2);
  if (highs.length < 2 || lows.length < 2) return null;
  const h1 = highs[highs.length - 1], h0 = highs[highs.length - 2];
  const l1 = lows[lows.length - 1], l0 = lows[lows.length - 2];

  if (price > h1.p) return { dir: 1, src: 'BOS naik', bos: true, h1, l1 };
  if (price < l1.p) return { dir: -1, src: 'BOS turun', bos: true, h1, l1 };
  if (h1.p > h0.p && l1.p > l0.p) return { dir: 1, src: 'HH-HL', bos: false, h1, l1 };
  if (h1.p < h0.p && l1.p < l0.p) return { dir: -1, src: 'LH-LL', bos: false, h1, l1 };
  return null;
}

function findSDZones(candles, dir, price) {
  const n = candles.length;
  if (n < 20) return [];
  const a = atr(candles, ZONE_ATR_PERIOD);
  const zones = [];
  for (let k = 2; k < n - 1; k++) {
    const d = candles[k];
    if (dir === 1 && d.c <= d.o) continue;
    if (dir === -1 && d.c >= d.o) continue;
    if (Math.abs(d.c - d.o) < ZONE_DISP_ATR * a) continue;

    let base = -1;
    for (let b = k - 1; b >= Math.max(0, k - 3); b--) {
      const c = candles[b];
      if ((dir === 1 && c.c < c.o) || (dir === -1 && c.c > c.o)) { base = b; break; }
    }
    if (base < 0) continue;

    const bc = candles[base];
    const top = Math.max(bc.o, bc.c), bottom = Math.min(bc.o, bc.c);
    const sl = dir === 1 ? bc.l : bc.h;

    let broken = false;
    if (ZONE_FRESH_ONLY) {
      for (let j = k + 1; j < n; j++) {
        if (dir === 1 && candles[j].l < bottom) { broken = true; break; }
        if (dir === -1 && candles[j].h > top) { broken = true; break; }
      }
    }
    if (broken) continue;

    const dist = dir === 1 ? Math.max(0, price - top) : Math.max(0, bottom - price);
    zones.push({ top, bottom, sl, dist, fresh: true, dir });
  }
  return zones.sort((x, y) => x.dist - y.dist);
}

// ── SMC / ICT Detection ──
// Sweep likuiditas (BSL/SSL): wick break swing lalu close balik
function detectSweep(candles, lookback = 20) {
  if (!candles || candles.length < lookback + 3) return null;
  const n = candles.length;
  const last = candles[n - 1];
  const { highs, lows } = findSwings(candles.slice(0, n - 1), 2);
  const recentH = highs.slice(-3);
  const recentL = lows.slice(-3);

  for (const h of recentH) {
    if (last.h > h.p && last.c < h.p) return { type: 'BSL', level: h.p, dir: -1, idx: h.i };
  }
  for (const l of recentL) {
    if (last.l < l.p && last.c > l.p) return { type: 'SSL', level: l.p, dir: 1, idx: l.i };
  }
  return null;
}

// Displacement: candle body besar searah, minimal 1.2× ATR
function lastDisplacement(candles, atrVal, lookback = 3) {
  if (!candles) return null;
  const n = candles.length;
  for (let i = n - 1; i >= Math.max(0, n - lookback); i--) {
    const c = candles[i];
    const body = Math.abs(c.c - c.o);
    if (body < 1.2 * atrVal) continue;
    return { dir: c.c > c.o ? 1 : -1, idx: i, body };
  }
  return null;
}

// CISD: displacement tembus body candle lawan terakhir
function detectCISD(candles, atrVal) {
  const n = candles.length;
  if (n < 5) return null;
  const disp = lastDisplacement(candles, atrVal, 5);
  if (!disp) return null;

  for (let i = disp.idx - 1; i >= Math.max(0, disp.idx - 5); i--) {
    const c = candles[i];
    if (disp.dir === 1 && c.c < c.o) {
      const broke = candles.slice(disp.idx).some(x => x.c > c.h);
      if (broke) return { dir: 1, level: c.h, dispIdx: disp.idx };
    }
    if (disp.dir === -1 && c.c > c.o) {
      const broke = candles.slice(disp.idx).some(x => x.c < c.l);
      if (broke) return { dir: -1, level: c.l, dispIdx: disp.idx };
    }
  }
  return null;
}

// Reversal setup: sweep + CISD + displacement searah
function detectReversalSetup(candles, atrVal) {
  const sweep = detectSweep(candles);
  if (!sweep) return null;
  const cisd = detectCISD(candles, atrVal);
  if (!cisd || cisd.dir !== sweep.dir) return null;
  const disp = lastDisplacement(candles, atrVal, 2);
  if (!disp || disp.dir !== sweep.dir) return null;
  return {
    dir: sweep.dir,
    sweepLevel: sweep.level,
    cisdLevel: cisd.level,
    sweepType: sweep.type,
    note: `Reversal ${sweep.type} sweep @ ${sweep.level} + CISD + Displacement ${sweep.dir === 1 ? 'bullish' : 'bearish'}`,
  };
}

// Top-down multi-TF bias
function multiTfBias(tfCandles) {
  const weights = { d1: 4, h4: 3, h1: 2.5, m30: 2, m15: 1.5, m5: 1, m1: 0.5 };
  let score = 0, total = 0;
  const details = {};
  for (const [tf, w] of Object.entries(weights)) {
    const c = tfCandles[tf];
    if (!c || c.length < 20) continue;
    const price = c[c.length - 1].c;
    const st = readStructure(c, price);
    if (!st) continue;
    details[tf] = { dir: st.dir, src: st.src, bos: st.bos };
    score += st.dir * w;
    total += w;
  }
  if (!total) return { dir: 0, bias: 'NEUTRAL', score: 0, details };
  const norm = score / total;
  return {
    dir: norm > 0.2 ? 1 : norm < -0.2 ? -1 : 0,
    bias: norm > 0.2 ? 'BULLISH' : norm < -0.2 ? 'BEARISH' : 'NEUTRAL',
    score: Number(norm.toFixed(2)),
    details,
  };
}

function emaLast(values, period) {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 1; i < values.length; i++) prev = values[i] * k + prev * (1 - k);
  return prev;
}

function clampRisk(risk, kind, ctx, atrVal) {
  let min = slFloor(kind, ctx);
  let max;
  if (ctx.gold && GOLD_SL_PIPS[kind]) {
    min = Math.max(min, GOLD_SL_PIPS[kind][0] * ctx.pip);
    max = GOLD_SL_PIPS[kind][1] * ctx.pip;
  } else {
    const m = ATR_SL_MULT[kind] || [1, 3];
    min = Math.max(min, m[0] * atrVal);
    max = m[1] * atrVal;
  }
  if (max < min) max = min;
  return Math.min(Math.max(risk, min), max);
}

// ── Order Builders ──
function buildStrictOrder({ dir, zone, atrVal, ctx, kind, rrList, price }) {
  let entry = (zone.top + zone.bottom) / 2;
  let shifted = false;

  if (dir === 1 && entry >= price) { entry = price - 1.0 * atrVal; shifted = true; }
  if (dir === -1 && entry <= price) { entry = price + 1.0 * atrVal; shifted = true; }

  const invLevel = shifted ? entry : (zone.sl ?? (dir === 1 ? zone.bottom : zone.top));
  const buf = 0.2 * atrVal;
  const rawSl = dir === 1 ? invLevel - buf : invLevel + buf;
  const risk = clampRisk(Math.abs(entry - rawSl), kind, ctx, atrVal);

  const finalSl = entry - dir * risk;
  const tps = rrList.map(m => entry + dir * risk * m);
  const zoneOut = shifted
    ? { min: entry - 0.2 * atrVal, max: entry + 0.2 * atrVal }
    : { min: zone.bottom, max: zone.top };

  return {
    dir, entry, sl: finalSl, risk, tps,
    label: `${dir === 1 ? 'Buy' : 'Sell'} Limit · ${dir === 1 ? 'Demand' : 'Supply'}`,
    zone: zoneOut,
    tag: dir === 1 ? 'Demand' : 'Supply',
  };
}

function buildMarketOrder({ dir, entry, invLevel, atrVal, ctx, kind, rrList }) {
  const rawSl = dir === 1 ? invLevel - 0.2 * atrVal : invLevel + 0.2 * atrVal;
  const risk = clampRisk(Math.abs(entry - rawSl), kind, ctx, atrVal);
  const sl = entry - dir * risk;
  const tps = rrList.map(m => entry + dir * risk * m);
  return { dir, entry, sl, risk, tps };
}

// ── Runners ──

// 1) Scalping Agresif: SMA20 + struktur M30/M15/M5/M1
async function runAggressiveScalp(ctx, d) {
  const { price, m1, m5, m15, m30 } = d;
  const base = m5.length >= 40 ? m5 : m15;
  if (!base || base.length < 30) return { reason: 'Data M5/M15 belum cukup untuk scalping agresif.' };

  const atr5 = atrOf(base, ctx.pip);
  const closes = base.map(c => c.c);
  const sma20 = smaLast(closes, 20);
  if (!sma20) return { reason: 'SMA20 belum tersedia.' };

  // Reversal prioritas
  const reversal = detectReversalSetup(base, atr5);

  // Top-down bias untuk konfirmasi
  const bias = multiTfBias({ m30, m15, m5, m1 });

  let dir, entry, mode, invLevel, why;
  const dist = Math.abs(price - sma20);

  if (reversal) {
    dir = reversal.dir;
    mode = 'MARKET';
    entry = price;
    invLevel = reversal.sweepLevel;
    why = reversal.note;
  } else {
    const st = readStructure(base, price);
    if (!st) return { reason: withPair(ctx.symbol, 'Scalping Agresif: struktur belum jelas. Tunggu BOS/CHoCH.') };

    // Wajib selaras dengan bias multi-TF jika ada
    if (bias.dir !== 0 && st.dir !== bias.dir) {
      return { reason: withPair(ctx.symbol, `Scalping Agresif: struktur ${st.dir === 1 ? 'bull' : 'bear'} M5 tidak selaras bias HTF (${bias.bias}). Tunggu.`) };
    }
    const smaAligned = (st.dir === 1 && price > sma20) || (st.dir === -1 && price < sma20);
    if (!smaAligned && !st.bos) {
      return { reason: withPair(ctx.symbol, `Scalping Agresif: harga ${price > sma20 ? 'di atas' : 'di bawah'} SMA20 tapi struktur ${st.dir === 1 ? 'bullish' : 'bearish'} — belum selaras. Tunggu.`) };
    }

    dir = st.dir;
    const origin = dir === 1 ? st.l1.p : st.h1.p;

    if (dist <= 0.5 * atr5) {
      // Dekat SMA20 → MARKET sekarang
      mode = 'MARKET';
      entry = price;
      invLevel = dir === 1 ? Math.min(origin, sma20 - 0.5 * atr5) : Math.max(origin, sma20 + 0.5 * atr5);
      why = `Harga ${ctx.f(price)} dekat SMA20 (${ctx.f(sma20)}), struktur ${st.src}. MARKET entry.`;
    } else {
      // Jauh dari SMA20 → LIMIT di jalur SMA20 + struktur
      const limEntry = sma20 + dir * 0.2 * atr5;
      if ((dir === 1 && limEntry >= price) || (dir === -1 && limEntry <= price)) {
        return { reason: withPair(ctx.symbol, 'Scalping Agresif: harga belum pullback ke SMA20, tunggu.') };
      }
      mode = 'LIMIT';
      entry = limEntry;
      invLevel = dir === 1 ? Math.min(origin, sma20 - 0.6 * atr5) : Math.max(origin, sma20 + 0.6 * atr5);
      why = `Harga ${ctx.f(price)} jauh dari SMA20 (${ctx.f(sma20)}). LIMIT di jalur SMA20 + struktur ${st.src}.`;
    }
  }

  const order = buildMarketOrder({ dir, entry, invLevel, atrVal: atr5, ctx, kind: 'scalp', rrList: STYLES['Scalping'].rr });
  const side = dir === 1 ? 'BUY' : 'SELL';
  const setup = 'Scalping Agresif · SMA20 + Top-Down';
  const orderTxt = mode === 'MARKET' ? `${side} NOW` : `${side} LIMIT`;

  const topDownSummary = `Bias HTF: ${bias.bias} (score ${bias.score}). SMA20 M5: ${ctx.f(sma20)}.`;

  return {
    dir,
    plan: {
      isOCO: false, orderType: mode, status: mode === 'MARKET' ? 'RUNNING' : 'PENDING',
      entry: order.entry, sl: order.sl, tps: order.tps, setup,
      chartContext: `${setup}: ${orderTxt} ${ctx.f(order.entry)} (SL ${ctx.f(order.sl)}). Live ${ctx.f(price)}`,
      zone: null, tag: dir === 1 ? 'Demand' : 'Supply',
    },
    meta: {
      setup, confidence: 'HIGH', riskLabel: 'HIGH',
      reason: withPair(ctx.symbol, `${orderTxt} @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])}, TP2 ${ctx.f(order.tps[1])}, TP3 ${ctx.f(order.tps[2])}. ${why} ${topDownSummary}`),
      topDown: bias,
      sma20,
    },
  };
}

// 2) Scalping Konservatif / Intraday / Swing: top-down limit zona
async function runTopDownLimit(ctx, d, styleName) {
  const cfg = STYLES[styleName];
  const kind = cfg.kind;
  const rr = cfg.rr;
  const { price } = d;

  // Kumpulkan TF sesuai style
  const tfMap = {};
  for (const tf of cfg.tfs) if (d[tf] && d[tf].length) tfMap[tf] = d[tf];

  const bias = multiTfBias(tfMap);

  // Entry TF = TF terakhir yang tersedia (terendah)
  const entryTF = cfg.tfs[cfg.tfs.length - 1];
  const zoneRows = d[entryTF] || d.m15 || d.m5;
  if (!zoneRows || zoneRows.length < 30) return { reason: `Data ${entryTF.toUpperCase()} belum cukup untuk ${cfg.label}.` };

  const atrVal = atrOf(zoneRows, ctx.pip);
  const maxDist = (MAX_DIST_ATR[kind] || 4) * atrVal;

  const demand = findSDZones(zoneRows, 1, price)
    .filter(z => z.top < price && (price - (z.top + z.bottom) / 2) <= maxDist);
  const supply = findSDZones(zoneRows, -1, price)
    .filter(z => z.bottom > price && ((z.top + z.bottom) / 2 - price) <= maxDist);

  const base = { atrVal, ctx, kind, rrList: rr, price };

  // Pilih sisi sesuai bias HTF (kalau bias jelas, hanya zona searah)
  let buy = demand.length ? buildStrictOrder({ dir: 1, zone: demand[0], ...base }) : null;
  let sell = supply.length ? buildStrictOrder({ dir: -1, zone: supply[0], ...base }) : null;

  if (bias.dir === 1 && buy) sell = null;
  if (bias.dir === -1 && sell) buy = null;

  const setup = cfg.label;

  if (!buy && !sell) {
    // Fallback: continuation mengikuti arah market dengan pantulan terdekat
    const st = readStructure(zoneRows, price);
    if (st) {
      const sma = smaLast(zoneRows.map(c => c.c), 20) || price;
      const dir = st.dir;
      const origin = dir === 1 ? st.l1.p : st.h1.p;
      const nearLevel = dir === 1 ? Math.max(origin, sma) : Math.min(origin, sma);
      const entry = nearLevel + dir * 0.1 * atrVal;

      if ((dir === 1 && entry < price) || (dir === -1 && entry > price)) {
        const cont = buildMarketOrder({ dir, entry, invLevel: origin, atrVal, ctx, kind, rrList: rr });
        const side = dir === 1 ? 'BUY' : 'SELL';
        const contSetup = `${setup} · Continuation`;
        const reason = withPair(ctx.symbol, `${side} LIMIT @ ${ctx.f(cont.entry)} (SL ${ctx.f(cont.sl)}). Tidak ada zona S/D fresh — pakai continuation mengikuti struktur ${st.src} dengan pantulan terdekat di ${ctx.f(nearLevel)}. Bias HTF: ${bias.bias}.`);
        return {
          dir,
          plan: {
            isOCO: false, orderType: 'LIMIT', status: 'PENDING',
            entry: cont.entry, sl: cont.sl, tps: cont.tps, setup: contSetup,
            chartContext: `${contSetup}: ${side} Limit ${ctx.f(cont.entry)} (SL ${ctx.f(cont.sl)}). Live ${ctx.f(price)}`,
            zone: null, tag: dir === 1 ? 'Demand' : 'Supply',
          },
          meta: { setup: contSetup, confidence: 'MEDIUM', riskLabel: 'MEDIUM', reason, topDown: bias },
        };
      }
    }
    return { reason: withPair(ctx.symbol, `${setup}: tidak ada zona fresh & tidak ada continuation valid. Tunggu setup baru.`) };
  }

  const leg = o => ({ ...o, orderType: 'LIMIT', status: 'PENDING' });

  if (buy && sell) {
    const chartContext = `${setup}: Buy Limit ${ctx.f(buy.entry)} & Sell Limit ${ctx.f(sell.entry)}. Bias ${bias.bias}.`;
    const reason = withPair(ctx.symbol, `${setup}. BUY LIMIT @ ${ctx.f(buy.entry)} (SL ${ctx.f(buy.sl)}) & SELL LIMIT @ ${ctx.f(sell.entry)} (SL ${ctx.f(sell.sl)}). Bias HTF: ${bias.bias}.`);
    return {
      plan: { isOCO: true, orders: [leg(buy), leg(sell)], setup, chartContext },
      meta: { setup, confidence: 'HIGH', riskLabel: 'MEDIUM', reason, topDown: bias },
    };
  }

  const o = leg(buy || sell);
  const side = o.dir === 1 ? 'BUY' : 'SELL';
  const oneSetup = `${setup} · 1 Zona Fresh`;
  const chartContext = `${oneSetup}: ${side} Limit ${ctx.f(o.entry)} (SL ${ctx.f(o.sl)}). Bias ${bias.bias}.`;
  const reason = withPair(ctx.symbol, `${oneSetup}. ${side} LIMIT @ ${ctx.f(o.entry)}, SL ${ctx.f(o.sl)}, TP1 ${ctx.f(o.tps[0])}, TP2 ${ctx.f(o.tps[1])}, TP3 ${ctx.f(o.tps[2])}. Bias HTF: ${bias.bias} (score ${bias.score}).`);

  return {
    dir: o.dir,
    plan: {
      isOCO: false, orderType: 'LIMIT', status: 'PENDING',
      entry: o.entry, sl: o.sl, tps: o.tps, setup: oneSetup, chartContext,
      zone: o.zone, tag: o.tag,
    },
    meta: { setup: oneSetup, confidence: 'HIGH', riskLabel: 'MEDIUM', reason, topDown: bias },
  };
}

// 3) Bot: SMA20 M1 continuation + reversal
async function runBotSma20(ctx, d) {
  const { price, m1, m5 } = d;
  const candles = (m1 && m1.length >= 30) ? m1 : m5;
  if (!candles || candles.length < 30) return { reason: 'Data M1 belum cukup untuk bot SMA20.' };

  const atrVal = atrOf(candles, ctx.pip);
  const closes = candles.map(c => c.c);
  const sma20 = smaLast(closes, 20);
  if (!sma20) return { reason: 'Bot SMA20: SMA20 belum tersedia.' };

  const last = candles[candles.length - 1];
  const reversal = detectReversalSetup(candles, atrVal);
  const st = readStructure(candles, price);
  const rrList = [1, 2]; // Bot: 1:1 & 1:2

  let dir, mode, entry, invLevel, why;

  if (reversal) {
    // Reversal prioritas untuk bot
    dir = reversal.dir;
    mode = 'MARKET';
    entry = price;
    invLevel = reversal.sweepLevel;
    why = reversal.note;
  } else if (st) {
    dir = st.dir;
    const smaAligned = (dir === 1 && price > sma20) || (dir === -1 && price < sma20);
    if (!smaAligned) {
      return { reason: `Bot SMA20: harga ${price > sma20 ? 'di atas' : 'di bawah'} SMA20 (${ctx.f(sma20)}) tidak searah struktur ${st.dir === 1 ? 'bullish' : 'bearish'}. Tunggu konfirmasi.` };
    }
    const dist = Math.abs(price - sma20);
    if (dist <= 0.3 * atrVal) {
      mode = 'MARKET';
      entry = price;
      invLevel = dir === 1 ? Math.min(last.l, sma20 - 0.5 * atrVal) : Math.max(last.h, sma20 + 0.5 * atrVal);
      why = `Harga ${ctx.f(price)} dekat SMA20 (${ctx.f(sma20)}), struktur ${st.src}. MARKET continuation.`;
    } else {
      const limEntry = sma20 + dir * 0.2 * atrVal;
      if ((dir === 1 && limEntry >= price) || (dir === -1 && limEntry <= price)) {
        return { reason: `Bot SMA20: harga belum pullback ke SMA20 (${ctx.f(sma20)}). Tunggu.` };
      }
      mode = 'LIMIT';
      entry = limEntry;
      invLevel = dir === 1 ? sma20 - 0.6 * atrVal : sma20 + 0.6 * atrVal;
      why = `Harga ${ctx.f(price)} jauh dari SMA20 (${ctx.f(sma20)}). LIMIT pullback continuation.`;
    }
  } else {
    return { reason: 'Bot SMA20: struktur M1 belum jelas. Tunggu BOS.' };
  }

  const order = buildMarketOrder({ dir, entry, invLevel, atrVal, ctx, kind: 'bot', rrList });
  const side = dir === 1 ? 'BUY' : 'SELL';
  const setup = 'Bot · SMA20 M1 Continuation';
  const orderTxt = mode === 'MARKET' ? `${side} NOW` : `${side} LIMIT`;
  const reason = withPair(ctx.symbol, `${orderTxt} @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])} (RR 1:1), TP2 ${ctx.f(order.tps[1])} (RR 1:2). ${why}`);

  return {
    dir,
    plan: {
      isOCO: false, orderType: mode, status: mode === 'MARKET' ? 'RUNNING' : 'PENDING',
      entry: order.entry, sl: order.sl, tps: order.tps, setup,
      chartContext: `${setup}: ${orderTxt} ${ctx.f(order.entry)} (SL ${ctx.f(order.sl)}, TP1/TP2 RR 1:1 & 1:2). Live ${ctx.f(price)}`,
      zone: null, tag: dir === 1 ? 'Demand' : 'Supply',
    },
    meta: { setup, confidence: 'HIGH', riskLabel: 'HIGH', reason, sma20 },
  };
}

const RUNNERS = {
  'Scalping': runAggressiveScalp,
  'Scalping EMA': runAggressiveScalp,
  'Day Trading': (ctx, d) => runTopDownLimit(ctx, d, 'Day Trading'),
  'Intraday': (ctx, d) => runTopDownLimit(ctx, d, 'Intraday'),
  'Swing': (ctx, d) => runTopDownLimit(ctx, d, 'Swing'),
};

function normStyle(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (k.includes('swing')) return 'Swing';
  if (k.includes('intraday') || k.includes('daytrade')) return k.includes('intraday') ? 'Intraday' : 'Day Trading';
  if (k.includes('konserv') || k.includes('conserv') || k.includes('daytrading')) return 'Day Trading';
  if (k.includes('scalp')) return 'Scalping';
  return 'Day Trading';
}

// ── Signal Formatter ──
function buildSignal(result, lang) {
  const meta = result.meta || {};
  const plan = result.plan;
  const reason = meta.reason || '';
  const common = {
    setup: meta.setup || plan.setup || '',
    confidence: meta.confidence || 'MEDIUM',
    risk: meta.riskLabel || 'MEDIUM',
    reason,
    reasons: { [lang]: reason },
    chartContext: plan.chartContext || '',
    topDown: meta.topDown || null,
    sma20: meta.sma20 ?? null,
  };

  if (plan.isOCO) {
    return {
      ...common,
      orders: plan.orders.map(o => ({
        signal: o.dir === 1 ? 'BUY' : 'SELL',
        orderType: 'LIMIT', fill: 'LIMIT', status: 'PENDING',
        entry: o.entry, sl: o.sl,
        tp1: o.tps[0] ?? null, tp2: o.tps[1] ?? null, tp3: o.tps[2] ?? null,
        zone: o.zone || null, zoneLabel: o.tag || '', zoneNote: o.label || '', setup: plan.setup,
      })),
    };
  }

  const isMarket = plan.orderType === 'MARKET';
  return {
    ...common,
    signal: result.dir === 1 ? 'BUY' : 'SELL',
    orderType: plan.orderType,
    fill: isMarket ? 'NOW' : 'LIMIT',
    status: plan.status,
    entry: plan.entry, sl: plan.sl,
    tp1: plan.tps[0] ?? null, tp2: plan.tps[1] ?? null, tp3: plan.tps[2] ?? null,
    zone: plan.zone || null, zoneLabel: plan.tag || '', zoneNote: '',
  };
}

function pickSingleForBot(result, price) {
  if (result.plan.isOCO) {
    const o = result.plan.orders.reduce((a, b) =>
      (Math.abs(b.entry - price) < Math.abs(a.entry - price) ? b : a));
    return {
      dir: o.dir,
      plan: {
        isOCO: false, orderType: 'LIMIT', status: 'PENDING',
        entry: o.entry, sl: o.sl, tps: o.tps, setup: `${result.meta.setup} · Bot`,
        chartContext: `Bot memilih zona terdekat: ${o.dir === 1 ? 'BUY' : 'SELL'} Limit ${o.entry}. Live ${price}`,
        zone: o.zone, tag: o.tag,
      },
      meta: result.meta,
    };
  }
  return result;
}

// ── VISION (AI) ──
const VISION_BASE = `Kamu adalah analis trading profesional dengan spesialisasi Smart Money Concept (SMC) dan ICT.
Tugasmu menganalisis screenshot chart yang dikirim user dan mengembalikan setup valid sesuai style yang diminta.
Prinsip WAJIB:
- Analisis TOP-DOWN: baca bias dari timeframe tertinggi ke terendah, baru cari entry di timeframe rendah.
- Kenali struktur: BOS (Break of Structure), CHoCH (Change of Character), HH-HL, LH-LL.
- Kenali POI: Order Block, FVG, Supply/Demand zone, Liquidity sweep (BSL/SSL), CISD (Change in State of Delivery), Displacement, Rejection Block.
- SL wajib logis (di balik swing terakhir / level invalidasi zona).
- RR sehat: minimal 1:1, ideal 1:2 atau 1:3.
- Jangan mengarang level yang tidak terlihat di chart.

Balas HANYA JSON valid, tanpa markdown dan tanpa teks lain:
{"signal":"BUY|SELL|NONE","orderType":"MARKET|LIMIT","entry":0,"sl":0,"tp1":0,"tp2":0,"tp3":0,"setup":"","confidence":"HIGH|MEDIUM|LOW","risk":"LOW|MEDIUM|HIGH","reason":"","topDown":"bias & TF yg dipakai","zone":"zona yg dipakai"}`;

function buildVisionSystem(style) {
  const map = {
    'Scalping': `STYLE: SCALPING AGRESIF.
Timeframe acuan: M1 (trigger) + M5 + M15 + M30 + SMA20.
Aturan:
- Gunakan SMA20 sebagai magnet/pullback.
- Jika harga dekat SMA20 dan struktur searah → MARKET entry.
- Jika harga jauh dari SMA20 → LIMIT di jalur SMA20 + zona struktur terdekat.
- Boleh entry kapan saja (tidak perlu killzone).
- RR fleksibel (1:1, 1:2, 1:3) sesuai struktur; jangan mengarang profit.
- Jika ada reversal valid (sweep BSL/SSL + CISD + Displacement) → beri entry reversal.`,
    'Day Trading': `STYLE: SCALPING KONSERVATIF.
Timeframe acuan: M5 (entry) + M15 + H1 (bias HTF).
Aturan:
- WAJIB cari zona Buy/Sell TERKUAT dari top-down (H1 → M15 → M5).
- Entry WAJIB LIMIT ORDER di zona pantulan/rejection.
- Jika tidak ada zona fresh → cari continuation sesuai arah market dengan pantulan terdekat (SMA20 / OB / FVG).
- RR ideal 1:2 atau 1:3.
- Reversal hanya bila sweep + CISD + Displacement jelas → entry LIMIT di OB/FVG hasil displacement.`,
    'Intraday': `STYLE: INTRADAY.
Timeframe acuan: M15 (entry) + H1 + H4 (bias HTF).
WAJIB melampirkan M15 + H1 + H4.
Aturan:
- Baca bias H4 → konfirmasi H1, entry di POI M15.
- Entry LIMIT searah bias HTF.
- RR ideal 1:2 atau 1:3.
- Reversal hanya di zona premium/discount HTF dengan sweep + CISD.`,
    'Swing': `STYLE: SWING.
Timeframe acuan: H1 (entry) + H4 + D1 (bias HTF).
WAJIB melampirkan H1 + H4 + D1.
Aturan:
- Bias dari D1 → H4.
- Entry LIMIT di zona premium/discount HTF atau OB H1/H4.
- RR ideal 1:2 atau 1:3 (boleh lebih).
- Reversal hanya bila sweep HTF (BSL/SSL) + CHoCH jelas di H4/D1.`,
  };
  return `${VISION_BASE}\n\n${map[style] || map['Day Trading']}`;
}

function extractContent(data) {
  const c = data?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => p?.text || '').join('');
  return '';
}

function parseJsonLoose(text) {
  const s = String(text || '').replace(/```json|```/gi, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

function checkVisionSignal(j) {
  if (!j || typeof j !== 'object') return 'Respons AI tidak bisa dibaca. Coba analisa ulang.';
  const sig = String(j.signal || 'NONE').toUpperCase();
  if (sig === 'NONE') return String(j.reason || 'Tidak ada setup valid pada gambar.');
  if (sig !== 'BUY' && sig !== 'SELL') return 'Sinyal dari AI tidak dikenali.';
  const e = Number(j.entry), s = Number(j.sl), t1 = Number(j.tp1);
  if (![e, s, t1].every(Number.isFinite)) return 'Entry, SL, atau TP1 dari AI tidak lengkap.';
  const okOrder = sig === 'BUY' ? (s < e && e < t1) : (s > e && e > t1);
  return okOrder ? null : 'Level entry/SL/TP dari AI tidak konsisten dengan arah sinyal.';
}

function buildVisionSignal(j, style, lang) {
  const sig = String(j.signal).toUpperCase();
  const isLimit = String(j.orderType || '').toUpperCase() === 'LIMIT';
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  const level = (v, allowed, dflt) => (allowed.includes(String(v || '').toUpperCase()) ? String(v).toUpperCase() : dflt);
  const reason = String(j.reason || '').trim()
    || (lang === 'en' ? 'AI analysis of the uploaded chart.' : 'Analisis AI dari screenshot chart.');
  return {
    signal: sig,
    orderType: isLimit ? 'LIMIT' : 'MARKET',
    fill: isLimit ? 'LIMIT' : 'NOW',
    status: isLimit ? 'PENDING' : 'RUNNING',
    entry: Number(j.entry), sl: Number(j.sl),
    tp1: num(j.tp1), tp2: num(j.tp2), tp3: num(j.tp3),
    setup: String(j.setup || `Vision ${style} Setup`),
    confidence: level(j.confidence, ['HIGH', 'MEDIUM', 'LOW'], 'MEDIUM'),
    risk: level(j.risk, ['LOW', 'MEDIUM', 'HIGH'], 'MEDIUM'),
    reason, reasons: { [lang]: reason },
    chartContext: '',
    zone: j.zone ? { label: String(j.zone) } : null, zoneLabel: '', zoneNote: '',
    topDown: j.topDown ? String(j.topDown) : null,
    source: 'VISION_AI',
  };
}

async function runVisionAnalysis(images, style, lang) {
  if (!OPENAI_API_KEY) return { ok: false, reason: msg(lang, 'noKey') };
  const imgs = images.filter(s => typeof s === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(s));
  if (!imgs.length) return { ok: false, reason: msg(lang, 'badImage') };

  const langName = lang === 'en' ? 'English' : 'Indonesian';
  const userContent = [
    { type: 'text', text: `Style trading: ${style}. Tulis field reason dalam bahasa ${langName}. Analisa murni dari gambar yang diupload.` },
    ...imgs.map(url => ({ type: 'image_url', image_url: { url } })),
  ];

  const r = await httpJson(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: AI_VISION_MODEL,
      max_tokens: VISION_MAX_TOKENS,
      temperature: 0.2,
      messages: [
        { role: 'system', content: buildVisionSystem(style) },
        { role: 'user', content: userContent },
      ],
    }),
  }, VISION_TIMEOUT_MS);

  if (!r.ok) {
    const detail = r.data?.error?.message || (typeof r.data?.error === 'string' ? r.data.error : '') || r.text.slice(0, 160);
    return { ok: false, reason: `AI gagal (HTTP ${r.status}): ${detail}` };
  }

  const parsed = parseJsonLoose(extractContent(r.data));
  const bad = checkVisionSignal(parsed);
  if (bad) return { ok: false, reason: bad };
  return { ok: true, signal: buildVisionSignal(parsed, style, lang) };
}

// ── Handler ──
async function handleVision(body, lang, res) {
  const images = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
  const style = normStyle(body.style || body.mode);
  const out = await runVisionAnalysis(images, style, lang);
  if (!out.ok) return fail(res, out.reason);
  return res.status(200).json({ ok: true, mode: 'vision', symbol: 'VISION', style, signal: out.signal });
}

async function handleCandles(body, lang, res, { email, isAutoBot }) {
  const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
  const styleName = isAutoBot ? 'Scalping' : normStyle(body.style || body.mode); // bot pakai runner SMA20 di bawah
  const price = Number(body.price ?? body.livePrice ?? body.currentPrice ?? 0);
  if (!(price > 0)) return fail(res, msg(lang, 'noPrice'));

  const dec = DECIMALS[symbol] ?? 2;
  const ctx = {
    symbol, lang, dec,
    pip: pipSizeOf(symbol, dec),
    prof: pairProfile(symbol),
    gold: isGold(symbol),
    f: v => Number(Number(v).toFixed(dec)),
  };

  // Kumpulkan TF dari client
  const tfsWanted = isAutoBot
    ? ['m1', 'm5']
    : (STYLES[styleName]?.tfs || ['m15', 'm5']);

  const candleMap = {};
  for (const tf of tfsWanted) candleMap[tf] = clientCandles(body, tf);
  // Fallback: pastikan minimal M5 & M15 terisi
  for (const tf of ['m5', 'm15']) if (!candleMap[tf]?.length) candleMap[tf] = clientCandles(body, tf);

  const anyOk = Object.values(candleMap).some(a => a.length >= MIN_BARS.m5);
  if (!anyOk) {
    // Coba fallback TickerLayer untuk TF yang dibutuhkan
    try {
      for (const tf of tfsWanted) {
        const iv = { m1: '1m', m5: '5m', m15: '15m', m30: '30m', h1: '1h', h4: '4h', d1: '1d' }[tf];
        if (!iv) continue;
        if (candleMap[tf] && candleMap[tf].length >= (MIN_BARS[tf] || 30)) continue;
        const need = tf === 'd1' ? 60 : tf === 'h4' ? 80 : tf === 'h1' ? 100 : tf === 'm30' ? 100 : 200;
        const rows = await fetchTickerLayerRows(symbol, iv, need);
        if (rows.length) candleMap[tf] = rows;
      }
    } catch (e) { console.warn('fallback TL:', e.message); }
  }

  // Fallback silang
  const m5f = candleMap.m5?.length ? candleMap.m5 : candleMap.m15;
  const m15f = candleMap.m15?.length ? candleMap.m15 : candleMap.m5;
  if (!m5f || !m15f) return fail(res, msg(lang, 'noCandles'));

  if (isAutoBot) await markTrialAsUsed(email);

  const data = {
    price,
    m1: candleMap.m1 || [],
    m5: m5f,
    m15: m15f,
    m30: candleMap.m30 || m15f,
    h1: candleMap.h1 || m15f,
    h4: candleMap.h4 || candleMap.h1 || m15f,
    d1: candleMap.d1 || candleMap.h4 || m15f,
  };

  let result;
  if (isAutoBot) {
    result = await runBotSma20(ctx, data);
  } else {
    result = await RUNNERS[styleName](ctx, data);
  }
  if (!result || !result.plan) return fail(res, result?.reason || msg(lang, 'noSetup'));

  const final = isAutoBot ? pickSingleForBot(result, price) : result;

  return res.status(200).json({
    ok: true, mode: 'candles', symbol, style: styleName, price,
    signal: buildSignal(final, lang),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-email');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);

  try {
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return fail(res, 'Body request tidak valid (JSON).'); }
    }

    const lang = body.lang === 'en' ? 'en' : 'id';
    const email = String(body.email || body.value || '').trim().toLowerCase();
    const isAutoBot = !!(body.auto || body.bot || body.mode === 'bot' || body.source === 'bot');
    const isVision = body.symbol === 'VISION' || (Array.isArray(body.images) && body.images.length > 0);

    const access = await checkAccess(email, isAutoBot);
    if (!access.ok) return fail(res, msg(lang, access.key));

    if (isVision) return handleVision(body, lang, res);
    return handleCandles(body, lang, res, { email, isAutoBot });
  } catch (err) {
    console.error('Fatal API Error:', err);
    if (!res.headersSent) return fail(res, `Server error: ${err.message || 'tidak diketahui'}`, 500);
  }
}
