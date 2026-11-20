// lib/bot_ea.js — BOT SCALPER gaya EA (aturan pasti, tanpa zona/SMC)
// Tren   : M5 EMA20 > EMA50 dan harga di atas EMA50 (buy) / kebalikannya (sell). M15 EMA50 ikut jika data cukup.
// Pemicu : M1 pullback ke EMA20 lalu candle searah menutup di atas/bawah EMA20 dan menembus high/low candle sebelumnya.
// Filter : ATR M5 minimal, jam sesi (UTC), cooldown antar sinyal.
// Keputusan HANYA dari candle tertutup, jadi hasil stabil di dalam satu candle M1.
// SL     : 1.5 x ATR M1, dijepit antara minSlPips dan maxSlPips.
// TP     : single TP 1:1.5 dari jarak SL (SL 20–30 pip -> TP 30–45 pip). TP1 = TP2 = TP3.
// Kontrak output sama dengan runBotSma lama (dipakai generate.js -> runBot).

export const CFG = {
  emaFast: 20,
  emaSlow: 50,
  slopeLookback: 3,            // EMA20 M5 harus miring searah dibanding 3 candle lalu
  pullbackLookback: 8,         // candle M1 terakhir yang dicek menyentuh EMA20 M1
  rr: 1.5,                     // single TP = 1.5 x jarak SL
  slAtrMult: 1.5,
  minSlPips: 20,               // SL minimal 20 pip -> TP minimal 30 pip
  maxSlPips: 30,               // SL maksimal 30 pip -> TP maksimal 45 pip
  minAtr5Pips: 12,             // ATR M5 di bawah ini dianggap sepi
  sessionFilter: true,
  sessionUtc: { start: 6, end: 21 },
  cooldownMs: 5 * 60e3,
  minM5: 60,
  minM1: 40,
};

const lastSignal = new Map();   // per simbol: { candleT, at, res }

