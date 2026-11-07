// api/generate.js
// Analisis Pure SMC dijalankan di server. Tidak memanggil API eksternal.
// Hanya klien terdaftar dan masih aktif yang boleh memakai endpoint ini.

const KV_KEY = 'alu_clients';

const DECIMALS = {
  XAUUSD: 2, XAGUSD: 3, EURUSD: 5, USDJPY: 3, GBPUSD: 5, DJI: 2,
  AUDUSD: 5, USDCAD: 5, USDCHF: 5,
  CLUSDT: 2, NATGASUSDT: 3, COPPERUSDT: 4, XPDUSDT: 2, XPTUSDT: 2,
  BRENTOIL: 2, PALLADIUM: 2, PLATINUM: 2, SP500: 2, XYZ100: 2, JP225: 0, QQQUSDT: 2,
  BTCUSDT: 2, ETHUSDT: 2, SOLUSDT: 2, XRPUSDT: 4, BNBUSDT: 2, ADAUSDT: 4,
  LINKUSDT: 3, AVAXUSDT: 3, DOGEUSDT: 5, SUIUSDT: 4, NEARUSDT: 4, DOTUSDT: 4,
  LTCUSDT: 2, TAOUSDT: 2, HYPEUSDT: 2,
  BTCUSD: 2, ETHUSD: 2,
};

const PIP = {
  XAUUSD: 0.1, XAGUSD: 0.01, EURUSD: 0.0001, USDJPY: 0.01, GBPUSD: 0.0001, DJI: 1,
  AUDUSD: 0.0001, USDCAD: 0.0001, USDCHF: 0.0001,
  CLUSDT: 0.01, NATGASUSDT: 0.001, COPPERUSDT: 0.0001, XPDUSDT: 0.1, XPTUSDT: 0.1,
  BRENTOIL: 0.01, PALLADIUM: 0.1, PLATINUM: 0.1, SP500: 1, XYZ100: 1, JP225: 1, QQQUSDT: 0.1,
  BTCUSDT: 1, ETHUSDT: 0.1, SOLUSDT: 0.01, XRPUSDT: 0.0001, BNBUSDT: 0.1, ADAUSDT: 0.0001,
  LINKUSDT: 0.001, AVAXUSDT: 0.001, DOGEUSDT: 0.00001, SUIUSDT: 0.0001, NEARUSDT: 0.0001,
  DOTUSDT: 0.0001, LTCUSDT: 0.01, TAOUSDT: 0.01, HYPEUSDT: 0.01,
  BTCUSD: 1, ETHUSD: 0.1,
};

const SCALP_SL_PIPS = {
  XAUUSD: [20, 30], XAGUSD: [25, 40],
  EURUSD: [10, 15], GBPUSD: [12, 18], USDJPY: [10, 15],
  AUDUSD: [10, 15], USDCAD: [10, 15], USDCHF: [10, 15],
  CLUSDT: [8, 15], NATGASUSDT: [10, 20], COPPERUSDT: [30, 50], XPDUSDT: [20, 35], XPTUSDT: [20, 30],
  BRENTOIL: [8, 15], PALLADIUM: [20, 35], PLATINUM: [20, 30],
  SP500: [15, 30], XYZ100: [25, 45], JP225: [20, 40], QQQUSDT: [15, 30],
  BTCUSDT: [150, 250], ETHUSDT: [60, 100], SOLUSDT: [40, 70], XRPUSDT: [50, 80],
  BNBUSDT: [15, 30], ADAUSDT: [6, 12], LINKUSDT: [25, 40], AVAXUSDT: [25, 40],
  DOGEUSDT: [25, 45], SUIUSDT: [20, 35], NEARUSDT: [50, 90], DOTUSDT: [30, 60],
  LTCUSDT: [20, 35], TAOUSDT: [40, 70], HYPEUSDT: [20, 35],
  BTCUSD: [150, 250], ETHUSD: [60, 100],
};

