// api/generate.js
// v123 — Top-Down SMC/ICT + SMA20 (Manual, Bot Fleksibel Konservatif/Agresif, & Vision Per-Gambar)

export const config = { maxDuration: 60 };

const KV_KEY = 'alu_clients';
const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

// ── AI (VISION) ──
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/$/, '');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || 'claude-sonnet-5.5';
const VISION_TIMEOUT_MS = 55000;
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

function smaPrev(values, period = 20, offset = 1) {
  if (!values || values.length < period + offset) return null;
  let s = 0;
  const end = values.length - offset;
  for (let i = end - period; i < end; i++) s += values[i];
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
  };
}

function confirmPriceAction(candles, dir) {
  if (!candles || candles.length < 3) return null;
  const c1 = candles[candles.length - 1];
  const c0 = candles[candles.length - 2];
  const body1 = Math.abs(c1.c - c1.o);
  const body0 = Math.abs(c0.c - c0.o);

  if (dir === 1 && c1.c > c1.o) {
    if (c0.c < c0.o && c1.c > c0.o && body1 >= body0 * 0.9) return 'Bullish Engulfing';
    if (c1.c > c0.h) return 'Bullish Momentum Close';
  }
  if (dir === -1 && c1.c < c1.o) {
    if (c0.c > c0.o && c1.c < c0.o && body1 >= body0 * 0.9) return 'Bearish Engulfing';
    if (c1.c < c0.l) return 'Bearish Momentum Close';
  }
  return null;
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

async function runAggressiveScalp(ctx, d) {
  const { price, m1, m5, m15, m30 } = d;
  const base = m5.length >= 30 ? m5 : m15;
  if (!base || base.length < 25) return { reason: withPair(ctx.symbol, 'Data M5/M15 belum cukup untuk Scalping Agresif.') };

  const atr5 = atrOf(base, ctx.pip);
  const closes = base.map(c => c.c);
  const sma20 = smaLast(closes, 20);
  if (!sma20) return { reason: withPair(ctx.symbol, 'SMA20 belum terbentuk.') };

  const bias = multiTfBias({ m30, m15, m5, m1 }, ['m30', 'm15', 'm5', 'm1']);
  const triggerTF = m1.length >= 25 ? m1 : base;
  const reversal = detectReversalSetup(triggerTF, atrOf(triggerTF, ctx.pip), price) || detectReversalSetup(base, atr5, price);

  let dir, entry, mode, invLevel, why;
  const dist = Math.abs(price - sma20);

  if (reversal) {
    dir = reversal.dir;
    mode = 'MARKET';
    entry = price;
    invLevel = reversal.sweepLevel;
    why = `${reversal.note}. Eksekusi cepat sesuai kaidah ICT.`;
  } else {
    const st = readStructure(base, price) || readStructure(triggerTF, price) || {
      dir: bias.dir !== 0 ? bias.dir : (price >= sma20 ? 1 : -1),
      src: 'SMA20/Bias', bos: false,
      l1: { p: Math.min(...base.slice(-6).map(c => c.l)) },
      h1: { p: Math.max(...base.slice(-6).map(c => c.h)) },
    };

    dir = st.dir;
    const origin = dir === 1 ? st.l1.p : st.h1.p;
    const smaAligned = (dir === 1 && price >= sma20 - 0.25 * atr5) || (dir === -1 && price <= sma20 + 0.25 * atr5);

    // Agresif = selalu Buy Now / Sell Now searah pasar (tanpa limit)
    mode = 'MARKET';
    entry = price;
    invLevel = dir === 1 ? Math.min(origin, sma20 - 0.5 * atr5, price - 0.8 * atr5) : Math.max(origin, sma20 + 0.5 * atr5, price + 0.8 * atr5);
    why = smaAligned && dist <= 0.65 * atr5
      ? `Harga ${ctx.f(price)} menempel jalur SMA20 (${ctx.f(sma20)}) & searah struktur ${st.src}. Entry NOW.`
      : `Eksekusi NOW searah ${st.src}; SMA20 di ${ctx.f(sma20)}.`;
  }

  const order = buildOrderFromLevels({ dir, entry, invLevel, atrVal: atr5, ctx, kind: 'scalp', rrList: STYLES['Scalping'].rr });
  const side = dir === 1 ? 'BUY' : 'SELL';
  const setup = 'Scalping Agresif · M30/M15/M5/M1 + SMA20';
  const orderTxt = mode === 'MARKET' ? `${side} NOW` : `${side} LIMIT`;
  const tdStr = Object.entries(bias.details).map(([k, v]) => `${k.toUpperCase()}:${v}`).join(' | ');

  return {
    dir,
    plan: {
      isOCO: false, orderType: mode, status: mode === 'MARKET' ? 'RUNNING' : 'PENDING',
      entry: order.entry, sl: order.sl, tps: order.tps, setup,
      chartContext: `${setup}: ${orderTxt} ${ctx.f(order.entry)} (SL ${ctx.f(order.sl)}). Live ${ctx.f(price)}`,
      zone: mode === 'LIMIT' ? { min: order.entry - 0.2 * atr5, max: order.entry + 0.2 * atr5 } : null,
      tag: dir === 1 ? 'Demand/SMA20' : 'Supply/SMA20',
    },
    meta: {
      setup, confidence: 'HIGH', riskLabel: 'HIGH',
      reason: withPair(ctx.symbol, `${orderTxt} @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])} (1:1), TP2 ${ctx.f(order.tps[1])} (1:2), TP3 ${ctx.f(order.tps[2])} (1:3). ${why} Top-Down: [${tdStr}].`),
      topDown: bias,
      sma20,
    },
  };
}

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
    return { reason: withPair(ctx.symbol, `Data ${entryTF.toUpperCase()} belum cukup untuk ${cfg.label}.`) };
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
    const st = readStructure(zoneRows, price) || readStructure(midRows, price);
    if (!st) {
      return { reason: withPair(ctx.symbol, `${setup}: belum ada zona S&D fresh dan struktur market belum jelas. Tidak mengarang entry, tunggu konfirmasi.`) };
    }
    if (bias.dir !== 0 && st.dir !== bias.dir) {
      return { reason: withPair(ctx.symbol, `${setup}: struktur ${entryTF.toUpperCase()} berlawanan dengan bias HTF (${bias.bias}). Tunggu arah selaras.`) };
    }

    const dir = st.dir;
    const fvgs = findFVGs(zoneRows, dir, price);
    const midFvgs = findFVGs(midRows, dir, price);
    const nearestFvg = fvgs[0] || midFvgs[0];
    const sma20 = smaLast(zoneRows.map(c => c.c), 20);
    const origin = dir === 1 ? st.l1.p : st.h1.p;

    let bounceLevel = null;
    let bounceLabel = '';

    if (nearestFvg && nearestFvg.dist <= maxDist) {
      bounceLevel = (nearestFvg.top + nearestFvg.bottom) / 2;
      bounceLabel = nearestFvg.kind;
    } else if (sma20 && ((dir === 1 && sma20 < price && (price - sma20) <= maxDist) || (dir === -1 && sma20 > price && (sma20 - price) <= maxDist))) {
      bounceLevel = sma20;
      bounceLabel = `SMA20 ${entryTF.toUpperCase()}`;
    }

    if (bounceLevel != null) {
      const inv = nearestFvg ? nearestFvg.sl : origin;
      const cont = buildOrderFromLevels({ dir, entry: bounceLevel, invLevel: inv, atrVal, ctx, kind, rrList: rr });
      const side = dir === 1 ? 'BUY' : 'SELL';
      const contSetup = `${setup} · Continuation`;
      const reason = withPair(ctx.symbol, `${side} LIMIT @ ${ctx.f(cont.entry)}, SL ${ctx.f(cont.sl)}, TP1 ${ctx.f(cont.tps[0])} (1:1), TP2 ${ctx.f(cont.tps[1])} (1:2), TP3 ${ctx.f(cont.tps[2])} (1:3). Zona S&D utama jauh/terisi — mengambil setup Continuation searah ${st.src} di ${bounceLabel} (${ctx.f(bounceLevel)}). Top-Down: [${tdStr}].`);

      return {
        dir,
        plan: {
          isOCO: false, orderType: 'LIMIT', status: 'PENDING',
          entry: cont.entry, sl: cont.sl, tps: cont.tps, setup: contSetup,
          chartContext: `${contSetup}: ${side} Limit ${ctx.f(cont.entry)} (SL ${ctx.f(cont.sl)}). Live ${ctx.f(price)}`,
          zone: { min: cont.entry - 0.2 * atrVal, max: cont.entry + 0.2 * atrVal },
          tag: bounceLabel,
        },
        meta: { setup: contSetup, confidence: 'MEDIUM', riskLabel: 'MEDIUM', reason, topDown: bias },
      };
    }

    return { reason: withPair(ctx.symbol, `${setup}: belum ditemukan zona S&D kuat maupun pantulan FVG/SMA20 terdekat yang valid sesuai SOP SMC/ICT. Tunggu setup baru.`) };
  }

  const leg = o => ({ ...o, orderType: 'LIMIT', status: 'PENDING' });

  if (buy && sell) {
    const chartContext = `${setup}: Buy Limit ${ctx.f(buy.entry)} & Sell Limit ${ctx.f(sell.entry)}. Bias ${bias.bias}.`;
    const reason = withPair(ctx.symbol, `${setup} (Netral HTF). BUY LIMIT @ ${ctx.f(buy.entry)} (SL ${ctx.f(buy.sl)}) & SELL LIMIT @ ${ctx.f(sell.entry)} (SL ${ctx.f(sell.sl)}). Top-Down: [${tdStr}].`);
    return {
      plan: { isOCO: true, orders: [leg(buy), leg(sell)], setup, chartContext },
      meta: { setup, confidence: 'HIGH', riskLabel: 'MEDIUM', reason, topDown: bias },
    };
  }

  const o = leg(buy || sell);
  const side = o.dir === 1 ? 'BUY' : 'SELL';
  const oneSetup = `${setup} · Zona Terkuat`;
  const chartContext = `${oneSetup}: ${side} Limit ${ctx.f(o.entry)} (SL ${ctx.f(o.sl)}). Bias ${bias.bias}.`;
  const reason = withPair(ctx.symbol, `${oneSetup}. ${side} LIMIT @ ${ctx.f(o.entry)}, SL ${ctx.f(o.sl)}, TP1 ${ctx.f(o.tps[0])} (1:1), TP2 ${ctx.f(o.tps[1])} (1:2), TP3 ${ctx.f(o.tps[2])} (1:3). Zona ${o.tag} terkuat hasil top-down [${tdStr}].`);

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

