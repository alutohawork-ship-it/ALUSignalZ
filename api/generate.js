// api/generate.js
// v21
//  - Acuan arah SELALU market structure (BOS / HH-HL / LH-LL). EMA hanya pendukung.
//  - Scalping (AGRESIF entry): TP 1:1 / 1:2 / 1:3.
//      Harga MASUK area Day Trading → arah ikut Day (HTF 1H). XAUUSD: zona M1 (S/D / FVG) searah Day.
//      Di luar area Day → metode awal (tidak perlu selaras): XAUUSD zona pantulan M1 bebas arah → structure M1 → EMA5/9 M1.
//      Pair lain: structure 5m → 15m → EMA9/21 5m.
//      Buffer = entry ∓ 0,5 ATR. SL dari BUFFER. TP dari ENTRY = RR × |entry − SL|.
//  - Day Trading (KONSERVATIF entry): zona M5 (OB-BOS / S&D) yang menumpuk zona BOS HTF/MTF diprioritaskan,
//      lalu REFINE ke M1. Entry = tepi zona terpilih (LIMIT), di dalam zona → NOW. Tanpa zona M5 → kontinuitas M5.
//      SL = sisi jauh zona + pad ATR M5 (maks 1,5 × jarak SL scalping 5m, naik ke level M5 jika terlalu lebar).
//      TP 1:1 / 1:1,5 / 1:2.
//  - Intraday (MODERAT entry): bias HTF 4h, REFINE M15 (FVG / OB / S&D / kontinuasi EMA20), lalu REFINE ke M5.
//      Skor kekuatan (min 5), maks 1 sinyal kuat per hari (UTC) per user per pair. HANYA TP1 & TP2 berbasis Fibonacci.
//  - Swing (POSITIONING entry): bias HTF 1d, MTF 4h, REFINE H1 (FVG / OB / S&D / kontinuasi). HANYA 1 TP (1:3).
//  - Candle: cache KV (candles_SIMBOL_TF) dulu, lalu TickerLayer berurutan (retry 429 sekali).

const KV_KEY = 'alu_clients';
const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

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
const INDEX_LIST = ['US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'JPN225', 'FRA40', 'AUS200'];
const GOLD_SYMBOLS = ['XAUUSD', 'XAUUSDX'];

const STYLES = {
  'Scalping': {
    label: 'Scalping · Agresif Entry (SL dari buffer · XAUUSD: pantulan zona M1 / kontinuasi · TP 1:1 · 1:2 · 1:3)',
    entryStyle: 'Agresif', mode: 'MARKET', kind: 'scalp', rr: [1.0, 2.0, 3.0],
  },
  'Day Trading': {
    label: 'Day Trading · Konservatif Entry (Refine zone M5 → M1 · Kontinuitas M5 · TP 1:1 · 1:1,5 · 1:2)',
    entryStyle: 'Konservatif', mode: 'LIMIT', kind: 'day', rr: [1.0, 1.5, 2.0],
  },
  'Intraday': {
    label: 'Intraday · Moderat Entry (Refine M15 → M5: S&D / OB / FVG / Kontinuitas · TP1-TP2 Fibonacci · 1 sinyal kuat/hari)',
    entryStyle: 'Moderat', mode: 'LIMIT', kind: 'intraday', rr: [],
  },
  'Swing': {
    label: 'Swing Trading · Positioning Entry (Refine H1: S&D / OB / FVG / Kontinuitas · 1 TP)',
    entryStyle: 'Positioning', mode: 'LIMIT', kind: 'swing', rr: [3.0],
  },
};

const SETUP_CFG = {
  day: {
    ema: [20, 50], pivot: 3, lookback: 80, expireMin: 240,
    m5Pivot: 2, m5Lookback: 100, m5MaxDistAtr: 6,   // zona M5 maks 6 ATR(M5) dari harga
  },
  intraday: {
    ema: [20, 50], pivot: 3, lookback: 80, riskAtr: [0.8, 3.0], maxDist: 2.0, expireMin: 720, minScore: 5,
    refineTf: 'M15', refineTfKey: '15m', refinePivot: 3, refineLookback: 120,
    fib: [1.272, 1.618, 2.0, 2.618],  // level extension; 2 pertama yang valid dipakai sebagai TP1 & TP2
  },
  swing: {
    ema: [20, 50], pivot: 4, lookback: 80, riskAtr: [1.0, 3.5], maxDist: 1.5, expireMin: 2880, minScore: 4,
    refineTf: 'H1', refineTfKey: '1h', refinePivot: 3, refineLookback: 120,
  },
};

const SCALP_PIVOT = 2;
const DAY_SL_MULT = 1.5;
const MAX_SCORE_REFINE = 8;

// Buffer scalping: jarak entry ke buffer, dalam satuan ATR
const SCALP_BUFFER_ATR = 0.5;

// Konfigurasi SL & TP XAUUSD untuk Scalping
// scalpMode: 'fixed' | 'swing' | 'clamp'
const GOLD_SL_CFG = {
  scalpMode: 'fixed',
  fixedPips: 20,          // SL 20 pip dari buffer
  minPips: 30,            // dipakai jika mode 'clamp'
  maxPips: 35,            // dipakai jika mode 'clamp'
  pipSize: 0.1,           // 1 pip = 0.10
  rr: [1.0, 2.0, 3.0],    // RR TP1, TP2, TP3 dari entry, dihitung dari |entry − SL|
};

// Konfigurasi SL M1 terdekat untuk XAUUSD (hanya dipakai jika mode 'swing' / 'clamp')
const GOLD_M1_SL = {
  pivot: 2,
  lookback: 45,
  minDistAtr: 0.4,
  maxRiskAtr: 3.0,
  padAtr: 0.2,
};

// Structure M1 (pivot dasar)
const GOLD_M1_DIR = {
  pivot: 3,
};

// Cadangan arah XAUUSD: EMA 5 & EMA 9 di M1 (dipakai jika structure M1 belum jelas)
const GOLD_EMA_CFG = {
  fast: 5,
  slow: 9,
  cooldownMin: 15,     // hanya catatan di reason, tidak menahan sinyal
};

// Arah dasar XAUUSD = market structure M1 (pivot swing M1)
const GOLD_SMC_CFG = {
  pivot: 2,
};

// Zona pantulan M1 (demand / supply) dan zona lawan
const GOLD_ZONE_CFG = {
  lookback: 60,
  minBodyAtr: 0.8,
  maxHeightAtr: 1.5,
  maxTests: 2,
  nearPips: 25,
  expireMin: 30,
  blockDistAtr: 1.0,
};

// htf = bias struktur, mtf = konfirmasi, refine = TF refine zona (Intraday/Swing)
const STYLE_TF_SERVER = {
  'Day Trading': { htf: '1h', mtf: '30m' },
  'Intraday':    { htf: '4h', mtf: '1h', refine: '15m' },
  'Swing':       { htf: '1d', mtf: '4h', refine: '1h' },
};

const TF_MIN = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440 };

const TL_SPAN = {
  '1m':  { mult: 1,  span: 'minute', minutes: 1 },
  '5m':  { mult: 5,  span: 'minute', minutes: 5 },
  '15m': { mult: 15, span: 'minute', minutes: 15 },
  '1h':  { mult: 1,  span: 'hour',   minutes: 60 },
  '4h':  { mult: 4,  span: 'hour',   minutes: 240 },
  '1d':  { mult: 1,  span: 'day',    minutes: 1440 },
};

const BASE_OF = { '30m': '15m', '1h': '15m', '4h': '15m' };

const CACHE_TTL = { '1m': 120, '5m': 600, '15m': 900, '30m': 900, '1h': 1800, '4h': 3600, '1d': 7200 };
const CACHE_BARS = { '1m': 300, '5m': 300, '15m': 1600, '30m': 300, '1h': 300, '4h': 300, '1d': 300 };

const CHUNK_MS = 2 * 86400000;
const MAX_CHUNKS = 30;
const MINUTE_CHUNK_THRESHOLD = 4500;
const TIME_FMT = { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit' };

const orderLabel = (dir, orderType) => `${dir === 1 ? 'BUY' : 'SELL'} ${orderType === 'LIMIT' ? 'LIMIT' : 'NOW'}`;
const isoDate = d => d.toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  } catch {
    return null;
  }
}

async function kvSetJSON(key, value, ttl) {
  try {
    await kv(['SET', key, JSON.stringify(value), 'EX', ttl]);
  } catch (e) {}
}

async function checkAccess(email) {
  if (!email) return { ok: false, msg: 'Sesi tidak punya email. Silakan logout lalu login ulang.' };
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

// Padding kecil di sekitar swing, dalam satuan ATR. Hanya padding, tidak ada batas min/max.
function padAtrFor(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (CRYPTO_LIST.includes(s)) return 0.3;
  if (s.includes('XAU') || s.includes('XAG')) return 0.25;
  if (INDEX_LIST.includes(s)) return 0.25;
  return 0.2;
}

// Satu request ke TickerLayer. Bila 429, tunggu sebentar lalu coba sekali lagi.
async function tlFetch(url, apiKey) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    });
    if (r.status === 429 && attempt === 0) { await sleep(1500); continue; }
    return r;
  }
}

