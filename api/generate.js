// api/generate.js
// v105 (Hybrid: arah dari M5/EMA, filter market ranging agar tidak asal keluar sinyal,
//       pemicu entry dari M1. NOW: SL minimal 1 ATR M5 (maks 2 ATR M5), searah bias M15 kecuali CHoCH,
//       hanya sesi London/NY, cooldown 20 menit setelah SL arah sama.
//       LIMIT/OCO tetap dari strong zone M1 dengan SL di balik likuiditas.
//       Konservatif tetap selalu memberi sinyal. Vision tetap.)

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
const VISION_MAX_TOKENS = 700;

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

const MIN_SL_PIPS = { fx: 5, fx_jpy: 5, gold: 25, silver: 8, metal: 8, crypto: 20, index: 10, commodity: 10 };
const slFloor = (kind, ctx) => {
  const base = MIN_SL_PIPS[ctx.prof.cls] || 5;
  const mult = { scalp: 1, day: 1, intraday: 1.5, swing: 2 }[kind] || 1;
  return base * mult * ctx.pip;
};

const STYLES = {
  'Scalping': {
    label: 'Scalping Agresif · Hybrid M5/M1 · Pullback & Trend Follow EMA',
    labelEn: 'Aggressive Scalping · Hybrid M5/M1 · Pullback & EMA Trend Follow',
    entryStyle: 'Agresif', entryStyleEn: 'Aggressive', mode: 'MIXED', kind: 'scalp', rr: [1.0, 2.0, 3.0],
  },
  'Day Trading': {
    label: 'Scalping Konservatif · Strong Zone Terdekat (wajib sinyal) · LIMIT / OCO',
    labelEn: 'Conservative Scalping · Nearest Strong Zone (always signal) · LIMIT / OCO',
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
const SCALP_PIVOT = 2;
const ZONE_ATR_PERIOD = 14;
const ZONE_DISP_ATR = 1.2;
const ZONE_MAX_ATR = 2.5;
const ZONE_FRESH_ONLY = true;

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
1. **Konteks State Machine & EMA**: Jelaskan alur trend berdasarkan EMA dan struktur harga.
2. **Konteks Pullback**: Jelaskan konfirmasi pullback searah trend.
3. **Analisa Struktur & Zona**: Sebutkan zona kunci atau area retest EMA.
4. **Alasan & Tipe Entry**: Trend Following / Pullback EMA.
5. **Invalidasi**: Alasan penempatan SL.

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
    noSetup: 'Pasar sedang Ranging atau tidak ada setup pullback valid searah EMA. Menunggu tren terbentuk.',
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
1. **State Machine & EMA Context**: Explain trend flow based on EMA and price structure.
2. **Pullback Context**: Explain valid trend-following pullbacks.
3. **Structure & Zone Analysis**: Key zones or EMA retest areas.
4. **Reason & Entry Type**: Trend Following / EMA Pullback.
5. **Invalidation**: SL reasoning.

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
    noSetup: 'Market is ranging or no valid EMA pullback setup found. Waiting for trend.',
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
  const prompt = `Analisis chart ini dan berikan format JSON signal.`;
  const userContent = [{ type: "text", text: prompt }, ...images.map(imgBase64 => ({ type: "image_url", image_url: { url: imgBase64 } }))];
  try {
    const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: AI_VISION_MODEL, messages: [{ role: 'user', content: userContent }], max_tokens: VISION_MAX_TOKENS, temperature: 0.1 }),
    });
    if (!resp.ok) return { plan: null, reason: 'AI Vision error.' };
    const data = await resp.json();
    let content = data.choices?.[0]?.message?.content?.trim() || '';
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    return { plan: JSON.parse(content), reason: 'Vision Analysis' };
  } catch (err) {
    return { plan: null, reason: err.message };
  }
}

// ═══════════════════════════ KONFIGURASI STRONG ZONE & EMA PULLBACK ═══════════════════════════
const STRONG_DISP_ATR = 1.5;
const STRONG_SWEEP_BARS = 12;
const LIQ_BUF_ATR = 0.3;
const SCALP_MAX_RISK_ATR = 5;
const DAY_MAX_RISK_ATR = 6;

const DAY_FVG_IMPULSE_ATR = 0.8;
const DAY_ZONE_DISP_ATR = 0.8;

