// api/generate.js
// v54 (Day Trading: Scalping Konservatif - Fresh FVG/OB Retest)
//  - Scalping: Market Execution (NOW), FVG M1-M5.
//  - Day Trading: Konsep Scalping Konservatif. Menunggu retest FVG/OB baru (fresh) di M15 akibat BOS. Limit Order.
//  - Intraday: Area S/D H1 + Refine M15. 2 arah.
//  - Swing: Area S/D H4 + Refine H1.
//  - Integrasi AI GutsAI (DeepSeek) untuk narasi reasoning SMC/ICT.

export const config = { api: { bodyParser: { sizeLimit: '6mb' } } };

const KV_KEY = 'alu_clients';
const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

// ── AI CONFIG ──
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AI_MODEL = 'deepseek-v4.1-flash-uncensored'; // <-- SUDAH DIGANTI KE UNCENSORED

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

// ── PROFIL PER PAIR ──
// Setiap pair dihitung dari ATR, pip, dan strukturnya sendiri. Profil kelas hanya mengatur default.
const MAX_SRC_DEVIATION = 0.05; // candle sumber harus dekat harga live (5%), kalau tidak dibuang

const pairClassOf = symbol => {
  if (isGold(symbol)) return 'gold';
  if (['XAGUSD', 'XPTUSD', 'XPDUSD'].includes(symbol)) return 'metal';
  if (CRYPTO_LIST.includes(symbol) || symbol.endsWith('BTC')) return 'crypto';
  if (['US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'JPN225', 'FRA40', 'AUS200'].includes(symbol)) return 'index';
  if (['BRENT', 'WTI', 'NATGAS', 'COPPER', 'COFFEE', 'SUGAR'].includes(symbol)) return 'commodity';
  if (symbol.includes('JPY')) return 'fx_jpy';
  return 'fx';
};

const PAIR_CLASS_PROFILE = {
  gold:      { label: 'Emas',      structTf: 'M1', zoneTf: 'M5', zoneDisp: 0.8, nearAtr: 0.5, slMul: 1.0, bufAtr: 0.2,  range: [100, 50000] },
  metal:     { label: 'Logam',     structTf: 'M5', zoneTf: 'M5', zoneDisp: 0.9, nearAtr: 0.6, slMul: 1.1, bufAtr: 0.25, range: [0.5, 50000] },
  fx:        { label: 'Forex',     structTf: 'M5', zoneTf: 'M5', zoneDisp: 0.8, nearAtr: 0.6, slMul: 1.0, bufAtr: 0.2,  range: [0.00001, 50000] },
  fx_jpy:    { label: 'Forex JPY', structTf: 'M5', zoneTf: 'M5', zoneDisp: 0.8, nearAtr: 0.6, slMul: 1.0, bufAtr: 0.2,  range: [0.01, 100000] },
  index:     { label: 'Indeks',    structTf: 'M5', zoneTf: 'M5', zoneDisp: 0.9, nearAtr: 0.6, slMul: 1.1, bufAtr: 0.25, range: [100, 500000] },
  commodity: { label: 'Komoditas', structTf: 'M5', zoneTf: 'M5', zoneDisp: 0.9, nearAtr: 0.7, slMul: 1.2, bufAtr: 0.25, range: [0.1, 100000] },
  crypto:    { label: 'Kripto',    structTf: 'M5', zoneTf: 'M5', zoneDisp: 1.0, nearAtr: 0.8, slMul: 1.3, bufAtr: 0.3,  range: [0.00001, 5000000] },
};

// Override khusus per pair. Isi hanya jika satu pair perlu angka sendiri.
const PAIR_OVERRIDE = {
  // BTCUSD: { slMul: 1.4 },
  // EURUSD: { nearAtr: 0.5 },
};

const pairProfile = symbol => {
  const cls = pairClassOf(symbol);
  return { cls, ...PAIR_CLASS_PROFILE[cls], ...(PAIR_OVERRIDE[symbol] || {}) };
};

// Ukuran 1 pip per instrumen. Di luar daftar ini: 10^-(desimal-1), misalnya EURUSD 0.0001, USDJPY 0.01.
const PIP_OVERRIDE = {
  XAUUSD: 0.1, XAUUSDX: 0.1, DXY: 0.01, ETHUSD: 0.1,
  US30: 1, NAS100: 1, SPX500: 1, GER40: 1, UK100: 1, JPN225: 1, FRA40: 1, AUS200: 1, BTCUSD: 1,
};
const pipSizeOf = (symbol, dec) => PIP_OVERRIDE[symbol] ?? Math.pow(10, -(dec - 1));

const STYLES = {
  'Scalping': {
    label: 'Scalping · Area S/D M5 + NOW (struktur M1 untuk XAUUSD, M5 untuk pair lain) · SL structure · TP 1:1 · 1:2 · 1:3',
    entryStyle: 'Agresif', mode: 'MARKET', kind: 'scalp', rr: [1.0, 2.0, 3.0],
  },
  'Day Trading': {
    // Ubah label dan RR untuk Scalping Konservatif
    label: 'Day Trading · Scalping Konservatif · Retest FVG/OB M15',
    entryStyle: 'Konservatif', mode: 'LIMIT', kind: 'day', rr: [1.0, 1.5, 2.0],
  },
  'Intraday': {
    label: 'Intraday · Area S/D H1 + Refine M15 · 2 arah · 1 signal per hari · TP 1:1 · 1:2 · 1:3',
    entryStyle: 'Moderat', mode: 'LIMIT', kind: 'intraday', rr: [1.0, 2.0, 3.0],
  },
  'Swing': {
    label: 'Swing · Area S/D H4 + Refine H1 · Limit/NOW · TP 1:3',
    entryStyle: 'Positioning', mode: 'LIMIT', kind: 'swing', rr: [3.0],
  },
};

// ── Jumlah candle dan batas minimum ──
const NEED = { m1: 160, m5: 120, m15: 480 };
const MIN_BARS = { m1: 100, m5: 40, m15: 120, m15Swing: 400 };

// ── Struktur dan BOS ──
const SCALP_PIVOT = 2;
const DAY_PIVOT = 3;
const DAY_BOS_LOOKBACK = 60;
const DAY_OB_LOOKBACK = 12;

// ── Bollinger ──
const BB_PERIOD = 20;
const BB_MULT = 2;
const BAND_TOL_PIPS = 10;   // toleransi limit terhadap band (dipakai untuk pair dengan pip)
const BAND_TOL_ATR = 0.2;   // toleransi limit terhadap band (pair tanpa batas pip, dalam kelipatan ATR)

// ── Zona Supply/Demand (default) ──
const ZONE_ATR_PERIOD = 14;
const ZONE_DISP_ATR = 1.2;
const ZONE_MAX_ATR = 2.5;
const ZONE_REQUIRE_FVG = false;
const ZONE_FRESH_ONLY = true;

// ── Scalping ──
const SCALP_ZONE_LOOKBACK_M5 = 60;      // area M5 harus terbentuk dalam 60 candle M5 terakhir
const SCALP_ZONE_DISP_ATR = 0.8;        // displacement scalping M5: body minimal 0.8 × ATR
const SCALP_ZONE_FRESH_ONLY = true;     // true = area yang sudah pernah tersentuh dibuang
const SCALP_ZONE_NEEDS_CONFIRM = false; // true = tunggu reaksi (pullback selesai lalu tembus) dulu
const SCALP_ZONE_REQUIRE_BIAS = false;  // true = demand hanya jika bias M5 bullish, supply jika bearish
const SCALP_NEAR_ZONE_PIPS = 15;        // area berlawanan dalam 15 pip → peringatan
const SCALP_CHASE_MAX_PIPS = 15;        // dipakai hanya jika SCALP_ZONE_NEEDS_CONFIRM = true
const scalpZoneOpts = { dispAtr: SCALP_ZONE_DISP_ATR, freshOnly: SCALP_ZONE_FRESH_ONLY };

// ── SL: XAUUSD dalam pip, pair lain dalam kelipatan ATR ──
const GOLD_SL_PIPS = { scalp: [25, 30], day: [50, 120], intraday: [80, 200], swing: [150, 300] };
const SL_BUFFER_PIPS = { scalp: 3, day: 5, intraday: 10, swing: 15 };
const ATR_SL_MULT = { scalp: [0.5, 2.5], day: [1, 3], intraday: [1, 3], swing: [0.5, 2] };
const SL_BUFFER_ATR = 0.2;

const orderLabel = (dir, orderType) => `${dir === 1 ? 'BUY' : 'SELL'} ${orderType === 'LIMIT' ? 'LIMIT' : 'NOW'}`;
const isoDate = d => d.toISOString().slice(0, 10);
const wibDate = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lastClosePrice = arr => (arr && arr.length ? arr[arr.length - 1].c : 0);

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
  try {
    const raw = await kv(['GET', key]);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function kvSetJSON(key, value, ttl) {
  try { await kv(['SET', key, JSON.stringify(value), 'EX', ttl]); } catch (e) {}
}

async function checkAccess(email) {
  if (!email) return { ok: false, msg: 'Sesi tidak punya email.' };
  try {
    const raw = await kv(['GET', KV_KEY]);
    if (!raw) return { ok: true };
    const clients = JSON.parse(raw);
    const c = clients.find(x => x.email === email);
    if (!c) return { ok: false, msg: 'Email tidak terdaftar.' };
    if (new Date(c.expires_at) <= new Date()) return { ok: false, msg: 'Masa aktif habis.' };
  } catch (e) {}
  return { ok: true };
}

// FIX: Menambahkan konversi USD ke USDT untuk Crypto agar TickerLayer bisa membaca datanya
function mapSymbolToTickerLayer(symbol) {
  const s = symbol.toUpperCase().trim();
  if (CRYPTO_LIST.includes(s)) {
    // TickerLayer umumnya pakai USDT untuk Crypto (contoh: BTCUSD -> BTCUSDT)
    if (s.endsWith('USD')) {
      return { asset: 'crypto', symbol: s.replace('USD', 'USDT') };
    }
    return { asset: 'crypto', symbol: s };
  }
  if (s === 'US30' || s === 'SPX500') return { asset: 'stocks', symbol: `US:${s}` };
  if (s === 'NAS100') return { asset: 'stocks', symbol: 'US:NDX' };
  if (s.includes('XAU') || s.includes('XAG')) return { asset: 'forex', symbol: s };
  return { asset: 'forex', symbol: s };
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
      if ((r.status === 429 || r.status === 401 || r.status === 403) && retry === 0) {
        await sleep(1000);
        continue;
      }
      break;
    }
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;
    attempts++;
  }
  return { response: await fetch(url, { method: 'GET', headers: { 'x-api-key': keys[0], 'Content-Type': 'application/json' } }), keyIndex: 0 };
}

// Hanya 1m, 5m, dan 15m yang diambil dari TickerLayer. H1 dan H4 dibentuk dari M15.
const TL_SPAN = {
  '1m':  { mult: 1,  span: 'minute', minutes: 1 },
  '5m':  { mult: 5,  span: 'minute', minutes: 5 },
  '15m': { mult: 15, span: 'minute', minutes: 15 },
};
const CACHE_TTL = { '1m': 120, '5m': 300, '15m': 600 };
const CACHE_BARS = { '1m': 300, '5m': 300, '15m': 600 };

async function fetchTickerLayerOHLC(symbol, interval, apiKey, need) {
  const out = { rows: [] };
  const tf = TL_SPAN[interval];
  if (!tf) return out;
  const mapped = mapSymbolToTickerLayer(symbol);
  const now = Date.now();
  const startMs = now - Math.ceil(need * 1.2 * tf.minutes * 60000) - 86400000;
  const byT = new Map();
  const url = `${TICKERLAYER_BASE_URL}/${mapped.asset}/agg/${mapped.symbol}/${tf.mult}/${tf.span}/${isoDate(new Date(startMs))}/${isoDate(new Date(now + 86400000))}?sort=asc&limit=5000`;
  try {
    const { response } = await tlFetch(url, apiKey);
    if (response.ok) {
      const data = await response.json();
      const rows = Array.isArray(data) ? data : (data.results || []);
      for (const c of rows) {
        const cand = { t: Number(c.t || 0), o: Number(c.o || 0), h: Number(c.h || 0), l: Number(c.l || 0), c: Number(c.c || 0) };
        if (cand.t > 0 && [cand.o, cand.h, cand.l, cand.c].every(Number.isFinite)) byT.set(cand.t, cand);
      }
    }
  } catch (err) {}
  out.rows = [...byT.values()].sort((a, b) => a.t - b.t).slice(-Math.max(1, Math.ceil(need)));
  return out;
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
  if (last.t === bucket) {
    last.h = Math.max(last.h, price);
    last.l = Math.min(last.l, price);
    last.c = price;
  } else if (last.t < bucket) {
    const o = last.c;
    candles.push({ t: bucket, o, h: Math.max(o, price), l: Math.min(o, price), c: price });
  }
  return candles;
}

// Bangun candle berjangka tfMin menit dari candle yang lebih kecil (M1→M5, M15→H1, M15→H4)
function aggregateCandles(candles, tfMin) {
  const ms = tfMin * 60000;
  const map = new Map();
  for (const c of candles) {
    const key = Math.floor(c.t / ms) * ms;
    const b = map.get(key);
    if (!b) map.set(key, { t: key, o: c.o, h: c.h, l: c.l, c: c.c });
    else {
      b.h = Math.max(b.h, c.h);
      b.l = Math.min(b.l, c.l);
      b.c = c.c;
    }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

async function getCandles(symbol, tf, need, apiKey) {
  const cacheKey = `candles_${symbol}_${tf}`;
  const cached = await kvGetJSON(cacheKey);
  if (Array.isArray(cached) && cached.length >= need) return { candles: cached };
  const nat = await fetchTickerLayerOHLC(symbol, tf, apiKey, need);
  if (nat.rows.length) await kvSetJSON(cacheKey, nat.rows.slice(-CACHE_BARS[tf]), CACHE_TTL[tf]);
  return { candles: nat.rows };
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

function bollingerAt(candles, idx, period = BB_PERIOD, mult = BB_MULT) {
  if (idx < period - 1 || idx >= candles.length) return null;
  const closes = candles.slice(idx - period + 1, idx + 1).map(c => c.c);
  const mid = closes.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(closes.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
  return { mid, upper: mid + mult * sd, lower: mid - mult * sd };
}

function analyzePureSMCStructure(candles) {
  if (!candles || candles.length < 15) return { dir: 1, src: 'Default' };
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
  return { dir: lastC >= candles[candles.length - 2].c ? 1 : -1, src: 'Mitigasi FVG / Inducement' };
}

function structureBias(candles, L) {
  const { highs, lows } = findPivots(candles, L);
  if (highs.length < 2 || lows.length < 2) return { dir: 0, src: 'struktur belum terbentuk' };
  const [h1, h2] = highs.slice(-2);
  const [l1, l2] = lows.slice(-2);
  const c = candles[candles.length - 1].c;
  if (c > h2.p) return { dir: 1, src: 'BOS bullish' };
  if (c < l2.p) return { dir: -1, src: 'BOS bearish' };
  if (h2.p > h1.p && l2.p > l1.p) return { dir: 1, src: 'HH + HL' };
  if (h2.p < h1.p && l2.p < l1.p) return { dir: -1, src: 'LH + LL' };
  return { dir: 0, src: 'belum jelas' };
}

function findLastBOS(candles, L) {
  const { highs, lows } = findPivots(candles, L);
  const from = Math.max(L + 1, candles.length - DAY_BOS_LOOKBACK);
  for (let j = candles.length - 1; j >= from; j--) {
    const c = candles[j].c;
    const prevC = candles[j - 1].c;
    const sh = highs.filter(h => h.i + L <= j).pop();
    const sl = lows.filter(l => l.i + L <= j).pop();
    if (sh && prevC <= sh.p && c > sh.p) return { dir: 1, idx: j, level: sh.p };
    if (sl && prevC >= sl.p && c < sl.p) return { dir: -1, idx: j, level: sl.p };
  }
  return null;
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
    const top = Math.max(bc.o, bc.c);
    const bottom = Math.min(bc.o, bc.c);
    const sl = dir === 1 ? bc.l : bc.h;
    if (Math.abs(top - sl) > ZONE_MAX_ATR * a) continue;
    if (!isBOSAfter(candles, base, k, dir)) continue;

    const fvgNow = dir === 1 ? candles[k - 1].h < candles[k + 1].l : candles[k - 1].l > candles[k + 1].h;
    if (ZONE_REQUIRE_FVG && !fvgNow) continue;

    const after = candles.slice(k + 1, n - 1);
    if (after.some(x => (dir === 1 ? x.c < sl : x.c > sl))) continue;
    const fresh = !after.some(x => (dir === 1 ? x.l <= top : x.h >= bottom));
    if (freshOnly && !fresh) continue;

    if (dir === 1 && (bottom > price || price < sl)) continue;
    if (dir === -1 && (top < price || price > sl)) continue;

    const dist = dir === 1 ? Math.max(0, price - top) : Math.max(0, bottom - price);
    zones.push({ top, bottom, sl, idx: base, dispIdx: k, dist, strength: Math.abs(d.c - d.o) / a, fvg: fvgNow, fresh });
  }
  return zones.sort((x, y) => x.dist - y.dist);
}

function pickZone(candles, dir, price, L, extra = () => true) {
  const n = candles.length;
  const ok = z => z.dispIdx >= n - L && extra(z);
  const strict = findSDZones(candles, dir, price).filter(ok)[0];
  if (strict) return strict;
  return findSDZones(candles, dir, price, { dispAtr: 0.6, freshOnly: false }).filter(ok)[0] || null;
}

function refineZone(lower, parent, dir, price, L) {
  return pickZone(lower, dir, price, L, z => z.top >= parent.bottom && z.bottom <= parent.top);
}

function swingArea(candles, dir, L) {
  const s = candles.slice(-L);
  const lvl = dir === 1 ? Math.min(...s.map(c => c.l)) : Math.max(...s.map(c => c.h));
  return { top: lvl, bottom: lvl, sl: lvl, idx: -1, dispIdx: -1, dist: 0 };
}

function pickM15Area(m15, bos, price) {
  const zones = findSDZones(m15, bos.dir, price)
    .filter(z => z.dispIdx >= bos.idx - DAY_OB_LOOKBACK && z.dispIdx <= bos.idx);
  return zones[0] || null;
}

function recentExtreme(candles, dir, bars) {
  const s = candles.slice(-(bars + 1));
  return dir === 1 ? Math.min(...s.map(c => c.l)) : Math.max(...s.map(c => c.h));
}

function areaNote(m5c, price, ctx) {
  const { f, pip } = ctx;
  const recent = z => z.dispIdx >= m5c.length - SCALP_ZONE_LOOKBACK_M5;
  const sup = findSDZones(m5c, -1, price, scalpZoneOpts).filter(recent)[0];
  const dem = findSDZones(m5c, 1, price, scalpZoneOpts).filter(recent)[0];
  const parts = [];
  if (sup) {
    const d = sup.dist === 0 ? 'sudah di dalam' : `${(sup.dist / pip).toFixed(0)} pip di atas`;
    parts.push(`supply ${f(sup.bottom)} - ${f(sup.top)} (${d})`);
  }
  if (dem) {
    const d = dem.dist === 0 ? 'sudah di dalam' : `${(dem.dist / pip).toFixed(0)} pip di bawah`;
    parts.push(`demand ${f(dem.bottom)} - ${f(dem.top)} (${d})`);
  }
  return parts.length
    ? `Area M5 terdekat: ${parts.join(', ')}`
    : `Tidak ada area S/D M5 valid dalam ${SCALP_ZONE_LOOKBACK_M5} candle terakhir`;
}

function m1Reaction(struct, dir, price, ctx) {
  const { f, pip } = ctx;
  const { highs, lows } = findPivots(struct, SCALP_PIVOT);
  if (!highs.length || !lows.length) return { ok: false, why: 'struktur belum terbentuk' };
  const lastH = highs[highs.length - 1];
  const lastL = lows[lows.length - 1];
  let breakLevel = null;
  if (dir === 1 && lastL.i > lastH.i) breakLevel = lastH.p;
  else if (dir === -1 && lastH.i > lastL.i) breakLevel = lastL.p;
  if (breakLevel == null) return { ok: false, why: 'pullback belum selesai' };
  const beyond = ((price - breakLevel) * dir) / pip;
  if (beyond <= 0) return { ok: false, why: `menunggu menembus ${f(breakLevel)}` };
  if (beyond > SCALP_CHASE_MAX_PIPS) return { ok: false, why: `harga ${beyond.toFixed(0)} pip melewati ${f(breakLevel)}, tidak dikejar` };
  return { ok: true, breakLevel };
}

function findRefineTrigger(candles, dir) {
  const n = candles.length;
  const cur = candles[n - 1];
  const prev = candles[n - 2];
  const bbCur = bollingerAt(candles, n - 1);
  const bbPrev = bollingerAt(candles, n - 2);
  if (!bbCur || !bbPrev) return null;

  if (dir === 1 && prev.l <= bbPrev.mid && cur.c > bbCur.mid && cur.c > cur.o) {
    const strong = prev.l <= bbPrev.lower;
    return { strong, setup: strong ? 'BB Lower Band Reclaim' : 'BB Middle Band Pullback' };
  }
  if (dir === -1 && prev.h >= bbPrev.mid && cur.c < bbCur.mid && cur.c < cur.o) {
    const strong = prev.h >= bbPrev.upper;
    return { strong, setup: strong ? 'BB Upper Band Reject' : 'BB Middle Band Pullback' };
  }
  return null;
}

function slBounds(kind, ctx, atrVal) {
  if (ctx.gold) {
    const [a, b] = GOLD_SL_PIPS[kind];
    return { min: a * ctx.pip, max: b * ctx.pip };
  }
  const [a, b] = ATR_SL_MULT[kind];
  return { min: a * ctx.prof.slMul * atrVal, max: b * ctx.prof.slMul * atrVal };
}

// ── AI REASONING FUNCTION ──
const KIND_NAME = {
  scalp: 'Scalping (Agresif)',
  day: 'Day Trade (Konservatif)',
  intraday: 'Intraday (Moderat)',
  swing: 'Swing (Positioning)',
};

async function getAIReasoning({ ctx, dir, kind, orderType, entry, sl, tps, setup, rawReason, riskPips }) {
  if (!OPENAI_API_KEY) return null;
  const { symbol, dec, prof } = ctx;
  const p = v => Number(v).toFixed(dec);

  const prompt = `
Anda adalah "Alu Signal Z", trader SMC/ICT. Tulis 1 paragraf (maks 400 karakter, bahasa Indonesia, tegas) yang menjelaskan MENGAPA entry ini diambil. Gunakan HANYA data di bawah.

=== ATURAN ===
1. Pair yang dibahas hanya ${symbol} (${prof.label}). Jangan menyebut pair lain, emas, atau XAUUSD kecuali pair ini memang XAUUSD.
2. Timeframe yang boleh disebut: struktur ${prof.structTf}, zona ${prof.zoneTf}, dan TF lain hanya jika tertulis di DATA.
3. Gunakan istilah: Order Block, FVG, BOS, CHoCH, Liquidity Sweep, Premium/Discount, Inducement, Displacement, Supply/Demand. Jangan pakai RSI, MACD, MA, atau S/R klasik.
4. Bollinger Band hanya disebut jika tertulis di DATA, dan sebut apa adanya.
5. Jika tidak ada setup yang jelas, tulis bahwa market sedang ranging/equilibrium.
6. Jangan mengarang berita fundamental.

=== DATA ===
- Pair: ${symbol} | Kelas: ${prof.label} | Desimal: ${dec}
- Sinyal: ${dir === 1 ? 'BUY' : 'SELL'} | Gaya: ${KIND_NAME[kind] || kind} | Order: ${orderType}
- Entry: ${p(entry)} | SL: ${p(sl)} (${riskPips.toFixed(1)} pip)
- TP: ${tps.map(p).join(', ')}
- Setup: ${setup}
- Data mentah: ${rawReason}
`;

  try {
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'Anda adalah AI analis trading SMC/ICT yang objektif, dingin, dan presisi.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 200,
        temperature: 0.1, // Suhu rendah agar AI sangat patuh pada aturan SMC
      })
    });

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('AI Error:', err.message);
    return null;
  }
}

