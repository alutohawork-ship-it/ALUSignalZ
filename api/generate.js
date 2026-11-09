// api/generate.js
// v12
//  - Acuan arah SELALU market structure (BOS / HH-HL / LH-LL). EMA hanya pendukung.
//  - Day Trading:
//      1) Zona S/D berbasis BOS (HTF lalu MTF). Harga di dalam zona + reaksi → NOW, di luar zona → LIMIT di tepi terdekat.
//      2) Tanpa zona, struktur MTF harus searah HTF:
//           BOS MTF → NOW | harga sejalan EMA20 MTF → LIMIT di EMA | lainnya → LIMIT di swing MTF terdekat.
//      SL = 1,5 × jarak SL scalping 5m. TP 1:2 / 1:3 / 1:4. ATR hanya untuk padding, tanpa batas min/max.
//  - Scalping : arah dari structure 5m (cadangan 15m).
//      XAUUSD → SL mode 'clamp': swing M1 terdekat, dibatasi 30–35 pip (1 pip = 0.10).
//      Pair lain → SL = swing 5m + padding. Tanpa batas ATR.
//  - Intraday : Sweep > CHoCH > FVG, skor kekuatan, maks 1 sinyal kuat per hari (UTC) per user per pair.
//  - Swing    : Sweep > CHoCH > FVG.
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
  'Scalping': { label: 'Scalping Agresif (SL struktur 5m · XAUUSD: swing M1 30–35 pip)', mode: 'MARKET', kind: 'scalp', rr: [1.0, 2.0, 3.0] },
  'Day Trading': { label: 'Day Trading (Zona BOS HTF-MTF · Continuation EMA · SL 1,5× scalping)', mode: 'LIMIT', kind: 'day', rr: [2.0, 3.0, 4.0] },
  'Intraday': { label: 'Intraday (Sweep > CHoCH > FVG · 1 sinyal kuat/hari)', mode: 'LIMIT', kind: 'intraday', rr: [1.5, 3.0, 5.5] },
  'Swing': { label: 'Swing Trading (Sweep > CHoCH > FVG + Multi EMA + BB)', mode: 'LIMIT', kind: 'swing', rr: [2.0, 4.5, 8.5] },
};

const SETUP_CFG = {
  day:      { ema: [20, 50], pivot: 3, lookback: 80, expireMin: 240 },
  intraday: { ema: [20, 50], pivot: 3, lookback: 80, riskAtr: [0.8, 3.0], maxDist: 2.0, expireMin: 720, minScore: 5 },
  swing:    { ema: [20, 50], pivot: 4, lookback: 80, riskAtr: [1.0, 3.5], maxDist: 1.5, expireMin: 2880 },
};

const SCALP_PIVOT = 2;
const DAY_SL_MULT = 1.5;

// Konfigurasi SL XAUUSD untuk Scalping
// mode: 'fixed' | 'swing' | 'clamp'
const GOLD_SL_CFG = {
  scalpMode: 'clamp',
  fixedPips: 30,     // dipakai jika mode 'fixed'
  minPips: 30,       // batas bawah jarak SL (mode 'clamp')
  maxPips: 35,       // batas atas jarak SL (mode 'clamp')
  pipSize: 0.1,      // 1 pip = 0.10 (4000 → 4001 = 10 pip)
};

// Konfigurasi SL M1 terdekat untuk XAUUSD
const GOLD_M1_SL = {
  pivot: 2,          // swing M1 L=2 agar swing terdekat cukup tersedia
  lookback: 45,      // cari swing dalam 45 candle M1 terakhir
  minDistAtr: 0.4,   // swing yang terlalu dekat dengan harga (noise) diabaikan
  maxRiskAtr: 3.0,   // jarak SL lebih dari 3 ATR M1 → skip (hanya mode 'swing')
  padAtr: 0.2,       // padding dalam ATR M1
};

