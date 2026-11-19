// lib/manual_scalp.js — ENGINE MANUAL
// SCALPING (SMC):
//   H1 bias (HH/HL atau LH/LL)
//   -> M5 BOS/CHoCH + anchor leg
//   -> OTE Fibonacci 0.618–0.786
//   -> POI (OB / FVG / S&D) minimal 2 dari 3 jenis di dalam OTE
//   -> M1 CHoCH + candle konfirmasi (body >= 50%, close menembus high candle CHoCH)
//   -> entry MARKET jika harga sudah di area entry, selain itu LIMIT di midpoint POI
//   -> SL di luar POI + buffer 0.2 ATR M1
//   -> TP 1:1 / 1:1.5 / 1:2 (pilihan RR)
// INTRADAY & SWING: logika VWAP dan S&D H4/D1 dipertahankan.

export const CFG = {
  swingLen: 3,            // fractal M5/H1: 3 candle kiri, 3 candle kanan
  m1SwingLen: 2,          // fractal M1 untuk CHoCH mikro
  atrPeriod: 14,
  structLookback: 40,     // BOS/CHoCH M5 harus terjadi dalam 40 candle terakhir
  m1EventLookback: 20,    // CHoCH M1 harus terjadi dalam 20 candle terakhir
  touchLookback: 30,      // harga harus menyentuh POI dalam 30 candle M1 terakhir
  oteFrom: 0.618,
  oteTo: 0.786,
  oteMid: 0.705,
  maxRetraceFib: 0.886,   // retrace lebih dalam dari ini = setup batal
  minConfluence: 2,
  obMaxAge: 100,
  obMitigationDepth: 0.5, // harga masuk > 50% OB = termitigasi
  fvgMinAtr: 0.2,
  fvgMaxAge: 50,
  sdImpulseAtr: 1.5,
  sdBaseAtr: 0.85,
  sdMaxWidthAtr: 1.0,
  slBufferAtr: 0.2,       // buffer SL = 0.2 ATR M1
  maxSlAtrM1: 2.0,        // SL lebih dari 2 ATR M1 = ditolak
  minSlPips: 30,          // SL minimal 30 pip
  marketTolR: 0.1,        // MARKET jika harga sudah di dalam 0.1R dari entry
  blockMinR: 0.3,         // swing likuiditas di atas 0.3R dihitung sebagai penghalang
  blockLookback: 60,
  bodyMin: 0.5,
  orderExpiryMs: 10 * 60e3, // limit kedaluwarsa setelah 10 candle M1
  rrOptions: [1, 1.5, 2],
  defaultRr: 1.5,
};

const toMs = t => {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n < 1e12 ? n * 1000 : n;
};
const toDoc = bars => (bars || []).map(b => ({ time: toMs(b.t), open: b.o, high: b.h, low: b.l, close: b.c }));
const lastOf = arr => (arr && arr.length ? arr[arr.length - 1] : undefined);
const roundTo = (p, dec) => Number(Number(p).toFixed(dec));

// ════════════════════════════════════════════════════════════════
// INDIKATOR
// ════════════════════════════════════════════════════════════════
export function calcATR(c, period = CFG.atrPeriod) {
  const out = new Array(c.length).fill(null);
  if (!c || c.length < period + 1) return out;
  const tr = c.map((x, i) => (i === 0
    ? x.high - x.low
    : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close))));
  let atr = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = atr;
  for (let i = period + 1; i < c.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i] = atr;
  }
  return out;
}
const atrLast = c => lastOf(calcATR(c)) || 0;

export function calcEMA(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════
// MARKET STRUCTURE: fractal swing, BOS/CHoCH, anchor leg
// ════════════════════════════════════════════════════════════════
export function getSwings(c, n = CFG.swingLen) {
  const highs = [], lows = [];
  for (let i = n; i < c.length - n; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= n; j++) {
      if (!(c[i].high > c[i - j].high && c[i].high >= c[i + j].high)) isH = false;
      if (!(c[i].low < c[i - j].low && c[i].low <= c[i + j].low)) isL = false;
    }
    if (isH) highs.push({ i, price: c[i].high });
    if (isL) lows.push({ i, price: c[i].low });
  }
  return { highs, lows };
}

