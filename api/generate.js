// api/generate.js — v182 compact
// - BTCUSD: nilai pip TAMPILAN diskalakan ÷10 (186→19, 1100→110) agar recap setara gold; harga & risiko internal TETAP
// - Lifecycle v2: fill dulu baru TP/SL; deteksi via high/low candle sejak tick terakhir; pending tidak dibatalkan karena jarak
// - Intraday: zona M15 utama > refine M5; TP 1:1.5/3/5/7/10; selalu LIMIT. Swing selalu LIMIT. Scalping cascade + ranging edge
// - Cooldown: reason "kembali lagi setelah 5 menit" + sisa menit
// - PERSISTENSI: Vercel KV / Upstash REST + fallback prevSignal localStorage
import { checkAccess, markTrialBotUsed } from '../lib/access.js';
import { generateManualPlan, buildWatchlist, SYARAT_MASUK } from '../lib/manual_scalp.js';
import { planIntraday, planSwing, planScalping } from '../lib/mtf-engine.js';
import { planBot } from '../lib/bot-ict.js';
import { simpleZonePlan, scalpWatch } from '../lib/smc_flex.js';
import { runBotSma as runBotFlex } from '../lib/bot_3candle.js';

export const config = { maxDuration: 60 };
const VERSION = 'v182';
const TL_BASE = 'https://api.tickerlayer.com';
const AI_BASE = (process.env.QWEN_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/+$/, '');
const AI_KEYS = [process.env.QWEN_MANUAL_API_KEY, process.env.QWEN_API_KEY, process.env.QWEN_API_KEY_2, process.env.OPENAI_API_KEY].filter(Boolean);
const AI_MODELS = [process.env.QWEN_MANUAL_MODEL || 'qwen-4-max', process.env.QWEN_MODEL || 'deepseek-v4-flash'];
const VIS_MODEL = process.env.AI_VISION_MODEL || 'gpt-6-luna';
const VIS_KEY = process.env.OPENAI_API_KEY || AI_KEYS[0] || '';
const TL_KEYS = ['TICKERLAYER_API_KEY', ...Array.from({ length: 19 }, (_, i) => 'TICKERLAYER_API_KEY_' + (i + 1))].map(n => process.env[n] || '').filter(Boolean);
const DEC = { XAUUSD: 2, XAGUSD: 3, BTCUSD: 2, ETHUSD: 2, SOLUSD: 2, XRPUSD: 4, BNBUSD: 2, DXY: 2, US30: 2, NAS100: 2, SPX500: 2, GER40: 2, UK100: 2, JPN225: 0, EURUSD: 5, GBPUSD: 5, USDJPY: 3, AUDUSD: 5, USDCAD: 5, USDCHF: 5, NZDUSD: 5 };
const PIP = { XAUUSD: 0.1, BTCUSD: 1, DXY: 0.01, US30: 1, NAS100: 1 };
// Skala TAMPILAN pip saja (recap setara gold). Tidak mengubah harga/SL/TP/perhitungan internal.
const PIP_DISPLAY = { BTCUSD: 0.1 };
const pipOf = (s, d) => PIP[s] ?? Math.pow(10, -(d - 1));
const pipScaleOf = s => PIP_DISPLAY[s] ?? 1;
const isGold = s => s === 'XAUUSD' || s === 'XAUUSDX';
const TFMS = { m1: 6e4, m5: 3e5, m15: 9e5, m30: 18e5, h1: 36e5, h4: 144e5, d1: 864e5 };
const TFIV = { m1: '1m', m5: '5m', m15: '15m', m30: '30m', h1: '1h', h4: '4h', d1: '1d' };
const TFSPAN = { m1: [1, 'minute', 1], m5: [5, 'minute', 5], m15: [15, 'minute', 15], m30: [30, 'minute', 30], h1: [1, 'hour', 60], h4: [4, 'hour', 240], d1: [1, 'day', 1440] };
const NEED = { Scalping: ['m1', 'm5', 'm15'], Intraday: ['m5', 'm15', 'h1', 'h4'], Swing: ['m15', 'h1', 'h4', 'd1'] };
const MINB = { m1: 60, m5: 40, m15: 40, m30: 35, h1: 35, h4: 25, d1: 20 };
const EXPMS = { Scalping: (Number(process.env.EXP_SCALP_MIN) || 30) * 6e4, Intraday: (Number(process.env.EXP_INTRADAY_MIN) || 480) * 6e4, Swing: (Number(process.env.EXP_SWING_MIN) || 5760) * 6e4 };
const HTF_OF = { Scalping: 'm15', Intraday: 'h4', Swing: 'd1' };
const MAXPIP = { Scalping: 150, Intraday: 500, Swing: 2000 };
const RULES = {
  Scalping: { gMin: 35, gMax: 50, bMin: 0.0025, bMax: 0.006, tps: [1, 1.5, 2, 3, 5] },
  Intraday: { gMin: 35, gMax: 100, bMin: 0.005, bMax: 0.012, tps: [1.5, 3, 5, 7, 10] },
  Swing: { gMin: 50, gMax: 300, bMin: 0.01, bMax: 0.025, tps: [1, 2, 3, 4, 5] },
};
const COOLDOWN = 3e5;
const cache = new Map();
const outcomes = new Map();
const stories = new Map();
const num = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
const tsMs = t => (t < 1e12 ? t * 1000 : t);
const closed = (c, ms) => (Array.isArray(c) && c.length && Date.now() < tsMs(c[c.length - 1].t) + ms ? c.slice(0, -1) : (c || []));
const iso = d => d.toISOString().slice(0, 10);
const dw = d => (d === 1 ? 'bullish' : d === -1 ? 'bearish' : 'netral');
const dwEn = d => (d === 1 ? 'bullish' : d === -1 ? 'bearish' : 'neutral');

