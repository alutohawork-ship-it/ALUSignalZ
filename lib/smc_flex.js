// lib/smc_flex.js — ENGINE SMC FLEKSIBEL (mandiri): bot & manual Scalping
// Alur dinamis, mengikuti struktur yang sedang berjalan:
//   1) Bias: H1 (fallback M15). Dealing range: buy hanya discount, sell hanya premium.
//   2) Jika harga menyentuh POI H1/M15 searah bias -> CHoCH M5 -> BOS M5 -> entry di FVG/OB displacement.
//   3) Jika tidak ada POI cocok: pakai CHoCH M5 + BOS M5 terbaru yang masih berjalan.
//   4) Jika entry sudah tertinggal: kontinuitas (BOS searah terbaru -> retest FVG).
//   5) Tanpa CHoCH dan BOS yang valid: diam (STANDBY). Tidak ada entry tanpa struktur.
// Entry: LIMIT retest FVG/OB, atau MARKET jika harga di dalam zona dan CHoCH M1 terkonfirmasi.

export const CFG = {
  swingLen: 3,            // fractal M5/H1
  m1SwingLen: 2,
  atrPeriod: 14,
  poiMaxAtr: 2.0,         // POI maksimal 2 ATR dari harga
  touchLookback: 40,      // POI harus disentuh dalam 40 candle M5
  chochMaxAge: 40,        // CHoCH M5 berlaku 40 candle
  bosMaxAge: 30,          // BOS M5 berlaku 30 candle
  sdImpulseAtr: 1.5,
  sdBaseAtr: 0.85,
  slBufferAtr: 0.3,
  minSlPips: 20,
  maxRiskAtr: 4,
  maxLimitPips: 40,
  m1Lookback: 20,
  limitExpiryMs: 20 * 60e3,
  marketExpiryMs: 10 * 60e3,
  // Band TP (pip): risiko < lowMax -> 1:1.5 / 1:2.5 / 1:4 ; mid -> 1:1 / 1:2 / 1:3 ; di atas mid ditolak
  bands: {
    XAUUSD: { lowMax: 40, midMax: 50 },
    BTCUSD: { lowMax: 80, midMax: 100 },
  },
  defaultBand: { lowMax: 40, midMax: 50 },
};

// ─────────────── utilitas ───────────────
const toMs = t => { const n = Number(t); if (!Number.isFinite(n) || n <= 0) return Date.now(); return n < 1e12 ? n * 1000 : n; };
export const toDoc = bars => (bars || []).map(b => ({ time: toMs(b.t), open: b.o, high: b.h, low: b.l, close: b.c }));
const lastOf = a => (a && a.length ? a[a.length - 1] : undefined);
const R = (p, d) => Number(Number(p).toFixed(d));

export function atr(c, period = CFG.atrPeriod) {
  if (!c || c.length < period + 1) return 0;
  let a = 0;
  for (let i = 1; i <= period; i++) a += trOf(c, i);
  a /= period;
  for (let i = period + 1; i < c.length; i++) a = (a * (period - 1) + trOf(c, i)) / period;
  return a;
}
const trOf = (c, i) => Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));

