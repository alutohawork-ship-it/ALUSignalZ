// api/generate.js
// v88 (Fixed missing TX functions: entryLine & slCapped)

export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };

const KV_KEY = 'alu_clients';
const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

// ── AI CONFIG ──
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || 'qwen-3.8-max';
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || 'gpt-6-luna';

const API_KEYS = [
  process.env.TICKERLAYER_API_KEY,
  process.env.TICKERLAYER_API_KEY_1,
  process.env.TICKERLAYER_API_KEY_2,
  process.env.TICKERLAYER_API_KEY_3,
  process.env.TICKERLAYER_API_KEY_4,
].filter(Boolean);

const DECIMALS = {
  DXY: 2, EURUSD: 5, GBPUSD: 5, USDJPY: 3, AUDUSD: 5, USDCAD: 5, USDCHF: 5, NZDUSD: 5,
  EURGBP: 5, EURJPY: 3, GBPJPY: 3, AUDJPY: 3, EURAUD: 5, GBPAUD: 5, AUDNZD: 5, CADJPY: 3, CHFJPY: 3, EURNZD: 5,
  XAUUSD: 2, XAGUSD: 3, XPTUSD: 2, XPDUSD: 2, XAUEUR: 2, XAGEUR: 3,
  BRENT: 2, WTI: 2, NATGAS: 3, COPPER: 4, COFFEE: 2, SUGAR: 2,
  US30: 2, NAS100: 2, SPX500: 2, GER40: 2, UK100: 2, JPN225: 0, FRA40: 2, AUS200: 2,
  BTCUSD: 2, ETHUSD: 2, SOLUSD: 2, XRPUSD: 4, BNBUSD: 2, ADAUSD: 4, DOGEUSD: 5, AVAXUSD: 3, LINKUSD: 3, DOTUSD: 4, MATICUSD: 4, UNIUSD: 3,
  BTCXAU: 2, ETHBTC: 5, SOLBTC: 5, US30BTC: 2, XAUUSDX: 2,
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

const PAIR_OVERRIDE = {};
const pairProfile = symbol => {
  const cls = pairClassOf(symbol);
  return { cls, ...PAIR_CLASS_PROFILE[cls], ...(PAIR_OVERRIDE[symbol] || {}) };
};

const PIP_OVERRIDE = {
  XAUUSD: 0.1, XAUUSDX: 0.1, DXY: 0.01, ETHUSD: 0.1,
  US30: 1, NAS100: 1, SPX500: 1, GER40: 1, UK100: 1, JPN225: 1, FRA40: 1, AUS200: 1, BTCUSD: 1,
};
const pipSizeOf = (symbol, dec) => PIP_OVERRIDE[symbol] ?? Math.pow(10, -(dec - 1));

const STYLES = {
  'Scalping': {
    label: 'Scalping Agresif · Market Execution NOW (M1/M5 Structure)',
    labelEn: 'Aggressive Scalping · Market Execution NOW (M1/M5 Structure)',
    entryStyle: 'Agresif', entryStyleEn: 'Aggressive', mode: 'MARKET', kind: 'scalp', rr: [1.0, 2.0, 3.0],
  },
  'Day Trading': {
    label: 'Scalping Konservatif · Fokus Zona/FVG M5 (Refine M1)',
    labelEn: 'Conservative Scalping · M5 Zone/FVG Focused (M1 Refine)',
    entryStyle: 'Konservatif', entryStyleEn: 'Conservative', mode: 'LIMIT', kind: 'day', rr: [1.0, 1.5, 2.0],
  },
  'Intraday': {
    label: 'Day Trading / Intraday · Strict Trend Following (Bias H1+M15, Zona/FVG M5)',
    labelEn: 'Day Trading / Intraday · Strict Trend Following (H1+M15 Bias, M5 Zone/FVG)',
    entryStyle: 'Moderat', entryStyleEn: 'Moderate', mode: 'LIMIT', kind: 'intraday', rr: [1.0, 2.0, 3.0],
  },
  'Swing': {
    label: 'Swing · Strict Trend Following (Bias D1+H4+H1, Zona/FVG M15)',
    labelEn: 'Swing · Strict Trend Following (D1+H4+H1 Bias, M15 Zone/FVG)',
    entryStyle: 'Positioning', entryStyleEn: 'Positioning', mode: 'LIMIT', kind: 'swing', rr: [3.0],
  },
};

const NEED = { m1: 160, m5: 120, m15: 480 };
const MIN_BARS = { m1: 100, m5: 40, m15: 120, m15Swing: 400 };

const SCALP_PIVOT = 2;
const DAY_PIVOT = 3;
const DAY_BOS_LOOKBACK = 60;
const DAY_OB_LOOKBACK = 12;

const BB_PERIOD = 20;
const BB_MULT = 2;
const BAND_TOL_PIPS = 10;
const BAND_TOL_ATR = 0.2;

const ZONE_ATR_PERIOD = 14;
const ZONE_DISP_ATR = 1.2;
const ZONE_MAX_ATR = 2.5;
const ZONE_REQUIRE_FVG = false;
const ZONE_FRESH_ONLY = true;

const SCALP_ZONE_LOOKBACK_M5 = 60;
const SCALP_ZONE_DISP_ATR = 0.8;
const SCALP_ZONE_FRESH_ONLY = true;
const SCALP_CHASE_MAX_PIPS = 15;
const scalpZoneOpts = { dispAtr: SCALP_ZONE_DISP_ATR, freshOnly: SCALP_ZONE_FRESH_ONLY };

const REACTION_ATR = { scalp: 1.5, day: 1.5, intraday: 1.5, swing: 2.0 };
const REACTION_MIN_PIP = 5;
const NOW_MAX_ATR = { scalp: 0.4, day: 0.6, intraday: 0.8 };
const FVG_LOOKBACK_BY_STYLE = { scalp: 40, day: 40, intraday: 40 };
const FVG_MIN_SIZE_ATR = 0.15;
const SCALP_ZONE_MIN_AGE_BARS = 8;
const FIXED_RISK_XAU_DAY_PIPS = 50;

function fixedRiskFor(kind, ctx) {
  if (kind === 'day' && ctx.gold) return FIXED_RISK_XAU_DAY_PIPS * ctx.pip;
  return null;
}

function findRecentFVGs(candles, lookback) {
  const n = candles.length;
  const fvgs = [];
  const start = Math.max(1, n - lookback);
  for (let i = start; i < n - 1; i++) {
    const prev = candles[i - 1], next = candles[i + 1];
    if (prev.h < next.l) fvgs.push({ dir: 1,  lo: prev.h, hi: next.l, idx: i });
    if (prev.l > next.h) fvgs.push({ dir: -1, lo: next.h, hi: prev.l, idx: i });
  }
  return fvgs.filter(f => {
    for (let i = f.idx + 2; i < n; i++) {
      if (candles[i].l <= f.hi && candles[i].h >= f.lo) return false;
    }
    return true;
  });
}

function evaluateFVG(candles, price, dir, atrVal, lookback = 40) {
  const fvgs = findRecentFVGs(candles, lookback)
    .filter(f => f.dir === dir && (f.hi - f.lo) >= FVG_MIN_SIZE_ATR * atrVal);
  if (!fvgs.length) return { useFVG: false, reason: 'no-fvg' };
  const candidates = dir === 1
    ? fvgs.filter(f => f.hi <= price + 0.2 * atrVal).sort((a, b) => b.hi - a.hi)
    : fvgs.filter(f => f.lo >= price - 0.2 * atrVal).sort((a, b) => a.lo - b.lo);
  if (!candidates.length) return { useFVG: false, reason: 'fvg-opposite-side' };
  const fvg = candidates[0];
  const inFVG = price >= fvg.lo && price <= fvg.hi;
  const distToFVG = dir === 1 ? (price - fvg.hi) : (fvg.lo - price);
  const entry = dir === 1 ? fvg.hi : fvg.lo;
  const sl = dir === 1 ? fvg.lo - 0.25 * atrVal : fvg.hi + 0.25 * atrVal;
  if (inFVG) return { useFVG: true, entry, sl, fvg, retraceMandatory: false, reason: 'inside-fvg' };
  if (distToFVG > 0) return { useFVG: true, entry, sl, fvg, retraceMandatory: true, reason: 'retrace-needed' };
  if (Math.abs(distToFVG) < 1.0 * atrVal) return { useFVG: true, entry, sl, fvg, retraceMandatory: true, reason: 'near-breakout' };
  return { useFVG: false, reason: 'breakout-far', fvg };
}

const GOLD_SL_PIPS = { scalp: [25, 30], day: [50, 120], intraday: [80, 200], swing: [150, 300] };
const SL_BUFFER_PIPS = { scalp: 3, day: 5, intraday: 10, swing: 15 };
const ATR_SL_MULT = { scalp: [0.5, 2.5], day: [1, 3], intraday: [1, 3], swing: [0.5, 2] };

const orderLabel = (dir, orderType) => `${dir === 1 ? 'BUY' : 'SELL'} ${orderType === 'LIMIT' ? 'LIMIT' : 'NOW'}`;
const isoDate = d => d.toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lastClosePrice = arr => (arr && arr.length ? arr[arr.length - 1].c : 0);

// ── KILLZONE & FILTERS ──
function isWithinKillzone() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  return (utcHour >= 7 && utcHour <= 10) || (utcHour >= 12 && utcHour <= 15);
}