async function httpJson(url, opt = {}, ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { ...opt, signal: ac.signal });
    const txt = await r.text();
    let data = null;
    try { data = JSON.parse(txt); } catch {}
    return { ok: r.ok, status: r.status, data, text: txt };
  } finally { clearTimeout(t); }
}
// ===== Persistensi signal: Vercel KV / Upstash Redis via REST =====
const KV_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const kvOn = !!(KV_URL && KV_TOKEN);
async function kvCmd(args, ms = 4000) {
  if (!kvOn) return null;
  try {
    const r = await httpJson(KV_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(args) }, ms);
    return r.ok ? (r.data && r.data.result !== undefined ? r.data.result : null) : null;
  } catch { return null; }
}
const sigKey = (sym, style) => 'sig:' + sym + '|' + style;
const ocKey = k => 'oc:' + k;
async function loadSignal(sym, style) {
  const raw = await kvCmd(['GET', sigKey(sym, style)]);
  if (raw == null) return null;
  try { const j = typeof raw === 'string' ? JSON.parse(raw) : raw; return (j && typeof j === 'object' && j.symbol) ? j : null; } catch { return null; }
}
async function saveSignal(sig) {
  if (!kvOn || !sig || !sig.symbol || !sig.style) return;
  const ttl = Math.max(60, Math.ceil(((Number(sig.expiresAt) || Date.now() + 18e5) - Date.now()) / 1000));
  try { await kvCmd(['SET', sigKey(sig.symbol, sig.style), JSON.stringify(sig), 'EX', String(ttl)]); } catch {}
}
async function dropSignal(sym, style) { if (kvOn) { try { await kvCmd(['DEL', sigKey(sym, style)]); } catch {} } }
async function saveOutcome(key, oc) {
  outcomes.set(key, oc);
  if (kvOn) { try { await kvCmd(['SET', ocKey(key), JSON.stringify(oc), 'EX', String(Math.ceil(COOLDOWN / 1000))]); } catch {} }
}
async function loadOutcome(key) {
  const mem = outcomes.get(key);
  if (mem) return mem;
  const raw = await kvCmd(['GET', ocKey(key)]);
  if (raw == null) return null;
  try { const j = typeof raw === 'string' ? JSON.parse(raw) : raw; if (j && j.out) { outcomes.set(key, j); return j; } } catch {}
  return null;
}
const pickPrev = (a, b) => {
  const ok = x => x && typeof x === 'object' && (x.signal === 'BUY' || x.signal === 'SELL');
  if (!ok(a)) return ok(b) ? b : null;
  if (!ok(b)) return a;
  const score = x => Math.max(Number(x.lastTickAt) || 0, Number(x.createdAt) || 0);
  return score(b) > score(a) ? b : a;
};
// ================================================================
function clean(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(c => ({ t: Number(c.t ?? c.time), o: Number(c.o ?? c.open), h: Number(c.h ?? c.high), l: Number(c.l ?? c.low), c: Number(c.c ?? c.close) }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
}
async function tlRows(sym, tf, need) {
  const sp = TFSPAN[tf];
  if (!sp || !TL_KEYS.length) return [];
  const route = isGold(sym) ? ['commodities', 'XAUUSD'] : ['forex', sym];
  if (['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD'].includes(sym)) route[0] = 'crypto';
  const now = Date.now();
  const win = Math.max(need * 1.3 * sp[2] * 6e4, 6048e5) + 864e5;
  const url = TL_BASE + '/' + route[0] + '/agg/' + route[1] + '/' + sp[0] + '/' + sp[1] + '/' + iso(new Date(now - win)) + '/' + iso(new Date(now + 864e5)) + '?sort=desc&limit=5000';
  for (const k of TL_KEYS.slice(0, 3)) {
    try {
      const r = await httpJson(url, { headers: { 'x-api-key': k } }, 6000);
      if (r.ok && r.data) return clean(Array.isArray(r.data) ? r.data : (r.data.results || [])).slice(-need);
    } catch {}
  }
  return [];
}
function atr(rows, n = 14) {
  if (!Array.isArray(rows) || rows.length < n + 1) return 0;
  const tr = i => Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - rows[i - 1].c), Math.abs(rows[i].l - rows[i - 1].c));
  let a = 0;
  for (let i = 1; i <= n; i++) a += tr(i);
  a /= n;
  for (let i = n + 1; i < rows.length; i++) a = (a * (n - 1) + tr(i)) / n;
  return a;
}
function ema(rows, n = 20) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const k = 2 / (n + 1);
  let e = rows[0].c;
  for (let i = 1; i < rows.length; i++) e = rows[i].c * k + e * (1 - k);
  return e;
}
function internal(rows, lb = 60) {
  const o = { dir: 0, ev: '', mom: 0, strong: false };
  if (!Array.isArray(rows) || rows.length < 25) return o;
  const a = rows.slice(-lb);
  const n = a.length;
  const e = ema(a);
  o.mom = a[n - 1].c > e ? 1 : a[n - 1].c < e ? -1 : 0;
  const hs = [], ls = [];
  for (let i = 2; i < n - 2; i++) {
    let ih = true, il = true;
    for (let j = i - 2; j <= i + 2; j++) { if (j === i) continue; if (a[j].h >= a[i].h) ih = false; if (a[j].l <= a[i].l) il = false; }
    if (ih) hs.push([i, a[i].h]);
    if (il) ls.push([i, a[i].l]);
  }
  let tr = 0, ev = '', bi = -1, pi = 0, pj = 0;
  for (let i = 4; i < n; i++) {
    while (pi < hs.length && hs[pi][0] < i - 2) pi++;
    while (pj < ls.length && ls[pj][0] < i - 2) pj++;
    const ph = pi > 0 ? hs[pi - 1][1] : null;
    const pl = pj > 0 ? ls[pj - 1][1] : null;
    const c = a[i].c;
    if (ph != null && c > ph) { ev = tr === -1 ? 'CHOCH_UP' : 'BOS_UP'; tr = 1; bi = i; }
    else if (pl != null && c < pl) { ev = tr === 1 ? 'CHOCH_DOWN' : 'BOS_DOWN'; tr = -1; bi = i; }
  }
  const fresh = bi >= n - 12;
  o.ev = ev;
  o.dir = tr !== 0 && fresh ? tr : o.mom;
  o.strong = fresh && tr !== 0 && o.mom === tr;
  return o;
}
// Deteksi ranging/sideways: EMA flat + harga sering cross EMA → LIMIT di tepi range
function ranging(rows, lb = 30, tf = 'M5') {
  if (!Array.isArray(rows) || rows.length < lb) return null;
  const a = rows.slice(-lb);
  const hi = Math.max(...a.map(c => c.h)), lo = Math.min(...a.map(c => c.l));
  const h = hi - lo;
  if (!(h > 0)) return null;
  const e = ema(a);
  let cross = 0;
  for (let i = 1; i < a.length; i++) if ((a[i - 1].c - e) * (a[i].c - e) < 0) cross++;
  const half = Math.floor(lb / 2);
  const flat = Math.abs(ema(a.slice(half)) - ema(a.slice(0, half))) <= 0.2 * h;
  const pos = (a[a.length - 1].c - lo) / h;
  if (cross >= 4 && flat) return { hi, lo, h, pos, cross, tf };
  return null;
}
function gaps(rows, lb = 40) {
  const out = [];
  if (!Array.isArray(rows) || rows.length < 3) return out;
  const a = rows.slice(-lb);
  for (let i = 1; i < a.length - 1; i++) {
    if (a[i - 1].h < a[i + 1].l) out.push({ lo: a[i - 1].h, hi: a[i + 1].l, side: 'demand', kind: 'FVG bull' });
    if (a[i - 1].l > a[i + 1].h) out.push({ lo: a[i + 1].h, hi: a[i - 1].l, side: 'supply', kind: 'FVG bear' });
  }
  return out;
}
function zonesFromRows(rows, tfLabel, ctx, lb = 90) {
  if (!Array.isArray(rows) || rows.length < 12) return [];
  const a = rows.slice(-lb);
  const at = atr(a) || ctx.pip * 10;
  const raw = gaps(a, 60).map(g => ({ ...g, tf: tfLabel }));
  for (let i = 1; i < a.length - 1; i++) {
    const nx = a[i + 1];
    const body = Math.abs(nx.c - nx.o);
    if (body < 1.2 * at) continue;
    const up = nx.c > nx.o;
    const pv = a[i];
    if (up && pv.c < pv.o) raw.push({ tf: tfLabel, kind: 'Demand OB', lo: pv.l, hi: pv.h, side: 'demand' });
    if (!up && pv.c > pv.o) raw.push({ tf: tfLabel, kind: 'Supply OB', lo: pv.l, hi: pv.h, side: 'supply' });
  }
  const dist = z => (z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi);
  const kept = [];
  for (const z of raw.sort((x, y) => dist(x) - dist(y))) {
    if (!(z.hi > z.lo)) continue;
    if ((z.hi - z.lo) / ctx.price > 0.03) continue;
    if (kept.some(k => k.side === z.side && !(z.hi < k.lo || z.lo > k.hi))) continue;
    kept.push(z);
    if (kept.length >= 6) break;
  }
  return kept;
}
function zoneLine(list, ctx, en) {
  if (!list || !list.length) return en ? 'no fresh zone readable yet.' : 'belum ada zona fresh terbaca.';
  return list.slice(0, 4).map(z => {
    const inside = ctx.price >= z.lo && ctx.price <= z.hi;
    const d = ctx.dp((z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi) / ctx.pip);
    const pos = inside ? (en ? 'price inside' : 'harga di dalam') : (z.lo >= ctx.price ? (en ? 'above' : 'di atas') : (en ? 'below' : 'di bawah'));
    const tail = inside ? pos : d + ' pip ' + pos;
    return z.kind + ' ' + ctx.f(z.lo) + '–' + ctx.f(z.hi) + ' (' + tail + ')';
  }).join('; ');
}
function zonesOf(ctx, watch, m5) {
  const list = [];
  for (const w of watch || []) {
    const lo = Number(w.bawah ?? w.lo), hi = Number(w.atas ?? w.hi);
    if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)) continue;
    const lab = String(w.tipe ?? w.type ?? 'Zona');
    const side = /supply|sell|bear/i.test(lab) ? 'supply' : /demand|buy|bull/i.test(lab) ? 'demand' : (lo >= ctx.price ? 'supply' : 'demand');
    list.push({ lo, hi, side, kind: lab, tf: String(w.tf || 'M5') });
  }
  for (const g of gaps(m5)) list.push({ ...g, tf: 'M5' });
  return list;
}
function dedupeZones(list) {
  const out = [];
  for (const z of [...list].sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo))) {
    if (!(z.hi > z.lo)) continue;
    if (out.some(k => k.side === z.side && !(z.hi < k.lo || z.lo > k.hi))) continue;
    out.push(z);
  }
  return out;
}
function candidatesFor(ctx, list, dir, bars) {
  const a = atr(bars) || ctx.pip * 10;
  const want = dir === 1 ? 'demand' : 'supply';
  return list.filter(z => z.side === want)
    .filter(z => (dir === 1 ? z.lo <= ctx.price + 0.2 * a : z.hi >= ctx.price - 0.2 * a))
    .map(z => ({ ...z, d: dir === 1 ? ctx.price - z.hi : z.lo - ctx.price }))
    .sort((x, y) => x.d - y.d);
}
function bounds(entry, ctx, style) {
  const r = RULES[style] || RULES.Scalping;
  return isGold(ctx.symbol) ? { min: r.gMin * ctx.pip, max: r.gMax * ctx.pip } : { min: entry * r.bMin, max: entry * r.bMax };
}
function invalidation(p, ctx, bars) {
  const dir = p.dir;
  const zl = Number(p.zone && p.zone.lo), zh = Number(p.zone && p.zone.hi);
  const distal = dir === 1 ? zl : zh;
  const cands = [];
  if (Number.isFinite(distal)) cands.push(distal);
  if (Number.isFinite(Number(p.invalidLevel))) cands.push(Number(p.invalidLevel));
  const a = atr(bars) || ctx.pip * 10;
  const reach = (zh - zl) > 0 ? (zh - zl) : a;
  if (dir === 1) {
    for (const g of gaps(bars)) if (g.side === 'demand' && g.lo <= distal && g.lo >= distal - reach) cands.push(g.lo);
    const v = cands.filter(x => Number.isFinite(x) && x < p.entry);
    return v.length ? Math.min(...v) : NaN;
  }
  for (const g of gaps(bars)) if (g.side === 'supply' && g.hi >= distal && g.hi <= distal + reach) cands.push(g.hi);
  const v = cands.filter(x => Number.isFinite(x) && x > p.entry);
  return v.length ? Math.max(...v) : NaN;
}
function applyRisk(p, ctx, bars, style, allowCap = false) {
  const r = RULES[style] || RULES.Scalping;
  const b = bounds(p.entry, ctx, style);
  const inv = invalidation(p, ctx, bars);
  const buf = 0.1 * (atr(bars) || ctx.pip * 10);
  let need = Math.max(Math.abs(p.entry - p.sl), Number.isFinite(inv) ? Math.abs(p.entry - inv) + buf : 0, b.min);
  if (need > b.max) {
    if (!allowCap) return { reject: true, need: ctx.dp(need / ctx.pip), max: ctx.dp(b.max / ctx.pip), inv: Number.isFinite(inv) ? ctx.f(inv) : null };
    need = b.max;
  }
  p.sl = p.entry - p.dir * need;
  if (Array.isArray(r.tps)) {
    p.tps = r.tps.slice(0, 3).map(m => p.entry + p.dir * need * m);
    p.tp4 = r.tps[3] != null ? p.entry + p.dir * need * r.tps[3] : null;
    p.tp5 = r.tps[4] != null ? p.entry + p.dir * need * r.tps[4] : null;
    p.rr = r.tps[0];
  }
  p.riskPips = ctx.dp(need / ctx.pip); // nilai tampilan (BTC ÷10); jarak harga SL/TP tetap asli
  if (Number.isFinite(inv)) p.invalidLevel = inv;
  return { reject: false, inv: Number.isFinite(inv) ? ctx.f(inv) : null };
}
// Cascade wajib-signal. Intraday/Swing = LIMIT only; Scalping boleh NOW kecuali saat ranging.
function entryMode(ctx, p, it, lt, bars, style, m1, cands, opts = {}) {
  const a = atr(bars) || ctx.pip * 10;
  const maxPip = style === 'Scalping' && isGold(ctx.symbol) ? 50 : (MAXPIP[style] || 150);
  const align = it.dir === p.dir && lt.dir === p.dir;
  const calc = z => {
    const zl = z.lo, zh = z.hi, w = zh - zl;
    const beyond = p.dir === 1 ? ctx.price < zl : ctx.price > zh;
    const inside = ctx.price >= zl && ctx.price <= zh;
    const lim = inside ? (p.dir === 1 ? zl + 0.5 * w : zh - 0.5 * w) : (p.dir === 1 ? zh - 0.4 * w : zl + 0.4 * w);
    const sideOk = p.dir === 1 ? lim < ctx.price : lim > ctx.price;
    const distPip = Math.abs(ctx.price - lim) / ctx.pip;
    const atProx = p.dir === 1 ? ctx.price <= zh + 0.2 * a : ctx.price >= zl - 0.2 * a;
    return { z, beyond, inside, lim, sideOk, distPip, atProx };
  };
  const pool = (cands && cands.length) ? cands : (p.zone && Number.isFinite(p.zone.lo) ? [{ ...p.zone, tf: 'Plan' }] : []);
  for (const z of pool) {
    const c = calc(z);
    if (c.beyond) continue;
    const cap = String(z.kind || '').startsWith('Range') ? (MAXPIP[style] || 150) : maxPip;
    if (c.sideOk && c.distPip >= 2 && c.distPip <= cap)
      return { type: 'LIMIT', entry: c.lim, zone: z, note: 'LIMIT pullback @ ' + ctx.f(c.lim) + ' (' + ctx.dp(c.distPip) + ' pip) di ' + (z.tf ? z.tf + ' ' : '') + z.kind + (z.refFrom ? ' (refine M5 dari ' + z.refFrom + ')' : '') + ': zona valid, sisi order benar, jarak layak — limit diprioritaskan.' };
    if (!opts.ranging && style === 'Scalping' && align && (c.inside || c.atProx))
      return { type: 'MARKET', entry: ctx.price, zone: z, note: 'NOW: LIMIT tidak memungkinkan (sisi limit terlewat / jarak < 2 pip) di ' + (z.tf ? z.tf + ' ' : '') + z.kind + ' sementara internal M5 & M1 searah dan harga di area proximal zona.' };
  }
  if (style === 'Scalping') {
    const b = bounds(ctx.price, ctx, style);
    const a1 = atr(m1) || ctx.pip * 10;
    const buf = 0.1 * a1;
    if (!opts.ranging && align && Array.isArray(m1) && m1.length >= 6) {
      const n = m1.slice(-8);
      const swing = p.dir === 1 ? Math.min(...n.map(c => c.l)) : Math.max(...n.map(c => c.h));
      const w = Math.max(0.3 * a1, ctx.pip * 5);
      let z, capped = false;
      if (p.dir === 1) {
        let lo = Math.min(swing, ctx.price - 2 * ctx.pip);
        if (ctx.price - lo > b.max - buf) { lo = ctx.price - (b.max - buf); capped = true; }
        z = { lo, hi: lo + w, side: 'demand', kind: 'Swing M1', tf: 'M1' };
      } else {
        let hi = Math.max(swing, ctx.price + 2 * ctx.pip);
        if (hi - ctx.price > b.max - buf) { hi = ctx.price + (b.max - buf); capped = true; }
        z = { lo: hi - w, hi, side: 'supply', kind: 'Swing M1', tf: 'M1' };
      }
      return { type: 'MARKET', entry: ctx.price, zone: z, forced: true, note: 'NOW momentum: tidak ada zona pullback layak dalam ' + ctx.dp(maxPip) + ' pip, tapi internal M5 (' + (it.ev || 'mom') + ') & M1 (' + (lt.ev || 'mom') + ') searah. SL swing M1 ' + ctx.f(p.dir === 1 ? z.lo : z.hi) + (capped ? ' (dicap ' + ctx.dp(b.max / ctx.pip) + ' pip)' : '') + '; risiko lebih tinggi, size dikecilkan.' };
    }
    let far = null;
    for (const z of pool) {
      const c = calc(z);
      if (c.beyond || !c.sideOk || c.distPip < 2 || c.distPip > (MAXPIP[style] || 150)) continue;
      if (!far || c.distPip < far.distPip) far = c;
    }
    if (far) return { type: 'LIMIT', entry: far.lim, zone: far.z, note: 'LIMIT pullback dalam @ ' + ctx.f(far.lim) + ' (' + ctx.dp(far.distPip) + ' pip > ideal ' + ctx.dp(maxPip) + ' pip) di ' + (far.z.tf ? far.z.tf + ' ' : '') + far.z.kind + ': belum ada zona lebih dekat; order dipasang menunggu retest, batalkan bila struktur berbalik.' };
  } else {
    for (const z of pool) {
      const c = calc(z);
      if (!c.inside || c.sideOk) continue;
      const w = z.hi - z.lo;
      const step = Math.max(2 * ctx.pip, 0.3 * w);
      const e2 = p.dir === 1 ? Math.max(z.lo, ctx.price - step) : Math.min(z.hi, ctx.price + step);
      if (Math.abs(ctx.price - e2) / ctx.pip >= 2)
        return { type: 'LIMIT', entry: e2, zone: z, note: 'LIMIT retest dalam zona @ ' + ctx.f(e2) + ' (' + ctx.dp(Math.abs(ctx.price - e2) / ctx.pip) + ' pip) di ' + (z.tf ? z.tf + ' ' : '') + z.kind + (z.refFrom ? ' (refine M5 dari ' + z.refFrom + ')' : '') + ': harga sudah di dalam zona, order limit dipasang pada pullback kecil searah bias.' };
    }
  }
  const tfLab = style === 'Scalping' ? 'M5' : style === 'Intraday' ? 'M15' : 'H4';
  const off = Math.min(Math.max(0.6 * a, 2 * ctx.pip), (MAXPIP[style] || 150) * ctx.pip);
  const entry = ctx.price - p.dir * off;
  const w2 = Math.max(0.25 * a, 2 * ctx.pip);
  const z = { lo: entry - w2 / 2, hi: entry + w2 / 2, side: p.dir === 1 ? 'demand' : 'supply', kind: 'Retest ATR', tf: tfLab };
  return { type: 'LIMIT', entry, zone: z, forced: true, note: 'LIMIT retest ATR @ ' + ctx.f(entry) + ' (' + ctx.dp(off / ctx.pip) + ' pip): tidak ada zona segar searah dalam jangkauan; zona sintetis 0.6×ATR ' + tfLab + ', SL minimum ' + ctx.dp(bounds(entry, ctx, style).min / ctx.pip) + ' pip. Confidence rendah — tunggu reaksi harga di zona.' };
}
function sigOf(p, ctx, style) {
  const f = ctx.f;
  const tps = p.tps && p.tps.length >= 3 ? p.tps : [p.entry, p.entry, p.entry];
  const s = {
    signal: p.dir === 1 ? 'BUY' : 'SELL', orderType: p.type, fill: p.type === 'MARKET' ? 'NOW' : 'LIMIT',
    status: p.type === 'MARKET' ? 'RUNNING' : 'PENDING', state: p.type === 'MARKET' ? 'CONFIRMED' : 'LIMIT_PLACED',
    entry: f(p.entry), sl: f(p.sl), tp1: f(tps[0]), tp2: f(tps[1]), tp3: f(tps[2]),
    invalidLevel: Number.isFinite(Number(p.invalidLevel)) ? f(p.invalidLevel) : null,
    zone: p.zone ? { min: f(p.zone.lo), max: f(p.zone.hi), label: p.zone.kind } : null,
    zoneLabel: p.zone ? p.zone.kind : '', rr: Number(num(p.rr, 1).toFixed(2)), riskPips: p.riskPips ?? null,
    pipDisplayScale: ctx.pipScale ?? 1,
    tpMode: 'RISK_R', setup: 'Manual ' + style, confidence: p.forced ? 'LOW' : 'MEDIUM', risk: p.forced ? 'HIGH' : 'MEDIUM', forced: !!p.forced,
    symbol: ctx.symbol, style, role: 'main', createdAt: Date.now(), lastTickAt: Date.now(),
    filledAt: p.type === 'MARKET' ? Date.now() : null,
    expiresAt: Date.now() + (EXPMS[style] || 18e5),
    entryMode: p.type === 'MARKET' ? 'NOW' : 'PULLBACK', entryNote: p.note || null,
    tpHits: [], tpHitCount: 0, maxTpHit: 0, be: false, slBe: null,
    checklist: p.steps || [], reason: '', reasons: { id: '', en: '' },
  };
  if (Number.isFinite(Number(p.tp4))) s.tp4 = f(p.tp4);
  if (Number.isFinite(Number(p.tp5))) s.tp5 = f(p.tp5);
  return s;
}
function standby(ctx, style, why, steps) {
  return {
    signal: { signal: 'NONE', status: 'STANDBY', state: 'STANDBY', orderType: 'NONE', symbol: ctx.symbol, style, entry: null, sl: null, tp1: null, tp2: null, tp3: null, checklist: (steps || []).map(s => s.tf + ': ' + s.text), reason: '', reasons: { id: '', en: '' } },
    facts: { symbol: ctx.symbol, style, status: 'STANDBY', why, steps: steps || [], dec: ctx.dec, price: ctx.f(ctx.price) },
  };
}
function layout(f, en, lines, setup) {
  return '[' + f.symbol + ' · ' + (en ? 'Multi-TF Analysis' : 'Analisa Multi-TF') + ' · ' + f.style + ']\n' + (lines || []).map(t => '• ' + t).join('\n') + '\n\n[Setup]\n' + setup;
}
function manualReason(f, en) {
  const lines = (f.steps || []).map(s => s.tf + ': ' + (en ? (s.textEn || s.text) : s.text));
  if (f.status === 'STANDBY') return layout(f, en, lines, f.symbol + ': ' + (f.why || (en ? 'waiting for a valid setup.' : 'menunggu setup valid.')));
  const tp = [f.tp1, f.tp2, f.tp3, f.tp4, f.tp5].filter(v => Number.isFinite(Number(v))).join(', ');
  const ow = f.orderType === 'MARKET' ? 'MARKET (NOW)' : 'LIMIT';
  const inv = f.invalidLevel != null ? (en ? ' Invalidation ' + f.invalidLevel + '.' : ' Invalidasi ' + f.invalidLevel + '.') : '';
  const note = f.entryNote ? ' ' + f.entryNote : '';
  return layout(f, en, lines, f.symbol + ': ' + (en ? 'final decision ' : 'keputusan final ') + f.signal + ' ' + ow + ' @ ' + f.entry + ', SL ' + f.sl + ', TP ' + tp + '.' + inv + note);
}
async function aiJson(sys, obj, ms) {
  if (!AI_KEYS.length) return null;
  const end = Date.now() + ms;
  for (const m of AI_MODELS) {
    for (const k of AI_KEYS.slice(0, 2)) {
      const left = end - Date.now();
      if (left < 2500) return null;
      try {
        const r = await httpJson(AI_BASE + '/chat/completions', {
          method: 'POST', headers: { Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m, max_tokens: 1400, temperature: 0.2, messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(obj) }] }),
        }, Math.min(20000, left));
        if (!r.ok) continue;
        let txt = String(r.data?.choices?.[0]?.message?.content || '');
        txt = txt.replace(/```(?:json)?/gi, '').replace(/```/g, '');
        const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
        if (a >= 0 && b > a) { try { return JSON.parse(txt.slice(a, b + 1)); } catch {} }
      } catch {}
    }
  }
  return null;
}
const SYS_MTF = 'Kamu analis SMC. Jelaskan hasil scan multi-TF secara faktual, salin angka PERSIS dari JSON (angka pip sudah diskalakan untuk tampilan — jangan dihitung ulang). Untuk tiap item "steps" tulis maks 2 kalimat. WAJIB sebutkan zona HTF (zonesHtf) dan M5 (zonesM5): jenis, rentang, jarak pip. Intraday: zona M15 utama direfine M5 untuk eksekusi, TP 1:1.5/3/5/7/10. Scalping ranging: LIMIT di tepi range. Jelaskan alasan entry dari entryNote (semua style wajib setup; Intraday/Swing selalu LIMIT). Ringkasan setup 2-3 kalimat diawali nama pair: arah, tipe order, entry, SL, TP. Jika STANDBY jelaskan "why". Balas HANYA JSON: {"perTfId":["M15: ..."],"perTfEn":["M15: ..."],"id":"...","en":"..."}';
const SYS_BOT = 'Kamu mentor bot scalper. Jelaskan alur bot dari JSON (bias, htf, m1, checklist, trigger) dalam paragraf 4-6 kalimat santai, salin angka persis, tanpa bullet. Balas HANYA JSON: {"id":"...","en":"..."}';
async function reasonManual(f) {
  const fb = { id: manualReason(f, false), en: manualReason(f, true), ai: false };
  const j = await aiJson(SYS_MTF, f, 9000);
  if (!j || typeof j.id !== 'string' || typeof j.en !== 'string') return fb;
  const li = Array.isArray(j.perTfId) ? j.perTfId.map(String) : (f.steps || []).map(s => s.tf + ': ' + s.text);
  const le = Array.isArray(j.perTfEn) ? j.perTfEn.map(String) : (f.steps || []).map(s => s.tf + ': ' + (s.textEn || s.text));
  return { id: layout(f, false, li, j.id), en: layout(f, true, le, j.en), ai: true };
}
async function reasonBot(f) {
  const tp = [f.tp1, f.tp2, f.tp3].filter(v => v != null).join(', ');
  const fbId = f.status === 'STANDBY'
    ? 'Bot memantau ' + f.symbol + '. Bias ' + (f.bias || 'netral') + '. ' + (f.why || '')
    : 'Bot ' + f.signal + ' ' + (f.orderType === 'MARKET' ? 'eksekusi sekarang' : 'pending limit') + ' di ' + f.entry + ', SL ' + f.sl + ', TP ' + tp + '. Pemicu: ' + (f.trigger || '-') + '.';
  const fbEn = f.status === 'STANDBY'
    ? 'Bot is scanning ' + f.symbol + '. Bias ' + (f.bias || 'neutral') + '. ' + (f.why || '')
    : 'Bot ' + f.signal + ' ' + (f.orderType === 'MARKET' ? 'executes now' : 'pending limit') + ' at ' + f.entry + ', SL ' + f.sl + ', TP ' + tp + '. Trigger: ' + (f.trigger || '-') + '.';
  const j = await aiJson(SYS_BOT, f, 8000);
  if (j && typeof j.id === 'string' && typeof j.en === 'string') return { id: j.id, en: j.en, ai: true };
  return { id: fbId, en: fbEn, ai: false };
}
async function runManual(ctx, d, style) {
  const cl = { m1: closed(d.m1, TFMS.m1), m5: closed(d.m5, TFMS.m5), m15: closed(d.m15, TFMS.m15), h1: closed(d.h1, TFMS.h1), h4: closed(d.h4, TFMS.h4), d1: closed(d.d1, TFMS.d1) };
  const watch = style === 'Scalping' ? scalpWatch({ m1: cl.m1, m5: cl.m5 }, { price: ctx.price, pip: ctx.pip, dec: ctx.dec, symbol: ctx.symbol }) : buildWatchlist({ ...cl, price: ctx.price, pip: ctx.pip, styleName: style });
  const htfKey = HTF_OF[style] || 'm15';
  const htfLabel = htfKey.toUpperCase();
  const zHtf = zonesFromRows(cl[htfKey], htfLabel, ctx);
  const zM5 = zonesFromRows(cl.m5, 'M5', ctx);
  const zM15 = zonesFromRows(cl.m15, 'M15', ctx);
  const zH1 = zonesFromRows(cl.h1, 'H1', ctx);
  const bars = style === 'Intraday' ? cl.m15 : style === 'Swing' ? cl.h4 : cl.m5;
  const it = internal(cl.m5), lt = internal(cl.m1), ht = internal(cl[htfKey]);
  const i1 = internal(cl.h1), i4 = internal(cl.h4), i15 = internal(cl.m15);
  let plan = null;
  try {
    if (style === 'Intraday') plan = planIntraday({ h4: cl.h4, h1: cl.h1, m15: cl.m15, m5: cl.m5, price: ctx.price, sym: ctx.symbol, tNow: Date.now() });
    else if (style === 'Swing') plan = planSwing({ d1: cl.d1, h4: cl.h4, h1: cl.h1, m15: cl.m15, price: ctx.price, sym: ctx.symbol, tNow: Date.now() });
    else plan = planScalping({ m15: cl.m15, m5: cl.m5, m1: cl.m1, price: ctx.price, sym: ctx.symbol, tNow: Date.now() });
  } catch { plan = null; }
  const steps = Array.isArray(plan && plan.steps) ? plan.steps.slice() : [];
  steps.push({ tf: 'Zona HTF ' + htfLabel, text: zoneLine(zHtf, ctx, false), textEn: zoneLine(zHtf, ctx, true) });
  steps.push({ tf: 'Zona M5', text: zoneLine(zM5, ctx, false), textEn: zoneLine(zM5, ctx, true) });
  if (style === 'Intraday') steps.push({ tf: 'Zona M15', text: zoneLine(zM15, ctx, false), textEn: zoneLine(zM15, ctx, true) });
  if (ctx.pipScale !== 1) steps.push({ tf: 'Pip', text: 'Nilai pip tampilan diskalakan ×' + ctx.pipScale + ' (÷10) agar recap setara gold; jarak harga SL/TP tetap asli.', textEn: 'Displayed pip values scaled ×' + ctx.pipScale + ' (÷10) so recap matches gold; actual SL/TP price distances unchanged.' });
  const okPlan = plan && plan.status === 'limit' && plan.zone && Number.isFinite(Number(plan.entry)) && Number.isFinite(Number(plan.sl));
  if (!okPlan) {
    let lz = null;
    if (style === 'Scalping') { try { lz = simpleZonePlan({ m1: cl.m1, m5: cl.m5, m15: cl.m15, h1: cl.h1 }, { price: ctx.price, dec: ctx.dec, pip: ctx.pip, symbol: ctx.symbol }, { tfs: ['M5', 'M1'] }); } catch {} }
    if (lz && lz.ok) {
      const o = lz.order;
      plan = { status: 'limit', dir: o.side === 'buy' ? 'BUY' : 'SELL', entry: o.entryPrice, sl: o.sl, orderType: 'LIMIT', tps: [o.tp1, o.tp2, o.tp3], zone: { lo: lz.zone.bottom, hi: lz.zone.top, kind: lz.zone.type || 'Zona M5' }, steps: [] };
      steps.push({ tf: 'M5', text: o.reason, textEn: o.reason });
    } else {
      const a = atr(bars) || ctx.pip * 10;
      const dir0 = style === 'Swing' ? (ht.dir || i4.dir || i1.dir || 1) : style === 'Intraday' ? (i15.dir || i1.dir || ht.dir || 1) : (it.dir || ht.dir || 1);
      plan = { status: 'limit', dir: dir0 === 1 ? 'BUY' : 'SELL', entry: ctx.price, sl: ctx.price - dir0 * bounds(ctx.price, ctx, style).min, orderType: 'LIMIT', tps: [ctx.price, ctx.price, ctx.price], zone: { lo: ctx.price - a, hi: ctx.price + a, kind: 'Auto ATR' }, steps: [] };
      steps.push({ tf: 'Bias', text: 'Engine belum memberi zona valid; arah dari bias ' + dw(dir0) + ', zona dipilih dari inventaris.', textEn: 'No valid engine zone; bias ' + dwEn(dir0) + ', zone picked from inventory.' });
    }
  }
  const dir = plan.dir === 'BUY' ? 1 : -1;
  const tpsSrc = Array.isArray(plan.tps) && plan.tps.length >= 3 ? plan.tps : [plan.entry, plan.entry, plan.entry];
  const p = { dir, entry: num(plan.entry, ctx.price), sl: num(plan.sl, ctx.price), type: plan.orderType || 'LIMIT', tps: [tpsSrc[0], tpsSrc[1], tpsSrc[2]], tp4: tpsSrc[3] ?? null, tp5: tpsSrc[4] ?? null, rr: 1, zone: { lo: Number(plan.zone.lo), hi: Number(plan.zone.hi), kind: plan.zone.kind || 'Zona' }, steps };
  let opts = {};
  let rangeZone = null;
  if (style === 'Scalping') {
    steps.push({ tf: htfLabel, text: 'Bias ' + dw(ht.dir) + (ht.ev ? ' (' + ht.ev + ')' : '') + '.', textEn: 'Bias ' + dwEn(ht.dir) + (ht.ev ? ' (' + ht.ev + ')' : '') + '.' });
    steps.push({ tf: 'M5', text: 'Internal ' + dw(it.dir) + (it.ev ? ' · ' + it.ev : '') + ' · harga ' + (it.mom === 1 ? 'di atas' : 'di bawah') + ' EMA20.', textEn: 'Internal ' + dwEn(it.dir) + (it.ev ? ' · ' + it.ev : '') + ' · price ' + (it.mom === 1 ? 'above' : 'below') + ' EMA20.' });
    steps.push({ tf: 'M1', text: 'Trigger ' + dw(lt.dir) + (lt.ev ? ' · ' + lt.ev : '') + '.', textEn: 'Trigger ' + dwEn(lt.dir) + (lt.ev ? ' · ' + lt.ev : '') + '.' });
    const atPlanZone = ctx.price >= p.zone.lo && ctx.price <= p.zone.hi && lt.dir === dir;
    if (it.dir !== 0 && it.dir !== dir && !atPlanZone) {
      p.dir = it.dir;
      steps.push({ tf: 'M5', text: 'Follow internal: ' + (it.dir === 1 ? 'BUY' : 'SELL') + ' — zona dipilih otomatis dari inventaris terdekat yang layak (M1/M5/HTF).', textEn: 'Follow internal: ' + (it.dir === 1 ? 'BUY' : 'SELL') + ' — zone auto-picked from nearest valid inventory (M1/M5/HTF).' });
    }
    const rg = ranging(cl.m5, 30, 'M5') || ranging(cl.m1, 40, 'M1');
    if (rg) {
      const dirR = rg.pos >= 0.5 ? -1 : 1;
      p.dir = dirR;
      const w = Math.max(0.2 * rg.h, 2 * ctx.pip);
      rangeZone = dirR === -1 ? { lo: rg.hi - w, hi: rg.hi, side: 'supply', kind: 'Range High', tf: rg.tf } : { lo: rg.lo, hi: rg.lo + w, side: 'demand', kind: 'Range Low', tf: rg.tf };
      opts.ranging = true;
      steps.push({ tf: rg.tf, text: 'Ranging/sideways (' + rg.cross + '× cross EMA, EMA flat): LIMIT di tepi range — ' + (dirR === 1 ? 'BUY Range Low ' : 'SELL Range High ') + ctx.f(rangeZone.lo) + '–' + ctx.f(rangeZone.hi) + '.', textEn: 'Ranging/sideways (' + rg.cross + ' EMA crosses, flat EMA): LIMIT at range edge — ' + (dirR === 1 ? 'BUY Range Low ' : 'SELL Range High ') + ctx.f(rangeZone.lo) + '–' + ctx.f(rangeZone.hi) + '.' });
    }
  } else {
    const mid = style === 'Intraday' ? i15 : i4;
    const trig = style === 'Intraday' ? it : i1;
    const midLab = style === 'Intraday' ? 'M15' : 'H4';
    const trigLab = style === 'Intraday' ? 'M5' : 'H1';
    steps.push({ tf: htfLabel, text: 'Bias ' + dw(ht.dir) + (ht.ev ? ' (' + ht.ev + ')' : '') + '.', textEn: 'Bias ' + dwEn(ht.dir) + (ht.ev ? ' (' + ht.ev + ')' : '') + '.' });
    steps.push({ tf: midLab, text: 'Internal ' + dw(mid.dir) + (mid.ev ? ' · ' + mid.ev : '') + ' · harga ' + (mid.mom === 1 ? 'di atas' : 'di bawah') + ' EMA20.', textEn: 'Internal ' + dwEn(mid.dir) + (mid.ev ? ' · ' + mid.ev : '') + ' · price ' + (mid.mom === 1 ? 'above' : 'below') + ' EMA20.' });
    steps.push({ tf: trigLab, text: 'Trigger eksekusi ' + dw(trig.dir) + (trig.ev ? ' · ' + trig.ev : '') + '.', textEn: 'Execution trigger ' + dwEn(trig.dir) + (trig.ev ? ' · ' + trig.ev : '') + '.' });
  }
  let pool = [];
  if (style === 'Scalping') {
    const inv = dedupeZones([...zonesOf(ctx, watch, cl.m5), ...gaps(cl.m1).map(g => ({ ...g, tf: 'M1' })), ...zM5, ...zHtf]);
    pool = candidatesFor(ctx, inv, p.dir, bars).slice(0, 8);
  } else if (style === 'Intraday') {
    // M15 utama > refine M5 (zona M5 yang overlap zona M15 ditaruh depan)
    const m15c = candidatesFor(ctx, dedupeZones(zM15), p.dir, bars);
    const m5c = candidatesFor(ctx, dedupeZones([...zM5, ...gaps(cl.m5).map(g => ({ ...g, tf: 'M5' }))]), p.dir, bars);
    for (const z of m15c) {
      const ref = m5c.find(m => m.lo <= z.hi && m.hi >= z.lo);
      if (ref) pool.push({ ...ref, refFrom: z.kind + ' M15' });
      pool.push(z);
    }
    pool.push(...candidatesFor(ctx, dedupeZones([...zH1, ...zHtf]), p.dir, bars));
    pool = pool.slice(0, 10);
  } else {
    pool = candidatesFor(ctx, dedupeZones([...zonesOf(ctx, watch, cl.h1), ...zonesFromRows(cl.h4, 'H4', ctx), ...zHtf]), p.dir, bars).slice(0, 8);
  }
  if (Number.isFinite(p.zone.lo) && Number.isFinite(p.zone.hi) && p.zone.hi > p.zone.lo) {
    const side = p.dir === 1 ? 'demand' : 'supply';
    if (!pool.some(z => z.side === side && !(z.hi < p.zone.lo || z.lo > p.zone.hi)))
      pool.unshift({ ...p.zone, side, tf: 'Plan', d: p.dir === 1 ? ctx.price - p.zone.hi : p.zone.lo - ctx.price });
  }
  if (rangeZone) pool.unshift({ ...rangeZone, d: p.dir === 1 ? ctx.price - rangeZone.hi : rangeZone.lo - ctx.price });
  let em = null, risk = null;
  for (let guard = 0; guard < 10; guard++) {
    em = entryMode(ctx, p, it, lt, bars, style, cl.m1, pool, opts);
    if (em.reject) break;
    p.type = em.type; p.entry = em.entry; p.note = em.note; p.forced = !!em.forced;
    if (em.zone) p.zone = { lo: em.zone.lo, hi: em.zone.hi, kind: (em.zone.tf ? em.zone.tf + ' ' : '') + em.zone.kind };
    p.sl = p.entry - p.dir * bounds(p.entry, ctx, style).min;
    risk = applyRisk(p, ctx, bars, style, !!em.forced);
    if (!risk.reject) break;
    const i = pool.findIndex(z => z.lo === p.zone.lo && z.hi === p.zone.hi);
    if (i >= 0) pool.splice(i, 1);
    else { em = { reject: true, note: 'Risk ' + risk.need + ' pip melebihi batas ' + risk.max + ' pip.' }; break; }
  }
  if (!em || em.reject) return standby(ctx, style, (em && em.note) || 'Menunggu setup valid.', steps);
  if (risk && risk.reject) return standby(ctx, style, 'Risk ' + risk.need + ' pip melebihi batas ' + risk.max + ' pip (invalidasi ' + (risk.inv ?? '-') + ' terlalu jauh). Menunggu zona lebih rapat.', steps);
  steps.push({ tf: 'Entry', text: em.note, textEn: em.note });
  const s = sigOf(p, ctx, style);
  s.checklist = steps.map(x => x.tf + ': ' + x.text);
  const f = {
    symbol: ctx.symbol, style, status: s.status, signal: s.signal, orderType: s.orderType,
    entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4 ?? null, tp5: s.tp5 ?? null,
    invalidLevel: s.invalidLevel, entryNote: s.entryNote, steps,
    zonesHtf: zoneLine(zHtf, ctx, false), zonesM5: zoneLine(zM5, ctx, false),
    dec: ctx.dec, price: ctx.f(ctx.price),
  };
  return { signal: s, facts: f };
}
function runBot(ctx, d) {
  const m1 = closed(d.m1, TFMS.m1), m5 = closed(d.m5, TFMS.m5), m15 = closed(d.m15, TFMS.m15);
  let r = null;
  try { r = runBotFlex({ m1, m5, m15 }, { price: ctx.price, dec: ctx.dec, pip: ctx.pip, symbol: ctx.symbol }); } catch {}
  if (!r || !r.ok) {
    try {
      const ict = planBot({ m15, m5, price: ctx.price, sym: ctx.symbol, tNow: Date.now() });
      if (ict && ict.status === 'limit') r = { ok: true, dir: ict.dir === 'BUY' ? 1 : -1, dirTxt: ict.dir, entry: ict.entry, sl: ict.sl, tps: [ict.tp1, ict.tp2, ict.tp3], rr: 2, orderType: 'LIMIT', tier: 'ICT_POI', trigger: 'POI ' + ict.poi.kind + ' M15', bias: 'M15 ' + ict.dir, checklist: ['POI ' + ict.poi.kind + ' M15', 'Entry 40% zona', 'SL buffer ATR'] };
    } catch {}
  }
  if (!r || !r.ok) return standby(ctx, 'Scalping', (r && r.reason) || 'Menunggu setup bot.', []);
  const tps = Array.isArray(r.tps) && r.tps.length >= 3 ? r.tps : [r.entry, r.entry, r.entry];
  const p = { dir: r.dir, entry: num(r.entry, ctx.price), sl: num(r.sl, ctx.price), type: r.orderType || 'MARKET', tps, rr: num(r.rr, 1.5), zone: null, steps: [] };
  const s = sigOf(p, ctx, 'Scalping');
  s.style = 'scalperbot'; s.tier = r.tier || 'EA'; s.expiresAt = Date.now() + 9e5;
  s.checklist = r.checklist || [];
  const f = { symbol: ctx.symbol, style: 'scalperbot', status: s.status, signal: s.signal, orderType: s.orderType, entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, trigger: r.trigger || null, bias: r.bias || 'netral', htf: r.trendTxt || '-', m1: r.structTxt || '-', checklist: r.checklist || [], dec: ctx.dec, price: ctx.f(ctx.price) };
  return { signal: s, facts: f };
}
// Lifecycle v2: fill dulu, baru TP/SL dari high/low candle sejak tick terakhir.
function lifecycle(prev, sym, style, price, pip, data) {
  if (!prev || typeof prev !== 'object' || prev.symbol !== sym || prev.style !== style) return null;
  if (prev.signal !== 'BUY' && prev.signal !== 'SELL') return null;
  if (prev.status === 'TP5_HIT' || prev.finished) return null;
  const exp = Number(prev.expiresAt);
  if (!Number.isFinite(exp) || Date.now() > exp) return { dead: true, out: 'EXPIRED', prev };
  const dir = prev.signal === 'BUY' ? 1 : -1;
  const sl = Number(prev.sl), e = Number(prev.entry);
  const t = [prev.tp1, prev.tp2, prev.tp3, prev.tp4, prev.tp5].map(Number);
  if (![sl, e, t[0]].every(Number.isFinite)) return null;
  const tfKey = style === 'Swing' ? 'm15' : style === 'Intraday' ? 'm5' : 'm1';
  const ms = TFMS[tfKey] || 6e4;
  const rows = clean((data && data[tfKey]) || []);
  const start = Number(prev.lastTickAt) || Number(prev.createdAt) || Date.now();
  let win = rows.filter(c => tsMs(c.t) + ms > start && tsMs(c.t) <= Date.now());
  if (!win.length) win = [{ t: Date.now(), h: price, l: price, c: price }];
  let filled = prev.status !== 'PENDING' || Number(prev.filledAt) > 0;
  let filledAt = Number(prev.filledAt) || 0;
  const hits = new Set(Array.isArray(prev.tpHits) ? prev.tpHits : []);
  let be = !!prev.be || hits.has(1);
  let dead = null;
  for (const c of win) {
    if (!filled) {
      if (dir === 1 ? c.l <= e : c.h >= e) { filled = true; filledAt = tsMs(c.t); }
      else continue;
    }
    const slEff = be ? e : sl;
    const slTouch = dir === 1 ? c.l <= slEff : c.h >= slEff;
    if (slTouch) { dead = { out: be ? 'BE' : 'SL' }; break; }
    for (let i = 0; i < 5; i++) {
      const v = t[i];
      if (Number.isFinite(v) && !hits.has(i + 1) && (dir === 1 ? c.h >= v : c.l <= v)) hits.add(i + 1);
    }
    if (hits.has(1)) be = true;
    if (hits.has(5)) { dead = { out: 'TP5' }; break; }
  }
  const maxHit = hits.size ? Math.max(...hits) : 0;
  const patch = { tpHits: [...hits].sort((a, b) => a - b), tpHitCount: hits.size, maxTpHit: maxHit, be, slBe: be ? e : null, filledAt: filledAt || null, lastTickAt: Date.now() };
  if (dead && dead.out === 'TP5') return { dead: true, out: 'TP5', prev, patch: { ...patch, status: 'TP5_HIT', state: 'TP5', finished: true } };
  if (dead) return { dead: true, out: dead.out, prev, patch };
  let status, state;
  if (!filled) { status = 'PENDING'; state = 'LIMIT_PLACED'; }
  else if (maxHit >= 1) { status = 'TP' + maxHit + '_HIT'; state = 'TP' + maxHit; }
  else { status = 'RUNNING'; state = filledAt ? 'FILLED' : 'CONFIRMED'; }
  return { dead: false, prev, patch: { ...patch, status, state } };
}
const SYS_VIS = 'Kamu analis S&D/OB dari gambar chart. Baca level PERSIS dari skala harga. Wajib BUY atau SELL kecuali gambar bukan chart. Prioritaskan LIMIT pullback; MARKET hanya bila harga sudah di zona dan ada penolakan. Sebutkan zona yang terlihat di TF tinggi dan TF rendah pada perImageAnalyses. Isi perImageAnalyses (Indonesia), perImageAnalysesEn (Inggris), reason (Indonesia), reasonEn (Inggris) dengan angka sama. SL di luar distal zona/swing. Balas HANYA JSON: {"signal":"BUY","orderType":"LIMIT","entry":0,"sl":0,"tp1":0,"tp2":0,"tp3":0,"tp4":0,"tp5":0,"zoneLow":0,"zoneHigh":0,"zone":"Demand","pair":"","decimals":2,"perImageAnalyses":[],"perImageAnalysesEn":[],"reason":"","reasonEn":""}';
async function handleVision(body, lang, res) {
  const imgs = (Array.isArray(body.images) ? body.images : []).filter(s => typeof s === 'string' && s.startsWith('data:image/')).slice(0, 3);
  if (!imgs.length) return res.status(200).json({ ok: false, reason: 'Gambar tidak valid.' });
  if (!VIS_KEY) return res.status(200).json({ ok: false, reason: 'OPENAI_API_KEY belum diatur.' });
  const style = normStyle(body.style);
  const content = [{ type: 'text', text: 'Jumlah gambar: ' + imgs.length + '. Style: ' + style + '.' }, ...imgs.flatMap((u, i) => [{ type: 'text', text: 'Gambar ' + (i + 1) + ':' }, { type: 'image_url', image_url: { url: u } }])];
  let r = null;
  try {
    r = await httpJson(AI_BASE + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + VIS_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: VIS_MODEL, max_completion_tokens: 1800, messages: [{ role: 'system', content: SYS_VIS }, { role: 'user', content }] }) }, 50000);
  } catch (e) { return res.status(200).json({ ok: false, reason: 'AI timeout: ' + e.message }); }
  if (!r || !r.ok) return res.status(200).json({ ok: false, reason: 'AI gagal (HTTP ' + (r ? r.status : 0) + ').' });
  let txt = String(r.data?.choices?.[0]?.message?.content || '').replace(/```(?:json)?/gi, '').replace(/```/g, '');
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  let j = null;
  if (a >= 0 && b > a) { try { j = JSON.parse(txt.slice(a, b + 1)); } catch {} }
  const sg = String(j?.signal || '').toUpperCase();
  const e0 = Number(j?.entry), s0 = Number(j?.sl);
  if (!j || (sg !== 'BUY' && sg !== 'SELL') || !(e0 > 0) || !(s0 > 0)) return res.status(200).json({ ok: false, reason: 'AI tidak memberi setup valid.' });
  const sym = String(j.pair || 'CHART').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'CHART';
  const dec = Number.isInteger(j.decimals) ? j.decimals : (DEC[sym] ?? 2);
  const pip = pipOf(sym, dec);
  const f = v => Number(Number(v).toFixed(dec));
  const dir = sg === 'BUY' ? 1 : -1;
  const entry = f(e0);
  const risk = Math.abs(e0 - s0) || pip * 10;
  const sl = f(entry - dir * risk);
  const at = [j.tp1, j.tp2, j.tp3].map(Number);
  const okT = at.every(v => Number.isFinite(v) && (dir === 1 ? v > entry : v < entry));
  const [t1, t2, t3] = okT ? at.map(f) : [1.5, 2.25, 3].map(k => f(entry + dir * risk * k));
  const t4 = Number.isFinite(Number(j.tp4)) ? f(Number(j.tp4)) : f(entry + dir * risk * 4);
  const t5 = Number.isFinite(Number(j.tp5)) ? f(Number(j.tp5)) : f(entry + dir * risk * 5);
  const zl = f(Number(j.zoneLow) || Math.min(entry, entry - dir * risk * 0.5));
  const zh = f(Number(j.zoneHigh) || Math.max(entry, entry - dir * risk * 0.5));
  const pi = Array.isArray(j.perImageAnalyses) ? j.perImageAnalyses.map(String) : [];
  const pe = Array.isArray(j.perImageAnalysesEn) ? j.perImageAnalysesEn.map(String) : pi;
  const rid = '[' + sym + ' · Analisa ' + imgs.length + ' Gambar]\n' + pi.map(t => '• ' + t).join('\n') + '\n\n[Setup]\n' + (j.reason || '');
  const ren = '[' + sym + ' · ' + imgs.length + '-Image Analysis]\n' + pe.map(t => '• ' + t).join('\n') + '\n\n[Setup]\n' + (j.reasonEn || j.reason || '');
  const isLimit = String(j.orderType || '').toUpperCase() === 'LIMIT';
  const out = {
    signal: sg, orderType: isLimit ? 'LIMIT' : 'MARKET', fill: isLimit ? 'LIMIT' : 'NOW', status: isLimit ? 'PENDING' : 'RUNNING',
    entryMode: isLimit ? 'PULLBACK' : 'NOW',
    symbol: sym, pair: sym, dec, pip, style, entry, sl, tp1: t1, tp2: t2, tp3: t3, tp4: t4, tp5: t5,
    riskPips: Math.round((risk / pip) * pipScaleOf(sym)), pipDisplayScale: pipScaleOf(sym),
    tpHits: [], tpHitCount: 0, maxTpHit: 0, be: false, slBe: null,
    zone: { min: zl, max: zh, label: (j.zone || 'Zona') + ' ' + zl + '–' + zh },
    reason: lang === 'en' ? ren : rid, reasons: { id: rid, en: ren }, reasonSource: 'AI', aiReasoning: true,
    createdAt: Date.now(), lastTickAt: Date.now(), filledAt: isLimit ? null : Date.now(),
    expiresAt: Date.now() + (EXPMS[style] || 18e5), source: 'VISION_AI',
  };
  await saveSignal(out);
  return res.status(200).json({ ok: true, mode: 'vision', symbol: sym, pair: sym, dec, pip, price: entry, style, signal: out });
}
function normStyle(raw) {
  const k = String(raw || '').toLowerCase();
  if (k.includes('swing')) return 'Swing';
  if (k.includes('intraday')) return 'Intraday';
  return 'Scalping';
}
async function handleCandles(body, lang, res, isBot, email) {
  const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
  const style = isBot ? 'scalperbot' : normStyle(body.style || body.mode);
  const price = Number(body.price ?? body.livePrice ?? 0);
  if (!(price > 0)) return res.status(200).json({ ok: false, reason: 'Harga live belum tersedia.' });
  const dec = DEC[symbol] ?? 2;
  const pipScale = pipScaleOf(symbol);
  const ctx = { symbol, dec, price, pip: pipOf(symbol, dec), pipScale, dp: v => Math.round(num(v) * pipScale), f: v => Number(num(v, price).toFixed(dec)) };
  const tfs = ['m1', 'm5', 'm15', 'h1', 'h4', 'd1'];
  const data = {};
  for (const tf of tfs) {
    const inc = clean((body.candles || {})[tf] ?? body[tf]);
    if (inc.length) { data[tf] = inc; cache.set(symbol + tf, { t: Date.now(), rows: inc }); }
    else data[tf] = [];
  }
  const need = isBot ? ['m1', 'm5', 'm15'] : (NEED[style] || NEED.Scalping);
  await Promise.all(need.map(async tf => {
    if (data[tf].length >= (MINB[tf] || 25)) return;
    const rows = await tlRows(symbol, TFIV[tf], 200);
    if (rows.length) { data[tf] = rows; cache.set(symbol + tf, { t: Date.now(), rows }); return; }
    const c = cache.get(symbol + tf);
    if (c && Date.now() - c.t < 12e4) data[tf] = c.rows;
  }));
  if (!data.m5.length && !data.m15.length && !data.m1.length) return res.status(200).json({ ok: false, reason: 'Data candle belum cukup.' });
  let out;
  try { out = isBot ? runBot(ctx, data) : await runManual(ctx, data, style); }
  catch (e) { out = standby(ctx, style, 'Engine error: ' + e.message, []); }
  if (!out || !out.signal) out = standby(ctx, style, 'Menunggu setup valid.', []);
  const key = symbol + '|' + style;
  const clientPrev = (body.prevSignal && typeof body.prevSignal === 'object') ? body.prevSignal : null;
  const storePrev = await loadSignal(symbol, style);
  const prev = pickPrev(clientPrev, storePrev);
  const restored = !clientPrev && !!storePrev;
  const life = lifecycle(prev, symbol, style, price, ctx.pip, data);
  if (life && life.dead) {
    await saveOutcome(key, { dir: life.prev.signal, out: life.out, t: Date.now() });
    await dropSignal(symbol, style);
  }
  if (life && life.dead && life.out === 'TP5') {
    const fin = { ...life.prev, ...life.patch, sticky: true, finished: true };
    if (fin.reasons) fin.reason = lang === 'en' ? (fin.reasons.en || fin.reasons.id) : (fin.reasons.id || fin.reasons.en);
    return res.status(200).json({ ok: true, mode: isBot ? 'bot' : 'candles', symbol, style, price, signal: fin, diag: { version: VERSION, lifecycle: 'TP5', finished: true, store: kvOn ? 'KV' : 'MEM' } });
  }
  if (life && !life.dead) {
    const managed = { ...life.prev, ...life.patch, sticky: true };
    const opp = out.signal.status !== 'STANDBY' && out.signal.signal !== managed.signal;
    if (!(body.forceNew && opp)) {
      await saveSignal(managed);
      if (managed.reasons) managed.reason = lang === 'en' ? (managed.reasons.en || managed.reasons.id) : (managed.reasons.id || managed.reasons.en);
      return res.status(200).json({ ok: true, mode: isBot ? 'bot' : 'candles', symbol, style, price, signal: managed, diag: { version: VERSION, lifecycle: managed.state, tpHits: managed.tpHits, filled: !!managed.filledAt, sticky: true, restored, store: kvOn ? 'KV' : 'MEM' } });
    }
  }
  const oc = await loadOutcome(key);
  if (out.signal.status !== 'STANDBY' && oc && (oc.out === 'SL' || oc.out === 'INVALID') && Date.now() - oc.t < COOLDOWN && out.signal.signal === oc.dir) {
    const remain = Math.max(1, Math.ceil((COOLDOWN - (Date.now() - oc.t)) / 6e4));
    out = standby(ctx, style, 'Cooldown setelah ' + oc.out + ' ' + oc.dir + '. Kembali lagi setelah 5 menit (sisa ' + remain + ' menit) — menunggu struktur internal baru.', []);
  }
  if (isBot && out.signal.status !== 'STANDBY') { try { await markTrialBotUsed(email); } catch {} }
  const f = out.facts || { symbol, style, status: 'STANDBY', why: '', steps: [], dec, price: ctx.f(price) };
  const ck = key + '|' + f.status + '|' + (f.signal || '') + '|' + (f.entry || '') + '|' + String(f.why || '').slice(0, 40);
  let story = stories.get(ck);
  if (!story || Date.now() - story.t > 12e4) {
    const r = isBot ? await reasonBot(f) : await reasonManual(f);
    story = { t: Date.now(), v: r };
    stories.set(ck, story);
    if (stories.size > 200) stories.delete(stories.keys().next().value);
  }
  const signal = { ...out.signal, reason: lang === 'en' ? story.v.en : story.v.id, reasons: { id: story.v.id, en: story.v.en }, reasonSource: story.v.ai ? 'AI' : 'RULES', aiReasoning: !!story.v.ai };
  if (signal.status !== 'STANDBY') await saveSignal(signal);
  return res.status(200).json({ ok: true, mode: isBot ? 'bot' : 'candles', symbol, style, price, signal, diag: { version: VERSION, status: signal.status, entryMode: signal.entryMode || null, forced: !!signal.forced, pipDisplayScale: pipScale, zonesHtf: f.zonesHtf || null, zonesM5: f.zonesM5 || null, restored, store: kvOn ? 'KV' : 'MEM' } });
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-email');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ ok: true, version: VERSION, store: kvOn ? 'KV' : 'MEM', note: 'generate alive' });
  if (req.method !== 'POST') return res.status(200).json({ ok: false, reason: 'Method not allowed' });
  let body = {};
  try {
    body = req.body || {};
    if (typeof body === 'string') body = JSON.parse(body);
    if (body.probe) return res.status(200).json({ ok: true, version: VERSION, store: kvOn ? 'KV' : 'MEM' });
    const lang = body.lang === 'en' ? 'en' : 'id';
    const email = String(body.email || body.value || '').trim().toLowerCase();
    const isBot = !!(body.auto || body.bot || body.mode === 'bot' || body.source === 'bot');
    const isVis = body.symbol === 'VISION' || body.mode === 'vision' || (Array.isArray(body.images) && body.images.length);
    const acc = await checkAccess(email, isBot);
    if (!acc.ok) return res.status(200).json({ ok: false, reason: 'Akses: ' + acc.key });
    if (isVis) return await handleVision(body, lang, res);
    return await handleCandles(body, lang, res, isBot, email);
  } catch (err) {
    console.error('fatal', err);
    if (!res.headersSent) return res.status(200).json({ ok: false, reason: 'Server error: ' + (err?.message || 'unknown'), version: VERSION });
  }
}
