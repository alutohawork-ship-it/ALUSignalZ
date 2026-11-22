// lib/bot-ict.js — logika bot ICT dinamis: M15 untuk zona (POI), M5 untuk struktur dan eksekusi limit.
// Fungsi murni tanpa API. Dipakai bot-engine / bot-tick nanti.
//
// Aturan yang sudah disepakati (default):
// - Displacement: body >= 1x ATR M5 dan body >= 60% dari range candle.
// - Sweep (BSL/SSL) opsional: dipakai sebagai penguat, bukan syarat.
// - Killzone London 07-10 UTC dan New York 12-15 UTC: bobot lebih tinggi, tidak memblokir.
// - POI prioritas: OB segar > breaker > FVG. Dipilih yang terdekat di sisi pullback.
// - Entry LIMIT di 40% dari tepi zona yang disentuh lebih dulu (sama dengan Scalping).
// - SL di luar zona + buffer 0.1x ATR M5.
// - TP1 = 1:1 psikologis (toleransi 10% dari risiko), TP2 = swing M5 berikutnya atau 1:2.
// - Limit kedaluwarsa setelah 12 candle M5, atau batal jika struktur M5 berbalik melawan arah.

export const ICT_CFG = {
  atrPeriod: 14, swingL: 2,
  dispBodyAtr: 1.0, dispBodyRatio: 0.6,
  entryFrac: 0.4, slBufferAtr: 0.1,
  limitTtlCandles: 12,
  psychStep: { XAUUSD: 5, BTCUSD: 500 },
  psychTolRatio: 0.10,
  killzones: [[7, 10], [12, 15]],
};

export function atrOf(rows, period = ICT_CFG.atrPeriod) {
  if (!rows || rows.length < period + 1) return 0;
  const tr = i => Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - rows[i - 1].c), Math.abs(rows[i].l - rows[i - 1].c));
  let a = 0;
  for (let i = 1; i <= period; i++) a += tr(i);
  a /= period;
  for (let i = period + 1; i < rows.length; i++) a = (a * (period - 1) + tr(i)) / period;
  return a;
}

export function isDisplacement(c, atr, cfg = ICT_CFG) {
  const body = Math.abs(c.c - c.o), range = c.h - c.l;
  return range > 0 && body >= cfg.dispBodyAtr * atr && body / range >= cfg.dispBodyRatio;
}

export function inKillzone(t, cfg = ICT_CFG) {
  const h = new Date(t).getUTCHours();
  return cfg.killzones.some(([a, b]) => h >= a && h < b);
}

function swings(rows, L) {
  const sh = [], sl = [];
  for (let i = L; i < rows.length - L; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= L; j++) {
      if (rows[i].h <= rows[i - j].h || rows[i].h <= rows[i + j].h) isH = false;
      if (rows[i].l >= rows[i - j].l || rows[i].l >= rows[i + j].l) isL = false;
    }
    if (isH) sh.push({ i, p: rows[i].h, t: rows[i].t });
    if (isL) sl.push({ i, p: rows[i].l, t: rows[i].t });
  }
  return { sh, sl };
}

// Struktur: BOS (searah tren) dan CHoCH (berbalik). trend: 1 bullish, -1 bearish, 0 belum jelas.
export function structure(rows, L = ICT_CFG.swingL) {
  const sw = swings(rows, L);
  const shMap = new Map(sw.sh.map(x => [x.i, x]));
  const slMap = new Map(sw.sl.map(x => [x.i, x]));
  let trend = 0, lastH = null, lastL = null;
  const events = [];
  for (let i = 0; i < rows.length; i++) {
    const ci = i - L;
    if (ci >= 0) { if (shMap.has(ci)) lastH = shMap.get(ci); if (slMap.has(ci)) lastL = slMap.get(ci); }
    const c = rows[i];
    if (lastH && c.c > lastH.p) {
      events.push({ type: trend === -1 ? 'CHoCH' : 'BOS', dir: 1, level: lastH.p, i, t: c.t });
      trend = 1; lastH = null;
    } else if (lastL && c.c < lastL.p) {
      events.push({ type: trend === 1 ? 'CHoCH' : 'BOS', dir: -1, level: lastL.p, i, t: c.t });
      trend = -1; lastL = null;
    }
  }
  return { trend, events, lastEvent: events[events.length - 1] || null, swings: sw };
}

// Order block: candle lawan terakhir sebelum impuls displacement yang menghasilkan BOS/CHoCH dir.
export function findOBs(rows, dir, cfg = ICT_CFG) {
  const atr = atrOf(rows, cfg.atrPeriod);
  const obs = [];
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i];
    const bull = c.c > c.o;
    if ((dir > 0 && !bull) || (dir < 0 && bull)) continue;
    if (!isDisplacement(c, atr, cfg)) continue;
    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
      const p = rows[j];
      const opp = dir > 0 ? p.c < p.o : p.c > p.o;
      if (opp) { obs.push({ kind: 'OB', dir, lo: p.l, hi: p.h, i: j, t: p.t, fresh: true }); break; }
    }
  }
  return obs;
}

// FVG 3-candle: bullish jika high[i-1] < low[i+1].
export function findFVGs(rows, dir) {
  const out = [];
  for (let i = 1; i < rows.length - 1; i++) {
    const a = rows[i - 1], c = rows[i + 1];
    if (dir > 0 && a.h < c.l) out.push({ kind: 'FVG', dir, lo: a.h, hi: c.l, i, t: rows[i].t });
    if (dir < 0 && a.l > c.h) out.push({ kind: 'FVG', dir, lo: c.h, hi: a.l, i, t: rows[i].t });
  }
  // belum terisi: tidak ada candle sesudahnya yang menembus zona
  return out.filter(z => !rows.slice(z.i + 2).some(r => dir > 0 ? r.l <= z.lo : r.h >= z.hi));
}

