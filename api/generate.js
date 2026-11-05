// smc-signal-engine.js (v3, mode kuat)
// Mode strict (default): hanya setup dengan displacement, pullback OTE 61.8-79%,
// POI konfluensi (FVG+OB atau key level/S&D), dan konfirmasi penolakan.
// Matikan per gaya dengan strict: false di STYLES.
// Mesin sinyal SMC deterministik. Tidak ada Math.random(): input yang sama
// selalu menghasilkan output yang sama.
//
// Input candle (urut lama -> baru): { t, o, h, l, c }
//   t = waktu buka dalam ms (wajib hanya untuk backtest)
// Output: BUY / SELL (entry zone, SL, TP1-3, skor) atau WAIT (no trade).
//
// Pembagian tugas:
//   - GATE WAJIB  : struktur HTF, discount/premium, sweep, CHoCH, POI, konfirmasi,
//                   SL sehat, TP1 minRR. Gagal salah satu = WAIT.
//   - SKOR        : hanya faktor tambahan (displacement, kualitas pullback, kualitas POI,
//                   key level / S&D, kekuatan konfirmasi). Di bawah minScore = WAIT.

// Parameter per gaya trading:
//   minRR        : RR minimum untuk TP1 (dari entry ke target struktur pertama)
//   maxRiskAtr   : batas atas jarak SL, dalam kelipatan ATR HTF
//   minScore     : ambang skor konfluensi tambahan (0-100); di bawah ini = WAIT
//   strict       : true = hanya setup kuat (displacement, OTE 61.8-79%, POI konfluensi,
//                  konfirmasi penolakan). false = gate longgar seperti v2.
// Semua nilai ini belum dikalibrasi dengan data asli. Tentukan lewat backtest.
export const STYLES = {
  Scalping:      { htf: 'M15', ltf: 'M1',  minRR: 1.5, maxRiskAtr: 1.0, minScore: 80, strict: true },
  'Day Trading': { htf: 'M30', ltf: 'M3',  minRR: 1.8, maxRiskAtr: 1.0, minScore: 80, strict: true },
  Intraday:      { htf: 'H1',  ltf: 'M5',  minRR: 2.0, maxRiskAtr: 1.0, minScore: 80, strict: true },
  Swing:         { htf: 'H4',  ltf: 'M15', minRR: 2.5, maxRiskAtr: 1.0, minScore: 85, strict: true },
};

const PIVOT_L = 3;
const PIVOT_R = 3;
const SWEEP_LOOKBACK = 40;   // candle LTF untuk mencari sweep dan CHoCH setelahnya
const TAP_LOOKBACK = 20;     // POI dianggap aktif bila pernah disentuh dalam 20 candle LTF terakhir

// ---------- utilitas ----------
const maxOf = (a, f) => a.reduce((m, x) => Math.max(m, f(x)), -Infinity);
const minOf = (a, f) => a.reduce((m, x) => Math.min(m, f(x)), Infinity);
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;

function decimals(symbol, price) {
  if (symbol.includes('JPY')) return 3;
  if (price >= 100) return 2;   // XAU, BTC, indeks
  if (price >= 10) return 3;    // XAG dan sejenisnya
  return 5;                     // forex
}

function atr(c, n = 14) {
  let sum = 0;
  for (let i = c.length - n; i < c.length; i++) {
    const x = c[i], pc = c[i - 1].c;
    sum += Math.max(x.h - x.l, Math.abs(x.h - pc), Math.abs(x.l - pc));
  }
  return sum / n;
}

// Swing high / low yang sudah terkonfirmasi (butuh PIVOT_R candle sesudahnya)
function pivots(c) {
  const highs = [], lows = [];
  for (let i = PIVOT_L; i < c.length - PIVOT_R; i++) {
    let isHi = true, isLo = true;
    for (let k = 1; k <= PIVOT_L; k++) {
      if (c[i].h <= c[i - k].h) isHi = false;
      if (c[i].l >= c[i - k].l) isLo = false;
    }
    for (let k = 1; k <= PIVOT_R; k++) {
      if (c[i].h <= c[i + k].h) isHi = false;
      if (c[i].l >= c[i + k].l) isLo = false;
    }
    if (isHi) highs.push({ i, p: c[i].h });
    if (isLo) lows.push({ i, p: c[i].l });
  }
  return { highs, lows };
}

