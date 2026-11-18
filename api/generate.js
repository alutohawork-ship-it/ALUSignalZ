// api/generate.js
// v126 — Top-Down SMC/ICT + Scalper Bot M1 (Pure Scalping Running Structure & Dual-Language Reasoning + Strict SOP)

export const config = { maxDuration: 60 };

const KV_KEY = 'alu_clients';
const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

// ── AI (VISION) ──
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/$/, '');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || 'gpt-6-luna';
const VISION_TIMEOUT_MS = 55000;

// ── AI REASONING MANUAL (QWEN) ──
const QWEN_BASE_URL = (process.env.QWEN_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/$/, '');
const QWEN_KEYS = [process.env.QWEN_API_KEY, process.env.QWEN_API_KEY_2, process.env.OPENAI_API_KEY].filter(Boolean);
const QWEN_MODELS = [process.env.QWEN_MODEL || 'qwen-3.8-max', process.env.QWEN_MODEL_2].filter(Boolean);
const QWEN_TIMEOUT_MS = 15000;
const QWEN_MAX_TOKENS = 700;
const VISION_MAX_TOKENS = 2600;

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
  gold:      { label: 'Emas',      slMul: 1.0, bufAtr: 0.22 },
  silver:    { label: 'Perak',     slMul: 1.1, bufAtr: 0.25 },
  metal:     { label: 'Logam',     slMul: 1.1, bufAtr: 0.25 },
  fx:        { label: 'Forex',     slMul: 1.0, bufAtr: 0.20 },
  fx_jpy:    { label: 'Forex JPY', slMul: 1.0, bufAtr: 0.20 },
  index:     { label: 'Indeks',    slMul: 1.1, bufAtr: 0.25 },
  commodity: { label: 'Komoditas', slMul: 1.2, bufAtr: 0.25 },
  crypto:    { label: 'Kripto',    slMul: 1.3, bufAtr: 0.30 },
};

const pairProfile = symbol => ({ cls: pairClassOf(symbol), ...PAIR_CLASS_PROFILE[pairClassOf(symbol)] });

const PIP_OVERRIDE = { XAUUSD: 0.1, XAUUSDX: 0.1, DXY: 0.01, US30: 1, NAS100: 1, BTCUSD: 1 };
const pipSizeOf = (symbol, dec) => PIP_OVERRIDE[symbol] ?? Math.pow(10, -(dec - 1));

const MIN_SL_PIPS = { fx: 5, fx_jpy: 5, gold: 25, silver: 8, metal: 8, crypto: 20, index: 10, commodity: 10 };
const slFloor = (kind, ctx) => {
  const base = MIN_SL_PIPS[ctx.prof.cls] || 5;
  const mult = { scalp: 1, scalp_cons: 1.1, intraday: 1.5, swing: 2.2, bot: 1 }[kind] || 1;
  return base * mult * ctx.pip;
};

const STYLES = {
  'Scalping':     { label: 'Scalping Agresif · M30+M15+M5+M1 + SMA20', kind: 'scalp',      rr: [1, 2, 3], tfs: ['m30', 'm15', 'm5', 'm1'] },
  'Scalping EMA': { label: 'Scalping Agresif · M30+M15+M5+M1 + SMA20', kind: 'scalp',      rr: [1, 2, 3], tfs: ['m30', 'm15', 'm5', 'm1'] },
  'Day Trading':  { label: 'Scalping Konservatif · H1+M15+M5',         kind: 'scalp_cons', rr: [1, 2, 3], tfs: ['h1', 'm15', 'm5'] },
  'Intraday':     { label: 'Intraday · H4+H1+M15+M5',                  kind: 'intraday',   rr: [1, 2, 3], tfs: ['h4', 'h1', 'm15', 'm5'] },
  'Swing':        { label: 'Swing · Daily+H4+H1+M15',                  kind: 'swing',      rr: [1, 2, 3], tfs: ['d1', 'h4', 'h1', 'm15'] },
};

const MIN_BARS = { m1: 60, m5: 40, m15: 40, m30: 35, h1: 35, h4: 25, d1: 20 };
const ZONE_ATR_PERIOD = 14;
const ZONE_DISP_ATR = 1.15;
const MAX_DIST_ATR = { scalp: 3.5, scalp_cons: 4.5, intraday: 6.5, swing: 11.0, bot: 2.5 };
const GOLD_SL_PIPS = { scalp: [25, 65], scalp_cons: [35, 110], intraday: [70, 190], swing: [140, 320], bot: [25, 75] };
const ATR_SL_MULT = { scalp: [0.9, 2.8], scalp_cons: [1.0, 3.0], intraday: [1.1, 3.5], swing: [1.2, 4.0], bot: [0.9, 2.4] };

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
    noSetup: 'Belum ada setup valid sesuai SOP.',
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
    noSetup: 'No valid setup meeting SOP yet.',
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

function smaLast(values, period = 20) {
  if (!values || values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

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

  if (price > h1.p) return { dir: 1, src: 'BOS Bullish', bos: true, h1, l1, h0, l0 };
  if (price < l1.p) return { dir: -1, src: 'BOS Bearish', bos: true, h1, l1, h0, l0 };
  if (h1.p > h0.p && l1.p > l0.p) return { dir: 1, src: 'HH-HL Uptrend', bos: false, h1, l1, h0, l0 };
  if (h1.p < h0.p && l1.p < l0.p) return { dir: -1, src: 'LH-LL Downtrend', bos: false, h1, l1, h0, l0 };
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
    for (let j = k + 1; j < n; j++) {
      if (dir === 1 && candles[j].l < bottom) { broken = true; break; }
      if (dir === -1 && candles[j].h > top) { broken = true; break; }
    }
    if (broken) continue;

    const dist = dir === 1 ? Math.max(0, price - top) : Math.max(0, bottom - price);
    zones.push({ top, bottom, sl, dist, fresh: true, dir, kind: dir === 1 ? 'Demand/OB' : 'Supply/OB' });
  }
  return zones.sort((x, y) => x.dist - y.dist);
}

function findFVGs(candles, dir, price) {
  const n = candles.length;
  if (n < 10) return [];
  const fvgs = [];
  for (let i = 1; i < n - 1; i++) {
    const prev = candles[i - 1], next = candles[i + 1];
    if (dir === 1 && prev.h < next.l) {
      const bottom = prev.h, top = next.l;
      const mitigated = candles.slice(i + 2).some(x => x.l <= bottom);
      if (!mitigated && top < price) {
        fvgs.push({ top, bottom, sl: prev.l, dist: price - top, dir: 1, kind: 'Bullish FVG' });
      }
    }
    if (dir === -1 && prev.l > next.h) {
      const top = prev.l, bottom = next.h;
      const mitigated = candles.slice(i + 2).some(x => x.h >= top);
      if (!mitigated && bottom > price) {
        fvgs.push({ top, bottom, sl: prev.h, dist: bottom - price, dir: -1, kind: 'Bearish FVG' });
      }
    }
  }
  return fvgs.sort((x, y) => x.dist - y.dist);
}

function hasRejectionBlock(candles, dir) {
  if (!candles || candles.length < 3) return null;
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - 3); i--) {
    const c = candles[i];
    const body = Math.abs(c.c - c.o);
    const range = c.h - c.l;
    if (range <= 0) continue;
    const lowerWick = Math.min(c.o, c.c) - c.l;
    const upperWick = c.h - Math.max(c.o, c.c);
    if (dir === 1 && lowerWick >= 1.5 * Math.max(body, range * 0.35)) {
      return { dir: 1, level: c.l, candleIdx: i };
    }
    if (dir === -1 && upperWick >= 1.5 * Math.max(body, range * 0.35)) {
      return { dir: -1, level: c.h, candleIdx: i };
    }
  }
  return null;
}

