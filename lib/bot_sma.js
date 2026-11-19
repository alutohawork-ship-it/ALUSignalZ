// lib/bot_sma.js — BOT SCALPER SMC STRICT (tanpa SMA)
// Memakai runScalpSMC dengan strict = true:
// bias H1 -> BOS/CHoCH M5 -> OTE -> POI minimal 2 dari 3 -> sentuh POI -> CHoCH M1 + konfirmasi.
// Sinyal hanya dikirim jika semua validasi lolos dan order bertipe MARKET.
import { runScalpSMC } from './manual_scalp.js';

const BOT_RR = 1.5;

// Nama fungsi tetap runBotSma agar import di generate.js tidak berubah
export function runBotSma(bars, { price, dec = 2, pip = 0.1 }) {
  const out = runScalpSMC(bars, { price, dec, pip, now: Date.now(), rr: BOT_RR }, { strict: true });
  const bias = out.regime === 'trending_up' ? 'bullish' : out.regime === 'trending_down' ? 'bearish' : 'NETRAL';
  const checklist = Array.isArray(out.checks) ? out.checks : [];
  const base = {
    bias,
    checklist,
    trendTxt: `H1 ${bias}`,
    structTxt: out.regimeSrc || '-',
  };

  if (!out.ok) {
    return { ok: false, reason: out.reason, dirTxt: '-', trigger: null, ...base };
  }

  const o = out.order;
  if (o.orderType !== 'MARKET') {
    return {
      ok: false,
      reason: 'Setup valid, menunggu harga masuk area entry.',
      dirTxt: '-', trigger: null, ...base,
    };
  }

  return {
    ok: true,
    dir: o.side === 'buy' ? 1 : -1,
    dirTxt: o.side === 'buy' ? 'BUY' : 'SELL',
    bias,
    trigger: o.reason,
    checklist,
    trendTxt: base.trendTxt,
    structTxt: base.structTxt,
    entry: o.entryPrice,
    sl: o.sl,
    tps: [o.tp1, o.tp2, o.tp3],
    rr: o.rr,
    orderType: 'MARKET',
    setup: `Bot SMC · ${o.reason}`,
    reason: null,
  };
}
