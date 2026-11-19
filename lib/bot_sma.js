// lib/bot_sma.js — BOT SCALPER XAUUSD M1
// Mode utama   : SMA20 + Market Structure M1 (pullback ke SMA20 searah tren).
// Mode tambahan: jika arah SMA20 datar/tidak jelas -> Supply & Demand + Order Block + Market Structure M1.
// Input candle : [{ t, o, h, l, c }] (hanya candle yang sudah close).
// Output       : { ok, reason, bias, dirTxt, trigger, checklist, trendTxt, structTxt, dir, entry, sl, tps, rr, orderType, setup }

import { calcATR, analyzeMarketStructure, detectSDAndOB, updateZoneState } from './manual_scalp.js';

const CFG = {
  minBars: 60,
  smaPeriod: 20,
  slopeBars: 5,
  flatSlopeAtr: 0.15,   // |slope SMA| < 0.15 ATR => datar
  pullbackAtr: 0.35,    // jarak low/high ke SMA yang dianggap "menyentuh"
  slBufAtr: 0.25,
  minRiskAtr: 0.5,
  maxRiskAtr: 3.5,
  swingLookback: 6,
};

const toDoc = bars => bars.map(b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: 1 }));

function smaLast(closes, period, offset = 0) {
  const end = closes.length - offset;
  if (end < period) return null;
  let s = 0;
  for (let i = end - period; i < end; i++) s += closes[i];
  return s / period;
}

function wait(reason, extra = {}) {
  return {
    ok: false, reason,
    bias: 'NETRAL', dirTxt: '-', trigger: null,
    trendTxt: '-', structTxt: '-', checklist: [],
    ...extra,
  };
}

function buildSignal({ dir, entry, sl, atr, trigger, setup, base }) {
  let risk = Math.abs(entry - sl);
  if (!(risk > 0) || risk > CFG.maxRiskAtr * atr) {
    return { ...base, ok: false, reason: 'Setup ditemukan, tetapi jarak SL terlalu jauh (risk melebihi batas ATR).' };
  }
  if (risk < CFG.minRiskAtr * atr) {
    risk = CFG.minRiskAtr * atr;
    sl = entry - dir * risk;
  }
  const tps = [1.5, 2.25, 3].map(k => entry + dir * risk * k);
  return {
    ...base, ok: true, dir,
    dirTxt: dir === 1 ? 'BUY' : 'SELL',
    entry, sl, tps, rr: 3, orderType: 'MARKET',
    trigger, setup,
  };
}

