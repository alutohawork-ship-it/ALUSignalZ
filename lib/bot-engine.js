// lib/bot-engine.js — logika bot server: deteksi sinyal (three candle) dan pelacakan TP/SL/BE
// Dipakai oleh api/bot-tick.js. Memakai runBotSma yang sama dengan bot di browser.
import { runBotSma } from './bot_3candle.js';

export const M5_MS = 5 * 60000;
const PIP = 0.1;

// Hanya candle yang sudah tutup
export function closedBars(rows, tfMs) {
  const now = Date.now();
  return rows.filter(c => c.t + tfMs <= now);
}

export function detectSignal(m5Closed, price, prevCandleT) {
  return runBotSma({ m5: m5Closed }, { price, dec: 2, pip: PIP, symbol: 'XAUUSD', prevCandleT });
}

// Evaluasi satu sinyal terhadap candle M1 yang sudah tutup sejak candle sinyal.
// Urutan titik dalam candle sama dengan replay di browser (O-L-H-C atau O-H-L-C).
// Mengembalikan { status, result, exit, hits, pips } jika sudah selesai, atau null jika masih berjalan.
export function trackSignal(sig, m1Closed) {
  const hits = { ...(sig.hits || {}) };
  const d = sig.dir;
  const eps = PIP * 0.5;
  const fromT = Number(sig.candle_t) + M5_MS;
  const bars = m1Closed.filter(c => c.t >= fromT).sort((a, b) => a.t - b.t);
  for (const c of bars) {
    const path = c.c >= c.o ? [c.o, c.l, c.h, c.c] : [c.o, c.h, c.l, c.c];
    for (const pt of path) {
      const stop = hits.tp1 ? sig.entry : sig.sl;
      const tpHit = sig.tp1 != null && (d > 0 ? pt >= sig.tp1 - eps : pt <= sig.tp1 + eps);
      const slHit = d > 0 ? pt <= stop + eps : pt >= stop - eps;
      if (tpHit) { hits.tp1 = c.t; return finish(sig, 'TP', sig.tp1, hits); }
      if (slHit) return finish(sig, hits.tp1 ? 'BE' : 'SL', stop, hits);
    }
  }
  return null;
}

function finish(sig, result, exit, hits) {
  const pips = Math.round(((exit - sig.entry) * sig.dir / PIP) * 10) / 10;
  return { status: 'closed', result, exit, hits, pips };
}