async function finalizePlan({ dir, entry, orderType, baseSL, kind, atrVal, ctx, rrList, confidence, setup, zoneNote, zoneRange, head, lines }) {
  const { f, pip, gold, prof } = ctx;
  const b = slBounds(kind, ctx, atrVal);
  const buf = gold ? SL_BUFFER_PIPS[kind] * pip : prof.bufAtr * atrVal;
  let raw = Math.abs(entry - baseSL) + buf;
  if ((dir === 1 && baseSL >= entry) || (dir === -1 && baseSL <= entry)) raw = b.min;
  const risk = Math.min(Math.max(raw, b.min), b.max);
  const sl = entry - dir * risk;
  const tps = rrList.map(x => entry + dir * x * risk);
  const slNote = raw > b.max
    ? `SL dibatasi ${(b.max / pip).toFixed(0)} pip, struktur lebih lebar (${(raw / pip).toFixed(0)} pip)`
    : '';
  const parts = [
    head,
    ...lines,
    slNote,
    `Entry ${f(entry)}, SL (${(risk / pip).toFixed(0)} pip) di ${f(sl)}`,
    rrList.map((x, i) => `TP${i + 1} 1:${x}`).join(', '),
  ].filter(Boolean);
  const manualReason = parts.map(s => s.replace(/\.?$/, '.')).join(' • ');

  // Panggil AI
  const aiReason = await getAIReasoning({
    ctx, dir, kind, orderType, entry, sl, tps, setup,
    rawReason: manualReason, riskPips: risk / pip,
  });

  return {
    dir,
    plan: {
      kind,
      orderType,
      status: orderType === 'LIMIT' ? 'PENDING' : 'RUNNING',
      entry,
      bufferEnd: entry,
      sl,
      tps,
      zone: zoneRange || null,
      expireMs: 0,
      zoneNote,
    },
    meta: { confidence, riskLabel: 'MEDIUM', setup, reason: aiReason || manualReason },
  };
}

