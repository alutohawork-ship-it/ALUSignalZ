// api/generate.js
// v107 (Hybrid lama tetap untuk style "Scalping".
//       Scalping EMA: cross EMA 9/21 searah EMA 200, hanya di killzone, NOW saat trigger M1,
//       rejection block opsional, LIMIT terdekat jika NOW ditahan.
//       Day Trading: OCO 2 arah wajib. Area M15 strong, di-refine ke M5.
//       Momentum M1 kuat -> NOW searah, tanpa menunggu pullback.
//       SL di balik invalidation, zona yang melewati batas SL dilewati.
//       TickerLayer: slot key tetap, maksimal percobaan per request, bisa dimatikan TICKERLAYER_DISABLED=1.
//       Vision tetap.)
// v107-fix: handler (export default) dipulihkan + logika Scalping EMA, Day, Intraday, Swing, Vision.

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

// ═══════════════════════════════════════════════════════════════════════════
//  BAGIAN BARU (v107-fix): helper strategi, Scalping EMA, Day, Intraday, Swing,
//  jalur Vision, dan HANDLER (export default) yang sebelumnya hilang.
// ═══════════════════════════════════════════════════════════════════════════

const fail = reason => ({ plan: null, reason });

const guessDec = p => (p < 0.001 ? 8 : p < 1 ? 5 : p < 100 ? 4 : 2);

function makeCtx(symbol, lang, refPrice) {
  const dec = DECIMALS[symbol] ?? guessDec(refPrice || 1);
  return {
    symbol, lang, dec,
    f: v => Number(Number(v).toFixed(dec)),
    pip: pipSizeOf(symbol, dec),
    gold: isGold(symbol),
    prof: pairProfile(symbol),
  };
}

const SYMBOL_ALIAS = {
  GOLD: 'XAUUSD', XAU: 'XAUUSD', SILVER: 'XAGUSD', XBTUSD: 'BTCUSD', BITCOIN: 'BTCUSD', BTC: 'BTCUSD',
  ETH: 'ETHUSD', USOIL: 'WTI', UKOIL: 'BRENT', US500: 'SPX500', US100: 'NAS100', DJ30: 'US30', DE40: 'GER40', JP225: 'JPN225',
};

function normSymbol(raw) {
  let s = String(raw || '').toUpperCase();
  if (!s) return '';
  if (s.includes(':')) s = s.split(':').pop();
  s = s.replace(/[^A-Z0-9]/g, '');
  if (!s || s === 'UNKNOWN' || s === 'UNKNOWNPAIR') return '';
  if (SYMBOL_ALIAS[s]) return SYMBOL_ALIAS[s];
  if (DECIMALS[s]) return s;
  // akhiran broker (XAUUSDM, EURUSDC) dan USDT -> USD
  if ((s.endsWith('M') || s.endsWith('C')) && DECIMALS[s.slice(0, -1)]) return s.slice(0, -1);
  if (s.endsWith('USDT') && DECIMALS[s.slice(0, -1)]) return s.slice(0, -1);
  return s;
}

const toNum = v => {
  const n = Number(typeof v === 'string' ? v.replace(/,/g, '') : v);
  return Number.isFinite(n) ? n : 0;
};

function rangeInfoText(ctx, m5) {
  const r = getRangeInfo(m5, 50);
  if (!r) return '-';
  const last = lastClosePrice(m5);
  const pct = r.high > r.low ? ((last - r.low) / (r.high - r.low)) * 100 : 50;
  return `M5 range ${ctx.f(r.low)} - ${ctx.f(r.high)}, harga di ${pct >= 50 ? 'Premium' : 'Discount'} (${pct.toFixed(0)}%)`;
}

// Ambil order LIMIT pertama yang lolos batas SL (zona yang melewati batas SL dilewati).
// allowNow: jika harga sudah di dalam zona, ubah jadi NOW di harga live.
function firstLimitOrder(zones, { dir, liq, atrVal, ctx, kind, maxRiskAtr, rrList, price, maxDist, allowNow }) {
  const gap = 2 * ctx.pip;
  for (const z of zones) {
    const o = buildLiquidityOrder({ dir, zone: z, liq, atrVal, ctx, kind, maxRiskAtr, rrList });
    if (o) {
      const valid = dir === 1 ? o.entry < price - gap : o.entry > price + gap;
      if (valid) {
        if (maxDist && Math.abs(price - o.entry) > maxDist) continue;
        return { order: o, orderType: 'LIMIT' };
      }
    }
    if (allowNow) {
      const inside = dir === 1 ? price <= z.top + gap && price >= z.bottom - gap : price >= z.bottom - gap && price <= z.top + gap;
      if (!inside) continue;
      const n = buildLiquidityOrder({ dir, zone: z, liq, atrVal, ctx, kind, maxRiskAtr, rrList, entryOverride: price });
      if (n) {
        n.label = n.label.replace('Limit', 'NOW');
        n.zone = null;
        return { order: n, orderType: 'NOW' };
      }
    }
  }
  return null;
}

