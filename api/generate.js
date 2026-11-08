// api/generate.js
// v4 — Setup struktural Day Trading / Intraday / Swing (HTF bias → Sweep → CHoCH → FVG + EMA & BB).
//      Candle TickerLayer diambil per potongan 2 hari sampai hari ini (bar terbaru).
//      4h dibentuk dari 1h, 30m dibentuk dari 15m.
//      Jika tidak ada area valid, server TIDAK memaksa sinyal (signal: null).

const KV_KEY = 'alu_clients';
const XBTFX_BASE_URL = 'https://interface.xbtfx.com';
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

// Konsistensi RRR untuk setiap gaya trading
const STYLES = {
  'Scalping': { label: 'Scalping Agresif (Crypto 30-50 Pip & Currency Fix)', mode: 'MARKET', kind: 'scalp', rr: [1.0, 2.0, 3.0] },
  'Day Trading': { label: 'Day Trading (Limit Order Zona & Bollinger Bands)', mode: 'LIMIT', kind: 'day', rr: [1.5, 2.5, 3.5] },
  'Intraday': { label: 'Intraday (Limit Order + EMA + BB)', mode: 'LIMIT', kind: 'intraday', rr: [1.5, 3.0, 5.5] },
  'Swing': { label: 'Swing Trading (Limit Order + Multi EMA + BB)', mode: 'LIMIT', kind: 'swing', rr: [2.0, 4.5, 8.5] },
};

// Konfigurasi setup struktural (khusus non-scalp)
// ema       : [fast, slow] EMA di HTF untuk bias arah
// pivot     : jumlah candle kiri/kanan untuk swing point
// lookback  : jumlah candle MTF yang dipindai untuk sweep
// riskAtr   : rentang lebar SL (kelipatan ATR MTF)
// maxDist   : jarak maksimum harga ke entry (kelipatan ATR) agar area dianggap aktif
// expireMin : umur pending order (menit) sebelum dibatalkan frontend
const SETUP_CFG = {
  day:      { ema: [20, 50], pivot: 3, lookback: 60, riskAtr: [0.8, 2.5], maxDist: 2.0, expireMin: 240 },
  intraday: { ema: [20, 50], pivot: 3, lookback: 80, riskAtr: [0.8, 3.0], maxDist: 2.0, expireMin: 720 },
  swing:    { ema: [20, 50], pivot: 4, lookback: 80, riskAtr: [1.0, 3.5], maxDist: 1.5, expireMin: 2880 },
};

// Timeframe per gaya untuk fallback server: htf = bias, mtf = setup (samakan dengan STYLE_TF di frontend)
const STYLE_TF_SERVER = {
  'Day Trading': { htf: '1h', mtf: '30m' },
  'Intraday':    { htf: '4h', mtf: '1h' },
  'Swing':       { htf: '1d', mtf: '4h' },
};

