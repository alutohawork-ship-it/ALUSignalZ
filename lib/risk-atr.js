// lib/risk-atr.js — v218
// SL adaptif: ATR × sesi × skala TF + cap gaya + cap sesi (likuiditas tipis = SL lebih ketat).
// - K_TF_SCALE: M1 lebih noisy (k naik), H4/D1 lebih stabil (k turun), m30 disertakan.
// - SESSION_CAP_MULT: sesi tipis (ASIA/DEAD) memperketat cap SL secara proporsional.
// - atrOverflow: bila cap < 1.2×ATR, SL dilebarkan agar tidak berada di dalam noise.
// Dipakai oleh api/generate.js v218 via calcSL({..., tfKey}).

export const K_SESSION = {
  NY_AM_KZ: 1.8,
  LONDON_KZ: 1.9,
  LONDON_MID: 2.0,
  LONDON_CLOSE: 2.0,
  NY_PM: 2.2,
  ASIA: 2.6,
  DEAD: 3.0,
};

// Skala k berdasarkan TF tempat ATR diukur (v218: m30 ditambahkan)
export const K_TF_SCALE = {
  m1: 1.35,
  m5: 1.0,
  m15: 1.0,
  m30: 0.97,
  h1: 0.95,
  h4: 0.9,
  d1: 0.85,
};

// Pengali cap SL per sesi: likuiditas tipis = cap lebih ketat (proporsional, bukan angka mati)
export const SESSION_CAP_MULT = {
  ASIA: 0.6,
  DEAD: 0.5,
  NY_PM: 0.8,
  LONDON_CLOSE: 0.9,
  LONDON_KZ: 1.0,
  LONDON_MID: 1.0,
  NY_AM_KZ: 1.0,
};

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

  // Cap: gaya (b.max) & 3.5×ATR & pengali sesi
  const sessMult = SESSION_CAP_MULT[sess.key] ?? 1.0;
  let cap = Math.min(b.max, 3.5 * atrUse) * sessMult;

  // Guard: SL tidak boleh berada di dalam noise (minimal 1.2×ATR)
  const atrFloor = 1.2 * atrUse;
  let atrOverflow = false;
  if (cap < atrFloor) {
    cap = Math.min(atrFloor, b.max * 2);
    atrOverflow = true;
  }

  // Kebutuhan struktural: swing / kolam likuiditas / batas range + buffer
  const buf = (sess.liq >= 1.0 ? 0.15 : 0.25) * atrUse;
  const cands = [];
  const push = lvl => { if (Number.isFinite(lvl)) cands.push(Math.abs(entry - lvl) + buf); };
  push(structLevel); push(poolLevel); push(rangeBound);
  let structNeed = cands.length ? Math.max(...cands) : 0;

  // Bila invalidasi struktur jauh di luar skala cap → abaikan struktur, pakai ATR
  let structMismatch = false;
  if (structNeed > cap * 1.3) { structMismatch = true; structNeed = 0; }

  let need = Math.max(structNeed, slAtr, floor);
  let capped = false;
  if (need > cap) { need = cap; capped = true; }

  const src = structMismatch
    ? 'ATR (struktur di luar skala)'
    : (structNeed > slAtr ? 'struktur dominan' : 'ATR dominan');

  return {
    sl: entry - dir * need,
    need,
    capped,
    k,
    structMismatch,
    atrOverflow,
    riskPips: ctx.dp(need / ctx.pip),
    diag: 'k=' + k.toFixed(2) + ' (' + kBase + 'x' + tfScale + ') × ATR ' + ctx.dp(atrUse / ctx.pip)
      + ' = ' + ctx.dp(slAtr / ctx.pip)
      + ' pip | floor ' + ctx.dp(floor / ctx.pip)
      + ' | cap ' + ctx.dp(cap / ctx.pip) + ' (sesi x' + sessMult + ')'
      + ' | acuan ' + src
      + (capped ? ' | dicap' : '')
      + (atrOverflow ? ' | ATR overflow' : ''),
  };
}

export function rrCheck(need, drawDistPrice) {
  if (!(drawDistPrice > 0) || !(need > 0)) return { ok: true, rr: null, penalty: 0 };
  const rr = drawDistPrice / need;
  if (rr < 1.0) return { ok: false, rr, penalty: 12, note: 'Draw likuiditas hanya ' + rr.toFixed(2) + 'R — TP1 tidak realistis.' };
  if (rr < 1.5) return { ok: true, rr, penalty: 6, note: 'R:R tipis ' + rr.toFixed(2) + 'R ke draw terdekat.' };
  return { ok: true, rr, penalty: 0 };
}