// Request dijalankan berurutan agar tidak memicu 429
async function fetchTickerLayerOHLC(symbol, interval, apiKey, need) {
  const out = { rows: [], status: 'OK', reqs: 0 };
  const tf = TL_SPAN[interval];
  if (!apiKey) { out.status = 'KEY KOSONG'; return out; }
  if (!tf) { out.status = 'TF TIDAK DIDUKUNG'; return out; }

  const mapped = mapSymbolToTickerLayer(symbol);
  const now = Date.now();
  const startMs = now - Math.ceil(need * 1.2 * tf.minutes * 60000) - 86400000;
  const byT = new Map();

  const ranges = [];
  const barsEst = (now - startMs) / (tf.minutes * 60000);
  if (tf.span === 'minute' && barsEst > MINUTE_CHUNK_THRESHOLD) {
    let to = now + 86400000;
    while (to > startMs && ranges.length < MAX_CHUNKS) {
      const from = Math.max(startMs, to - CHUNK_MS);
      ranges.push([from, to]);
      to = from;
    }
  } else {
    ranges.push([startMs, now + 86400000]);
  }

  for (const [fromMs, toMs] of ranges) {
    const url = `${TICKERLAYER_BASE_URL}/${mapped.asset}/agg/${mapped.symbol}/${tf.mult}/${tf.span}/${isoDate(new Date(fromMs))}/${isoDate(new Date(toMs))}?sort=asc&limit=5000`;
    out.reqs++;
    try {
      const response = await tlFetch(url, apiKey);
      if (!response.ok) { out.status = `HTTP ${response.status}`; continue; }
      const data = await response.json();
      const rows = Array.isArray(data) ? data : (data.results || []);
      for (const c of rows) {
        const cand = { t: Number(c.t || 0), o: Number(c.o || 0), h: Number(c.h || 0), l: Number(c.l || 0), c: Number(c.c || 0) };
        if (cand.t > 0 && [cand.o, cand.h, cand.l, cand.c].every(Number.isFinite)) byT.set(cand.t, cand);
      }
    } catch (err) {
      out.status = `ERR ${err.message}`;
    }
  }

  out.rows = [...byT.values()].sort((a, b) => a.t - b.t).slice(-Math.max(1, Math.ceil(need)));
  console.log(`TickerLayer ${interval} ${symbol}: ${out.rows.length} candle, ${out.reqs} req, ${out.status}`);
  return out;
}

function cleanCandles(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map(c => ({ t: Number(c?.t), o: Number(c?.o), h: Number(c?.h), l: Number(c?.l), c: Number(c?.c) }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
}

function aggregateCandles(candles, tfMin) {
  const ms = tfMin * 60 * 1000;
  const buckets = new Map();
  for (const c of candles) {
    const b = Math.floor(c.t / ms) * ms;
    const g = buckets.get(b);
    if (!g) {
      buckets.set(b, { t: b, o: c.o, h: c.h, l: c.l, c: c.c });
    } else {
      g.h = Math.max(g.h, c.h);
      g.l = Math.min(g.l, c.l);
      g.c = c.c;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
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

// Cache dulu (key sama dengan api/candles.js), lalu TickerLayer, lalu dibentuk dari base
async function getCandles(symbol, tf, need, apiKey) {
  const cacheKey = `candles_${symbol}_${tf}`;
  const cached = await kvGetJSON(cacheKey);
  if (Array.isArray(cached) && cached.length >= need) {
    return { candles: cached, note: `cache ${tf} ${cached.length}` };
  }

  const notes = [];
  let best = [];

  if (TL_SPAN[tf]) {
    const nat = await fetchTickerLayerOHLC(symbol, tf, apiKey, Math.max(need, 150));
    notes.push(`native ${tf} ${nat.rows.length} (${nat.status})`);
    best = nat.rows;
    if (nat.rows.length >= need) {
      await kvSetJSON(cacheKey, nat.rows.slice(-CACHE_BARS[tf]), CACHE_TTL[tf]);
      return { candles: nat.rows, note: notes.join(' · ') };
    }
  }

  const baseTf = BASE_OF[tf];
  if (baseTf) {
    const factor = TF_MIN[tf] / TF_MIN[baseTf];
    const base = await fetchTickerLayerOHLC(symbol, baseTf, apiKey, need * factor + factor * 5);
    const agg = aggregateCandles(base.rows, TF_MIN[tf]);
    notes.push(`base ${baseTf} ${base.rows.length} (${base.status}) → ${tf} ${agg.length}`);
    if (agg.length > best.length) best = agg;
  }

  if (best.length) await kvSetJSON(cacheKey, best.slice(-CACHE_BARS[tf]), CACHE_TTL[tf]);
  return { candles: best, note: notes.join(' · ') || 'tidak ada sumber' };
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

function calculateBollingerBands(candles, period = 20, multiplier = 2) {
  try {
    if (!Array.isArray(candles) || candles.length < period) return { upper: 0, middle: 0, lower: 0 };
    const closes = candles.slice(-period).map(c => Number(c.c)).filter(Number.isFinite);
    if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };

    const middle = closes.reduce((sum, val) => sum + val, 0) / period;
    const variance = closes.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    return {
      middle: Number(middle.toFixed(5)),
      upper: Number((middle + multiplier * stdDev).toFixed(5)),
      lower: Number((middle - multiplier * stdDev).toFixed(5)),
    };
  } catch {
    return { upper: 0, middle: 0, lower: 0 };
  }
}

function emaSeries(values, period) {
  const k = 2 / (period + 1);
  let e = values[0];
  return values.map(v => (e = v * k + e * (1 - k)));
}

// Swing point: candle i adalah pivot jika high/low-nya tertinggi/terendah
// dibanding L candle kiri dan L candle kanan
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

// Market structure: BOS → HH/HL → LH/LL
function structureBias(candles, pivot) {
  if (!candles || candles.length < 10) return { dir: 0, src: 'data kurang' };
  const { highs, lows } = findPivots(candles, pivot);
  if (highs.length < 2 || lows.length < 2) return { dir: 0, src: 'swing belum cukup' };

  const [h1, h2] = highs.slice(-2);
  const [l1, l2] = lows.slice(-2);
  const last = candles[candles.length - 1].c;

  if (last > h2.p) return { dir: 1, src: 'BOS naik' };
  if (last < l2.p) return { dir: -1, src: 'BOS turun' };
  if (h2.p > h1.p && l2.p > l1.p) return { dir: 1, src: 'HH/HL' };
  if (h2.p < h1.p && l2.p < l1.p) return { dir: -1, src: 'LH/LL' };
  return { dir: 0, src: 'range' };
}

function emaState(candles, cfg) {
  const closes = candles.map(c => c.c);
  const f = emaSeries(closes, cfg.ema[0]);
  const s = emaSeries(closes, cfg.ema[1]);
  const fl = f[f.length - 1], sl = s[s.length - 1];
  return { fast: fl, slow: sl, dir: fl > sl ? 1 : fl < sl ? -1 : 0 };
}

// Supply/Demand berbasis impuls kuat (body ≥ 1,2 ATR). Dipakai Day/Intraday/Swing.
function findSDZones(candles, dir, atrV, lookback) {
  const zones = [];
  const n = candles.length;
  const from = Math.max(2, n - lookback);
  for (let i = from; i < n; i++) {
    const c = candles[i];
    const body = Math.abs(c.c - c.o);
    if (body < 1.2 * atrV) continue;
    const bull = c.c > c.o;
    if ((dir === 1 && !bull) || (dir === -1 && bull)) continue;

    let bi = -1;
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      const b = candles[j];
      if (dir === 1 ? b.c < b.o : b.c > b.o) { bi = j; break; }
    }
    if (bi < 0) continue;

    const b = candles[bi];
    const zone = dir === 1
      ? { min: b.l, max: b.o, idx: bi, impulse: i }
      : { min: b.o, max: b.h, idx: bi, impulse: i };
    if (zone.max - zone.min <= 0) continue;

    let mitigated = false;
    for (let y = i + 1; y < n; y++) {
      if (dir === 1 ? candles[y].c < zone.min : candles[y].c > zone.max) { mitigated = true; break; }
    }
    if (!mitigated) zones.push(zone);
  }
  return zones;
}

// Zona berbasis BOS (Order Block): base candle berlawanan terakhir sebelum close menembus swing terakhir.
// Demand: [low base, open base]. Supply: [open base, high base].
// Zona gugur jika setelahnya ada close yang menembus sisi jauh zona.
function findBosZones(candles, dir, lookback, pivot) {
  const zones = [];
  const n = candles.length;
  const { highs, lows } = findPivots(candles, pivot);
  const from = Math.max(pivot + 1, n - lookback);

  for (let i = from; i < n; i++) {
    const c = candles[i];
    const prev = candles[i - 1];

    if (dir === 1) {
      const ph = [...highs].reverse().find(p => p.i + pivot < i);
      if (!ph || !(c.c > ph.p && prev.c <= ph.p)) continue;

      let bi = -1;
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        if (candles[j].c < candles[j].o) { bi = j; break; }
      }
      if (bi < 0) continue;

      const b = candles[bi];
      const zone = { min: b.l, max: b.o, idx: bi };
      if (zone.max <= zone.min) continue;
      if (candles.slice(i + 1).some(x => x.c < zone.min)) continue;
      zones.push(zone);
    } else {
      const pl = [...lows].reverse().find(p => p.i + pivot < i);
      if (!pl || !(c.c < pl.p && prev.c >= pl.p)) continue;

      let bi = -1;
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        if (candles[j].c > candles[j].o) { bi = j; break; }
      }
      if (bi < 0) continue;

      const b = candles[bi];
      const zone = { min: b.o, max: b.h, idx: bi };
      if (zone.max <= zone.min) continue;
      if (candles.slice(i + 1).some(x => x.c > zone.max)) continue;
      zones.push(zone);
    }
  }
  return zones;
}

const overlaps = (z, list) => list.some(b => b.max >= z.min && b.min <= z.max);

// Sweep > CHoCH > FVG (dipakai Intraday & Swing sebagai salah satu kandidat refine)
function findStructuralSetup(mtfC, dir, cfg, price, bb, padAtr) {
  const n = mtfC.length;
  const atrV = atr(mtfC, 14);
  const { highs, lows } = findPivots(mtfC, cfg.pivot);
  const pivots = dir === 1 ? lows : highs;
  const from = Math.max(0, n - cfg.lookback);
  let reason = 'Belum ada sweep likuiditas searah market structure HTF.';

  for (let pi = pivots.length - 1; pi >= 0; pi--) {
    const piv = pivots[pi];
    if (piv.i < from) break;

    let k = -1;
    for (let x = piv.i + cfg.pivot + 1; x < n; x++) {
      const c = mtfC[x];
      const swept = dir === 1 ? (c.l < piv.p && c.c > piv.p) : (c.h > piv.p && c.c < piv.p);
      if (swept) { k = x; break; }
    }
    if (k < 0) continue;

    let rangeLvl = dir === 1 ? -Infinity : Infinity;
    for (let x = piv.i; x < k; x++) {
      rangeLvl = dir === 1 ? Math.max(rangeLvl, mtfC[x].h) : Math.min(rangeLvl, mtfC[x].l);
    }
    let chochIdx = -1;
    for (let x = k + 1; x < n; x++) {
      const broke = dir === 1 ? mtfC[x].c > rangeLvl : mtfC[x].c < rangeLvl;
      if (broke) { chochIdx = x; break; }
    }
    if (chochIdx < 0) {
      reason = 'Ada sweep, tapi belum ada CHoCH (close belum menembus struktur).';
      continue;
    }

    let zone = null;
    for (let x = n - 1; x >= k + 2 && !zone; x--) {
      const a = mtfC[x - 2], b = mtfC[x];
      const gap = dir === 1 ? a.h < b.l : a.l > b.h;
      if (!gap) continue;
      const zMin = dir === 1 ? a.h : b.h;
      const zMax = dir === 1 ? b.l : a.l;
      let mitigated = false;
      for (let y = x + 1; y < n; y++) {
        if (dir === 1 ? mtfC[y].l <= zMin : mtfC[y].h >= zMax) { mitigated = true; break; }
      }
      if (!mitigated) zone = { min: zMin, max: zMax };
    }
    if (!zone) {
      reason = 'Ada CHoCH, tapi FVG segar belum tersedia.';
      continue;
    }

    const entry = (zone.min + zone.max) / 2;
    const pending = dir === 1 ? price > zone.max : price < zone.min;
    if (!pending) {
      reason = 'Harga sudah di dalam atau melewati FVG; tidak ada area limit baru.';
      continue;
    }

    const dist = Math.abs(price - entry) / atrV;
    if (dist > cfg.maxDist) {
      reason = `FVG terlalu jauh dari harga (${dist.toFixed(1)} ATR, batas ${cfg.maxDist} ATR).`;
      continue;
    }

    if (bb && bb.middle > 0) {
      const okZone = dir === 1 ? entry <= bb.middle : entry >= bb.middle;
      if (!okZone) {
        reason = `FVG berada di ${dir === 1 ? 'premium' : 'discount'} terhadap BB middle.`;
        continue;
      }
    }

    const sw = mtfC[k];
    const extreme = dir === 1 ? Math.min(sw.l, zone.min) : Math.max(sw.h, zone.max);
    const sl = dir === 1 ? extreme - padAtr * atrV : extreme + padAtr * atrV;
    let risk = Math.abs(entry - sl);
    if (risk > cfg.riskAtr[1] * atrV) {
      reason = `SL struktur terlalu lebar (${(risk / atrV).toFixed(1)} ATR, batas ${cfg.riskAtr[1]}).`;
      continue;
    }
    let slFinal = sl;
    if (risk < cfg.riskAtr[0] * atrV) {
      risk = cfg.riskAtr[0] * atrV;
      slFinal = dir === 1 ? entry - risk : entry + risk;
    }

    return {
      plan: {
        dir,
        entry,
        zone,
        sl: slFinal,
        risk,
        dist,
        atr: atrV,
        sweepLvl: piv.p,
        sweepWick: dir === 1 ? sw.l : sw.h,
        rangeLvl,
        chochClose: mtfC[chochIdx].c,
      },
    };
  }

  return { plan: null, reason };
}

// SL scalping: swing 5m terdekat di sisi SL + padding. Jika tidak ada swing,
// pakai low/high 12 candle 5m terakhir. Tidak ada batas min/max ATR.
function scalpSL(c5, price, dir, symbol) {
  const a = atr(c5, 14);
  const pad = padAtrFor(symbol) * a;
  const { highs, lows } = findPivots(c5, SCALP_PIVOT);
  const list = dir === 1 ? lows : highs;

  let level = null;
  let src = 'swing 5m';
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i].p;
    if (dir === 1 ? p < price : p > price) { level = p; break; }
  }
  if (level == null) {
    const recent = c5.slice(-12);
    level = dir === 1
      ? Math.min(price, Math.min(...recent.map(c => c.l)))
      : Math.max(price, Math.max(...recent.map(c => c.h)));
    src = 'low/high 12 candle 5m';
  }

  const risk = Math.abs(price - level) + pad;
  const sl = dir === 1 ? price - risk : price + risk;
  return { sl, risk, level, pad, atr: a, src };
}