// ---------- HTF: struktur, leg, pullback ----------
function structure(c) {
  const NR = why => ({ trend: 'RANGE', why });
  const { highs, lows } = pivots(c);
  if (highs.length < 2 || lows.length < 2) return NR('swing belum cukup');

  const [h1, h2] = highs.slice(-2);
  const [l1, l2] = lows.slice(-2);
  let trend = 'RANGE';
  if (h2.p > h1.p && l2.p > l1.p) trend = 'BULL';
  else if (h2.p < h1.p && l2.p < l1.p) trend = 'BEAR';
  if (trend === 'RANGE') return NR('HH/HL atau LH/LL tidak konsisten');

  // Leg impulsif terakhir: swing awal -> swing ekstrem terakhir
  const ext = trend === 'BULL' ? highs.at(-1) : lows.at(-1);
  const start = (trend === 'BULL' ? lows : highs).filter(p => p.i < ext.i).at(-1);
  if (!start) return NR('leg awal tidak ditemukan');

  const after = c.slice(start.i + 1);
  let lo, hi;
  if (trend === 'BULL') {
    if (minOf(after, x => x.l) < start.p) return NR('HL terakhir sudah ditembus');
    lo = start.p;
    hi = maxOf(after, x => x.h);
  } else {
    if (maxOf(after, x => x.h) > start.p) return NR('LH terakhir sudah ditembus');
    hi = start.p;
    lo = minOf(after, x => x.l);
  }
  if (!(hi > lo)) return NR('leg tidak valid');

  // depth = seberapa dalam harga sudah retrace dari ekstrem leg (0 = di ujung, 1 = di awal leg)
  const price = c.at(-1).c;
  const depth = trend === 'BULL' ? (hi - price) / (hi - lo) : (price - lo) / (hi - lo);
  const A = atr(c);
  const bodies = after.filter(x => (trend === 'BULL' ? x.c > x.o : x.c < x.o));
  const disp = bodies.length ? maxOf(bodies, x => Math.abs(x.c - x.o)) / A : 0;

  return { trend, lo, hi, depth, disp, startIdx: start.i };
}

// Candle berlawanan terakhir sebelum leg (demand untuk bull, supply untuk bear)
function originZone(c, idx, bull) {
  for (let j = idx; j >= Math.max(0, idx - 5); j--) {
    const x = c[j];
    if (bull && x.c < x.o) return { lo: x.c, hi: x.o };
    if (!bull && x.c > x.o) return { lo: x.o, hi: x.c };
  }
  return null;
}

// Key level: kumpulan pivot yang berdekatan (minimal 2 sentuhan)
function keyLevels(c, tol) {
  const { highs, lows } = pivots(c);
  const pts = [...highs, ...lows].map(x => x.p).sort((a, b) => a - b);
  const levels = [];
  let grp = [];
  const flush = () => { if (grp.length >= 2) levels.push(avg(grp)); grp = []; };
  for (const p of pts) {
    if (grp.length && p - grp[0] > tol) flush();
    grp.push(p);
  }
  flush();
  return levels;
}

// ---------- LTF: sweep -> CHoCH -> POI ----------

// Liquidity sweep pada candle j: wick menembus low/high 15 candle sebelumnya, lalu close kembali ke dalam
function sweepAt(c, bull, j) {
  const ref = c.slice(j - 15, j);
  if (bull) {
    const lvl = minOf(ref, x => x.l);
    if (c[j].l < lvl && c[j].c > lvl) return { idx: j, lvl, wick: c[j].l };
  } else {
    const lvl = maxOf(ref, x => x.h);
    if (c[j].h > lvl && c[j].c < lvl) return { idx: j, lvl, wick: c[j].h };
  }
  return null;
}