// Breaker: OB yang ditembus ke sisi lawan; zona berbalik arah.
export function findBreakers(rows, obs) {
  const out = [];
  for (const ob of obs) {
    const after = rows.slice(ob.i + 1);
    const broke = after.find(r => ob.dir > 0 ? r.c < ob.lo : r.c > ob.hi);
    if (broke) out.push({ kind: 'BREAKER', dir: -ob.dir, lo: ob.lo, hi: ob.hi, i: ob.i, t: ob.t });
  }
  return out;
}

// Sweep: wick menembus swing lalu close kembali ke dalam. dir sweep: 1 = sweep SSL (BUY), -1 = sweep BSL (SELL).
export function findSweep(rows, sw, lookback = 30) {
  const n = rows.length, from = Math.max(0, n - lookback);
  for (let i = n - 1; i >= from; i--) {
    const c = rows[i];
    for (const s of sw.sl) if (s.i < i - 1 && c.l < s.p && c.c > s.p) return { dir: 1, level: s.p, i, t: c.t };
    for (const s of sw.sh) if (s.i < i - 1 && c.h > s.p && c.c < s.p) return { dir: -1, level: s.p, i, t: c.t };
  }
  return null;
}

export function psychTp1(entry, sl, dir, sym) {
  const risk = Math.abs(entry - sl);
  const ideal = entry + dir * risk;
  const step = ICT_CFG.psychStep[sym];
  if (!step) return ideal;
  const near = Math.round(ideal / step) * step;
  return Math.abs(near - ideal) <= ICT_CFG.psychTolRatio * risk ? near : ideal;
}

// Rencana entry dari M15 (POI) + M5 (eksekusi). Mengembalikan null bila belum ada setup.
export function planBot({ m15, m5, price, sym = 'XAUUSD', tNow }) {
  const atr5 = atrOf(m5, ICT_CFG.atrPeriod);
  if (!(atr5 > 0) || !(price > 0)) return { status: 'none', reason: 'data belum cukup' };
  const s15 = structure(m15);
  const dir = s15.trend;
  if (dir === 0) return { status: 'none', reason: 'tren M15 belum jelas' };
  const s5 = structure(m5);
  const last5 = s5.lastEvent;
  // Mode dinamis: struktur M5 melawan tren M15 -> pakai arah M5 (reversal), POI dicari di arah baru
  const mode = last5 && last5.dir !== dir ? 'reversal' : 'continuation';
  const pdir = mode === 'reversal' ? last5.dir : dir;

  // Kandidat POI dari M15 searah pdir: OB > breaker > FVG
  const obs = findOBs(m15, pdir);
  const brk = findBreakers(m15, obs);
  const fvg = findFVGs(m15, pdir);
  const cands = [...obs.map(z => ({ ...z, prio: 0 })), ...brk.map(z => ({ ...z, prio: 1 })), ...fvg.map(z => ({ ...z, prio: 2 }))]
    .filter(z => z.dir === pdir)
    .filter(z => (pdir > 0 ? z.hi < price : z.lo > price));   // sisi pullback
  if (!cands.length) return { status: 'none', reason: 'tidak ada POI M15 yang valid', mode };
  cands.sort((a, b) => a.prio - b.prio || Math.abs(price - (a.lo + a.hi) / 2) - Math.abs(price - (b.lo + b.hi) / 2));
  const poi = cands[0];

  const entry = pdir > 0 ? poi.hi - ICT_CFG.entryFrac * (poi.hi - poi.lo) : poi.lo + ICT_CFG.entryFrac * (poi.hi - poi.lo);
  const sl = pdir > 0 ? poi.lo - ICT_CFG.slBufferAtr * atr5 : poi.hi + ICT_CFG.slBufferAtr * atr5;
  const risk = Math.abs(entry - sl);
  if (!(risk > 0)) return { status: 'none', reason: 'risiko nol' };
  const tp1 = psychTp1(entry, sl, pdir, sym);
  const nextSw = pdir > 0
    ? s5.swings.sh.filter(s => s.p > entry + risk).sort((a, b) => a.p - b.p)[0]
    : s5.swings.sl.filter(s => s.p < entry - risk).sort((a, b) => b.p - a.p)[0];
  const tp2 = nextSw ? nextSw.p : entry + pdir * 2 * risk;
  const tp3 = pdir * (entry + pdir * 3 * risk) > pdir * tp2 ? entry + pdir * 3 * risk : tp2 + pdir * risk; // TP3: 1:3 atau lebih jauh dari TP2

  return {
    status: 'limit', mode, dir: pdir === 1 ? 'BUY' : 'SELL',
    poi: { kind: poi.kind, lo: poi.lo, hi: poi.hi, t: poi.t },
    entry, sl, tp1, tp2, tp3,
    killzone: tNow ? inKillzone(tNow) : false,
    placedAt: m5[m5.length - 1].t,
  };
}

// Pembaruan limit yang sudah terpasang: kedaluwarsa atau batal jika struktur M5 berbalik.
export function reviewLimit(plan, m5New, m5Closed) {
  const n = m5New.length;
  if (n >= ICT_CFG.limitTtlCandles) return { action: 'cancel', reason: 'kedaluwarsa (12 candle M5)' };
  const last = structure(m5Closed).lastEvent;
  if (last && last.dir !== (plan.dir === 'BUY' ? 1 : -1) && last.t > plan.placedAt) {
    return { action: 'cancel', reason: 'struktur M5 berbalik sebelum limit terisi' };
  }
  return { action: 'keep' };
}