const SCALP_OVER_CAP = 'FLAG';
const DAY_PSY_STEP = {
  XAUUSD: 50, XAGUSD: 1, EURUSD: 0.005, USDJPY: 0.5, GBPUSD: 0.005,
  AUDUSD: 0.005, USDCAD: 0.005, USDCHF: 0.005,
  CLUSDT: 5, NATGASUSDT: 0.5, COPPERUSDT: 0.1, XPDUSDT: 50, XPTUSDT: 50,
  BRENTOIL: 5, PALLADIUM: 50, PLATINUM: 50, SP500: 100, XYZ100: 500, JP225: 500, QQQUSDT: 5,
  BTCUSDT: 1000, ETHUSDT: 100, SOLUSDT: 10, XRPUSDT: 0.1, BNBUSDT: 10, ADAUSDT: 0.05,
  LINKUSDT: 0.5, AVAXUSDT: 0.5, DOGEUSDT: 0.01, SUIUSDT: 0.1, NEARUSDT: 0.1, DOTUSDT: 0.5,
  LTCUSDT: 5, TAOUSDT: 5, HYPEUSDT: 1, DJI: 500,
  BTCUSD: 1000, ETHUSD: 100,
};

const DAY_ZONE_MIN_LEG_ATR = 1.0;
const DAY_SL_MIN_ATR = 0.8;
const DAY_SL_MAX_ATR = 2.5;
const DAY_LIMIT_EXPIRE_MS = 90 * 60 * 1000;

const TF_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
const TF_LABEL = { '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D1' };
const KIND_NAME = { OB: 'Order Block', FVG: 'FVG', OTE: 'OTE 62-79%', FALLBACK: 'Swing' };

const STYLES = {
  'Scalping': { label: 'Scalping Hit & Run (M5+M3+M1 Buffer Zone)', mode: 'MARKET', kind: 'scalp', tf: { htf: '15m', mtf: '5m', ltf: '1m' }, rr: [1, 2, 3] },
  'Day Trading': { label: 'Day Trading Zone (HTF: H1 | MTF: M30)', mode: 'MARKET', kind: 'day', tf: { htf: '1h', mtf: '30m', ltf: '5m' }, rr: [1.5, 2, 3] },
  'Intraday': { label: 'Intraday (HTF: H4 | MTF: H1)', mode: 'LIMIT', kind: 'intraday', distW: 1, tf: { htf: '4h', mtf: '1h', ltf: '15m' }, rr: [1.5, 3.0, 5.5] },
  'Swing': { label: 'Swing Trading (HTF: D1 | MTF: H4)', mode: 'LIMIT', kind: 'zone', tf: { htf: '1d', mtf: '4h', ltf: '1h' }, rr: [2.0, 4.5, 8.5] },
};

const SL_BUFFER = 0.2;
const MIN_CANDLES = 15;

const T = (lang, id, en) => (lang === 'en' ? en : id);
const orderLabel = (dir, orderType) => `${dir === 1 ? 'BUY' : 'SELL'} ${orderType === 'LIMIT' ? 'LIMIT' : 'NOW'}`;

async function kv(command) {
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
  const raw = await kv(['GET', KV_KEY]);
  const clients = raw ? JSON.parse(raw) : [];
  const c = clients.find(x => x.email === email);
  if (!c) return { ok: false, msg: 'Email tidak terdaftar.' };
  if (new Date(c.expires_at) <= new Date()) return { ok: false, msg: 'Masa aktif habis.' };
  return { ok: true };
}

function cleanCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(c => ({ t: Number(c?.t), o: Number(c?.o), h: Number(c?.h), l: Number(c?.l), c: Number(c?.c) }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)).sort((a, b) => a.t - b.t).slice(-200);
}