// Cari sweep dari yang terbaru ke yang lama, ambil yang PERTAMA diikuti CHoCH.
// Sweep kecil di tengah retrace tidak boleh menutupi sweep yang sebenarnya memicu struktur.
function findSweepChoch(c, bull) {
  for (let j = c.length - 1; j >= c.length - SWEEP_LOOKBACK; j--) {
    if (j < 16) break;
    const s = sweepAt(c, bull, j);
    if (!s) continue;
    const ch = findChoch(c, bull, s);
    if (ch) return { sweep: s, choch: ch };
  }
  return null;
}

// CHoCH: close menembus lower high (bull) / higher low (bear) terakhir sebelum sweep
function findChoch(c, bull, s) {
  const { highs, lows } = pivots(c);
  const ref = (bull ? highs : lows)
    .filter(p => p.i < s.idx - PIVOT_R && p.i >= s.idx - SWEEP_LOOKBACK)
    .at(-1);
  if (!ref) return null;
  for (let j = s.idx + 1; j < c.length; j++) {
    if (bull ? c[j].c > ref.p : c[j].c < ref.p) return { idx: j, lvl: ref.p };
  }
  return null;
}

// POI aktif bila harga terakhir (1) belum menembus sisi invalidasi zona dan
// (2) masih dekat zona, maksimal 1 ATR di sisi yang sudah dilewati harga.
// Bila harga sudah lari jauh dari zona, entry di tepi zona tidak realistis.
function poiActive(last, z, bull, atrL) {
  return bull
    ? last.c >= z.lo && last.c <= z.hi + atrL
    : last.c <= z.hi && last.c >= z.lo - atrL;
}

// FVG yang belum tertembus penuh, pernah di-retest dalam TAP_LOOKBACK candle terakhir,
// dan harga belum menutup menembus zona (invalidasi).
// Bila irisan dengan OB berlawanan belum termitigasi, POI = irisan keduanya.
function findFVG(c, bull, choch, sweep, atrL) {
  const n = c.length, last = c[n - 1];
  const lowB = Math.max(sweep.idx + 2, choch.idx - 1);
  for (let cc = lowB; cc <= n - 2; cc++) {
    const a = c[cc - 2];
    const gap = bull
      ? (c[cc].l > a.h ? { lo: a.h, hi: c[cc].l } : null)
      : (c[cc].h < a.l ? { lo: c[cc].h, hi: a.l } : null);
    if (!gap) continue;

    const after = c.slice(cc + 1);
    if (after.some(x => (bull ? x.l < gap.lo : x.h > gap.hi))) continue;     // sudah tertembus penuh
    const touched = c.slice(-TAP_LOOKBACK).some(x => (bull ? x.l <= gap.hi : x.h >= gap.lo));
    if (!touched || !poiActive(last, gap, bull, atrL)) continue;

    // Order block: candle berlawanan terakhir sebelum displacement
    let ob = null;
    for (let j = cc - 1; j >= Math.max(sweep.idx, cc - 6) && !ob; j--) {
      const x = c[j];
      if (bull && x.c < x.o) ob = { lo: x.c, hi: x.o };
      if (!bull && x.c > x.o) ob = { lo: x.o, hi: x.c };
    }
    if (ob) {
      const mitigated = after.some(x => (bull ? x.l < ob.lo : x.h > ob.hi));
      const ovLo = Math.max(gap.lo, ob.lo), ovHi = Math.min(gap.hi, ob.hi);
      if (!mitigated && ovHi > ovLo) return { lo: ovLo, hi: ovHi, type: 'FVG+OB' };
    }
    return { lo: gap.lo, hi: gap.hi, type: 'FVG' };
  }
  return null;
}

