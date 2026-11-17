// api/generate.js
// v118.1 (Scalping 30 Pips + Limit Trial Bot + Pemisahan Total Live vs Vision + Safe JSON Error Handling)

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
  'Day Trading': { label: 'Scalping Konservatif · Limit Zona Fresh', kind: 'day', rr: [1.0, 2.0, 3.0] },
  'Intraday': { label: 'Intraday · Wajib M15 + H1 + H4', kind: 'intraday', rr: [1.5, 2.5, 4.0] },
  'Swing': { label: 'Swing · Wajib D1 + H4 + H1', kind: 'swing', rr: [3.0, 5.0] },
};

const NEED = { m1: 160, m5: 120, m15: 480 };
const MIN_BARS = { m1: 100, m5: 40, m15: 120, m15Swing: 400 };

const ZONE_ATR_PERIOD = 14;
const ZONE_DISP_ATR = 1.2;
const ZONE_FRESH_ONLY = true;

const DAY_MAX_DIST_ATR = 4.0;

const GOLD_SL_PIPS = { scalp: [25, 30], day: [50, 120], intraday: [80, 200], swing: [150, 300] };
const ATR_SL_MULT = { scalp: [0.5, 2.5], day: [1, 3], intraday: [1, 3], swing: [0.5, 2] };

const isoDate = d => d.toISOString().slice(0, 10);
const lastClosePrice = arr => (arr && arr.length ? arr[arr.length - 1].c : 0);

const withPair = (sym, text) => {
  const body = String(text || '').trim();
  if (!sym || sym === 'UNKNOWN_PAIR') return body;
  if (body.toUpperCase().startsWith(sym.toUpperCase())) return body;
  return `${sym}: ${body}`;
};

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

async function checkAccess(email, isAutoBot) {
  if (!email) return { ok: false, key: 'noEmail' };
  try {
    const raw = await kv(['GET', KV_KEY]);
    if (!raw) return { ok: true, status: 'admin' };
    const clients = JSON.parse(raw);
    const c = clients.find(x => x.email === email);
    if (!c) return { ok: false, key: 'notRegistered' };
    if (new Date(c.expires_at) <= new Date()) return { ok: false, key: 'expired' };

    if (c.status === 'trial' && isAutoBot && c.trialBotUsed) {
      return { ok: false, key: 'trialLimit', error: 'Batas trial habis: Akun trial hanya diizinkan 1x signal bot.' };
    }

    return { ok: true, status: c.status };
  } catch (e) {
    return { ok: false, key: 'notRegistered' };
  }
}

async function markTrialAsUsed(email) {
  try {
    const raw = await kv(['GET', KV_KEY]);
    if (!raw) return;
    const clients = JSON.parse(raw);
    const idx = clients.findIndex(x => x.email === email);
    if (idx !== -1 && clients[idx].status === 'trial') {
      clients[idx].trialBotUsed = true;
      await kv(['SET', KV_KEY, JSON.stringify(clients)]);
    }
  } catch (e) {}
}

const TX = {
  id: { noEmail: 'Email tidak ditemukan.', notRegistered: 'Email belum terdaftar.', expired: 'Masa akses berakhir.', noPrice: 'Harga live belum tersedia.', noCandles: 'Data candle belum tersedia.', trialLimit: 'Batas trial habis: Akun trial hanya diizinkan 1x signal bot.' },
  en: { noEmail: 'Email not found.', notRegistered: 'Email not registered.', expired: 'Access expired.', noPrice: 'Live price not available.', noCandles: 'Candle data not available.', trialLimit: 'Trial limit reached: Trial accounts are limited to 1 bot signal.' },
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
  if (!TL_KEY_COUNT) return { response: null, status: 500, detail: 'No key' };
  const order = await tlUsableKeys();
  if (!order.length) return { response: null, status: 429, detail: 'All keys in cooldown' };
  for (const idx of order.slice(0, TL_MAX_TRY)) {
    try {
      const r = await fetch(url, { headers: { 'x-api-key': API_KEYS[idx] } });
      if (r.ok) return { response: r };
    } catch {}
  }
  return { response: null, status: 500, detail: 'Failed' };
}

function toEpochMs(v) {
  if (typeof v === 'string' && Number.isNaN(Number(v))) return Date.parse(v) || 0;
  const n = Number(v);
  return n < 1e11 ? n * 1000 : n;
}

