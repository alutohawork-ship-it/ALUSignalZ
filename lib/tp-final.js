export function buildChart(sig, pip, dp, f) {
  const e = Number(sig.entry), sl = Number(sig.sl);
  const dir = sig.signal === 'BUY' ? 1 : -1;
  const tps = [sig.tp1, sig.tp2, sig.tp3, sig.tp4, sig.tp5].map(Number);

  const levels = [];
  const add = (key, price, type) => {
    if (!Number.isFinite(price)) return;
    levels.push({ key, price: f(price), type, pipsFromEntry: dp(Math.abs(price - e) / pip) });
  };
  add('SL', sl, 'sl');
  add('ENTRY', e, 'entry');
  tps.forEach((t, i) => add('TP' + (i + 1), t, 'tp'));
  levels.sort((a, b) => b.price - a.price);

  const prices = levels.map(l => l.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  const spanPip = dp((max - min) / pip);

  const duplicateTP = tps.some((t, i) => i > 0 && Math.abs(t - tps[i - 1]) < pip * 0.5);
  const nonMonotonic = tps.some((t, i) => i > 0 && (t - tps[i - 1]) * dir <= 0);

  return {
    levels,
    range: { min: f(min), max: f(max), spanPip, padPip: Math.max(10, Math.round(spanPip * 0.08)) },
    warnings: { duplicateTP, nonMonotonic, wideSpan: spanPip > 400 },
  };
}