function asLimitLeg(o) {
  return { ...o, orderType: 'LIMIT', status: 'PENDING' };
}

// ─────────────────────────── SCALPING (HYBRID) ───────────────────────────
async function runScalpHybrid(ctx, d) {
  const { price, m1, m5, m15 } = d;
  if (!inScalpSession()) return fail('Di luar sesi scalping (07:00–22:00 UTC). Coba lagi saat sesi London/New York.');
  if (m5.length < SCALP_MIN_DIR_CANDLES) return fail('Candle M5 belum cukup untuk membaca struktur.');

  const atr5 = atrOf(m5, ctx.pip);
  const atr1 = atrOf(m1, ctx.pip);
  const liq = liquidityLevels(m5, atr5);
  const biasDir = emaBias(m15, 20);
  const blocked = cooldownDirs(d.recentSL);
  const rangeInfo = rangeInfoText(ctx, m5);
  const rr = STYLES['Scalping'].rr;
  const maxDist = SCALP_MAX_DIST_ATR * atr5;
  const common = { ctx, kind: 'scalp', timeframes: 'M15/M5/M1', rangeInfo, confidence: 'MEDIUM' };

  // 1) Market ranging -> OCO di strong zone dua sisi
  if (isRangingDir(m5, atr5)) {
    const chartContext = `Ranging M5 -> strong zone dua sisi -> OCO`;
    const get = dir => blocked.has(dir) ? null : firstLimitOrder(
      strongZoneList(m5, dir, price, atr5, maxDist),
      { dir, liq, atrVal: atr5, ctx, kind: 'scalp', maxRiskAtr: SCALP_MAX_RISK_ATR, rrList: rr, price, maxDist, allowNow: false }
    );
    const b = get(1), s = get(-1);
    const pick = pickLimitSetup({
      buyO: b && b.order, sellO: s && s.order, bias: 0, ctx,
      setupPrefix: 'Scalping Ranging', chartContext, confidence: 'HIGH',
    });
    if (!pick) return fail('Market ranging, tapi belum ada strong zone yang valid di sisi mana pun.');
    if (pick.plan) {
      pick.plan.orders = pick.plan.orders.map(asLimitLeg);
      return { dir: 0, ...pick };
    }
    return planFromOrder(pick.single, { ...common, orderType: 'LIMIT', setup: pick.setup, chartContext, head: 'Scalping Ranging', lines: ['Market ranging M5'], confidence: 'HIGH' });
  }

  // 2) Trending -> event struktur M5 (BOS / CHoCH / CISD)
  const st = scalpStructureEvents(m5, atr5);
  const ev = st.current;
  if (!ev) return fail('Belum ada event struktur M5 (BOS/CHoCH/CISD) yang segar.');
  const dir = ev.dir;
  if (blocked.has(dir)) return fail('Arah ini baru kena SL. Cooldown 20 menit aktif.');
  if (!biasAllows(dir, biasDir, ev.type)) return fail(`${ev.type} berlawanan dengan bias EMA M15 (${dirLabel(biasDir)}). Setup dilewati.`);

  // Likuiditas lawan terlalu dekat -> ruang gerak sempit
  const oppPool = dir === 1 ? [...liq.swingHigh, ...liq.eqh].filter(p => p > price) : [...liq.swingLow, ...liq.eql].filter(p => p < price);
  if (oppPool.length) {
    const nearest = Math.min(...oppPool.map(p => Math.abs(p - price)));
    if (nearest < SCALP_OPP_NEAR_PIPS * ctx.pip) return fail('Likuiditas lawan terlalu dekat dari harga. Ruang gerak sempit, setup dilewati.');
  }

  const chartContext = `${dirLabel(biasDir)} M15 -> ${ev.type} M5 -> ${m1Trigger(m1, dir) ? 'Trigger M1' : 'Tunggu retest'} -> SIGNAL ${dir === 1 ? 'BUY' : 'SELL'}`;
  const chase = Math.abs(price - ev.level) > SCALP_MAX_CHASE_ATR * atr5;

  // NOW: trigger M1 searah, tidak mengejar harga
  if (m1Trigger(m1, dir) && !chase) {
    const o = buildNowOrder({
      dir, entry: price, baseSL: recentExtreme(m5, dir, 6), atrM5: atr5, atrM1: atr1,
      ctx, rrList: rr, structName: 'swing M5',
    });
    if (o) {
      return planFromOrder(o, { ...common, orderType: 'NOW', setup: `Scalping ${ev.type} (NOW)`, chartContext, head: `Scalping ${orderLabel(dir, 'NOW')}`, lines: [`${ev.type} M5`, 'Trigger breakout M1'] });
    }
  }

  // LIMIT: strong zone terdekat
  const lim = firstLimitOrder(
    strongZoneList(m5, dir, price, atr5, maxDist),
    { dir, liq, atrVal: atr5, ctx, kind: 'scalp', maxRiskAtr: SCALP_MAX_RISK_ATR, rrList: rr, price, maxDist, allowNow: true }
  );
  if (!lim) return fail(chase ? 'Harga sudah mengejar jauh dari event struktur dan belum ada zona retest yang valid.' : 'Menunggu trigger M1 atau zona retest yang valid.');
  return planFromOrder(lim.order, { ...common, orderType: lim.orderType, setup: `Scalping ${ev.type} (${lim.orderType})`, chartContext, head: `Scalping ${orderLabel(dir, lim.orderType)}`, lines: [`${ev.type} M5`, `Retest ${lim.order.tag}`] });
}

