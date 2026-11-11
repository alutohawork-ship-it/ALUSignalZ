// api/generate.js
// v52 (Cleaned - No Visual)
//  - Scalping:
//      · XAUUSD: struktur M1, area S/D M5 dibentuk dari candle M1. SL 25-30 pip dari struktur.
//      · Pair lain: struktur M5 dan area S/D M5 langsung. SL/TP mengikuti struktur, dibatasi ATR M5.
//      · Di dalam area demand M5 → BUY NOW, area supply M5 → SELL NOW
//      · Di luar area → NOW searah arah awal market (BOS → HH+HL/LH+LL → price action)
//  - Day Trading: BOS M15 (bias) → area M15 → refine M5. DUA ARAH: BUY dan SELL dinilai,
//      zona terkuat (Supply/Demand/OB/FVG) dipilih, tidak terkunci ke arah bias.
//  - Intraday: area S/D H1 → refine M15. DUA ARAH. Maksimal 1 signal per hari (WIB), disimpan di KV.
//  - Swing: area S/D H4 → refine H1. Selalu ada signal.
//  - Maping Zone: Mendukung mode 'zones' (SMC + ICT: OB, SND, FVG, SNR, QM).
//  - Pip per pair: XAUUSD 0.1; forex 10^-(desimal-1); indeks dan BTC 1 (lihat PIP_OVERRIDE).
//  - TickerLayer API Key Rotations terintegrasi utuh.

export const config = { api: { bodyParser: { sizeLimit: '6mb' } } };

const KV_KEY = 'alu_clients';
const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

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
    label: 'Day Trading · BOS M15 + Area M15 + Refine M5 · 2 arah · Limit/NOW · TP 1:1 · 1:1.5 · 1:2',
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

// ── Label zona per gaya (dipakai untuk Maping Zone) ──
const STYLE_ZONE_CFG = {
  'Scalping':    { label: 'Scalping agresif' },
  'Day Trading': { label: 'Day Trading konservatif' },
  'Intraday':    { label: 'Intraday moderat' },
  'Swing':       { label: 'Swing positioning' },
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

function mapSymbolToTickerLayer(symbol) {
  const s = symbol.toUpperCase().trim();
  if (CRYPTO_LIST.includes(s)) return { asset: 'crypto', symbol: s };
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
    return { dir: last.c >= prev.c ? 1 : -1, src: 'Price action' };
  }
  const [h1, h2] = highs.slice(-2);
  const [l1, l2] = lows.slice(-2);
  const lastC = candles[candles.length - 1].c;

  if (lastC > h2.p) return { dir: 1, src: 'BOS bullish' };
  if (lastC < l2.p) return { dir: -1, src: 'BOS bearish' };
  if (h2.p > h1.p && l2.p > l1.p) return { dir: 1, src: 'Struktur HH + HL' };
  if (h2.p < h1.p && l2.p < l1.p) return { dir: -1, src: 'Struktur LH + LL' };
  return { dir: lastC >= candles[candles.length - 2].c ? 1 : -1, src: 'Order flow' };
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
  return { min: a * atrVal, max: b * atrVal };
}

function finalizePlan({ dir, entry, orderType, baseSL, kind, atrVal, ctx, rrList, confidence, setup, zoneNote, zoneRange, head, lines }) {
  const { f, pip, gold } = ctx;
  const b = slBounds(kind, ctx, atrVal);
  const buf = gold ? SL_BUFFER_PIPS[kind] * pip : SL_BUFFER_ATR * atrVal;
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
  const reason = parts.map(s => s.replace(/\.?$/, '.')).join(' • ');

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
    meta: { confidence, riskLabel: 'MEDIUM', setup, reason },
  };
}

