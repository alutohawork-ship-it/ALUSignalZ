// ============================================================
// api/generate.js
// Signal engine: Scalping / Day Trade / Intraday / Swing
// Menerima data OHLC dari frontend (WebSocket stream)
// ============================================================

// ===================== PRESETS =====================
const STYLE_PRESETS = {
  scalping: {
    label: "Scalping (hit & run)",
    tf_entry: "3m",
    tf_bias:  "5m",
    tf_htf:   "15m",
    tf_minutes: 3,
    max_hold_bars: 10,
    killzone: true,
    killzone_tight: true,
    tech_weight: 0.30,
    min_total: 60,
    exit_mode: "single",
    target_tp: 1,
    management: "Hit & run: tutup 100% di TP1. Kalau 30 menit belum kena, tutup manual.",
    cfg: {
      adx_min: 18, pullback_atr: 0.4, swing_lookback: 5, sr_lookback: 30,
      sl_min_atr: 0.8, sl_max_atr: 1.8, tp_r: [1.0, 1.5, 2.0],
      min_score: 50, risk_per_trade: 0.005,
    },
    smc: {
      swing_len: 2, structure_lookback: 60, sweep_lookback: 5,
      ob_lookback: 15, fvg_lookback: 10, displacement_atr: 0.8,
      min_smc_score: 60,
    },
  },
  daytrade: {
    label: "Day Trade (hold 1-2 jam)",
    tf_entry: "5m",
    tf_bias:  "30m",
    tf_htf:   "1h",
    tf_minutes: 5,
    max_hold_bars: 24,
    killzone: true,
    killzone_tight: false,
    tech_weight: 0.40,
    min_total: 60,
    exit_mode: "partial",
    target_tp: 2,
    management: "TP1: tutup 50% & SL ke entry. Sisa target TP2. Maks. hold 2 jam.",
    cfg: {
      adx_min: 20, pullback_atr: 0.35, swing_lookback: 8, sr_lookback: 40,
      sl_min_atr: 1.0, sl_max_atr: 2.2, tp_r: [1.0, 1.5, 2.5],
      min_score: 60, risk_per_trade: 0.0075,
    },
    smc: {
      swing_len: 3, structure_lookback: 80, sweep_lookback: 8,
      ob_lookback: 25, fvg_lookback: 20, min_smc_score: 50,
    },
  },
  intraday: {
    label: "Intraday (hold 3-6 jam)",
    tf_entry: "5m",
    tf_bias:  "1h",
    tf_htf:   "4h",
    tf_minutes: 5,
    max_hold_bars: 60,
    killzone: true,
    killzone_tight: false,
    tech_weight: 0.45,
    min_total: 65,
    exit_mode: "partial",
    target_tp: 2,
    management: "TP1: tutup 40% & SL ke BE. TP2: tutup 40%. Sisa trail sampai EOD.",
    cfg: {
      adx_min: 22, pullback_atr: 0.30, swing_lookback: 10, sr_lookback: 50,
      sl_min_atr: 1.0, sl_max_atr: 2.5, tp_r: [1.5, 2.5, 3.5],
      min_score: 65, risk_per_trade: 0.01,
    },
    smc: {
      swing_len: 4, structure_lookback: 100, sweep_lookback: 10,
      ob_lookback: 30, fvg_lookback: 25, min_smc_score: 55,
    },
  },
  swing: {
    label: "Swing (hold 2-5 hari)",
    tf_entry: "15m",
    tf_bias:  "4h",
    tf_htf:   "1d",
    tf_minutes: 15,
    max_hold_bars: 288,
    killzone: false,
    killzone_tight: false,
    tech_weight: 0.50,
    min_total: 70,
    exit_mode: "partial",
    target_tp: 3,
    management: "TP1: tutup 30% & SL ke BE. TP2: tutup 40%. TP3: trail sisa.",
    cfg: {
      adx_min: 20, pullback_atr: 0.5, swing_lookback: 15, sr_lookback: 80,
      sl_min_atr: 1.5, sl_max_atr: 3.5, tp_r: [2.0, 3.5, 5.0],
      min_score: 70, risk_per_trade: 0.005,
    },
    smc: {
      swing_len: 5, structure_lookback: 150, sweep_lookback: 15,
      ob_lookback: 40, fvg_lookback: 30, min_smc_score: 60,
    },
  },
};

