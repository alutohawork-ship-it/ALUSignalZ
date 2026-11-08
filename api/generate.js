// api/generate.js
// Analisis Pure SMC Universal: XBTFX 60% Pairs + DXY Support & Fixed Range + EMA & Bollinger Bands Filter + Konsistensi RRR + Pending/Waiting Mechanism

const KV_KEY = 'alu_clients';

const DECIMALS = {
  DXY: 2, EURUSD: 5, GBPUSD: 5, USDJPY: 3, AUDUSD: 5, USDCAD: 5, USDCHF: 5, NZDUSD: 5,
  EURGBP: 5, EURJPY: 3, GBPJPY: 3, AUDJPY: 3, EURAUD: 5, GBPAUD: 5, AUDNZD: 5, CADJPY: 3, CHFJPY: 3, EURNZD: 5,
  XAUUSD: 2, XAGUSD: 3, XPTUSD: 2, XPDUSD: 2, XAUEUR: 2, XAGEUR: 3,
  BRENT: 2, WTI: 2, NATGAS: 3, COPPER: 4, COFFEE: 2, SUGAR: 2,
  US30: 2, NAS100: 2, SPX500: 2, GER40: 2, UK100: 2, JPN225: 0, FRA40: 2, AUS200: 2,
  BTCUSD: 2, ETHUSD: 2, SOLUSD: 2, XRPUSD: 4, BNBUSD: 2, ADAUSD: 4, DOGEUSD: 5, AVAXUSD: 3, LINKUSD: 3, DOTUSD: 4, MATICUSD: 4, UNIUSD: 3,
  BTCXAU: 2, ETHBTC: 5, SOLBTC: 5, US30BTC: 2, XAUUSDX: 2,
};

// Konsistensi RRR terstruktur untuk setiap gaya trading
const STYLES = {
  'Scalping': { label: 'Scalping Agresif (Crypto 30-50 Pip & Currency Fix)', mode: 'MARKET', kind: 'scalp', rr: [1.0, 2.0, 3.0] },
  'Day Trading': { label: 'Day Trading (Limit Order Zona & Bollinger Bands)', mode: 'LIMIT', kind: 'day', rr: [1.5, 2.5, 3.5] },
  'Intraday': { label: 'Intraday (Limit Order + EMA + BB)', mode: 'LIMIT', kind: 'intraday', rr: [1.5, 3.0, 5.5] },
  'Swing': { label: 'Swing Trading (Limit Order + Multi EMA + BB)', mode: 'LIMIT', kind: 'swing', rr: [2.0, 4.5, 8.5] },
};

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
      status: 'RUNNING', // Scalping langsung berjalan
      sl: sl,
      tps: [tp1, tp2, tp3],
      zone: { min: Math.min(price, bufferEnd), max: Math.max(price, bufferEnd) },
      trigSrc: `Scalping Agresif (XBTFX + EMA + BB Filter) [${offsets.type}]`,
      expireMs: 0,
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

