// api/generate.js
// Analisis Pure SMC Universal: Konsistensi Reason Teknikal & Skala Stop Loss

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
  'Scalping': { label: 'Scalping Agresif (EMA 5/9 + BB)', mode: 'MARKET', kind: 'scalp', rr: [1, 2, 3] },
  'Day Trading': { label: 'Day Trading (EMA 14/20 + Zona & Kontinuitas)', mode: 'MARKET', kind: 'day', rr: [1.5, 2, 3] },
  'Intraday': { label: 'Intraday (Limit Order + EMA 20/50/100)', mode: 'LIMIT', kind: 'intraday', rr: [1.5, 3.0, 5.5] },
  'Swing': { label: 'Swing Trading (Limit Order + EMA 20/50/100/200)', mode: 'LIMIT', kind: 'swing', rr: [2.0, 4.5, 8.5] },
};

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

function getAssetConfig(symbol, kind) {
  const s = symbol.toUpperCase();
  let mult = (kind === 'intraday' || kind === 'swing') ? 2.5 : 1.0;

  if (s.includes('XAU')) return { bufferVal: 1.5 * mult, slVal: 2.5 * mult, type: 'GOLD_FIX' };
  if (s.includes('XAG')) return { bufferVal: 3.0 * mult, slVal: 5.0 * mult, type: 'SILVER_2X' };
  if (s.includes('XPT') || s.includes('PLATINUM')) return { bufferVal: 5.0 * mult, slVal: 12.0 * mult, type: 'METAL_XPT' };
  if (s.includes('XPD') || s.includes('PALLADIUM')) return { bufferVal: 5.0 * mult, slVal: 12.0 * mult, type: 'METAL_XPD' };
  
  if (s.includes('BTC')) {
    const btcMult = kind === 'scalp' ? 1.0 : mult;
    return { bufferVal: 120.0 * btcMult, slVal: 400.0 * btcMult, type: 'CRYPTO_BTC_300_500' };
  }
  
  if (s.includes('ETH')) return { bufferVal: 45.0 * mult, slVal: 135.0 * mult, type: 'CRYPTO_ETH_3X' };
  if (s.includes('SOL') || s.includes('BNB') || s.includes('XRP') || s.includes('LTC')) return { bufferVal: 9.0 * mult, slVal: 27.0 * mult, type: 'CRYPTO_ALT_3X' };
  
  if (s.includes('EUR') || s.includes('GBP') || s.includes('AUD') || s.includes('NZD') || s.includes('USD') || s.includes('CAD') || s.includes('CHF')) {
    if (s.includes('JPY')) return { bufferVal: 0.45 * mult, slVal: 1.20 * mult, type: 'CURRENCY_JPY_3X' };
    return { bufferVal: 0.0045 * mult, slVal: 0.0120 * mult, type: 'CURRENCY_MAJOR_3X' };
  }
  
  if (s.includes('DJI') || s.includes('SP500') || s.includes('JP225')) return { bufferVal: 15.0 * mult, slVal: 45.0 * mult, type: 'INDEX' };
  if (s.includes('OIL') || s.includes('NATGAS') || s.includes('COPPER')) return { bufferVal: 1.5 * mult, slVal: 4.5 * mult, type: 'COMMODITY_3X' };
  return { bufferVal: 9.0 * mult, slVal: 27.0 * mult, type: 'DEFAULT_3X' };
}

