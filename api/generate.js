// api/generate.js
// v55 (True 2-Way Scalping: Tiered Zones, FVG & NOW)
//  - Scalping: Market Execution (NOW), FVG M1-M5, 2-Arah (Trend + Counter-Trend Scoring).
//  - Day Trading: Menunggu retest FVG/OB baru M15 akibat BOS. Limit Order. Fixed Risk 50 pip (XAUUSD).
//  - Intraday: Area S/D H1 + Refine M15. 2 arah.
//  - Swing: Area S/D H4 + Refine H1.
//  - Integrasi AI GutsAI (Qwen 3.8 Max) untuk narasi reasoning SMC/ICT.
//  - Bahasa output (id / en) mengikuti field "lang" dari frontend.

export const config = { api: { bodyParser: { sizeLimit: '6mb' } } };

const KV_KEY = 'alu_clients';
const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

// ── AI CONFIG ──
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || 'qwen-3.8-max'; // Default Qwen 3.8 Max

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
const MAX_SRC_DEVIATION = 0.05; // candle sumber harus dekat harga live (5%), kalau tidak dibuang

const pairClassOf = symbol => {
  if (isGold(symbol)) return 'gold';
  if (symbol === 'XAGUSD' || symbol === 'XAGEUR') return 'silver';
  if (['XPTUSD', 'XPDUSD'].includes(symbol)) return 'metal';
  if (CRYPTO_LIST.includes(symbol) || symbol.endsWith('BTC')) return 'crypto';
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
  crypto:    { label: 'Kripto',    structTf: 'M5', zoneTf: 'M5', zoneDisp: 1.0, nearAtr: 0.8, slMul: 1.3, bufAtr: 0.3,  range: [0.00001, 5000000] },
};

const PAIR_OVERRIDE = {};

const pairProfile = symbol => {
  const cls = pairClassOf(symbol);
  return { cls, ...PAIR_CLASS_PROFILE[cls], ...(PAIR_OVERRIDE[symbol] || {}) };
};

// Ukuran 1 pip per instrumen. 
const PIP_OVERRIDE = {
  XAUUSD: 0.1, XAUUSDX: 0.1, DXY: 0.01, ETHUSD: 0.1,
  US30: 1, NAS100: 1, SPX500: 1, GER40: 1, UK100: 1, JPN225: 1, FRA40: 1, AUS200: 1, BTCUSD: 1,
};
const pipSizeOf = (symbol, dec) => PIP_OVERRIDE[symbol] ?? Math.pow(10, -(dec - 1));

