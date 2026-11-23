// lib/scalp-mtf.js — Scalping manual versi M15 + M5 langsung.
// M15 = arah (struktur BOS/CHoCH terakhir). M5 = zona entry (OB/FVG searah) dan konfirmasi struktur M5.
// Tanpa pemicu M1. Fungsi murni, tanpa API.
import { structure, findOBs, findFVGs, atrOf, isDisplacement, psychTp1 } from './bot-ict.js';

export const SMTF = {
  atrPeriod: 14,
  entryFrac: 0.4,                 // LIMIT di 40% dari tepi zona yang disentuh lebih dulu
  slBufferAtr: 0.1,
  tpR: [1, 1.5, 2, 3, 5],         // 1:1, 1:1.5, 1:2, 1:3, 1:5
  maxDistPip: { XAUUSD: 50, BTCUSD: 0.003 },       // zona boleh maksimal sejauh ini dari harga (XAU pip, BTC rasio)
  slRange: {
    XAUUSD: { minPip: 25, maxPip: 50, pip: 0.1 },
    BTCUSD: { minPct: 0.0004, maxPct: 0.0012 },
  },
  limitTtlMs: 90 * 60e3,          // pending berlaku 90 menit
};

// Batas SL dalam harga
function slBounds(sym, entry) {
  const r = SMTF.slRange[sym];
  if (sym === 'XAUUSD') return { min: r.minPip * r.pip, max: r.maxPip * r.pip };
  return { min: entry * r.minPct, max: entry * r.maxPct };
}

// Jarak dari harga ke zona, dalam satuan batas (pip XAU atau rasio BTC)
function zoneDistOk(sym, price, zone) {
  const lim = SMTF.maxDistPip[sym];
  const dist = price > zone.hi ? price - zone.hi : price < zone.lo ? zone.lo - price : 0;
  if (sym === 'XAUUSD') return dist / 0.1 <= lim;
  return dist / price <= lim;
}

// Rencana entry dari M15 (arah) dan M5 (zona + konfirmasi). Mengembalikan:
//   { status:'limit'|'none', dir, entry, sl, tps[5], zone, reason }
export function planScalpMtf({ m15, m5, price, sym, tNow = Date.now() }) {
  const none = reason => ({ status: 'none', reason });
  if (!(price > 0)) return none('harga belum ada');
  if (!SMTF.slRange[sym]) return none('pair tidak didukung');
  if (m15.length < 40 || m5.length < 60) return none('data belum cukup');

  const s15 = structure(m15);
  const dir = s15.trend;
  if (dir === 0) return none('M15 belum punya arah (tren belum jelas)');

  const s5 = structure(m5);
  const last5 = s5.lastEvent;
  if (!last5 || last5.dir !== dir) return none('struktur M5 belum searah dengan M15');

  const atr5 = atrOf(m5, SMTF.atrPeriod);
  if (!(atr5 > 0)) return none('ATR M5 belum bisa dihitung');

  // Zona M5 searah: OB (lebih dulu) lalu FVG, yang berada di sisi pullback
  const obs = findOBs(m5, dir).map(z => ({ ...z, prio: 0 }));
  const fvgs = findFVGs(m5, dir).map(z => ({ ...z, prio: 1 }));
  const cands = [...obs, ...fvgs]
    .filter(z => (dir > 0 ? z.hi < price : z.lo > price))   // BUY: zona di bawah harga; SELL: di atas harga
    .map(z => ({ kind: z.kind, lo: z.lo, hi: z.hi, prio: z.prio, t: z.t }))
    .filter(z => zoneDistOk(sym, price, z));
  if (!cands.length) return none('belum ada zona M5 searah yang dekat harga');
  cands.sort((a, b) => a.prio - b.prio || b.t - a.t);
  const z = cands[0];

  const entry = dir > 0 ? z.hi - SMTF.entryFrac * (z.hi - z.lo) : z.lo + SMTF.entryFrac * (z.hi - z.lo);
  const b = slBounds(sym, entry);
  const buf = SMTF.slBufferAtr * atr5;
  const rawSl = dir > 0 ? z.lo - buf : z.hi + buf;
  let dist = Math.abs(entry - rawSl);
  dist = Math.min(Math.max(dist, b.min), b.max);      // SL dipotong/dilebarkan ke batas
  const sl = dir > 0 ? entry - dist : entry + dist;
  if (dir > 0 ? sl >= entry : sl <= entry) return none('SL tidak valid terhadap entry');

  const tps = SMTF.tpR.map(m => entry + dir * dist * m);
  return {
    status: 'limit', dir: dir > 0 ? 'BUY' : 'SELL', entry, sl, tps,
    zone: { kind: z.kind, lo: z.lo, hi: z.hi },
    slClamped: Math.abs(Math.abs(entry - rawSl) - dist) > 1e-9,
    expiresAt: tNow + SMTF.limitTtlMs,
    reason: `M15 ${dir > 0 ? 'bullish' : 'bearish'}, M5 ${last5.type} searah, zona ${z.kind} ${z.lo.toFixed(2)}–${z.hi.toFixed(2)}`,
  };
}
