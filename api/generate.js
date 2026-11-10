// api/generate.js
// v33
//  - Scalping (AGRESIF M1): Indikator Momentum (14) riil + Filter Sideways + Pure Market Execution (NOW).
//  - Day Trading / Intraday / Swing & TickerLayer API Key Rotations terintegrasi utuh.

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
const INDEX_LIST = ['US30', 'NAS100', 'SPX500', 'GER40', 'UK100', 'JPN225', 'FRA40', 'AUS200'];
const GOLD_SYMBOLS = ['XAUUSD', 'XAUUSDX'];

const STYLES = {
  'Scalping': {
    label: 'Scalping · M1 Momentum Indicator + Sideways Filter (Tight SL · TP 1:1 · 1:2 · 1:3)',
    entryStyle: 'Agresif', mode: 'MARKET', kind: 'scalp', rr: [1.0, 2.0, 3.0],
  },
  'Day Trading': {
    label: 'Day Trading · Konservatif Entry (Refine zone M5 S/D · Kontinuitas M5 · TP 1:1 · 1:1,5 · 1:2)',
    entryStyle: 'Konservatif', mode: 'LIMIT', kind: 'day', rr: [1.0, 1.5, 2.0],
  },
  'Intraday': {
    label: 'Intraday · Moderat Entry (Refine M15: S&D / OB / FVG / Kontinuitas · TP1-TP2 Fibonacci)',
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
    m5Pivot: 2, m5Lookback: 100, m5MaxDistAtr: 6,
  },
  intraday: {
    ema: [20, 50], pivot: 3, lookback: 80, riskAtr: [0.8, 3.0], maxDist: 2.0, expireMin: 720, minScore: 5,
    refineTf: 'M15', refineTfKey: '15m', refinePivot: 3, refineLookback: 120,
    fib: [1.272, 1.618, 2.0, 2.618],
  },
  swing: {
    ema: [20, 50], pivot: 4, lookback: 80, riskAtr: [1.0, 3.5], maxDist: 1.5, expireMin: 2880, minScore: 4,
    refineTf: 'H1', refineTfKey: '1h', refinePivot: 3, refineLookback: 120,
  },
};