function detectSweep(candles, lookback = 25) {
  if (!candles || candles.length < lookback + 3) return null;
  const n = candles.length;
  const { highs, lows } = findSwings(candles.slice(0, n - 1), 2);
  const recentH = highs.slice(-4);
  const recentL = lows.slice(-4);

  for (let k = n - 1; k >= Math.max(0, n - 3); k--) {
    const c = candles[k];
    for (const h of recentH) {
      if (c.h > h.p && c.c < h.p) return { type: 'BSL', level: h.p, sweepExtreme: c.h, dir: -1, idx: k };
    }
    for (const l of recentL) {
      if (c.l < l.p && c.c > l.p) return { type: 'SSL', level: l.p, sweepExtreme: c.l, dir: 1, idx: k };
    }
  }
  return null;
}

function lastDisplacement(candles, atrVal, lookback = 4) {
  if (!candles) return null;
  const n = candles.length;
  for (let i = n - 1; i >= Math.max(0, n - lookback); i--) {
    const c = candles[i];
    const body = Math.abs(c.c - c.o);
    if (body < 1.2 * atrVal) continue;
    return { dir: c.c > c.o ? 1 : -1, idx: i, body, open: c.o, close: c.c };
  }
  return null;
}

function detectCISD(candles, atrVal) {
  const n = candles.length;
  if (n < 6) return null;
  const disp = lastDisplacement(candles, atrVal, 5);
  if (!disp) return null;

  for (let i = disp.idx - 1; i >= Math.max(0, disp.idx - 6); i--) {
    const c = candles[i];
    if (disp.dir === 1 && c.c < c.o) {
      const broke = candles.slice(disp.idx).some(x => x.c > Math.max(c.o, c.h));
      if (broke) return { dir: 1, level: Math.max(c.o, c.h), obLow: c.l, obHigh: c.o, dispIdx: disp.idx };
    }
    if (disp.dir === -1 && c.c > c.o) {
      const broke = candles.slice(disp.idx).some(x => x.c < Math.min(c.o, c.l));
      if (broke) return { dir: -1, level: Math.min(c.o, c.l), obHigh: c.h, obLow: c.o, dispIdx: disp.idx };
    }
  }
  return null;
}

function detectReversalSetup(candles, atrVal, price) {
  const sweep = detectSweep(candles);
  if (!sweep) return null;
  const dir = sweep.dir;

  const sdZones = findSDZones(candles.slice(0, -2), dir, sweep.sweepExtreme);
  const nearSD = sdZones.find(z => Math.abs((z.top + z.bottom) / 2 - sweep.sweepExtreme) <= 2.5 * atrVal);

  const rej = hasRejectionBlock(candles, dir);
  const cisd = detectCISD(candles, atrVal);
  if (!cisd || cisd.dir !== dir) return null;

  const disp = lastDisplacement(candles, atrVal, 3);
  if (!disp || disp.dir !== dir) return null;

  if (!rej && !nearSD) return null;

  const limitEntry = dir === 1
    ? Math.min(price - 0.1 * atrVal, (cisd.obHigh + cisd.obLow) / 2)
    : Math.max(price + 0.1 * atrVal, (cisd.obHigh + cisd.obLow) / 2);

  return {
    dir,
    sweepLevel: sweep.sweepExtreme,
    cisdLevel: cisd.level,
    sweepType: sweep.type,
    hasRejection: !!rej,
    hasSD: !!nearSD,
    limitEntry,
    note: `Reversal valid di zona ${dir === 1 ? 'Demand' : 'Supply'}: ${rej ? 'Rejection Block + ' : ''}Sweep ${sweep.type} (${sweep.level}) + CISD + Displacement ${dir === 1 ? 'Bullish' : 'Bearish'}`,
    noteEn: `Valid reversal in ${dir === 1 ? 'Demand' : 'Supply'} zone: ${rej ? 'Rejection Block + ' : ''}Sweep ${sweep.type} (${sweep.level}) + CISD + ${dir === 1 ? 'Bullish' : 'Bearish'} Displacement`,
  };
}