const SCALP_STRUCT_BARS = 60;
const SCALP_MIN_DIR_CANDLES = 40;
const M1_TRIGGER_BARS = 5;

const NOW_MIN_SL_ATR_M5 = 1.0;
const NOW_MAX_SL_ATR_M5 = 2.0;
const NOW_BUF_ATR_M1 = 0.2;

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
    out.push({ bottom: z.bottom, top: z.top, dist: z.dist, tag: dir === 1 ? 'Demand' : 'Supply', strong: true });
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
    label: `${dir === 1 ? 'Buy' : 'Sell'} NOW (EMA Pullback) · SL di balik ${structName}`,
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

function m1Trigger(m1, dir) {
  if (!m1 || m1.length < M1_TRIGGER_BARS + 1) return false;
  const last = m1[m1.length - 1];
  const prev = m1.slice(-(M1_TRIGGER_BARS + 1), -1);
  if (dir === 1) return last.c > Math.max(...prev.map(c => c.h));
  return last.c < Math.min(...prev.map(c => c.l));
}

// ═══════════════════════════ SCALPING AGRESIF (DENGAN FILTER RANGING & EMA PULLBACK) ═══════════════════════════
async function buildScalpPlan({ m1, m5, m15, price, rrList, ctx, recentSL = [] }) {
  const { pip } = ctx;
  const t = tx(ctx);

  const atrM1 = atrOf(m1, pip);
  const m5ok = Array.isArray(m5) && m5.length >= SCALP_MIN_DIR_CANDLES;
  const dirCands = m5ok ? m5 : m1;
  const atrDir = m5ok ? atrOf(m5, pip) : atrM1;
  const atrM5 = m5ok ? atrDir : atrOf(m1, pip) * 5 / Math.sqrt(5);

  const biasM15 = analyzePureSMCStructure(m15);
  const emaTrend = emaBias(dirCands, 20); // Menggunakan EMA 20 untuk arah trend M5/M1

  // 1. FILTER RANGING: Jika EMA Netral atau pasar sideway ketat, JANGAN keluarkan sinyal.
  const rangeInfo = getRangeInfo(dirCands, 30);
  const isRanging = rangeInfo && (rangeInfo.high - rangeInfo.low) < 2.0 * atrDir;
  if (emaTrend === 0 || isRanging) {
    return { plan: null, reason: 'Pasar sedang Ranging / Sideways atau tren EMA netral. Sesuai aturan, tidak ada sinyal agresif yang dikeluarkan.' };
  }

  const sessionOk = inScalpSession();
  const blocked = cooldownDirs(recentSL);
  if (!sessionOk) return { plan: null, reason: 'Di luar sesi aktif (London/NY). Sinyal scalping agresif ditutup.' };

  const dir = emaTrend; // Arah mengikuti EMA
  if (blocked.has(dir)) return { plan: null, reason: 'Arah ini sedang dalam masa cooldown setelah terkena Stop Loss.' };

  // 2. Cek Pullback terhadap EMA / Zona terdekat searah trend
  const emaVals = emaSeries(dirCands, 20);
  const currentEma = emaVals[emaVals.length - 1];
  const distToEma = Math.abs(price - currentEma);

  // Validasi apakah harga melakukan pullback mendekati EMA atau support/resistance searah
  const isPullbackValid = distToEma <= 2.5 * atrDir; 
  if (!isPullbackValid) {
    return { plan: null, reason: `Harga terlalu jauh dari EMA (bukan area pullback ideal). Menunggu retracement searah ${dirLabel(dir)}.` };
  }

  // 3. Konfirmasi pemicu M1 untuk entry NOW
  if (!m1Trigger(m1, dir)) {
    return { plan: null, reason: `Trend ${dirLabel(dir)} terdeteksi via EMA, namun belum ada konfirmasi trigger breakout M1.` };
  }

  const baseSL = dir === 1 ? price - 1.5 * atrM5 : price + 1.5 * atrM5;
  const nowO = buildNowOrder({
    dir, entry: price, baseSL, atrM5, atrM1, ctx, rrList,
    structName: `EMA Pullback M5`,
  });

  if (!nowO) return { plan: null, reason: 'Gagal membangun setup order NOW berdasarkan parameter EMA pullback.' };

  return await planFromOrder(nowO, {
    ctx, kind: 'scalp', orderType: 'NOW',
    setup: `EMA Trend Follow & Pullback (Market NOW)`,
    chartContext: `EMA Trend ${dirLabel(dir)} + Valid Pullback + Trigger M1`,
    timeframes: `M1, M5, M15`, rangeInfo: `EMA Trend: ${dirLabel(dir)}`,
    head: t.headLine(t.title.scalp, dir === 1 ? 'BUY' : 'SELL', 'NOW', ctx.symbol),
    lines: [`Market bergerak searah trend EMA ${dirLabel(dir)} dengan pullback sehat dan trigger M1 terkonfirmasi.`],
    confidence: 'HIGH',
  });
}

