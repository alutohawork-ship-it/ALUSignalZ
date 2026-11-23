// lib/crt-engine.js — engine CRT untuk manual Intraday dan Swing (fungsi murni, tanpa API).
//   Intraday: range H4, sweep M15, konfirmasi CHoCH M5 (12 candle), eksekusi M5
//   Swing:    range D1, sweep H1, konfirmasi CHoCH M15 (24 candle), eksekusi M15
// Aturan (sudah disepakati):
//   - Range dari WICK candle range terakhir yang sudah tutup (RH, RL).
//   - Area WNS = RH/RL ± 0.2 x ATR range (lihat crt-wns.js).
//   - Sweep: wick menembus RH/RL lalu close kembali ke dalam. Sweep dua sisi dilewati.
//   - Entry LIMIT di 40% dari tepi zona yang disentuh lebih dulu (zona = OB/FVG hasil CHoCH).
//   - SL di luar extreme sweep + buffer 0.1 x ATR eksekusi.
//   - TP1 = 1:1 psikologis, TP2 = 1:2, TP3 = sisi range berlawanan.
//   - TP3 diganti TP2 jika harga sudah melewati sisi range berlawanan.
//   - Batal jika candle mid menutup melewati extreme sweep sebelum entry terisi.
//   - Pemantauan: Intraday 8 jam, Swing 1 hari.
import { computeWns, inWns, atrOf } from './crt-wns.js';
import { findOBs, findFVGs, structure, psychTp1 } from './bot-ict.js';
import { checkFill, trackTrade, PIP, nextBlockStart } from './bot-engine.js';

export const CRT_CFG = {
  intraday: { range: 'h4', mid: 'm15', exec: 'm5', chochWindow: 12, monitorMs: 8 * 3600e3, sweepMinRatio: 0.10 },
  swing:    { range: 'd1', mid: 'h1', exec: 'm15', chochWindow: 24, monitorMs: 30 * 24 * 3600e3, sweepMinRatio: 0.10 },
};

// Sweep pada candle mid: tembus RL lalu close di atas RL (BUY), atau tembus RH lalu close di bawah RH (SELL).
// Kedalaman sweep minimal sweepMinRatio dari tinggi range. Sweep dua sisi dilewati.
export function findCrtSweep(mid, wns, cfg) {
  const height = wns.rh - wns.rl;
  const minDepth = cfg.sweepMinRatio * height;
  const hits = [];
  for (let i = 0; i < mid.length; i++) {
    const c = mid[i];
    const below = c.l < wns.rl && c.c > wns.rl && (wns.rl - c.l) >= minDepth;
    const above = c.h > wns.rh && c.c < wns.rh && (c.h - wns.rh) >= minDepth;
    if (below && above) continue;           // dua sisi sekaligus: dilewati
    if (below) hits.push({ dir: 1, extreme: c.l, i, t: c.t });
    if (above) hits.push({ dir: -1, extreme: c.h, i, t: c.t });
  }
  return hits.length ? hits[hits.length - 1] : null;
}

// Konfirmasi CHoCH searah pada candle eksekusi, dalam chochWindow candle setelah sweep.
export function findConfirm(exec, sweep, cfg) {
  const after = exec.filter(c => c.t >= sweep.t);
  const window = after.slice(0, cfg.chochWindow);
  if (window.length < 3) return null;
  const s = structure(exec);
  const ev = s.events.find(e => e.dir === sweep.dir && e.t >= sweep.t && e.t <= (window[window.length - 1].t));
  if (!ev) return null;
  // zona dari OB atau FVG searah sejak sweep
  // Zona boleh terbentuk sedikit sebelum sweep (candle lawan terakhir sebelum impuls CHoCH)
  const step = exec.length > 1 ? exec[1].t - exec[0].t : 0;
  const from = sweep.t - 6 * step;
  const obs = findOBs(exec, sweep.dir).filter(z => z.t >= from);
  const fvg = findFVGs(exec, sweep.dir).filter(z => z.t >= from);
  const zone = [...obs.map(z => ({ ...z, prio: 0 })), ...fvg.map(z => ({ ...z, prio: 1 }))]
    .sort((a, b) => a.prio - b.prio || b.t - a.t)[0];
  if (!zone) return null;
  return { event: ev, zone };
}

