// lib/tp-final.js — TP ladder, perbaikan TP, pasangan zona, dan data chart untuk generate.js (v214).
// Aturan: TP semua model = kelipatan R dari risk (SL akhir). Intraday 1.5/3/5/7/10, Scalping & Swing 1..5.
// Jika zona lawan HTF/MTF (wall) atau likuiditas (draw) berada di jalur TP, ditandai runwayPip.

export const TP_PLAN = {
  Scalping: { count: 5, mode: 'RISK_R', targets: [1, 2, 3, 4, 5] },
  Intraday: { count: 5, mode: 'RISK_R', targets: [1.5, 3, 5, 7, 10] },
  Swing:    { count: 5, mode: 'RISK_R', targets: [1, 2, 3, 4, 5] },
  scalperbot: { count: 5, mode: 'RISK_R', targets: [1, 2, 3, 4, 5] },
};

const planOf = style => TP_PLAN[style] || TP_PLAN.Scalping;

// Hitung 5 TP dari entry + risk. wall/draw opsional (harga) untuk mengukur runway.
export function planTPs({ style, entry, dir, risk, pip, wall, draw, dp }) {
  const plan = planOf(style);
  if (!(risk > 0) || !Number.isFinite(entry)) return { tps: null, count: plan.count, mode: plan.mode, pips: [], rr1: 1, poorRR: true, runwayPip: null };
  const tps = plan.targets.slice(0, plan.count).map(m => entry + dir * risk * m);
  // runway: jarak ke hambatan terdekat di arah trade (zona lawan atau likuiditas draw)
  const obstacles = [wall, draw && draw.price].filter(v => Number.isFinite(v) && (dir === 1 ? v > entry : v < entry));
  const runwayPip = obstacles.length ? Math.abs(Math.min(...obstacles.map(v => Math.abs(v - entry)))) / pip : null;
  const pips = tps.map(v => (Math.abs(v - entry) / pip));
  return { tps, count: plan.count, mode: plan.mode, pips, rr1: plan.targets[0], poorRR: false, runwayPip: runwayPip == null ? null : (dp ? dp(runwayPip) : runwayPip) };
}

// Perbaiki TP pada sinyal: harus 5 angka, berurutan searah trade. Jika rusak, bangun ulang dari risk.
export function repairTPs(sig, f, pip) {
  if (!sig || !Number.isFinite(Number(sig.entry)) || !Number.isFinite(Number(sig.sl))) return sig;
  const e = Number(sig.entry), sl = Number(sig.sl);
  const dir = sig.signal === 'SELL' ? -1 : 1;
  const risk = Math.abs(e - sl);
  const plan = planOf(sig.style);
  const raw = [sig.tp1, sig.tp2, sig.tp3, sig.tp4, sig.tp5].map(v => (v == null ? NaN : Number(v)));
  const ok = raw.slice(0, plan.count).every((v, i) => Number.isFinite(v) && (dir === 1 ? v > e : v < e) && (i === 0 || (dir === 1 ? v > raw[i - 1] : v < raw[i - 1])));
  if (ok || !(risk > 0)) return sig;
  const fixed = plan.targets.slice(0, plan.count).map(m => e + dir * risk * m);
  const out = { ...sig };
  ['tp1', 'tp2', 'tp3', 'tp4', 'tp5'].forEach((k, i) => { out[k] = i < fixed.length ? f(fixed[i]) : null; });
  out.tpRepaired = true;
  return out;
}

// Pasangkan zona dengan entry: zona minimal selebar 2 pip dan tidak terbalik. Tidak menggeser harga.
export function coupleZone(zone, entry, dir, pip, atr) {
  if (!zone || !Number.isFinite(zone.lo) || !Number.isFinite(zone.hi)) return zone;
  let lo = Math.min(zone.lo, zone.hi), hi = Math.max(zone.lo, zone.hi);
  const minW = 2 * (pip || 0.1);
  if (hi - lo < minW) { const mid = (hi + lo) / 2; lo = mid - minW / 2; hi = mid + minW / 2; }
  return { ...zone, lo, hi };
}

// Pastikan sisi TP/SL sesuai arah sinyal (BUY: SL di bawah, SELL: SL di atas).
export function fixSide(sig) {
  if (!sig || !Number.isFinite(Number(sig.entry)) || !Number.isFinite(Number(sig.sl))) return sig;
  const dir = sig.signal === 'SELL' ? -1 : 1;
  const e = Number(sig.entry), sl = Number(sig.sl);
  if (dir === 1 && sl >= e) return { ...sig, sl: e - Math.abs(sl - e), sideFixed: true };
  if (dir === -1 && sl <= e) return { ...sig, sl: e + Math.abs(sl - e), sideFixed: true };
  return sig;
}

// Data chart ringkas untuk UI: timeframe tampilan per gaya dan rentang harga (pip) yang harus terlihat.
const CHART_TF = { Scalping: 'M5', Intraday: 'M15', Swing: 'H1', scalperbot: 'M1' };
export function buildChart(s, pip, dp, f, style) {
  const tps = [s.tp1, s.tp2, s.tp3, s.tp4, s.tp5].map(v => (v == null ? NaN : Number(v)));
  const far = Number.isFinite(tps[4]) ? tps[4] : (Number.isFinite(tps[2]) ? tps[2] : Number(s.entry));
  const spanPrice = Math.abs(far - Number(s.sl));
  return {
    tf: CHART_TF[style] || 'M5',
    range: { spanPips: dp ? dp(spanPrice / pip) : Math.round(spanPrice / pip), low: f ? f(Math.min(Number(s.sl), far)) : Math.min(Number(s.sl), far), high: f ? f(Math.max(Number(s.sl), far)) : Math.max(Number(s.sl), far) },
    focusEntry: f ? f(Number(s.entry)) : Number(s.entry),
  };
}