// ===================== INDIKATOR =====================
function ema(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let s = 0;
  for (let i = 0; i < period; i++) s += values[i];
  out[period - 1] = s / period;
  for (let i = period; i < values.length; i++)
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}

function atrSeries(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i];
  out[period] = sum / period;
  for (let i = period + 1; i < candles.length; i++)
    out[i] = (out[i - 1] * (period - 1) + trs[i - 1]) / period;
  return out;
}

function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    d >= 0 ? (g += d) : (l -= d);
  }
  g /= period; l /= period;
  out[period] = 100 - 100 / (1 + g / (l || 1e-9));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (period - 1) + Math.max(d, 0)) / period;
    l = (l * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = 100 - 100 / (1 + g / (l || 1e-9));
  }
  return out;
}

function adxSimple(candles, period = 14) {
  if (candles.length < period * 2 + 2) return { adx: 0, pdi: 0, ndi: 0 };
  const tr = [], pdm = [], ndm = [];
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const smooth = (arr) => {
    let s = 0;
    for (let i = 0; i < period; i++) s += arr[i];
    const out = [s];
    for (let i = period; i < arr.length; i++) {
      s = s - s / period + arr[i];
      out.push(s);
    }
    return out;
  };
  const sTR = smooth(tr), sP = smooth(pdm), sN = smooth(ndm);
  const pdi = sP.map((v, i) => (100 * v) / (sTR[i] || 1e-9));
  const ndi = sN.map((v, i) => (100 * v) / (sTR[i] || 1e-9));
  const dx = pdi.map((v, i) => (100 * Math.abs(v - ndi[i])) / ((v + ndi[i]) || 1e-9));
  let adxVal = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++)
    adxVal = (adxVal * (period - 1) + dx[i]) / period;
  return { adx: adxVal, pdi: pdi.at(-1), ndi: ndi.at(-1) };
}

// ===================== KILLZONE =====================
const KZ = { asia: [0, 3], london: [7, 10], ny_am: [12, 15], ny_pm: [16, 19] };

function inKillzone(nowUtcHour, tight = false) {
  const windows = tight ? [KZ.london, KZ.ny_am] : [KZ.london, KZ.ny_am, KZ.ny_pm, KZ.asia];
  return windows.some(([a, b]) => nowUtcHour >= a && nowUtcHour < b);
}

// ===================== SMC =====================
function findSwings(candles, len = 2) {
  const swings = [];
  for (let i = len; i < candles.length - len; i++) {
    const c = candles[i];
    let isH = true, isL = true;
    for (let j = 1; j <= len; j++) {
      if (candles[i - j].high >= c.high || candles[i + j].high >= c.high) isH = false;
      if (candles[i - j].low  <= c.low  || candles[i + j].low  <= c.low)  isL = false;
    }
    if (isH) swings.push({ type: "H", idx: i, price: c.high, time: c.time });
    if (isL) swings.push({ type: "L", idx: i, price: c.low,  time: c.time });
  }
  return swings;
}

function findBOS_CHoCH(candles, swings, lookback = 80) {
  if (!swings.length) return { bos: null, choch: null };
  const price  = candles.at(-1).close;
  const fromIdx = Math.max(0, candles.length - lookback);
  const highs  = swings.filter(s => s.type === "H" && s.idx >= fromIdx);
  const lows   = swings.filter(s => s.type === "L" && s.idx >= fromIdx);
  const lastH  = highs.at(-1), lastL = lows.at(-1);
  const prevH  = highs.at(-2), prevL = lows.at(-2);

  let bos = null, choch = null;
  if (lastH && price > lastH.price) bos = { dir: "bullish", price: lastH.price, time: lastH.time };
  if (lastL && price < lastL.price) bos = { dir: "bearish", price: lastL.price, time: lastL.time };

  if (prevH && lastH && lastH.price < prevH.price && price > lastH.price)
    choch = { dir: "bullish", price: lastH.price, time: lastH.time };
  if (prevL && lastL && lastL.price > prevL.price && price < lastL.price)
    choch = { dir: "bearish", price: lastL.price, time: lastL.time };

  return { bos, choch };
}

