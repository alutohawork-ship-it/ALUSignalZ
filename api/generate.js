// api/generate.js
// v131 — Top-Down SMC/ICT + Interactive Analyst Voice (Standby-Proof)
// Update: Return ok:true untuk STANDBY agar Frontend merender teks analis interaktif.

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
const ZONE_DISP_ATR = 1.2;
const MAX_DIST_ATR = { scalp: 3.5, scalp_cons: 4.5, intraday: 6.5, swing: 11.0, bot: 1.5 };
const GOLD_SL_PIPS = { scalp: [25, 65], scalp_cons: [35, 110], intraday: [70, 190], swing: [140, 320], bot: [25, 75] };
const ATR_SL_MULT = { scalp: [0.9, 2.8], scalp_cons: [1.0, 3.0], intraday: [1.1, 3.5], swing: [1.2, 4.0], bot: [0.3, 1.5] };

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

// ── KILLZONE CHECKER ──
function getKillzoneStatus(nowMs = Date.now()) {
  try {
    const nyTime = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const mins = nyTime.getHours() * 60 + nyTime.getMinutes();
    if (mins >= 120 && mins <= 300) return { active: true, name: 'LONDON KZ' };
    if (mins >= 420 && mins <= 600) return { active: true, name: 'NEWYORK KZ' };
    if (mins >= 600 && mins <= 660) return { active: true, name: 'SILVER BULLET KZ' };
    return { active: false, name: 'OUTSIDE KZ' };
  } catch {
    return { active: true, name: 'ACTIVE SESSION' };
  }
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
  const lastC = candles[n - 1];

  if (lastC.c > lastC.o) {
    let bearSeries = [];
    for (let i = n - 2; i >= Math.max(0, n - 8); i--) {
      if (candles[i].c < candles[i].o) {
        bearSeries.push(candles[i]);
      } else if (bearSeries.length > 0) {
        break;
      }
    }
    if (bearSeries.length >= 2) {
      const highestOpen = Math.max(...bearSeries.map(c => c.o));
      const lowestLow = Math.min(...bearSeries.map(c => c.l));
      if (lastC.c > highestOpen) {
        return { dir: 1, level: highestOpen, obLow: lowestLow, obHigh: highestOpen, dispIdx: n - 1, seriesCount: bearSeries.length };
      }
    }
  }

  if (lastC.c < lastC.o) {
    let bullSeries = [];
    for (let i = n - 2; i >= Math.max(0, n - 8); i--) {
      if (candles[i].c > candles[i].o) {
        bullSeries.push(candles[i]);
      } else if (bullSeries.length > 0) {
        break;
      }
    }
    if (bullSeries.length >= 2) {
      const lowestOpen = Math.min(...bullSeries.map(c => c.o));
      const highestHigh = Math.max(...bullSeries.map(c => c.h));
      if (lastC.c < lowestOpen) {
        return { dir: -1, level: lowestOpen, obHigh: highestHigh, obLow: lowestOpen, dispIdx: n - 1, seriesCount: bullSeries.length };
      }
    }
  }
  return null;
}

function validateStructureAndCISD(triggerCandles, atrVal) {
  if (!triggerCandles || triggerCandles.length < 10) {
    return { valid: false, reason: 'Data candle trigger tidak cukup untuk validasi struktur.' };
  }

  const { highs, lows } = findSwings(triggerCandles.slice(0, -1), 2);
  const lastC = triggerCandles[triggerCandles.length - 1];
  const recentHigh = highs.length ? highs[highs.length - 1].p : null;
  const recentLow = lows.length ? lows[lows.length - 1].p : null;

  if (recentHigh && lastC.c > recentHigh && lastC.c > lastC.o) {
    const body = Math.abs(lastC.c - lastC.o);
    if (body >= 0.75 * atrVal) {
      return { valid: true, dir: 1, model: 'CHoCH/BOS', type: 'Micro CHoCH / BOS Bullish (Close Confirmed)' };
    }
  }
  if (recentLow && lastC.c < recentLow && lastC.c < lastC.o) {
    const body = Math.abs(lastC.c - lastC.o);
    if (body >= 0.75 * atrVal) {
      return { valid: true, dir: -1, model: 'CHoCH/BOS', type: 'Micro CHoCH / BOS Bearish (Close Confirmed)' };
    }
  }

  const cisd = detectCISD(triggerCandles, atrVal);
  if (cisd) {
    return {
      valid: true,
      dir: cisd.dir,
      model: 'CISD',
      cisdLevel: cisd.level,
      obLow: cisd.obLow,
      obHigh: cisd.obHigh,
      type: `CISD ${cisd.dir === 1 ? 'Bullish' : 'Bearish'} Reversal (${cisd.seriesCount} candles delivery shift)`
    };
  }

  return { valid: false, reason: 'Belum ada konfirmasi Micro CHoCH/BOS ataupun CISD dengan candle close yang valid.' };
}