function buildDayOrder(dir, zone, liq, atrVal, ctx, rrList) {
  const entry = dir === 1 ? zone.top : zone.bottom;
  const edge = dir === 1 ? zone.bottom : zone.top;
  const buf = LIQ_BUF_ATR * atrVal;

  const pick = nearestLiquidity(dir, liq, edge, atrVal);
  const liqLevel = pick ? pick.p : edge;
  const liqName = pick ? pick.name : 'Zona';
  const slRaw = dir === 1 ? liqLevel - buf : liqLevel + buf;

  let risk = Math.abs(entry - slRaw);
  const maxRisk = DAY_MAX_RISK_ATR * atrVal;
  const capped = risk > maxRisk;
  if (capped) risk = maxRisk;
  risk = Math.max(risk, slFloor('day', ctx));

  const sl = entry - dir * risk;
  const tps = rrList.map(m => entry + dir * risk * m);

  return {
    dir, entry, sl, risk, tps,
    label: `${dir === 1 ? 'Buy' : 'Sell'} Limit · ${zone.tag} · SL di balik ${liqName}${capped ? ' (dibatasi)' : ''}`,
    zone: { min: zone.bottom, max: zone.top },
    liqLevel, liqName, tag: zone.tag,
    capped, strong: !!zone.strong,
  };
}

