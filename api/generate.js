// api/generate.js — v219
// TF PAIRS: Scalping M15/M5/M1 · Intraday H4/M30/M5 · Swing D1/H4/H1
// 3 TP semua mode · entry single (manual) / zone (vision) · forced binary · hybrid vision
// v219 fix: norm3TP (signal sticky lama dipaksa 3 TP) + sticky memakai reason bawaannya
// (teks reasoning selalu cocok dengan angka di card).
// Env opsional: HYBRID_VISION=0 (pure rule-engine).

import { checkAccess, markTrialBotUsed } from '../lib/access.js';
import { planBot } from '../lib/bot-ict.js';
import { runBotSma as runBotFlex } from '../lib/bot_3candle.js';
import { sessionOf, asianRange, asianSweep, sessionScore, volatilityRegime } from '../lib/session.js';
import { findPools, sweepVsBreak, doubleSweep, nearestDraw, slBeyondPool } from '../lib/liquidity.js';
import { resolveBias, counterGuard, adjustConviction, counterExpiry, nearestWall } from '../lib/framework-manual.js';
import { atrSanity, calcSL } from '../lib/risk-atr.js';
import { TP_PLAN, planTPs, repairTPs, coupleZone, buildChart } from '../lib/tp-final.js';
import { SCENARIOS, detectScenario, decideOrderType, cancelTolerance } from '../lib/scenarios.js';
import { buildReason } from '../lib/reason.js';
import { monitorLTFStructure, calculatePreciseSL, LTF_TF } from '../lib/ltf-dynamic.js';
import { renderSignalChart } from '../lib/chart-render.js';

export const config = { maxDuration: 60 };
const VERSION = 'v219';
const HYBRID = process.env.HYBRID_VISION !== '0';
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
  Scalping: { htf: 'm15', mtf: 'm5', ltf: 'm1', exec: null },
  Intraday: { htf: 'h4', mtf: 'm30', ltf: 'm5', exec: null },
  Swing: { htf: 'd1', mtf: 'h4', ltf: 'h1', exec: null },
};
const SL_REF = {
  Scalping: { atrTf: 'm1', swingTf: 'm5', win: 10, smooth: true },
  Intraday: { atrTf: 'm30', swingTf: 'm30', win: 8, smooth: false },
  Swing: { atrTf: 'h4', swingTf: 'h4', win: 8, smooth: false },
};
const NEED = {
  Scalping: ['m1', 'm5', 'm15'],
  Intraday: ['m5', 'm30', 'h4'],
  Swing: ['h1', 'h4', 'd1'],
};
const MINB = { m1: 80, m5: 50, m15: 40, m30: 35, h1: 35, h4: 25, d1: 20 };
const EXPMS = { Scalping: 30 * 6e4, Intraday: 480 * 6e4, Swing: 5760 * 6e4 };
const PROX = { Scalping: 50, Intraday: 80, Swing: 200 };
const MIN_ZONE_WIDTH = { Scalping: 20, Intraday: 20, Swing: 30 };
const RULES = {
  Scalping: { gMin: 30, gMax: 80, bMin: 0.004, bMax: 0.010 },
  Intraday: { gMin: 50, gMax: 150, bMin: 0.005, bMax: 0.014 },
  Swing: { gMin: 100, gMax: 350, bMin: 0.01, bMax: 0.025 },
};
const TP_MULT = [1, 1.5, 2.5];
const COOLDOWN = 3e5;

const cache = new Map();
const outcomes = new Map();
const stories = new Map();
const visionCache = new Map();
const isNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const num = (v, f = 0) => (isNum(v) ? Number(v) : f);
const tsMs = t => (t < 1e12 ? t * 1000 : t);
const closed = (c, ms) => (Array.isArray(c) && c.length && Date.now() < tsMs(c[c.length - 1].t) + ms ? c.slice(0, -1) : (c || []));
const iso = d => d.toISOString().slice(0, 10);
const dw = d => (d === 1 ? 'bullish' : d === -1 ? 'bearish' : 'netral');
const buildTPs = (e, dir, r) => (!(r > 0) || !Number.isFinite(e)) ? [e, e, e] : TP_MULT.map(m => e + dir * r * m);

// [v219] Paksa format 3 TP pada signal APA PUN (termasuk sticky lama dari versi sebelumnya)
function norm3TP(s) {
  if (!s || typeof s !== 'object') return s;
  s.tp4 = null; s.tp5 = null; s.tpCount = 3;
  if (Array.isArray(s.tpHits)) s.tpHits = s.tpHits.filter(n => n <= 3);
  if (s.maxTpHit > 3) s.maxTpHit = 3;
  return s;
}

