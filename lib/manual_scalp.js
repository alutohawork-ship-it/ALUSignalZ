// lib/manual_scalp.js — MANUAL SCALPING: Supply & Demand (RBR/DBR/RBD/DBD) + Order Block (OB) + Market Structure (M15 -> M5 -> M1)
// Aturan Entry Ketat: Tidak ada entry asal pullback atau tebak-tebakan. Wajib melewati 4 tahap Drilling:
// 1. M15: Bias Market Structure (HH/HL atau LH/LL) + Zona S&D M15 valid & fresh.
// 2. M5 : Order Block (OB) presisi di dalam/dekat S&D M15 (beserta 50% Mean Threshold).
// 3. M1 : Konfirmasi (CHoCH Mikro / Engulfing / Rejection) saat harga menyentuh OB (Skema B Market),
//         ATAU Limit Order di Proximal / 50% OB jika zona A+ Fresh (Skema A Limit).
// 4. SL & TP: SL di luar Distal OB M5 (+ buffer ATR), TP1 1:1.5, TP2 1:2.25, TP3 1:3.

const toMs = t => {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n < 1e12 ? n * 1000 : n;
};

const lastOf = arr => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : undefined);
const atIdx = (arr, idx) => {
  if (!Array.isArray(arr) || !arr.length) return undefined;
  return idx < 0 ? arr[arr.length + idx] : arr[idx];
};

export function calcATR(candles, period = 14) {
  const atr = new Array(candles.length).fill(null);
  if (!Array.isArray(candles) || candles.length < period + 1) return atr;
  const trs = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs[i] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trs[i];
  atr[period] = sum / period;
  for (let i = period + 1; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + trs[i]) / period;
  }
  return atr;
}

export function calcEMA(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  if (!Array.isArray(values) || values.length < period) return out;
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════
// MARKET STRUCTURE (HH/HL, LH/LL, BOS, CHoCH)
// ════════════════════════════════════════════════════════════════
export function getSwings(candles, pivotLen = 2) {
  const highs = [], lows = [];
  if (!Array.isArray(candles) || candles.length < pivotLen * 2 + 1) return { highs, lows };
  for (let i = pivotLen; i < candles.length - pivotLen; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= pivotLen; j++) {
      if (!(candles[i].high > candles[i - j].high && candles[i].high >= candles[i + j].high)) isH = false;
      if (!(candles[i].low < candles[i - j].low && candles[i].low <= candles[i + j].low)) isL = false;
    }
    if (isH) highs.push({ i, price: candles[i].high, time: candles[i].time });
    if (isL) lows.push({ i, price: candles[i].low, time: candles[i].time });
  }
  return { highs, lows };
}

export function analyzeMarketStructure(candles, pivotLen = 2) {
  if (!candles || candles.length < 25) {
    return { regime: 'neutral', trend: 0, event: null, swings: { highs: [], lows: [] } };
  }
  const swings = getSwings(candles, pivotLen);
  const { highs, lows } = swings;
  const h1 = atIdx(highs, -1), h0 = atIdx(highs, -2);
  const l1 = atIdx(lows, -1), l0 = atIdx(lows, -2);
  const lastClose = lastOf(candles).close;

  let trend = 0;
  if (h1 && h0 && l1 && l0) {
    if (h1.price > h0.price && l1.price > l0.price) trend = 1;       // HH & HL -> Uptrend
    else if (h1.price < h0.price && l1.price < l0.price) trend = -1; // LH & LL -> Downtrend
  }

  let event = null;
  if (h1 && lastClose > h1.price) {
    event = trend === -1 ? 'CHoCH_UP' : 'BOS_UP';
    if (trend === 0) trend = 1;
  } else if (l1 && lastClose < l1.price) {
    event = trend === 1 ? 'CHoCH_DOWN' : 'BOS_DOWN';
    if (trend === 0) trend = -1;
  }

  const regime = trend === 1 ? 'trending_up' : trend === -1 ? 'trending_down' : 'choppy';
  return { regime, trend, event, swings };
}