function buildAreaPlan({ title, area, dir, price, refineC, refineName, kind, atrVal, ctx, areaName, rrList, lines }) {
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
  return finalizePlan({
    dir, entry, orderType, baseSL, kind, atrVal, ctx, rrList, confidence, setup,
    zoneNote: `${title} · ${areaName} · ${orderType}`,
    zoneRange: { min: area.bottom, max: area.top },
    head, lines: notes,
  });
}

// ═══════════════════════════ SCALPING ═══════════════════════════

function buildScalpPlan({ m1, m5, price, rrList, ctx }) {
  const { f, pip, gold } = ctx;
  const struct = gold ? m1 : m5;
  const tfName = gold ? 'M1' : 'M5';
  const m5c = gold ? aggregateCandles(m1, 5).slice(0, -1) : m5.slice(0, -1);
  const recent = z => z.dispIdx >= m5c.length - SCALP_ZONE_LOOKBACK_M5;
  const inside = z => price >= z.bottom && price <= z.top;
  const demand = findSDZones(m5c, 1, price, scalpZoneOpts).filter(inside).filter(recent)[0] || null;
  const supply = demand ? null : (findSDZones(m5c, -1, price, scalpZoneOpts).filter(inside).filter(recent)[0] || null);
  const zone = demand || supply;

  const init = analyzePureSMCStructure(struct);
  const { highs, lows } = findPivots(struct, SCALP_PIVOT);
  const lastH = highs.length ? highs[highs.length - 1] : null;
  const lastL = lows.length ? lows[lows.length - 1] : null;
  const atrVal = atrOf(m5c, pip);

  const lines = [];
  let dir, baseSL, confidence, setup;

  if (zone) {
    dir = demand ? 1 : -1;
    const zoneTxt = `area ${dir === 1 ? 'demand' : 'supply'} M5 ${f(zone.bottom)} - ${f(zone.top)}`;

    if (SCALP_ZONE_REQUIRE_BIAS) {
      const b5 = structureBias(m5c, SCALP_PIVOT);
      if (b5.dir !== dir) {
        return { plan: null, reason: `Scalping: harga di ${zoneTxt}, tapi bias M5 ${b5.dir === 0 ? 'belum jelas' : (b5.dir === 1 ? 'bullish' : 'bearish')}, tidak diambil.` };
      }
    }
    if (SCALP_ZONE_NEEDS_CONFIRM) {
      const r = m1Reaction(struct, dir, price, ctx);
      if (!r.ok) return { plan: null, reason: `Scalping: harga di ${zoneTxt}, menunggu reaksi ${tfName} (${r.why}).` };
      lines.push(`Reaksi ${tfName} menembus ${f(r.breakLevel)}`);
    }

    baseSL = zone.sl;
    lines.push(`Harga di ${zoneTxt}`);
    lines.push(init.dir === dir
      ? `Arah ${tfName} ${init.src} searah`
      : `Hati-hati: arah ${tfName} ${init.src} berlawanan, reaksi belum terbukti`);
    confidence = init.dir === dir ? 'HIGH' : 'MEDIUM';
    setup = `Area S/D M5 ${dir === 1 ? 'demand' : 'supply'}`;
  } else {
    dir = init.dir;
    const pivot = dir === 1 ? lastL : lastH;
    const pivotOk = !!pivot && (dir === 1 ? pivot.p < price : pivot.p > price);
    baseSL = pivotOk ? pivot.p : recentExtreme(struct, dir, 10);
    lines.push(`Di luar area S/D M5, arah awal ${tfName} (${init.src}) → NOW`);
    lines.push(areaNote(m5c, price, ctx));
    confidence = /BOS|Struktur/.test(init.src) ? 'HIGH' : 'MEDIUM';
    setup = `Arah awal ${tfName} (NOW)`;
  }

  const opp = findSDZones(m5c, -dir, price, scalpZoneOpts).filter(recent)[0];
  if (opp && opp.dist <= SCALP_NEAR_ZONE_PIPS * pip) {
    const oppName = dir === 1 ? 'supply' : 'demand';
    const distTxt = opp.dist === 0 ? 'sudah di dalam' : `${(opp.dist / pip).toFixed(0)} pip ${dir === 1 ? 'di atas' : 'di bawah'}`;
    lines.push(`Hati-hati, ada ${oppName} M5 ${f(opp.bottom)} - ${f(opp.top)} (${distTxt}), berpotensi menahan ${dir === 1 ? 'BUY' : 'SELL'}`);
  }

  const refZone = zone || findSDZones(m5c, dir, price, scalpZoneOpts).filter(recent)[0] || null;
  return finalizePlan({
    dir, entry: price, orderType: 'NOW', baseSL, kind: 'scalp', atrVal, ctx, rrList,
    confidence, setup, zoneNote: `Scalp · ${setup}`,
    zoneRange: refZone ? { min: refZone.bottom, max: refZone.top } : null,
    head: `Scalping ${dir === 1 ? 'BUY' : 'SELL'} NOW pada ${ctx.symbol}`,
    lines,
  });
}