// ── PREMIUM / DISCOUNT & LIQUIDITY HELPERS ──
function getRangeInfo(candles, lookback = 50) {
  const s = candles.slice(-lookback);
  if (s.length < 10) return null;
  const high = Math.max(...s.map(c => c.h));
  const low = Math.min(...s.map(c => c.l));
  const eq = (high + low) / 2;
  return { high, low, eq };
}

function getLiquidityLevels(candles, lookback = 30) {
  const s = candles.slice(-lookback);
  if (s.length < 10) return { ssl: 0, bsl: 0 };
  const lows = s.map(c => c.l).sort((a, b) => a - b);
  const highs = s.map(c => c.h).sort((a, b) => b - a);
  return { ssl: lows[0], bsl: highs[0] };
}

// ── KV & AUTH ──
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
  } catch (e) {}
  return { ok: true, status: 'admin' };
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
    if (totalCount >= 15) return { ok: false, msg: 'Batas maksimal 15 kali request untuk masa trial telah habis.' };
    if (dailyCount >= 5) return { ok: false, msg: 'Batas harian 5 kali request untuk masa trial telah habis. Coba lagi besok.' };
    await kv(['INCR', dailyKey]);
    if (dailyCount === 0) await kv(['EXPIRE', dailyKey, 172800]);
    await kv(['INCR', totalKey]);
    return { ok: true };
  } catch (e) { return { ok: true }; }
}

// ── TRANSLATIONS ──
const pickLang = (body, query) => {
  const raw = String(body?.lang ?? body?.language ?? body?.locale ?? query?.lang ?? '').toLowerCase();
  return raw.startsWith('en') ? 'en' : 'id';
};

const TX = {
  id: {
    pip: 'pip',
    title: { scalp: 'Scalping', day: 'Scalping Konservatif', intraday: 'Day Trading / Intraday', swing: 'Swing' },
    kind: { scalp: 'Scalping (Agresif)', day: 'Scalping (Konservatif)', intraday: 'Day Trading (Intraday)', swing: 'Swing (Positioning)' },
    classLabel: { gold: 'Emas', silver: 'Perak', metal: 'Logam', fx: 'Forex', fx_jpy: 'Forex JPY', index: 'Indeks', commodity: 'Komoditas', crypto: 'Kripto' },
    headLine: (title, dir, ot, sym) => `${title} ${dir} ${ot} pada ${sym}`,
    entryLine: (e, pips, sl) => `Entry ${e}, SL (${pips} pip) di ${sl}`,
    slCapped: (max, raw) => `SL dibatasi ${max} pip, struktur lebih lebar (${raw} pip)`,
    aiPrompt: (d) => `
Anda adalah "Alu Signal Z", trader institusional SMC/ICT. Tulis analisa eksekusi (maks 600 karakter, bahasa Indonesia) berdasarkan data di bawah.
WAJIB jelaskan narasi:
1. **Konteks State Machine**: Jelaskan alur dari Sweep -> MSS -> POI -> Signal.
2. **Konteks Premium/Discount**: Sebutkan apakah harga saat ini di area Premium (Mahal) atau Discount (Murah).
3. **Analisa Struktur & Zona**: Sebutkan zona kunci (Supply/Demand/FVG/OB) dan konfirmasi Liquidity Sweep (SSL/BSL).
4. **Alasan & Tipe Entry**: Apakah ini setup Reversal, Continuity, atau Retest?
5. **Invalidasi**: Sebutkan alasan SL diletakkan di level tersebut.

=== DATA ===
- Pair/Aset: ${d.symbol}
- Timeframe: ${d.tfs}
- Sinyal: ${d.sideW} | Order: ${d.orderType}
- Entry: ${d.entry} | SL: ${d.sl} (${d.riskPips} pip)
- TP: ${d.tps}
- Setup Type: ${d.setup}
- Chart Context: ${d.chartContext}
- Range Info: ${d.rangeInfo || '-'}
- Detail Zona/Struktur: ${d.raw}
`,
    aiSystem: 'Anda adalah AI analis trading SMC/ICT yang objektif, dingin, dan presisi.',
  },
  en: {
    pip: 'pips',
    title: { scalp: 'Scalping', day: 'Conservative Scalping', intraday: 'Day Trading / Intraday', swing: 'Swing' },
    kind: { scalp: 'Scalping (Aggressive)', day: 'Scalping (Conservative)', intraday: 'Day Trading (Intraday)', swing: 'Swing (Positioning)' },
    classLabel: { gold: 'Gold', silver: 'Silver', metal: 'Metal', fx: 'Forex', fx_jpy: 'JPY Forex', index: 'Index', commodity: 'Commodity', crypto: 'Crypto' },
    headLine: (title, dir, ot, sym) => `${title} ${dir} ${ot} on ${sym}`,
    entryLine: (e, pips, sl) => `Entry ${e}, SL (${pips} pips) at ${sl}`,
    slCapped: (max, raw) => `SL capped at ${max} pips, structure is wider (${raw} pips)`,
    aiPrompt: (d) => `
You are "Alu Signal Z", an institutional SMC/ICT trader. Write an execution analysis (max 600 characters, in English) based on the data below.
MUST explain the narrative:
1. **State Machine Context**: Explain the flow from Sweep -> MSS -> POI -> Signal.
2. **Premium/Discount Context**: State whether the current price is in Premium or Discount.
3. **Structure & Zone Analysis**: State the key zones used (Supply/Demand/FVG/OB) and confirm Liquidity Sweep (SSL/BSL).
4. **Reason & Entry Type**: Is this a Reversal, Continuity, or Retest setup?
5. **Invalidation**: Explain the reasoning behind the SL placement.

=== DATA ===
- Pair/Asset: ${d.symbol}
- Timeframe: ${d.tfs}
- Signal: ${d.sideW} | Order: ${d.orderType}
- Entry: ${d.entry} | SL: ${d.sl} (${d.riskPips} pips)
- TP: ${d.tps}
- Setup Type: ${d.setup}
- Chart Context: ${d.chartContext}
- Range Info: ${d.rangeInfo || '-'}
- Zone/Structure Details: ${d.raw}
`,
    aiSystem: 'You are an objective, calm, and precise SMC/ICT trading analyst.',
  },
};
const tx = ctx => TX[ctx.lang] || TX.id;

const SRC_EN = { 'BOS Bullish': 'BOS Bullish', 'BOS Bearish': 'BOS Bearish', 'Struktur HH + HL': 'HH + HL', 'Struktur LH + LL': 'LH + LL', 'Mitigasi FVG / Inducement': 'FVG mitigation', 'Sweep FVG / OB': 'Sweep', 'Default': 'Default' };
const srcName = (src, lang) => (lang === 'en' ? (SRC_EN[src] || src) : src);