const STYLES = {
  'Scalping': {
    label: 'Scalping · Area S/D M5 + NOW (struktur M1 untuk XAUUSD, M5 untuk pair lain) · SL structure · TP 1:1 · 1:2 · 1:3',
    labelEn: 'Scalping · M5 S/D zone + NOW (M1 structure for XAUUSD, M5 for other pairs) · structure SL · TP 1:1 · 1:2 · 1:3',
    entryStyle: 'Agresif', entryStyleEn: 'Aggressive', mode: 'MARKET', kind: 'scalp', rr: [1.0, 2.0, 3.0],
  },
  'Day Trading': {
    label: 'Day Trading · Scalping Konservatif · Retest FVG/OB M15',
    labelEn: 'Day Trading · Conservative Scalping · M15 FVG/OB retest',
    entryStyle: 'Konservatif', entryStyleEn: 'Conservative', mode: 'LIMIT', kind: 'day', rr: [1.0, 1.5, 2.0],
  },
  'Intraday': {
    label: 'Intraday · Area S/D H1 + Refine M15 · 2 arah · 1 signal per hari · TP 1:1 · 1:2 · 1:3',
    labelEn: 'Intraday · H1 S/D zone + M15 refine · 2-way · 1 signal per day · TP 1:1 · 1:2 · 1:3',
    entryStyle: 'Moderat', entryStyleEn: 'Moderate', mode: 'LIMIT', kind: 'intraday', rr: [1.0, 2.0, 3.0],
  },
  'Swing': {
    label: 'Swing · Area S/D H4 + Refine H1 · Limit/NOW · TP 1:3',
    labelEn: 'Swing · H4 S/D zone + H1 refine · Limit/NOW · TP 1:3',
    entryStyle: 'Positioning', entryStyleEn: 'Positioning', mode: 'LIMIT', kind: 'swing', rr: [3.0],
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
const BAND_TOL_PIPS = 10;   
const BAND_TOL_ATR = 0.2;   

// ── Zona Supply/Demand (default) ──
const ZONE_ATR_PERIOD = 14;
const ZONE_DISP_ATR = 1.2;
const ZONE_MAX_ATR = 2.5;
const ZONE_REQUIRE_FVG = false;
const ZONE_FRESH_ONLY = true;

// ── Scalping ──
const SCALP_ZONE_LOOKBACK_M5 = 60;      
const SCALP_ZONE_DISP_ATR = 0.8;        
const SCALP_ZONE_FRESH_ONLY = true;     
const SCALP_CHASE_MAX_PIPS = 15;        
const scalpZoneOpts = { dispAtr: SCALP_ZONE_DISP_ATR, freshOnly: SCALP_ZONE_FRESH_ONLY };

// ── REACTION RANGE + FVG CONTINUITY + FIXED RISK ──
const REACTION_ATR = { scalp: 1.5, day: 1.5, intraday: 1.5, swing: 2.0 };
const REACTION_MIN_PIP = 5;
const NOW_MAX_ATR = { scalp: 0.4, day: 0.6, intraday: 0.8 };
const FVG_LOOKBACK_BY_STYLE = { scalp: 40, day: 40, intraday: 40 };
const FVG_MIN_SIZE_ATR = 0.15;
const SCALP_ZONE_MIN_AGE_BARS = 8;
const FIXED_RISK_XAU_DAY_PIPS = 50;

function reactionRangeFor(kind, atrVal, ctx) {
  return Math.max((REACTION_ATR[kind] || 1.5) * atrVal, REACTION_MIN_PIP * ctx.pip);
}

// Fixed 50 pip hanya untuk XAUUSD di Day Trading
function fixedRiskFor(kind, ctx) {
  if (kind === 'day' && ctx.gold) return FIXED_RISK_XAU_DAY_PIPS * ctx.pip;
  return null;
}

function classifyPriceZone(price, demand, supply, reactionDist) {
  const inDemand = !!demand && price >= demand.bottom && price <= demand.top;
  const inSupply = !!supply && price >= supply.bottom && price <= supply.top;
  const distToSupply = supply ? Math.max(0, supply.bottom - price) : Infinity;
  const distToDemand = demand ? Math.max(0, price - demand.top) : Infinity;
  return {
    inDemand, inSupply,
    nearSupply: !!supply && !inSupply && distToSupply > 0 && distToSupply <= reactionDist,
    nearDemand: !!demand && !inDemand && distToDemand > 0 && distToDemand <= reactionDist,
    distToSupply, distToDemand,
  };
}

function detectRejection(refineC, price, demand, supply, atrVal, nowMaxAtr) {
  if (!refineC || refineC.length < 5) return { buyOk: false, sellOk: false };
  const last5 = refineC.slice(-5);
  const last = last5[last5.length - 1];
  const bearCount = last5.filter(c => c.c < c.o).length;
  const bullCount = last5.filter(c => c.c > c.o).length;
  let sellWick = false, buyWick = false;
  if (supply) {
    const touched = last5.some(c => c.h >= supply.bottom);
    sellWick = touched && last.c < last.o && last.c < supply.bottom;
  }
  if (demand) {
    const touched = last5.some(c => c.l <= demand.top);
    buyWick = touched && last.c > last.o && last.c > demand.top;
  }
  const nearMax = nowMaxAtr * atrVal;
  const sellOk = sellWick || (bearCount >= 3 && supply && (supply.bottom - price) <= nearMax);
  const buyOk  = buyWick  || (bullCount >= 3 && demand && (price - demand.top)  <= nearMax);
  return { buyOk, sellOk };
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

// ── SL: XAUUSD dalam pip, pair lain dalam kelipatan ATR ──
const GOLD_SL_PIPS = { scalp: [25, 30], day: [50, 120], intraday: [80, 200], swing: [150, 300] };
const SL_BUFFER_PIPS = { scalp: 3, day: 5, intraday: 10, swing: 15 };
const ATR_SL_MULT = { scalp: [0.5, 2.5], day: [1, 3], intraday: [1, 3], swing: [0.5, 2] };

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
  if (!email) return { ok: false, key: 'noEmail' };
  try {
    const raw = await kv(['GET', KV_KEY]);
    if (!raw) return { ok: true };
    const clients = JSON.parse(raw);
    const c = clients.find(x => x.email === email);
    if (!c) return { ok: false, key: 'notRegistered' };
    if (new Date(c.expires_at) <= new Date()) return { ok: false, key: 'expired' };
  } catch (e) {}
  return { ok: true };
}

// ═══════════════════════════ BAHASA ═══════════════════════════
const pickLang = (body, query) => {
  const raw = String(body?.lang ?? body?.language ?? body?.locale ?? query?.lang ?? '').toLowerCase();
  return raw.startsWith('en') ? 'en' : 'id';
};

const TX = {
  id: {
    pip: 'pip',
    title: { scalp: 'Scalping', day: 'Day Trading (Scalping Konservatif)', intraday: 'Intraday', swing: 'Swing' },
    kind: { scalp: 'Scalping (Agresif)', day: 'Day Trade (Konservatif)', intraday: 'Intraday (Moderat)', swing: 'Swing (Positioning)' },
    classLabel: { gold: 'Emas', silver: 'Perak', metal: 'Logam', fx: 'Forex', fx_jpy: 'Forex JPY', index: 'Indeks', commodity: 'Komoditas', crypto: 'Kripto' },
    headLine: (title, dir, ot, sym) => `${title} ${dir} ${ot} pada ${sym}`,
    inZone: (side, tf, lo, hi) => `Harga di dalam ${side} ${tf} ${lo} - ${hi}`,
    limitEdge: (side, tf, px, pips) => `Limit di tepi ${side} ${tf} (${px}), ${pips} pip dari harga`,
    aligned: (tf, src) => `Arah ${tf} ${src} searah`,
    opposed: (tf, src) => `Hati-hati: arah ${tf} ${src} berlawanan, reaksi belum terbukti`,
    outside: (zoneTf, tf, src) => `Di luar area S/D ${zoneTf}, ikuti struktur ${tf} (${src}) → Market Execution`,
    nearM5: 'Area M5 terdekat:',
    noM5Zone: n => `Tidak ada area S/D M5 valid dalam ${n} candle terakhir`,
    insideAlready: 'sudah di dalam',
    dist: (pips, above) => `${pips} pip ${above ? 'di atas' : 'di bawah'}`,
    opposing: (oppName, tf, lo, hi, dist, dirW) => `Hati-hati, ada ${oppName} ${tf} ${lo} - ${hi} (${dist}), berpotensi menahan ${dirW}`,
    zoneSetup: (tf, side, ot) => `Area S/D ${tf} ${side} · ${ot}`,
    marketExec: src => `Market Execution (${src})`,
    zoneName: (side, type, tf) => `Zona ${side}/${type} ${tf}`,
    zoneSD: tf => `Zona S/D ${tf}`,
    swingLevel: tf => `Level swing ${tf}`,
    refineIn: (ref, parent) => `Refine ${ref} di dalam area ${parent}`,
    nearZone: ref => `Zona ${ref} terdekat`,
    noRefine: (ref, parent) => `Refine ${ref} belum ada, memakai area ${parent}`,
    noSDLastSwing: 'Area S/D belum ada, memakai swing terakhir',
    swRefineIn: 'Refine H1 berada di dalam area H4',
    swRefineNear: 'Refine H1 terdekat searah bias',
    swRefineNoH4: 'Refine H1 belum ada, memakai area H4',
    swNoAreaH1: 'Area S/D belum ada, memakai swing H1 terakhir',
    biasBOS: (tf, bull, lvl) => `Bias ${tf}: BOS ${bull ? 'bullish' : 'bearish'} di ${lvl}`,
    biasStruct: (tf, src) => `Bias ${tf}: struktur ${src}`,
    twoWay: (bDir, bScore, oDir, oScore) => `Dua arah dinilai: ${bDir} skor ${bScore} vs ${oDir} ${oScore}`,
    counterTrend: 'Counter-trend: zona lawan bias lebih kuat, risiko lebih tinggi',
    noBBConfirm: 'belum ada konfirmasi BB',
    brokenSetup: a => `${a} tertembus · NOW`,
    brokenNote: (a, ref) => `Harga sudah melewati ${a}, masuk NOW dengan SL dari struktur ${ref} terakhir`,
    inAreaSetup: (a, c) => `${a} · ${c}`,
    inAreaConfirm: (a, setup, ref) => `Harga di ${a}, konfirmasi ${setup} (${ref})`,
    inAreaNoConfirm: (a, ref) => `Harga di ${a}, belum ada konfirmasi BB ${ref}, hati-hati`,
    limitSetup: a => `${a} · Limit`,
    limitNote: (a, px, pips) => `Limit di tepi ${a} (${px}), ${pips} pip dari harga`,
    farLimit: 'Jarak limit cukup jauh, kemungkinan lama terisi',
    bbNote: (ref, hit, edge, band) => `BB ${ref}: limit ${hit ? 'bertemu' : 'belum bertemu'} ${edge} band (${band})`,
    slCapped: (max, raw) => `SL dibatasi ${max} pip, struktur lebih lebar (${raw} pip)`,
    entryLine: (e, pips, sl) => `Entry ${e}, SL (${pips} pip) di ${sl}`,
    noPair: keys => `Pair tidak terbaca dari request. Field yang diterima: ${keys}. Pastikan frontend mengirim field "symbol".`,
    emptyBody: '(body kosong)',
    noEmail: 'Sesi tidak punya email.',
    notRegistered: 'Email tidak terdaftar.',
    expired: 'Masa aktif habis.',
    noPrice: 'Harga saat ini belum tersedia.',
    range: (price, symbol, lo, hi) => `Harga ${price} di luar rentang wajar ${symbol} (${lo} - ${hi}).`,
    candle: (symbol, price, detail) => `Data candle ${symbol} tidak cocok dengan harga live (${price}). ${detail}`,
    noSource: 'tidak ada sumber',
    noSetup: 'Tidak ada setup yang valid saat ini.',
    notProcessed: 'Belum diproses',
    zoneFresh: (side, tf, lo, hi, inside) => `Zona ${side} ${tf} VALID & FRESH ${inside ? '(harga di dalam)' : '(harga dekat)'}: ${lo} - ${hi}`,
    zoneStale: (side, tf, lo, hi) => `Zona ${side} ${tf} TIDAK FRESH (sudah pernah disentuh): ${lo} - ${hi}`,
    zoneNone: 'Tidak ada zona S/D fresh yang dekat dengan harga',
    scalpRules: `
=== ALUR SCALPING AGRESIF (WAJIB DIIKUTI) ===
A. Jika ada zona VALID & FRESH (harga di dalam atau dekat zona):
   - Zona SUPPLY → fokus setup SELL. Zona DEMAND → fokus setup BUY.
   - Tulis catatan "zona valid" beserta tipe zona, rentang harga, dan arah fokus.
B. Jika zona TIDAK FRESH atau tidak ada zona, DAN tidak ada FVG:
   - Jelaskan arah dari momentum struktur (BOS/CHoCH).
C. Jangan jadikan BUY dari zona SUPPLY atau SELL dari zona DEMAND sebagai setup utama, kecuali zona sudah tidak fresh dan struktur sudah berbalik.
`,
    aiPrompt: (d) => `
Anda adalah "Alu Signal Z", trader SMC/ICT. Tulis 1 paragraf (maks 400 karakter, bahasa Indonesia, tegas) yang menjelaskan MENGAPA entry ini diambil. Gunakan HANYA data di bawah.
=== ATURAN ===
1. Pair hanya ${d.symbol} (${d.classLabel}). Jangan sebut pair lain.
2. TF: struktur ${d.structTf}, zona ${d.zoneTf}.
3. Istilah: Order Block, FVG, BOS, CHoCH, Liquidity Sweep, Displacement. Jangan pakai RSI/MACD.
4. Jika tidak ada setup jelas, tulis market ranging.
=== DATA ===
- Pair: ${d.symbol} | Kelas: ${d.classLabel}
- Sinyal: ${d.sideW} | Gaya: ${d.kind} | Order: ${d.orderType}
- Entry: ${d.entry} | SL: ${d.sl} (${d.riskPips} pip)
- TP: ${d.tps}
- Setup: ${d.setup}
- Konteks zona: ${d.zone || '-'}
- Data mentah: ${d.raw}
`,
    aiSystem: 'Anda adalah AI analis trading SMC/ICT yang objektif, dingin, dan presisi.',
  },
  en: {
    pip: 'pips',
    title: { scalp: 'Scalping', day: 'Day Trading (Conservative Scalping)', intraday: 'Intraday', swing: 'Swing' },
    kind: { scalp: 'Scalping (Aggressive)', day: 'Day Trade (Conservative)', intraday: 'Intraday (Moderate)', swing: 'Swing (Positioning)' },
    classLabel: { gold: 'Gold', silver: 'Silver', metal: 'Metal', fx: 'Forex', fx_jpy: 'JPY Forex', index: 'Index', commodity: 'Commodity', crypto: 'Crypto' },
    headLine: (title, dir, ot, sym) => `${title} ${dir} ${ot} on ${sym}`,
    inZone: (side, tf, lo, hi) => `Price inside ${side} ${tf} ${lo} - ${hi}`,
    limitEdge: (side, tf, px, pips) => `Limit at ${side} edge ${tf} (${px}), ${pips} pips from price`,
    aligned: (tf, src) => `${tf} direction ${src} aligned`,
    opposed: (tf, src) => `Caution: ${tf} direction ${src} is opposing`,
    outside: (zoneTf, tf, src) => `Outside S/D ${zoneTf} zone, following ${tf} structure (${src}) → Market Execution`,
    nearM5: 'Nearest M5 zones:',
    noM5Zone: n => `No valid M5 S/D zone in the last ${n} candles`,
    insideAlready: 'already inside',
    dist: (pips, above) => `${pips} pips ${above ? 'above' : 'below'}`,
    opposing: (oppName, tf, lo, hi, dist, dirW) => `Caution: ${oppName} ${tf} ${lo} - ${hi} (${dist}) may hold the ${dirW}`,
    zoneSetup: (tf, side, ot) => `S/D ${tf} ${side} zone · ${ot}`,
    marketExec: src => `Market Execution (${src})`,
    zoneName: (side, type, tf) => `${side} zone/${type} ${tf}`,
    zoneSD: tf => `S/D zone ${tf}`,
    swingLevel: tf => `${tf} swing level`,
    refineIn: (ref, parent) => `${ref} refine inside ${parent} area`,
    nearZone: ref => `Nearest ${ref} zone`,
    noRefine: (ref, parent) => `No ${ref} refine yet, using ${parent} area`,
    noSDLastSwing: 'No S/D zone yet, using last swing',
    swRefineIn: 'H1 refine sits inside the H4 area',
    swRefineNear: 'Nearest H1 refine aligned with bias',
    swRefineNoH4: 'No H1 refine yet, using H4 area',
    swNoAreaH1: 'No S/D zone yet, using last H1 swing',
    biasBOS: (tf, bull, lvl) => `${tf} bias: BOS ${bull ? 'bullish' : 'bearish'} at ${lvl}`,
    biasStruct: (tf, src) => `${tf} bias: ${src}`,
    twoWay: (bDir, bScore, oDir, oScore) => `Both sides scored: ${bDir} ${bScore} vs ${oDir} ${oScore}`,
    counterTrend: 'Counter-trend: opposing-bias zone is stronger, higher risk',
    noBBConfirm: 'no BB confirmation yet',
    brokenSetup: a => `${a} breached · NOW`,
    brokenNote: (a, ref) => `Price passed ${a}, entering NOW with SL from the last ${ref} structure`,
    inAreaSetup: (a, c) => `${a} · ${c}`,
    inAreaConfirm: (a, setup, ref) => `Price in ${a}, confirmed by ${setup} (${ref})`,
    inAreaNoConfirm: (a, ref) => `Price in ${a}, no BB confirmation on ${ref} yet`,
    limitSetup: a => `${a} · Limit`,
    limitNote: (a, px, pips) => `Limit at ${a} edge (${px}), ${pips} pips from price`,
    farLimit: 'Limit distance is large, may take a while to fill',
    bbNote: (ref, hit, edge, band) => `BB ${ref}: limit ${hit ? 'touches' : 'does not touch'} ${edge} band (${band})`,
    slCapped: (max, raw) => `SL capped at ${max} pips, structure is wider (${raw} pips)`,
    entryLine: (e, pips, sl) => `Entry ${e}, SL (${pips} pips) at ${sl}`,
    noPair: keys => `Pair not found in request. Received fields: ${keys}. Make sure the frontend sends the "symbol" field.`,
    emptyBody: '(empty body)',
    noEmail: 'Session has no email.',
    notRegistered: 'Email is not registered.',
    expired: 'Subscription has expired.',
    noPrice: 'Current price is not available yet.',
    range: (price, symbol, lo, hi) => `Price ${price} is outside the expected range for ${symbol} (${lo} - ${hi}).`,
    candle: (symbol, price, detail) => `Candle data for ${symbol} does not match the live price (${price}). ${detail}`,
    noSource: 'no source',
    noSetup: 'No valid setup right now.',
    notProcessed: 'Not processed yet',
    zoneFresh: (side, tf, lo, hi, inside) => `${side.toUpperCase()} zone ${tf} VALID & FRESH ${inside ? '(price inside)' : '(price near)'}: ${lo} - ${hi}`,
    zoneStale: (side, tf, lo, hi) => `${side.toUpperCase()} zone ${tf} NOT FRESH (already tested): ${lo} - ${hi}`,
    zoneNone: 'No fresh S/D zone near price',
    scalpRules: `
=== AGGRESSIVE SCALPING WORKFLOW (MUST FOLLOW) ===
A. If a VALID & FRESH zone exists (price inside or near the zone):
   - SUPPLY zone → focus SELL setup. DEMAND zone → focus BUY setup.
B. If the zone is NOT FRESH or there is no zone, AND no FVG:
   - Explain the direction from momentum structure (BOS/CHoCH).
`,
    aiPrompt: (d) => `
You are "Alu Signal Z", an SMC/ICT trader. Write ONE paragraph in English (max 400 characters) explaining WHY this entry was taken. Use ONLY the data below.
=== RULES ===
1. The only pair discussed is ${d.symbol} (${d.classLabel}).
2. Timeframes: structure ${d.structTf}, zone ${d.zoneTf}.
3. Use terms: Order Block, FVG, BOS, CHoCH, Liquidity Sweep, Displacement.
=== DATA ===
- Pair: ${d.symbol} | Class: ${d.classLabel}
- Signal: ${d.sideW} | Style: ${d.kind} | Order: ${d.orderType}
- Entry: ${d.entry} | SL: ${d.sl} (${d.riskPips} pips)
- TP: ${d.tps}
- Setup: ${d.setup}
- Zone context: ${d.zone || '-'}
- Raw data: ${d.raw}
`,
    aiSystem: 'You are an objective, calm, and precise SMC/ICT trading analyst.',
  },
};

const tx = ctx => TX[ctx.lang] || TX.id;

const SRC_EN = {
  'BOS Bullish': 'BOS Bullish',
  'BOS Bearish': 'BOS Bearish',
  'Struktur HH + HL': 'HH + HL structure',
  'Struktur LH + LL': 'LH + LL structure',
  'Mitigasi FVG / Inducement': 'FVG mitigation / Inducement',
  'Sweep FVG / OB': 'FVG / OB sweep',
  'Default': 'Default',
};
const srcName = (src, lang) => (lang === 'en' ? (SRC_EN[src] || src) : src);

// ═══════════════════════════ FEED CANDLE ═══════════════════════════

function tlCandidates(symbol) {
  const s = symbol.toUpperCase().trim();
  if (CRYPTO_LIST.includes(s)) {
    const base = s.replace(/USD$/, '');
    return [
      { asset: 'crypto', symbol: `${base}USDT` },
      { asset: 'crypto', symbol: `${base}USD` },
    ];
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
const CACHE_BARS = { '1m': 300, '5m': 300, '15m': 600 };

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
      const o = Number(bar.o ?? bar.open);
      const h = Number(bar.h ?? bar.high);
      const l = Number(bar.l ?? bar.low);
      const c = Number(bar.c ?? bar.close);
      if (t > 0 && [o, h, l, c].every(Number.isFinite)) byT.set(t, { t, o, h, l, c });
    }
    info.rows = [...byT.values()].sort((a, b) => a.t - b.t).slice(-Math.max(1, Math.ceil(need)));
  } catch (err) {
    info.error = err.message;
  }
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

const CANDLE_CACHE_VER = 'v2';
const matchesRef = (arr, ref) =>
  arr.length > 0 && ref > 0 && Math.abs(arr[arr.length - 1].c - ref) / ref <= MAX_SRC_DEVIATION;

async function getCandles(symbol, tf, need, apiKey, ref) {
  const cacheKey = `candles_${CANDLE_CACHE_VER}_${symbol}_${tf}`;
  const cached = await kvGetJSON(cacheKey);
  if (Array.isArray(cached) && cached.length >= need && matchesRef(cached, ref)) {
    return { candles: cached, source: 'cache', tried: [] };
  }

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

function recentExtreme(candles, dir, bars) {
  const s = candles.slice(-(bars + 1));
  return dir === 1 ? Math.min(...s.map(c => c.l)) : Math.max(...s.map(c => c.h));
}

function areaNote(m5c, price, ctx) {
  const { f, pip } = ctx;
  const t = tx(ctx);
  const recent = z => z.dispIdx >= m5c.length - SCALP_ZONE_LOOKBACK_M5;
  const sup = findSDZones(m5c, -1, price, scalpZoneOpts).filter(recent)[0];
  const dem = findSDZones(m5c, 1, price, scalpZoneOpts).filter(recent)[0];
  const parts = [];
  if (sup) {
    const d = sup.dist === 0 ? t.insideAlready : t.dist((sup.dist / pip).toFixed(0), true);
    parts.push(`supply ${f(sup.bottom)} - ${f(sup.top)} (${d})`);
  }
  if (dem) {
    const d = dem.dist === 0 ? t.insideAlready : t.dist((dem.dist / pip).toFixed(0), false);
    parts.push(`demand ${f(dem.bottom)} - ${f(dem.top)} (${d})`);
  }
  return parts.length
    ? `${t.nearM5} ${parts.join(', ')}`
    : t.noM5Zone(SCALP_ZONE_LOOKBACK_M5);
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
async function getAIReasoning({ ctx, dir, kind, orderType, entry, sl, tps, setup, rawReason, riskPips, zoneLine }) {
  if (!OPENAI_API_KEY) return null;
  const { symbol, dec, prof, lang } = ctx;
  const t = TX[lang] || TX.id;
  const p = v => Number(v).toFixed(dec);

  const prompt = t.aiPrompt({
    symbol,
    classLabel: t.classLabel[prof.cls] || prof.label,
    structTf: prof.structTf,
    zoneTf: prof.zoneTf,
    dec,
    sideW: dir === 1 ? 'BUY' : 'SELL',
    kind: t.kind[kind] || kind,
    orderType,
    entry: p(entry),
    sl: p(sl),
    riskPips: riskPips.toFixed(1),
    tps: tps.map(p).join(', '),
    setup,
    zone: zoneLine || '',
    raw: rawReason,
  }) + (kind === 'scalp' ? t.scalpRules : '');

  try {
    const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: t.aiSystem },
          { role: 'user', content: prompt }
        ],
        max_tokens: 200,
        temperature: 0.1, 
      })
    });

    if (!resp.ok) {
      console.error('AI HTTP', resp.status, (await resp.text()).slice(0, 200));
      return null;
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('AI Error:', err.message);
    return null;
  }
}