async function buildAreaPlan({ title, area, dir, price, refineC, refineName, kind, atrVal, ctx, areaName, rrList, lines }) {
  const { f, pip, gold, symbol } = ctx;
  const tol = gold ? BAND_TOL_PIPS * pip : BAND_TOL_ATR * atrVal;
  const broken = dir === 1 ? price <= area.sl : price >= area.sl;
  const inArea = dir === 1 ? price <= area.top : price >= area.bottom;
  const trig = findRefineTrigger(refineC, dir);
  const bb = bollingerAt(refineC, refineC.length - 1);
  const notes = [...lines];
  let orderType, entry, baseSL, confidence, setup;

  if (broken) {
    orderType = 'NOW';
    entry = price;
    baseSL = recentExtreme(refineC, dir, 20);
    confidence = 'MEDIUM';
    setup = `${areaName} tertembus · NOW`;
    notes.push(`Harga sudah melewati ${areaName}, masuk NOW dengan SL dari struktur ${refineName} terakhir`);
  } else if (inArea) {
    orderType = 'NOW';
    entry = price;
    baseSL = area.sl;
    confidence = trig && trig.strong ? 'HIGH' : 'MEDIUM';
    setup = `${areaName} · ${trig ? trig.setup : 'belum ada konfirmasi BB'}`;
    notes.push(trig
      ? `Harga di ${areaName}, konfirmasi ${trig.setup} (${refineName})`
      : `Harga di ${areaName}, belum ada konfirmasi BB ${refineName}, hati-hati`);
  } else {
    orderType = 'LIMIT';
    entry = dir === 1 ? area.top : area.bottom;
    baseSL = area.sl;
    const dist = Math.abs(price - entry);
    const bandRef = bb ? (dir === 1 ? bb.lower : bb.upper) : null;
    const bandHit = bandRef != null && Math.abs(entry - bandRef) <= tol;
    confidence = bandHit ? 'HIGH' : 'MEDIUM';
    setup = `${areaName} · Limit`;
    notes.push(`Limit di tepi ${areaName} (${f(entry)}), ${(dist / pip).toFixed(0)} pip dari harga`);
    if (dist > 3 * atrVal) notes.push('Jarak limit cukup jauh, kemungkinan lama terisi');
    if (bandRef != null) {
      notes.push(`BB ${refineName}: limit ${bandHit ? 'bertemu' : 'belum bertemu'} ${dir === 1 ? 'lower' : 'upper'} band (${f(bandRef)})`);
    }
  }

  const head = `${title} ${dir === 1 ? 'BUY' : 'SELL'} ${orderType === 'LIMIT' ? 'LIMIT' : 'NOW'} pada ${symbol}`;
  return await finalizePlan({
    dir, entry, orderType, baseSL, kind, atrVal, ctx, rrList, confidence, setup,
    zoneNote: `${title} · ${areaName} · ${orderType}`,
    zoneRange: { min: area.bottom, max: area.top },
    head, lines: notes,
  });
}