// ─────────────────────────── SCALPING EMA ───────────────────────────
// Rejection block: candle dengan wick panjang yang menolak harga searah dir.
function rejectionBlocks(m5, dir, atrVal) {
  const out = [];
  const s = m5.slice(-11, -1);
  for (const c of s) {
    const range = c.h - c.l;
    if (range < 0.5 * atrVal) continue;
    const bodyTop = Math.max(c.o, c.c), bodyBot = Math.min(c.o, c.c);
    if (dir === 1 && (bodyBot - c.l) / range >= 0.55) out.push({ bottom: c.l, top: bodyBot, tag: 'Rejection Block', dist: 0 });
    if (dir === -1 && (c.h - bodyTop) / range >= 0.55) out.push({ bottom: bodyTop, top: c.h, tag: 'Rejection Block', dist: 0 });
  }
  return out.reverse(); // terbaru dulu
}

async function runScalpEMA(ctx, d) {
  const { price, m1, m5 } = d;
  if (!isWithinKillzone()) return fail('Di luar killzone (07–10 dan 12–15 UTC). Scalping EMA hanya aktif saat killzone.');
  if (m5.length < 200) return fail('Candle M5 belum cukup untuk EMA 200 (butuh minimal 200 bar).');

  const e9 = emaSeries(m5, 9), e21 = emaSeries(m5, 21), e200 = emaSeries(m5, 200);
  const n = m5.length, i = n - 1;
  const dir = price > e200[i] ? 1 : -1;
  const blocked = cooldownDirs(d.recentSL);
  if (blocked.has(dir)) return fail('Arah ini baru kena SL. Cooldown 20 menit aktif.');

  const slope200 = e200[i] - e200[i - 10];
  if ((dir === 1 && slope200 < 0) || (dir === -1 && slope200 > 0)) return fail('EMA 200 tidak searah dengan posisi harga. Setup dilewati.');
  if ((dir === 1 && e21[i] <= e200[i]) || (dir === -1 && e21[i] >= e200[i])) return fail('EMA 21 belum berada di sisi yang sama dengan harga terhadap EMA 200.');
  if ((dir === 1 && e9[i] <= e21[i]) || (dir === -1 && e9[i] >= e21[i])) return fail('EMA 9 belum searah di atas/bawah EMA 21.');

  // Cross EMA 9/21 dalam 8 candle M5 terakhir
  let crossed = false;
  for (let j = n - 8; j <= i; j++) {
    if (j < 1) continue;
    if (dir === 1 && e9[j - 1] <= e21[j - 1] && e9[j] > e21[j]) crossed = true;
    if (dir === -1 && e9[j - 1] >= e21[j - 1] && e9[j] < e21[j]) crossed = true;
  }
  if (!crossed) return fail('Belum ada cross EMA 9/21 yang segar searah EMA 200.');

  const atr5 = atrOf(m5, ctx.pip);
  const atr1 = atrOf(m1, ctx.pip);
  const rr = STYLES['Scalping EMA'].rr;
  const rangeInfo = rangeInfoText(ctx, m5);
  const chartContext = `Harga ${dir === 1 ? 'di atas' : 'di bawah'} EMA200 -> Cross EMA 9/21 ${dir === 1 ? 'Bullish' : 'Bearish'} -> ${m1Trigger(m1, dir) ? 'Trigger M1' : 'Tunggu pullback'} -> SIGNAL ${dir === 1 ? 'BUY' : 'SELL'}`;
  const common = { ctx, kind: 'scalp', timeframes: 'M5/M1', rangeInfo, confidence: 'MEDIUM', chartContext };

  // NOW: trigger breakout M1
  if (m1Trigger(m1, dir)) {
    const o = buildNowOrder({
      dir, entry: price, baseSL: recentExtreme(m5, dir, 6), atrM5: atr5, atrM1: atr1,
      ctx, rrList: rr, structName: 'swing M5',
    });
    if (o) {
      return planFromOrder(o, { ...common, orderType: 'NOW', setup: 'Scalping EMA 9/21 Cross (NOW)', head: `Scalping EMA ${orderLabel(dir, 'NOW')}`, lines: ['Cross EMA 9/21 searah EMA 200', 'Trigger breakout M1'] });
    }
  }

  // LIMIT terdekat: rejection block, lalu zona EMA 21
  const liq = liquidityLevels(m5, atr5);
  const maxDist = SCALP_MAX_DIST_ATR * atr5;
  const ema21Zone = dir === 1
    ? { bottom: e21[i] - 0.15 * atr5, top: e21[i], tag: 'EMA21', dist: 0 }
    : { bottom: e21[i], top: e21[i] + 0.15 * atr5, tag: 'EMA21', dist: 0 };
  const zones = [...rejectionBlocks(m5, dir, atr5), ema21Zone];
  const lim = firstLimitOrder(zones, {
    dir, liq, atrVal: atr5, ctx, kind: 'scalp', maxRiskAtr: SCALP_MAX_RISK_ATR, rrList: rr, price, maxDist, allowNow: false,
  });
  if (!lim) return fail('Cross EMA valid, tetapi belum ada trigger M1 dan belum ada zona pullback (rejection block / EMA 21) yang valid.');
  return planFromOrder(lim.order, { ...common, orderType: 'LIMIT', setup: `Scalping EMA 9/21 Cross (${lim.order.tag} LIMIT)`, head: `Scalping EMA ${orderLabel(dir, 'LIMIT')}`, lines: ['Cross EMA 9/21 searah EMA 200', `Pullback ke ${lim.order.tag}`] });
}