export function runBotSma(c1, { price, dec } = {}) {
  if (!Array.isArray(c1) || c1.length < CFG.minBars) {
    return wait(`Data M1 belum cukup (${Array.isArray(c1) ? c1.length : 0}/${CFG.minBars} candle).`);
  }
  const doc = toDoc(c1);
  const closes = doc.map(c => c.close);
  const last = doc[doc.length - 1];
  const prev = doc[doc.length - 2];
  const px = Number(price) > 0 ? Number(price) : last.close;

  const atrArr = calcATR(doc, 14);
  const atr = atrArr[atrArr.length - 1];
  if (!(atr > 0)) return wait('ATR M1 belum tersedia.');

  const smaNow = smaLast(closes, CFG.smaPeriod, 0);
  const smaOld = smaLast(closes, CFG.smaPeriod, CFG.slopeBars);
  if (smaNow == null || smaOld == null) return wait('SMA20 belum bisa dihitung.');
  const slope = smaNow - smaOld;
  const trendDir = slope > CFG.flatSlopeAtr * atr ? 1 : slope < -CFG.flatSlopeAtr * atr ? -1 : 0;

  const ms = analyzeMarketStructure(doc, 2);
  const msDir = ms.trend || 0;
  const msTxt = ms.event ? `${ms.event.replace('_', ' ')}` : (ms.regime || 'netral').replace('_', ' ');

  const trendTxt = trendDir === 1 ? 'SMA20 naik' : trendDir === -1 ? 'SMA20 turun' : 'SMA20 datar';
  const structTxt = `${msTxt} (${msDir === 1 ? 'bullish' : msDir === -1 ? 'bearish' : 'netral'})`;
  const bias = (trendDir || msDir) === 1 ? 'BULLISH' : (trendDir || msDir) === -1 ? 'BEARISH' : 'NETRAL';

  const base = {
    bias, trendTxt, structTxt, dirTxt: '-', trigger: null, checklist: [],
  };
  const chk = (label, ok) => `${ok ? '✓' : '✗'} ${label}`;

  // ───────── MODE UTAMA: SMA20 + Market Structure M1 ─────────
  if (trendDir !== 0) {
    const dir = trendDir;
    const aligned = msDir === dir;
    const sideOk = dir === 1 ? px > smaNow : px < smaNow;
    const recent = doc.slice(-3);
    const touched = dir === 1
      ? Math.min(...recent.map(c => c.low)) <= smaNow + CFG.pullbackAtr * atr
      : Math.max(...recent.map(c => c.high)) >= smaNow - CFG.pullbackAtr * atr;
    const candleOk = dir === 1
      ? (last.close > last.open && last.close > prev.close && last.close > smaNow)
      : (last.close < last.open && last.close < prev.close && last.close < smaNow);

    base.checklist = [
      chk(`Arah ${trendTxt}`, true),
      chk('Market Structure M1 searah', aligned),
      chk('Harga di sisi benar SMA20', sideOk),
      chk('Pullback menyentuh SMA20', touched),
      chk('Candle konfirmasi searah', candleOk),
    ];

    if (aligned && sideOk && touched && candleOk) {
      const sw = doc.slice(-CFG.swingLookback);
      const swing = dir === 1 ? Math.min(...sw.map(c => c.low)) : Math.max(...sw.map(c => c.high));
      const sl = swing - dir * CFG.slBufAtr * atr;
      return buildSignal({
        dir, entry: px, sl, atr, base,
        trigger: `Pullback SMA20 + ${msTxt}`,
        setup: `Bot SMA20 · ${dir === 1 ? 'Buy' : 'Sell'} pullback`,
      });
    }
    return {
      ...base, ok: false,
      reason: `Mode utama SMA20 (${trendTxt}): menunggu ${!aligned ? 'Market Structure M1 searah' : !touched ? 'pullback ke SMA20' : 'candle konfirmasi searah'}.`,
    };
  }

  // ───────── MODE TAMBAHAN: S&D + OB + Market Structure M1 ─────────
  base.checklist = [chk('SMA20 datar → mode S&D/OB', true)];
  if (msDir === 0) {
    return { ...base, ok: false, reason: 'SMA20 datar dan Market Structure M1 belum jelas. Bot menunggu arah.' };
  }
  const dir = msDir;
  const wantType = dir === 1 ? 'demand' : 'supply';
  const zones = detectSDAndOB(doc, 'M1', { lookback: 100, impulseMult: 1.5 })
    .map(z => updateZoneState(z, doc))
    .filter(z => !z.mitigated && z.type === wantType);

  const tol = 0.15 * atr;
  const inside = zones
    .filter(z => px <= z.obTop + tol && px >= z.obBottom - tol)
    .sort((a, b) => Number(b.fresh) - Number(a.fresh) || b.createdIndex - a.createdIndex);
  const z = inside[0];

  const rng = last.high - last.low;
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const confirmOk = rng > 0 && (dir === 1
    ? (last.close > last.open && (lowerWick >= 0.4 * rng || last.close > prev.high))
    : (last.close < last.open && (upperWick >= 0.4 * rng || last.close < prev.low)));

  base.checklist.push(
    chk(`Market Structure M1 ${dir === 1 ? 'bullish' : 'bearish'}`, true),
    chk(`Ada OB ${wantType} M1 aktif`, zones.length > 0),
    chk('Harga berada di dalam OB', !!z),
    chk('Candle konfirmasi/rejection', confirmOk),
  );

  if (z && confirmOk) {
    const sl = dir === 1 ? z.obBottom - CFG.slBufAtr * atr : z.obTop + CFG.slBufAtr * atr;
    return buildSignal({
      dir, entry: px, sl, atr, base,
      trigger: `S&D/OB M1 (${z.pattern}) + ${msTxt}`,
      setup: `Bot S&D/OB M1 · ${z.pattern}`,
    });
  }
  return {
    ...base, ok: false,
    reason: `Mode tambahan S&D/OB: menunggu harga masuk OB ${wantType} M1 dan candle konfirmasi.`,
  };
}
