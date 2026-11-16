// api/generate.js
// v101 (Vision: validasi SL/TP, pair name di reasoning, pembacaan pair MT4/MT5 & TradingView)

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

// Urutan tetap: utama dulu, lalu cadangan
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

// ── MINIMUM SL (PIPS) UNTUK MENCEGAH KENA SPREAD ──
const MIN_SL_PIPS = { fx: 5, fx_jpy: 5, gold: 25, silver: 8, metal: 8, crypto: 20, index: 10, commodity: 10 };
const slFloor = (kind, ctx) => {
  const base = MIN_SL_PIPS[ctx.prof.cls] || 5;
  const mult = { scalp: 1, day: 1, intraday: 1.5, swing: 2 }[kind] || 1;
  return base * mult * ctx.pip;
};

const STYLES = {
  'Scalping': {
    label: 'Scalping Agresif · Momentum NOW / OCO Wajib',
    labelEn: 'Aggressive Scalping · Momentum NOW / OCO Mandatory',
    entryStyle: 'Agresif', entryStyleEn: 'Aggressive', mode: 'MIXED', kind: 'scalp', rr: [1.0, 2.0, 3.0],
  },
  'Day Trading': {
    label: 'Scalping Konservatif · OCO 2 Zona / LIMIT (RR 1:1/1:2/1:3)',
    labelEn: 'Conservative Scalping · OCO 2 Zones / LIMIT (RR 1:1/1:2/1:3)',
    entryStyle: 'Konservatif', entryStyleEn: 'Conservative', mode: 'LIMIT', kind: 'day',
    rr: [1.0, 2.0, 3.0], // TP murni RR
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

function liquidityInsideZone(candles, zone, lookback = 30) {
  const s = candles.slice(-lookback);
  const lows = s.map(c => c.l).filter(l => l > zone.bottom && l < zone.top);
  const highs = s.map(c => c.h).filter(h => h > zone.bottom && h < zone.top);
  return { insideLows: lows, insideHighs: highs };
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

const SRC_EN = { 'BOS Bullish': 'BOS Bullish', 'BOS Bearish': 'BOS Bearish', 'Struktur HH + HL': 'HH + HL', 'Struktur LH + LL': 'LH + LL', 'Mitigasi FVG / Inducement': 'FVG mitigation', 'Sweep FVG / OB': 'Sweep', 'Default': 'Default' };
const srcName = (src, lang) => (lang === 'en' ? (SRC_EN[src] || src) : src);

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

async function tlUsableKeys() {
  const names = API_KEYS.map((_, i) => `tl_cd_${i}`);
  let vals = names.map(() => null);
  try {
    const raw = await kv(['MGET', ...names]);
    if (Array.isArray(raw)) vals = raw;
  } catch {}
  const now = Date.now();
  return API_KEYS.map((_, i) => i).filter(i => !vals[i] && (tlCdMem.get(names[i]) || 0) <= now);
}

async function tlSetCooldown(idx, sec) {
  if (sec <= 0) return;
  const name = `tl_cd_${idx}`;
  tlCdMem.set(name, Date.now() + sec * 1000);
  try { await kv(['SET', name, '1', 'EX', sec]); } catch {}
}

async function tlFetch(url) {
  if (!API_KEYS.length) return { response: null, status: 500, detail: 'Tidak ada TICKERLAYER_API_KEY di env' };
  const order = await tlUsableKeys();
  if (!order.length) return { response: null, status: 429, detail: 'Semua key TickerLayer sedang cooldown' };

  let last = { status: 500, detail: '' };
  for (const idx of order) {
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
    } catch(e) {
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

// Helper untuk mencari Swing High/Low terdekat dari harga saat ini
function findNearestSwings(candles, price, minDist, maxDist) {
  const { highs, lows } = findPivots(candles, 2);
  let nearestHigh = null;
  let nearestLow = null;

  for (let i = highs.length - 1; i >= 0; i--) {
    const h = highs[i].p;
    if (h > price + minDist && h <= price + maxDist) {
      if (!nearestHigh || h < nearestHigh) nearestHigh = h;
    }
  }
  for (let i = lows.length - 1; i >= 0; i--) {
    const l = lows[i].p;
    if (l < price - minDist && l >= price - maxDist) {
      if (!nearestLow || l > nearestLow) nearestLow = l;
    }
  }
  return { nearestHigh, nearestLow };
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

  // Log ukuran gambar untuk memantau beban request
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
// Batas jarak SL (pip) per kelas aset untuk mode Vision
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

  // 1. SL harus di sisi yang benar terhadap entry
  if (isBuy ? !(sl < entry) : !(sl > entry)) {
    return {
      ok: false,
      reason: en
        ? 'AI placed the SL on the wrong side of entry. Setup rejected, please try another chart.'
        : 'SL dari AI berada di sisi yang salah terhadap entry. Setup ditolak, coba gambar lain.',
    };
  }

  // 2. Jarak SL tidak boleh terlalu lebar
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

  // 3. SL tidak boleh terlalu sempit (kena spread/noise)
  let note = '';
  if (riskPips < minPips) {
    risk = minPips * pip;
    sl = isBuy ? entry - risk : entry + risk;
    riskPips = minPips;
    note = en
      ? `SL widened to minimum ${minPips} pips.`
      : `SL dilebarkan ke minimum ${minPips} pip.`;
  }

  // 4. TP: pakai TP AI jika searah dan RR >= 1R, selain itu hitung ulang 1R/2R/3R
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

// ═══════════════════════════ WORKFLOW MTF ═══════════════════════════

// ── SCALPING AGRESIF: Momentum/FVG NOW → OCO (2 zona valid / Swing / Probable) WAJIB 2 ARAH ──
async function buildScalpPlan({ m1, m5, m15, price, rrList, ctx }) {
  const { pip } = ctx;
  const t = tx(ctx);
  const atrM1 = atrOf(m1, pip);
  const maxZoneDist = SCALP_MAX_DIST_ATR * atrM1;

  const biasM15 = analyzePureSMCStructure(m15);
  const structM1 = analyzePureSMCStructure(m1);
  const rangeM15 = getRangeInfo(m15, 50);
  let rangeInfoStr = '-', isPremium = false, isDiscount = false;
  if (rangeM15 && rangeM15.high > rangeM15.low) {
    const diff = rangeM15.high - rangeM15.low;
    const pricePos = (price - rangeM15.low) / diff;
    isPremium = pricePos > 0.5;
    isDiscount = pricePos <= 0.5;
    rangeInfoStr = `M15 Range: ${isPremium ? 'PREMIUM' : 'DISCOUNT'} (Pos: ${(pricePos * 100).toFixed(1)}%)`;
  }

  const lastM1 = m1[m1.length - 1];
  const bodyM1 = Math.abs(lastM1.c - lastM1.o);
  const isMomentumStrong = structM1.dir !== 0 && bodyM1 > 1.2 * atrM1;
  const fvgs = findRecentFVGs(m1, 20);

  // ── 1. MARKET KENCENG (MOMENTUM) -> NOW ──
  if (isMomentumStrong) {
    const dir = structM1.dir;
    const isOverextended = dir === 1 ? (price > recentExtreme(m1, -1, 10) + 3 * atrM1) : (price < recentExtreme(m1, 1, 10) - 3 * atrM1);

    if (!isOverextended) {
      return await finalizePlan({
        dir, entry: price, orderType: 'NOW', baseSL: recentExtreme(m1, dir, 5),
        kind: 'scalp', atrVal: atrM1, ctx, rrList,
        confidence: 'HIGH', setup: 'M1 Momentum (Market NOW)', zoneNote: 'M1 Momentum', zoneRange: { min: price, max: price },
        timeframes: 'M1, M5, M15', rangeInfo: rangeInfoStr,
        chartContext: `M1 Momentum Kuat -> NOW ${dir === 1 ? 'BUY' : 'SELL'}`,
        head: t.headLine(t.title.scalp, dir === 1 ? 'BUY' : 'SELL', 'NOW', ctx.symbol),
        lines: [`Market kencang terdeteksi. Eksekusi Market NOW searah momentum M1.`],
      });
    }
  }

  // ── 2. FVG NOW (Harga sedang di FVG) ──
  const inFvgBull = fvgs.find(f => f.dir === 1 && price >= f.lo && price <= f.hi);
  const inFvgBear = fvgs.find(f => f.dir === -1 && price >= f.lo && price <= f.hi);

  if (inFvgBull && biasM15.dir >= 0) {
    return await finalizePlan({
      dir: 1, entry: price, orderType: 'NOW', baseSL: inFvgBull.lo - 0.25 * atrM1,
      kind: 'scalp', atrVal: atrM1, ctx, rrList,
      confidence: 'HIGH', setup: 'M1 Bullish FVG (Market NOW)', zoneNote: 'M1 Bullish FVG', zoneRange: { min: inFvgBull.lo, max: inFvgBull.hi },
      timeframes: 'M1, M5, M15', rangeInfo: rangeInfoStr,
      chartContext: `M15 ${biasM15.src} -> M1 FVG NOW BUY`,
      head: t.headLine(t.title.scalp, 'BUY', 'NOW', ctx.symbol),
      lines: [`Harga berada di zona FVG Bullish M1. Eksekusi NOW.`],
    });
  }
  if (inFvgBear && biasM15.dir <= 0) {
    return await finalizePlan({
      dir: -1, entry: price, orderType: 'NOW', baseSL: inFvgBear.hi + 0.25 * atrM1,
      kind: 'scalp', atrVal: atrM1, ctx, rrList,
      confidence: 'HIGH', setup: 'M1 Bearish FVG (Market NOW)', zoneNote: 'M1 Bearish FVG', zoneRange: { min: inFvgBear.lo, max: inFvgBear.hi },
      timeframes: 'M1, M5, M15', rangeInfo: rangeInfoStr,
      chartContext: `M15 ${biasM15.src} -> M1 FVG NOW SELL`,
      head: t.headLine(t.title.scalp, 'SELL', 'NOW', ctx.symbol),
      lines: [`Harga berada di zona FVG Bearish M1. Eksekusi NOW.`],
    });
  }

  // ── 3. AREA VALID (WAJIB OCO 2 ARAH KARENA TIDAK ADA MOMENTUM) ──
  const demandBelow = findSDZones(m1, 1, price, { dispAtr: 0.8, freshOnly: true })
    .filter(z => z.top < price - 0.2 * atrM1 && z.dist > 0 && z.dist <= maxZoneDist)
    .sort((a, b) => a.dist - b.dist)[0] || null;
  const fvgBullBelow = fvgs.filter(f => f.dir === 1 && f.hi < price - 0.2 * atrM1 && (price - f.hi) < 2.5 * atrM1)
    .sort((a, b) => b.hi - a.hi)[0] || null;

  const supplyAbove = findSDZones(m1, -1, price, { dispAtr: 0.8, freshOnly: true })
    .filter(z => z.bottom > price + 0.2 * atrM1 && z.dist > 0 && z.dist <= maxZoneDist)
    .sort((a, b) => a.dist - b.dist)[0] || null;
  const fvgBearAbove = fvgs.filter(f => f.dir === -1 && f.lo > price + 0.2 * atrM1 && (f.lo - price) < 2.5 * atrM1)
    .sort((a, b) => a.lo - b.lo)[0] || null;

  let buyOrder = null, sellOrder = null;

  if (demandBelow) {
    const entry = demandBelow.top;
    const sl = clampSL(1, entry, demandBelow.sl - 0.3 * atrM1, 'scalp', ctx, atrM1);
    const risk = entry - sl;
    if (risk > 0) buyOrder = { dir: 1, entry, sl, tps: rrList.map(m => entry + risk * m), type: 'BUY LIMIT', label: 'Buy Limit · Demand M1', zone: { min: demandBelow.bottom, max: demandBelow.top } };
  } else if (fvgBullBelow) {
    const entry = fvgBullBelow.hi;
    const sl = clampSL(1, entry, fvgBullBelow.lo - 0.3 * atrM1, 'scalp', ctx, atrM1);
    const risk = entry - sl;
    if (risk > 0) buyOrder = { dir: 1, entry, sl, tps: rrList.map(m => entry + risk * m), type: 'BUY LIMIT', label: 'Buy Limit · FVG M1', zone: { min: fvgBullBelow.lo, max: fvgBullBelow.hi } };
  }

  if (supplyAbove) {
    const entry = supplyAbove.bottom;
    const sl = clampSL(-1, entry, supplyAbove.sl + 0.3 * atrM1, 'scalp', ctx, atrM1);
    const risk = sl - entry;
    if (risk > 0) sellOrder = { dir: -1, entry, sl, tps: rrList.map(m => entry - risk * m), type: 'SELL LIMIT', label: 'Sell Limit · Supply M1', zone: { min: supplyAbove.bottom, max: supplyAbove.top } };
  } else if (fvgBearAbove) {
    const entry = fvgBearAbove.lo;
    const sl = clampSL(-1, entry, fvgBearAbove.hi + 0.3 * atrM1, 'scalp', ctx, atrM1);
    const risk = sl - entry;
    if (risk > 0) sellOrder = { dir: -1, entry, sl, tps: rrList.map(m => entry - risk * m), type: 'SELL LIMIT', label: 'Sell Limit · FVG M1', zone: { min: fvgBearAbove.lo, max: fvgBearAbove.hi } };
  }

  // ✅ JIKA SALAH SATU KOSONG: Pakai Swing High/Low terdekat (Wajib OCO)
  if (!buyOrder || !sellOrder) {
    const minGap = 0.8 * atrM1;
    const swings = findNearestSwings(m1, price, minGap, maxZoneDist);

    if (!buyOrder && swings.nearestLow) {
      const entry = swings.nearestLow;
      const sl = clampSL(1, entry, entry - 0.3 * atrM1, 'scalp', ctx, atrM1);
      const risk = entry - sl;
      if (risk > 0) {
        buyOrder = {
          dir: 1, entry, sl, tps: rrList.map(m => entry + risk * m),
          type: 'BUY LIMIT', label: 'Buy Limit · Swing Low Bounce',
          zone: { min: entry - 0.1*atrM1, max: entry + 0.1*atrM1 }
        };
      }
    }

    if (!sellOrder && swings.nearestHigh) {
      const entry = swings.nearestHigh;
      const sl = clampSL(-1, entry, entry + 0.3 * atrM1, 'scalp', ctx, atrM1);
      const risk = sl - entry;
      if (risk > 0) {
        sellOrder = {
          dir: -1, entry, sl, tps: rrList.map(m => entry - risk * m),
          type: 'SELL LIMIT', label: 'Sell Limit · Swing High Bounce',
          zone: { min: entry - 0.1*atrM1, max: entry + 0.1*atrM1 }
        };
      }
    }
  }

  // ✅ Fallback Terakhir jika Swing tidak ada: Paksa jarak 1.5 ATR (Probable Bounce)
  if (!buyOrder) {
    const entry = price - (1.5 * atrM1);
    const sl = clampSL(1, entry, entry - 0.3 * atrM1, 'scalp', ctx, atrM1);
    const risk = entry - sl;
    if (risk > 0) {
       buyOrder = { dir: 1, entry, sl, tps: rrList.map(m => entry + risk * m), type: 'BUY LIMIT', label: 'Buy Limit · Probable Bounce', zone: { min: entry - 0.1*atrM1, max: entry + 0.1*atrM1 } };
    }
  }
  if (!sellOrder) {
    const entry = price + (1.5 * atrM1);
    const sl = clampSL(-1, entry, entry + 0.3 * atrM1, 'scalp', ctx, atrM1);
    const risk = sl - entry;
    if (risk > 0) {
       sellOrder = { dir: -1, entry, sl, tps: rrList.map(m => entry - risk * m), type: 'SELL LIMIT', label: 'Sell Limit · Probable Bounce', zone: { min: entry - 0.1*atrM1, max: entry + 0.1*atrM1 } };
    }
  }

  // Scalping Agresif WAJIB OCO jika bukan NOW
  return {
    plan: {
      isOCO: true,
      orders: [buyOrder, sellOrder],
      setup: 'OCO M1 (Agresif 2 Arah)',
      chartContext: `M15 ${biasM15.src} -> M1 OCO Wajib`,
    },
    meta: {
      confidence: 'HIGH',
      riskLabel: 'MEDIUM',
      reason: `Tidak ada momentum untuk NOW. Karena SL/TP tipis, dipasang OCO 2 arah untuk probabilitas pantulan lebih tinggi: BUY @ ${buyOrder.entry.toFixed(ctx.dec)}, SELL @ ${sellOrder.entry.toFixed(ctx.dec)}. Jika salah satu tersentuh, order lawannya otomatis dibatalkan.`,
    },
  };
}

// ── SCALPING KONSERVATIF: OCO (2 zona valid) → LIMIT (1 zona valid) ──
async function buildDayPlan({ m1, m5, m15, price, rrList, ctx }) {
  const t = tx(ctx);
  const { f, pip } = ctx;
  const atrM5 = atrOf(m5, pip);
  const maxDist = DAY_MAX_DIST_ATR * atrM5;
  const gap = 0.1 * atrM5;

  const rawM15 = analyzePureSMCStructure(m15);
  const dirM15 = rawM15.dir || emaBias(m15, 20);
  const rangeM5 = getRangeInfo(m5, 50);
  const rangeInfoStr = rangeM5 && rangeM5.high > rangeM5.low
    ? `M5 Range Pos: ${(((price - rangeM5.low) / (rangeM5.high - rangeM5.low)) * 100).toFixed(1)}%`
    : '-';

  const pickZone = dir => {
    const z5 = findSDZones(m5, dir, price, { dispAtr: 0.8, freshOnly: true }).find(z => z.dist <= maxDist);
    if (z5) return { z: z5, tf: 'M5' };
    const z1 = findSDZones(m1, dir, price, { dispAtr: 0.8, freshOnly: true }).find(z => z.dist <= maxDist);
    if (z1) return { z: z1, tf: 'M1' };
    return null;
  };

  const mkOrder = dir => {
    const pz = pickZone(dir);
    if (!pz) return null;
    const z = pz.z;
    const entry = dir === 1 ? z.top : z.bottom;
    const sl = clampSL(dir, entry, z.sl, 'day', ctx, atrM5);
    const risk = Math.abs(entry - sl);
    if (risk <= 0) return null;

    const tps = rrList.map(m => entry + dir * risk * m);

    return {
      dir, entry, sl, tps, dist: z.dist,
      type: dir === 1 ? 'BUY LIMIT' : 'SELL LIMIT',
      label: `${dir === 1 ? 'Buy' : 'Sell'} Limit · ${pz.tf} ${dir === 1 ? 'Demand' : 'Supply'}`,
      zone: { min: z.bottom, max: z.top },
    };
  };

  let buyOrder = mkOrder(1);
  let sellOrder = mkOrder(-1);

  if (buyOrder && !(buyOrder.entry < price - gap)) buyOrder = null;
  if (sellOrder && !(sellOrder.entry > price + gap)) sellOrder = null;

  // Jika ada 2 zona valid → OCO
  if (buyOrder && sellOrder) {
    const biasLabel = dirM15 === 1 ? 'Bullish' : dirM15 === -1 ? 'Bearish' : 'Netral';
    const confidence = rawM15.dir !== 0 ? 'HIGH' : 'MEDIUM';
    return {
      plan: {
        isOCO: true,
        orders: [buyOrder, sellOrder],
        setup: 'Konservatif OCO 2 Zona (M5/M1)',
        chartContext: `M15 ${biasLabel} -> M5/M1 OCO 2 arah`,
      },
      meta: {
        confidence,
        riskLabel: 'MEDIUM',
        reason: `OCO 2 zona valid: BUY @ ${f(buyOrder.entry)} (${buyOrder.label}), SELL @ ${f(sellOrder.entry)} (${sellOrder.label}). TP ikut RR 1:1 / 1:2 / 1:3. Jika salah satu tersentuh, order lawannya otomatis dibatalkan.`,
      },
    };
  }

  // Jika hanya 1 zona valid → LIMIT 1 Arah
  const singleOrder = buyOrder || sellOrder;
  if (singleOrder) {
    return await finalizePlan({
      dir: singleOrder.dir, entry: singleOrder.entry, orderType: 'LIMIT', baseSL: singleOrder.sl,
      kind: 'day', atrVal: atrM5, ctx, rrList,
      confidence: 'MEDIUM', setup: singleOrder.label, zoneNote: singleOrder.label, zoneRange: singleOrder.zone,
      timeframes: 'M1, M5, M15', rangeInfo: rangeInfoStr,
      chartContext: `M15 ${dirLabel(dirM15)} -> M5/M1 1 Arah`,
      head: t.headLine(t.title.day, singleOrder.dir === 1 ? 'BUY' : 'SELL', 'LIMIT', ctx.symbol),
      lines: [`Hanya ada 1 zona valid searah bias.`],
    });
  }

  return { plan: null, reason: 'Tidak ada zona fresh M5/M1 yang valid dalam jarak maksimal. Menunggu setup probabilitas tinggi.' };
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

      // ✅ SMART SIGNAL DEDUCTION
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

      // Pair: prioritas dari body (input user), lalu dari hasil baca AI
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

      // ✅ VALIDASI: arah, jarak SL, dan RR TP
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

    const needM1 = (style === 'Scalping' || style === 'Day Trading') ? NEED.m1 : 0;
    const needM5 = (style === 'Scalping' || style === 'Day Trading' || style === 'Intraday') ? NEED.m5 : 0;
    const needM15 = (style === 'Intraday' || style === 'Swing' || style === 'Day Trading') ? NEED.m15 : 0;

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

    if (style === 'Scalping') {
      liveSteps = [`Cek Momentum M1`, `Cek FVG M1`, `Cari OCO / LIMIT Valid`, `Anti Entry Acak`];
      result = await buildScalpPlan({ m1, m5, m15, price, rrList, ctx });
    } else if (style === 'Day Trading') {
      liveSteps = [`Cek Zona M5 / M1 (refine)`, `Validasi Bias M15`, `Hitung SL / RR murni`, `OCO / LIMIT Valid`];
      result = await buildDayPlan({ m1, m5, m15, price, rrList, ctx });
    } else if (style === 'Intraday') {
      liveSteps = [`Memeriksa bias M15 & H1`, `Mencari Zona M5 / M15`, `Cek OCO / Trend Follow`, `Validasi ERL/IRL`];
      result = await buildIntradayPlan({ m5, m15, price, rrList, ctx });
    } else if (style === 'Swing') {
      liveSteps = [`Memeriksa bias D1, H4 & H1`, `Mencari Zona M15`, `Cek Trend Follow`, `Validasi ERL/IRL`];
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