function sanitizeCandles(rows, atrRef, mult = 5) {
  if (!Array.isArray(rows) || rows.length < 2) return rows;
  const maxRange = atrRef * mult;
  if (!(maxRange > 0)) return rows;
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i], range = c.h - c.l;
    if (range > maxRange && i < rows.length - 1) {
      const prev = out[out.length - 1] || c;
      out.push({ t: c.t, o: prev.c, h: Math.max(prev.c, c.c), l: Math.min(prev.c, c.c), c: c.c });
      continue;
    }
    if (out.length && c.t <= out[out.length - 1].t) continue;
    out.push(c);
  }
  return out;
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
const sigKey = (s, st) => 'sig:' + s + '|' + st;
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
  if (kvOn) { try { await kvCmd(['SET', 'oc:' + key, JSON.stringify(oc), 'EX', String(Math.ceil(COOLDOWN / 1000))]); } catch {} }
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
function atrSmooth(rows, n = 20) {
  if (!Array.isArray(rows) || rows.length < n + 1) return 0;
  const tr = i => Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - rows[i - 1].c), Math.abs(rows[i].l - rows[i - 1].c));
  let a = 0;
  for (let i = 1; i <= n; i++) a += tr(i);
  a /= n;
  for (let i = n + 1; i < rows.length; i++) a = (a * (n - 1) + tr(i)) / n;
  return a;
}
function sessionAtr(rows, sess, symbol) {
  if (!Array.isArray(rows) || rows.length < 5) return 0;
  const same = rows.filter(c => sessionOf(tsMs(c.t), symbol).key === sess.key);
  const calc = same.length >= 5 ? same : rows.slice(-5);
  return atr(calc) || 0;
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
  o.ev = ev; o.dir = tr; o.fresh = tr !== 0 && bi >= n - 12; o.displaced = disp;
  return o;
}
function ranging(rows, lb = 30, tf = 'M30') {
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
  return { hi, lo, range };
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
  const structDir = ht.dir !== 0 ? ht.dir : (it.dir !== 0 ? it.dir : lt.dir);
  const cand = zones.filter(z => {
    const inside = ctx.price >= z.lo && ctx.price <= z.hi;
    const d = (z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi) / ctx.pip;
    return inside || d <= prox * 2;
  });
  if (!cand.length) return null;
  return cand.map(z => {
    const s = scoreZone(z, ht, it, lt, ctx, style);
    const zoneDir = z.side === 'demand' ? 1 : -1;
    return { z, score: s.score + (zoneDir === structDir ? 15 : 0), width: s.width, d: s.d, inside: s.inside };
  }).sort((a, b) => b.score - a.score)[0];
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
function findEntryZone(ctx, p, pool, ltfRows) {
  const prox = PROX[p._style] || 50;
  const validPool = pool.filter(z => (p.dir === 1 ? z.side === 'demand' : z.side === 'supply'));
  for (const z of validPool) {
    const zl = z.lo, zh = z.hi, w = zh - zl;
    const inside = ctx.price >= zl && ctx.price <= zh;
    const beyond = p.dir === 1 ? ctx.price < zl : ctx.price > zh;
    if (beyond) continue;
    const lim = inside ? ctx.price : (p.dir === 1 ? zh + Math.min(2 * ctx.pip, 0.1 * w) : zl - Math.min(2 * ctx.pip, 0.1 * w));
    const sideOk = p.dir === 1 ? lim <= ctx.price : lim >= ctx.price;
    const distPip = Math.abs(ctx.price - lim) / ctx.pip;
    if (sideOk && distPip <= prox) return { z, lim, inside, distPip };
  }
  const synth = synthesizeZone(ctx, p.dir, p._style, ltfRows);
  if (synth) {
    const off = Math.max(5 * ctx.pip, Math.min(synth.d * ctx.pip, 15 * ctx.pip));
    const entry = ctx.price - p.dir * off;
    return { z: synth.z, lim: entry, inside: false, distPip: off / ctx.pip };
  }
  const off = 10 * ctx.pip, entry = ctx.price - p.dir * off, w2 = 15 * ctx.pip;
  const z = { lo: p.dir === 1 ? entry - w2 : entry, hi: p.dir === 1 ? entry : entry + w2, side: p.dir === 1 ? 'demand' : 'supply', kind: 'Fallback', tf: TF_ROLE[p._style].ltf.toUpperCase(), isSynthetic: true };
  return { z, lim: entry, inside: false, distPip: off / ctx.pip };
}
function rejectionAt(ctx, rows, dir) {
  if (!Array.isArray(rows) || rows.length < 3) return false;
  const c = rows[rows.length - 1], p = rows[rows.length - 2];
  const rng = c.h - c.l || ctx.pip;
  if (dir === 1) {
    const lowerWick = Math.min(c.o, c.c) - c.l;
    return lowerWick > 0.5 * rng || (c.c > c.o && p.c < p.o && c.c > p.o && c.o < p.c);
  }
  const upperWick = c.h - Math.max(c.o, c.c);
  return upperWick > 0.5 * rng || (c.c < c.o && p.c > p.o && c.c < p.o && c.o > p.c);
}
function estimateProbability(c) {
  if (c >= 75) return { min: 62, max: 75, label: Math.round(62 + (c - 75) / 25 * 13) + '%' };
  if (c >= 55) return { min: 52, max: 61, label: Math.round(52 + (c - 55) / 20 * 9) + '%' };
  return { min: 45, max: 51, label: Math.round(45 + c / 55 * 6) + '%' };
}
const riskMult = c => (c >= 75 ? 1.0 : c >= 55 ? 0.65 : 0.25);
function baseExpiry(style) {
  const m = {
    Scalping: { candles: 15, tf: 'M1', minutes: 15 },
    Intraday: { candles: 8, tf: 'M30', minutes: 240 },
    Swing: { candles: 12, tf: 'H1', minutes: 720 },
  };
  const e = m[style] || m.Scalping;
  return { ...e, id: 'Auto-cancel ' + e.candles + ' candle ' + e.tf + ' (' + e.minutes + ' mnt) atau SL tertembus lebih dulu.', en: 'Auto-cancel ' + e.candles + ' ' + e.tf + ' candles (' + e.minutes + ' min) or SL hit first.' };
}
function setupToScenario(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('kontin')) return SCENARIOS.CONTINUATION;
  if (n.includes('retest')) return SCENARIOS.RETEST_BOS;
  if (n.includes('revers')) return SCENARIOS.REVERSAL;
  if (n.includes('fake') || n.includes('trap') || n.includes('sweep')) return SCENARIOS.FAKEOUT;
  if (n.includes('range')) return SCENARIOS.RANGE_EDGE;
  if (n.includes('break')) return SCENARIOS.BREAKOUT;
  if (n.includes('demand') || n.includes('supply')) return SCENARIOS.CONTINUATION;
  return SCENARIOS.UNCLEAR;
}

function sigOf(p, ctx, style) {
  const f = ctx.f;
  const nf = v => (isNum(v) ? f(v) : null);
  const risk = Math.abs(p.entry - p.sl) || bounds(p.entry, ctx, style).min;
  const tps = Array.isArray(p.tps) && p.tps.length >= 3 ? p.tps.slice(0, 3) : buildTPs(p.entry, p.dir, risk);
  const c = p.conviction || 0;
  const prob = estimateProbability(c);
  const lvl = c >= 75 ? 'HIGH' : c >= 55 ? 'MEDIUM' : 'LOW';
  const s = {
    signal: p.dir === 1 ? 'BUY' : 'SELL',
    orderType: p.type, fill: p.type === 'MARKET' ? 'NOW' : 'LIMIT',
    status: p.type === 'MARKET' ? 'RUNNING' : 'PENDING',
    state: p.type === 'MARKET' ? 'CONFIRMED' : 'LIMIT_PLACED',
    entry: f(p.entry), sl: f(p.sl),
    tp1: nf(tps[0]), tp2: nf(tps[1]), tp3: nf(tps[2]), tp4: null, tp5: null,
    tpCount: 3, tpMode: p.tpMode || 'RISK_R',
    invalidLevel: isNum(p.invalidLevel) ? f(p.invalidLevel) : null,
    zone: p.zone ? (p.hybrid ? { min: f(p.zone.lo), max: f(p.zone.hi), label: p.zone.kind } : { min: f(p.entry), max: f(p.entry), label: p.zone.kind }) : null,
    zoneMode: p.hybrid ? 'range' : 'single',
    entryPrice: f(p.entry),
    zoneLabel: p.zone ? p.zone.kind : '',
    rr: 1, riskPips: p.riskPips ?? ctx.dp(risk / ctx.pip), pipDisplayScale: ctx.pipScale ?? 1,
    setup: p.setupType ? p.setupType.type : 'Unknown',
    setupLabel: p.setupType ? p.setupType.id : '',
    scenario: p.scenario ? p.scenario.id : 'SC-08',
    scenarioName: p.scenario ? p.scenario.name : 'Struktur Belum Jelas',
    scenarioWhy: p.scenario ? p.scenario.why : '',
    orderReason: p.orderReason || '',
    conviction: c, convictionLevel: lvl, confidence: lvl,
    risk: c >= 75 ? 'LOW' : c >= 55 ? 'MEDIUM' : 'HIGH',
    probability: prob.label, probabilityRange: prob, riskMultiplier: riskMult(c),
    session: p.sess ? p.sess.key : null, sessionLiq: p.sess ? p.sess.liq : null,
    biasMode: p.biasMode || 'HTF_LEAD', expiry: p.expiry || null,
    cancelDistPips: p.cancelDistPips || 50,
    hybrid: !!p.hybrid,
    forced: !!p.forced, symbol: ctx.symbol, style, role: 'main',
    createdAt: Date.now(), lastTickAt: Date.now(),
    filledAt: p.type === 'MARKET' ? Date.now() : null,
    expiresAt: p.expiresAt || Date.now() + (EXPMS[style] || 18e5),
    entryMode: p.type === 'MARKET' ? 'NOW' : 'PULLBACK', entryNote: p.note || null,
    tpHits: [], tpHitCount: 0, maxTpHit: 0, be: false, slBe: null,
    checklist: [], reason: '', reasons: { id: '', en: '' },
  };
  s.chart = buildChart(s, ctx.pip, ctx.dp, f, style);
  return s;
}
function standby(ctx, style, why, steps = []) {
  return {
    signal: { signal: 'NONE', status: 'STANDBY', state: 'STANDBY', orderType: 'NONE', symbol: ctx.symbol, style, entry: null, sl: null, tp1: null, tp2: null, tp3: null, tp4: null, tp5: null, tpCount: 0, checklist: steps.map(s => s.tf + ': ' + s.text), reason: '', reasons: { id: '', en: '' } },
    facts: { symbol: ctx.symbol, style, status: 'STANDBY', why, steps, dec: ctx.dec, price: ctx.f(ctx.price) },
  };
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
          body: JSON.stringify({ model: m, max_tokens: 700, temperature: 0.1, messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(obj) }] }),
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