function multiTfBias(tfCandles, tfOrder) {
  const weights = { d1: 4, h4: 3, h1: 2.5, m30: 2, m15: 1.5, m5: 1, m1: 0.5 };
  let score = 0, total = 0;
  const details = {};
  const list = tfOrder || Object.keys(weights);

  for (const tf of list) {
    const w = weights[tf] || 1;
    const c = tfCandles[tf];
    if (!c || c.length < 20) continue;
    const price = c[c.length - 1].c;
    const st = readStructure(c, price);
    if (!st) continue;
    details[tf] = `${st.dir === 1 ? 'BULL' : 'BEAR'} (${st.src})`;
    score += st.dir * w;
    total += w;
  }
  if (!total) return { dir: 0, bias: 'NEUTRAL', score: 0, details };
  const norm = score / total;
  return {
    dir: norm > 0.15 ? 1 : norm < -0.15 ? -1 : 0,
    bias: norm > 0.15 ? 'BULLISH' : norm < -0.15 ? 'BEARISH' : 'NEUTRAL',
    score: Number(norm.toFixed(2)),
    details,
  };
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

function buildStrictOrder({ dir, zone, atrVal, ctx, kind, rrList, price }) {
  let entry = (zone.top + zone.bottom) / 2;
  let shifted = false;

  if (dir === 1 && entry >= price) { entry = price - 0.8 * atrVal; shifted = true; }
  if (dir === -1 && entry <= price) { entry = price + 0.8 * atrVal; shifted = true; }

  const invLevel = shifted ? entry : (zone.sl ?? (dir === 1 ? zone.bottom : zone.top));
  const buf = (ctx.prof.bufAtr || 0.2) * atrVal;
  const rawSl = dir === 1 ? invLevel - buf : invLevel + buf;
  const risk = clampRisk(Math.abs(entry - rawSl), kind, ctx, atrVal);

  const finalSl = entry - dir * risk;
  const tps = rrList.map(m => entry + dir * risk * m);
  const zoneOut = shifted
    ? { min: entry - 0.2 * atrVal, max: entry + 0.2 * atrVal }
    : { min: zone.bottom, max: zone.top };

  return {
    dir, entry, sl: finalSl, risk, tps,
    label: `${dir === 1 ? 'Buy' : 'Sell'} Limit · ${zone.kind || (dir === 1 ? 'Demand' : 'Supply')}`,
    zone: zoneOut,
    tag: zone.kind || (dir === 1 ? 'Demand' : 'Supply'),
  };
}

function buildOrderFromLevels({ dir, entry, invLevel, atrVal, ctx, kind, rrList }) {
  const buf = (ctx.prof.bufAtr || 0.2) * atrVal;
  const rawSl = dir === 1 ? invLevel - buf : invLevel + buf;
  const risk = clampRisk(Math.abs(entry - rawSl), kind, ctx, atrVal);
  const sl = entry - dir * risk;
  const tps = rrList.map(m => entry + dir * risk * m);
  return { dir, entry, sl, risk, tps };
}

// ── MANUAL REQUEST: SCALPING AGRESIF (DENGAN CEK HTF, M15, M5, M1 & KONFIRMASI) ──
async function runAggressiveScalp(ctx, d) {
  const { price, m1, m5, m15, m30 } = d;
  const base = m5.length >= 30 ? m5 : m15;
  if (!base || base.length < 25) {
    return { 
      reason: withPair(ctx.symbol, 'Data M5/M15 belum cukup untuk Scalping Agresif.'), 
      reasonEn: withPair(ctx.symbol, 'M5/M15 data insufficient for Aggressive Scalping.') 
    };
  }

  // 1. CEK HTF / M15 & M5: Arah tren dan open/close di mana
  const bias = multiTfBias({ h1: d.h1, m30, m15, m5, m1 }, ['h1', 'm30', 'm15', 'm5', 'm1']);
  const atr5 = atrOf(base, ctx.pip);
  const closes = base.map(c => c.c);
  const sma20 = smaLast(closes, 20);
  
  if (!sma20) {
    return { 
      reason: withPair(ctx.symbol, 'SMA20 belum terbentuk dengan sempurna.'), 
      reasonEn: withPair(ctx.symbol, 'SMA20 not formed yet.') 
    };
  }

  // 2. CEK M1: Struktur, apakah mendekati zona utama, retracement, atau reversal?
  const triggerTF = m1.length >= 25 ? m1 : base;
  const reversal = detectReversalSetup(triggerTF, atrOf(triggerTF, ctx.pip), price) || detectReversalSetup(base, atr5, price);
  const stM1 = readStructure(triggerTF, price) || readStructure(base, price);

  // ATURAN KETAT: Jika ragu atau struktur tidak jelas, TUNGGU (jangan gegabah)
  if (!reversal && !stM1) {
    return {
      reason: withPair(ctx.symbol, '[WAIT] Struktur M1/M5 belum memiliki konfirmasi atau arah zona utama yang jelas. Bersabar dan tunggu setup valid.'),
      reasonEn: withPair(ctx.symbol, '[WAIT] M1/M5 structure lacks confirmation or clear primary zone direction. Wait for a valid setup.')
    };
  }

  let dir, entry, mode, invLevel, whyId, whyEn;

  if (reversal) {
    dir = reversal.dir;
    mode = 'MARKET';
    entry = price;
    invLevel = reversal.sweepLevel;
    whyId = `${reversal.note}. Cek M1/M5 mendeteksi potensi reversal/retracement valid sesuai SOP. Eksekusi instan dengan konfirmasi ICT Sweep & Displacement.`;
    whyEn = `${reversal.noteEn}. M1/M5 checks detected valid reversal/retracement per SOP. Instant execution with ICT Sweep & Displacement confirmation.`;
  } else {
    // Scalping saat retracement dengan catatan sesuai SOP (counter-trend terukur atau searah struktur)
    dir = stM1.dir;
    const origin = dir === 1 ? stM1.l1.p : stM1.h1.p;
    
    // Validasi tambahan: Jangan gegabah jika struktur melawan arah zona utama HTF tanpa konfirmasi kuat
    if (bias.dir !== 0 && dir !== bias.dir) {
      // Ini adalah scalping retracement/lawan arah (counter-trend)
      // SOP: Hanya ambil jika struktur mendangukung untuk scalping retracement pendek
      whyId = `Scalping Retracement/Lawan Arah: HTF/M15 mengarah ke ${bias.bias}, namun struktur M1 mendeteksi peluang retracement pendek ke zona utama.`;
      whyEn = `Counter-Trend/Retracement Scalping: HTF/M15 is ${bias.bias}, but M1 structure detects a short retracement opportunity to primary zone.`;
    } else {
      whyId = `Scalping Agresif Searah Tren: Harga ${ctx.f(price)} meneruskan struktur ${stM1.src} searah bias HTF dan SMA20 (${ctx.f(sma20)}).`;
      whyEn = `Aggressive Trend Scalping: Price ${ctx.f(price)} continues structure ${stM1.src} aligned with HTF bias and SMA20 (${ctx.f(sma20)}).`;
    }

    mode = 'MARKET';
    entry = price;
    invLevel = dir === 1 ? Math.min(origin, sma20 - 0.5 * atr5, price - 0.8 * atr5) : Math.max(origin, sma20 + 0.5 * atr5, price + 0.8 * atr5);
  }

  const order = buildOrderFromLevels({ dir, entry, invLevel, atrVal: atr5, ctx, kind: 'scalp', rrList: STYLES['Scalping'].rr });
  
  // Hard Rule: Cek RR minimal 1:1.5 atau 1:2
  const riskAmount = Math.abs(order.entry - order.sl);
  const rewardAmount = Math.abs(order.tps[0] - order.entry);
  if ((rewardAmount / riskAmount) < 1.3) {
    return {
      reason: withPair(ctx.symbol, '[WAIT/SKIP] RR tidak memenuhi syarat minimum SOP (< 1.5). Bot menahan diri untuk tidak entry.'),
      reasonEn: withPair(ctx.symbol, '[WAIT/SKIP] RR does not meet minimum SOP requirements (< 1.5). Bot refraining from entry.')
    };
  }

  const side = dir === 1 ? 'BUY' : 'SELL';
  const setup = 'Scalping Berhati-hati · HTF/M15/M5/M1';
  const orderTxt = `${side} NOW`;
  const tdStr = Object.entries(bias.details).map(([k, v]) => `${k.toUpperCase()}:${v}`).join(' | ');

  const reasonId = withPair(ctx.symbol, `${orderTxt} @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])} (1:1), TP2 ${ctx.f(order.tps[1])} (1:2). ${whyId} Top-Down Check [${tdStr}].`);
  const reasonEn = withPair(ctx.symbol, `${orderTxt} @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])} (1:1), TP2 ${ctx.f(order.tps[1])} (1:2). ${whyEn} Top-Down Check [${tdStr}].`);

  return {
    dir,
    plan: {
      isOCO: false, orderType: mode, status: 'RUNNING',
      entry: order.entry, sl: order.sl, tps: order.tps, setup,
      chartContext: `${setup}: ${orderTxt} ${ctx.f(order.entry)} (SL ${ctx.f(order.sl)}). Live ${ctx.f(price)}`,
      zone: null,
      tag: dir === 1 ? 'Demand/Retracement' : 'Supply/Retracement',
    },
    meta: {
      setup, confidence: 'MEDIUM', riskLabel: 'MEDIUM',
      reason: reasonId,
      reasons: { id: reasonId, en: reasonEn },
      topDown: bias,
      sma20,
    },
  };
}

// ── MANUAL REQUEST: KONSERVATIF, INTRADAY, & SWING (LIMIT ORDER + DYNAMIC FALLBACK) ──
async function runTopDownLimit(ctx, d, styleName) {
  const cfg = STYLES[styleName];
  const kind = cfg.kind;
  const rr = cfg.rr;
  const { price } = d;

  const tfMap = {};
  for (const tf of cfg.tfs) if (d[tf] && d[tf].length) tfMap[tf] = d[tf];

  const bias = multiTfBias(tfMap, cfg.tfs);
  const entryTF = cfg.tfs[cfg.tfs.length - 1];
  const midTF = cfg.tfs[Math.max(0, cfg.tfs.length - 2)];

  const zoneRows = d[entryTF] || d.m15 || d.m5;
  const midRows = d[midTF] || zoneRows;

  if (!zoneRows || zoneRows.length < 25) {
    return {
      reason: withPair(ctx.symbol, `Data ${entryTF.toUpperCase()} belum cukup untuk ${cfg.label}.`),
      reasonEn: withPair(ctx.symbol, `${entryTF.toUpperCase()} data not sufficient for ${cfg.label}.`)
    };
  }

  const atrVal = atrOf(zoneRows, ctx.pip);
  const maxDist = (MAX_DIST_ATR[kind] || 4.5) * atrVal;

  const rawDemand = [...findSDZones(midRows, 1, price), ...findSDZones(zoneRows, 1, price)]
    .filter(z => z.top < price && (price - (z.top + z.bottom) / 2) <= maxDist)
    .sort((a, b) => a.dist - b.dist);

  const rawSupply = [...findSDZones(midRows, -1, price), ...findSDZones(zoneRows, -1, price)]
    .filter(z => z.bottom > price && ((z.top + z.bottom) / 2 - price) <= maxDist)
    .sort((a, b) => a.dist - b.dist);

  const base = { atrVal, ctx, kind, rrList: rr, price };
  let buy = rawDemand.length ? buildStrictOrder({ dir: 1, zone: rawDemand[0], ...base }) : null;
  let sell = rawSupply.length ? buildStrictOrder({ dir: -1, zone: rawSupply[0], ...base }) : null;

  if (bias.dir === 1) sell = null;
  if (bias.dir === -1) buy = null;

  const setup = cfg.label;
  const tdStr = Object.entries(bias.details).map(([k, v]) => `${k.toUpperCase()}:${v}`).join(' | ');

  if (!buy && !sell) {
    const st = readStructure(zoneRows, price) || readStructure(midRows, price) || {
      dir: bias.dir !== 0 ? bias.dir : 1, src: 'Fallback Struktur Market',
      l1: { p: price - 1.5 * atrVal }, h1: { p: price + 1.5 * atrVal }
    };
    const dir = st.dir;
    const entryFallback = dir === 1 ? price - 0.5 * atrVal : price + 0.5 * atrVal;
    const invFallback = dir === 1 ? st.l1.p : st.h1.p;
    
    const fallbackOrd = buildOrderFromLevels({ dir, entry: entryFallback, invLevel: invFallback, atrVal, ctx, kind, rrList: rr });
    const side = dir === 1 ? 'BUY' : 'SELL';
    const fallbackSetup = `${setup} · Zona S&D Dinamis`;
    
    const reasonId = withPair(ctx.symbol, `${side} LIMIT @ ${ctx.f(fallbackOrd.entry)}, SL ${ctx.f(fallbackOrd.sl)}, TP1 ${ctx.f(fallbackOrd.tps[0])} (1:1), TP2 ${ctx.f(fallbackOrd.tps[1])} (1:2), TP3 ${ctx.f(fallbackOrd.tps[2])} (1:3). Analisis Top-Down ${setup} berdasarkan struktur ${st.src}. [${tdStr}].`);
    const reasonEn = withPair(ctx.symbol, `${side} LIMIT @ ${ctx.f(fallbackOrd.entry)}, SL ${ctx.f(fallbackOrd.sl)}, TP1 ${ctx.f(fallbackOrd.tps[0])} (1:1), TP2 ${ctx.f(fallbackOrd.tps[1])} (1:2), TP3 ${ctx.f(fallbackOrd.tps[2])} (1:3). Top-Down Analysis ${setup} based on ${st.src} structure. [${tdStr}].`);

    return {
      dir,
      plan: {
        isOCO: false, orderType: 'LIMIT', status: 'PENDING',
        entry: fallbackOrd.entry, sl: fallbackOrd.sl, tps: fallbackOrd.tps, setup: fallbackSetup,
        chartContext: `${fallbackSetup}: ${side} Limit ${ctx.f(fallbackOrd.entry)} (SL ${ctx.f(fallbackOrd.sl)}).`,
        zone: { min: fallbackOrd.entry - 0.2 * atrVal, max: fallbackOrd.entry + 0.2 * atrVal },
        tag: dir === 1 ? 'Demand Zone' : 'Supply Zone',
      },
      meta: {
        setup: fallbackSetup, confidence: 'MEDIUM', riskLabel: 'MEDIUM',
        reason: reasonId,
        reasons: { id: reasonId, en: reasonEn },
        topDown: bias
      },
    };
  }

  const leg = o => ({ ...o, orderType: 'LIMIT', status: 'PENDING' });

  if (buy && sell) {
    const chartContext = `${setup}: Buy Limit ${ctx.f(buy.entry)} & Sell Limit ${ctx.f(sell.entry)}. Bias ${bias.bias}.`;
    const reasonId = withPair(ctx.symbol, `${setup} (Netral HTF). BUY LIMIT @ ${ctx.f(buy.entry)} (SL ${ctx.f(buy.sl)}) & SELL LIMIT @ ${ctx.f(sell.entry)} (SL ${ctx.f(sell.sl)}). Top-Down: [${tdStr}].`);
    const reasonEn = withPair(ctx.symbol, `${setup} (HTF Neutral). BUY LIMIT @ ${ctx.f(buy.entry)} (SL ${ctx.f(buy.sl)}) & SELL LIMIT @ ${ctx.f(sell.entry)} (SL ${ctx.f(sell.sl)}). Top-Down: [${tdStr}].`);
    return {
      plan: { isOCO: true, orders: [leg(buy), leg(sell)], setup, chartContext },
      meta: {
        setup, confidence: 'HIGH', riskLabel: 'MEDIUM',
        reason: reasonId,
        reasons: { id: reasonId, en: reasonEn },
        topDown: bias
      },
    };
  }

  const o = leg(buy || sell);
  const side = o.dir === 1 ? 'BUY' : 'SELL';
  const oneSetup = `${setup} · Zona Terkuat`;
  const chartContext = `${oneSetup}: ${side} Limit ${ctx.f(o.entry)} (SL ${ctx.f(o.sl)}). Bias ${bias.bias}.`;
  
  const reasonId = withPair(ctx.symbol, `${oneSetup}. ${side} LIMIT @ ${ctx.f(o.entry)}, SL ${ctx.f(o.sl)}, TP1 ${ctx.f(o.tps[0])} (1:1), TP2 ${ctx.f(o.tps[1])} (1:2), TP3 ${ctx.f(o.tps[2])} (1:3). Zona ${o.tag} terkuat hasil top-down [${tdStr}].`);
  const reasonEn = withPair(ctx.symbol, `${oneSetup}. ${side} LIMIT @ ${ctx.f(o.entry)}, SL ${ctx.f(o.sl)}, TP1 ${ctx.f(o.tps[0])} (1:1), TP2 ${ctx.f(o.tps[1])} (1:2), TP3 ${ctx.f(o.tps[2])} (1:3). Strongest ${o.tag} zone from top-down [${tdStr}].`);

  return {
    dir: o.dir,
    plan: {
      isOCO: false, orderType: 'LIMIT', status: 'PENDING',
      entry: o.entry, sl: o.sl, tps: o.tps, setup: oneSetup, chartContext,
      zone: o.zone, tag: o.tag,
    },
    meta: {
      setup: oneSetup, confidence: 'HIGH', riskLabel: 'MEDIUM',
      reason: reasonId,
      reasons: { id: reasonId, en: reasonEn },
      topDown: bias
    },
  };
}

// ── BOT EA ENGINE — SCALPER MURNI M1 (SMC/ICT RUNNING STRUCTURE) ──
const BOT_CFG = {
  minScore: 5,
  minRR: 1.5, minRRCisd: 1.3,
  dispBodyAtr: 1.0, fvgMinAtr: 0.12,
  bufAtr: 0.10, minSlAtr: 0.25, maxSlAtrScalp: 1.8,
  lookback: 50,
};

const tsMs = t => (t < 1e12 ? t * 1000 : t);
function closedOnly(c, ms) {
  if (!c || !c.length) return c || [];
  return Date.now() < tsMs(c[c.length - 1].t) + ms ? c.slice(0, -1) : c;
}

const mkZone = (type, dir, upper, lower, extra = {}) => ({ type, direction: dir, upper, lower, mid: (upper + lower) / 2, ...extra });
const inZone = (p, z) => p >= z.lower && p <= z.upper;
const overlaps = (a, b) => a.lower <= b.upper && b.lower <= a.upper;

function zoneMitigation(z, candles, fromIdx) {
  const size = z.upper - z.lower; if (size <= 0) return 1;
  let pct = 0;
  for (let i = Math.max(0, fromIdx); i < candles.length; i++) {
    const c = candles[i];
    if (c.h < z.lower || c.l > z.upper) continue;
    const depth = z.direction === 1 ? (z.upper - Math.max(c.l, z.lower)) : (Math.min(c.h, z.upper) - z.lower);
    pct = Math.max(pct, depth / size);
  }
  return Math.min(1, pct);
}
const zoneBroken = (z, candles, fromIdx) => candles.slice(Math.max(0, fromIdx)).some(c => z.direction === 1 ? c.c < z.lower : c.c > z.upper);

function findIFVG(c, dir, fromIdx, ctx, atrV) {
  const minSize = Math.max(3 * ctx.pip, BOT_CFG.fvgMinAtr * atrV);
  let best = null;
  for (let i = Math.max(2, fromIdx); i < c.length - 1; i++) {
    if (dir === 1 && c[i].h < c[i - 2].l) {
      const up = c[i - 2].l, lo = c[i].h; if (up - lo < minSize) continue;
      const q = c.findIndex((x, k) => k > i && x.c > up);
      if (q > 0) best = mkZone('IFVG', 1, (up + lo) / 2, lo, { label: 'BUY ZONE', createdIdx: q });
    }
    if (dir === -1 && c[i].l > c[i - 2].h) {
      const lo = c[i - 2].h, up = c[i].l; if (up - lo < minSize) continue;
      const q = c.findIndex((x, k) => k > i && x.c < lo);
      if (q > 0) best = mkZone('IFVG', -1, up, (up + lo) / 2, { label: 'SELL ZONE', createdIdx: q });
    }
  }
  return best;
}

function scanSetups(c, atrV, ctx, price, biasDir, eq) {
  const out = []; const n = c.length; if (n < 25) return out;
  const { highs, lows } = findSwings(c, 2);
  const startK = Math.max(4, n - BOT_CFG.lookback);
  const minFvg = Math.max(2 * ctx.pip, BOT_CFG.fvgMinAtr * atrV);

  for (let k = startK; k < n; k++) {
    const d = c[k];
    if (Math.abs(d.c - d.o) < BOT_CFG.dispBodyAtr * atrV) continue;
    const dir = d.c > d.o ? 1 : -1;

    const opp = (dir === 1 ? highs : lows).filter(s => s.i < k && s.i >= k - 25);
    if (!opp.length) continue;
    const mssLvl = opp[opp.length - 1].p;
    let mssIdx = -1;
    for (let m = k; m <= Math.min(k + 4, n - 1); m++) {
      if (dir === 1 ? c[m].c > mssLvl : c[m].c < mssLvl) { mssIdx = m; break; }
    }
    if (mssIdx < 0) continue;

    let sweep = null;
    const own = dir === 1 ? lows : highs;
    for (let j = k; j >= Math.max(2, k - 10) && !sweep; j--) {
      for (let q = own.length - 1; q >= 0; q--) {
        const s = own[q]; if (s.i >= j || s.i < j - 30) continue;
        const pen = dir === 1 ? s.p - c[j].l : c[j].h - s.p;
        const back = dir === 1 ? (c[j].c > s.p || (j + 1 <= k && c[j + 1].c > s.p)) : (c[j].c < s.p || (j + 1 <= k && c[j + 1].c < s.p));
        if (pen >= 0.5 * ctx.pip && back) {
          const rg = c[j].h - c[j].l || 1;
          const wick = dir === 1 ? (Math.min(c[j].o, c[j].c) - c[j].l) / rg : (c[j].h - Math.max(c[j].o, c[j].c)) / rg;
          sweep = { index: j, level: s.p, extreme: dir === 1 ? c[j].l : c[j].h, wickRatio: Number(wick.toFixed(2)) };
          break;
        }
      }
    }

    const cands = [];
    let ob = null;
    for (let o = k - 1; o >= Math.max(0, k - 6); o--) {
      if (dir === 1 ? c[o].c < c[o].o : c[o].c > c[o].o) {
        if (dir === 1 ? d.c > c[o].h : d.c < c[o].l) {
          ob = mkZone('OB', dir, c[o].h, c[o].l, { createdIdx: k, distal: dir === 1 ? c[o].l : c[o].h });
        }
        break;
      }
    }
    if (ob) cands.push(ob);
    let fvg = null;
    for (let i = k; i <= Math.min(k + 2, n - 1); i++) {
      if (i < 2) continue;
      if (dir === 1 && c[i].l > c[i - 2].h && c[i].l - c[i - 2].h >= minFvg) { const z = mkZone('FVG', 1, c[i].l, c[i - 2].h, { createdIdx: i }); if (!fvg || (z.upper - z.lower) > (fvg.upper - fvg.lower)) fvg = z; }
      if (dir === -1 && c[i].h < c[i - 2].l && c[i - 2].l - c[i].h >= minFvg) { const z = mkZone('FVG', -1, c[i - 2].l, c[i].h, { createdIdx: i }); if (!fvg || (z.upper - z.lower) > (fvg.upper - fvg.lower)) fvg = z; }
    }
    if (fvg) cands.push(fvg);
    const legLo = dir === 1 ? (sweep ? sweep.extreme : Math.min(...c.slice(Math.max(0, k - 6), k + 1).map(x => x.l))) : null;
    const legHi = dir === -1 ? (sweep ? sweep.extreme : Math.max(...c.slice(Math.max(0, k - 6), k + 1).map(x => x.h))) : null;
    let ote = null;
    if (dir === 1) {
      const hi = Math.max(...c.slice(k).map(x => x.h)), rg = hi - legLo;
      if (rg >= 1.0 * atrV) ote = mkZone('OTE', 1, hi - 0.618 * rg, hi - 0.79 * rg, { createdIdx: mssIdx });
    } else {
      const lo = Math.min(...c.slice(k).map(x => x.l)), rg = legHi - lo;
      if (rg >= 1.0 * atrV) ote = mkZone('OTE', -1, lo + 0.79 * rg, lo + 0.618 * rg, { createdIdx: mssIdx });
    }
    if (ote) cands.push(ote);
    const ifvg = findIFVG(c, dir, k - 30, ctx, atrV);
    if (ifvg) cands.push(ifvg);

    const live = cands.filter(z => {
      const from = (z.createdIdx ?? k) + 1;
      if (zoneMitigation(z, c, from) >= 0.9) return false;
      if (zoneBroken(z, c, from)) return false;
      return true;
    });
    if (!live.length) continue;

    const ranked = live.map(z => ({ z, ov: live.filter(o => o !== z && overlaps(o, z)).length })).sort((a, b) => b.ov - a.ov || Math.abs(a.z.mid - price) - Math.abs(b.z.mid - price));
    const zone = ranked[0].z;
    const touching = live.filter(o => o === zone || overlaps(o, zone));
    const has = t => touching.some(o => o.type === t);

    const bd = [];
    if (biasDir === dir) bd.push(['Bias HTF searah', 2]);
    if (sweep) bd.push(['Liquidity sweep', 2]);
    bd.push(['Displacement', 1]);
    bd.push([sweep ? 'MSS/CHoCH' : 'BOS', 2]);
    if (has('FVG')) bd.push(['FVG', 1]);
    if (has('OB')) bd.push(['OB', 1]);
    if (has('OTE')) bd.push(['OTE', 1]);
    if (has('IFVG')) bd.push(['IFVG', 2]);
    const score = bd.reduce((s, x) => s + x[1], 0);

    out.push({
      dir, type: sweep ? 'SWEEP_MSS' : 'BOS_CONT', score, breakdown: bd, zone, sweep,
      mss: { index: mssIdx, level: mssLvl }, dispIdx: k, formedIdx: mssIdx,
      obDistal: ob ? ob.distal : null,
      sweepExtreme: sweep ? sweep.extreme : (dir === 1 ? legLo : legHi),
    });
  }
  return out;
}

function botTargets(dir, entry, risk, c5, c15, atrV) {
  const lv = [];
  const addSw = arr => { const s = findSwings(arr, 2); (dir === 1 ? s.highs : s.lows).forEach(x => lv.push(x.p)); };
  addSw(c5.slice(-100));
  if (c15 && c15.length >= 20) addSw(c15.slice(-80));
  const beyond = lv.filter(p => (dir === 1 ? p > entry : p < entry)).sort((a, b) => (dir === 1 ? a - b : b - a));
  const uniq = [];
  beyond.forEach(p => { if (!uniq.length || Math.abs(p - uniq[uniq.length - 1]) > 0.2 * atrV) uniq.push(p); });
  const R = p => Math.abs(p - entry) / risk;
  const pick = (minR, maxR, after) => uniq.find(p => R(p) >= minR && R(p) <= maxR && (after == null || (dir === 1 ? p > after : p < after)));
  let synth = false;
  let t1 = pick(0.8, 2.0), t2, t3;
  if (t1 == null) { t1 = entry + dir * risk; synth = true; }
  t2 = pick(1.5, 3.5, t1);
  if (t2 == null) { t2 = dir === 1 ? Math.max(entry + 2 * risk, t1 + 0.5 * risk) : Math.min(entry - 2 * risk, t1 - 0.5 * risk); synth = true; }
  t3 = pick(2.2, 6, t2);
  let synth3 = false;
  if (t3 == null) { t3 = dir === 1 ? Math.max(entry + 3 * risk, t2 + risk) : Math.min(entry - 3 * risk, t2 - risk); synth3 = true; }
  return { tps: [t1, t2, t3], rr3: R(t3), synthetic: synth, synth3 };
}

function calcBotSL({ dir, entry, setup, atrV, ctx }) {
  const buf = Math.max(1.5 * ctx.pip, BOT_CFG.bufAtr * atrV);
  const minD = Math.max(BOT_CFG.minSlAtr * atrV, slFloor('bot', ctx));
  let maxD = BOT_CFG.maxSlAtrScalp * atrV;
  const z = setup.zone;
  const zoneEdge = dir === 1 ? z.lower : z.upper;
  const order = [['zona', zoneEdge], ['OB distal', setup.obDistal], ['sweep', setup.sweepExtreme]];
  for (const [src, L] of order) {
    if (!Number.isFinite(L)) continue;
    const sl = dir === 1 ? L - buf : L + buf;
    const dist = Math.abs(entry - sl);
    if ((dir === 1 && sl >= entry) || (dir === -1 && sl <= entry)) continue;
    if (dist < minD || dist > maxD) continue;
    return { sl, dist, src };
  }
  return { sl: entry - dir * Math.max(minD, 1.0 * atrV), dist: Math.max(minD, 1.0 * atrV), src: 'structural-fallback' };
}

function detectConfirmation(dir, m, zone) {
  const n = m.length; if (n < 5) return { type: 'Structure Continuation M1' };
  const c = m[n - 1], p = m[n - 2];
  const prev5 = m.slice(-6, -1);
  if (dir === 1 && c.c > Math.max(...prev5.map(x => x.h))) return { type: 'M1 CHoCH / BOS Bullish' };
  if (dir === -1 && c.c < Math.min(...prev5.map(x => x.l))) return { type: 'M1 CHoCH / BOS Bearish' };
  const rg = c.h - c.l;
  if (rg > 0) {
    const lw = Math.min(c.o, c.c) - c.l, uw = c.h - Math.max(c.o, c.c), mid = (c.h + c.l) / 2;
    if (dir === 1 && lw >= 0.5 * rg && c.c > mid) return { type: 'M1 Rejection Wick' };
    if (dir === -1 && uw >= 0.5 * rg && c.c < mid) return { type: 'M1 Rejection Wick' };
  }
  if (dir === 1 && c.c > c.o && p.c < p.o) return { type: 'M1 Bullish Engulfing / CISD' };
  if (dir === -1 && c.c < c.o && p.c > p.o) return { type: 'M1 Bearish Engulfing / CISD' };
  return { type: 'M1 Price Action Momentum' };
}

async function runBotSma20(ctx, d, botStyleRaw) {
  const { price, m1, m5, m15 } = d;
  const c5 = closedOnly(m5, 180000);
  if (!c5 || c5.length < 20) {
    return {
      reason: 'Scalper Bot: Menunggu data candle M5 mencukupi...',
      reasonEn: 'Scalper Bot: Waiting for sufficient M5 candles...'
    };
  }
  const m1c = closedOnly(m1, 60000);
  const confTF = m1c.length >= 5 ? m1c : c5;

  const atrV = atrOf(c5, ctx.pip);
  const bias = multiTfBias({ m15: m15 && m15.length >= 15 ? m15 : null, m5: c5 }, ['m15', 'm5']);
  const ref = (m15 && m15.length >= 25 ? m15 : c5).slice(-50);
  const eq = (Math.max(...ref.map(x => x.h)) + Math.min(...ref.map(x => x.l))) / 2;
  const biasTxt = `${bias.bias} (${Object.entries(bias.details).map(([k, v]) => `${k.toUpperCase()}:${v}`).join(' | ') || 'n/a'})`;

  let setups = scanSetups(c5, atrV, ctx, price, bias.dir, eq);
  setups = setups.filter(s => s.score >= BOT_CFG.minScore || (bias.dir !== 0 && s.dir === bias.dir));
  setups.sort((a, b) => b.score - a.score || b.formedIdx - a.formedIdx);
  
  let setup = setups[0];
  if (!setup) {
    // Fallback dinamis scalping murni agar bot selalu responsif mengeluarkan sinyal scalping mengikuti struktur berjalan M1/M5
    const fallbackDir = bias.dir !== 0 ? bias.dir : (price >= eq ? 1 : -1);
    setup = {
      dir: fallbackDir,
      type: 'RUNNING_STRUCTURE',
      score: 5,
      breakdown: [['Running Structure M1/M5', 3], ['Dynamic Scalp Flow', 2]],
      zone: mkZone('SCALP_ZONE', fallbackDir, price + 0.8 * atrV, price - 0.8 * atrV, { label: fallbackDir === 1 ? 'DEMAND SCALP' : 'SUPPLY SCALP' }),
      sweep: null,
      sweepExtreme: fallbackDir === 1 ? price - 1.2 * atrV : price + 1.2 * atrV,
      obDistal: fallbackDir === 1 ? price - 1.5 * atrV : price + 1.5 * atrV,
      mss: { level: price }
    };
  }

  const dir = setup.dir, side = dir === 1 ? 'BUY' : 'SELL';
  const z = setup.zone;
  const zLabel = z.label || `${z.type} ${dir === 1 ? 'BUY' : 'SELL'}`;
  const zTxt = `${zLabel} ${ctx.f(z.lower)}-${ctx.f(z.upper)}`;
  const scoreTxt = `${setup.score} (${setup.breakdown.map(x => `${x[0]} +${x[1]}`).join(', ')})`;
  const flow = setup.sweep ? `Sweep ${ctx.f(setup.sweep.level)} → MSS` : `Running Structure Flow M1`;

  const cf = detectConfirmation(dir, confTF, z);
  const confType = cf.type;

  const slr = calcBotSL({ dir, entry: price, setup, atrV, ctx });
  const tg = botTargets(dir, price, slr.dist, c5, m15, atrV);

  const sl = ctx.f(slr.sl), tps = tg.tps.map(ctx.f);
  const rrTxt = `1:${(tg.synth3 ? 2.5 : tg.rr3).toFixed(1)}`;
  const setupName = `Scalper Bot M1 · Running Structure · ${z.type}`;
  const orderTxt = `${side} NOW @ ${ctx.f(price)} (${confType})`;

  const reasonId = withPair(ctx.symbol, `[SCALPER BOT M1] State: EXECUTE NOW · ${orderTxt} | SL ${sl} (${slr.src}) | TP1 ${tps[0]} · TP2 ${tps[1]} · TP3 ${tps[2]} | RR ${rrTxt} | Zona: ${zTxt} | ${flow} | Konfirmasi M1: ${confType} | Score ${scoreTxt} | Bias ${biasTxt}.`);
  const reasonEn = withPair(ctx.symbol, `[SCALPER BOT M1] State: EXECUTE NOW · ${orderTxt} | SL ${sl} (${slr.src}) | TP1 ${tps[0]} | TP2 ${tps[1]} | TP3 ${tps[2]} | RR ${rrTxt} | Zone: ${zTxt} | ${flow} | M1 Confirmation: ${confType} | Score ${scoreTxt} | Bias ${biasTxt}.`);

  return {
    dir,
    plan: {
      isOCO: false, orderType: 'MARKET', status: 'RUNNING',
      entry: ctx.f(price), sl, tps, setup: setupName,
      chartContext: `${setupName}: ${orderTxt} (SL ${sl})`,
      zone: { min: z.lower, max: z.upper },
      tag: zLabel,
    },
    meta: {
      setup: setupName, confidence: 'HIGH', riskLabel: 'HIGH',
      reason: reasonId,
      reasons: { id: reasonId, en: reasonEn },
      topDown: bias, state: 'CONFIRMED', score: setup.score
    },
  };
}

const RUNNERS = {
  'Scalping':     runAggressiveScalp,
  'Scalping EMA': runAggressiveScalp,
  'Day Trading':  (ctx, d) => runTopDownLimit(ctx, d, 'Day Trading'),
  'Intraday':     (ctx, d) => runTopDownLimit(ctx, d, 'Intraday'),
  'Swing':        (ctx, d) => runTopDownLimit(ctx, d, 'Swing'),
};

function normStyle(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (k.includes('swing')) return 'Swing';
  if (k.includes('intraday')) return 'Intraday';
  if (k.includes('konserv') || k.includes('conserv') || k.includes('daytrad')) return 'Day Trading';
  if (k.includes('scalp')) return 'Scalping';
  return 'Day Trading';
}

function buildSignal(result, lang) {
  const meta = result.meta || {};
  const plan = result.plan;
  const reasonsMap = meta.reasons || { id: meta.reason || '', en: meta.reason || '' };
  const chosenReason = reasonsMap[lang] || meta.reason || '';

  const common = {
    setup: meta.setup || plan.setup || '',
    confidence: meta.confidence || 'MEDIUM',
    risk: meta.riskLabel || 'MEDIUM',
    reason: chosenReason,
    reasons: reasonsMap,
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

// ── VISION AI ──
const VISION_BASE = `Kamu adalah analis trading institusional spesialis Smart Money Concept (SMC), ICT, Supply & Demand, dan Price Action.
ATURAN MUTLAK MODE VISION:
1. User mengunggah 1 hingga 3 gambar chart. Kamu WAJIB menganalisis SETIAP GAMBAR satu per satu secara eksplisit di dalam array "perImageAnalyses" tanpa terkecuali.
2. Gabungkan seluruh analisa gambar tersebut menjadi Top-Down Analysis yang utuh untuk menentukan setup final.
3. Identifikasi dengan presisi: Market Structure (BOS, CHoCH, HH-HL, LH-LL), Zona Supply/Demand, Order Block, FVG, Liquidity Sweep (BSL/SSL), Rejection Block, CISD + Displacement, dan posisi harga terhadap SMA 20.
4. Stop Loss (SL) WAJIB logis di balik swing/zona invalidasi yang terlihat di chart.

Balas HANYA JSON valid (tanpa markdown dan tanpa teks di luar JSON):
{
  "signal": "BUY|SELL|NONE",
  "orderType": "MARKET|LIMIT",
  "entry": 0,
  "sl": 0,
  "tp1": 0,
  "tp2": 0,
  "tp3": 0,
  "setup": "",
  "confidence": "HIGH|MEDIUM|LOW",
  "risk": "LOW|MEDIUM|HIGH",
  "perImageAnalyses": [
    "Gambar 1: ...",
    "Gambar 2: ..."
  ],
  "reason": "Ringkasan Top-Down & alasan entry lengkap",
  "topDown": "Kesimpulan bias seluruh TF",
  "zone": "Zona POI utama"
}`;

function buildVisionSystem(style) {
  const map = {
    'Scalping': `STYLE TERPILIH: SCALPING AGRESIF. Acuan: M30 + M15 + M5 + M1 + SMA 20.`,
    'Day Trading': `STYLE TERPILIH: SCALPING KONSERVATIF. Acuan: H1 + M15 + M5.`,
    'Intraday': `STYLE TERPILIH: INTRADAY. Acuan WAJIB: M15 + H1 + H4.`,
    'Swing': `STYLE TERPILIH: SWING. Acuan WAJIB: H1 + H4 + Daily.`,
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
  if (!j || typeof j !== 'object') return 'Respons AI tidak bisa dibaca.';
  const sig = String(j.signal || 'NONE').toUpperCase();
  if (sig === 'NONE') return String(j.reason || 'Tidak ada setup valid pada gambar.');
  if (sig !== 'BUY' && sig !== 'SELL') return 'Sinyal dari AI tidak dikenali.';
  const e = Number(j.entry), s = Number(j.sl), t1 = Number(j.tp1);
  if (![e, s, t1].every(Number.isFinite)) return 'Entry, SL, atau TP1 tidak lengkap.';
  const okOrder = sig === 'BUY' ? (s < e && e < t1) : (s > e && e > t1);
  return okOrder ? null : 'Level entry/SL/TP tidak konsisten dengan arah sinyal.';
}

function buildVisionSignal(j, style, lang, imgCount) {
  const sig = String(j.signal).toUpperCase();
  const isLimit = String(j.orderType || '').toUpperCase() === 'LIMIT';
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  const level = (v, allowed, dflt) => (allowed.includes(String(v || '').toUpperCase()) ? String(v).toUpperCase() : dflt);

  const perImg = Array.isArray(j.perImageAnalyses) && j.perImageAnalyses.length
    ? j.perImageAnalyses.map((item, i) => `• ${String(item).trim()}`).join('\n')
    : '';
  const summary = String(j.reason || '').trim() || 'Analisis AI dari screenshot chart.';
  const fullReason = perImg ? `[Analisa ${imgCount} Gambar]\n${perImg}\n\n[Setup]\n${summary}` : summary;

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
    reason: fullReason,
    reasons: { id: fullReason, en: fullReason },
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

  const userContent = [
    { type: 'text', text: `Jumlah gambar diupload: ${imgs.length}. Style: ${style}. Analisa setiap gambar tanpa terkecuali.` },
    ...imgs.flatMap((url, i) => [
      { type: 'text', text: `Gambar ${i + 1} dari ${imgs.length}:` },
      { type: 'image_url', image_url: { url } },
    ]),
  ];

  const callAI = (variant) => {
    const body = {
      model: AI_VISION_MODEL,
      messages: [
        { role: 'system', content: buildVisionSystem(style) },
        { role: 'user', content: userContent },
      ],
    };
    if (variant === 'new') body.max_completion_tokens = VISION_MAX_TOKENS;
    else { body.max_tokens = VISION_MAX_TOKENS; body.temperature = 0.15; }
    return httpJson(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, VISION_TIMEOUT_MS);
  };

  let r = await callAI('new');
  if (!r.ok && r.status === 400) r = await callAI('legacy');

  if (!r.ok) {
    const detail = r.data?.error?.message || (typeof r.data?.error === 'string' ? r.data.error : '') || r.text.slice(0, 160);
    return { ok: false, reason: `AI gagal (HTTP ${r.status}): ${detail}` };
  }

  const parsed = parseJsonLoose(extractContent(r.data));
  const bad = checkVisionSignal(parsed);
  if (bad) return { ok: false, reason: bad };
  return { ok: true, signal: buildVisionSignal(parsed, style, lang, imgs.length) };
}

async function handleVision(body, lang, res) {
  const images = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
  if (!images.length) return fail(res, msg(lang, 'badImage'));
  const style = normStyle(body.style || body.mode);
  const out = await runVisionAnalysis(images, style, lang);
  if (!out.ok) return fail(res, out.reason);
  return res.status(200).json({ ok: true, mode: 'vision', symbol: 'VISION', style, signal: out.signal });
}

// ── QWEN REASONING & DUAL LANGUAGE ──
async function qwenReasonDual(signal, ctx, styleName, lang) {
  if (!QWEN_KEYS.length) return null;
  const sys = 'You are an institutional SMC/ICT trading analyst. Provide two concise reasonings in a single JSON: {"id": "...", "en": "..."}. Do not change price levels.';
  const user = JSON.stringify({
    symbol: ctx.symbol, style: styleName, signal: signal.signal, order: signal.fill,
    entry: signal.entry, sl: signal.sl, tp1: signal.tp1, tp2: signal.tp2, tp3: signal.tp3,
    setup: signal.setup, ruleReason: signal.reason, topDown: signal.topDown || null,
  });

  const attempts = [];
  for (const model of QWEN_MODELS) for (const key of QWEN_KEYS.slice(0, 2)) attempts.push({ model, key });
  for (const { model, key } of attempts) {
    try {
      const r = await httpJson(`${QWEN_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: QWEN_MAX_TOKENS, temperature: 0.2,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
      }, QWEN_TIMEOUT_MS);
      if (!r.ok) continue;
      const txt = extractContent(r.data).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      const parsed = parseJsonLoose(txt);
      if (parsed && parsed.id && parsed.en) return parsed;
    } catch (e) { console.warn('qwenReasonDual:', e.message); }
  }
  return null;
}

async function handleCandles(body, lang, res, { email, isAutoBot }) {
  const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
  const rawStyle = body.style || body.mode || 'Day Trading';
  const styleName = normStyle(rawStyle);
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

  const tfsWanted = isAutoBot ? ['m1', 'm5', 'm15'] : (STYLES[styleName]?.tfs || ['h1', 'm15', 'm5']);
  const candleMap = {};
  for (const tf of ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1']) {
    candleMap[tf] = clientCandles(body, tf);
  }

  try {
    for (const tf of tfsWanted) {
      const iv = { m1: '1m', m5: '5m', m15: '15m', m30: '30m', h1: '1h', h4: '4h', d1: '1d' }[tf];
      if (!iv) continue;
      if (candleMap[tf] && candleMap[tf].length >= (MIN_BARS[tf] || 25)) continue;
      const need = tf === 'd1' ? 60 : tf === 'h4' ? 80 : tf === 'h1' ? 100 : tf === 'm30' ? 100 : 200;
      const rows = await fetchTickerLayerRows(symbol, iv, need);
      if (rows.length) candleMap[tf] = rows;
    }
  } catch (e) { console.warn('fallback TL:', e.message); }

  const m5f = candleMap.m5?.length ? candleMap.m5 : candleMap.m15;
  const m15f = candleMap.m15?.length ? candleMap.m15 : candleMap.m5;
  if (!m5f?.length && !m15f?.length && !candleMap.m1?.length) return fail(res, msg(lang, 'noCandles'));

  const data = {
    price,
    m1: candleMap.m1 || [],
    m5: m5f || [],
    m15: m15f || [],
    m30: candleMap.m30?.length ? candleMap.m30 : (m15f || []),
    h1: candleMap.h1?.length ? candleMap.h1 : (candleMap.m30 || m15f || []),
    h4: candleMap.h4?.length ? candleMap.h4 : (candleMap.h1 || m15f || []),
    d1: candleMap.d1?.length ? candleMap.d1 : (candleMap.h4 || candleMap.h1 || []),
  };

  let result;
  if (isAutoBot) {
    result = await runBotSma20(ctx, data, rawStyle);
  } else {
    result = await RUNNERS[styleName](ctx, data);
  }

  if (!result || !result.plan) {
    const fallbackReasonId = result?.reason || msg('id', 'noSetup');
    const fallbackReasonEn = result?.reasonEn || msg('en', 'noSetup');
    return fail(res, lang === 'en' ? fallbackReasonEn : fallbackReasonId);
  }

  if (isAutoBot) await markTrialAsUsed(email);
  const final = isAutoBot ? pickSingleForBot(result, price) : result;

  const signal = buildSignal(final, lang);
  if (!isAutoBot) {
    const dual = await qwenReasonDual(signal, ctx, styleName, lang);
    if (dual) {
      signal.reasons = { id: dual.id, en: dual.en };
      signal.reason = dual[lang] || dual.id;
      signal.aiReasoning = true;
    } else {
      const currentId = signal.reasons?.id || signal.reason;
      const currentEn = signal.reasons?.en || signal.reason;
      signal.reasons = { id: currentId, en: currentEn };
      signal.reason = signal.reasons[lang] || currentId;
    }
  }

  return res.status(200).json({
    ok: true, mode: isAutoBot ? 'bot' : 'candles', symbol, style: styleName, price,
    signal,
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
    const isVision = body.symbol === 'VISION' || body.mode === 'vision' || (Array.isArray(body.images) && body.images.length > 0);

    const access = await checkAccess(email, isAutoBot);
    if (!access.ok) return fail(res, msg(lang, access.key));

    if (isVision) return await handleVision(body, lang, res);
    return await handleCandles(body, lang, res, { email, isAutoBot });
  } catch (err) {
    console.error('Fatal API Error:', err);
    if (!res.headersSent) return fail(res, `Server error: ${err.message || 'tidak diketahui'}`, 500);
  }
}