export function detectRegime(candles) {
  const ms = analyzeMarketStructure(candles, 3);
  if (ms.regime !== 'choppy') return ms.regime;
  if (!candles || candles.length < 60) return 'neutral';
  const closes = candles.map(c => c.close);
  const ema50 = calcEMA(closes, 50);
  const atr = lastOf(calcATR(candles, 14)) ?? 0;
  const i = candles.length - 1;
  if (ema50[i] == null || ema50[i - 5] == null) return 'neutral';
  const slope = ema50[i] - ema50[i - 5];
  if (Math.abs(slope) > atr * 0.15) return slope > 0 ? 'trending_up' : 'trending_down';
  return 'choppy';
}

// ════════════════════════════════════════════════════════════════
// SUPPLY & DEMAND (RBR / DBR / RBD / DBD) + ORDER BLOCK (OB)
// ════════════════════════════════════════════════════════════════
export function detectSDAndOB(candles, timeframe, opts = {}) {
  const { lookback = 120, impulseMult = 1.5 } = opts;
  if (!Array.isArray(candles) || candles.length < 22) return [];
  const atrArr = calcATR(candles, 14);
  const zones = [];
  const start = Math.max(20, candles.length - lookback);

  for (let i = start; i < candles.length - 1; i++) {
    const atr = atrArr[i];
    if (!atr || !(atr > 0)) continue;
    const legOut = candles[i];
    const bodyOut = Math.abs(legOut.close - legOut.open);

    // Syarat 1: Leg-out impulsif (body >= 1.5x ATR)
    if (bodyOut < impulseMult * atr) continue;
    const isBullImp = legOut.close > legOut.open;

    // Syarat 2: Base konsolidasi 1-3 candle sebelum impuls
    let baseStart = i - 1;
    let baseCount = 0;
    for (let b = i - 1; b >= Math.max(1, i - 3); b--) {
      const bBody = Math.abs(candles[b].close - candles[b].open);
      if (bBody <= 0.85 * atr) {
        baseStart = b;
        baseCount++;
      } else {
        break;
      }
    }
    if (baseCount === 0) continue;

    // Klasifikasi Pola: RBR, DBR, RBD, DBD
    const legIn = candles[baseStart - 1];
    const isBullIn = legIn.close > legIn.open;
    const pattern = isBullImp
      ? (isBullIn ? 'RBR' : 'DBR')
      : (isBullIn ? 'RBD' : 'DBD');

    // Area S&D (base wick-to-wick)
    const baseSlice = candles.slice(baseStart, i);
    const sdTop = Math.max(...baseSlice.map(x => x.high));
    const sdBottom = Math.min(...baseSlice.map(x => x.low));

    // Order Block (OB): candle terakhir berlawanan arah sebelum impuls
    let obCandle = candles[i - 1];
    for (let b = i - 1; b >= baseStart; b--) {
      if (isBullImp && candles[b].close < candles[b].open) { obCandle = candles[b]; break; }
      if (!isBullImp && candles[b].close > candles[b].open) { obCandle = candles[b]; break; }
    }

    const obTop = obCandle.high;
    const obBottom = obCandle.low;
    const obMid = (Math.max(obCandle.open, obCandle.close) + Math.min(obCandle.open, obCandle.close)) / 2;

    const type = isBullImp ? 'demand' : 'supply';
    const isStrongPattern = pattern === 'DBR' || pattern === 'RBD';

    zones.push({
      id: `${timeframe}-${type}-${pattern}-${legOut.time}`,
      type,
      pattern,
      isStrongPattern,
      timeframe,
      top: sdTop,
      bottom: sdBottom,
      obTop,
      obBottom,
      obMid,
      createdIndex: i,
      createdTime: legOut.time,
      fresh: true,
      mitigated: false,
    });
  }

  return zones;
}