// Fallback: order block saja (candle berlawanan + displacement kuat setelahnya)
function findOB(c, bull, choch, atrL) {
  const last = c[c.length - 1];
  for (let j = c.length - 3; j >= Math.max(0, choch.idx - 1); j--) {
    const x = c[j], d = c[j + 1];
    const opp = bull ? x.c < x.o : x.c > x.o;
    const disp = bull
      ? (d.c > d.o && d.c - d.o >= atrL)
      : (d.c < d.o && d.o - d.c >= atrL);
    if (!opp || !disp) continue;

    const z = bull ? { lo: x.c, hi: x.o } : { lo: x.o, hi: x.c };
    if (c.slice(j + 2).some(y => (bull ? y.l < z.lo : y.h > z.hi))) continue;
    const touched = c.slice(-TAP_LOOKBACK).some(y => (bull ? y.l <= z.hi : y.h >= z.lo));
    if (touched && poiActive(last, z, bull, atrL)) return { lo: z.lo, hi: z.hi, type: 'OB' };
  }
  return null;
}

// ---------- analisis utama ----------
export function analyzeSignal({ symbol = '', style, htf, ltf, lang = 'id' }) {
  const hc = htf.slice(-300);
  const lc = ltf.slice(-300);
  const last = lc.at(-1);
  const digits = decimals(symbol, last.c);
  const f = (v, d = digits) => v.toFixed(d);
  const no = (id, en) => ({ signal: 'WAIT', status: 'NO_TRADE', reason: lang === 'en' ? en : id });

  // 1. Struktur HTF wajib jelas. Sideways = tidak trade.
  const H = structure(hc);
  if (H.trend === 'RANGE') {
    return no(
      `Sideways / struktur ${style.htf} belum jelas (${H.why}). Tidak ada trade.`,
      `Sideways / unclear ${style.htf} structure (${H.why}). No trade.`
    );
  }
  const bull = H.trend === 'BULL';
  const pct = Math.round(H.depth * 100);

  // 2. Discount/premium: BUY hanya saat harga sudah retrace >= 50% leg (discount),
  //    SELL hanya saat >= 50% (premium). Batas atas 79% = struktur rawan patah.
  if (H.depth < 0.5) {
    return no(
      `Harga di zona ${bull ? 'premium' : 'discount'} (${pct}% retrace). Entry ${bull ? 'BUY' : 'SELL'} menunggu retrace ke 50%+.`,
      `Price in ${bull ? 'premium' : 'discount'} (${pct}% retrace). ${bull ? 'BUY' : 'SELL'} entries wait for 50%+ retrace.`
    );
  }
  if (H.depth > 0.79) {
    return no(
      `Pullback lebih dari 79%, struktur rawan patah. Skip.`,
      `Pullback deeper than 79%, structure at risk. Skip.`
    );
  }

  const atrL = atr(lc), atrH = atr(hc);

  // 3-4. Liquidity sweep di LTF yang diikuti CHoCH
  const sc = findSweepChoch(lc, bull);
  if (!sc) {
    return no(
      `Belum ada liquidity sweep yang diikuti CHoCH di ${style.ltf}.`,
      `No liquidity sweep followed by a ${style.ltf} CHoCH yet.`
    );
  }
  const { sweep, choch } = sc;

  // 5. POI: FVG (+OB) atau OB saja, pernah disentuh & belum tertembus
  let poi = findFVG(lc, bull, choch, sweep, atrL) || findOB(lc, bull, choch, atrL);
  if (!poi) return no(`Belum ada FVG/OB valid yang aktif.`, `No valid active FVG/OB.`);

  // 6. Candle konfirmasi searah
  const confirmed = bull ? last.c > last.o : last.c < last.o;
  if (!confirmed) return no(`Belum ada candle konfirmasi searah.`, `No confirmation candle yet.`);

  // Konfluensi HTF dan penolakan candle (dipakai gate kuat dan skor)
  const keyLv = keyLevels(hc.slice(-200), 0.3 * atrH);
  const origin = originZone(hc, H.startIdx, bull);
  const overlapsPoi = z => !!z && z.lo <= poi.hi && poi.lo <= z.hi;
  const keyOk = keyLv.some(v => v >= poi.lo - 0.5 * atrH && v <= poi.hi + 0.5 * atrH) || overlapsPoi(origin);
  const wick = bull ? Math.min(last.o, last.c) - last.l : last.h - Math.max(last.o, last.c);
  const rejection = wick / Math.max(last.h - last.l, 1e-12) >= 0.3;
  const ote = H.depth >= 0.618;

  if (style.strict) {
    if (H.disp < 1) {
      return no(`Displacement ${style.htf} lemah (<1 ATR), belum ada momentum yang jelas.`, `Weak ${style.htf} displacement (<1 ATR), no clear momentum.`);
    }
    if (!ote) {
      return no(`Pullback ${pct}% belum masuk OTE 61.8%-79%.`, `Pullback ${pct}% not in the 61.8%-79% OTE zone.`);
    }
    if (poi.type !== 'FVG+OB' && !keyOk) {
      return no(`POI belum jadi zona konfluensi (FVG+OB atau key level/S&D).`, `POI is not a confluence zone (FVG+OB or key level/S&D).`);
    }
    if (!rejection) {
      return no(`Konfirmasi belum kuat (ekor penolakan < 30%).`, `Confirmation not strong (rejection wick < 30%).`);
    }
  }

  // 7. Zona entry maksimal 1.5 ATR, diambil dari sisi yang pertama disentuh harga.
  //    SL tetap memakai batas penuh POI (invalidasi tidak berubah).
  const full = { lo: poi.lo, hi: poi.hi };
  const maxW = 1.5 * atrL;
  if (poi.hi - poi.lo > maxW) {
    // pertahankan sisi zona yang paling dekat dengan harga terakhir
    const nearLo = Math.abs(last.c - full.lo) <= Math.abs(last.c - full.hi);
    poi = nearLo ? { ...poi, hi: full.lo + maxW } : { ...poi, lo: full.hi - maxW };
  }
  const entry = Math.min(Math.max(last.c, poi.lo), poi.hi);
  const buf = 0.2 * atrL;
  const sl = bull ? Math.min(sweep.wick, full.lo) - buf : Math.max(sweep.wick, full.hi) + buf;
  const risk = bull ? entry - sl : sl - entry;
  if (risk < 0.5 * atrL) return no(`SL terlalu sempit, rawan kena noise.`, `Stop too tight, prone to noise.`);
  // Batas atas SL dihitung dari ATR HTF: ATR LTF (M1) terlalu kecil dan noisy untuk jadi patokan
  if (risk > style.maxRiskAtr * atrH) return no(`SL terlalu lebar untuk konteks ${style.htf}, RR tidak sehat.`, `Stop too wide for ${style.htf} context, poor RR.`);

  // 8. TP dari likuiditas/struktur nyata. TP1 wajib memenuhi minRR.
  const rrOf = p => Math.abs(p - entry) / risk;
  const beyond = (p, q) => (bull ? p > q : p < q);
  const ph = pivots(hc.slice(-200)), pl = pivots(lc.slice(-200));
  const pool = bull
    ? [...ph.highs, ...pl.highs].map(x => x.p)
    : [...ph.lows, ...pl.lows].map(x => x.p);
  pool.push(bull ? H.hi : H.lo);
  const levels = pool.filter(p => beyond(p, entry)).sort((a, b) => (bull ? a - b : b - a));

  const tp1 = levels.find(p => rrOf(p) >= style.minRR);
  if (tp1 === undefined) {
    return no(
      `Target struktur terdekat belum memberi RR ≥ ${style.minRR}.`,
      `Nearest structural target gives less than RR ${style.minRR}.`
    );
  }
  const R = r => entry + (bull ? r : -r) * risk;
  const tp2S = levels.find(p => beyond(p, tp1) && rrOf(p) >= rrOf(tp1) + 0.8);
  const tp2 = tp2S ?? R(rrOf(tp1) + 0.8);
  const tp3S = levels.find(p => beyond(p, tp2) && rrOf(p) >= rrOf(tp2) + 0.8);
  const tp3 = tp3S ?? R(rrOf(tp2) + 0.8);

  // 9. Skor konfluensi tambahan (maks 100). Gate wajib di atas tidak dihitung lagi.

  const parts = [
    ['Displacement', H.disp >= 1 ? 20 : 0],
    ['Pullback OTE', ote ? 20 : 12],
    ['Kualitas POI', poi.type === 'FVG+OB' ? 20 : poi.type === 'FVG' ? 12 : 8],
    ['Key level / S&D', keyOk ? 20 : 0],
    ['Konfirmasi kuat', rejection ? 20 : 8],
  ];
  const score = parts.reduce((a, [, p]) => a + p, 0);
  if (score < style.minScore) {
    return no(
      `Konfluensi ${score}/100 di bawah ambang ${style.minScore}. Tidak ada trade (low noise).`,
      `Confluence ${score}/100 below threshold ${style.minScore}. No trade (low noise).`
    );
  }

  const setup = H.disp >= 1 && !ote ? 'MOMENTUM' : 'PULLBACK';
  const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : 'B';
  const rr1 = rrOf(tp1);
  const sweepSide = bull ? 'low' : 'high';

  const reason = lang === 'en'
    ? `${setup} ${bull ? 'BUY' : 'SELL'} | ${style.htf} structure ${bull ? 'HH & HL' : 'LH & LL'}${H.disp >= 1 ? ' with displacement' : ''}, ${pct}% retrace (${bull ? 'discount' : 'premium'}). Liquidity: ${sweepSide} sweep at ${f(sweep.lvl)}, then ${style.ltf} CHoCH at ${f(choch.lvl)}. POI ${poi.type} ${f(poi.lo)}–${f(poi.hi)}${keyOk ? ' + key level / S&D' : ''}. SL behind the sweep + 0.2 ATR buffer. TP1 RR ${rr1.toFixed(2)}; TP2/TP3 follow structure where available, otherwise R projection. Score ${score}/100 (${grade}).`
    : `Setup ${setup} ${bull ? 'BUY' : 'SELL'} | struktur ${style.htf} ${bull ? 'HH & HL' : 'LH & LL'}${H.disp >= 1 ? ' + displacement' : ''}, retrace ${pct}% (${bull ? 'discount' : 'premium'}). Likuiditas: sweep ${sweepSide} di ${f(sweep.lvl)} lalu CHoCH ${style.ltf} di ${f(choch.lvl)}. POI ${poi.type} ${f(poi.lo)}–${f(poi.hi)}${keyOk ? ' + key level / S&D' : ''}. SL di balik sweep + buffer 0.2 ATR. TP1 RR ${rr1.toFixed(2)}; TP2/TP3 mengikuti struktur bila ada, selain itu proyeksi R. Skor ${score}/100 (${grade}).`;

  return {
    signal: bull ? 'BUY' : 'SELL',
    status: 'SIGNAL',
    setup,
    entry_min: f(poi.lo),
    entry_max: f(poi.hi),
    sl: f(sl),
    tp1: f(tp1),
    tp2: f(tp2),
    tp3: f(tp3),
    rr_tp1: rr1.toFixed(2),
    score,
    grade,
    reason,
    raw: { bull, entry, sl, tp1, tp2, tp3, risk },
  };
}