// Menit per timeframe
const TF_MIN = { '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440 };

// Interval yang diminta langsung ke endpoint range TickerLayer
const TL_SPAN = {
  '15m': { mult: 15, span: 'minute', minutes: 15 },
  '1h':  { mult: 60, span: 'minute', minutes: 60 },
  '1d':  { mult: 1,  span: 'day',    minutes: 1440 },
};

// Interval yang dibentuk dari base (diagregasi di server)
const BASE_OF = { '30m': '15m', '4h': '1h' };

const CHUNK_MS = 2 * 86400000; // potongan 2 hari, sekitar 4.320 bar menit (di bawah limit 5.000)
const MAX_CHUNKS = 30;

const orderLabel = (dir, orderType) => `${dir === 1 ? 'BUY' : 'SELL'} ${orderType === 'LIMIT' ? 'LIMIT' : 'NOW'}`;

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

// Deteksi kategori asset & pemetaan format simbol untuk TickerLayer
function mapSymbolToTickerLayer(symbol) {
  const s = symbol.toUpperCase().trim();
  if (['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD', 'DOGEUSD', 'AVAXUSD', 'LINKUSD'].includes(s)) {
    return { asset: 'crypto', symbol: s };
  }
  if (s === 'US30' || s === 'SPX500') return { asset: 'stocks', symbol: `US:${s}` };
  if (s === 'NAS100') return { asset: 'stocks', symbol: 'US:NDX' };
  if (s.includes('XAU') || s.includes('XAG')) return { asset: 'forex', symbol: s };
  return { asset: 'forex', symbol: s };
}

const isoDate = d => d.toISOString().slice(0, 10);

// Ambil candle TERBARU dari endpoint range TickerLayer:
// GET /{asset}/agg/{symbol}/{mult}/{span}/{from}/{to}?sort=asc&limit=5000
// Timeframe menit dipecah per 2 hari supaya bar terbaru tidak terpotong limit.
async function fetchTickerLayerOHLC(symbol, interval, apiKey, need) {
  const out = { rows: [], status: 'OK', reqs: 0 };
  const tf = TL_SPAN[interval];
  if (!apiKey) { out.status = 'KEY KOSONG'; return out; }
  if (!tf) { out.status = 'TF TIDAK DIDUKUNG'; return out; }

  const mapped = mapSymbolToTickerLayer(symbol);
  const now = Date.now();
  const startMs = now - Math.ceil(need * 1.2 * tf.minutes * 60000) - 86400000;
  const byT = new Map();

  const request = async (fromMs, toMs) => {
    const url = `${TICKERLAYER_BASE_URL}/${mapped.asset}/agg/${mapped.symbol}/${tf.mult}/${tf.span}/${isoDate(new Date(fromMs))}/${isoDate(new Date(toMs))}?sort=asc&limit=5000`;
    out.reqs++;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      out.status = `HTTP ${response.status}`;
      return;
    }
    const data = await response.json();
    const rows = Array.isArray(data) ? data : (data.results || []);
    for (const c of rows) {
      const cand = {
        t: Number(c.t || 0),
        o: Number(c.o || 0),
        h: Number(c.h || 0),
        l: Number(c.l || 0),
        c: Number(c.c || 0),
      };
      if (cand.t > 0 && [cand.o, cand.h, cand.l, cand.c].every(Number.isFinite)) byT.set(cand.t, cand);
    }
  };

  try {
    if (tf.span === 'day') {
      await request(startMs, now + 86400000);
    } else {
      let toMs = now + 86400000;
      while (toMs > startMs && out.reqs < MAX_CHUNKS) {
        const fromMs = Math.max(startMs, toMs - CHUNK_MS);
        await request(fromMs, toMs);
        toMs = fromMs;
      }
    }
  } catch (err) {
    out.status = `ERR ${err.message}`;
    console.error(`Gagal fetch TickerLayer ${interval} ${symbol}:`, err);
  }

  out.rows = [...byT.values()].sort((a, b) => a.t - b.t).slice(-300);
  console.log(`TickerLayer ${interval} ${symbol}: ${out.rows.length} candle, ${out.reqs} req, ${out.status}`);
  return out;
}

function cleanCandles(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map(c => ({ t: Number(c?.t), o: Number(c?.o), h: Number(c?.h), l: Number(c?.l), c: Number(c?.c) }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
}

// Gabungkan candle kecil menjadi candle besar, mis. 1h → 4h
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

// Ambil candle satu TF: langsung dari TickerLayer bila didukung, sisanya dibentuk dari base
async function getCandles(symbol, tf, need, apiKey) {
  const notes = [];
  let best = [];

  if (TL_SPAN[tf]) {
    const nat = await fetchTickerLayerOHLC(symbol, tf, apiKey, Math.max(need, 150));
    notes.push(`native ${tf} ${nat.rows.length} (${nat.status})`);
    best = nat.rows;
    if (nat.rows.length >= need) return { candles: nat.rows, note: notes.join(' · ') };
  }

  const baseTf = BASE_OF[tf];
  if (baseTf) {
    const factor = TF_MIN[tf] / TF_MIN[baseTf];
    const base = await fetchTickerLayerOHLC(symbol, baseTf, apiKey, need * factor + factor * 5);
    const agg = aggregateCandles(base.rows, TF_MIN[tf]);
    notes.push(`base ${baseTf} ${base.rows.length} (${base.status}) → ${tf} ${agg.length}`);
    if (agg.length > best.length) best = agg;
  }

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
    const slice = candles.slice(-period);
    const closes = slice.map(c => Number(c.c)).filter(Number.isFinite);
    if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };

    const middle = closes.reduce((sum, val) => sum + val, 0) / period;
    const variance = closes.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    return {
      middle: Number(middle.toFixed(5)),
      upper: Number((middle + (multiplier * stdDev)).toFixed(5)),
      lower: Number((middle - (multiplier * stdDev)).toFixed(5))
    };
  } catch {
    return { upper: 0, middle: 0, lower: 0 };
  }
}

