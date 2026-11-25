// api/generate.js — v205
// Integrasi Framework AI Signal Tunggal XAUUSD & BTCUSD
// - SL Scalping pakai M5, Intraday M15, Swing H4
// - TP: Scalping 5R, Intraday 3R, Swing 3 pip (TP4/5 null)
// - Tidak ada flip arah (kompresi TP jika runway sempit)
// - Null-safe (null tidak berubah jadi 0)
// - System Prompt sesuai Framework yang diberikan

import { checkAccess, markTrialBotUsed } from '../lib/access.js';
import { planBot } from '../lib/bot-ict.js';
import { runBotSma as runBotFlex } from '../lib/bot_3candle.js';
import { sessionOf, asianRange, asianSweep, sessionScore, volatilityRegime } from '../lib/session.js';
import { findPools, sweepVsBreak, doubleSweep, nearestDraw, slBeyondPool } from '../lib/liquidity.js';
import { resolveBias, counterGuard, adjustConviction, counterExpiry } from '../lib/framework-manual.js';
import { atrSanity, calcSL } from '../lib/risk-atr.js';
import { TP_PLAN, planTPs, repairTPs, coupleZone, fixSide, buildChart } from '../lib/tp-final.js';

export const config = { maxDuration: 60 };
const VERSION = 'v205';
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

const TF_ROLE = {
  Scalping: { htf: 'h1', mtf: 'm15', ltf: 'm5', exec: 'm1' },
  Intraday: { htf: 'h4', mtf: 'm15', ltf: 'm5', exec: null },
  Swing: { htf: 'd1', mtf: 'h4', ltf: 'h1', exec: null },
};
const SL_REF = {
  Scalping: { atrTf: 'm5', swingTf: 'm5', win: 8 },
  Intraday: { atrTf: 'm15', swingTf: 'm15', win: 8 },
  Swing: { atrTf: 'h4', swingTf: 'h4', win: 8 },
};
const NEED = { Scalping: ['m1', 'm5', 'm15', 'h1'], Intraday: ['m5', 'm15', 'h1', 'h4'], Swing: ['m15', 'h1', 'h4', 'd1'] };
const MINB = { m1: 60, m5: 40, m15: 40, m30: 35, h1: 35, h4: 25, d1: 20 };
const EXPMS = { Scalping: 60 * 6e4, Intraday: 480 * 6e4, Swing: 5760 * 6e4 };
const PROX = { Scalping: 50, Intraday: 80, Swing: 200 };
const MIN_ZONE_WIDTH = { Scalping: 20, Intraday: 20, Swing: 30 };
const RULES = {
  Scalping: { gMin: 50, gMax: 100, bMin: 0.005, bMax: 0.012 },
  Intraday: { gMin: 50, gMax: 120, bMin: 0.005, bMax: 0.014 },
  Swing: { gMin: 100, gMax: 300, bMin: 0.01, bMax: 0.025 },
};
const TP_MULT = [1, 1.5, 2, 3, 5];
const COOLDOWN = 3e5;