// Anchor leg: impuls dari swing awal sampai harga tertinggi/terendah sebelum event k
function anchorOf(c, side, swingIdx, k) {
  if (side === 'buy') {
    let hi = -Infinity, hiI = swingIdx;
    for (let j = swingIdx; j <= k; j++) if (c[j].high > hi) { hi = c[j].high; hiI = j; }
    return { low: c[swingIdx].low, lowIdx: swingIdx, high: hi, highIdx: hiI };
  }
  let lo = Infinity, loI = swingIdx;
  for (let j = swingIdx; j <= k; j++) if (c[j].low < lo) { lo = c[j].low; loI = j; }
  return { high: c[swingIdx].high, highIdx: swingIdx, low: lo, lowIdx: loI };
}

// Event BOS/CHoCH tanpa lookahead: swing hanya dipakai setelah right-bars selesai
export function structureEvents(c, n = CFG.swingLen) {
  const { highs, lows } = getSwings(c, n);
  const events = [];
  let trend = 0, brokenHi = -1, brokenLo = -1;
  for (let k = 2 * n + 1; k < c.length; k++) {
    const hs = highs.filter(h => h.i + n < k);
    const ls = lows.filter(l => l.i + n < k);
    const h1 = lastOf(hs), h0 = hs.length >= 2 ? hs[hs.length - 2] : undefined;
    const l1 = lastOf(ls), l0 = ls.length >= 2 ? ls[ls.length - 2] : undefined;
    if (h1 && h0 && l1 && l0) {
      if (h1.price > h0.price && l1.price > l0.price) trend = 1;
      else if (h1.price < h0.price && l1.price < l0.price) trend = -1;
    }
    const close = c[k].close;
    if (h1 && h1.i !== brokenHi && close > h1.price) {
      const lb = lastOf(ls.filter(l => l.i < h1.i));
      events.push({
        k, side: 'buy', type: trend === -1 ? 'CHoCH_BULL' : 'BOS_BULL',
        level: h1.price, anchor: lb ? anchorOf(c, 'buy', lb.i, k) : null,
      });
      brokenHi = h1.i;
      trend = 1;
    }
    if (l1 && l1.i !== brokenLo && close < l1.price) {
      const hb = lastOf(hs.filter(h => h.i < l1.i));
      events.push({
        k, side: 'sell', type: trend === 1 ? 'CHoCH_BEAR' : 'BOS_BEAR',
        level: l1.price, anchor: hb ? anchorOf(c, 'sell', hb.i, k) : null,
      });
      brokenLo = l1.i;
      trend = -1;
    }
  }
  return { trend, events, highs, lows };
}

function recentEvent(s, c, lookback) {
  const ev = lastOf(s.events);
  return ev && ev.k >= c.length - 1 - lookback ? ev : null;
}

export function detectRegime(c) {
  const s = structureEvents(c, 3);
  if (s.trend === 1) return 'trending_up';
  if (s.trend === -1) return 'trending_down';
  if (!c || c.length < 60) return 'neutral';
  const ema = calcEMA(c.map(x => x.close), 50);
  const i = c.length - 1, atr = atrLast(c);
  if (ema[i] == null || ema[i - 5] == null) return 'neutral';
  const slope = ema[i] - ema[i - 5];
  if (Math.abs(slope) > atr * 0.15) return slope > 0 ? 'trending_up' : 'trending_down';
  return 'choppy';
}