// ═══════════════════════════ SCALPING ═══════════════════════════

async function buildScalpPlan({ m1, m5, price, rrList, ctx }) {
  const { f, pip, prof } = ctx;
  const tfName = prof.structTf;
  const struct = tfName === 'M1' ? m1 : m5;
  const m5c = tfName === 'M1' ? aggregateCandles(m1, 5).slice(0, -1) : m5.slice(0, -1);
  const atrVal = atrOf(m5c, pip);
  const nearDist = prof.nearAtr * atrVal; // jarak "dekat" dihitung dari volatilitas pair ini
  const zOpts = { dispAtr: prof.zoneDisp, freshOnly: SCALP_ZONE_FRESH_ONLY };
  const recent = z => z.dispIdx >= m5c.length - SCALP_ZONE_LOOKBACK_M5;

  // Zona terdekat di tiap sisi. dist = 0 berarti harga sudah di dalam zona.
  const demand = findSDZones(m5c, 1, price, zOpts).filter(recent)[0] || null;
  const supply = findSDZones(m5c, -1, price, zOpts).filter(recent)[0] || null;
  const pick = [
    demand && { z: demand, dir: 1 },
    supply && { z: supply, dir: -1 },
  ]
    .filter(c => c && c.z.dist <= nearDist)
    .sort((a, b) => a.z.dist - b.z.dist)[0] || null;

  const init = analyzePureSMCStructure(struct);
  const { highs, lows } = findPivots(struct, SCALP_PIVOT);
  const lastH = highs.length ? highs[highs.length - 1] : null;
  const lastL = lows.length ? lows[lows.length - 1] : null;

  const lines = [];
  let dir, orderType, entry, baseSL, zoneRange, confidence, setup;

  if (pick) {
    const { z } = pick;
    dir = pick.dir;
    const side = dir === 1 ? 'demand' : 'supply';
    const inside = z.dist === 0;
    orderType = inside ? 'NOW' : 'LIMIT';
    entry = inside ? price : (dir === 1 ? z.top : z.bottom);
    baseSL = z.sl;
    zoneRange = { min: z.bottom, max: z.top };
    lines.push(inside
      ? `Harga di dalam ${side} ${prof.zoneTf} ${f(z.bottom)} - ${f(z.top)}`
      : `Limit di tepi ${side} ${prof.zoneTf} (${f(entry)}), ${(z.dist / pip).toFixed(0)} pip dari harga`);
    lines.push(init.dir === dir
      ? `Arah ${tfName} ${init.src} searah`
      : `Hati-hati: arah ${tfName} ${init.src} berlawanan, reaksi belum terbukti`);
    confidence = init.dir === dir ? 'HIGH' : 'MEDIUM';
    setup = `Area S/D ${prof.zoneTf} ${side} · ${orderType}`;
  } else {
    dir = init.dir;
    orderType = 'NOW';
    entry = price;
    const pivot = dir === 1 ? lastL : lastH;
    const pivotOk = !!pivot && (dir === 1 ? pivot.p < price : pivot.p > price);
    baseSL = pivotOk ? pivot.p : recentExtreme(struct, dir, 10);
    zoneRange = { min: price, max: price };
    lines.push(`Di luar area S/D ${prof.zoneTf}, ikuti struktur ${tfName} (${init.src}) → Market Execution`);
    lines.push(areaNote(m5c, price, ctx));
    confidence = /BOS|Struktur/.test(init.src) ? 'HIGH' : 'MEDIUM';
    setup = `Market Execution (${init.src})`;
  }

  const opp = findSDZones(m5c, -dir, price, zOpts).filter(recent)[0];
  if (opp && opp.dist <= nearDist) {
    const oppName = dir === 1 ? 'supply' : 'demand';
    const distTxt = opp.dist === 0 ? 'sudah di dalam' : `${(opp.dist / pip).toFixed(0)} pip ${dir === 1 ? 'di atas' : 'di bawah'}`;
    lines.push(`Hati-hati, ada ${oppName} ${prof.zoneTf} ${f(opp.bottom)} - ${f(opp.top)} (${distTxt}), berpotensi menahan ${dir === 1 ? 'BUY' : 'SELL'}`);
  }

  return await finalizePlan({
    dir, entry, orderType, baseSL, kind: 'scalp', atrVal, ctx, rrList,
    confidence, setup, zoneNote: `Scalp · ${setup}`, zoneRange,
    head: `Scalping ${dir === 1 ? 'BUY' : 'SELL'} ${orderType === 'LIMIT' ? 'LIMIT' : 'NOW'} pada ${ctx.symbol}`,
    lines,
  });
}

