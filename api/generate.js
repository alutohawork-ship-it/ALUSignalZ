// api/generate.js
// v107 (Hybrid lama tetap untuk style "Scalping".
//       Scalping EMA: cross EMA 9/21 searah EMA 200, hanya di killzone, NOW saat trigger M1,
//       rejection block opsional, LIMIT terdekat jika NOW ditahan.
//       Day Trading: OCO 2 arah wajib. Area M15 strong, di-refine ke M5.
//       Momentum M1 kuat -> NOW searah, tanpa menunggu pullback.
//       SL di balik invalidation, zona yang melewati batas SL dilewati.
//       TickerLayer: slot key tetap, maksimal percobaan per request, bisa dimatikan TICKERLAYER_DISABLED=1.
//       Vision tetap.)

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

// Timeout Vision (ms). Harus lebih kecil dari maxDuration (60s) agar sempat membalas error.
const VISION_TIMEOUT_MS = 50000;
const VISION_MAX_TOKENS = 700;

// ── TICKERLAYER: slot key tetap (utama + _1 sampai _19) ──
// Slot tetap: key kosong di tengah tidak menggeser cooldown key lain.
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

// ── MINIMUM SL (PIPS) UNTUK MENCEGAH KENA SPREAD ──
const MIN_SL_PIPS = { fx: 5, fx_jpy: 5, gold: 25, silver: 8, metal: 8, crypto: 20, index: 10, commodity: 10 };
const slFloor = (kind, ctx) => {
  const base = MIN_SL_PIPS[ctx.prof.cls] || 5;
  const mult = { scalp: 1, day: 1, intraday: 1.5, swing: 2 }[kind] || 1;
  return base * mult * ctx.pip;
};

const STYLES = {
  'Scalping': {
    label: 'Scalping Agresif · Hybrid M5/M1 · NOW / LIMIT / OCO (Ranging)',
    labelEn: 'Aggressive Scalping · Hybrid M5/M1 · NOW / LIMIT / OCO (Ranging)',
    entryStyle: 'Agresif', entryStyleEn: 'Aggressive', mode: 'MIXED', kind: 'scalp', rr: [1.0, 2.0, 3.0],
  },
  'Scalping EMA': {
    label: 'Scalping Agresif EMA · Cross EMA 9/21 searah EMA 200 · Killzone · NOW / LIMIT',
    labelEn: 'Aggressive Scalping EMA · EMA 9/21 cross with EMA 200 · Killzone · NOW / LIMIT',
    entryStyle: 'Agresif', entryStyleEn: 'Aggressive', mode: 'MIXED', kind: 'scalp', rr: [1.0, 2.0, 3.0],
  },
  'Day Trading': {
    label: 'Scalping Konservatif · OCO 2 arah · Area M15 refine M5 · Momentum NOW',
    labelEn: 'Conservative Scalping · Two-way OCO · M15 area refined on M5 · Momentum NOW',
    entryStyle: 'Konservatif', entryStyleEn: 'Conservative', mode: 'LIMIT', kind: 'day',
    rr: [1.0, 2.0, 3.0],
  },
  'Intraday': {
    label: 'Day Trading / Intraday · OCO (HTF Ranging) / Trend Follow M5-M15',
    labelEn: 'Day Trading / Intraday · OCO (HTF Ranging) / Trend Follow M5-M15',
    entryStyle: 'Moderat', entryStyleEn: 'Moderate', mode: 'LIMIT', kind: 'intraday', rr: [1.0, 2.0, 3.0],
  },
  'Swing': {
    label: 'Swing · Strict Trend Following (Bias D1+H4+H1, Zona M15)',
    labelEn: 'Swing · Strict Trend Following (D1+H4+H1 Bias, M15 Zone)',
    entryStyle: 'Positioning', entryStyleEn: 'Positioning', mode: 'LIMIT', kind: 'swing', rr: [3.0],
  },
};

const NEED = { m1: 160, m5: 120, m15: 480 };
const MIN_BARS = { m1: 100, m5: 40, m15: 120, m15Swing: 400 };

const SCALP_PIVOT = 2;
const DAY_PIVOT = 3;

const ZONE_ATR_PERIOD = 14;
const ZONE_DISP_ATR = 1.2;
const ZONE_MAX_ATR = 2.5;
const ZONE_FRESH_ONLY = true;

// ── BATAS JARAK ENTRY DARI HARGA LIVE (kelipatan ATR) ──
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

// Pastikan reasoning selalu diawali nama pair, misal "XAUUSD: ..."
const withPair = (sym, text) => {
  const body = String(text || '').trim();
  if (!sym || sym === 'UNKNOWN_PAIR') return body;
  if (body.toUpperCase().startsWith(sym.toUpperCase())) return body;
  return `${sym}: ${body}`;
};

// Killzone: 07–10 dan 12–15 UTC (sekitar 14–18 dan 19–23 WIB)
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
    console.error('checkAccess error', e);
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
    if (totalCount >= 15) return { ok: false, msg: 'Batas maksimal 15 kali request untuk masa trial telah habis.' };
    if (dailyCount >= 5) return { ok: false, msg: 'Batas harian 5 kali request untuk masa trial telah habis. Coba lagi besok.' };
    await kv(['INCR', dailyKey]);
    if (dailyCount === 0) await kv(['EXPIRE', dailyKey, 172800]);
    await kv(['INCR', totalKey]);
    return { ok: true };
  } catch (e) { return { ok: true }; }
}

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
WAJIB diawali dengan nama pair: "${d.symbol}: ..."
WAJIB jelaskan narasi:
1. **Konteks State Machine**: Jelaskan alur dari Sweep -> MSS -> POI -> Signal.
2. **Konteks Premium/Discount**: Sebutkan apakah harga saat ini di area Premium (Mahal) atau Discount (Murah).
3. **Analisa Struktur & Zona**: Sebutkan zona kunci (Supply/Demand/FVG/OB) dan konfirmasi Liquidity Sweep (SSL/BSL).
4. **Alasan & Tipe Entry**: Apakah ini setup Reversal, Continuity, OCO, atau Retest?
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
    noEmail: 'Email tidak ditemukan. Silakan login ulang.',
    notRegistered: 'Email ini belum terdaftar sebagai klien.',
    expired: 'Masa akses sudah berakhir. Hubungi admin.',
    noSource: 'tidak ada sumber candle',
    emptyBody: 'body kosong',
    noPrice: 'Harga live belum tersedia. Tunggu stream terhubung.',
    noSetup: 'Belum ada setup valid.',
    notProcessed: 'Analisa belum diproses.',
    noPair: (keys) => `Simbol tidak dikenali. Field yang diterima: ${keys}`,
    range: (price, symbol, lo, hi) => `Harga ${price} di luar rentang wajar untuk ${symbol} (${lo} - ${hi}).`,
    candle: (symbol, price, detail) => `Candle ${symbol} belum tersedia (harga live ${price}). Detail: ${detail}`,
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
MUST start with the pair name: "${d.symbol}: ..."
MUST explain the narrative:
1. **State Machine Context**: Explain the flow from Sweep -> MSS -> POI -> Signal.
2. **Premium/Discount Context**: State whether the current price is in Premium or Discount.
3. **Structure & Zone Analysis**: State the key zones used (Supply/Demand/FVG/OB) and confirm Liquidity Sweep (SSL/BSL).
4. **Reason & Entry Type**: Is this a Reversal, Continuity, OCO, or Retest setup?
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
    noEmail: 'Email not found. Please log in again.',
    notRegistered: 'This email is not registered as a client.',
    expired: 'Access has expired. Please contact the admin.',
    noSource: 'no candle source',
    emptyBody: 'empty body',
    noPrice: 'Live price is not available yet. Wait for the stream to connect.',
    noSetup: 'No valid setup yet.',
    notProcessed: 'Analysis not processed yet.',
    noPair: (keys) => `Symbol not recognized. Fields received: ${keys}`,
    range: (price, symbol, lo, hi) => `Price ${price} is outside the expected range for ${symbol} (${lo} - ${hi}).`,
    candle: (symbol, price, detail) => `Candles for ${symbol} are not available (live price ${price}). Detail: ${detail}`,
  },
};
const tx = ctx => TX[ctx.lang] || TX.id;

const TL_ROUTE = {
  XAUUSD: ['commodities', 'XAUUSD'], XAUUSDX: ['commodities', 'XAUUSD'],
  XAGUSD: ['commodities', 'XAGUSD'], XPTUSD: ['commodities', 'XPTUSD'], XPDUSD: ['commodities', 'XPDUSD'],
  BRENT: ['commodities', 'BRENTUSD'], WTI: ['commodities', 'WTIUSD'],
  NATGAS: ['commodities', 'NGASUSD'], COPPER: ['commodities', 'COPPERUSD'],
  US30: ['indices', 'US30'], SPX500: ['indices', 'US500'], NAS100: ['indices', 'US100'],
  GER40: ['indices', 'DE40'], JPN225: ['indices', 'JP225'],
};

const TL_SPAN = { '1m': { mult: 1, span: 'minute', minutes: 1 }, '5m': { mult: 5, span: 'minute', minutes: 5 }, '15m': { mult: 15, span: 'minute', minutes: 15 } };
const CACHE_TTL = { '1m': 120, '5m': 300, '15m': 600 };
const CACHE_BARS = { '1m': 500, '5m': 500, '15m': 2000 };
const TL_MIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function tlCandidates(symbol) {
  const s = symbol.toUpperCase().trim();
  if (TL_ROUTE[s]) {
    const [asset, sym] = TL_ROUTE[s];
    return [{ asset, symbol: sym }];
  }
  if (CRYPTO_LIST.includes(s)) return [{ asset: 'crypto', symbol: s }];
  return [{ asset: 'forex', symbol: s }];
}

const TL_CD_SEC = { quota: 600, rate: 5, invalid: 6 * 3600 };
const tlCdMem = new Map();

function tlCooldownFor(status, body, retryAfter) {
  if (status === 401) return TL_CD_SEC.invalid;
  if (status === 429) {
    if (body && body.code === 'REST_QUOTA_EXCEEDED') return TL_CD_SEC.quota;
    const ra = Number((body && body.retry_after) || retryAfter);
    return Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : TL_CD_SEC.rate;
  }
  return 0;
}

// Slot key yang terisi dan tidak sedang cooldown. Indeks = nomor slot, jadi cooldown tetap cocok.
async function tlUsableKeys() {
  const names = TL_KEY_NAMES.map((_, i) => `tl_cd_${i}`);
  let vals = names.map(() => null);
  try {
    const raw = await kv(['MGET', ...names]);
    if (Array.isArray(raw)) vals = raw;
  } catch {}
  const now = Date.now();
  return API_KEYS
    .map((_, i) => i)
    .filter(i => API_KEYS[i] && !vals[i] && (tlCdMem.get(names[i]) || 0) <= now);
}

async function tlSetCooldown(idx, sec) {
  if (sec <= 0) return;
  const name = `tl_cd_${idx}`;
  tlCdMem.set(name, Date.now() + sec * 1000);
  try { await kv(['SET', name, '1', 'EX', sec]); } catch {}
}

async function tlFetch(url) {
  if (TL_DISABLED) {
    return { response: null, status: 503, detail: 'TickerLayer dinonaktifkan (TICKERLAYER_DISABLED=1). Kirim candle dari chart.' };
  }
  if (!TL_KEY_COUNT) return { response: null, status: 500, detail: 'Tidak ada TICKERLAYER_API_KEY di env' };

  const order = await tlUsableKeys();
  if (!order.length) return { response: null, status: 429, detail: 'Semua key TickerLayer sedang cooldown' };

  let last = { status: 500, detail: '' };
  for (const idx of order.slice(0, TL_MAX_TRY)) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    try {
      const r = await fetch(url, { headers: { 'x-api-key': API_KEYS[idx] }, signal: controller.signal });
      clearTimeout(timeoutId);

      if (r.ok) return { response: r, keyNo: idx + 1 };

      const text = await r.text().catch(() => '');
      let body = {};
      try { body = JSON.parse(text); } catch {}
      last = { status: r.status, detail: text.slice(0, 300) };

      if (r.status === 429 || r.status === 401) {
        await tlSetCooldown(idx, tlCooldownFor(r.status, body, r.headers.get('retry-after')));
        continue;
      }
      if (r.status === 403) continue;
      break;
    } catch (e) {
      clearTimeout(timeoutId);
      last = { status: 500, detail: e.message };
    }
  }
  return { response: null, status: last.status, detail: last.detail };
}