// Syarat 3: Freshness & Mitigasi (Zona yang ditembus tidak di-flip otomatis)
export function updateZoneState(zone, candles) {
  let touched = false;
  for (let k = zone.createdIndex + 1; k < candles.length; k++) {
    const c = candles[k];
    if (zone.type === 'supply') {
      if (c.high >= zone.bottom) touched = true;
      if (c.close > zone.top) return { ...zone, fresh: false, mitigated: true };
    } else {
      if (c.low <= zone.top) touched = true;
      if (c.close < zone.bottom) return { ...zone, fresh: false, mitigated: true };
    }
  }
  return { ...zone, fresh: !touched, mitigated: false };
}

// ════════════════════════════════════════════════════════════════
// KONFIRMASI M1 (CHoCH Mikro / Engulfing / Rejection)
// ════════════════════════════════════════════════════════════════
function checkM1Confirmation(c1, side) {
  if (!c1 || c1.length < 10) return { ok: false, reason: 'Data M1 kurang' };
  const last = lastOf(c1);
  const prev = atIdx(c1, -2);
  const rng = last.high - last.low;
  const body = Math.abs(last.close - last.open);
  if (!(rng > 0)) return { ok: false, reason: 'Doji/no range' };

  const isBuy = side === 'buy';

  // 1. Engulfing M1
  const engulfing = isBuy
    ? (last.close > last.open && prev.close < prev.open && last.close > prev.open && last.open <= prev.close)
    : (last.close < last.open && prev.close > prev.open && last.close < prev.open && last.open >= prev.close);
  if (engulfing) return { ok: true, type: 'Engulfing M1' };

  // 2. Pin Bar / Rejection kuat di dalam OB (wick >= 55% range candle)
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const rejection = isBuy
    ? (lowerWick >= 0.55 * rng && last.close >= last.open)
    : (upperWick >= 0.55 * rng && last.close <= last.open);
  if (rejection) return { ok: true, type: 'Rejection/Pin Bar M1' };

  // 3. CHoCH Mikro M1 (close menembus swing high/low mikro 6 candle terakhir)
  const recent = c1.slice(-7, -1);
  const microHigh = Math.max(...recent.map(x => x.high));
  const microLow = Math.min(...recent.map(x => x.low));
  const choch = isBuy
    ? (last.close > microHigh && body >= 0.45 * rng)
    : (last.close < microLow && body >= 0.45 * rng);
  if (choch) return { ok: true, type: 'CHoCH Mikro M1' };

  return { ok: false, reason: 'Menunggu CHoCH mikro / engulfing / rejection M1' };
}

function makeIntent(style, side, entryPrice, sl, expiryMs, zoneId, maxSpread, minRR, reason, now) {
  return { style, side, entryType: 'limit', entryPrice, sl, expiryTime: now + expiryMs, zoneId, maxSpread, minRR, reason };
}

export function buildTargets(side, entry, sl) {
  const risk = Math.abs(entry - sl);
  const dir = side === 'buy' ? 1 : -1;
  return { risk, tp1: entry + dir * risk * 1.5, tp2: entry + dir * risk * 2.25, tp3: entry + dir * risk * 3 };
}

const SCALP_CFG = {
  zoneMaxAtr: 3.0,
  slBufAtr: 0.25,
  minRiskAtr: 0.5,
  maxRiskAtr: 3.5,
  limitExpiryMs: 30 * 60e3,
};

function clampScalpRisk(intent, atr) {
  const risk = Math.abs(intent.entryPrice - intent.sl);
  if (!(risk > 0) || risk > SCALP_CFG.maxRiskAtr * atr) return null;
  if (risk < SCALP_CFG.minRiskAtr * atr) {
    const r = SCALP_CFG.minRiskAtr * atr;
    intent.sl = intent.side === 'buy' ? intent.entryPrice - r : intent.entryPrice + r;
  }
  return intent;
}