// ════════════════════════════════════════════════════════════════
// SUPPLY & DEMAND (RBR/DBR/RBD/DBD) — zona base wick-to-wick
// ════════════════════════════════════════════════════════════════
export function detectSDAndOB(c, timeframe, opts = {}) {
  const { lookback = 100, impulseMult = CFG.sdImpulseAtr, baseMult = CFG.sdBaseAtr } = opts;
  const zones = [];
  if (!c || c.length < 22) return zones;
  const atrArr = calcATR(c);
  const start = Math.max(20, c.length - lookback);
  for (let i = start; i < c.length - 1; i++) {
    const atr = atrArr[i];
    if (!atr) continue;
    const out = c[i];
    if (Math.abs(out.close - out.open) < impulseMult * atr) continue;
    const isBullImp = out.close > out.open;
    let baseStart = i, baseCount = 0;
    for (let b = i - 1; b >= Math.max(1, i - 3); b--) {
      if (Math.abs(c[b].close - c[b].open) <= baseMult * atr) { baseStart = b; baseCount++; }
      else break;
    }
    if (baseCount === 0) continue;
    const legIn = c[baseStart - 1];
    if (!legIn) continue;
    const isBullIn = legIn.close > legIn.open;
    const pattern = isBullImp ? (isBullIn ? 'RBR' : 'DBR') : (isBullIn ? 'RBD' : 'DBD');
    const base = c.slice(baseStart, i);
    zones.push({
      id: `${timeframe}-${isBullImp ? 'demand' : 'supply'}-${pattern}-${out.time}`,
      type: isBullImp ? 'demand' : 'supply',
      pattern, timeframe,
      top: Math.max(...base.map(x => x.high)),
      bottom: Math.min(...base.map(x => x.low)),
      createdIndex: i, fresh: true, mitigated: false,
    });
  }
  return zones;
}

export function updateZoneState(zone, c) {
  let touched = false;
  for (let k = zone.createdIndex + 1; k < c.length; k++) {
    const x = c[k];
    if (zone.type === 'supply') {
      if (x.high >= zone.bottom) touched = true;
      if (x.close > zone.top) return { ...zone, fresh: false, mitigated: true };
    } else {
      if (x.low <= zone.top) touched = true;
      if (x.close < zone.bottom) return { ...zone, fresh: false, mitigated: true };
    }
  }
  return { ...zone, fresh: !touched, mitigated: false };
}

// ════════════════════════════════════════════════════════════════
// ORDER BLOCK & FVG (di dalam anchor leg M5)
// ════════════════════════════════════════════════════════════════
// OB bullish = candle bearish terakhir sebelum impuls naik.
// OB bearish = candle bullish terakhir sebelum impuls turun.
function findOB(c5, anc, side) {
  let idx = -1;
  if (side === 'buy') {
    for (let j = anc.highIdx - 1; j >= anc.lowIdx; j--) {
      if (c5[j].close < c5[j].open) { idx = j; break; }
    }
  } else {
    for (let j = anc.lowIdx - 1; j >= anc.highIdx; j--) {
      if (c5[j].close > c5[j].open) { idx = j; break; }
    }
  }
  if (idx < 0 || c5.length - 1 - idx > CFG.obMaxAge) return null;
  const ob = c5[idx];
  const span = ob.high - ob.low;
  if (!(span > 0)) return null;
  let depth = 0;
  for (let j = idx + 1; j < c5.length; j++) {
    const pen = side === 'buy' ? (ob.high - c5[j].low) / span : (c5[j].high - ob.low) / span;
    if (pen > depth) depth = pen;
  }
  if (depth > CFG.obMitigationDepth) return null;
  return {
    id: `M5-OB-${side}-${ob.time}`, kind: 'OB',
    label: `OB ${side === 'buy' ? 'bullish' : 'bearish'}`,
    top: ob.high, bottom: ob.low, fresh: depth === 0,
  };
}