// SL Gold: swing M1 TERDEKAT di sisi SL (bukan yang paling baru) + padding ATR M1.
function goldNearestM1SL(m1, price, dir) {
  const a1 = atr(m1, 14);
  const { highs, lows } = findPivots(m1, GOLD_M1_SL.pivot);
  const from = m1.length - GOLD_M1_SL.lookback;
  const minDist = GOLD_M1_SL.minDistAtr * a1;

  let best = null;
  for (const p of (dir === 1 ? lows : highs)) {
    if (p.i < from) continue;
    const onSlSide = dir === 1 ? p.p < price : p.p > price;
    if (!onSlSide) continue;
    const dist = Math.abs(price - p.p);
    if (dist < minDist) continue;
    if (!best || dist < best.dist) best = { level: p.p, dist };
  }

  if (!best) {
    const recent = m1.slice(-GOLD_M1_SL.lookback);
    const level = dir === 1
      ? Math.min(...recent.map(c => c.l))
      : Math.max(...recent.map(c => c.h));
    best = { level, dist: Math.abs(price - level) };
  }

  const pad = GOLD_M1_SL.padAtr * a1;
  const risk = best.dist + pad;
  const sl = dir === 1 ? price - risk : price + risk;
  return { sl, risk, level: best.level, pad, atr: a1, src: 'swing M1 terdekat' };
}

// SL tetap XAUUSD: jarak fixedPips dari buffer
function goldFixedSL(m1, price, dir) {
  const a1 = atr(m1, 14);
  const risk = GOLD_SL_CFG.fixedPips * GOLD_SL_CFG.pipSize;
  const sl = dir === 1 ? price - risk : price + risk;
  return { sl, risk, level: sl, pad: 0, atr: a1, src: `fixed ${GOLD_SL_CFG.fixedPips} pip` };
}

// SL swing M1 terdekat, dibatasi ke rentang minPips..maxPips
function goldClampSL(m1, price, dir) {
  const base = goldNearestM1SL(m1, price, dir);
  const minR = GOLD_SL_CFG.minPips * GOLD_SL_CFG.pipSize;
  const maxR = GOLD_SL_CFG.maxPips * GOLD_SL_CFG.pipSize;
  const risk = Math.min(Math.max(base.risk, minR), maxR);
  const sl = dir === 1 ? price - risk : price + risk;
  const clampedTo = base.risk < minR ? 'min' : base.risk > maxR ? 'max' : 'swing';
  return {
    sl,
    risk,
    level: sl,
    pad: 0,
    atr: base.atr,
    src: `swing M1 (${clampedTo}, ${GOLD_SL_CFG.minPips}-${GOLD_SL_CFG.maxPips} pip)`,
  };
}

// Pemilih mode SL XAUUSD
function goldSL(m1, price, dir, mode) {
  if (mode === 'fixed') return goldFixedSL(m1, price, dir);
  if (mode === 'clamp') return goldClampSL(m1, price, dir);
  return goldNearestM1SL(m1, price, dir);
}

// Zona lawan di M1: supply (untuk BUY) atau demand (untuk SELL).
function findGoldOpposingZones(m1, dir, atrV) {
  const zones = [];
  const n = m1.length;
  const from = Math.max(2, n - GOLD_ZONE_CFG.lookback);
  for (let i = from; i < n; i++) {
    const c = m1[i];
    const body = Math.abs(c.c - c.o);
    if (body < GOLD_ZONE_CFG.minBodyAtr * atrV) continue;
    const impulseUp = c.c > c.o;
    if (dir === 1 && impulseUp) continue;
    if (dir === -1 && !impulseUp) continue;

    let bi = -1;
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      const b = m1[j];
      if (dir === 1 ? b.c > b.o : b.c < b.o) { bi = j; break; }
    }
    if (bi < 0) continue;

    const b = m1[bi];
    const zone = dir === 1
      ? { min: b.o, max: b.h }
      : { min: b.l, max: b.o };
    if (zone.max - zone.min <= 0) continue;

    let mitigated = false;
    for (let y = i + 1; y < n; y++) {
      if (dir === 1 ? m1[y].c > zone.max : m1[y].c < zone.min) { mitigated = true; break; }
    }
    if (!mitigated) zones.push(zone);
  }
  return zones;
}

// Cek apakah ada zona lawan di jalur antara entry dan TP1.
function goldOpposingZoneBlock(m1, dir, price, tp1, atrV) {
  const zones = findGoldOpposingZones(m1, dir, atrV);
  const blockDist = GOLD_ZONE_CFG.blockDistAtr * atrV;
  const hit = zones.find(z => {
    if (dir === 1) {
      return z.min >= price - 0.1 && z.min <= tp1 && (z.min - price) <= blockDist;
    }
    return z.max <= price + 0.1 && z.max >= tp1 && (price - z.max) <= blockDist;
  });
  return hit || null;
}

