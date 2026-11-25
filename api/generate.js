// api/generate.js — v197 (Scalping SL = Swing Terakhir + Min 50 pip + Max 100 pip)
// - [v197] Scalping SL min 50 pip, max 100 pip (sama seperti Intraday)
// - [v197] SL SELALU di swing terakhir + buffer — bukan di distal zona tipis
// - [v197] Zona min width 20 pip — hindari zona FOMO tipis
// - [v197] Tidak ada cap ketat yang menghalangi signal

import { checkAccess, markTrialBotUsed } from '../lib/access.js';
import { generateManualPlan, buildWatchlist, SYARAT_MASUK } from '../lib/manual_scalp.js';
import { planIntraday, planSwing, planScalping } from '../lib/mtf-engine.js';
import { planBot } from '../lib/bot-ict.js';
import { simpleZonePlan, scalpWatch } from '../lib/smc_flex.js';
import { runBotSma as runBotFlex } from '../lib/bot_3candle.js';

export const config = { maxDuration: 60 };
const VERSION = 'v197';
const TL_BASE = 'https://api.tickerlayer.com';
const AI_BASE = (process.env.QWEN_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/+$/, '');
const AI_KEYS = [process.env.QWEN_MANUAL_API_KEY, process.env.QWEN_API_KEY, process.env.QWEN_API_KEY_2, process.env.OPENAI_API_KEY].filter(Boolean);
const AI_MODELS = [process.env.QWEN_MANUAL_MODEL || 'qwen-4-max', process.env.QWEN_MODEL || 'deepseek-v4-flash'];
const VIS_MODEL = process.env.AI_VISION_MODEL || 'gpt-6-luna';
const VIS_KEY = process.env.OPENAI_API_KEY || AI_KEYS[0] || '';
const TL_KEYS = ['TICKERLAYER_API_KEY', ...Array.from({ length: 19 }, (_, i) => 'TICKERLAYER_API_KEY_' + (i + 1))].map(n => process.env[n] || '').filter(Boolean);
const DEC = { XAUUSD: 2, XAGUSD: 3, BTCUSD: 2, ETHUSD: 2, SOLUSD: 2, XRPUSD: 4, BNBUSD: 2, DXY: 2, US30: 2, NAS100: 2, SPX500: 2, GER40: 2, UK100: 2, JPN225: 0, EURUSD: 5, GBPUSD: 5, USDJPY: 3, AUDUSD: 5, USDCAD: 5, USDCHF: 5, NZDUSD: 5 };
const PIP = { XAUUSD: 0.1, BTCUSD: 1, DXY: 0.01, US30: 1, NAS100: 1 };
const PIP_DISPLAY = { BTCUSD: 0.1 };
const pipOf = (s, d) => PIP[s] ?? Math.pow(10, -(d - 1));
const pipScaleOf = s => PIP_DISPLAY[s] ?? 1;
const isGold = s => s === 'XAUUSD' || s === 'XAUUSDX';
const TFMS = { m1: 6e4, m5: 3e5, m15: 9e5, m30: 18e5, h1: 36e5, h4: 144e5, d1: 864e5 };
const TFIV = { m1: '1m', m5: '5m', m15: '15m', m30: '30m', h1: '1h', h4: '4h', d1: '1d' };
const TFSPAN = { m1: [1, 'minute', 1], m5: [5, 'minute', 5], m15: [15, 'minute', 15], m30: [30, 'minute', 30], h1: [1, 'hour', 60], h4: [4, 'hour', 240], d1: [1, 'day', 1440] };
const NEED = { Scalping: ['m5', 'm15', 'm30'], Intraday: ['m5', 'm15', 'h1', 'h4'], Swing: ['m15', 'h1', 'h4', 'd1'] };
const MINB = { m1: 60, m5: 40, m15: 40, m30: 35, h1: 35, h4: 25, d1: 20 };
const EXPMS = { Scalping: (Number(process.env.EXP_SCALP_MIN) || 60) * 6e4, Intraday: (Number(process.env.EXP_INTRADAY_MIN) || 480) * 6e4, Swing: (Number(process.env.EXP_SWING_MIN) || 5760) * 6e4 };
const HTF_OF = { Scalping: 'm30', Intraday: 'h4', Swing: 'd1' };
const MAXPIP = { Scalping: 500, Intraday: 700, Swing: 2500 };
const PROX = { Scalping: 50, Intraday: 80, Swing: 200 };

// [v197] Scalping SL min 50 pip, max 100 pip — sama seperti Intraday
const RULES = {
  Scalping: { gMin: 50, gMax: 100, bMin: 0.005, bMax: 0.012, tps: [1, 1.5, 2, 3, 5] },
  Intraday: { gMin: 50, gMax: 120, bMin: 0.005, bMax: 0.014, tps: [1, 1.5, 2, 3, 5] },
  Swing:    { gMin: 100, gMax: 300, bMin: 0.01,  bMax: 0.025, tps: [1, 1.5, 2, 3, 5] },
};

// [v197] Zona min width 20 pip — hindari zona FOMO tipis
const MIN_ZONE_WIDTH = { Scalping: 20, Intraday: 20, Swing: 30 };

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
const stTag = s => (s.dir === 0 ? 'belum ada BOS/CHOCH' : (s.ev || (s.dir === 1 ? 'BOS_UP' : 'BOS_DOWN')) + (s.fresh ? ' (fresh)' : ' (stale)'));
const stTagEn = s => (s.dir === 0 ? 'no BOS/CHOCH yet' : (s.ev || (s.dir === 1 ? 'BOS_UP' : 'BOS_DOWN')) + (s.fresh ? ' (fresh)' : ' (stale)'));

const TP_MULTIPLIERS = [1, 1.5, 2, 3, 5];
function buildTPs(entry, dir, risk, multipliers = TP_MULTIPLIERS) {
  if (!(risk > 0) || !Number.isFinite(entry)) return [entry, entry, entry, entry, entry];
  return multipliers.map(m => entry + dir * risk * m);
}

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

function internal(rows, lb = 60) {
  const o = { dir: 0, ev: '', fresh: false, strong: false };
  if (!Array.isArray(rows) || rows.length < 25) return o;
  const a = rows.slice(-lb);
  const n = a.length;
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
  o.ev = ev;
  o.dir = tr;
  o.fresh = tr !== 0 && bi >= n - 12;
  o.strong = o.fresh;
  return o;
}

function ranging(rows, lb = 30, tf = 'M15') {
  if (!Array.isArray(rows) || rows.length < lb) return null;
  const a = rows.slice(-lb);
  const hi = Math.max(...a.map(c => c.h)), lo = Math.min(...a.map(c => c.l));
  const h = hi - lo;
  if (!(h > 0)) return null;
  const st = internal(a, lb);
  if (st.fresh) return null;
  const nearHi = a.filter(c => c.h >= hi - 0.15 * h).length;
  const nearLo = a.filter(c => c.l <= lo + 0.15 * h).length;
  if (nearHi >= 2 && nearLo >= 2) return { hi, lo, h, pos: (a[a.length - 1].c - lo) / h, tf };
  return null;
}

function getPDZone(rows, lb = 60) {
  if (!Array.isArray(rows) || rows.length < 10) return null;
  const a = rows.slice(-lb);
  const hi = Math.max(...a.map(c => c.h));
  const lo = Math.min(...a.map(c => c.l));
  const range = hi - lo;
  if (range <= 0) return null;
  return { hi, lo, eq: lo + (range * 0.5), ote: lo + (range * 0.618), alt: lo + (range * 0.382), range };
}

