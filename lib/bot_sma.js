// lib/bot_sma.js — BOT SCALPER SMC FLEKSIBEL (3 Tier: STRICT, LOOSE, MOMENTUM)
// Tier A (STRICT)   : semua validasi penuh -> confidence HIGH
// Tier B (LOOSE)    : minimal 1 POI (fallback ke OTE jika POI kosong) -> MEDIUM
// Tier C (MOMENTUM) : abaikan POI, entry di area OTE -> MEDIUM, risk HIGH
// Order MARKET langsung dikirim. Order LIMIT dikirim sebagai pending jika entry cukup dekat.
// Bounce setup dimatikan (allowBounce: false) — bounce hanya untuk Manual.
import { runScalpSMC } from './manual_scalp.js';

const BOT_RR = 1.5;
const MAX_LIMIT_DIST_PIP = 120;
const MOMENTUM_MAX_DIST_PIP = 200;
const ALLOW_LOOSE = true;
const LOOSE_NEEDS_DIRECTION = false;

function summarize(out) {
  const bias = out.regime === 'trending_up' ? 'bullish' : out.regime === 'trending_down' ? 'bearish' : 'NETRAL';
  return {
    bias,
    checklist: Array.isArray(out.checks) ? out.checks : [],
    trendTxt: `H1 ${bias}`,
    structTxt: out.regimeSrc || '-',
  };
}

function accept(out, { price, pip }, tier) {
  if (!out || !out.ok || !out.order) return null;
  const o = out.order;
  const isMarket = o.orderType === 'MARKET';
  if (!isMarket) {
    const dist = Math.abs(price - o.entryPrice) / pip;
    const maxDist = tier === 'MOMENTUM' ? MOMENTUM_MAX_DIST_PIP : MAX_LIMIT_DIST_PIP;
    if (!(dist <= maxDist)) return null;
  }
  if (tier === 'LOOSE' && LOOSE_NEEDS_DIRECTION && o.role === 'counter') return null;
  return o;
}

export function runBotSma(bars, { price, dec = 2, pip = 0.1, symbol = 'XAUUSD' }) {
  const ctx = { price, dec, pip, now: Date.now(), rr: BOT_RR, symbol };

  // Tier A: STRICT (2 POI)
  const strictOut = runScalpSMC(bars, ctx, { strict: true, allowCounter: true, useOco: false, allowBounce: false });
  let tier = 'STRICT';
  let out = strictOut;
  let o = accept(strictOut, ctx, 'STRICT');

  // Tier B: LOOSE (1 POI)
  if (!o && ALLOW_LOOSE) {
    const looseOut = runScalpSMC(bars, ctx, { strict: false, allowCounter: true, useOco: false, minPoi: 1, allowBounce: false });
    const lo = accept(looseOut, ctx, 'LOOSE');
    if (lo) { tier = 'LOOSE'; out = looseOut; o = lo; }
    else { out = looseOut; }
  }

  // Tier C: MOMENTUM (abaikan POI)
  if (!o && ALLOW_LOOSE) {
    const momentumOut = runScalpSMC(bars, ctx, { strict: false, allowCounter: true, useOco: false, ignorePoi: true, allowBounce: false });
    const lo = accept(momentumOut, ctx, 'MOMENTUM');
    if (lo) { tier = 'MOMENTUM'; out = momentumOut; o = lo; }
    else { out = momentumOut; }
  }

  const base = summarize(out);
  if (!o) {
    const reason = out.ok
      ? 'Setup terbentuk, tapi entry masih jauh dari harga. Menunggu harga mendekat.'
      : (out.reason || 'Menunggu setup valid.');
    return { ok: false, reason, dirTxt: '-', trigger: null, ...base };
  }

  const isMarket = o.orderType === 'MARKET';
  return {
    ok: true,
    dir: o.side === 'buy' ? 1 : -1,
    dirTxt: o.side === 'buy' ? 'BUY' : 'SELL',
    role: o.role,
    tier,
    bias: base.bias,
    trigger: o.reason,
    checklist: base.checklist,
    trendTxt: base.trendTxt,
    structTxt: base.structTxt,
    entry: o.entryPrice,
    sl: o.sl,
    tps: [o.tp1, o.tp2, o.tp3],
    rr: o.rr,
    tpMode: o.tpMode,
    orderType: isMarket ? 'MARKET' : 'LIMIT',
    confidence: tier === 'STRICT' ? 'HIGH' : 'MEDIUM',
    setup: `Bot SMC ${tier === 'STRICT' ? '(Strict)' : tier === 'MOMENTUM' ? '(Momentum)' : '(Fleksibel)'} · ${o.reason}`,
    reason: null,
  };
}