const cache = new Map();
const outcomes = new Map();
const stories = new Map();
const isNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const num = (v, f = 0) => (isNum(v) ? Number(v) : f);
const tsMs = t => (t < 1e12 ? t * 1000 : t);
const closed = (c, ms) => (Array.isArray(c) && c.length && Date.now() < tsMs(c[c.length - 1].t) + ms ? c.slice(0, -1) : (c || []));
const iso = d => d.toISOString().slice(0, 10);
const dw = d => (d === 1 ? 'bullish' : d === -1 ? 'bearish' : 'netral');
const dwEn = d => (d === 1 ? 'bullish' : d === -1 ? 'bearish' : 'neutral');
const buildTPs = (e, dir, r) => (!(r > 0) || !Number.isFinite(e)) ? [e, e, e, e, e] : TP_MULT.map(m => e + dir * r * m);

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
const sigKey = (s, st) => 'sig:' + s + '|' + st;
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
const pickPrev = (a, b) => {
  const ok = x => x && typeof x === 'object' && (x.signal === 'BUY' || x.signal === 'SELL');
  if (!ok(a)) return ok(b) ? b : null;
  if (!ok(b)) return a;
  const sc = x => Math.max(Number(x.lastTickAt) || 0, Number(x.createdAt) || 0);
  return sc(b) > sc(a) ? b : a;
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
  const o = { dir: 0, ev: '', fresh: false, displaced: false };
  if (!Array.isArray(rows) || rows.length < 25) return o;
  const a = rows.slice(-lb);
  const n = a.length;
  const at = atr(a) || 1;
  const hs = [], ls = [];
  for (let i = 2; i < n - 2; i++) {
    let ih = true, il = true;
    for (let j = i - 2; j <= i + 2; j++) { if (j === i) continue; if (a[j].h >= a[i].h) ih = false; if (a[j].l <= a[i].l) il = false; }
    if (ih) hs.push([i, a[i].h]);
    if (il) ls.push([i, a[i].l]);
  }
  let tr = 0, ev = '', bi = -1, disp = false, pi = 0, pj = 0;
  for (let i = 4; i < n; i++) {
    while (pi < hs.length && hs[pi][0] < i - 2) pi++;
    while (pj < ls.length && ls[pj][0] < i - 2) pj++;
    const ph = pi > 0 ? hs[pi - 1][1] : null;
    const pl = pj > 0 ? ls[pj - 1][1] : null;
    const c = a[i].c;
    const body = Math.abs(a[i].c - a[i].o);
    if (ph != null && c > ph) { ev = tr === -1 ? 'CHOCH_UP' : 'BOS_UP'; tr = 1; bi = i; disp = body >= 1.2 * at; }
    else if (pl != null && c < pl) { ev = tr === 1 ? 'CHOCH_DOWN' : 'BOS_DOWN'; tr = -1; bi = i; disp = body >= 1.2 * at; }
  }
  o.ev = ev; o.dir = tr;
  o.fresh = tr !== 0 && bi >= n - 12;
  o.displaced = disp;
  return o;
}
function ranging(rows, lb = 30, tf = 'M15') {
  if (!Array.isArray(rows) || rows.length < lb) return null;
  const a = rows.slice(-lb);
  const hi = Math.max(...a.map(c => c.h)), lo = Math.min(...a.map(c => c.l));
  const h = hi - lo;
  if (!(h > 0)) return null;
  if (internal(a, lb).fresh) return null;
  const nH = a.filter(c => c.h >= hi - 0.15 * h).length;
  const nL = a.filter(c => c.l <= lo + 0.15 * h).length;
  if (nH >= 2 && nL >= 2) return { hi, lo, h, pos: (a[a.length - 1].c - lo) / h, tf };
  return null;
}
function getPDZone(rows, lb = 60) {
  if (!Array.isArray(rows) || rows.length < 10) return null;
  const a = rows.slice(-lb);
  const hi = Math.max(...a.map(c => c.h)), lo = Math.min(...a.map(c => c.l));
  const range = hi - lo;
  if (range <= 0) return null;
  return { hi, lo, eq: lo + range * 0.5, ote: lo + range * 0.618, range };
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
function zonesFromRows(rows, tfLabel, ctx, style, lb = 90) {
  if (!Array.isArray(rows) || rows.length < 12) return [];
  const a = rows.slice(-lb);
  const at = atr(a) || ctx.pip * 10;
  const minW = (MIN_ZONE_WIDTH[style] || 20) * ctx.pip;
  const raw = gaps(a, 60).map(g => ({ ...g, tf: tfLabel }));
  for (let i = 1; i < a.length - 1; i++) {
    const nx = a[i + 1];
    if (Math.abs(nx.c - nx.o) < 1.2 * at) continue;
    const up = nx.c > nx.o, pv = a[i];
    if (up && pv.c < pv.o) raw.push({ tf: tfLabel, kind: 'Demand OB', lo: pv.l, hi: pv.h, side: 'demand' });
    if (!up && pv.c > pv.o) raw.push({ tf: tfLabel, kind: 'Supply OB', lo: pv.l, hi: pv.h, side: 'supply' });
  }
  const dist = z => (z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi);
  const kept = [];
  for (const z of raw.sort((x, y) => dist(x) - dist(y))) {
    if (!(z.hi > z.lo)) continue;
    if (z.hi - z.lo < minW) continue;
    if ((z.hi - z.lo) / ctx.price > 0.03) continue;
    if (kept.some(k => k.side === z.side && !(z.hi < k.lo || z.lo > k.hi))) continue;
    kept.push(z);
    if (kept.length >= 6) break;
  }
  return kept;
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
function zoneLine(list, ctx, en, maxPip) {
  if (!list || !list.length) return en ? 'no zone readable.' : 'belum ada zona terbaca.';
  const near = list.filter(z => {
    const inside = ctx.price >= z.lo && ctx.price <= z.hi;
    const d = (z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi) / ctx.pip;
    return inside || d <= (maxPip || 50);
  }).slice(0, 3);
  if (!near.length) return en ? 'no zone in proximity.' : 'tidak ada zona dalam proksimitas.';
  return near.map(z => {
    const inside = ctx.price >= z.lo && ctx.price <= z.hi;
    const d = ctx.dp((z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi) / ctx.pip);
    const pos = inside ? (en ? 'inside' : 'di dalam') : (z.lo >= ctx.price ? (en ? 'above' : 'di atas') : (en ? 'below' : 'di bawah'));
    return z.kind + ' ' + ctx.f(z.lo) + '-' + ctx.f(z.hi) + ' (' + (inside ? pos : d + ' pip ' + pos) + ')';
  }).join('; ');
}
function bounds(entry, ctx, style) {
  const r = RULES[style] || RULES.Scalping;
  return isGold(ctx.symbol) ? { min: r.gMin * ctx.pip, max: r.gMax * ctx.pip } : { min: entry * r.bMin, max: entry * r.bMax };
}
function swingLevel(rows, dir, win = 8) {
  if (!Array.isArray(rows) || rows.length < 5) return NaN;
  const n = rows.slice(-Math.min(win, rows.length));
  return dir === 1 ? Math.min(...n.map(c => c.l)) : Math.max(...n.map(c => c.h));
}
function scoreZone(z, ht, it, lt, ctx, style) {
  let score = 0;
  const width = (z.hi - z.lo) / ctx.pip;
  const minW = MIN_ZONE_WIDTH[style] || 20;
  if (width >= minW && width <= minW * 4) score += 25; else if (width >= minW) score += 15; else score += 5;
  const H = TF_ROLE[style].htf.toUpperCase(), M = TF_ROLE[style].mtf.toUpperCase();
  if (z.tf === H) score += 20; else if (z.tf === M) score += 15; else score += 10;
  const dir = z.side === 'demand' ? 1 : -1;
  if (ht.dir === dir) score += 15;
  if (it.dir === dir) score += 10;
  if (lt.dir === dir) score += 5;
  if (it.fresh && it.displaced && it.dir === dir) score += 8;
  if (lt.fresh && lt.dir === dir) score += 5;
  const inside = ctx.price >= z.lo && ctx.price <= z.hi;
  const d = inside ? 0 : (dir === 1 ? ctx.price - z.hi : z.lo - ctx.price) / ctx.pip;
  if (inside) score += 15; else if (d <= 10) score += 12; else if (d <= 20) score += 8; else if (d <= 50) score += 4;
  return { score, width, d, inside };
}
function chooseBestZone(ctx, ht, it, lt, zones, style) {
  const prox = PROX[style] || 50;
  const cand = zones.filter(z => {
    const inside = ctx.price >= z.lo && ctx.price <= z.hi;
    const d = (z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi) / ctx.pip;
    return inside || d <= prox * 2;
  });
  if (!cand.length) return null;
  return cand.map(z => ({ z, ...scoreZone(z, ht, it, lt, ctx, style) })).sort((a, b) => b.score - a.score)[0];
}
function synthesizeZone(ctx, dir, style, rows) {
  const a = atr(rows) || ctx.pip * 10;
  const n = Array.isArray(rows) && rows.length >= 6 ? rows.slice(-15) : [];
  if (n.length < 4) return null;
  const sw = dir === 1 ? Math.min(...n.map(c => c.l)) : Math.max(...n.map(c => c.h));
  const w = Math.max(0.3 * a, ctx.pip * 15);
  const z = dir === 1
    ? { lo: sw, hi: sw + w, side: 'demand', kind: 'Swing Low', tf: TF_ROLE[style].ltf.toUpperCase(), isSynthetic: true }
    : { lo: sw - w, hi: sw, side: 'supply', kind: 'Swing High', tf: TF_ROLE[style].ltf.toUpperCase(), isSynthetic: true };
  return { z, score: 30, width: w / ctx.pip, d: Math.abs(ctx.price - (dir === 1 ? z.hi : z.lo)) / ctx.pip, inside: false, dir };
}
function entryMode(ctx, p, it, lt, ex, style, pool, ltfRows) {
  const prox = PROX[style] || 50;
  const align = it.dir === p.dir && lt.dir === p.dir;
  const execOk = !ex || ex.dir === p.dir || ex.dir === 0;
  for (const z of pool) {
    const zl = z.lo, zh = z.hi, w = zh - zl;
    const inside = ctx.price >= zl && ctx.price <= zh;
    const beyond = p.dir === 1 ? ctx.price < zl : ctx.price > zh;
    if (beyond) continue;
    const lim = inside ? ctx.price : (p.dir === 1 ? zh + Math.min(2 * ctx.pip, 0.1 * w) : zl - Math.min(2 * ctx.pip, 0.1 * w));
    const sideOk = p.dir === 1 ? lim <= ctx.price : lim >= ctx.price;
    const distPip = Math.abs(ctx.price - lim) / ctx.pip;
    if (inside && align && (it.fresh || lt.fresh) && execOk) {
      return { type: 'MARKET', entry: ctx.price, zone: z, note: 'NOW: harga di dalam zona ' + z.tf + ' ' + z.kind + ', struktur searah' + (ex ? ' + ' + TF_ROLE[style].exec.toUpperCase() + ' konfirmasi' : '') + '.' };
    }
    if (sideOk && distPip <= prox) {
      const t = distPip < 2 ? 'MARKET' : 'LIMIT';
      return { type: t, entry: t === 'MARKET' ? ctx.price : lim, zone: z, note: t + ' di tepi zona ' + z.tf + ' ' + z.kind + ' @ ' + ctx.f(t === 'MARKET' ? ctx.price : lim) + ' (' + ctx.dp(distPip) + ' pip dari harga).' };
    }
  }
  const synth = synthesizeZone(ctx, p.dir, style, ltfRows);
  if (synth) {
    const off = Math.max(2 * ctx.pip, Math.min(synth.d * ctx.pip, 10 * ctx.pip));
    const entry = ctx.price - p.dir * off;
    return { type: 'LIMIT', entry, zone: synth.z, forced: true, note: 'LIMIT @ ' + ctx.f(entry) + ' (' + ctx.dp(off / ctx.pip) + ' pip): zona sintetis swing terdekat.' };
  }
  const off = 6 * ctx.pip, entry = ctx.price - p.dir * off, w2 = 10 * ctx.pip;
  const z = { lo: p.dir === 1 ? entry - w2 : entry, hi: p.dir === 1 ? entry : entry + w2, side: p.dir === 1 ? 'demand' : 'supply', kind: 'Fallback', tf: TF_ROLE[style].ltf.toUpperCase(), isSynthetic: true };
  return { type: 'LIMIT', entry, zone: z, forced: true, note: 'LIMIT fallback @ ' + ctx.f(entry) + '.' };
}
function classifySetup(ht, it, lt, chosen, verdict, sweepSess) {
  if (sweepSess) return { type: 'Fakeout/Trap', id: sweepSess.id, en: sweepSess.en };
  if (verdict === 'SWEEP') return { type: 'Fakeout/Trap', id: 'Liquidity sweep lalu reclaim.', en: 'Sweep then reclaim.' };
  if (verdict === 'BREAK') return { type: 'Kontinuitas', id: 'Break displacement + hold.', en: 'Displacement break held.' };
  if (!chosen || !chosen.z) return { type: 'Unknown', id: 'Setup tidak terklasifikasi.', en: 'Unclassified.' };
  const dir = chosen.z.side === 'demand' ? 1 : -1;
  if (chosen.z.tf === 'H1' || chosen.z.tf === 'H4' || chosen.z.tf === 'D1') return { type: 'Supply & Demand', id: 'Zona ' + chosen.z.kind + ' TF tinggi.', en: 'HTF zone.' };
  if (ht.dir === dir && it.dir === dir) return { type: 'Kontinuitas', id: 'Pullback searah tren.', en: 'Trend pullback.' };
  if (it.fresh && it.displaced && it.dir === dir) return { type: 'Retest BOS', id: 'Retest setelah BOS valid.', en: 'Retest after BOS.' };
  if (ht.dir !== 0 && dir !== ht.dir) return { type: 'Reversal', id: 'Reversal di area ekstrem.', en: 'Reversal at extreme.' };
  return { type: 'Supply & Demand', id: 'Zona ' + chosen.z.kind + '.', en: 'Zone setup.' };
}
function estimateProbability(c) {
  if (c >= 75) return { min: 62, max: 75, label: Math.round(62 + (c - 75) / 25 * 13) + '%' };
  if (c >= 55) return { min: 52, max: 61, label: Math.round(52 + (c - 55) / 20 * 9) + '%' };
  return { min: 45, max: 51, label: Math.round(45 + c / 55 * 6) + '%' };
}
const riskMult = c => (c >= 75 ? 1.0 : c >= 55 ? 0.65 : 0.25);
function baseExpiry(style) {
  const m = {
    Scalping: { candles: 12, tf: 'M5', minutes: 60 },
    Intraday: { candles: 10, tf: 'M15', minutes: 150 },
    Swing: { candles: 12, tf: 'H1', minutes: 720 },
  };
  const e = m[style] || m.Scalping;
  return { ...e, id: 'Auto-cancel ' + e.candles + ' candle ' + e.tf + ' (' + e.minutes + ' menit), atau SL tertembus lebih dulu, atau impulse berlawanan merusak struktur.', en: 'Auto-cancel ' + e.candles + ' ' + e.tf + ' candles or SL hit first.' };
}

function sigOf(p, ctx, style) {
  const f = ctx.f;
  const nf = v => (isNum(v) ? f(v) : null);
  const risk = Math.abs(p.entry - p.sl) || bounds(p.entry, ctx, style).min;
  const tps = Array.isArray(p.tps) && p.tps.length === 5 ? p.tps : buildTPs(p.entry, p.dir, risk);
  const c = p.conviction || 0;
  const prob = estimateProbability(c);
  const lvl = c >= 75 ? 'HIGH' : c >= 55 ? 'MEDIUM' : 'LOW';
  const s = {
    signal: p.dir === 1 ? 'BUY' : 'SELL',
    orderType: p.type, fill: p.type === 'MARKET' ? 'NOW' : 'LIMIT',
    status: p.type === 'MARKET' ? 'RUNNING' : 'PENDING',
    state: p.type === 'MARKET' ? 'CONFIRMED' : 'LIMIT_PLACED',
    entry: f(p.entry), sl: f(p.sl),
    tp1: nf(tps[0]), tp2: nf(tps[1]), tp3: nf(tps[2]), tp4: nf(tps[3]), tp5: nf(tps[4]),
    tpCount: p.tpCount || 5, tpMode: p.tpMode || 'RISK_R',
    invalidLevel: isNum(p.invalidLevel) ? f(p.invalidLevel) : null,
    zone: p.zone ? { min: f(p.zone.lo), max: f(p.zone.hi), label: p.zone.kind } : null,
    zoneLabel: p.zone ? p.zone.kind : '',
    rr: 1, riskPips: p.riskPips ?? ctx.dp(risk / ctx.pip), pipDisplayScale: ctx.pipScale ?? 1,
    setup: p.setupType ? p.setupType.type : 'Unknown',
    setupLabel: p.setupType ? p.setupType.id : '',
    conviction: c, convictionLevel: lvl, confidence: lvl,
    risk: c >= 75 ? 'LOW' : c >= 55 ? 'MEDIUM' : 'HIGH',
    probability: prob.label, probabilityRange: prob, riskMultiplier: riskMult(c),
    session: p.sess ? p.sess.key : null, sessionLiq: p.sess ? p.sess.liq : null,
    biasMode: p.biasMode || 'HTF_LEAD', expiry: p.expiry || null,
    forced: !!p.forced, symbol: ctx.symbol, style, role: 'main',
    createdAt: Date.now(), lastTickAt: Date.now(),
    filledAt: p.type === 'MARKET' ? Date.now() : null,
    expiresAt: p.expiresAt || Date.now() + (EXPMS[style] || 18e5),
    entryMode: p.type === 'MARKET' ? 'NOW' : 'PULLBACK', entryNote: p.note || null,
    tpHits: [], tpHitCount: 0, maxTpHit: 0, be: false, slBe: null,
    checklist: p.steps || [], reason: '', reasons: { id: '', en: '' },
  };
  s.chart = buildChart(s, ctx.pip, ctx.dp, f, style);
  return s;
}
function standby(ctx, style, why, steps) {
  return {
    signal: { signal: 'NONE', status: 'STANDBY', state: 'STANDBY', orderType: 'NONE', symbol: ctx.symbol, style, entry: null, sl: null, tp1: null, tp2: null, tp3: null, tp4: null, tp5: null, tpCount: 0, checklist: (steps || []).map(s => s.tf + ': ' + s.text), reason: '', reasons: { id: '', en: '' } },
    facts: { symbol: ctx.symbol, style, status: 'STANDBY', why, steps: steps || [], dec: ctx.dec, price: ctx.f(ctx.price) },
  };
}
const layout = (f, en, lines, setup) => '[' + f.symbol + ' · ' + (en ? 'Multi-TF Analysis' : 'Analisa Multi-TF') + ' · ' + f.style + ']\n' + (lines || []).map(t => '• ' + t).join('\n') + '\n\n[Setup]\n' + setup;

function manualReason(f, en) {
  const lines = (f.steps || []).map(s => s.tf + ': ' + (en ? (s.textEn || s.text) : s.text));
  if (f.status === 'STANDBY') return layout(f, en, lines, f.symbol + ': ' + (f.why || 'menunggu setup.'));
  const tp = [f.tp1, f.tp2, f.tp3, f.tp4, f.tp5].filter(isNum).map(Number).join(', ');
  const ow = f.orderType === 'MARKET' ? 'NOW' : 'LIMIT';
  return layout(f, en, lines, f.symbol + ': ' + f.signal + ' ' + ow + ' @ ' + f.entry + ', SL ' + f.sl + ' (' + f.riskPips + ' pip), TP ' + tp + ' | ' + (f.setup || '') + ' | Conviction ' + (f.convictionLevel || '') + ' (' + (f.conviction || 0) + '/100) | Prob ' + (f.probability || '-') + ' | Risk ' + (f.riskMultiplier || 0.25) + 'x');
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
          method: 'POST',
          headers: { Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m, max_tokens: 1200, temperature: 0.1, messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(obj) }] }),
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