// ═══════════════ DAY TRADING (SCALPING KONSERVATIF) ═══════════════

function evalSide(dir, o) {
  const { price, bias, parentPick, parentName, refineC, refineName, refineL, atrVal } = o;
  
  // Cari zona utama (M15)
  const parent = parentPick(dir);
  
  // Cari zona refine (M5) di dalam parent
  const refined = parent ? refineZone(refineC, parent, dir, price, refineL) : null;
  
  // Prioritaskan zona yang punya FVG dan FRESH
  let z = refined;
  if (!z) {
      const fvgZones = findSDZones(refineC, dir, price, { freshOnly: true, dispAtr: 0.8 })
          .filter(x => x.fvg);
      z = fvgZones[0] || pickZone(refineC, dir, price, refineL);
  }
  
  const side = dir === 1 ? 'Demand' : 'Supply';
  let area, areaName, refineNote, score = 0;

  if (z) {
    area = z;
    const zoneType = z.fvg ? 'FVG' : 'OB';
    areaName = `Zona ${side}/${zoneType} ${refineName}`;
    refineNote = refined ? `Refine ${refineName} di dalam area ${parentName}` : `Zona ${refineName} terdekat`;
  } else if (parent) {
    area = parent;
    const zoneType = parent.fvg ? 'FVG' : 'OB';
    areaName = `Zona ${side}/${zoneType} ${parentName}`;
    refineNote = `Refine ${refineName} belum ada, memakai area ${parentName}`;
  } else {
    area = swingArea(refineC, dir, 20);
    areaName = `Level swing ${refineName}`;
    refineNote = 'Area S/D belum ada, memakai swing terakhir';
    return { dir, area, areaName, refineNote, score: -1 };
  }

  // SCORING: Semakin dekat harga, semakin tinggi skor
  score += Math.max(0, 3 - (area.dist || 0) / atrVal);
  
  // Bonus besar jika FVG (sesuai request)
  if (area.fvg) score += 3;
  
  // Bonus jika searah bias
  if (dir === bias.dir) score += 2;
  
  // Bonus jika zona sangat fresh (belum tersentuh)
  if (area.fresh) score += 2;
  
  const trig = findRefineTrigger(refineC, dir);
  if (trig) score += trig.strong ? 1.5 : 1;
  
  return { dir, area, areaName, refineNote, score };
}