// ─────────────── struktur pasar ───────────────
function swings(c, n) {
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

// Anchor leg: untuk buy = swing low sebelum break, plus high tertinggi sesudahnya
function anchorFor(c, side, idx, k) {
  if (side === 'buy') {
    let hi = -Infinity, hiI = idx;
    for (let j = idx; j <= k; j++) if (c[j].high > hi) { hi = c[j].high; hiI = j; }
    return { low: c[idx].low, lowIdx: idx, high: hi, highIdx: hiI };
  }
  let lo = Infinity, loI = idx;
  for (let j = idx; j <= k; j++) if (c[j].low < lo) { lo = c[j].low; loI = j; }
  return { high: c[idx].high, highIdx: idx, low: lo, lowIdx: loI };
}

export function structure(c, n = CFG.swingLen) {
  const { highs, lows } = swings(c, n);
  const events = [];
  let trend = 0, brokenHi = -1, brokenLo = -1;
  for (let k = 2 * n + 1; k < c.length; k++) {
    const hs = highs.filter(h => h.i + n < k), ls = lows.filter(l => l.i + n < k);
    const h1 = lastOf(hs), h0 = hs.length >= 2 ? hs[hs.length - 2] : undefined;
    const l1 = lastOf(ls), l0 = ls.length >= 2 ? ls[ls.length - 2] : undefined;
    if (h1 && h0 && l1 && l0) {
      if (h1.price > h0.price && l1.price > l0.price) trend = 1;
      else if (h1.price < h0.price && l1.price < l0.price) trend = -1;
    }
    const close = c[k].close;
    if (h1 && h1.i !== brokenHi && close > h1.price) {
      const lb = lastOf(ls.filter(l => l.i < h1.i));
      events.push({ k, side: 'buy', type: trend === -1 ? 'CHoCH_BULL' : 'BOS_BULL', level: h1.price, anchor: lb ? anchorFor(c, 'buy', lb.i, k) : null });
      brokenHi = h1.i; trend = 1;
    }
    if (l1 && l1.i !== brokenLo && close < l1.price) {
      const hb = lastOf(hs.filter(h => h.i < l1.i));
      events.push({ k, side: 'sell', type: trend === 1 ? 'CHoCH_BEAR' : 'BOS_BEAR', level: l1.price, anchor: hb ? anchorFor(c, 'sell', hb.i, k) : null });
      brokenLo = l1.i; trend = -1;
    }
  }
  return { trend, events };
}

// ─────────────── zona S&D (base + impulse) ───────────────
function sdZones(c, tf) {
  const out = [];
  const a = atr(c);
  if (!(a > 0) || c.length < 25) return out;
  for (let i = Math.max(20, c.length - 100); i < c.length - 1; i++) {
    const x = c[i];
    if (Math.abs(x.close - x.open) < CFG.sdImpulseAtr * a) continue;
    const bullImp = x.close > x.open;
    let baseStart = i, cnt = 0;
    for (let b = i - 1; b >= Math.max(1, i - 3); b--) {
      if (Math.abs(c[b].close - c[b].open) <= CFG.sdBaseAtr * a) { baseStart = b; cnt++; } else break;
    }
    if (!cnt) continue;
    const base = c.slice(baseStart, i);
    const top = Math.max(...base.map(v => v.high)), bottom = Math.min(...base.map(v => v.low));
    let touched = false, mitigated = false;
    for (let k = i + 1; k < c.length; k++) {
      if (bullImp) {
        if (c[k].low <= top) touched = true;
        if (c[k].close < bottom) { mitigated = true; break; }
      } else {
        if (c[k].high >= bottom) touched = true;
        if (c[k].close > top) { mitigated = true; break; }
      }
    }
    if (!mitigated) out.push({ tf, type: bullImp ? 'demand' : 'supply', top, bottom, fresh: !touched, id: `${tf}-${bullImp ? 'D' : 'S'}-${x.time}` });
  }
  return out;
}

// ─────────────── dealing range ───────────────
export function dealingRange(c, tf) {
  const s = structure(c);
  if (s.trend === 0) return null;
  const side = s.trend === 1 ? 'buy' : 'sell';
  const ev = lastOf(s.events.filter(e => e.side === side && e.anchor));
  if (!ev) return null;
  const a = ev.anchor;
  let lo, hi;
  if (side === 'buy') { lo = a.low; hi = -Infinity; for (let j = a.lowIdx; j < c.length; j++) hi = Math.max(hi, c[j].high); }
  else { hi = a.high; lo = Infinity; for (let j = a.highIdx; j < c.length; j++) lo = Math.min(lo, c[j].low); }
  if (!(hi > lo)) return null;
  return { side, tf, lo, hi, eq: (lo + hi) / 2 };
}

// ─────────────── helper M5 ───────────────
// POI H1/M15 searah bias, di sisi dealing range yang benar, terdekat dan fresh diutamakan
function htfPois(h1, m15, side, px, rng) {
  const want = side === 'buy' ? 'demand' : 'supply';
  const out = [];
  for (const [tf, c] of [['H1', h1], ['M15', m15]]) {
    if (c.length < 25) continue;
    const a = atr(c);
    if (!(a > 0)) continue;
    for (const z of sdZones(c, tf)) {
      if (z.type !== want) continue;
      if (rng && !(side === 'buy' ? z.top <= rng.eq : z.bottom >= rng.eq)) continue;
      const dist = side === 'buy' ? Math.max(0, px - z.top) : Math.max(0, z.bottom - px);
      if (dist > CFG.poiMaxAtr * a) continue;
      out.push({ ...z, dist });
    }
  }
  return out.sort((x, y) => (Number(y.fresh) - Number(x.fresh)) || (x.dist - y.dist));
}

function touchIdx(c5, side, z) {
  for (let j = Math.max(0, c5.length - CFG.touchLookback); j < c5.length; j++) {
    if (side === 'buy' ? c5[j].low <= z.top : c5[j].high >= z.bottom) return j;
  }
  return -1;
}

// CHoCH M5 terbaru searah (dan belum berbalik) -> BOS searah sesudahnya
function chochBos(c5, side, minIdx) {
  const s = structure(c5);
  const n = c5.length - 1;
  const cT = side === 'buy' ? 'CHoCH_BULL' : 'CHoCH_BEAR';
  const bT = side === 'buy' ? 'BOS_BULL' : 'BOS_BEAR';
  const opp = side === 'buy' ? 'sell' : 'buy';
  const choch = lastOf(s.events.filter(e => e.type === cT && e.anchor && e.k >= minIdx && n - e.k <= CFG.chochMaxAge));
  if (!choch) return { ok: false, reason: 'belum ada CHoCH M5 searah' };
  const after = s.events.filter(e => e.k > choch.k);
  if (after.some(e => e.side === opp)) return { ok: false, reason: 'struktur M5 berbalik setelah CHoCH' };
  const bos = after.find(e => e.type === bT && n - e.k <= CFG.bosMaxAge);
  if (!bos) return { ok: false, reason: 'CHoCH ada, menunggu BOS M5 searah' };
  return { ok: true, choch, bos };
}

// BOS searah terbaru (untuk kontinuitas bila entry awal sudah tertinggal)
function latestContinuation(c5, side) {
  const s = structure(c5);
  const n = c5.length - 1;
  const bT = side === 'buy' ? 'BOS_BULL' : 'BOS_BEAR';
  const opp = side === 'buy' ? 'sell' : 'buy';
  const bos = lastOf(s.events.filter(e => e.type === bT && n - e.k <= CFG.bosMaxAge));
  if (!bos) return null;
  if (s.events.some(e => e.k > bos.k && e.side === opp)) return null;
  return bos;
}

function fvgBetween(c5, side, from, to) {
  let best = null;
  for (let i = Math.max(2, from); i <= Math.min(to, c5.length - 1); i++) {
    const a = c5[i - 2], b = c5[i];
    let bottom, top;
    if (side === 'buy' && a.high < b.low) { bottom = a.high; top = b.low; }
    else if (side === 'sell' && a.low > b.high) { bottom = b.high; top = a.low; }
    else continue;
    let filled = false;
    for (let j = i + 1; j < c5.length; j++) {
      if (side === 'buy' ? c5[j].low <= bottom : c5[j].high >= top) { filled = true; break; }
    }
    if (!filled) best = { bottom, top, kind: 'FVG' };
  }
  return best;
}

function obBefore(c5, side, k, from) {
  for (let j = k - 1; j >= Math.max(0, from); j--) {
    const x = c5[j];
    const opposite = side === 'buy' ? x.close < x.open : x.close > x.open;
    if (!opposite) continue;
    for (let q = j + 1; q < c5.length; q++) {
      if (side === 'buy' ? c5[q].close < x.low : c5[q].close > x.high) return null;
    }
    return { bottom: x.low, top: x.high, kind: 'OB' };
  }
  return null;
}

function m1Confirm(c1, side) {
  const s = structure(c1, CFG.m1SwingLen);
  const want = side === 'buy' ? 'CHoCH_BULL' : 'CHoCH_BEAR';
  const ev = lastOf(s.events.filter(e => e.type === want && c1.length - 1 - e.k <= CFG.m1Lookback));
  if (!ev) return null;
  const cl = lastOf(c1), range = cl.high - cl.low;
  if (!(range > 0) || c1.length - 1 <= ev.k) return null;
  const body = Math.abs(cl.close - cl.open);
  const dirOk = side === 'buy' ? cl.close > cl.open : cl.close < cl.open;
  const breakOk = side === 'buy' ? cl.close > c1[ev.k].high : cl.close < c1[ev.k].low;
  return dirOk && breakOk && body >= 0.5 * range ? ev : null;
}

// Entry dari zona (FVG atau OB) yang terbentuk oleh displacement sequence
function entryFrom(c5, c1, side, seq, px, pip, dec) {
  const buy = side === 'buy';
  let z = fvgBetween(c5, side, seq.choch.k - 2, seq.bos.k);
  if (!z) z = obBefore(c5, side, seq.choch.k, seq.choch.k - 10);
  if (!z) return { ok: false, reason: 'tidak ada FVG/OB displacement' };
  if (buy ? px < z.bottom : px > z.top) return { ok: false, reason: `harga sudah menembus ${z.kind}, entry tertinggal` };
  const inside = buy ? px <= z.top : px >= z.bottom;
  if (inside) {
    if (!m1Confirm(c1, side)) return { ok: false, reason: `harga di ${z.kind}, menunggu konfirmasi M1` };
    return { ok: true, zone: z, kind: z.kind, orderType: 'MARKET', entry: R(px, dec), confirmed: true };
  }
  const mid = R((z.top + z.bottom) / 2, dec);
  if (Math.abs(mid - px) / pip > CFG.maxLimitPips) return { ok: false, reason: `LIMIT ${z.kind} lebih dari ${CFG.maxLimitPips} pip, tertinggal` };
  return { ok: true, zone: z, kind: z.kind, orderType: 'LIMIT', entry: mid, confirmed: false };
}

function bandFor(symbol, riskPips) {
  const b = CFG.bands[symbol] || CFG.defaultBand;
  if (riskPips <= 0) return null;
  if (riskPips < b.lowMax) return { name: 'LOW_RISK', mults: [1.5, 2.5, 4], rr: 1.5 };
  if (riskPips <= b.midMax) return { name: 'MID_RISK', mults: [1, 2, 3], rr: 1 };
  return null;
}

function orderFrom(side, seq, ent, atr5, pip, dec, symbol) {
  const buy = side === 'buy';
  const z = ent.zone, entry = R(ent.entry, dec);
  const buf = CFG.slBufferAtr * atr5, minRisk = CFG.minSlPips * pip, maxRisk = CFG.maxRiskAtr * atr5;
  const cands = [buy ? z.bottom - buf : z.top + buf, buy ? seq.choch.anchor.low - buf : seq.choch.anchor.high + buf];
  let best = null;
  for (const raw of cands) {
    let sl = R(raw, dec);
    if (buy ? sl >= entry : sl <= entry) continue;
    let risk = Math.abs(entry - sl);
    if (risk < minRisk) { sl = R(buy ? entry - minRisk : entry + minRisk, dec); risk = Math.abs(entry - sl); }
    if (risk > maxRisk) continue;
    if (!best || risk < best.risk) best = { sl, risk };
  }
  if (!best) return { ok: false, reason: 'SL tidak valid atau risiko melebihi batas' };
  const riskPips = best.risk / pip;
  const band = bandFor(symbol, riskPips);
  if (!band) return { ok: false, reason: `risiko ${R(riskPips, 1)} pip di luar batas TP` };
  const d = buy ? 1 : -1;
  return {
    ok: true, entry, sl: best.sl, risk: best.risk, riskPips, band,
    tps: band.mults.map(m => R(entry + d * best.risk * m, dec)),
    invalid: R(buy ? seq.choch.anchor.low : seq.choch.anchor.high, dec),
  };
}

// ─────────────── ENGINE UTAMA ───────────────
// bars: { m1, m5, m15, h1 } (candle sudah tertutup, format {t,o,h,l,c})
// ctx : { price, dec, pip, now, symbol }
export function flexScalpPlan(bars, ctx) {
  const { price: px, dec, pip, now, symbol } = ctx;
  const checks = [];
  const fail = (reason, extra = {}) => ({ ok: false, reason, checks, bias: 'NETRAL', regime: 'choppy', regimeSrc: '-', ...extra });

  const c1 = toDoc(bars.m1), c5 = toDoc(bars.m5), h1 = toDoc(bars.h1), m15 = toDoc(bars.m15);
  if (c5.length < 30 || c1.length < 20) return fail('Data M1/M5 belum cukup.');
  const atr5 = atr(c5), atr1 = atr(c1);
  if (!(atr5 > 0) || !(atr1 > 0)) return fail('ATR belum bisa dihitung.');

  // 1) Bias
  let biasTf = 'H1', biasC = h1, hb = structure(h1);
  if (hb.trend === 0 && m15.length >= 30) { biasTf = 'M15'; biasC = m15; hb = structure(m15); }
  if (hb.trend === 0) return fail('Bias H1 dan M15 belum searah.');
  const side = hb.trend === 1 ? 'buy' : 'sell';
  const bias = side === 'buy' ? 'bullish' : 'bearish';
  const regime = side === 'buy' ? 'trending_up' : 'trending_down';
  const regimeSrc = `${biasTf} MS (${side === 'buy' ? 'HH/HL' : 'LH/LL'})`;
  checks.push(`OK: bias ${biasTf} ${bias}.`);

  // 2) Dealing range
  const rng = dealingRange(biasC, biasTf);
  if (rng) {
    const where = side === 'buy' ? (px < rng.eq ? 'discount' : 'premium') : (px > rng.eq ? 'premium' : 'discount');
    checks.push(`OK: dealing range ${biasTf} ${R(rng.lo, dec)}–${R(rng.hi, dec)}, EQ ${R(rng.eq, dec)}, harga di ${where}.`);
  }
  const sideOk = p => !rng || (side === 'buy' ? p <= rng.eq : p >= rng.eq);

  const build = (seq, label, poiTag) => {
    const ent = entryFrom(c5, c1, side, seq, px, pip, dec);
    if (!ent.ok) return { ok: false, reason: ent.reason };
    if (!sideOk(ent.entry)) return { ok: false, reason: 'entry di area berlawanan dealing range' };
    const o = orderFrom(side, seq, ent, atr5, pip, dec, symbol);
    if (!o.ok) return { ok: false, reason: o.reason };
    const reason = `Flex · ${label} · CHoCH M5 · BOS M5 · ${ent.kind} ${ent.confirmed ? 'konfirmasi M1' : 'LIMIT retest'}`;
    return {
      ok: true, role: 'main', side, confirmed: ent.confirmed, regime, regimeSrc, bias, biasTf, checks,
      order: {
        side, role: 'main', orderType: ent.orderType, entryPrice: o.entry, sl: o.sl,
        tp1: o.tps[0], tp2: o.tps[1], tp3: o.tps[2], risk: R(o.risk, dec), riskPips: R(o.riskPips, 1),
        rr: o.band.rr, tpMode: o.band.name, invalidLevel: o.invalid,
        expiryTime: now + (ent.confirmed ? CFG.marketExpiryMs : CFG.limitExpiryMs),
        zoneId: `${poiTag}-${side}-${seq.choch.k}`, confirmed: ent.confirmed, reason,
      },
      zone: { id: `${poiTag}-${side}-${seq.choch.k}`, timeframe: 'M5', type: `${ent.kind} displacement`, top: ent.zone.top, bottom: ent.zone.bottom, fresh: true },
    };
  };

  // 3) POI H1/M15 yang disentuh -> CHoCH M5 -> BOS M5
  for (const z of htfPois(h1, m15, side, px, rng).slice(0, 3)) {
    const t = touchIdx(c5, side, z);
    if (t < 0) { checks.push(`BELUM: POI ${z.tf} ${z.type} belum disentuh.`); continue; }
    const seq = chochBos(c5, side, t - 3);
    if (!seq.ok) { checks.push(`BELUM: ${seq.reason}.`); continue; }
    const r = build(seq, `POI ${z.tf} ${z.type}`, 'POI');
    if (r.ok) { checks.push(`OK: POI ${z.tf} ${z.type} disentuh, CHoCH & BOS M5 valid.`); return r; }
    checks.push(`BELUM: ${r.reason}.`);
  }

  // 4) Struktur berjalan: CHoCH M5 + BOS M5 terbaru searah bias
  const seqRun = chochBos(c5, side, c5.length - 1 - CFG.chochMaxAge);
  if (seqRun.ok) {
    const r = build(seqRun, 'Struktur berjalan', 'RUN');
    if (r.ok) { checks.push('OK: mengikuti struktur M5 yang berjalan.'); return r; }
    checks.push(`BELUM: ${r.reason}.`);

    // 5) Kontinuitas: entry tertinggal -> BOS searah terbaru -> retest FVG
    const cont = latestContinuation(c5, side);
    if (cont && cont.k > seqRun.bos.k) {
      const seqC = { choch: seqRun.choch, bos: cont };
      const rc = build(seqC, 'Kontinuitas', 'CONT');
      if (rc.ok) { checks.push('OK: kontinuitas, BOS searah terbaru.'); return rc; }
      checks.push(`BELUM: kontinuitas, ${rc.reason}.`);
    }
  } else {
    checks.push(`BELUM: ${seqRun.reason}.`);
  }

  return fail('Belum ada struktur valid. Bot diam sampai CHoCH dan BOS M5 searah muncul.', { checks, bias, regime, regimeSrc, biasTf });
}

// ─────────────── BOT ───────────────
// Output sama dengan kontrak lama (dipakai generate.js → runBot)
export function runBotSma(bars, { price, dec = 2, pip = 0.1, symbol = 'XAUUSD' }) {
  const p = flexScalpPlan(bars, { price, dec, pip, now: Date.now(), symbol });
  if (!p.ok) {
    return {
      ok: false, reason: p.reason, dirTxt: '-', trigger: null,
      bias: p.bias || 'NETRAL', trendTxt: p.biasTf ? `${p.biasTf} ${p.bias}` : '-',
      structTxt: p.regimeSrc || '-', checklist: (p.checks || []).slice(-12),
    };
  }
  const o = p.order;
  const tier = p.order.reason.includes('Kontinuitas') ? 'KONTINUITAS'
    : p.order.reason.includes('Struktur berjalan') ? 'STRUKTUR' : 'FLEKSIBEL';
  return {
    ok: true, dir: o.side === 'buy' ? 1 : -1, dirTxt: o.side === 'buy' ? 'BUY' : 'SELL',
    role: o.role, tier, bias: p.bias, trigger: o.reason, checklist: p.checks,
    trendTxt: `${p.biasTf} ${p.bias}`, structTxt: p.regimeSrc,
    entry: o.entryPrice, sl: o.sl, tps: [o.tp1, o.tp2, o.tp3], rr: o.rr, tpMode: o.tpMode,
    orderType: o.orderType, confidence: p.confirmed ? 'HIGH' : 'MEDIUM',
    setup: `Bot ${tier} · ${o.reason}`, reason: null,
  };
}

// ════════════════════════════════════════════════════════════════
// PULLBACK LIMIT (manual Scalping & bot)
// Syarat: H1 searah (dan M15 tidak berlawanan). Impuls M5 searah (BOS terbaru, belum berbalik).
// Entry: LIMIT di zona retrace OTE 0.618–0.786 dari impuls, pada FVG M1/M3/M5 yang belum terisi
//        (jika tidak ada, LIMIT di tengah OTE). MARKET jika harga sudah di zona dan CHoCH M1 terkonfirmasi.
// SL di bawah awal impuls (buy) / di atas awal impuls (sell). Invalid jika harga menembus awal impuls.
// ════════════════════════════════════════════════════════════════
function aggDoc(c, n) {
  const out = [];
  for (let i = 0; i + n <= c.length; i += n) {
    const g = c.slice(i, i + n);
    out.push({ time: g[0].time, open: g[0].open, high: Math.max(...g.map(x => x.high)), low: Math.min(...g.map(x => x.low)), close: g[g.length - 1].close });
  }
  return out;
}

function unfilledFvgs(c, side, from) {
  const out = [];
  for (let i = Math.max(2, from); i < c.length; i++) {
    const a = c[i - 2], b = c[i];
    let bottom, top;
    if (side === 'buy' && a.high < b.low) { bottom = a.high; top = b.low; }
    else if (side === 'sell' && a.low > b.high) { bottom = b.high; top = a.low; }
    else continue;
    let filled = false;
    for (let j = i + 1; j < c.length; j++) {
      if (side === 'buy' ? c[j].low <= bottom : c[j].high >= top) { filled = true; break; }
    }
    if (!filled) out.push({ bottom, top, kind: 'FVG' });
  }
  return out;
}

export function pullbackPlan(bars, ctx) {
  const { price: px, dec, pip, now, symbol } = ctx;
  const R = v => Number(Number(v).toFixed(dec));
  const checks = [];
  const fail = reason => ({ ok: false, reason, checks, bias: 'NETRAL', regime: 'choppy', regimeSrc: '-' });

  const c1 = toDoc(bars.m1), c5 = toDoc(bars.m5), h1 = toDoc(bars.h1), m15 = toDoc(bars.m15);
  if (c1.length < 30 || c5.length < 30 || h1.length < 20) return fail('Data M1/M5/H1 belum cukup.');
  const c3 = aggDoc(c1, 3);
  const atr5 = atr(c5), atr1 = atr(c1);
  if (!(atr5 > 0) || !(atr1 > 0)) return fail('ATR belum bisa dihitung.');

  // 1) H1 searah, M15 tidak boleh berlawanan
  const th = structure(h1).trend;
  const tm = m15.length >= 30 ? structure(m15).trend : 0;
  if (th === 0) return fail('H1 belum searah.');
  if (tm !== 0 && tm !== th) return fail('M15 berlawanan dengan H1.');
  const side = th === 1 ? 'buy' : 'sell';
  const bias = side === 'buy' ? 'bullish' : 'bearish';
  const regime = side === 'buy' ? 'trending_up' : 'trending_down';
  const regimeSrc = `H1 MS${tm === th ? ' + M15 searah' : ''} · PULLBACK`;
  checks.push(`OK: H1 ${bias}${tm === th ? ' dan M15 searah' : ''}.`);

  // 2) Dealing range (M15, fallback H1)
  const rng = dealingRange(m15.length >= 30 ? m15 : h1, m15.length >= 30 ? 'M15' : 'H1');

  // 3) Impuls M5 searah terbaru, belum berbalik
  const s5 = structure(c5);
  const n5 = c5.length - 1;
  const bT = side === 'buy' ? 'BOS_BULL' : 'BOS_BEAR';
  const imp = lastOf(s5.events.filter(e => e.type === bT && e.anchor && n5 - e.k <= CFG.bosMaxAge));
  if (!imp) return fail('belum ada BOS M5 searah sebagai impuls.');
  if (s5.events.some(e => e.k > imp.k && e.side !== side)) return fail('struktur M5 sudah berbalik setelah impuls.');

  // Kaki impuls: awal = swing sebelum BOS, akhir = ekstrem searah sesudahnya
  let lo, hi, awalIdx, ekIdx;
  if (side === 'buy') {
    awalIdx = imp.anchor.lowIdx; lo = imp.anchor.low; hi = -Infinity; ekIdx = awalIdx;
    for (let j = awalIdx; j < c5.length; j++) if (c5[j].high > hi) { hi = c5[j].high; ekIdx = j; }
  } else {
    awalIdx = imp.anchor.highIdx; hi = imp.anchor.high; lo = Infinity; ekIdx = awalIdx;
    for (let j = awalIdx; j < c5.length; j++) if (c5[j].low < lo) { lo = c5[j].low; ekIdx = j; }
  }
  const L = hi - lo;
  if (!(L >= atr5)) return fail('impuls M5 terlalu kecil (kurang dari 1 ATR).');
  if (side === 'buy' ? px < lo : px > hi) return fail('struktur impuls sudah tertembus.');
  const depth = side === 'buy' ? (hi - px) / L : (px - lo) / L;
  if (depth > 0.886) return fail('pullback terlalu dalam (lebih dari 0.886).');
  checks.push(`OK: impuls M5 ${R(lo)}–${R(hi)} (${R(L / pip)} pip).`);

  // 4) Zona OTE 0.618–0.786
  const zOte = side === 'buy'
    ? { bottom: hi - L * 0.786, top: hi - L * 0.618 }
    : { bottom: lo + L * 0.618, top: lo + L * 0.786 };
  const oteMid = (zOte.top + zOte.bottom) / 2;
  if (rng && (side === 'buy' ? oteMid > rng.eq : oteMid < rng.eq)) {
    return fail('zona pullback berada di area berlawanan dealing range.');
  }

  // 5) FVG M1/M3/M5 yang belum terisi dan bersinggungan dengan OTE; pilih yang paling dekat mid OTE
  let zone = null;
  const from = Math.max(0, awalIdx);
  for (const [tf, c] of [['M1', c1], ['M3', c3], ['M5', c5]]) {
    const fromIdx = tf === 'M1' ? Math.max(0, c.length - 60) : tf === 'M3' ? Math.max(0, c.length - 40) : Math.max(0, c.length - 40);
    for (const f of unfilledFvgs(c, side, fromIdx)) {
      if (f.top < zOte.bottom || f.bottom > zOte.top) continue;
      const cand = { tf, bottom: Math.max(f.bottom, zOte.bottom), top: Math.min(f.top, zOte.top), kind: `FVG ${tf}` };
      const d = Math.abs((cand.top + cand.bottom) / 2 - oteMid);
      if (!zone || d < zone.d) zone = { ...cand, d };
    }
  }
  if (!zone) zone = { tf: 'M5', bottom: zOte.bottom, top: zOte.top, kind: 'OTE', d: 0 };
  checks.push(`OK: zona pullback ${zone.kind} ${R(zone.bottom)}–${R(zone.top)}.`);

  // 6) Posisi harga terhadap zona -> LIMIT atau MARKET
  const mid = R((zone.top + zone.bottom) / 2);
  const above = side === 'buy' ? px > zone.top : px < zone.bottom;
  const below = side === 'buy' ? px < zone.bottom : px > zone.top;
  if (below) return fail('harga sudah masuk di bawah zona OTE (lebih dari 0.786), menunggu struktur baru.');
  let ent;
  if (above) {
    ent = { zone, kind: zone.kind, orderType: 'LIMIT', entry: mid, confirmed: false };
  } else {
    const m1 = m1Confirm(c1, side);
    if (m1) ent = { zone, kind: zone.kind, orderType: 'MARKET', entry: R(px), confirmed: true };
    else {
      if (side === 'buy' ? mid >= px : mid <= px) return fail('harga di zona, menunggu konfirmasi M1.');
      ent = { zone, kind: zone.kind, orderType: 'LIMIT', entry: mid, confirmed: false };
    }
  }
  if (Math.abs(ent.entry - px) / pip > CFG.maxLimitPips) return fail(`LIMIT pullback ${R(Math.abs(ent.entry - px) / pip)} pip dari harga, terlalu jauh.`);
  checks.push(ent.confirmed ? 'OK: konfirmasi M1 terpenuhi, eksekusi MARKET.' : `OK: LIMIT pullback di ${mid}.`);

  // 7) SL dan TP (reuse fungsi order)
  const anchorObj = side === 'buy' ? { low: lo, high: hi } : { high: hi, low: lo };
  const o = orderFrom(side, { choch: { anchor: anchorObj } }, ent, atr5, pip, dec, symbol);
  if (!o.ok) return fail(o.reason);
  checks.push(`OK: SL ${o.sl}, risiko ${R(o.riskPips)} pip, band ${o.band.name}, TP1 ${o.tps[0]}.`);

  const id = `PB-${side}-${ekIdx}`;
  return {
    ok: true, role: 'pullback', side, confirmed: ent.confirmed, regime, regimeSrc, bias, biasTf: 'H1', checks,
    order: {
      side, role: 'pullback', orderType: ent.orderType,
      entryPrice: o.entry, sl: o.sl, tp1: o.tps[0], tp2: o.tps[1], tp3: o.tps[2],
      risk: R(o.risk), riskPips: R(o.riskPips), rr: o.band.rr, tpMode: o.band.name,
      invalidLevel: o.invalid,
      expiryTime: now + (ent.confirmed ? CFG.marketExpiryMs : CFG.limitExpiryMs),
      zoneId: id, confirmed: ent.confirmed,
      reason: `Pullback · Impuls M5 BOS · ${zone.kind} OTE 0.618–0.786 · ${ent.confirmed ? 'konfirmasi M1' : 'LIMIT'}`,
    },
    zone: { id, timeframe: zone.tf, type: `${zone.kind} pullback`, top: R(zone.top), bottom: R(zone.bottom), fresh: true },
  };
}