function detectReversalSetup(candles, atrVal, price) {
  const sweep = detectSweep(candles);
  const cisd = detectCISD(candles, atrVal);
  if (!sweep && !cisd) return null;

  const dir = cisd ? cisd.dir : sweep.dir;
  if (sweep && cisd && sweep.dir !== cisd.dir) return null;

  const refExtreme = sweep ? sweep.sweepExtreme : (dir === 1 ? cisd.obLow : cisd.obHigh);
  const sdZones = findSDZones(candles.slice(0, -2), dir, refExtreme);
  const nearSD = sdZones.find(z => Math.abs((z.top + z.bottom) / 2 - refExtreme) <= 2.5 * atrVal);

  const disp = lastDisplacement(candles, atrVal, 3);
  if (!cisd && (!disp || disp.dir !== dir)) return null;

  const limitEntry = cisd
    ? (dir === 1 ? Math.min(price - 0.1 * atrVal, (cisd.obHigh + cisd.obLow) / 2) : Math.max(price + 0.1 * atrVal, (cisd.obHigh + cisd.obLow) / 2))
    : price;

  return {
    dir,
    model: cisd ? 'CISD' : 'REVERSAL_BOS',
    sweepLevel: refExtreme,
    cisdLevel: cisd ? cisd.level : null,
    sweepType: sweep ? sweep.type : 'CISD_DELIVERY',
    hasSD: !!nearSD,
    limitEntry,
    note: `Reversal Terkonfirmasi (${cisd ? 'CISD Delivery Shift' : 'Sweep + Displacement'}) di zona ${dir === 1 ? 'Demand' : 'Supply'}${sweep ? ` setelah Sweep ${sweep.type}` : ''}`,
    noteEn: `Confirmed Reversal (${cisd ? 'CISD Delivery Shift' : 'Sweep + Displacement'}) in ${dir === 1 ? 'Demand' : 'Supply'} zone${sweep ? ` after ${sweep.type} Sweep` : ''}`,
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

async function runAggressiveScalp(ctx, d) {
  const { price, m1, m5, m15, m30 } = d;
  const base = m5.length >= 30 ? m5 : m15;
  if (!base || base.length < 25) {
    return {
      reason: withPair(ctx.symbol, '[DEEP SCAN] Data M5/M15 belum cukup untuk scanning mendalam.'),
      reasonEn: withPair(ctx.symbol, '[DEEP SCAN] M5/M15 data insufficient for deep scanning.')
    };
  }

  const bias = multiTfBias({ h1: d.h1, m30, m15, m5, m1 }, ['h1', 'm30', 'm15', 'm5', 'm1']);
  const atr5 = atrOf(base, ctx.pip);
  const closes = base.map(c => c.c);
  const sma20 = smaLast(closes, 20);

  if (!sma20) {
    return {
      reason: withPair(ctx.symbol, '[DEEP SCAN] SMA20 belum terbentuk sempurna. Menunggu stabilitas harga.'),
      reasonEn: withPair(ctx.symbol, '[DEEP SCAN] SMA20 not fully formed. Waiting for price stability.')
    };
  }

  const triggerTF = m1.length >= 25 ? m1 : base;
  const triggerAtr = atrOf(triggerTF, ctx.pip);
  const structConf = validateStructureAndCISD(triggerTF, triggerAtr);
  const reversal = detectReversalSetup(triggerTF, triggerAtr, price) || detectReversalSetup(base, atr5, price);

  if (!structConf.valid && !reversal) {
    return {
      reason: withPair(ctx.symbol, '[WAIT / STANDBY] Deep Scan selesai: Belum ada konfirmasi CHoCH/BOS maupun CISD pembalikan arah dengan candle close valid. Bot menunggu.'),
      reasonEn: withPair(ctx.symbol, '[WAIT / STANDBY] Deep Scan complete: No valid close-confirmed CHoCH/BOS or CISD reversal yet. Bot waiting.')
    };
  }

  let dir, entry, mode, invLevel, whyId, whyEn, isCisdModel = false;

  if (reversal) {
    dir = reversal.dir;
    mode = 'MARKET';
    entry = price;
    invLevel = reversal.sweepLevel;
    isCisdModel = reversal.model === 'CISD';
    whyId = `${reversal.note}. Konfirmasi struktur & CISD valid di M1/M5.`;
    whyEn = `${reversal.noteEn}. Valid M1/M5 structure & CISD confirmation.`;
  } else {
    dir = structConf.dir;
    isCisdModel = structConf.model === 'CISD';
    const stM1 = readStructure(triggerTF, price) || readStructure(base, price);
    const origin = dir === 1
      ? (structConf.obLow ?? stM1?.l1?.p ?? price - 1.2 * atr5)
      : (structConf.obHigh ?? stM1?.h1?.p ?? price + 1.2 * atr5);

    if (bias.dir !== 0 && dir !== bias.dir) {
      whyId = `Scalping Retracement / Reversal (${structConf.type}): HTF ${bias.bias}, namun M1/M5 terkonfirmasi pembalikan/retracement menuju zona utama.`;
      whyEn = `Retracement / Reversal Scalping (${structConf.type}): HTF is ${bias.bias}, but M1/M5 confirmed reversal/retracement toward primary zone.`;
    } else {
      whyId = `Scalping Searah Struktur (${structConf.type}): Harga ${ctx.f(price)} terkonfirmasi sejalan dengan bias HTF & SMA20 (${ctx.f(sma20)}).`;
      whyEn = `Trend Structure Scalping (${structConf.type}): Price ${ctx.f(price)} confirmed aligned with HTF bias & SMA20 (${ctx.f(sma20)}).`;
    }

    mode = 'MARKET';
    entry = price;
    invLevel = dir === 1 ? Math.min(origin, sma20 - 0.4 * atr5) : Math.max(origin, sma20 + 0.4 * atr5);
  }

  const order = buildOrderFromLevels({ dir, entry, invLevel, atrVal: atr5, ctx, kind: 'scalp', rrList: STYLES['Scalping'].rr });
  const minRRRequired = isCisdModel ? 1.5 : 2.0;
  const riskAmount = Math.abs(order.entry - order.sl);
  const rewardMax = Math.abs(order.tps[2] - order.entry);
  const actualRR = riskAmount > 0 ? (rewardMax / riskAmount) : 0;

  if (actualRR < minRRRequired) {
    return {
      reason: withPair(ctx.symbol, `[SKIP / SOP] RR (${actualRR.toFixed(2)}) di bawah syarat minimum modul (${minRRRequired} untuk ${isCisdModel ? 'CISD' : 'Standar'}). Tidak mengubah SL, setup di-skip.`),
      reasonEn: withPair(ctx.symbol, `[SKIP / SOP] RR (${actualRR.toFixed(2)}) below module minimum (${minRRRequired} for ${isCisdModel ? 'CISD' : 'Standard'}). SL not altered, setup skipped.`)
    };
  }

  const side = dir === 1 ? 'BUY' : 'SELL';
  const setup = `Scalping ICTxSMC · ${isCisdModel ? 'CISD Reversal' : 'Structure Confirmed'}`;
  const orderTxt = `${side} NOW`;
  const tdStr = Object.entries(bias.details).map(([k, v]) => `${k.toUpperCase()}:${v}`).join(' | ');

  const reasonId = withPair(ctx.symbol, `${orderTxt} @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])} (1:1), TP2 ${ctx.f(order.tps[1])} (1:2), TP3 ${ctx.f(order.tps[2])} (1:3). ${whyId} Top-Down [${tdStr}].`);
  const reasonEn = withPair(ctx.symbol, `${orderTxt} @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])} (1:1), TP2 ${ctx.f(order.tps[1])} (1:2), TP3 ${ctx.f(order.tps[2])} (1:3). ${whyEn} Top-Down [${tdStr}].`);

  return {
    dir,
    plan: {
      isOCO: false, orderType: mode, status: 'RUNNING',
      entry: order.entry, sl: order.sl, tps: order.tps, setup,
      chartContext: `${setup}: ${orderTxt} ${ctx.f(order.entry)} (SL ${ctx.f(order.sl)}). Live ${ctx.f(price)}`,
      zone: null,
      tag: dir === 1 ? 'Demand/CISD' : 'Supply/CISD',
    },
    meta: {
      setup, confidence: 'HIGH', riskLabel: 'MEDIUM',
      reason: reasonId,
      reasons: { id: reasonId, en: reasonEn },
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
    const st = readStructure(zoneRows, price) || readStructure(midRows, price);
    if (!st) {
      return {
        reason: withPair(ctx.symbol, `[WAIT] Belum ditemukan zona Supply/Demand valid atau struktur yang jelas pada ${cfg.label}.`),
        reasonEn: withPair(ctx.symbol, `[WAIT] No valid Supply/Demand zone or clear structure found for ${cfg.label}.`)
      };
    }
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

// ── BOT EA ENGINE — INTERACTIVE STRUCTURE & REASONING ──
const BOT_CFG = {
  minScore: 7,
  splitScore: 9,
  confidentScore: 9,
  minRR: 2.0,
  minRRCisd: 1.5,
  dispBodyAtr: 1.2,
  fvgMinAtr: 0.15,
  bufAtr: 0.10,
  minSlAtr: 0.30,
  maxSlAtrScalp: 1.50,
  maxChaseAtr: 1.50,
  lookback: 60,
  maxZoneBars: 3,
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

function findBreakerAndMitigation(c, dir, k, hasSweep) {
  const zones = [];
  if (!hasSweep && k >= 1) {
    const ob = c[k - 1];
    if (dir === 1 && ob.c < ob.o) {
      zones.push(mkZone('MITIGATION', 1, ob.h, ob.l, { label: 'MITIGATION BUY', createdIdx: k, distal: ob.l }));
    }
    if (dir === -1 && ob.c > ob.o) {
      zones.push(mkZone('MITIGATION', -1, ob.h, ob.l, { label: 'MITIGATION SELL', createdIdx: k, distal: ob.h }));
    }
  }
  for (let b = k - 2; b >= Math.max(1, k - 12); b--) {
    const cand = c[b];
    if (dir === 1 && cand.c > cand.o && c[k].c > cand.h) {
      zones.push(mkZone('BREAKER', 1, cand.h, cand.l, { label: 'BREAKER BUY', createdIdx: k, distal: cand.l }));
      break;
    }
    if (dir === -1 && cand.c < cand.o && c[k].c < cand.l) {
      zones.push(mkZone('BREAKER', -1, cand.h, cand.l, { label: 'BREAKER SELL', createdIdx: k, distal: cand.h }));
      break;
    }
  }
  return zones;
}

function scanSetups(c, atrV, ctx, price, biasDir, kzActive) {
  const out = []; const n = c.length; if (n < 25) return out;
  const { highs, lows } = findSwings(c, 2);
  const startK = Math.max(4, n - BOT_CFG.lookback);
  const minFvg = Math.max(3 * ctx.pip, BOT_CFG.fvgMinAtr * atrV);

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
        if (pen >= 1.0 * ctx.pip && back) {
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

    const bmZones = findBreakerAndMitigation(c, dir, k, !!sweep);
    cands.push(...bmZones);

    const live = cands.filter(z => {
      const from = (z.createdIdx ?? k) + 1;
      if (zoneMitigation(z, c, from) >= 0.8) return false;
      if (zoneBroken(z, c, from)) return false;
      return true;
    });
    if (!live.length) continue;

    const prio = { IFVG: 5, FVG: 3, OB: 2, BREAKER: 2, MITIGATION: 2, OTE: 1 };
    const ranked = live
      .map(z => ({ z, ov: live.filter(o => o !== z && overlaps(o, z)).length, p: prio[z.type] || 1 }))
      .sort((a, b) => b.p - a.p || b.ov - a.ov || Math.abs(a.z.mid - price) - Math.abs(b.z.mid - price));

    const zone = ranked[0].z;
    const touching = live.filter(o => o === zone || overlaps(o, zone));
    const has = t => touching.some(o => o.type === t);

    const bd = [];
    if (biasDir === dir) bd.push(['Bias HTF searah', 2]);
    if (kzActive) bd.push(['Dalam Killzone', 1]);
    if (sweep) bd.push(['Liquidity sweep valid', 2]);
    bd.push(['Displacement >= 1.2xATR', 1]);
    bd.push([sweep ? 'MSS/CHoCH valid' : 'BOS valid', 2]);
    if (has('FVG')) bd.push(['FVG fresh', 1]);
    if (has('OB')) bd.push(['OB fresh', 1]);
    if (has('OTE')) bd.push(['OTE 61.8-79%', 1]);
    if (has('IFVG')) bd.push(['IFVG terkonfirmasi', 2]);
    if (has('BREAKER') || has('MITIGATION')) bd.push(['Breaker/Mitigation', 1]);
    bd.push(['Spread & ATR normal', 1]);

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
  let t1 = pick(0.8, 1.8), t2, t3;
  if (t1 == null) { t1 = entry + dir * risk; synth = true; }
  t2 = pick(1.5, 3.0, t1);
  if (t2 == null) { t2 = dir === 1 ? Math.max(entry + 2 * risk, t1 + 0.5 * risk) : Math.min(entry - 2 * risk, t1 - 0.5 * risk); synth = true; }
  t3 = pick(2.2, 5.5, t2);
  let synth3 = false;
  if (t3 == null) { t3 = dir === 1 ? Math.max(entry + 3 * risk, t2 + risk) : Math.min(entry - 3 * risk, t2 - risk); synth3 = true; }
  return { tps: [t1, t2, t3], rr3: R(t3), synthetic: synth, synth3 };
}

function calcBotSL({ dir, entry, setup, atrV, ctx, mode }) {
  const buf = Math.max(2 * ctx.pip, BOT_CFG.bufAtr * atrV);
  const minD = Math.max(BOT_CFG.minSlAtr * atrV, slFloor('bot', ctx));
  const maxD = BOT_CFG.maxSlAtrScalp * atrV;
  const z = setup.zone;
  const zoneEdge = dir === 1 ? z.lower : z.upper;

  const order = mode === 'CONSERVATIVE'
    ? [['OB distal', setup.obDistal], ['sweep', setup.sweepExtreme]]
    : [['zona', zoneEdge], ['OB distal', setup.obDistal], ['sweep', setup.sweepExtreme]];

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

// ─── INTERACTIVE ANALYST NARRATIVE HELPERS ───
const TF_ORDER_FULL = ['d1', 'h4', 'h1', 'm30', 'm15', 'm5', 'm1'];
const TF_LABEL = { d1: 'Daily', h4: 'H4', h1: 'H1', m30: 'M30', m15: 'M15', m5: 'M5', m1: 'M1' };

function describeTF(tf, candles, lang) {
  const lbl = TF_LABEL[tf] || tf.toUpperCase();
  if (!candles || candles.length < 20) {
    return lang === 'en' ? `${lbl} — waiting for data` : `${lbl} — menunggu data`;
  }
  const price = candles[candles.length - 1].c;
  const st = readStructure(candles, price);
  if (!st) {
    return lang === 'en'
      ? `${lbl} — ranging, no clear structure`
      : `${lbl} — ranging, struktur belum jelas`;
  }
  const dirId = st.dir === 1 ? 'bullish' : 'bearish';
  if (st.bos) {
    return lang === 'en' ? `${lbl} — BOS ${dirId} confirmed` : `${lbl} — BOS ${dirId} terkonfirmasi`;
  }
  return lang === 'en' ? `${lbl} — trend ${st.src}` : `${lbl} — tren ${st.src}`;
}

function buildTopDownStory(tfMap, lang, order = TF_ORDER_FULL) {
  return order
    .filter(tf => tfMap[tf] && tfMap[tf].length >= 20)
    .map(tf => '  • ' + describeTF(tf, tfMap[tf], lang))
    .join('\n');
}

function biasWord(bias, lang) {
  if (bias.dir === 1) return 'bullish';
  if (bias.dir === -1) return 'bearish';
  return lang === 'en' ? 'neutral' : 'netral';
}

function fmtScore(bias) {
  return (bias.score >= 0 ? '+' : '') + bias.score.toFixed(2);
}

function buildAnalystView(ctx, { bias, tfStory, kz, body }) {
  const lang = ctx.lang;
  const header = lang === 'en' ? `[ANALYST — ${ctx.symbol}]` : `[ANALIS — ${ctx.symbol}]`;
  const kzTxt = kz.active ? kz.name : (lang === 'en' ? 'Outside KZ' : 'Di luar KZ');
  const synthLine = lang === 'en'
    ? `HTF bias is ${biasWord(bias, lang)} (score ${fmtScore(bias)}). Killzone: ${kzTxt}.`
    : `Bias HTF ${biasWord(bias, lang)} (skor ${fmtScore(bias)}). Killzone: ${kzTxt}.`;

  return [
    header,
    ``,
    lang === 'en' ? `📊 TOP-DOWN SCAN (HTF → LTF):` : `📊 SCAN TOP-DOWN (HTF → LTF):`,
    tfStory || (lang === 'en' ? '  (insufficient TF data)' : '  (data TF belum cukup)'),
    ``,
    `🎯 ${lang === 'en' ? 'SYNTHESIS' : 'SINTESIS'}: ${synthLine}`,
    ``,
    body,
  ].join('\n');
}

async function runBotSma20(ctx, d, botStyleRaw) {
  const { price, m1, m5, m15, h1 } = d;
  const lang = ctx.lang;
  const c5 = closedOnly(m5, 180000);

  const tfSnapshot = {
    d1: d.d1, h4: d.h4, h1,
    m30: d.m30, m15, m5: c5,
    m1: closedOnly(m1, 60000),
  };
  const tfStory = buildTopDownStory(tfSnapshot, lang);

  if (!c5 || c5.length < 25) {
    const bodyTxt = lang === 'en'
      ? `⏳ I still need more M5 candles (currently ${c5?.length || 0}/25) before I can run deep scan. Standby.`
      : `⏳ Saya masih butuh candle M5 lebih lengkap (saat ini ${c5?.length || 0}/25) sebelum deep scan. Standby.`;
    const full = withPair(ctx.symbol, buildAnalystView(ctx, {
      bias: { dir: 0, bias: 'NEUTRAL', score: 0, details: {} },
      tfStory,
      kz: { active: false, name: '—' },
      body: bodyTxt,
    }));
    return { reason: full, reasonEn: full };
  }

  const m1c = tfSnapshot.m1;
  const confTF = m1c.length >= 10 ? m1c : c5;
  const atrV = atrOf(c5, ctx.pip);
  const atrConf = atrOf(confTF, ctx.pip);
  const kz = getKillzoneStatus();
  const kzTxt = kz.active ? kz.name : (lang === 'en' ? 'Outside KZ' : 'Di luar KZ');

  const bias = multiTfBias({
    h1: h1 && h1.length >= 20 ? h1 : null,
    m15: m15 && m15.length >= 15 ? m15 : null,
    m5: c5,
  }, ['h1', 'm15', 'm5']);

  let setups = scanSetups(c5, atrV, ctx, price, bias.dir, kz.active);
  setups = setups.filter(s => s.score >= BOT_CFG.minScore);
  setups.sort((a, b) => b.score - a.score || b.formedIdx - a.formedIdx);

  const setup = setups[0];

  // ═══════════ NO SETUP — EXPLAIN WHY ═══════════
  if (!setup) {
    const nearDemand = findSDZones(c5, 1, price).slice(0, 1)[0];
    const nearSupply = findSDZones(c5, -1, price).slice(0, 1)[0];
    const nearDesc = [nearDemand, nearSupply]
      .filter(Boolean)
      .map(z => `${z.kind} ${ctx.f(z.bottom)}–${ctx.f(z.top)} (${(z.dist / atrV).toFixed(1)}x ATR)`)
      .join('  |  ')
      || (lang === 'en' ? 'no clear POI nearby' : 'tidak ada POI jelas dekat harga');

    const body = lang === 'en'
      ? [
          `❓ WHY NO SETUP YET:`,
          `I scanned the last ${c5.length} M5 candles. No structure met our minimum SOP (Confluence ≥ ${BOT_CFG.minScore}).`,
          ``,
          `What's still missing:`,
          `  • Displacement ≥ ${BOT_CFG.dispBodyAtr}x ATR on a delivery candle`,
          `  • MSS/CHoCH confirmed by close`,
          `  • Sweep of liquidity (BSL/SSL) preceding the leg`,
          `  • Fresh POI zone (OB/FVG/Breaker/IFVG) not yet mitigated`,
          ``,
          `🔍 Nearest POI: ${nearDesc}`,
          `⏳ What I'm watching: structure confirmation after a liquidity sweep at a fresh zone.`,
        ].join('\n')
      : [
          `❓ MENGAPA BELUM ADA SETUP:`,
          `Saya sudah scan ${c5.length} candle M5 terakhir. Belum ada yang lolos SOP minimal (Confluence ≥ ${BOT_CFG.minScore}).`,
          ``,
          `Syarat yang belum terpenuhi:`,
          `  • Displacement ≥ ${BOT_CFG.dispBodyAtr}x ATR pada candle delivery`,
          `  • MSS/CHoCH close-confirmed`,
          `  • Sweep likuiditas (BSL/SSL) sebelum leg displacement`,
          `  • Zona POI fresh (OB/FVG/Breaker/IFVG) yang belum dimitigasi`,
          ``,
          `🔍 POI terdekat: ${nearDesc}`,
          `⏳ Yang saya tunggu: konfirmasi struktur setelah sweep likuiditas di zona fresh.`,
        ].join('\n');

    const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, body }));
    return { reason: full, reasonEn: full };
  }

  const dir = setup.dir;
  const side = dir === 1 ? 'BUY' : 'SELL';
  const z = setup.zone;
  const zLabel = z.label || `${z.type} ${dir === 1 ? 'BUY' : 'SELL'}`;
  const zTxt = `${zLabel} ${ctx.f(z.lower)}–${ctx.f(z.upper)}`;
  const distToZone = price < z.lower ? (z.lower - price) : (price > z.upper ? (price - z.upper) : 0);

  const scoreTxt = lang === 'en'
    ? `Confluence Score ${setup.score} — ${setup.breakdown.map(x => `${x[0]} +${x[1]}`).join(', ')}`
    : `Confluence Score ${setup.score} — ${setup.breakdown.map(x => `${x[0]} +${x[1]}`).join(', ')}`;

  const sweepTxt = setup.sweep
    ? (lang === 'en'
        ? `Sweep ${setup.sweep.wickRatio >= 0.4 ? 'clean' : 'shallow'} of ${dir === 1 ? 'SSL' : 'BSL'} at ${ctx.f(setup.sweep.level)}`
        : `Sweep ${setup.sweep.wickRatio >= 0.4 ? 'bersih' : 'tipis'} ${dir === 1 ? 'SSL' : 'BSL'} di ${ctx.f(setup.sweep.level)}`)
    : (lang === 'en' ? 'BOS continuation (no prior sweep)' : 'BOS continuation (tanpa sweep sebelumnya)');

  // ═══════════ CHASE BLOCK ═══════════
  if (distToZone > BOT_CFG.maxChaseAtr * atrV) {
    const body = lang === 'en'
      ? [
          `🚫 SETUP FOUND — BUT I WON'T CHASE:`,
          `${scoreTxt}`,
          `Zone ${zTxt} is already ${(distToZone / atrV).toFixed(1)}x ATR away from live price.`,
          `Hard-Rule 5 blocks chasing. I'll only enter if price returns to the zone.`,
          ``,
          `⏳ Re-scanning for a fresher zone.`,
        ].join('\n')
      : [
          `🚫 SETUP ADA — TAPI TIDAK DIEJAR:`,
          `${scoreTxt}`,
          `Zona ${zTxt} sudah ${(distToZone / atrV).toFixed(1)}x ATR dari harga live.`,
          `Hard-Rule 5 melarang mengejar harga. Entry hanya jika harga balik ke zona.`,
          ``,
          `⏳ Saya rescan untuk zona yang lebih fresh.`,
        ].join('\n');
    const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, body }));
    return { reason: full, reasonEn: full };
  }

  const priceInZone = inZone(price, z) || distToZone <= 0.15 * atrV;

  // ═══════════ LIMIT PLACED (harga di luar zona) ═══════════
  if (!priceInZone) {
    const slr = calcBotSL({ dir, entry: z.mid, setup, atrV, ctx, mode: 'CONSERVATIVE' });
    const tg = botTargets(dir, z.mid, slr.dist, c5, m15, atrV);

    if (tg.rr3 < BOT_CFG.minRR) {
      const body = lang === 'en'
        ? `⚠️ Setup ${zTxt} valid but RR 1:${tg.rr3.toFixed(1)} < 1:${BOT_CFG.minRR.toFixed(1)}. SL will NOT be shrunk — setup skipped per SOP.`
        : `⚠️ Setup ${zTxt} valid tapi RR 1:${tg.rr3.toFixed(1)} < 1:${BOT_CFG.minRR.toFixed(1)}. SL tidak akan diperkecil — setup di-skip sesuai SOP.`;
      const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, body }));
      return { reason: full, reasonEn: full };
    }

    const isSplit = setup.score >= BOT_CFG.splitScore;
    const body = lang === 'en'
      ? [
          `💡 SETUP FOUND — LIMIT ORDERS:`,
          `${scoreTxt}`,
          ``,
          `📍 Zone: ${zTxt}`,
          `📐 ${sweepTxt}`,
          ``,
          `🛒 ${side} LIMIT @ ${ctx.f(z.mid)} ${isSplit ? '(split 40/40/20)' : '(conservative single fill)'}`,
          `🛡️ SL: ${ctx.f(slr.sl)} — ${slr.src} (structure invalidation)`,
          `🎯 TP1 ${ctx.f(tg.tps[0])}  |  TP2 ${ctx.f(tg.tps[1])}  |  TP3 ${ctx.f(tg.tps[2])}   (RR 1:${tg.rr3.toFixed(1)})`,
          ``,
          `Why SL sits at ${slr.src}: protects the entry from false wick sweeps. If ${slr.src} is broken by close, this setup is invalid.`,
        ].join('\n')
      : [
          `💡 SETUP DITEMUKAN — LIMIT ORDER:`,
          `${scoreTxt}`,
          ``,
          `📍 Zona: ${zTxt}`,
          `📐 ${sweepTxt}`,
          ``,
          `🛒 ${side} LIMIT @ ${ctx.f(z.mid)} ${isSplit ? '(split 40/40/20)' : '(konservatif, single fill)'}`,
          `🛡️ SL: ${ctx.f(slr.sl)} — ${slr.src} (invalidasi struktur)`,
          `🎯 TP1 ${ctx.f(tg.tps[0])}  |  TP2 ${ctx.f(tg.tps[1])}  |  TP3 ${ctx.f(tg.tps[2])}   (RR 1:${tg.rr3.toFixed(1)})`,
          ``,
          `Alasan SL di ${slr.src}: melindungi entry dari sapuan wick semu. Jika ${slr.src} ditembus close, setup invalid.`,
        ].join('\n');

    const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, body }));
    const setupName = `SMC/ICT Bot · ${isSplit ? 'LIMIT SPLIT (40/40/20)' : 'CONSERVATIVE LIMIT'} · ${z.type}`;

    return {
      dir,
      plan: {
        isOCO: false, orderType: 'LIMIT', status: 'PENDING',
        entry: ctx.f(z.mid), sl: ctx.f(slr.sl), tps: tg.tps.map(ctx.f),
        setup: setupName,
        chartContext: `${setupName}: ${side} Limit ${ctx.f(z.mid)} (SL ${ctx.f(slr.sl)})`,
        zone: { min: z.lower, max: z.upper }, tag: zLabel,
      },
      meta: {
        setup: setupName, confidence: 'HIGH', riskLabel: 'LOW',
        reason: full, reasons: { id: full, en: full },
        topDown: bias, state: 'LIMIT_PLACED', score: setup.score,
      },
    };
  }

  // ═══════════ HIGH CONFIDENCE — DIRECT ENTRY ═══════════
  const isHighConfidence = setup.score >= BOT_CFG.confidentScore;

  if (isHighConfidence) {
    const slr = calcBotSL({ dir, entry: price, setup, atrV, ctx, mode: 'AGGRESSIVE' });
    const tg = botTargets(dir, price, slr.dist, c5, m15, atrV);

    if (tg.rr3 < BOT_CFG.minRR) {
      const body = lang === 'en'
        ? `⚠️ High-confluence zone (Score ${setup.score}) but RR 1:${tg.rr3.toFixed(1)} < 2.0. Skipping — SL integrity preserved.`
        : `⚠️ Zona confluence tinggi (Score ${setup.score}) tapi RR 1:${tg.rr3.toFixed(1)} < 2.0. Skip — integritas SL dijaga.`;
      const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, body }));
      return { reason: full, reasonEn: full };
    }

    const body = lang === 'en'
      ? [
          `🔥 HIGH CONFLUENCE — DIRECT ENTRY:`,
          `${scoreTxt}`,
          `📍 Price already at ${zTxt} — ${sweepTxt}`,
          `⏱ Killzone: ${kzTxt}`,
          ``,
          `🛒 ${side} NOW @ ${ctx.f(price)} (direct, no confirmation lag)`,
          `🛡️ SL: ${ctx.f(slr.sl)} — ${slr.src}`,
          `🎯 TP1 ${ctx.f(tg.tps[0])}  |  TP2 ${ctx.f(tg.tps[1])}  |  TP3 ${ctx.f(tg.tps[2])}   (RR 1:${tg.rr3.toFixed(1)})`,
          ``,
          `Why direct entry: score ≥ ${BOT_CFG.confidentScore} + price already at POI + displacement already confirmed.`,
          `If ${slr.src} is broken by close, I cut — no averaging.`,
        ].join('\n')
      : [
          `🔥 HIGH CONFLUENCE — DIRECT ENTRY:`,
          `${scoreTxt}`,
          `📍 Harga sudah di ${zTxt} — ${sweepTxt}`,
          `⏱ Killzone: ${kzTxt}`,
          ``,
          `🛒 ${side} NOW @ ${ctx.f(price)} (direct, tanpa lag konfirmasi)`,
          `🛡️ SL: ${ctx.f(slr.sl)} — ${slr.src}`,
          `🎯 TP1 ${ctx.f(tg.tps[0])}  |  TP2 ${ctx.f(tg.tps[1])}  |  TP3 ${ctx.f(tg.tps[2])}   (RR 1:${tg.rr3.toFixed(1)})`,
          ``,
          `Alasan entry langsung: skor ≥ ${BOT_CFG.confidentScore} + harga di POI + displacement terbaca.`,
          `Jika ${slr.src} ditembus close, saya cut — tidak ada averaging.`,
        ].join('\n');

    const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, body }));
    const setupName = `SMC/ICT Bot · HIGH CONFIDENCE ENTRY · ${z.type}`;

    return {
      dir,
      plan: {
        isOCO: false, orderType: 'MARKET', status: 'RUNNING',
        entry: ctx.f(price), sl: ctx.f(slr.sl), tps: tg.tps.map(ctx.f),
        setup: setupName,
        chartContext: `${setupName}: ${side} NOW ${ctx.f(price)}`,
        zone: { min: z.lower, max: z.upper }, tag: zLabel,
      },
      meta: {
        setup: setupName, confidence: 'HIGH', riskLabel: 'MEDIUM',
        reason: full, reasons: { id: full, en: full },
        topDown: bias, state: 'CONFIRMED_DIRECT', score: setup.score,
      },
    };
  }

  // ═══════════ IN-ZONE WAITING FOR CONFIRMATION ═══════════
  const structConf = validateStructureAndCISD(confTF, atrConf);
  const barsInZone = Math.max(0, c5.length - 1 - setup.formedIdx);

  if (!structConf.valid || structConf.dir !== dir) {
    if (barsInZone > BOT_CFG.maxZoneBars) {
      const body = lang === 'en'
        ? `⏰ ZONE EXPIRED — ${barsInZone} candles inside ${zTxt} without a close-confirmed MSS/CHoCH/CISD.\nCancelling and re-scanning. No chase.`
        : `⏰ ZONA EXPIRED — ${barsInZone} candle di ${zTxt} tanpa MSS/CHoCH/CISD close-confirmed.\nDibatalkan, rescan. Tanpa chase.`;
      const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, body }));
      return { reason: full, reasonEn: full };
    }

    const triggerSide = dir === 1 ? 'Micro CHoCH/BOS bullish' : 'Micro CHoCH/BOS bearish';
    const body = lang === 'en'
      ? [
          `⏳ PRICE IS IN ZONE — WAITING FOR TRIGGER:`,
          `${scoreTxt}`,
          `📍 ${zTxt} — price inside/touching`,
          `⏱ ${barsInZone}/${BOT_CFG.maxZoneBars} candles in zone — zone expires soon`,
          ``,
          `What I need before pulling the trigger:`,
          `  • ${triggerSide} close-confirmed on M1/M5, OR`,
          `  • CISD (Change in State of Delivery) reversal close`,
          ``,
          `No confirmation yet — no entry. Discipline over FOMO.`,
        ].join('\n')
      : [
          `⏳ HARGA DI ZONA — MENUNGGU TRIGGER:`,
          `${scoreTxt}`,
          `📍 ${zTxt} — harga di dalam/menyentuh`,
          `⏱ ${barsInZone}/${BOT_CFG.maxZoneBars} candle di zona — zona segera expire`,
          ``,
          `Yang saya butuh sebelum entry:`,
          `  • ${triggerSide} close-confirmed di M1/M5, ATAU`,
          `  • CISD (Change in State of Delivery) reversal close`,
          ``,
          `Belum ada konfirmasi — tidak entry. Disiplin di atas FOMO.`,
        ].join('\n');

    const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, body }));
    return { reason: full, reasonEn: full };
  }

  // ═══════════ CONFIRMED ENTRY ═══════════
  const isCisd = structConf.model === 'CISD';
  const minRRRequired = isCisd ? BOT_CFG.minRRCisd : BOT_CFG.minRR;

  const slr = calcBotSL({ dir, entry: price, setup, atrV, ctx, mode: 'AGGRESSIVE' });
  const tg = botTargets(dir, price, slr.dist, c5, m15, atrV);

  if (tg.rr3 < minRRRequired) {
    const body = lang === 'en'
      ? `⚠️ ${structConf.type} appeared but RR 1:${tg.rr3.toFixed(1)} < ${minRRRequired}. SL not altered — setup cancelled.`
      : `⚠️ ${structConf.type} muncul tapi RR 1:${tg.rr3.toFixed(1)} < ${minRRRequired}. SL tidak diubah — setup dibatalkan.`;
    const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, body }));
    return { reason: full, reasonEn: full };
  }

  const body = lang === 'en'
    ? [
        `✅ CONFIRMED — EXECUTING ${side}:`,
        `${scoreTxt}`,
        `📍 Zone ${zTxt} + trigger: ${structConf.type}`,
        `📐 ${sweepTxt}`,
        ``,
        `🛒 ${side} NOW @ ${ctx.f(price)}`,
        `🛡️ SL: ${ctx.f(slr.sl)} — ${slr.src} (structure invalidation)`,
        `🎯 TP1 ${ctx.f(tg.tps[0])}  |  TP2 ${ctx.f(tg.tps[1])}  |  TP3 ${ctx.f(tg.tps[2])}   (RR 1:${tg.rr3.toFixed(1)})`,
        ``,
        `Why now: close-candle confirmation just printed at the zone, direction aligned with HTF bias.`,
        `SL at ${slr.src} — if the zone breaks, setup is invalid, I'm out.`,
      ].join('\n')
    : [
        `✅ TERKONFIRMASI — EKSEKUSI ${side}:`,
        `${scoreTxt}`,
        `📍 Zona ${zTxt} + trigger: ${structConf.type}`,
        `📐 ${sweepTxt}`,
        ``,
        `🛒 ${side} NOW @ ${ctx.f(price)}`,
        `🛡️ SL: ${ctx.f(slr.sl)} — ${slr.src} (invalidasi struktur)`,
        `🎯 TP1 ${ctx.f(tg.tps[0])}  |  TP2 ${ctx.f(tg.tps[1])}  |  TP3 ${ctx.f(tg.tps[2])}   (RR 1:${tg.rr3.toFixed(1)})`,
        ``,
        `Alasan entry sekarang: close-candle konfirmasi sudah muncul di zona, arah sejalan bias HTF.`,
        `SL di ${slr.src} — jika zona break, setup invalid, saya keluar.`,
      ].join('\n');

  const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, body }));
  const setupName = `SMC/ICT Bot · ${isCisd ? 'CISD Reversal' : 'Structure Confirmed'} · ${z.type}`;

  return {
    dir,
    plan: {
      isOCO: false, orderType: 'MARKET', status: 'RUNNING',
      entry: ctx.f(price), sl: ctx.f(slr.sl), tps: tg.tps.map(ctx.f),
      setup: setupName,
      chartContext: `${setupName}: ${side} NOW ${ctx.f(price)} (${structConf.type})`,
      zone: { min: z.lower, max: z.upper }, tag: zLabel,
    },
    meta: {
      setup: setupName, confidence: 'HIGH', riskLabel: 'MEDIUM',
      reason: full, reasons: { id: full, en: full },
      topDown: bias, state: 'CONFIRMED', score: setup.score,
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
    state: meta.state || null,
    score: meta.score ?? null,
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
3. Identifikasi dengan presisi: Market Structure (BOS, CHoCH, HH-HL, LH-LL), Zona Supply/Demand, Order Block, FVG, IFVG, Breaker/Mitigation, Liquidity Sweep (BSL/SSL), CISD (Change in State of Delivery) + Displacement, dan posisi harga terhadap SMA 20.
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

// ── QWEN REASONING (SINGKAT & PADAT UNTUK MANUAL) ──
async function qwenReasonDual(signal, ctx, styleName, lang) {
  if (!QWEN_KEYS.length) return null;
  const sys = 'You are an institutional SMC/ICT trading analyst. Provide a concise, punchy, and professional reasoning (short and dense / singkat padat) explaining the market structure, entry reason, and SL rationale in valid JSON format: {"id": "...", "en": "..."}. Do not change price levels.';
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

  const tfsWanted = isAutoBot ? ['m1', 'm5', 'm15', 'h1'] : (STYLES[styleName]?.tfs || ['h1', 'm15', 'm5']);
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

  // ── PERUBAHAN PENTING: Standby Tetap Mengembalikan `ok: true` ──
  if (!result || !result.plan) {
    const fallbackReasonId = result?.reason || msg('id', 'noSetup');
    const fallbackReasonEn = result?.reasonEn || msg('en', 'noSetup');
    
    const standbySignal = {
      signal: 'NONE',
      orderType: 'NONE',
      fill: 'NONE',
      status: 'STANDBY',
      entry: null, sl: null, tp1: null, tp2: null, tp3: null,
      setup: 'STANDBY / SCANNING',
      confidence: 'NONE', 
      risk: 'NONE',
      reason: lang === 'en' ? fallbackReasonEn : fallbackReasonId,
      reasons: { id: fallbackReasonId, en: fallbackReasonEn },
      chartContext: '', topDown: null, state: 'STANDBY', score: null
    };

    return res.status(200).json({ 
      ok: true, 
      mode: isAutoBot ? 'bot' : 'candles', 
      symbol, 
      style: styleName, 
      price, 
      signal: standbySignal 
    });
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