// ===== Scalping (tidak berubah) =====
function structureDir(candles, emaFilter = {}, bbFilter = {}) {
  if (!candles || candles.length < 5) return 1;
  const last = candles[candles.length - 1], first = candles[0];
  let baseDir = last.c >= first.c ? 1 : -1;

  const emaKeys = Object.keys(emaFilter);
  if (emaKeys.length > 0) {
    const fastKey = emaKeys[0];
    const slowKey = emaKeys[emaKeys.length - 1];
    const fastVal = emaFilter[fastKey];
    const slowVal = emaFilter[slowKey];

    if (fastVal && slowVal && fastVal > 0 && slowVal > 0) {
      if (fastVal > slowVal && baseDir === 1) return 1;
      if (fastVal < slowVal && baseDir === -1) return -1;
    }
  }

  const low = Number(bbFilter?.lower || 0);
  const up = Number(bbFilter?.upper || 0);
  if (low > 0 && up > 0) {
    if (last.c <= low * 1.002) return 1;
    if (last.c >= up * 0.998) return -1;
  }

  return baseDir;
}

function getAbsoluteScalpOffsets(symbol) {
  const s = symbol.toUpperCase();
  if (s.includes('XAU')) return { buffer: 1.0, sl: 2.8, type: 'XAU_20_30_PIP' };
  if (s.includes('XAG')) return { buffer: 2.0, sl: 5.6, type: 'XAG_2X_XAU' };
  if (s.includes('DXY')) return { buffer: 0.10, sl: 0.30, type: 'DXY_FIX' };
  if (s.includes('BTC')) return { buffer: 12.0, sl: 35.0, type: 'BTC_30_50_PIP' };
  if (s.includes('ETH')) return { buffer: 1.5, sl: 4.5, type: 'ETH_30_50_PIP' };
  if (s.includes('SOL') || s.includes('BNB') || s.includes('XRP') || s.includes('LTC') || s.includes('AVAX') || s.includes('LINK')) {
    return { buffer: 1.0, sl: 3.5, type: 'ALT_30_50_PIP' };
  }
  if (s.includes('USDJPY') || s.includes('GBPJPY') || s.includes('EURJPY') || s.includes('AUDJPY') || s.includes('CADJPY') || s.includes('CHFJPY')) {
    return { buffer: 0.20, sl: 0.50, type: 'JPY_CROSS_50PIP' };
  }
  if (s.includes('GBPUSD')) return { buffer: 0.0020, sl: 0.0050, type: 'GBPUSD_50PIP' };
  if (s.includes('AUDUSD')) return { buffer: 0.0012, sl: 0.0035, type: 'AUDUSD_30PIP' };
  if (s.includes('USDCAD')) return { buffer: 0.0030, sl: 0.0080, type: 'USDCAD_80PIP' };
  if (s.includes('USDCHF')) return { buffer: 0.0022, sl: 0.0060, type: 'USDCHF_60PIP' };
  if (s.includes('EUR') || s.includes('NZD') || s.includes('CHF') || s.includes('CAD')) {
    return { buffer: 0.0020, sl: 0.0055, type: 'CURRENCY_50_60_PIP' };
  }
  if (s.includes('US30') || s.includes('NAS100') || s.includes('SP500') || s.includes('GER40') || s.includes('UK100') || s.includes('JPN225')) {
    return { buffer: 20.0, sl: 60.0, type: 'INDEX_FIX' };
  }
  return { buffer: 0.0020, sl: 0.0055, type: 'DEFAULT_FIX' };
}

