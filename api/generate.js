// api/generate.js
// v49
//  - Scalping:
//      · harga di area demand M5 → BUY NOW, area supply M5 → SELL NOW (area dari candle M5 yang sudah close)
//      · di luar kedua area → NOW langsung searah arah awal market M1:
//          BOS M1 → HH+HL / LH+LL → price action M1 (close vs close sebelumnya). Selalu ada arah, tanpa menunggu.
//      · SL dari tepi wick area, atau pivot M1 berlawanan / ekstrem 10 candle terakhir. Dibatasi 25-30 pip.
//      · reason memberi peringatan jika arah M1 berlawanan dengan area, atau ada area berlawanan dekat harga
//  - Day Trading: BOS M15 (bias) → zona S/D M15 (displacement + BOS, fresh) → refine zona S/D M5 → entry:
//      · harga di luar zona  → LIMIT di tepi zona (maks. 50 pip dari harga)
//      · harga sudah di zona → NOW, hanya jika konfirmasi Bollinger Band M5
//    Tanpa zona valid, sinyal tidak dikeluarkan.
//  - Pure Market Execution (NOW) dengan SL aman anti-noise.
//  - TickerLayer API Key Rotations terintegrasi utuh.

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

const STYLES = {
  'Scalping': {
    label: 'Scalping · Area S/D M5 (BUY demand / SELL supply) + NOW arah awal M1 di luar area · SL 25-30 Pip · TP 1:1 · 1:2 · 1:3',
    entryStyle: 'Agresif', mode: 'MARKET', kind: 'scalp', rr: [1.0, 2.0, 3.0],
  },
  'Day Trading': {
    label: 'Day Trading · M15 BOS + Zona S/D M15/M5 + BB M5 · Limit di tepi zona (SL 50-120 Pip · TP 1:1 · 1:1.5 · 1:2)',
    entryStyle: 'Konservatif', mode: 'LIMIT', kind: 'day', rr: [1.0, 1.5, 2.0],
  },
  'Intraday': { label: 'Intraday', kind: 'intraday', rr: [] },
  'Swing': { label: 'Swing', kind: 'swing', rr: [3.0] },
};

// ── Scalping (area S/D M5, arah awal M1) ──
const SCALP_PIVOT = 2;
const SCALP_ZONE_TF = 5;                // area scalping dari candle M5 (agregasi M1), hanya candle yang sudah close
const SCALP_ZONE_LOOKBACK_M5 = 60;      // area M5 harus terbentuk dalam 60 candle M5 terakhir
const SCALP_ZONE_DISP_ATR = 0.8;        // displacement scalping M5: body minimal 0.8 × ATR
const SCALP_ZONE_FRESH_ONLY = true;     // true = area yang sudah pernah tersentuh dibuang (matikan jika area terlalu sedikit)
const SCALP_ZONE_NEEDS_CONFIRM = false; // false = masuk langsung saat harga di area; true = tunggu reaksi M1 dulu
const SCALP_ZONE_REQUIRE_BIAS = false;  // true = demand hanya dipakai jika bias M5 bullish, supply jika bearish
const SCALP_NEAR_ZONE_PIPS = 15;        // area berlawanan dalam 15 pip dari harga → diberi peringatan
const SCALP_M1_NEED = 160;              // ±160 candle M1 (≈32 candle M5)
const SCALP_CHASE_MAX_PIPS = 15;        // dipakai hanya jika SCALP_ZONE_NEEDS_CONFIRM = true
const SCALP_SL_BUFFER_PIPS = 3;         // buffer SL di luar wick area / pivot M1
const MIN_SL_PIPS = 25;
const MAX_SL_PIPS = 30;
const PIP_SIZE = 0.1;                   // XAUUSD: 1 pip = 0.1

// ── Day Trading ──
const DAY_PIVOT = 3;            // pivot M15 untuk BOS
const DAY_BOS_LOOKBACK = 60;    // BOS dicari dalam 60 candle M15 terakhir
const DAY_OB_LOOKBACK = 12;     // displacement zona M15 harus maks. 12 candle sebelum BOS
const DAY_LIMIT_MAX_PIPS = 50;  // limit hanya dipasang jika harga maks. 50 pip dari tepi zona
const DAY_ZONE_TOL_PIPS = 10;   // toleransi harga untuk konfirmasi BB pada harga limit
const DT_MIN_SL_PIPS = 50;
const DT_MAX_SL_PIPS = 120;
const DT_SL_BUFFER_PIPS = 5;