// ═══════════════ DAY TRADING & INTRADAY (DUA ARAH) ═══════════════

function evalSide(dir, o) {
  const { price, bias, parentPick, parentName, refineC, refineName, refineL, atrVal } = o;
  const parent = parentPick(dir);
  const refined = parent ? refineZone(refineC, parent, dir, price, refineL) : null;
  const z = refined || pickZone(refineC, dir, price, refineL);
  const side = dir === 1 ? 'Demand' : 'Supply';
  let area, areaName, refineNote, score = 0;

  if (z) {
    area = z;
    areaName = `Zona ${side}/OB ${refineName}${z.fvg ? ' + FVG' : ''}`;
    refineNote = refined ? `Refine ${refineName} di dalam area ${parentName}` : `Zona ${refineName} terdekat`;
  } else if (parent) {
    area = parent;
    areaName = `Zona ${side}/OB ${parentName}${parent.fvg ? ' + FVG' : ''}`;
    refineNote = `Refine ${refineName} belum ada, memakai area ${parentName}`;
  } else {
    area = swingArea(refineC, dir, 20);
    areaName = `Level swing ${refineName}`;
    refineNote = 'Area S/D belum ada, memakai swing terakhir';
    return { dir, area, areaName, refineNote, score: -1 };
  }

  score += Math.max(0, 3 - (area.dist || 0) / atrVal);
  if (dir === bias.dir) score += 2;
  if (refined) score += 2;
  score += Math.min(1.5, (area.strength || 0) / 2);
  if (area.fvg) score += 1.5;
  if (area.fresh) score += 1;
  const trig = findRefineTrigger(refineC, dir);
  if (trig) score += trig.strong ? 2.5 : 1.5;
  return { dir, area, areaName, refineNote, score };
}

function buildTwoWayPlan(o) {
  const { title, kind, price, ctx, rrList, bias, biasNote, refineC, refineName, atrVal } = o;
  const [best, other] = [evalSide(1, o), evalSide(-1, o)].sort((a, b) => b.score - a.score);
  const lines = [
    biasNote,
    best.refineNote,
    `Dua arah dinilai: ${best.dir === 1 ? 'BUY' : 'SELL'} skor ${best.score.toFixed(1)} vs ${other.dir === 1 ? 'BUY' : 'SELL'} ${other.score.toFixed(1)}`,
    best.dir !== bias.dir ? 'Counter-trend: zona lawan bias lebih kuat, risiko lebih tinggi' : '',
  ].filter(Boolean);
  return buildAreaPlan({
    title, area: best.area, dir: best.dir, price, refineC, refineName,
    kind, atrVal, ctx, areaName: best.areaName, rrList, lines,
  });
}