// ── 3) BOT EA ENGINE (FLEKSIBEL: REVERSAL / SMA / ZONE M1) ──
async function runBotSma20(ctx, d, botStyleRaw) {
  const { price, m1, m5 } = d;
  const candles = (m1 && m1.length >= 30) ? m1 : m5;
  if (!candles || candles.length < 30) {
    return { reason: 'Bot menunggu data candle M1 mencukupi...' };
  }

  const isConservative = /konserv|conserv|day/i.test(String(botStyleRaw || ''));
  const atrVal = atrOf(candles, ctx.pip);
  const closes = candles.map(c => c.c);
  const sma20 = smaLast(closes, 20);
  const sma20Prev = smaPrev(closes, 20, 1);
  if (!sma20 || !sma20Prev) return { reason: 'Bot menghitung SMA20 M1...' };

  const last = candles[candles.length - 1];
  const st = readStructure(candles, price);
  const reversal = detectReversalSetup(candles, atrVal, price);
  const rrList = [1, 2]; // SOP Bot: RR 1:1 & 1:2

  // ════════════════════════════════════════════════════════
  // BOT KONSERVATIF FLEKSIBEL:
  // Jika limit order sebelumnya kejauhan atau belum tersentuh, bot secara dinamis
  // membaca zona baru (Reversal / SMA20 / S&D Zone terdekat) secara real-time.
  // ════════════════════════════════════════════════════════
  if (isConservative) {
    // 1. Cek Reversal fresh (Sweep + CISD + Displacement di S&D)
    if (reversal) {
      const dir = reversal.dir;
      const entry = reversal.limitEntry;
      const order = buildOrderFromLevels({ dir, entry, invLevel: reversal.sweepLevel, atrVal, ctx, kind: 'bot', rrList });
      const side = dir === 1 ? 'BUY' : 'SELL';
      const setup = 'Bot Konservatif · Fleksibel Reversal';
      return {
        dir,
        plan: {
          isOCO: false, orderType: 'LIMIT', status: 'PENDING',
          entry: order.entry, sl: order.sl, tps: order.tps, setup,
          chartContext: `${setup}: ${side} LIMIT ${ctx.f(order.entry)} (SL ${ctx.f(order.sl)})`,
          zone: { min: order.entry - 0.2 * atrVal, max: order.entry + 0.2 * atrVal },
          tag: 'Reversal Zone',
        },
        meta: {
          setup, confidence: 'HIGH', riskLabel: 'MEDIUM',
          reason: withPair(ctx.symbol, `[BOT KONSERVATIF FLEKSIBEL] ${side} LIMIT @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])} (1:1), TP2 ${ctx.f(order.tps[1])} (1:2). Membaca zona baru Reversal: ${reversal.note}.`),
          sma20,
        },
      };
    }

    // 2. Baca Zona S&D fresh atau SMA20 terdekat yang realistis dengan harga berjalan
    const dir = st ? st.dir : (price > sma20 ? 1 : -1);
    const sdZones = findSDZones(candles, dir, price);
    const validSD = sdZones.find(z => Math.abs((z.top + z.bottom) / 2 - price) <= 3.5 * atrVal);
    
    let targetEntry = sma20;
    let inv = dir === 1 ? sma20 - 0.8 * atrVal : sma20 + 0.8 * atrVal;
    let zoneTag = 'SMA20 Dynamic';

    if (validSD) {
      targetEntry = (validSD.top + validSD.bottom) / 2;
      inv = validSD.sl;
      zoneTag = validSD.kind;
    } else {
      const fvg = findFVGs(candles, dir, price)[0];
      if (fvg && fvg.dist <= 3.0 * atrVal) {
        targetEntry = (fvg.top + fvg.bottom) / 2;
        inv = fvg.sl;
        zoneTag = fvg.kind;
      }
    }

    // Jika target limit terlalu jauh di atas/bawah harga berjalan, bot secara fleksibel menyesuaikan ke pantulan terdekat
    const distToTarget = Math.abs(price - targetEntry);
    if (distToTarget > 4.0 * atrVal) {
      targetEntry = dir === 1 ? price - 0.6 * atrVal : price + 0.6 * atrVal;
      zoneTag = 'Dynamic Pullback';
    }

    const order = buildOrderFromLevels({ dir, entry: targetEntry, invLevel: inv, atrVal, ctx, kind: 'bot', rrList });
    const side = dir === 1 ? 'BUY' : 'SELL';
    const setup = 'Bot Konservatif · Fleksibel Zone/SMA';
    return {
      dir,
      plan: {
        isOCO: false, orderType: 'LIMIT', status: 'PENDING',
        entry: order.entry, sl: order.sl, tps: order.tps, setup,
        chartContext: `${setup}: ${side} LIMIT ${ctx.f(order.entry)} (SL ${ctx.f(order.sl)})`,
        zone: { min: order.entry - 0.2 * atrVal, max: order.entry + 0.2 * atrVal },
        tag: zoneTag,
      },
      meta: {
        setup, confidence: 'HIGH', riskLabel: 'MEDIUM',
        reason: withPair(ctx.symbol, `[BOT KONSERVATIF FLEKSIBEL] ${side} LIMIT @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])} (1:1), TP2 ${ctx.f(order.tps[1])} (1:2). Membaca zona baru ${zoneTag} & SMA20 (${ctx.f(sma20)}) secara dinamis.`),
        sma20,
      },
    };
  }

  // ════════════════════════════════════════════════════════
  // BOT AGRESIF (ENTRY NOW — OPSI 1, OPSI 2, OPSI 3)
  // ════════════════════════════════════════════════════════
  if (reversal) {
    const dir = reversal.dir;
    const order = buildOrderFromLevels({ dir, entry: price, invLevel: reversal.sweepLevel, atrVal, ctx, kind: 'bot', rrList });
    const side = dir === 1 ? 'BUY' : 'SELL';
    const setup = 'Bot Agresif · Opsi 3 Reversal (CISD+Disp)';
    return {
      dir,
      plan: {
        isOCO: false, orderType: 'MARKET', status: 'RUNNING',
        entry: order.entry, sl: order.sl, tps: order.tps, setup,
        chartContext: `${setup}: ${side} NOW ${ctx.f(order.entry)} (SL ${ctx.f(order.sl)})`,
        zone: null, tag: 'Reversal CISD',
      },
      meta: {
        setup, confidence: 'HIGH', riskLabel: 'HIGH',
        reason: withPair(ctx.symbol, `[BOT AGRESIF - OPSI 3 REVERSAL] ${side} NOW @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])} (1:1), TP2 ${ctx.f(order.tps[1])} (1:2). ${reversal.note}.`),
        sma20,
      },
    };
  }

  // Agresif = Buy Now / Sell Now searah pasar. Jika struktur belum jelas, pakai posisi harga vs SMA20 + slope.
  const stx = st || {
    dir: (price >= sma20 && sma20 >= sma20Prev) ? 1 : (price < sma20 && sma20 < sma20Prev) ? -1 : (price >= sma20 ? 1 : -1),
    src: 'SMA20 Bias', bos: false,
    l1: { p: Math.min(...candles.slice(-6).map(c => c.l)) },
    h1: { p: Math.max(...candles.slice(-6).map(c => c.h)) },
  };
  const dir = stx.dir;
  const distSma = Math.abs(price - sma20);
  const touchedSma = (dir === 1 && last.l <= sma20 + 0.15 * atrVal && last.c > sma20)
                  || (dir === -1 && last.h >= sma20 - 0.15 * atrVal && last.c < sma20);
  const paConfirm = confirmPriceAction(candles, dir);

  if ((touchedSma || distSma <= 0.35 * atrVal) && ((dir === 1 && price > sma20) || (dir === -1 && price < sma20))) {
    const invLevel = dir === 1 ? Math.min(last.l, sma20 - 0.45 * atrVal) : Math.max(last.h, sma20 + 0.45 * atrVal);
    const order = buildOrderFromLevels({ dir, entry: price, invLevel, atrVal, ctx, kind: 'bot', rrList });
    const side = dir === 1 ? 'BUY' : 'SELL';
    const setup = 'Bot Agresif · Opsi 2 SMA20 Continuation';
    return {
      dir,
      plan: {
        isOCO: false, orderType: 'MARKET', status: 'RUNNING',
        entry: order.entry, sl: order.sl, tps: order.tps, setup,
        chartContext: `${setup}: ${side} NOW ${ctx.f(order.entry)} (SL ${ctx.f(order.sl)})`,
        zone: null, tag: 'SMA20 Continuation',
      },
      meta: {
        setup, confidence: 'HIGH', riskLabel: 'HIGH',
        reason: withPair(ctx.symbol, `[BOT AGRESIF - OPSI 2 SMA20] ${side} NOW @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])} (1:1), TP2 ${ctx.f(order.tps[1])} (1:2). Kontinuitas SMA20 (${ctx.f(sma20)}) searah struktur ${stx.src}.`),
        sma20,
      },
    };
  }

  if (paConfirm && ((dir === 1 && price > sma20) || (dir === -1 && price < sma20)) && distSma <= 1.5 * atrVal) {
    const invLevel = dir === 1 ? Math.min(last.l, stx.l1.p) : Math.max(last.h, stx.h1.p);
    const order = buildOrderFromLevels({ dir, entry: price, invLevel, atrVal, ctx, kind: 'bot', rrList });
    const side = dir === 1 ? 'BUY' : 'SELL';
    const setup = 'Bot Agresif · Opsi 1 Structure + Price Action';
    return {
      dir,
      plan: {
        isOCO: false, orderType: 'MARKET', status: 'RUNNING',
        entry: order.entry, sl: order.sl, tps: order.tps, setup,
        chartContext: `${setup}: ${side} NOW ${ctx.f(order.entry)} (SL ${ctx.f(order.sl)})`,
        zone: null, tag: 'Structure + PA',
      },
      meta: {
        setup, confidence: 'HIGH', riskLabel: 'HIGH',
        reason: withPair(ctx.symbol, `[BOT AGRESIF - OPSI 1 STRUCTURE+PA] ${side} NOW @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])} (1:1), TP2 ${ctx.f(order.tps[1])} (1:2). Struktur ${stx.src} + konfirmasi ${paConfirm} di jalur SMA20 (${ctx.f(sma20)}).`),
        sma20,
      },
    };
  }

  // Fallback: tidak ada trigger sempurna -> tetap NOW searah arah pasar (sesuai SOP Agresif)
  {
    const invLevel = dir === 1 ? Math.min(last.l, stx.l1.p, sma20 - 0.3 * atrVal) : Math.max(last.h, stx.h1.p, sma20 + 0.3 * atrVal);
    const order = buildOrderFromLevels({ dir, entry: price, invLevel, atrVal, ctx, kind: 'bot', rrList });
    const side = dir === 1 ? 'BUY' : 'SELL';
    const setup = 'Bot Agresif · Market Direction NOW';
    return {
      dir,
      plan: {
        isOCO: false, orderType: 'MARKET', status: 'RUNNING',
        entry: order.entry, sl: order.sl, tps: order.tps, setup,
        chartContext: `${setup}: ${side} NOW ${ctx.f(order.entry)} (SL ${ctx.f(order.sl)})`,
        zone: null, tag: 'Market Direction',
      },
      meta: {
        setup, confidence: 'MEDIUM', riskLabel: 'HIGH',
        reason: withPair(ctx.symbol, `[BOT AGRESIF - MARKET NOW] ${side} NOW @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])} (1:1), TP2 ${ctx.f(order.tps[1])} (1:2). Arah ${stx.src}, harga ${price >= sma20 ? 'di atas' : 'di bawah'} SMA20 (${ctx.f(sma20)}).`),
        sma20,
      },
    };
  }
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
    reasons: { [lang]: fullReason },
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
    // Model GPT baru: pakai max_completion_tokens & tanpa temperature. Gateway lama: max_tokens.
    if (variant === 'new') body.max_completion_tokens = VISION_MAX_TOKENS;
    else { body.max_tokens = VISION_MAX_TOKENS; body.temperature = 0.15; }
    return httpJson(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, VISION_TIMEOUT_MS);
  };

  let r = await callAI('new');
  if (!r.ok && r.status === 400) r = await callAI('legacy'); // fallback jika gateway menolak parameter baru

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

  const tfsWanted = isAutoBot ? ['m1', 'm5'] : (STYLES[styleName]?.tfs || ['h1', 'm15', 'm5']);
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

  if (!result || !result.plan) return fail(res, result?.reason || msg(lang, 'noSetup'));

  if (isAutoBot) await markTrialAsUsed(email);
  const final = isAutoBot ? pickSingleForBot(result, price) : result;

  return res.status(200).json({
    ok: true, mode: isAutoBot ? 'bot' : 'candles', symbol, style: styleName, price,
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
