// qc_real.mjs — QC probabilitas sinyal manual Scalping dari CSV MetaTrader (M1)
// Pemakaian: node qc_real.mjs data_xauusd_m1.csv [--tz 2] [--stride 1]
//   --tz     : offset jam server broker terhadap UTC (MetaTrader sering GMT+2 atau GMT+3)
//   --stride : langkah replay per M1 (1 = setiap candle)
// Letakkan file ini di folder yang sama dengan folder lib/ (berisi manual_scalp.js).
import { readFileSync, writeFileSync } from 'fs';
import { generateManualPlan, structureEvents, getSwings, calcATR } from './lib/manual_scalp.js';

const args = process.argv.slice(2);
const file = args[0];
if (!file) { console.error('pakai: node qc_real.mjs <file.csv> [--tz 2] [--stride 1]'); process.exit(1); }
const argNum = (name, def) => { const i = args.indexOf(name); return i > 0 ? Number(args[i + 1]) : def; };
const TZ = argNum('--tz', 0);
const STRIDE = argNum('--stride', 1);
const PIP = Number(process.env.PIP || 0.1);
const EXPIRY_BARS = Number(process.env.EXPIRY || 10);   // expiry order LIMIT dalam candle M1
const HORIZON = 60;       // jendela forward untuk melihat SL/TP

function parseCsv(path) {
  const bars = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = line.trim().split(/[\t,;]/).map(x => x.trim());
    let dateStr, timeStr, vals;
    if (/^\d{4}[.\-\/]\d{2}[.\-\/]\d{2}$/.test(f[0]) && /^\d{1,2}:\d{2}/.test(f[1] || '')) { dateStr = f[0]; timeStr = f[1]; vals = f.slice(2, 6); }
    else if (/^\d{4}[.\-\/]\d{2}[.\-\/]\d{2}[ T]\d{1,2}:\d{2}/.test(f[0])) { [dateStr, timeStr] = f[0].split(/[ T]/); vals = f.slice(1, 5); }
    else continue; // header atau baris tidak valid dilewati
    const [y, mo, d] = dateStr.split(/[.\-\/]/).map(Number);
    const [hh, mi] = timeStr.split(':').map(Number);
    const t = Date.UTC(y, mo - 1, d, hh, mi) - TZ * 3600e3;
    const [o, h, l, c] = vals.map(Number);
    if (![t, o, h, l, c].every(Number.isFinite)) continue;
    bars.push({ t, o, h, l, c });
  }
  return bars.sort((a, b) => a.t - b.t);
}

// Agregasi M1 ke TF lain. closeIdx = indeks M1 pertama bucket berikutnya (bar dianggap tertutup saat itu)
function buildTf(m1, minutes) {
  const ms = minutes * 60e3, out = []; let cur = null;
  m1.forEach((b, i) => {
    const key = Math.floor(b.t / ms);
    if (!cur || cur.key !== key) {
      if (cur) cur.bar.closeIdx = i;
      cur = { key, bar: { t: key * ms, o: b.o, h: b.h, l: b.l, c: b.c, closeIdx: Infinity } };
      out.push(cur.bar);
    } else { cur.bar.h = Math.max(cur.bar.h, b.h); cur.bar.l = Math.min(cur.bar.l, b.l); cur.bar.c = b.c; }
  });
  return out;
}
const toD = bars => bars.map(b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c }));
const lastOf = a => (a && a.length ? a[a.length - 1] : null);

// FVG belum terisi di sisi searah yang overlap dengan [lo, hi]
function fvgOverlap(c, side, lo, hi) {
  for (let i = Math.max(2, c.length - 40); i < c.length; i++) {
    const a = c[i - 2], b = c[i];
    let bot, top;
    if (side === 'buy' && a.high < b.low) { bot = a.high; top = b.low; }
    else if (side === 'sell' && a.low > b.high) { bot = b.high; top = a.low; }
    else continue;
    let filled = false;
    for (let j = i + 1; j < c.length; j++) if (side === 'buy' ? c[j].low <= bot : c[j].high >= top) { filled = true; break; }
    if (!filled && top >= lo && bot <= hi) return true;
  }
  return false;
}