// ─────────────────────────── DAY TRADING (OCO 2 ARAH) ───────────────────────────
function refineToM5(zone15, dir, m5, price, atr5, maxDist) {
  const cands = strongZoneList(m5, dir, price, atr5, maxDist)
    .filter(a => a.bottom <= zone15.top && a.top >= zone15.bottom);
  if (!cands.length) return zone15;
  const a = cands[0];
  return {
    bottom: Math.max(a.bottom, zone15.bottom),
    top: Math.min(a.top, zone15.top),
    dist: a.dist,
    tag: `${zone15.tag}>M5 ${a.tag}`,
    strong: true,
  };
}

async function runDay(ctx, d) {
  const { price, m1, m5, m15 } = d;
  const atr15 = atrOf(m15, ctx.pip);
  const atr5 = atrOf(m5, ctx.pip);
  const atr1 = atrOf(m1 && m1.length ? m1 : m5, ctx.pip);
  const rr = STYLES['Day Trading'].rr;
  const rangeInfo = rangeInfoText(ctx, m5);
  const biasDir = emaBias(m15, 20);

  // Momentum M1 kuat -> NOW searah, tanpa menunggu pullback
  if (m1 && m1.length > M1_TRIGGER_BARS + 1 && m5.length >= SCALP_MIN_DIR_CANDLES) {
    const ev = scalpStructureEvents(m5, atr5).current;
    const lastM5 = m5[m5.length - 1];
    const strongBody = Math.abs(lastM5.c - lastM5.o) >= SCALP_DISP_ATR * atr5;
    if (ev && strongBody && ((ev.dir === 1) === (lastM5.c > lastM5.o)) && m1Trigger(m1, ev.dir)
        && biasAllows(ev.dir, biasDir, ev.type) && !cooldownDirs(d.recentSL).has(ev.dir)) {
      const o = buildNowOrder({
        dir: ev.dir, entry: price, baseSL: recentExtreme(m5, ev.dir, 6), atrM5: atr5, atrM1: atr1,
        ctx, rrList: rr, structName: 'swing M5',
      });
      if (o) {
        const chartContext = `${ev.type} M5 + displacement -> Momentum M1 -> SIGNAL ${ev.dir === 1 ? 'BUY' : 'SELL'}`;
        return planFromOrder(o, { ctx, kind: 'day', orderType: 'NOW', setup: 'Momentum M1 (NOW)', chartContext, timeframes: 'M15/M5/M1', rangeInfo, head: `Scalping Konservatif ${orderLabel(ev.dir, 'NOW')}`, lines: [`${ev.type} M5 dengan displacement kuat`, 'Momentum M1 searah'], confidence: 'MEDIUM' });
      }
    }
  }

  // OCO 2 arah wajib: area M15 strong, di-refine ke M5
  const liq = liquidityLevels(m15, atr15);
  const maxDist = DAY_MAX_DIST_ATR * atr15;
  const build = dir => {
    const zones = strongZoneList(m15, dir, price, atr15, maxDist).map(z => refineToM5(z, dir, m5, price, atr5, maxDist));
    return firstLimitOrder(zones, {
      dir, liq, atrVal: atr15, ctx, kind: 'day', maxRiskAtr: DAY_MAX_RISK_ATR, rrList: rr, price, maxDist, allowNow: false,
    });
  };
  const b = build(1), s = build(-1);
  if (!(b && s)) {
    const miss = !b && !s ? 'kedua sisi' : !b ? 'sisi BUY' : 'sisi SELL';
    return fail(`OCO 2 arah wajib, tetapi strong zone M15 yang valid belum ada di ${miss}.`);
  }
  const chartContext = 'Area strong M15 -> refine M5 -> OCO dua arah';
  const res = buildOcoResult(asLimitLeg(b.order), asLimitLeg(s.order), { ctx, setup: 'Day Trading OCO (M15 > M5)', chartContext, confidence: 'HIGH' });
  return { dir: 0, ...res };
}