// ═══ MODIFIED: finalizePlan ═══
async function finalizePlan({ dir, entry, orderType, baseSL, kind, atrVal, ctx, rrList, confidence, setup, zoneNote, zoneRange, head, lines, zoneLine }) {
  const { f, pip, gold, prof } = ctx;
  const t = tx(ctx);

  let risk, slNote = '';
  const fixedRisk = fixedRiskFor(kind, ctx);
  if (fixedRisk) {
    risk = fixedRisk;
    slNote = ctx.lang === 'en'
      ? `SL fixed ${FIXED_RISK_XAU_DAY_PIPS} pips (XAUUSD day trade)`
      : `SL fixed ${FIXED_RISK_XAU_DAY_PIPS} pip (Day Trading XAUUSD)`;
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
  const parts = [
    head,
    ...lines,
    slNote,
    t.entryLine(f(entry), (risk / pip).toFixed(0), f(sl)),
    rrList.map((x, i) => `TP${i + 1} 1:${x}`).join(', '),
  ].filter(Boolean);
  const manualReason = parts.map(s => s.replace(/\.?$/, '.')).join(' • ');

  const aiReason = await getAIReasoning({
    ctx, dir, kind, orderType, entry, sl, tps, setup,
    rawReason: manualReason, riskPips: risk / pip, zoneLine,
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
// ═══ END MODIFIED ═══

async function buildAreaPlan({ title, area, dir, price, refineC, refineName, kind, atrVal, ctx, areaName, rrList, lines }) {
  const { f, pip, gold, symbol } = ctx;
  const t = tx(ctx);
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
    setup = t.brokenSetup(areaName);
    notes.push(t.brokenNote(areaName, refineName));
  } else if (inArea) {
    orderType = 'NOW';
    entry = price;
    baseSL = area.sl;
    confidence = trig && trig.strong ? 'HIGH' : 'MEDIUM';
    setup = t.inAreaSetup(areaName, trig ? trig.setup : t.noBBConfirm);
    notes.push(trig
      ? t.inAreaConfirm(areaName, trig.setup, refineName)
      : t.inAreaNoConfirm(areaName, refineName));
  } else {
    orderType = 'LIMIT';
    entry = dir === 1 ? area.top : area.bottom;
    baseSL = area.sl;
    const dist = Math.abs(price - entry);
    const bandRef = bb ? (dir === 1 ? bb.lower : bb.upper) : null;
    const bandHit = bandRef != null && Math.abs(entry - bandRef) <= tol;
    confidence = bandHit ? 'HIGH' : 'MEDIUM';
    setup = t.limitSetup(areaName);
    notes.push(t.limitNote(areaName, f(entry), (dist / pip).toFixed(0)));
    if (dist > 3 * atrVal) notes.push(t.farLimit);
    if (bandRef != null) {
      notes.push(t.bbNote(refineName, bandHit, dir === 1 ? 'lower' : 'upper', f(bandRef)));
    }
  }

  const head = t.headLine(title, dir === 1 ? 'BUY' : 'SELL', orderType === 'LIMIT' ? 'LIMIT' : 'NOW', symbol);
  return await finalizePlan({
    dir, entry, orderType, baseSL, kind, atrVal, ctx, rrList, confidence, setup,
    zoneNote: `${title} · ${areaName} · ${orderType}`,
    zoneRange: { min: area.bottom, max: area.top },
    head, lines: notes,
  });
}

// ═══════════════════════════ SCALPING ═══════════════════════════

// ═══ MODIFIED: buildScalpPlan — TRUE 2-WAY SCALPING (Trend + Counter-Trend Bounce) ═══
async function buildScalpPlan({ m1, m5, price, rrList, ctx }) {
  const { f, pip, prof } = ctx;
  const t = tx(ctx);
  const tfName = prof.structTf;
  const struct = tfName === 'M1' ? m1 : m5;
  const m5c = tfName === 'M1' ? aggregateCandles(m1, 5).slice(0, -1) : m5.slice(0, -1);
  const atrVal = atrOf(m5c, pip);
  const reactionDist = reactionRangeFor('scalp', atrVal, ctx);
  const zOpts = { dispAtr: prof.zoneDisp, freshOnly: SCALP_ZONE_FRESH_ONLY };
  const recent = z => z.dispIdx >= m5c.length - SCALP_ZONE_LOOKBACK_M5
                   && z.dispIdx <= m5c.length - SCALP_ZONE_MIN_AGE_BARS;

  const demand = findSDZones(m5c, 1, price, zOpts).filter(recent)[0] || null;
  const supply = findSDZones(m5c, -1, price, zOpts).filter(recent)[0] || null;
  const init = analyzePureSMCStructure(struct);

  // ── FUNGSI SCORING PER ARAH (BUY / SELL) ──
  const evaluateSide = (dir) => {
    const isBuy = dir === 1;
    const pos = classifyPriceZone(price, demand, supply, reactionDist);
    const rejection = detectRejection(struct, price, demand, supply, atrVal, NOW_MAX_ATR.scalp);
    const fvgEval = evaluateFVG(m5c, price, dir, atrVal, FVG_LOOKBACK_BY_STYLE.scalp);
    
    let score = 0;
    let area = null, areaName = '', zoneLine = '', orderType = 'NOW', entry = price, baseSL = price;
    let zoneRange = null, confidence = 'MEDIUM', setup = '', lines = [];
    
    // 1. Struktur (Trend Following)
    if (init.dir === dir) score += 3; 
    else score -= 3;                  
    
    const inZone = isBuy ? pos.inDemand : pos.inSupply;
    const nearZone = isBuy ? pos.nearDemand : pos.nearSupply;
    const dist = isBuy ? pos.distToDemand : pos.distToSupply;
    const zone = isBuy ? demand : supply;
    const rejOk = isBuy ? rejection.buyOk : rejection.sellOk;
    const sideName = isBuy ? 'demand' : 'supply';
    const sideNameCap = isBuy ? 'Demand' : 'Supply';
    
    // TIER 1: ZONA S/D (PRIORITAS UTAMA)
    if (inZone) {
      score += 5;
      area = zone;
      areaName = sideNameCap;
      zoneRange = { min: zone.bottom, max: zone.top };
      zoneLine = t.zoneFresh(sideName, prof.zoneTf, f(zone.bottom), f(zone.top), true);
      lines.push(t.inZone(sideName, prof.zoneTf, f(zone.bottom), f(zone.top)));
      
      if (rejOk) {
        score += 2;
        orderType = 'NOW'; entry = price; baseSL = zone.sl;
        confidence = 'HIGH'; setup = isBuy ? 'Demand Bounce NOW' : 'Supply Rejection NOW';
      } else {
        orderType = 'LIMIT'; entry = isBuy ? zone.top : zone.bottom; baseSL = zone.sl;
        confidence = 'MEDIUM'; setup = isBuy ? 'Demand LIMIT' : 'Supply LIMIT';
      }
    } else if (nearZone) {
      score += 4;
      area = zone;
      areaName = sideNameCap;
      zoneRange = { min: zone.bottom, max: zone.top };
      zoneLine = t.zoneFresh(sideName, prof.zoneTf, f(zone.bottom), f(zone.top), false);
      lines.push(t.dist((dist / pip).toFixed(0), !isBuy) + ` → ${prof.zoneTf} ${sideName}`);
      
      if (rejOk && dist <= NOW_MAX_ATR.scalp * atrVal) {
        score += 1;
        orderType = 'NOW'; entry = price; baseSL = zone.sl;
        confidence = 'HIGH'; setup = isBuy ? 'Approaching Demand NOW' : 'Approaching Supply NOW';
      } else {
        orderType = 'LIMIT'; entry = isBuy ? zone.top : zone.bottom; baseSL = zone.sl;
        confidence = 'HIGH'; setup = isBuy ? 'Approaching Demand LIMIT' : 'Approaching Supply LIMIT';
      }
    } else {
      // TIER 2: FVG (Jika jauh dari zona, cari retrace FVG)
      if (fvgEval.useFVG) {
        score += 2;
        area = { top: fvgEval.fvg.hi, bottom: fvgEval.fvg.lo, sl: fvgEval.sl };
        areaName = `FVG ${isBuy ? 'Bull' : 'Bear'}`;
        zoneRange = { min: fvgEval.fvg.lo, max: fvgEval.fvg.hi };
        zoneLine = `FVG ${f(fvgEval.fvg.lo)}-${f(fvgEval.fvg.hi)}`;
        orderType = 'LIMIT'; entry = fvgEval.entry; baseSL = fvgEval.sl;
        confidence = 'HIGH';
        setup = fvgEval.retraceMandatory ? `FVG Retrace (WAJIB)` : `FVG Interior`;
        lines.push(`FVG ${f(fvgEval.fvg.lo)}-${f(fvgEval.fvg.hi)}`);
      } 
      // TIER 3: MOMENTUM NOW (Jika tidak ada Zona & FVG, tapi Tren sangat kuat)
      else {
        if (init.dir === dir) {
          // Harga lanjut jalan (Continuation)
          score += 2; 
          orderType = 'NOW'; entry = price;
          baseSL = recentExtreme(struct, dir, 10);
          zoneRange = { min: price, max: price };
          confidence = 'MEDIUM';
          setup = `Market NOW (Trend Continuation)`;
          lines.push(`Tidak ada zona/FVG, ikuti momentum ${srcName(init.src, ctx.lang)}`);
        } else {
          // Jika melawan tren dan tidak ada zona/FVG -> TOLAK MENTAH-MENTAH
          score -= 99; 
        }
      }
    }
    
    // Cek zona lawan yang terlalu dekat (Reaction Range)
    const oppZone = isBuy ? supply : demand;
    if (oppZone && (isBuy ? (oppZone.bottom - price) : (price - oppZone.top)) <= reactionDist) {
      score -= 2; 
      lines.push(t.opposing(isBuy ? 'supply' : 'demand', prof.zoneTf, f(oppZone.bottom), f(oppZone.top), 'dekat', isBuy ? 'BUY' : 'SELL'));
    }

    return { dir, score, entry, orderType, baseSL, zoneRange, confidence, setup, zoneLine, lines, areaName };
  };

  const buySetup = evaluateSide(1);
  const sellSetup = evaluateSide(-1);
  const best = buySetup.score >= sellSetup.score ? buySetup : sellSetup;

  if (best.score < 0) {
    return { plan: null, reason: 'Tidak ada setup valid. Harga di tengah, tren tidak jelas, dan tidak ada FVG/Zona.' };
  }

  return await finalizePlan({
    ...best,
    kind: 'scalp', atrVal, ctx, rrList,
    zoneNote: best.setup,
    head: t.headLine(t.title.scalp, best.dir === 1 ? 'BUY' : 'SELL',
      best.orderType === 'LIMIT' ? 'LIMIT' : 'NOW', ctx.symbol),
  });
}
// ═══ END MODIFIED ═══

// ═══════════════ DAY TRADING (SCALPING KONSERVATIF) ═══════════════

function evalSide(dir, o) {
  const { price, bias, parentPick, parentName, refineC, refineName, refineL, atrVal } = o;
  const t = tx(o.ctx);

  const parent = parentPick(dir);
  const refined = parent ? refineZone(refineC, parent, dir, price, refineL) : null;

  let z = refined;
  if (!z) {
      const fvgZones = findSDZones(refineC, dir, price, { freshOnly: true, dispAtr: 0.8 }).filter(x => x.fvg);
      z = fvgZones[0] || pickZone(refineC, dir, price, refineL);
  }

  const side = dir === 1 ? 'Demand' : 'Supply';
  let area, areaName, refineNote, score = 0;

  if (z) {
    area = z;
    const zoneType = z.fvg ? 'FVG' : 'OB';
    areaName = t.zoneName(side, zoneType, refineName);
    refineNote = refined ? t.refineIn(refineName, parentName) : t.nearZone(refineName);
  } else if (parent) {
    area = parent;
    const zoneType = parent.fvg ? 'FVG' : 'OB';
    areaName = t.zoneName(side, zoneType, parentName);
    refineNote = t.noRefine(refineName, parentName);
  } else {
    area = swingArea(refineC, dir, 20);
    areaName = t.swingLevel(refineName);
    refineNote = t.noSDLastSwing;
    return { dir, area, areaName, refineNote, score: -1 };
  }

  score += Math.max(0, 3 - (area.dist || 0) / atrVal);
  if (area.fvg) score += 3;
  if (dir === bias.dir) score += 2;
  if (area.fresh) score += 2;

  const trig = findRefineTrigger(refineC, dir);
  if (trig) score += trig.strong ? 1.5 : 1;

  return { dir, area, areaName, refineNote, score };
}

async function buildTwoWayPlan(o) {
  const { title, kind, price, ctx, rrList, bias, biasNote, refineC, refineName, atrVal } = o;
  const t = tx(ctx);
  const [best, other] = [evalSide(1, o), evalSide(-1, o)].sort((a, b) => b.score - a.score);
  const lines = [
    biasNote,
    best.refineNote,
    t.twoWay(best.dir === 1 ? 'BUY' : 'SELL', best.score.toFixed(1), other.dir === 1 ? 'BUY' : 'SELL', other.score.toFixed(1)),
    best.dir !== bias.dir ? t.counterTrend : '',
  ].filter(Boolean);
  return await buildAreaPlan({
    title, area: best.area, dir: best.dir, price, refineC, refineName,
    kind, atrVal, ctx, areaName: best.areaName, rrList, lines,
  });
}

async function buildDayPlan({ m5, m15, price, rrList, ctx }) {
  const t = tx(ctx);
  const { f, pip } = ctx;
  const atrM15 = atrOf(m15, pip);
  const reactionDist = reactionRangeFor('day', atrM15, ctx);
  const zOpts = { dispAtr: 0.8, freshOnly: true };
  const demand = findSDZones(m15, 1, price, zOpts)[0] || null;
  const supply = findSDZones(m15, -1, price, zOpts)[0] || null;
  const pos = classifyPriceZone(price, demand, supply, reactionDist);
  const rejection = detectRejection(m5, price, demand, supply, atrM15, NOW_MAX_ATR.day);
  const bos = findLastBOS(m15, DAY_PIVOT);
  const init = analyzePureSMCStructure(m15);
  const bias = { dir: bos ? bos.dir : init.dir };
  const biasNote = bos
    ? t.biasBOS('M15', bos.dir === 1, f(bos.level))
    : t.biasStruct('M15', srcName(init.src, ctx.lang));

  const lines = [biasNote];
  let dir, orderType, entry, baseSL, zoneRange, confidence, setup, zoneLine;

  if (pos.inSupply) {
    dir = -1;
    zoneRange = { min: supply.bottom, max: supply.top };
    zoneLine = t.zoneFresh('supply', 'M15', f(supply.bottom), f(supply.top), true);
    lines.push(t.inZone('supply', 'M15', f(supply.bottom), f(supply.top)));
    if (rejection.sellOk) {
      orderType = 'NOW'; entry = price; baseSL = supply.sl;
      confidence = 'HIGH'; setup = 'Supply Rejection NOW (Day)';
    } else {
      orderType = 'LIMIT'; entry = supply.bottom; baseSL = supply.sl;
      confidence = 'MEDIUM'; setup = 'Supply LIMIT (Day)';
    }
  } else if (pos.inDemand) {
    dir = 1;
    zoneRange = { min: demand.bottom, max: demand.top };
    zoneLine = t.zoneFresh('demand', 'M15', f(demand.bottom), f(demand.top), true);
    lines.push(t.inZone('demand', 'M15', f(demand.bottom), f(demand.top)));
    if (rejection.buyOk) {
      orderType = 'NOW'; entry = price; baseSL = demand.sl;
      confidence = 'HIGH'; setup = 'Demand Bounce NOW (Day)';
    } else {
      orderType = 'LIMIT'; entry = demand.top; baseSL = demand.sl;
      confidence = 'MEDIUM'; setup = 'Demand LIMIT (Day)';
    }
  } else if (pos.nearSupply || pos.nearDemand) {
    const useSupply = pos.nearSupply && (!pos.nearDemand || pos.distToSupply <= pos.distToDemand);
    if (useSupply) {
      dir = -1;
      zoneRange = { min: supply.bottom, max: supply.top };
      zoneLine = t.zoneFresh('supply', 'M15', f(supply.bottom), f(supply.top), false);
      lines.push(t.dist((pos.distToSupply / pip).toFixed(0), true) + ' → M15 supply');
      orderType = 'LIMIT'; entry = supply.bottom; baseSL = supply.sl;
      confidence = 'HIGH'; setup = 'Approaching Supply LIMIT (Day)';
    } else {
      dir = 1;
      zoneRange = { min: demand.bottom, max: demand.top };
      zoneLine = t.zoneFresh('demand', 'M15', f(demand.bottom), f(demand.top), false);
      lines.push(t.dist((pos.distToDemand / pip).toFixed(0), false) + ' → M15 demand');
      orderType = 'LIMIT'; entry = demand.top; baseSL = demand.sl;
      confidence = 'HIGH'; setup = 'Approaching Demand LIMIT (Day)';
    }
  } else {
    dir = bias.dir;
    const fvgEval = evaluateFVG(m15, price, dir, atrM15, FVG_LOOKBACK_BY_STYLE.day);
    lines.push(t.outside('M15', 'M15', srcName(init.src, ctx.lang)));
    if (fvgEval.useFVG && fvgEval.retraceMandatory) {
      orderType = 'LIMIT'; entry = fvgEval.entry; baseSL = fvgEval.sl;
      zoneRange = { min: fvgEval.fvg.lo, max: fvgEval.fvg.hi };
      confidence = 'HIGH';
      setup = `FVG ${dir === 1 ? 'Bull' : 'Bear'} Retrace M15 (WAJIB)`;
      zoneLine = `FVG M15 ${f(fvgEval.fvg.lo)}-${f(fvgEval.fvg.hi)}`;
    } else if (fvgEval.useFVG) {
      orderType = 'LIMIT'; entry = fvgEval.entry; baseSL = fvgEval.sl;
      zoneRange = { min: fvgEval.fvg.lo, max: fvgEval.fvg.hi };
      confidence = 'HIGH';
      setup = `FVG ${dir === 1 ? 'Bull' : 'Bear'} Interior M15`;
      zoneLine = `Harga di FVG M15 ${f(fvgEval.fvg.lo)}-${f(fvgEval.fvg.hi)}`;
    } else {
      orderType = 'NOW'; entry = price;
      baseSL = recentExtreme(m15, dir, 10);
      zoneRange = { min: price, max: price };
      confidence = 'MEDIUM';
      setup = `Market ${srcName(init.src, ctx.lang)} (Day)`;
    }
  }

  return await finalizePlan({
    dir, entry, orderType, baseSL, kind: 'day', atrVal: atrM15, ctx, rrList,
    confidence, setup, zoneNote: setup, zoneRange, zoneLine,
    head: t.headLine(t.title.day, dir === 1 ? 'BUY' : 'SELL',
      orderType === 'LIMIT' ? 'LIMIT' : 'NOW', ctx.symbol),
    lines,
  });
}

// ═══════════════════════════ INTRADAY & SWING ═══════════════════════════

async function buildIntradayPlan({ m15, price, rrList, ctx }) {
  const t = tx(ctx);
  const { f, pip } = ctx;
  const h1 = aggregateCandles(m15, 60);
  const atrH1 = atrOf(h1, pip);
  const reactionDist = reactionRangeFor('intraday', atrH1, ctx);
  const zOpts = { dispAtr: 0.8, freshOnly: true };
  const demand = findSDZones(h1, 1, price, zOpts)[0] || null;
  const supply = findSDZones(h1, -1, price, zOpts)[0] || null;
  const pos = classifyPriceZone(price, demand, supply, reactionDist);
  const rejection = detectRejection(m15, price, demand, supply, atrH1, NOW_MAX_ATR.intraday);
  const bos = findLastBOS(h1, DAY_PIVOT);
  const init = analyzePureSMCStructure(h1);
  const bias = { dir: bos ? bos.dir : init.dir };
  const biasNote = bos
    ? t.biasBOS('H1', bos.dir === 1, f(bos.level))
    : t.biasStruct('H1', srcName(init.src, ctx.lang));

  const lines = [biasNote];
  let dir, orderType, entry, baseSL, zoneRange, confidence, setup, zoneLine;

  if (pos.inSupply) {
    dir = -1;
    zoneRange = { min: supply.bottom, max: supply.top };
    zoneLine = t.zoneFresh('supply', 'H1', f(supply.bottom), f(supply.top), true);
    lines.push(t.inZone('supply', 'H1', f(supply.bottom), f(supply.top)));
    if (rejection.sellOk) {
      orderType = 'NOW'; entry = price; baseSL = supply.sl;
      confidence = 'HIGH'; setup = 'Supply Rejection NOW (Intraday)';
    } else {
      orderType = 'LIMIT'; entry = supply.bottom; baseSL = supply.sl;
      confidence = 'MEDIUM'; setup = 'Supply LIMIT (Intraday)';
    }
  } else if (pos.inDemand) {
    dir = 1;
    zoneRange = { min: demand.bottom, max: demand.top };
    zoneLine = t.zoneFresh('demand', 'H1', f(demand.bottom), f(demand.top), true);
    lines.push(t.inZone('demand', 'H1', f(demand.bottom), f(demand.top)));
    if (rejection.buyOk) {
      orderType = 'NOW'; entry = price; baseSL = demand.sl;
      confidence = 'HIGH'; setup = 'Demand Bounce NOW (Intraday)';
    } else {
      orderType = 'LIMIT'; entry = demand.top; baseSL = demand.sl;
      confidence = 'MEDIUM'; setup = 'Demand LIMIT (Intraday)';
    }
  } else if (pos.nearSupply || pos.nearDemand) {
    const useSupply = pos.nearSupply && (!pos.nearDemand || pos.distToSupply <= pos.distToDemand);
    if (useSupply) {
      dir = -1;
      zoneRange = { min: supply.bottom, max: supply.top };
      zoneLine = t.zoneFresh('supply', 'H1', f(supply.bottom), f(supply.top), false);
      lines.push(t.dist((pos.distToSupply / pip).toFixed(0), true) + ' → H1 supply');
      orderType = 'LIMIT'; entry = supply.bottom; baseSL = supply.sl;
      confidence = 'HIGH'; setup = 'Approaching Supply LIMIT (Intraday)';
    } else {
      dir = 1;
      zoneRange = { min: demand.bottom, max: demand.top };
      zoneLine = t.zoneFresh('demand', 'H1', f(demand.bottom), f(demand.top), false);
      lines.push(t.dist((pos.distToDemand / pip).toFixed(0), false) + ' → H1 demand');
      orderType = 'LIMIT'; entry = demand.top; baseSL = demand.sl;
      confidence = 'HIGH'; setup = 'Approaching Demand LIMIT (Intraday)';
    }
  } else {
    dir = bias.dir;
    const fvgEval = evaluateFVG(h1, price, dir, atrH1, FVG_LOOKBACK_BY_STYLE.intraday);
    lines.push(t.outside('H1', 'H1', srcName(init.src, ctx.lang)));
    if (fvgEval.useFVG && fvgEval.retraceMandatory) {
      orderType = 'LIMIT'; entry = fvgEval.entry; baseSL = fvgEval.sl;
      zoneRange = { min: fvgEval.fvg.lo, max: fvgEval.fvg.hi };
      confidence = 'HIGH';
      setup = `FVG ${dir === 1 ? 'Bull' : 'Bear'} Retrace H1 (WAJIB)`;
      zoneLine = `FVG H1 ${f(fvgEval.fvg.lo)}-${f(fvgEval.fvg.hi)}`;
    } else if (fvgEval.useFVG) {
      orderType = 'LIMIT'; entry = fvgEval.entry; baseSL = fvgEval.sl;
      zoneRange = { min: fvgEval.fvg.lo, max: fvgEval.fvg.hi };
      confidence = 'HIGH';
      setup = `FVG ${dir === 1 ? 'Bull' : 'Bear'} Interior H1`;
      zoneLine = `Harga di FVG H1 ${f(fvgEval.fvg.lo)}-${f(fvgEval.fvg.hi)}`;
    } else {
      orderType = 'NOW'; entry = price;
      baseSL = recentExtreme(h1, dir, 10);
      zoneRange = { min: price, max: price };
      confidence = 'MEDIUM';
      setup = `Market ${srcName(init.src, ctx.lang)} (Intraday)`;
    }
  }

  return await finalizePlan({
    dir, entry, orderType, baseSL, kind: 'intraday', atrVal: atrH1, ctx, rrList,
    confidence, setup, zoneNote: setup, zoneRange, zoneLine,
    head: t.headLine(t.title.intraday, dir === 1 ? 'BUY' : 'SELL',
      orderType === 'LIMIT' ? 'LIMIT' : 'NOW', ctx.symbol),
    lines,
  });
}

async function buildSwingPlan({ m15, price, rrList, ctx }) {
  const t = tx(ctx);
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
    areaName = t.zoneSD('H1');
    refineNote = refined ? t.swRefineIn : t.swRefineNear;
  } else if (area4) {
    area = area4;
    areaName = t.zoneSD('H4');
    refineNote = t.swRefineNoH4;
  } else {
    area = swingArea(h1, dir, 20);
    areaName = t.swingLevel('H1');
    refineNote = t.swNoAreaH1;
  }

  const biasNote = bos
    ? t.biasBOS('H4', dir === 1, ctx.f(bos.level))
    : t.biasStruct('H4', srcName(init.src, ctx.lang));

  return await buildAreaPlan({
    title: t.title.swing, area, dir, price, refineC: h1, refineName: 'H1',
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
  };
}

// ═══════════════════════════ RESOLVE PAIR DARI REQUEST ═══════════════════════════

const isKnownSymbol = s => Object.prototype.hasOwnProperty.call(DECIMALS, s);

const normalizeSymbol = raw => String(raw ?? '')
  .split(/[|:]/).pop()
  .toUpperCase()
  .replace(/[\s\/_\-]/g, '')
  .trim();

const SYMBOL_KEYS = ['symbol', 'pair', 'instrument', 'asset', 'target', 'pairName', 'ticker', 'market', 'code', 'sym'];

function findPairString(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 2) return null;
  for (const v of Object.values(obj)) {
    if (typeof v === 'string') {
      const s = normalizeSymbol(v);
      if (isKnownSymbol(s)) return s;
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const s = findPairString(v, depth + 1);
      if (s) return s;
    }
  }
  return null;
}

function resolveSymbol(body, query) {
  for (const src of [body, query]) {
    if (!src || typeof src !== 'object') continue;
    for (const key of SYMBOL_KEYS) {
      const s = normalizeSymbol(src[key]);
      if (isKnownSymbol(s)) return s;
    }
  }
  return findPairString(body) || findPairString(query) || null;
}

// ═══════════════════════════ MAIN HANDLER ═══════════════════════════

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const lang = pickLang(body, req.query);
  const t = TX[lang];

  const symbol = resolveSymbol(body, req.query);
  if (!symbol) {
    const keys = Object.keys(body).join(', ') || t.emptyBody;
    return res.status(400).json({ error: t.noPair(keys) });
  }

  const styleKey = String(body.style || body.tradingStyle || 'Scalping').trim();
  const style = STYLES[styleKey] ? styleKey : 'Scalping';
  const styleCfg = STYLES[style];

  const access = await checkAccess(body.email);
  if (!access.ok) return res.status(403).json({ error: t[access.key] });

  const dec = DECIMALS[symbol];
  const pip = pipSizeOf(symbol, dec);
  const gold = isGold(symbol);
  const prof = pairProfile(symbol);
  const f = v => Number(Number(v).toFixed(dec));
  const ctx = { symbol, dec, pip, gold, f, prof, lang };

  let apiKey = API_KEYS[0] || process.env.TICKERLAYER_API_KEY || '';

  let m1 = cleanCandles(body.candles?.m1);
  let m5 = cleanCandles(body.candles?.m5);
  let m15 = cleanCandles(body.candles?.m15);

  let price = Number(body.currentPrice);
  if (!(price > 0)) price = lastClosePrice(m5) || lastClosePrice(m15) || lastClosePrice(m1);
  if (!(price > 0)) return res.status(400).json({ error: t.noPrice });

  const [lo, hi] = prof.range;
  if (price < lo || price > hi) {
    return res.status(400).json({ error: t.range(price, symbol, lo, hi) });
  }

  const needM1 = gold && style === 'Scalping' ? NEED.m1 : 0;
  const needM5 = style === 'Scalping' || style === 'Day Trading' ? NEED.m5 : 0;
  const needM15 = NEED.m15;

  const pick = async (arr, tf, need) => {
    const frontOk = arr.length >= Math.min(need, 60) && matchesRef(arr, price);
    if (frontOk && arr.length >= need) return { candles: arr, source: 'frontend', tried: [] };
    const r = await getCandles(symbol, tf, need, apiKey, price);
    if (!r.candles.length && frontOk) return { candles: arr, source: 'frontend (parsial)', tried: r.tried };
    return r;
  };

  const [r1, r5, r15] = await Promise.all([
    needM1 ? pick(m1, '1m', needM1) : null,
    needM5 ? pick(m5, '5m', needM5) : null,
    pick(m15, '15m', needM15),
  ]);
  if (r1) m1 = r1.candles;
  if (r5) m5 = r5.candles;
  m15 = r15.candles;

  const failed = [['m1', r1], ['m5', r5], ['m15', r15]].filter(([, r]) => r && r.candles.length === 0);
  if (failed.length) {
    const detail = failed.map(([k, r]) => `${k}: ${describeTried(r.tried, price, lang)}`).join(' | ');
    console.error('candle gagal', symbol, detail);
    return res.status(502).json({ error: t.candle(symbol, price, detail) });
  }
  console.log('candle source', symbol, r1 ? r1.source : '-', r5 ? r5.source : '-', r15.source);

  if (needM1) m1 = mergeLiveBar(m1, price, 1);
  if (needM5) m5 = mergeLiveBar(m5, price, 5);
  m15 = mergeLiveBar(m15, price, 15);

  const rrList = styleCfg.rr;
  let result = { plan: null, reason: t.notProcessed };

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
    return res.status(200).json({ ok: false, reason: result.reason || t.noSetup });
  }

  const payload = toSignal(result, styleCfg, ctx);
  return res.status(200).json({ ok: true, signal: payload });
}