// FVG bullish: high candle[i-2] < low candle[i]. Bearish: low candle[i-2] > high candle[i].
function findFVGs(c5, side, fromIdx, atr) {
  const out = [];
  const start = Math.max(2, c5.length - 1 - CFG.fvgMaxAge, fromIdx);
  for (let i = start; i < c5.length; i++) {
    const a = c5[i - 2], b = c5[i];
    let top, bottom;
    if (side === 'buy' && a.high < b.low) { bottom = a.high; top = b.low; }
    else if (side === 'sell' && a.low > b.high) { bottom = b.high; top = a.low; }
    else continue;
    if (top - bottom < CFG.fvgMinAtr * atr) continue;
    let filled = false;
    for (let j = i + 1; j < c5.length; j++) {
      if (side === 'buy' ? c5[j].low <= bottom : c5[j].high >= top) { filled = true; break; }
    }
    if (!filled) {
      out.push({
        id: `M5-FVG-${side}-${b.time}`, kind: 'FVG',
        label: `FVG ${side === 'buy' ? 'bullish' : 'bearish'}`,
        top, bottom, fresh: true,
      });
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════
// KONFIRMASI M1: CHoCH M1 setelah sentuhan POI + candle konfirmasi
// ════════════════════════════════════════════════════════════════
export function m1ChochConfirm(c1, side, lookback = CFG.m1EventLookback, minIdx = 0) {
  const s = structureEvents(c1, CFG.m1SwingLen);
  const ev = recentEvent(s, c1, lookback);
  const want = side === 'buy' ? 'CHoCH_BULL' : 'CHoCH_BEAR';
  if (!ev || ev.type !== want || ev.k < minIdx) {
    return { ok: false, reason: 'Belum ada CHoCH M1 searah setelah harga menyentuh POI', ev: null };
  }
  const cl = lastOf(c1);
  const range = cl.high - cl.low;
  if (!(range > 0) || c1.length - 1 <= ev.k) {
    return { ok: false, reason: 'Menunggu candle konfirmasi M1 setelah CHoCH', ev: null };
  }
  const body = Math.abs(cl.close - cl.open);
  const dirOk = side === 'buy' ? cl.close > cl.open : cl.close < cl.open;
  const breakOk = side === 'buy' ? cl.close > c1[ev.k].high : cl.close < c1[ev.k].low;
  if (!(dirOk && breakOk && body >= CFG.bodyMin * range)) {
    return { ok: false, reason: 'Candle konfirmasi M1 belum valid (arah, close, atau body < 50%)', ev: null };
  }
  return { ok: true, ev, type: want };
}

// ════════════════════════════════════════════════════════════════
// TARGET & ORDER
// ════════════════════════════════════════════════════════════════
export function buildTargets(side, entry, sl, mults = [1.5, 2.25, 3]) {
  const risk = Math.abs(entry - sl);
  const d = side === 'buy' ? 1 : -1;
  return {
    risk,
    tp1: entry + d * risk * mults[0],
    tp2: entry + d * risk * mults[1],
    tp3: entry + d * risk * mults[2],
  };
}

function buildOrder(side, entry, sl, mults, orderType, expiryTime, reason, rr, dec) {
  const t = buildTargets(side, entry, sl, mults);
  return {
    side, orderType,
    entryPrice: roundTo(entry, dec), sl: roundTo(sl, dec),
    tp1: roundTo(t.tp1, dec), tp2: roundTo(t.tp2, dec), tp3: roundTo(t.tp3, dec),
    risk: roundTo(t.risk, dec), rr, expiryTime,
    invalidLevel: null, zoneId: null, reason,
  };
}

// ════════════════════════════════════════════════════════════════
// SCALPING: H1 bias -> M5 structure & OTE -> POI -> M1 confirm -> order
// ════════════════════════════════════════════════════════════════
function scalpPlan(bars, ctx) {
  const checks = [];
  let regime = 'choppy', regimeSrc = 'H1 MS';
  const fail = reason => ({ ok: false, regime, regimeSrc, reason, checks });
  const { dec, pip, now, rr, price: px } = ctx;
  const R2 = v => roundTo(v, dec);

  const c1 = toDoc(bars.m1), c5 = toDoc(bars.m5), ch1 = toDoc(bars.h1);
  if (c5.length < 30 || c1.length < 20 || ch1.length < 20) return fail('Data candle belum cukup (H1/M5/M1).');
  const atr5 = atrLast(c5), atr1 = atrLast(c1);
  if (!(atr5 > 0) || !(atr1 > 0)) return fail('ATR belum bisa dihitung.');

  // 1) Bias H1
  const hb = structureEvents(ch1, CFG.swingLen);
  if (hb.trend === 0) {
    checks.push('BELUM: bias H1 belum jelas (HH/HL atau LH/LL).');
    return fail('Bias H1 belum searah (choppy).');
  }
  const side = hb.trend === 1 ? 'buy' : 'sell';
  regime = hb.trend === 1 ? 'trending_up' : 'trending_down';
  regimeSrc = `H1 MS (${side === 'buy' ? 'HH/HL' : 'LH/LL'})`;
  checks.push(`OK: bias H1 ${side === 'buy' ? 'bullish' : 'bearish'}.`);

  // 2) BOS/CHoCH M5 searah + anchor leg
  const s5 = structureEvents(c5, CFG.swingLen);
  const ev5 = recentEvent(s5, c5, CFG.structLookback);
  const okTypes = side === 'buy' ? ['BOS_BULL', 'CHoCH_BULL'] : ['BOS_BEAR', 'CHoCH_BEAR'];
  if (!ev5 || !okTypes.includes(ev5.type) || !ev5.anchor) {
    checks.push('BELUM: belum ada BOS/CHoCH M5 searah dengan bias H1.');
    return fail('Belum ada BOS/CHoCH M5 searah.');
  }
  const anc = ev5.anchor;
  const R = anc.high - anc.low;
  if (!(R > 0)) return fail('Anchor leg tidak valid.');
  regimeSrc += ` · M5 ${ev5.type}`;
  checks.push(`OK: ${ev5.type} M5, anchor ${R2(anc.low)}–${R2(anc.high)}.`);

  // 3) OTE & invalidasi
  const lvl = f => (side === 'buy' ? anc.high - R * f : anc.low + R * f);
  const oteHi = Math.max(lvl(CFG.oteFrom), lvl(CFG.oteTo));
  const oteLo = Math.min(lvl(CFG.oteFrom), lvl(CFG.oteTo));
  const deep = lvl(CFG.maxRetraceFib);
  if (side === 'buy' ? (px < anc.low || px < deep) : (px > anc.high || px > deep)) {
    return fail('Harga menembus invalidasi (swing atau retrace 0.886). Setup batal.');
  }
  checks.push(`OK: OTE ${R2(oteLo)}–${R2(oteHi)} (0.618–0.786).`);

  // 4) POI di dalam OTE, minimal 2 jenis dari 3
  const ov = z => z.bottom <= oteHi && z.top >= oteLo;
  const cands = [];
  const ob = findOB(c5, anc, side);
  if (ob && ov(ob)) cands.push(ob);
  for (const f of findFVGs(c5, side, side === 'buy' ? anc.lowIdx : anc.highIdx, atr5)) {
    if (ov(f)) cands.push(f);
  }
  const sdList = detectSDAndOB(c5, 'M5')
    .map(z => updateZoneState(z, c5))
    .filter(z => !z.mitigated && z.type === (side === 'buy' ? 'demand' : 'supply') && (z.top - z.bottom) <= CFG.sdMaxWidthAtr * atr5);
  for (const z of sdList) {
    if (ov(z)) cands.push({
      id: z.id, kind: 'SD',
      label: `${side === 'buy' ? 'Demand' : 'Supply'} ${z.pattern}`,
      top: z.top, bottom: z.bottom, fresh: z.fresh,
    });
  }
  const kinds = new Set(cands.map(z => z.kind));
  if (kinds.size < CFG.minConfluence) {
    checks.push(`BELUM: POI di OTE hanya ${kinds.size} dari 3 jenis (OB/FVG/S&D), minimal 2.`);
    return fail('Confluence POI di dalam OTE kurang dari 2.');
  }
  checks.push(`OK: confluence POI ${kinds.size}/3 (${[...kinds].join(', ')}).`);
  const mid705 = lvl(CFG.oteMid);
  cands.sort((a, b) => Math.abs((a.top + a.bottom) / 2 - mid705) - Math.abs((b.top + b.bottom) / 2 - mid705));
  const poi = cands[0];
  const poiMid = (poi.top + poi.bottom) / 2;

  // 5) Harga menyentuh POI (M1)
  let touchIdx = -1;
  for (let j = Math.max(0, c1.length - CFG.touchLookback); j < c1.length; j++) {
    if (side === 'buy' ? c1[j].low <= poi.top : c1[j].high >= poi.bottom) { touchIdx = j; break; }
  }
  if (touchIdx < 0) {
    checks.push('BELUM: harga belum menyentuh POI di M1.');
    return fail('Menunggu harga menyentuh POI.');
  }
  checks.push('OK: harga sudah menyentuh POI.');

  // 6) Konfirmasi M1
  const conf = m1ChochConfirm(c1, side, CFG.m1EventLookback, touchIdx);
  if (!conf.ok) {
    checks.push(`BELUM: ${conf.reason}.`);
    return fail(conf.reason);
  }
  checks.push(`OK: ${conf.type} M1 + candle konfirmasi.`);
  const evC = c1[conf.ev.k];

  // 7) Entry & SL
  const entryMid = R2(poiMid);
  const buf = CFG.slBufferAtr * atr1;
  const rawSl = side === 'buy'
    ? Math.min(evC.low, poi.bottom) - buf
    : Math.max(evC.high, poi.top) + buf;
  const refRisk = Math.abs(entryMid - rawSl);
  const market = side === 'buy'
    ? px <= entryMid + CFG.marketTolR * refRisk
    : px >= entryMid - CFG.marketTolR * refRisk;
  const orderType = market ? 'MARKET' : 'LIMIT';
  const entry = R2(market ? px : entryMid);

  if (side === 'buy' ? rawSl >= entry : rawSl <= entry) return fail('SL tidak valid terhadap entry.');
  let sl = R2(rawSl);
  let risk = Math.abs(entry - sl);
  const minRisk = CFG.minSlPips * pip;
  if (risk < minRisk) {
    sl = R2(side === 'buy' ? entry - minRisk : entry + minRisk);
    risk = Math.abs(entry - sl);
  }
  if (risk > CFG.maxSlAtrM1 * atr1) {
    checks.push(`BELUM: SL ${R2(risk)} melebihi ${CFG.maxSlAtrM1} ATR M1.`);
    return fail('SL melebihi batas maksimum ATR M1.');
  }
  checks.push(`OK: SL ${sl}, risiko ${R2(risk)}.`);

  // 8) RR & cek penghalang likuiditas
  const useRr = CFG.rrOptions.includes(Number(rr)) ? Number(rr) : CFG.defaultRr;
  const d = side === 'buy' ? 1 : -1;
  const tp1 = R2(entry + d * risk * useRr);
  const tp2 = R2(entry + d * risk * (useRr + 0.5));
  const tp3 = R2(entry + d * risk * (useRr + 1));
  const sw = getSwings(c5, CFG.swingLen);
  const from5 = c5.length - CFG.blockLookback;
  const levels = (side === 'buy' ? sw.highs : sw.lows).filter(s => s.i >= from5).map(s => s.price);
  const blocker = levels.find(p => (side === 'buy'
    ? p > entry + CFG.blockMinR * risk && p < tp1
    : p < entry - CFG.blockMinR * risk && p > tp1));
  if (blocker !== undefined) {
    checks.push(`BELUM: swing likuiditas di ${R2(blocker)} menghalangi TP 1:${useRr}.`);
    return fail('Target terhalang swing likuiditas (RR tidak tercapai).');
  }
  checks.push(`OK: RR 1:${useRr} tersedia, TP1 ${tp1}.`);

  const order = {
    side, orderType,
    entryPrice: entry, sl, tp1, tp2, tp3,
    risk: R2(risk), rr: useRr,
    expiryTime: now + CFG.orderExpiryMs,
    invalidLevel: R2(side === 'buy' ? anc.low : anc.high),
    zoneId: poi.id,
    reason: `${conf.type} · ${poi.label} di OTE 0.618–0.786 · ${market ? 'eksekusi MARKET' : 'LIMIT di midpoint POI'}`,
  };
  return {
    ok: true, regime, regimeSrc, order, checks,
    zone: { id: poi.id, timeframe: 'M5', type: poi.label, top: poi.top, bottom: poi.bottom, fresh: !!poi.fresh },
  };
}

// ════════════════════════════════════════════════════════════════
// INTRADAY (VWAP) & SWING (S&D H4/D1)
// ════════════════════════════════════════════════════════════════
function calcVWAPSession(c) {
  let pv = 0, v = 0, day = null;
  const out = [];
  for (const x of c) {
    const d = new Date(x.time).toISOString().slice(0, 10);
    if (d !== day) { pv = 0; v = 0; day = d; }
    pv += (x.high + x.low + x.close) / 3;
    v += 1;
    out.push(pv / v);
  }
  return out;
}

function nextSessionEnd(now) {
  const d = new Date(now);
  const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 21, 0, 0));
  if (e.getTime() <= now) e.setUTCDate(e.getUTCDate() + 1);
  return e.getTime();
}

function intradayPlan(bars, ctx) {
  const c15 = toDoc(bars.m15), cH4 = toDoc(bars.h4);
  const atr15 = atrLast(c15);
  if (!c15.length || !(atr15 > 0)) return { ok: false, reason: 'Data M15 belum cukup untuk VWAP/ATR.', checks: [] };
  const regime = detectRegime(cH4);
  const vwap = lastOf(calcVWAPSession(c15));
  const last = lastOf(c15);
  const side = regime === 'trending_up' ? 'buy'
    : regime === 'trending_down' ? 'sell'
    : regime === 'choppy' ? null
    : (last.close > vwap ? 'buy' : 'sell');
  if (!side || !vwap) return { ok: false, regime, reason: 'Belum ada pullback ke VWAP sesi atau regime H4 choppy.', checks: [] };
  const d = side === 'buy' ? 1 : -1;
  const entry = vwap + d * atr15 * 0.1;
  if (side === 'buy' ? entry >= last.close : entry <= last.close) {
    return { ok: false, regime, reason: 'Harga sudah melewati entry VWAP.', checks: [] };
  }
  const sessionEnd = nextSessionEnd(ctx.now);
  const order = buildOrder(side, entry, vwap - d * atr15, [1.5, 2.25, 3], 'LIMIT', sessionEnd, 'vwap_pullback', 2, ctx.dec);
  return { ok: true, order, regime, regimeSrc: `H4 ${regime}`, zone: null, checks: [] };
}

function swingPlan(bars, ctx) {
  const cH4 = toDoc(bars.h4), cD1 = toDoc(bars.d1);
  const atr4 = atrLast(cH4);
  if (!cH4.length || !(atr4 > 0)) return { ok: false, reason: 'Data H4 belum cukup untuk ATR.', checks: [] };
  const regime = detectRegime(cD1);
  const want = regime === 'trending_up' ? 'demand' : regime === 'trending_down' ? 'supply' : null;
  if (!want) return { ok: false, regime, reason: 'Regime D1 belum searah.', checks: [] };
  const zones = [
    ...detectSDAndOB(cH4, 'H4').map(z => updateZoneState(z, cH4)),
    ...detectSDAndOB(cD1, 'D1').map(z => updateZoneState(z, cD1)),
  ];
  const last = lastOf(cH4);
  for (const z of zones) {
    if (z.mitigated || z.type !== want) continue;
    const buy = z.type === 'demand';
    const dist = buy ? last.close - z.top : z.bottom - last.close;
    if (!(dist >= 0 && dist <= 6 * atr4)) continue;
    const entry = buy ? z.top : z.bottom;
    const sl = buy ? z.bottom - 0.5 * atr4 : z.top + 0.5 * atr4;
    return {
      ok: true, regime, regimeSrc: `D1 ${regime}`,
      order: buildOrder(buy ? 'buy' : 'sell', entry, sl, [1.5, 2.25, 3], 'LIMIT', ctx.now + 4 * 86400e3, `htf_${z.type}_${z.pattern}`, 3, ctx.dec),
      zone: { id: z.id, timeframe: z.timeframe, type: `${z.type} ${z.pattern}`, top: z.top, bottom: z.bottom, fresh: !!z.fresh },
      checks: [],
    };
  }
  return { ok: false, regime, reason: 'Belum ada zona S&D/OB H4/D1 searah D1 yang dekat dengan harga.', checks: [] };
}

// ════════════════════════════════════════════════════════════════
// TITIK MASUK SEMUA GAYA MANUAL
// ════════════════════════════════════════════════════════════════
export function generateManualPlan(input, styleName) {
  const {
    m1, m5, m15, h1, h4, d1,
    tickSize = 0.01, now = Date.now(), price: livePrice = 0,
    pip = 0.1, rr = CFG.defaultRr,
  } = input;
  const dec = Math.max(0, Math.round(-Math.log10(tickSize)));
  const ctx = { price: Number(livePrice) || 0, pip, dec, now, rr };

  if (styleName === 'Scalping') return scalpPlan({ m1, m5, h1 }, ctx);
  if (styleName === 'Intraday') return intradayPlan({ m15, h4 }, ctx);
  if (styleName === 'Swing') return swingPlan({ h4, d1 }, ctx);
  return { ok: false, reason: `Gaya tidak dikenal: ${styleName}`, checks: [] };
}

export const SYARAT_MASUK = {
  Scalping: 'Bias H1 (HH/HL atau LH/LL) + BOS/CHoCH M5 searah + retrace ke OTE 0.618–0.786 + POI (OB/FVG/S&D) minimal 2 dari 3 di dalam OTE + CHoCH M1 dan candle konfirmasi (body ≥ 50%). Entry MARKET jika harga sudah di area entry, selain itu LIMIT di midpoint POI. SL di luar POI + buffer 0.2 ATR M1. TP 1:1, 1:1.5, atau 1:2.',
  Intraday: 'Regime H4 searah, pullback ke VWAP sesi M15, limit terisi di VWAP (RR 1:1.5 s/d 1:3)',
  Swing: 'Harga mendekati zona S&D/OB H4/D1 searah regime D1, limit terisi di OB H4 (RR 1:3)',
};

export function buildWatchlist({ m5, m15, h1, h4, d1, price, pip, styleName }) {
  const sets = {
    Scalping: [['H1', h1, 3], ['M5', m5, 2.5]],
    Intraday: [['H1', h1, 3], ['M15', m15, 2]],
    Swing: [['H4', h4, 3], ['D1', d1, 3]],
  }[styleName] || [];
  const step = Number(pip) > 0 ? Number(pip) : 0.1;
  const out = [];
  for (const [tf, bars, maxAtr] of sets) {
    const c = toDoc(bars);
    if (c.length < 25) continue;
    const atr = atrLast(c);
    if (!(atr > 0)) continue;
    const zones = detectSDAndOB(c, tf).map(z => updateZoneState(z, c)).filter(z => !z.mitigated);
    for (const z of zones) {
      const dist = price > z.top ? price - z.top : price < z.bottom ? z.bottom - price : 0;
      if (dist > maxAtr * atr) continue;
      out.push({
        tf,
        tipe: `${z.type === 'supply' ? 'SELL (Supply' : 'BUY (Demand'} ${z.pattern})`,
        bawah: z.bottom, atas: z.top,
        jarak_pip: Math.round(dist / step),
        di_dalam: dist === 0,
        status: z.fresh ? 'fresh' : 'termitigasi sebagian',
      });
    }
  }
  out.sort((a, b) => (a.status === b.status ? a.jarak_pip - b.jarak_pip : a.status === 'fresh' ? -1 : 1));
  return out.slice(0, 4);
}