function scalpHitRun(mtfC, ltfC, htfDir, price, symbol, emaFilter, bbFilter, rrList) {
  let dir = structureDir(mtfC, emaFilter, bbFilter);
  if (dir === 0) dir = htfDir !== 0 ? htfDir : 1;
  const activeDir = htfDir !== 0 ? htfDir : dir;
  const isBuy = activeDir === 1;

  const offsets = getAbsoluteScalpOffsets(symbol);
  const bufferEnd = isBuy ? price - offsets.buffer : price + offsets.buffer;
  const sl = isBuy ? price - offsets.sl : price + offsets.sl;

  const riskDistance = Math.abs(price - sl);
  const tp1 = isBuy ? price + (rrList[0] * riskDistance) : price - (rrList[0] * riskDistance);
  const tp2 = isBuy ? price + (rrList[1] * riskDistance) : price - (rrList[1] * riskDistance);
  const tp3 = isBuy ? price + (rrList[2] * riskDistance) : price - (rrList[2] * riskDistance);

  return {
    dir: activeDir,
    plan: {
      kind: 'hitrun',
      orderType: 'NOW',
      mode: 'DIRECT',
      entry: price,
      bufferEnd: bufferEnd,
      status: 'RUNNING',
      sl: sl,
      tps: [tp1, tp2, tp3],
      zone: { min: Math.min(price, bufferEnd), max: Math.max(price, bufferEnd) },
      trigSrc: `Scalping Agresif (TickerLayer + EMA + BB Filter) [${offsets.type}]`,
      expireMs: 0,
      zoneNote: `Range Mode (${offsets.type})`
    }
  };
}

// ===== Setup struktural: Day Trading / Intraday / Swing =====

function emaSeries(values, period) {
  const k = 2 / (period + 1);
  let e = values[0];
  return values.map(v => (e = v * k + e * (1 - k)));
}

// Swing point: candle i dianggap pivot jika high/low-nya paling tinggi/rendah
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

// Bias HTF: struktur (HH/HL atau LH/LL) HARUS searah dengan EMA fast/slow
function htfBias(htfC, cfg) {
  const closes = htfC.map(c => c.c);
  const fast = emaSeries(closes, cfg.ema[0]);
  const slow = emaSeries(closes, cfg.ema[1]);
  const fLast = fast[fast.length - 1];
  const sLast = slow[slow.length - 1];
  const last = closes[closes.length - 1];
  const emaDir = (fLast > sLast && last > sLast) ? 1 : ((fLast < sLast && last < sLast) ? -1 : 0);

  const { highs, lows } = findPivots(htfC, cfg.pivot);
  let structDir = 0;
  if (highs.length >= 2 && lows.length >= 2) {
    const [h1, h2] = highs.slice(-2);
    const [l1, l2] = lows.slice(-2);
    if (h2.p > h1.p && l2.p > l1.p) structDir = 1;
    else if (h2.p < h1.p && l2.p < l1.p) structDir = -1;
  }

  const dir = (structDir !== 0 && structDir === emaDir) ? structDir : 0;
  return { dir, fast: fLast, slow: sLast };
}