// ─────────────────────────── INTRADAY ───────────────────────────
async function runIntraday(ctx, d) {
  const { price, m5, m15 } = d;
  const atr15 = atrOf(m15, ctx.pip);
  const atr5 = atrOf(m5, ctx.pip);
  const rr = STYLES['Intraday'].rr;
  const rangeInfo = rangeInfoText(ctx, m5);
  const h1 = aggregateCandles(m15, 60);
  const htf = analyzePureSMCStructure(h1);
  const maxDist = INTRADAY_MAX_DIST_ATR * atr15;

  // HTF ranging -> OCO
  if (htf.dir === 0) {
    const liq = liquidityLevels(m15, atr15);
    const build = dir => firstLimitOrder(
      strongZoneList(m15, dir, price, atr15, maxDist).map(z => refineToM5(z, dir, m5, price, atr5, maxDist)),
      { dir, liq, atrVal: atr15, ctx, kind: 'intraday', maxRiskAtr: DAY_MAX_RISK_ATR, rrList: rr, price, maxDist, allowNow: false }
    );
    const b = build(1), s = build(-1);
    const chartContext = `H1 ${htf.src} -> strong zone M15 -> OCO`;
    const pick = pickLimitSetup({ buyO: b && b.order, sellO: s && s.order, bias: 0, ctx, setupPrefix: 'Intraday', chartContext, confidence: 'HIGH' });
    if (!pick) return fail('HTF ranging, tetapi belum ada strong zone M15 yang valid.');
    if (pick.plan) {
      pick.plan.orders = pick.plan.orders.map(asLimitLeg);
      return { dir: 0, ...pick };
    }
    return planFromOrder(pick.single, { ctx, kind: 'intraday', orderType: 'LIMIT', setup: pick.setup, chartContext, timeframes: 'H1/M15/M5', rangeInfo, head: `Intraday ${orderLabel(pick.single.dir, 'LIMIT')}`, lines: [`H1 ${htf.src}`], confidence: 'HIGH' });
  }

  // Trend follow: zona M15 searah struktur H1
  const dir = htf.dir;
  const zones = findSDZones(m15, dir, price, {}).filter(z => z.dist <= maxDist);
  if (!zones.length) return fail(`Bias H1 ${dirLabel(dir)}, tetapi belum ada zona ${dir === 1 ? 'Demand' : 'Supply'} M15 yang fresh dan dekat.`);
  const z = zones[0];
  const rawEntry = dir === 1 ? z.top : z.bottom;
  const { entry, orderType } = sanitizeEntry({ dir, entry: rawEntry, price, orderType: 'LIMIT', pip: ctx.pip });
  const chartContext = `H1 ${dirLabel(dir)} (${htf.src}) -> zona M15 -> ${orderType === 'LIMIT' ? 'Retest' : 'Harga di zona'} -> SIGNAL ${dir === 1 ? 'BUY' : 'SELL'}`;
  const customTPs = getStructuralTPs(m15, dir, entry, z.sl, 1.0);
  return finalizePlan({
    dir, entry, orderType, baseSL: z.sl, kind: 'intraday', atrVal: atr15, ctx, rrList: rr,
    confidence: 'MEDIUM', setup: `Intraday Trend Follow (${dir === 1 ? 'Demand' : 'Supply'} M15)`,
    zoneNote: `${dir === 1 ? 'Demand' : 'Supply'} M15`, zoneRange: { min: z.bottom, max: z.top },
    head: `Intraday ${orderLabel(dir, orderType)}`, lines: [`Bias H1 ${dirLabel(dir)} (${htf.src})`, `Zona M15 ${ctx.f(z.bottom)} - ${ctx.f(z.top)}`],
    zoneLine: `${dir === 1 ? 'Demand' : 'Supply'} M15`, timeframes: 'H1/M15/M5', rangeInfo, chartContext, customTPs,
  });
}