async function buildTwoWayPlan(o) {
  const { title, kind, price, ctx, rrList, bias, biasNote, refineC, refineName, atrVal } = o;
  const [best, other] = [evalSide(1, o), evalSide(-1, o)].sort((a, b) => b.score - a.score);
  const lines = [
    biasNote,
    best.refineNote,
    `Dua arah dinilai: ${best.dir === 1 ? 'BUY' : 'SELL'} skor ${best.score.toFixed(1)} vs ${other.dir === 1 ? 'BUY' : 'SELL'} ${other.score.toFixed(1)}`,
    best.dir !== bias.dir ? 'Counter-trend: zona lawan bias lebih kuat, risiko lebih tinggi' : '',
  ].filter(Boolean);
  return await buildAreaPlan({
    title, area: best.area, dir: best.dir, price, refineC, refineName,
    kind, atrVal, ctx, areaName: best.areaName, rrList, lines,
  });
}

async function buildDayPlan({ m5, m15, price, rrList, ctx }) {
  const bos = findLastBOS(m15, DAY_PIVOT);
  const init = analyzePureSMCStructure(m15);
  const bias = { dir: bos ? bos.dir : init.dir };
  const biasNote = bos
    ? `Bias M15: BOS ${bos.dir === 1 ? 'bullish' : 'bearish'} di ${ctx.f(bos.level)}`
    : `Bias M15: struktur ${init.src}`;
    
  const parentPick = d => {
      const zones15 = findSDZones(m15, d, price, { freshOnly: true, dispAtr: 0.8 });
      if (zones15.length > 0) return zones15[0];
      return pickZone(m15, d, price, 96);
  };

  return await buildTwoWayPlan({
    title: 'Day Trading (Scalping Konservatif)', 
    kind: 'day', 
    price, ctx, rrList, bias, biasNote,
    parentName: 'M15',
    parentPick: parentPick,
    refineC: m5, refineName: 'M5', refineL: 120, atrVal: atrOf(m15, ctx.pip),
  });
}

