// lib/ltf-dynamic.js — LTF dinamis: deteksi inducement (sapuan swing minor), SHIFT, RETURN ke POI, dan SL presisi.
// Urutan (SHORT/LONG sesuai dir): IDLE -> INDUCEMENT -> SHIFT -> RETURN -> ENTRY.
//   INDUCEMENT : LTF menyapu swing minor berlawanan arah trade (jebakan likuiditas).
//   SHIFT      : setelah sapuan, struktur LTF bergeser searah trade (CHoCH/BOS).
//   RETURN     : harga kembali menyentuh POI (zona) yang terbentuk dari impuls shift.
//   ENTRY      : hanya setelah RETURN. Jika harga lari tanpa RETURN -> 'chase' (conviction turun).

export const LTF_TF = { Scalping: 'm1', Intraday: 'm5', Swing: 'h1', scalperbot: 'm1' };

function swingsOf(rows, L = 2) {
  const hs = [], ls = [];
  for (let i = L; i < rows.length - L; i++) {
    let ih = true, il = true;
    for (let j = 1; j <= L; j++) {
      if (rows[i].h <= rows[i - j].h || rows[i].h <= rows[i + j].h) ih = false;
      if (rows[i].l >= rows[i - j].l || rows[i].l >= rows[i + j].l) il = false;
    }
    if (ih) hs.push({ i, p: rows[i].h }); if (il) ls.push({ i, p: rows[i].l });
  }
  return { hs, ls };
}

// Deteksi sapuan inducement terbaru melawan arah dir (dir=1 BUY: sapuan swing low minor).
export function detectInducement(rows, dir, lookback = 30) {
  if (!Array.isArray(rows) || rows.length < 12) return null;
  const { hs, ls } = swingsOf(rows.slice(-Math.max(lookback, 12)));
  const a = rows.slice(-Math.max(lookback, 12));
  const pool = dir === 1 ? ls : hs;
  for (let k = a.length - 1; k >= 0; k--) {
    const c = a[k];
    for (const s of pool) {
      if (s.i >= k - 1) continue;
      const swept = dir === 1 ? (c.l < s.p && c.c > s.p) : (c.h > s.p && c.c < s.p);
      if (swept) return { level: s.p, i: k, t: c.t };
    }
  }
  return null;
}

// Shift searah setelah index idx: BOS/CHoCH naik (dir=1) atau turun (dir=-1).
export function detectShiftAfter(rows, dir, idx) {
  const { hs, ls } = swingsOf(rows);
  const pool = dir === 1 ? hs : ls;
  const ref = pool.filter(s => s.i < idx).sort((x, y) => y.i - x.i)[0];
  if (!ref) return null;
  for (let k = idx + 1; k < rows.length; k++) {
    const c = rows[k].c;
    if (dir === 1 ? c > ref.p : c < ref.p) return { level: ref.p, i: k, t: rows[k].t };
  }
  return null;
}

// Mesin fase LTF. poi = { lo, hi } (zona HTF/MTF yang sedang ditunggu). Mengembalikan fase & catatan.
export function monitorLTFStructure(rows, dir, poi) {
  const out = { phase: 'IDLE', chase: false, inducement: null, shift: null, returned: false, note: '' };
  if (!Array.isArray(rows) || rows.length < 12) { out.note = 'data LTF belum cukup'; return out; }
  const ind = detectInducement(rows, dir);
  out.inducement = ind;
  if (!ind) { out.note = 'belum ada inducement'; return out; }
  out.phase = 'INDUCEMENT';
  const shift = detectShiftAfter(rows, dir, ind.i);
  if (!shift) { out.note = 'inducement terjadi, menunggu shift'; return out; }
  out.phase = 'SHIFT'; out.shift = shift;
  const after = rows.slice(shift.i);
  const touched = poi && after.some(c => c.l <= poi.hi && c.h >= poi.lo);
  if (touched) { out.phase = 'RETURN'; out.returned = true; out.note = 'harga kembali ke POI setelah shift'; }
  else {
    const last = rows[rows.length - 1].c;
    const far = poi ? (dir === 1 ? last - poi.hi : poi.lo - last) : 0;
    out.chase = far > 0;
    out.note = out.chase ? 'shift tanpa retrace ke POI: chase (conviction turun)' : 'menunggu retrace ke POI';
  }
  return out;
}

// Zona entry valid: ada, tidak terbalik, tidak terlalu jauh dari harga (> 3 ATR LTF).
export function validateEntryZone(zone, price, dir, pip, atr) {
  if (!zone || !Number.isFinite(zone.lo) || !Number.isFinite(zone.hi)) return { ok: false, why: 'zona kosong' };
  if (zone.hi <= zone.lo) return { ok: false, why: 'zona terbalik' };
  const far = dir === 1 ? price - zone.hi : zone.lo - price;
  if (far > 3 * (atr || pip * 10)) return { ok: false, why: 'zona terlalu jauh (>3 ATR LTF)' };
  return { ok: true, why: 'zona valid' };
}

// SL presisi: di balik swing LTF terakhir yang tidak tertembus setelah entry, plus buffer 0.1 ATR LTF.
export function calculatePreciseSL(rows, dir, entry, pip, atr) {
  if (!Array.isArray(rows) || rows.length < 8) return null;
  const a = rows.slice(-12);
  const level = dir === 1 ? Math.min(...a.map(c => c.l)) : Math.max(...a.map(c => c.h));
  const buf = 0.1 * (atr || pip * 10);
  const sl = dir === 1 ? level - buf : level + buf;
  if (dir === 1 ? sl >= entry : sl <= entry) return null;
  return { sl, level };
}
