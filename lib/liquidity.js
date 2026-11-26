// lib/liquidity.js — Liquidity Pool Engine (nol data eksternal)
// BSL = buy-side liquidity (di atas harga). SSL = sell-side (di bawah harga).

function atrOf(rows, n = 14) {
  if (!Array.isArray(rows) || rows.length < n + 1) return 0;
  const tr = i => Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - rows[i-1].c), Math.abs(rows[i].l - rows[i-1].c));
  let a = 0; for (let i = 1; i <= n; i++) a += tr(i); a /= n;
  for (let i = n + 1; i < rows.length; i++) a = (a * (n - 1) + tr(i)) / n;
  return a;
}

function swings(rows) {
  const hs = [], ls = [];
  for (let i = 2; i < rows.length - 2; i++) {
    let ih = true, il = true;
    for (let j = i - 2; j <= i + 2; j++) { if (j === i) continue; if (rows[j].h >= rows[i].h) ih = false; if (rows[j].l <= rows[i].l) il = false; }
    if (ih) hs.push({ i, p: rows[i].h });
    if (il) ls.push({ i, p: rows[i].l });
  }
  return { hs, ls };
}

function poolState(price, side, formedIdx, rows) {
  for (let i = formedIdx + 3; i < rows.length; i++) {
    if (side === 'BSL' && rows[i].h > price) return 'SPENT';
    if (side === 'SSL' && rows[i].l < price) return 'SPENT';
  }
  return 'VIRGIN';
}

export function findPools(rows, ctx, d1rows) {
  if (!Array.isArray(rows) || rows.length < 20) return [];
  const a = rows.slice(-90);
  const at = atrOf(a) || ctx.pip * 10;
  const tol = 0.15 * at;
  const { hs, ls } = swings(a);
  const out = [];

  const push = (price, side, type, strength, idx) => {
    const state = poolState(price, side, idx, a);
    const distPip = ((price - ctx.price) * (side === 'BSL' ? 1 : -1)) / ctx.pip;
    out.push({ price, side, type, strength, state, distPip, ahead: distPip > 0 });
  };

  const cluster = (arr, side) => {
    const used = new Set();
    for (let i = 0; i < arr.length; i++) {
      if (used.has(i)) continue;
      const grp = [arr[i]];
      for (let j = i + 1; j < arr.length; j++) if (!used.has(j) && Math.abs(arr[j].p - arr[i].p) <= tol) { grp.push(arr[j]); used.add(j); }
      const last = grp[grp.length - 1];
      if (grp.length >= 2) push(last.p, side, side === 'BSL' ? 'EQH' : 'EQL', 5, last.i);
      else push(last.p, side, 'SWING', 3, last.i);
      used.add(i);
    }
  };
  cluster(hs, 'BSL'); cluster(ls, 'SSL');

  if (Array.isArray(d1rows) && d1rows.length >= 2) {
    const prev = d1rows[d1rows.length - 2];
    push(prev.h, 'BSL', 'PDH', 5, a.length - 1);
    push(prev.l, 'SSL', 'PDL', 5, a.length - 1);
  }

  const step = ctx.symbol === 'BTCUSD' ? 1000 : 10;
  const base = Math.round(ctx.price / step) * step;
  for (const k of [-2, -1, 1, 2]) {
    const p = base + k * step;
    push(p, p > ctx.price ? 'BSL' : 'SSL', 'ROUND', 2, a.length - 1);
  }

  const uniq = [];
  for (const p of out.sort((x, y) => y.strength - x.strength)) {
    if (uniq.some(u => Math.abs(u.price - p.price) <= tol && u.side === p.side)) continue;
    uniq.push(p);
  }
  return uniq;
}

export function sweepVsBreak(level, side, rows, ctx) {
  if (!Array.isArray(rows) || rows.length < 4) return { verdict: 'NONE' };
  const at = atrOf(rows) || ctx.pip * 10;
  const n = rows.slice(-4);
  for (let i = n.length - 1; i >= 1; i--) {
    const c = n[i], rng = c.h - c.l || ctx.pip;
    const body = Math.abs(c.c - c.o);
    const beyond = side === 'BSL' ? c.h > level : c.l < level;
    if (!beyond) continue;
    const closedOut = side === 'BSL' ? c.c > level : c.c < level;
    const wickRatio = side === 'BSL' ? (c.h - Math.max(c.c, c.o)) / rng : (Math.min(c.c, c.o) - c.l) / rng;

    if (!closedOut && wickRatio > 0.5) {
      return { verdict: 'SWEEP', dir: side === 'BSL' ? -1 : 1, extreme: side === 'BSL' ? c.h : c.l,
               id: 'Sweep ' + side + ' lalu reclaim — stop hunt, potensi balik.', en: 'Sweep then reclaim — stop hunt.' };
    }
    if (closedOut && body >= 1.2 * at) {
      const held = n.slice(i + 1).every(x => side === 'BSL' ? x.c > level : x.c < level);
      if (held) return { verdict: 'BREAK', dir: side === 'BSL' ? 1 : -1, extreme: side === 'BSL' ? c.h : c.l,
                         id: 'Break displacement + hold — breakout asli, lanjut arah.', en: 'Displacement break held — real breakout.' };
      return { verdict: 'AMBIGUOUS', dir: 0, id: 'Close di luar tapi belum hold 2 candle — tunggu konfirmasi.', en: 'Closed beyond but not held — wait.' };
    }
  }
  return { verdict: 'NONE' };
}

export function doubleSweep(pools, rows, ctx) {
  const bsl = pools.filter(p => p.side === 'BSL').sort((a,b)=>a.distPip-b.distPip)[0];
  const ssl = pools.filter(p => p.side === 'SSL').sort((a,b)=>a.distPip-b.distPip)[0];
  if (!bsl || !ssl) return false;
  const n = rows.slice(-3);
  const up = n.some(c => c.h > bsl.price), dn = n.some(c => c.l < ssl.price);
  return up && dn;
}

export function nearestDraw(pools, dir, ctx) {
  const want = dir === 1 ? 'BSL' : 'SSL';
  const c = pools.filter(p => p.side === want && p.state === 'VIRGIN' && p.ahead)
                 .sort((a, b) => a.distPip - b.distPip);
  return c[0] || null;
}

export function slBeyondPool(pools, dir, entry, ctx, atrv) {
  const want = dir === 1 ? 'SSL' : 'BSL';
  const behind = pools.filter(p => p.side === want && ((p.price - entry) * dir < 0))
                      .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));
  const buf = 0.2 * atrv;
  if (!behind.length) return null;
  return { level: behind[0].price - dir * buf, pool: behind[0] };
}

export function liquidityScore(pools, dir, verdict, sess) {
  let s = 0;
  if (verdict === 'SWEEP' && (sess.key === 'LONDON_KZ' || sess.key === 'NY_AM_KZ')) s += 12;
  else if (verdict === 'SWEEP') s += 7;
  else if (verdict === 'BREAK') s += 10;
  else if (verdict === 'AMBIGUOUS') s += 2;
  else s += 4;
  const strong = pools.some(p => p.strength >= 5 && p.state === 'VIRGIN' && p.ahead);
  if (strong) s += 3;
  return Math.min(15, s);
}