function structureState(ht, it, lt, price, pd) {
  if (!pd) return { id: 'Struktur belum jelas.', en: 'Structure unclear.' };
  const ratio = (price - pd.lo) / pd.range;
  const inPremium = ratio >= 0.5;
  if (ht.dir === it.dir && it.dir === lt.dir) return { id: 'Semua TF searah — continuation.', en: 'All TFs aligned — continuation.' };
  if (ht.dir !== 0 && it.dir !== 0 && ht.dir !== it.dir) {
    if (lt.dir === it.dir) {
      return inPremium && ht.dir === 1 ? { id: 'Reversal di area premium HTF — potensi SELL.', en: 'Reversal at HTF premium — potential SELL.' }
        : !inPremium && ht.dir === -1 ? { id: 'Reversal di area discount HTF — potensi BUY.', en: 'Reversal at HTF discount — potential BUY.' }
        : { id: 'Internal lawan HTF dengan konfirmasi LTF.', en: 'Internal against HTF with LTF confirmation.' };
    }
    return { id: 'Retracement melawan HTF.', en: 'Retracement against HTF.' };
  }
  if (ht.dir !== 0 && it.dir === 0) return { id: 'HTF berjalan, MTF konsolidasi.', en: 'HTF running, MTF consolidating.' };
  return { id: 'Transisi struktur.', en: 'Structure transition.' };
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

function zonesFromRows(rows, tfLabel, ctx, lb = 90, style = 'Scalping') {
  if (!Array.isArray(rows) || rows.length < 12) return [];
  const a = rows.slice(-lb);
  const at = atr(a) || ctx.pip * 10;
  const minWidth = (MIN_ZONE_WIDTH[style] || 20) * ctx.pip;
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
    if ((z.hi - z.lo) < minWidth) continue;
    if ((z.hi - z.lo) / ctx.price > 0.03) continue;
    if (kept.some(k => k.side === z.side && !(z.hi < k.lo || z.lo > k.hi))) continue;
    kept.push(z);
    if (kept.length >= 6) break;
  }
  return kept;
}

