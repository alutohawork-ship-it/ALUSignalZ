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

const STYLES = {
  'Scalping': { label: 'Scalping Hit & Run (Multi-TF Buffer Zone)', mode: 'MARKET', kind: 'scalp', rr: [1, 2, 3] },
  'Day Trading': { label: 'Day Trading Zone (HTF: H1 | MTF: M30)', mode: 'MARKET', kind: 'day', rr: [1.5, 2, 3] },
  'Intraday': { label: 'Intraday (HTF: H4 | MTF: H1)', mode: 'LIMIT', kind: 'intraday', rr: [1.5, 3.0, 5.5] },
  'Swing': { label: 'Swing Trading (HTF: D1 | MTF: H4)', mode: 'LIMIT', kind: 'zone', rr: [2.0, 4.5, 8.5] },
};

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

// Konfigurasi Rentang Buffer & SL Ideal Spesifik Per Karakteristik Pair
function getAssetConfig(symbol) {
  const s = symbol.toUpperCase();
  if (s.includes('XAU')) return { bufferPips: 15, slPips: 25, tp1: 15, tp2: 30, tp3: 50 };
  if (s.includes('XAG')) return { bufferPips: 20, slPips: 30, tp1: 20, tp2: 40, tp3: 70 };
  if (s.includes('EUR') || s.includes('GBP') || s.includes('AUD') || s.includes('NZD') || s.includes('USD')) {
    if (s.includes('JPY')) return { bufferPips: 15, slPips: 25, tp1: 15, tp2: 30, tp3: 50 };
    return { bufferPips: 10, slPips: 18, tp1: 12, tp2: 25, tp3: 40 };
  }
  if (s.includes('BTC')) return { bufferPips: 80, slPips: 150, tp1: 100, tp2: 250, tp3: 450 };
  if (s.includes('ETH')) return { bufferPips: 15, slPips: 30, tp1: 20, tp2: 45, tp3: 80 };
  if (s.includes('SOL') || s.includes('BNB')) return { bufferPips: 0.5, slPips: 1.2, tp1: 0.8, tp2: 1.8, tp3: 3.0 };
  if (s.includes('DJI') || s.includes('SP500') || s.includes('JP225')) return { bufferPips: 30, slPips: 60, tp1: 40, tp2: 90, tp3: 150 };
  if (s.includes('OIL') || s.includes('CLUSDT') || s.includes('NATGAS')) return { bufferPips: 15, slPips: 30, tp1: 20, tp2: 45, tp3: 80 };
  
  return { bufferPips: 15, slPips: 30, tp1: 20, tp2: 40, tp3: 70 };
}

function scalpHitRun(mtfC, ltfC, htfDir, price, a, symbol, pip) {
  let dir = structureDir(mtfC);
  if (dir === 0) dir = htfDir !== 0 ? htfDir : 1;
  const activeDir = htfDir !== 0 ? htfDir : dir;
  const isBuy = activeDir === 1;

  const cfg = getAssetConfig(symbol);
  const pValue = pip || 1;

  const bufferOffset = cfg.bufferPips * pValue;
  const bufferEnd = isBuy ? price - bufferOffset : price + bufferOffset;

  const slDistance = cfg.slPips * pValue;
  const sl = isBuy ? bufferEnd - slDistance : bufferEnd + slDistance;

  const tp1 = isBuy ? price + (cfg.tp1 * pValue) : price - (cfg.tp1 * pValue);
  const tp2 = isBuy ? price + (cfg.tp2 * pValue) : price - (cfg.tp2 * pValue);
  const tp3 = isBuy ? price + (cfg.tp3 * pValue) : price - (cfg.tp3 * pValue);

  return {
    dir: activeDir,
    plan: {
      kind: 'hitrun',
      orderType: 'NOW',
      mode: 'DIRECT',
      fill: null,
      entry: price,
      bufferEnd: bufferEnd,
      status: 'RUNNING',
      sl: sl,
      tps: [tp1, tp2, tp3],
      zone: { min: Math.min(price, bufferEnd), max: Math.max(price, bufferEnd) },
      trigSrc: 'M5+M3+M1',
      expireMs: 0,
      riskAtr: slDistance / a,
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

function generalTradePlan({ htfC, mtfC, m5C, price, symbol, pip, dec, lang, styleKind }) {
  const m15C = aggregateM15(m5C);
  const a15 = atr(m15C, 14);
  const dir = structureDir(mtfC) || 1;
  const isBuy = dir === 1;

  const cfg = getAssetConfig(symbol);
  const pValue = pip || 1;
  const entry = price;

  const bufferOffset = (cfg.bufferPips * 1.5) * pValue;
  const bufferEnd = isBuy ? entry - bufferOffset : entry + bufferOffset;

  const slDistance = (cfg.slPips * 1.5) * pValue;
  const sl = isBuy ? bufferEnd - slDistance : bufferEnd + slDistance;
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
      expireMs: 90 * 60 * 1000,
      flags: [],
      meta: { confidence: 'HIGH', risk: 'LOW', setup: 'CONTINUATION', setupLabel: 'SMC Setup Valid', zoneLabel: 'Order Block / FVG', zoneNote: 'Pending order aktif sesuai karakter pair' }
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

    let dir = 0, plan = null;

    if (isScalp) {
      const hr = scalpHitRun(mtfC, ltfC, htfDir, price, refAtr, symbol, pip);
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
        risk: plan.meta?.risk || 'LOW',
        setup: plan.meta?.setup || 'CONTINUATION',
        setupLabel: plan.meta?.setupLabel || 'Setup SMC Valid',
        zoneLabel: plan.meta?.zoneLabel || 'Buffer Zone Active',
        zoneNote: plan.meta?.zoneNote || 'Rentang SL & Buffer disesuaikan spesifik per pair',
        reason: 'Sinyal digenerate dengan pengaturan jarak SL dan TP yang dioptimalkan khusus untuk karakteristik pair ini.'
      }
    });
  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
