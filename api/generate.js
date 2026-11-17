// api/generate.js
// v119 — respons konsisten (reason/message/error), bot menerima satu order (auto: true),
// vision memakai AI sungguhan, akses ditolak saat KV error, fallback candle TickerLayer.

export const config = {
  maxDuration: 60,
};

const KV_KEY = 'alu_clients';
const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

// ── AI (vision) ──
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/$/, '');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || 'claude-sonnet-5.5';
const VISION_TIMEOUT_MS = 50000;
const VISION_MAX_TOKENS = 800;

// ── TICKERLAYER (fallback candle) ──
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
  'Day Trading': { label: 'Scalping Konservatif · Limit Zona Fresh', kind: 'day', rr: [1.0, 2.0, 3.0] },
  'Intraday': { label: 'Intraday · Wajib M15 + H1 + H4', kind: 'intraday', rr: [1.5, 2.5, 4.0] },
  'Swing': { label: 'Swing · Wajib D1 + H4 + H1', kind: 'swing', rr: [3.0, 5.0] },
};

const MIN_BARS = { m1: 100, m5: 40, m15: 120 };
const ZONE_ATR_PERIOD = 14;
const ZONE_DISP_ATR = 1.2;
const ZONE_FRESH_ONLY = true;
const DAY_MAX_DIST_ATR = 4.0;
const MAX_DIST_ATR = { day: DAY_MAX_DIST_ATR, intraday: 6, swing: 10 };
const GOLD_SL_PIPS = { scalp: [25, 30], day: [50, 120], intraday: [80, 200], swing: [150, 300] };
const ATR_SL_MULT = { scalp: [0.5, 2.5], day: [1, 3], intraday: [1, 3], swing: [0.5, 2] };

const TL_SPAN = {
  '1m': { mult: 1, span: 'minute', minutes: 1 },
  '5m': { mult: 5, span: 'minute', minutes: 5 },
  '15m': { mult: 15, span: 'minute', minutes: 15 },
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

// Fetch dengan timeout yang juga mencakup pembacaan body
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
  } finally {
    clearTimeout(timer);
  }
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

// ── AKSES ──
async function checkAccess(email, isAutoBot) {
  if (!email) return { ok: false, key: 'noEmail' };
  if (!kvEnabled()) return { ok: true, status: 'dev' };

  let raw;
  try {
    raw = await kvCmd(['GET', KV_KEY]);
  } catch (e) {
    console.error('KV access error:', e.message);
    return { ok: false, key: 'kvError' };
  }
  if (!raw) return { ok: true, status: 'admin' }; // belum ada klien terdaftar

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
  } catch (e) {
    console.error('markTrialAsUsed:', e.message);
  }
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
    } catch (e) {
      console.warn(`TL key ${i}:`, e.message);
    }
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
  const startMs = now - Math.max(Math.ceil(need * 1.2 * tf.minutes * 60000), TL_MIN_WINDOW_MS) - 86400000;
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
    zones.push({ top, bottom, sl, dist, fresh: true });
  }
  return zones.sort((x, y) => x.dist - y.dist);
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

  if (price > h1.p) return { dir: 1, src: 'BOS naik', bos: true, h1, l1 };
  if (price < l1.p) return { dir: -1, src: 'BOS turun', bos: true, h1, l1 };
  if (h1.p > h0.p && l1.p > l0.p) return { dir: 1, src: 'HH-HL', bos: false, h1, l1 };
  if (h1.p < h0.p && l1.p < l0.p) return { dir: -1, src: 'LH-LL', bos: false, h1, l1 };
  return null;
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

// ── STRATEGI ──
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
    label: `${dir === 1 ? 'Buy' : 'Sell'} Limit · ${dir === 1 ? 'Demand' : 'Supply'} (50% Zone)`,
    zone: zoneOut,
    tag: dir === 1 ? 'Demand' : 'Supply',
  };
}

