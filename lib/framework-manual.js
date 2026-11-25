// lib/framework-manual.js — LTF DINAMIS v1
// Menentukan kapan LTF boleh memimpin arah (counter-HTF) vs hanya jadi trigger.
// Aturan: LTF fresh + zona LTF searah dalam PROX + runway bersih dari tembok HTF/MTF.

export const TF_ROLE = {
  Scalping: { htf: 'h1', mtf: 'm15', ltf: 'm5', exec: 'm1' },
  Intraday: { htf: 'h4', mtf: 'm15', ltf: 'm5', exec: null },
  Swing:    { htf: 'd1', mtf: 'h4',  ltf: 'h1', exec: null },
};
export const PROX = { Scalping: 50, Intraday: 80, Swing: 200 };

const lab = tf => String(tf || '').toUpperCase();
const sideOf = dir => (dir === 1 ? 'demand' : 'supply');
const oppOf = dir => (dir === 1 ? 'supply' : 'demand');

// Jarak harga ke tepi PROXIMAL zona (pip). 0 = inside. Negatif = zona sudah terlewati.
export function zoneDist(ctx, z, dir) {
  if (ctx.price >= z.lo && ctx.price <= z.hi) return 0;
  const edge = dir === 1 ? z.hi : z.lo;
  return ((ctx.price - edge) * dir) / ctx.pip;
}

// Tembok terdekat: zona HTF/MTF BERLAWANAN yang berada DI DEPAN harga (sisi target).
export function nearestWall(ctx, dir, zones, htfTf, mtfTf) {
  const want = oppOf(dir);
  const H = lab(htfTf), M = lab(mtfTf);
  let best = null;
  for (const z of zones) {
    if (z.side !== want) continue;
    const tf = lab(z.tf);
    if (tf !== H && tf !== M) continue; // hanya HTF/MTF yang jadi tembok
    const edge = dir === 1 ? z.lo : z.hi; // tepi yang menghadap harga
    const distPip = ((edge - ctx.price) * dir) / ctx.pip;
    if (distPip <= 0) continue; // di belakang, bukan tembok
    if (!best || distPip < best.distPip) best = { zone: z, edge, distPip };
  }
  return best;
}

// Resolver arah dinamis.
export function resolveBias({ ht, it, lt, zones, ctx, style, atrM15, slPips, allowCounter = true }) {
  const role = TF_ROLE[style] || TF_ROLE.Scalping;
  const prox = PROX[style] || 50;
  const htfDir = ht.dir || it.dir || lt.dir || 1;

  // Gate runway: bersihkan jalur minimal max(3x ATR M15, 1.2R)
  const clearNeed = Math.max((3 * atrM15) / ctx.pip, 1.2 * slPips);

  const ltfDir = lt.dir;
  const ltfFresh = !!lt.fresh && ltfDir !== 0;
  const L = lab(role.ltf);
  const nearLtf = zones
    .filter(z => lab(z.tf) === L && z.side === sideOf(ltfDir))
    .map(z => ({ z, d: zoneDist(ctx, z, ltfDir) }))
    .filter(x => x.d >= 0 && x.d <= prox) // <= PROX, BUKAN harus inside
    .sort((a, b) => a.d - b.d)[0] || null;

  const wallLtf = nearestWall(ctx, ltfDir, zones, role.htf, role.mtf);
  const runwayOk = !wallLtf || wallLtf.distPip >= clearNeed;

  // 1) LTF searah HTF → trigger normal (perilaku lama)
  if (ltfDir !== 0 && ltfDir === htfDir) {
    return { dir: htfDir, mode: 'HTF_LEAD', ltfRole: 'TRIGGER', penalty: 0, forcedLow: false,
             zone: nearLtf ? nearLtf.z : null, wall: wallLtf, clearNeed };
  }

  // 2) LTF fresh + zona dekat + runway bersih → LTF MEMIMPIN (counter-HTF)
  if (allowCounter && ltfFresh && nearLtf && runwayOk) {
    const mtfAgrees = it.dir === ltfDir;
    return { dir: ltfDir, mode: 'LTF_COUNTER', ltfRole: 'LEAD',
             penalty: mtfAgrees ? 10 : 20, forcedLow: !mtfAgrees, mtfAgrees,
             zone: nearLtf.z, zoneDistPip: nearLtf.d, wall: wallLtf, clearNeed };
  }

  // 3) Fallback: HTF memimpin, LTF tunggu
  return { dir: htfDir, mode: 'HTF_LEAD', ltfRole: 'WAIT', penalty: 0, forcedLow: false,
           zone: null, wall: nearestWall(ctx, htfDir, zones, role.htf, role.mtf), clearNeed };
}