const m1 = parseCsv(file);
if (m1.length < 1000) { console.error(`data terlalu sedikit (${m1.length} candle). Cek format CSV.`); process.exit(1); }
const arr = { m5: buildTf(m1, 5), m15: buildTf(m1, 15), h1: buildTf(m1, 60), h4: buildTf(m1, 240), d1: buildTf(m1, 1440) };
const N = { m5: 200, m15: 200, h1: 100, h4: 80, d1: 60 };
const ptr = { m5: 0, m15: 0, h1: 0, h4: 0, d1: 0 };
const lastSeen = new Map();
const rows = [];
let steps = 0;

for (let s = 300; s < m1.length - HORIZON - 1; s += STRIDE) {
  steps++;
  for (const k of Object.keys(ptr)) while (ptr[k] < arr[k].length && arr[k][ptr[k]].closeIdx <= s) ptr[k]++;
  const view = k => arr[k].slice(Math.max(0, ptr[k] - N[k]), ptr[k]);
  const m1w = m1.slice(Math.max(0, s - 199), s + 1);
  const price = m1[s].c;
  let mp;
  try {
    mp = generateManualPlan({ m1: m1w, m5: view('m5'), m15: view('m15'), h1: view('h1'), h4: view('h4'), d1: view('d1'),
      tickSize: 0.01, now: m1[s].t, price, pip: PIP, rr: 1, symbol: 'XAUUSD' }, 'Scalping');
  } catch { continue; }
  if (!mp || !mp.ok || !mp.order) continue;

  const o = mp.order, side = o.side === 'buy' ? 'BUY' : 'SELL', buy = side === 'BUY';
  const entry = o.entryPrice, sl = o.sl, tp1 = o.tp1;
  // hanya hitung kemunculan pertama dari sinyal yang sama (sinyal yang sama dipancarkan berulang tiap langkah)
  const key = `${side}|${entry}|${sl}|${tp1}`;
  const prev = lastSeen.get(key);
  lastSeen.set(key, s);
  if (prev !== undefined && s - prev <= EXPIRY_BARS) continue;

  const fut = m1.slice(s + 1, s + 1 + HORIZON);
  let fi = -1;
  if (o.orderType === 'MARKET') fi = 0;
  else for (let j = 0; j < Math.min(EXPIRY_BARS, fut.length); j++) if (buy ? fut[j].l <= entry : fut[j].h >= entry) { fi = j; break; }
  let result = fi < 0 ? 'NOFILL' : 'OPEN';
  if (fi >= 0) for (let j = fi; j < fut.length; j++) {
    const slHit = buy ? fut[j].l <= sl : fut[j].h >= sl;
    const tpHit = buy ? fut[j].h >= tp1 : fut[j].l <= tp1;
    if (slHit) { result = 'SL'; break; }       // konservatif: SL dianggap lebih dulu bila satu candle menyentuh keduanya
    if (tpHit) { result = 'TP'; break; }
  }

  const c5 = toD(view('m5')), c1 = toD(m1w);
  const atr5 = calcATR(c5).filter(x => x != null).pop() || 0;
  const atr1 = calcATR(c1).filter(x => x != null).pop() || 0;
  const risk = Math.abs(entry - sl);
  const sw = getSwings(c5, 3);
  const swPts = (buy ? sw.lows : sw.highs).map(x => x.price);
  const ev5 = lastOf(structureEvents(c5, 3).events);
  const hour = new Date(m1[s].t).getUTCHours();
  rows.push({
    time: new Date(m1[s].t).toISOString(), side, type: o.orderType, role: o.role, price,
    distPip: Math.abs(entry - price) / PIP, riskAtr5: atr5 > 0 ? risk / atr5 : NaN, riskPip: risk / PIP,
    rMult: risk > 0 ? Math.abs(tp1 - entry) / risk : NaN, atr1,
    liqAtSl: atr5 > 0 && swPts.some(p => Math.abs(p - sl) <= 0.5 * atr5),
    fvgBetween: atr5 > 0 && fvgOverlap(c5, buy ? 'buy' : 'sell', Math.min(sl, entry), Math.max(sl, entry)),
    m5Aligned: ev5 ? ev5.side === (buy ? 'buy' : 'sell') : null,
    session: hour < 7 ? 'Asia' : hour < 12 ? 'London' : hour < 21 ? 'NewYork' : 'Late',
    result,
  });
}