// [v205] SYSTEM PROMPT SESUAI FRAMEWORK YANG DIBERIKAN
const SYS_MTF = `Anda adalah analis trading XAUUSD dan BTCUSD yang bertugas mengeluarkan SATU sinyal tunggal per analisis untuk dibaca langsung oleh trader.
ATURAN WAJIB:
1. IDENTIFIKASI ASET & KARAKTERNYA:
- Sesuaikan analisis dengan aset yang diminta: XAUUSD atau BTCUSD.
- Untuk XAUUSD: perhatikan sesi London/NY, likuiditas sesi, dan rilis berita makro USD.
- Untuk BTCUSD: perhatikan struktur likuiditas 24/7, volatilitas/ATR tinggi, potensi stop-hunt pada equal highs/lows, serta likuiditas akhir pekan (weekend).
2. FORCED BINARY DIRECTION (WAJIB PILIH SATU):
- Selalu pilih TEPAT SATU arah: BUY atau SELL. Dilarang mengeluarkan HOLD, WAIT, atau NO TRADE.
- Jika pasar choppy, sideways sempit, atau likuiditas tipis, tetap pilih BUY atau SELL dengan probabilitas relatif terbaik, beri label LOW CONVICTION, dan gunakan risiko minimum (0.25x).
3. ORDER TYPE TUNGGAL (WAJIB PILIH SATU):
- Pilih TEPAT SATU tipe order: BUY NOW, SELL NOW, BUY LIMIT, atau SELL LIMIT.
- Gunakan NOW jika harga sudah berada pada titik konfirmasi/reaksi aktif atau momentum LTF sedang berjalan.
- Gunakan LIMIT jika harga belum menyentuh zona Supply/Demand atau area retest yang terukur agar posisi/SL/R:R lebih efisien.
4. TOP-DOWN & KLASIFIKASI SETUP:
- Analisis berurutan dari HTF (bias & zona/likuiditas), MTF (struktur & koreksi/transisi), hingga LTF (trigger eksekusi).
- Klasifikasikan setup ke: Supply & Demand, Reversal, Kontinuitas, Fakeout / Trap Breakout, atau Retest Setelah BOS.
5. ATURAN SKENARIO KHUSUS:
- CHOPPY / SIDEWAYS SEMPIT / WEEKEND TIPIS (BTCUSD): tetap keluarkan 1 sinyal, label LOW CONVICTION, risiko 0.25x, target realistis/dekat.
- RANGING JELAS: utamakan LIMIT di batas bawah (BUY LIMIT) atau batas atas (SELL LIMIT) range dengan SL di luar batas range.
- TREND KUAT + PULLBACK: utamakan LIMIT di zona demand/supply atau retest searah tren dengan conviction lebih tinggi.
- BREAKOUT / IMPULSE TERKONFIRMASI: gunakan NOW searah dorongan selama jarak SL masih terukur.
- FAKEOUT / TRAP BREAKOUT: evaluasi pembalikan setelah masuk kembali ke struktur; pakai NOW jika reaksi LTF terkonfirmasi atau LIMIT di area reclaim terdekat dengan SL di balik titik trap.
- RETEST SETELAH BOS: pakai LIMIT jika harga belum menyentuh zona retest/demand/supply pemicu BOS, atau NOW jika sudah menyentuh zona dan LTF bereaksi searah BOS.
- MENJELANG / SAAT NEWS USD BERDAMPAK TINGGI: turunkan conviction/risiko ke level hati-hati (0.25x) dan hindari limit tipis yang rawan tersapu wick.
6. ESTIMASI PROBABILITAS, CONVICTION SCORE (0-100) & RISK:
- Hitung Conviction Score (0-100) dari: HTF & zona (0-30), struktur/likuiditas & setup (0-30), trigger & R:R (0-25), serta sesi/volatilitas/likuiditas (0-15).
- Petakan ke level risiko dan estimasi probabilitas realistis:
* 75-100 = HIGH (Risk: 1.0x | Probabilitas umumnya 62%-75%)
* 55-74 = MEDIUM (Risk: 0.5x-0.75x | Probabilitas umumnya 52%-61%)
* 0-54 = LOW (Risk: 0.25x | Probabilitas umumnya 45%-51%)
- Jangan melebih-lebihkan probabilitas secara tidak realistis.
7. EXPIRY & AUTO-CANCEL (KHUSUS LIMIT):
- Untuk BUY/SELL LIMIT, wajib sertakan batas jumlah candle/waktu auto-cancel dan pembatalan otomatis jika level invalidasi SL tertembus lebih dulu atau volatilitas/berita merusak struktur.
FORMAT KELUARAN:
SIGNAL: [BUY NOW | SELL NOW | BUY LIMIT | SELL LIMIT] | [XAUUSD | BTCUSD]
Gaya & TF: [Scalping/Intraday/Swing] | HTF [..] / MTF [..] / LTF [..]
Setup: [Supply & Demand | Reversal | Kontinuitas | Fakeout Trap | Retest BOS]
Entry / Zona: [Harga pasar atau rentang zona limit]
SL: [Level invalidasi + estimasi jarak poin/pip]
TP1 / TP2: [Target 1] | [Target 2]
Probability: [estimasi %] | Conviction: [skor]/100 - [HIGH | MEDIUM | LOW] (Risk: [porsi risiko])
Expiry (jika LIMIT): [Aturan auto-cancel & invalidasi]
Catatan Analisa: [2-3 kalimat ringkas top-down, zona/likuiditas, dasar probabilitas & skor, serta alasan pemilihan order]
Balas HANYA JSON: {"perTfId":["HTF: ...","MTF: ...","LTF: ..."],"perTfEn":["..."],"id":"...","en":"..."}`;

