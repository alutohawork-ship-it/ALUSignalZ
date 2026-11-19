// lib/manual_scalp.js — logika MANUAL Scalping Agresif & Konservatif (dari dokumen "Alur Sistem").
// Dipakai HANYA oleh manual. Bot tidak memakai file ini.
//
// Mapping TF (sesuai SOP aplikasi):
//   Agresif     : regime dari M15, entry dari M5
//   Konservatif : regime dari H1,  zona M5 (fresh), entry limit di tepi zona
// Semua order LIMIT. SL/TP 1:1, 1:2, 1:3 dihitung dari jarak entry ke SL.
// Catatan: dokumen ini TIDAK memakai trigger M1 (CHoCH/CISD). Itu tidak ada di sini.

// ── Indikator ──
export function calcATR(candles, period = 14) {
  const atr = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return atr;
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
  if (values.length < period) return out;
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

// ADX (perbaikan: nilai ditempatkan di index candle yang benar)
export function calcADX(candles, period = 14) {
  const len = candles.length;
  const adx = new Array(len).fill(null);
  if (len < period * 2 + 1) return adx;

  const tr = new Array(len).fill(0), pDM = new Array(len).fill(0), mDM = new Array(len).fill(0);
  for (let i = 1; i < len; i++) {
    const c = candles[i], p = candles[i - 1];
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    const up = c.high - p.high, down = p.low - c.low;
    pDM[i] = up > down && up > 0 ? up : 0;
    mDM[i] = down > up && down > 0 ? down : 0;
  }

  let trS = 0, pS = 0, mS = 0;
  for (let i = 1; i <= period; i++) { trS += tr[i]; pS += pDM[i]; mS += mDM[i]; }

  const dx = new Array(len).fill(null);
  for (let i = period + 1; i < len; i++) {
    trS = trS - trS / period + tr[i];
    pS = pS - pS / period + pDM[i];
    mS = mS - mS / period + mDM[i];
    const pdi = trS ? (100 * pS) / trS : 0;
    const mdi = trS ? (100 * mS) / trS : 0;
    const s = pdi + mdi;
    dx[i] = s ? (100 * Math.abs(pdi - mdi)) / s : 0;
  }

  const firstDx = period + 1;
  const firstAdx = firstDx + period - 1; // = 2 * period
  let sum = 0;
  for (let i = firstDx; i <= firstAdx; i++) sum += dx[i];
  let a = sum / period;
  adx[firstAdx] = a;
  for (let i = firstAdx + 1; i < len; i++) {
    a = (a * (period - 1) + dx[i]) / period;
    adx[i] = a;
  }
  return adx;
}

// ── Regime ──
export function detectRegime(candles) {
  const closes = candles.map(c => c.close);
  const ema50 = calcEMA(closes, 50);
  const atrArr = calcATR(candles, 14);
  const adxArr = calcADX(candles, 14);
  const i = candles.length - 1;
  const adx = adxArr[i] ?? 0;
  const atr = atrArr[i] ?? 0;
  const emaNow = ema50[i];
  const emaPrev = ema50[i - 5];
  if (emaNow == null || emaPrev == null) return 'neutral';
  const slope = emaNow - emaPrev;
  const strongTrend = adx > 25 && Math.abs(slope) > atr * 0.15;
  if (strongTrend) return slope > 0 ? 'trending_up' : 'trending_down';
  if (adx < 18) return 'choppy';
  return 'neutral';
}

// ── Zone engine ──
function makeZone(candle, type, timeframe) {
  const top = Math.max(candle.high, candle.open, candle.close);
  const bottom = Math.min(candle.low, candle.open, candle.close);
  return { id: `${timeframe}-${type}-${candle.time}`, type, timeframe, top, bottom, createdTime: candle.time, fresh: true, mitigated: false };
}

export function detectZones(candles, timeframe, opts = {}) {
  const { lookback = 100, pivotLen = 3 } = opts;
  const zones = [];
  const start = Math.max(pivotLen, candles.length - lookback);
  for (let i = start; i < candles.length - pivotLen; i++) {
    const c = candles[i];
    const leftHigh = candles.slice(i - pivotLen, i).every(x => x.high <= c.high);
    const rightHigh = candles.slice(i + 1, i + 1 + pivotLen).every(x => x.high <= c.high);
    const leftLow = candles.slice(i - pivotLen, i).every(x => x.low >= c.low);
    const rightLow = candles.slice(i + 1, i + 1 + pivotLen).every(x => x.low >= c.low);
    if (leftHigh && rightHigh) zones.push(makeZone(c, 'supply', timeframe));
    if (leftLow && rightLow) zones.push(makeZone(c, 'demand', timeframe));
  }
  return zones;
}

export function updateZoneState(zone, candles) {
  const after = candles.filter(c => c.time > zone.createdTime);
  let touched = false;
  for (const c of after) {
    if (zone.type === 'supply') {
      if (c.high >= zone.bottom) touched = true;
      if (c.close > zone.top) return { ...zone, fresh: false, mitigated: true };
    }
    if (zone.type === 'demand') {
      if (c.low <= zone.top) touched = true;
      if (c.close < zone.bottom) return { ...zone, fresh: false, mitigated: true };
    }
  }
  return { ...zone, fresh: !touched };
}

// ── Intent, SL/TP, quality gate, order ──
function makeIntent(style, side, entryPrice, sl, expiryMs, zoneId, maxSpread, minRR, reason, now) {
  return { style, side, entryType: 'limit', entryPrice, sl, expiryTime: now + expiryMs, zoneId, maxSpread, minRR, reason };
}

export function buildTargets(side, entry, sl) {
  const risk = Math.abs(entry - sl);
  const dir = side === 'buy' ? 1 : -1;
  return { risk, tp1: entry + dir * risk * 1, tp2: entry + dir * risk * 2, tp3: entry + dir * risk * 3 };
}

export function generateAggressiveScalp(candles, regime, ctx) {
  if (!['trending_up', 'trending_down'].includes(regime)) return null;
  const i = candles.length - 1;
  const atr = calcATR(candles, 14)[i];
  if (!atr) return null;
  const last = candles[i];
  const side = regime === 'trending_up' ? 'buy' : 'sell';
  if (side === 'buy') {
    const entry = last.close - atr * 0.5;
    const sl = entry - atr * 1.0;
    return makeIntent('AGGRESSIVE_SCALP', 'buy', entry, sl, 15 * 60 * 1000, null, ctx.maxSpread, 1, 'momentum_pullback', ctx.now);
  }
  const entry = last.close + atr * 0.5;
  const sl = entry + atr * 1.0;
  return makeIntent('AGGRESSIVE_SCALP', 'sell', entry, sl, 15 * 60 * 1000, null, ctx.maxSpread, 1, 'momentum_pullback', ctx.now);
}

export function generateConservativeScalp(candles, zones, regime, ctx) {
  if (regime === 'choppy') return null;
  const last = candles[candles.length - 1];
  const freshZones = zones.filter(z => z.fresh && !z.mitigated && z.timeframe === 'M5');
  for (const z of freshZones) {
    if (z.type === 'demand' && last.close > z.top) {
      return makeIntent('CONSERVATIVE_SCALP', 'buy', z.top, z.bottom - ctx.atr * 0.2, 2 * 60 * 60 * 1000, z.id, ctx.maxSpread, 2, 'fresh_demand', ctx.now);
    }
    if (z.type === 'supply' && last.close < z.bottom) {
      return makeIntent('CONSERVATIVE_SCALP', 'sell', z.bottom, z.top + ctx.atr * 0.2, 2 * 60 * 60 * 1000, z.id, ctx.maxSpread, 2, 'fresh_supply', ctx.now);
    }
  }
  return null;
}

export function qualityGate(intent, ctx) {
  if (!intent) return false;
  if (ctx.spread > intent.maxSpread) return false;
  if (ctx.regime === 'choppy' && intent.style === 'AGGRESSIVE_SCALP') return false;
  if (intent.side === 'buy' && intent.sl >= intent.entryPrice) return false;
  if (intent.side === 'sell' && intent.sl <= intent.entryPrice) return false;
  const risk = Math.abs(intent.entryPrice - intent.sl);
  if (!(risk > 0)) return false;
  if (intent.zoneId) {
    const zone = ctx.zones.find(z => z.id === intent.zoneId);
    if (!zone || !zone.fresh || zone.mitigated) return false;
  }
  return !!buildTargets(intent.side, intent.entryPrice, intent.sl).tp1;
}

export function createLimitOrder(intent, tickSize) {
  const round = p => Math.round(p / tickSize) * tickSize;
  const t = buildTargets(intent.side, intent.entryPrice, intent.sl);
  return {
    ...intent,
    entryPrice: round(intent.entryPrice),
    sl: round(intent.sl),
    tp1: round(t.tp1), tp2: round(t.tp2), tp3: round(t.tp3),
    risk: t.risk,
    status: 'PENDING',
  };
}

// ── Titik masuk utama untuk manual ──
// input: m5 (candle M5 tertutup), htf (candle M30 untuk Agresif / H1 untuk Konservatif), tickSize
// output: { ok, order, regime, zone } atau { ok:false, reason, regime }
export function generateManualScalp({ m5, htf, tickSize, now = Date.now() }, styleName) {
  const toDoc = bars => bars.map(b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: 0 }));
  const c5 = toDoc(m5), cHtf = toDoc(htf);
  const atr5 = calcATR(c5, 14).at(-1);
  if (!c5.length || !atr5) return { ok: false, reason: 'Data M5 belum cukup untuk menghitung ATR.' };

  const regime = detectRegime(cHtf);
  const isAgr = styleName === 'Scalping';
  const ctx = { now, regime, zones: [], atr: atr5, spread: 0, maxSpread: Infinity, tickSize };

  let intent, zone = null;
  if (isAgr) {
    intent = generateAggressiveScalp(c5, regime, ctx);
    if (!intent) return { ok: false, regime, reason: `Regime M15 ${regime === 'choppy' ? 'choppy' : 'belum trending'}. Agresif tidak mengambil entry.` };
  } else {
    const zones = detectZones(c5, 'M5').map(z => updateZoneState(z, c5));
    ctx.zones = zones;
    intent = generateConservativeScalp(c5, zones, regime, ctx);
    if (!intent) return { ok: false, regime, reason: 'Belum ada zona M5 fresh yang ditembus dan diuji searah.' };
    zone = zones.find(z => z.id === intent.zoneId) || null;
  }

  if (!qualityGate(intent, ctx)) return { ok: false, regime, reason: 'Setup ditemukan, tapi gagal quality gate (SL/risk/zona).' };
  const order = createLimitOrder(intent, tickSize);
  return { ok: true, order, regime, zone };
}