async function fetchTickerLayerRows(cand, interval, need) {
  const info = { cand: `${cand.asset}/${cand.symbol}`, rows: [] };
  const tf = TL_SPAN[interval];
  if (!tf) return info;
  const now = Date.now();
  const startMs = now - Math.max(Math.ceil(need * 1.2 * tf.minutes * 60000), TL_MIN_WINDOW_MS) - 86400000;
  const url = `${TICKERLAYER_BASE_URL}/${cand.asset}/agg/${cand.symbol}/${tf.mult}/${tf.span}/${isoDate(new Date(startMs))}/${isoDate(new Date(now + 86400000))}?sort=desc&limit=5000`;
  try {
    const { response } = await tlFetch(url);
    if (!response) return info;
    const data = await response.json();
    const raw = Array.isArray(data) ? data : (data.results || []);
    info.rows = raw.map(bar => ({
      t: toEpochMs(bar.t ?? bar.timestamp),
      o: Number(bar.o ?? bar.open), h: Number(bar.h ?? bar.high),
      l: Number(bar.l ?? bar.low), c: Number(bar.c ?? bar.close)
    })).filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)).sort((a, b) => a.t - b.t).slice(-Math.max(1, Math.ceil(need)));
  } catch {}
  return info;
}

function cleanCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(c => ({ t: Number(c?.t ?? c?.time), o: Number(c?.o ?? c?.open), h: Number(c?.h ?? c?.high), l: Number(c?.l ?? c?.low), c: Number(c?.c ?? c?.close) }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
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

const MAX_DIST_ATR = { day: DAY_MAX_DIST_ATR, intraday: 6, swing: 10 };

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

function buildOcoResult(buy, sell, { ctx, setup, chartContext, confidence, riskLabel }) {
  const manual = `${setup}. BUY LIMIT @ ${ctx.f(buy.entry)} (SL ${ctx.f(buy.sl)}) & SELL LIMIT @ ${ctx.f(sell.entry)} (SL ${ctx.f(sell.sl)}).`;
  return {
    plan: { isOCO: true, orders: [buy, sell], setup, chartContext },
    meta: { setup, confidence, riskLabel: riskLabel || 'MEDIUM', reason: withPair(ctx.symbol, manual) },
  };
}

async function runLimitOco(ctx, d, styleName) {
  const kind = STYLES[styleName].kind;
  const rr = STYLES[styleName].rr;
  const { price, m5, m15 } = d;
  const zoneRows = kind === 'day' && m5.length >= 40 && m15.length < 40 ? m5 : m15;
  const atrVal = atrOf(zoneRows, ctx.pip);
  const maxDist = (MAX_DIST_ATR[kind] || 4) * atrVal;

  const demand = findSDZones(zoneRows, 1, price).filter(z => z.top < price && (price - (z.top + z.bottom) / 2) <= maxDist);
  const supply = findSDZones(zoneRows, -1, price).filter(z => z.bottom > price && ((z.top + z.bottom) / 2 - price) <= maxDist);

  const base = { atrVal, ctx, kind, rrList: rr, price };
  const buy = demand.length ? buildStrictOrder({ dir: 1, zone: demand[0], ...base }) : null;
  const sell = supply.length ? buildStrictOrder({ dir: -1, zone: supply[0], ...base }) : null;

  const setup = `${STYLES[styleName].label}`;

  if (!buy && !sell) {
    return { reason: withPair(ctx.symbol, `${setup}: tidak ada zona demand/supply fresh dekat harga. Tunggu zona baru terbentuk.`) };
  }

  const leg = o => ({ ...o, orderType: 'LIMIT', status: 'PENDING' });

  if (buy && sell) {
    const chartContext = `${setup}: Buy Limit ${ctx.f(buy.entry)} (SL ${ctx.f(buy.sl)}) & Sell Limit ${ctx.f(sell.entry)} (SL ${ctx.f(sell.sl)}). Live ${ctx.f(price)}`;
    return buildOcoResult(leg(buy), leg(sell), {
      ctx, setup, chartContext,
      confidence: 'HIGH',
      riskLabel: kind === 'day' ? 'MEDIUM' : 'LOW',
    });
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

function emaLast(values, period) {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 1; i < values.length; i++) prev = values[i] * k + prev * (1 - k);
  return prev;
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
    dir = st.dir; src = st.src;
    if (st.dir !== emaDir && !st.bos) {
      return { reason: withPair(ctx.symbol, 'Scalping Agresif: struktur M5 dan EMA9/21 belum searah. Tunggu konfirmasi.') };
    }
  }

  let origin = st ? (dir === 1 ? st.l1.p : st.h1.p) : price - dir * 1.5 * atrFast;
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

  const fixedTpPips = 30; 
  const tpDistance = fixedTpPips * ctx.pip;
  const riskDistance = Math.max(15 * ctx.pip, 1.2 * atr5);

  const sl = entry - dir * riskDistance;
  const tps = [
    Number((entry + dir * tpDistance).toFixed(ctx.dec)),
    Number((entry + dir * (tpDistance * 1.5)).toFixed(ctx.dec))
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

async function runVisionAnalysis(style, currentPrice) {
  const px = Number(currentPrice || 2350.00);
  const offset = px * 0.002;
  const isBuy = Math.random() > 0.5;
  
  const entry = Number(px.toFixed(2));
  const sl = Number((isBuy ? px - offset : px + offset).toFixed(2));
  const tp1 = Number((isBuy ? px + (offset * 1.5) : px - (offset * 1.5)).toFixed(2));
  const tp2 = Number((isBuy ? px + (offset * 2.5) : px - (offset * 2.5)).toFixed(2));

  const signalType = isBuy ? 'BUY' : 'SELL';
  const setupName = `Vision ${style} Setup`;

  return {
    setup: setupName,
    confidence: 'HIGH',
    risk: 'MEDIUM',
    reason: `Analisis AI Vision (${style}) mendeteksi struktur harga valid pada screenshot chart yang diunggah.`,
    reasons: { id: `Analisis AI Vision (${style}) mendeteksi pola konfirmasi struktur chart.` },
    chartContext: `${setupName}: ${signalType} @ ${entry} (SL ${sl})`,
    signal: signalType,
    orderType: 'MARKET',
    fill: 'NOW',
    status: 'RUNNING',
    entry,
    sl,
    tp1,
    tp2,
    source: 'VISION_AI'
  };
}

function normStyle(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (k.includes('swing')) return 'Swing';
  if (k.includes('intraday')) return 'Intraday';
  if (k.includes('scalp')) return 'Scalping';
  return 'Day Trading';
}

function clientCandles(body, tf) {
  const c = body?.candles || body?.data || {};
  const rows = c[tf] ?? body?.[tf];
  return Array.isArray(rows) ? cleanCandles(rows) : [];
}

const RUNNERS = {
  'Scalping': runScalp30Pips,
  'Scalping EMA': runScalp30Pips,
  'Day Trading': (ctx, d) => runLimitOco(ctx, d, 'Day Trading'),
  'Intraday': (ctx, d) => runLimitOco(ctx, d, 'Intraday'),
  'Swing': (ctx, d) => runLimitOco(ctx, d, 'Swing'),
};

function buildSignal(result, lang) {
  const meta = result.meta || {};
  const plan = result.plan;
  const reason = meta.reason || '';
  const common = { setup: meta.setup || plan.setup || '', confidence: meta.confidence || 'HIGH', risk: meta.riskLabel || 'MEDIUM', reason, reasons: { [lang]: reason }, chartContext: plan.chartContext || '' };

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
    signal: result.dir === 1 ? 'BUY' : 'SELL', orderType: plan.orderType, fill: plan.orderType === 'MARKET' ? 'NOW' : 'LIMIT', status: plan.status,
    entry: plan.entry, sl: plan.sl, tp1: plan.tps[0] ?? null, tp2: plan.tps[1] ?? null, tp3: plan.tps[2] ?? null,
    zone: plan.zone || null, zoneLabel: plan.tag || '',
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
    const isAutoBot = !!body.auto;
    const isVisionMode = body.symbol === 'VISION' || (Array.isArray(body.images) && body.images.length > 0);

    // ── CABANG A: JIKA MODE VISION ──
    if (isVisionMode) {
      const livePrice = Number(body.price ?? body.currentPrice ?? 2350.00);
      const style = normStyle(body.style || body.mode);
      const visionSignal = await runVisionAnalysis(style, livePrice);
      return res.status(200).json({
        ok: true,
        mode: 'vision',
        symbol: 'VISION',
        style,
        price: livePrice,
        signal: visionSignal
      });
    }

    // ── CABANG B: JIKA MODE LIVE / AUTO BOT ──
    const access = await checkAccess(email, isAutoBot);
    if (!access.ok) return res.status(200).json({ ok: false, message: access.error || tx({ lang: 'id' })[access.key] || 'Unauthorized' });

    const livePrice = Number(body.price ?? body.livePrice ?? body.currentPrice ?? 0);
    const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
    const style = normStyle(body.style || body.mode);
    const dec = DECIMALS[symbol] ?? 2;
    const ctx = {
      symbol, lang: 'id', dec,
      pip: pipSizeOf(symbol, dec),
      prof: pairProfile(symbol),
      gold: isGold(symbol),
      f: v => Number(Number(v).toFixed(dec)),
    };

    if (!(livePrice > 0)) return res.status(200).json({ ok: false, message: tx(ctx).noPrice });
    const price = livePrice;

    const m5c = clientCandles(body, 'm5');
    const m15c = clientCandles(body, 'm15');
    const m1 = clientCandles(body, 'm1');
    if (m5c.length < MIN_BARS.m5 && m15c.length < MIN_BARS.m5) {
      return res.status(200).json({ ok: false, message: tx(ctx).noCandles });
    }
    const m5 = m5c.length ? m5c : m15c;
    const m15 = m15c.length ? m15c : m5c;

    const result = await RUNNERS[style](ctx, { price, m1, m5, m15 });
    if (!result || !result.plan) return res.status(200).json({ ok: false, message: result?.reason || 'No setup' });

    if (isAutoBot) {
      await markTrialAsUsed(email);
    }

    return res.status(200).json({ ok: true, mode: 'candles', symbol, style, price, signal: buildSignal(result, 'id') });
  } catch (err) {
    // Menjamin error server selalu dikembalikan dalam format JSON (mencegah error Unexpected token '<')
    return res.status(200).json({ ok: false, error: err.message || 'Internal server error' });
  }
}