async function aiVisionImg(sys, text, dataUrl, ms) {
  if (!VIS_KEY) return null;
  try {
    const r = await httpJson(AI_BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + VIS_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VIS_MODEL, max_completion_tokens: 900, temperature: 0,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: dataUrl } }] },
        ],
      }),
    }, ms);
    if (!r || !r.ok) return null;
    let txt = String(r.data?.choices?.[0]?.message?.content || '');
    txt = txt.replace(/```(?:json)?/gi, '').replace(/```/g, '');
    const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(txt.slice(a, b + 1)); } catch {} }
  } catch {}
  return null;
}

const SYS_HYB = `Anda analis trading XAUUSD/BTCUSD membaca gambar chart 3 panel bertumpuk (HTF/MTF/LTF) dengan gridline harga ber-label, zona transparan, dan garis kolam likuiditas ber-label. Keluarkan SATU sinyal.
ATURAN:
1. Wajib pilih BUY atau SELL (dilarang HOLD/WAIT). Choppy/tipis → tetap pilih, conviction LOW.
2. Wajib pilih NOW atau LIMIT: NOW bila harga sudah di titik reaksi/momentum LTF berjalan; LIMIT bila harga belum menyentuh zona terukur agar SL/R:R efisien.
3. Baca level entry & SL PRESISI dari label gridline/zona pada gambar. SL di balik invalidasi struktur (di luar zona/swing/kolam likuiditas), jangan di tengah noise.
4. Klasifikasi setup: Supply & Demand | Reversal | Kontinuitas | Fakeout/Trap | Retest BOS | Ranging Edge | Struktur Belum Jelas.
5. Conviction 0-100: HTF&zona 0-30, struktur&likuiditas&setup 0-30, trigger&R:R 0-25, sesi&volatilitas 0-15. Jangan berlebihan.
6. Jika HTF dan MTF berlawanan → conviction kecil (counter-trend). Jika HTF stale/tanpa displacement → jangan klaim Kontinuitas.
7. TIDAK perlu mengeluarkan TP (sistem yang mengatur TP, maksimal TP1/TP2/TP3).
Balas HANYA JSON: {"signal":"BUY|SELL","orderType":"NOW|LIMIT","entry":0,"sl":0,"zoneLow":0,"zoneHigh":0,"setup":"...","conviction":0,"perPanel":["HTF: ...","MTF: ...","LTF: ..."],"reason":"2-3 kalimat ID","reasonEn":"2-3 kalimat EN"}`;

function guardVision(v, ctx, style, b, live) {
  if (!v || (v.signal !== 'BUY' && v.signal !== 'SELL')) return null;
  const dir = v.signal === 'BUY' ? 1 : -1;
  let entry = Number(v.entry), sl = Number(v.sl);
  if (!Number.isFinite(entry) || !Number.isFinite(sl) || entry <= 0 || sl <= 0) return null;
  const ot = String(v.orderType || '').toUpperCase() === 'LIMIT' ? 'LIMIT' : 'MARKET';
  if (ot === 'LIMIT') {
    const okSide = dir === 1 ? entry < live : entry > live;
    const dist = Math.abs(live - entry) / ctx.pip;
    if (!okSide) return null;
    if (dist > (PROX[style] || 50) * 2) return null;
  } else if (Math.abs(entry - live) / ctx.pip > 8) entry = live;
  const wrongSide = dir === 1 ? sl >= entry : sl <= entry;
  if (wrongSide) return null;
  let slDist = Math.abs(entry - sl) / ctx.pip;
  const minSL = Math.max(20, (b.min / ctx.pip) * 0.6);
  const maxSL = (b.max / ctx.pip) * 1.3;
  if (slDist < minSL) { sl = entry - dir * minSL * ctx.pip; slDist = minSL; }
  if (slDist > maxSL) { sl = entry - dir * maxSL * ctx.pip; slDist = maxSL; }
  let conv = Math.round(Number(v.conviction));
  if (!Number.isFinite(conv)) conv = 50;
  conv = Math.max(0, Math.min(100, conv));
  return {
    dir, entry, sl, ot, conv,
    setup: String(v.setup || ''),
    zoneLow: isNum(v.zoneLow) ? Number(v.zoneLow) : null,
    zoneHigh: isNum(v.zoneHigh) ? Number(v.zoneHigh) : null,
    perPanel: Array.isArray(v.perPanel) ? v.perPanel.map(String).slice(0, 3) : [],
    reason: String(v.reason || ''), reasonEn: String(v.reasonEn || v.reason || ''),
  };
}

const SYS_BOT = `Anda mentor bot scalper. Engine sudah memutuskan setup. Salin angka PERSIS. Tulis 2-3 kalimat: skenario, entry+SL, alasan NOW/LIMIT, conviction. Tanpa bullet.
Balas HANYA JSON: {"id":"...","en":"..."}`;

async function reasonManual(f) {
  if (f.status === 'STANDBY') return { id: buildReason(f, false), en: buildReason(f, true), ai: false };
  if (f.vReason) {
    return {
      id: buildReason(f, false) + '\n• Catatan: ' + f.vReason,
      en: buildReason(f, true) + '\n• Note: ' + (f.vReasonEn || f.vReason),
      ai: true,
    };
  }
  return { id: buildReason(f, false), en: buildReason(f, true), ai: false };
}
async function reasonBot(f) {
  const tp = [f.tp1, f.tp2, f.tp3].filter(isNum).map(Number).join(', ');
  const id = f.status === 'STANDBY' ? 'Bot memantau ' + f.symbol + '.' : 'Bot ' + f.signal + ' @ ' + f.entry + ', SL ' + f.sl + ', TP ' + tp + '.';
  const en = f.status === 'STANDBY' ? 'Bot scanning ' + f.symbol + '.' : 'Bot ' + f.signal + ' at ' + f.entry + ', SL ' + f.sl + ', TP ' + tp + '.';
  const j = await aiJson(SYS_BOT, f, 8000);
  if (j && typeof j.id === 'string' && typeof j.en === 'string') return { id: j.id, en: j.en, ai: true };
  return { id, en, ai: false };
}

