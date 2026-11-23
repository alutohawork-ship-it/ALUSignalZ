// lib/mtf-engine.js — Intraday, Swing, dan Scalping (M1 cadangan) berbasis multi-timeframe.
//   Intraday : bias H4 -> H1 searah -> zona M15 -> entry M5
//   Swing    : bias D1 -> H4 searah -> zona H1 -> entry M15
//   Scalping : bias M15 -> zona M5 -> entry M5 (BOS M5 searah)
//              cadangan (wajib sinyal): bias M15 -> zona M1 -> entry M1
// Fungsi murni. Dipakai oleh generate.js.
import { structure, findOBs, findFVGs, atrOf } from './bot-ict.js';

export const MTF = {
  entryFrac: 0.4,
  slBufferAtr: 0.1,
  tpR: [1, 1.5, 2, 3, 5],
  limitTtlMs: { Scalping: 90 * 60e3, Intraday: 8 * 3600e3, Swing: 30 * 24 * 3600e3 },
  // batas SL per gaya
  scalpGold: { minPip: 25, maxPip: 50, pip: 0.1 },
  scalpBtc: { minPct: 0.0004, maxPct: 0.0012 },
  ladderSlAtr: { minMult: 1, maxMult: 3 },     // Intraday/Swing: SL dalam 1x sampai 3x ATR TF poi
  zoneMaxAtr: 2,                               // zona boleh maksimal 2x ATR dari harga
};

const ATR = (rows, p = 14) => atrOf(rows, p);

// Klasifikasi kondisi satu timeframe terhadap arah yang dipilih (dir)
//   BOS searah      -> kontinuitas
//   CHoCH searah    -> reversal yang sudah terkonfirmasi ke arah dir
//   event melawan   -> retracement / pullback melawan arah
function tfCondition(rows, dir) {
  const ev = structure(rows).lastEvent;
  if (!ev) return 'belum ada struktur jelas';
  if (ev.dir === dir) return ev.type === 'CHoCH' ? 'reversal terkonfirmasi searah' : 'kontinuitas (BOS searah)';
  return ev.type === 'CHoCH' ? 'reversal melawan arah (waspada)' : 'retracement melawan arah';
}
const dirWord = d => (d > 0 ? 'bullish' : 'bearish');

function slBoundsScalp(sym, entry) {
  if (sym === 'XAUUSD') return { min: MTF.scalpGold.minPip * MTF.scalpGold.pip, max: MTF.scalpGold.maxPip * MTF.scalpGold.pip };
  return { min: entry * MTF.scalpBtc.minPct, max: entry * MTF.scalpBtc.maxPct };
}

// Ambil zona POI/entry searah di sisi pullback, terdekat dari harga
function pickZone(rows, dir, price) {
  const obs = findOBs(rows, dir).map(z => ({ ...z, prio: 0 }));
  const fvg = findFVGs(rows, dir).map(z => ({ ...z, prio: 1 }));
  const c = [...obs, ...fvg]
    .filter(z => (dir > 0 ? z.lo <= price : z.hi >= price))   // zona di sisi pullback, atau harga sudah di dalam zona
    .map(z => ({ kind: z.kind, lo: z.lo, hi: z.hi, prio: z.prio, t: z.t }));
  c.sort((a, b) => a.prio - b.prio || Math.abs(price - (a.lo + a.hi) / 2) - Math.abs(price - (b.lo + b.hi) / 2));
  return c[0] || null;
}

function build({ style, sym, dir, zone, atrExec, atrSl, price, tNow }) {
  const inside = price >= zone.lo && price <= zone.hi;
  // Harga sudah di dalam zona -> NOW (MARKET) di harga live. Di luar zona -> LIMIT 40% dari tepi.
  const entry = inside ? price : (dir > 0 ? zone.hi - MTF.entryFrac * (zone.hi - zone.lo) : zone.lo + MTF.entryFrac * (zone.hi - zone.lo));
  const raw = dir > 0 ? zone.lo - MTF.slBufferAtr * atrExec : zone.hi + MTF.slBufferAtr * atrExec;
  let dist = Math.abs(entry - raw);
  let b;
  if (style === 'Scalping') b = slBoundsScalp(sym, entry);
  else b = { min: MTF.ladderSlAtr.minMult * atrSl, max: MTF.ladderSlAtr.maxMult * atrSl };
  dist = Math.min(Math.max(dist, b.min), b.max);
  const sl = dir > 0 ? entry - dist : entry + dist;
  const tps = MTF.tpR.map(m => entry + dir * dist * m);
  return {
    status: 'limit', orderType: inside ? 'MARKET' : 'LIMIT', style, dir: dir > 0 ? 'BUY' : 'SELL', entry, sl, tps,
    zone: { kind: zone.kind, lo: zone.lo, hi: zone.hi },
    expiresAt: tNow + MTF.limitTtlMs[style],
  };
}

