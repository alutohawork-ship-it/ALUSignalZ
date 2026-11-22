// lib/bot-engine.js — mesin bot ICT: sesi & kunci, pesan notifikasi dua bahasa, dan pelacakan trade.
// Fungsi murni, tanpa API. Dipakai oleh api/bot.js (botTick).
import { ICT_CFG } from './bot-ict.js';

export const M1 = 60e3, M5 = 5 * 60e3;
export const PIP = { XAUUSD: 0.1, BTCUSD: 1 };

// Blok sesi UTC tanpa overlap: Asia 00-07, London 07-13, New York 13-21, penutup 21-24
export function nextBlockStart(now) {
  const d = new Date(now);
  const h = d.getUTCHours();
  const next = [7, 13, 21, 24].find(s => h < s);
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return base + next * 3600e3;
}
export function blockName(now) {
  const h = new Date(now).getUTCHours();
  return h < 7 ? 'Asia' : h < 13 ? 'London' : h < 21 ? 'New York' : 'Penutup';
}
export function utcDay(now) { return new Date(now).toISOString().slice(0, 10); }

// Hanya candle yang sudah tutup
export function closedBars(rows, tfMs, now = Date.now()) {
  return rows.filter(c => c.t + tfMs <= now);
}

// ---- Kunci: aturan yang sudah disepakati ----
// - TP2 kena: kunci sampai sesi berikutnya.
// - SL pertama: boleh satu sinyal lagi.
// - Setelah SL pertama, sinyal berikutnya menang (TP1 atau BE): kunci.
// - Dua SL berturut-turut: kunci.
export function applyOutcome(state, result, now) {
  const next = { ...state };
  let lock = null;
  if (result === 'TP2') lock = 'TP2 tercapai';
  else if (result === 'SL') {
    next.consec_sl = (state.consec_sl || 0) + 1;
    if (next.consec_sl >= 2) lock = 'SL 2x berturut-turut';
  } else if (result === 'TP1' || result === 'BE') {
    if ((state.consec_sl || 0) >= 1) lock = 'TP1 setelah SL';
    else next.consec_sl = 0;
  }
  if (lock) {
    next.locked_until = nextBlockStart(now);
    next.lock_reason = lock;
    next.consec_sl = 0;
  }
  return { state: next, lock };
}

export function isLocked(state, now) {
  return !!state.locked_until && now < state.locked_until;
}

// ---- Pelacakan trade (satu posisi) ----
// trade: { dir, entry, sl, tp1, tp2, tp3, placed_at, sym }
// Fill: limit terisi saat candle M1 menyentuh entry (setelah placed_at).
export function checkFill(trade, m1Closed) {
  const eps = (PIP[trade.sym] || 0.1) * 0.5;
  const bars = m1Closed.filter(c => c.t >= trade.placed_at).sort((a, b) => a.t - b.t);
  for (const c of bars) {
    const hit = trade.dir > 0 ? c.l <= trade.entry + eps : c.h >= trade.entry - eps;
    if (hit) return { filledAt: c.t };
  }
  return null;
}

// Pelacakan posisi terbuka. Mulai dari candle M1 sesudah fill.
// Hasil: { done:false, hits } atau { done:true, result, exit, hits, pips, outcome }
export function trackTrade(trade, m1Closed) {
  const eps = (PIP[trade.sym] || 0.1) * 0.5;
  const hits = { ...(trade.hits || {}) };
  const d = trade.dir;
  const bars = m1Closed.filter(c => c.t > trade.filled_at).sort((a, b) => a.t - b.t);
  for (const c of bars) {
    const path = c.c >= c.o ? [c.o, c.l, c.h, c.c] : [c.o, c.h, c.l, c.c];
    for (const pt of path) {
      const stop = hits.tp1 ? trade.entry : trade.sl;
      const tp2 = trade.tp2 != null && (d > 0 ? pt >= trade.tp2 - eps : pt <= trade.tp2 + eps);
      const tp1 = !hits.tp1 && trade.tp1 != null && (d > 0 ? pt >= trade.tp1 - eps : pt <= trade.tp1 + eps);
      const sl = d > 0 ? pt <= stop + eps : pt >= stop - eps;
      if (tp2) return finish(trade, 'TP2', trade.tp2, { ...hits, tp1: hits.tp1 || c.t, tp2: c.t });
      if (tp1) { hits.tp1 = c.t; continue; }
      if (sl) {
        const result = hits.tp1 ? 'BE' : 'SL';
        return finish(trade, result, stop, hits);
      }
    }
  }
  return { done: false, hits };
}