function buildDayPlan({ m5, m15, price, rrList, ctx }) {
  const bos = findLastBOS(m15, DAY_PIVOT);
  const init = analyzePureSMCStructure(m15);
  const bias = { dir: bos ? bos.dir : init.dir };
  const biasNote = bos
    ? `Bias M15: BOS ${bos.dir === 1 ? 'bullish' : 'bearish'} di ${ctx.f(bos.level)}`
    : `Bias M15: struktur ${init.src}`;
  return buildTwoWayPlan({
    title: 'Day Trading', kind: 'day', price, ctx, rrList, bias, biasNote,
    parentName: 'M15',
    parentPick: d => (bos && bos.dir === d ? pickM15Area(m15, bos, price) : null) || pickZone(m15, d, price, 96),
    refineC: m5, refineName: 'M5', refineL: 120, atrVal: atrOf(m15, ctx.pip),
  });
}

function buildIntradayPlan({ m15, price, rrList, ctx }) {
  const h1 = aggregateCandles(m15, 60);
  const bos = findLastBOS(h1, DAY_PIVOT);
  const init = analyzePureSMCStructure(h1);
  const bias = { dir: bos ? bos.dir : init.dir };
  const biasNote = bos
    ? `Bias H1: BOS ${bos.dir === 1 ? 'bullish' : 'bearish'} di ${ctx.f(bos.level)}`
    : `Bias H1: struktur ${init.src}`;
  return buildTwoWayPlan({
    title: 'Intraday', kind: 'intraday', price, ctx, rrList, bias, biasNote,
    parentName: 'H1',
    parentPick: d => pickZone(h1, d, price, 72),
    refineC: m15, refineName: 'M15', refineL: 96, atrVal: atrOf(h1, ctx.pip),
  });
}

// ═══════════════════════════ SWING ═══════════════════════════