// ════════════════════════════════════════════════════════════════
// SCALPING ENGINE: DRILLING M15 (Bias & S&D) -> M5 (OB) -> M1 (Konfirmasi)
// ════════════════════════════════════════════════════════════════
export function generateScalpDrilling({ c15, c5, c1, ms15, ctx }) {
  if (!['trending_up', 'trending_down'].includes(ms15.regime)) return null;
  const atr5 = lastOf(calcATR(c5, 14));
  if (!atr5 || !(atr5 > 0)) return null;

  const buy = ms15.regime === 'trending_up';
  const side = buy ? 'buy' : 'sell';
  const wantType = buy ? 'demand' : 'supply';
  const last5 = lastOf(c5);
  const price = ctx.price > 0 ? ctx.price : (last5 ? last5.close : 0);
  if (!(price > 0)) return null;
  const buf = SCALP_CFG.slBufAtr * atr5;

  // Step 1: Zona S&D M15 yang belum ditembus & searah bias M15
  const sd15 = detectSDAndOB(c15, 'M15', { lookback: 100, impulseMult: 1.5 })
    .map(z => updateZoneState(z, c15))
    .filter(z => !z.mitigated && z.type === wantType);

  // Step 2: Order Block M5 yang valid & searah bias M15
  const ob5All = detectSDAndOB(c5, 'M5', { lookback: 100, impulseMult: 1.5 })
    .map(z => updateZoneState(z, c5))
    .filter(z => !z.mitigated && z.type === wantType);

  if (!ob5All.length) return null;

  // Prioritas: Fresh > Overlap S&D M15 > Pola Kuat (DBR/RBD) > Jarak Terdekat
  const scored = ob5All.map(ob => {
    const inHtf = sd15.some(h => ob.obBottom <= h.top && ob.obTop >= h.bottom);
    const dist = price > ob.obTop ? price - ob.obTop : price < ob.obBottom ? ob.obBottom - price : 0;
    return { ob, inHtf, dist };
  })
    .filter(x => x.dist <= SCALP_CFG.zoneMaxAtr * atr5)
    .sort((a, b) => {
      if (a.ob.fresh !== b.ob.fresh) return Number(b.ob.fresh) - Number(a.ob.fresh);
      if (a.inHtf !== b.inHtf) return Number(b.inHtf) - Number(a.inHtf);
      if (a.ob.isStrongPattern !== b.ob.isStrongPattern) return Number(b.ob.isStrongPattern) - Number(a.ob.isStrongPattern);
      return a.dist - b.dist;
    });

  if (!scored.length) return null;
  const best = scored[0];
  const ob = best.ob;
  const sl = buy ? ob.obBottom - buf : ob.obTop + buf;
  const htfTag = best.inHtf ? ' + Konfluensi S&D M15' : '';

  const build = (orderType, entry, reason) => {
    const intent = {
      ...makeIntent('SCALP', side, entry, sl, SCALP_CFG.limitExpiryMs, ob.id, ctx.maxSpread, 1.5, reason, ctx.now),
      orderType,
      entryType: orderType === 'MARKET' ? 'market' : 'limit',
    };
    return clampScalpRisk(intent, atr5);
  };

  // Step 3: Harga sudah menyentuh / masuk OB M5 -> Skema B (Wajib Konfirmasi M1)
  const inZone = buy
    ? (price <= ob.obTop + 0.15 * atr5 && price >= ob.obBottom - 0.15 * atr5)
    : (price >= ob.obBottom - 0.15 * atr5 && price <= ob.obTop + 0.15 * atr5);

  if (inZone) {
    const conf = checkM1Confirmation(c1, side);
    if (conf.ok) {
      return build('MARKET', price,
        `Skema B (Market): Harga di OB M5 (${ob.pattern}${htfTag}) + ${conf.type}`);
    }
    return null; // Jangan entry sebelum ada konfirmasi M1
  }

  // Step 4: Harga belum menyentuh OB M5 -> Skema A (Limit Order) khusus zona Fresh A+
  if (ob.fresh && (best.inHtf || ob.isStrongPattern)) {
    const rawEntry = ob.isStrongPattern ? ob.obMid : (buy ? ob.obTop : ob.obBottom);
    const validLimit = buy ? rawEntry < price : rawEntry > price;
    if (!validLimit) return null;
    return build('LIMIT', rawEntry,
      `Skema A (Limit): OB M5 Fresh (${ob.pattern}${htfTag}), entry ${ob.isStrongPattern ? '50% Mean Threshold' : 'Proximal'}`);
  }

  return null;
}