// Rencana lengkap. Mengembalikan { status: 'wns'|'limit'|'none'|'cancel', ... }
export function planCrt({ style, range, mid, exec, price, sym = 'XAUUSD', tNow }) {
  const cfg = CRT_CFG[style === 'Swing' ? 'swing' : 'intraday'];
  const wns = computeWns(range);
  if (!wns.ok) return { status: 'none', reason: wns.reason };
  const zoneSide = inWns(price, wns);
  if (!zoneSide) return { status: 'wns', wns, reason: 'harga belum masuk WNS' };

  const sweep = findCrtSweep(mid, wns, cfg);
  if (!sweep) return { status: 'wns', wns, reason: 'menunggu sweep di WNS ' + zoneSide };

  // sweep bisa sudah basi: cek candle mid setelah sweep yang menutup melewati extreme
  const broke = mid.filter(c => c.t > sweep.t).some(c => sweep.dir > 0 ? c.c < sweep.extreme : c.c > sweep.extreme);
  if (broke) return { status: 'cancel', reason: 'mid menutup melewati extreme sweep sebelum entry' };

  const conf = findConfirm(exec, sweep, cfg);
  if (!conf) return { status: 'wns', wns, sweep, reason: 'sweep terjadi, menunggu CHoCH ' + (sweep.dir > 0 ? 'bullish' : 'bearish') };

  const z = conf.zone, dir = sweep.dir;
  const atrE = atrOf(exec);
  const entry = dir > 0 ? z.hi - 0.4 * (z.hi - z.lo) : z.lo + 0.4 * (z.hi - z.lo);
  const sl = dir > 0 ? sweep.extreme - 0.1 * atrE : sweep.extreme + 0.1 * atrE;
  const risk = Math.abs(entry - sl);
  if (!(risk > 0)) return { status: 'none', reason: 'risiko nol' };
  const tp1 = psychTp1(entry, sl, dir, sym);
  const oppSide = dir > 0 ? wns.rh : wns.rl;
  const tp2 = entry + dir * 2 * risk;
  let tp3 = oppSide;
  if (dir * (tp3 - entry) <= dir * (tp2 - entry)) tp3 = tp2;   // TP3 diganti TP2 jika target CRT sudah terlewati
  const passedOpp = dir > 0 ? price >= oppSide : price <= oppSide;
  if (passedOpp) tp3 = tp2;

  return {
    status: 'limit', style, dir: dir > 0 ? 'BUY' : 'SELL', sym,
    wns: { rh: wns.rh, rl: wns.rl, sell: wns.sell, buy: wns.buy },
    sweep: { extreme: sweep.extreme, t: sweep.t },
    zone: { kind: z.kind, lo: z.lo, hi: z.hi },
    entry, sl, tp1, tp2, tp3,
    expiresAt: (tNow || Date.now()) + cfg.monitorMs,
  };
}

// ---- Pelacakan CRT: fill LIMIT lalu TP/SL, BE setelah TP1 (aturan disepakati untuk semua setup) ----
// plan: hasil planCrt status 'limit'. m1: candle M1 tutup. Mengembalikan:
//   { status:'pending' } | { status:'open', filledAt } | { status:'closed', result, exit, pips, hits, outcome }
export function crtTrack(plan, placedAt, m1, state = {}) {
  const dir = plan.dir === 'BUY' ? 1 : -1;
  const base = { side: plan.dir, dir, entry: plan.entry, sl: plan.sl, tp1: plan.tp1, tp2: plan.tp2, tp3: plan.tp3, sym: plan.sym };
  if (!state.filled_at) {
    const f = checkFill({ ...base, placed_at: placedAt }, m1);
    if (!f) return { status: 'pending' };
    return { status: 'open', filledAt: f.filledAt };
  }
  const tr = trackTrade({ ...base, filled_at: state.filled_at, hits: state.hits || {} }, m1);
  if (!tr.done) return { status: 'open', filledAt: state.filled_at, hits: tr.hits };
  return { status: 'closed', result: tr.result, exit: tr.exit, pips: tr.pips, hits: tr.hits, outcome: tr.outcome };
}