// ════════════════════════════════════════════════════════════════
// INTRADAY & SWING (dari dokumen yang sama)
// ════════════════════════════════════════════════════════════════

// VWAP sesi: direset tiap hari UTC. Volume = 1 per candle (proxy), karena data candle aplikasi tidak punya volume.
export function calcVWAPSession(candles) {
  let pv = 0, v = 0, day = null;
  const out = [];
  for (const c of candles) {
    const d = new Date(c.time).toISOString().slice(0, 10);
    if (d !== day) { pv = 0; v = 0; day = d; }
    pv += (c.high + c.low + c.close) / 3;
    v += 1;
    out.push(pv / v);
  }
  return out;
}

// Akhir sesi intraday: 21:00 UTC berikutnya (sekitar penutupan New York)
export function nextSessionEnd(now) {
  const d = new Date(now);
  const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 21, 0, 0));
  if (e.getTime() <= now) e.setUTCDate(e.getUTCDate() + 1);
  return e.getTime();
}

export function generateIntraday(candles, ctx) {
  const vwap = calcVWAPSession(candles).at(-1);
  const atr = calcATR(candles, 14).at(-1);
  if (!vwap || !atr) return null;
  const last = candles.at(-1);
  const side = last.close > vwap ? 'buy' : 'sell';
  const expiry = ctx.sessionEnd - ctx.now;
  if (expiry <= 0) return null;

  if (side === 'buy') {
    const entry = vwap + atr * 0.1;
    if (entry >= last.close) return null;          // belum ada pullback ke VWAP
    const sl = vwap - atr * 1.0;
    return makeIntent('INTRADAY', 'buy', entry, sl, expiry, null, ctx.maxSpread, 2, 'vwap_pullback', ctx.now);
  }
  const entry = vwap - atr * 0.1;
  if (entry <= last.close) return null;
  const sl = vwap + atr * 1.0;
  return makeIntent('INTRADAY', 'sell', entry, sl, expiry, null, ctx.maxSpread, 2, 'vwap_pullback', ctx.now);
}