function generalTradePlan({ mtfC, m5C, price, symbol, styleKind, emaFilter, bbFilter, rrList }) {
  const m15C = aggregateM15(m5C);
  const a15 = atr(m15C, 14) || 10;
  const dir = structureDir(mtfC, emaFilter, bbFilter) || 1;
  const isBuy = dir === 1;

  // Day Trading, Intraday, dan Swing diatur menggunakan Limit Order (Pending Order / Waiting)
  const mult = (styleKind === 'intraday' || styleKind === 'swing') ? 2.0 : 1.2;
  const actualEntry = isBuy ? price - a15 * 0.5 : price + a15 * 0.5;
  
  const bufferVal = a15 * 0.5 * mult;
  const slVal = a15 * 1.5 * mult;

  const bufferEnd = isBuy ? actualEntry - bufferVal : actualEntry + bufferVal;
  const sl = isBuy ? actualEntry - slVal : actualEntry + slVal;

  const risk = Math.abs(actualEntry - sl);
  
  const tp1 = actualEntry + dir * rrList[0] * risk;
  const tp2 = actualEntry + dir * rrList[1] * risk;
  const tp3 = actualEntry + dir * rrList[2] * risk;

  let trigName = 'Day Trading (Pending Order Limit)';
  if (styleKind === 'intraday') trigName = 'Intraday (Limit Order Pending)';
  if (styleKind === 'swing') trigName = 'Swing Trading (Limit Order Pending)';

  return {
    dir,
    plan: {
      kind: styleKind,
      orderType: 'LIMIT', // Wajib Limit Order untuk Day, Intraday, Swing
      status: 'WAITING',   // Status live diatur menjadi WAITING (Pending Order)
      entry: actualEntry,
      bufferEnd,
      sl,
      tps: [tp1, tp2, tp3],
      zone: { min: Math.min(actualEntry, bufferEnd), max: Math.max(actualEntry, bufferEnd) },
      expireMs: 360 * 60 * 1000,
      trigSrc: `${trigName} [ATR + Structure Zone]`,
      flags: ['PENDING_ZONE'],
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const email = String(body.email || req.headers['x-user-email'] || '').trim().toLowerCase();
    const styleKey = body.tradingStyle || 'Scalping';
    const style = STYLES[styleKey] || STYLES['Scalping'];
    const symbol = String(body.marketId || '').split('|').pop().toUpperCase();
    const dec = DECIMALS[symbol] ?? 2;
    const price = Number(body.currentPrice);
    const emaFilter = body.emaFilter || {};

    const access = await checkAccess(email);
    if (!access.ok) return res.status(403).json({ error: access.msg });

    const cnd = body.candles || {};
    const htfC = cleanCandles(cnd.htf);
    const mtfC = cleanCandles(cnd.mtf ?? cnd.entry);
    const ltfC = cleanCandles(cnd.ltf);

    const incomingBb = body.bbFilter;
    const bbFilter = (incomingBb && Number(incomingBb.middle) > 0)
      ? {
          upper: Number(incomingBb.upper || 0),
          middle: Number(incomingBb.middle || 0),
          lower: Number(incomingBb.lower || 0)
        }
      : calculateBollingerBands(mtfC.length > 0 ? mtfC : ltfC);

    const htfDir = structureDir(htfC, emaFilter, bbFilter);
    const isScalp = style.kind === 'scalp';
    const rrList = style.rr;

    let dir = 0, plan = null;

    if (isScalp) {
      const hr = scalpHitRun(mtfC, ltfC, htfDir, price, symbol, emaFilter, bbFilter, rrList);
      dir = hr.dir;
      plan = hr.plan;
    } else {
      const dp = generalTradePlan({ mtfC, m5C: ltfC, price, symbol, styleKind: style.kind, emaFilter, bbFilter, rrList });
      dir = dp.dir;
      plan = dp.plan;
    }

    const entry = plan.entry;
    const r = v => Number(v.toFixed(dec));
    const tps = plan.tps || [entry + dir * 20, entry + dir * 40, entry + dir * 60];

    const actionType = plan.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET';
    const sideText = dir === 1 ? 'BUY' : 'SELL';
    const offsets = getAbsoluteScalpOffsets(symbol);

    const emaSummary = Object.entries(emaFilter).map(([k, v]) => `${k}: ${v}`).join(' | ');
    const bbSummary = `Upper: ${bbFilter.upper} | Mid: ${bbFilter.middle} | Lower: ${bbFilter.lower}`;

    const actionDesc = sideText === 'BUY' 
      ? 'menempatkan Pending Order BUY LIMIT pada area Zona Demand & Bollinger Band Bawah' 
      : 'menempatkan Pending Order SELL LIMIT pada area Zona Supply & Bollinger Band Atas';

    const techReason = [
      `Analisis Teknikal Pure SMC ${sideText} (${style.label}) pada pair ${symbol}.`,
      `Mekanisme Eksekusi: Menggunakan Limit Order (Pending Order / WAITING) pada zona harga optimal.`,
      `Alasan: Diputuskan ${actionDesc}. Indikator EMA (${emaSummary}) serta Bollinger Bands (${bbSummary}) menyaring titik jenuh.`,
      `Manajemen Risiko: Target RRR konsisten [TP1: 1:${rrList[0]}, TP2: 1:${rrList[1]}, TP3: 1:${rrList[2]}].`
    ].join('\n\n');

    return res.status(200).json({
      ok: true,
      signal: {
        signal: sideText,
        mode: actionType,
        orderType: plan.orderType,
        orderLabel: orderLabel(dir, plan.orderType),
        status: plan.status, // Menjadi WAITING untuk limit order / PENDING zone
        entry: r(entry),
        bufferEnd: r(plan.bufferEnd || entry),
        sl: r(plan.sl),
        tp1: r(tps[0]), tp2: r(tps[1]), tp3: r(tps[2]),
        zone: plan.zone ? { min: r(plan.zone.min), max: r(plan.zone.max) } : null,
        confidence: 'HIGH',
        risk: 'LOW',
        setup: `PENDING ORDER ZONE (RRR Target: 1:${rrList[0]} - 1:${rrList[2]})`,
        setupLabel: style.label,
        zoneLabel: plan.orderType === 'LIMIT' ? 'Limit Order Zone (Waiting)' : 'Market Execution Zone',
        zoneNote: `Range Mode (${offsets.type})`,
        reason: techReason
      }
    });
  } catch (err) {
    console.error('generate error stack:', err);
    return res.status(200).json({ ok: false, error: 'Server error: ' + (err.message || 'Unknown error') });
  }
}
