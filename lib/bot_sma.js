// lib/bot_sma.js — BOT SCALPER M1
// Mode utama   : SMA20 searah struktur M1 + pullback ke SMA20 + BOS/CHoCH M1 searah -> MARKET
// Mode tambahan: jika SMA20 datar, pakai S&D M1 + CHoCH M1 + candle konfirmasi -> MARKET
import { calcATR, structureEvents, detectSDAndOB, updateZoneState, m1ChochConfirm } from './manual_scalp.js';

const SMA_PERIOD = 20;
const RR = 1.5;

const toMs = t => {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n < 1e12 ? n * 1000 : n;
};
const lastOf = a => (a && a.length ? a[a.length - 1] : undefined);
const roundTo = (p, dec) => Number(Number(p).toFixed(dec));

function smaSeries(values, p) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= p) sum -= values[i - p];
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}

export function runBotSma(raw, { price, dec = 2 }) {
  const c = (raw || []).map(b => ({ time: toMs(b.t), open: b.o, high: b.h, low: b.l, close: b.c }));
  const fail = (reason, extra = {}) => ({
    ok: false, reason, bias: 'NETRAL', dirTxt: '-', trendTxt: '-', structTxt: '-',
    trigger: null, checklist: [], ...extra,
  });
  if (c.length < 40) return fail('Data M1 belum cukup.');
  const atr = lastOf(calcATR(c)) || 0;
  if (!(atr > 0)) return fail('ATR M1 belum bisa dihitung.');

  const i = c.length - 1;
  const sma = smaSeries(c.map(x => x.close), SMA_PERIOD);
  const smaNow = sma[i], smaPrev = sma[i - 3];
  if (smaNow == null || smaPrev == null) return fail('SMA20 belum siap.');
  const slope = smaNow - smaPrev;
  const flat = Math.abs(slope) < 0.1 * atr;
  const smaDir = flat ? 0 : slope > 0 ? 1 : -1;

  const st = structureEvents(c, 2);
  const lastEv = lastOf(st.events);
  const ev = lastEv && lastEv.k >= c.length - 21 ? lastEv : null;
  const bias = st.trend === 1 ? 'bullish' : st.trend === -1 ? 'bearish' : 'NETRAL';
  const trendTxt = `SMA20 ${flat ? 'datar' : smaDir > 0 ? 'naik' : 'turun'}`;
  const structTxt = `Struktur M1 ${bias}${ev ? ` · ${ev.type}` : ''}`;
  const checklist = [trendTxt, structTxt];
  const ctxFail = reason => fail(reason, { bias, trendTxt, structTxt, checklist });

  const last = c[i];
  let side = null, trigger = null, sl = null;

  // Mode utama: SMA20 + struktur M1
  if (!flat) {
    const want = smaDir === 1 ? 'buy' : 'sell';
    const structOk = st.trend === smaDir;
    const evOk = ev && (want === 'buy' ? ev.type === 'BOS_BULL' || ev.type === 'CHoCH_BULL'
      : ev.type === 'BOS_BEAR' || ev.type === 'CHoCH_BEAR');
    const recent = c.slice(-5);
    const touch = want === 'buy'
      ? Math.min(...recent.map(x => x.low)) <= smaNow + 0.2 * atr
      : Math.max(...recent.map(x => x.high)) >= smaNow - 0.2 * atr;
    const reclaim = want === 'buy'
      ? last.close > smaNow && last.close > last.open
      : last.close < smaNow && last.close < last.open;
    if (structOk && evOk && touch && reclaim) {
      side = want;
      trigger = `Pullback SMA20 + ${ev.type}`;
      const swLow = lastOf(st.lows.filter(l => l.i < i));
      const swHigh = lastOf(st.highs.filter(h => h.i < i));
      const rawSl = want === 'buy'
        ? (swLow ? swLow.price - 0.2 * atr : last.close - atr)
        : (swHigh ? swHigh.price + 0.2 * atr : last.close + atr);
      sl = rawSl;
    }
  }

  // Mode tambahan: S&D M1 + CHoCH M1 saat SMA datar
  if (!side && flat) {
    const zones = detectSDAndOB(c, 'M1').map(z => updateZoneState(z, c)).filter(z => !z.mitigated && z.fresh);
    for (const z of zones) {
      const s = z.type === 'demand' ? 'buy' : 'sell';
      const inside = s === 'buy'
        ? price <= z.top + 0.15 * atr && price >= z.bottom
        : price >= z.bottom - 0.15 * atr && price <= z.top;
      if (!inside) continue;
      const conf = m1ChochConfirm(c, s, 20, 0);
      if (!conf.ok) continue;
      side = s;
      trigger = `S&D M1 ${z.pattern} + ${conf.type}`;
      sl = s === 'buy' ? z.bottom - 0.2 * atr : z.top + 0.2 * atr;
      break;
    }
  }

  if (!side) {
    return ctxFail('Menunggu setup valid (SMA20 + struktur M1, atau S&D M1 + CHoCH).');
  }

  const entry = roundTo(price, dec);
  const slR = roundTo(sl, dec);
  if (side === 'buy' ? slR >= entry : slR <= entry) return ctxFail('SL bot tidak valid terhadap entry.');
  const risk = Math.abs(entry - slR);
  if (risk > 2 * atr) return ctxFail('SL terlalu lebar (> 2 ATR M1).');

  const d = side === 'buy' ? 1 : -1;
  const tps = [RR, RR + 0.5, RR + 1].map(m => roundTo(entry + d * risk * m, dec));
  checklist.push(`OK: ${trigger}`, `OK: SL ${slR}, RR 1:${RR}`);

  return {
    ok: true,
    dir: d,
    dirTxt: side === 'buy' ? 'BUY' : 'SELL',
    bias: side === 'buy' ? 'bullish' : 'bearish',
    trigger, checklist, trendTxt, structTxt,
    entry, sl: slR, tps, rr: RR,
    orderType: 'MARKET',
    setup: `Bot · ${trigger}`,
    reason: null,
  };
}