// ═══════════════════════════ INTRADAY & SWING ═══════════════════════════

async function buildIntradayPlan({ m15, price, rrList, ctx }) {
  const h1 = aggregateCandles(m15, 60);
  const bos = findLastBOS(h1, DAY_PIVOT);
  const init = analyzePureSMCStructure(h1);
  const bias = { dir: bos ? bos.dir : init.dir };
  const biasNote = bos
    ? `Bias H1: BOS ${bos.dir === 1 ? 'bullish' : 'bearish'} di ${ctx.f(bos.level)}`
    : `Bias H1: struktur ${init.src}`;
  return await buildTwoWayPlan({
    title: 'Intraday', kind: 'intraday', price, ctx, rrList, bias, biasNote,
    parentName: 'H1',
    parentPick: d => pickZone(h1, d, price, 72),
    refineC: m15, refineName: 'M15', refineL: 96, atrVal: atrOf(h1, ctx.pip),
  });
}

async function buildSwingPlan({ m15, price, rrList, ctx }) {
  const h4 = aggregateCandles(m15, 240);
  const h1 = aggregateCandles(m15, 60);
  const bos = findLastBOS(h4, DAY_PIVOT);
  const init = analyzePureSMCStructure(h4);
  const dir = bos ? bos.dir : init.dir;

  const area4 = pickZone(h4, dir, price, h4.length);
  const refined = area4 ? refineZone(h1, area4, dir, price, h1.length) : null;
  const z1 = refined || pickZone(h1, dir, price, h1.length);

  let area, areaName, refineNote;
  if (z1) {
    area = z1;
    areaName = 'Zona S/D H1';
    refineNote = refined ? 'Refine H1 berada di dalam area H4' : 'Refine H1 terdekat searah bias';
  } else if (area4) {
    area = area4;
    areaName = 'Zona S/D H4';
    refineNote = 'Refine H1 belum ada, memakai area H4';
  } else {
    area = swingArea(h1, dir, 20);
    areaName = 'Level swing H1';
    refineNote = 'Area S/D belum ada, memakai swing H1 terakhir';
  }

  const biasNote = bos
    ? `Bias H4: BOS ${dir === 1 ? 'bullish' : 'bearish'} di ${ctx.f(bos.level)}`
    : `Bias H4: struktur ${init.src}`;

  return await buildAreaPlan({
    title: 'Swing', area, dir, price, refineC: h1, refineName: 'H1',
    kind: 'swing', atrVal: atrOf(h4, ctx.pip), ctx, areaName, rrList,
    lines: [biasNote, refineNote],
  });
}