// ── Zona Supply/Demand (default untuk Day Trading M15/M5) ──
const ZONE_ATR_PERIOD = 14;
const ZONE_DISP_ATR = 1.2;       // displacement: body minimal 1.2 × ATR
const ZONE_MAX_ATR = 2.5;        // tinggi zona maks. 2.5 × ATR
const ZONE_REQUIRE_FVG = false;  // true = displacement wajib meninggalkan FVG
const ZONE_FRESH_ONLY = true;    // true = zona yang sudah pernah disentuh dibuang

// ── Bollinger (hanya Day Trading M5) ──
const BB_PERIOD = 20;
const BB_MULT = 2;

const orderLabel = (dir, orderType) => `${dir === 1 ? 'BUY' : 'SELL'} ${orderType === 'LIMIT' ? 'LIMIT' : 'NOW'}`;
const isoDate = d => d.toISOString().slice(0, 10);
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

const TL_SPAN = {
  '1m':  { mult: 1,  span: 'minute', minutes: 1 },
  '5m':  { mult: 5,  span: 'minute', minutes: 5 },
  '15m': { mult: 15, span: 'minute', minutes: 15 },
};
const CACHE_TTL = { '1m': 120, '5m': 300, '15m': 600 };
const CACHE_BARS = { '1m': 300, '5m': 300, '15m': 300 };

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