// Zona pantulan M1 (demand / supply) untuk scalping XAUUSD.
function findGoldReactionZones(m1, atrV) {
  const zones = [];
  const n = m1.length;
  const from = Math.max(2, n - GOLD_ZONE_CFG.lookback);
  for (let i = from; i < n; i++) {
    const c = m1[i];
    const body = Math.abs(c.c - c.o);
    if (body < GOLD_ZONE_CFG.minBodyAtr * atrV) continue;

    const bullImpulse = c.c > c.o;
    const type = bullImpulse ? 'demand' : 'supply';

    let bi = -1;
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      const b = m1[j];
      if (bullImpulse ? b.c < b.o : b.c > b.o) { bi = j; break; }
    }
    if (bi < 0) continue;

    const b = m1[bi];
    const zone = bullImpulse
      ? { type, min: b.l, max: b.o }
      : { type, min: b.o, max: b.h };
    const height = zone.max - zone.min;
    if (height <= 0 || height > GOLD_ZONE_CFG.maxHeightAtr * atrV) continue;

    let broken = false, touches = 0;
    for (let y = i + 1; y < n; y++) {
      const k = m1[y];
      if (bullImpulse ? k.c < zone.min : k.c > zone.max) { broken = true; break; }
      if (y < n - 1 && (bullImpulse ? k.l <= zone.max : k.h >= zone.min)) touches++;
    }
    if (broken || touches >= GOLD_ZONE_CFG.maxTests) continue;

    zones.push({ ...zone, strength: body / atrV });
  }
  return zones;
}

function pickGoldReactionZone(zones, price) {
  const nearDist = GOLD_ZONE_CFG.nearPips * GOLD_SL_CFG.pipSize;
  let best = null;
  for (const z of zones) {
    let dist;
    if (z.type === 'demand') {
      if (price < z.min) continue;
      dist = price <= z.max ? 0 : price - z.max;
    } else {
      if (price > z.max) continue;
      dist = price >= z.min ? 0 : z.min - price;
    }
    if (dist > nearDist) continue;
    if (!best || dist < best.dist || (dist === best.dist && z.strength > best.strength)) {
      best = { ...z, dist, dir: z.type === 'demand' ? 1 : -1 };
    }
  }
  return best;
}

// Arah cadangan: dipakai jika structure belum jelas. Selalu mengembalikan BUY atau SELL.
function fallbackDir(candles, price, label, fastP, slowP) {
  const closes = candles.map(c => c.c);
  if (closes.length >= slowP + 2) {
    const fs = emaSeries(closes, fastP);
    const ss = emaSeries(closes, slowP);
    const fl = fs[fs.length - 1], sl = ss[ss.length - 1];
    if (fl !== sl) return { dir: fl > sl ? 1 : -1, src: `EMA${fastP}/EMA${slowP} ${label}` };
  }
  const last = candles[candles.length - 1];
  if (last.c !== last.o) return { dir: last.c > last.o ? 1 : -1, src: `candle ${label} terakhir` };
  return { dir: price >= last.c ? 1 : -1, src: `harga vs close ${label}` };
}

// ═══════════════════════════ HELPER: AREA DAY, ZONA M1 (S/D + FVG), REFINE ═══════════════════════════

// Jarak "dekat area Day Trading" untuk Scalping, dalam ATR M5. Harga di dalam zona selalu dianggap masuk.
const DAY_AREA_NEAR_ATR = 0.5;
const DAY_M1 = { pivot: 2, lookback: 60 };      // refine M5 → M1 (Day Trading)
const INTRA_M5 = { pivot: 2, lookback: 100 };   // refine M15 → M5 (Intraday)