// ── FETCH DATA ──
function tlCandidates(symbol) {
  const s = symbol.toUpperCase().trim();
  if (CRYPTO_LIST.includes(s)) {
    const base = s.replace(/USD$/, '');
    return [{ asset: 'crypto', symbol: `${base}USDT` }, { asset: 'crypto', symbol: `${base}USD` }];
  }
  if (s === 'US30' || s === 'SPX500') return [{ asset: 'stocks', symbol: `US:${s}` }];
  if (s === 'NAS100') return [{ asset: 'stocks', symbol: 'US:NDX' }];
  return [{ asset: 'forex', symbol: s }];
}
let currentKeyIndex = 0;
async function tlFetch(url, initialApiKey) {
  const keys = API_KEYS.length > 0 ? API_KEYS : [initialApiKey];
  let attempts = 0;
  while (attempts < keys.length) {
    const activeKey = keys[currentKeyIndex];
    for (let retry = 0; retry < 2; retry++) {
      const r = await fetch(url, { method: 'GET', headers: { 'x-api-key': activeKey, 'Content-Type': 'application/json' } });
      if (r.ok) return { response: r, keyIndex: currentKeyIndex };
      if ((r.status === 429 || r.status === 401 || r.status === 403) && retry === 0) { await sleep(1000); continue; }
      break;
    }
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;
    attempts++;
  }
  return { response: await fetch(url, { method: 'GET', headers: { 'x-api-key': keys[0], 'Content-Type': 'application/json' } }), keyIndex: 0 };
}
const TL_SPAN = { '1m': { mult: 1, span: 'minute', minutes: 1 }, '5m': { mult: 5, span: 'minute', minutes: 5 }, '15m': { mult: 15, span: 'minute', minutes: 15 } };
const CACHE_TTL = { '1m': 120, '5m': 300, '15m': 600 };
const CACHE_BARS = { '1m': 500, '5m': 500, '15m': 2000 };

function toEpochMs(v) {
  if (typeof v === 'string' && v.trim() !== '' && Number.isNaN(Number(v))) return Date.parse(v) || 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e11 ? n * 1000 : n;
}
async function fetchTickerLayerRows(cand, interval, apiKey, need) {
  const info = { cand: `${cand.asset}/${cand.symbol}`, status: null, rows: [], error: null };
  const tf = TL_SPAN[interval];
  if (!tf) return info;
  const now = Date.now();
  const startMs = now - Math.ceil(need * 1.2 * tf.minutes * 60000) - 86400000;
  const url = `${TICKERLAYER_BASE_URL}/${cand.asset}/agg/${cand.symbol}/${tf.mult}/${tf.span}/${isoDate(new Date(startMs))}/${isoDate(new Date(now + 86400000))}?sort=asc&limit=5000`;
  try {
    const { response } = await tlFetch(url, apiKey);
    info.status = response.status;
    if (!response.ok) return info;
    const data = await response.json();
    const raw = Array.isArray(data) ? data : (data.results || []);
    const byT = new Map();
    for (const bar of raw) {
      const t = toEpochMs(bar.t ?? bar.timestamp ?? bar.time);
      const o = Number(bar.o ?? bar.open), h = Number(bar.h ?? bar.high), l = Number(bar.l ?? bar.low), c = Number(bar.c ?? bar.close);
      if (t > 0 && [o, h, l, c].every(Number.isFinite)) byT.set(t, { t, o, h, l, c });
    }
    info.rows = [...byT.values()].sort((a, b) => a.t - b.t).slice(-Math.max(1, Math.ceil(need)));
  } catch (err) { info.error = err.message; }
  return info;
}
function cleanCandles(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map(c => ({ t: Number(c?.t), o: Number(c?.o), h: Number(c?.h), l: Number(c?.l), c: Number(c?.c) }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
}
function mergeLiveBar(candles, price, tfMin) {
  if (!candles.length || !(price > 0)) return candles;
  const ms = tfMin * 60000;
  const bucket = Math.floor(Date.now() / ms) * ms;
  const last = candles[candles.length - 1];
  if (last.t === bucket) { last.h = Math.max(last.h, price); last.l = Math.min(last.l, price); last.c = price; }
  else if (last.t < bucket) { const o = last.c; candles.push({ t: bucket, o, h: Math.max(o, price), l: Math.min(o, price), c: price }); }
  return candles;
}
const CANDLE_CACHE_VER = 'v4';
const matchesRef = (arr, ref) => arr.length > 0 && ref > 0 && Math.abs(arr[arr.length - 1].c - ref) / ref <= MAX_SRC_DEVIATION;
async function getCandles(symbol, tf, need, apiKey, ref) {
  const cacheKey = `candles_${CANDLE_CACHE_VER}_${symbol}_${tf}`;
  const cached = await kvGetJSON(cacheKey);
  if (Array.isArray(cached) && cached.length >= need && matchesRef(cached, ref)) return { candles: cached, source: 'cache', tried: [] };
  const tried = [];
  const minBars = Math.min(need, 60);
  for (const cand of tlCandidates(symbol)) {
    const info = await fetchTickerLayerRows(cand, tf, apiKey, need);
    tried.push(info);
    if (info.rows.length >= minBars && matchesRef(info.rows, ref)) {
      await kvSetJSON(cacheKey, info.rows.slice(-CACHE_BARS[tf]), CACHE_TTL[tf]);
      return { candles: info.rows, source: `tickerlayer ${info.cand}`, tried };
    }
  }
  return { candles: [], source: 'none', tried };
}
function describeTried(tried, ref, lang) {
  if (!tried || !tried.length) return TX[lang].noSource;
  return tried.map(t => {
    const last = t.rows.length ? `, close ${t.rows[t.rows.length - 1].c} vs live ${ref}` : '';
    const err = t.error ? `, error ${t.error}` : '';
    return `${t.cand} HTTP ${t.status ?? '-'}, ${t.rows.length} bar${last}${err}`;
  }).join('; ');
}

// ── INDIKATOR & STRUKTUR ──
function atr(candles, period = 14) {
  if (!candles || candles.length < 2) return 15;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const s = trs.slice(-period);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 15;
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
  const { highs, lows } = findPivots(candles, SCALP_PIVOT);
  if (highs.length < 2 || lows.length < 2) {
    const last = candles[candles.length - 1], prev = candles[candles.length - 2];
    return { dir: last.c >= prev.c ? 1 : -1, src: 'Sweep FVG / OB' };
  }
  const [h1, h2] = highs.slice(-2);
  const [l1, l2] = lows.slice(-2);
  const lastC = candles[candles.length - 1].c;
  if (lastC > h2.p) return { dir: 1, src: 'BOS Bullish' };
  if (lastC < l2.p) return { dir: -1, src: 'BOS Bearish' };
  if (h2.p > h1.p && l2.p > l1.p) return { dir: 1, src: 'Struktur HH + HL' };
  if (h2.p < h1.p && l2.p < l1.p) return { dir: -1, src: 'Struktur LH + LL' };
  return { dir: 0, src: 'Ranging / Inducement' };
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
    if (Math.abs(top - sl) > ZONE_MAX_ATR * a) continue;
    if (!isBOSAfter(candles, base, k, dir)) continue;
    const after = candles.slice(k + 1, n - 1);
    if (after.some(x => (dir === 1 ? x.c < sl : x.c > sl))) continue;
    const fresh = !after.some(x => (dir === 1 ? x.l <= top : x.h >= bottom));
    if (freshOnly && !fresh) continue;
    if (dir === 1 && (bottom > price || price < sl)) continue;
    if (dir === -1 && (top < price || price > sl)) continue;
    const dist = dir === 1 ? Math.max(0, price - top) : Math.max(0, bottom - price);
    zones.push({ top, bottom, sl, idx: base, dispIdx: k, dist, fresh });
  }
  return zones.sort((x, y) => x.dist - y.dist);
}

function recentExtreme(candles, dir, bars) {
  const s = candles.slice(-(bars + 1));
  return dir === 1 ? Math.min(...s.map(c => c.l)) : Math.max(...s.map(c => c.h));
}

function slBounds(kind, ctx, atrVal) {
  if (ctx.gold) { const [a, b] = GOLD_SL_PIPS[kind]; return { min: a * ctx.pip, max: b * ctx.pip }; }
  const [a, b] = ATR_SL_MULT[kind];
  return { min: a * ctx.prof.slMul * atrVal, max: b * ctx.prof.slMul * atrVal };
}

// ── AI REASONING ──
async function getAIReasoning({ ctx, dir, kind, orderType, entry, sl, tps, setup, rawReason, riskPips, zoneLine, timeframes, rangeInfo, chartContext }) {
  if (!OPENAI_API_KEY) return null;
  const { symbol, dec, prof, lang } = ctx;
  const t = TX[lang] || TX.id;
  const p = v => {
    if (v === 0) return "0";
    if (v < 0.001) return Number(v).toFixed(8);
    return Number(v).toFixed(dec);
  };
  
  const prompt = t.aiPrompt({
    symbol, classLabel: t.classLabel[prof.cls] || prof.label, sideW: dir === 1 ? 'BUY' : 'SELL',
    kind: t.kind[kind] || kind, orderType, entry: p(entry), sl: p(sl),
    riskPips: riskPips.toFixed(1), tps: tps.map(p).join(', '), setup, zone: zoneLine || '', raw: rawReason,
    tfs: timeframes || 'Chart', rangeInfo: rangeInfo || '-', chartContext: chartContext || '-'
  });
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8500); 

    const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST', 
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, messages: [{ role: 'system', content: t.aiSystem }, { role: 'user', content: prompt }], max_tokens: 500, temperature: 0.2 }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!resp.ok) return null;
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) { 
    console.error('AI Reasoning Exception/Timeout:', err.message);
    return null; 
  }
}

