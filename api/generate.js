// api/generate.js — v176 compact (anti-500, phone-paste friendly)
import { checkAccess, markTrialBotUsed } from '../lib/access.js';
import { generateManualPlan, buildWatchlist, SYARAT_MASUK } from '../lib/manual_scalp.js';
import { planIntraday, planSwing, planScalping } from '../lib/mtf-engine.js';
import { planBot } from '../lib/bot-ict.js';
import { simpleZonePlan, scalpWatch } from '../lib/smc_flex.js';
import { runBotSma as runBotFlex } from '../lib/bot_3candle.js';

export const config = { maxDuration: 60 };
const VERSION = 'v176';
const TL_BASE = 'https://api.tickerlayer.com';
const AI_BASE = (process.env.QWEN_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/+$/, '');
const AI_KEYS = [process.env.QWEN_MANUAL_API_KEY, process.env.QWEN_API_KEY, process.env.QWEN_API_KEY_2, process.env.OPENAI_API_KEY].filter(Boolean);
const AI_MODELS = [process.env.QWEN_MANUAL_MODEL || 'qwen-4-max', process.env.QWEN_MODEL || 'deepseek-v4-flash'];
const VIS_MODEL = process.env.AI_VISION_MODEL || 'gpt-6-luna';
const VIS_KEY = process.env.OPENAI_API_KEY || AI_KEYS[0] || '';
const TL_KEYS = ['TICKERLAYER_API_KEY', ...Array.from({ length: 19 }, (_, i) => 'TICKERLAYER_API_KEY_' + (i + 1))].map(n => process.env[n] || '').filter(Boolean);
const DEC = { XAUUSD: 2, XAGUSD: 3, BTCUSD: 2, ETHUSD: 2, SOLUSD: 2, XRPUSD: 4, BNBUSD: 2, DXY: 2, US30: 2, NAS100: 2, SPX500: 2, GER40: 2, UK100: 2, JPN225: 0, EURUSD: 5, GBPUSD: 5, USDJPY: 3, AUDUSD: 5, USDCAD: 5, USDCHF: 5, NZDUSD: 5 };
const PIP = { XAUUSD: 0.1, BTCUSD: 1, DXY: 0.01, US30: 1, NAS100: 1 };
const pipOf = (s, d) => PIP[s] ?? Math.pow(10, -(d - 1));
const isGold = s => s === 'XAUUSD' || s === 'XAUUSDX';
const TFMS = { m1: 6e4, m5: 3e5, m15: 9e5, m30: 18e5, h1: 36e5, h4: 144e5, d1: 864e5 };
const TFIV = { m1: '1m', m5: '5m', m15: '15m', m30: '30m', h1: '1h', h4: '4h', d1: '1d' };
const TFSPAN = { m1: [1, 'minute', 1], m5: [5, 'minute', 5], m15: [15, 'minute', 15], m30: [30, 'minute', 30], h1: [1, 'hour', 60], h4: [4, 'hour', 240], d1: [1, 'day', 1440] };
const NEED = { Scalping: ['m1', 'm5', 'm15'], Intraday: ['m5', 'm15', 'h1', 'h4'], Swing: ['m15', 'h1', 'h4', 'd1'] };
const MINB = { m1: 60, m5: 40, m15: 40, m30: 35, h1: 35, h4: 25, d1: 20 };
const EXPMS = { Scalping: 18e5, Intraday: 288e5, Swing: 3456e5 };
const RULES = {
  Scalping: { gMin: 35, gMax: 50, bMin: 0.0025, bMax: 0.006, tps: [1, 1.5, 2, 3, 5] },
  Intraday: { gMin: 35, gMax: 100, bMin: 0.005, bMax: 0.012, tps: [1.5, 3, 5] },
  Swing: { gMin: 50, gMax: 300, bMin: 0.01, bMax: 0.025, tps: null },
};
const COOLDOWN = 3e5;
const cache = new Map();
const outcomes = new Map();
const stories = new Map();
const num = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
const tsMs = t => (t < 1e12 ? t * 1000 : t);
const closed = (c, ms) => (Array.isArray(c) && c.length && Date.now() < tsMs(c[c.length - 1].t) + ms ? c.slice(0, -1) : (c || []));
const iso = d => d.toISOString().slice(0, 10);

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
function nearestZone(list, ctx, dir, m5) {
  const a = atr(m5) || ctx.pip * 10;
  const want = dir === 1 ? 'demand' : 'supply';
  return list.filter(z => z.side === want)
    .filter(z => (dir === 1 ? z.hi <= ctx.price + 0.2 * a : z.lo >= ctx.price - 0.2 * a))
    .map(z => ({ ...z, d: dir === 1 ? ctx.price - z.hi : z.lo - ctx.price }))
    .sort((x, y) => x.d - y.d)[0] || null;
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
  const it = internal(bars);
  if (dir === 1) {
    if (Number.isFinite(it.swingLow)) cands.push(it.swingLow);
    for (const g of gaps(bars)) if (g.side === 'demand' && g.lo <= distal && g.lo >= distal - reach) cands.push(g.lo);
    const v = cands.filter(x => Number.isFinite(x) && x < p.entry);
    return v.length ? Math.min(...v) : NaN;
  }
  for (const g of gaps(bars)) if (g.side === 'supply' && g.hi >= distal && g.hi <= distal + reach) cands.push(g.hi);
  const v = cands.filter(x => Number.isFinite(x) && x > p.entry);
  return v.length ? Math.max(...v) : NaN;
}
function applyRisk(p, ctx, bars, style) {
  const r = RULES[style] || RULES.Scalping;
  const b = bounds(p.entry, ctx, style);
  const inv = invalidation(p, ctx, bars);
  const buf = 0.1 * (atr(bars) || ctx.pip * 10);
  const need = Math.max(Math.abs(p.entry - p.sl), Number.isFinite(inv) ? Math.abs(p.entry - inv) + buf : 0, b.min);
  if (need > b.max) return { reject: true, need: Math.round(need / ctx.pip), max: Math.round(b.max / ctx.pip), inv: Number.isFinite(inv) ? ctx.f(inv) : null };
  p.sl = p.entry - p.dir * need;
  if (Array.isArray(r.tps)) {
    p.tps = r.tps.slice(0, 3).map(m => p.entry + p.dir * need * m);
    p.tp4 = r.tps[3] != null ? p.entry + p.dir * need * r.tps[3] : null;
    p.tp5 = r.tps[4] != null ? p.entry + p.dir * need * r.tps[4] : null;
    p.rr = r.tps[0];
  }
  p.riskPips = Math.round(need / ctx.pip);
  if (Number.isFinite(inv)) p.invalidLevel = inv;
  return { reject: false, inv: Number.isFinite(inv) ? ctx.f(inv) : null };
}
function entryMode(ctx, p, it, lt, m5) {
  const zl = p.zone.lo, zh = p.zone.hi, w = zh - zl;
  const a = atr(m5) || ctx.pip * 10;
  const inside = ctx.price >= zl && ctx.price <= zh;
  const beyond = p.dir === 1 ? ctx.price < zl : ctx.price > zh;
  if (beyond) return { reject: true, note: 'Harga sudah menembus zona; menunggu zona baru.' };
  const ok = it.dir === p.dir && it.strong && lt.dir === p.dir;
  const prox = p.dir === 1 ? zh : zl;
  const dist = p.dir === 1 ? ctx.price - prox : prox - ctx.price;
  if (inside && ok) return { type: 'MARKET', entry: ctx.price, note: 'NOW: harga di dalam zona + internal M5 & M1 searah.' };
  if (!inside && ok && dist <= 0.3 * a) return { type: 'MARKET', entry: ctx.price, note: 'NOW: momentum searah dan harga dekat proximal zona.' };
  const lim = inside ? (p.dir === 1 ? Math.min(zl + 0.5 * w, ctx.price - 0.05 * a) : Math.max(zh - 0.5 * w, ctx.price + 0.05 * a)) : (p.dir === 1 ? zh - 0.4 * w : zl + 0.4 * w);
  return { type: 'LIMIT', entry: lim, note: 'LIMIT pullback @ ' + ctx.f(lim) + ': tunggu retest zona, bukan kejar harga.' };
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
    tpMode: 'RISK_R', setup: 'Manual ' + style, confidence: 'MEDIUM', risk: 'MEDIUM',
    symbol: ctx.symbol, style, role: 'main', createdAt: Date.now(),
    expiresAt: Date.now() + (EXPMS[style] || 18e5),
    entryMode: p.type === 'MARKET' ? 'NOW' : 'PULLBACK', entryNote: p.note || null,
    checklist: p.steps || [], reason: '', reasons: { id: '', en: '' },
  };
  if (Number.isFinite(Number(p.tp4))) s.tp4 = f(p.tp4);
  if (Number.isFinite(Number(p.tp5))) s.tp5 = f(p.tp5);
  return s;
}
function standby(ctx, style, why, steps) {
  return {
    signal: { signal: 'NONE', status: 'STANDBY', state: 'STANDBY', orderType: 'NONE', symbol: ctx.symbol, style, entry: null, sl: null, tp1: null, tp2: null, tp3: null, checklist: steps || [], reason: '', reasons: { id: '', en: '' } },
    facts: { symbol: ctx.symbol, style, status: 'STANDBY', why, steps: steps || [], dec: ctx.dec, price: ctx.f(ctx.price) },
  };
}
function layout(f, en, lines, setup) {
  return '[' + f.symbol + ' · ' + (en ? 'Multi-TF Analysis' : 'Analisa Multi-TF') + ' · ' + f.style + ']\n' + (lines || []).map(t => '• ' + t).join('\n') + '\n\n[Setup]\n' + setup;
}
function manualReason(f, en) {
  const lines = (f.steps || []).map(s => s.tf + ': ' + s.text);
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
          body: JSON.stringify({ model: m, max_tokens: 1200, temperature: 0.2, messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(obj) }] }),
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
const SYS_MTF = 'Kamu analis SMC. Jelaskan hasil scan multi-TF secara faktual. Salin angka PERSIS dari JSON, jangan mengarang. Untuk tiap item "steps" tulis maks 2 kalimat (struktur TF + zona terdekat). Lalu ringkasan setup 2-3 kalimat diawali nama pair: arah, tipe order, entry, SL, TP, dan alasan entryNote bila ada. Jika STANDBY jelaskan yang ditunggu dari "why". Balas HANYA JSON: {"perTfId":["M15: ..."],"perTfEn":["M15: ..."],"id":"...","en":"..."}';
const SYS_BOT = 'Kamu mentor bot scalper. Jelaskan alur bot dari JSON (bias, htf, m1, checklist, trigger) dalam paragraf 4-6 kalimat santai, salin angka persis, tanpa bullet. Balas HANYA JSON: {"id":"...","en":"..."}';
async function reasonManual(f) {
  const fb = { id: manualReason(f, false), en: manualReason(f, true), ai: false };
  const j = await aiJson(SYS_MTF, f, 9000);
  if (!j || typeof j.id !== 'string' || typeof j.en !== 'string') return fb;
  const li = Array.isArray(j.perTfId) ? j.perTfId.map(String) : (f.steps || []).map(s => s.tf + ': ' + s.text);
  const le = Array.isArray(j.perTfEn) ? j.perTfEn.map(String) : li;
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
  let plan = null;
  try {
    if (style === 'Intraday') plan = planIntraday({ h4: cl.h4, h1: cl.h1, m15: cl.m15, m5: cl.m5, price: ctx.price, sym: ctx.symbol, tNow: Date.now() });
    else if (style === 'Swing') plan = planSwing({ d1: cl.d1, h4: cl.h4, h1: cl.h1, m15: cl.m15, price: ctx.price, sym: ctx.symbol, tNow: Date.now() });
    else plan = planScalping({ m15: cl.m15, m5: cl.m5, m1: cl.m1, price: ctx.price, sym: ctx.symbol, tNow: Date.now() });
  } catch (e) { plan = null; }
  const steps = Array.isArray(plan && plan.steps) ? plan.steps.slice() : [];
  const okPlan = plan && plan.status === 'limit' && plan.zone && Number.isFinite(Number(plan.entry)) && Number.isFinite(Number(plan.sl));
  if (!okPlan) {
    if (style !== 'Scalping') return standby(ctx, style, (plan && plan.reason) || 'Menunggu setup MTF valid.', steps);
    const lz = simpleZonePlan({ m1: cl.m1, m5: cl.m5, m15: cl.m15, h1: cl.h1 }, { price: ctx.price, dec: ctx.dec, pip: ctx.pip, symbol: ctx.symbol }, { tfs: ['M5', 'M1'] });
    if (!lz || !lz.ok) return standby(ctx, style, (lz && lz.reason) || 'Belum ada zona M5 valid.', steps);
    const o = lz.order;
    plan = { status: 'limit', dir: o.side === 'buy' ? 'BUY' : 'SELL', entry: o.entryPrice, sl: o.sl, orderType: 'LIMIT', tps: [o.tp1, o.tp2, o.tp3], zone: { lo: lz.zone.bottom, hi: lz.zone.top, kind: lz.zone.type || 'Zona M5' }, steps: [{ tf: 'M5', text: o.reason }] };
  }
  const dir = plan.dir === 'BUY' ? 1 : -1;
  const tpsSrc = Array.isArray(plan.tps) && plan.tps.length >= 3 ? plan.tps : [plan.entry, plan.entry, plan.entry];
  const p = { dir, entry: num(plan.entry, ctx.price), sl: num(plan.sl, ctx.price), type: plan.orderType || 'LIMIT', tps: [tpsSrc[0], tpsSrc[1], tpsSrc[2]], tp4: tpsSrc[3] ?? null, tp5: tpsSrc[4] ?? null, rr: 1, zone: { lo: Number(plan.zone.lo), hi: Number(plan.zone.hi), kind: plan.zone.kind || 'Zona' }, steps };
  const bars = style === 'Intraday' ? cl.m15 : style === 'Swing' ? cl.h4 : cl.m5;
  if (style === 'Scalping') {
    const ht = internal(cl.m15), it = internal(cl.m5), lt = internal(cl.m1);
    steps.push({ tf: 'M15', text: 'Bias ' + (ht.dir === 1 ? 'bullish' : ht.dir === -1 ? 'bearish' : 'netral') + (ht.ev ? ' (' + ht.ev + ')' : '') + '.' });
    steps.push({ tf: 'M5', text: 'Internal ' + (it.dir === 1 ? 'bullish' : 'bearish') + (it.ev ? ' · ' + it.ev : '') + ' · harga ' + (it.mom === 1 ? 'di atas' : 'di bawah') + ' EMA20.' });
    steps.push({ tf: 'M1', text: 'Trigger ' + (lt.dir === 1 ? 'bullish' : 'bearish') + (lt.ev ? ' · ' + lt.ev : '') + '.' });
    if (it.dir !== 0 && it.dir !== dir) {
      const zl = zonesOf(ctx, watch, cl.m5);
      const follow = nearestZone(zl, ctx, it.dir, cl.m5);
      const atZone = ctx.price >= p.zone.lo && ctx.price <= p.zone.hi && lt.dir === dir;
      if (follow) {
        const w = follow.hi - follow.lo;
        const inside = ctx.price >= follow.lo && ctx.price <= follow.hi;
        p.dir = it.dir;
        p.entry = inside ? ctx.price : (it.dir === 1 ? follow.hi - 0.4 * w : follow.lo + 0.4 * w);
        p.sl = it.dir === 1 ? follow.lo - 0.1 * atr(cl.m5) : follow.hi + 0.1 * atr(cl.m5);
        p.zone = { lo: follow.lo, hi: follow.hi, kind: follow.tf + ' ' + follow.kind };
        steps.push({ tf: 'M5', text: 'Follow internal: ' + (it.dir === 1 ? 'BUY' : 'SELL') + ' di ' + p.zone.kind + ' ' + ctx.f(follow.lo) + '–' + ctx.f(follow.hi) + '.' });
      } else if (!atZone) {
        const wait = nearestZone(zl, ctx, dir, cl.m5);
        return standby(ctx, style, 'HTF ' + (ht.dir === 1 ? 'bullish' : 'bearish') + ' tapi internal M5 ' + (it.dir === 1 ? 'bullish' : 'bearish') + (it.ev ? ' (' + it.ev + ')' : '') + '. Menunggu ' + (wait ? wait.kind + ' ' + ctx.f(wait.lo) + '–' + ctx.f(wait.hi) : 'zona searah internal') + ' + konfirmasi M1.', steps);
      }
    }
    const em = entryMode(ctx, p, internal(cl.m5), internal(cl.m1), cl.m5);
    if (em.reject) return standby(ctx, style, em.note, steps);
    p.type = em.type; p.entry = em.entry; p.note = em.note;
    steps.push({ tf: 'Entry', text: em.note });
  } else {
    const wrong = p.type === 'LIMIT' && ((dir === 1 && p.entry > ctx.price) || (dir === -1 && p.entry < ctx.price));
    if (wrong) { p.type = 'MARKET'; p.entry = ctx.price; }
  }
  const risk = applyRisk(p, ctx, bars, style);
  if (risk.reject) return standby(ctx, style, 'Risk ' + risk.need + ' pip melebihi batas ' + risk.max + ' pip (invalidasi ' + (risk.inv ?? '-') + ' terlalu jauh). Menunggu zona lebih rapat.', steps);
  const s = sigOf(p, ctx, style);
  s.checklist = steps.map(x => x.tf + ': ' + x.text);
  const f = { symbol: ctx.symbol, style, status: s.status, signal: s.signal, orderType: s.orderType, entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, tp4: s.tp4 ?? null, tp5: s.tp5 ?? null, invalidLevel: s.invalidLevel, entryNote: s.entryNote, steps, dec: ctx.dec, price: ctx.f(ctx.price) };
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
  const p = { dir: r.dir, entry: num(r.entry, ctx.price), sl: num(r.sl, ctx.price), type: r.orderType || 'MARKET', tps, rr: num(r.rr, 1.5), zone: null, steps: r.checklist || [] };
  const s = sigOf(p, ctx, 'Scalping');
  s.style = 'scalperbot'; s.symbol = ctx.symbol; s.tier = r.tier || 'EA';
  s.expiresAt = Date.now() + 9e5;
  const f = { symbol: ctx.symbol, style: 'scalperbot', status: s.status, signal: s.signal, orderType: s.orderType, entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tp3: s.tp3, trigger: r.trigger || null, bias: r.bias || 'netral', htf: r.trendTxt || '-', m1: r.structTxt || '-', checklist: r.checklist || [], dec: ctx.dec, price: ctx.f(ctx.price) };
  return { signal: s, facts: f };
}
function lifecycle(prev, sym, style, price, pip) {
  if (!prev || typeof prev !== 'object' || prev.symbol !== sym || prev.style !== style) return null;
  if (prev.signal !== 'BUY' && prev.signal !== 'SELL') return null;
  const exp = Number(prev.expiresAt);
  if (!Number.isFinite(exp) || Date.now() > exp) return { dead: true, out: 'EXPIRED', prev };
  const dir = prev.signal === 'BUY' ? 1 : -1;
  const sl = Number(prev.sl), e = Number(prev.entry), t1 = Number(prev.tp1), t2 = Number(prev.tp2), t3 = Number(prev.tp3);
  if (![sl, e, t1].every(Number.isFinite)) return null;
  const hit = v => (dir === 1 ? price >= v : price <= v);
  if (hit(sl)) return { dead: true, out: 'SL', prev };
  if (Number.isFinite(t3) && hit(t3)) return { dead: true, out: 'TP3', prev };
  if (prev.status === 'PENDING' && Math.abs(e - price) > 150 * pip) return { dead: true, out: 'TOO_FAR', prev };
  let status = prev.status, state = prev.state || 'CONFIRMED', be = !!prev.be;
  if (Number.isFinite(t2) && hit(t2)) { status = 'TP2_HIT'; state = 'TP2'; be = true; }
  else if (hit(t1)) { status = 'TP1_HIT'; state = 'TP1'; be = true; }
  else if (prev.status === 'PENDING' && (dir === 1 ? price <= e : price >= e)) { status = 'RUNNING'; state = 'FILLED'; }
  else status = 'RUNNING';
  return { dead: false, prev, patch: { status, state, be, slBe: be ? e : null } };
}
const SYS_VIS = 'Kamu analis S&D/OB dari gambar chart. Baca level PERSIS dari skala harga. Wajib BUY atau SELL kecuali gambar bukan chart. Isi perImageAnalyses (Indonesia) dan perImageAnalysesEn (Inggris), reason (Indonesia) dan reasonEn (Inggris) dengan angka sama. SL di luar distal zona/swing. Balas HANYA JSON: {"signal":"BUY","orderType":"LIMIT","entry":0,"sl":0,"tp1":0,"tp2":0,"tp3":0,"zoneLow":0,"zoneHigh":0,"zone":"Demand","pair":"","decimals":2,"perImageAnalyses":[],"perImageAnalysesEn":[],"reason":"","reasonEn":""}';
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
  const zl = f(Number(j.zoneLow) || Math.min(entry, entry - dir * risk * 0.5));
  const zh = f(Number(j.zoneHigh) || Math.max(entry, entry - dir * risk * 0.5));
  const pi = Array.isArray(j.perImageAnalyses) ? j.perImageAnalyses.map(String) : [];
  const pe = Array.isArray(j.perImageAnalysesEn) ? j.perImageAnalysesEn.map(String) : pi;
  const rid = '[' + sym + ' · Analisa ' + imgs.length + ' Gambar]\n' + pi.map(t => '• ' + t).join('\n') + '\n\n[Setup]\n' + (j.reason || '');
  const ren = '[' + sym + ' · ' + imgs.length + '-Image Analysis]\n' + pe.map(t => '• ' + t).join('\n') + '\n\n[Setup]\n' + (j.reasonEn || j.reason || '');
  const isLimit = String(j.orderType || '').toUpperCase() === 'LIMIT';
  const out = {
    signal: sg, orderType: isLimit ? 'LIMIT' : 'MARKET', fill: isLimit ? 'LIMIT' : 'NOW', status: isLimit ? 'PENDING' : 'RUNNING',
    symbol: sym, pair: sym, dec, pip, style, entry, sl, tp1: t1, tp2: t2, tp3: t3, tp4: f(entry + dir * risk * 4), tp5: f(entry + dir * risk * 5),
    zone: { min: zl, max: zh, label: (j.zone || 'Zona') + ' ' + zl + '–' + zh },
    reason: lang === 'en' ? ren : rid, reasons: { id: rid, en: ren }, reasonSource: 'AI', aiReasoning: true,
    createdAt: Date.now(), expiresAt: Date.now() + (EXPMS[style] || 18e5), source: 'VISION_AI',
  };
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
  const ctx = { symbol, dec, price, pip: pipOf(symbol, dec), f: v => Number(num(v, price).toFixed(dec)) };
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
  const life = lifecycle(body.prevSignal, symbol, isBot ? 'scalperbot' : style, price, ctx.pip);
  const key = symbol + '|' + style;
  if (life && life.dead) outcomes.set(key, { dir: life.prev.signal, out: life.out, t: Date.now() });
  if (life && !life.dead) {
    const managed = { ...life.prev, ...life.patch, sticky: true };
    const opp = out.signal.status !== 'STANDBY' && out.signal.signal !== managed.signal;
    if (!(body.forceNew && opp)) {
      if (managed.reasons) managed.reason = lang === 'en' ? (managed.reasons.en || managed.reasons.id) : (managed.reasons.id || managed.reasons.en);
      return res.status(200).json({ ok: true, mode: isBot ? 'bot' : 'candles', symbol, style, price, signal: managed, diag: { version: VERSION, lifecycle: managed.state, sticky: true } });
    }
  }
  const oc = outcomes.get(key);
  if (out.signal.status !== 'STANDBY' && oc && (oc.out === 'SL' || oc.out === 'INVALID') && Date.now() - oc.t < COOLDOWN && out.signal.signal === oc.dir) {
    out = standby(ctx, style, 'Cooldown setelah ' + oc.out + ' ' + oc.dir + '; menunggu struktur internal baru.', out.signal.checklist || []);
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
  return res.status(200).json({ ok: true, mode: isBot ? 'bot' : 'candles', symbol, style, price, signal, diag: { version: VERSION, status: signal.status, internal: f.internal || null, entryNote: f.entryNote || null } });
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-email');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ ok: true, version: VERSION, note: 'generate alive' });
  if (req.method !== 'POST') return res.status(200).json({ ok: false, reason: 'Method not allowed' });
  let body = {};
  try {
    body = req.body || {};
    if (typeof body === 'string') body = JSON.parse(body);
    if (body.probe) return res.status(200).json({ ok: true, version: VERSION });
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