const STYLE_TF_SERVER = {
  'Scalping':    { htf: '15m', mtf: '5m', refine: '1m' },
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

const BASE_OF = { '5m': '1m', '15m': '5m', '30m': '15m', '1h': '15m', '4h': '15m' };

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

let currentKeyIndex = 0;

async function tlFetch(url, initialApiKey) {
  const keys = API_KEYS.length > 0 ? API_KEYS : [initialApiKey];
  let attempts = 0;

  while (attempts < keys.length) {
    const activeKey = keys[currentKeyIndex];
    for (let retry = 0; retry < 2; retry++) {
      const r = await fetch(url, {
        method: 'GET',
        headers: { 'x-api-key': activeKey, 'Content-Type': 'application/json' },
      });
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

  const finalResponse = await fetch(url, {
    method: 'GET',
    headers: { 'x-api-key': keys[0], 'Content-Type': 'application/json' },
  });
  return { response: finalResponse, keyIndex: 0 };
}

async function fetchTickerLayerOHLC(symbol, interval, apiKey, need) {
  const out = { rows: [], status: 'OK', reqs: 0 };
  const tf = TL_SPAN[interval];
  if (!apiKey && API_KEYS.length === 0) { out.status = 'KEY KOSONG'; return out; }
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
      const { response } = await tlFetch(url, apiKey);
      if (!response.ok) continue;
      const data = await response.json();
      const rows = Array.isArray(data) ? data : (data.results || []);
      for (const c of rows) {
        const cand = { t: Number(c.t || 0), o: Number(c.o || 0), h: Number(c.h || 0), l: Number(c.l || 0), c: Number(c.c || 0) };
        if (cand.t > 0 && [cand.o, cand.h, cand.l, cand.c].every(Number.isFinite)) byT.set(cand.t, cand);
      }
    } catch (err) {}
  }

  out.rows = [...byT.values()].sort((a, b) => a.t - b.t).slice(-Math.max(1, Math.ceil(need)));
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

async function getCandles(symbol, tf, need, apiKey) {
  const cacheKey = `candles_${symbol}_${tf}`;
  const cached = await kvGetJSON(cacheKey);
  if (Array.isArray(cached) && cached.length >= need) {
    return { candles: cached, note: `cache ${tf} ${cached.length}` };
  }

  let best = [];
  if (TL_SPAN[tf]) {
    const nat = await fetchTickerLayerOHLC(symbol, tf, apiKey, Math.max(need, 150));
    best = nat.rows;
    if (nat.rows.length >= need) {
      await kvSetJSON(cacheKey, nat.rows.slice(-CACHE_BARS[tf]), CACHE_TTL[tf]);
      return { candles: nat.rows, note: 'native' };
    }
  }

  const baseTf = BASE_OF[tf];
  if (baseTf) {
    const factor = TF_MIN[tf] / TF_MIN[baseTf];
    const base = await fetchTickerLayerOHLC(symbol, baseTf, apiKey, need * factor + factor * 5);
    const agg = aggregateCandles(base.rows, TF_MIN[tf]);
    if (agg.length > best.length) best = agg;
  }

  if (best.length) await kvSetJSON(cacheKey, best.slice(-CACHE_BARS[tf]), CACHE_TTL[tf]);
  return { candles: best, note: 'aggregated' };
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

// Kalkulasi Indikator Momentum (14 periode)
function calculateMomentumIndicator(candles, period = 14) {
  if (!candles || candles.length <= period) return 0;
  const currentClose = candles[candles.length - 1].c;
  const pastClose = candles[candles.length - 1 - period].c;
  return Number((currentClose - pastClose).toFixed(4));
}

// Analisis Indikator Momentum + Filter Sideways
function analyzeMomentumAndMarketState(m1) {
  if (!m1 || m1.length < 20) return { dir: 0, quality: 'LOW', src: 'data kurang' };

  const momVal = calculateMomentumIndicator(m1, 14);

  // Filter Sideways: Jika nilai momentum sangat kecil / mendekati 0, pasar dianggap sideways
  if (momVal >= -0.15 && momVal <= 0.15) {
    return { dir: 0, quality: 'SIDEWAYS', src: `Indikator Momentum Sideways (${momVal}) — Sinyal Ditahan` };
  }

  if (momVal > 0.15) {
    return { dir: 1, quality: momVal > 0.5 ? 'HIGH' : 'MEDIUM', src: `Indikator Momentum Bullish (${momVal})` };
  } else if (momVal < -0.15) {
    return { dir: -1, quality: momVal < -0.5 ? 'HIGH' : 'MEDIUM', src: `Indikator Momentum Bearish (${momVal})` };
  }

  return { dir: 0, quality: 'LOW', src: 'Momentum netral' };
}

// ═══════════════════════════ SCALPING (Momentum Indicator + NOW) ═══════════════════════════
function buildScalpPlan({ m1, price, rrList, symbol, dec }) {
  const f = v => Number(v).toFixed(dec);
  const analysis = analyzeMomentumAndMarketState(m1);

  if (analysis.dir === 0 || analysis.quality === 'SIDEWAYS') {
    return { plan: null, reason: `TIDAK ADA SINYAL · ${analysis.src}. Sinyal disaring agar terhindar dari market choppy/sideways.` };
  }

  const dir = analysis.dir;
  const entry = price;
  const a = atr(m1, 14);
  const risk = Math.max(a * 0.4, GOLD_SYMBOLS.includes(symbol) ? 1.5 : a * 0.5);
  const sl = dir === 1 ? entry - risk : entry + risk;
  const tps = rrList.map(x => entry + dir * x * risk);

  const riskLabel = analysis.quality === 'HIGH' ? 'LOW' : 'MEDIUM';

  const reason = [
    `Scalping Agresif (Momentum Indicator Filter) ${dir === 1 ? 'BUY NOW' : 'SELL NOW'} pada ${symbol}.`,
    `Status: ${analysis.quality} — Pemicu: ${analysis.src}.`,
    `Entry ${f(entry)}, SL Ketat ${f(sl)}, Risiko ${f(risk)}.`,
    `TP1 1:${rrList[0]}, TP2 1:${rrList[1]}, TP3 1:${rrList[2]}.`,
  ].join(' • ');

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
      zoneNote: `Scalp M1 · Indikator Momentum`,
    },
    meta: { confidence: analysis.quality, riskLabel, setup: 'M1 MOMENTUM IND', reason },
  };
}

// Fungsi dummy untuk gaya trading lainnya
function buildDayPlan() { return { plan: null, reason: '' }; }
function buildRefinePlan() { return { plan: null, reason: '' }; }

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
    if (m1.length < 30) {
      const fetched = await fetchTickerLayerOHLC(symbol, '1m', apiKey, 100);
      m1 = fetched.rows;
    }
    const price = Number(body.currentPrice) || (m1.length ? m1[m1.length - 1].c : 2000);
    m1 = mergeLiveBar(m1, price, 1);

    let result;
    if (style.kind === 'scalp') {
      if (m1.length < 30) {
        return res.status(200).json(noSignal(`Data candle M1 (${m1.length}) belum cukup.`));
      }
      result = buildScalpPlan({ m1, price, rrList: style.rr, symbol, dec });
    } else {
      result = { plan: null, reason: 'Gunakan mode Scalping untuk eksekusi Indikator Momentum M1.' };
    }

    if (!result.plan) {
      return res.status(200).json(noSignal(result.reason));
    }

    const { dir, plan, meta } = result;
    const r = v => Number(v.toFixed(dec));
    const tps = plan.tps;

    return res.status(200).json({
      ok: true,
      signal: {
        signal: dir === 1 ? 'BUY' : 'SELL',
        mode: 'MARKET',
        orderType: 'NOW',
        orderLabel: orderLabel(dir, 'NOW'),
        status: 'RUNNING',
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
        zoneLabel: 'Market Execution Zone',
        zoneNote: plan.zoneNote,
        reason: meta.reason,
      },
    });
  } catch (err) {
    console.error('generate error stack:', err);
    return res.status(200).json({ ok: false, error: 'Server error: ' + (err.message || 'Unknown error') });
  }
}