export function qualityGate(intent, ctx) {
  if (!intent) return false;
  if (ctx.spread > intent.maxSpread) return false;
  if (intent.side === 'buy' && intent.sl >= intent.entryPrice) return false;
  if (intent.side === 'sell' && intent.sl <= intent.entryPrice) return false;
  const risk = Math.abs(intent.entryPrice - intent.sl);
  if (!(risk > 0)) return false;
  if (intent.zoneId && Array.isArray(ctx.zones) && ctx.zones.length) {
    const zone = ctx.zones.find(z => z.id === intent.zoneId);
    if (!zone || zone.mitigated) return false;
  }
  return !!buildTargets(intent.side, intent.entryPrice, intent.sl).tp1;
}

export function createLimitOrder(intent, tickSize) {
  const step = Number(tickSize) > 0 ? Number(tickSize) : 0.1;
  const round = p => Math.round(p / step) * step;
  const t = buildTargets(intent.side, intent.entryPrice, intent.sl);
  return {
    ...intent,
    entryPrice: round(intent.entryPrice),
    sl: round(intent.sl),
    tp1: round(t.tp1), tp2: round(t.tp2), tp3: round(t.tp3),
    risk: t.risk,
    status: intent.orderType === 'MARKET' ? 'RUNNING' : 'PENDING',
  };
}

// ════════════════════════════════════════════════════════════════
// INTRADAY & SWING
// ════════════════════════════════════════════════════════════════
export function calcVWAPSession(candles) {
  let pv = 0, v = 0, day = null;
  const out = [];
  for (const c of candles) {
    const d = new Date(toMs(c.time)).toISOString().slice(0, 10);
    if (d !== day) { pv = 0; v = 0; day = d; }
    pv += (c.high + c.low + c.close) / 3;
    v += 1;
    out.push(pv / v);
  }
  return out;
}

export function nextSessionEnd(now) {
  const d = new Date(now);
  const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 21, 0, 0));
  if (e.getTime() <= now) e.setUTCDate(e.getUTCDate() + 1);
  return e.getTime();
}

export function generateIntraday(candles, ctx) {
  const vwap = lastOf(calcVWAPSession(candles));
  const atr = lastOf(calcATR(candles, 14));
  if (!vwap || !atr) return null;
  const last = lastOf(candles);
  const dayOf = c => new Date(toMs(c.time)).toISOString().slice(0, 10);
  if (candles.filter(c => dayOf(c) === dayOf(last)).length < 8) return null;
  const expiry = ctx.sessionEnd - ctx.now;
  if (expiry <= 0) return null;
  const side = ctx.regime === 'trending_up' ? 'buy'
    : ctx.regime === 'trending_down' ? 'sell'
    : ctx.regime === 'choppy' ? null
    : (last.close > vwap ? 'buy' : 'sell');
  if (!side) return null;
  const d = side === 'buy' ? 1 : -1;
  const entry = vwap + d * atr * 0.1;
  if (side === 'buy' ? entry >= last.close : entry <= last.close) return null;
  return makeIntent('INTRADAY', side, entry, vwap - d * atr, expiry, null, ctx.maxSpread, 2, 'vwap_pullback', ctx.now);
}