const STYLE_TF_SERVER = {
  'Day Trading': { htf: '1h', mtf: '30m' },
  'Intraday':    { htf: '4h', mtf: '1h' },
  'Swing':       { htf: '1d', mtf: '4h' },
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

// Supply/Demand versi lama (dipakai Intraday/Swing untuk skor). Tidak diubah.
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

// Zona berbasis BOS: base candle berlawanan terakhir sebelum close menembus swing terakhir.
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

// Sweep > CHoCH > FVG untuk Intraday & Swing (tidak diubah)
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

  // Fallback: low/high terdekat dalam lookback jika tidak ada swing valid
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

// SL tetap XAUUSD: jarak fixedPips dari entry
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

function scoreStructure(p, htfZones, aM, emaAligned) {
  let s = 1;
  if (emaAligned) s++;
  if (Math.abs(p.sweepLvl - p.sweepWick) / aM >= 0.3) s++;
  if (Math.abs(p.chochClose - p.rangeLvl) / aM >= 0.2) s++;
  if (htfZones.some(z => z.max >= p.zone.min && z.min <= p.zone.max)) s += 2;
  if (p.dist <= 1) s++;
  return s;
}

// Scalping: XAUUSD pakai SL mode GOLD_SL_CFG.scalpMode, pair lain pakai swing 5m
function buildScalpPlan({ htfC, mtfC, m1, price, rrList, symbol, dec }) {
  const s5 = structureBias(mtfC, SCALP_PIVOT);
  const s15 = structureBias(htfC, SETUP_CFG.day.pivot);
  const dir = s5.dir !== 0 ? s5.dir : s15.dir;
  if (dir === 0) {
    return { plan: null, reason: `Market structure 5m dan 15m belum jelas (5m: ${s5.src}, 15m: ${s15.src}).` };
  }
  const srcTxt = s5.dir !== 0 ? `5m ${s5.src}` : `15m ${s15.src}`;
  const f = v => Number(v).toFixed(dec);

  let sc;
  if (GOLD_SYMBOLS.includes(symbol)) {
    sc = goldSL(m1, price, dir, GOLD_SL_CFG.scalpMode);
    if (GOLD_SL_CFG.scalpMode === 'swing') {
      const riskAtrM1 = sc.risk / sc.atr;
      if (riskAtrM1 > GOLD_M1_SL.maxRiskAtr) {
        return { plan: null, reason: `SL swing M1 terdekat terlalu jauh (${riskAtrM1.toFixed(1)} ATR M1, batas ${GOLD_M1_SL.maxRiskAtr}).` };
      }
    }
  } else {
    sc = scalpSL(mtfC, price, dir, symbol);
  }

  const bufferEnd = price - dir * 0.5 * sc.atr;
  const riskAtr = sc.risk / sc.atr;
  const riskLabel = riskAtr <= 1.5 ? 'LOW' : riskAtr <= 2.5 ? 'MEDIUM' : 'HIGH';

  const reason = [
    `Scalping ${dir === 1 ? 'BUY' : 'SELL'} MARKET pada ${symbol}, arah dari market structure ${srcTxt}.`,
    `SL: ${sc.src} ${f(sc.level)}${sc.pad ? ` + pad ${f(sc.pad)}` : ''}.`,
    `Jarak SL ${f(sc.risk)}.`,
    `RRR: TP1 1:${rrList[0]}, TP2 1:${rrList[1]}, TP3 1:${rrList[2]}.`,
  ].join(' • ');

  return {
    dir,
    plan: {
      kind: 'scalp',
      orderType: 'NOW',
      status: 'RUNNING',
      entry: price,
      bufferEnd,
      sl: sc.sl,
      tps: rrList.map(rr => price + dir * rr * sc.risk),
      zone: { min: Math.min(price, bufferEnd), max: Math.max(price, bufferEnd) },
      expireMs: 0,
      zoneNote: `Scalp · SL ${sc.src}`,
    },
    meta: {
      confidence: riskLabel === 'LOW' ? 'HIGH' : 'MEDIUM',
      riskLabel,
      setup: 'CONTINUATION',
      reason,
    },
  };
}

// Day Trading
function buildDayPlan({ htfC, mtfC, c5, symbol, price, rrList, dec }) {
  const cfg = SETUP_CFG.day;
  const aM = atr(mtfC, 14);
  const f = v => Number(v).toFixed(dec);

  const st = structureBias(htfC, cfg.pivot);
  if (st.dir === 0) {
    return { plan: null, reason: `Market structure HTF belum jelas (${st.src}): belum ada HH/HL, LH/LL, atau BOS.` };
  }
  const dir = st.dir;
  const dirTxt = dir === 1 ? 'BULLISH' : 'BEARISH';

  const sc = scalpSL(c5, price, dir, symbol);
  const dayRisk = DAY_SL_MULT * sc.risk;
  const riskAtr = dayRisk / aM;
  const riskLabel = riskAtr <= 1.5 ? 'LOW' : riskAtr <= 2.5 ? 'MEDIUM' : 'HIGH';

  // 1) Zona BOS: HTF diutamakan, lalu MTF, lalu yang terdekat dengan harga
  const zoneList = [
    ...findBosZones(htfC, dir, 60, cfg.pivot).map(z => ({ ...z, tf: 'HTF' })),
    ...findBosZones(mtfC, dir, cfg.lookback, cfg.pivot).map(z => ({ ...z, tf: 'MTF' })),
  ];
  const lastClose = mtfC[mtfC.length - 1].c;
  const cands = [];
  for (const z of zoneList) {
    const mid = (z.min + z.max) / 2;
    if (dir === 1) {
      if (price < z.min) continue;
      const inside = price <= z.max;
      if (inside && lastClose < mid) continue;
      cands.push({ ...z, inside, dist: inside ? 0 : price - z.max });
    } else {
      if (price > z.max) continue;
      const inside = price >= z.min;
      if (inside && lastClose > mid) continue;
      cands.push({ ...z, inside, dist: inside ? 0 : z.min - price });
    }
  }
  cands.sort((a, b) => (a.tf === b.tf ? a.dist - b.dist : (a.tf === 'HTF' ? -1 : 1)));

  let entry, orderType, far, confidence, modeTxt, zoneDisplay, zoneNote;

  if (cands.length) {
    const z = cands[0];
    orderType = z.inside ? 'NOW' : 'LIMIT';
    entry = z.inside ? price : (dir === 1 ? z.max : z.min);
    far = dir === 1 ? z.min : z.max;
    confidence = z.tf === 'HTF' ? 'HIGH' : 'MEDIUM';
    zoneDisplay = { min: z.min, max: z.max };
    zoneNote = `S/D ${z.tf} (BOS) · ${z.inside ? 'INSIDE' : 'LIMIT'}`;
    modeTxt = `Zona ${z.tf} ${dir === 1 ? 'demand' : 'supply'} ${f(z.min)} – ${f(z.max)} (BOS). ` +
      (z.inside
        ? `Harga di dalam zona dan close MTF sudah berbalik, entry market ${f(entry)}.`
        : `Harga ${dir === 1 ? 'di atas' : 'di bawah'} zona, limit di tepi terdekat ${f(entry)}.`);
  } else {
    // 2) Tanpa zona: struktur MTF harus searah HTF
    const s30 = structureBias(mtfC, cfg.pivot);
    if (s30.dir !== dir) {
      return { plan: null, reason: `Tidak ada zona S/D yang belum termitigasi, dan struktur MTF (${s30.src}) belum searah HTF.` };
    }

    const emaArr = emaSeries(mtfC.map(c => c.c), cfg.ema[0]);
    const ema = emaArr[emaArr.length - 1];
    far = null;
    zoneDisplay = null;

    if (s30.src.startsWith('BOS')) {
      entry = price;
      orderType = 'NOW';
      confidence = 'MEDIUM';
      modeTxt = `Momentum: BOS MTF searah HTF, entry market ${f(price)}.`;
    } else if (dir === 1 ? price > ema : price < ema) {
      entry = ema;
      orderType = 'LIMIT';
      confidence = 'MEDIUM';
      modeTxt = `Continuation: harga ${dir === 1 ? 'di atas' : 'di bawah'} EMA${cfg.ema[0]} MTF, limit di EMA ${f(ema)}.`;
    } else {
      const { highs, lows } = findPivots(mtfC, cfg.pivot);
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
        modeTxt = `Pullback: limit di swing ${dir === 1 ? 'low' : 'high'} MTF ${f(lv)}.`;
      } else {
        entry = price;
        orderType = 'NOW';
        confidence = 'LOW';
        modeTxt = `Tidak ada swing pullback, entry market ${f(price)}.`;
      }
    }
    zoneDisplay = { min: entry, max: entry };
    zoneNote = `Struktur MTF · ${orderType}`;
  }

  // SL = 1,5 × jarak SL scalping, diukur dari entry
  let sl = dir === 1 ? entry - dayRisk : entry + dayRisk;
  let widened = false;
  if (far != null) {
    // SL tidak boleh berada di dalam zona: minimal di sisi jauh zona + padding
    const guard = dir === 1 ? far - sc.pad : far + sc.pad;
    if (dir === 1 ? sl > guard : sl < guard) { sl = guard; widened = true; }
  }

  const risk = Math.abs(entry - sl);
  const tps = rrList.map(rr => entry + dir * rr * risk);

  const reason = [
    `Market structure HTF ${dirTxt} (${st.src}).`,
    modeTxt,
    `SL = 1,5 × jarak scalp: ${f(sc.risk)} (${sc.src} ${f(sc.level)}) → ${f(dayRisk)}${widened ? ', diperlebar ke sisi jauh zona' : ''}.`,
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

// Intraday & Swing (tidak diubah)
function buildStructPlan({ htfC, mtfC, styleKind, price, rrList, bb, dec, symbol }) {
  const cfg = SETUP_CFG[styleKind];
  const minHtf = cfg.ema[1] + 5;
  if (htfC.length < minHtf || mtfC.length < 30) {
    return { plan: null, reason: `Data candle belum cukup (HTF min ${minHtf}, MTF min 30).` };
  }

  const st = structureBias(htfC, cfg.pivot);
  if (st.dir === 0) {
    return { plan: null, reason: `Market structure HTF belum jelas (${st.src}): belum ada HH/HL, LH/LL, atau BOS.` };
  }
  const emaH = emaState(htfC, cfg);
  const emaAligned = emaH.dir === st.dir;

  const padAtr = padAtrFor(symbol);
  const found = findStructuralSetup(mtfC, st.dir, cfg, price, bb, padAtr);
  if (!found.plan) return { plan: null, reason: found.reason };

  const p = found.plan;
  const dir = p.dir;
  const aH = atr(htfC, 14);
  const htfZones = findSDZones(htfC, dir, aH, 60);
  const score = scoreStructure(p, htfZones, p.atr, emaAligned);

  if (styleKind === 'intraday' && score < cfg.minScore) {
    return {
      plan: null,
      reason: `Setup terbentuk, tapi kekuatannya ${score}/7 (minimal ${cfg.minScore}). Sinyal intraday tidak dikeluarkan.`,
    };
  }

  const f = v => Number(v).toFixed(dec);
  const riskAtr = p.risk / p.atr;
  const riskLabel = riskAtr <= 1.5 ? 'LOW' : riskAtr <= 2.5 ? 'MEDIUM' : 'HIGH';
  const confidence = score >= 6 ? 'HIGH' : 'MEDIUM';
  const biasTxt = dir === 1 ? 'BULLISH' : 'BEARISH';
  const bbTxt = (bb && bb.middle > 0)
    ? `BB: entry ${f(p.entry)} di ${dir === 1 ? 'discount' : 'premium'} (BB middle ${f(bb.middle)}).`
    : 'BB: data belum tersedia.';

  const reason = [
    `Market structure HTF ${biasTxt} (${st.src}).`,
    `EMA${cfg.ema[0]}/EMA${cfg.ema[1]} HTF ${emaAligned ? 'sejalan (+1 skor)' : 'belum sejalan (tidak memblokir sinyal)'}.`,
    `Sweep ${dir === 1 ? 'swing low' : 'swing high'} ${f(p.sweepLvl)} (wick ${f(p.sweepWick)}), CHoCH close ${f(p.chochClose)} menembus ${f(p.rangeLvl)}.`,
    `FVG ${f(p.zone.min)} – ${f(p.zone.max)} belum termitigasi, entry 50% (${f(p.entry)}).`,
    bbTxt,
    `SL struktur ${f(p.sl)} (pad ${padAtr} ATR), jarak ${riskAtr.toFixed(1)} ATR MTF.`,
    `Kekuatan ${score}/7${styleKind === 'intraday' ? ` (minimal ${cfg.minScore})` : ''}.`,
    `RRR: TP1 1:${rrList[0]}, TP2 1:${rrList[1]}, TP3 1:${rrList[2]}.`,
  ].join(' • ');

  return {
    dir,
    score,
    plan: {
      kind: styleKind,
      orderType: 'LIMIT',
      status: 'PENDING',
      entry: p.entry,
      bufferEnd: dir === 1 ? p.zone.min : p.zone.max,
      sl: p.sl,
      tps: rrList.map(rr => p.entry + dir * rr * p.risk),
      zone: { min: p.zone.min, max: p.zone.max },
      expireMs: cfg.expireMin * 60000,
      zoneNote: `Sweep > CHoCH > FVG · HTF ${biasTxt}`,
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
      result = buildScalpPlan({ htfC, mtfC, m1, price, rrList: style.rr, symbol, dec });

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
        if (c5.length < 30) c5 = (await getCandles(symbol, '5m', 150, apiKey)).candles;
        c5 = mergeLiveBar(c5, price, 5);
        if (c5.length < 30) {
          return res.status(200).json(noSignal(`Data 5m belum cukup untuk SL scalping (${c5.length}/30).`));
        }
        result = buildDayPlan({ htfC, mtfC, c5, symbol, price, rrList: style.rr, dec });
      } else {
        result = buildStructPlan({
          htfC, mtfC, styleKind: style.kind, price, rrList: style.rr,
          bb: calculateBollingerBands(mtfC), dec, symbol,
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
        tp1: r(tps[0]), tp2: r(tps[1]), tp3: r(tps[2]),
        zone: plan.zone ? { min: r(plan.zone.min), max: r(plan.zone.max) } : null,
        expireMs: plan.expireMs || 0,
        confidence: meta.confidence,
        risk: meta.riskLabel,
        setup: meta.setup,
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