function findLiquiditySweep(candles, swings, lookback = 10, dir = "bullish") {
  const recent = candles.slice(-lookback);
  if (!swings.length) return null;
  const ref = dir === "bullish"
    ? swings.filter(s => s.type === "L").at(-1)
    : swings.filter(s => s.type === "H").at(-1);
  if (!ref) return null;
  for (const c of recent) {
    if (dir === "bullish" && c.low < ref.price && c.close > ref.price) return { level: ref.price, candle: c, dir };
    if (dir === "bearish" && c.high > ref.price && c.close < ref.price) return { level: ref.price, candle: c, dir };
  }
  return null;
}

function findOrderBlock(candles, lookback = 20, dir = "bullish") {
  const slice = candles.slice(-lookback);
  for (let i = slice.length - 1; i > 0; i--) {
    const c = slice[i], prev = slice[i - 1];
    if (dir === "bullish" && prev.close < prev.open && c.close > c.open && c.close > prev.high) {
      return { top: Math.max(prev.open, prev.close), bottom: Math.min(prev.open, prev.close), idx: i - 1, dir };
    }
    if (dir === "bearish" && prev.close > prev.open && c.close < c.open && c.close < prev.low) {
      return { top: Math.max(prev.open, prev.close), bottom: Math.min(prev.open, prev.close), idx: i - 1, dir };
    }
  }
  return null;
}

function findFVG(candles, lookback = 15, dir = "bullish") {
  const slice = candles.slice(-lookback);
  for (let i = 2; i < slice.length; i++) {
    const a = slice[i - 2], c = slice[i];
    if (dir === "bullish" && c.low > a.high) return { top: c.low, bottom: a.high, idx: i - 1, dir };
    if (dir === "bearish" && c.high < a.low) return { top: a.low, bottom: c.high, idx: i - 1, dir };
  }
  return null;
}

function detectDisplacement(candles, atrArr, mult = 0.8) {
  const last = candles.at(-1), prev = candles.at(-2), a = atrArr.at(-1) || 0;
  if (!last || !prev || !a) return null;
  const body = Math.abs(last.close - last.open);
  if (body < a * mult) return null;
  return { dir: last.close > last.open ? "bullish" : "bearish", strength: body / a };
}

function premiumDiscount(candles, swings) {
  if (!swings.length) return null;
  const lastH = swings.filter(s => s.type === "H").at(-1);
  const lastL = swings.filter(s => s.type === "L").at(-1);
  if (!lastH || !lastL) return null;
  const hi = lastH.price, lo = lastL.price, eq = (hi + lo) / 2;
  const price = candles.at(-1).close;
  return { hi, lo, eq, zone: price < eq ? "discount" : "premium", price };
}

// ===================== BIAS / SCORING =====================
function scoreBiasTF(candles, cfg) {
  if (!candles || candles.length < 60) return { dir: "neutral", score: 0, bull: 0, bear: 0 };
  const closes = candles.map(c => c.close);
  const e20 = ema(closes, 20), e50 = ema(closes, 50);
  const i = closes.length - 1, price = closes[i];
  const ema20 = e20[i], ema50 = e50[i], ema50Prev = e50[i - 5] ?? ema50;

  let bull = 0, bear = 0;
  if (price > ema50) bull += 2; else bear += 2;
  if (ema20 > ema50) bull += 1; else bear += 1;
  if (ema50 > ema50Prev) bull += 1; else bear += 1;

  const swings = findSwings(candles, cfg.swing_len);
  const { bos, choch } = findBOS_CHoCH(candles, swings, cfg.structure_lookback);
  if (bos?.dir === "bullish") bull += 2;
  if (bos?.dir === "bearish") bear += 2;
  if (choch?.dir === "bullish") bull += 1;
  if (choch?.dir === "bearish") bear += 1;

  let dir = "neutral";
  if (bull >= 4 && bull > bear) dir = "bullish";
  if (bear >= 4 && bear > bull) dir = "bearish";
  return { dir, score: Math.max(bull, bear), bull, bear };
}