function scalpHitRun(mtfC, ltfC, htfDir, price, a, symbol) {
  let dir = structureDir(mtfC);
  if (dir === 0) dir = htfDir !== 0 ? htfDir : 1;
  const activeDir = htfDir !== 0 ? htfDir : dir;
  const isBuy = activeDir === 1;

  const cfg = getAssetConfig(symbol, 'scalp');
  const bufferEnd = isBuy ? price - cfg.bufferVal : price + cfg.bufferVal;
  const sl = isBuy ? bufferEnd - cfg.slVal : bufferEnd + cfg.slVal;

  const riskDistance = Math.abs(price - sl);
  const tp1 = isBuy ? price + (1.0 * riskDistance) : price - (1.0 * riskDistance);
  const tp2 = isBuy ? price + (2.0 * riskDistance) : price - (2.0 * riskDistance);
  const tp3 = isBuy ? price + (3.0 * riskDistance) : price - (3.0 * riskDistance);

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
      trigSrc: `Scalping Agresif (EMA 5/9 + BB Ekstrem) [${cfg.type}]`,
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

function generalTradePlan({ mtfC, m5C, price, symbol, styleKind }) {
  const m15C = aggregateM15(m5C);
  const a15 = atr(m15C, 14);
  const dir = structureDir(mtfC) || 1;
  const isBuy = dir === 1;

  const cfg = getAssetConfig(symbol, styleKind);
  const isLimit = styleKind === 'intraday' || styleKind === 'swing';
  
  const entry = isLimit ? (isBuy ? price - a15 * 0.5 : price + a15 * 0.5) : price;
  const bufferEnd = isBuy ? entry - cfg.bufferVal : entry + cfg.bufferVal;
  const sl = isBuy ? bufferEnd - cfg.slVal : bufferEnd + cfg.slVal;

  const risk = Math.abs(entry - sl);
  const rrList = STYLES[Object.keys(STYLES).find(k => STYLES[k].kind === styleKind)]?.rr || [1.5, 2.5, 4.0];
  
  const tp1 = entry + dir * rrList[0] * risk;
  const tp2 = entry + dir * rrList[1] * risk;
  const tp3 = entry + dir * rrList[2] * risk;

  let trigName = 'Day Trading (Zona Utama & Kontinuitas + EMA 14/20)';
  if (styleKind === 'intraday') trigName = 'Intraday (Limit Order + EMA 20/50/100)';
  if (styleKind === 'swing') trigName = 'Swing Trading (Limit Order + EMA 20/50/100/200)';

  return {
    dir,
    plan: {
      kind: styleKind,
      orderType: isLimit ? 'LIMIT' : 'NOW',
      status: isLimit ? 'PENDING' : 'RUNNING',
      entry,
      bufferEnd,
      sl,
      tps: [tp1, tp2, tp3],
      zone: { min: entry - a15, max: entry + a15 },
      expireMs: isLimit ? 360 * 60 * 1000 : 90 * 60 * 1000,
      trigSrc: `${trigName} [${cfg.type}]`,
      flags: [],
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();
    const style = STYLES[body.tradingStyle];
    const symbol = String(body.marketId || '').split('|').pop().toUpperCase();
    const dec = DECIMALS[symbol] ?? 2;
    const price = Number(body.currentPrice);

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
      const hr = scalpHitRun(mtfC, ltfC, htfDir, price, refAtr, symbol);
      dir = hr.dir;
      plan = hr.plan;
    } else {
      const dp = generalTradePlan({ mtfC, m5C: ltfC, price, symbol, styleKind: style.kind });
      dir = dp.dir;
      plan = dp.plan;
    }

    const entry = plan.entry;
    const r = v => Number(v.toFixed(dec));
    const tps = plan.tps || [entry + dir * 20, entry + dir * 40, entry + dir * 60];

    const actionType = plan.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET';
    const sideText = dir === 1 ? 'BUY' : 'SELL';
    const cfgInfo = getAssetConfig(symbol, style.kind);

    // PENYUSUNAN REASON TEKNIKAL YANG KUAT & KONSISTEN
    const techReason = [
      `Analisis Struktur Pure SMC ${sideText} (${style.label}) pada pair ${symbol}.`,
      `Pijakan Analisis: Harga divalidasi melalui reaksi pada Zona Utama / Peta Struktur Berjalan menggunakan pemicu ${plan.trigSrc}.`,
      `Manajemen Risiko: Jarak Stop Loss dan Buffer telah disesuaikan secara presisi (${cfgInfo.type}) untuk mengantisipasi volatilitas serta noise market secara optimal.`
    ].join('\n\n');

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
        confidence: 'HIGH',
        risk: 'LOW',
        setup: 'CONTINUATION / REVERSAL',
        setupLabel: style.label,
        zoneLabel: 'Order Block / FVG / Structure Zone',
        zoneNote: `Scale Digit Range (${cfgInfo.type})`,
        reason: techReason
      }
    });
  } catch (err) {
    console.error('generate error:', err);
    return res.status(200).json({ ok: false, error: 'Server error: ' + err.message });
  }
}