function toEpochMs(v) {
  if (typeof v === 'string' && v.trim() !== '' && Number.isNaN(Number(v))) return Date.parse(v) || 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
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
    if (!response) {
      info.status = status;
      info.error = detail || `HTTP ${status}`;
      return info;
    }
    info.status = response.status;
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
  return rows.map(c => ({
    t: Number(c?.t ?? c?.time),
    o: Number(c?.o ?? c?.open),
    h: Number(c?.h ?? c?.high),
    l: Number(c?.l ?? c?.low),
    c: Number(c?.c ?? c?.close)
  }))
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

const CANDLE_CACHE_VER = 'v6';
const matchesRef = (arr, ref) => arr.length > 0 && ref > 0 && Math.abs(arr[arr.length - 1].c - ref) / ref <= MAX_SRC_DEVIATION;

async function getCandles(symbol, tf, need, ref) {
  const cacheKey = `candles_${CANDLE_CACHE_VER}_${symbol}_${tf}`;
  const cached = await kvGetJSON(cacheKey);
  if (Array.isArray(cached) && cached.length >= need && matchesRef(cached, ref)) return { candles: cached, source: 'cache', tried: [] };
  const tried = [];
  const minBars = Math.min(need, 60);
  for (const cand of tlCandidates(symbol)) {
    const info = await fetchTickerLayerRows(cand, tf, need);
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

function getStructuralTPs(candles, dir, entry, sl, minRR = 1.0) {
  const risk = Math.abs(entry - sl);
  const { highs, lows } = findPivots(candles, 2);
  const fvgs = findRecentFVGs(candles, 40);

  let erlTargets = [];
  if (dir === 1) {
    erlTargets = highs.filter(h => h.p > entry + risk * minRR).map(h => h.p).sort((a, b) => a - b);
  } else {
    erlTargets = lows.filter(l => l.p < entry - risk * minRR).map(l => l.p).sort((a, b) => b - a);
  }

  let irlTarget = null;
  if (dir === 1) {
    const bearFVG = fvgs.filter(f => f.dir === -1 && f.lo > entry + risk * 0.5).sort((a, b) => a.lo - b.lo)[0];
    if (bearFVG) irlTarget = bearFVG.lo;
  } else {
    const bullFVG = fvgs.filter(f => f.dir === 1 && f.hi < entry - risk * 0.5).sort((a, b) => b.hi - a.hi)[0];
    if (bullFVG) irlTarget = bullFVG.hi;
  }

  let tps = [];

  if (irlTarget && Math.abs(irlTarget - entry) >= risk * minRR) {
    tps.push(irlTarget);
  } else if (erlTargets.length > 0) {
    tps.push(erlTargets[0]);
  } else {
    tps.push(entry + dir * risk * 1.0);
  }

  for (let i = 0; i < erlTargets.length; i++) {
    const target = erlTargets[i];
    if (Math.abs(target - entry) > Math.abs(tps[tps.length - 1] - entry) + (risk * 0.1)) {
      tps.push(target);
    }
    if (tps.length >= 3) break;
  }

  while (tps.length < 3) {
    const lastTpDist = Math.abs(tps[tps.length - 1] - entry);
    const nextRR = (lastTpDist / risk) + 0.5;
    tps.push(entry + dir * risk * nextRR);
  }

  return tps.slice(0, 3);
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

function slBounds(kind, ctx, atrVal) {
  if (ctx.gold) { const [a, b] = GOLD_SL_PIPS[kind]; return { min: a * ctx.pip, max: b * ctx.pip }; }
  const [a, b] = ATR_SL_MULT[kind];
  return { min: a * ctx.prof.slMul * atrVal, max: b * ctx.prof.slMul * atrVal };
}

function clampSL(dir, entry, baseSL, kind, ctx, atrVal) {
  const { pip, gold, prof } = ctx;
  let risk;
  if (kind === 'day' && gold) {
    risk = 50 * pip;
  } else {
    const b = slBounds(kind, ctx, atrVal);
    const buf = gold ? SL_BUFFER_PIPS[kind] * pip : prof.bufAtr * atrVal;
    let raw = Math.abs(entry - baseSL) + buf;
    if ((dir === 1 && baseSL >= entry) || (dir === -1 && baseSL <= entry)) raw = b.min;
    risk = Math.min(Math.max(raw, b.min, slFloor(kind, ctx)), b.max);
  }
  return entry - dir * risk;
}

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
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, messages: [{ role: 'system', content: t.aiSystem }, { role: 'user', content: prompt }], max_tokens: 500, temperature: 0.2 }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!resp.ok) return null;
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim() || null;
    return text ? withPair(symbol, text) : null;
  } catch (err) {
    console.error('AI Reasoning Exception/Timeout:', err.message);
    return null;
  }
}