function finish(trade, result, exit, hits) {
  const d = trade.dir;
  const pips = Math.round(((exit - trade.entry) * d / (PIP[trade.sym] || 0.1)) * 10) / 10;
  // outcome untuk aturan kunci: TP2 = TP2, TP1 atau BE = win TP1, SL = kalah
  const outcome = result === 'TP2' ? 'TP2' : (result === 'BE' || hits.tp1) ? 'TP1' : 'SL';
  return { done: true, result, exit, hits, pips, outcome };
}

// ---- Pesan notifikasi dua bahasa ----
const T = {
  id: {
    poi: 'Signal Z POI #{n}', limit: 'Limit', entry: 'Entry', sl: 'SL',
    cancel: '❌ Signal Z POI #{n} dibatalkan', reason: 'Alasan',
    moved: '🔄 Signal Z POI #{n} dipindah ke {kind}', newEntry: 'Entry baru',
    filled: '✅ Signal Z POI #{n} terisi di {p}', tp1: '🎯 TP1 tercapai (POI #{n})',
    tp2: '🏁 TP2 tercapai (POI #{n}), bot dikunci', sl_hit: '❌ SL kena (POI #{n})',
    be: '🟡 BE kena setelah TP1 (POI #{n})', lock: '🔒 Bot dikunci sampai {t} UTC',
    lockReason: 'Alasan kunci', noFomo: 'No FOMO / over trade. Kembali di sesi berikutnya.',
    kind: { OB: 'OB', BREAKER: 'Breaker', FVG: 'FVG' },
    pips: 'pips',
  },
  en: {
    poi: 'Signal Z POI #{n}', limit: 'Limit', entry: 'Entry', sl: 'SL',
    cancel: '❌ Signal Z POI #{n} cancelled', reason: 'Reason',
    moved: '🔄 Signal Z POI #{n} moved to {kind}', newEntry: 'New entry',
    filled: '✅ Signal Z POI #{n} filled at {p}', tp1: '🎯 TP1 hit (POI #{n})',
    tp2: '🏁 TP2 hit (POI #{n}), bot locked', sl_hit: '❌ SL hit (POI #{n})',
    be: '🟡 BE hit after TP1 (POI #{n})', lock: '🔒 Bot locked until {t} UTC',
    lockReason: 'Lock reason', noFomo: 'No FOMO / over trade. Come back next session.',
    kind: { OB: 'OB', BREAKER: 'Breaker', FVG: 'FVG' },
    pips: 'pips',
  },
};
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? v[k] : ''));
const px = v => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '-');
const hm = t => new Date(t).toISOString().slice(11, 16);

export function msgPoi(lang, sig) {
  const L = T[lang] || T.id;
  const body = [
    `${sig.sym} ${L.limit} · ${sig.side}`,
    `${L.entry} ${px(sig.entry)}`,
    `${L.sl} ${px(sig.sl)}`,
    `TP1 ${px(sig.tp1)}`,
    `TP2 ${px(sig.tp2)}`,
    `TP3 ${px(sig.tp3)}`,
  ].join('\n');
  return { title: fill(L.poi, { n: sig.poi_no }), body, tag: 'poi-' + sig.id };
}
export function msgCancel(lang, sig, reason) {
  const L = T[lang] || T.id;
  return { title: fill(L.cancel, { n: sig.poi_no }), body: `${L.reason}: ${reason}`, tag: 'poi-' + sig.id };
}
export function msgMoved(lang, sig, kind) {
  const L = T[lang] || T.id;
  return { title: fill(L.moved, { n: sig.poi_no, kind: (T[lang] || T.id).kind[kind] || kind }), body: `${L.newEntry} ${px(sig.entry)}`, tag: 'poi-' + sig.id };
}
export function msgFilled(lang, sig) {
  const L = T[lang] || T.id;
  return { title: fill(L.filled, { n: sig.poi_no, p: px(sig.entry) }), body: `${sig.symbol} ${sig.dir}`, tag: 'poi-' + sig.id };
}
export function msgResult(lang, sig, result, pips) {
  const L = T[lang] || T.id;
  const key = result === 'TP1' ? 'tp1' : result === 'TP2' ? 'tp2' : result === 'BE' ? 'be' : 'sl_hit';
  return { title: fill(L[key], { n: sig.poi_no }), body: `${pips > 0 ? '+' : ''}${pips} ${L.pips}`, tag: 'poi-' + sig.id };
}
export function msgLock(lang, until, reason) {
  const L = T[lang] || T.id;
  return { title: fill(L.lock, { t: hm(until) }), body: `${L.lockReason}: ${reason}. ${L.noFomo}`, tag: 'bot-lock' };
}
export { ICT_CFG };