// ── VISION AI ──
async function getVisionSignal(images, lang) {
  if (!OPENAI_API_KEY) return { plan: null, reason: 'API Key AI tidak ada.' };
  
  const prompt = `
Anda adalah trader institusional SMC/ICT profesional. Anda menerima ${images.length} gambar chart TradingView (Multi-Timeframe).
TIDAK ADA gaya trading. Berikan REKOMENDASI murni berdasarkan arsitektur SMC State Machine.

LANGKAH WAJIB (Analisa Top-Down + State Machine):
1. **Baca TF**: Semua TF di tiap gambar. Kumpulkan ke ARRAY (misal ["H4", "M15", "M5"]).
2. **Baca Pair**: Pojok kiri atas ("PEPE / TetherUS" -> "PEPEUSDT"). Jika tidak ada, "UNKNOWN".
3. **IDLE (Dealing Range)**: Tentukan range harga saat ini (High-Low). Apakah harga berada di Premium (>50%) atau Discount (<50%)?
4. **SWEEP DETECTED**: Apakah ada likuiditas (BSL/SSL) yang baru saja disapu?
5. **MSS CONFIRMED**: Apakah ada Market Structure Shift / CHoCH di LTF?
6. **POI_REACHED**: Cari zona kunci (FVG, Order Block, Breaker). Apakah harga sudah menyentuh zona ini?
7. **SIGNAL FIRED (Entry & SL)**:
   - Tentukan Entry (NOW jika di POI, LIMIT jika menunggu retest).
   - **SL ANTI-SWEEP**: Letakkan SL di LUAR zona pelindung (buffer 1.5 ATR).
   - Tentukan TP1, TP2, TP3 berdasarkan likuiditas berikutnya.
8. **chartContext**: Tuliskan alur state machine secara eksplisit (contoh: "HTF H4 Bullish -> Sweep SSL M15 -> MSS M5 -> POI FVG -> SIGNAL BUY").

KEMBALIKAN HANYA DALAM FORMAT JSON:
{
  "symbol": "BTCUSDT",
  "timeframes": ["H4", "M15", "M5"],
  "signal": "BUY",
  "orderType": "LIMIT",
  "entry": 65276.37,
  "sl": 64800.00,
  "tp1": 65800.00,
  "tp2": 66500.00,
  "tp3": 67000.00,
  "setup": "M15 Demand Retest (Continuity)",
  "range_info": "H4 Premium (70%), M15 Discount (30%)",
  "chartContext": "IDLE at Premium -> Sweep SSL M15 -> MSS M5 -> POI FVG -> SIGNAL FIRED",
  "reason": "Harga menyapu SSL di M15 (Sweep Detected), lalu terjadi MSS Bullish di M5. Entry Limit di FVG M5 yang berada di area Discount. SL aman di bawah swing low dengan buffer."
}`;

  const userContent = [
    { type: "text", text: prompt },
    ...images.map(imgBase64 => ({ type: "image_url", image_url: { url: imgBase64 } }))
  ];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8500); 

    const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST', 
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: AI_VISION_MODEL, messages: [{ role: 'user', content: userContent }], max_tokens: 1500, temperature: 0.1 }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!resp.ok) return { plan: null, reason: `Server AI menolak (HTTP ${resp.status}).` };
    const data = await resp.json();
    let content = data.choices?.[0]?.message?.content?.trim() || '';
    if (!content) return { plan: null, reason: `AI gagal membaca gambar.` };
    
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const startIdx = content.indexOf('{');
    const endIdx = content.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const jsonString = content.substring(startIdx, endIdx + 1);
      try {
        const parsed = JSON.parse(jsonString);
        return { plan: parsed, reason: parsed.reason || 'Vision Analysis' };
      } catch (parseError) { return { plan: null, reason: 'Format JSON AI rusak.' }; }
    }
    return { plan: null, reason: `AI tidak mengembalikan JSON.` };
  } catch (err) { 
    console.error('Vision AI Exception:', err.message);
    return { plan: null, reason: err.message }; 
  }
}

// ── FINALIZE PLAN ──
async function finalizePlan({ dir, entry, orderType, baseSL, kind, atrVal, ctx, rrList, confidence, setup, zoneNote, zoneRange, head, lines, zoneLine, timeframes, rangeInfo, chartContext }) {
  const { f, pip, gold, prof } = ctx;
  const t = tx(ctx);

  let risk, slNote = '';
  const fixedRisk = fixedRiskFor(kind, ctx);
  if (fixedRisk) {
    risk = fixedRisk;
    slNote = ctx.lang === 'en' ? `SL fixed ${FIXED_RISK_XAU_DAY_PIPS} pips` : `SL fixed ${FIXED_RISK_XAU_DAY_PIPS} pip`;
  } else {
    const b = slBounds(kind, ctx, atrVal);
    const buf = gold ? SL_BUFFER_PIPS[kind] * pip : prof.bufAtr * atrVal;
    let raw = Math.abs(entry - baseSL) + buf;
    if ((dir === 1 && baseSL >= entry) || (dir === -1 && baseSL <= entry)) raw = b.min;
    risk = Math.min(Math.max(raw, b.min), b.max);
    if (raw > b.max) slNote = t.slCapped((b.max / pip).toFixed(0), (raw / pip).toFixed(0));
  }

  const sl = entry - dir * risk;
  const tps = rrList.map(x => entry + dir * x * risk);

  const minDist = atrVal * 0.5; 
  if (Math.abs(tps[0] - entry) < minDist) {
     return { plan: null, reason: 'Dibatalkan: Target TP terlalu dekat dengan Entry (terkena noise volatilitas).' };
  }

  const parts = [head, ...lines, slNote, t.entryLine(f(entry), (risk / pip).toFixed(0), f(sl)), rrList.map((x, i) => `TP${i + 1} 1:${x}`).join(', ')].filter(Boolean);
  const manualReason = parts.map(s => s.replace(/\.?$/, '.')).join(' • ');

  const aiReason = await getAIReasoning({ ctx, dir, kind, orderType, entry, sl, tps, setup, rawReason: manualReason, riskPips: risk / pip, zoneLine, timeframes, rangeInfo, chartContext });

  return {
    dir,
    plan: { kind, orderType, status: orderType === 'LIMIT' ? 'PENDING' : 'RUNNING', entry, bufferEnd: entry, sl, tps, zone: zoneRange || null, expireMs: 0, zoneNote, chartContext },
    meta: { confidence, riskLabel: 'MEDIUM', setup, reason: aiReason || manualReason },
  };
}

// ═══════════════════════════ WORKFLOW MTF (STATE MACHINE SIMULATION) ═══════════════════════════