async function getVisionSignal(images, lang) {
  if (!OPENAI_API_KEY) return { plan: null, reason: 'API Key AI tidak ada.' };

  const totalKB = Math.round(images.reduce((s, img) => s + (img?.length || 0), 0) / 1024);
  console.log(`[Vision] ${images.length} gambar, total ~${totalKB} KB base64`);

  const prompt = `
Anda adalah trader institusional SMC/ICT profesional. Anda menerima ${images.length} gambar chart (MetaTrader 4/5 atau TradingView, Multi-Timeframe).
TIDAK ADA gaya trading. Berikan REKOMENDASI murni berdasarkan arsitektur SMC State Machine.

LANGKAH WAJIB (Analisa Top-Down + State Machine):
1. **Baca TF**: Semua TF di tiap gambar. Kumpulkan ke ARRAY (misal ["H4", "M15", "M5"]).
2. **Baca Pair (WAJIB)**: Tentukan nama pair dari gambar.
   - MetaTrader 4/5: lihat judul jendela chart di pojok kiri atas atau tab chart (contoh "XAUUSD,M5" -> "XAUUSD"). Bisa juga dari kotak Market Watch yang aktif.
   - TradingView: lihat label di pojok kiri atas (contoh "XAUUSD · 5 · OANDA" -> "XAUUSD"). Abaikan nama exchange (OANDA, FOREXCOM, BINANCE, dll) dan timeframe.
   - Buang awalan/akhiran broker atau simbol seperti ".", "#", "m", "c" bila bukan bagian nama pair inti. Contoh: "XAUUSD.m" -> "XAUUSD".
   - "PEPE / TetherUS" -> "PEPEUSDT".
   - Jika benar-benar tidak terbaca, isi "UNKNOWN".
3. **IDLE (Dealing Range)**: Tentukan range harga saat ini (High-Low). Apakah harga berada di Premium (>50%) atau Discount (<50%)?
4. **SWEEP DETECTED**: Apakah ada likuiditas (BSL/SSL) yang baru saja disapu?
5. **MSS CONFIRMED**: Apakah ada Market Structure Shift / CHoCH di LTF?
6. **POI_REACHED**: Cari zona kunci (FVG, Order Block, Breaker). Apakah harga sudah menyentuh zona ini?
7. **SIGNAL FIRED (Entry & SL)**:
   - Tentukan Entry (NOW jika di POI, LIMIT jika menunggu retest).
   - **SL**: Letakkan SL sedikit di luar swing sweep (buffer kecil, sekitar 0.2-0.3 ATR). Jarak entry ke SL maksimal 60 pip untuk XAUUSD.
   - Jarak entry ke TP1 WAJIB minimal sama dengan jarak entry ke SL (RR minimal 1:1).
   - Tentukan TP1, TP2, TP3 berdasarkan likuiditas berikutnya.
   - **PENTING**: Field "signal" HANYA BOLEH berisi string "BUY" atau "SELL". Jangan isi dengan kata lain.
8. **chartContext**: Tuliskan alur state machine secara eksplisit (contoh: "HTF H4 Bullish -> Sweep SSL M15 -> MSS M5 -> POI FVG -> SIGNAL BUY").
9. **reason WAJIB diawali nama pair** dengan format "NAMAPAIR: ...", contoh "XAUUSD: Harga menyapu SSL di M15...".

KEMBALIKAN HANYA DALAM FORMAT JSON (tanpa teks lain, tanpa markdown):
{
  "symbol": "XAUUSD",
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
  "reason": "XAUUSD: Harga menyapu SSL di M15 (Sweep Detected), lalu terjadi MSS Bullish di M5. Entry Limit di FVG M5 yang berada di area Discount. SL aman di bawah swing low dengan buffer."
}`;

  const userContent = [
    { type: "text", text: prompt },
    ...images.map(imgBase64 => ({ type: "image_url", image_url: { url: imgBase64 } }))
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_VISION_MODEL,
        messages: [{ role: 'user', content: userContent }],
        max_tokens: VISION_MAX_TOKENS,
        temperature: 0.1,
      }),
      signal: controller.signal
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error(`[Vision] HTTP ${resp.status}: ${errText.slice(0, 300)}`);
      return { plan: null, reason: `Server AI menolak (HTTP ${resp.status}).` };
    }

    const data = await resp.json();
    console.log(`[Vision] selesai dalam ${Date.now() - startedAt} ms`);

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
      } catch (parseError) {
        console.error('[Vision] JSON parse error:', parseError.message);
        return { plan: null, reason: 'Gagal memproses format JSON dari AI. Silakan coba lagi.' };
      }
    }
    return { plan: null, reason: `AI tidak mengembalikan format JSON yang valid.` };
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    console.error(`[Vision] exception setelah ${elapsed} ms:`, err.name, err.message);
    if (err.name === 'AbortError') {
      return { plan: null, reason: `Waktu habis (${Math.round(VISION_TIMEOUT_MS / 1000)} detik): AI Vision belum selesai memproses ${images.length} gambar. Coba kurangi jumlah gambar atau perkecil ukurannya, lalu ulangi.` };
    }
    return { plan: null, reason: `Gagal memproses AI Vision: ${err.message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function finalizePlan({ dir, entry, orderType, baseSL, kind, atrVal, ctx, rrList, confidence, setup, zoneNote, zoneRange, head, lines, zoneLine, timeframes, rangeInfo, chartContext, customTPs = null }) {
  const { f, pip, gold, prof } = ctx;
  const t = tx(ctx);

  let risk, slNote = '';
  const fixedRisk = kind === 'day' && gold ? 50 * pip : null;

  if (fixedRisk) {
    risk = fixedRisk;
    slNote = ctx.lang === 'en' ? `SL fixed 50 pips` : `SL fixed 50 pip`;
  } else {
    const b = slBounds(kind, ctx, atrVal);
    const buf = gold ? SL_BUFFER_PIPS[kind] * pip : prof.bufAtr * atrVal;
    let raw = Math.abs(entry - baseSL) + buf;
    if ((dir === 1 && baseSL >= entry) || (dir === -1 && baseSL <= entry)) raw = b.min;

    risk = Math.min(Math.max(raw, b.min, slFloor(kind, ctx)), b.max);
    if (raw > b.max) slNote = t.slCapped((b.max / pip).toFixed(0), (raw / pip).toFixed(0));
  }

  const sl = entry - dir * risk;

  let tps;
  if (customTPs && customTPs.length > 0) {
    const okDir = dir === 1 ? customTPs[0] > entry : customTPs[0] < entry;
    tps = okDir ? customTPs : rrList.map(x => entry + dir * x * risk);
  } else {
    tps = rrList.map(x => entry + dir * x * risk);
  }

  const minDist = Math.min(atrVal * 0.5, slFloor(kind, ctx));
  if (Math.abs(tps[0] - entry) < minDist) {
    return { plan: null, reason: 'Dibatalkan: Target TP terlalu dekat dengan Entry (terkena noise volatilitas).' };
  }

  const parts = [head, ...lines, slNote, t.entryLine(f(entry), (risk / pip).toFixed(0), f(sl)), tps.map((val, i) => `TP${i + 1}: ${f(val)}`).join(', ')].filter(Boolean);
  const manualReason = parts.map(s => s.replace(/\.?$/, '.')).join(' • ');

  const aiReason = await getAIReasoning({ ctx, dir, kind, orderType, entry, sl, tps, setup, rawReason: manualReason, riskPips: risk / pip, zoneLine, timeframes, rangeInfo, chartContext });

  return {
    dir,
    plan: { kind, orderType, status: orderType === 'LIMIT' ? 'PENDING' : 'RUNNING', entry, bufferEnd: entry, sl, tps, zone: zoneRange || null, expireMs: 0, zoneNote, chartContext },
    meta: { confidence, riskLabel: 'MEDIUM', setup, reason: withPair(ctx.symbol, aiReason || manualReason) },
  };
}

// ═══════════════════════════ VALIDASI SETUP VISION ═══════════════════════════
const VISION_SL_RANGE_PIPS = {
  gold: [25, 60], silver: [8, 60], metal: [8, 60], fx: [5, 40], fx_jpy: [5, 40],
  index: [10, 100], commodity: [10, 100], crypto: [20, 300],
};
const VISION_MIN_RR = 1.0;
const VISION_FALLBACK_RR = [1.0, 2.0, 3.0];

function validateVisionPlan({ dir, entry, sl, tps, ctx }) {
  const { pip, prof, lang } = ctx;
  const en = lang === 'en';
  const isBuy = dir === 1;
  const [minPips, maxPips] = VISION_SL_RANGE_PIPS[prof.cls] || [5, 40];

  if (isBuy ? !(sl < entry) : !(sl > entry)) {
    return {
      ok: false,
      reason: en
        ? 'AI placed the SL on the wrong side of entry. Setup rejected, please try another chart.'
        : 'SL dari AI berada di sisi yang salah terhadap entry. Setup ditolak, coba gambar lain.',
    };
  }

  let risk = Math.abs(entry - sl);
  let riskPips = risk / pip;
  if (riskPips > maxPips) {
    return {
      ok: false,
      reason: en
        ? `SL ${riskPips.toFixed(0)} pips is too wide for ${prof.label} (max ${maxPips} pips). Setup rejected.`
        : `SL ${riskPips.toFixed(0)} pip terlalu lebar untuk ${prof.label} (maks ${maxPips} pip). Setup ditolak.`,
    };
  }

  let note = '';
  if (riskPips < minPips) {
    risk = minPips * pip;
    sl = isBuy ? entry - risk : entry + risk;
    riskPips = minPips;
    note = en
      ? `SL widened to minimum ${minPips} pips.`
      : `SL dilebarkan ke minimum ${minPips} pip.`;
  }

  const aiTps = (tps || [])
    .filter(tp => (isBuy ? tp > entry : tp < entry))
    .map(tp => ({ tp, rr: Math.abs(tp - entry) / risk }))
    .filter(x => x.rr >= VISION_MIN_RR)
    .sort((a, b) => a.rr - b.rr)
    .map(x => x.tp);

  let finalTps;
  if (aiTps.length >= 3) {
    finalTps = aiTps.slice(0, 3);
  } else {
    const sign = isBuy ? 1 : -1;
    finalTps = VISION_FALLBACK_RR.map(m => entry + sign * risk * m);
    const msg = en ? 'TP recalculated at 1R/2R/3R.' : 'TP dihitung ulang dengan RR 1R/2R/3R.';
    note = note ? `${note} ${msg}` : msg;
  }

  return { ok: true, sl, tps: finalTps, riskPips, note };
}

// ═══════════════════════════ KONFIGURASI STRONG ZONE & STRUKTUR ═══════════════════════════
const STRONG_DISP_ATR = 1.5;
const STRONG_SWEEP_BARS = 12;
const LIQ_BUF_ATR = 0.3;
const SCALP_MAX_RISK_ATR = 5;
const DAY_MAX_RISK_ATR = 6;

const SCALP_STRUCT_BARS = 60;
const SCALP_EVENT_FRESH = 12;
const SCALP_RECLAIM_ATR = 0.15;
const SCALP_CISD_LOOK = 6;
const SCALP_DISP_ATR = 1.2;
const SCALP_MAX_CHASE_ATR = 1.5;
const SCALP_MIN_DIR_CANDLES = 40;

const M1_TRIGGER_BARS = 5;

const NOW_MIN_SL_ATR_M5 = 1.0;
const NOW_MAX_SL_ATR_M5 = 2.0;
const NOW_BUF_ATR_M1 = 0.2;

const SCALP_OPP_NEAR_PIPS = 30;
const SCALP_RANGE_BARS = 20;
const SCALP_RANGE_ATR = 2.5;
const SCALP_SESSION_START = 7;
const SCALP_SESSION_END = 22;
const SCALP_COOLDOWN_MS = 20 * 60 * 1000;

function clusterPivots(pivots, tol) {
  const groups = [];
  for (const { p } of pivots) {
    const g = groups.find(x => Math.abs(x.p - p) <= tol);
    if (g) { g.n++; g.p = (g.p * (g.n - 1) + p) / g.n; }
    else groups.push({ p, n: 1 });
  }
  return groups;
}

function liquidityLevels(candles, atrVal) {
  const { highs, lows } = findPivots(candles, 2);
  const tol = atrVal * 0.25;
  const eq = arr => clusterPivots(arr, tol).filter(g => g.n >= 2).map(g => g.p);
  return {
    swingHigh: highs.map(h => h.p),
    swingLow: lows.map(l => l.p),
    eqh: eq(highs),
    eql: eq(lows),
  };
}

// Strong zone: SD dengan displacement >= STRONG_DISP_ATR yang sudah menyapu likuiditas sebelum base,
// atau FVG dengan candle displacement kuat. Setiap zona membawa `inv` = level invalidation.
function strongZoneList(candles, dir, price, atrVal, maxDist) {
  const out = [];
  if (!candles || candles.length < 20 || !(atrVal > 0)) return out;

  const sd = findSDZones(candles, dir, price, { dispAtr: STRONG_DISP_ATR, freshOnly: true });
  for (const z of sd) {
    if (z.dist > maxDist) continue;
    const base = candles[z.idx];
    const prior = candles.slice(Math.max(0, z.idx - STRONG_SWEEP_BARS), z.idx);
    if (!prior.length) continue;
    const swept = dir === 1
      ? base.l < Math.min(...prior.map(c => c.l))
      : base.h > Math.max(...prior.map(c => c.h));
    if (!swept) continue;
    out.push({
      bottom: z.bottom, top: z.top, dist: z.dist,
      tag: dir === 1 ? 'Demand' : 'Supply', strong: true, inv: z.sl,
    });
  }

  for (const f of findRecentFVGs(candles, 30)) {
    if (f.dir !== dir) continue;
    const mid = candles[f.idx];
    if (!mid || Math.abs(mid.c - mid.o) < STRONG_DISP_ATR * atrVal) continue;
    const dist = dir === 1 ? price - f.hi : f.lo - price;
    if (dist < 0 || dist > maxDist) continue;
    out.push({ bottom: f.lo, top: f.hi, dist, tag: 'FVG', strong: true, inv: dir === 1 ? f.lo : f.hi });
  }

  return out.sort((a, b) => a.dist - b.dist);
}

function nearestLiquidity(dir, liq, edge, atrVal) {
  const buf = 0.1 * atrVal;
  const pool = dir === 1
    ? [...liq.eql.map(p => ({ p, name: 'EQL' })), ...liq.swingLow.map(p => ({ p, name: 'SSL' }))]
        .filter(x => x.p < edge - buf)
    : [...liq.eqh.map(p => ({ p, name: 'EQH' })), ...liq.swingHigh.map(p => ({ p, name: 'BSL' }))]
        .filter(x => x.p > edge + buf);
  if (!pool.length) return null;
  return dir === 1
    ? pool.reduce((a, b) => (b.p > a.p ? b : a))
    : pool.reduce((a, b) => (b.p < a.p ? b : a));
}

function buildLiquidityOrder({ dir, zone, liq, atrVal, ctx, kind, maxRiskAtr, rrList, entryOverride = null }) {
  const entry = entryOverride ?? (dir === 1 ? zone.top : zone.bottom);
  const edge = dir === 1 ? zone.bottom : zone.top;
  const liqPick = nearestLiquidity(dir, liq, edge, atrVal);
  if (!liqPick) return null;

  const buf = LIQ_BUF_ATR * atrVal;
  const slRaw = dir === 1 ? liqPick.p - buf : liqPick.p + buf;
  const rawRisk = Math.abs(entry - slRaw);
  if (dir === 1 ? entry <= slRaw : entry >= slRaw) return null;
  if (rawRisk > maxRiskAtr * atrVal) return null;

  const risk = Math.max(rawRisk, slFloor(kind, ctx));
  const sl = entry - dir * risk;
  const tps = rrList.map(m => entry + dir * risk * m);

  return {
    dir, entry, sl, risk, tps,
    label: `${dir === 1 ? 'Buy' : 'Sell'} Limit · ${zone.tag} · SL di balik ${liqPick.name}`,
    zone: { min: zone.bottom, max: zone.top },
    liqLevel: liqPick.p,
    liqName: liqPick.name,
    tag: zone.tag,
  };
}

function buildNowOrder({ dir, entry, baseSL, atrM5, atrM1, ctx, rrList, structName }) {
  if (dir === 1 ? baseSL >= entry : baseSL <= entry) return null;
  const raw = Math.abs(entry - baseSL) + NOW_BUF_ATR_M1 * atrM1;
  const maxR = NOW_MAX_SL_ATR_M5 * atrM5;
  if (raw > maxR) return null;
  const minR = NOW_MIN_SL_ATR_M5 * atrM5;
  const risk = Math.max(raw, minR, slFloor('scalp', ctx));
  const sl = entry - dir * risk;
  const tps = rrList.map(m => entry + dir * risk * m);
  return {
    dir, entry, sl, risk, tps,
    label: `${dir === 1 ? 'Buy' : 'Sell'} NOW · SL di balik ${structName}`,
    zone: null,
    liqLevel: baseSL,
    liqName: structName,
    tag: 'NOW',
  };
}

async function planFromOrder(o, { ctx, kind, orderType, setup, chartContext, timeframes, rangeInfo, head, lines, confidence }) {
  const fx = v => Number(Number(v).toFixed(ctx.dec));
  const riskPips = o.risk / ctx.pip;
  const parts = [
    head,
    ...lines,
    `Entry ${fx(o.entry)}, SL (${riskPips.toFixed(0)} pip) di ${fx(o.sl)} di balik ${o.liqName} ${fx(o.liqLevel)}`,
    o.tps.map((v, i) => `TP${i + 1}: ${fx(v)}`).join(', '),
  ].filter(Boolean);
  const manual = parts.map(s => s.replace(/\.?$/, '.')).join(' • ');

  const aiReason = await getAIReasoning({
    ctx, dir: o.dir, kind, orderType, entry: o.entry, sl: o.sl, tps: o.tps, setup,
    rawReason: manual, riskPips, zoneLine: o.label, timeframes, rangeInfo, chartContext,
  });

  return {
    dir: o.dir,
    plan: {
      kind, orderType, status: orderType === 'LIMIT' ? 'PENDING' : 'RUNNING',
      entry: o.entry, bufferEnd: o.entry, sl: o.sl, tps: o.tps,
      zone: orderType === 'LIMIT' && o.zone ? o.zone : null,
      expireMs: 0, zoneNote: o.label, chartContext,
    },
    meta: { confidence, riskLabel: 'MEDIUM', setup, reason: withPair(ctx.symbol, aiReason || manual) },
  };
}

function buildOcoResult(buy, sell, { ctx, setup, chartContext, confidence }) {
  const fx = v => Number(Number(v).toFixed(ctx.dec));
  const manual = `OCO strong zone. BUY @ ${fx(buy.entry)} (SL ${fx(buy.sl)} di balik ${buy.liqName} ${fx(buy.liqLevel)}). SELL @ ${fx(sell.entry)} (SL ${fx(sell.sl)} di balik ${sell.liqName} ${fx(sell.liqLevel)}). Jika salah satu tersentuh, order lawannya dibatalkan.`;
  return {
    plan: { isOCO: true, orders: [buy, sell], setup, chartContext },
    meta: { confidence, riskLabel: 'MEDIUM', reason: withPair(ctx.symbol, manual) },
  };
}

function pickLimitSetup({ buyO, sellO, bias, ctx, setupPrefix, chartContext, confidence = 'HIGH' }) {
  if (buyO && sellO) {
    return buildOcoResult(buyO, sellO, {
      ctx, setup: `${setupPrefix} OCO (Strong Zone)`, chartContext, confidence,
    });
  }
  if (buyO && bias >= 0) return { single: buyO, setup: `${setupPrefix} BUY LIMIT (Strong Zone)` };
  if (sellO && bias <= 0) return { single: sellO, setup: `${setupPrefix} SELL LIMIT (Strong Zone)` };
  return null;
}

function scalpStructureEvents(cands, atrDir) {
  const s = cands.slice(-SCALP_STRUCT_BARS);
  const n = s.length;
  if (n < 20 || !(atrDir > 0)) return { events: [], trend: 0, current: null };

  const tol = SCALP_RECLAIM_ATR * atrDir;
  const { highs, lows } = findPivots(s, 2);
  const events = [];

  let trend = 0;
  if (highs.length >= 2 && lows.length >= 2) {
    const [h1, h2] = highs.slice(-2);
    const [l1, l2] = lows.slice(-2);
    if (h2.p > h1.p && l2.p > l1.p) trend = 1;
    else if (h2.p < h1.p && l2.p < l1.p) trend = -1;
  }

  const lastH = highs[highs.length - 1];
  const lastL = lows[lows.length - 1];
  if (lastH) {
    for (let i = lastH.i + 1; i < n; i++) {
      if (s[i].c > lastH.p) {
        events.push({ idx: i, dir: 1, type: trend === -1 ? 'CHoCH Bullish' : 'BOS Bullish', level: lastH.p });
        break;
      }
    }
  }
  if (lastL) {
    for (let i = lastL.i + 1; i < n; i++) {
      if (s[i].c < lastL.p) {
        events.push({ idx: i, dir: -1, type: trend === 1 ? 'CHoCH Bearish' : 'BOS Bearish', level: lastL.p });
        break;
      }
    }
  }

  for (let i = Math.max(SCALP_CISD_LOOK, n - SCALP_EVENT_FRESH); i < n; i++) {
    const c = s[i];
    const body = c.c - c.o;
    if (Math.abs(body) < SCALP_DISP_ATR * atrDir) continue;
    const up = body > 0;
    let k = -1;
    for (let j = i - 1; j >= Math.max(0, i - SCALP_CISD_LOOK); j--) {
      if (up ? s[j].c < s[j].o : s[j].c > s[j].o) { k = j; break; }
    }
    if (k < 0) continue;
    if ((up && c.c > s[k].o) || (!up && c.c < s[k].o)) {
      events.push({ idx: i, dir: up ? 1 : -1, type: up ? 'CISD Bullish' : 'CISD Bearish', level: s[k].o });
    }
  }

  const valid = events.filter(e => {
    if (e.idx < n - SCALP_EVENT_FRESH) return false;
    const after = s.slice(e.idx + 1);
    if (e.dir === 1) return !after.some(c => c.c < e.level - tol);
    return !after.some(c => c.c > e.level + tol);
  });
  valid.sort((a, b) => b.idx - a.idx);

  return { events: valid, trend, current: valid[0] || null };
}

function isRangingDir(cands, atrDir) {
  const s = cands.slice(-SCALP_RANGE_BARS);
  if (s.length < SCALP_RANGE_BARS || !(atrDir > 0)) return false;
  const hi = Math.max(...s.map(c => c.h));
  const lo = Math.min(...s.map(c => c.l));
  return (hi - lo) < SCALP_RANGE_ATR * atrDir;
}

function m1Trigger(m1, dir) {
  if (!m1 || m1.length < M1_TRIGGER_BARS + 1) return false;
  const last = m1[m1.length - 1];
  const prev = m1.slice(-(M1_TRIGGER_BARS + 1), -1);
  if (dir === 1) return last.c > Math.max(...prev.map(c => c.h));
  return last.c < Math.min(...prev.map(c => c.l));
}

function inScalpSession(now = new Date()) {
  const h = now.getUTCHours();
  return h >= SCALP_SESSION_START && h < SCALP_SESSION_END;
}

function cooldownDirs(recentSL, now = Date.now()) {
  const blocked = new Set();
  if (!Array.isArray(recentSL)) return blocked;
  for (const x of recentSL) {
    const t = Number(x?.t);
    const d = Number(x?.dir);
    if ((d === 1 || d === -1) && Number.isFinite(t) && now - t < SCALP_COOLDOWN_MS) blocked.add(d);
  }
  return blocked;
}

function biasAllows(dir, biasM15Dir, evType) {
  if (evType && evType.includes('CHoCH')) return true;
  if (biasM15Dir === 0) return true;
  return biasM15Dir === dir;
}

// ═══════════════════════════ WORKFLOW MTF ═══════════════════════════

// ── SCALPING AGRESIF (hybrid lama) ──
async function buildScalpPlan({ m1, m5, m15, price, rrList, ctx, recentSL = [] }) {
  const { pip } = ctx;
  const t = tx(ctx);
  const fx = v => Number(Number(v).toFixed(ctx.dec));

  const atrM1 = atrOf(m1, pip);
  const m5ok = Array.isArray(m5) && m5.length >= SCALP_MIN_DIR_CANDLES;
  const dirCands = m5ok ? m5 : m1;
  const atrDir = m5ok ? atrOf(m5, pip) : atrM1;
  const atrM5 = m5ok ? atrDir : atrOf(m1, pip) * 5 / Math.sqrt(5);
  const dirTf = m5ok ? 'M5' : 'M1';

  const maxZoneDist = SCALP_MAX_DIST_ATR * atrM1;
  const maxNearDist = SCALP_OPP_NEAR_PIPS * pip;
  const tol = SCALP_RECLAIM_ATR * atrDir;

  const biasM15 = analyzePureSMCStructure(m15);
  const rangeM15 = getRangeInfo(m15, 50);
  let rangeInfoStr = '-';
  if (rangeM15 && rangeM15.high > rangeM15.low) {
    const diff = rangeM15.high - rangeM15.low;
    const pricePos = (price - rangeM15.low) / diff;
    rangeInfoStr = `M15 Range: ${pricePos > 0.5 ? 'PREMIUM' : 'DISCOUNT'} (Pos: ${(pricePos * 100).toFixed(1)}%)`;
  }

  const ranging = isRangingDir(dirCands, atrDir);
  const sessionOk = inScalpSession();
  const blocked = cooldownDirs(recentSL);
  const fvgs = findRecentFVGs(m1, 20);
  const liq = liquidityLevels(m1.slice(-100), atrM1);
  const demandZ = strongZoneList(m1, 1, price, atrM1, maxZoneDist);
  const supplyZ = strongZoneList(m1, -1, price, atrM1, maxZoneDist);

  if (!ranging) {
    const cands = [];

    const ev = scalpStructureEvents(dirCands, atrDir).current;
    if (ev) {
      const sideOk = ev.dir === 1 ? price > ev.level - tol : price < ev.level + tol;
      const chased = Math.abs(price - ev.level) > SCALP_MAX_CHASE_ATR * atrDir;
      const overextended = ev.dir === 1
        ? price > recentExtreme(dirCands, -1, 10) + 3 * atrDir
        : price < recentExtreme(dirCands, 1, 10) - 3 * atrDir;
      if (sideOk && !chased && !overextended) {
        const baseSL = ev.dir === 1
          ? Math.min(ev.level, recentExtreme(dirCands, 1, 5))
          : Math.max(ev.level, recentExtreme(dirCands, -1, 5));
        cands.push({ dir: ev.dir, type: `${ev.type} (${dirTf})`, evType: ev.type, baseSL, zone: null });
      }
    }

    const inFvgBull = fvgs.find(f => f.dir === 1 && price >= f.lo && price <= f.hi);
    const inFvgBear = fvgs.find(f => f.dir === -1 && price >= f.lo && price <= f.hi);
    if (inFvgBull) cands.push({ dir: 1, type: 'M1 Bullish FVG', evType: 'FVG', baseSL: inFvgBull.lo - 0.25 * atrM1, zone: { min: inFvgBull.lo, max: inFvgBull.hi } });
    if (inFvgBear) cands.push({ dir: -1, type: 'M1 Bearish FVG', evType: 'FVG', baseSL: inFvgBear.hi + 0.25 * atrM1, zone: { min: inFvgBear.lo, max: inFvgBear.hi } });

    for (const c of cands) {
      if (blocked.has(c.dir)) continue;
      if (!biasAllows(c.dir, biasM15.dir, c.evType)) continue;

      const opp = strongZoneList(m1, -c.dir, price, atrM1, maxNearDist)
        .filter(z => (c.dir === 1 ? z.bottom > price : z.top < price))[0];
      if (opp) {
        const o = buildLiquidityOrder({ dir: -c.dir, zone: opp, liq, atrVal: atrM1, ctx, kind: 'scalp', maxRiskAtr: SCALP_MAX_RISK_ATR, rrList });
        if (o) {
          const pips = Math.round(opp.dist / pip);
          return await planFromOrder(o, {
            ctx, kind: 'scalp', orderType: 'LIMIT',
            setup: `${o.dir === 1 ? 'BUY' : 'SELL'} LIMIT (flip ${c.type}, zona lawan ${pips} pip)`,
            chartContext: `${c.type} ${c.dir === 1 ? 'naik' : 'turun'}, zona ${opp.tag} ${pips} pip -> LIMIT`,
            timeframes: `M1, ${dirTf}, M15`, rangeInfo: rangeInfoStr,
            head: t.headLine(t.title.scalp, o.dir === 1 ? 'BUY' : 'SELL', 'LIMIT', ctx.symbol),
            lines: [`${c.type} searah ${c.dir === 1 ? 'naik' : 'turun'}, tetapi zona ${c.dir === 1 ? 'SELL' : 'BUY'} strong ada ${pips} pip di depan. Entry dipasang LIMIT, bukan NOW.`],
            confidence: 'HIGH',
          });
        }
      }

      if (!sessionOk) continue;
      if (!m1Trigger(m1, c.dir)) continue;
      const nowO = buildNowOrder({
        dir: c.dir, entry: price, baseSL: c.baseSL, atrM5, atrM1, ctx, rrList,
        structName: `Struktur ${dirTf}`,
      });
      if (!nowO) continue;

      return await planFromOrder(nowO, {
        ctx, kind: 'scalp', orderType: 'NOW',
        setup: `${c.type} (Market NOW)`,
        chartContext: `${c.type} (arah ${dirTf}) + trigger M1 -> NOW ${c.dir === 1 ? 'BUY' : 'SELL'}`,
        timeframes: `M1, ${dirTf}, M15`, rangeInfo: rangeInfoStr,
        head: t.headLine(t.title.scalp, c.dir === 1 ? 'BUY' : 'SELL', 'NOW', ctx.symbol),
        lines: [`${c.type} searah ${c.dir === 1 ? 'naik' : 'turun'}, pemicu M1 terkonfirmasi, bias M15 ${dirLabel(biasM15.dir)}. SL minimal ${NOW_MIN_SL_ATR_M5} ATR M5.`],
        confidence: 'HIGH',
      });
    }

    if (sessionOk) {
      const inDemand = demandZ.find(z => price >= z.bottom && price <= z.top);
      const inSupply = supplyZ.find(z => price >= z.bottom && price <= z.top);
      if (inDemand && biasAllows(1, biasM15.dir, null) && !blocked.has(1) && m1Trigger(m1, 1)) {
        const o = buildLiquidityOrder({ dir: 1, zone: inDemand, liq, atrVal: atrM1, ctx, kind: 'scalp', maxRiskAtr: SCALP_MAX_RISK_ATR, rrList, entryOverride: price });
        if (o) return await planFromOrder(o, {
          ctx, kind: 'scalp', orderType: 'NOW', setup: 'M1 Strong Demand (Market NOW)',
          chartContext: `M15 ${biasM15.src} -> M1 Strong Demand NOW BUY`, timeframes: 'M1, M5, M15', rangeInfo: rangeInfoStr,
          head: t.headLine(t.title.scalp, 'BUY', 'NOW', ctx.symbol),
          lines: ['Harga di dalam strong demand M1 dengan pemicu M1. Eksekusi NOW, SL di balik likuiditas.'],
          confidence: 'HIGH',
        });
      }
      if (inSupply && biasAllows(-1, biasM15.dir, null) && !blocked.has(-1) && m1Trigger(m1, -1)) {
        const o = buildLiquidityOrder({ dir: -1, zone: inSupply, liq, atrVal: atrM1, ctx, kind: 'scalp', maxRiskAtr: SCALP_MAX_RISK_ATR, rrList, entryOverride: price });
        if (o) return await planFromOrder(o, {
          ctx, kind: 'scalp', orderType: 'NOW', setup: 'M1 Strong Supply (Market NOW)',
          chartContext: `M15 ${biasM15.src} -> M1 Strong Supply NOW SELL`, timeframes: 'M1, M5, M15', rangeInfo: rangeInfoStr,
          head: t.headLine(t.title.scalp, 'SELL', 'NOW', ctx.symbol),
          lines: ['Harga di dalam strong supply M1 dengan pemicu M1. Eksekusi NOW, SL di balik likuiditas.'],
          confidence: 'HIGH',
        });
      }
    }
  }

  const minGap = 0.1 * atrM1;
  const buyZ = demandZ.filter(z => z.top < price - minGap)[0];
  const sellZ = supplyZ.filter(z => z.bottom > price + minGap)[0];
  const buyOrder = buyZ && !blocked.has(1) ? buildLiquidityOrder({ dir: 1, zone: buyZ, liq, atrVal: atrM1, ctx, kind: 'scalp', maxRiskAtr: SCALP_MAX_RISK_ATR, rrList }) : null;
  const sellOrder = sellZ && !blocked.has(-1) ? buildLiquidityOrder({ dir: -1, zone: sellZ, liq, atrVal: atrM1, ctx, kind: 'scalp', maxRiskAtr: SCALP_MAX_RISK_ATR, rrList }) : null;

  const setupPrefix = ranging ? 'M1 Ranging' : 'M1 Sideways';
  const pick = pickLimitSetup({ buyO: buyOrder, sellO: sellOrder, bias: biasM15.dir, ctx, setupPrefix, chartContext: `M15 ${biasM15.src} -> M1 ${ranging ? 'Ranging' : 'Sideways'} OCO` });

  if (pick && pick.plan) {
    return { dir: 0, plan: pick.plan, meta: pick.meta };
  }
  if (pick && pick.single) {
    const o = pick.single;
    return await planFromOrder(o, {
      ctx, kind: 'scalp', orderType: 'LIMIT', setup: pick.setup,
      chartContext: `M15 ${biasM15.src} -> M1 ${ranging ? 'Ranging' : 'Sideways'} LIMIT`, timeframes: 'M1, M5, M15', rangeInfo: rangeInfoStr,
      head: t.headLine(t.title.scalp, o.dir === 1 ? 'BUY' : 'SELL', 'LIMIT', ctx.symbol),
      lines: [`${ranging ? 'Pasar ranging' : 'Tidak ada event struktur valid'}. Hanya satu sisi strong zone yang aman, searah bias M15.`],
      confidence: 'MEDIUM',
    });
  }

  const why = !sessionOk ? 'Di luar sesi London/NY (NOW ditutup).'
    : blocked.size ? 'Cooldown setelah SL aktif.'
    : 'Tidak ada trigger M1 atau strong zone aman.';
  return {
    plan: null,
    reason: `${ranging ? 'Pasar ranging' : 'Tidak ada event struktur ' + dirTf + ' yang valid'}. ${why} Menunggu setup.`,
  };
}

// ═══════════════════════════ SCALPING KONSERVATIF (DAY TRADE) ═══════════════════════════
const DAY_ZONE_DISP_ATR = 0.8;      // zona biasa M5: displacement minimal 0,8 ATR M5
const DAY_LEG_MAX_ATR = 2;          // kaki OCO tidak boleh lebih dari 2 ATR M5 dari harga
const DAY_SL_OVER_MODE = 'skip';    // 'skip' = zona dengan invalidation di luar batas SL dilewati, 'cut' = SL dipotong
const DAY_SL_MODE = 'dynamic';      // 'dynamic' = di balik invalidation, 'fixed' = jarak tetap
const DAY_MAX_SL_PIPS = { XAUUSD: 50, XAUUSDX: 50 };
const DAY_FIXED_SL_PIPS = { XAUUSD: 50, XAUUSDX: 50 };
const DAY_SL_BUF_ATR_M5 = 0.5;      // buffer di balik invalidation, kelipatan ATR M5
const DAY_REFINE_SL = 'm5';         // 'm5' = SL di balik invalidation M5 (sempit), 'm15' = di balik M15 (lebih aman)
const DAY_MOM_BARS = 6;             // jendela momentum M1
const DAY_MOM_MIN_ATR = 2.5;        // gerak bersih minimal 2,5 ATR M1 dalam jendela
const DAY_MOM_CONFIRM = 4;          // minimal 4 dari 6 candle searah
const DAY_MOM_OPP_PIPS = 30;        // zona lawan kuat dalam jarak ini membatalkan NOW momentum

// Order untuk satu kaki. entryOverride = tepi LIMIT, atau harga live untuk NOW.
// allowCut = true hanya dipakai kalau tidak ada zona lain yang muat dalam batas SL.
function buildDayOrder(dir, zone, atrM5, ctx, rrList, entryOverride = null, isNow = false, allowCut = false) {
  const { pip, symbol } = ctx;
  const entry = entryOverride ?? (dir === 1 ? zone.top : zone.bottom);
  const inv = zone.inv ?? (dir === 1 ? zone.bottom : zone.top);
  const buf = DAY_SL_BUF_ATR_M5 * atrM5;
  const slRaw = dir === 1 ? inv - buf : inv + buf;
  if (dir === 1 ? slRaw >= entry : slRaw <= entry) return null;

  const capPips = DAY_MAX_SL_PIPS[symbol];
  const capPrice = capPips ? capPips * pip : DAY_MAX_RISK_ATR * atrM5;
  const fixedPips = DAY_FIXED_SL_PIPS[symbol];
  const useFixed = DAY_SL_MODE === 'fixed' && !!fixedPips;

  let risk = useFixed ? fixedPips * pip : Math.abs(entry - slRaw);
  let capped = false;
  if (!useFixed && risk > capPrice) {
    if (DAY_SL_OVER_MODE === 'skip' && !allowCut) return null;
    risk = capPrice;
    capped = true;
  }
  risk = Math.max(risk, slFloor('day', ctx));

  const sl = entry - dir * risk;
  const tps = rrList.map(m => entry + dir * risk * m);
  const side = dir === 1 ? 'Buy' : 'Sell';
  const kind = isNow ? 'NOW' : 'Limit';
  const slText = useFixed ? `SL tetap ${fixedPips} pip` : 'SL di balik invalidation';
  return {
    dir, entry, sl, risk, tps,
    label: `${side} ${kind} · ${zone.tag} · ${slText}${capped ? ' (dipotong ke batas maks)' : ''}`,
    zone: { min: zone.bottom, max: zone.top },
    liqLevel: inv, liqName: 'invalidation', tag: zone.tag, capped, strong: !!zone.strong,
  };
}

// Momentum M1: gerak bersih cepat dan mayoritas candle searah. Return 1, -1, atau 0.
function momentumDir(m1, atrM1) {
  if (!m1 || m1.length < DAY_MOM_BARS + 1 || !(atrM1 > 0)) return 0;
  const last = m1[m1.length - 1];
  const base = m1[m1.length - 1 - DAY_MOM_BARS];
  const net = last.c - base.c;
  if (Math.abs(net) < DAY_MOM_MIN_ATR * atrM1) return 0;
  const dir = net > 0 ? 1 : -1;
  const win = m1.slice(-DAY_MOM_BARS);
  const agree = win.filter(c => (dir === 1 ? c.c > c.o : c.c < c.o)).length;
  return agree >= DAY_MOM_CONFIRM ? dir : 0;
}

async function buildDayPlan({ m1, m5, m15, price, rrList, ctx }) {
  const t = tx(ctx);
  const { pip } = ctx;
  const atrM1 = atrOf(m1, pip);
  const atrM5 = atrOf(m5, pip);
  const atrM15 = atrOf(m15, pip);
  const legMax = DAY_LEG_MAX_ATR * atrM5;
  const gap = 0.1 * atrM5;

  const biasM15 = analyzePureSMCStructure(m15);
  const dirM15 = biasM15.dir || emaBias(m15, 20);
  const dirM5 = analyzePureSMCStructure(m5).dir;
  const trendTxt = `Bias M15 ${dirLabel(dirM15)}, M5 ${dirLabel(dirM5)}.`;

  const rangeM5 = getRangeInfo(m5, 50);
  const rangeInfoStr = rangeM5 && rangeM5.high > rangeM5.low
    ? `M5 Range Pos: ${(((price - rangeM5.low) / (rangeM5.high - rangeM5.low)) * 100).toFixed(1)}%`
    : '-';

  const liq = liquidityLevels(m5.slice(-120), atrM5);
  const onSide = (dir, z) => (dir === 1 ? z.top < price - gap : z.bottom > price + gap);

  // LIMIT di tepi zona terdekat, tidak melewati harga
  const limitEntry = (dir, zone) => dir === 1
    ? Math.max(zone.bottom, Math.min(zone.top, price - gap))
    : Math.min(zone.top, Math.max(zone.bottom, price + gap));

  // Cadangan terakhir: swing terdekat, lalu ATR Pullback
  const fallback = dir => {
    const lvl = dir === 1
      ? [...liq.eql, ...liq.swingLow].filter(p => p < price - gap).sort((a, b) => b - a)[0]
      : [...liq.eqh, ...liq.swingHigh].filter(p => p > price + gap).sort((a, b) => a - b)[0];
    if (lvl != null) {
      return {
        bottom: lvl - 0.1 * atrM5, top: lvl + 0.1 * atrM5, dist: Math.abs(price - lvl),
        tag: 'Swing', strong: false, inv: lvl,
      };
    }
    const p = dir === 1 ? price - atrM5 : price + atrM5;
    return {
      bottom: p - 0.1 * atrM5, top: p + 0.1 * atrM5, dist: atrM5,
      tag: 'ATR Pullback', strong: false, inv: p,
    };
  };

  // ── 1. MOMENTUM: harga bergerak cepat, tidak menunggu pullback ──
  const momDir = momentumDir(m1, atrM1);
  if (momDir !== 0) {
    const oppStrong = [
      ...strongZoneList(m5, -momDir, price, atrM5, DAY_MOM_OPP_PIPS * pip),
      ...strongZoneList(m15, -momDir, price, atrM15, DAY_MOM_OPP_PIPS * pip),
    ];
    if (!oppStrong.length) {
      const zone = {
        bottom: price, top: price,
        inv: recentExtreme(m1, momDir, DAY_MOM_BARS),
        tag: 'Momentum M1', strong: false,
      };
      const o = buildDayOrder(momDir, zone, atrM5, ctx, rrList, price, true, false);
      if (o) {
        const aligned = dirM15 === momDir;
        const side = momDir === 1 ? 'BUY' : 'SELL';
        return await planFromOrder(o, {
          ctx, kind: 'day', orderType: 'NOW',
          setup: `${side} NOW (Momentum M1)`,
          chartContext: `${trendTxt} Momentum M1 ${momDir === 1 ? 'naik' : 'turun'} kuat -> NOW`,
          timeframes: 'M1, M5, M15', rangeInfo: rangeInfoStr,
          head: t.headLine(t.title.day, side, 'NOW', ctx.symbol),
          lines: [
            `Harga bergerak cepat (${DAY_MOM_MIN_ATR} ATR M1 dalam ${DAY_MOM_BARS} candle). Pending LIMIT tidak diambil, eksekusi NOW.`
            + (aligned ? '' : ' Melawan bias M15, risiko lebih tinggi.'),
          ],
          confidence: aligned ? 'HIGH' : 'LOW',
        });
      }
    }
  }

  // ── 2. OCO dua arah wajib ──
  // Tier 5: strong M15 dengan zona M5 di dalamnya (refine)
  // Tier 4: strong M15 tanpa zona M5
  // Tier 3: strong M5 tanpa M15
  // Tier 2: zona biasa M5
  // Tier 1: cadangan swing/ATR

  // Zona M5 yang berada di dalam (atau menyentuh) zona M15. Strong M5 diutamakan.
  const refineInM15 = (dir, htf) => {
    const overlaps = z => z.top >= htf.bottom && z.bottom <= htf.top;
    const fromStrong = strongZoneList(m5, dir, price, atrM5, legMax)
      .filter(z => onSide(dir, z) && overlaps(z))
      .map(z => ({ bottom: z.bottom, top: z.top, dist: z.dist, tag: `M5 Strong ${z.tag}`, inv: z.inv }));
    const fromZona = findSDZones(m5, dir, price, { dispAtr: DAY_ZONE_DISP_ATR, freshOnly: true })
      .filter(z => onSide(dir, z) && z.dist <= legMax && overlaps(z))
      .map(z => ({ bottom: z.bottom, top: z.top, dist: z.dist, tag: 'M5 Zona', inv: z.sl }));
    return fromStrong.sort((a, b) => a.dist - b.dist)[0]
      || fromZona.sort((a, b) => a.dist - b.dist)[0]
      || null;
  };

  const legCandidates = dir => {
    const out = [];

    for (const h of strongZoneList(m15, dir, price, atrM15, legMax).filter(z => onSide(dir, z))) {
      const r = refineInM15(dir, h);
      if (r) {
        out.push({
          bottom: r.bottom, top: r.top, dist: r.dist,
          tag: `M15 Strong ${h.tag} → ${r.tag}`,
          strong: true, tier: 5,
          inv: DAY_REFINE_SL === 'm15' ? h.inv : r.inv,
        });
      } else {
        out.push({
          bottom: h.bottom, top: h.top, dist: h.dist,
          tag: `M15 Strong ${h.tag}`, strong: true, tier: 4, inv: h.inv,
        });
      }
    }

    for (const s of strongZoneList(m5, dir, price, atrM5, legMax).filter(z => onSide(dir, z))) {
      out.push({ bottom: s.bottom, top: s.top, dist: s.dist, tag: `M5 Strong ${s.tag}`, strong: true, tier: 3, inv: s.inv });
    }

    for (const z of findSDZones(m5, dir, price, { dispAtr: DAY_ZONE_DISP_ATR, freshOnly: true })) {
      if (!onSide(dir, z) || z.dist > legMax) continue;
      out.push({ bottom: z.bottom, top: z.top, dist: z.dist, tag: 'M5 Zona', strong: false, tier: 2, inv: z.sl });
    }

    out.push({ ...fallback(dir), tier: 1 });
    return out.sort((a, b) => b.tier - a.tier || a.dist - b.dist);
  };

  const pickLeg = (dir, allowCut) => {
    for (const z of legCandidates(dir)) {
      const o = buildDayOrder(dir, z, atrM5, ctx, rrList, limitEntry(dir, z), false, allowCut);
      if (o) return { z, o };
    }
    return null;
  };

  // OCO dua arah wajib. Kalau tidak ada kaki yang muat dalam batas SL, baru pakai SL dipotong.
  const buy = pickLeg(1, false) || pickLeg(1, true);
  const sell = pickLeg(-1, false) || pickLeg(-1, true);
  if (!buy || !sell) {
    return { plan: null, reason: 'OCO dua arah belum bisa dibentuk: kaki valid tidak ditemukan di kedua sisi. Menunggu.' };
  }

  const minTier = Math.min(buy.z.tier, sell.z.tier);
  const anyCut = buy.o.capped || sell.o.capped;
  let confidence = minTier >= 5 ? 'HIGH' : minTier >= 3 ? 'MEDIUM' : 'LOW';
  if (anyCut) confidence = 'LOW';

  const fx = v => Number(Number(v).toFixed(ctx.dec));
  const pipsOf = o => (o.risk / pip).toFixed(0);
  const cutTxt = anyCut ? ' Salah satu kaki memakai SL dipotong karena tidak ada zona dengan invalidation dalam batas.' : '';
  const manual = `OCO konservatif 2 arah. BUY LIMIT @ ${fx(buy.o.entry)} (${buy.z.tag}, SL ${fx(buy.o.sl)}, ${pipsOf(buy.o)} pip). SELL LIMIT @ ${fx(sell.o.entry)} (${sell.z.tag}, SL ${fx(sell.o.sl)}, ${pipsOf(sell.o)} pip). Jika salah satu tersentuh, order lawannya dibatalkan. ${trendTxt}${cutTxt}`;

  return {
    plan: {
      isOCO: true,
      orders: [buy.o, sell.o],
      setup: `Konservatif OCO 2 arah (${buy.z.tag} / ${sell.z.tag})`,
      chartContext: `${trendTxt} -> OCO 2 arah, M15 sebagai area, M5 sebagai refine`,
    },
    meta: { confidence, riskLabel: 'MEDIUM', reason: withPair(ctx.symbol, manual) },
  };
}

// ── INTRADAY: bias H1/M15 fleksibel (struktur → EMA), zona M5 lalu fallback M15 ──
async function buildIntradayPlan({ m5, m15, price, rrList, ctx }) {
  const t = tx(ctx);
  const { f, pip } = ctx;
  const h1 = aggregateCandles(m15, 60);
  const atrM5 = atrOf(m5, pip);
  const atrM15 = atrOf(m15, pip);
  const maxDist = INTRADAY_MAX_DIST_ATR * atrM15;
  const gap = 0.1 * atrM15;

  const sH1 = analyzePureSMCStructure(h1);
  const sM15 = analyzePureSMCStructure(m15);
  const dH1 = sH1.dir || emaBias(h1, 20);
  const dM15 = sM15.dir || emaBias(m15, 20);

  const rangeH1 = getRangeInfo(h1, 50);
  const rangeInfoStr = rangeH1 && rangeH1.high > rangeH1.low
    ? `H1 Range Pos: ${(((price - rangeH1.low) / (rangeH1.high - rangeH1.low)) * 100).toFixed(1)}%`
    : '-';

  const pickZone = dir => {
    const z5 = findSDZones(m5, dir, price, { dispAtr: 0.8, freshOnly: true }).find(z => z.dist <= maxDist);
    if (z5) return { z: z5, tf: 'M5' };
    const z15 = findSDZones(m15, dir, price, { dispAtr: 0.8, freshOnly: true }).find(z => z.dist <= maxDist);
    if (z15) return { z: z15, tf: 'M15' };
    return null;
  };

  const mkOrder = dir => {
    const pz = pickZone(dir);
    if (!pz) return null;
    const z = pz.z;
    const entry = dir === 1 ? z.top : z.bottom;
    const sl = clampSL(dir, entry, z.sl, 'intraday', ctx, atrM5 > atrM15 * 0.5 ? atrM5 : atrM15 * 0.5);
    const tps = getStructuralTPs(m15, dir, entry, sl, 1.0);
    if (dir === 1 ? !(tps[0] > entry) : !(tps[0] < entry)) return null;
    return {
      dir, entry, sl, tps, dist: z.dist,
      type: dir === 1 ? 'BUY LIMIT' : 'SELL LIMIT',
      label: `${dir === 1 ? 'Buy' : 'Sell'} Limit · ${pz.tf} ${dir === 1 ? 'Demand' : 'Supply'}`,
      zone: { min: z.bottom, max: z.top },
    };
  };

  const buyOrder = mkOrder(1);
  const sellOrder = mkOrder(-1);
  const okBuy = buyOrder && buyOrder.entry < price - gap;
  const okSell = sellOrder && sellOrder.entry > price + gap;

  if (sH1.dir === 0 && sM15.dir === 0 && okBuy && okSell) {
    return {
      plan: { isOCO: true, orders: [buyOrder, sellOrder], setup: 'Intraday OCO (HTF Ranging)', chartContext: `H1 Ranging -> M15 Ranging -> OCO` },
      meta: { confidence: 'HIGH', riskLabel: 'MEDIUM', reason: `H1 & M15 ranging. Pasang OCO: BUY @ ${f(buyOrder.entry)}, SELL @ ${f(sellOrder.entry)}. TP mengikuti ERL/IRL M15. Jika salah satu tersentuh, order lawannya otomatis dibatalkan.` }
    };
  }

  const htfBias = dH1 !== 0 ? dH1 : dM15;
  if (htfBias === 0) return { plan: null, reason: 'Bias H1 & M15 belum terbentuk (netral). Tunggu struktur yang lebih jelas.' };

  const aligned = dH1 !== 0 && dH1 === dM15;
  const pullback = dH1 !== 0 && dM15 !== 0 && dH1 !== dM15;
  const confidence = aligned ? 'HIGH' : 'MEDIUM';

  let finalOrder = null, reason = '';
  if (htfBias === 1 && buyOrder) finalOrder = buyOrder;
  else if (htfBias === -1 && sellOrder) finalOrder = sellOrder;

  if (!finalOrder) return { plan: null, reason: `Tidak ada zona fresh searah bias ${dirLabel(htfBias)} dalam jarak ${INTRADAY_MAX_DIST_ATR}x ATR M15.` };

  reason = aligned
    ? `H1 & M15 ${dirLabel(htfBias)}. Fokus ${htfBias === 1 ? 'Buy' : 'Sell'} Limit.`
    : pullback
      ? `H1 ${dirLabel(dH1)}, M15 ${dirLabel(dM15)} (koreksi dalam tren H1). Entry searah H1.`
      : `Bias ${dirLabel(htfBias)} (${dH1 !== 0 ? 'H1' : 'M15'}). Entry searah bias.`;

  const inZone = price >= finalOrder.zone.min && price <= finalOrder.zone.max;
  let orderType = 'LIMIT', entry = finalOrder.entry;

  if (inZone) {
    entry = price; orderType = 'NOW';
  } else {
    const san = sanitizeEntry({ dir: finalOrder.dir, entry, price, orderType: 'LIMIT', pip });
    entry = san.entry; orderType = san.orderType;
  }

  return await finalizePlan({
    dir: finalOrder.dir, entry, orderType, baseSL: finalOrder.sl, kind: 'intraday', atrVal: atrM5, ctx, rrList,
    confidence, setup: finalOrder.label, zoneNote: finalOrder.label, zoneRange: finalOrder.zone,
    timeframes: 'M5, M15, H1', rangeInfo: rangeInfoStr, chartContext: `H1 ${dirLabel(dH1)} / M15 ${dirLabel(dM15)} -> POI ${finalOrder.label}`,
    head: t.headLine(t.title.intraday, finalOrder.dir === 1 ? 'BUY' : 'SELL', orderType, ctx.symbol),
    lines: [reason, `Area Eksekusi: ${f(finalOrder.zone.min)} - ${f(finalOrder.zone.max)}`],
    customTPs: finalOrder.tps
  });
}

async function buildSwingPlan({ m15, price, rrList, ctx }) {
  const t = tx(ctx);
  const { f, pip } = ctx;
  const h1 = aggregateCandles(m15, 60);
  const h4 = aggregateCandles(m15, 240);
  const d1 = aggregateCandles(m15, 1440);
  const atrM15 = atrOf(m15, pip);

  const biasD1 = analyzePureSMCStructure(d1);
  const biasH4 = analyzePureSMCStructure(h4);
  const biasH1 = analyzePureSMCStructure(h1);

  let bullCount = [biasD1, biasH4, biasH1].filter(x => x.dir === 1).length;
  let bearCount = [biasD1, biasH4, biasH1].filter(x => x.dir === -1).length;

  let htfBias = 0;
  if (bullCount >= 2) htfBias = 1;
  if (bearCount >= 2) htfBias = -1;

  if (htfBias === 0) return { plan: null, reason: 'Bias D1/H4/H1 tidak searah. Menunggu tren makro.' };

  const demand = findSDZones(m15, 1, price, { dispAtr: 0.8, freshOnly: true })[0] || null;
  const supply = findSDZones(m15, -1, price, { dispAtr: 0.8, freshOnly: true })[0] || null;

  let finalOrder = null, reason = '', zoneUsed = null;

  if (htfBias === 1 && demand) {
    const entry = demand.top; const sl = demand.sl; const tps = getStructuralTPs(m15, 1, entry, sl, 1.0);
    if (tps[0] > entry) { finalOrder = { dir: 1, entry, sl, tps, label: 'M15 Demand Limit' }; reason = 'Tren Makro Bullish. Buy Limit di M15 Demand.'; zoneUsed = demand; }
  } else if (htfBias === -1 && supply) {
    const entry = supply.bottom; const sl = supply.sl; const tps = getStructuralTPs(m15, -1, entry, sl, 1.0);
    if (tps[0] < entry) { finalOrder = { dir: -1, entry, sl, tps, label: 'M15 Supply Limit' }; reason = 'Tren Makro Bearish. Sell Limit di M15 Supply.'; zoneUsed = supply; }
  }

  if (!finalOrder) return { plan: null, reason: 'Tidak ada zona M15 fresh searah tren makro.' };

  const inZone = price >= zoneUsed.bottom && price <= zoneUsed.top;
  let orderType = 'LIMIT', entry = finalOrder.entry;

  if (inZone) { entry = price; orderType = 'NOW'; }
  else {
    const san = sanitizeEntry({ dir: finalOrder.dir, entry, price, orderType: 'LIMIT', pip });
    entry = san.entry; orderType = san.orderType;
  }

  return await finalizePlan({
    dir: finalOrder.dir, entry, orderType, baseSL: finalOrder.sl, kind: 'swing', atrVal: atrM15, ctx, rrList,
    confidence: 'HIGH', setup: finalOrder.label, zoneNote: finalOrder.label, zoneRange: { min: zoneUsed.bottom, max: zoneUsed.top },
    timeframes: 'M15, H1, H4, D1', rangeInfo: '-', chartContext: `HTF ${htfBias === 1 ? 'Bullish' : 'Bearish'} -> POI M15`,
    head: t.headLine(t.title.swing, finalOrder.dir === 1 ? 'BUY' : 'SELL', orderType, ctx.symbol),
    lines: [reason, `Area Eksekusi M15`],
    customTPs: finalOrder.tps
  });
}

// ═══════════════════════════ SCALPING EMA (AGRESIF, KILLZONE) ═══════════════════════════
const EMA_FAST = 9;
const EMA_SLOW = 21;
const EMA_TREND = 200;
const EMA_CROSS_LOOK = 3;          // cross boleh terjadi dalam 3 candle M1 terakhir
const EMA_MAX_CHASE_ATR = 1;       // harga tidak boleh lebih dari 1 ATR M1 dari EMA 9
const EMA_FLAT_SPREAD_ATR = 0.2;   // EMA 9 dan 21 berdekatan
const EMA_FLAT_SLOPE_ATR = 0.1;    // EMA 200 datar
const EMA_SLOPE_BARS = 5;
const EMA_MIN_BARS = 400;          // EMA 200 perlu data panjang agar konvergen
const NEED_EMA_M1 = 420;

const RB_LOOK = 5;                 // candle M1 terakhir yang dicari sebagai rejection
const RB_WICK_RATIO = 0.5;         // sumbu penolakan minimal 50% dari range candle
const RB_TOUCH_ATR = 0.2;          // toleransi sentuhan ke EMA
const RB_MIN_RANGE_ATR = 0.5;      // candle terlalu kecil diabaikan

function emaState(m1, atrM1) {
  if (!m1 || m1.length < EMA_MIN_BARS || !(atrM1 > 0)) return null;
  const eF = emaSeries(m1, EMA_FAST);
  const eS = emaSeries(m1, EMA_SLOW);
  const eT = emaSeries(m1, EMA_TREND);
  const i = m1.length - 1;
  const last = m1[i].c;

  let dir = 0;
  if (eF[i] > eS[i] && last > eT[i]) dir = 1;
  else if (eF[i] < eS[i] && last < eT[i]) dir = -1;

  let fresh = false;
  if (dir !== 0) {
    for (let k = 0; k < EMA_CROSS_LOOK && !fresh; k++) {
      const j = i - k;
      if (dir === 1 && eF[j - 1] <= eS[j - 1] && eF[j] > eS[j]) fresh = true;
      if (dir === -1 && eF[j - 1] >= eS[j - 1] && eF[j] < eS[j]) fresh = true;
    }
  }

  const flat =
    Math.abs(eF[i] - eS[i]) < EMA_FLAT_SPREAD_ATR * atrM1 &&
    Math.abs(eT[i] - eT[i - EMA_SLOPE_BARS]) < EMA_FLAT_SLOPE_ATR * atrM1;

  return {
    dir, fresh, flat,
    chased: Math.abs(last - eF[i]) > EMA_MAX_CHASE_ATR * atrM1,
    eF, eS, eT,
  };
}

function findRejectionBlock(m1, dir, st, atrM1) {
  const i = m1.length - 1;
  const tol = RB_TOUCH_ATR * atrM1;
  for (let k = 0; k < RB_LOOK; k++) {
    const j = i - k;
    const c = m1[j];
    const range = c.h - c.l;
    if (!(range >= RB_MIN_RANGE_ATR * atrM1)) continue;
    const bodyTop = Math.max(c.o, c.c);
    const bodyBot = Math.min(c.o, c.c);
    const emaHi = Math.max(st.eF[j], st.eS[j]);
    const emaLo = Math.min(st.eF[j], st.eS[j]);
    if (dir === 1) {
      const wick = (bodyBot - c.l) / range;
      if (wick >= RB_WICK_RATIO && c.l <= emaHi + tol && c.c > emaHi && c.c > st.eT[j]) {
        return { lo: c.l, hi: bodyTop, entry: bodyTop, sl: c.l, trigger: c.h };
      }
    } else {
      const wick = (c.h - bodyTop) / range;
      if (wick >= RB_WICK_RATIO && c.h >= emaLo - tol && c.c < emaLo && c.c < st.eT[j]) {
        return { lo: bodyBot, hi: c.h, entry: bodyBot, sl: c.h, trigger: c.l };
      }
    }
  }
  return null;
}

async function buildScalpEmaPlan({ m1, m5, m15, price, rrList, ctx, recentSL = [], useRB = false }) {
  if (!isWithinKillzone()) {
    return { plan: null, reason: 'Di luar killzone London/NY (sekitar 14.00–18.00 dan 19.00–23.00 WIB). Mode agresif tidak mengeluarkan signal.' };
  }

  const { pip } = ctx;
  const t = tx(ctx);
  const atrM1 = atrOf(m1, pip);
  const atrM5 = atrOf(m5, pip);
  const minGap = 0.1 * atrM1;
  const maxNearDist = SCALP_OPP_NEAR_PIPS * pip;
  const biasM15 = analyzePureSMCStructure(m15);

  const st = emaState(m1, atrM1);
  if (!st) return { plan: null, reason: `Data M1 kurang dari ${EMA_MIN_BARS} candle untuk EMA 200. Menunggu data.` };

  // 1. Ranging / sideways: tidak ada signal, beri keterangan
  if (st.flat || isRangingDir(m5, atrM5)) {
    return { plan: null, reason: 'Pasar ranging / sideways: EMA 9 dan 21 berdekatan dan EMA 200 datar. Tidak ada signal, menunggu tren.' };
  }

  // 2. Belum ada cross searah
  if (!st.dir || !st.fresh) {
    return { plan: null, reason: 'Belum ada cross EMA 9/21 searah EMA 200 dalam 3 candle M1 terakhir. Menunggu.' };
  }

  const dir = st.dir;
  const tag = dir === 1 ? 'BUY' : 'SELL';
  const rb = useRB ? findRejectionBlock(m1, dir, st, atrM1) : null;
  const rbConfirmed = !!rb && (dir === 1 ? price > rb.trigger : price < rb.trigger);

  // 3. Syarat NOW (satu saja gagal, NOW ditahan)
  const blockers = [];
  if (cooldownDirs(recentSL).has(dir)) blockers.push('cooldown setelah SL arah sama');
  if (st.chased) blockers.push('harga mengejar EMA 9 lebih dari 1 ATR M1');
  if (!biasAllows(dir, biasM15.dir, 'EMA')) blockers.push(`bias M15 ${dirLabel(biasM15.dir)} berlawanan`);
  if (useRB && !rb) blockers.push('belum ada rejection block di EMA 9/21');
  else if (useRB && !rbConfirmed) blockers.push('rejection block belum dikonfirmasi');

  const oppZones = [
    ...strongZoneList(m1, -dir, price, atrM1, maxNearDist),
    ...strongZoneList(m5, -dir, price, atrM5, maxNearDist),
  ];
  if (oppZones.length) blockers.push(`strong ${oppZones[0].tag} lawan dekat harga`);

  const confidence = biasM15.dir === dir ? 'HIGH' : 'MEDIUM';
  const chartContext = `EMA 9/21 cross ${tag} searah EMA 200 (M1), M15 ${dirLabel(biasM15.dir)}${useRB ? ', rejection block' : ''}`;

  if (!blockers.length) {
    const baseSL = useRB
      ? rb.sl
      : (dir === 1 ? recentExtreme(m1, 1, 5) : recentExtreme(m1, -1, 5));
    const nowO = buildNowOrder({
      dir, entry: price, baseSL, atrM5, atrM1, ctx, rrList,
      structName: useRB ? 'rejection block M1' : 'swing M1',
    });
    if (nowO) {
      return await planFromOrder(nowO, {
        ctx, kind: 'scalp', orderType: 'NOW',
        setup: `EMA Cross ${tag}${useRB ? ' + Rejection Block' : ''} (Market NOW)`,
        chartContext,
        timeframes: 'M1, M5, M15', rangeInfo: '-',
        head: t.headLine(t.title.scalp, tag, 'NOW', ctx.symbol),
        lines: [`EMA 9/21 cross searah EMA 200, tidak ranging, harga tidak mengejar EMA 9.${useRB ? ' Rejection block terkonfirmasi.' : ''}`],
        confidence,
      });
    }
    blockers.push('SL tidak valid atau melebihi 2 ATR M5');
  }

  // 4. NOW ditahan: LIMIT terdekat searah tren (rejection block atau strong zone M1)
  const candidates = [];

  if (useRB && rb && (dir === 1 ? rb.entry < price - minGap : rb.entry > price + minGap)) {
    const o = buildNowOrder({
      dir, entry: rb.entry, baseSL: rb.sl, atrM5, atrM1, ctx, rrList,
      structName: 'rejection block M1',
    });
    if (o) {
      candidates.push({
        ...o,
        label: `${dir === 1 ? 'Buy' : 'Sell'} Limit · Rejection Block M1`,
        zone: { min: rb.lo, max: rb.hi },
        src: 'Rejection Block',
      });
    }
  }

  const zone = strongZoneList(m1, dir, price, atrM1, SCALP_MAX_DIST_ATR * atrM1)
    .find(z => (dir === 1 ? z.top < price - minGap : z.bottom > price + minGap));
  if (zone) {
    const o = buildLiquidityOrder({
      dir, zone, liq: liquidityLevels(m1.slice(-100), atrM1), atrVal: atrM1, ctx,
      kind: 'scalp', maxRiskAtr: SCALP_MAX_RISK_ATR, rrList,
    });
    if (o) candidates.push({ ...o, src: 'Strong Zone' });
  }

  if (!candidates.length) {
    return { plan: null, reason: `${tag} NOW ditahan (${blockers.join('; ')}). Tidak ada LIMIT yang valid. Menunggu.` };
  }

  candidates.sort((a, b) => Math.abs(a.entry - price) - Math.abs(b.entry - price));
  const best = candidates[0];

  return await planFromOrder(best, {
    ctx, kind: 'scalp', orderType: 'LIMIT',
    setup: `${tag} LIMIT (${best.src}, NOW ditahan)`,
    chartContext: `${chartContext} -> NOW ditahan, LIMIT ${best.src} terdekat`,
    timeframes: 'M1, M5, M15', rangeInfo: '-',
    head: t.headLine(t.title.scalp, tag, 'LIMIT', ctx.symbol),
    lines: [`NOW ditahan: ${blockers.join('; ')}. Diganti LIMIT ${best.src.toLowerCase()} terdekat searah tren.`],
    confidence: 'MEDIUM',
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

  const en = ctx.lang === 'en';
  const reasonText = withPair(ctx.symbol, meta.reason);

  if (plan && plan.isOCO) {
    const [buy, sell] = plan.orders;
    return {
      signal: 'OCO',
      mode: 'OCO_PENDING',
      orderType: 'OCO',
      orderLabel: `OCO ${r(buy.entry)} / ${r(sell.entry)}`,
      status: 'PENDING',
      statusLabel: `OCO ${r(buy.entry)} / ${r(sell.entry)}`,
      pendingEntries: [r(buy.entry), r(sell.entry)],
      setup: plan.setup,
      confidence: meta.confidence,
      risk: meta.riskLabel,
      reason: reasonText,
      chartContext: plan.chartContext,
      orders: plan.orders.map(o => ({
        signal: o.dir === 1 ? 'BUY' : 'SELL',
        orderType: 'LIMIT',
        entry: r(o.entry),
        sl: r(o.sl),
        tp1: o.tps[0] != null ? r(o.tps[0]) : null,
        tp2: o.tps[1] != null ? r(o.tps[1]) : null,
        tp3: o.tps[2] != null ? r(o.tps[2]) : null,
        zone: o.zone ? { min: r(o.zone.min), max: r(o.zone.max) } : null,
        entryStyle: en ? style.entryStyleEn : style.entryStyle,
        setup: o.label,
        setupLabel: en ? style.labelEn : style.label,
        zoneLabel: o.label,
        zoneNote: o.label,
      })),
    };
  }

  const tps = plan.tps;
  const isLimit = plan.orderType === 'LIMIT';
  const mode = isLimit ? 'LIMIT' : 'MARKET';

  return {
    signal: dir === 1 ? 'BUY' : 'SELL',
    mode: mode,
    orderType: plan.orderType,
    orderLabel: orderLabel(dir, plan.orderType),
    status: plan.status,
    statusLabel: plan.status,
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
    reason: reasonText,
    chartContext: plan.chartContext,
  };
}

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

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

    const lang = pickLang(body, req.query);
    const t = TX[lang];

    const inSession = isWithinKillzone();
    const sessionNote = inSession ? '' : '(Di luar sesi London/NY, volatilitas mungkin rendah)';

    // ============ VISION ============
    if (body.images && Array.isArray(body.images) && body.images.length > 0) {
      const access = await checkAccess(body.email);
      if (!access.ok) return res.status(403).json({ error: t[access.key] });

      const trial = await checkTrialLimit(body.email, access.status);
      if (!trial.ok) return res.status(403).json({ error: trial.msg });

      const visionRes = await getVisionSignal(body.images, lang);
      if (!visionRes.plan) return res.status(400).json({ error: visionRes.reason });

      const p = visionRes.plan;
      const entry = Number(p.entry);
      const rawSl = Number(p.sl);
      const rawTps = [p.tp1, p.tp2, p.tp3].filter(v => v != null).map(Number);
      const orderType = p.orderType === 'LIMIT' ? 'LIMIT' : 'NOW';

      const rawSignal = String(p.signal || '').toUpperCase();
      let dir = 0;

      if (rawSignal.includes('BUY') || rawSignal === 'LONG') dir = 1;
      else if (rawSignal.includes('SELL') || rawSignal === 'SHORT') dir = -1;
      else if (entry > 0 && rawSl > 0) {
        if (entry > rawSl) dir = 1;
        else if (entry < rawSl) dir = -1;
      }

      if (dir === 0) return res.status(400).json({ error: 'AI gagal menentukan arah BUY/SELL. Silakan coba gambar yang lebih jelas atau tunggu tren valid.' });
      if (!(entry > 0) || !(rawSl > 0) || rawTps.length === 0 || rawTps.some(v => !(v > 0))) {
        return res.status(400).json({ error: 'AI mengembalikan harga 0.0 atau tidak lengkap. Pastikan chart jelas.' });
      }

      let symbol = resolveSymbol(body, req.query) || (p.symbol && p.symbol !== 'UNKNOWN' ? normalizeSymbol(p.symbol) : null);
      if (!symbol) symbol = 'UNKNOWN_PAIR';

      let dec = 2, pip = 0.01, gold = false, prof = PAIR_CLASS_PROFILE.fx;
      if (isKnownSymbol(symbol)) {
        dec = DECIMALS[symbol] || 2; pip = pipSizeOf(symbol, dec); gold = isGold(symbol); prof = pairProfile(symbol);
      } else {
        if (entry > 1000) { dec = 2; pip = 0.1; } else if (entry > 100) { dec = 2; pip = 0.01; } else if (entry > 1) { dec = 4; pip = 0.0001; } else if (entry > 0.01) { dec = 5; pip = 0.00001; } else if (entry > 0.0001) { dec = 6; pip = 0.000001; } else if (entry > 0.00001) { dec = 7; pip = 0.0000001; } else { dec = 8; pip = 0.00000001; }
        if (symbol.includes('XAU')) { gold = true; dec = 2; pip = 0.1; }
        const cls = symbol.includes('XAU') ? 'gold' : (symbol.includes('BTC') ? 'crypto' : 'fx');
        prof = { cls, ...PAIR_CLASS_PROFILE[cls] };
      }

      const ctx = { symbol, dec, pip, gold, prof, lang };
      const f = v => { if (v === 0) return 0; if (v < 0.001) return Number(v).toFixed(8); return Number(Number(v).toFixed(dec)); };

      const v = validateVisionPlan({ dir, entry, sl: rawSl, tps: rawTps, ctx });
      if (!v.ok) return res.status(400).json({ error: v.reason });

      const sl = v.sl;
      const tps = v.tps;
      const riskPips = v.riskPips;

      let tfText = 'Chart';
      if (Array.isArray(p.timeframes)) tfText = p.timeframes.join(', ');
      else if (typeof p.timeframes === 'string') tfText = p.timeframes;

      const aiReason = await getAIReasoning({
        ctx, dir, kind: 'vision', orderType, entry, sl, tps, setup: p.setup || 'SMC Top-Down', rawReason: p.reason, riskPips, zoneLine: `MTF: ${tfText}`, timeframes: tfText, rangeInfo: p.range_info || '-', chartContext: p.chartContext || '-'
      });

      const riskNote = v.note ? ` ${v.note}` : '';
      const baseReason = aiReason || p.reason || 'Vision Analysis';
      const reasonText = withPair(symbol, baseReason) + riskNote + sessionNote;

      return res.status(200).json({
        ok: true,
        analysis_steps: [`Analisa Top-Down (${tfText})`, `Identifikasi Likuiditas & Trend HTF`, `Konfirmasi Zona LTF`, `Penentuan Entry & Anti-Sweep SL`],
        signal: {
          symbol, decimals: dec, pipSize: pip, signal: dir === 1 ? 'BUY' : 'SELL', mode: orderType === 'LIMIT' ? 'LIMIT' : 'MARKET', orderType, orderLabel: `${dir === 1 ? 'BUY' : 'SELL'} ${orderType}`, status: orderType === 'LIMIT' ? 'PENDING' : 'RUNNING',
          entry: f(entry), sl: f(sl), tp1: f(tps[0]), tp2: f(tps[1]), tp3: f(tps[2]), tpCount: tps.length,
          riskPips: Number(riskPips.toFixed(1)),
          zone: null, expireMs: 0, confidence: 'HIGH', risk: 'MEDIUM', setup: p.setup || `SMC MTF (${tfText})`, entryStyle: 'Rekomendasi AI', setupLabel: 'SMC Top-Down', zoneLabel: orderType === 'LIMIT' ? 'Limit Entry Zone' : 'Market Execution Zone', zoneNote: `Timeframes: ${tfText}`,
          reason: reasonText,
          chartContext: p.chartContext || '-'
        }
      });
    }

    // ============ LIVE SMC ============
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

    let m1 = cleanCandles(body.candles?.m1);
    let m5 = cleanCandles(body.candles?.m5);
    let m15 = cleanCandles(body.candles?.m15);

    let price = Number(body.currentPrice);
    if (!(price > 0)) price = lastClosePrice(m5) || lastClosePrice(m15) || lastClosePrice(m1);
    if (!(price > 0)) return res.status(400).json({ error: t.noPrice });

    const [lo, hi] = prof.range;
    if (price < lo || price > hi) return res.status(400).json({ error: t.range(price, symbol, lo, hi) });

    const needM1 = style === 'Scalping EMA' ? NEED_EMA_M1
      : (style === 'Scalping' || style === 'Day Trading') ? NEED.m1 : 0;
    const needM5 = ['Scalping', 'Scalping EMA', 'Day Trading', 'Intraday'].includes(style) ? NEED.m5 : 0;
    const needM15 = ['Scalping EMA', 'Intraday', 'Swing', 'Day Trading'].includes(style) ? NEED.m15 : 0;

    const pick = async (arr, tf, need) => {
      if (!need) return { candles: [], source: 'none', tried: [] };
      const frontOk = arr.length >= Math.min(need, 60) && matchesRef(arr, price);
      if (frontOk && arr.length >= need) return { candles: arr, source: 'frontend', tried: [] };
      const r = await getCandles(symbol, tf, need, price);
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

    const recentSL = Array.isArray(body.recentSL) ? body.recentSL : [];

    if (style === 'Scalping') {
      liveSteps = [`Cek Arah Struktur M5`, `Cek Pemicu M1 & Sesi`, `Cek Filter Bias M15 & Cooldown`, `NOW / LIMIT / OCO`];
      result = await buildScalpPlan({ m1, m5, m15, price, rrList, ctx, recentSL });
    } else if (style === 'Scalping EMA') {
      liveSteps = ['Cek Killzone', 'Cek Ranging', 'Cek Cross EMA 9/21 searah EMA 200', 'Cek Syarat NOW', 'NOW atau LIMIT terdekat'];
      result = await buildScalpEmaPlan({
        m1, m5, m15, price, rrList, ctx, recentSL,
        useRB: body.useRejectionBlock === true,
      });
    } else if (style === 'Day Trading') {
      liveSteps = ['Cek Momentum M1', 'Cari area M15 strong', 'Refine ke M5', 'OCO dua arah / NOW momentum'];
      result = await buildDayPlan({ m1, m5, m15, price, rrList, ctx });
    } else if (style === 'Intraday') {
      liveSteps = [`Memeriksa bias M15 & H1`, `Mencari Zona M5 / M15`, `Cek OCO / Trend Follow`, `Validasi ERL/IRL`];
      result = await buildIntrada