function zoneLine(list, ctx, en, maxPip) {
  if (!list || !list.length) return en ? 'no fresh zone readable yet.' : 'belum ada zona fresh terbaca.';
  const near = list.filter(z => {
    const inside = ctx.price >= z.lo && ctx.price <= z.hi;
    const d = (z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi) / ctx.pip;
    return inside || d <= (maxPip || 50);
  }).slice(0, 3);
  if (!near.length) return en ? 'no zone within proximity.' : 'tidak ada zona dalam proksimitas.';
  return near.map(z => {
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
  const tol = 0.8 * a;
  return list.filter(z => z.side === want)
    .filter(z => (dir === 1 ? z.lo <= ctx.price + tol : z.hi >= ctx.price - tol))
    .map(z => ({ ...z, d: dir === 1 ? ctx.price - z.hi : z.lo - ctx.price }))
    .sort((x, y) => x.d - y.d);
}

function bounds(entry, ctx, style) {
  const r = RULES[style] || RULES.Scalping;
  return isGold(ctx.symbol) ? { min: r.gMin * ctx.pip, max: r.gMax * ctx.pip } : { min: entry * r.bMin, max: entry * r.bMax };
}

// [v197] invalidation: cari swing terakhir, bukan hanya distal zona
function invalidation(p, ctx, bars) {
  const dir = p.dir;
  const zl = Number(p.zone && p.zone.lo), zh = Number(p.zone && p.zone.hi);
  const distal = dir === 1 ? zl : zh;
  const cands = [];
  if (Number.isFinite(distal)) cands.push(distal);
  if (Number.isFinite(Number(p.invalidLevel))) cands.push(Number(p.invalidLevel));
  
  // [v197] Cari swing terakhir dari bars
  if (Array.isArray(bars) && bars.length >= 10) {
    const n = bars.slice(-15);
    const swing = dir === 1 ? Math.min(...n.map(c => c.l)) : Math.max(...n.map(c => c.h));
    if (Number.isFinite(swing)) cands.push(swing);
  }
  
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

// [v197] applyRisk: SL di swing terakhir, min 50 pip, max 100 pip untuk Scalping
function applyRisk(p, ctx, bars, style, allowCap = true) {
  const r = RULES[style] || RULES.Scalping;
  const b = bounds(p.entry, ctx, style);
  const inv = invalidation(p, ctx, bars);
  const buf = 0.1 * (atr(bars) || ctx.pip * 10); // Buffer lebih besar
  const structNeed = Number.isFinite(inv) ? Math.abs(p.entry - inv) + buf : 0;
  const cap = b.max;
  let need = Math.max(structNeed, b.min);
  if (need > cap) { need = cap; p.slCapped = true; }
  p.sl = p.entry - p.dir * need;
  const multipliers = Array.isArray(r.tps) && r.tps.length >= 5 ? r.tps : TP_MULTIPLIERS;
  p.tps = buildTPs(p.entry, p.dir, need, multipliers);
  p.tp4 = p.tps[3];
  p.tp5 = p.tps[4];
  p.rr = multipliers[0];
  p.riskPips = ctx.dp(need / ctx.pip);
  if (Number.isFinite(inv)) p.invalidLevel = inv;
  return { reject: false, inv: Number.isFinite(inv) ? ctx.f(inv) : null };
}

function scoreZone(z, ht, it, lt, ctx, style) {
  let score = 0;
  const width = (z.hi - z.lo) / ctx.pip;
  const minW = MIN_ZONE_WIDTH[style] || 20;
  if (width >= minW && width <= minW * 4) score += 25;
  else if (width >= minW) score += 15;
  else score += 5;
  if (z.tf === HTF_OF[style].toUpperCase()) score += 20;
  else if (z.tf === 'M15') score += 15;
  else if (z.tf === 'M5') score += 10;
  const dir = z.side === 'demand' ? 1 : -1;
  if (ht.dir === dir) score += 15;
  if (it.dir === dir) score += 10;
  if (lt.dir === dir) score += 5;
  if (it.fresh && it.dir === dir) score += 8;
  if (lt.fresh && lt.dir === dir) score += 5;
  const inside = ctx.price >= z.lo && ctx.price <= z.hi;
  const d = inside ? 0 : (dir === 1 ? ctx.price - z.hi : z.lo - ctx.price) / ctx.pip;
  if (inside) score += 15;
  else if (d <= 10) score += 12;
  else if (d <= 20) score += 8;
  else if (d <= 50) score += 4;
  return { score, width, d, inside };
}

function chooseBestZone(ctx, ht, it, lt, allZones, style) {
  const prox = PROX[style] || 50;
  const candidates = allZones.filter(z => {
    const inside = ctx.price >= z.lo && ctx.price <= z.hi;
    const d = (z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi) / ctx.pip;
    return inside || d <= prox * 2;
  });
  if (!candidates.length) return null;
  const scored = candidates.map(z => {
    const s = scoreZone(z, ht, it, lt, ctx, style);
    return { z, ...s };
  }).sort((a, b) => b.score - a.score);
  return scored[0];
}

function synthesizeZone(ctx, ht, it, lt, style, execRows) {
  const dir = ht.dir || it.dir || lt.dir || 1;
  const a = atr(execRows) || ctx.pip * 10;
  const n = Array.isArray(execRows) && execRows.length >= 6 ? execRows.slice(-15) : [];
  if (n.length < 4) return null;
  const swing = dir === 1 ? Math.min(...n.map(c => c.l)) : Math.max(...n.map(c => c.h));
  const w = Math.max(0.3 * a, ctx.pip * 15);
  const z = dir === 1
    ? { lo: swing, hi: swing + w, side: 'demand', kind: 'Swing Low', tf: style === 'Scalping' ? 'M5' : 'M15', isSynthetic: true }
    : { lo: swing - w, hi: swing, side: 'supply', kind: 'Swing High', tf: style === 'Scalping' ? 'M5' : 'M15', isSynthetic: true };
  return { z, score: 30, width: w / ctx.pip, d: Math.abs(ctx.price - (dir === 1 ? z.hi : z.lo)) / ctx.pip, inside: false, dir };
}

function entryMode(ctx, p, it, lt, bars, style, exec, cands, opts = {}) {
  const a = atr(bars) || ctx.pip * 10;
  const prox = PROX[style] || 50;
  const align = it.dir === p.dir && lt.dir === p.dir;
  const structOk = it.fresh || lt.fresh;
  const deep = opts.deep || new Set();
  const calc = z => {
    const zl = z.lo, zh = z.hi, w = zh - zl;
    const isDeep = deep.has(zl + '|' + zh);
    const inside = ctx.price >= zl && ctx.price <= zh;
    const beyond = p.dir === 1 ? ctx.price < zl : ctx.price > zh;
    let lim;
    if (inside) lim = ctx.price;
    else if (p.dir === 1) lim = zh + Math.min(2 * ctx.pip, 0.1 * w);
    else lim = zl - Math.min(2 * ctx.pip, 0.1 * w);
    const sideOk = p.dir === 1 ? lim <= ctx.price : lim >= ctx.price;
    const distPip = Math.abs(ctx.price - lim) / ctx.pip;
    return { z, inside, beyond, lim, sideOk, distPip, isDeep };
  };
  const pool = (cands && cands.length) ? cands : (p.zone && Number.isFinite(p.zone.lo) ? [{ ...p.zone, tf: 'Plan' }] : []);
  for (const z of pool) {
    const c = calc(z);
    if (c.beyond) continue;
    if (c.inside && !opts.ranging && align && structOk && style === 'Scalping')
      return { type: 'MARKET', entry: ctx.price, zone: z, note: 'NOW: harga di dalam zona ' + (z.tf ? z.tf + ' ' : '') + z.kind + ' dan struktur searah — eksekusi langsung.' };
    if (c.sideOk && c.distPip <= prox)
      return { type: c.distPip < 2 ? 'MARKET' : 'LIMIT', entry: c.distPip < 2 ? ctx.price : c.lim, zone: z, note: (c.distPip < 2 ? 'NOW' : 'LIMIT') + ' di tepi zona ' + (z.tf ? z.tf + ' ' : '') + z.kind + ' @ ' + ctx.f(c.distPip < 2 ? ctx.price : c.lim) + ' (' + ctx.dp(c.distPip) + ' pip dari harga).' };
  }
  const b = bounds(ctx.price, ctx, style);
  const a1 = atr(exec) || ctx.pip * 10;
  const n = Array.isArray(exec) && exec.length >= 6 ? exec.slice(-15) : bars.slice(-15);
  const swing = p.dir === 1 ? Math.min(...n.map(c => c.l)) : Math.max(...n.map(c => c.h));
  const off = Math.max(2 * ctx.pip, Math.min(Math.abs(ctx.price - swing), 10 * ctx.pip));
  const entry = ctx.price - p.dir * off;
  const w2 = Math.max(0.3 * a1, 10 * ctx.pip);
  const z = { lo: p.dir === 1 ? entry - w2 : entry, hi: p.dir === 1 ? entry : entry + w2, side: p.dir === 1 ? 'demand' : 'supply', kind: 'Swing ' + (style === 'Scalping' ? 'M5' : 'M15'), tf: style === 'Scalping' ? 'M5' : 'M15', isSynthetic: true };
  return { type: 'LIMIT', entry, zone: z, forced: true, note: 'LIMIT @ ' + ctx.f(entry) + ' (' + ctx.dp(off / ctx.pip) + ' pip): zona sintetis dari swing terdekat. SL ' + ctx.dp(b.max / ctx.pip) + ' pip di luar swing.' };
}

function sigOf(p, ctx, style) {
  const f = ctx.f;
  const riskUsed = p.riskPips ? p.riskPips * ctx.pip : (Math.abs(p.entry - p.sl) || bounds(p.entry, ctx, style).min);
  const tps = buildTPs(p.entry, p.dir, riskUsed, TP_MULTIPLIERS);
  const q = p.zoneQuality || 0;
  const conf = q >= 70 ? 'HIGH' : q >= 50 ? 'MEDIUM' : q >= 30 ? 'LOW' : 'LOW';
  const riskLvl = q >= 70 ? 'LOW' : q >= 50 ? 'MEDIUM' : 'HIGH';
  const s = {
    signal: p.dir === 1 ? 'BUY' : 'SELL', orderType: p.type, fill: p.type === 'MARKET' ? 'NOW' : 'LIMIT',
    status: p.type === 'MARKET' ? 'RUNNING' : 'PENDING', state: p.type === 'MARKET' ? 'CONFIRMED' : 'LIMIT_PLACED',
    entry: f(p.entry), sl: f(p.sl),
    tp1: f(tps[0]), tp2: f(tps[1]), tp3: f(tps[2]),
    tp4: f(tps[3]), tp5: f(tps[4]),
    invalidLevel: Number.isFinite(Number(p.invalidLevel)) ? f(p.invalidLevel) : null,
    zone: p.zone ? { min: f(p.zone.lo), max: f(p.zone.hi), label: p.zone.kind } : null,
    zoneLabel: p.zone ? p.zone.kind : '', rr: Number(num(p.rr, 1).toFixed(2)), riskPips: p.riskPips ?? null,
    pipDisplayScale: ctx.pipScale ?? 1,
    tpMode: 'RISK_R', setup: 'Manual ' + style, confidence: conf, risk: riskLvl, forced: !!p.forced,
    zoneQuality: q,
    symbol: ctx.symbol, style, role: 'main', createdAt: Date.now(), lastTickAt: Date.now(),
    filledAt: p.type === 'MARKET' ? Date.now() : null,
    expiresAt: Date.now() + (EXPMS[style] || 18e5),
    entryMode: p.type === 'MARKET' ? 'NOW' : 'PULLBACK', entryNote: p.note || null,
    tpHits: [], tpHitCount: 0, maxTpHit: 0, be: false, slBe: null,
    checklist: p.steps || [], reason: '', reasons: { id: '', en: '' },
  };
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

function buildNarrative(ctx, style, ht, it, lt, pd, state, chosen, p, en) {
  const pdLabel = pd ? ((ctx.price - pd.lo) / pd.range >= 0.5 ? 'premium' : 'discount') : 'netral';
  const zoneLabel = chosen && chosen.zone ? (en ? 'zone ' + ctx.f(chosen.zone.lo) + '-' + ctx.f(chosen.zone.hi) + ' (' + ctx.dp(chosen.d) + ' pips)' : 'zona ' + ctx.f(chosen.zone.lo) + '-' + ctx.f(chosen.zone.hi) + ' (' + ctx.dp(chosen.d) + ' pip)') : (en ? 'no nearby zone' : 'tidak ada zona dekat');
  const L = en ? {
    htf: () => HTF_OF[style].toUpperCase() + ' ' + dwEn(ht.dir) + ' (' + (ht.ev || 'BOS') + (ht.fresh ? ', fresh' : '') + '), harga di area ' + pdLabel + '.',
    mid: () => 'M15 ' + dwEn(it.dir) + ' (' + (it.ev || 'BOS') + (it.fresh ? ', fresh' : '') + '). ' + state.en,
    low: () => 'M5 ' + dwEn(lt.dir) + ' (' + (lt.ev || 'BOS') + (lt.fresh ? ', fresh' : ', stale') + '). ' + zoneLabel + '.',
    setup: () => {
      const ow = p.type === 'MARKET' ? 'MARKET' : 'LIMIT';
      return ctx.symbol + ': ' + (p.dir === 1 ? 'BUY' : 'SELL') + ' ' + ow + ' @ ' + ctx.f(p.entry) + ', SL ' + ctx.f(p.sl) + ' (' + p.riskPips + ' pips), TP ' + ctx.f(p.tps[0]) + '/' + ctx.f(p.tps[1]) + '/' + ctx.f(p.tps[2]) + '.';
    }
  } : {
    htf: () => HTF_OF[style].toUpperCase() + ' ' + dw(ht.dir) + ' (' + (ht.ev || 'BOS') + (ht.fresh ? ', fresh' : '') + '), harga di area ' + pdLabel + '.',
    mid: () => 'M15 ' + dw(it.dir) + ' (' + (it.ev || 'BOS') + (it.fresh ? ', fresh' : '') + '). ' + state.id,
    low: () => 'M5 ' + dw(lt.dir) + ' (' + (lt.ev || 'BOS') + (lt.fresh ? ', fresh' : ', stale') + '). ' + zoneLabel + '.',
    setup: () => {
      const ow = p.type === 'MARKET' ? 'MARKET' : 'LIMIT';
      return ctx.symbol + ': ' + (p.dir === 1 ? 'BUY' : 'SELL') + ' ' + ow + ' @ ' + ctx.f(p.entry) + ', SL ' + ctx.f(p.sl) + ' (' + p.riskPips + ' pip), TP ' + ctx.f(p.tps[0]) + '/' + ctx.f(p.tps[1]) + '/' + ctx.f(p.tps[2]) + '.';
    }
  };
  return { lines: [L.htf(), L.mid(), L.low()], setup: L.setup() };
}

function manualReason(f, en) {
  const lines = (f.steps || []).map(s => s.tf + ': ' + (en ? (s.textEn || s.text) : s.text));
  if (f.status === 'STANDBY') return layout(f, en, lines, f.symbol + ': ' + (f.why || (en ? 'waiting for a valid setup.' : 'menunggu setup valid.')));
  const tp = [f.tp1, f.tp2, f.tp3, f.tp4, f.tp5].filter(v => Number.isFinite(Number(v))).join(', ');
  const ow = f.orderType === 'MARKET' ? 'MARKET' : 'LIMIT';
  const inv = f.invalidLevel != null ? (en ? ' Invalidation ' + f.invalidLevel + '.' : ' Invalidasi ' + f.invalidLevel + '.') : '';
  return layout(f, en, lines, f.symbol + ': ' + (en ? 'final ' : 'keputusan final ') + f.signal + ' ' + ow + ' @ ' + f.entry + ', SL ' + f.sl + ', TP ' + tp + '.' + inv);
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
          body: JSON.stringify({ model: m, max_tokens: 600, temperature: 0.1, messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(obj) }] }),
        }, Math.min(15000, left));
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

const SYS_MTF = `Kamu analis trading profesional dengan gaya Vision: WAJIB memberi arah BUY atau SELL, tidak pernah netral.

DATA: struktur M30/M15/M5, zona terdekat (sudah difilter berkualitas), posisi premium/discount, setup final.

ATURAN WAJIB:
1. WAJIB BUY atau SELL — tidak pernah "menunggu" atau "netral"
2. Baca angka PERSIS dari JSON — jangan mengarang
3. Fokus pada zona yang dipakai entry — jangan sebut zona lain
4. Tulis 3 kalimat: M30 (arah + posisi), M15 (arah + status), M5 (arah + zona entry)
5. Setup: arah, entry, SL, TP — singkat, tanpa basa-basi
6. Jika confidence LOW, sebut "setup agresif" tapi tetap kasih arah
7. Bahasa seperti trader profesional, bukan robot

Balas HANYA JSON: {"perTfId":["M30: ...","M15: ...","M5: ..."],"perTfEn":["M30: ...","M15: ...","M5: ..."],"id":"...","en":"..."}`;

const SYS_BOT = 'Kamu mentor bot scalper. Jelaskan setup dalam 2-3 kalimat sederhana, wajib sebut BUY/SELL. Salin angka persis. Balas HANYA JSON: {"id":"...","en":"..."}';

async function reasonManual(f) {
  const fb = { id: manualReason(f, false), en: manualReason(f, true), ai: false };
  const j = await aiJson(SYS_MTF, f, 9000);
  if (!j || typeof j.id !== 'string' || typeof j.en !== 'string') return fb;
  const li = Array.isArray(j.perTfId) ? j.perTfId.map(String) : (f.steps || []).map(s => s.tf + ': ' + s.text);
  const le = Array.isArray(j.perTfEn) ? j.perTfEn.map(String) : (f.steps || []).map(s => s.tf + ': ' + (s.textEn || s.text));
  return { id: layout(f, false, li, j.id), en: layout(f, true, le, j.en), ai: true };
}

async function reasonBot(f) {
  const tp = [f.tp1, f.tp2, f.tp3, f.tp4, f.tp5].filter(v => v != null).join(', ');
  const fbId = f.status === 'STANDBY' ? 'Bot memantau ' + f.symbol + '. Bias ' + (f.bias || 'netral') + '. ' + (f.why || '') : 'Bot ' + f.signal + ' @ ' + f.entry + ', SL ' + f.sl + ', TP ' + tp + '.';
  const fbEn = f.status === 'STANDBY' ? 'Bot scanning ' + f.symbol + '. Bias ' + (f.bias || 'neutral') + '. ' + (f.why || '') : 'Bot ' + f.signal + ' at ' + f.entry + ', SL ' + f.sl + ', TP ' + tp + '.';
  const j = await aiJson(SYS_BOT, f, 8000);
  if (j && typeof j.id === 'string' && typeof j.en === 'string') return { id: j.id, en: j.en, ai: true };
  return { id: fbId, en: fbEn, ai: false };
}

async function runManual(ctx, d, style) {
  const cl = { m1: closed(d.m1, TFMS.m1), m5: closed(d.m5, TFMS.m5), m15: closed(d.m15, TFMS.m15), m30: closed(d.m30, TFMS.m30), h1: closed(d.h1, TFMS.h1), h4: closed(d.h4, TFMS.h4), d1: closed(d.d1, TFMS.d1) };
  let watch = [];
  try { if (style !== 'Scalping' && typeof buildWatchlist === 'function') watch = buildWatchlist({ ...cl, price: ctx.price, pip: ctx.pip, styleName: style }); } catch (e) { console.log('[v197] buildWatchlist error:', e.message); watch = []; }
  const htfKey = HTF_OF[style] || 'm30';
  const htfLabel = htfKey.toUpperCase();
  const zHtf = zonesFromRows(cl[htfKey], htfLabel, ctx, 90, style);
  const zM5 = zonesFromRows(cl.m5, 'M5', ctx, 90, style);
  const zM15 = zonesFromRows(cl.m15, 'M15', ctx, 90, style);
  const zH1 = zonesFromRows(cl.h1, 'H1', ctx, 90, style);
  const bars = style === 'Intraday' ? cl.m15 : style === 'Swing' ? cl.h4 : cl.m15;
  const it = style === 'Scalping' ? internal(cl.m15) : style === 'Intraday' ? internal(cl.m15) : internal(cl.h4);
  const lt = style === 'Scalping' ? internal(cl.m5) : style === 'Intraday' ? internal(cl.m5) : internal(cl.h1);
  const ht = internal(cl[htfKey]);
  let plan = null;
  try { if (style === 'Intraday') plan = planIntraday({ h4: cl.h4, h1: cl.h1, m15: cl.m15, m5: cl.m5, price: ctx.price, sym: ctx.symbol, tNow: Date.now() }); else if (style === 'Swing') plan = planSwing({ d1: cl.d1, h4: cl.h4, h1: cl.h1, m15: cl.m15, price: ctx.price, sym: ctx.symbol, tNow: Date.now() }); } catch { plan = null; }
  const steps = Array.isArray(plan && plan.steps) ? plan.steps.slice() : [];
  const prox = PROX[style] || 50;

  const allZones = dedupeZones([...zHtf, ...zM15, ...zM5, ...gaps(cl.m5).map(g => ({ ...g, tf: 'M5' }))]);
  const nearZones = allZones.filter(z => { const inside = ctx.price >= z.lo && ctx.price <= z.hi; const d = (z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi) / ctx.pip; return inside || d <= prox; });

  const best = chooseBestZone(ctx, ht, it, lt, allZones, style);
  const pd = getPDZone(style === 'Scalping' ? cl.m15 : cl.h4, 60);
  const state = structureState(ht, it, lt, ctx.price, pd);

  let chosen = best;
  if (!chosen) {
    const execRows = style === 'Scalping' ? cl.m5 : cl.m15;
    const synth = synthesizeZone(ctx, ht, it, lt, style, execRows);
    if (synth) chosen = synth;
  }

  const dir = chosen ? (chosen.z.side === 'demand' ? 1 : -1) : (ht.dir || it.dir || lt.dir || 1);
  const fallbackRisk = bounds(ctx.price, ctx, style).min;
  const p = { dir, entry: ctx.price, sl: ctx.price - dir * fallbackRisk, type: 'LIMIT', tps: buildTPs(ctx.price, dir, fallbackRisk), rr: 1, zone: chosen ? { lo: chosen.z.lo, hi: chosen.z.hi, kind: chosen.z.kind } : { lo: ctx.price, hi: ctx.price, kind: 'None' }, zoneQuality: chosen ? chosen.score : 0, steps };
  const opts = { deep: new Set() };
  let rangeZone = null;

  if (style === 'Scalping' && !chosen) { const rg = ranging(cl.m15, 30, 'M15') || ranging(cl.m5, 30, 'M5'); if (rg) { const dirR = rg.pos >= 0.5 ? -1 : 1; p.dir = dirR; const w = Math.max(0.2 * rg.h, 2 * ctx.pip); rangeZone = dirR === -1 ? { lo: rg.hi - w, hi: rg.hi, side: 'supply', kind: 'Range High', tf: rg.tf } : { lo: rg.lo, hi: rg.lo + w, side: 'demand', kind: 'Range Low', tf: rg.tf }; opts.ranging = true; } }

  steps.push({ tf: htfLabel, text: dw(ht.dir) + ' (' + (ht.ev || 'BOS') + (ht.fresh ? ', fresh' : '') + ') — harga di area ' + (pd ? ((ctx.price - pd.lo) / pd.range >= 0.5 ? 'premium' : 'discount') : 'netral'), textEn: dwEn(ht.dir) + ' (' + (ht.ev || 'BOS') + (ht.fresh ? ', fresh' : '') + ') — price in ' + (pd ? ((ctx.price - pd.lo) / pd.range >= 0.5 ? 'premium' : 'discount') : 'neutral') });
  steps.push({ tf: 'M15', text: dw(it.dir) + ' (' + (it.ev || 'BOS') + (it.fresh ? ', fresh' : '') + '). ' + state.id, textEn: dwEn(it.dir) + ' (' + (it.ev || 'BOS') + (it.fresh ? ', fresh' : '') + '). ' + state.en });
  steps.push({ tf: 'M5', text: dw(lt.dir) + ' (' + (lt.ev || 'BOS') + (lt.fresh ? ', fresh' : ', stale') + ')', textEn: dwEn(lt.dir) + ' (' + (lt.ev || 'BOS') + (lt.fresh ? ', fresh' : ', stale') + ')' });
  steps.push({ tf: 'Zona dekat', text: zoneLine(nearZones, ctx, false, prox), textEn: zoneLine(nearZones, ctx, true, prox) });
  if (chosen) steps.push({ tf: 'Zona Terpilih', text: chosen.z.kind + ' ' + ctx.f(chosen.z.lo) + '–' + ctx.f(chosen.z.hi) + ' (skor ' + chosen.score + '/100, lebar ' + ctx.dp(chosen.width) + ' pip, ' + ctx.dp(chosen.d) + ' pip dari harga)', textEn: chosen.z.kind + ' ' + ctx.f(chosen.z.lo) + '–' + ctx.f(chosen.z.hi) + ' (score ' + chosen.score + '/100, width ' + ctx.dp(chosen.width) + ' pips, ' + ctx.dp(chosen.d) + ' pips from price)' });
  steps.push({ tf: 'Validasi', text: 'SL min ' + ctx.dp(RULES[style].gMin) + ' pip, cap ' + ctx.dp(RULES[style].gMax) + ' pip. TP 1/1.5/2/3/5R. Zona min ' + MIN_ZONE_WIDTH[style] + ' pip. SL di swing terakhir.', textEn: 'SL min ' + ctx.dp(RULES[style].gMin) + ' pips, cap ' + ctx.dp(RULES[style].gMax) + ' pips. TP 1/1.5/2/3/5R. Min zone width ' + MIN_ZONE_WIDTH[style] + ' pips. SL at last swing.' });

  let pool = [];
  if (chosen) pool.push({ ...chosen.z, tf: chosen.z.tf || 'MTF', d: chosen.d });
  for (const z of dedupeZones(nearZones)) if (!pool.some(k => k.lo === z.lo && k.hi === z.hi)) pool.push({ ...z, d: Math.abs(ctx.price - (z.lo >= ctx.price ? z.lo : z.hi)) / ctx.pip });
  if (style === 'Scalping') { const htfC = candidatesFor(ctx, dedupeZones(zHtf), p.dir, bars); const midC = candidatesFor(ctx, dedupeZones(zM15), p.dir, bars); const lowC = candidatesFor(ctx, dedupeZones([...zM5, ...gaps(cl.m5).map(g => ({ ...g, tf: 'M5' }))]), p.dir, bars); for (const z of [...htfC, ...midC, ...lowC]) if (!pool.some(k => k.lo === z.lo && k.hi === z.hi)) pool.push(z); } else { for (const z of candidatesFor(ctx, dedupeZones([...zH1, ...zHtf, ...zM15]), p.dir, bars)) if (!pool.some(k => k.lo === z.lo && k.hi === z.hi)) pool.push(z); }
  if (rangeZone) pool.unshift({ ...rangeZone, d: p.dir === 1 ? ctx.price - rangeZone.hi : rangeZone.lo - ctx.price });

  let em = null, risk = null;
  const execRows = style === 'Scalping' ? cl.m5 : cl.m1;
  for (let guard = 0; guard < 16; guard++) {
    em = entryMode(ctx, p, it, lt, bars, style, execRows, pool, opts);
    if (em.reject) break;
    p.type = em.type; p.entry = em.entry; p.note = em.note; p.forced = !!em.forced;
    if (em.zone) p.zone = { lo: em.zone.lo, hi: em.zone.hi, kind: (em.zone.tf ? em.zone.tf + ' ' : '') + em.zone.kind + (em.zone.isSynthetic ? ' [SYNTH]' : '') };
    risk = applyRisk(p, ctx, bars, style, true);
    if (!risk.reject) break;
    const zk = p.zone.lo + '|' + p.zone.hi;
    if (!opts.deep.has(zk)) { opts.deep.add(zk); continue; }
    const i = pool.findIndex(z => z.lo === p.zone.lo && z.hi === p.zone.hi);
    if (i >= 0) pool.splice(i, 1);
    else break;
  }
  if (!em || em.reject) {
    const synth = synthesizeZone(ctx, ht, it, lt, style, execRows);
    if (synth) {
      p.dir = synth.dir; p.zone = { lo: synth.z.lo, hi: synth.z.hi, kind: synth.z.tf + ' ' + synth.z.kind + ' [SYNTH]' };
      p.entry = ctx.price - synth.dir * Math.max(2 * ctx.pip, Math.min(synth.d * ctx.pip, 10 * ctx.pip));
      p.type = 'LIMIT'; p.forced = true; p.zoneQuality = synth.score;
      p.note = 'LIMIT @ ' + ctx.f(p.entry) + ': zona sintetis dari swing terdekat (WAJIB signal).';
      risk = applyRisk(p, ctx, bars, style, true);
      em = { type: 'LIMIT', entry: p.entry, zone: synth.z, note: p.note, forced: true };
    } else {
      return standby(ctx, style, 'Data candle tidak cukup untuk signal.', steps);
    }
  }

  const nar = buildNarrative(ctx, style, ht, it, lt, pd, state, chosen, p, false);
  const narEn = buildNarrative(ctx, style, ht, it, lt, pd, state, chosen, p, true);
  steps.push({ tf: 'Entry', text: em.note, textEn: em.note });
  const s = sigOf(p, ctx, style);
  s.checklist = steps.map(x => x.tf + ': ' + x.text);
  const f = { symbol: ctx.symbol, style, status: s.status, signal: s.signal, orderType: s.orderType, entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4 ?? null, tp5: s.tp5 ?? null, invalidLevel: s.invalidLevel, entryNote: s.entryNote, steps, structureState: state.id, structureStateEn: state.en, zoneQuality: p.zoneQuality || 0, premiumDiscount: pd ? (((ctx.price - pd.lo) / pd.range >= 0.5 ? 'premium' : 'discount') + ' (posisi ' + Math.round(((ctx.price - pd.lo) / pd.range) * 100) + '%)') : 'n/a', nearZones: nearZones.slice(0, 3).map(z => ({ kind: z.kind, tf: z.tf, lo: ctx.f(z.lo), hi: ctx.f(z.hi), side: z.side })), zonesHtf: zoneLine(nearZones.filter(z => z.tf === htfLabel), ctx, false, prox), zonesM5: zoneLine(nearZones.filter(z => z.tf === 'M5'), ctx, false, prox), narrativeDraft: { id: nar.lines.concat([nar.setup]), en: narEn.lines.concat([narEn.setup]) }, dec: ctx.dec, price: ctx.f(ctx.price) };
  return { signal: s, facts: f };
}

function runBot(ctx, d) { const m1 = closed(d.m1, TFMS.m1), m5 = closed(d.m5, TFMS.m5), m15 = closed(d.m15, TFMS.m15); let r = null; try { r = runBotFlex({ m1, m5, m15 }, { price: ctx.price, dec: ctx.dec, pip: ctx.pip, symbol: ctx.symbol }); } catch {} if (!r || !r.ok) { try { const ict = planBot({ m15, m5, price: ctx.price, sym: ctx.symbol, tNow: Date.now() }); if (ict && ict.status === 'limit') r = { ok: true, dir: ict.dir === 'BUY' ? 1 : -1, dirTxt: ict.dir, entry: ict.entry, sl: ict.sl, tps: [ict.tp1, ict.tp2, ict.tp3], rr: 2, orderType: 'LIMIT', tier: 'ICT_POI', trigger: 'POI ' + ict.poi.kind + ' M15', bias: 'M15 ' + ict.dir, checklist: ['POI ' + ict.poi.kind + ' M15', 'Entry 40% zona', 'SL buffer ATR'] }; } catch {} } if (!r || !r.ok) return standby(ctx, 'Scalping', (r && r.reason) || 'Menunggu setup bot.', []); const botRisk = Math.abs(Number(r.entry) - Number(r.sl)) || bounds(Number(r.entry), ctx, 'Scalping').min; const tps = Array.isArray(r.tps) && r.tps.length >= 3 && r.tps[0] !== r.entry ? r.tps : buildTPs(Number(r.entry), r.dir, botRisk); const p = { dir: r.dir, entry: num(r.entry, ctx.price), sl: num(r.sl, ctx.price), type: r.orderType || 'MARKET', tps, tp4: tps[3], tp5: tps[4], rr: num(r.rr, 1.5), zone: null, steps: [], zoneQuality: 60 }; const s = sigOf(p, ctx, 'Scalping'); s.style = 'scalperbot'; s.tier = r.tier || 'EA'; s.expiresAt = Date.now() + 9e5; s.checklist = r.checklist || []; const f = { symbol: ctx.symbol, style: 'scalperbot', status: s.status, signal: s.signal, orderType: s.orderType, entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4, tp5: s.tp5, trigger: r.trigger || null, bias: r.bias || 'netral', htf: r.trendTxt || '-', m1: r.structTxt || '-', checklist: r.checklist || [], dec: ctx.dec, price: ctx.f(ctx.price) }; return { signal: s, facts: f }; }

function lifecycle(prev, sym, style, price, pip, data) { if (!prev || typeof prev !== 'object' || prev.symbol !== sym || prev.style !== style) return null; if (prev.signal !== 'BUY' && prev.signal !== 'SELL') return null; if (prev.status === 'TP5_HIT' || prev.finished) return null; const exp = Number(prev.expiresAt); if (!Number.isFinite(exp) || Date.now() > exp) return { dead: true, out: 'EXPIRED', prev }; const dir = prev.signal === 'BUY' ? 1 : -1; const sl = Number(prev.sl), e = Number(prev.entry); const rawT = [prev.tp1, prev.tp2, prev.tp3, prev.tp4, prev.tp5].map(Number); const fallback = (i) => { const v = rawT[i]; if (Number.isFinite(v) && v !== e) return v; const mult = TP_MULTIPLIERS[i] || (i + 1); return e + dir * Math.abs(e - sl) * mult; }; const t = [0,1,2,3,4].map(fallback); if (![sl, e, t[0]].every(Number.isFinite)) return null; const tfKey = style === 'scalperbot' ? 'm1' : style === 'Swing' ? 'm15' : 'm5'; const ms = TFMS[tfKey] || 3e5; const rows = clean((data && data[tfKey]) || []); const start = Number(prev.lastTickAt) || Number(prev.createdAt) || Date.now(); let win = rows.filter(c => tsMs(c.t) + ms > start && tsMs(c.t) <= Date.now()); if (!win.length) win = [{ t: Date.now(), h: price, l: price, c: price }]; let filled = prev.status !== 'PENDING' || Number(prev.filledAt) > 0; let filledAt = Number(prev.filledAt) || 0; const hits = new Set(Array.isArray(prev.tpHits) ? prev.tpHits : []); let be = !!prev.be || hits.has(1); let dead = null; for (const c of win) { if (!filled) { if (dir === 1 ? c.l <= e : c.h >= e) { filled = true; filledAt = tsMs(c.t); } else continue; } const slEff = be ? e : sl; const slTouch = dir === 1 ? c.l <= slEff : c.h >= slEff; if (slTouch) { dead = { out: be ? 'BE' : 'SL' }; break; } for (let i = 0; i < 5; i++) { const v = t[i]; if (Number.isFinite(v) && !hits.has(i + 1) && (dir === 1 ? c.h >= v : c.l <= v)) hits.add(i + 1); } if (hits.has(1)) be = true; if (hits.has(5)) { dead = { out: 'TP5' }; break; } } const maxHit = hits.size ? Math.max(...hits) : 0; const patch = { tpHits: [...hits].sort((a, b) => a - b), tpHitCount: hits.size, maxTpHit: maxHit, be, slBe: be ? e : null, filledAt: filledAt || null, lastTickAt: Date.now() }; if (dead && dead.out === 'TP5') return { dead: true, out: 'TP5', prev, patch: { ...patch, status: 'TP5_HIT', state: 'TP5', finished: true } }; if (dead) return { dead: true, out: dead.out, prev, patch }; let status, state; if (!filled) { status = 'PENDING'; state = 'LIMIT_PLACED'; } else if (maxHit >= 1) { status = 'TP' + maxHit + '_HIT'; state = 'TP' + maxHit; } else { status = 'RUNNING'; state = filledAt ? 'FILLED' : 'CONFIRMED'; } return { dead: false, prev, patch: { ...patch, status, state } }; }

const SYS_VIS = 'Kamu analis S&D/OB dari gambar chart. Baca level PERSIS dari skala harga. Wajib BUY atau SELL kecuali gambar bukan chart. Prioritaskan LIMIT pullback; MARKET hanya bila harga sudah di zona dan ada penolakan. Sebutkan zona yang terlihat di TF tinggi dan TF rendah pada perImageAnalyses. Isi perImageAnalyses (Indonesia), perImageAnalysesEn (Inggris), reason (Indonesia), reasonEn (Inggris) dengan angka sama. SL di luar distal zona/swing. Balas HANYA JSON: {"signal":"BUY","orderType":"LIMIT","entry":0,"sl":0,"tp1":0,"tp2":0,"tp3":0,"tp4":0,"tp5":0,"zoneLow":0,"zoneHigh":0,"zone":"Demand","pair":"","decimals":2,"perImageAnalyses":[],"perImageAnalysesEn":[],"reason":"","reasonEn":""}';

async function handleVision(body, lang, res) { const imgs = (Array.isArray(body.images) ? body.images : []).filter(s => typeof s === 'string' && s.startsWith('data:image/')).slice(0, 3); if (!imgs.length) return res.status(200).json({ ok: false, reason: 'Gambar tidak valid.' }); if (!VIS_KEY) return res.status(200).json({ ok: false, reason: 'OPENAI_API_KEY belum diatur.' }); const style = normStyle(body.style); const content = [{ type: 'text', text: 'Jumlah gambar: ' + imgs.length + '. Style: ' + style + '.' }, ...imgs.flatMap((u, i) => [{ type: 'text', text: 'Gambar ' + (i + 1) + ':' }, { type: 'image_url', image_url: { url: u } }])]; let r = null; try { r = await httpJson(AI_BASE + '/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + VIS_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: VIS_MODEL, max_completion_tokens: 1800, messages: [{ role: 'system', content: SYS_VIS }, { role: 'user', content }] }) }, 50000); } catch (e) { return res.status(200).json({ ok: false, reason: 'AI timeout: ' + e.message }); } if (!r || !r.ok) return res.status(200).json({ ok: false, reason: 'AI gagal (HTTP ' + (r ? r.status : 0) + ').' }); let txt = String(r.data?.choices?.[0]?.message?.content || '').replace(/```(?:json)?/gi, '').replace(/```/g, ''); const a = txt.indexOf('{'), b = txt.lastIndexOf('}'); let j = null; if (a >= 0 && b > a) { try { j = JSON.parse(txt.slice(a, b + 1)); } catch {} } const sg = String(j?.signal || '').toUpperCase(); const e0 = Number(j?.entry), s0 = Number(j?.sl); if (!j || (sg !== 'BUY' && sg !== 'SELL') || !(e0 > 0) || !(s0 > 0)) return res.status(200).json({ ok: false, reason: 'AI tidak memberi setup valid.' }); const sym = String(j.pair || 'CHART').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'CHART'; const dec = Number.isInteger(j.decimals) ? j.decimals : (DEC[sym] ?? 2); const pip = pipOf(sym, dec); const f = v => Number(Number(v).toFixed(dec)); const dir = sg === 'BUY' ? 1 : -1; const entry = f(e0); const risk = Math.abs(e0 - s0) || pip * 10; const sl = f(entry - dir * risk); const at = [j.tp1, j.tp2, j.tp3].map(Number); const okT = at.every(v => Number.isFinite(v) && (dir === 1 ? v > entry : v < entry)); const visionTPs = okT ? at.map(f) : buildTPs(entry, dir, risk); const [t1, t2, t3, t4, t5] = visionTPs; const zl = f(Number(j.zoneLow) || Math.min(entry, entry - dir * risk * 0.5)); const zh = f(Number(j.zoneHigh) || Math.max(entry, entry - dir * risk * 0.5)); const pi = Array.isArray(j.perImageAnalyses) ? j.perImageAnalyses.map(String) : []; const pe = Array.isArray(j.perImageAnalysesEn) ? j.perImageAnalysesEn.map(String) : pi; const rid = '[' + sym + ' · Analisa ' + imgs.length + ' Gambar]\n' + pi.map(t => '• ' + t).join('\n') + '\n\n[Setup]\n' + (j.reason || ''); const ren = '[' + sym + ' · ' + imgs.length + '-Image Analysis]\n' + pe.map(t => '• ' + t).join('\n') + '\n\n[Setup]\n' + (j.reasonEn || j.reason || ''); const isLimit = String(j.orderType || '').toUpperCase() === 'LIMIT'; const out = { signal: sg, orderType: isLimit ? 'LIMIT' : 'MARKET', fill: isLimit ? 'LIMIT' : 'NOW', status: isLimit ? 'PENDING' : 'RUNNING', entryMode: isLimit ? 'PULLBACK' : 'NOW', symbol: sym, pair: sym, dec, pip, style, entry, sl, tp1: t1, tp2: t2, tp3: t3, tp4: t4, tp5: t5, riskPips: Math.round((risk / pip) * pipScaleOf(sym)), pipDisplayScale: pipScaleOf(sym), tpHits: [], tpHitCount: 0, maxTpHit: 0, be: false, slBe: null, zone: { min: zl, max: zh, label: (j.zone || 'Zona') + ' ' + zl + '–' + zh }, reason: lang === 'en' ? ren : rid, reasons: { id: rid, en: ren }, reasonSource: 'AI', aiReasoning: true, createdAt: Date.now(), lastTickAt: Date.now(), filledAt: isLimit ? null : Date.now(), expiresAt: Date.now() + (EXPMS[style] || 18e5), source: 'VISION_AI' }; await saveSignal(out); return res.status(200).json({ ok: true, mode: 'vision', symbol: sym, pair: sym, dec, pip, price: entry, style, signal: out }); }

function normStyle(raw) { const k = String(raw || '').toLowerCase(); if (k.includes('swing')) return 'Swing'; if (k.includes('intraday')) return 'Intraday'; return 'Scalping'; }

async function handleCandles(body, lang, res, isBot, email) { const symbol = String(body.symbol || 'XAUUSD').toUpperCase(); const style = isBot ? 'scalperbot' : normStyle(body.style || body.mode); const price = Number(body.price ?? body.livePrice ?? 0); if (!(price > 0)) return res.status(200).json({ ok: false, reason: 'Harga live belum tersedia.' }); const dec = DEC[symbol] ?? 2; const pipScale = pipScaleOf(symbol); const ctx = { symbol, dec, price, pip: pipOf(symbol, dec), pipScale, dp: v => Math.round(num(v) * pipScale), f: v => Number(num(v, price).toFixed(dec)) }; const tfs = ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1']; const data = {}; for (const tf of tfs) { const inc = clean((body.candles || {})[tf] ?? body[tf]); if (inc.length) { data[tf] = inc; cache.set(symbol + tf, { t: Date.now(), rows: inc }); } else data[tf] = []; } const need = isBot ? ['m1', 'm5', 'm15'] : (NEED[style] || NEED.Scalping); await Promise.all(need.map(async tf => { if (data[tf].length >= (MINB[tf] || 25)) return; const rows = await tlRows(symbol, TFIV[tf], 200); if (rows.length) { data[tf] = rows; cache.set(symbol + tf, { t: Date.now(), rows }); return; } const c = cache.get(symbol + tf); if (c && Date.now() - c.t < 12e4) data[tf] = c.rows; })); if (!data.m5.length && !data.m15.length && !data.m1.length) return res.status(200).json({ ok: false, reason: 'Data candle belum cukup.' }); let out; try { out = isBot ? runBot(ctx, data) : await runManual(ctx, data, style); } catch (e) { console.error('[v197] engine error:', e.message, e.stack); out = standby(ctx, style, 'Engine error: ' + e.message, []); } if (!out || !out.signal) out = standby(ctx, style, 'Menunggu setup valid.', []); const key = symbol + '|' + style; const clientPrev = (body.prevSignal && typeof body.prevSignal === 'object') ? body.prevSignal : null; const storePrev = await loadSignal(symbol, style); const prev = pickPrev(clientPrev, storePrev); const restored = !clientPrev && !!storePrev; const life = lifecycle(prev, symbol, style, price, ctx.pip, data); if (life && life.dead) { await saveOutcome(key, { dir: life.prev.signal, out: life.out, t: Date.now() }); await dropSignal(symbol, style); } if (life && life.dead && life.out === 'TP5') { const fin = { ...life.prev, ...life.patch, sticky: true, finished: true }; if (fin.reasons) fin.reason = lang === 'en' ? (fin.reasons.en || fin.reasons.id) : (fin.reasons.id || fin.reasons.en); return res.status(200).json({ ok: true, mode: isBot ? 'bot' : 'candles', symbol, style, price, signal: fin, diag: { version: VERSION, lifecycle: 'TP5', finished: true, store: kvOn ? 'KV' : 'MEM' } }); } if (life && !life.dead) { const managed = { ...life.prev, ...life.patch, sticky: true }; const opp = out.signal.status !== 'STANDBY' && out.signal.signal !== managed.signal; if (!(body.forceNew && opp)) { await saveSignal(managed); if (managed.reasons) managed.reason = lang === 'en' ? (managed.reasons.en || managed.reasons.id) : (managed.reasons.id || managed.reasons.en); return res.status(200).json({ ok: true, mode: isBot ? 'bot' : 'candles', symbol, style, price, signal: managed, diag: { version: VERSION, lifecycle: managed.state, tpHits: managed.tpHits, filled: !!managed.filledAt, sticky: true, restored, store: kvOn ? 'KV' : 'MEM' } }); } } if (isBot && out.signal.status !== 'STANDBY') { try { await markTrialBotUsed(email); } catch {} } const f = out.facts || { symbol, style, status: 'STANDBY', why: '', steps: [], dec, price: ctx.f(price) }; const ck = key + '|' + f.status + '|' + (f.signal || '') + '|' + (f.entry || '') + '|' + String(f.why || '').slice(0, 40); let story = stories.get(ck); if (!story || Date.now() - story.t > 12e4) { const r = isBot ? await reasonBot(f) : await reasonManual(f); story = { t: Date.now(), v: r }; stories.set(ck, story); if (stories.size > 200) stories.delete(stories.keys().next().value); } const signal = { ...out.signal, reason: lang === 'en' ? story.v.en : story.v.id, reasons: { id: story.v.id, en: story.v.en }, reasonSource: story.v.ai ? 'AI' : 'RULES', aiReasoning: !!story.v.ai }; if (signal.status !== 'STANDBY') await saveSignal(signal); return res.status(200).json({ ok: true, mode: isBot ? 'bot' : 'candles', symbol, style, price, signal, diag: { version: VERSION, status: signal.status, entryMode: signal.entryMode || null, forced: !!signal.forced, pipDisplayScale: pipScale, zonesHtf: f.zonesHtf || null, zonesM5: f.zonesM5 || null, structureState: f.structureState || null, premiumDiscount: f.premiumDiscount || null, zoneQuality: f.zoneQuality || 0, restored, store: kvOn ? 'KV' : 'MEM' } }); }

export default async function handler(req, res) { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-email'); if (req.method === 'OPTIONS') return res.status(204).end(); if (req.method === 'GET') return res.status(200).json({ ok: true, version: VERSION, store: kvOn ? 'KV' : 'MEM', note: 'generate alive' }); if (req.method !== 'POST') return res.status(200).json({ ok: false, reason: 'Method not allowed' }); let body = {}; try { body = req.body || {}; if (typeof body === 'string') body = JSON.parse(body); if (body.probe) return res.status(200).json({ ok: true, version: VERSION, store: kvOn ? 'KV' : 'MEM' }); const lang = body.lang === 'en' ? 'en' : 'id'; const email = String(body.email || body.value || '').trim().toLowerCase(); const isBot = !!(body.auto || body.bot || body.mode === 'bot' || body.source === 'bot'); const isVis = body.symbol === 'VISION' || body.mode === 'vision' || (Array.isArray(body.images) && body.images.length); const acc = await checkAccess(email, isBot); if (!acc.ok) return res.status(200).json({ ok: false, reason: 'Akses: ' + acc.key }); if (isVis) return await handleVision(body, lang, res); return await handleCandles(body, lang, res, isBot, email); } catch (err) { console.error('[generate] fatal error:', err?.message, err?.stack); if (!res.headersSent) { return res.status(200).json({ ok: false, reason: 'Server error: ' + (err?.message || 'unknown'), version: VERSION }); } } }
