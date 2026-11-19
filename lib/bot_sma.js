// lib/bot_sma.js — BOT XAUUSD: SMA20 + Market Structure M1 (skenario continuation)
// Hanya memakai candle M1 yang sudah close. Tanpa CHoCH, OB, FVG, Breaker, sweep, atau CISD.
// Dipakai HANYA oleh bot (AUTOBOT).
//
// BUY  : tren SMA20 naik + harga di atas SMA20 + struktur HH-HL
//        → BOS naik (close tembus swing high, body ≥ 60%) dalam 15 candle terakhir
//        → pullback menyentuh SMA20 dalam 5 candle terakhir, HL sebelum BOS belum tertembus
//        → candle M1 terakhir close bullish di atas SMA20 (body ≥ 40%), jarak ke SMA20 ≤ 1.5 ATR
// SELL : kebalikan BUY (SMA20 turun, harga di bawah SMA20, LH-LL, BOS turun, pullback ke SMA20 dari bawah).

export const BOT_SMA_CFG = {
  smaPeriod: 20,
  slopeLookback: 3,      // SMA dianggap naik/turun bila dibanding 3 candle sebelumnya
  pivotLen: 2,           // swing high/low = pivot 2 kiri-kanan
  bosLookback: 15,       // BOS harus terjadi dalam 15 candle M1 terakhir
  bosBodyMin: 0.6,       // body candle BOS minimal 60% dari range
  pbWindow: 5,           // pullback ke SMA20 harus terjadi dalam 5 candle terakhir
  touchAtr: 0.25,        // "menyentuh SMA20" = low (buy) / high (sell) masuk band SMA20 ± 0.25 ATR
  maxExtAtr: 1.5,        // jarak close ke SMA20 maksimal 1.5 ATR (anti-chase)
  triggerBodyMin: 0.4,   // body candle konfirmasi minimal 40% dari range
  entryNearAtr: 0.25,    // harga dalam 0.25 ATR dari close konfirmasi → MARKET, selain itu LIMIT
  slBufAtr: 0.2,         // buffer SL di luar titik ekstrem pullback
  minRiskAtr: 0.5,       // SL minimal 0.5 ATR
  maxRiskAtr: 2.0,       // SL maksimal 2.0 ATR, lebih lebar → skip (SL tidak diubah)
  atrPeriod: 14,
  rr: [1, 2, 3],         // TP 1:1, 1:2, 1:3 dari jarak entry ke SL
};

function atrOf(c, n = 14) {
  if (!c || c.length < 2) return 0;
  const k = Math.min(n, c.length - 1);
  let s = 0;
  for (let i = c.length - k; i < c.length; i++) {
    s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  }
  return s / k;
}

function smaAt(c, idx, period) {
  if (idx < period - 1 || idx >= c.length) return null;
  let s = 0;
  for (let i = idx - period + 1; i <= idx; i++) s += c[i].c;
  return s / period;
}

// Pivot dikonfirmasi hanya setelah L candle di kanannya tersedia
function pivotsOf(c, L) {
  const highs = [], lows = [];
  for (let i = L; i < c.length - L; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= L; j++) {
      if (!(c[i].h > c[i - j].h && c[i].h >= c[i + j].h)) isH = false;
      if (!(c[i].l < c[i - j].l && c[i].l <= c[i + j].l)) isL = false;
    }
    if (isH) highs.push({ i, p: c[i].h });
    if (isL) lows.push({ i, p: c[i].l });
  }
  return { highs, lows };
}

// Pivot terakhir yang sudah terkonfirmasi pada atau sebelum indeks idx
const lastBefore = (list, idx) => {
  for (let k = list.length - 1; k >= 0; k--) if (list[k].i <= idx) return list[k];
  return null;
};