async function buildScalpPlan({ m1, m5, m15, price, rrList, ctx }) {
  const { pip } = ctx;
  const t = tx(ctx);
  const atrM1 = atrOf(m1, pip);
  
  const biasM15 = analyzePureSMCStructure(m15);
  const rangeM15 = getRangeInfo(m15, 50);
  let rangeInfoStr = '-';
  let isPremium = false, isDiscount = false;
  if (rangeM15 && rangeM15.high > rangeM15.low) {
      const diff = rangeM15.high - rangeM15.low;
      const pricePos = (price - rangeM15.low) / diff;
      isPremium = pricePos > 0.5;
      isDiscount = pricePos <= 0.5;
      rangeInfoStr = `M15 Range: ${isPremium ? 'PREMIUM' : 'DISCOUNT'} (Pos: ${(pricePos*100).toFixed(1)}%)`;
  }

  const structM5 = analyzePureSMCStructure(m5);
  const structM1 = analyzePureSMCStructure(m1);
  
  const demand = findSDZones(m1, 1, price, { dispAtr: 0.8, freshOnly: true })[0] || null;
  const supply = findSDZones(m1, -1, price, { dispAtr: 0.8, freshOnly: true })[0] || null;
  
  const fvgs = findRecentFVGs(m1, 20);
  const inBullFVG = fvgs.some(f => f.dir === 1 && price >= f.lo && price <= f.hi);
  const inBearFVG = fvgs.some(f => f.dir === -1 && price >= f.lo && price <= f.hi);

  const inDemand = (demand && price >= demand.bottom && price <= demand.top) || inBullFVG;
  const inSupply = (supply && price >= supply.bottom && price <= supply.top) || inBearFVG;

  let state = 'IDLE';
  let chartContext = '';
  
  if (structM5.dir !== 0) state = 'SWEEP_DETECTED';
  if (structM1.dir !== 0) state = 'MSS_CONFIRMED';
  
  let dir = structM1.dir;
  let setup = `Market NOW (${srcName(structM1.src, ctx.lang)})`;
  let lines = [`Eksekusi NOW mengikuti momentum M1: ${srcName(structM1.src, ctx.lang)}`];

  if (inDemand && inSupply) {
    return { plan: null, reason: 'Dibatalkan: Harga terjepit di antara Supply dan Demand (Konsolidasi).' };
  } else if (inDemand) {
    if (state !== 'IDLE') state = 'POI_REACHED';
    dir = 1; 
    setup = `Reaksi Demand / Bullish FVG (Discount Buy)`;
    lines = [`Harga di area Demand/FVG M1 (${isDiscount ? 'Discount' : 'Premium'}). Prioritas BUY.`];
  } else if (inSupply) {
    if (state !== 'IDLE') state = 'POI_REACHED';
    dir = -1; 
    setup = `Reaksi Supply / Bearish FVG (Premium Sell)`;
    lines = [`Harga di area Supply/FVG M1 (${isPremium ? 'Premium' : 'Discount'}). Prioritas SELL.`];
  } else if (dir === 0) {
    return { plan: null, reason: 'Dibatalkan: Struktur M1 ranging & harga di luar zona.' };
  } else if (isPremium && dir === 1) {
    return { plan: null, reason: 'Dibatalkan: Harga di area Premium (Mahal), tapi struktur M1 Bullish. Rawan fakeout.' };
  } else if (isDiscount && dir === -1) {
    return { plan: null, reason: 'Dibatalkan: Harga di area Discount (Murah), tapi struktur M1 Bearish. Rawan fakeout.' };
  }

  if (state === 'POI_REACHED') state = 'SIGNAL_FIRED';
  chartContext = `HTF M15 ${biasM15.src} -> M5 ${structM5.src} -> M1 ${state} at POI`;

  const side = dir === 1 ? 'BUY' : 'SELL';
  const baseSL = inDemand ? (demand ? demand.sl : recentExtreme(m1, dir, 5)) : (inSupply ? (supply ? supply.sl : recentExtreme(m1, dir, 5)) : recentExtreme(m1, dir, 10));
  const zoneRange = inDemand ? (demand ? { min: demand.bottom, max: demand.top } : { min: price, max: price }) : (inSupply ? (supply ? { min: supply.bottom, max: supply.top } : { min: price, max: price }) : { min: price, max: price });

  return await finalizePlan({
    dir, entry: price, orderType: 'NOW', baseSL, kind: 'scalp', atrVal: atrM1, ctx, rrList,
    confidence: 'HIGH', setup,
    zoneNote: inDemand ? 'Area Demand / Bullish FVG' : (inSupply ? 'Area Supply / Bearish FVG' : 'Momentum M1'), 
    zoneRange, timeframes: 'M1, M5, M15', rangeInfo: rangeInfoStr, chartContext,
    head: t.headLine(t.title.scalp, side, 'NOW', ctx.symbol),
    lines,
  });
}

async function buildDayPlan({ m1, m5, price, rrList, ctx }) {
  const t = tx(ctx);
  const { f, pip } = ctx;
  const atrM5 = atrOf(m5, pip);
  
  const rangeM5 = getRangeInfo(m5, 50);
  let rangeInfoStr = '-';
  if (rangeM5 && rangeM5.high > rangeM5.low) {
      const diff = rangeM5.high - rangeM5.low;
      const pricePos = (price - rangeM5.low) / diff;
      rangeInfoStr = `M5 Range Pos: ${(pricePos*100).toFixed(1)}%`;
  }

  const demand = findSDZones(m5, 1, price, { dispAtr: 0.8, freshOnly: true })[0] || null;
  const supply = findSDZones(m5, -1, price, { dispAtr: 0.8, freshOnly: true })[0] || null;
  const liqM5 = getLiquidityLevels(m5, 30);

  let dir, entry, baseSL, zoneRange, setup;
  let lines = [];
  let state = 'IDLE';
  let chartContext = '';

  if (demand && (!supply || demand.dist <= supply.dist)) {
    if (liqM5.ssl > 0 && liqM5.ssl > demand.bottom && liqM5.ssl < demand.top) {
       return { plan: null, reason: 'Dibatalkan: Ada likuiditas (SSL) di dalam zona Demand M5. Rentan tersapu. Menunggu sweep.' };
    }
    state = 'POI_REACHED';
    dir = 1; entry = demand.top; baseSL = demand.sl; zoneRange = { min: demand.bottom, max: demand.top };
    setup = `M5 Demand Limit (Zone Scalping)`;
    lines.push(`Setup M5: Zona Demand Fresh (OB/SD)`);
  } else if (supply) {
    if (liqM5.bsl > 0 && liqM5.bsl < supply.top && liqM5.bsl > supply.bottom) {
       return { plan: null, reason: 'Dibatalkan: Ada likuiditas (BSL) di dalam zona Supply M5. Rentan tersapu. Menunggu sweep.' };
    }
    state = 'POI_REACHED';
    dir = -1; entry = supply.bottom; baseSL = supply.sl; zoneRange = { min: supply.bottom, max: supply.top };
    setup = `M5 Supply Limit (Zone Scalping)`;
    lines.push(`Setup M5: Zona Supply Fresh (OB/SD)`);
  } else {
    const fvgBuy = evaluateFVG(m5, price, 1, atrM5, 40);
    const fvgSell = evaluateFVG(m5, price, -1, atrM5, 40);

    if (fvgBuy.useFVG && (!fvgSell.useFVG || Math.abs(price - fvgBuy.entry) < Math.abs(price - fvgSell.entry))) {
      state = 'POI_REACHED';
      dir = 1; entry = fvgBuy.entry; baseSL = fvgBuy.sl; 
      zoneRange = { min: fvgBuy.fvg.lo, max: fvgBuy.fvg.hi };
      setup = `M5 FVG Bullish Limit (Continuity)`;
      lines.push(`Setup M5: FVG Bullish (Retest)`);
    } else if (fvgSell.useFVG) {
      state = 'POI_REACHED';
      dir = -1; entry = fvgSell.entry; baseSL = fvgSell.sl; 
      zoneRange = { min: fvgSell.fvg.lo, max: fvgSell.fvg.hi };
      setup = `M5 FVG Bearish Limit (Continuity)`;
      lines.push(`Setup M5: FVG Bearish (Retest)`);
    } else {
      return { plan: null, reason: 'Tidak ada setup valid. Tidak ada Zona S/D atau FVG M5 yang fresh.' };
    }
  }

  if (state === 'POI_REACHED') state = 'SIGNAL_FIRED';
  chartContext = `M5 Structure IDLE -> POI_REACHED -> ${state}`;

  return await finalizePlan({
    dir, entry, orderType: 'LIMIT', baseSL, kind: 'day', atrVal: atrM5, ctx, rrList,
    confidence: 'HIGH', setup, zoneNote: setup, zoneRange, timeframes: 'M1, M5', rangeInfo: rangeInfoStr, chartContext,
    head: t.headLine(t.title.day, dir === 1 ? 'BUY' : 'SELL', 'LIMIT', ctx.symbol),
    lines: [...lines, `Area Eksekusi M5: ${f(zoneRange.min)} - ${f(zoneRange.max)}`],
  });
}