function buildSwingPlan({ m15, price, rrList, ctx }) {
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

  return buildAreaPlan({
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
  return {
    signal: dir === 1 ? 'BUY' : 'SELL',
    mode: isLimit ? 'LIMIT' : 'MARKET',
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

// ═══════════════ MAPING ZONE (SMC + ICT: OB, SND, FVG, SNR, QM) ═══════════════

const MAP_PIVOT = { 'Scalping': 2, 'Day Trading': 2, 'Intraday': 3, 'Swing': 3 };
const ZONE_TF_NAME = { 'Scalping': 'M1', 'Day Trading': 'M5', 'Intraday': 'M15', 'Swing': 'H1' };
const HTF_NAME = { 'Scalping': 'M15', 'Day Trading': 'H1', 'Intraday': 'H4', 'Swing': 'H4' };

function findFVG(c, dir, price) {
  const out = [];
  for (let k = 1; k < c.length - 1; k++) {
    const a = c[k - 1], b = c[k + 1];
    let bottom, top;
    if (dir === 1 && a.h < b.l && b.l <= price) { bottom = a.h; top = b.l; }
    else if (dir === -1 && a.l > b.h && b.h >= price) { bottom = b.h; top = a.l; }
    else continue;
    if (c.slice(k + 2).some(x => x.l <= top && x.h >= bottom)) continue;
    out.push({ bottom, top, type: 'FVG' });
  }
  return out;
}

function findSNR(c, dir, price, L, tol) {
  const { highs, lows } = findPivots(c, L);
  return (dir === 1 ? lows : highs)
    .filter(p => (dir === 1 ? p.p <= price : p.p >= price))
    .map(p => ({ bottom: p.p - tol, top: p.p + tol, type: 'SNR' }));
}

function findQM(c, dir, price, L, tol) {
  const { highs, lows } = findPivots(c, L);
  const seq = [
    ...highs.map(p => ({ ...p, hi: true })),
    ...lows.map(p => ({ ...p, hi: false })),
  ].sort((x, y) => x.i - y.i);
  if (seq.length < 3) return [];
  const [ls, mid, hd] = seq.slice(-3);
  const close = c[c.length - 1].c;
  if (dir === -1 && ls.hi && !mid.hi && hd.hi && hd.p > ls.p && hd.p >= price && close < mid.p)
    return [{ bottom: hd.p - tol, top: hd.p, type: 'QM' }];
  if (dir === 1 && !ls.hi && mid.hi && !hd.hi && hd.p < ls.p && hd.p <= price && close > mid.p)
    return [{ bottom: hd.p, top: hd.p + tol, type: 'QM' }];
  return [];
}

function inKillzone() {
  const h = new Date().getUTCHours();
  if (h >= 7 && h < 10) return 'London';
  if (h >= 12 && h < 15) return 'New York';
  return null;
}

function buildZoneMap(c, style, price, htfBias) {
  const L = MAP_PIVOT[style] || 2;
  const a = atr(c, ZONE_ATR_PERIOD);
  const tol = BAND_TOL_ATR * a;
  const tfName = ZONE_TF_NAME[style] || 'M5';
  const htfName = HTF_NAME[style] || 'M15';
  const kz = inKillzone();
  const styleLabel = STYLE_ZONE_CFG[style]?.label || style;
  const res = { sell: null, buy: null };

  for (const dir of [1, -1]) {
    // Kumpulkan semua block SMC + ICT untuk arah ini
    const sndBlocks = findSDZones(c, dir, price).map(z => ({
      bottom: z.bottom, top: z.top, type: z.fvg ? 'OB' : 'SND', fresh: z.fresh,
    }));
    const fvgBlocks = findFVG(c, dir, price);
    const snrBlocks = findSNR(c, dir, price, L, tol);
    const qmBlocks = findQM(c, dir, price, L, tol);
    const blocks = [...sndBlocks, ...fvgBlocks, ...snrBlocks, ...qmBlocks];

    const dist = b => Math.max(0, dir === 1 ? price - b.top : b.bottom - price);
    const overlapOf = b => blocks.filter(o => o !== b && o.bottom <= b.top && o.top >= b.bottom);
    const score = b => overlapOf(b).length
      + (b.fresh !== false ? 1 : 0)
      + (htfBias === dir ? 2 : 0)
      + (b.type === 'QM' ? 1 : 0);

    // 1) Zona dalam 5 ATR
    let best = blocks
      .filter(b => dist(b) <= 5 * a)
      .sort((x, y) => score(y) - score(x) || dist(x) - dist(y))[0];

    // 2) Fallback dalam 10 ATR
    if (!best) {
      best = blocks
        .filter(b => dist(b) <= 10 * a)
        .sort((x, y) => score(y) - score(x) || dist(x) - dist(y))[0];
    }

    // 3) Fallback S/D longgar (displacement 0.5×ATR, boleh sudah tersentuh)
    if (!best) {
      const relaxed = findSDZones(c, dir, price, { dispAtr: 0.5, freshOnly: false })[0];
      if (relaxed) {
        best = {
          bottom: relaxed.bottom,
          top: relaxed.top,
          type: relaxed.fvg ? 'OB' : 'SND',
          fresh: relaxed.fresh,
        };
      }
    }

    // 4) Fallback level swing terakhir — WAJIB ada output
    if (!best) {
      const s = c.slice(-50);
      if (!s.length) continue;
      const lvl = dir === 1 ? Math.min(...s.map(x => x.l)) : Math.max(...s.map(x => x.h));
      best = { bottom: lvl - tol, top: lvl + tol, type: 'SWING', fresh: true };
    }

    const s = score(best);
    const overlap = [...new Set(overlapOf(best).map(o => o.type))];
    const isFallback = best.type === 'SWING';
    
    // Narasi Teknikal SMC / ICT Alchemist
    const typeLabel = {
      'OB': 'Order Block (OB)',
      'SND': 'Supply & Demand (SND)',
      'FVG': 'Fair Value Gap (FVG)',
      'SNR': 'Support & Resistance (SNR)',
      'QM': 'Quasimodo (QM)',
      'SWING': 'Swing Level'
    }[best.type] || best.type;

    const reasons = [
      `${styleLabel}: ${typeLabel} di ${tfName}`,
      overlap.length ? `Konfluensi zona: ${overlap.map(o => {
        return { 'OB': 'Order Block', 'SND': 'Supply/Demand', 'FVG': 'FVG', 'SNR': 'SNR', 'QM': 'QM' }[o] || o;
      }).join(' + ')}` : 'Zona Tunggal (Tanpa Konfluensi)',
      htfBias === dir ? `Bias ${htfName}: Searah (BOS/Struktur)` : `Bias ${htfName}: Counter-trend (Hati-hati)`,
      best.fresh !== false ? 'Status Zona: Fresh (Belum Termitigasi)' : 'Status Zona: Sudah Pernah Disentuh (Risiko Retest)',
      best.type === 'QM' ? 'Pola: Quasimodo (QM) dengan Patahan Struktur' : null,
      isFallback ? 'Fallback: Level Swing Ekstrem (Tidak Ada Blok Valid)' : null,
      kz ? `Waktu: Di dalam Killzone ${kz}` : 'Waktu: Di luar Killzone Institusional',
    ].filter(Boolean);

    res[dir === 1 ? 'buy' : 'sell'] = {
      min: best.bottom,
      max: best.top,
      type: best.type,
      score: s,
      conf: isFallback ? 'LOW_CONFIDENT' : (s >= 4 ? 'CONFIDENT' : s >= 2 ? 'WARNING' : 'LOW_CONFIDENT'),
      reasons,
    };
  }
  return res;
}

async function handleZones(body, ctx, styleKey, apiKey) {
  const { symbol, dec } = ctx;
  const style = MAP_PIVOT[styleKey] ? styleKey : 'Scalping';

  let m1 = cleanCandles(body.candles?.m1);
  let m5 = cleanCandles(body.candles?.m5);
  let m15 = cleanCandles(body.candles?.m15);

  // Pastikan data primer tersedia untuk masing-masing gaya
  if ((style === 'Scalping') && m1.length < NEED.m1) m1 = (await getCandles(symbol, '1m', NEED.m1, apiKey)).candles;
  if ((style === 'Scalping' || style === 'Day Trading') && m5.length < NEED.m5) m5 = (await getCandles(symbol, '5m', NEED.m5, apiKey)).candles;
  if (m15.length < NEED.m15) m15 = (await getCandles(symbol, '15m', NEED.m15, apiKey)).candles;

  const price = Number(body.currentPrice) || lastClosePrice(m1) || lastClosePrice(m5) || lastClosePrice(m15);
  if (!(price > 0)) return { ok: false, error: 'Harga belum tersedia dari server. Coba klik ulang atau tunggu pergerakan harga.' };

  // Suntikkan harga live ke candle terakhir
  if (m1.length) m1 = mergeLiveBar(m1, price, 1);
  if (m5.length) m5 = mergeLiveBar(m5, price, 5);
  if (m15.length) m15 = mergeLiveBar(m15, price, 15);

  const h1 = aggregateCandles(m15, 60);
  const h4 = aggregateCandles(m15, 240);

  // Pilih TF Zona sesuai permintaan user
  let zoneTF, htfTF;
  if (style === 'Scalping') {
    zoneTF = m1; htfTF = m15;
  } else if (style === 'Day Trading') {
    zoneTF = m5; htfTF = m15;
  } else if (style === 'Intraday') {
    zoneTF = m15; htfTF = h1;
  } else if (style === 'Swing') {
    zoneTF = h1; htfTF = h4;
  }

  if (!zoneTF || zoneTF.length < 20) {
    return { ok: false, error: `Data candle ${ZONE_TF_NAME[style]} belum cukup (minimal 20 candle). Silakan ganti pair atau tunggu pergerakan pasar.` };
  }

  const zc = zoneTF.slice(0, -1);
  const hc = htfTF.length >= 10 ? htfTF.slice(0, -1) : zoneTF.slice(0, -1);

  const zones = buildZoneMap(zc, style, price, structureBias(hc, MAP_PIVOT[style]).dir);
  const fmt = v => Number(Number(v).toFixed(dec));
  const out = {};
  for (const side of ['sell', 'buy']) {
    const z = zones[side];
    out[side] = z
      ? { min: fmt(z.min), max: fmt(z.max), type: z.type, conf: z.conf, score: z.score, reasons: z.reasons }
      : null;
  }
  return { ok: true, style, price: fmt(price), zones: out };
}

// ═══════════════════════════ MAIN HANDLER ═══════════════════════════

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const symbol = String(body.symbol || 'XAUUSD').toUpperCase().trim();
  const styleKey = String(body.style || 'Scalping').trim();
  const style = STYLES[styleKey] ? styleKey : 'Scalping';
  const styleCfg = STYLES[style];

  const access = await checkAccess(body.email);
  if (!access.ok) return res.status(403).json({ error: access.msg });

  const dec = DECIMALS[symbol] ?? 2;
  const pip = pipSizeOf(symbol, dec);
  const gold = isGold(symbol);
  const f = v => Number(Number(v).toFixed(dec));
  const ctx = { symbol, dec, pip, gold, f };

  let apiKey = API_KEYS[0] || process.env.TICKERLAYER_API_KEY || '';

  // Mode Maping Zone: Sell Zone dan Buy Zone dari block SMC + ICT, tanpa generate signal
  if (body.mode === 'zones') {
    const out = await handleZones(body, ctx, styleKey, apiKey);
    return res.status(200).json(out);
  }

  // Mode Standar (Signal Generation)
  let m1 = cleanCandles(body.candles?.m1);
  let m5 = cleanCandles(body.candles?.m5);
  let m15 = cleanCandles(body.candles?.m15);

  const needM1 = gold && style === 'Scalping' ? NEED.m1 : 0;
  const needM5 = style === 'Scalping' || style === 'Day Trading' ? NEED.m5 : 0;
  const needM15 = NEED.m15;

  if (needM1 && m1.length < needM1) m1 = (await getCandles(symbol, '1m', needM1, apiKey)).candles;
  if (needM5 && m5.length < needM5) m5 = (await getCandles(symbol, '5m', needM5, apiKey)).candles;
  if (m15.length < needM15) m15 = (await getCandles(symbol, '15m', needM15, apiKey)).candles;

  const price = Number(body.currentPrice) || lastClosePrice(m5) || lastClosePrice(m15) || lastClosePrice(m1);
  if (!(price > 0)) return res.status(400).json({ error: 'Harga saat ini belum tersedia.' });

  if (needM1) m1 = mergeLiveBar(m1, price, 1);
  if (needM5) m5 = mergeLiveBar(m5, price, 5);
  m15 = mergeLiveBar(m15, price, 15);

  const rrList = styleCfg.rr;
  let result = { plan: null, reason: 'Belum diproses' };

  if (style === 'Scalping') {
    result = buildScalpPlan({ m1, m5, price, rrList, ctx });
  } else if (style === 'Day Trading') {
    result = buildDayPlan({ m5, m15, price, rrList, ctx });
  } else if (style === 'Intraday') {
    result = buildIntradayPlan({ m15, price, rrList, ctx });
  } else if (style === 'Swing') {
    result = buildSwingPlan({ m15, price, rrList, ctx });
  }

  if (!result.plan) {
    return res.status(200).json({ ok: false, reason: result.reason || 'Tidak ada setup yang valid saat ini.' });
  }

  const payload = toSignal(result, styleCfg, ctx);
  // PERBAIKAN: Mengirim payload di dalam objek 'signal' agar sesuai dengan frontend HTML/JS
  return res.status(200).json({ ok: true, signal: payload });
}