function scoreSMC(candles, dir, cfg, atrArr) {
  let score = 0;
  const reasons = [];

  const swings = findSwings(candles, cfg.swing_len);
  const { bos, choch } = findBOS_CHoCH(candles, swings, cfg.structure_lookback);
  if (bos?.dir === dir)   { score += 15; reasons.push(`BOS ${dir}`); }
  if (choch?.dir === dir) { score += 20; reasons.push(`CHoCH ${dir}`); }

  const sweep = findLiquiditySweep(candles, swings, cfg.sweep_lookback, dir);
  if (sweep) { score += 20; reasons.push(`Liquidity sweep ${dir} @ ${sweep.level}`); }

  const ob = findOrderBlock(candles, cfg.ob_lookback, dir);
  const price = candles.at(-1).close;
  if (ob && price <= ob.top && price >= ob.bottom) { score += 15; reasons.push("Retest Order Block"); }

  const fvg = findFVG(candles, cfg.fvg_lookback, dir);
  if (fvg && price <= fvg.top && price >= fvg.bottom) { score += 10; reasons.push("FVG fill"); }

  const disp = detectDisplacement(candles, atrArr, cfg.displacement_atr);
  if (disp && disp.dir === dir) { score += 15; reasons.push("Displacement"); }

  const pd = premiumDiscount(candles, swings);
  if (pd && ((dir === "bullish" && pd.zone === "discount") || (dir === "bearish" && pd.zone === "premium"))) {
    score += 10; reasons.push(`Zona ${pd.zone}`);
  }

  return { score: Math.min(score, 100), reasons };
}

function scoreTech(candles, dir, cfg) {
  let score = 0;
  const reasons = [];
  const closes = candles.map(c => c.close);
  const i = closes.length - 1;

  const e20 = ema(closes, 20), e50 = ema(closes, 50), price = closes[i];

  if (dir === "bullish" && price > e20[i] && e20[i] > e50[i]) { score += 20; reasons.push("EMA stack bullish"); }
  if (dir === "bearish" && price < e20[i] && e20[i] < e50[i]) { score += 20; reasons.push("EMA stack bearish"); }

  const { adx, pdi, ndi } = adxSimple(candles, 14);
  if (adx >= cfg.adx_min) {
    score += 15;
    if ((dir === "bullish" && pdi > ndi) || (dir === "bearish" && ndi > pdi)) reasons.push(`ADX ${adx.toFixed(1)} trend`);
    else score -= 5;
  }

  const rsiArr = rsiSeries(closes, 14), r = rsiArr[i];
  if (dir === "bullish" && r > 40 && r < 70) { score += 15; reasons.push(`RSI ${r.toFixed(1)}`); }
  if (dir === "bearish" && r < 60 && r > 30) { score += 15; reasons.push(`RSI ${r.toFixed(1)}`); }

  const atrArr = atrSeries(candles, 14), a = atrArr[i] || 0;
  if (a > 0 && Math.abs(price - e20[i]) <= a * cfg.pullback_atr * 2) { score += 20; reasons.push("Pullback ke EMA20"); }

  return { score: Math.max(0, Math.min(score, 100)), reasons };
}