// Ladder umum: bias -> aligned -> POI -> entry
function ladder({ style, sym, biasRows, midRows, poiRows, execRows, price, tNow, midTfName, requireMid = true }) {
  const none = reason => ({ status: 'none', reason });
  const bias = structure(biasRows).trend;
  if (bias === 0) return none(`${midTfName.bias} belum punya arah`);
  const mid = structure(midRows).lastEvent;
  if (requireMid) {
    if (!mid || mid.dir !== bias) return none(`${midTfName.mid} belum searah dengan bias`);
  } else if (mid && mid.dir === -bias) {
    return none(`${midTfName.mid} sedang berbalik melawan bias`);
  }
  const atrPoi = ATR(poiRows);
  const atrExec = ATR(execRows);
  if (!(atrPoi > 0) || !(atrExec > 0)) return none('ATR belum bisa dihitung');
  const poi = pickZone(poiRows, bias, price);
  if (!poi) return none(`belum ada zona ${midTfName.poi} searah yang dekat harga`);
  if (Math.abs(price - (poi.lo + poi.hi) / 2) > MTF.zoneMaxAtr * atrPoi) return none(`zona ${midTfName.poi} terlalu jauh`);
  // entry: zona exec yang berada di dalam POI
  const ex = pickZone(execRows, bias, price);
  const inside = ex && ex.hi >= poi.lo && ex.lo <= poi.hi;
  const zone = inside ? { kind: ex.kind, lo: Math.max(ex.lo, poi.lo), hi: Math.min(ex.hi, poi.hi) } : { kind: poi.kind, lo: poi.lo, hi: poi.hi };
  const plan = build({ style, sym, dir: bias, zone, atrExec, atrSl: atrPoi, price, tNow });
  const dirTxt = bias > 0 ? 'bullish' : 'bearish';
  const zoneTxt = `${poi.kind} ${poi.lo.toFixed(2)}–${poi.hi.toFixed(2)}`;
  const execTxt = plan.orderType === 'MARKET' ? 'harga sudah di dalam zona, NOW' : 'entry LIMIT 40% dari tepi zona';
  const steps = [
    { tf: midTfName.bias, text: `${dirTxt} · ${tfCondition(biasRows, bias)}` },
    { tf: midTfName.mid, text: `${tfCondition(midRows, bias)}` },
  ];
  if (midTfName.poi === midTfName.exec) steps.push({ tf: midTfName.poi, text: `zona ${zoneTxt}, ${execTxt}` });
  else { steps.push({ tf: midTfName.poi, text: `zona ${zoneTxt}` }); steps.push({ tf: midTfName.exec, text: execTxt }); }
  plan.steps = steps;
  plan.reason = `${midTfName.bias} ${dirTxt}, zona ${midTfName.poi} ${poi.kind}, ${plan.orderType === 'MARKET' ? 'NOW' : 'LIMIT'} di ${midTfName.exec}`;
  return plan;
}

export function planIntraday({ h4, h1, m15, m5, price, sym, tNow = Date.now() }) {
  return ladder({
    style: 'Intraday', sym, biasRows: h4, midRows: h1, poiRows: m15, execRows: m5, price, tNow,
    midTfName: { bias: 'H4', mid: 'H1', poi: 'M15', exec: 'M5' },
  });
}

export function planSwing({ d1, h4, h1, m15, price, sym, tNow = Date.now() }) {
  return ladder({
    style: 'Swing', sym, biasRows: d1, midRows: h4, poiRows: h1, execRows: m15, price, tNow,
    midTfName: { bias: 'D1', mid: 'H4', poi: 'H1', exec: 'M15' },
  });
}

// Scalping: M15 -> M5 BOS searah + zona M5 -> entry M5. Jika tidak ada: cadangan zona M1 (wajib sinyal).
export function planScalping({ m15, m5, m1, price, sym, tNow = Date.now() }) {
  const primary = ladder({
    style: 'Scalping', sym, biasRows: m15, midRows: m5, poiRows: m5, execRows: m5, price, tNow,
    midTfName: { bias: 'M15', mid: 'M5', poi: 'M5', exec: 'M5' }, requireMid: false,
  });
  if (primary.status === 'limit') return { ...primary, source: 'M15+M5' };
  return { ...planScalpFallbackM1({ m15, m5, m1, price, sym, tNow }), source: 'M1 cadangan', primaryReason: primary.reason };
}

// Cadangan M1: arah dari M15 (atau M5/M1 jika M15 kosong). Zona M1 terdekat; jika tidak ada, swing M1 terakhir.
export function planScalpFallbackM1({ m15, m5, m1, price, sym, tNow = Date.now() }) {
  const dir = [structure(m15).trend, structure(m5).trend, structure(m1).trend].find(d => d !== 0) || (price >= m1[m1.length - 1].c ? -1 : 1);
  const atrM1 = ATR(m1) || Math.abs(price) * 0.0005;
  let zone = pickZone(m1, dir, price);
  if (!zone) {
    const look = m1.slice(-40);
    const ext = dir > 0 ? Math.min(...look.map(c => c.l)) : Math.max(...look.map(c => c.h));
    zone = dir > 0
      ? { kind: 'Swing M1', lo: ext, hi: ext + 0.5 * atrM1 }
      : { kind: 'Swing M1', lo: ext - 0.5 * atrM1, hi: ext };
  }
  const plan = build({ style: 'Scalping', sym, dir, zone, atrExec: atrM1, atrSl: atrM1, price, tNow });
  plan.steps = [
    { tf: 'M15', text: `${dirWord(dir)} · ${tfCondition(m15, dir)}` },
    { tf: 'M5', text: `${tfCondition(m5, dir)}` },
    { tf: 'M1', text: `cadangan, zona ${zone.kind} ${zone.lo.toFixed(2)}–${zone.hi.toFixed(2)}` },
    { tf: 'M1', text: plan.orderType === 'MARKET' ? 'harga sudah di dalam zona, NOW' : 'entry LIMIT 40% dari tepi zona' },
  ];
  plan.reason = `cadangan M1: arah ${dir > 0 ? 'BUY' : 'SELL'} dari M15/M5, zona M1 ${zone.kind}, ${plan.orderType === 'MARKET' ? 'NOW' : 'LIMIT'}`;
  return plan;
}