// Guardrail R:R — counter-HTF dengan runway < 1R ditolak.
export function counterGuard(bias, slPips) {
  if (bias.mode !== 'LTF_COUNTER') return { ok: true };
  if (!bias.wall) return { ok: true };
  if (bias.wall.distPip < slPips) {
    return { ok: false, reason: 'Runway ' + Math.round(bias.wall.distPip) + ' pip < 1R (' + slPips + ' pip) — R:R tidak layak, kembali ke bias HTF.' };
  }
  return { ok: true };
}

// Potong TP di tembok. Kalau TP1 sudah mentok → redistribusi fraksi runway (TP tetap 5 level berbeda).
export function capTPs({ tps, entry, dir, wall, ctx, mode }) {
  if (!wall) return { tps, capped: false };
  const limit = wall.edge - dir * 2 * ctx.pip; // berhenti 2 pip sebelum tembok
  const runway = (limit - entry) * dir;
  if (runway <= 2 * ctx.pip) return { tps, capped: false, blocked: true };

  const raw = tps.map(t => (((t - entry) * dir > runway) ? limit : t));
  const tp1Clamped = (raw[0] - entry) * dir >= runway - ctx.pip;

  if (tp1Clamped && mode === 'LTF_COUNTER') {
    const fr = [0.4, 0.6, 0.8, 0.95, 1.0];
    return { tps: fr.map(f => entry + dir * runway * f), capped: true, redistributed: true,
             runwayPip: ctx.dp(runway / ctx.pip) };
  }
  return { tps: raw, capped: raw.some((t, i) => t !== tps[i]), runwayPip: ctx.dp(runway / ctx.pip) };
}

// Penalti conviction + cap LOW untuk counter-HTF murni.
export function adjustConviction(base, bias, tps, entry, dir) {
  let c = base - (bias.penalty || 0);
  let wallInPath = false;
  if (bias.wall && Array.isArray(tps) && tps.length) {
    const tp3 = tps[2] != null ? tps[2] : tps[tps.length - 1];
    wallInPath = (bias.wall.edge - entry) * dir <= (tp3 - entry) * dir;
    if (wallInPath) c -= 10;
  }
  if (bias.mode === 'LTF_COUNTER' && bias.forcedLow) c = Math.min(c, 54);
  return { conviction: Math.max(0, Math.min(100, Math.round(c))), wallInPath };
}

// Expiry dipendekkan untuk counter-HTF (momentum cepat mati).
export function counterExpiry(style) {
  const m = {
    Scalping: { candles: 6, tf: 'M5', minutes: 30 },
    Intraday: { candles: 6, tf: 'M15', minutes: 90 },
    Swing:    { candles: 6, tf: 'H1', minutes: 360 },
  };
  const e = m[style] || m.Scalping;
  return { ...e,
    id: 'Counter-HTF: auto-cancel ' + e.candles + ' candle ' + e.tf + ' (' + e.minutes + ' menit) atau SL tertembus lebih dulu.',
    en: 'Counter-HTF: auto-cancel ' + e.candles + ' ' + e.tf + ' candles (' + e.minutes + ' min) or SL hit first.' };
}