// Zona searah yang masih valid (close belum berbalik), diurut dari yang terdekat.
// inside = harga di dalam zona, dist = jarak ke tepi terdekat (0 jika di dalam).
function sideCandidates(zones, dir, price, lastClose) {
  const out = [];
  for (const z of zones) {
    const mid = (z.min + z.max) / 2;
    let inside, dist;
    if (dir === 1) {
      if (price < z.min) continue;
      inside = price <= z.max;
      if (inside && lastClose < mid) continue;
      dist = inside ? 0 : price - z.max;
    } else {
      if (price > z.max) continue;
      inside = price >= z.min;
      if (inside && lastClose > mid) continue;
      dist = inside ? 0 : z.min - price;
    }
    out.push({ ...z, inside, dist });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

// Zona OB (BOS) dan S&D (impuls) dari satu TF
function zonesOfTf(candles, dir, tag, pivot, lookback) {
  if (!candles || candles.length < 30) return [];
  const a = atr(candles, 14);
  return [
    ...findBosZones(candles, dir, lookback, pivot).map(z => ({ min: z.min, max: z.max, kind: `OB ${tag}` })),
    ...findSDZones(candles, dir, a, lookback).map(z => ({ min: z.min, max: z.max, kind: `S&D ${tag}` })),
  ];
}

// Zona dari list finer yang berpotongan dengan zona induk, dipilih yang paling dekat harga
function refineInside(parent, finer, dir, price, lastClose) {
  const overlap = finer.filter(z => z.max >= parent.min && z.min <= parent.max);
  return sideCandidates(overlap, dir, price, lastClose)[0] ?? null;
}

// Kandidat refine M5 untuk Day Trading. refined = menumpuk zona BOS HTF/MTF (diprioritaskan).
function dayCandidates({ htfC, mtfC, c5, dir, price }) {
  const cfg = SETUP_CFG.day;
  const a5 = atr(c5, 14);
  const bigZones = [
    ...findBosZones(htfC, dir, 60, cfg.pivot),
    ...findBosZones(mtfC, dir, cfg.lookback, cfg.pivot),
  ];
  const m5Zones = zonesOfTf(c5, dir, 'M5', cfg.m5Pivot, cfg.m5Lookback);
  const lastClose = c5[c5.length - 1].c;
  const cands = sideCandidates(m5Zones, dir, price, lastClose)
    .filter(z => z.dist <= cfg.m5MaxDistAtr * a5)
    .map(z => ({ ...z, refined: overlaps(z, bigZones) }))
    .sort((a, b) => (a.refined === b.refined ? a.dist - b.dist : (a.refined ? -1 : 1)));
  return { cands, bigZones, a5 };
}

// FVG: bullish gap → demand, bearish gap → supply. Gugur jika close sudah menembus sisi jauh.
function findFvgZones(candles, atrV, lookback) {
  const zones = [];
  const n = candles.length;
  const from = Math.max(2, n - lookback);
  for (let i = from; i < n; i++) {
    const a = candles[i - 2], b = candles[i];
    if (a.h < b.l) {
      const z = { type: 'demand', kind: 'FVG', min: a.h, max: b.l };
      const h = z.max - z.min;
      if (h >= 0.1 * atrV && h <= GOLD_ZONE_CFG.maxHeightAtr * atrV) {
        let broken = false;
        for (let y = i + 1; y < n; y++) if (candles[y].c < z.min) { broken = true; break; }
        if (!broken) zones.push({ ...z, strength: h / atrV });
      }
    }
    if (a.l > b.h) {
      const z = { type: 'supply', kind: 'FVG', min: b.h, max: a.l };
      const h = z.max - z.min;
      if (h >= 0.1 * atrV && h <= GOLD_ZONE_CFG.maxHeightAtr * atrV) {
        let broken = false;
        for (let y = i + 1; y < n; y++) if (candles[y].c > z.max) { broken = true; break; }
        if (!broken) zones.push({ ...z, strength: h / atrV });
      }
    }
  }
  return zones;
}

// Semua zona reaksi M1 untuk entry scalping: S/D (base + impuls) dan FVG
function findM1ReactionZones(m1, atrV) {
  const sd = findGoldReactionZones(m1, atrV).map(z => ({ ...z, kind: 'S/D' }));
  return [...sd, ...findFvgZones(m1, atrV, GOLD_ZONE_CFG.lookback)];
}

// Zona reaksi M1 yang SEARAH arah dasar (demand untuk BUY, supply untuk SELL) dan paling dekat harga
function pickAlignedZone(zones, price, dir) {
  const want = dir === 1 ? 'demand' : 'supply';
  const nearDist = GOLD_ZONE_CFG.nearPips * GOLD_SL_CFG.pipSize;
  let best = null;
  for (const z of zones) {
    if (z.type !== want) continue;
    let dist;
    if (dir === 1) {
      if (price < z.min) continue;
      dist = price <= z.max ? 0 : price - z.max;
    } else {
      if (price > z.max) continue;
      dist = price >= z.min ? 0 : z.min - price;
    }
    if (dist > nearDist) continue;
    if (!best || dist < best.dist || (dist === best.dist && z.strength > best.strength)) {
      best = { ...z, dist };
    }
  }
  return best;
}

// Entry dari zona reaksi M1: LIMIT di tepi zona, atau NOW jika harga sudah di dalam zona
function scalpZoneEntry(z, dir, price, f) {
  const zone = { min: z.min, max: z.max };
  const label = `${z.kind} M1 ${f(z.min)}–${f(z.max)}`;
  if (z.dist === 0) {
    return { orderType: 'NOW', entry: price, zone, expireMs: 0, txt: `di dalam zona ${label}` };
  }
  const pips = Math.round(z.dist / GOLD_SL_CFG.pipSize);
  return {
    orderType: 'LIMIT',
    entry: dir === 1 ? z.max : z.min,
    zone,
    expireMs: GOLD_ZONE_CFG.expireMin * 60000,
    txt: `pending di tepi zona ${label} (${pips} pip)`,
  };
}

// ═══════════════════════════ SCALPING (Agresif) ═══════════════════════════
// Arah IKUT Day Trading (HTF 1H) hanya jika harga MASUK area Day Trading.
// Di luar area Day Trading → metode awal (tidak perlu selaras):
//   XAUUSD : zona pantulan M1 (S/D / FVG) bebas arah → structure M1 → EMA5/9 M1
//   Pair   : structure 5m → 15m → EMA9/21 5m
// Di area Day Trading : XAUUSD pakai zona M1 yang searah Day (LIMIT di tepi / NOW di dalam zona).
//                       Tanpa zona → market searah Day. Pair → market searah Day.
// SL dari buffer (entry ∓ 0,5 ATR) ∓ jarak SL; untuk LIMIT juga di luar sisi jauh zona.
// TP dari entry = RR × |entry − SL| → 1:1 / 1:2 / 1:3.
function buildScalpPlan({ htfC, mtfC, m1, price, rrList, symbol, dec, day }) {
  const f = v => Number(v).toFixed(dec);
  const isGold = GOLD_SYMBOLS.includes(symbol);
  const a5 = atr(mtfC, 14);
  const a1 = isGold ? atr(m1, 14) : a5;

  // 1) Apakah harga masuk area Day Trading?
  const dayS = structureBias(day.htfC, SETUP_CFG.day.pivot);
  let inDay = false;
  let areaTxt = '';
  if (dayS.dir !== 0 && day.mtfC.length >= 30) {
    const dc = dayCandidates({ htfC: day.htfC, mtfC: day.mtfC, c5: mtfC, dir: dayS.dir, price });
    const near = DAY_AREA_NEAR_ATR * a5;
    const hit = dc.cands.find(z => z.inside)
      ?? dc.cands.filter(z => z.dist <= near).sort((a, b) => a.dist - b.dist)[0];
    if (hit) {
      inDay = true;
      areaTxt = `${hit.kind}${hit.refined ? ' (menumpuk HTF/MTF)' : ''}`;
    }
  }

  let dir, srcTxt, fallback = false;
  let mode = 'KONTINUASI';
  let orderType = 'NOW';
  let entry = price;
  let zone = null;
  let expireMs = 0;

  const useZone = ze => {
    mode = 'PANTULAN';
    orderType = ze.orderType;
    entry = ze.entry;
    zone = ze.zone;
    expireMs = ze.expireMs;
    return ze.txt;
  };

  if (inDay) {
    // 2a) Di area Day Trading: arah ikut Day
    dir = dayS.dir;
    srcTxt = `area Day Trading ${areaTxt}, searah Day HTF 1H (${dayS.src})`;
    if (isGold) {
      const z = pickAlignedZone(findM1ReactionZones(m1, a1), price, dir);
      srcTxt += z
        ? ` · ${useZone(scalpZoneEntry(z, dir, price, f))}`
        : ' · tanpa zona M1 searah dekat → market';
    }
  } else {
    // 2b) Di luar area Day Trading: metode awal (tidak perlu selaras)
    if (isGold) {
      const rz = pickGoldReactionZone(findM1ReactionZones(m1, a1), price);
      if (rz) {
        dir = rz.dir;
        srcTxt = `zona reaksi M1 ${rz.type} (${rz.kind})`;
        srcTxt += ` · ${useZone(scalpZoneEntry(rz, dir, price, f))}`;
      } else {
        const s1 = structureBias(m1, GOLD_SMC_CFG.pivot);
        if (s1.dir !== 0) {
          dir = s1.dir;
          srcTxt = `structure M1 ${s1.src}`;
        } else {
          const fb = fallbackDir(m1, price, 'M1', GOLD_EMA_CFG.fast, GOLD_EMA_CFG.slow);
          dir = fb.dir;
          srcTxt = `EMA cadangan ${fb.src}`;
          fallback = true;
        }
      }
    } else {
      const s5 = structureBias(mtfC, SCALP_PIVOT);
      const s15 = structureBias(htfC, SETUP_CFG.day.pivot);
      if (s5.dir !== 0) {
        dir = s5.dir;
        srcTxt = `structure 5m ${s5.src}`;
      } else if (s15.dir !== 0) {
        dir = s15.dir;
        srcTxt = `structure 15m ${s15.src}`;
      } else {
        const fb = fallbackDir(mtfC, price, '5m', 9, 21);
        dir = fb.dir;
        srcTxt = `EMA cadangan ${fb.src}`;
        fallback = true;
      }
    }
    srcTxt += dayS.dir === 0 ? ' (HTF 1H belum jelas)' : ` (Day HTF 1H ${dayS.src})`;
  }

  // 3) Jarak SL dari buffer
  const sc = isGold
    ? goldSL(m1, entry, dir, GOLD_SL_CFG.scalpMode)
    : scalpSL(mtfC, price, dir, symbol);

  // 4) Buffer dan SL (untuk LIMIT di zona, SL juga di luar sisi jauh zona)
  const bufferEnd = entry - dir * SCALP_BUFFER_ATR * sc.atr;
  let sl = bufferEnd - dir * sc.risk;
  if (zone) {
    const farSl = dir === 1
      ? zone.min - SCALP_BUFFER_ATR * sc.atr
      : zone.max + SCALP_BUFFER_ATR * sc.atr;
    if (dir === 1 ? farSl < sl : farSl > sl) sl = farSl;
  }
  const risk = Math.abs(entry - sl);

  // 5) TP dari entry, 1R = |entry − SL| → 1:1, 1:2, 1:3
  const rr = isGold ? GOLD_SL_CFG.rr : rrList;
  const tps = rr.map(x => entry + dir * x * risk);

  // 6) Zona lawan M1 di jalur TP1: hanya label WASPADA
  let warnText = '';
  if (isGold) {
    const hitZone = goldOpposingZoneBlock(m1, dir, entry, tps[0], sc.atr);
    if (hitZone) {
      const zText = dir === 1
        ? `supply ${f(hitZone.min)}–${f(hitZone.max)}`
        : `demand ${f(hitZone.min)}–${f(hitZone.max)}`;
      warnText = ` · WASPADA ${zText} M1 di jalur TP1`;
    }
  }

  // 7) Kualitas & confidence
  const counterDay = dayS.dir !== 0 && dir !== dayS.dir;
  const riskAtr = sc.risk / sc.atr;
  const riskLabel = riskAtr <= 1.5 ? 'LOW' : riskAtr <= 2.5 ? 'MEDIUM' : 'HIGH';
  let quality;
  if (mode === 'PANTULAN') {
    quality = `${inDay ? 'AREA DAY + ' : ''}PANTULAN ZONA M1 ${orderType === 'LIMIT' ? '(LIMIT)' : '(NOW di dalam zona)'}`;
  } else if (fallback) {
    quality = 'FALLBACK (arah cadangan)';
  } else {
    quality = inDay ? 'AREA DAY · SEARAH DAY' : 'NORMAL (metode awal)';
  }
  if (!inDay && counterDay) quality += ' · berlawanan Day (di luar area)';
  quality += warnText;
  const confidence = warnText || fallback || counterDay ? 'LOW'
    : inDay ? 'HIGH'
    : 'MEDIUM';

  // 8) Alasan
  const reason = [
    `Scalping (agresif) ${dir === 1 ? 'BUY' : 'SELL'} ${orderType === 'LIMIT' ? 'LIMIT' : 'MARKET'} pada ${symbol}, arah dari ${srcTxt}.`,
    `Kualitas sinyal: ${quality}.`,
    `Entry ${f(entry)}, buffer ${f(bufferEnd)} (${sc.src}), SL ${f(sl)}, jarak entry ke SL ${f(risk)}.`,
    `RRR: ${rr.map((x, i) => `TP${i + 1} 1:${x}`).join(', ')} (dihitung dari entry).`,
  ].join(' • ');

  const zoneDisplay = zone ?? { min: Math.min(entry, bufferEnd), max: Math.max(entry, bufferEnd) };

  return {
    dir,
    plan: {
      kind: 'scalp',
      orderType,
      status: orderType === 'LIMIT' ? 'PENDING' : 'RUNNING',
      entry,
      bufferEnd,
      sl,
      tps,
      zone: zoneDisplay,
      expireMs,
      zoneNote: `Scalp · ${quality}`,
    },
    meta: { confidence, riskLabel, setup: 'CONTINUATION', reason },
  };
}

// ═══════════════════════════ DAY TRADING (Konservatif) ═══════════════════════════
// Bias struktur HTF. Zona M5 (OB / S&D) yang menumpuk zona BOS HTF/MTF diprioritaskan,
// lalu di-REFINE ke M1 (OB / S&D M1) bila ada. Entry = tepi terdekat zona terpilih (LIMIT),
// di dalam zona → NOW. SL = sisi jauh zona terpilih + pad ATR M5. Jika melebihi 1,5× scalp,
// naik ke level M5. Tanpa zona sama sekali → kontinuitas M5. TP 1:1 / 1:1,5 / 1:2.
function buildDayPlan({ htfC, mtfC, c5, m1, symbol, price, rrList, dec }) {
  const cfg = SETUP_CFG.day;
  const aM = atr(mtfC, 14);
  const a5 = atr(c5, 14);
  const f = v => Number(v).toFixed(dec);

  const st = structureBias(htfC, cfg.pivot);
  if (st.dir === 0) {
    return { plan: null, reason: `Market structure HTF belum jelas (${st.src}): belum ada HH/HL, LH/LL, atau BOS.` };
  }
  const dir = st.dir;
  const dirTxt = dir === 1 ? 'BULLISH' : 'BEARISH';

  const sc = scalpSL(c5, price, dir, symbol);
  const dayCap = DAY_SL_MULT * sc.risk;
  const riskAtr = dayCap / aM;
  const riskLabel = riskAtr <= 1.5 ? 'LOW' : riskAtr <= 2.5 ? 'MEDIUM' : 'HIGH';
  const pad = padAtrFor(symbol) * a5;
  const lastM1 = m1.length ? m1[m1.length - 1].c : price;

  const { cands } = dayCandidates({ htfC, mtfC, c5, dir, price });
  const top = cands[0] ?? null;

  let chosen = null;
  if (top) {
    const m1z = refineInside(top, zonesOfTf(m1, dir, 'M1', DAY_M1.pivot, DAY_M1.lookback), dir, price, lastM1);
    const levels = [];
    if (m1z) levels.push({ ...m1z, chain: `M5 ${top.kind} → M1 ${m1z.kind}` });
    levels.push({ ...top, chain: `M5 ${top.kind}` });

    // Pilih level pertama yang SL-nya tidak melebihi batas; level terakhir (M5) selalu diterima
    for (let i = 0; i < levels.length; i++) {
      const lv = levels[i];
      const e = lv.inside ? price : (dir === 1 ? lv.max : lv.min);
      const fr = dir === 1 ? lv.min : lv.max;
      const sl0 = dir === 1 ? fr - pad : fr + pad;
      const raw = Math.abs(e - sl0);
      const overCap = raw > dayCap;
      if (overCap && i < levels.length - 1) continue;
      let s = sl0;
      let r = raw;
      if (r < 0.5 * a5) {
        r = 0.5 * a5;
        s = dir === 1 ? e - r : e + r;
      }
      chosen = { ...lv, entry: e, far: fr, sl: s, risk: r, overCap };
      break;
    }
  }

  let entry, orderType, far = null, sl, risk, confidence, modeTxt, zoneDisplay, zoneNote, reasonSl;

  if (chosen) {
    entry = chosen.entry;
    far = chosen.far;
    sl = chosen.sl;
    risk = chosen.risk;
    orderType = chosen.inside ? 'NOW' : 'LIMIT';
    confidence = top.refined ? 'HIGH' : 'MEDIUM';
    zoneDisplay = { min: chosen.min, max: chosen.max };
    zoneNote = `Refine ${chosen.chain}${top.refined ? ' (menumpuk HTF/MTF)' : ''} · ${chosen.inside ? 'INSIDE' : 'LIMIT'}`;
    modeTxt = `Zona ${chosen.chain} ${dir === 1 ? 'demand' : 'supply'} ${f(chosen.min)} – ${f(chosen.max)}` +
      `${top.refined ? ' (menumpuk zona HTF/MTF)' : ''}. ` +
      (chosen.inside
        ? `Harga di dalam zona, entry market ${f(entry)}.`
        : `Harga ${dir === 1 ? 'di atas' : 'di bawah'} zona, limit di tepi terdekat ${f(entry)}.`);
    reasonSl = `SL di sisi jauh zona ${f(far)} + pad ${f(pad)} → jarak ${f(risk)}` +
      (chosen.overCap ? ' (melebihi 1,5× scalp, dipakai level M5)' : ' (zona paling halus yang muat)') + '.';
  } else {
    // Tanpa zona M5: kontinuitas M5 harus searah HTF
    const s5 = structureBias(c5, cfg.m5Pivot);
    if (s5.dir !== dir) {
      return { plan: null, reason: `Tidak ada zona S/D M5 yang valid, dan struktur M5 (${s5.src}) belum searah HTF.` };
    }

    const emaArr = emaSeries(c5.map(c => c.c), cfg.ema[0]);
    const ema = emaArr[emaArr.length - 1];

    if (s5.src.startsWith('BOS')) {
      entry = price;
      orderType = 'NOW';
      confidence = 'MEDIUM';
      modeTxt = `Kontinuitas: BOS M5 searah HTF, entry market ${f(price)}.`;
    } else if (dir === 1 ? price > ema : price < ema) {
      entry = ema;
      orderType = 'LIMIT';
      confidence = 'MEDIUM';
      modeTxt = `Kontinuitas: harga ${dir === 1 ? 'di atas' : 'di bawah'} EMA${cfg.ema[0]} M5, limit di EMA ${f(ema)}.`;
    } else {
      const { highs, lows } = findPivots(c5, cfg.m5Pivot);
      const list = dir === 1 ? lows : highs;
      let lv = null;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i].p;
        if (dir === 1 ? p < price : p > price) { lv = p; break; }
      }
      if (lv != null) {
        entry = lv;
        orderType = 'LIMIT';
        confidence = 'LOW';
        modeTxt = `Pullback: limit di swing ${dir === 1 ? 'low' : 'high'} M5 ${f(lv)}.`;
      } else {
        entry = price;
        orderType = 'NOW';
        confidence = 'LOW';
        modeTxt = `Tidak ada swing pullback M5, entry market ${f(price)}.`;
      }
    }
    zoneDisplay = { min: entry, max: entry };
    zoneNote = `Kontinuitas M5 · ${orderType}`;
    sl = dir === 1 ? entry - dayCap : entry + dayCap;
    risk = Math.abs(entry - sl);
    reasonSl = `SL = 1,5 × jarak scalp: ${f(dayCap)} (${sc.src} ${f(sc.level)}).`;
  }

  const tps = rrList.map(rr => entry + dir * rr * risk);

  const reason = [
    `Day Trading (konservatif) · market structure HTF ${dirTxt} (${st.src}).`,
    modeTxt,
    reasonSl,
    `RRR: TP1 1:${rrList[0]}, TP2 1:${rrList[1]}, TP3 1:${rrList[2]}.`,
  ].join(' • ');

  return {
    dir,
    plan: {
      kind: 'day',
      orderType,
      status: orderType === 'LIMIT' ? 'PENDING' : 'RUNNING',
      entry,
      bufferEnd: far ?? entry,
      sl,
      tps,
      zone: zoneDisplay,
      expireMs: orderType === 'LIMIT' ? cfg.expireMin * 60000 : 0,
      zoneNote,
    },
    meta: { confidence, riskLabel, setup: 'CONTINUATION', reason },
  };
}

