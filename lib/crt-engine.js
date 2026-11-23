export function findCrtSweep(mid, wns, cfg) {
  const from = Math.max(0, mid.length - 40);          // abaikan sweep lama
  const height = wns.rh - wns.rl;
  const minDepth = cfg.sweepMinRatio * height;
  const hits = [];
  for (let i = from; i < mid.length; i++) {
    const c = mid[i];
    const below = c.l < wns.rl && c.c > wns.rl && (wns.rl - c.l) >= minDepth;
    const above = c.h > wns.rh && c.c < wns.rh && (c.h - wns.rh) >= minDepth;
    if (below && above) continue;
    if (below) hits.push({ dir: 1, extreme: c.l, i, t: c.t });
    if (above) hits.push({ dir: -1, extreme: c.h, i, t: c.t });
  }
  return hits.length ? hits[hits.length - 1] : null;
}

export function planCrt({ style, range, mid, exec, price, sym = 'XAUUSD', tNow }) {
  const cfg = CRT_CFG[style === 'Swing' ? 'swing' : 'intraday'];
  const wns = computeWns(range);
  const wnsOut = wns.rh != null ? { rh: wns.rh, rl: wns.rl, mid: wns.mid, sell: wns.sell, buy: wns.buy } : null;
  const out = (status, extra = {}) => ({ status, wns: wnsOut, crtHigh: wns.rh ?? null, crtLow: wns.rl ?? null, ...extra });

  if (!wns.ok) return out('none', { reason: wns.reason });

  const zoneSide = inWns(price, wns);
  if (!zoneSide) return out('wns', { reason: `harga di luar WNS (area SELL ${wns.sell.lo}-${wns.sell.hi}, area BUY ${wns.buy.lo}-${wns.buy.hi})` });

  const sweep = findCrtSweep(mid, wns, cfg);
  if (!sweep) return out('wns', { reason: 'menunggu sweep di WNS ' + zoneSide });

  const broke = mid.filter(c => c.t > sweep.t).some(c => sweep.dir > 0 ? c.c < sweep.extreme : c.c > sweep.extreme);
  if (broke) return out('cancel', { reason: 'mid menutup melewati extreme sweep sebelum entry' });

  const conf = findConfirm(exec, sweep, cfg);
  if (!conf) return out('wns', { sweep, reason: 'sweep terjadi, menunggu CHoCH ' + (sweep.dir > 0 ? 'bullish' : 'bearish') });

  const z = conf.zone, dir = sweep.dir;
  const atrE = atrOf(exec);
  const entry = dir > 0 ? z.hi - 0.4 * (z.hi - z.lo) : z.lo + 0.4 * (z.hi - z.lo);
  const sl = dir > 0 ? sweep.extreme - 0.1 * atrE : sweep.extreme + 0.1 * atrE;
  const risk = Math.abs(entry - sl);
  if (!(risk > 0)) return out('none', { reason: 'risiko nol' });

  const tp1 = psychTp1(entry, sl, dir, sym);
  const oppSide = dir > 0 ? wns.rh : wns.rl;
  const tp2 = entry + dir * 2 * risk;
  let tp3 = oppSide;
  if (dir * (tp3 - entry) <= dir * (tp2 - entry)) tp3 = tp2;
  if (dir > 0 ? price >= oppSide : price <= oppSide) tp3 = tp2;

  return out('limit', {
    style, dir: dir > 0 ? 'BUY' : 'SELL', sym,
    sweep: { extreme: sweep.extreme, t: sweep.t },
    zone: { kind: z.kind, lo: z.lo, hi: z.hi },
    entry, sl, tp1, tp2, tp3,
    expiresAt: (tNow || Date.now()) + cfg.monitorMs,
  });
}