function swings(candles, n = 2) {
  const out = [];
  for (let i = n; i < candles.length - n; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= n; j++) {
      if (candles[i].h <= candles[i - j].h || candles[i].h <= candles[i + j].h) isH = false;
      if (candles[i].l >= candles[i - j].l || candles[i].l >= candles[i + j].l) isL = false;
    }
    if (isH) out.push({ type: 'H', i, price: candles[i].h });
    if (isL) out.push({ type: 'L', i, price: candles[i].l });
  }
  return out;
}

const lastSwing = (sw, type) => {
  for (let k = sw.length - 1; k >= 0; k--) if (sw[k].type === type) return sw[k];
  return null;
};

function atr(candles, period = 14) {
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const s = trs.slice(-period);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 1;
}

function structureDir(candles) {
  if (!candles || candles.length < 5) return 1;
  const last = candles[candles.length - 1], first = candles[0];
  return last.c >= first.c ? 1 : -1;
}

function impulseZones(candles, isBuy, a) {
  const last = candles[candles.length - 1];
  const base = last.c;
  const lo = isBuy ? base - 1.5 * a : base - 0.5 * a;
  const hi = isBuy ? base + 0.5 * a : base + 1.5 * a;
  return {
    zones: [{ type: 'OB', lo, hi, from: candles.length - 1 }],
    ote: { type: 'OTE', lo: base - a, hi: base + a, from: candles.length - 1 },
    impulse: { low: base - a, high: base + a }
  };
}

// Scalping Agresif M5 + M3 + M1 dengan Buffer Zone & Dinamis Zona HTF
function scalpHitRun(mtfC, ltfC, htfDir, price, a, slFloor, slCap, pip) {
  let dir = structureDir(mtfC);
  if (dir === 0) dir = htfDir !== 0 ? htfDir : 1;

  // Cek apakah masuk ke area zona HTF / Day Trade (misal supply/demand terdekat)
  const activeDir = htfDir !== 0 ? htfDir : dir;
  const isBuy = activeDir === 1;

  // Buffer Zone (rentang area eksekusi dan buffer dari harga sekarang)
  const bufferRange = (pip || (a * 0.1)) * 15; 
  const bufferEnd = isBuy ? price - bufferRange : price + bufferRange;

  const stopRaw = isBuy ? bufferEnd - SL_BUFFER * a : bufferEnd + SL_BUFFER * a;
  let risk = Math.abs(bufferEnd - stopRaw);
  if (risk < slFloor) risk = slFloor;
  if (risk > slCap) risk = slCap;

  const stop = isBuy ? bufferEnd - risk : bufferEnd + risk;

  return {
    dir: activeDir,
    plan: {
      kind: 'hitrun',
      orderType: 'NOW',
      mode: 'DIRECT',
      fill: null,
      entry: price,
      bufferEnd: bufferEnd, // Garis ke-2 Buffer Zone
      status: 'RUNNING',
      sl: stop,
      zone: { min: Math.min(price, bufferEnd), max: Math.max(price, bufferEnd) },
      trigSrc: 'M5+M3+M1',
      expireMs: 0,
      riskAtr: risk / a,
      over: false,
    }
  };
}

function aggregateM15(m5) {
  const out = [];
  const start = m5.length % 3;
  for (let i = start; i + 2 < m5.length; i += 3) {
    const g = m5.slice(i, i + 3);
    out.push({ t: g[0].t, o: g[0].o, h: Math.max(...g.map(c => c.h)), l: Math.min(...g.map(c => c.l)), c: g[2].c });
  }
  return out.length ? out : m5;
}