// ═══════════════════════════ FIBONACCI (Intraday) ═══════════════════════════
// Leg impuls searah: BUY = swing low (A) → swing high (B) terbaru. SELL = sebaliknya.
function fibLeg(c, dir, pivot) {
  const { highs, lows } = findPivots(c, pivot);
  let A = null, B = null;
  if (dir === 1) {
    for (const h of [...highs].reverse()) {
      const lo = [...lows].reverse().find(l => l.i < h.i);
      if (lo && h.p > lo.p) { A = lo.p; B = h.p; break; }
    }
  } else {
    for (const l of [...lows].reverse()) {
      const hi = [...highs].reverse().find(h => h.i < l.i);
      if (hi && hi.p > l.p) { A = hi.p; B = l.p; break; }
    }
  }
  if (A == null) {
    const rec = c.slice(-60);
    const hiP = Math.max(...rec.map(x => x.h)), loP = Math.min(...rec.map(x => x.l));
    A = dir === 1 ? loP : hiP;
    B = dir === 1 ? hiP : loP;
  }
  return { A, B };
}

// TP1 & TP2 = extension A + x·(B − A). Hanya level yang berjarak ≥ 1R dari entry yang dipakai.
function fibTargets(c, dir, entry, risk, pivot, levels) {
  const { A, B } = fibLeg(c, dir, pivot);
  const leg = B - A;
  const tps = [];
  const used = [];
  for (const x of levels) {
    const v = A + x * leg;
    if ((v - entry) * dir >= risk && (!tps.length || (v - tps[tps.length - 1]) * dir > 0)) {
      tps.push(v);
      used.push(x);
      if (tps.length === 2) break;
    }
  }
  const fb = [1.5, 2.5];
  while (tps.length < 2) {
    let v = entry + dir * fb[tps.length] * risk;
    if (tps.length && (v - tps[tps.length - 1]) * dir <= 0) v = tps[tps.length - 1] + dir * risk * 0.5;
    tps.push(v);
    used.push(null);
  }
  return { tps, used, A, B };
}