// ===================== SIGNAL GENERATOR =====================
function generateSignal({ entry, bias, htf }, preset, nowUtcHour) {
  const out = { side: null, score: 0, smcScore: 0, techScore: 0, reasons: [], dir: null, entry: null, sl: null, tp: [], atr: null, risk: null, management: null };

  if (!entry?.length || !bias?.length || !htf?.length) { out.reasons.push("Data candle kurang"); return out; }
  if (entry.length < 60 || bias.length < 60 || htf.length < 60) { out.reasons.push("Candle belum cukup (min 60)"); return out; }
  if (preset.killzone && !inKillzone(nowUtcHour, preset.killzone_tight)) { out.reasons.push("Di luar killzone"); return out; }

  const htfBias = scoreBiasTF(htf, preset.smc);
  if (htfBias.dir === "neutral") { out.reasons.push("HTF netral"); return out; }

  const midBias = scoreBiasTF(bias, preset.smc);
  if (midBias.dir !== htfBias.dir) { out.reasons.push(`Bias TF tidak selaras (${midBias.dir} vs ${htfBias.dir})`); return out; }

  const dir = htfBias.dir;
  const atrArr = atrSeries(entry, 14);
  const smc  = scoreSMC(entry, dir, preset.smc, atrArr);
  const tech = scoreTech(entry, dir, preset.cfg);

  const total = (1 - preset.tech_weight) * smc.score + preset.tech_weight * tech.score;
  out.smcScore = Math.round(smc.score);
  out.techScore = Math.round(tech.score);
  out.score = Math.round(total);
  out.reasons = [...smc.reasons, ...tech.reasons];
  out.dir = dir;

  if (smc.score < preset.smc.min_smc_score) { out.reasons.push(`SMC ${smc.score} < ${preset.smc.min_smc_score}`); return out; }
  if (total < preset.min_total) { out.reasons.push(`Total ${total.toFixed(1)} < ${preset.min_total}`); return out; }

  const price = entry.at(-1).close;
  const a = atrArr.at(-1) || 0;
  if (a <= 0) { out.reasons.push("ATR nol"); return out; }

  const swings = findSwings(entry, preset.smc.swing_len);
  const lastSwing = dir === "bullish" ? swings.filter(s => s.type === "L").at(-1) : swings.filter(s => s.type === "H").at(-1);
  let slDist = lastSwing ? Math.abs(price - lastSwing.price) : a * preset.cfg.sl_min_atr;
  slDist = Math.max(slDist, a * preset.cfg.sl_min_atr);
  slDist = Math.min(slDist, a * preset.cfg.sl_max_atr);

  out.side = dir === "bullish" ? "BUY" : "SELL";
  out.entry = price;
  out.sl = dir === "bullish" ? price - slDist : price + slDist;
  out.tp = preset.cfg.tp_r.slice(0, preset.target_tp).map(r => dir === "bullish" ? price + slDist * r : price - slDist * r);
  out.atr = a;
  out.risk = slDist;
  out.management = preset.management;
  return out;
}

// ===================== HANDLER VERCEL =====================
export default async function handler(req, res) {
  // Wajib POST karena kita mengirim payload candle dari frontend
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed, use POST" });
  }

  try {
    const { 
      symbol = "XAUUSD", 
      style = "daytrade", 
      entry = [], 
      bias = [], 
      htf = [] 
    } = req.body || {};

    const preset = STYLE_PRESETS[style];
    if (!preset) {
      return res.status(400).json({ ok: false, error: `Style tidak dikenal: ${style}` });
    }

    // Validasi array candle dari WebSocket frontend
    if (!Array.isArray(entry) || !Array.isArray(bias) || !Array.isArray(htf)) {
      return res.status(400).json({ ok: false, error: "Payload entry, bias, dan htf harus berupa array" });
    }

    const nowUtcHour = new Date().getUTCHours();
    const signal = generateSignal({ entry, bias, htf }, preset, nowUtcHour);

    return res.status(200).json({
      ok: true,
      symbol,
      style,
      label: preset.label,
      timeframes: { entry: preset.tf_entry, bias: preset.tf_bias, htf: preset.tf_htf },
      utcHour: nowUtcHour,
      killzone: preset.killzone ? inKillzone(nowUtcHour, preset.killzone_tight) : "disabled",
      signal,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