async function runLimitOco(ctx, d, styleName) {
  const kind = STYLES[styleName].kind;
  const rr = STYLES[styleName].rr;
  const { price, m5, m15 } = d;
  const zoneRows = kind === 'day' && m5.length >= 40 && m15.length < 40 ? m5 : m15;
  const atrVal = atrOf(zoneRows, ctx.pip);
  const maxDist = (MAX_DIST_ATR[kind] || 4) * atrVal;

  const demand = findSDZones(zoneRows, 1, price)
    .filter(z => z.top < price && (price - (z.top + z.bottom) / 2) <= maxDist);
  const supply = findSDZones(zoneRows, -1, price)
    .filter(z => z.bottom > price && ((z.top + z.bottom) / 2 - price) <= maxDist);

  const base = { atrVal, ctx, kind, rrList: rr, price };
  const buy = demand.length ? buildStrictOrder({ dir: 1, zone: demand[0], ...base }) : null;
  const sell = supply.length ? buildStrictOrder({ dir: -1, zone: supply[0], ...base }) : null;

  const setup = STYLES[styleName].label;

  if (!buy && !sell) {
    return { reason: withPair(ctx.symbol, `${setup}: tidak ada zona demand/supply fresh dekat harga. Tunggu zona baru terbentuk.`) };
  }

  const leg = o => ({ ...o, orderType: 'LIMIT', status: 'PENDING' });

  if (buy && sell) {
    const chartContext = `${setup}: Buy Limit ${ctx.f(buy.entry)} (SL ${ctx.f(buy.sl)}) & Sell Limit ${ctx.f(sell.entry)} (SL ${ctx.f(sell.sl)}). Live ${ctx.f(price)}`;
    const manual = `${setup}. BUY LIMIT @ ${ctx.f(buy.entry)} (SL ${ctx.f(buy.sl)}) & SELL LIMIT @ ${ctx.f(sell.entry)} (SL ${ctx.f(sell.sl)}).`;
    return {
      plan: { isOCO: true, orders: [leg(buy), leg(sell)], setup, chartContext },
      meta: {
        setup,
        confidence: 'HIGH',
        riskLabel: kind === 'day' ? 'MEDIUM' : 'LOW',
        reason: withPair(ctx.symbol, manual),
      },
    };
  }

  const o = leg(buy || sell);
  const side = o.dir === 1 ? 'BUY' : 'SELL';
  const zoneName = o.dir === 1 ? 'demand' : 'supply';
  const oppName = o.dir === 1 ? 'supply' : 'demand';
  const oneSetup = `${setup} · 1 Zona Fresh`;
  const chartContext = `${oneSetup}: ${side} Limit ${ctx.f(o.entry)} (SL ${ctx.f(o.sl)}). Live ${ctx.f(price)}`;
  const reason = withPair(ctx.symbol,
    `${oneSetup}. ${side} LIMIT @ ${ctx.f(o.entry)}, SL ${ctx.f(o.sl)}, TP1 ${ctx.f(o.tps[0])}. Hanya zona ${zoneName} yang fresh; zona ${oppName} tidak ada yang fresh sehingga tidak dipasang.`);

  return {
    dir: o.dir,
    plan: {
      isOCO: false, orderType: 'LIMIT', status: 'PENDING',
      entry: o.entry, sl: o.sl, tps: o.tps, setup: oneSetup, chartContext,
      zone: o.zone, tag: o.tag,
    },
    meta: { setup: oneSetup, confidence: 'MEDIUM', riskLabel: kind === 'day' ? 'MEDIUM' : 'LOW', reason },
  };
}

