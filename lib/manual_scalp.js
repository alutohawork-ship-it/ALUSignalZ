// lib/manual_scalp.js — logika MANUAL: gaya Scalping (tunggal), Intraday, Swing.
// Dipakai HANYA oleh manual. Bot tidak memakai file ini.
//
// Scalping (tunggal): arah dari regime M30 → M15 → M5, zona M5 sebagai acuan. Entry dipilih sesuai kondisi:
//   1) harga di dalam zona M5 searah               → NOW (reaksi zona)
//   2) momentum M5 kuat searah, harga dekat close,
//      dan tidak ada zona dekat                    → NOW (kontinuitas)
//   3) zona M5 searah dalam 2 ATR belum tersentuh  → LIMIT di tepi zona
//   4) tanpa zona dekat                            → LIMIT pullback 0.5 ATR searah
// SL/TP: RR 1:1, 1:2, 1:3 dari jarak entry ke SL (createLimitOrder → buildTargets).
//
// Perubahan v142:
//  - Agresif & Konservatif dihapus. Gaya Scalping tunggal bisa NOW atau LIMIT.
//  - createLimitOrder: status RUNNING untuk order MARKET, PENDING untuk LIMIT.
//  - generateManualPlan menerima harga live (price) untuk menentukan NOW / LIMIT.
//  - Kode Intraday dan Swing tidak diubah.

const toMs = t => (t < 1e12 ? t * 1000 : t);

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

// ADX (nilai ditempatkan di index candle yang benar)
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
  if (!candles || candles.length < 60) return 'neutral';
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
  const strongTrend = adx > 20 && Math.abs(slope) > atr * 0.1;
  if (strongTrend) return slope > 0 ? 'trending_up' : 'trending_down';
  if (adx < 15) return 'choppy';
  return 'neutral';
}