export function generateSwing(candles, zones, ctx) {
  const last = lastOf(candles);
  const wantType = ctx.regime === 'trending_up' ? 'demand' : ctx.regime === 'trending_down' ? 'supply' : null;
  if (!wantType) return null;
  const valid = zones.filter(z => !z.mitigated && z.type === wantType && ['H4', 'D1'].includes(z.timeframe));
  for (const z of valid) {
    if (z.type === 'demand' && last.close > z.obTop && (last.close - z.obTop) <= 6 * ctx.atr)
      return makeIntent('SWING', 'buy', z.obTop, z.obBottom - ctx.atr * 0.5, 4 * 86400e3, z.id, ctx.maxSpread, 3, `htf_demand_${z.pattern}`, ctx.now);
    if (z.type === 'supply' && last.close < z.obBottom && (z.obBottom - last.close) <= 6 * ctx.atr)
      return makeIntent('SWING', 'sell', z.obBottom, z.obTop + ctx.atr * 0.5, 4 * 86400e3, z.id, ctx.maxSpread, 3, `htf_supply_${z.pattern}`, ctx.now);
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
// TITIK MASUK SEMUA GAYA MANUAL
// ════════════════════════════════════════════════════════════════
export function generateManualPlan({ m1, m5, m15, m30, h1, h4, d1, tickSize, now = Date.now(), price: livePrice }, styleName) {
  const toDoc = bars => (bars || []).map(b => ({ time: toMs(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: 1 }));
  const ctxBase = { now, spread: 0, maxSpread: Infinity, tickSize };

  if (styleName === 'Scalping') {
    const c1 = toDoc(m1), c5 = toDoc(m5), c15 = toDoc(m15);
    const atr5 = lastOf(calcATR(c5, 14));
    if (!c5.length || !atr5) return { ok: false, reason: 'Data M5 belum cukup untuk menghitung ATR dan Order Block.' };

    const ms15 = analyzeMarketStructure(c15, 2);
    if (ms15.regime === 'choppy' || ms15.regime === 'neutral') {
      return {
        ok: false, regime: 'choppy', regimeSrc: 'M15 MS',
        reason: 'Market Structure M15 belum membentuk tren jelas (HH/HL atau LH/LL). Skip sesuai aturan bias HTF.',
      };
    }

    const ob5Zones = detectSDAndOB(c5, 'M5', { lookback: 100, impulseMult: 1.5 }).map(z => updateZoneState(z, c5));
    const ctx = { ...ctxBase, regime: ms15.regime, zones: ob5Zones, atr: atr5, price: Number(livePrice) || 0 };
    const intent = generateScalpDrilling({ c15, c5, c1, ms15, ctx });

    if (!intent) {
      return {
        ok: false, regime: ms15.regime, regimeSrc: `M15 MS (${ms15.event || 'Trend'})`,
        reason: `Bias M15 ${ms15.regime === 'trending_up' ? 'Bullish (HH/HL)' : 'Bearish (LH/LL)'}, menunggu harga masuk ke OB M5 fresh atau menunggu konfirmasi CHoCH/Engulfing M1.`,
      };
    }
    if (!qualityGate(intent, ctx)) {
      return { ok: false, regime: ms15.regime, regimeSrc: 'M15 MS', reason: 'Setup OB ditemukan, tetapi gagal quality gate.' };
    }
    const chosenZone = ob5Zones.find(z => z.id === intent.zoneId) || null;
    return {
      ok: true,
      order: createLimitOrder(intent, tickSize),
      regime: ms15.regime,
      regimeSrc: `M15 MS (${ms15.event || 'Trend'})`,
      zone: chosenZone ? { ...chosenZone, top: chosenZone.obTop, bottom: chosenZone.obBottom, type: `${chosenZone.type} OB (${chosenZone.pattern})` } : null,
    };
  }

  if (styleName === 'Intraday') {
    const c15 = toDoc(m15), cH4 = toDoc(h4);
    const atr15 = lastOf(calcATR(c15, 14));
    if (!c15.length || !atr15) return { ok: false, reason: 'Data M15 belum cukup untuk VWAP/ATR.' };
    const regime = detectRegime(cH4);
    const sessionEnd = nextSessionEnd(now);
    const ctx = { ...ctxBase, regime, zones: [], atr: atr15, sessionEnd };
    const intent = generateIntraday(c15, ctx);
    if (!intent) return { ok: false, regime, reason: 'Belum ada pullback ke VWAP sesi atau regime H4 choppy.' };
    if (!qualityGate(intent, ctx)) return { ok: false, regime, reason: 'Setup ditemukan, tapi gagal quality gate.' };
    return { ok: true, order: createLimitOrder(intent, tickSize), regime, zone: null };
  }

  if (styleName === 'Swing') {
    const cH4 = toDoc(h4), cD1 = toDoc(d1);
    const atr4 = lastOf(calcATR(cH4, 14));
    if (!cH4.length || !atr4) return { ok: false, reason: 'Data H4 belum cukup untuk ATR.' };
    const regime = detectRegime(cD1);
    const zones = [
      ...detectSDAndOB(cH4, 'H4').map(z => updateZoneState(z, cH4)),
      ...detectSDAndOB(cD1, 'D1').map(z => updateZoneState(z, cD1)),
    ];
    const ctx = { ...ctxBase, regime, zones, atr: atr4 };
    const intent = generateSwing(cH4, zones, ctx);
    if (!intent) return { ok: false, regime, reason: 'Belum ada zona S&D/OB H4/D1 searah D1 yang dekat dengan harga.' };
    if (!qualityGate(intent, ctx)) return { ok: false, regime, reason: 'Setup ditemukan, tapi gagal quality gate.' };
    return { ok: true, order: createLimitOrder(intent, tickSize), regime, zone: zones.find(z => z.id === intent.zoneId) || null };
  }

  return { ok: false, reason: `Gaya tidak dikenal: ${styleName}` };
}

export const SYARAT_MASUK = {
  'Scalping': 'Bias Market Structure M15 (HH/HL atau LH/LL) + Zona S&D M15 & OB M5 Fresh (RBR/DBR/RBD/DBD) + Limit di Proximal/50% OB (Skema A) atau Market setelah CHoCH/Engulfing M1 (Skema B)',
  'Intraday': 'Regime H4 searah, pullback ke VWAP sesi M15, limit terisi di VWAP (RR 1:1.5 s/d 1:3)',
  'Swing': 'Harga mendekati zona S&D/OB H4/D1 searah regime D1, limit terisi di OB H4 (RR 1:3)',
};

export function buildWatchlist({ m5, m15, m30, h1, h4, d1, price, pip, styleName }) {
  const toDoc = bars => (bars || []).map(b => ({ time: toMs(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: 1 }));
  const sets = {
    'Scalping': [['M15', m15, 3], ['M5', m5, 2.5]],
    'Intraday': [['H1', h1, 3], ['M15', m15, 2]],
    'Swing': [['H4', h4, 3], ['D1', d1, 3]],
  }[styleName] || [];
  const out = [];
  const step = Number(pip) > 0 ? Number(pip) : 0.1;
  for (const [tf, bars, maxAtr] of sets) {
    const c = toDoc(bars);
    if (c.length < 25) continue;
    const atr = lastOf(calcATR(c, 14));
    if (!atr) continue;
    const zones = detectSDAndOB(c, tf, { lookback: 100, impulseMult: 1.5 })
      .map(z => updateZoneState(z, c))
      .filter(z => !z.mitigated);
    for (const z of zones) {
      const top = tf === 'M5' ? z.obTop : z.top;
      const bottom = tf === 'M5' ? z.obBottom : z.bottom;
      const dist = price > top ? price - top : price < bottom ? bottom - price : 0;
      if (dist > maxAtr * atr) continue;
      out.push({
        tf,
        tipe: `${z.type === 'supply' ? 'SELL (Supply' : 'BUY (Demand'} ${z.pattern}${tf === 'M5' ? ' OB' : ''})`,
        bawah: bottom,
        atas: top,
        jarak_pip: Math.round(dist / step),
        di_dalam: dist === 0,
        status: z.fresh ? 'fresh' : 'termitigasi sebagian',
      });
    }
  }
  out.sort((a, b) => (a.status === b.status ? a.jarak_pip - b.jarak_pip : a.status === 'fresh' ? -1 : 1));
  return out.slice(0, 4);
}