async function runScalp30Pips(ctx, d) {
  const { price, m1, m5, m15 } = d;
  const base = m5.length >= 40 ? m5 : m15;
  const atr5 = atrOf(base, ctx.pip);
  const atrFast = m1 && m1.length >= 30 ? atrOf(m1, ctx.pip) : atr5;

  const closes = base.map(c => c.c);
  const ema9 = emaLast(closes, 9);
  const ema21 = emaLast(closes, 21);
  const emaDir = ema9 >= ema21 ? 1 : -1;

  const st = readStructure(base, price);
  let dir = emaDir, src = 'EMA9/21';
  if (st) {
    dir = st.dir;
    src = st.src;
    if (st.dir !== emaDir && !st.bos) {
      return { reason: withPair(ctx.symbol, 'Scalping Agresif: struktur M5 dan EMA9/21 belum searah. Tunggu konfirmasi.') };
    }
  }

  const origin = st ? (dir === 1 ? st.l1.p : st.h1.p) : price - dir * 1.5 * atrFast;
  const stretch = dir * (price - ema9) / atr5;
  let mode = 'MARKET', entry = price, why = 'harga masih dekat EMA9';

  if (stretch > 0.8) {
    const legMid = (origin + price) / 2;
    const pb = dir === 1 ? Math.max(legMid, ema21) : Math.min(legMid, ema21);
    const gap = dir * (price - pb);
    if (gap >= 0.4 * atr5) {
      const e = price - dir * Math.min(gap, 1.5 * atr5);
      if (dir * (e - origin) >= 0.2 * atr5) {
        mode = 'LIMIT';
        entry = e;
        why = 'harga sudah melebar dari EMA9, tunggu pullback';
      }
    }
  }

  if (mode === 'LIMIT') {
    if (dir === 1 && entry >= price) entry = price - 0.4 * atr5;
    if (dir === -1 && entry <= price) entry = price + 0.4 * atr5;
  }

  const tpDistance = 30 * ctx.pip;
  const riskDistance = Math.max(15 * ctx.pip, 1.2 * atr5);
  const sl = entry - dir * riskDistance;
  const tps = [
    Number((entry + dir * tpDistance).toFixed(ctx.dec)),
    Number((entry + dir * (tpDistance * 1.5)).toFixed(ctx.dec)),
  ];

  const side = dir === 1 ? 'BUY' : 'SELL';
  const setup = mode === 'MARKET' ? 'Scalping 30 Pips (Market Now)' : 'Scalping 30 Pips (Pullback Limit)';
  const orderTxt = mode === 'MARKET' ? `${side} NOW` : `${side} LIMIT`;
  const reason = withPair(ctx.symbol,
    `${orderTxt} @ ${ctx.f(entry)}, SL ${ctx.f(sl)}, TP ${ctx.f(tps[0])} (Target 30 Pips). Struktur: ${src}; ${why}.`);

  return {
    dir,
    plan: {
      isOCO: false,
      orderType: mode,
      status: mode === 'MARKET' ? 'RUNNING' : 'PENDING',
      entry, sl, tps, setup,
      chartContext: `${setup}: ${orderTxt} ${ctx.f(entry)} (SL ${ctx.f(sl)}, TP 30 Pips). Live ${ctx.f(price)}`,
    },
    meta: { setup, confidence: 'HIGH', riskLabel: 'HIGH', reason },
  };
}

const RUNNERS = {
  'Scalping': runScalp30Pips,
  'Scalping EMA': runScalp30Pips,
  'Day Trading': (ctx, d) => runLimitOco(ctx, d, 'Day Trading'),
  'Intraday': (ctx, d) => runLimitOco(ctx, d, 'Intraday'),
  'Swing': (ctx, d) => runLimitOco(ctx, d, 'Swing'),
};

function normStyle(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (k.includes('swing')) return 'Swing';
  if (k.includes('intraday')) return 'Intraday';
  if (k.includes('scalp')) return 'Scalping';
  return 'Day Trading';
}

// Hasil strategi → format sinyal yang dibaca frontend
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

// Bot hanya menerima satu order: pilih sisi yang paling dekat dengan harga
function pickSingleForBot(result, price, ctx) {
  const o = result.plan.orders.reduce((a, b) =>
    (Math.abs(b.entry - price) < Math.abs(a.entry - price) ? b : a));
  const side = o.dir === 1 ? 'BUY' : 'SELL';
  const setup = `${result.meta.setup} · Bot`;
  const reason = withPair(ctx.symbol,
    `${setup}. ${side} LIMIT @ ${ctx.f(o.entry)}, SL ${ctx.f(o.sl)}, TP1 ${ctx.f(o.tps[0])}. Bot memilih zona terdekat dari harga.`);
  return {
    dir: o.dir,
    plan: {
      isOCO: false, orderType: 'LIMIT', status: 'PENDING',
      entry: o.entry, sl: o.sl, tps: o.tps, setup,
      chartContext: `${setup}: ${side} Limit ${ctx.f(o.entry)} (SL ${ctx.f(o.sl)}). Live ${ctx.f(price)}`,
      zone: o.zone, tag: o.tag,
    },
    meta: { setup, confidence: result.meta.confidence, riskLabel: result.meta.riskLabel, reason },
  };
}