// ─────────────────────────── SWING ───────────────────────────
async function runSwing(ctx, d) {
  const { price, m15 } = d;
  const atr15 = atrOf(m15, ctx.pip);
  const h1 = aggregateCandles(m15, 60);
  const h4 = aggregateCandles(m15, 240);
  const d1 = aggregateCandles(m15, 1440);

  const h1Dir = analyzePureSMCStructure(h1).dir;
  const h4Dir = emaBias(h4, 20);
  let d1Dir = 0;
  if (d1.length >= 3) {
    const ref = d1[d1.length - 3].c;
    const a = atr(d1, 14);
    if (price > ref + 0.25 * a) d1Dir = 1;
    else if (price < ref - 0.25 * a) d1Dir = -1;
  }
  if (!(d1Dir !== 0 && d1Dir === h4Dir && h4Dir === h1Dir)) {
    return fail(`Bias belum selaras. D1 ${dirLabel(d1Dir)}, H4 ${dirLabel(h4Dir)}, H1 ${dirLabel(h1Dir)}. Swing hanya aktif jika ketiganya searah.`);
  }
  const dir = d1Dir;
  const maxDist = 6 * atr15;
  const zones = findSDZones(m15, dir, price, {}).filter(z => z.dist <= maxDist);
  if (!zones.length) return fail(`Bias ${dirLabel(dir)} selaras, tetapi belum ada zona M15 yang fresh dan dekat.`);
  const z = zones[0];
  const rawEntry = dir === 1 ? z.top : z.bottom;
  const { entry, orderType } = sanitizeEntry({ dir, entry: rawEntry, price, orderType: 'LIMIT', pip: ctx.pip });
  const chartContext = `D1 ${dirLabel(d1Dir)} + H4 ${dirLabel(h4Dir)} + H1 ${dirLabel(h1Dir)} -> zona M15 -> SIGNAL ${dir === 1 ? 'BUY' : 'SELL'}`;
  return finalizePlan({
    dir, entry, orderType, baseSL: z.sl, kind: 'swing', atrVal: atr15, ctx, rrList: STYLES['Swing'].rr,
    confidence: 'HIGH', setup: `Swing Trend Following (${dir === 1 ? 'Demand' : 'Supply'} M15)`,
    zoneNote: `${dir === 1 ? 'Demand' : 'Supply'} M15`, zoneRange: { min: z.bottom, max: z.top },
    head: `Swing ${orderLabel(dir, orderType)}`, lines: [`Bias D1/H4/H1 ${dirLabel(dir)}`, `Zona M15 ${ctx.f(z.bottom)} - ${ctx.f(z.top)}`],
    zoneLine: `${dir === 1 ? 'Demand' : 'Supply'} M15`, timeframes: 'D1/H4/H1/M15', rangeInfo: rangeInfoText(ctx, h1), chartContext,
  });
}

// ─────────────────────────── VISION ───────────────────────────
function collectImages(body) {
  const raw = [];
  for (const k of ['images', 'imgs', 'screenshots']) if (Array.isArray(body?.[k])) raw.push(...body[k]);
  for (const k of ['image', 'img', 'screenshot']) if (typeof body?.[k] === 'string') raw.push(body[k]);
  return raw
    .map(x => (typeof x === 'string' ? x : x?.data || x?.url || x?.dataUrl || ''))
    .filter(x => typeof x === 'string' && x.length > 100)
    .map(x => (x.startsWith('data:') || x.startsWith('http') ? x : `data:image/jpeg;base64,${x}`))
    .slice(0, 4);
}

