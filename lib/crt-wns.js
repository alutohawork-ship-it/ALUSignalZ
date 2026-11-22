// lib/crt-wns.js — CRT WNS (zona pantau), dihitung dari WICK candle terakhir yang sudah tutup.
// Fungsi murni: tidak memanggil API. Dipakai untuk Intraday (range H4) dan Swing (range D1).
//
// RH = high tertinggi candle range (ujung wick atas), RL = low terendah (ujung wick bawah).
// Area WNS SELL = RH ± band, area WNS BUY = RL ± band, band = 0.2 x ATR range.
// Range diterima hanya jika tingginya antara 0.5x dan 2x ATR range.

export const WNS_CFG = {
  atrPeriod: 14,
  bandAtr: 0.2,        // lebar area WNS di sekitar RH/RL
  minRangeAtr: 0.5,    // tinggi range minimal (x ATR)
  maxRangeAtr: 2.0,    // tinggi range maksimal (x ATR)
};

export function atrOf(rows, period = WNS_CFG.atrPeriod) {
  if (!rows || rows.length < period + 1) return 0;
  const tr = i => Math.max(
    rows[i].h - rows[i].l,
    Math.abs(rows[i].h - rows[i - 1].c),
    Math.abs(rows[i].l - rows[i - 1].c)
  );
  let a = 0;
  for (let i = 1; i <= period; i++) a += tr(i);
  a /= period;
  for (let i = period + 1; i < rows.length; i++) a = (a * (period - 1) + tr(i)) / period;
  return a;
}

// rows: candle range (H4 atau D1), urut naik, HANYA yang sudah tutup.
// Mengembalikan { ok, reason?, rh, rl, mid, atr, sell:{lo,hi}, buy:{lo,hi}, candleT }
export function computeWns(rows, cfg = WNS_CFG) {
  const atr = atrOf(rows, cfg.atrPeriod);
  if (!(atr > 0)) return { ok: false, reason: 'ATR belum bisa dihitung' };
  const last = rows[rows.length - 1];
  const rh = last.h;   // ujung wick atas
  const rl = last.l;   // ujung wick bawah
  const height = rh - rl;
  if (height < cfg.minRangeAtr * atr) return { ok: false, reason: 'range terlalu sempit', atr };
  if (height > cfg.maxRangeAtr * atr) return { ok: false, reason: 'range terlalu lebar', atr };
  const band = cfg.bandAtr * atr;
  return {
    ok: true, rh, rl, mid: (rh + rl) / 2, atr, candleT: last.t,
    sell: { lo: rh - band, hi: rh + band },
    buy: { lo: rl - band, hi: rl + band },
  };
}

// Harga live di area WNS mana? Mengembalikan 'SELL', 'BUY', atau null.
export function inWns(price, wns) {
  if (!wns || !wns.ok || !Number.isFinite(price)) return null;
  if (price >= wns.sell.lo && price <= wns.sell.hi) return 'SELL';
  if (price >= wns.buy.lo && price <= wns.buy.hi) return 'BUY';
  return null;
}

// Apakah WNS perlu dihitung ulang? Ya jika candle range baru sudah tutup.
export function wnsStale(wns, latestClosedT) {
  return !wns || !wns.ok || latestClosedT !== wns.candleT;
}