async function buildDayPlan({ m1, m5, m15, price, rrList, ctx }) {
  const t = tx(ctx);
  const { pip } = ctx;
  const atrM5 = atrOf(m5, pip);
  const maxDist = DAY_MAX_DIST_ATR * atrM5;
  const gap = 0.1 * atrM5;

  const biasM15 = analyzePureSMCStructure(m15);
  const dirM15 = biasM15.dir || emaBias(m15, 20);
  const dirM5 = analyzePureSMCStructure(m5).dir;
  const continuity = dirM5 !== 0 && dirM5 === dirM15;

  const rangeM5 = getRangeInfo(m5, 50);
  const mid = rangeM5 ? rangeM5.eq : price;
  const rangeInfoStr = rangeM5 && rangeM5.high > rangeM5.low
    ? `M5 Range Pos: ${(((price - rangeM5.low) / (rangeM5.high - rangeM5.low)) * 100).toFixed(1)}%`
    : '-';

  const liq = liquidityLevels(m5.slice(-120), atrM5);
  const onSide = (dir, z) => (dir === 1 ? z.top < price - gap : z.bottom > price + gap);

  const realZone = dir => {
    const strong = strongZoneList(m5, dir, price, atrM5, maxDist)
      .filter(z => onSide(dir, z))
      .map(s => ({ bottom: s.bottom, top: s.top, dist: s.dist, tag: `M5 Strong ${s.tag}`, strong: true }));
    if (strong.length) return strong.sort((a, b) => a.dist - b.dist)[0];

    const z = findSDZones(m5, dir, price, { dispAtr: DAY_ZONE_DISP_ATR, freshOnly: true })
      .filter(x => onSide(dir, x))
      .find(x => x.dist <= maxDist);
    return z ? { bottom: z.bottom, top: z.top, dist: z.dist, tag: 'M5 Zona', strong: false } : null;
  };

  const pullbackFvg = dir => {
    let best = null;
    for (const f of findRecentFVGs(m5, 30)) {
      if (f.dir !== dir) continue;
      const imp = m5[f.idx];
      if (!imp || Math.abs(imp.c - imp.o) < DAY_FVG_IMPULSE_ATR * atrM5) continue;
      if (dir === 1 && (f.hi >= mid || f.hi >= price - gap)) continue;
      if (dir === -1 && (f.lo <= mid || f.lo <= price + gap)) continue;
      const dist = dir === 1 ? price - f.hi : f.lo - price;
      if (dist > maxDist) continue;
      if (!best || dist < best.dist) {
        best = { bottom: f.lo, top: f.hi, dist, tag: 'M5 FVG Pullback', strong: false };
      }
    }
    return best;
  };

  const fallback = dir => {
    const lvl = dir === 1
      ? [...liq.eql, ...liq.swingLow].filter(p => p < price - gap).sort((a, b) => b - a)[0]
      : [...liq.eqh, ...liq.swingHigh].filter(p => p > price + gap).sort((a, b) => a - b)[0];
    if (lvl != null) {
      return { bottom: lvl - 0.1 * atrM5, top: lvl + 0.1 * atrM5, dist: Math.abs(price - lvl), tag: 'Swing', strong: false };
    }
    const p = dir === 1 ? price - atrM5 : price + atrM5;
    return { bottom: p - 0.1 * atrM5, top: p + 0.1 * atrM5, dist: atrM5, tag: 'ATR Pullback', strong: false };
  };

  const single = async (side, zone, confidence, note) => {
    const o = buildDayOrder(side, zone, liq, atrM5, ctx, rrList);
    const capNote = o.capped ? `SL dibatasi ${DAY_MAX_RISK_ATR} ATR M5 karena likuiditas terlalu jauh.` : '';
    return await planFromOrder(o, {
      ctx, kind: 'day', orderType: 'LIMIT',
      setup: `${side === 1 ? 'BUY' : 'SELL'} LIMIT (${zone.tag})`,
      chartContext: `M15 ${dirLabel(dirM15)}, M5 ${dirLabel(dirM5)} -> ${zone.tag} LIMIT`,
      timeframes: 'M1, M5, M15', rangeInfo: rangeInfoStr,
      head: t.headLine(t.title.day, side === 1 ? 'BUY' : 'SELL', 'LIMIT', ctx.symbol),
      lines: [note, capNote].filter(Boolean),
      confidence,
    });
  };

  if (continuity) {
    const side = dirM15;
    const fz = pullbackFvg(side);
    if (fz) return await single(side, fz, 'MEDIUM', `Kontinuitas: M5 dan M15 ${dirLabel(side)}. Pullback ke FVG M5, tanpa OCO.`);
    const z = realZone(side);
    if (z) return await single(side, z, z.strong ? 'HIGH' : 'MEDIUM', `Kontinuitas: M5 dan M15 ${dirLabel(side)}. Zona M5 searah tren, tanpa OCO.`);
    return await single(side, fallback(side), 'LOW', 'Kontinuitas tanpa zona M5 valid. Memakai zona cadangan, risiko lebih tinggi.');
  }

  const buyZ = realZone(1);
  const sellZ = realZone(-1);

  if (buyZ && sellZ) {
    const buyO = buildDayOrder(1, buyZ, liq, atrM5, ctx, rrList);
    const sellO = buildDayOrder(-1, sellZ, liq, atrM5, ctx, rrList);
    const both = buyZ.strong && sellZ.strong;
    const capNote = [buyO, sellO].some(o => o.capped) ? `SL dibatasi ${DAY_MAX_RISK_ATR} ATR M5.` : '';
    const fx = v => Number(Number(v).toFixed(ctx.dec));
    const manual = `OCO konservatif zona M5. BUY @ ${fx(buyO.entry)}, SELL @ ${fx(sellO.entry)}.${capNote ? ' ' + capNote : ''}`;
    return {
      plan: { isOCO: true, orders: [buyO, sellO], setup: `Konservatif OCO`, chartContext: `M15 ${dirLabel(dirM15)} -> OCO` },
      meta: { confidence: both ? 'HIGH' : 'MEDIUM', riskLabel: 'MEDIUM', reason: withPair(ctx.symbol, manual) },
    };
  }

  if (buyZ || sellZ) {
    const side = buyZ ? 1 : -1;
    const z = buyZ || sellZ;
    return await single(side, z, 'MEDIUM', `Hanya satu sisi zona M5 valid searah bias.`);
  }

  let side = dirM15;
  if (side === 0) side = fallback(1).dist <= fallback(-1).dist ? 1 : -1;
  return await single(side, fallback(side), 'LOW', 'Zona cadangan.');
}