// c = candle M1 yang sudah close (urut waktu). opts: { price (live), dec }
export function runBotSma(c, opts = {}) {
  const cfg = BOT_SMA_CFG;
  const dec = Number.isFinite(opts.dec) ? opts.dec : 2;
  const f = v => Number(v).toFixed(dec);
  const n = c ? c.length : 0;
  const L = cfg.pivotLen;
  const checklist = [];
  const T = (ok, txt) => checklist.push(`${ok ? '✅' : '⬜'} ${txt}`);

  const fail = (reason, ext = {}) => ({
    ok: false, reason, checklist,
    dir: 0, bias: ext.bias || 'NETRAL', dirTxt: '-', trigger: null,
    trendTxt: ext.trendTxt || '-', structTxt: ext.structTxt || '-',
    entry: null, sl: null, tps: [], rr: 0, orderType: 'NONE', setup: '',
  });

  if (n < 40) return fail('Data M1 belum cukup (minimal 40 candle). Tunggu sebentar.');
  const atr = atrOf(c, cfg.atrPeriod);
  if (!(atr > 0)) return fail('ATR M1 belum bisa dihitung.');

  const last = n - 1;
  const px = c[last].c;
  const sma = smaAt(c, last, cfg.smaPeriod);
  const smaPrev = smaAt(c, last - cfg.slopeLookback, cfg.smaPeriod);
  if (sma == null || smaPrev == null) return fail('SMA20 belum bisa dihitung.');

  // ── Tren SMA20 ──
  const trendDir = px > sma && sma > smaPrev ? 1 : px < sma && sma < smaPrev ? -1 : 0;
  const trendTxt = trendDir === 1 ? 'BULLISH (harga di atas SMA20, SMA naik)'
    : trendDir === -1 ? 'BEARISH (harga di bawah SMA20, SMA turun)'
    : 'DATAR / belum jelas';

  // ── Struktur (HH-HL / LH-LL) dari pivot terkonfirmasi ──
  const { highs, lows } = pivotsOf(c, L);
  const h1 = highs[highs.length - 1], h0 = highs[highs.length - 2];
  const l1 = lows[lows.length - 1], l0 = lows[lows.length - 2];
  let structDir = 0;
  if (h1 && h0 && l1 && l0) {
    if (h1.p > h0.p && l1.p > l0.p) structDir = 1;
    else if (h1.p < h0.p && l1.p < l0.p) structDir = -1;
  }
  const structTxt = structDir === 1 ? 'HH-HL (uptrend)' : structDir === -1 ? 'LH-LL (downtrend)' : 'range / belum jelas';

  const side = trendDir;               // arah yang dievaluasi
  const sideTxt = side === 1 ? 'naik' : side === -1 ? 'turun' : '';
  const ctxInfo = { bias: trendDir === 1 ? 'BULLISH' : trendDir === -1 ? 'BEARISH' : 'NETRAL', trendTxt, structTxt };

  // ── BOS dalam 15 candle terakhir: close menembus pivot terakhir, body kuat ──
  let bos = null;
  if (side !== 0) {
    for (let k = last; k >= Math.max(1, n - cfg.bosLookback); k--) {
      const ref = side === 1 ? lastBefore(highs, k - L - 1) : lastBefore(lows, k - L - 1);
      if (!ref) continue;
      const crossed = side === 1
        ? (c[k].c > ref.p && c[k - 1].c <= ref.p)
        : (c[k].c < ref.p && c[k - 1].c >= ref.p);
      if (!crossed) continue;
      const rng = c[k].h - c[k].l;
      const body = Math.abs(c[k].c - c[k].o);
      const dirOk = side === 1 ? c[k].c > c[k].o : c[k].c < c[k].o;
      if (!(rng > 0 && dirOk && body / rng >= cfg.bosBodyMin)) continue;
      bos = { k, level: ref.p };
      break;
    }
  }

  // ── Pullback menyentuh SMA20 dalam 5 candle terakhir (setelah BOS) ──
  let touch = null;
  if (bos) {
    const band = cfg.touchAtr * atr;
    for (let j = last - 1; j > bos.k && j >= last - cfg.pbWindow; j--) {
      const s = smaAt(c, j, cfg.smaPeriod);
      if (s == null) continue;
      const hit = side === 1 ? c[j].l <= s + band : c[j].h >= s - band;
      if (hit) { touch = { j, sma: s }; break; }
    }
  }

  // ── HL/LH sebelum BOS belum tertembus oleh pullback ──
  let intact = true;
  if (bos && touch) {
    const piv = side === 1 ? lastBefore(lows, bos.k - L - 1) : lastBefore(highs, bos.k - L - 1);
    if (piv) {
      let ext = side === 1 ? Infinity : -Infinity;
      for (let k = bos.k; k <= last; k++) {
        ext = side === 1 ? Math.min(ext, c[k].l) : Math.max(ext, c[k].h);
      }
      intact = side === 1 ? ext > piv.p : ext < piv.p;
    }
  }

  // ── Konfirmasi: candle M1 terakhir close searah, di sisi yang benar dari SMA20 ──
  const tg = c[last];
  const rng = tg.h - tg.l, body = Math.abs(tg.c - tg.o);
  const trigOk = !!touch && rng > 0 && body >= cfg.triggerBodyMin * rng &&
    (side === 1 ? tg.c > tg.o && tg.c > sma : side === -1 ? tg.c < tg.o && tg.c < sma : false);

  // ── Anti-chase: jarak close ke SMA20 ──
  const ext = Math.abs(tg.c - sma);
  const extOk = ext <= cfg.maxExtAtr * atr;

  const armed = side !== 0 && structDir === side && !!bos && !!touch && intact && trigOk && extOk;

  // ── Checklist (selalu ditampilkan, untuk narasi dan layar) ──
  T(trendDir !== 0, `Tren SMA20 M1: ${trendTxt}`);
  T(side !== 0 && structDir === side, `Struktur M1: ${structTxt}`);
  T(!!bos, bos ? `BOS ${sideTxt} M1 tembus ${f(bos.level)} (${last - bos.k} candle lalu)` : `BOS M1 dalam ${cfg.bosLookback} candle: belum ada`);
  T(!!touch, touch ? `Pullback menyentuh SMA20 (${f(touch.sma)})` : `Pullback ke SMA20 dalam ${cfg.pbWindow} candle: belum ada`);
  T(intact, `Struktur ${side === -1 ? 'LH' : 'HL'} sebelum BOS belum rusak`);
  T(trigOk, `Konfirmasi M1 close ${side === -1 ? 'bearish di bawah' : 'bullish di atas'} SMA20`);
  T(extOk, `Jarak close ke SMA20 ${(ext / atr).toFixed(1)}x ATR (maks ${cfg.maxExtAtr}x)`);

  if (!armed) {
    let reason;
    if (trendDir === 0) reason = 'Tren SMA20 belum jelas (harga dan SMA20 belum searah). Menunggu.';
    else if (structDir === 0) reason = `Struktur M1 masih range. Menunggu HH-HL (buy) atau LH-LL (sell) searah tren SMA20 ${sideTxt}.`;
    else if (structDir !== trendDir) reason = `Struktur ${structTxt} belum searah dengan tren SMA20 ${sideTxt}. Menunggu HH-HL / LH-LL.`;
    else if (!bos) reason = `Tren dan struktur ${sideTxt} sudah searah, menunggu BOS ${sideTxt} dalam ${cfg.bosLookback} candle terakhir.`;
    else if (!touch) reason = `BOS ${sideTxt} sudah terjadi. Menunggu pullback menyentuh SMA20.`;
    else if (!intact) reason = 'Pullback sudah menembus HL/LH sebelum BOS, struktur rusak. Skip.';
    else if (!trigOk) reason = `Pullback menyentuh SMA20. Menunggu candle M1 close ${side === -1 ? 'bearish di bawah' : 'bullish di atas'} SMA20.`;
    else reason = `Harga terlalu jauh dari SMA20 (${(ext / atr).toFixed(1)}x ATR). Tunggu pullback, tidak chase.`;
    return fail(reason, ctxInfo);
  }

  // ── Entry & SL ──
  const price = Number(opts.price) > 0 ? Number(opts.price) : px;
  const pbSlice = c.slice(touch.j, last + 1);
  const pbExt = side === 1 ? Math.min(...pbSlice.map(x => x.l)) : Math.max(...pbSlice.map(x => x.h));
  const sl0 = side === 1 ? pbExt - cfg.slBufAtr * atr : pbExt + cfg.slBufAtr * atr;

  const near = Math.abs(price - tg.c) <= cfg.entryNearAtr * atr;
  const ran = side === 1 ? price > tg.c : price < tg.c;
  if (!near && !ran) {
    return fail(`Harga sudah turun lagi di bawah close konfirmasi M1 sebelum tertahan. Menunggu.`, ctxInfo);
  }

  let orderType, entry, entryNote;
  if (near) {
    orderType = 'MARKET';
    entry = price;
    entryNote = 'entry NOW dekat close konfirmasi M1';
  } else {
    orderType = 'LIMIT';
    entry = (tg.o + tg.c) / 2;
    entryNote = 'limit di tengah body konfirmasi M1 (harga sudah lari)';
  }

  if (side === 1 ? sl0 >= entry : sl0 <= entry) {
    return fail('SL pullback tidak valid terhadap entry. Skip.', ctxInfo);
  }

  let sl = sl0;
  let risk = Math.abs(entry - sl);
  if (risk > cfg.maxRiskAtr * atr) {
    return fail(`SL pullback ${(risk / atr).toFixed(1)}x ATR, melebihi batas ${cfg.maxRiskAtr}x ATR. Skip, SL tidak saya ubah.`, ctxInfo);
  }
  if (risk < cfg.minRiskAtr * atr) {
    risk = cfg.minRiskAtr * atr;
    sl = side === 1 ? entry - risk : entry + risk;
  }
  const tps = cfg.rr.map(m => entry + side * risk * m);

  T(true, `Entry ${orderType === 'MARKET' ? 'NOW' : 'LIMIT'} ${f(entry)} · SL ${f(sl)} · TP 1:1 / 1:2 / 1:3`);

  return {
    ok: true, reason: '', checklist,
    dir: side,
    bias: side === 1 ? 'BULLISH' : 'BEARISH',
    dirTxt: side === 1 ? 'BUY' : 'SELL',
    trigger: `BOS ${sideTxt} + pullback SMA20`,
    trendTxt, structTxt,
    entry, sl, tps,
    rr: cfg.rr[cfg.rr.length - 1],
    orderType, entryNote,
    setup: `Bot SMA20 + Structure M1 · BOS ${sideTxt} + pullback SMA20 · ${entryNote}`,
  };
}