// Mencari urutan: Sweep likuiditas → CHoCH → FVG segar (pending) di MTF
function findStructuralSetup(mtfC, dir, cfg, price, bb) {
  const n = mtfC.length;
  const atrV = atr(mtfC, 14);
  const { highs, lows } = findPivots(mtfC, cfg.pivot);
  const pivots = dir === 1 ? lows : highs;
  const from = Math.max(0, n - cfg.lookback);
  let reason = 'Belum ada sweep likuiditas searah bias HTF.';

  for (let pi = pivots.length - 1; pi >= 0; pi--) {
    const piv = pivots[pi];
    if (piv.i < from) break;

    // 1) Liquidity sweep: wick menembus swing point lalu close kembali
    let k = -1;
    for (let x = piv.i + cfg.pivot + 1; x < n; x++) {
      const c = mtfC[x];
      const swept = dir === 1 ? (c.l < piv.p && c.c > piv.p) : (c.h > piv.p && c.c < piv.p);
      if (swept) { k = x; break; }
    }
    if (k < 0) continue;

    // 2) CHoCH: close menembus ekstrem range antara swing dan sweep
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

    // 3) FVG terbaru setelah sweep yang belum termitigasi
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

    // 4) Area harus pending: harga belum menyentuh zona (limit menunggu retrace)
    const entry = (zone.min + zone.max) / 2;
    const pending = dir === 1 ? price > zone.max : price < zone.min;
    if (!pending) {
      reason = 'Harga sudah berada di dalam atau melewati FVG; tidak ada area limit baru.';
      continue;
    }

    const dist = Math.abs(price - entry) / atrV;
    if (dist > cfg.maxDist) {
      reason = `FVG terlalu jauh dari harga (${dist.toFixed(1)} ATR, batas ${cfg.maxDist} ATR).`;
      continue;
    }

    // 5) Filter BB: BUY hanya di discount (<= BB middle), SELL hanya di premium (>= BB middle)
    if (bb && bb.middle > 0) {
      const okZone = dir === 1 ? entry <= bb.middle : entry >= bb.middle;
      if (!okZone) {
        reason = `FVG berada di ${dir === 1 ? 'premium' : 'discount'} terhadap BB middle.`;
        continue;
      }
    }

    // 6) SL di luar likuiditas yang disapu, lebar dibatasi oleh riskAtr
    const sw = mtfC[k];
    const extreme = dir === 1 ? Math.min(sw.l, zone.min) : Math.max(sw.h, zone.max);
    const pad = 0.2 * atrV;
    let sl = dir === 1 ? extreme - pad : extreme + pad;
    let risk = Math.abs(entry - sl);
    if (risk > cfg.riskAtr[1] * atrV) {
      reason = `SL terlalu lebar (${(risk / atrV).toFixed(1)} ATR, batas ${cfg.riskAtr[1]} ATR).`;
      continue;
    }
    if (risk < cfg.riskAtr[0] * atrV) {
      risk = cfg.riskAtr[0] * atrV;
      sl = dir === 1 ? entry - risk : entry + risk;
    }

    return {
      plan: {
        dir,
        entry,
        zone,
        sl,
        risk,
        dist,
        atr: atrV,
        sweepLvl: piv.p,
        sweepWick: dir === 1 ? sw.l : sw.h,
        rangeLvl,
      },
    };
  }

  return { plan: null, reason };
}