export function generateSwing(candles, zones, ctx) {
  const last = candles[candles.length - 1];
  const freshZones = zones.filter(z => z.fresh && !z.mitigated && (z.timeframe === 'H4' || z.timeframe === 'D1'));
  for (const z of freshZones) {
    if (z.type === 'demand' && last.close > z.top) {
      return makeIntent('SWING', 'buy', z.top, z.bottom - ctx.atr * 0.5, 4 * 24 * 60 * 60 * 1000, z.id, ctx.maxSpread, 2, 'htf_demand', ctx.now);
    }
    if (z.type === 'supply' && last.close < z.bottom) {
      return makeIntent('SWING', 'sell', z.bottom, z.top + ctx.atr * 0.5, 4 * 24 * 60 * 60 * 1000, z.id, ctx.maxSpread, 2, 'htf_supply', ctx.now);
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
// TITIK MASUK SEMUA GAYA MANUAL
// input: { m5, m15, m30, h1, h4, d1 } (candle tertutup), tickSize, now
// gaya  : 'Scalping' | 'Day Trading' | 'Intraday' | 'Swing'
// ════════════════════════════════════════════════════════════════
export function pickRegimeMTF(list) {
  for (const x of list) if (x.regime && x.regime.startsWith('trending')) return x;
  return null;
}
const oppositeTrend = (a, b) => (a === 'trending_up' && b === 'trending_down') || (a === 'trending_down' && b === 'trending_up');

export function generateManualPlan({ m5, m15, m30, h1, h4, d1, tickSize, now = Date.now() }, styleName) {
  const toDoc = bars => (bars || []).map(b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: 1 }));
  const ctxBase = { now, spread: 0, maxSpread: Infinity, tickSize };

  // ── Scalping Agresif: regime multi-TF (M30 -> M15 -> M5), entry M5 ──
  if (styleName === 'Scalping') {
    const c5 = toDoc(m5), c15 = toDoc(m15), c30 = toDoc(m30);
    const atr5 = calcATR(c5, 14).at(-1);
    if (!c5.length || !atr5) return { ok: false, reason: 'Data M5 belum cukup untuk ATR.' };
    const r30 = detectRegime(c30), r15 = detectRegime(c15), r5 = detectRegime(c5);
    let pick = pickRegimeMTF([{ tf: 'M30', regime: r30 }, { tf: 'M15', regime: r15 }, { tf: 'M5', regime: r5 }]);
    if (pick && oppositeTrend(pick.regime, r5)) pick = null; // M5 berlawanan: jangan ikut
    if (!pick) return { ok: false, regime: 'choppy', regimeSrc: null,
      reason: `Belum ada trending kuat: M30 ${r30}, M15 ${r15}, M5 ${r5}. Scalping tidak mengambil entry.` };
    const regime = pick.regime;
    const ctx = { ...ctxBase, regime, zones: [], atr: atr5 };
    const intent = generateAggressiveScalp(c5, regime, ctx);
    if (!intent) return { ok: false, regime, regimeSrc: pick.tf, reason: `Regime ${pick.tf} trending, tapi belum ada pola pullback. Tunggu.` };
    if (!qualityGate(intent, ctx)) return { ok: false, regime, regimeSrc: pick.tf, reason: 'Setup ditemukan, tapi gagal quality gate.' };
    return { ok: true, order: createLimitOrder(intent, tickSize), regime, regimeSrc: pick.tf, zone: null };
  }

  // ── Scalping Konservatif: regime multi-TF (H1 -> M30 -> M15), zona M5 ──
  if (styleName === 'Day Trading') {
    const c5 = toDoc(m5), cH1 = toDoc(h1), c15 = toDoc(m15), c30 = toDoc(m30);
    const atr5 = calcATR(c5, 14).at(-1);
    if (!c5.length || !atr5) return { ok: false, reason: 'Data M5 belum cukup untuk ATR.' };
    const rH1 = detectRegime(cH1), r30 = detectRegime(c30), r15 = detectRegime(c15);
    const pick = pickRegimeMTF([{ tf: 'H1', regime: rH1 }, { tf: 'M30', regime: r30 }, { tf: 'M15', regime: r15 }]);
    const regime = pick ? pick.regime : (rH1 === 'choppy' ? null : rH1);
    const regimeSrc = pick ? pick.tf : 'H1';
    if (!regime) return { ok: false, regime: 'choppy', regimeSrc: null,
      reason: `H1, M30, dan M15 choppy (H1 ${rH1}, M30 ${r30}, M15 ${r15}). Konservatif tidak mengambil entry.` };
    const zones = detectZones(c5, 'M5').map(z => updateZoneState(z, c5));
    const ctx = { ...ctxBase, regime, zones, atr: atr5 };
    const intent = generateConservativeScalp(c5, zones, regime, ctx);
    if (!intent) return { ok: false, regime, regimeSrc, reason: 'Belum ada zona M5 fresh yang ditembus dan diuji searah.' };
    if (!qualityGate(intent, ctx)) return { ok: false, regime, regimeSrc, reason: 'Setup ditemukan, tapi gagal quality gate.' };
    return { ok: true, order: createLimitOrder(intent, tickSize), regime, regimeSrc, zone: zones.find(z => z.id === intent.zoneId) || null };
  }

  // ── Intraday: VWAP sesi M15, arah H4 ──
  if (styleName === 'Intraday') {
    const c15 = toDoc(m15), cH4 = toDoc(h4);
    const atr15 = calcATR(c15, 14).at(-1);
    if (!c15.length || !atr15) return { ok: false, reason: 'Data M15 belum cukup untuk VWAP/ATR.' };
    const regime = detectRegime(cH4);
    const sessionEnd = nextSessionEnd(now);
    const ctx = { ...ctxBase, regime, zones: [], atr: atr15, sessionEnd };
    const intent = generateIntraday(c15, ctx);
    if (!intent) return { ok: false, regime, reason: 'Belum ada pullback ke VWAP sesi, atau sesi sudah habis.' };
    if (!qualityGate(intent, ctx)) return { ok: false, regime, reason: 'Setup ditemukan, tapi gagal quality gate.' };
    return { ok: true, order: createLimitOrder(intent, tickSize), regime, zone: null };
  }

  // ── Swing: zona H4 & D1 fresh, arah D1 ──
  if (styleName === 'Swing') {
    const cH4 = toDoc(h4), cD1 = toDoc(d1);
    const atr4 = calcATR(cH4, 14).at(-1);
    if (!cH4.length || !atr4) return { ok: false, reason: 'Data H4 belum cukup untuk ATR.' };
    const regime = detectRegime(cD1);
    const zones = [
      ...detectZones(cH4, 'H4').map(z => updateZoneState(z, cH4)),
      ...detectZones(cD1, 'D1').map(z => updateZoneState(z, cD1)),
    ];
    const ctx = { ...ctxBase, regime, zones, atr: atr4 };
    const intent = generateSwing(cH4, zones, ctx);
    if (!intent) return { ok: false, regime, reason: 'Belum ada zona H4/D1 fresh yang ditembus searah.' };
    if (!qualityGate(intent, ctx)) return { ok: false, regime, reason: 'Setup ditemukan, tapi gagal quality gate.' };
    return { ok: true, order: createLimitOrder(intent, tickSize), regime, zone: zones.find(z => z.id === intent.zoneId) || null };
  }

  return { ok: false, reason: `Gaya tidak dikenal: ${styleName}` };
}

// ════════════════════════════════════════════════════════════════
// WATCHLIST: zona WNS yang sedang dipantau saat belum ada sinyal
// ════════════════════════════════════════════════════════════════
export const SYARAT_MASUK = {
  'Scalping': 'Harga masuk area zona, lalu candle M5 close searah dengan trigger M1 (CHoCH/CISD/Breaker)',
  'Day Trading': 'Harga masuk zona M5, lalu trigger M1 close searah',
  'Intraday': 'Pullback ke VWAP sesi atau zona H1, lalu candle M15 close searah',
  'Swing': 'Harga menyentuh zona H4/D1, lalu candle H4 close searah',
};

export function buildWatchlist({ m5, m15, m30, h1, h4, d1, price, pip, styleName }) {
  const toDoc = bars => (bars || []).map(b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: 1 }));
  // [TF, data, batas jarak dalam ATR]
  const sets = {
    'Scalping':    [['M15', m15, 3], ['M5', m5, 2]],
    'Day Trading': [['M5', m5, 2]],
    'Intraday':    [['H1', h1, 3], ['M15', m15, 2]],
    'Swing':       [['H4', h4, 3], ['D1', d1, 3]],
  }[styleName] || [];
  const out = [];
  for (const [tf, bars, maxAtr] of sets) {
    const c = toDoc(bars);
    if (c.length < 25) continue;
    const atr = calcATR(c, 14).at(-1);
    if (!atr) continue;
    const zones = detectZones(c, tf).map(z => updateZoneState(z, c)).filter(z => !z.mitigated); // fresh ATAU sudah pernah disentuh, belum ditembus
    for (const z of zones) {
      const dist = price > z.top ? price - z.top : price < z.bottom ? z.bottom - price : 0;
      if (dist > maxAtr * atr) continue;
      out.push({
        tf,
        tipe: z.type === 'supply' ? 'SELL (supply)' : 'BUY (demand)',
        bawah: z.bottom,
        atas: z.top,
        jarak_pip: Math.round(dist / pip),
        di_dalam: dist === 0,
        status: z.fresh ? 'fresh' : 'pernah disentuh',
      });
    }
  }
  out.sort((a, b) => (a.status === b.status ? a.jarak_pip - b.jarak_pip : a.status === 'fresh' ? -1 : 1));
  return out.slice(0, 3);
}