async function runVision(body, images, lang, livePrice) {
  const t = TX[lang];
  const vr = await getVisionSignal(images, lang);
  if (!vr.plan) return { ok: false, reason: vr.reason };
  const p = vr.plan;

  const sig = String(p.signal || '').toUpperCase();
  const dir = sig === 'BUY' ? 1 : sig === 'SELL' ? -1 : 0;
  if (!dir) return { ok: false, reason: 'AI tidak memberi sinyal BUY/SELL yang jelas. Coba gambar lain.' };

  const symbol = normSymbol(p.symbol) || normSymbol(body.symbol ?? body.pair ?? body.asset ?? body.ticker);
  if (!symbol) return { ok: false, reason: lang === 'en' ? 'Could not read the pair from the image.' : 'Nama pair tidak terbaca dari gambar. Pastikan judul chart terlihat.' };

  let entry = toNum(p.entry), sl = toNum(p.sl);
  const tps = [p.tp1, p.tp2, p.tp3].map(toNum).filter(x => x > 0);
  if (!(entry > 0) || !(sl > 0)) return { ok: false, reason: 'AI tidak memberi angka entry/SL yang valid. Coba lagi.' };

  const ctx = makeCtx(symbol, lang, livePrice || entry);
  const [lo, hi] = ctx.prof.range;
  const ref = livePrice || entry;
  if (ref < lo || ref > hi) return { ok: false, reason: t.range(ref, symbol, lo, hi) };
  if (livePrice > 0 && Math.abs(entry - livePrice) / livePrice > 0.05) {
    return { ok: false, reason: lang === 'en' ? 'Entry from the image is far from the live price. Make sure the chart matches the selected pair.' : 'Entry dari gambar jauh dari harga live. Pastikan chart sesuai dengan pair yang dipilih.' };
  }

  let orderType = /LIMIT|STOP/i.test(String(p.orderType || '')) ? 'LIMIT' : 'NOW';
  if (livePrice > 0) {
    if (orderType === 'NOW') entry = livePrice;
    else ({ entry, orderType } = sanitizeEntry({ dir, entry, price: livePrice, orderType, pip: ctx.pip }));
  }

  const v = validateVisionPlan({ dir, entry, sl, tps, ctx });
  if (!v.ok) return { ok: false, reason: v.reason };

  const tfs = Array.isArray(p.timeframes) ? p.timeframes.join('/') : String(p.timeframes || '');
  const reason = withPair(symbol, [p.reason, v.note].filter(Boolean).join(' '));
  return {
    ok: true, symbol, dir, ctx,
    plan: {
      kind: 'intraday', orderType, status: orderType === 'LIMIT' ? 'PENDING' : 'RUNNING',
      entry, bufferEnd: entry, sl: v.sl, tps: v.tps, zone: null, expireMs: 0,
      zoneNote: String(p.setup || 'Vision'), chartContext: String(p.chartContext || ''), source: 'vision',
    },
    meta: { confidence: 'MEDIUM', riskLabel: 'MEDIUM', setup: String(p.setup || 'Vision Analysis'), reason, timeframes: tfs, rangeInfo: String(p.range_info || '') },
  };
}

// ─────────────────────────── INPUT CANDLE ───────────────────────────
function normStyle(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!k) return 'Scalping';
  const map = {
    scalping: 'Scalping', scalpingema: 'Scalping EMA', ema: 'Scalping EMA', scalpema: 'Scalping EMA',
    daytrading: 'Day Trading', day: 'Day Trading', scalpingkonservatif: 'Day Trading',
    intraday: 'Intraday', swing: 'Swing',
  };
  return map[k] || Object.keys(STYLES).find(s => s.toLowerCase().replace(/[^a-z]/g, '') === k) || 'Scalping';
}

function clientCandles(body, tf) {
  const c = body?.candles || body?.data || {};
  const keys = tf === 'm1' ? ['m1', 'M1', '1m'] : tf === 'm5' ? ['m5', 'M5', '5m'] : ['m15', 'M15', '15m'];
  for (const k of keys) {
    const rows = c[k] ?? body?.[k];
    if (Array.isArray(rows) && rows.length) {
      return cleanCandles(rows).map(x => ({ ...x, t: toEpochMs(x.t) }));
    }
  }
  return [];
}

const TF_API = { m1: '1m', m5: '5m', m15: '15m' };
const TF_MIN = { m1: 1, m5: 5, m15: 15 };

function needsFor(style) {
  switch (style) {
    case 'Scalping': return { m1: NEED.m1, m5: NEED.m5, m15: 150 };
    case 'Scalping EMA': return { m1: NEED.m1, m5: 260 };
    case 'Day Trading': return { m1: NEED.m1, m5: NEED.m5, m15: 200 };
    case 'Intraday': return { m5: NEED.m5, m15: 300 };
    case 'Swing': return { m15: NEED.m15 };
    default: return { m5: NEED.m5, m15: 200 };
  }
}

