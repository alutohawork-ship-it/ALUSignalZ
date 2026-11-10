// api/generate.js
// v26
//  - Scalping (AGRESIF entry): Murni Market Execution (Buy/Sell Now / 'NOW') berbasis M1 + M15 Confluence.
//      Bias arah utama dari struktur M15 (cadangan M1).
//      Entry langsung di harga market saat ini, tanpa pending limit order.
//      Buffer ATR dipertebal sedikit (0.7 ATR) dan SL diletakkan di struktur invalidasi terdekat.
//      TP dihitung dari entry dengan RRR 1:1 / 1:2 / 1:3.
//  - Day Trading / Intraday / Swing: Menggunakan struktur dan refine zone masing-masing.
//  - TickerLayer: Rotasi 5 API Key sekuensial (TICKERLAYER_API_KEY + _1 s/d _4).

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
    label: 'Scalping · Agresif Pure Market Execution (M1 + M15 Confluence · TP 1:1 · 1:2 · 1:3)',
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

const SCALP_PIVOT = 2;
const DAY_SL_MULT = 1.5;
const MAX_SCORE_REFINE = 8;
const SCALP_BUFFER_ATR = 0.7; // Buffer sedikit dipertebal agar aman untuk Market Execution

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

function padAtrFor(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (CRYPTO_LIST.includes(s)) return 0.3;
  if (s.includes('XAU') || s.includes('XAG')) return 0.25;
  if (INDEX_LIST.includes(s)) return 0.25;
  return 0.2;
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
      const { response, keyIndex } = await tlFetch(url, apiKey);
      if (!response.ok) { continue; }
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

function scalpSL(c1, price, dir, symbol) {
  const a = atr(c1, 14);
  const pad = padAtrFor(symbol) * a;
  const { highs, lows } = findPivots(c1, SCALP_PIVOT);
  const list = dir === 1 ? lows : highs;

  let level = null;
  let src = 'swing M1';
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i].p;
    if (dir === 1 ? p < price : p > price) { level = p; break; }
  }
  if (level == null) {
    const recent = c1.slice(-12);
    level = dir === 1
      ? Math.min(price, Math.min(...recent.map(c => c.l)))
      : Math.max(price, Math.max(...recent.map(c => c.h)));
    src = 'low/high 12 candle M1';
  }

  const risk = Math.abs(price - level) + pad;
  const sl = dir === 1 ? price - risk : price + risk;
  return { sl, risk, level, pad, atr: a, src };
}

// ═══════════════════════════ SCALPING (M1 + M15 PURE MARKET NOW) ═══════════════════════════
function buildScalpPlan({ htfC, m1, price, rrList, symbol, dec }) {
  const f = v => Number(v).toFixed(dec);

  // Bias arah dari M15 (HTF) & struktur M1
  const stM15 = structureBias(htfC, SETUP_CFG.day.pivot);
  const stM1 = structureBias(m1, SCALP_PIVOT);

  let dir = 0;
  let srcTxt = '';

  if (stM15.dir !== 0) {
    dir = stM15.dir;
    srcTxt = `Market structure M15 (${stM15.src})`;
  } else if (stM1.dir !== 0) {
    dir = stM1.dir;
    srcTxt = `Market structure M1 (${stM1.src}) [M15 netral]`;
  } else {
    const last = m1[m1.length - 1];
    dir = price >= last.c ? 1 : -1;
    srcTxt = `Harga vs close M1 terakhir`;
  }

  // Pure Market Execution (NOW) tanpa limit
  const orderType = 'NOW';
  const entry = price;

  const sc = scalpSL(m1, entry, dir, symbol);
  const bufferEnd = entry - dir * SCALP_BUFFER_ATR * sc.atr;
  const sl = bufferEnd - dir * sc.risk;
  
  const risk = Math.abs(entry - sl);
  const tps = rrList.map(x => entry + dir * x * risk);

  const riskAtr = sc.risk / sc.atr;
  const riskLabel = riskAtr <= 1.5 ? 'LOW' : riskAtr <= 2.5 ? 'MEDIUM' : 'HIGH';
  const confidence = stM15.dir !== 0 ? 'HIGH' : 'MEDIUM';

  const reason = [
    `Scalping Agresif (Pure Market Execution) ${dir === 1 ? 'BUY NOW' : 'SELL NOW'} pada ${symbol}.`,
    `Acuan arah: ${srcTxt}.`,
    `Entry Market ${f(entry)}, SL ${f(sl)} (${sc.src}), Jarak risiko ${f(risk)}.`,
    `RRR: TP1 1:${rrList[0]}, TP2 1:${rrList[1]}, TP3 1:${rrList[2]}.`,
  ].join(' • ');

  return {
    dir,
    plan: {
      kind: 'scalp',
      orderType,
      status: 'RUNNING',
      entry,
      bufferEnd,
      sl,
      tps,
      zone: { min: Math.min(entry, bufferEnd), max: Math.max(entry, bufferEnd) },
      expireMs: 0,
      zoneNote: `Scalp M1/M15 · Market Execution (NOW)`,
    },
    meta: { confidence, riskLabel, setup: 'CONTINUATION', reason },
  };
}

// Fungsi pendukung untuk Day Trading / Intraday / Swing
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

    let htfC = cleanCandles(body.candles?.htf);
    let mtfC = cleanCandles(body.candles?.mtf ?? body.candles?.entry);
    const price = Number(body.currentPrice) || (mtfC.length ? mtfC[mtfC.length - 1].c : 2000);

    let result;
    if (style.kind === 'scalp') {
      let m1 = cleanCandles(body.candles?.m1);
      if (m1.length < 30) m1 = (await getCandles(symbol, '1m', 150, apiKey)).candles;
      m1 = mergeLiveBar(m1, price, 1);

      if (htfC.length < 30) htfC = (await getCandles(symbol, '15m', 150, apiKey)).candles;
      htfC = mergeLiveBar(htfC, price, 15);

      if (m1.length < 30 || htfC.length < 30) {
        return res.status(200).json(noSignal(`Data candle M1 (${m1.length}) atau M15 (${htfC.length}) belum cukup.`));
      }

      result = buildScalpPlan({ htfC, m1, price, rrList: style.rr, symbol, dec });
    } else {
      result = { plan: null, reason: 'Gunakan mode Scalping untuk kombinasi M1 + M15 Market Execution.' };
    }

    if (!result.plan) {
      return res.status(200).json(noSignal(`TIDAK ADA SINYAL · ${style.label}\n${result.reason}`));
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
        bufferEnd: r(plan.bufferEnd ?? plan.entry),
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
