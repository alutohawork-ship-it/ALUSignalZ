// lib/tp-final.js — v220
// TP per gaya (3 TP semua mode) + kopel zona + chart hint.
// v220: dinding/kolam yang JARAKNYA < 1R diabaikan saat mem-cap TP
// (tepi konsolidasi dekat bukan target; mencegah TP 22 pip vs SL 159 pip).

export const TP_PLAN = {
  Scalping: { mode: 'R',   targets: [1, 1.5, 2.5],    count: 3 },
  Intraday: { mode: 'R',   targets: [1.5, 2.5, 4],    count: 3 },
  Swing:    { mode: 'PIP', targets: [300, 600, 1000], count: 3 },
};

export const CHART_TF = { Scalping: 'm1', Intraday: 'm5', Swing: 'm15' };

export function planTPs({ style, entry, dir, risk, pip, wall, draw, dp }) {
  const plan = TP_PLAN[style] || TP_PLAN.Scalping;
  if (!(risk > 0) || !Number.isFinite(entry)) {
    return { tps: null, mode: 'INVALID', count: plan.count, runwayPip: null, pips: [], rr1: 0, poorRR: true, scaled: false };
  }

  const base = plan.mode === 'PIP'
    ? plan.targets.map(t => t * pip)
    : plan.targets.map(m => risk * m);

  // [v220] Runway hanya dari penghalang yang >= 1R; yang lebih dekat dianggap noise konsolidasi
  const runs = [];
  if (wall && Number.isFinite(wall.edge)) {
    const r1 = (wall.edge - dir * 2 * pip - entry) * dir;
    if (r1 >= risk) runs.push(r1);
  }
  if (draw && Number.isFinite(draw.price)) {
    const r2 = (draw.price - dir * 2 * pip - entry) * dir;
    if (r2 >= risk) runs.push(r2);
  }
  const runway = runs.length ? Math.min(...runs) : Infinity;
  if (runway <= 2 * pip) {
    return { tps: null, mode: 'BLOCKED', count: plan.count, runwayPip: dp(Math.max(0, runway) / pip), pips: [], rr1: 0, poorRR: true, scaled: false };
  }

  const last = base[base.length - 1];
  let d = base.slice();
  let mode = plan.mode === 'PIP' ? 'FIXED_PIP' : 'RISK_R';
  let scaled = false;

  if (runway < last) {
    if (runway >= base[0]) {
      const room = runway - base[0], span = last - base[0];
      d = base.map((v, i) => (i === 0 ? v : base[0] + room * ((v - base[0]) / span)));
      mode = 'PARTIAL_CAP';
    } else {
      const kk = runway / last;
      d = base.map(v => v * kk);
      mode = 'WALL_SCALED';
      scaled = true;
    }
  }

  const step = Math.min(runway, last) * 0.02;
  for (let i = 1; i < d.length; i++) if (d[i] <= d[i - 1]) d[i] = d[i - 1] + step;

  return {
    tps: d.map(x => entry + dir * x),
    count: plan.count,
    mode,
    scaled,
    runwayPip: Number.isFinite(runway) ? dp(runway / pip) : null,
    pips: d.map(x => dp(x / pip)),
    rr1: Number((d[0] / risk).toFixed(2)),
    poorRR: d[0] / risk < 0.8,
  };
}

export function repairTPs(sig, f, pip) {
  const plan = TP_PLAN[sig.style] || TP_PLAN.Scalping;
  const out = { ...sig };
  ['tp1', 'tp2', 'tp3', 'tp4', 'tp5'].forEach((k, i) => { if (i >= plan.count) out[k] = null; });
  out.tpCount = plan.count;

  const e = Number(sig.entry), sl = Number(sig.sl);
  if (!Number.isFinite(e) || !Number.isFinite(sl) || e === sl) return out;
  const dir = sig.signal === 'BUY' ? 1 : -1;
  const risk = Math.abs(e - sl);

  const raw = [out.tp1, out.tp2, out.tp3].map(Number);
  const bad = raw.some(v => !Number.isFinite(v) || v === 0)
    || raw.some(v => (v - e) * dir <= 0)
    || raw.some((v, i) => i > 0 && (v - raw[i - 1]) * dir <= 0);
  if (!bad) return out;

  const d = plan.mode === 'PIP' ? plan.targets.map(t => t * pip) : plan.targets.map(m => risk * m);
  ['tp1', 'tp2', 'tp3'].forEach((k, i) => { out[k] = f(e + dir * d[i]); });
  out.tpRepaired = true;
  return out;
}

export function coupleZone(zone, entry, dir, pip, atrv) {
  if (zone && Number.isFinite(zone.lo) && Number.isFinite(zone.hi) && entry >= zone.lo && entry <= zone.hi) return zone;
  const w = Math.max(0.25 * atrv, 10 * pip);
  return dir === 1
    ? { lo: entry - w * 0.4, hi: entry + w * 0.6, side: 'demand', kind: 'Entry Zone', tf: zone && zone.tf ? zone.tf : 'LTF', coupled: true }
    : { lo: entry - w * 0.6, hi: entry + w * 0.4, side: 'supply', kind: 'Entry Zone', tf: zone && zone.tf ? zone.tf : 'LTF', coupled: true };
}

export function fixSide(type, entry, dir, price, pip) {
  if (type !== 'LIMIT') return { type, entry };
  const ok = dir === 1 ? entry < price : entry > price;
  if (ok && Math.abs(price - entry) >= 2 * pip) return { type, entry };
  return { type: 'MARKET', entry: price, flipped: true };
}

export function buildChart(sig, pip, dp, f, style) {
  const e = Number(sig.entry), sl = Number(sig.sl);
  const levels = [];
  const add = (key, price, type) => {
    const v = Number(price);
    if (price === null || price === undefined || !Number.isFinite(v) || v === 0) return;
    levels.push({ key, price: f(v), type, pips: dp(Math.abs(v - e) / pip) });
  };
  add('SL', sl, 'sl');
  add('ENTRY', e, 'entry');
  [sig.tp1, sig.tp2, sig.tp3].forEach((t, i) => add('TP' + (i + 1), t, 'tp'));
  levels.sort((a, b) => b.price - a.price);

  const ps = levels.map(l => l.price);
  const mn = Math.min(...ps), mx = Math.max(...ps);
  const spanPips = dp((mx - mn) / pip);
  return {
    tf: CHART_TF[style] || 'm1',
    levels,
    range: { min: f(mn), max: f(mx), spanPips, padPips: Math.max(10, Math.round(spanPips * 0.08)) },
  };
}
