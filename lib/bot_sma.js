// lib/bot_sma.js — BOT SCALPER SMC FLEKSIBEL (bertingkat, dua arah, tanpa SMA, tanpa OCO)
// Tier A (STRICT)  : semua validasi penuh -> confidence HIGH
// Tier B (FLEKSIBEL): validasi inti SMC (struktur + zona + arah), checklist tambahan dilonggarkan -> MEDIUM
// Order MARKET langsung dikirim. Order LIMIT dikirim sebagai pending jika entry cukup dekat dengan harga.
import { runScalpSMC } from './manual_scalp.js';

const BOT_RR = 1.5;
const MAX_LIMIT_DIST_PIP = 60;   // LIMIT hanya diterima jika entry <= 60 pip (6.0 USD di XAUUSD) dari harga
const ALLOW_LOOSE = true;        // set false untuk kembali ke mode strict murni
const LOOSE_NEEDS_DIRECTION = false; // true = tier B tetap wajib searah bias H1 (tidak boleh counter)

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
    if (!(dist <= MAX_LIMIT_DIST_PIP)) return null;
  }
  if (tier === 'LOOSE' && LOOSE_NEEDS_DIRECTION && o.role === 'counter') return null;
  return o;
}

export function runBotSma(bars, { price, dec = 2, pip = 0.1, symbol = 'XAUUSD' }) {
  const ctx = { price, dec, pip, now: Date.now(), rr: BOT_RR, symbol };

  // Tier A: strict
  const strictOut = runScalpSMC(bars, ctx, { strict: true, allowCounter: true, useOco: false });
  let tier = 'STRICT';
  let out = strictOut;
  let o = accept(strictOut, ctx, 'STRICT');

  // Tier B: fleksibel (hanya dicoba jika strict tidak menghasilkan order yang bisa dipakai)
  if (!o && ALLOW_LOOSE) {
    const looseOut = runScalpSMC(bars, ctx, { strict: false, allowCounter: true, useOco: false });
    const lo = accept(looseOut, ctx, 'LOOSE');
    if (lo) { tier = 'LOOSE'; out = looseOut; o = lo; }
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
    setup: `Bot SMC ${tier === 'STRICT' ? '(Strict)' : '(Fleksibel)'} · ${o.reason}`,
    reason: null,
  };
}