async function runManual(ctx, d, style) {
  const role = TF_ROLE[style] || TF_ROLE.Scalping;
  const slRef = SL_REF[style] || SL_REF.Scalping;
  const plan = TP_PLAN[style] || TP_PLAN.Scalping;
  const prox = PROX[style] || 50;
  const cl = {};
  for (const tf of ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1']) {
    let rows = closed(d[tf], TFMS[tf]);
    if (tf === 'm1' && rows.length >= 10) {
      const atrM5Ref = atr(d.m5 && d.m5.length >= 14 ? d.m5 : rows) || ctx.pip * 10;
      rows = sanitizeCandles(rows, atrM5Ref, 4);
    }
    cl[tf] = rows;
  }

  const sess = sessionOf(Date.now(), ctx.symbol);
  const mtfRows = cl[role.mtf];
  const ltfRows = cl[role.ltf];
  const slRows = cl[slRef.atrTf] || ltfRows;

  const atrStruct = atr(mtfRows) || ctx.pip * 10;
  const atrSlNow = sessionAtr(slRows, sess, ctx.symbol) || atr(slRows) || ctx.pip * 10;
  const atrSlBase = sessionAtr(slRows.slice(0, Math.max(15, slRows.length - 10)), sess, ctx.symbol) || atr(slRows.slice(0, Math.max(15, slRows.length - 10))) || atrSlNow;
  const atrUse = atrSanity(atrSlNow, atrSlBase);
  const vol = volatilityRegime(atrSlNow, atrSlBase, sess);

  const ht = internal(cl[role.htf]);
  const it = internal(cl[role.mtf]);
  const lt = internal(cl[role.ltf]);

  const H = role.htf.toUpperCase(), M = role.mtf.toUpperCase(), L = role.ltf.toUpperCase();
  const allZones = dedupeZones([
    ...zonesFromRows(cl[role.htf], H, ctx, style),
    ...zonesFromRows(cl[role.mtf], M, ctx, style),
    ...zonesFromRows(cl[role.ltf], L, ctx, style),
    ...gaps(ltfRows).map(g => ({ ...g, tf: L })),
  ]);
  const nearZones = allZones.filter(z => {
    const inside = ctx.price >= z.lo && ctx.price <= z.hi;
    const dd = (z.lo >= ctx.price ? z.lo - ctx.price : ctx.price - z.hi) / ctx.pip;
    return inside || dd <= prox * 2;
  }).slice(0, 4);

  const pools = findPools(mtfRows, ctx, cl.d1);
  const whipsaw = doubleSweep(pools, ltfRows, ctx);
  const aheadPool = pools.filter(x => x.ahead).sort((a, b) => a.distPip - b.distPip)[0];
  const verdict = aheadPool ? sweepVsBreak(aheadPool.price, aheadPool.side, ltfRows, ctx) : { verdict: 'NONE' };

  const b = bounds(ctx.price, ctx, style);
  const htEff = (ht.fresh || ht.displaced) ? ht : { ...ht, weak: true };
  let bias = resolveBias({ ht: htEff, it, lt, zones: allZones, ctx, style, atrM15: atrStruct, slPips: b.min / ctx.pip });
  const guard = counterGuard(bias, b.min / ctx.pip);
  if (!guard.ok) bias = resolveBias({ ht: htEff, it, lt, zones: allZones, ctx, style, atrM15: atrStruct, slPips: b.min / ctx.pip, allowCounter: false });

  const aRange = asianRange(ltfRows, ctx.symbol);
  const sessSweep = (sess.key === 'LONDON_KZ' || sess.key === 'NY_AM_KZ') ? asianSweep(ltfRows, aRange, ctx) : null;

  let dir = bias.dir;
  if (sessSweep) dir = sessSweep.dir;
  else if (verdict.verdict === 'SWEEP' || verdict.verdict === 'BREAK') dir = verdict.dir;

  const pd = getPDZone(mtfRows, 60);
  const rg = ranging(mtfRows, 30, M);
  let rangeBound = NaN;
  if (rg && sess.mode === 'RANGE') { dir = rg.pos >= 0.5 ? -1 : 1; rangeBound = dir === 1 ? rg.lo : rg.hi; }

  let chosen = chooseBestZone(ctx, ht, it, lt, allZones.filter(z => z.side === (dir === 1 ? 'demand' : 'supply')), style);
  if (!chosen) chosen = synthesizeZone(ctx, dir, style, ltfRows);

  const steps = [];
  steps.push({ tf: 'Sesi', text: sess.key + ' (' + sess.wib + ') liq ' + sess.liq + 'x', textEn: sess.key + ' liq ' + sess.liq + 'x' });
  steps.push({ tf: H, text: dw(ht.dir) + ' ' + (ht.ev || '-') + (ht.fresh ? ' fresh' : ' stale') + (ht.displaced ? ' +displacement' : ' TANPA displacement'), textEn: dw(ht.dir) + ' ' + (ht.ev || '-') });
  steps.push({ tf: M, text: dw(it.dir) + ' ' + (it.ev || '-') + (it.fresh && it.displaced ? ' valid' : ''), textEn: dw(it.dir) + ' ' + (it.ev || '-') });
  steps.push({ tf: L, text: dw(lt.dir) + ' ' + (lt.ev || '-') + (lt.fresh ? ' fresh' : ''), textEn: dw(lt.dir) + ' ' + (lt.ev || '-') });
  if (whipsaw) steps.push({ tf: 'Whipsaw', text: 'Double sweep — kemungkinan news. Risk 0.25x.', textEn: 'Double sweep — news whipsaw.' });
  if (bias.mode === 'LTF_COUNTER') steps.push({ tf: 'LTF Dinamis', text: 'LTF memimpin counter-HTF, penalti -' + bias.penalty, textEn: 'LTF leads counter-HTF.' });

  // FORCED BINARY: WAJIB BUY/SELL, dilarang standby karena struktur
  const ltfMonRows0 = cl[LTF_TF[style] || role.ltf] || ltfRows;
  const healthOf = ddir => {
    const mon = monitorLTFStructure(ltfMonRows0, ddir, ctx, style);
    let h = mon.confidence;
    if (lt.dir === ddir) h += 15;
    if (it.dir === ddir) h += 10;
    if (ht.dir === ddir) h += 8;
    return { mon, h };
  };
  const hCur = healthOf(dir);
  const hOpp = healthOf(-dir);
  let forcedWeak = false;
  if (!hCur.mon.valid && hOpp.h > hCur.h) {
    dir = -dir;
    if (rg) rangeBound = dir === 1 ? rg.lo : rg.hi;
    chosen = chooseBestZone(ctx, ht, it, lt, allZones.filter(z => z.side === (dir === 1 ? 'demand' : 'supply')), style) || synthesizeZone(ctx, dir, style, ltfRows);
    steps.push({ tf: 'Arah', text: 'Arah dibalik ke ' + (dir === 1 ? 'BUY' : 'SELL') + ': struktur LTF arah semula rusak (' + hCur.mon.reason + ').', textEn: 'Direction flipped: original LTF structure broken (' + hCur.mon.reason + ').' });
  } else if (!hCur.mon.valid) {
    forcedWeak = true;
    steps.push({ tf: 'Arah', text: 'Struktur LTF kedua arah lemah — sinyal tetap dipaksa (FORCED BINARY) dengan conviction dikunci LOW, risk 0.25x.', textEn: 'Both directions weak — forced binary signal locked LOW, 0.25x.' });
  }
  const mon0 = healthOf(dir).mon;

  const p = { dir, _style: style, entry: ctx.price, sl: ctx.price, type: 'LIMIT', zone: chosen ? chosen.z : null };
  const pool = [];
  if (chosen) pool.push(chosen.z);
  for (const z of nearZones) if (z.side === (dir === 1 ? 'demand' : 'supply') && !pool.some(k => k.lo === z.lo && k.hi === z.hi)) pool.push(z);

  const ez = findEntryZone(ctx, p, pool, ltfRows);
  p.entry = ez.lim; p.zone = ez.z;
  if (p.type !== 'MARKET') {
    const okSide = dir === 1 ? p.entry <= ctx.price : p.entry >= ctx.price;
    if (!okSide) p.entry = ctx.price;
  }
  p.zone = coupleZone(p.zone, p.entry, p.dir, ctx.pip, atrUse);

  const struct = swingLevel(cl[slRef.swingTf] || ltfRows, p.dir, slRef.win);
  const slp = slBeyondPool(pools, p.dir, p.entry, ctx, atrUse);
  let rr = calcSL({ entry: p.entry, dir: p.dir, ctx, b, sess, atrUse, structLevel: sessSweep ? sessSweep.extreme : struct, poolLevel: slp ? slp.pool.price : NaN, rangeBound, tfKey: slRef.atrTf });
  p.sl = rr.sl; p.riskPips = rr.riskPips; p.slCapped = rr.capped;
  p.invalidLevel = slp ? slp.level : (sessSweep ? sessSweep.extreme : struct);
  let slReason = slp ? 'di luar kolam ' + slp.pool.type + ' + buffer' : (sessSweep ? 'di balik titik sweep' : 'di luar swing ' + slRef.swingTf.toUpperCase());

  const ltfMonRows = cl[LTF_TF[style] || role.ltf] || ltfRows;
  const psl = calculatePreciseSL(p.entry, p.dir, ltfMonRows, ctx, 1.5);
  if (psl && psl.distancePips >= 20 && psl.distancePips < rr.riskPips) {
    p.sl = psl.sl; p.riskPips = ctx.dp(psl.distancePips); p.slCapped = false; slReason = psl.reason;
  }

  const reject = rejectionAt(ctx, ltfRows, p.dir);
  const momentum = !!(lt.fresh && lt.dir === p.dir);
  const preNews = vol.regime === 'SPIKE';
  let scenario = detectScenario({ ht, it, lt, chosen, verdict: verdict.verdict, sweepSess: sessSweep, rg, biasMode: bias.mode, dir: p.dir, inside: ez.inside, distPip: ez.distPip, momentum, preNews, sess });
  const ord = decideOrderType(scenario, { inside: ez.inside, distPip: ez.distPip, reject, momentum, preNews, sess, ltfConfidence: mon0.confidence });
  p.type = ord.type;
  if (p.type === 'MARKET') p.entry = ctx.price;
  p.orderReason = ord.reason;
  p.scenario = scenario;
  p.cancelDistPips = cancelTolerance(p.riskPips, prox);

  const draw = nearestDraw(pools, p.dir, ctx);
  let fin = planTPs({ style, entry: p.entry, dir: p.dir, risk: rr.need, pip: ctx.pip, wall: bias.wall, draw, dp: ctx.dp });
  let rrPenalty = 0;
  const runwayTooTight = Number.isFinite(fin.runwayPip) && fin.runwayPip < rr.riskPips;
  if (!fin.tps || runwayTooTight) {
    if (!fin.tps) fin = { tps: buildTPs(p.entry, p.dir, rr.need), count: 3, mode: 'RISK_R', pips: [], rr1: 1, poorRR: true, runwayPip: null };
    else rrPenalty += 6;
  }
  p.tps = fin.tps; p.tpCount = 3; p.tpMode = fin.mode;
  p.tpCapped = fin.mode !== 'RISK_R' && fin.mode !== 'FIXED_PIP';
  if (fin.poorRR) rrPenalty += 8;
  if (rr.structMismatch) rrPenalty += 6;
  if (rr.atrOverflow) rrPenalty += 8;

  let setupType = { type: scenario.name, id: scenario.why, en: scenario.why };

  let c1 = 0;
  if (ht.dir === p.dir) c1 += 20; else if (ht.dir === 0) c1 += 8; else c1 += 4;
  if (chosen && chosen.width >= 20 && chosen.width <= 80) c1 += 10; else if (chosen && chosen.width >= 15) c1 += 5;
  c1 = Math.min(30, c1);
  let c2 = 0;
  const stMap = { 'Kontinuitas Pullback': 22, 'Retest BOS': 22, 'Fakeout / Trap': 18, 'Reversal Sweep': 18, 'Ranging Edge': 16, 'Breakout Impulse': 20, 'LTF Momentum (counter-HTF)': 12, 'Struktur Belum Jelas': 6 };
  c2 += stMap[scenario.name] || 5;
  if (it.fresh && it.displaced && it.dir === p.dir) c2 += 4;
  if (verdict.verdict === 'SWEEP' && (sess.key === 'LONDON_KZ' || sess.key === 'NY_AM_KZ')) c2 += 4;
  if (pools.some(x => x.strength >= 5 && x.state === 'VIRGIN' && x.ahead)) c2 += 4;
  c2 = Math.min(30, c2);
  let c3 = 0;
  if (lt.dir === p.dir) c3 += 12;
  if (lt.fresh) c3 += 6;
  if (reject) c3 += 4;
  if (!rr.capped) c3 += 3;
  c3 = Math.min(25, c3);
  let c4 = sessionScore(sess, scenario.name === 'Fakeout / Trap' ? 'SWEEP' : (rg ? 'RANGE' : 'TREND'));
  c4 -= vol.penalty;
  c4 = Math.max(0, Math.min(15, c4));

  let conv = c1 + c2 + c3 + c4 - rrPenalty;
  const adj = adjustConviction(conv, bias, p.tps.filter(isNum), p.entry, p.dir);
  conv = adj.conviction;
  if (whipsaw || sess.mode === 'AVOID' || vol.regime === 'SPIKE') conv = Math.min(conv, 54);
  if (ht.dir === 0 && sess.key === 'ASIA') conv = Math.min(conv, 35);
  const htfWeak = !(ht.fresh || ht.displaced);
  const mixedStructure = htfWeak && it.dir !== 0 && lt.dir !== 0 && it.dir !== lt.dir;
  if (mixedStructure || scenario.name === 'Struktur Belum Jelas') {
    conv = Math.min(conv, 54);
    steps.push({ tf: 'Struktur', text: 'Struktur bercampur = choppy: conviction dibatasi LOW, risk 0.25x.', textEn: 'Mixed structure = choppy: capped LOW, 0.25x.' });
  } else if (it.dir !== 0 && it.dir !== p.dir) {
    conv -= 10;
    steps.push({ tf: 'Struktur', text: 'MTF (' + (it.ev || '-') + ') berlawanan arah sinyal = counter-trend: conviction -10.', textEn: 'MTF opposes = counter-trend: -10.' });
  }
  if (forcedWeak) conv = Math.min(conv, 45);
  p.conviction = Math.max(0, Math.min(100, Math.round(conv)));
  p.setupType = setupType;
  p.sess = sess;
  p.biasMode = bias.mode;

  // HYBRID VISION: render → vision → guardrail → override
  let hybrid = null;
  if (HYBRID && VIS_KEY) {
    const lastMt = mtfRows.length ? mtfRows[mtfRows.length - 1].t : 0;
    const vKey = ctx.symbol + '|' + style + '|' + lastMt + '|' + Math.round(ctx.price / (ctx.pip * 5));
    const vHit = visionCache.get(vKey);
    if (vHit && Date.now() - vHit.t < 90000) hybrid = vHit.v;
    else {
      const poolLines = pools.filter(x => x.strength >= 4 || x.ahead).sort((a, b2) => b2.strength - a.strength).slice(0, 4).map(x => ({ price: x.price, label: x.type }));
      const img = renderSignalChart({
        dec: ctx.dec, live: ctx.price,
        panels: [
          { label: H + ' HTF', rows: cl[role.htf].slice(-90), zones: nearZones.filter(z => z.tf === H), pools: [] },
          { label: M + ' MTF', rows: cl[role.mtf].slice(-90), zones: nearZones.filter(z => z.tf === M), pools: poolLines },
          { label: L + ' LTF', rows: cl[role.ltf].slice(-70), zones: nearZones.filter(z => z.tf === L), pools: [] },
        ],
      });
      const text = 'Aset ' + ctx.symbol + ', gaya ' + style + '. Harga live ' + ctx.f(ctx.price) + '. Sesi ' + sess.key + ' (' + sess.wib + ') liq ' + sess.liq + 'x. ATR ' + slRef.atrTf.toUpperCase() + ' ' + ctx.dp(atrUse / ctx.pip) + ' pip. Gambar: 3 panel bertumpuk HTF/MTF/LTF, gridline harga ber-label, zona = kotak transparan, kolam = garis putus ber-label. Tentukan SATU sinyal sesuai aturan.';
      let raw = await aiVisionImg(SYS_HYB, text, img, 25000);
      hybrid = guardVision(raw, ctx, style, b, ctx.price);
      if (!hybrid && raw) {
        const raw2 = await aiVisionImg(SYS_HYB, text + '\nKOREKSI: jawaban sebelumnya melanggar guardrail (sisi order/SL/jarak). Perbaiki dan balas JSON lagi.', img, 20000);
        hybrid = guardVision(raw2, ctx, style, b, ctx.price);
      }
      visionCache.set(vKey, { t: Date.now(), v: hybrid });
      if (visionCache.size > 120) visionCache.delete(visionCache.keys().next().value);
    }
  }

  if (hybrid) {
    p.dir = hybrid.dir;
    p.entry = hybrid.ot === 'MARKET' ? ctx.price : hybrid.entry;
    p.sl = hybrid.sl;
    p.type = hybrid.ot;
    p.riskPips = ctx.dp(Math.abs(p.entry - p.sl) / ctx.pip);
    p.invalidLevel = p.sl;
    p.zone = coupleZone(hybrid.zoneLow != null && hybrid.zoneHigh != null ? { lo: Math.min(hybrid.zoneLow, hybrid.zoneHigh), hi: Math.max(hybrid.zoneLow, hybrid.zoneHigh), kind: 'Zona Vision', tf: M } : p.zone, p.entry, p.dir, ctx.pip, atrUse);
    p.orderReason = hybrid.ot === 'MARKET' ? 'NOW: reaksi/momentum aktif terkonfirmasi vision.' : 'LIMIT: harga belum di zona terukur (vision).';
    slReason = 'level invalidasi vision di balik struktur';
    const wall = nearestWall(ctx, p.dir, allZones, role.htf, role.mtf);
    const draw2 = nearestDraw(pools, p.dir, ctx);
    let fin2 = planTPs({ style, entry: p.entry, dir: p.dir, risk: Math.abs(p.entry - p.sl), pip: ctx.pip, wall, draw: draw2, dp: ctx.dp });
    if (!fin2.tps) fin2 = { tps: buildTPs(p.entry, p.dir, Math.abs(p.entry - p.sl)), count: 3, mode: 'RISK_R', pips: [], rr1: 1, poorRR: false, runwayPip: null };
    p.tps = fin2.tps; p.tpCount = 3; p.tpMode = fin2.mode;
    p.tpCapped = fin2.mode !== 'RISK_R' && fin2.mode !== 'FIXED_PIP';
    let conv2 = hybrid.conv;
    const htfWeak2 = !(ht.fresh || ht.displaced);
    const mixed2 = htfWeak2 && it.dir !== 0 && lt.dir !== 0 && it.dir !== lt.dir;
    if (mixed2 || /struktur belum jelas/i.test(hybrid.setup)) conv2 = Math.min(conv2, 54);
    if (it.dir !== 0 && it.dir !== p.dir) conv2 -= 10;
    if (whipsaw || sess.mode === 'AVOID' || vol.regime === 'SPIKE') conv2 = Math.min(conv2, 54);
    if (ht.dir === 0 && sess.key === 'ASIA') conv2 = Math.min(conv2, 35);
    if (forcedWeak) conv2 = Math.min(conv2, 45);
    if (Number.isFinite(fin2.runwayPip) && fin2.runwayPip < p.riskPips) conv2 -= 6;
    p.conviction = Math.max(0, Math.min(100, Math.round(conv2)));
    scenario = setupToScenario(hybrid.setup);
    p.scenario = scenario;
    setupType = { type: hybrid.setup || scenario.name, id: scenario.why, en: scenario.why };
    p.setupType = setupType;
    p.hybrid = true;
    p.vReason = hybrid.reason; p.vReasonEn = hybrid.reasonEn; p.perPanel = hybrid.perPanel;
    steps.push({ tf: 'Vision Hybrid', text: 'Sinyal diputus vision-model dari chart render: ' + (hybrid.setup || scenario.name) + '.', textEn: 'Vision-model decided from rendered chart.' });
  }

  p.expiry = bias.mode === 'LTF_COUNTER' && !p.hybrid ? counterExpiry(style) : baseExpiry(style);
  if (p.type === 'LIMIT') {
    const byTime = Date.now() + p.expiry.minutes * 60000;
    p.expiresAt = Math.min(byTime, sess.nextBoundaryMs);
    p.expiry.id += ' Atau harga menjauh >' + p.cancelDistPips + ' pip dari entry.';
  }

  const tfSummary = (p.hybrid && p.perPanel && p.perPanel.length) ? p.perPanel : [
    H + ' ' + dw(ht.dir) + ' ' + (ht.ev || '-') + (ht.fresh ? ' fresh' : ' stale') + (ht.displaced ? ' +displacement' : ' TANPA displacement'),
    M + ' ' + dw(it.dir) + ' ' + (it.ev || '-') + (it.fresh && it.displaced ? ' valid' : ''),
    L + ' ' + dw(lt.dir) + ' ' + (lt.ev || '-') + (lt.fresh ? ' fresh' : ''),
  ];
  steps.push({ tf: 'Entry', text: p.orderReason, textEn: p.orderReason });
  steps.push({ tf: 'SL', text: ctx.f(p.sl) + ' (' + p.riskPips + ' pip) — ' + slReason, textEn: slReason });
  steps.push({ tf: 'Conviction', text: p.conviction + '/100 → ' + (p.conviction >= 75 ? 'HIGH' : p.conviction >= 55 ? 'MEDIUM' : 'LOW') + ' · Risk ' + riskMult(p.conviction) + 'x · Prob ' + estimateProbability(p.conviction).label, textEn: p.conviction + '/100' });
  if (p.type === 'LIMIT') steps.push({ tf: 'Expiry', text: p.expiry.id, textEn: p.expiry.en });

  const s = sigOf(p, ctx, style);
  const f = {
    symbol: ctx.symbol, style, status: s.status, signal: s.signal, orderType: s.orderType,
    entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: null, tp5: null,
    tpCount: 3, tpMode: s.tpMode, riskPips: s.riskPips, invalidLevel: s.invalidLevel,
    setup: setupType.type, scenarioName: scenario.name, scenarioWhy: scenario.why, scenarioId: scenario.id,
    orderReason: p.orderReason, tfSummary,
    conviction: p.conviction, convictionLevel: s.convictionLevel, probability: s.probability, riskMultiplier: s.riskMultiplier,
    session: sess.key, sessionWib: sess.wib, sessionLiq: sess.liq, volRegime: vol.regime,
    premiumDiscount: pd ? ((ctx.price - pd.lo) / pd.range >= 0.5 ? 'premium' : 'discount') : null,
    slReason, cancelDistPips: p.cancelDistPips, biasMode: p.biasMode, whipsaw: !!whipsaw,
    liquidity: aheadPool ? aheadPool.type + ' ' + verdict.verdict : 'none',
    vReason: p.vReason || '', vReasonEn: p.vReasonEn || '',
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
      if (ict && ict.status === 'limit') r = { ok: true, dir: ict.dir === 'BUY' ? 1 : -1, entry: ict.entry, sl: ict.sl, orderType: 'LIMIT', tier: 'ICT_POI', trigger: 'POI M15', bias: 'M15 ' + ict.dir };
    } catch {}
  }
  if (!r || !r.ok) return standby(ctx, 'Scalping', (r && r.reason) || 'Menunggu setup bot.');
  const risk = Math.abs(Number(r.entry) - Number(r.sl)) || bounds(Number(r.entry), ctx, 'Scalping').min;
  const p = { dir: r.dir, entry: num(r.entry, ctx.price), sl: num(r.sl, ctx.price), type: r.orderType || 'MARKET', tps: buildTPs(Number(r.entry), r.dir, risk), tpCount: 3, riskPips: ctx.dp(risk / ctx.pip), conviction: 60, setupType: { type: 'Supply & Demand', id: 'Bot ICT POI' }, scenario: SCENARIOS.RETEST_BOS, orderReason: 'LIMIT di POI M15.', cancelDistPips: 60, steps: [], zone: null };
  const s = sigOf(p, ctx, 'Scalping');
  s.style = 'scalperbot'; s.tier = r.tier || 'EA'; s.expiresAt = Date.now() + 9e5;
  const f = { symbol: ctx.symbol, style: 'scalperbot', status: s.status, signal: s.signal, orderType: s.orderType, entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: null, tp5: null, trigger: r.trigger || null, bias: r.bias || 'netral', dec: ctx.dec, price: ctx.f(ctx.price), conviction: 60, convictionLevel: 'MEDIUM', probability: '55%', riskMultiplier: 0.65, setup: 'Supply & Demand', scenarioName: 'Retest BOS', orderReason: 'LIMIT di POI M15.', cancelDistPips: 60, tfSummary: ['M15/M5/M1 searah POI'] };
  return { signal: s, facts: f };
}