function buildGeneralPlan({ htfC, mtfC, styleKind, price, rrList, bb, dec }) {
  const cfg = SETUP_CFG[styleKind];
  const minHtf = cfg.ema[1] + 5;
  if (htfC.length < minHtf || mtfC.length < 30) {
    return { plan: null, reason: `Data candle belum cukup (HTF min ${minHtf}, MTF min 30 candle).` };
  }

  const bias = htfBias(htfC, cfg);
  if (bias.dir === 0) {
    return { plan: null, reason: `Bias HTF belum jelas: struktur (HH/HL atau LH/LL) dan EMA${cfg.ema[0]}/EMA${cfg.ema[1]} harus searah.` };
  }

  const found = findStructuralSetup(mtfC, bias.dir, cfg, price, bb);
  if (!found.plan) return { plan: null, reason: found.reason };

  const p = found.plan;
  const dir = p.dir;
  const f = v => Number(v).toFixed(dec);
  const tps = rrList.map(rr => p.entry + dir * rr * p.risk);
  const riskAtr = p.risk / p.atr;
  const riskLabel = riskAtr <= 1.5 ? 'LOW' : riskAtr <= 2.5 ? 'MEDIUM' : 'HIGH';
  const confidence = (p.dist <= 1 && riskLabel === 'LOW') ? 'HIGH' : 'MEDIUM';
  const biasTxt = dir === 1 ? 'BULLISH' : 'BEARISH';

  const bbTxt = (bb && bb.middle > 0)
    ? `BB filter: entry ${f(p.entry)} di ${dir === 1 ? 'discount' : 'premium'} (BB middle ${f(bb.middle)}).`
    : 'BB filter: data BB belum tersedia.';

  const reason = [
    `Bias HTF ${biasTxt}: struktur ${dir === 1 ? 'HH/HL' : 'LH/LL'} searah EMA${cfg.ema[0]} (${f(bias.fast)}) ${dir === 1 ? '>' : '<'} EMA${cfg.ema[1]} (${f(bias.slow)}).`,
    `Liquidity sweep di ${dir === 1 ? 'swing low' : 'swing high'} ${f(p.sweepLvl)} (wick ${f(p.sweepWick)}), lalu close kembali ke dalam range.`,
    `CHoCH: close menembus ${f(p.rangeLvl)} setelah sweep.`,
    `FVG ${f(p.zone.min)} – ${f(p.zone.max)} belum termitigasi, entry di 50% (${f(p.entry)}).`,
    bbTxt,
    `Jarak harga ke entry ${p.dist.toFixed(1)} ATR, lebar SL ${riskAtr.toFixed(1)} ATR.`,
    `RRR: TP1 1:${rrList[0]}, TP2 1:${rrList[1]}, TP3 1:${rrList[2]}.`,
  ].join(' • ');

  return {
    dir,
    plan: {
      kind: styleKind,
      orderType: 'LIMIT',
      status: 'PENDING',
      entry: p.entry,
      bufferEnd: dir === 1 ? p.zone.min : p.zone.max,
      sl: p.sl,
      tps,
      zone: { min: p.zone.min, max: p.zone.max },
      expireMs: cfg.expireMin * 60 * 1000,
      zoneNote: `Sweep > CHoCH > FVG · HTF ${biasTxt}`,
    },
    confidence,
    riskLabel,
    setup: 'CONTINUATION',
    reason,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const email = String(body.email || req.headers['x-user-email'] || '').trim().toLowerCase();

    // Ambil TickerLayer API Key dari Environment Variables Vercel
    const tickerLayerApiKey = String(process.env.TICKERLAYER_API_KEY || '').trim();

    const styleKey = body.tradingStyle || 'Scalping';
    const style = STYLES[styleKey] || STYLES['Scalping'];
    const rrList = style.rr;
    const symbol = String(body.marketId || '').split('|').pop().toUpperCase();
    const dec = DECIMALS[symbol] ?? 2;
    const emaFilter = body.emaFilter || {};

    const access = await checkAccess(email);
    if (!access.ok) return res.status(403).json({ error: access.msg });

    let htfC = cleanCandles(body.candles?.htf);
    let mtfC = cleanCandles(body.candles?.mtf ?? body.candles?.entry);
    let ltfC = cleanCandles(body.candles?.ltf);

    const price = Number(body.currentPrice) || (mtfC.length > 0 ? mtfC[mtfC.length - 1].c : 2000);

    let dir = 0, plan = null, meta = null, bbFilter;

    if (style.kind === 'scalp') {
      if (htfC.length === 0 || mtfC.length === 0) {
        htfC = (await fetchTickerLayerOHLC(symbol, '1h', tickerLayerApiKey, 100)).rows;
        mtfC = (await fetchTickerLayerOHLC(symbol, '15m', tickerLayerApiKey, 100)).rows;
      }

      const incomingBb = body.bbFilter;
      bbFilter = (incomingBb && Number(incomingBb.middle) > 0)
        ? {
            upper: Number(incomingBb.upper || 0),
            middle: Number(incomingBb.middle || 0),
            lower: Number(incomingBb.lower || 0)
          }
        : calculateBollingerBands(mtfC.length > 0 ? mtfC : ltfC);

      const htfDir = structureDir(htfC, emaFilter, bbFilter);
      const hr = scalpHitRun(mtfC, ltfC, htfDir, price, symbol, emaFilter, bbFilter, rrList);
      dir = hr.dir;
      plan = hr.plan;
    } else {
      const tf = STYLE_TF_SERVER[styleKey];
      const htfNeed = SETUP_CFG[style.kind].ema[1] + 5;
      const mtfNeed = 30;

      let htfNote = `frontend ${htfC.length}`;
      let mtfNote = `frontend ${mtfC.length}`;

      // Kiriman frontend sering pendek, jadi ambil dari server bila kurang
      if (htfC.length < htfNeed) {
        const h = await getCandles(symbol, tf.htf, htfNeed, tickerLayerApiKey);
        htfNote = h.note;
        if (h.candles.length > htfC.length) htfC = h.candles;
      }
      if (mtfC.length < mtfNeed) {
        const m = await getCandles(symbol, tf.mtf, mtfNeed, tickerLayerApiKey);
        mtfNote = m.note;
        if (m.candles.length > mtfC.length) mtfC = m.candles;
      }

      if (htfC.length < htfNeed || mtfC.length < mtfNeed) {
        return res.status(200).json({
          ok: true,
          signal: null,
          reason: `DATA CANDLE BELUM CUKUP · ${style.label}\n` +
                  `HTF ${tf.htf}: ${htfC.length}/${htfNeed} · MTF ${tf.mtf}: ${mtfC.length}/${mtfNeed}\n` +
                  `Detail HTF: ${htfNote}\n` +
                  `Detail MTF: ${mtfNote}`,
        });
      }

      bbFilter = calculateBollingerBands(mtfC);

      const gp = buildGeneralPlan({
        htfC, mtfC, styleKind: style.kind, price, rrList, bb: bbFilter, dec
      });
      if (!gp.plan) {
        // Tidak ada area valid → tidak ada sinyal (bukan dipaksa)
        return res.status(200).json({
          ok: true,
          signal: null,
          reason: `TIDAK ADA AREA VALID · ${style.label}\n${gp.reason}`,
        });
      }
      dir = gp.dir;
      plan = gp.plan;
      meta = gp;
    }

    const entry = plan.entry;
    const r = v => Number(v.toFixed(dec));
    const tps = plan.tps || [entry + dir * 20, entry + dir * 40, entry + dir * 60];

    const actionType = plan.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET';
    const sideText = dir === 1 ? 'BUY' : 'SELL';

    const zoneNoteText = plan.zoneNote || 'Range Mode (Scalp)';
    const zoneLabelText = plan.orderType === 'LIMIT' ? 'Limit Order Zone (Waiting)' : 'Market Execution Zone';

    let techReason;
    if (meta) {
      techReason = meta.reason;
    } else {
      const emaSummary = Object.entries(emaFilter).map(([k, v]) => `${k}: ${v}`).join(' | ');
      const bbSummary = `Upper: ${bbFilter.upper} | Mid: ${bbFilter.middle} | Lower: ${bbFilter.lower}`;
      const actionDesc = sideText === 'BUY'
        ? 'menempatkan Pending Order BUY LIMIT pada area struktur Demand / Order Block riil'
        : 'menempatkan Pending Order SELL LIMIT pada area struktur Supply / Order Block riil';

      techReason = [
        `Analisis Struktur Jauh SMC ${sideText} (${style.label}) pada pair ${symbol}.`,
        `Mekanisme Eksekusi: Menggunakan Limit Order (Pending Order / WAITING) dengan memindai titik Swing High/Low dari data bar OHLC TickerLayer.`,
        `Alasan: Diputuskan ${actionDesc}. Indikator EMA (${emaSummary}) serta Bollinger Bands (${bbSummary}) memfilter area jenuh.`,
        `Manajemen Risiko: Lebar zona dan Stop Loss ditarik dari struktur market asli dengan target RRR [TP1: 1:${rrList[0]}, TP2: 1:${rrList[1]}, TP3: 1:${rrList[2]}].`
      ].join('\n\n');
    }

    return res.status(200).json({
      ok: true,
      signal: {
        signal: sideText,
        mode: actionType,
        orderType: plan.orderType,
        orderLabel: orderLabel(dir, plan.orderType),
        status: plan.status,
        entry: r(entry),
        bufferEnd: r(plan.bufferEnd || entry),
        sl: r(plan.sl),
        tp1: r(tps[0]), tp2: r(tps[1]), tp3: r(tps[2]),
        zone: plan.zone ? { min: r(plan.zone.min), max: r(plan.zone.max) } : null,
        expireMs: plan.expireMs || 0,
        confidence: meta ? meta.confidence : 'HIGH',
        risk: meta ? meta.riskLabel : 'LOW',
        setup: meta ? meta.setup : `STRUCTURAL PENDING ZONE (RRR Target: 1:${rrList[0]} - 1:${rrList[2]})`,
        setupLabel: style.label,
        zoneLabel: zoneLabelText,
        zoneNote: zoneNoteText,
        reason: techReason
      }
    });
  } catch (err) {
    console.error('generate error stack:', err);
    return res.status(200).json({ ok: false, error: 'Server error: ' + (err.message || 'Unknown error') });
  }
}