// ---------- backtest walk-forward (tanpa lookahead) ----------
// htfMs = durasi satu candle HTF dalam ms. Candle HTF dianggap valid hanya setelah close.
// Aturan: SL dicek dulu bila SL dan TP1 tersentuh di candle yang sama (konservatif).
export function backtest({ symbol = '', style, htf, ltf, htfMs, warmup = 300, maxHold = 150 }) {
  const list = [];
  let hIdx = -1, busyUntil = -1;

  for (let i = warmup; i < ltf.length - 1; i++) {
    if (i <= busyUntil) continue;
    const t = ltf[i].t;
    while (hIdx + 1 < htf.length && htf[hIdx + 1].t + htfMs <= t) hIdx++;
    if (hIdx < 150) continue;

    const r = analyzeSignal({
      symbol,
      style,
      htf: htf.slice(Math.max(0, hIdx - 299), hIdx + 1),
      ltf: ltf.slice(Math.max(0, i - 299), i + 1),
      lang: 'en',
    });
    if (r.status !== 'SIGNAL') continue;

    const { bull, entry, sl, tp1, risk } = r.raw;
    let R = null, exit = i;
    for (let j = i + 1; j < ltf.length && j <= i + maxHold; j++) {
      const x = ltf[j];
      if (bull ? x.l <= sl : x.h >= sl) { R = -1; exit = j; break; }
      if (bull ? x.h >= tp1 : x.l <= tp1) { R = Math.abs(tp1 - entry) / risk; exit = j; break; }
    }
    if (R === null) {
      exit = Math.min(i + maxHold, ltf.length - 1);
      R = (bull ? ltf[exit].c - entry : entry - ltf[exit].c) / risk;
    }
    list.push({ time: t, signal: r.signal, score: r.score, R: +R.toFixed(2) });
    busyUntil = exit;
  }

  const wins = list.filter(x => x.R > 0).length;
  const sumR = list.reduce((a, x) => a + x.R, 0);
  return {
    trades: list.length,
    wins,
    losses: list.length - wins,
    winrate: list.length ? +(wins / list.length).toFixed(3) : 0,
    expectancyR: list.length ? +(sumR / list.length).toFixed(3) : 0,
    list,
  };
}

