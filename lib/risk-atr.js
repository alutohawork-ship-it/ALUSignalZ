// lib/risk-atr.js — SL adaptif ATR × sesi × TF
export const K_SESSION = {
  NY_AM_KZ: 1.8, LONDON_KZ: 1.9, LONDON_MID: 2.0, LONDON_CLOSE: 2.0,
  NY_PM: 2.2, ASIA: 2.6, DEAD: 3.0,
};

export const K_TF_SCALE = { m1: 1.35, m5: 1.0, m15: 1.0, h1: 0.95, h4: 0.9, d1: 0.85 };

export function atrSanity(atrNow, atrBase) {
  if (!(atrBase > 0)) return atrNow;
  return Math.max(0.6 * atrBase, Math.min(2.0 * atrBase, atrNow));
}

export function calcSL({ entry, dir, ctx, b, sess, atrUse, structLevel, poolLevel, rangeBound, tfKey }) {
  const kBase = K_SESSION[sess.key] || 2.2;
  const tfScale = K_TF_SCALE[tfKey || 'm5'] || 1.0;
  const k = kBase * tfScale;
  
  const slAtr = k * atrUse;
  const floor = Math.max(0.8 * atrUse, b.min * 0.6);

  let cap = Math.min(b.max, 3.5 * atrUse);
  const atrFloor = 1.2 * atrUse;
  let atrOverflow = false;
  if (cap < atrFloor) { cap = Math.min(atrFloor, b.max * 2); atrOverflow = true; }

  const buf = (sess.liq >= 1.0 ? 0.15 : 0.25) * atrUse;
  const cands = [];
  const push = lvl => { if (Number.isFinite(lvl)) cands.push(Math.abs(entry - lvl) + buf); };
  push(structLevel); push(poolLevel); push(rangeBound);
  let structNeed = cands.length ? Math.max(...cands) : 0;

  let structMismatch = false;
  if (structNeed > cap * 1.3) { structMismatch = true; structNeed = 0; }

  let need = Math.max(structNeed, slAtr, floor);
  let capped = false;
  if (need > cap) { need = cap; capped = true; }

  const src = structMismatch ? 'ATR (struktur di luar skala)' : (structNeed > slAtr ? 'struktur dominan' : 'ATR dominan');
  return {
    sl: entry - dir * need, need, capped, k, structMismatch, atrOverflow,
    riskPips: ctx.dp(need / ctx.pip),
    diag: 'k=' + k.toFixed(2) + ' (' + kBase + 'x' + tfScale + ') × ATR ' + ctx.dp(atrUse / ctx.pip) + ' = ' + ctx.dp(slAtr / ctx.pip)
        + ' pip | floor ' + ctx.dp(floor / ctx.pip) + ' | cap ' + ctx.dp(cap / ctx.pip)
        + ' | acuan ' + src + (capped ? ' | dicap' : '') + (atrOverflow ? ' | ATR overflow' : ''),
  };
}

export function rrCheck(need, drawDistPrice) {
  if (!(drawDistPrice > 0) || !(need > 0)) return { ok: true, rr: null, penalty: 0 };
  const rr = drawDistPrice / need;
  if (rr < 1.0) return { ok: false, rr, penalty: 12, note: 'Draw likuiditas hanya ' + rr.toFixed(2) + 'R — TP1 tidak realistis.' };
  if (rr < 1.5) return { ok: true, rr, penalty: 6, note: 'R:R tipis ' + rr.toFixed(2) + 'R ke draw terdekat.' };
  return { ok: true, rr, penalty: 0 };
}