function minFor(style, tf) {
  if (style === 'Swing' && tf === 'm15') return MIN_BARS.m15Swing;
  if (style === 'Scalping EMA' && tf === 'm5') return 200;
  return MIN_BARS[tf];
}

const RUNNERS = {
  'Scalping': runScalpHybrid,
  'Scalping EMA': runScalpEMA,
  'Day Trading': runDay,
  'Intraday': runIntraday,
  'Swing': runSwing,
};

// ═══════════════════════════ HANDLER ═══════════════════════════
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-email');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed', message: 'Method not allowed' });

  let lang = 'id';
  const sendErr = (status, msg, extra = {}) =>
    res.status(status).json({ ok: false, error: msg, message: msg, reason: msg, plan: null, ...extra });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body && typeof body === 'object' ? body : {};
    lang = pickLang(body, req.query);
    const t = TX[lang];

    if (!Object.keys(body).length) return sendErr(400, t.emptyBody);

    // ── Akses ──
    const email = String(body.email || req.headers['x-user-email'] || '').trim();
    const access = await checkAccess(email);
    if (!access.ok) return sendErr(access.key === 'noEmail' ? 401 : 403, t[access.key] || t.notRegistered);

    const livePrice = toNum(body.price ?? body.livePrice ?? body.live_price ?? body.currentPrice ?? body.last);
    const images = collectImages(body);

    // ── Jalur Vision (screenshot chart) ──
    if (images.length) {
      const trial = await checkTrialLimit(email, access.status);
      if (!trial.ok) return sendErr(429, trial.msg);
      const v = await runVision(body, images, lang, livePrice);
      if (!v.ok) return res.status(200).json({ ok: false, error: null, message: v.reason, reason: v.reason, plan: null, meta: { reason: v.reason } });
      const f = v.ctx.f;
      return res.status(200).json({
        ok: true, mode: 'vision', symbol: v.symbol, price: livePrice || f(v.plan.entry),
        dir: v.dir, plan: v.plan, meta: v.meta,
      });
    }

    // ── Jalur candle ──
    const symbol = normSymbol(body.symbol ?? body.pair ?? body.asset ?? body.ticker ?? body.instrument);
    if (!symbol) return sendErr(400, t.noPair(Object.keys(body).join(', ')));

    let price = livePrice;
    if (!(price > 0)) {
      const c5 = clientCandles(body, 'm5');
      price = lastClosePrice(c5);
    }
    if (!(price > 0)) return sendErr(400, t.noPrice);

    const ctx = makeCtx(symbol, lang, price);
    const [lo, hi] = ctx.prof.range;
    if (price < lo || price > hi) return sendErr(400, t.range(price, symbol, lo, hi));

    const style = normStyle(body.style ?? body.mode ?? body.tradingStyle);
    const need = needsFor(style);

    const trial = await checkTrialLimit(email, access.status);
    if (!trial.ok) return sendErr(429, trial.msg);

    // Ambil candle: dari client jika cukup dan cocok, selain itu TickerLayer / cache
    const tfs = Object.keys(need);
    const triedAll = [];
    const got = await Promise.all(tfs.map(async tf => {
      const fromClient = clientCandles(body, tf);
      if (fromClient.length >= minFor(style, tf) && matchesRef(fromClient, price)) return fromClient;
      const r = await getCandles(symbol, TF_API[tf], need[tf], price);
      if (r.tried) triedAll.push(...r.tried);
      return r.candles;
    }));

    const d = { price, m1: [], m5: [], m15: [], recentSL: body.recentSL };
    tfs.forEach((tf, i) => { d[tf] = mergeLiveBar(got[i], price, TF_MIN[tf]); });

    for (const tf of tfs) {
      if (d[tf].length < minFor(style, tf)) {
        return sendErr(503, t.candle(symbol, price, describeTried(triedAll, price, lang)));
      }
    }

    const result = await RUNNERS[style](ctx, d);
    const cfg = STYLES[style];

    if (!result || !result.plan) {
      const reason = (result && result.reason) || t.noSetup;
      return res.status(200).json({
        ok: false, error: null, message: reason, reason, plan: null,
        symbol, style, price, meta: { reason },
      });
    }

    return res.status(200).json({
      ok: true, mode: 'candles', symbol, style,
      label: lang === 'en' ? cfg.labelEn : cfg.label,
      price, dir: result.dir ?? 0, plan: result.plan, meta: result.meta,
    });
  } catch (err) {
    console.error('[generate] unhandled error:', err && err.stack ? err.stack : err);
    return sendErr(500, `Server error: ${err && err.message ? err.message : 'unknown'}`);
  }
}