function lifecycle(prev, sym, style, price, pip, data) {
  if (!prev || typeof prev !== 'object' || prev.symbol !== sym || prev.style !== style) return null;
  if (prev.signal !== 'BUY' && prev.signal !== 'SELL') return null;
  if (prev.status === 'TP3_HIT' || prev.finished) return null;
  const exp = Number(prev.expiresAt);
  if (!Number.isFinite(exp) || Date.now() > exp) return { dead: true, out: 'EXPIRED', prev };
  const dir = prev.signal === 'BUY' ? 1 : -1;
  const sl = Number(prev.sl), e = Number(prev.entry);
  if (![sl, e].every(Number.isFinite) || sl === e) return null;
  const risk0 = Math.abs(e - sl);
  const plan = TP_PLAN[prev.style] || TP_PLAN.Scalping;
  const rawT = [prev.tp1, prev.tp2, prev.tp3].map(v => (isNum(v) ? Number(v) : NaN));
  const t = [0, 1, 2].map(i => {
    if (i >= plan.count) return NaN;
    const v = rawT[i];
    if (Number.isFinite(v) && v !== e && v !== 0) return v;
    const base = plan.mode === 'PIP' ? plan.targets[i] * pip : risk0 * plan.targets[i];
    return e + dir * base;
  });
  if (!Number.isFinite(t[0])) return null;

  if (prev.status === 'PENDING') {
    const ltfRowsM = clean((data && data[LTF_TF[prev.style] || 'm5']) || []);
    const mon = monitorLTFStructure(ltfRowsM, dir, { pip, f: v => v }, prev.style);
    if (!mon.valid) {
      return { dead: true, out: 'LTF_REVERSAL', prev, patch: { lastTickAt: Date.now(), status: 'CANCELLED', state: 'LTF_REVERSAL' } };
    }
  }

  const tfKey = style === 'scalperbot' ? 'm1' : (TF_ROLE[prev.style] || TF_ROLE.Scalping).ltf;
  const ms = TFMS[tfKey] || 3e5;
  const rows = clean((data && data[tfKey]) || []);
  const start = Number(prev.lastTickAt) || Number(prev.createdAt) || Date.now();
  let win = rows.filter(c => tsMs(c.t) + ms > start && tsMs(c.t) <= Date.now());
  if (!win.length) win = [{ t: Date.now(), h: price, l: price, c: price }];
  let filled = prev.status !== 'PENDING' || Number(prev.filledAt) > 0;
  let filledAt = Number(prev.filledAt) || 0;
  const hits = new Set(Array.isArray(prev.tpHits) ? prev.tpHits.filter(n => n <= 3) : []);
  let be = !!prev.be || hits.has(1);
  let dead = null;
  const lastIdx = 3;
  const cancelDist = Number(prev.cancelDistPips) || 50;
  for (const c of win) {
    if (!filled) {
      const away = dir === 1 ? (c.h - e) : (e - c.l);
      if (away / pip > cancelDist) { dead = { out: 'CANCELLED' }; break; }
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
  if (dead && dead.out === 'TPMAX') return { dead: true, out: 'TP3', prev, patch: { ...patch, status: 'TP3_HIT', state: 'TP3', finished: true } };
  if (dead) return { dead: true, out: dead.out, prev, patch };
  let status, state;
  if (!filled) { status = 'PENDING'; state = 'LIMIT_PLACED'; }
  else if (maxHit >= 1) { status = 'TP' + maxHit + '_HIT'; state = 'TP' + maxHit; }
  else { status = 'RUNNING'; state = filledAt ? 'FILLED' : 'CONFIRMED'; }
  return { dead: false, prev, patch: { ...patch, status, state } };
}

const SYS_VIS = 'Kamu analis S&D/OB dari gambar chart. Baca level PERSIS dari skala harga. Wajib BUY atau SELL kecuali gambar bukan chart. Prioritaskan LIMIT pullback; MARKET hanya bila harga sudah di zona dan ada penolakan. Sebutkan zona TF tinggi dan rendah pada perImageAnalyses. SL di luar distal zona/swing. Balas HANYA JSON: {"signal":"BUY","orderType":"LIMIT","entry":0,"sl":0,"tp1":0,"tp2":0,"tp3":0,"zoneLow":0,"zoneHigh":0,"zone":"Demand","pair":"","decimals":2,"perImageAnalyses":[],"perImageAnalysesEn":[],"reason":"","reasonEn":""}';

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
  const out = norm3TP({
    signal: sg, orderType: isLimit ? 'LIMIT' : 'MARKET', fill: isLimit ? 'LIMIT' : 'NOW',
    status: isLimit ? 'PENDING' : 'RUNNING', entryMode: isLimit ? 'PULLBACK' : 'NOW',
    symbol: sym, pair: sym, dec, pip, style, entry, sl,
    tp1: tps[0], tp2: tps[1], tp3: tps[2], tp4: null, tp5: null, tpCount: 3,
    zoneMode: 'range', entryPrice: entry,
    riskPips: Math.round((risk / pip) * pipScaleOf(sym)), pipDisplayScale: pipScaleOf(sym),
    tpHits: [], tpHitCount: 0, maxTpHit: 0, be: false, slBe: null,
    zone: { min: zl, max: zh, label: (j.zone || 'Zona') + ' ' + zl + '–' + zh },
    reason: lang === 'en' ? ren : rid, reasons: { id: rid, en: ren },
    reasonSource: 'AI', aiReasoning: true,
    createdAt: Date.now(), lastTickAt: Date.now(), filledAt: isLimit ? null : Date.now(),
    expiresAt: Date.now() + (EXPMS[style] || 18e5), source: 'VISION_AI',
  });
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
    let inc = clean((body.candles || {})[tf] ?? body[tf]);
    if (tf === 'm1' && inc.length >= 10) {
      const atrRef = atr(inc) || ctx.pip * 10;
      inc = sanitizeCandles(inc, atrRef, 4);
    }
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
  const enough = need.some(tf => (data[tf] || []).length >= Math.min(MINB[tf] || 25, 30));
  if (!enough) return res.status(200).json({ ok: false, reason: 'Data candle belum cukup.' });

  let out;
  try { out = isBot ? runBot(ctx, data) : await runManual(ctx, data, style); }
  catch (e) { console.error('[v219] engine error:', e.message, e.stack); out = standby(ctx, style, 'Engine error: ' + e.message); }
  if (!out || !out.signal) out = standby(ctx, style, 'Menunggu setup valid.');

  const key = symbol + '|' + style;
  const clientPrev = (body.prevSignal && typeof body.prevSignal === 'object') ? body.prevSignal : null;
  const storePrev = await loadSignal(symbol, style);
  const prev = pickPrev(clientPrev, storePrev);
  const restored = !clientPrev && !!storePrev;
  const life = lifecycle(prev, symbol, style, price, ctx.pip, data);
  if (life && life.prev) life.prev = norm3TP(repairTPs(life.prev, ctx.f, ctx.pip));
  if (life && life.dead) {
    await saveOutcome(key, { dir: life.prev.signal, out: life.out, t: Date.now() });
    await dropSignal(symbol, style);
  }
  if (life && life.dead && String(life.out).startsWith('TP') && life.patch && life.patch.finished) {
    const fin = norm3TP(repairTPs({ ...life.prev, ...life.patch, sticky: true, finished: true }, ctx.f, ctx.pip));
    if (!fin.reason && fin.reasons) fin.reason = lang === 'en' ? (fin.reasons.en || fin.reasons.id) : (fin.reasons.id || fin.reasons.en);
    return res.status(200).json({ ok: true, mode: isBot ? 'bot' : 'candles', symbol, style, price, signal: fin, diag: { version: VERSION, lifecycle: life.out, store: kvOn ? 'KV' : 'MEM' } });
  }
  if (life && !life.dead) {
    const managed = norm3TP(repairTPs({ ...life.prev, ...life.patch, sticky: true }, ctx.f, ctx.pip));
    const opp = out.signal.status !== 'STANDBY' && out.signal.signal !== managed.signal;
    if (!(body.forceNew && opp)) {
      await saveSignal(managed);
      // [v219] STICKY: pakai reason bawaan signal lama agar TEKS cocok dengan ANGKA di card
      if (!managed.reason && managed.reasons) managed.reason = lang === 'en' ? (managed.reasons.en || managed.reasons.id) : (managed.reasons.id || managed.reasons.en);
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
  const signal = norm3TP({ ...out.signal, reason: lang === 'en' ? story.v.en : story.v.id, reasons: { id: story.v.id, en: story.v.en }, reasonSource: f.vReason ? 'VISION_HYBRID' : (story.v.ai ? 'AI' : 'RULES'), aiReasoning: !!story.v.ai || !!f.vReason });
  if (signal.status !== 'STANDBY') await saveSignal(signal);
  return res.status(200).json({ ok: true, mode: isBot ? 'bot' : 'candles', symbol, style, price, signal, diag: { version: VERSION, status: signal.status, hybrid: !!signal.hybrid, session: f.session || null, liquidity: f.liquidity || null, biasMode: f.biasMode || null, conviction: f.conviction || 0, setup: f.setup || null, scenario: f.scenarioName || null, tpCount: signal.tpCount || 0, chartTf: signal.chart ? signal.chart.tf : null, spanPips: signal.chart ? signal.chart.range.spanPips : null, store: kvOn ? 'KV' : 'MEM' } });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-email');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ ok: true, version: VERSION, store: kvOn ? 'KV' : 'MEM', hybrid: HYBRID });
  if (req.method !== 'POST') return res.status(200).json({ ok: false, reason: 'Method not allowed' });
  try {
    let body = req.body || {};
    if (typeof body === 'string') body = JSON.parse(body);
    if (body.probe) return res.status(200).json({ ok: true, version: VERSION, store: kvOn ? 'KV' : 'MEM', hybrid: HYBRID });
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
