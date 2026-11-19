// lib/bot_sma.js — BOT SCALPER SMC STRICT (dua arah, tanpa SMA, tanpa OCO)
// Setiap arah dicek dengan validasi penuh. Counter-trend hanya boleh jika struktur M5
// arah itu valid dan zona pantulan sudah terkonfirmasi CHoCH M1.
// TP memakai RR tunggal dari pilihan RR (bukan TP band manual).
// Sinyal hanya dikirim jika order bertipe MARKET.
import { runScalpSMC } from './manual_scalp.js';

const BOT_RR = 1.5;

export function runBotSma(bars, { price, dec = 2, pip = 0.1, symbol = 'XAUUSD' }) {
  const out = runScalpSMC(
    bars,
    { price, dec, pip, now: Date.now(), rr: BOT_RR, symbol },
    { strict: true, allowCounter: true, useOco: false }
  );
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
    return { ok: false, reason: 'Setup valid, menunggu harga masuk area entry.', dirTxt: '-', trigger: null, ...base };
  }

  return {
    ok: true,
    dir: o.side === 'buy' ? 1 : -1,
    dirTxt: o.side === 'buy' ? 'BUY' : 'SELL',
    role: o.role,
    bias,
    trigger: o.reason,
    checklist,
    trendTxt: base.trendTxt,
    structTxt: base.structTxt,
    entry: o.entryPrice,
    sl: o.sl,
    tps: [o.tp1, o.tp2, o.tp3],
    rr: o.rr,
    tpMode: o.tpMode,
    orderType: 'MARKET',
    setup: `Bot SMC · ${o.reason}`,
    reason: null,
  };
}