const SYS_BOT = `Anda mentor bot scalper. Engine sudah memutuskan setup — Anda hanya menjelaskan.
Salin angka PERSIS dari JSON (entry, sl, tp1-tp3, conviction, probability). Dilarang mengubah arah atau angka.
Tulis 2-3 kalimat santai namun profesional: apa yang bot lakukan, di mana entry & SL, dan mengapa (trigger + conviction).
Sebut conviction level dan porsi risiko. Tanpa bullet, tanpa basa-basi.
Balas HANYA JSON: {"id":"...","en":"..."}`;

async function reasonManual(f) {
  const fb = { id: manualReason(f, false), en: manualReason(f, true), ai: false };
  const j = await aiJson(SYS_MTF, f, 9000);
  if (!j || typeof j.id !== 'string' || typeof j.en !== 'string') return fb;
  const li = Array.isArray(j.perTfId) ? j.perTfId.map(String) : (f.steps || []).map(s => s.tf + ': ' + s.text);
  const le = Array.isArray(j.perTfEn) ? j.perTfEn.map(String) : (f.steps || []).map(s => s.tf + ': ' + (s.textEn || s.text));
  return { id: layout(f, false, li, j.id), en: layout(f, true, le, j.en), ai: true };
}
async function reasonBot(f) {
  const tp = [f.tp1, f.tp2, f.tp3].filter(isNum).map(Number).join(', ');
  const id = f.status === 'STANDBY' ? 'Bot memantau ' + f.symbol + '. ' + (f.why || '') : 'Bot ' + f.signal + ' @ ' + f.entry + ', SL ' + f.sl + ', TP ' + tp + '.';
  const en = f.status === 'STANDBY' ? 'Bot scanning ' + f.symbol + '.' : 'Bot ' + f.signal + ' at ' + f.entry + ', SL ' + f.sl + ', TP ' + tp + '.';
  const j = await aiJson(SYS_BOT, f, 8000);
  if (j && typeof j.id === 'string' && typeof j.en === 'string') return { id: j.id, en: j.en, ai: true };
  return { id, en, ai: false };
}