async function buildIntradayPlan({ m5, m15, price, rrList, ctx }) {
  const t = tx(ctx);
  const { f, pip } = ctx;
  const h1 = aggregateCandles(m15, 60);
  const atrM5 = atrOf(m5, pip);
  const atrM15 = atrOf(m15, pip);
  const maxDist = INTRADAY_MAX_DIST_ATR * atrM15;

  const sH1 = analyzePureSMCStructure(h1);
  const sM15 = analyzePureSMCStructure(m15);
  const dH1 = sH1.dir || emaBias(h1, 20);
  const dM15 = sM15.dir || emaBias(m15, 20);
  const htfBias = dH1 !== 0 ? dH1 : dM15;

  if (htfBias === 0) return { plan: null, reason: 'Bias H1 & M15 netral.' };

  const z5 = findSDZones(m5, htfBias, price, { dispAtr: 0.8, freshOnly: true }).find(z => z.dist <= maxDist);
  if (!z5) return { plan: null, reason: 'Tidak ada zona fresh intraday.' };

  const entry = htfBias === 1 ? z5.top : z5.bottom;
  const sl = clampSL(htfBias, entry, z5.sl, 'intraday', ctx, atrM5);
  const tps = getStructuralTPs(m15, htfBias, entry, sl, 1.0);

  return await finalizePlan({
    dir: htfBias, entry, orderType: 'LIMIT', baseSL: z5.sl, kind: 'intraday', atrVal: atrM5, ctx, rrList,
    confidence: 'HIGH', setup: 'Intraday Trend Follow', zoneNote: 'Intraday Zone', zoneRange: { min: z5.bottom, max: z5.top },
    timeframes: 'M5, M15, H1', rangeInfo: '-', chartContext: 'Intraday Trend Follow',
    head: t.headLine(t.title.intraday, htfBias === 1 ? 'BUY' : 'SELL', 'LIMIT', ctx.symbol),
    lines: ['Trend intraday searah HTF.'], customTPs: tps
  });
}

async function buildSwingPlan({ m15, price, rrList, ctx }) {
  const t = tx(ctx);
  const { pip } = ctx;
  const h1 = aggregateCandles(m15, 60);
  const h4 = aggregateCandles(m15, 240);
  const d1 = aggregateCandles(m15, 1440);
  const atrM15 = atrOf(m15, pip);

  const biasD1 = analyzePureSMCStructure(d1);
  const biasH4 = analyzePureSMCStructure(h4);
  const biasH1 = analyzePureSMCStructure(h1);
  const htfBias = (biasD1.dir + biasH4.dir + biasH1.dir) >= 2 ? 1 : ((biasD1.dir + biasH4.dir + biasH1.dir) <= -2 ? -1 : 0);

  if (htfBias === 0) return { plan: null, reason: 'Bias makro swing tidak searah.' };

  const demand = findSDZones(m15, htfBias, price, { dispAtr: 0.8, freshOnly: true })[0] || null;
  if (!demand) return { plan: null, reason: 'Zona swing tidak ditemukan.' };

  const entry = htfBias === 1 ? demand.top : demand.bottom;
  const sl = demand.sl;
  const tps = getStructuralTPs(m15, htfBias, entry, sl, 1.0);

  return await finalizePlan({
    dir: htfBias, entry, orderType: 'LIMIT', baseSL: sl, kind: 'swing', atrVal: atrM15, ctx, rrList,
    confidence: 'HIGH', setup: 'Swing Position', zoneNote: 'Swing Zone', zoneRange: { min: demand.bottom, max: demand.top },
    timeframes: 'M15, H1, H4, D1', rangeInfo: '-', chartContext: 'Swing Position',
    head: t.headLine(t.title.swing, htfBias === 1 ? 'BUY' : 'SELL', 'LIMIT', ctx.symbol),
    lines: ['Swing positioning searah makro.'], customTPs: tps
  });
}