// ── Zone engine ──
// Supply: dari high sampai bawah body. Demand: dari low sampai atas body.
function makeZone(candle, type, timeframe) {
  const bHi = Math.max(candle.open, candle.close), bLo = Math.min(candle.open, candle.close);
  const top = type === 'supply' ? candle.high : bHi;
  const bottom = type === 'supply' ? bLo : candle.low;
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

// 3 candle sesudah pivot adalah candle konfirmasi pivot, tidak dihitung sebagai "menyentuh zona"
export function updateZoneState(zone, candles) {
  const i0 = candles.findIndex(c => c.time === zone.createdTime);
  let touched = false;
  for (let k = i0 + 1; k < candles.length; k++) {
    const c = candles[k], confirm = k - i0 <= 3;
    if (zone.type === 'supply') {
      if (!confirm && c.high >= zone.bottom) touched = true;
      if (c.close > zone.top) return { ...zone, fresh: false, mitigated: true };
    } else {
      if (!confirm && c.low <= zone.top) touched = true;
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

// ════════════════════════════════════════════════════════════════
// SCALPING (tunggal): entry NOW atau LIMIT sesuai kondisi
// ════════════════════════════════════════════════════════════════
const SCALP_CFG = {
  zoneMaxAtr: 2.0,        // zona M5 searah dipakai bila tepinya ≤ 2 ATR dari harga
  zoneNearAtr: 0.5,       // zona dianggap dekat bila ≤ 0.5 ATR (momentum tidak mengejar)
  momentumBodyAtr: 0.6,   // candle momentum M5: body ≥ 0.6 ATR searah
  momentumNearAtr: 0.3,   // harga masih dekat close candle momentum (≤ 0.3 ATR)
  pbAtr: 0.5,             // LIMIT pullback tanpa zona: 0.5 ATR dari harga
  slBufAtr: 0.2,          // buffer SL di luar zona / ekstrem candle
  minRiskAtr: 0.5,        // SL minimal 0.5 ATR (dilebarkan bila lebih sempit)
  maxRiskAtr: 3.0,        // SL maksimal 3 ATR (lebih lebar → setup di-skip, SL tidak diubah)
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

export function generateScalp(candles, regime, ctx) {
  if (!['trending_up', 'trending_down'].includes(regime)) return null;
  const i = candles.length - 1;
  const atr = calcATR(candles, 14)[i];
  if (!atr) return null;
  const last = candles[i];
  const buy = regime === 'trending_up';
  const side = buy ? 'buy' : 'sell';
  const price = ctx.price > 0 ? ctx.price : last.close;
  const buf = SCALP_CFG.slBufAtr * atr;

  const build = (orderType, entry, sl, zoneId, reason) => {
    const intent = {
      ...makeIntent('SCALP', side, entry, sl, SCALP_CFG.limitExpiryMs, zoneId, ctx.maxSpread, 1, reason, ctx.now),
      orderType,
      entryType: orderType === 'MARKET' ? 'market' : 'limit',
    };
    return clampScalpRisk(intent, atr);
  };

  // Jarak harga ke tepi zona searah. 0 = di dalam zona. null = harga sudah menembus zona.
  const edgeDist = z => {
    if (buy) return price < z.bottom ? null : Math.max(0, price - z.top);
    return price > z.top ? null : Math.max(0, z.bottom - price);
  };
  const wantType = buy ? 'demand' : 'supply';
  const zc = (ctx.zones || [])
    .filter(z => !z.mitigated && z.type === wantType && z.timeframe === 'M5')
    .map(z => ({ z, d: edgeDist(z) }))
    .filter(x => x.d !== null && x.d <= SCALP_CFG.zoneMaxAtr * atr)
    .sort((a, b) => (Number(b.z.fresh) - Number(a.z.fresh)) || (a.d - b.d));
  const zz = zc[0] || null;
  const zoneNear = !!zz && zz.d <= SCALP_CFG.zoneNearAtr * atr;

  // 1) Harga di dalam zona searah → NOW (reaksi zona)
  if (zz && zz.d === 0) {
    const z = zz.z;
    const sl = buy ? z.bottom - buf : z.top + buf;
    return build('MARKET', price, sl, z.id,
      `reaksi zona M5 ${z.fresh ? 'fresh' : 'pernah disentuh'} (harga di dalam zona): entry NOW`);
  }

  // 2) Momentum M5 kuat searah, harga masih dekat close, tidak ada zona dekat → NOW (kontinuitas)
  const body = Math.abs(last.close - last.open);
  const strong = (buy ? last.close > last.open : last.close < last.open) && body >= SCALP_CFG.momentumBodyAtr * atr;
  const nearClose = Math.abs(price - last.close) <= SCALP_CFG.momentumNearAtr * atr;
  if (strong && nearClose && !zoneNear) {
    const k3 = candles.slice(-3);
    const ext = buy ? Math.min(...k3.map(x => x.low)) : Math.max(...k3.map(x => x.high));
    const sl = buy ? ext - buf : ext + buf;
    return build('MARKET', price, sl, null, 'momentum M5 searah kuat, kontinuitas: entry NOW');
  }

  // 3) Zona M5 searah dekat yang belum tersentuh → LIMIT di tepi zona
  if (zz) {
    const z = zz.z;
    const entry = buy ? z.top : z.bottom;
    const sl = buy ? z.bottom - buf : z.top + buf;
    return build('LIMIT', entry, sl, z.id,
      `pantulan zona M5 ${z.fresh ? 'fresh' : 'pernah disentuh'}: LIMIT di tepi zona`);
  }

  // 4) Tanpa zona dekat → LIMIT pullback searah tren
  const entry = buy ? price - SCALP_CFG.pbAtr * atr : price + SCALP_CFG.pbAtr * atr;
  const sl = buy ? entry - atr : entry + atr;
  return build('LIMIT', entry, sl, null, 'tanpa zona dekat: LIMIT pullback searah tren');
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
    if (!zone || zone.mitigated) return false;
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
    status: intent.orderType === 'MARKET' ? 'RUNNING' : 'PENDING',
  };
}

// ════════════════════════════════════════════════════════════════
// INTRADAY & SWING
// ════════════════════════════════════════════════════════════════

// VWAP sesi: direset tiap hari UTC. Volume = 1 per candle (proxy), karena data candle aplikasi tidak punya volume.
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

// Akhir sesi intraday: 21:00 UTC berikutnya (sekitar penutupan New York)
export function nextSessionEnd(now) {
  const d = new Date(now);
  const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 21, 0, 0));
  if (e.getTime() <= now) e.setUTCDate(e.getUTCDate() + 1);
  return e.getTime();
}

// Arah dari regime H4. VWAP hanya titik entry pullback.
export function generateIntraday(candles, ctx) {
  const vwap = calcVWAPSession(candles).at(-1);
  const atr = calcATR(candles, 14).at(-1);
  if (!vwap || !atr) return null;
  const last = candles.at(-1);
  const dayOf = c => new Date(toMs(c.time)).toISOString().slice(0, 10);
  const today = dayOf(last);
  if (candles.filter(c => dayOf(c) === today).length < 8) return null; // VWAP baru reset, belum stabil
  const expiry = ctx.sessionEnd - ctx.now;
  if (expiry <= 0) return null;
  const side = ctx.regime === 'trending_up' ? 'buy'
    : ctx.regime === 'trending_down' ? 'sell'
    : ctx.regime === 'choppy' ? null
    : (last.close > vwap ? 'buy' : 'sell');
  if (!side) return null;
  const d = side === 'buy' ? 1 : -1;
  const entry = vwap + d * atr * 0.1;
  if (side === 'buy' ? entry >= last.close : entry <= last.close) return null; // belum ada pullback ke VWAP
  return makeIntent('INTRADAY', side, entry, vwap - d * atr, expiry, null, ctx.maxSpread, 2, 'vwap_pullback', ctx.now);
}

export function generateSwing(candles, zones, ctx) {
  const last = candles[candles.length - 1];
  for (const { z } of pickZones(zones, ['H4', 'D1'], ctx.regime, last, 6 * ctx.atr)) {
    if (z.type === 'demand' && last.close > z.top)
      return makeIntent('SWING', 'buy', z.top, z.bottom - ctx.atr * 0.5, 4 * 86400e3, z.id, ctx.maxSpread, 2, 'htf_demand', ctx.now);
    if (z.type === 'supply' && last.close < z.bottom)
      return makeIntent('SWING', 'sell', z.bottom, z.top + ctx.atr * 0.5, 4 * 86400e3, z.id, ctx.maxSpread, 2, 'htf_supply', ctx.now);
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

export function generateManualPlan({ m5, m15, m30, h1, h4, d1, tickSize, now = Date.now(), price: livePrice }, styleName) {
  const toDoc = bars => (bars || []).map(b => ({ time: toMs(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: 1 }));
  const ctxBase = { now, spread: 0, maxSpread: Infinity, tickSize };

  // ── Scalping (tunggal): regime M30 → M15 → M5, zona M5. Entry NOW atau LIMIT sesuai kondisi ──
  if (styleName === 'Scalping') {
    const c5 = toDoc(m5), c15 = toDoc(m15), c30 = toDoc(m30);
    const atr5 = calcATR(c5, 14).at(-1);
    if (!c5.length || !atr5) return { ok: false, reason: 'Data M5 belum cukup untuk ATR.' };
    const r30 = detectRegime(c30), r15 = detectRegime(c15), r5 = detectRegime(c5);
    const pick = pickRegimeMTF([{ tf: 'M30', regime: r30 }, { tf: 'M15', regime: r15 }, { tf: 'M5', regime: r5 }]);
    if (!pick) return { ok: false, regime: 'choppy', regimeSrc: null,
      reason: `Belum ada trending kuat: M30 ${r30}, M15 ${r15}, M5 ${r5}. Scalping tidak mengambil entry.` };
    const zones = detectZones(c5, 'M5').map(z => updateZoneState(z, c5));
    const ctx = { ...ctxBase, regime: pick.regime, zones, atr: atr5, price: Number(livePrice) || 0 };
    const intent = generateScalp(c5, pick.regime, ctx);
    if (!intent) return { ok: false, regime: pick.regime, regimeSrc: pick.tf,
      reason: `Regime ${pick.tf} trending, tapi belum ada zona M5 searah yang dekat atau momentum yang layak. Tunggu.` };
    if (!qualityGate(intent, ctx)) return { ok: false, regime: pick.regime, regimeSrc: pick.tf,
      reason: 'Setup ditemukan, tapi gagal quality gate.' };
    return { ok: true, order: createLimitOrder(intent, tickSize), regime: pick.regime, regimeSrc: pick.tf,
      zone: zones.find(z => z.id === intent.zoneId) || null };
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
    if (!intent) return { ok: false, regime, reason: 'Belum ada pullback ke VWAP sesi (atau VWAP baru reset / sesi habis / regime H4 choppy).' };
    if (!qualityGate(intent, ctx)) return { ok: false, regime, reason: 'Setup ditemukan, tapi gagal quality gate.' };
    return { ok: true, order: createLimitOrder(intent, tickSize), regime, zone: null };
  }

  // ── Swing: zona H4 & D1, arah D1 ──
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
    if (!intent) return { ok: false, regime, reason: 'Belum ada zona H4/D1 searah D1 yang dekat dengan harga.' };
    if (!qualityGate(intent, ctx)) return { ok: false, regime, reason: 'Setup ditemukan, tapi gagal quality gate.' };
    return { ok: true, order: createLimitOrder(intent, tickSize), regime, zone: zones.find(z => z.id === intent.zoneId) || null };
  }

  return { ok: false, reason: `Gaya tidak dikenal: ${styleName}` };
}

// ════════════════════════════════════════════════════════════════
// WATCHLIST: zona yang sedang dipantau saat belum ada sinyal
// ════════════════════════════════════════════════════════════════
export const SYARAT_MASUK = {
  'Scalping': 'Regime M30/M15/M5 trending. Zona M5 searah: NOW jika harga di dalam zona atau momentum M5 kuat, LIMIT di tepi zona jika belum (SL/TP 1:1 sampai 1:3)',
  'Intraday': 'Regime H4 searah, pullback ke VWAP sesi M15, limit terisi di VWAP (SL/TP 1:1 sampai 1:3)',
  'Swing': 'Harga mendekati zona H4/D1 searah regime D1, limit terisi di tepi zona (SL/TP 1:1 sampai 1:3)',
};

export function buildWatchlist({ m5, m15, m30, h1, h4, d1, price, pip, styleName }) {
  const toDoc = bars => (bars || []).map(b => ({ time: toMs(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: 1 }));
  // [TF, data, batas jarak dalam ATR]
  const sets = {
    'Scalping':    [['M15', m15, 3], ['M5', m5, 2]],
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