// ── VISION (AI) ──
const VISION_SYSTEM = `Kamu analis chart trading (SMC/ICT). Analisis screenshot chart yang dikirim.
Balas HANYA JSON valid, tanpa markdown dan tanpa teks lain, dengan format:
{"signal":"BUY|SELL|NONE","orderType":"MARKET|LIMIT","entry":0,"sl":0,"tp1":0,"tp2":0,"tp3":0,"setup":"","confidence":"HIGH|MEDIUM|LOW","risk":"LOW|MEDIUM|HIGH","reason":""}
Aturan:
- BUY: sl < entry < tp1 < tp2 < tp3. SELL: sl > entry > tp1 > tp2 > tp3.
- Baca harga dari sumbu harga di gambar. Jika harga tidak terbaca, balas signal NONE.
- Jika tidak ada setup valid, balas {"signal":"NONE","reason":"alasan singkat"}.`;

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

// Mengembalikan pesan error, atau null jika sinyal valid
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
    reason,
    reasons: { [lang]: reason },
    chartContext: '',
    zone: null, zoneLabel: '', zoneNote: '',
    source: 'VISION_AI',
  };
}

async function runVisionAnalysis(images, style, lang) {
  if (!OPENAI_API_KEY) return { ok: false, reason: msg(lang, 'noKey') };

  const imgs = images.filter(s => typeof s === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(s));
  if (!imgs.length) return { ok: false, reason: msg(lang, 'badImage') };

  const langName = lang === 'en' ? 'English' : 'Indonesian';
  const userContent = [
    { type: 'text', text: `Gaya trading: ${style}. Tulis field reason dalam bahasa ${langName}.` },
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
        { role: 'system', content: VISION_SYSTEM },
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

// ── HANDLER ──
async function handleVision(body, lang, res) {
  const images = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
  const style = normStyle(body.style || body.mode);
  const out = await runVisionAnalysis(images, style, lang);
  if (!out.ok) return fail(res, out.reason);
  return res.status(200).json({ ok: true, mode: 'vision', symbol: 'VISION', style, signal: out.signal });
}

async function handleCandles(body, lang, res, { email, isAutoBot }) {
  const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
  const style = normStyle(body.style || body.mode);
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

  const m1 = clientCandles(body, 'm1');
  let m5 = clientCandles(body, 'm5');
  let m15 = clientCandles(body, 'm15');

  if (m5.length < MIN_BARS.m5 && m15.length < MIN_BARS.m5) {
    try {
      m5 = await fetchTickerLayerRows(symbol, '5m', 200);
      m15 = await fetchTickerLayerRows(symbol, '15m', 200);
    } catch (e) {
      console.warn('fallback candle:', e.message);
    }
    if (m5.length < MIN_BARS.m5 && m15.length < MIN_BARS.m5) return fail(res, msg(lang, 'noCandles'));
  }

  const m5f = m5.length ? m5 : m15;
  const m15f = m15.length ? m15 : m5;

  const result = await RUNNERS[style](ctx, { price, m1, m5: m5f, m15: m15f });
  if (!result || !result.plan) return fail(res, result?.reason || msg(lang, 'noSetup'));

  const final = isAutoBot && result.plan.isOCO ? pickSingleForBot(result, price, ctx) : result;

  if (isAutoBot) await markTrialAsUsed(email);

  return res.status(200).json({
    ok: true, mode: 'candles', symbol, style, price,
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
    const isAutoBot = !!(body.auto || body.bot);
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