function ema(vals, p) {
  const k = 2 / (p + 1);
  const out = [];
  let e = vals[0];
  for (let i = 0; i < vals.length; i++) {
    e = i === 0 ? vals[0] : vals[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

function atr(bars, period = 14) {
  if (!bars || bars.length < period + 1) return 0;
  const tr = i => Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
  let a = 0;
  for (let i = 1; i <= period; i++) a += tr(i);
  a /= period;
  for (let i = period + 1; i < bars.length; i++) a = (a * (period - 1) + tr(i)) / period;
  return a;
}

export function runBotSma(bars, { price, dec = 2, pip = 0.1, symbol = 'XAUUSD' }) {
  const R = v => Number(Number(v).toFixed(dec));
  const m1 = bars.m1 || [], m5 = bars.m5 || [], m15 = bars.m15 || [];
  const checks = [];
  const standby = (reason, extra = {}) => ({
    ok: false, reason, dirTxt: '-', trigger: null,
    bias: extra.bias || 'NETRAL', trendTxt: extra.trendTxt || '-', structTxt: extra.structTxt || '-',
    checklist: checks.slice(-12),
  });

  if (m5.length < CFG.minM5 || m1.length < CFG.minM1) {
    return standby(`Data belum cukup (M5 ${m5.length}/${CFG.minM5}, M1 ${m1.length}/${CFG.minM1}).`);
  }

  // Stabil dalam satu candle M1: hasil sinyal yang sama dikembalikan lagi
  const candleT = m1[m1.length - 1].t;
  const prevS = lastSignal.get(symbol);
  if (prevS && prevS.candleT === candleT) return prevS.res;

  // 1) Sesi
  if (CFG.sessionFilter) {
    const h = new Date().getUTCHours();
    if (h < CFG.sessionUtc.start || h >= CFG.sessionUtc.end) {
      checks.push(`BELUM: di luar jam sesi (${CFG.sessionUtc.start}:00–${CFG.sessionUtc.end}:00 UTC).`);
      return standby('Di luar jam sesi bot.');
    }
    checks.push('OK: jam sesi aktif.');
  }

  // 2) Volatilitas
  const atr5 = atr(m5), atr1 = atr(m1);
  if (!(atr5 > 0) || !(atr1 > 0)) return standby('ATR belum bisa dihitung.');
  const atr5Pips = atr5 / pip;
  if (atr5Pips < CFG.minAtr5Pips) {
    checks.push(`BELUM: market sepi, ATR M5 ${R(atr5Pips)} pip (minimal ${CFG.minAtr5Pips}).`);
    return standby('Market terlalu sepi untuk scalping.');
  }
  checks.push(`OK: ATR M5 ${R(atr5Pips)} pip.`);

  // 3) Tren M5 (EMA20 vs EMA50), M15 ikut sebagai filter
  const c5 = m5.map(x => x.c);
  const f5 = ema(c5, CFG.emaFast), s5 = ema(c5, CFG.emaSlow);
  const n5 = c5.length - 1;
  const slopeUp = f5[n5] > f5[n5 - CFG.slopeLookback];
  const slopeDn = f5[n5] < f5[n5 - CFG.slopeLookback];
  let dir = 0;
  if (c5[n5] > s5[n5] && f5[n5] > s5[n5] && slopeUp) dir = 1;
  else if (c5[n5] < s5[n5] && f5[n5] < s5[n5] && slopeDn) dir = -1;
  if (!dir) {
    checks.push('BELUM: tren M5 belum jelas (EMA20/EMA50 belum searah dengan harga).');
    return standby('Tren M5 belum jelas, bot menunggu.');
  }
  const bias = dir === 1 ? 'bullish' : 'bearish';
  const trendTxt = `M5 EMA${CFG.emaFast}/${CFG.emaSlow} ${bias}`;
  checks.push(`OK: tren ${trendTxt}.`);

  if (m15.length >= CFG.minM5) {
    const c15 = m15.map(x => x.c);
    const s15 = ema(c15, CFG.emaSlow);
    const n15 = c15.length - 1;
    const ok15 = dir === 1 ? c15[n15] > s15[n15] : c15[n15] < s15[n15];
    if (!ok15) {
      checks.push('BELUM: M15 berlawanan dengan tren M5.');
      return standby('M15 berlawanan dengan tren M5, bot menunggu.', { bias, trendTxt });
    }
    checks.push('OK: M15 searah.');
  }

  // 4) Pemicu M1: pullback ke EMA20 lalu candle searah menutup menembus candle sebelumnya
  const c1 = m1.map(x => x.c);
  const e1 = ema(c1, CFG.emaFast);
  const n1 = m1.length - 1;
  const last = m1[n1], prev = m1[n1 - 1];
  let touched = false;
  for (let i = Math.max(1, n1 - CFG.pullbackLookback); i <= n1; i++) {
    if (dir === 1 ? m1[i].l <= e1[i] : m1[i].h >= e1[i]) { touched = true; break; }
  }
  const closeSide = dir === 1 ? last.c > e1[n1] : last.c < e1[n1];
  const bodyDir = dir === 1 ? last.c > last.o : last.c < last.o;
  const breakPrev = dir === 1 ? last.c > prev.h : last.c < prev.l;
  const structTxt = `M1 pullback EMA${CFG.emaFast}`;
  if (!touched) { checks.push(`BELUM: harga belum pullback ke EMA${CFG.emaFast} M1.`); return standby('Menunggu pullback ke EMA20 M1.', { bias, trendTxt, structTxt }); }
  if (!(closeSide && bodyDir && breakPrev)) {
    checks.push('BELUM: candle konfirmasi M1 belum menutup searah dan menembus candle sebelumnya.');
    return standby('Pullback ada, menunggu candle konfirmasi M1.', { bias, trendTxt, structTxt });
  }
  checks.push('OK: pullback EMA20 M1 + candle konfirmasi searah.');

  // 5) Cooldown
  if (prevS && Date.now() - prevS.at < CFG.cooldownMs) {
    checks.push(`BELUM: cooldown ${Math.ceil((CFG.cooldownMs - (Date.now() - prevS.at)) / 1000)} detik.`);
    return standby('Cooldown setelah sinyal terakhir.', { bias, trendTxt, structTxt });
  }

  // 6) Order: MARKET saat candle tertutup. SL berbasis ATR, TP tetap (TP1 minimal 30 pip)
  const slDist = Math.min(Math.max(CFG.slAtrMult * atr1, CFG.minSlPips * pip), CFG.maxSlPips * pip);
  const entry = R(price);
  const sl = R(entry - dir * slDist);
  const tp = R(entry + dir * slDist * CFG.rr);
  const tps = [tp, tp, tp];   // single TP: TP1 = TP2 = TP3
  const slPips = slDist / pip;
  const rr = Math.abs(tp - entry) / slDist;
  checks.push(`OK: SL ${R(slPips)} pip, TP ${R(slPips * CFG.rr)} pip, RR 1:${R(rr)}.`);

  const dirTxt = dir === 1 ? 'BUY' : 'SELL';
  const trigger = `EA Pullback · ${trendTxt} · ${structTxt} · MARKET`;
  const res = {
    ok: true, dir, dirTxt, role: 'ea', tier: 'EA_PULLBACK', bias, trigger, checklist: checks.slice(-12),
    trendTxt, structTxt,
    entry, sl, tps, rr: R(rr), tpMode: 'EA_SINGLE_RR', orderType: 'MARKET', confidence: 'MEDIUM',
    setup: `Bot EA · ${trigger}`, reason: null,
  };
  lastSignal.set(symbol, { candleT, at: Date.now(), res });
  return res;
}