// ═══════════════════════════ INTRADAY (Moderat) & SWING (Positioning) ═══════════════════════════
// Bias struktur HTF. Refine zona di TF refine (Intraday M15, Swing H1) dari 4 kandidat:
//   FVG (Sweep>CHoCH>FVG) · OB (BOS) · S&D (impuls) · Kontinuitas (EMA20 + struktur refine searah)
// Dipilih berdasarkan skor (maks 8), lalu jarak ke harga.
// Intraday: zona M15 terpilih di-refine lagi ke M5 (OB / S&D M5) bila berpotongan dan SL masih wajar.
function buildRefinePlan({ htfC, mtfC, rC, c5, styleKind, price, dec, symbol, rrList }) {
  const cfg = SETUP_CFG[styleKind];
  const minHtf = cfg.ema[1] + 5;
  if (htfC.length < minHtf || mtfC.length < 30 || rC.length < 40) {
    return { plan: null, reason: `Data candle belum cukup (HTF min ${minHtf}, MTF min 30, ${cfg.refineTf} min 40).` };
  }

  const st = structureBias(htfC, cfg.pivot);
  if (st.dir === 0) {
    return { plan: null, reason: `Market structure HTF belum jelas (${st.src}): belum ada HH/HL, LH/LL, atau BOS.` };
  }
  const dir = st.dir;
  const biasTxt = dir === 1 ? 'BULLISH' : 'BEARISH';
  const emaH = emaState(htfC, cfg);
  const emaAligned = emaH.dir === dir;

  const f = v => Number(v).toFixed(dec);
  const aR = atr(rC, 14);
  const padAtr = padAtrFor(symbol);
  const bb = calculateBollingerBands(rC);
  const lastR = rC[rC.length - 1];

  const bigZones = [
    ...findBosZones(htfC, dir, 60, cfg.pivot),
    ...findBosZones(mtfC, dir, cfg.lookback, cfg.pivot),
    ...findSDZones(htfC, dir, atr(htfC, 14), 60),
  ];

  const rejects = [];
  const raw = [];

  // a) FVG: Sweep > CHoCH > FVG di TF refine
  const rcfg = { pivot: cfg.refinePivot, lookback: cfg.refineLookback, riskAtr: cfg.riskAtr, maxDist: cfg.maxDist };
  const fvg = findStructuralSetup(rC, dir, rcfg, price, bb, padAtr);
  if (fvg.plan) {
    const p = fvg.plan;
    raw.push({
      type: 'FVG', label: 'Sweep > CHoCH > FVG', base: 3,
      zone: { min: p.zone.min, max: p.zone.max }, entry: p.entry, sl: p.sl, risk: p.risk, dist: p.dist,
      orderType: 'LIMIT', ready: true,
      detail: `Sweep ${dir === 1 ? 'swing low' : 'swing high'} ${f(p.sweepLvl)} (wick ${f(p.sweepWick)}), CHoCH close ${f(p.chochClose)} menembus ${f(p.rangeLvl)}, FVG ${f(p.zone.min)} – ${f(p.zone.max)} belum termitigasi, entry 50% (${f(p.entry)}).`,
    });
  } else {
    rejects.push(`FVG: ${fvg.reason}`);
  }

  // b) OB dan c) S&D
  const zoneCands = (zones, type, label) => {
    const out = [];
    for (const z of zones) {
      const mid = (z.min + z.max) / 2;
      let inside, entry, extreme;
      if (dir === 1) {
        if (price < z.min) continue;
        inside = price <= z.max;
        if (inside && lastR.c < mid) continue;
        entry = inside ? price : z.max;
        extreme = z.min;
      } else {
        if (price > z.max) continue;
        inside = price >= z.min;
        if (inside && lastR.c > mid) continue;
        entry = inside ? price : z.min;
        extreme = z.max;
      }
      out.push({
        type, label, base: 2, zone: { min: z.min, max: z.max }, entry, extreme,
        orderType: inside ? 'NOW' : 'LIMIT', ready: false,
        detail: `${label} ${dir === 1 ? 'demand' : 'supply'} ${f(z.min)} – ${f(z.max)} ${cfg.refineTf}, ${inside ? `harga di dalam zona, entry market ${f(entry)}` : `limit di tepi terdekat ${f(entry)}`}.`,
      });
    }
    out.sort((a, b) => Math.abs(price - a.entry) - Math.abs(price - b.entry));
    return out.slice(0, 3);
  };
  raw.push(...zoneCands(findBosZones(rC, dir, cfg.refineLookback, cfg.refinePivot), 'OB', 'Order Block (BOS)'));
  raw.push(...zoneCands(findSDZones(rC, dir, aR, cfg.refineLookback), 'SND', 'Supply/Demand'));

  // d) Kontinuitas: struktur refine searah + pullback ke EMA20
  const sR = structureBias(rC, cfg.refinePivot);
  if (sR.dir === dir) {
    const emaArr = emaSeries(rC.map(c => c.c), cfg.ema[0]);
    const ema = emaArr[emaArr.length - 1];
    if (dir === 1 ? price > ema : price < ema) {
      const { highs, lows } = findPivots(rC, cfg.refinePivot);
      const list = dir === 1 ? lows : highs;
      let lv = null;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i].p;
        if (dir === 1 ? p < ema : p > ema) { lv = p; break; }
      }
      if (lv == null) {
        const rec = rC.slice(-12);
        lv = dir === 1 ? Math.min(ema, ...rec.map(c => c.l)) : Math.max(ema, ...rec.map(c => c.h));
      }
      raw.push({
        type: 'CONT', label: 'Kontinuitas EMA20', base: 1,
        zone: { min: ema, max: ema }, entry: ema, extreme: lv, orderType: 'LIMIT', ready: false,
        detail: `Kontinuitas: struktur ${cfg.refineTf} ${sR.src} searah HTF, limit di EMA${cfg.ema[0]} ${cfg.refineTf} ${f(ema)}.`,
      });
    } else {
      rejects.push(`Kontinuitas: harga belum pullback ke EMA${cfg.ema[0]} ${cfg.refineTf}.`);
    }
  } else {
    rejects.push(`Kontinuitas: struktur ${cfg.refineTf} (${sR.src}) belum searah HTF.`);
  }

  // Finalisasi: SL, jarak, risiko, skor
  const scored = [];
  for (const c of raw) {
    let { entry, sl, risk } = c;
    if (!c.ready) {
      sl = dir === 1 ? c.extreme - padAtr * aR : c.extreme + padAtr * aR;
      risk = Math.abs(entry - sl);
      if (risk > cfg.riskAtr[1] * aR) {
        rejects.push(`${c.label}: SL terlalu lebar (${(risk / aR).toFixed(1)} ATR, batas ${cfg.riskAtr[1]}).`);
        continue;
      }
      if (risk < cfg.riskAtr[0] * aR) {
        risk = cfg.riskAtr[0] * aR;
        sl = entry - dir * risk;
      }
    }
    const dist = Math.abs(price - entry) / aR;
    if (dist > cfg.maxDist) {
      rejects.push(`${c.label}: terlalu jauh dari harga (${dist.toFixed(1)} ATR, batas ${cfg.maxDist}).`);
      continue;
    }

    let score = c.base;
    const parts = [`${c.type} +${c.base}`];
    if (emaAligned) { score++; parts.push('EMA HTF +1'); }
    if (overlaps(c.zone, bigZones)) { score += 2; parts.push('zona HTF/MTF +2'); }
    if (dist <= 1) { score++; parts.push('dekat harga +1'); }
    if (bb.middle > 0 && (dir === 1 ? entry <= bb.middle : entry >= bb.middle)) {
      score++;
      parts.push(dir === 1 ? 'discount BB +1' : 'premium BB +1');
    }
    scored.push({ ...c, sl, risk, dist, score, parts });
  }

  if (!scored.length) {
    return { plan: null, reason: `Tidak ada area refine ${cfg.refineTf} yang valid. ${rejects.slice(-3).join(' ')}` };
  }

  scored.sort((a, b) => (b.score - a.score) || (a.dist - b.dist));
  const best = scored[0];

  if (best.score < cfg.minScore) {
    return {
      plan: null,
      reason: `Setup ${best.label} terbentuk, tapi kekuatannya ${best.score}/${MAX_SCORE_REFINE} (minimal ${cfg.minScore}). Sinyal ${styleKind} tidak dikeluarkan.`,
    };
  }

  // Refine lanjutan ke M5 (Intraday): zona OB / S&D M5 yang berpotongan dengan zona M15 terpilih
  const a5 = c5 && c5.length >= 30 ? atr(c5, 14) : 0;
  let fin = { entry: best.entry, sl: best.sl, risk: best.risk, orderType: best.orderType, zone: best.zone, refineNote: '' };
  if (styleKind === 'intraday' && a5 > 0 && best.type !== 'CONT') {
    const pick = refineInside(
      best.zone,
      zonesOfTf(c5, dir, 'M5', INTRA_M5.pivot, INTRA_M5.lookback),
      dir, price, c5[c5.length - 1].c
    );
    if (pick) {
      const entry5 = pick.inside ? price : (dir === 1 ? pick.max : pick.min);
      const far5 = dir === 1 ? pick.min : pick.max;
      let sl5 = dir === 1 ? far5 - padAtr * a5 : far5 + padAtr * a5;
      let risk5 = Math.abs(entry5 - sl5);
      if (risk5 <= cfg.riskAtr[1] * aR) {
        if (risk5 < cfg.riskAtr[0] * aR) {
          risk5 = cfg.riskAtr[0] * aR;
          sl5 = dir === 1 ? entry5 - risk5 : entry5 + risk5;
        }
        fin = {
          entry: entry5,
          sl: sl5,
          risk: risk5,
          orderType: pick.inside ? 'NOW' : 'LIMIT',
          zone: { min: pick.min, max: pick.max },
          refineNote: ` · refine M5 ${pick.kind} ${f(pick.min)}–${f(pick.max)}`,
        };
      }
    }
  }

  // TP
  let tps, tpTxt, tpNote = '';
  if (styleKind === 'intraday') {
    const fib = fibTargets(rC, dir, fin.entry, fin.risk, cfg.refinePivot, cfg.fib);
    tps = fib.tps;
    tpTxt = `TP1 & TP2 Fibonacci extension leg ${f(fib.A)} → ${f(fib.B)} (` +
      fib.used.map((u, i) => `TP${i + 1} ${u != null ? u : 'fallback 1R'}`).join(', ') + ').';
    tpNote = 'Fibonacci';
  } else {
    tps = [fin.entry + dir * rrList[0] * fin.risk];
    tpTxt = `TP tunggal 1:${rrList[0]}.`;
    tpNote = `1:${rrList[0]}`;
  }

  const riskAtr = fin.risk / aR;
  const riskLabel = riskAtr <= 1.5 ? 'LOW' : riskAtr <= 2.5 ? 'MEDIUM' : 'HIGH';
  const confidence = best.score >= 6 ? 'HIGH' : 'MEDIUM';
  const styleTxt = styleKind === 'intraday' ? 'Intraday (moderat)' : 'Swing (positioning)';

  const reason = [
    `${styleTxt} · market structure HTF ${biasTxt} (${st.src}).`,
    `EMA${cfg.ema[0]}/EMA${cfg.ema[1]} HTF ${emaAligned ? 'sejalan (+1 skor)' : 'belum sejalan (tidak memblokir sinyal)'}.`,
    `Refine ${cfg.refineTf}: ${best.detail}${fin.refineNote}`,
    `SL ${f(fin.sl)} (pad ${padAtr} ATR), jarak ${riskAtr.toFixed(1)} ATR ${cfg.refineTf}.`,
    `Kekuatan ${best.score}/${MAX_SCORE_REFINE} (${best.parts.join(', ')}) · minimal ${cfg.minScore}.`,
    tpTxt,
  ].join(' • ');

  return {
    dir,
    score: best.score,
    plan: {
      kind: styleKind,
      orderType: fin.orderType,
      status: fin.orderType === 'LIMIT' ? 'PENDING' : 'RUNNING',
      entry: fin.entry,
      bufferEnd: best.type === 'CONT' ? fin.entry : (dir === 1 ? fin.zone.min : fin.zone.max),
      sl: fin.sl,
      tps,
      zone: { min: fin.zone.min, max: fin.zone.max },
      expireMs: fin.orderType === 'LIMIT' ? cfg.expireMin * 60000 : 0,
      zoneNote: `Refine ${cfg.refineTf} ${best.label}${fin.refineNote ? ' → M5' : ''} · HTF ${biasTxt} · TP ${tpNote}`,
    },
    meta: { confidence, riskLabel, setup: 'CONTINUATION', reason },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const email = String(body.email || req.headers['x-user-email'] || '').trim().toLowerCase();
    const apiKey = String(process.env.TICKERLAYER_API_KEY || '').trim();

    const styleKey = body.tradingStyle || 'Scalping';
    const style = STYLES[styleKey] || STYLES['Scalping'];
    const symbol = String(body.marketId || '').split('|').pop().toUpperCase();
    const dec = DECIMALS[symbol] ?? 2;

    const access = await checkAccess(email);
    if (!access.ok) return res.status(403).json({ error: access.msg });

    const noSignal = reason => ({ ok: true, signal: null, reason });

    const dayKey = `sig_intraday_${email}_${symbol}_${isoDate(new Date())}`;
    if (style.kind === 'intraday') {
      const used = await kvGetJSON(dayKey);
      if (used) {
        return res.status(200).json(noSignal(
          `SINYAL INTRADAY ${symbol} HARI INI SUDAH ADA\n` +
          `Batas 1 sinyal kuat per hari (UTC).\n` +
          `${used.side} @ ${used.entry} · dikeluarkan ${used.time} WIB`
        ));
      }
    }

    let htfC = cleanCandles(body.candles?.htf);
    let mtfC = cleanCandles(body.candles?.mtf ?? body.candles?.entry);
    const price = Number(body.currentPrice) || (mtfC.length ? mtfC[mtfC.length - 1].c : 2000);

    let result;

    if (style.kind === 'scalp') {
      let m1 = [];
      if (GOLD_SYMBOLS.includes(symbol)) {
        m1 = cleanCandles(body.candles?.m1);
        if (m1.length < 30) m1 = (await getCandles(symbol, '1m', 150, apiKey)).candles;
        m1 = mergeLiveBar(m1, price, 1);
        if (m1.length < 30) {
          return res.status(200).json(noSignal(`Data M1 belum cukup untuk SL (${m1.length}/30).`));
        }
      }
      if (mtfC.length < 30) mtfC = (await getCandles(symbol, '5m', 150, apiKey)).candles;
      if (htfC.length < 20) htfC = (await getCandles(symbol, '15m', 100, apiKey)).candles;
      mtfC = mergeLiveBar(mtfC, price, 5);
      if (mtfC.length < 30) {
        return res.status(200).json(noSignal(`Data candle 5m belum cukup (${mtfC.length}/30).`));
      }

      // Area Day Trading: bias HTF 1H dan zona MTF 30m (sama dengan style Day Trading)
      const day = {
        htfC: mergeLiveBar((await getCandles(symbol, '1h', 60, apiKey)).candles, price, 60),
        mtfC: mergeLiveBar((await getCandles(symbol, '30m', 100, apiKey)).candles, price, 30),
      };

      result = buildScalpPlan({ htfC, mtfC, m1, price, rrList: style.rr, symbol, dec, day });

      // Cooldown XAUUSD hanya catatan di reason, tidak menahan sinyal.
      if (GOLD_SYMBOLS.includes(symbol) && result.plan) {
        const goldKey = `sig_gold_${email}_${symbol}`;
        const last = await kvGetJSON(goldKey);
        if (last && (Date.now() - last.t) < GOLD_EMA_CFG.cooldownMin * 60000) {
          const menit = Math.round((Date.now() - last.t) / 60000);
          result.meta.reason += ` • Catatan: sinyal ${last.dir === 1 ? 'BUY' : 'SELL'} terakhir ${menit} menit lalu.`;
        }
        await kvSetJSON(goldKey, { dir: result.dir, t: Date.now() }, 3600);
      }

    } else {
      const tf = STYLE_TF_SERVER[styleKey];
      const htfNeed = SETUP_CFG[style.kind].ema[1] + 5;
      const mtfNeed = 30;
      const note = { htf: `frontend ${htfC.length}`, mtf: `frontend ${mtfC.length}` };

      if (htfC.length < htfNeed) {
        const h = await getCandles(symbol, tf.htf, htfNeed, apiKey);
        note.htf = h.note;
        if (h.candles.length > htfC.length) htfC = h.candles;
      }
      if (mtfC.length < mtfNeed) {
        const m = await getCandles(symbol, tf.mtf, mtfNeed, apiKey);
        note.mtf = m.note;
        if (m.candles.length > mtfC.length) mtfC = m.candles;
      }
      if (htfC.length < htfNeed || mtfC.length < mtfNeed) {
        return res.status(200).json(noSignal(
          `DATA CANDLE BELUM CUKUP · ${style.label}\n` +
          `HTF ${tf.htf}: ${htfC.length}/${htfNeed} · MTF ${tf.mtf}: ${mtfC.length}/${mtfNeed}\n` +
          `Detail HTF: ${note.htf}\n` +
          `Detail MTF: ${note.mtf}`
        ));
      }

      htfC = mergeLiveBar(htfC, price, TF_MIN[tf.htf]);
      mtfC = mergeLiveBar(mtfC, price, TF_MIN[tf.mtf]);

      if (style.kind === 'day') {
        let c5 = cleanCandles(body.candles?.ltf);
        if (c5.length < 60) c5 = (await getCandles(symbol, '5m', 150, apiKey)).candles;
        c5 = mergeLiveBar(c5, price, 5);
        if (c5.length < 30) {
          return res.status(200).json(noSignal(`Data M5 belum cukup untuk refine zone & SL (${c5.length}/30).`));
        }
        // Day Trading juga refine sampai M1
        let m1 = cleanCandles(body.candles?.m1);
        if (m1.length < 30) m1 = (await getCandles(symbol, '1m', 150, apiKey)).candles;
        m1 = mergeLiveBar(m1, price, 1);
        result = buildDayPlan({ htfC, mtfC, c5, m1, symbol, price, rrList: style.rr, dec });
      } else {
        // Intraday (M15) & Swing (H1): candle refine dari server agar TF pasti sesuai
        const rf = await getCandles(symbol, tf.refine, 150, apiKey);
        const rC = mergeLiveBar(rf.candles, price, TF_MIN[tf.refine]);
        if (rC.length < 40) {
          return res.status(200).json(noSignal(
            `DATA CANDLE REFINE ${tf.refine.toUpperCase()} BELUM CUKUP (${rC.length}/40)\nDetail: ${rf.note}`
          ));
        }
        // Intraday juga butuh M5 untuk refine lanjutan
        let c5 = [];
        if (style.kind === 'intraday') {
          c5 = cleanCandles(body.candles?.ltf);
          if (c5.length < 60) c5 = (await getCandles(symbol, '5m', 150, apiKey)).candles;
          c5 = mergeLiveBar(c5, price, 5);
        }
        result = buildRefinePlan({
          htfC, mtfC, rC, c5, styleKind: style.kind, price, dec, symbol, rrList: style.rr,
        });
      }
    }

    if (!result.plan) {
      return res.status(200).json(noSignal(`TIDAK ADA SINYAL · ${style.label}\n${result.reason}`));
    }

    const { dir, plan, meta } = result;

    if (style.kind === 'intraday') {
      await kvSetJSON(dayKey, {
        side: dir === 1 ? 'BUY' : 'SELL',
        entry: Number(plan.entry.toFixed(dec)),
        time: new Date().toLocaleTimeString('id-ID', TIME_FMT),
      }, 36 * 3600);
    }

    const r = v => Number(v.toFixed(dec));
    const tps = plan.tps;
    const tpAt = i => (tps[i] != null ? r(tps[i]) : null);

    return res.status(200).json({
      ok: true,
      signal: {
        signal: dir === 1 ? 'BUY' : 'SELL',
        mode: plan.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET',
        orderType: plan.orderType,
        orderLabel: orderLabel(dir, plan.orderType),
        status: plan.status,
        entry: r(plan.entry),
        bufferEnd: r(plan.bufferEnd ?? plan.entry),
        sl: r(plan.sl),
        tp1: tpAt(0), tp2: tpAt(1), tp3: tpAt(2),
        tpCount: tps.length,
        zone: plan.zone ? { min: r(plan.zone.min), max: r(plan.zone.max) } : null,
        expireMs: plan.expireMs || 0,
        confidence: meta.confidence,
        risk: meta.riskLabel,
        setup: meta.setup,
        entryStyle: style.entryStyle,
        setupLabel: style.label,
        zoneLabel: plan.orderType === 'LIMIT' ? 'Limit Order Zone (Waiting)' : 'Market Execution Zone',
        zoneNote: plan.zoneNote,
        reason: meta.reason,
      },
    });
  } catch (err) {
    console.error('generate error stack:', err);
    return res.status(200).json({ ok: false, error: 'Server error: ' + (err.message || 'Unknown error') });
  }
}
