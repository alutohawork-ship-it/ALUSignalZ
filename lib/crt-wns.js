export function computeWns(rows, cfg = WNS_CFG) {
  if (!Array.isArray(rows) || !rows.length) return { ok: false, reason: 'candle range belum ada' };
  const atr = atrOf(rows, cfg.atrPeriod);
  const last = rows[rows.length - 1];
  const rh = last.h, rl = last.l, height = rh - rl;
  const band = atr > 0 ? cfg.bandAtr * atr : 0.1 * (height || 1);
  const base = {
    rh, rl, mid: (rh + rl) / 2, atr, candleT: last.t,
    sell: { lo: rh - band, hi: rh + band },
    buy:  { lo: rl - band, hi: rl + band },
  };
  if (!(atr > 0)) return { ...base, ok: false, reason: 'ATR belum bisa dihitung' };
  if (height < cfg.minRangeAtr * atr) return { ...base, ok: false, reason: 'range terlalu sempit' };
  if (height > cfg.maxRangeAtr * atr) return { ...base, ok: false, reason: 'range terlalu lebar' };
  return { ...base, ok: true };
}