// Batas waktu pemantauan: Intraday 8 jam atau ganti hari UTC; Swing minimal 1 bulan.
export function expiryFor(style, fromT) {
  // Swing: pemantauan berjalan terus sampai zona valid, minimal 1 bulan, tidak berhenti saat ganti hari
  if (style === 'Swing') return fromT + 30 * 24 * 3600e3;
  const dur = 8 * 3600e3;
  const d = new Date(fromT);
  const nextDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.min(fromT + dur, nextDay);
}

// Pelacakan manual CRT (aturan baru):
//  - TP1 kena: SL pindah ke entry (BE).
//  - TP2 kena: TIDAK ditutup. Stop dikunci di TP1. Trade lanjut menunggu TP3, stop, atau batas waktu.
//  - TP3 kena: ditutup di TP3.
//  - BE / SL: ditutup. Jika TP2 sudah kena, status tetap TP2.
//  - Batas waktu habis (8 jam / 1 hari / ganti hari UTC): ditutup, dicatat dengan pips terbaik yang tercapai.
// Hasil: { status:'pending' } | { status:'open', filledAt, hitTP1, hitTP2, maxPips }
//      | { status:'closed', result, pips, filledAt, hitTP1, hitTP2, maxPips, exit }
export function crtTrackManual(plan, placedAt, m1, now, expiresAt) {
  const dir = plan.dir === 'BUY' ? 1 : -1;
  const pip = PIP[plan.sym] || 0.1;
  const eps = pip * 0.5;
  const fill = checkFill({ side: plan.dir, dir, entry: plan.entry, sl: plan.sl, sym: plan.sym, placed_at: placedAt }, m1);
  if (!fill) return now >= expiresAt ? { status: 'closed', result: 'EXPIRED', pips: 0, reason: 'limit tidak terisi' } : { status: 'pending' };

  const bars = m1.filter(c => c.t > fill.filledAt && c.t <= Math.min(now, expiresAt)).sort((a, b) => a.t - b.t);
  const px = (p) => (p - plan.entry) * dir / pip;
  let stop = plan.sl, hitTP1 = false, hitTP2 = false, maxPips = 0;
  const reached = (v, pt) => v != null && (dir > 0 ? pt >= v - eps : pt <= v + eps);
  const fin = (result, exit) => ({
    status: 'closed', result, exit, pips: Math.round(px(exit) * 10) / 10,
    filledAt: fill.filledAt, hitTP1, hitTP2, maxPips: Math.round(maxPips * 10) / 10,
  });

  for (const c of bars) {
    const path = c.c >= c.o ? [c.o, c.l, c.h, c.c] : [c.o, c.h, c.l, c.c];
    for (const pt of path) {
      maxPips = Math.max(maxPips, px(pt));
      if (reached(plan.tp3, pt)) return fin('TP3', plan.tp3);
      if (!hitTP2 && reached(plan.tp2, pt)) { hitTP2 = true; }
      if (!hitTP1 && reached(plan.tp1, pt)) { hitTP1 = true; stop = plan.entry; }
      if (hitTP2) stop = plan.tp1; // setelah TP2, stop dikunci di TP1
      const stopHit = dir > 0 ? pt <= stop + eps : pt >= stop - eps;
      if (stopHit) {
        if (hitTP2) return { ...fin('TP2', stop), pips: Math.round(maxPips * 10) / 10 };
        if (hitTP1) return fin('BE', stop);
        return fin('SL', stop);
      }
    }
  }
  if (now >= expiresAt) {
    if (hitTP2) return { ...fin('TP2', bars.length ? bars[bars.length - 1].c : plan.entry), pips: Math.round(maxPips * 10) / 10 };
    if (hitTP1) return { ...fin('TP1', bars.length ? bars[bars.length - 1].c : plan.entry), pips: Math.round(maxPips * 10) / 10 };
    return fin('EXPIRED', bars.length ? bars[bars.length - 1].c : plan.entry);
  }
  return { status: 'open', filledAt: fill.filledAt, hitTP1, hitTP2, maxPips: Math.round(maxPips * 10) / 10 };
}