async function runManual(ctx, d, style) {
  const role = TF_ROLE[style] || TF_ROLE.Scalping;
  const slRef = SL_REF[style] || SL_REF.Scalping;
  const plan = TP_PLAN[style] || TP_PLAN.Scalping;
  const cl = {};
  for (const tf of ['m1', 'm5', 'm15', 'h1', 'h4', 'd1']) cl[tf] = closed(d[tf], TFMS[tf]);

  const sess = sessionOf(Date.now(), ctx.symbol);
  const mtfRows = cl[role.mtf];
  const ltfRows = cl[role.ltf];
  const slRows = cl[slRef.atrTf] || ltfRows;

  const atrStruct = atr(mtfRows) || ctx.pip * 10;
  const atrSlNow = atr(slRows) || ctx.pip * 10;
  const atrSlBase = atr(slRows.slice(0, Math.max(15, slRows.length - 10))) || atrSlNow;
  const atrUse = atrSanity(atrSlNow, atrSlBase);
  const vol = volatilityRegime(atrSlNow, atrSlBase, sess);

  const ht = internal(cl[role.htf]);
  const it = internal(cl[role.mtf]);
  const lt = internal(cl[role.ltf]);
  const ex = role.exec ? internal(cl[role.exec], 40) : null;

  const H = role.htf.toUpperCase(), M = role.mtf.toUpperCase(), L = role.ltf.toUpperCase();
  const zH = zonesFromRows(cl[role.htf], H, ctx, style);
  const zM = zonesFromRows(cl[role.mtf], M, ctx, style);
  const zL = zonesFromRows(cl[role.ltf], L, ctx, style);
  const allZones = dedupeZones([...zH, ...zM, ...zL, ...gaps(ltfRows).map(g => ({ ...g, tf: L }))]);
  const prox = PROX[style] || 50;
  const nearZones = allZones.filter(z => {
    const inside = ctx.price >= z.lo && ctx.price <= z.hi;
    const dd = (z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi) / ctx.pip;
    return inside || dd <= prox;
  });

  const pools = findPools(mtfRows, ctx, cl.d1);
  const whipsaw = doubleSweep(pools, ltfRows, ctx);
  const aheadPool = pools.filter(x => x.ahead).sort((a, b) => a.distPip - b.distPip)[0];
  const verdict = aheadPool ? sweepVsBreak(aheadPool.price, aheadPool.side, ltfRows, ctx) : { verdict: 'NONE' };

  const b = bounds(ctx.price, ctx, style);
  let bias = resolveBias({ ht, it, lt, zones: allZones, ctx, style, atrM15: atrStruct, slPips: b.min / ctx.pip });
  const guard = counterGuard(bias, b.min / ctx.pip);
  if (!guard.ok) bias = resolveBias({ ht, it, lt, zones: allZones, ctx, style, atrM15: atrStruct, slPips: b.min / ctx.pip, allowCounter: false });

  const aRange = asianRange(ltfRows, ctx.symbol);
  const sessSweep = (sess.key === 'LONDON_KZ' || sess.key === 'NY_AM_KZ') ? asianSweep(ltfRows, aRange, ctx) : null;

  let dir = bias.dir;
  if (sessSweep) dir = sessSweep.dir;
  else if (verdict.verdict === 'SWEEP' || verdict.verdict === 'BREAK') dir = verdict.dir;

  const pd = getPDZone(mtfRows, 60);
  const rg = ranging(mtfRows, 30, M);
  let rangeBound = NaN;
  if (rg && sess.mode === 'RANGE') {
    dir = rg.pos >= 0.5 ? -1 : 1;
    rangeBound = dir === 1 ? rg.lo : rg.hi;
  }

  let chosen = chooseBestZone(ctx, ht, it, lt, allZones.filter(z => z.side === (dir === 1 ? 'demand' : 'supply')), style);
  if (!chosen) chosen = synthesizeZone(ctx, dir, style, ltfRows);

  const steps = [];
  steps.push({ tf: 'Sesi', text: sess.key + ' (' + sess.wib + ' WIB) liq ' + sess.liq + 'x — ' + sess.note, textEn: sess.key + ' liq ' + sess.liq + 'x — ' + sess.noteEn });
  steps.push({ tf: 'Volatilitas', text: vol.id, textEn: vol.en });
  steps.push({ tf: H, text: dw(ht.dir) + ' ' + (ht.ev || '-') + (ht.fresh ? ' fresh' : ' stale') + (ht.displaced ? ' displacement' : ' TANPA displacement') + (pd ? ' · harga di ' + ((ctx.price - pd.lo) / pd.range >= 0.5 ? 'premium' : 'discount') : ''), textEn: dwEn(ht.dir) + ' ' + (ht.ev || '-') });
  steps.push({ tf: M, text: dw(it.dir) + ' ' + (it.ev || '-') + (it.fresh ? ' fresh' : ' stale') + (it.displaced ? ' displacement' : ' tanpa displacement'), textEn: dwEn(it.dir) + ' ' + (it.ev || '-') });
  steps.push({ tf: L, text: dw(lt.dir) + ' ' + (lt.ev || '-') + (lt.fresh ? ' fresh' : ' stale'), textEn: dwEn(lt.dir) + ' ' + (lt.ev || '-') });
  if (ex) steps.push({ tf: role.exec.toUpperCase(), text: 'Timing ' + dw(ex.dir) + (ex.dir === dir ? ' — konfirmasi eksekusi' : ' — belum searah, pakai LIMIT'), textEn: 'Timing ' + dwEn(ex.dir) });
  steps.push({ tf: 'Likuiditas', text: aheadPool ? aheadPool.type + ' ' + ctx.f(aheadPool.price) + ' (' + ctx.dp(aheadPool.distPip) + ' pip, ' + aheadPool.state + ') → ' + verdict.verdict + (verdict.id ? ': ' + verdict.id : '') : 'tidak ada kolam terdepan', textEn: aheadPool ? aheadPool.type + ' → ' + verdict.verdict : 'no pool ahead' });
  if (whipsaw) steps.push({ tf: 'Whipsaw', text: 'Double sweep ≤3 candle — kemungkinan news. Risk 0.25x.', textEn: 'Double sweep — news whipsaw.' });
  if (sessSweep) steps.push({ tf: 'Setup Sesi', text: sessSweep.id, textEn: sessSweep.en });
  if (bias.mode === 'LTF_COUNTER') steps.push({ tf: 'LTF Dinamis', text: 'LTF memimpin counter-HTF, penalti -' + bias.penalty + (bias.mtfAgrees ? ' (MTF setuju)' : ' (MTF lawan, forced LOW)'), textEn: 'LTF leads counter-HTF.' });
  if (!guard.ok) steps.push({ tf: 'LTF Dinamis', text: guard.reason, textEn: guard.reason });
  steps.push({ tf: 'Zona', text: zoneLine(nearZones, ctx, false, prox), textEn: zoneLine(nearZones, ctx, true, prox) });

  const p = { dir, entry: ctx.price, sl: ctx.price, type: 'LIMIT', zone: chosen ? chosen.z : null, steps };
  const pool = [];
  if (chosen) pool.push({ ...chosen.z, d: chosen.d });
  for (const z of nearZones) if (z.side === (dir === 1 ? 'demand' : 'supply') && !pool.some(k => k.lo === z.lo && k.hi === z.hi)) pool.push(z);

  const em = entryMode(ctx, p, it, lt, ex, style, pool, ltfRows);
  p.type = em.type; p.entry = em.entry; p.note = em.note; p.forced = !!em.forced;
  if (em.zone) p.zone = em.zone;

  const sideFix = fixSide(p.type, p.entry, p.dir, ctx.price, ctx.pip);
  if (sideFix.flipped) {
    p.type = sideFix.type; p.entry = sideFix.entry;
    p.note = 'NOW @ ' + ctx.f(p.entry) + ': LIMIT semula di sisi salah harga, dikonversi ke market.';
    steps.push({ tf: 'Koreksi', text: p.note, textEn: 'LIMIT side invalid, converted to market.' });
  }
  p.zone = coupleZone(p.zone, p.entry, p.dir, ctx.pip, atrUse);

  const struct = swingLevel(cl[slRef.swingTf] || ltfRows, p.dir, slRef.win);
  const slp = slBeyondPool(pools, p.dir, p.entry, ctx, atrUse);
  let rr = calcSL({ entry: p.entry, dir: p.dir, ctx, b, sess, atrUse, structLevel: sessSweep ? sessSweep.extreme : struct, poolLevel: slp ? slp.pool.price : NaN, rangeBound });
  p.sl = rr.sl; p.riskPips = rr.riskPips; p.slCapped = rr.capped;
  p.invalidLevel = slp ? slp.level : (sessSweep ? sessSweep.extreme : struct);
  const slReason = slp ? 'di luar kolam ' + slp.pool.type + ' + buffer' : (sessSweep ? 'di balik titik sweep' : 'di luar swing struktur');
  steps.push({ tf: 'SL', text: '[' + slRef.atrTf.toUpperCase() + '] ' + rr.diag + ' · ' + slReason, textEn: rr.diag });

  const draw = nearestDraw(pools, p.dir, ctx);
  let fin = planTPs({ style, entry: p.entry, dir: p.dir, risk: rr.need, pip: ctx.pip, wall: bias.wall, draw, dp: ctx.dp });
  let rrPenalty = 0;

  const runwayTooTight = Number.isFinite(fin.runwayPip) && fin.runwayPip < rr.riskPips;
  if (!fin.tps) {
    fin = { tps: buildTPs(p.entry, p.dir, rr.need), count: plan.count, mode: 'RISK_R', pips: [], rr1: 1, poorRR: false, runwayPip: null };
    steps.push({ tf: 'TP', text: 'Runway buntu — TP pola R murni tanpa cap likuiditas.', textEn: 'Runway blocked — pure R-multiple TP.' });
  } else if (runwayTooTight) {
    steps.push({ tf: 'TP', text: 'Runway ' + fin.runwayPip + ' pip < SL ' + rr.riskPips + ' pip — TP dikompresi, conviction -6.', textEn: 'Runway tight — TP compressed, conviction -6.' });
    rrPenalty += 6;
  } else {
    steps.push({ tf: 'TP', text: fin.count + ' target · ' + fin.mode + ' · ' + (fin.pips || []).join(' / ') + ' pip' + (fin.scaled ? ' (diskala ke runway ' + fin.runwayPip + ' pip)' : '') + ' · TP1 ' + fin.rr1 + 'R', textEn: fin.count + ' targets · ' + fin.mode });
  }
  p.tps = fin.tps; p.tpCount = fin.count; p.tpMode = fin.mode;
  p.tpCapped = fin.mode !== 'RISK_R' && fin.mode !== 'FIXED_PIP';

  if (rr.structMismatch) {
    rrPenalty += 8;
    steps.push({ tf: 'SL', text: 'Invalidasi struktur di luar skala ATR — SL pakai ATR murni, conviction -8.', textEn: 'Structural invalidation out of ATR scale.' });
  }
  if (rr.atrOverflow) {
    rrPenalty += 10;
    steps.push({ tf: 'SL', text: 'ATR ' + ctx.dp(atrUse / ctx.pip) + ' pip melebihi cap gaya — SL dilebarkan ke ' + rr.riskPips + ' pip agar di luar noise, conviction -10.', textEn: 'ATR exceeds style cap — SL widened.' });
  }
  if (draw) steps.push({ tf: 'Draw', text: 'Target ' + draw.type + ' ' + ctx.f(draw.price) + ' (' + ctx.dp(draw.distPip) + ' pip, ' + draw.state + ').', textEn: 'Draw ' + draw.type });

  const setupType = classifySetup(ht, it, lt, chosen, verdict.verdict, sessSweep);
  let c1 = 0;
  if (ht.dir === p.dir) c1 += 20; else if (ht.dir === 0) c1 += 10; else c1 += 5;
  if (chosen) { const w = chosen.width; if (w >= 20 && w <= 80) c1 += 10; else if (w >= 15) c1 += 5; }
  c1 = Math.min(30, c1);
  let c2 = 0;
  const stMap = { 'Supply & Demand': 18, 'Kontinuitas': 16, 'Retest BOS': 15, 'Reversal': 12, 'Fakeout/Trap': 14 };
  c2 += stMap[setupType.type] || 5;
  if (it.fresh && it.displaced && it.dir === p.dir) c2 += 5;
  if (verdict.verdict === 'SWEEP' && (sess.key === 'LONDON_KZ' || sess.key === 'NY_AM_KZ')) c2 += 7;
  else if (verdict.verdict === 'BREAK') c2 += 6;
  else if (verdict.verdict === 'AMBIGUOUS') c2 += 1;
  else c2 += 3;
  if (pools.some(x => x.strength >= 5 && x.state === 'VIRGIN' && x.ahead)) c2 += 2;
  c2 = Math.min(30, c2);
  let c3 = 0;
  if (lt.dir === p.dir) c3 += 12;
  if (lt.fresh) c3 += 6;
  if (ex && ex.dir === p.dir) c3 += 4;
  if (!rr.capped) c3 += 3;
  c3 = Math.min(25, c3);
  let c4 = sessionScore(sess, setupType.type === 'Fakeout/Trap' ? 'SWEEP' : (rg ? 'RANGE' : 'TREND'));
  c4 -= vol.penalty;
  c4 = Math.max(0, Math.min(15, c4));

  let conv = c1 + c2 + c3 + c4 - rrPenalty;
  const adj = adjustConviction(conv, bias, p.tps.filter(isNum), p.entry, p.dir);
  conv = adj.conviction;
  if (whipsaw || sess.mode === 'AVOID' || vol.regime === 'SPIKE') conv = Math.min(conv, 54);

  p.conviction = Math.max(0, Math.min(100, Math.round(conv)));
  p.setupType = setupType;
  p.sess = sess;
  p.biasMode = bias.mode;
  p.expiry = bias.mode === 'LTF_COUNTER' ? counterExpiry(style) : baseExpiry(style);
  if (p.type === 'LIMIT') {
    const byTime = Date.now() + p.expiry.minutes * 60000;
    p.expiresAt = Math.min(byTime, sess.nextBoundaryMs);
    p.expiry.id += ' Atau ganti sesi (' + sess.minsToBoundary + ' menit lagi).';
  }

  steps.push({ tf: 'Entry', text: p.note, textEn: p.note });
  steps.push({ tf: 'Conviction', text: p.conviction + '/100 (HTF ' + c1 + '/30 · Setup ' + c2 + '/30 · Trigger ' + c3 + '/25 · Sesi ' + c4 + '/15) → ' + (p.conviction >= 75 ? 'HIGH' : p.conviction >= 55 ? 'MEDIUM' : 'LOW') + ' · Risk ' + riskMult(p.conviction) + 'x · Prob ' + estimateProbability(p.conviction).label, textEn: p.conviction + '/100' });
  if (p.type === 'LIMIT') steps.push({ tf: 'Expiry', text: p.expiry.id, textEn: p.expiry.en });

  const s = sigOf(p, ctx, style);
  s.checklist = steps.map(x => x.tf + ': ' + x.text);

  const f = {
    symbol: ctx.symbol, style, status: s.status, signal: s.signal, orderType: s.orderType,
    entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4, tp5: s.tp5,
    tpCount: s.tpCount, tpMode: s.tpMode,
    riskPips: s.riskPips, invalidLevel: s.invalidLevel, entryNote: s.entryNote, steps,
    setup: setupType.type, setupLabel: setupType.id,
    conviction: p.conviction, convictionLevel: s.convictionLevel,
    probability: s.probability, riskMultiplier: s.riskMultiplier,
    tfLabels: { htf: H, mtf: M, ltf: L, exec: role.exec ? role.exec.toUpperCase() : null },
    asset: ctx.symbol === 'BTCUSD' ? 'BTCUSD — 24/7, impulsif, stop-hunt equal highs/lows, weekend tipis' : 'XAUUSD — 24/5, sensitif makro USD, sweep high/low sesi',
    priceNow: ctx.f(ctx.price),
    entryDistPips: ctx.dp(Math.abs(ctx.price - p.entry) / ctx.pip),
    convictionBreakdown: { htf: c1 + '/30', setup: c2 + '/30', trigger: c3 + '/25', session: c4 + '/15' },
    session: sess.key, sessionWib: sess.wib, sessionNote: sess.note, sessionLiq: sess.liq,
    volRegime: vol.regime, volNote: vol.id,
    premiumDiscount: pd ? ((ctx.price - pd.lo) / pd.range >= 0.5 ? 'premium' : 'discount') : null,
    htfDisplacement: ht.displaced, mtfDisplacement: it.displaced,
    pool: aheadPool ? { type: aheadPool.type, price: ctx.f(aheadPool.price), distPips: ctx.dp(aheadPool.distPip), state: aheadPool.state } : null,
    verdict: verdict.verdict, slReason, slDiag: rr.diag, slRefTf: slRef.atrTf.toUpperCase(),
    tpCapped: !!p.tpCapped, biasMode: p.biasMode, whipsaw: !!whipsaw,
    liquidity: aheadPool ? aheadPool.type + ' ' + verdict.verdict : 'none',
    zones: nearZones.slice(0, 3).map(z => ({ kind: z.kind, tf: z.tf, lo: ctx.f(z.lo), hi: ctx.f(z.hi), side: z.side })),
    chart: s.chart, expiry: p.expiry, dec: ctx.dec, price: ctx.f(ctx.price),
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
      if (ict && ict.status === 'limit') r = { ok: true, dir: ict.dir === 'BUY' ? 1 : -1, entry: ict.entry, sl: ict.sl, orderType: 'LIMIT', tier: 'ICT_POI', trigger: 'POI M15', bias: 'M15 ' + ict.dir, checklist: ['POI M15'] };
    } catch {}
  }
  if (!r || !r.ok) return standby(ctx, 'Scalping', (r && r.reason) || 'Menunggu setup bot.', []);
  const risk = Math.abs(Number(r.entry) - Number(r.sl)) || bounds(Number(r.entry), ctx, 'Scalping').min;
  const p = { dir: r.dir, entry: num(r.entry, ctx.price), sl: num(r.sl, ctx.price), type: r.orderType || 'MARKET', tps: buildTPs(Number(r.entry), r.dir, risk), tpCount: 5, riskPips: ctx.dp(risk / ctx.pip), conviction: 60, setupType: { type: 'Supply & Demand', id: 'Bot ICT POI' }, steps: [], zone: null };
  const s = sigOf(p, ctx, 'Scalping');
  s.style = 'scalperbot'; s.tier = r.tier || 'EA'; s.expiresAt = Date.now() + 9e5;
  s.checklist = r.checklist || [];
  const f = { symbol: ctx.symbol, style: 'scalperbot', status: s.status, signal: s.signal, orderType: s.orderType, entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4, tp5: s.tp5, trigger: r.trigger || null, bias: r.bias || 'netral', checklist: r.checklist || [], dec: ctx.dec, price: ctx.f(ctx.price), conviction: 60, convictionLevel: 'MEDIUM', probability: '55%', riskMultiplier: 0.65, setup: 'Supply & Demand' };
  return { signal: s, facts: f };
}

