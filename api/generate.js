// api/generate.js
// v35
//  - Scalping (AGRESIF entry): Pure SMC + Struktur M1 Berjalan + Minimum SL dipatok 25-30 pip.
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
    label: 'Scalping · Pure SMC + M1 Structure (Min SL 25-30 Pip · TP 1:1 · 1:2 · 1:3)',
    entryStyle: 'Agresif', mode: 'MARKET', kind: 'scalp', rr: [1.0, 2.0, 3.0],
  },
  'Day Trading': { label: 'Day Trading', kind: 'day', rr: [1.0, 1.5, 2.0] },
  'Intraday': { label: 'Intraday', kind: 'intraday', rr: [] },
  'Swing': { label: 'Swing', kind: 'swing', rr: [3.0] },
};

const SCALP_PIVOT = 2;
// Konfigurasi Min & Max SL pip (untuk Gold, 1 pip = 0.1 jadi 25-30 pip = 2.5 - 3.0 USD distance)
const MIN_SL_PIPS = 25;
const MAX_SL_PIPS = 30;
const PIP_SIZE = 0.1; // Sesuaikan untuk XAUUSD

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

const TL_SPAN = { '1m': { mult: 1, span: 'minute', minutes: 1 } };
const CACHE_TTL = { '1m': 120 };
const CACHE_BARS = { '1m': 300 };

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

function analyzePureSMCStructure(m1) {
  if (!m1 || m1.length < 15) return { dir: 1, src: 'SMC Default' };
  const { highs, lows } = findPivots(m1, SCALP_PIVOT);
  if (highs.length < 2 || lows.length < 2) {
    const last = m1[m1.length - 1], prev = m1[m1.length - 2];
    return { dir: last.c >= prev.c ? 1 : -1, src: 'Price action M1' };
  }
  const [h1, h2] = highs.slice(-2);
  const [l1, l2] = lows.slice(-2);
  const lastClose = m1[m1.length - 1].c;

  if (lastClose > h2.p) return { dir: 1, src: 'M1 BOS Bullish' };
  if (lastClose < l2.p) return { dir: -1, src: 'M1 BOS Bearish' };
  if (h2.p > h1.p && l2.p > l1.p) return { dir: 1, src: 'M1 Structure HH + HL' };
  if (h2.p < h1.p && l2.p < l1.p) return { dir: -1, src: 'M1 Structure LH + LL' };
  return { dir: lastClose >= m1[m1.length - 2].c ? 1 : -1, src: 'M1 Order Flow' };
}

// ═══════════════════════════ SCALPING (Pure SMC + Min SL 25-30 Pip) ═══════════════════════════
function buildScalpPlan({ m1, price, rrList, symbol, dec }) {
  const f = v => Number(v).toFixed(dec);
  const smc = analyzePureSMCStructure(m1);
  const dir = smc.dir;
  const entry = price;

  const minRisk = MIN_SL_PIPS * PIP_SIZE;
  const maxRisk = MAX_SL_PIPS * PIP_SIZE;

  const { highs, lows } = findPivots(m1, SCALP_PIVOT);
  const pivotList = dir === 1 ? lows : highs;
  let invalidationLevel = null;

  for (let i = pivotList.length - 1; i >= 0; i--) {
    const p = pivotList[i].p;
    if (dir === 1 ? p < price : p > price) { invalidationLevel = p; break; }
  }

  let risk;
  if (invalidationLevel != null) {
    const rawDist = Math.abs(entry - invalidationLevel);
    // Batasi dalam rentang 25 - 30 pip (atau setara)
    risk = Math.min(Math.max(rawDist, minRisk), maxRisk);
  } else {
    risk = minRisk; // Default aman ke batas minimum 25 pip
  }

  const sl = dir === 1 ? entry - risk : entry + risk;
  const tps = rrList.map(x => entry + dir * x * risk);
  const riskLabel = 'MEDIUM';

  const reason = [
    `Scalping Agresif (Pure SMC + Min SL 25-30 Pip) ${dir === 1 ? 'BUY NOW' : 'SELL NOW'} pada ${symbol}.`,
    `Struktur M1: ${smc.src}.`,
    `Entry ${f(entry)}, SL (${(risk / PIP_SIZE).toFixed(0)} pip) di ${f(sl)}.`,
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
      zoneNote: 'Scalp M1 · Pure SMC (Min 25-30 Pip SL)',
    },
    meta: { confidence: 'HIGH', riskLabel, setup: 'M1 PURE SMC MIN SL', reason },
  };
}

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
      const fetched = await getCandles(symbol, '1m', 100, apiKey);
      m1 = fetched.candles;
    }
    const price = Number(body.currentPrice) || (m1.length ? m1[m1.length - 1].c : 2000);
    m1 = mergeLiveBar(m1, price, 1);

    let result;
    if (style.kind === 'scalp') {
      if (m1.length < 30) return res.status(200).json(noSignal(`Data candle M1 belum cukup.`));
      result = buildScalpPlan({ m1, price, rrList: style.rr, symbol, dec });
    } else {
      result = { plan: null, reason: 'Gunakan mode Scalping untuk eksekusi ini.' };
    }

    if (!result.plan) return res.status(200).json(noSignal(result.reason));

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
    return res.status(200).json({ ok: false, error: 'Server error: ' + err.message });
  }
}