// Bangun candle berjangka tfMin menit dari candle M1 (mis. 5 candle M1 → 1 candle M5)
function aggregateFromM1(m1, tfMin) {
  const ms = tfMin * 60000;
  const map = new Map();
  for (const c of m1) {
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

// Bollinger Band pada indeks tertentu (SMA periode N dan standar deviasi close)
function bollingerAt(candles, idx, period = BB_PERIOD, mult = BB_MULT) {
  if (idx < period - 1 || idx >= candles.length) return null;
  const closes = candles.slice(idx - period + 1, idx + 1).map(c => c.c);
  const mid = closes.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(closes.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
  return { mid, upper: mid + mult * sd, lower: mid - mult * sd };
}

// Arah awal market M1: BOS → HH+HL / LH+LL → price action (close vs close sebelumnya).
// Selalu menghasilkan arah (1 atau -1), sehingga jalur di luar area tidak menunggu.
function analyzePureSMCStructure(m1) {
  if (!m1 || m1.length < 15) return { dir: 1, src: 'SMC Default' };
  const { highs, lows } = findPivots(m1, SCALP_PIVOT);
  if (highs.length < 2 || lows.length < 2) {
    const last = m1[m1.length - 1], prev = m1[m1.length - 2];
    return { dir: last.c >= prev.c ? 1 : -1, src: 'Price action M1' };
  }
  const [h1, h2] = highs.slice(-2);
  const [l1, l2] = lows.slice(-2);
  const lastC = m1[m1.length - 1].c;

  if (lastC > h2.p) return { dir: 1, src: 'M1 BOS Bullish' };
  if (lastC < l2.p) return { dir: -1, src: 'M1 BOS Bearish' };
  if (h2.p > h1.p && l2.p > l1.p) return { dir: 1, src: 'M1 Structure HH + HL' };
  if (h2.p < h1.p && l2.p < l1.p) return { dir: -1, src: 'M1 Structure LH + LL' };
  return { dir: lastC >= m1[m1.length - 2].c ? 1 : -1, src: 'M1 Order Flow' };
}

// Bias struktur: BOS, HH+HL, atau LH+LL. dir = 0 jika belum jelas (dipakai untuk filter M5 opsional).
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

// BOS terbaru: candle yang close menembus swing high/low yang sudah terkonfirmasi
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

// Displacement menembus swing high/low sebelum base (BOS)
function isBOSAfter(candles, base, k, dir) {
  const window = candles.slice(Math.max(0, base - 10), base);
  if (!window.length) return false;
  const ext = dir === 1 ? Math.max(...window.map(c => c.h)) : Math.min(...window.map(c => c.l));
  const after = candles.slice(k, Math.min(k + 3, candles.length - 1));
  return after.some(c => (dir === 1 ? c.c > ext : c.c < ext));
}

// Zona Supply/Demand yang valid:
//  - displacement: candle searah dengan body >= dispAtr × ATR
//  - base: candle lawan arah terakhir, maks. 3 candle sebelum displacement
//  - displacement menembus swing sebelumnya (BOS), opsional meninggalkan FVG
//  - zona belum ditembus close, dan (jika freshOnly) belum pernah disentuh setelah terbentuk
// opts: { dispAtr, freshOnly } (default ikut konstanta ZONE_*)
// Hasil diurutkan dari zona terdekat ke harga.
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

    if (ZONE_REQUIRE_FVG) {
      const fvg = dir === 1 ? candles[k - 1].h < candles[k + 1].l : candles[k - 1].l > candles[k + 1].h;
      if (!fvg) continue;
    }

    // Belum ditembus close setelah terbentuk; jika freshOnly, belum pernah disentuh
    const after = candles.slice(k + 1, n - 1);
    if (after.some(x => (dir === 1 ? x.c < sl : x.c > sl))) continue;
    if (freshOnly && after.some(x => (dir === 1 ? x.l <= top : x.h >= bottom))) continue;

    // Harus di sisi yang benar terhadap harga dan belum ditembus
    if (dir === 1 && (bottom > price || price < sl)) continue;
    if (dir === -1 && (top < price || price > sl)) continue;

    const dist = dir === 1 ? Math.max(0, price - top) : Math.max(0, bottom - price);
    zones.push({ top, bottom, sl, idx: base, dispIdx: k, dist });
  }
  return zones.sort((x, y) => x.dist - y.dist);
}

// ═══════════════════════════ SCALPING (area S/D M5 + arah awal M1) ═══════════════════════════

const scalpZoneOpts = { dispAtr: SCALP_ZONE_DISP_ATR, freshOnly: SCALP_ZONE_FRESH_ONLY };
const scalpRecent = m5c => z => z.dispIdx >= m5c.length - SCALP_ZONE_LOOKBACK_M5;

// Reaksi M1 searah dir: pivot pullback sudah selesai, lalu harga menembus level pullback.
// Dipakai hanya jika SCALP_ZONE_NEEDS_CONFIRM = true.
function m1Reaction(m1, dir, price, dec) {
  const f = v => Number(v).toFixed(dec);
  const { highs, lows } = findPivots(m1, SCALP_PIVOT);
  if (!highs.length || !lows.length) return { ok: false, why: 'struktur M1 belum terbentuk' };
  const lastH = highs[highs.length - 1];
  const lastL = lows[lows.length - 1];

  let breakLevel = null;
  let pullbackExtreme = null;
  if (dir === 1 && lastL.i > lastH.i) {
    breakLevel = lastH.p;
    pullbackExtreme = lastL.p;
  } else if (dir === -1 && lastH.i > lastL.i) {
    breakLevel = lastL.p;
    pullbackExtreme = lastH.p;
  }
  if (breakLevel == null) return { ok: false, why: 'pullback M1 belum selesai' };

  const beyondPips = ((price - breakLevel) * dir) / PIP_SIZE;
  if (beyondPips <= 0) return { ok: false, why: `menunggu M1 menembus ${f(breakLevel)}` };
  if (beyondPips > SCALP_CHASE_MAX_PIPS) {
    return { ok: false, why: `harga ${beyondPips.toFixed(0)} pip melewati ${f(breakLevel)}, tidak dikejar` };
  }
  return { ok: true, why: '', breakLevel, pullbackExtreme, beyondPips };
}

// Ekstrem 10 candle M1 terakhir di sisi berlawanan arah (dipakai sebagai SL jika pivot tidak valid)
function recentExtreme(m1, dir) {
  const slice = m1.slice(-11);
  return dir === 1 ? Math.min(...slice.map(c => c.l)) : Math.max(...slice.map(c => c.h));
}

// Area M5 terdekat untuk reason: supply di atas dan demand di bawah harga
function areaNote(m5c, price, dec) {
  const f = v => Number(v).toFixed(dec);
  const recent = scalpRecent(m5c);
  const sup = findSDZones(m5c, -1, price, scalpZoneOpts).filter(recent)[0];
  const dem = findSDZones(m5c, 1, price, scalpZoneOpts).filter(recent)[0];
  const parts = [];
  if (sup) {
    const d = sup.dist === 0 ? 'sudah di dalam' : `${(sup.dist / PIP_SIZE).toFixed(0)} pip di atas`;
    parts.push(`supply ${f(sup.bottom)} - ${f(sup.top)} (${d})`);
  }
  if (dem) {
    const d = dem.dist === 0 ? 'sudah di dalam' : `${(dem.dist / PIP_SIZE).toFixed(0)} pip di bawah`;
    parts.push(`demand ${f(dem.bottom)} - ${f(dem.top)} (${d})`);
  }
  return parts.length
    ? `Area M5 terdekat: ${parts.join(', ')}`
    : `Tidak ada area S/D M5 valid dalam ${SCALP_ZONE_LOOKBACK_M5} candle terakhir`;
}

function buildScalpPlan({ m1, price, rrList, symbol, dec }) {
  const f = v => Number(v).toFixed(dec);
  const minRisk = MIN_SL_PIPS * PIP_SIZE;
  const maxRisk = MAX_SL_PIPS * PIP_SIZE;
  const buffer = SCALP_SL_BUFFER_PIPS * PIP_SIZE;

  // 1. Area S/D M5 tempat harga berada sekarang (candle M5 yang sudah close)
  const m5c = aggregateFromM1(m1, SCALP_ZONE_TF).slice(0, -1);
  const inside = z => price >= z.bottom && price <= z.top;
  const recent = scalpRecent(m5c);
  const demand = findSDZones(m5c, 1, price, scalpZoneOpts).filter(inside).filter(recent)[0] || null;
  const supply = demand ? null : (findSDZones(m5c, -1, price, scalpZoneOpts).filter(inside).filter(recent)[0] || null);
  const zone = demand || supply;

  // 2. Arah awal market M1 (selalu ada arahnya)
  const init = analyzePureSMCStructure(m1);
  const { highs, lows } = findPivots(m1, SCALP_PIVOT);
  const lastH = highs.length ? highs[highs.length - 1] : null;
  const lastL = lows.length ? lows[lows.length - 1] : null;

  let dir;
  let baseLevel;
  let zoneLine;
  let m1Line = '';
  let areaLine = '';
  let confidence;
  let setupName;

  if (zone) {
    // Di dalam area: BUY di demand, SELL di supply. Arah M1 hanya sebagai catatan.
    dir = demand ? 1 : -1;
    const zoneTxt = `area ${dir === 1 ? 'demand' : 'supply'} M5 ${f(zone.bottom)} - ${f(zone.top)}`;

    if (SCALP_ZONE_REQUIRE_BIAS) {
      const b5 = structureBias(m5c, SCALP_PIVOT);
      if (b5.dir !== dir) {
        return { plan: null, reason: `Scalping: harga di ${zoneTxt}, tapi bias M5 ${b5.dir === 0 ? 'belum jelas' : (b5.dir === 1 ? 'bullish' : 'bearish')}, tidak diambil. ${areaNote(m5c, price, dec)}.` };
      }
    }

    let reactionTxt = 'masuk langsung';
    if (SCALP_ZONE_NEEDS_CONFIRM) {
      const r = m1Reaction(m1, dir, price, dec);
      if (!r.ok) {
        return { plan: null, reason: `Scalping: harga di ${zoneTxt}, menunggu reaksi M1 (${r.why}). ${areaNote(m5c, price, dec)}.` };
      }
      reactionTxt = `reaksi M1 menembus ${f(r.breakLevel)}`;
    }

    baseLevel = zone.sl; // SL di luar wick area
    zoneLine = `Harga di ${zoneTxt}, ${reactionTxt}`;
    m1Line = init.dir === dir
      ? `Arah M1 ${init.src} searah`
      : `Hati-hati: arah M1 ${init.src} berlawanan, reaksi belum terbukti`;
    confidence = init.dir === dir ? 'HIGH' : 'MEDIUM';
    setupName = `Area S/D M5 ${dir === 1 ? 'demand' : 'supply'}`;
  } else {
    // Di luar area: NOW langsung searah arah awal market M1
    dir = init.dir;
    const pivot = dir === 1 ? lastL : lastH; // SL di pivot M1 berlawanan arah
    const pivotOk = pivot && (dir === 1 ? pivot.p < price : pivot.p > price);
    baseLevel = pivotOk ? pivot.p : recentExtreme(m1, dir);
    zoneLine = `Di luar area S/D M5, arah awal market M1 (${init.src}) → ${dir === 1 ? 'BUY' : 'SELL'} NOW`;
    areaLine = areaNote(m5c, price, dec);
    confidence = init.src.startsWith('M1 BOS') || init.src.startsWith('M1 Structure') ? 'HIGH' : 'MEDIUM';
    setupName = 'Arah awal M1 (NOW)';
  }

  // 3. Peringatan jika ada area berlawanan dekat harga
  const opp = findSDZones(m5c, -dir, price, scalpZoneOpts).filter(recent)[0];
  let oppLine = '';
  if (opp && opp.dist / PIP_SIZE <= SCALP_NEAR_ZONE_PIPS) {
    const oppName = dir === 1 ? 'supply' : 'demand';
    const dirTxt = dir === 1 ? 'BUY' : 'SELL';
    const distTxt = opp.dist === 0
      ? 'sudah di dalam'
      : `${(opp.dist / PIP_SIZE).toFixed(0)} pip ${dir === 1 ? 'di atas' : 'di bawah'}`;
    oppLine = `Hati-hati, ada ${oppName} M5 ${f(opp.bottom)} - ${f(opp.top)} (${distTxt}), berpotensi menahan ${dirTxt}`;
  }

  // 4. SL dan TP. SL dibatasi 25-30 pip; kalau struktur lebih lebar, dipotong dan diberi tahu.
  let rawRisk = Math.abs(price - baseLevel) + buffer;
  if ((dir === 1 && baseLevel >= price) || (dir === -1 && baseLevel <= price)) rawRisk = minRisk;
  const risk = Math.min(Math.max(rawRisk, minRisk), maxRisk);
  const slLine = rawRisk > maxRisk
    ? `SL dibatasi ${MAX_SL_PIPS} pip karena struktur lebih lebar (${(rawRisk / PIP_SIZE).toFixed(0)} pip)`
    : '';
  const entry = price;
  const sl = entry - dir * risk;
  const tps = rrList.map(x => entry + dir * x * risk);

  const reasonLines = [
    `Scalping ${dir === 1 ? 'BUY' : 'SELL'} NOW pada ${symbol}.`,
    `${zoneLine}.`,
    m1Line ? `${m1Line}.` : null,
    areaLine ? `${areaLine}.` : null,
    oppLine ? `${oppLine}.` : null,
    slLine ? `${slLine}.` : null,
    `Entry ${f(entry)}, SL (${(risk / PIP_SIZE).toFixed(0)} pip) di ${f(sl)}.`,
    `TP1 1:${rrList[0]}, TP2 1:${rrList[1]}, TP3 1:${rrList[2]}.`,
  ].filter(Boolean);

  return {
    dir,
    plan: {
      kind: 'scalp',
      orderType: 'NOW',
      status: 'RUNNING',
      entry,
      bufferEnd: entry,
      sl,
      tps,
      zone: null,
      expireMs: 0,
      zoneNote: `Scalp · ${setupName}`,
    },
    meta: {
      confidence,
      riskLabel: 'MEDIUM',
      setup: setupName,
      reason: reasonLines.join(' • '),
    },
  };
}

// ═══════════════════════════ DAY TRADING (BOS M15 + Zona S/D M15/M5 + BB M5 + LIMIT) ═══════════════════════════

// Area M15: zona terdekat yang displacement-nya terjadi dekat BOS terakhir
function pickM15Area(m15, bos, price) {
  const zones = findSDZones(m15, bos.dir, price)
    .filter(z => z.dispIdx >= bos.idx - DAY_OB_LOOKBACK && z.dispIdx <= bos.idx);
  return zones[0] || null;
}

// Refine M5: zona S/D M5 yang berada di dalam area M15
function refineM5Zone(m5, area15, dir, price) {
  const zones = findSDZones(m5, dir, price).filter(z => z.top >= area15.bottom && z.bottom <= area15.top);
  return zones[0] || null;
}

// Trigger M5 (dipakai saat harga sudah di dalam area): pullback ke BB middle lalu close kembali searah
function findDayTrigger(m5, dir) {
  const n = m5.length;
  const cur = m5[n - 1];
  const prev = m5[n - 2];
  const bbCur = bollingerAt(m5, n - 1);
  const bbPrev = bollingerAt(m5, n - 2);
  if (!bbCur || !bbPrev) return null;

  if (dir === 1 && prev.l <= bbPrev.mid && cur.c > bbCur.mid && cur.c > cur.o) {
    const strong = prev.l <= bbPrev.lower;
    return { strong, setup: strong ? 'BB Lower Band Reclaim' : 'BB Middle Band Pullback', bbMid: bbCur.mid };
  }
  if (dir === -1 && prev.h >= bbPrev.mid && cur.c < bbCur.mid && cur.c < cur.o) {
    const strong = prev.h >= bbPrev.upper;
    return { strong, setup: strong ? 'BB Upper Band Reject' : 'BB Middle Band Pullback', bbMid: bbCur.mid };
  }
  return null;
}

function buildDayPlan({ m5, m15, price, rrList, symbol, dec }) {
  const f = v => Number(v).toFixed(dec);

  const bos = findLastBOS(m15, DAY_PIVOT);
  if (!bos) return { plan: null, reason: 'Day Trading: belum ada BOS M15 terbaru sebagai bias.' };
  const dir = bos.dir;
  const biasTxt = dir === 1 ? 'bullish' : 'bearish';

  const area15 = pickM15Area(m15, bos, price);
  if (!area15) {
    return { plan: null, reason: `Day Trading: bias M15 ${biasTxt}, tapi belum ada zona S/D M15 yang valid (displacement, BOS, belum tersentuh).` };
  }

  const zone5 = refineM5Zone(m5, area15, dir, price);
  const area = zone5 || area15;
  const areaName = zone5 ? 'Zona S/D M5' : 'Zona S/D M15';
  const areaTxt = `${areaName} ${f(area.bottom)} - ${f(area.top)}`;

  // Zona sudah ditembus (harga lewat SL zona): setup batal
  const broken = dir === 1 ? price <= area.sl : price >= area.sl;
  if (broken) return { plan: null, reason: `Day Trading: ${areaTxt} sudah ditembus, setup batal.` };

  const tol = DAY_ZONE_TOL_PIPS * PIP_SIZE;
  const limitMax = DAY_LIMIT_MAX_PIPS * PIP_SIZE;
  const bb5 = bollingerAt(m5, m5.length - 1);
  const inArea = dir === 1 ? price <= area.top : price >= area.bottom;

  let orderType, entry, setup, confidence, bbNote, distPips = '0';

  if (inArea) {
    // Harga sudah di dalam zona: NOW hanya jika ada konfirmasi Bollinger Band M5
    const trig = findDayTrigger(m5, dir);
    if (!trig) return { plan: null, reason: `Day Trading: harga di ${areaTxt}, menunggu konfirmasi Bollinger Band M5.` };
    orderType = 'NOW';
    entry = price;
    setup = `${areaName} · ${trig.setup}`;
    confidence = trig.strong ? 'HIGH' : 'MEDIUM';
    bbNote = `Trigger M5: ${trig.setup} (BB mid ${f(trig.bbMid)}).`;
  } else {
    // Harga di luar zona: pasang LIMIT di tepi zona terdekat dari harga
    const nearEdge = dir === 1 ? area.top : area.bottom;
    const dist = Math.abs(price - nearEdge);
    if (dist > limitMax) {
      return { plan: null, reason: `Day Trading: harga ${f(price)} masih ${(dist / PIP_SIZE).toFixed(0)} pip dari ${areaTxt}, menunggu.` };
    }
    orderType = 'LIMIT';
    entry = nearEdge;
    distPips = (dist / PIP_SIZE).toFixed(0);

    const bandRef = bb5 ? (dir === 1 ? bb5.lower : bb5.upper) : null;
    const bandHit = bandRef != null && Math.abs(nearEdge - bandRef) <= tol;
    confidence = bandHit ? 'HIGH' : 'MEDIUM';
    setup = `${areaName} · Limit`;
    bbNote = bandRef != null
      ? `BB M5 (${BB_PERIOD}, ${BB_MULT}): limit ${bandHit ? 'bertemu' : 'belum bertemu'} ${dir === 1 ? 'lower' : 'upper'} band (${f(bandRef)}).`
      : 'BB M5 belum cukup data.';
  }

  const minRiskDT = DT_MIN_SL_PIPS * PIP_SIZE;
  const maxRiskDT = DT_MAX_SL_PIPS * PIP_SIZE;
  const buffer = DT_SL_BUFFER_PIPS * PIP_SIZE;
  const rawRisk = Math.abs(entry - area.sl) + buffer;
  const risk = Math.min(Math.max(rawRisk, minRiskDT), maxRiskDT);
  const sl = entry - dir * risk;
  const tps = rrList.map(x => entry + dir * x * risk);

  const reason = [
    `Day Trading (BOS M15 + ${areaName} + BB M5) ${dir === 1 ? 'BUY' : 'SELL'} ${orderType === 'LIMIT' ? 'LIMIT' : 'NOW'} pada ${symbol}.`,
    `Bias M15: BOS ${biasTxt} di ${f(bos.level)}.`,
    `Area: ${areaTxt}.`,
    orderType === 'LIMIT'
      ? `Harga ${f(price)}, limit di ${f(entry)} (${distPips} pip dari harga).`
      : `Harga ${f(price)} sudah di dalam zona.`,
    bbNote,
    `Entry ${f(entry)}, SL (${(risk / PIP_SIZE).toFixed(0)} pip) di ${f(sl)}.`,
    rrList.map((x, i) => `TP${i + 1} 1:${x}`).join(', ') + '.',
  ].join(' • ');

  return {
    dir,
    plan: {
      kind: 'day',
      orderType,
      status: orderType === 'LIMIT' ? 'PENDING' : 'RUNNING',
      entry,
      bufferEnd: entry,
      sl,
      tps,
      zone: null,
      expireMs: 0,
      zoneNote: `Day · ${areaTxt} · ${orderType}`,
    },
    meta: {
      confidence,
      riskLabel: 'MEDIUM',
      setup,
      reason,
    },
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

    let m1 = cleanCandles(body.candles?.m1);
    let m5 = cleanCandles(body.candles?.m5);
    let m15 = cleanCandles(body.candles?.m15);

    if (style.kind === 'scalp' && m1.length < SCALP_M1_NEED) {
      m1 = (await getCandles(symbol, '1m', SCALP_M1_NEED, apiKey)).candles;
    }
    if (style.kind === 'day') {
      if (m5.length < 30) m5 = (await getCandles(symbol, '5m', 100, apiKey)).candles;
      if (m15.length < 60) m15 = (await getCandles(symbol, '15m', 100, apiKey)).candles;
    }

    const price = Number(body.currentPrice) || lastClosePrice(m1) || lastClosePrice(m5) || 2000;

    let result;
    if (style.kind === 'scalp') {
      if (m1.length < SCALP_M1_NEED) return res.status(200).json(noSignal(`Data candle M1 belum cukup (butuh ±${SCALP_M1_NEED} candle untuk area M5).`));
      m1 = mergeLiveBar(m1, price, 1);
      result = buildScalpPlan({ m1, price, rrList: style.rr, symbol, dec });
    } else if (style.kind === 'day') {
      if (m5.length < 30 || m15.length < 60) return res.status(200).json(noSignal('Data candle M5/M15 belum cukup.'));
      m5 = mergeLiveBar(m5, price, 5);
      m15 = mergeLiveBar(m15, price, 15);
      result = buildDayPlan({ m5, m15, price, rrList: style.rr, symbol, dec });
    } else {
      result = { plan: null, reason: `Mode ${styleKey} belum tersedia. Gunakan Scalping atau Day Trading.` };
    }

    if (!result.plan) return res.status(200).json(noSignal(result.reason));

    const { dir, plan, meta } = result;
    const isLimit = plan.orderType === 'LIMIT';
    const r = v => Number(v.toFixed(dec));
    const tps = plan.tps;

    return res.status(200).json({
      ok: true,
      signal: {
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
        zone: null,
        expireMs: 0,
        confidence: meta.confidence,
        risk: meta.riskLabel,
        setup: meta.setup,
        entryStyle: style.entryStyle,
        setupLabel: style.label,
        zoneLabel: isLimit ? 'Limit Entry Zone' : 'Market Execution Zone',
        zoneNote: plan.zoneNote,
        reason: meta.reason,
      },
    });
  } catch (err) {
    return res.status(200).json({ ok: false, error: 'Server error: ' + err.message });
  }
}