function lifecycle(prev, sym, style, price, pip, data) {
  if (!prev || typeof prev !== 'object' || prev.symbol !== sym || prev.style !== style) return null;
  if (prev.signal !== 'BUY' && prev.signal !== 'SELL') return null;
  if (prev.status === 'TP5_HIT' || prev.finished) return null;
  const exp = Number(prev.expiresAt);
  if (!Number.isFinite(exp) || Date.now() > exp) return { dead: true, out: 'EXPIRED', prev };
  const dir = prev.signal === 'BUY' ? 1 : -1;
  const sl = Number(prev.sl), e = Number(prev.entry);
  if (![sl, e].every(Number.isFinite) || sl === e) return null;
  const risk0 = Math.abs(e - sl);
  const plan = TP_PLAN[prev.style] || TP_PLAN.Scalping;
  const rawT = [prev.tp1, prev.tp2, prev.tp3, prev.tp4, prev.tp5].map(v => (isNum(v) ? Number(v) : NaN));
  const t = [0, 1, 2, 3, 4].map(i => {
    if (i >= plan.count) return NaN;
    const v = rawT[i];
    if (Number.isFinite(v) && v !== e && v !== 0) return v;
    const base = plan.mode === 'PIP' ? plan.targets[i] * pip : risk0 * plan.targets[i];
    return e + dir * base;
  });
  if (!Number.isFinite(t[0])) return null;
  const tfKey = style === 'scalperbot' ? 'm1' : style === 'Swing' ? 'm15' : 'm5';
  const ms = TFMS[tfKey] || 3e5;
  const rows = clean((data && data[tfKey]) || []);
  const start = Number(prev.lastTickAt) || Number(prev.createdAt) || Date.now();
  let win = rows.filter(c => tsMs(c.t) + ms > start && tsMs(c.t) <= Date.now());
  if (!win.length) win = [{ t: Date.now(), h: price, l: price, c: price }];
  let filled = prev.status !== 'PENDING' || Number(prev.filledAt) > 0;
  let filledAt = Number(prev.filledAt) || 0;
  const hits = new Set(Array.isArray(prev.tpHits) ? prev.tpHits.filter(n => n <= plan.count) : []);
  let be = !!prev.be || hits.has(1);
  let dead = null;
  const lastIdx = plan.count;
  for (const c of win) {
    if (!filled) {
      if (dir === 1 ? c.l <= e : c.h >= e) { filled = true; filledAt = tsMs(c.t); } else continue;
    }
    const slEff = be ? e : sl;
    if (dir === 1 ? c.l <= slEff : c.h >= slEff) { dead = { out: be ? 'BE' : 'SL' }; break; }
    for (let i = 0; i < lastIdx; i++) {
      const v = t[i];
      if (Number.isFinite(v) && !hits.has(i + 1) && (dir === 1 ? c.h >= v : c.l <= v)) hits.add(i + 1);
    }
    if (hits.has(1)) be = true;
    if (hits.has(lastIdx)) { dead = { out: 'TPMAX' }; break; }
  }
  const maxHit = hits.size ? Math.max(...hits) : 0;
  const patch = { tpHits: [...hits].sort((a, b) => a - b), tpHitCount: hits.size, maxTpHit: maxHit, be, slBe: be ? e : null, filledAt: filledAt || null, lastTickAt: Date.now() };
  if (dead && dead.out === 'TPMAX') return { dead: true, out: 'TP' + lastIdx, prev, patch: { ...patch, status: 'TP' + lastIdx + '_HIT', state: 'TP' + lastIdx, finished: true } };
  if (dead) return { dead: true, out: dead.out, prev, patch };
  let status, state;
  if (!filled) { status = 'PENDING'; state = 'LIMIT_PLACED'; }
  else if (maxHit >= 1) { status = 'TP' + maxHit + '_HIT'; state = 'TP' + maxHit; }
  else { status = 'RUNNING'; state = filledAt ? 'FILLED' : 'CONFIRMED'; }
  return { dead: false, prev, patch: { ...patch, status, state } };
}