async function buildIntradayPlan({ m5, m15, price, rrList, ctx }) {
  const t = tx(ctx);
  const { f, pip } = ctx;
  const h1 = aggregateCandles(m15, 60);
  const atrM5 = atrOf(m5, pip);

  const rangeH1 = getRangeInfo(h1, 50);
  let rangeInfoStr = '-';
  if (rangeH1 && rangeH1.high > rangeH1.low) {
      const diff = rangeH1.high - rangeH1.low;
      const pricePos = (price - rangeH1.low) / diff;
      rangeInfoStr = `H1 Range Pos: ${(pricePos*100).toFixed(1)}% (${pricePos > 0.5 ? 'Premium' : 'Discount'})`;
  }

  const biasH1 = analyzePureSMCStructure(h1);
  const biasM15 = analyzePureSMCStructure(m15);
  
  let htfBias = 0;
  if (biasH1.dir === 1 && biasM15.dir === 1) htfBias = 1;
  if (biasH1.dir === -1 && biasM15.dir === -1) htfBias = -1;

  if (htfBias === 0) {
    return { plan: null, reason: 'Bias H1 & M15 tidak searah / ranging. Menunggu tren yang jelas.' };
  }

  let dir, entry, baseSL, zoneRange, setup;
  let lines = [
    `Bias H1: ${srcName(biasH1.src, ctx.lang)}`,
    `Bias M15: ${srcName(biasM15.src, ctx.lang)}`
  ];
  let state = 'MSS_CONFIRMED';
  let chartContext = '';

  const liqM15 = getLiquidityLevels(m15, 40);

  if (htfBias === 1) {
    dir = 1;
    const demand = findSDZones(m5, 1, price, { dispAtr: 0.8, freshOnly: true })[0] || null;
    if (demand) {
      if (liqM15.ssl > 0 && liqM15.ssl > demand.bottom && liqM15.ssl < demand.top) {
         return { plan: null, reason: 'Dibatalkan: Likuiditas (SSL) terdeteksi di dalam zona Demand. Risiko sweep tinggi.' };
      }
      entry = demand.top; baseSL = demand.sl; zoneRange = { min: demand.bottom, max: demand.top };
      setup = `M5 Demand Limit (Trend Follow)`;
      lines.push(`Setup M5: Zona Demand Fresh (OB/SD)`);
    } else {
      const fvgBuy = evaluateFVG(m5, price, 1, atrM5, 40);
      if (fvgBuy.useFVG) {
        entry = fvgBuy.entry; baseSL = fvgBuy.sl; zoneRange = { min: fvgBuy.fvg.lo, max: fvgBuy.fvg.hi };
        setup = `M5 FVG Bullish Limit (Trend Continuity)`;
        lines.push(`Setup M5: FVG Bullish (Retest)`);
      } else {
        return { plan: null, reason: 'Tren Bullish, tetapi tidak ada zona Demand M5 atau FVG Bullish M5 yang fresh.' };
      }
    }
  } else {
    dir = -1;
    const supply = findSDZones(m5, -1, price, { dispAtr: 0.8, freshOnly: true })[0] || null;
    if (supply) {
      if (liqM15.bsl > 0 && liqM15.bsl < supply.top && liqM15.bsl > supply.bottom) {
         return { plan: null, reason: 'Dibatalkan: Likuiditas (BSL) terdeteksi di dalam zona Supply. Risiko sweep tinggi.' };
      }
      entry = supply.bottom; baseSL = supply.sl; zoneRange = { min: supply.bottom, max: supply.top };
      setup = `M5 Supply Limit (Trend Follow)`;
      lines.push(`Setup M5: Zona Supply Fresh (OB/SD)`);
    } else {
      const fvgSell = evaluateFVG(m5, price, -1, atrM5, 40);
      if (fvgSell.useFVG) {
        entry = fvgSell.entry; baseSL = fvgSell.sl; zoneRange = { min: fvgSell.fvg.lo, max: fvgSell.fvg.hi };
        setup = `M5 FVG Bearish Limit (Trend Continuity)`;
        lines.push(`Setup M5: FVG Bearish (Retest)`);
      } else {
        return { plan: null, reason: 'Tren Bearish, tetapi tidak ada zona Supply M5 atau FVG Bearish M5 yang fresh.' };
      }
    }
  }

  state = 'SIGNAL_FIRED';
  chartContext = `HTF H1/M15 ${htfBias === 1 ? 'Bullish' : 'Bearish'} -> MSS M15 -> POI M5 -> ${state}`;

  return await finalizePlan({
    dir, entry, orderType: 'LIMIT', baseSL, kind: 'intraday', atrVal: atrM5, ctx, rrList,
    confidence: 'HIGH', setup, zoneNote: setup, zoneRange, timeframes: 'M5, M15, H1', rangeInfo: rangeInfoStr, chartContext,
    head: t.headLine(t.title.intraday, dir === 1 ? 'BUY' : 'SELL', 'LIMIT', ctx.symbol),
    lines: [...lines, `Area Eksekusi M5: ${f(zoneRange.min)} - ${f(zoneRange.max)}`],
  });
}