// ── Ringkasan ──
const filled = rows.filter(r => r.result !== 'NOFILL');
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '-');
const cnt = (g, res) => g.filter(r => r.result === res).length;
console.log(`Data: ${m1.length} candle M1 | langkah replay: ${steps} | sinyal unik: ${rows.length}`);
console.log(`Terisi dalam ${EXPIRY_BARS} candle: ${filled.length} (${pct(filled.length, rows.length)}) | tidak terisi (expired): ${rows.length - filled.length}`);
console.log(`Setelah terisi: SL dulu ${pct(cnt(filled, 'SL'), filled.length)} | TP1 dulu ${pct(cnt(filled, 'TP'), filled.length)} | belum keduanya ${pct(cnt(filled, 'OPEN'), filled.length)}`);
if (filled.length < 30) console.log('⚠ sampel terisi < 30: proporsi belum bisa dipercaya');

const q = a => { const x = a.filter(Number.isFinite).sort((p, q) => p - q); return x.length ? [x[x.length >> 2], x[x.length >> 1], x[(x.length * 3) >> 2]] : [NaN, NaN, NaN]; };
const qa = q(filled.map(r => r.atr1)); // kuartil ATR M1
function table(title, keyFn, order) {
  console.log(`\n${title}`);
  const g = {};
  for (const r of filled) { const k = keyFn(r); if (k == null) continue; (g[k] ||= []).push(r); }
  for (const k of (order || Object.keys(g).sort())) {
    const grp = g[k]; if (!grp) continue;
    const warn = grp.length < 30 ? '  (sampel kecil)' : '';
    console.log(`  ${String(k).padEnd(18)} n=${String(grp.length).padStart(4)}  SL dulu ${pct(cnt(grp, 'SL'), grp.length).padStart(4)}  TP1 dulu ${pct(cnt(grp, 'TP'), grp.length).padStart(4)}${warn}`);
  }
}
table('Role setup', r => r.role, ['continuity', 'main', 'bounce']);
table('Tipe order', r => r.type);
table('Jarak entry dari harga (pip)', r => r.distPip < 10 ? '<10' : r.distPip <= 25 ? '10-25' : r.distPip <= 60 ? '25-60' : '>60', ['<10', '10-25', '25-60', '>60']);
table('Risiko SL dalam ATR M5', r => !Number.isFinite(r.riskAtr5) ? null : r.riskAtr5 < 1 ? '<1 ATR' : r.riskAtr5 < 2 ? '1-2 ATR' : r.riskAtr5 < 3 ? '2-3 ATR' : '>3 ATR', ['<1 ATR', '1-2 ATR', '2-3 ATR', '>3 ATR']);
table('TP1 dalam kelipatan risiko (R)', r => !Number.isFinite(r.rMult) ? null : r.rMult.toFixed(1) + 'R');
table('SL di level likuiditas (swing M5 ±0.5 ATR)', r => r.liqAtSl ? 'ya' : 'tidak', ['ya', 'tidak']);
table('FVG searah di antara entry dan SL', r => r.fvgBetween ? 'ya' : 'tidak', ['ya', 'tidak']);
table('M5 terakhir searah sinyal', r => r.m5Aligned === null ? null : r.m5Aligned ? 'searah' : 'berlawanan', ['searah', 'berlawanan']);
table('Sesi (UTC)', r => r.session, ['Asia', 'London', 'NewYork', 'Late']);
table('Volatilitas ATR M1 (kuartil)', r => r.atr1 <= qa[0] ? 'Q1 tenang' : r.atr1 <= qa[1] ? 'Q2' : r.atr1 <= qa[2] ? 'Q3' : 'Q4 aktif');

const header = Object.keys(rows[0] || {}).join(',');
writeFileSync('hasil_qc.csv', [header, ...rows.map(r => Object.values(r).map(v => (typeof v === 'number' ? v.toFixed(3) : v)).join(','))].join('\n'));
console.log(`\nDetail per sinyal: hasil_qc.csv (${rows.length} baris)`);