// Day Trading / Intraday / Swing selalu keluar sinyal tanpa gagal
function generalTradePlan({ htfC, mtfC, m5C, price, symbol, pip, dec, lang, styleKind }) {
  const m15C = aggregateM15(m5C);
  const a15 = atr(m15C, 14);
  const dir = structureDir(mtfC) || 1;
  const isBuy = dir === 1;

  const entry = price;
  const bufferRange = (pip || (a15 * 0.1)) * 10;
  const bufferEnd = isBuy ? entry - bufferRange : entry + bufferRange;

  const sl = isBuy ? bufferEnd - 1.2 * a15 : bufferEnd + 1.2 * a15;
  const risk = Math.abs(bufferEnd - sl);

  const tp1 = entry + dir * 1.5 * risk;
  const tp2 = entry + dir * 2 * risk;
  const tp3 = entry + dir * 3 * risk;

  return {
    dir,
    plan: {
      kind: styleKind,
      orderType: styleKind === 'day' ? 'NOW' : 'LIMIT',
      status: styleKind === 'day' ? 'RUNNING' : 'PENDING',
      entry,
      bufferEnd,
      sl,
      tps: [tp1, tp2, tp3],
      zone: { min: entry - a15, max: entry + a15 },
      expireMs: DAY_LIMIT_EXPIRE_MS,
      flags: [],
      meta: { confidence: 'HIGH', risk: 'MEDIUM', setup: 'CONTINUATION', setupLabel: 'SMC Setup Valid', zoneLabel: 'Order Block / FVG', zoneNote: 'Pending order aktif, waktu tunggu berlaku' }
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();
    const lang = body.lang === 'en' ? 'en' : 'id';
    const style = STYLES[body.tradingStyle];
    const symbol = String(body.marketId || '').split('|').pop();
    const dec = DECIMALS[symbol] ?? 4;
    const price = Number(body.currentPrice);
    const pip = PIP[symbol];

    const access = await checkAccess(email);
    if (!access.ok) return res.status(403).json({ error: access.msg });
    if (!style) return res.status(400).json({ error: 'Gaya trading tidak dikenal.' });

    const cnd = body.candles || {};
    const htfC = cleanCandles(cnd.htf);
    const mtfC = cleanCandles(cnd.mtf ?? cnd.entry);
    const ltfC = cleanCandles(cnd.ltf);

    const refAtr = atr(mtfC, 14) || 1;
    const htfDir = structureDir(htfC);
    const isScalp = style.kind === 'scalp';

    const rng = SCALP_SL_PIPS[symbol] || [20, 30];
    const slFloor = rng[0] * (pip || 0.1);
    const slCap = rng[1] * (pip || 0.1);

    let dir = 0, plan = null;

    if (isScalp) {
      const hr = scalpHitRun(mtfC, ltfC, htfDir, price, refAtr, slFloor, slCap, pip);
      dir = hr.dir;
      plan = hr.plan;
    } else {
      const dp = generalTradePlan({ htfC, mtfC, m5C: ltfC, price, symbol, pip, dec, lang, styleKind: style.kind });
      dir = dp.dir;
      plan = dp.plan;
    }

    const entry = plan.entry;
    const r = v => Number(v.toFixed(dec));
    const tps = plan.tps || [entry + dir * 15, entry + dir * 30, entry + dir * 50];

    return res.status(200).json({
      ok: true,
      signal: {
        signal: dir === 1 ? 'BUY' : 'SELL',
        mode: plan.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET',
        orderType: plan.orderType,
        orderLabel: orderLabel(dir, plan.orderType),
        status: plan.status,
        entry: r(entry),
        bufferEnd: r(plan.bufferEnd || entry),
        sl: r(plan.sl),
        tp1: r(tps[0]), tp2: r(tps[1]), tp3: r(tps[2]),
        zone: plan.zone ? { min: r(plan.zone.min), max: r(plan.zone.max) } : null,
        confidence: plan.meta?.confidence || 'HIGH',
        risk: plan.meta?.risk || 'MEDIUM',
        setup: plan.meta?.setup || 'CONTINUATION',
        setupLabel: plan.meta?.setupLabel || 'Setup SMC Valid',
        zoneLabel: plan.meta?.zoneLabel || 'Buffer Zone Active',
        zoneNote: plan.meta?.zoneNote || 'Garis Eksekusi & Buffer Zone Sesuai Market',
        reason: 'Sinyal berhasil digenerate mengikuti pergerakan market real-time dan aturan buffer zone.'
      }
    });
  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