function toSignal(result, style, ctx) {
  const { dir, plan, meta } = result;
  const r = v => (v === 0 ? 0 : v < 0.001 ? Number(v).toFixed(8) : Number(Number(v).toFixed(ctx.dec)));
  const en = ctx.lang === 'en';
  const reasonText = withPair(ctx.symbol, meta.reason);

  if (plan && plan.isOCO) {
    const [buy, sell] = plan.orders;
    return {
      signal: 'OCO', mode: 'OCO_PENDING', orderType: 'OCO', orderLabel: `OCO`, status: 'PENDING',
      pendingEntries: [r(buy.entry), r(sell.entry)], setup: plan.setup, confidence: meta.confidence, risk: meta.riskLabel,
      reason: reasonText, chartContext: plan.chartContext,
      orders: plan.orders.map(o => ({
        signal: o.dir === 1 ? 'BUY' : 'SELL', orderType: 'LIMIT', entry: r(o.entry), sl: r(o.sl),
        tp1: o.tps[0] != null ? r(o.tps[0]) : null, zone: o.zone ? { min: r(o.zone.min), max: r(o.zone.max) } : null,
        setup: o.label, setupLabel: en ? style.labelEn : style.label,
      })),
    };
  }

  const tps = plan.tps;
  return {
    signal: dir === 1 ? 'BUY' : 'SELL', mode: plan.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET',
    orderType: plan.orderType, orderLabel: orderLabel(dir, plan.orderType), status: plan.status,
    entry: r(plan.entry), sl: r(plan.sl), tp1: tps[0] != null ? r(tps[0]) : null, tp2: tps[1] != null ? r(tps[1]) : null,
    tp3: tps[2] != null ? r(tps[2]) : null, tpCount: tps.length, zone: plan.zone ? { min: r(plan.zone.min), max: r(plan.zone.max) } : null,
    confidence: meta.confidence, risk: meta.riskLabel, setup: meta.setup, entryStyle: en ? style.entryStyleEn : style.entryStyle,
    setupLabel: en ? style.labelEn : style.label, reason: reasonText, chartContext: plan.chartContext,
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

    if (body.images && Array.isArray(body.images) && body.images.length > 0) {
      const access = await checkAccess(body.email);
      if (!access.ok) return res.status(403).json({ error: t[access.key] });
      const trial = await checkTrialLimit(body.email, access.status);
      if (!trial.ok) return res.status(403).json({ error: trial.msg });

      const visionRes = await getVisionSignal(body.images, lang);
      if (!visionRes.plan) return res.status(400).json({ error: visionRes.reason });
      return res.status(200).json({ ok: true, signal: visionRes.plan });
    }

    const symbol = resolveSymbol(body, req.query);
    if (!symbol) return res.status(400).json({ error: t.noPair(Object.keys(body).join(', ')) });

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
    const ctx = { symbol, dec, pip, gold, f: v => Number(Number(v).toFixed(dec)), prof, lang };

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
      return await getCandles(symbol, tf, need, price);
    };

    const [r1, r5, r15] = await Promise.all([
      pick(m1, '1m', needM1), pick(m5, '5m', needM5), pick(m15, '15m', needM15),
    ]);

    if (needM1) m1 = r1.candles;
    if (needM5) m5 = r5.candles;
    if (needM15) m15 = r15.candles;

    if (needM1) m1 = mergeLiveBar(m1, price, 1);
    if (needM5) m5 = mergeLiveBar(m5, price, 5);
    if (needM15) m15 = mergeLiveBar(m15, price, 15);

    const rrList = styleCfg.rr;
    let result = { plan: null, reason: t.notProcessed };
    let liveSteps = [];
    const recentSL = Array.isArray(body.recentSL) ? body.recentSL : [];

    if (style === 'Scalping') {
      liveSteps = [`Cek Tren EMA & Filter Ranging`, `Cek Pullback Searah EMA`, `Cek Trigger M1 & Sesi`, `Eksekusi NOW`];
      result = await buildScalpPlan({ m1, m5, m15, price, rrList, ctx, recentSL });
    } else if (style === 'Day Trading') {
      liveSteps = [`Strong Zone M5/M1`, `Validasi Likuiditas`, `Day Plan`];
      result = await buildDayPlan({ m1, m5, m15, price, rrList, ctx });
    } else if (style === 'Intraday') {
      liveSteps = [`Bias H1/M15`, `Zona M5/M15`];
      result = await buildIntradayPlan({ m5, m15, price, rrList, ctx });
    } else if (style === 'Swing') {
      liveSteps = [`Bias Makro D1/H4`, `Zona M15`];
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