// ===== VISION — TIDAK DIUBAH =====
const SYS_VIS = 'Kamu analis S&D/OB dari gambar chart. Baca level PERSIS dari skala harga. Wajib BUY atau SELL kecuali gambar bukan chart. Prioritaskan LIMIT pullback; MARKET hanya bila harga sudah di zona dan ada penolakan. Sebutkan zona TF tinggi dan rendah pada perImageAnalyses. SL di luar distal zona/swing. Balas HANYA JSON: {"signal":"BUY","orderType":"LIMIT","entry":0,"sl":0,"tp1":0,"tp2":0,"tp3":0,"tp4":0,"tp5":0,"zoneLow":0,"zoneHigh":0,"zone":"Demand","pair":"","decimals":2,"perImageAnalyses":[],"perImageAnalysesEn":[],"reason":"","reasonEn":""}';

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
  const a = txt.indexOf('{'), bb = txt.lastIndexOf('}');
  let j = null;
  if (a >= 0 && bb > a) { try { j = JSON.parse(txt.slice(a, bb + 1)); } catch {} }
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
  const tps = buildTPs(entry, dir, risk).map(f);
  const zl = f(Number(j.zoneLow) || Math.min(entry, entry - dir * risk * 0.5));
  const zh = f(Number(j.zoneHigh) || Math.max(entry, entry - dir * risk * 0.5));
  const pi = Array.isArray(j.perImageAnalyses) ? j.perImageAnalyses.map(String) : [];
  const pe = Array.isArray(j.perImageAnalysesEn) ? j.perImageAnalysesEn.map(String) : pi;
  const rid = '[' + sym + ' · Analisa ' + imgs.length + ' Gambar]\n' + pi.map(t => '• ' + t).join('\n') + '\n\n[Setup]\n' + (j.reason || '');
  const ren = '[' + sym + ' · ' + imgs.length + '-Image Analysis]\n' + pe.map(t => '• ' + t).join('\n') + '\n\n[Setup]\n' + (j.reasonEn || j.reason || '');
  const isLimit = String(j.orderType || '').toUpperCase() === 'LIMIT';
  const out = {
    signal: sg, orderType: isLimit ? 'LIMIT' : 'MARKET', fill: isLimit ? 'LIMIT' : 'NOW',
    status: isLimit ? 'PENDING' : 'RUNNING', entryMode: isLimit ? 'PULLBACK' : 'NOW',
    symbol: sym, pair: sym, dec, pip, style, entry, sl,
    tp1: tps[0], tp2: tps[1], tp3: tps[2], tp4: tps[3], tp5: tps[4], tpCount: 5,
    riskPips: Math.round((risk / pip) * pipScaleOf(sym)), pipDisplayScale: pipScaleOf(sym),
    tpHits: [], tpHitCount: 0, maxTpHit: 0, be: false, slBe: null,
    zone: { min: zl, max: zh, label: (j.zone || 'Zona') + ' ' + zl + '–' + zh },
    reason: lang === 'en' ? ren : rid, reasons: { id: rid, en: ren },
    reasonSource: 'AI', aiReasoning: true,
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
  const data = {};
  for (const tf of ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1']) {
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
  catch (e) { console.error('[v205] engine error:', e.message, e.stack); out = standby(ctx, style, 'Engine error: ' + e.message, []); }
  if (!out || !out.signal) out = standby(ctx, style, 'Menunggu setup valid.', []);

  const key = symbol + '|' + style;
  const clientPrev = (body.prevSignal && typeof body.prevSignal === 'object') ? body.prevSignal : null;
  const storePrev = await loadSignal(symbol, style);
  const prev = pickPrev(clientPrev, storePrev);
  const restored = !clientPrev && !!storePrev;
  const life = lifecycle(prev, symbol, style, price, ctx.pip, data);
  if (life && life.prev) life.prev = repairTPs(life.prev, ctx.f, ctx.pip);
  if (life && life.dead) {
    await saveOutcome(key, { dir: life.prev.signal, out: life.out, t: Date.now() });
    await dropSignal(symbol, style);
  }
  if (life && life.dead && String(life.out).startsWith('TP') && life.patch && life.patch.finished) {
    const fin = repairTPs({ ...life.prev, ...life.patch, sticky: true, finished: true }, ctx.f, ctx.pip);
    if (fin.reasons) fin.reason = lang === 'en' ? (fin.reasons.en || fin.reasons.id) : (fin.reasons.id || fin.reasons.en);
    return res.status(200).json({ ok: true, mode: isBot ? 'bot' : 'candles', symbol, style, price, signal: fin, diag: { version: VERSION, lifecycle: life.out, store: kvOn ? 'KV' : 'MEM' } });
  }
  if (life && !life.dead) {
    const managed = repairTPs({ ...life.prev, ...life.patch, sticky: true }, ctx.f, ctx.pip);
    const opp = out.signal.status !== 'STANDBY' && out.signal.signal !== managed.signal;
    if (!(body.forceNew && opp)) {
      await saveSignal(managed);
      if (managed.reasons) managed.reason = lang === 'en' ? (managed.reasons.en || managed.reasons.id) : (managed.reasons.id || managed.reasons.en);
      return res.status(200).json({ ok: true, mode: isBot ? 'bot' : 'candles', symbol, style, price, signal: managed, diag: { version: VERSION, lifecycle: managed.state, tpHits: managed.tpHits, sticky: true, restored, store: kvOn ? 'KV' : 'MEM' } });
    }
  }
  if (isBot && out.signal.status !== 'STANDBY') { try { await markTrialBotUsed(email); } catch {} }
  const f = out.facts || { symbol, style, status: 'STANDBY', why: '', steps: [], dec, price: ctx.f(price) };
  const ck = key + '|' + f.status + '|' + (f.signal || '') + '|' + (f.entry || '') + '|' + (f.tp1 || '') + '|' + (f.tp3 || '');
  let story = stories.get(ck);
  if (!story || Date.now() - story.t > 12e4) {
    const r = isBot ? await reasonBot(f) : await reasonManual(f);
    story = { t: Date.now(), v: r };
    stories.set(ck, story);
    if (stories.size > 200) stories.delete(stories.keys().next().value);
  }
  const signal = { ...out.signal, reason: lang === 'en' ? story.v.en : story.v.id, reasons: { id: story.v.id, en: story.v.en }, reasonSource: story.v.ai ? 'AI' : 'RULES', aiReasoning: !!story.v.ai };
  if (signal.status !== 'STANDBY') await saveSignal(signal);
  return res.status(200).json({ ok: true, mode: isBot ? 'bot' : 'candles', symbol, style, price, signal, diag: { version: VERSION, status: signal.status, session: f.session || null, liquidity: f.liquidity || null, biasMode: f.biasMode || null, conviction: f.conviction || 0, setup: f.setup || null, tpCount: signal.tpCount || 0, chartTf: signal.chart ? signal.chart.tf : null, spanPips: signal.chart ? signal.chart.range.spanPips : null, store: kvOn ? 'KV' : 'MEM' } });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-email');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ ok: true, version: VERSION, store: kvOn ? 'KV' : 'MEM' });
  if (req.method !== 'POST') return res.status(200).json({ ok: false, reason: 'Method not allowed' });
  try {
    let body = req.body || {};
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
    console.error('[generate] fatal:', err?.message, err?.stack);
    if (!res.headersSent) return res.status(200).json({ ok: false, reason: 'Server error: ' + (err?.message || 'unknown'), version: VERSION });
  }
}