async function buildSwingPlan({ m15, price, rrList, ctx }) {
  const t = tx(ctx);
  const { f, pip } = ctx;
  const h1 = aggregateCandles(m15, 60);
  const h4 = aggregateCandles(m15, 240);
  const d1 = aggregateCandles(m15, 1440);
  const atrM15 = atrOf(m15, pip);

  const rangeH4 = getRangeInfo(h4, 50);
  let rangeInfoStr = '-';
  if (rangeH4 && rangeH4.high > rangeH4.low) {
      const diff = rangeH4.high - rangeH4.low;
      const pricePos = (price - rangeH4.low) / diff;
      rangeInfoStr = `H4 Range Pos: ${(pricePos*100).toFixed(1)}% (${pricePos > 0.5 ? 'Premium' : 'Discount'})`;
  }

  const biasD1 = analyzePureSMCStructure(d1);
  const biasH4 = analyzePureSMCStructure(h4);
  const biasH1 = analyzePureSMCStructure(h1);
  
  let bullCount = [biasD1, biasH4, biasH1].filter(x => x.dir === 1).length;
  let bearCount = [biasD1, biasH4, biasH1].filter(x => x.dir === -1).length;
  
  let htfBias = 0;
  if (bullCount >= 2) htfBias = 1;
  if (bearCount >= 2) htfBias = -1;

  if (htfBias === 0) {
    return { plan: null, reason: 'Bias D1/H4/H1 tidak searah. Menunggu tren makro.' };
  }

  let dir, entry, baseSL, zoneRange, setup;
  let lines = [
    `Bias D1: ${srcName(biasD1.src, ctx.lang)}`,
    `Bias H4: ${srcName(biasH4.src, ctx.lang)}`,
    `Bias H1: ${srcName(biasH1.src, ctx.lang)}`
  ];
  let state = 'MSS_CONFIRMED';
  let chartContext = '';

  const liqH1 = getLiquidityLevels(h1, 40);

  if (htfBias === 1) {
    dir = 1;
    const demand = findSDZones(m15, 1, price, { dispAtr: 0.8, freshOnly: true })[0] || null;
    if (demand) {
      if (liqH1.ssl > 0 && liqH1.ssl > demand.bottom && liqH1.ssl < demand.top) {
         return { plan: null, reason: 'Dibatalkan: Likuiditas (SSL) berada di dalam zona Demand M15. Risiko sweep tinggi.' };
      }
      entry = demand.top; baseSL = demand.sl; zoneRange = { min: demand.bottom, max: demand.top };
      setup = `M15 Demand Limit (Trend Follow)`;
      lines.push(`Setup M15: Zona Demand Fresh (OB/SD)`);
    } else {
      const fvgBuy = evaluateFVG(m15, price, 1, atrM15, 40);
      if (fvgBuy.useFVG) {
        entry = fvgBuy.entry; baseSL = fvgBuy.sl; zoneRange = { min: fvgBuy.fvg.lo, max: fvgBuy.fvg.hi };
        setup = `M15 FVG Bullish Limit (Trend Continuity)`;
        lines.push(`Setup M15: FVG Bullish (Retest)`);
      } else {
        return { plan: null, reason: 'Tren Makro Bullish, tetapi tidak ada zona Demand M15 atau FVG Bullish M15 yang fresh.' };
      }
    }
  } else {
    dir = -1;
    const supply = findSDZones(m15, -1, price, { dispAtr: 0.8, freshOnly: true })[0] || null;
    if (supply) {
      if (liqH1.bsl > 0 && liqH1.bsl < supply.top && liqH1.bsl > supply.bottom) {
         return { plan: null, reason: 'Dibatalkan: Likuiditas (BSL) berada di dalam zona Supply M15. Risiko sweep tinggi.' };
      }
      entry = supply.bottom; baseSL = supply.sl; zoneRange = { min: supply.bottom, max: supply.top };
      setup = `M15 Supply Limit (Trend Follow)`;
      lines.push(`Setup M15: Zona Supply Fresh (OB/SD)`);
    } else {
      const fvgSell = evaluateFVG(m15, price, -1, atrM15, 40);
      if (fvgSell.useFVG) {
        entry = fvgSell.entry; baseSL = fvgSell.sl; zoneRange = { min: fvgSell.fvg.lo, max: fvgSell.fvg.hi };
        setup = `M15 FVG Bearish Limit (Trend Continuity)`;
        lines.push(`Setup M15: FVG Bearish (Retest)`);
      } else {
        return { plan: null, reason: 'Tren Makro Bearish, tetapi tidak ada zona Supply M15 atau FVG Bearish M15 yang fresh.' };
      }
    }
  }

  state = 'SIGNAL_FIRED';
  chartContext = `HTF D1/H4/H1 Sync -> MSS H1 -> POI M15 -> ${state}`;

  return await finalizePlan({
    dir, entry, orderType: 'LIMIT', baseSL, kind: 'swing', atrVal: atrM15, ctx, rrList,
    confidence: 'HIGH', setup, zoneNote: setup, zoneRange, timeframes: 'M15, H1, H4, D1', rangeInfo: rangeInfoStr, chartContext,
    head: t.headLine(t.title.swing, dir === 1 ? 'BUY' : 'SELL', 'LIMIT', ctx.symbol),
    lines: [...lines, `Area Eksekusi M15: ${f(zoneRange.min)} - ${f(zoneRange.max)}`],
  });
}

// ═══════════════════════════ OUTPUT ═══════════════════════════
function toSignal(result, style, ctx) {
  const { dir, plan, meta } = result;
  const r = v => {
    if (v === 0) return 0;
    if (v < 0.001) return Number(v).toFixed(8);
    return Number(Number(v).toFixed(ctx.dec));
  };
  
  const tps = plan.tps;
  const isLimit = plan.orderType === 'LIMIT';
  const en = ctx.lang === 'en';
  const mode = isLimit ? 'LIMIT' : 'MARKET';

  return {
    signal: dir === 1 ? 'BUY' : 'SELL',
    mode: mode,
    orderType: plan.orderType,
    orderLabel: orderLabel(dir, plan.orderType),
    status: plan.status,
    entry: r(plan.entry),
    bufferEnd: r(plan.entry),
    sl: r(plan.sl),
    tp1: tps[0] != null ? r(tps[0]) : null,
    tp2: tps[1] != null ? r(tps[1]) : null,
    tp3: tps[2] != null ? r(tps[2]) : null,
    tpCount: tps.length,
    zone: plan.zone ? { min: r(plan.zone.min), max: r(plan.zone.max) } : null,
    expireMs: 0,
    confidence: meta.confidence,
    risk: meta.riskLabel,
    setup: meta.setup,
    entryStyle: en ? style.entryStyleEn : style.entryStyle,
    setupLabel: en ? style.labelEn : style.label,
    zoneLabel: isLimit ? 'Limit Entry Zone' : 'Market Execution Zone',
    zoneNote: plan.zoneNote,
    reason: meta.reason,
    chartContext: plan.chartContext
  };
}

// ── REQUEST RESOLVER ──
const isKnownSymbol = s => Object.prototype.hasOwnProperty.call(DECIMALS, s);
const normalizeSymbol = raw => {
  let s = String(raw ?? '').toUpperCase().trim();
  s = s.replace(/TETHERUS/g, 'USDT').replace(/TETHER/g, 'USDT');
  s = s.split(/[|:]/).pop();
  s = s.replace(/[\s\/_\-]/g, '').trim();
  return s;
};

const SYMBOL_KEYS = ['symbol', 'pair', 'instrument', 'asset', 'target', 'pairName', 'ticker', 'market', 'code', 'sym'];
function findPairString(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 2) return null;
  for (const v of Object.values(obj)) { if (typeof v === 'string') { const s = normalizeSymbol(v); if (isKnownSymbol(s)) return s; } }
  for (const v of Object.values(obj)) { if (v && typeof v === 'object' && !Array.isArray(v)) { const s = findPairString(v, depth + 1); if (s) return s; } }
  return null;
}
function resolveSymbol(body, query) {
  for (const src of [body, query]) {
    if (!src || typeof src !== 'object') continue;
    for (const key of SYMBOL_KEYS) { const s = normalizeSymbol(src[key]); if (isKnownSymbol(s)) return s; }
  }
  return findPairString(body) || findPairString(query) || null;
}