// ═══════════════════════════ OUTPUT ═══════════════════════════

function toSignal(result, style, ctx) {
  const { dir, plan, meta } = result;
  const r = v => Number(Number(v).toFixed(ctx.dec));
  const tps = plan.tps;
  const isLimit = plan.orderType === 'LIMIT';
  
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
    entryStyle: style.entryStyle,
    setupLabel: style.label,
    zoneLabel: isLimit ? 'Limit Entry Zone' : 'Market Execution Zone',
    zoneNote: plan.zoneNote,
    reason: meta.reason,
  };
}

// ═══════════════════════════ MAIN HANDLER ═══════════════════════════

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};

  // Pair wajib dikirim. Tidak ada default XAUUSD, karena fallback diam-diam itulah yang membuat semua pair terbaca sebagai emas.
  const symbol = String(body.symbol || body.pair || body.instrument || '').toUpperCase().trim();
  if (!DECIMALS[symbol]) {
    return res.status(400).json({ error: `Pair tidak dikenal: "${symbol || '(kosong)'}"` });
  }

  const styleKey = String(body.style || body.tradingStyle || 'Scalping').trim();
  const style = STYLES[styleKey] ? styleKey : 'Scalping';
  const styleCfg = STYLES[style];

  const access = await checkAccess(body.email);
  if (!access.ok) return res.status(403).json({ error: access.msg });

  const dec = DECIMALS[symbol];
  const pip = pipSizeOf(symbol, dec);
  const gold = isGold(symbol);
  const prof = pairProfile(symbol);
  const f = v => Number(Number(v).toFixed(dec));
  const ctx = { symbol, dec, pip, gold, f, prof };

  let apiKey = API_KEYS[0] || process.env.TICKERLAYER_API_KEY || '';

  // Mode Standar (Signal Generation)
  let m1 = cleanCandles(body.candles?.m1);
  let m5 = cleanCandles(body.candles?.m5);
  let m15 = cleanCandles(body.candles?.m15);

  let price = Number(body.currentPrice);
  if (!(price > 0)) price = lastClosePrice(m5) || lastClosePrice(m15) || lastClosePrice(m1);
  if (!(price > 0)) return res.status(400).json({ error: 'Harga saat ini belum tersedia.' });

  // Harga harus masuk rentang wajar pair ini. Ini menangkap kasus EURUSD dibaca sebagai XAUUSD.
  const [lo, hi] = prof.range;
  if (price < lo || price > hi) {
    return res.status(400).json({ error: `Harga ${price} di luar rentang wajar ${symbol} (${lo} - ${hi}).` });
  }

  // Candle frontend hanya dipakai jika close-nya cocok dengan harga live.
  const sameAsPrice = arr => arr.length > 0 && Math.abs(lastClosePrice(arr) - price) / price <= MAX_SRC_DEVIATION;
  if (!sameAsPrice(m1)) m1 = [];
  if (!sameAsPrice(m5)) m5 = [];
  if (!sameAsPrice(m15)) m15 = [];

  const needM1 = gold && style === 'Scalping' ? NEED.m1 : 0;
  const needM5 = style === 'Scalping' || style === 'Day Trading' ? NEED.m5 : 0;
  const needM15 = NEED.m15;

  if (needM1 && m1.length < needM1) m1 = (await getCandles(symbol, '1m', needM1, apiKey)).candles;
  if (needM5 && m5.length < needM5) m5 = (await getCandles(symbol, '5m', needM5, apiKey)).candles;
  if (m15.length < needM15) m15 = (await getCandles(symbol, '15m', needM15, apiKey)).candles;

  // Data dari sumber juga dicek. Lebih baik gagal daripada menghasilkan sinyal yang salah.
  if ((needM1 && !sameAsPrice(m1)) || (needM5 && !sameAsPrice(m5)) || !sameAsPrice(m15)) {
    return res.status(502).json({ error: `Data candle ${symbol} tidak tersedia atau tidak cocok dengan harga live.` });
  }

  if (needM1) m1 = mergeLiveBar(m1, price, 1);
  if (needM5) m5 = mergeLiveBar(m5, price, 5);
  m15 = mergeLiveBar(m15, price, 15);

  const rrList = styleCfg.rr;
  let result = { plan: null, reason: 'Belum diproses' };

  if (style === 'Scalping') {
    result = await buildScalpPlan({ m1, m5, price, rrList, ctx });
  } else if (style === 'Day Trading') {
    result = await buildDayPlan({ m5, m15, price, rrList, ctx });
  } else if (style === 'Intraday') {
    result = await buildIntradayPlan({ m15, price, rrList, ctx });
  } else if (style === 'Swing') {
    result = await buildSwingPlan({ m15, price, rrList, ctx });
  }

  if (!result.plan) {
    return res.status(200).json({ ok: false, reason: result.reason || 'Tidak ada setup yang valid saat ini.' });
  }

  const payload = toSignal(result, styleCfg, ctx);
  return res.status(200).json({ ok: true, signal: payload });
}