// ---------- handler (Vercel) ----------
function resolveStyle(name) {
  const key = Object.keys(STYLES)
    .sort((a, b) => b.length - a.length)           // nama yang lebih panjang dicek dulu
    .find(k => String(name || '').includes(k));
  return key ? { name: key, ...STYLES[key] } : null;
}

// Normalisasi candle. Terima o/h/l/c atau open/high/low/close.
// Harga boleh berupa string desimal (format Hyperliquid); dikonversi ke angka di sini.
function normalizeCandles(arr, label, min = 150) {
  if (!Array.isArray(arr)) return { error: `${label}: data candle tidak ditemukan.` };
  const out = [];
  for (const x of arr) {
    if (!x) continue;
    const o = Number(x.o ?? x.open), h = Number(x.h ?? x.high);
    const l = Number(x.l ?? x.low), c = Number(x.c ?? x.close);
    const t = Number(x.t ?? x.time ?? 0);
    if (![o, h, l, c].every(Number.isFinite) || h < l) continue;
    out.push({ t, o, h, l, c });
  }
  if (out.length < min) {
    return { error: `${label}: hanya ${out.length} candle valid dari ${arr.length} baris, butuh minimal ${min}.` };
  }
  out.sort((a, b) => a.t - b.t);
  return { candles: out.slice(-300) };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const { marketId, tradingStyle, lang = 'id', htf, ltf } = req.body || {};
    const style = resolveStyle(tradingStyle);
    if (!marketId || !style) {
      return res.status(400).json({
        error: 'marketId dan tradingStyle (Scalping / Day Trading / Intraday / Swing) wajib diisi.',
      });
    }
    const H = normalizeCandles(htf, `HTF (${style.htf})`);
    if (H.error) return res.status(400).json({ error: H.error });
    const L = normalizeCandles(ltf, `LTF (${style.ltf})`);
    if (L.error) return res.status(400).json({ error: L.error });

    const symbol = String(marketId).split('|').pop().toUpperCase();
    const { raw, ...out } = analyzeSignal({ symbol, style, htf: H.candles, ltf: L.candles, lang });
    return res.status(200).json({ choices: [{ message: { content: JSON.stringify(out) } }] });
  } catch (error) {
    console.error('SMC Engine Error:', error);
    return res.status(500).json({ error: error.message || 'Terjadi kesalahan pada server.' });
  }
}