// ═══════════════════════════ MAIN HANDLER ═══════════════════════════
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    const lang = pickLang(body, req.query);
    const t = TX[lang];

    const inSession = isWithinKillzone();
    const sessionNote = inSession ? '' : '(Di luar sesi London/NY, volatilitas mungkin rendah)';

    // =====================================================================
    // LOGIKA 1: JIKA REQUEST DARI VISION (ADA GAMBAR)
    // =====================================================================
    if (body.images && Array.isArray(body.images) && body.images.length > 0) {
      const access = await checkAccess(body.email);
      if (!access.ok) return res.status(403).json({ error: t[access.key] });

      const trial = await checkTrialLimit(body.email, access.status);
      if (!trial.ok) return res.status(403).json({ error: trial.msg });

      const visionRes = await getVisionSignal(body.images, lang);

      if (!visionRes.plan) {
         return res.status(400).json({ error: visionRes.reason });
      }

      const p = visionRes.plan;
      const entry = Number(p.entry);
      const sl = Number(p.sl);
      const tps = [p.tp1, p.tp2, p.tp3].filter(v => v != null).map(Number);
      const orderType = p.orderType === 'LIMIT' ? 'LIMIT' : 'NOW';

      if (!['BUY', 'SELL'].includes(p.signal)) return res.status(400).json({ error: 'AI gagal menentukan arah BUY/SELL.' });
      if (entry <= 0 || sl <= 0 || tps.some(t => t <= 0)) return res.status(400).json({ error: 'AI mengembalikan harga 0.0. Pastikan chart jelas.' });

      const dir = p.signal === 'BUY' ? 1 : -1;
      let symbol = resolveSymbol(body, req.query) || (p.symbol && p.symbol !== 'UNKNOWN' ? normalizeSymbol(p.symbol) : null);
      if (!symbol) symbol = 'UNKNOWN_PAIR';
      
      let dec = 2, pip = 0.01, gold = false, prof = PAIR_CLASS_PROFILE.fx;
      if (isKnownSymbol(symbol)) {
        dec = DECIMALS[symbol] || 2; pip = pipSizeOf(symbol, dec); gold = isGold(symbol); prof = pairProfile(symbol);
      } else {
         if (entry > 1000) { dec = 2; pip = 0.1; } else if (entry > 100) { dec = 2; pip = 0.01; } else if (entry > 1) { dec = 4; pip = 0.0001; } else if (entry > 0.01) { dec = 5; pip = 0.00001; } else if (entry > 0.0001) { dec = 6; pip = 0.000001; } else if (entry > 0.00001) { dec = 7; pip = 0.0000001; } else { dec = 8; pip = 0.00000001; }
         if (symbol.includes('XAU')) { gold = true; dec = 2; pip = 0.1; }
         prof = pairProfile(symbol.includes('XAU') ? 'gold' : (symbol.includes('BTC') ? 'crypto' : 'fx'));
      }

      const ctx = { symbol, dec, pip, gold, prof, lang };
      const f = v => { if (v === 0) return 0; if (v < 0.001) return Number(v).toFixed(8); return Number(Number(v).toFixed(dec)); };
      const riskPips = Math.abs(entry - sl) / pip;
      
      let tfText = 'Chart';
      if (Array.isArray(p.timeframes)) tfText = p.timeframes.join(', ');
      else if (typeof p.timeframes === 'string') tfText = p.timeframes;

      const aiReason = await getAIReasoning({
        ctx, dir, kind: 'vision', orderType: orderType, entry, sl, tps, setup: p.setup || 'SMC Top-Down', rawReason: p.reason, riskPips: riskPips, zoneLine: `MTF: ${tfText}`, timeframes: tfText, rangeInfo: p.range_info || '-', chartContext: p.chartContext || '-'
      });

      return res.status(200).json({
        ok: true,
        analysis_steps: [`Analisa Top-Down (${tfText})`, `Identifikasi Likuiditas & Trend HTF`, `Konfirmasi Zona LTF`, `Penentuan Entry & Anti-Sweep SL`],
        signal: {
          symbol, decimals: dec, pipSize: pip, signal: p.signal, mode: orderType === 'LIMIT' ? 'LIMIT' : 'MARKET', orderType: orderType, orderLabel: `${p.signal} ${orderType}`, status: orderType === 'LIMIT' ? 'PENDING' : 'RUNNING',
          entry: f(entry), sl: f(sl), tp1: tps[0] != null ? f(tps[0]) : null, tp2: tps[1] != null ? f(tps[1]) : null, tp3: tps[2] != null ? f(tps[2]) : null, tpCount: tps.length,
          zone: null, expireMs: 0, confidence: 'HIGH', risk: 'MEDIUM', setup: p.setup || `SMC MTF (${tfText})`, entryStyle: 'Rekomendasi AI', setupLabel: 'SMC Top-Down', zoneLabel: orderType === 'LIMIT' ? 'Limit Entry Zone' : 'Market Execution Zone', zoneNote: `Timeframes: ${tfText}`,
          reason: (aiReason || p.reason) + sessionNote,
          chartContext: p.chartContext || '-'
        }
      });
    }

    // =====================================================================
    // LOGIKA 2: JIKA REQUEST DARI LIVE SMC (TIDAK ADA GAMBAR)
    // =====================================================================
    const symbol = resolveSymbol(body, req.query);
    if (!symbol) return res.status(400).json({ error: t.noPair(Object.keys(body).join(', ') || t.emptyBody) });

    const styleKey = String(body.style || body.tradingStyle || 'Scalping').trim();
    const style = STYLES[styleKey] ? styleKey : 'Scalping';
    const styleCfg = STYLES[style];

    const access = await checkAccess(body.email);
    if (!access.ok) return res.status(403).json({ error: t[access.key] });

    const trial = await checkTrialLimit(body.email, access.status);
    if (!trial.ok) return res.status(403).json({ error: trial.msg });

    const dec = DECIMALS[symbol];
    const pip = pipSizeOf(symbol, dec);
    const gold = isGold(symbol);
    const prof = pairProfile(symbol);
    const f = v => { if (v === 0) return 0; if (v < 0.001) return Number(v).toFixed(8); return Number(Number(v).toFixed(dec)); };
    const ctx = { symbol, dec, pip, gold, f, prof, lang };

    let apiKey = API_KEYS[0] || process.env.TICKERLAYER_API_KEY || '';

    let m1 = cleanCandles(body.candles?.m1);
    let m5 = cleanCandles(body.candles?.m5);
    let m15 = cleanCandles(body.candles?.m15);

    let price = Number(body.currentPrice);
    if (!(price > 0)) price = lastClosePrice(m5) || lastClosePrice(m15) || lastClosePrice(m1);
    if (!(price > 0)) return res.status(400).json({ error: t.noPrice });

    const [lo, hi] = prof.range;
    if (price < lo || price > hi) return res.status(400).json({ error: t.range(price, symbol, lo, hi) });

    const needM1 = (style === 'Scalping' || style === 'Day Trading') ? NEED.m1 : 0;
    const needM5 = (style === 'Scalping' || style === 'Day Trading' || style === 'Intraday') ? NEED.m5 : 0;
    const needM15 = (style === 'Intraday' || style === 'Swing') ? NEED.m15 : 0;

    const pick = async (arr, tf, need) => {
      if (!need) return { candles: [], source: 'none', tried: [] };
      const frontOk = arr.length >= Math.min(need, 60) && matchesRef(arr, price);
      if (frontOk && arr.length >= need) return { candles: arr, source: 'frontend', tried: [] };
      const r = await getCandles(symbol, tf, need, apiKey, price);
      if (!r.candles.length && frontOk) return { candles: arr, source: 'frontend (parsial)', tried: r.tried };
      return r;
    };

    const [r1, r5, r15] = await Promise.all([
      pick(m1, '1m', needM1), pick(m5, '5m', needM5), pick(m15, '15m', needM15),
    ]);

    if (needM1) m1 = r1.candles;
    if (needM5) m5 = r5.candles;
    if (needM15) m15 = r15.candles;

    const failed = [['m1', r1, needM1], ['m5', r5, needM5], ['m15', r15, needM15]].filter(([, r, need]) => need && r.candles.length === 0);
    if (failed.length) {
      const detail = failed.map(([k, r]) => `${k}: ${describeTried(r.tried, price, lang)}`).join(' | ');
      return res.status(502).json({ error: t.candle(symbol, price, detail) });
    }

    if (needM1) m1 = mergeLiveBar(m1, price, 1);
    if (needM5) m5 = mergeLiveBar(m5, price, 5);
    if (needM15) m15 = mergeLiveBar(m15, price, 15);

    const rrList = styleCfg.rr;
    let result = { plan: null, reason: t.notProcessed };
    let liveSteps = [];

    if (style === 'Scalping') {
      liveSteps = [`Cek Premium/Discount Range (M15)`, `Analisa Struktur M5`, `Validasi Trigger M1`, `Entry Market NOW`];
      result = await buildScalpPlan({ m1, m5, m15, price, rrList, ctx }); 
    } else if (style === 'Day Trading') {
      liveSteps = [`Cek Zona / FVG M5`, `Validasi Likuiditas (SSL/BSL)`, `Menghitung Limit Entry`];
      result = await buildDayPlan({ m1, m5, price, rrList, ctx }); 
    } else if (style === 'Intraday') {
      liveSteps = [`Memeriksa bias M15 & H1`, `Mencari Zona Supply & Demand M5`, `Cek Liquidity Sweep (SSL/BSL)`, `Validasi rejection candle`];
      result = await buildIntradayPlan({ m5, m15, price, rrList, ctx });
    } else if (style === 'Swing') {
      liveSteps = [`Memeriksa bias D1, H4 & H1`, `Mencari Zona Supply & Demand M15`, `Cek Liquidity Sweep (SSL/BSL)`, `Validasi rejection candle`];
      result = await buildSwingPlan({ m15, price, rrList, ctx });
    }

    if (!result.plan) return res.status(200).json({ ok: false, reason: result.reason || t.noSetup, analysis_steps: liveSteps });

    const payload = toSignal(result, styleCfg, ctx);
    return res.status(200).json({ ok: true, analysis_steps: liveSteps, signal: payload });

  } catch (globalError) {
    console.error('Global Handler Error:', globalError);
    return res.status(500).json({ error: `Internal Server Error: ${globalError.message}` });
  }
}
