// api/generate.js — v174
// v174 = gabungan v169..v173:
// - Reasoning manual (Scalping/Intraday/Swing) format vision: [PAIR · Analisa Multi-TF] + bullet per-TF + [Setup], dual bahasa.
// - Scalping: gate internal LTF (M5 BOS/CHoCH + EMA20, trigger M1) tidak boleh melawan HTF sendirian; follow internal / tunggu zona / STANDBY.
// - Pertimbangan entry NOW vs LIMIT pullback (zona + momentum internal + trigger M1), tertulis di reason.
// - Invalidasi = swing high/low / tepi gap (FVG) / distal zona; SL di luar invalidasi + buffer; melebihi batas style => STANDBY.
// - SL/TP per style: Scalping gold 35-50 pip (TP 1/1.5/2/3/5 R), BTC 0.25-0.60%; Intraday gold 35-100 pip (TP 1.5/3/5), BTC 0.50-1.20%; Swing longgar.
// - Lifecycle signal hidup: tidak dibatalkan scanner/gate; PENDING->FILLED->TP1_HIT(BE)->TP2_HIT; cooldown 5 menit arah sama setelah SL/INVALID.
// - Vision: TP pakai angka AI bila valid, tp4/tp5 selalu searah, dual bahasa (reasonEn/perImageAnalysesEn) + fallback translate.
import { checkAccess, markTrialBotUsed } from '../lib/access.js';
import { generateManualPlan, buildWatchlist, SYARAT_MASUK } from '../lib/manual_scalp.js';
import { planCrt } from '../lib/crt-engine.js';
import { planIntraday, planSwing, planScalping } from '../lib/mtf-engine.js';
const MTF_MODE = 'mtf';
import { planBot } from '../lib/bot-ict.js';
import {
  scalpStructPlan,
  flexScalpPlan,
  pullbackPlan,
  simpleZonePlan,
  scalpWatch,
} from '../lib/smc_flex.js';
import { runBotSma as runBotFlex } from '../lib/bot_3candle.js';

export const config = { maxDuration: 60 };

const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/$/, '');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || 'gpt-6-luna';
const VISION_TIMEOUT_MS = 50000;
const VISION_DEADLINE_MS = 54000;
const VISION_MAX_TOKENS = 1800;
const VISION_EXPIRY_MS = { 'Scalping': 30 * 60e3, 'Intraday': 8 * 3600e3, 'Swing': 4 * 86400e3 };

const QWEN_BASE_URL = (process.env.QWEN_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/$/, '');
const QWEN_KEYS = [process.env.QWEN_API_KEY, process.env.QWEN_API_KEY_2, process.env.OPENAI_API_KEY].filter(Boolean);
const QWEN_MODELS = [...new Set([process.env.QWEN_MODEL || 'deepseek-v4-flash', process.env.QWEN_MODEL_2 || 'deepseek-v4-flash'].filter(Boolean))];
const QWEN_TIMEOUT_MS = 25000;
const QWEN_DEADLINE_MS = 30000;
const QWEN_MANUAL_DEADLINE_MS = Number(process.env.QWEN_MANUAL_DEADLINE_MS) > 0 ? Number(process.env.QWEN_MANUAL_DEADLINE_MS) : 12000;
const QWEN_MAX_TOKENS = 3000;
const QWEN_MANUAL_MODEL = process.env.QWEN_MANUAL_MODEL || 'qwen-4-max';
const envList = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const QWEN_MANUAL_KEYS = [...new Set([process.env.QWEN_MANUAL_API_KEY, ...QWEN_KEYS].filter(Boolean))];
const QWEN_MANUAL_MODELS = envList(process.env.QWEN_MANUAL_MODELS).length
  ? envList(process.env.QWEN_MANUAL_MODELS)
  : [QWEN_MANUAL_MODEL];
const QWEN_BOT_MODELS = envList(process.env.QWEN_BOT_MODELS).length ? envList(process.env.QWEN_BOT_MODELS) : QWEN_MODELS;

const TL_KEY_NAMES = ['TICKERLAYER_API_KEY', ...Array.from({ length: 19 }, (_, i) => `TICKERLAYER_API_KEY_${i + 1}`)];
const API_KEYS = TL_KEY_NAMES.map(n => process.env[n] || '');
const TL_MAX_TRY = Math.max(1, Number(process.env.TICKERLAYER_MAX_TRY || 3));
const TL_TIMEOUT_MS = 6000;
const TL_DISABLED = process.env.TICKERLAYER_DISABLED === '1';
const CANDLE_CACHE_TTL_MS = 90 * 1000;

const DECIMALS = {
  DXY: 2, EURUSD: 5, GBPUSD: 5, USDJPY: 3, AUDUSD: 5, USDCAD: 5, USDCHF: 5, NZDUSD: 5,
  EURGBP: 5, EURJPY: 3, GBPJPY: 3, AUDJPY: 3, EURAUD: 5, GBPAUD: 5, AUDNZD: 5, CADJPY: 3, CHFJPY: 3, EURNZD: 5,
  XAUUSD: 2, XAGUSD: 3, XPTUSD: 2, XPDUSD: 2, XAUEUR: 2, XAGEUR: 3,
  BRENT: 2, WTI: 2, NATGAS: 3, COPPER: 4, COFFEE: 2, SUGAR: 2,
  US30: 2, NAS100: 2, SPX500: 2, GER40: 2, UK100: 2, JPN225: 0, FRA40: 2, AUS200: 2,
  BTCUSD: 2, ETHUSD: 2, SOLUSD: 2, XRPUSD: 4, BNBUSD: 2, ADAUSD: 4, DOGEUSD: 5, AVAXUSD: 3, LINKUSD: 3, DOTUSD: 4, MATICUSD: 4, UNIUSD: 3,
};
const CRYPTO_LIST = ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','ADAUSD','DOGEUSD','AVAXUSD','LINKUSD','DOTUSD','MATICUSD','UNIUSD'];
const GOLD_SYMBOLS = ['XAUUSD', 'XAUUSDX'];
const isGold = s => GOLD_SYMBOLS.includes(s);
const PIP_OVERRIDE = { XAUUSD: 0.1, XAUUSDX: 0.1, DXY: 0.01, US30: 1, NAS100: 1, BTCUSD: 1 };
const pipSizeOf = (symbol, dec) => PIP_OVERRIDE[symbol] ?? Math.pow(10, -(dec - 1));

const TL_SPAN = { '1m': { mult:1, span:'minute', minutes:1 }, '5m': { mult:5, span:'minute', minutes:5 }, '15m': { mult:15, span:'minute', minutes:15 }, '30m': { mult:30, span:'minute', minutes:30 }, '1h': { mult:1, span:'hour', minutes:60 }, '4h': { mult:4, span:'hour', minutes:240 }, '1d': { mult:1, span:'day', minutes:1440 } };
const TL_MIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TL_ROUTE = { XAUUSD: ['commodities','XAUUSD'], XAUUSDX: ['commodities','XAUUSD'], XAGUSD: ['commodities','XAGUSD'], US30: ['indices','US30'], SPX500: ['indices','US500'], NAS100: ['indices','US100'] };
const TF_MS = { m1: 60000, m5: 300000, m15: 900000, m30: 1800000, h1: 3600000, h4: 14400000, d1: 86400000 };
const TF_IV = { m1: '1m', m5: '5m', m15: '15m', m30: '30m', h1: '1h', h4: '4h', d1: '1d' };
const TF_NEED = { d1: 60, h4: 80, h1: 100, m30: 100, m15: 200, m5: 200, m1: 200 };
const MIN_BARS = { m1: 60, m5: 40, m15: 40, m30: 35, h1: 35, h4: 25, d1: 20 };
const MANUAL_TF_NEEDED = {
  'Scalping': ['m1', 'm5', 'm15', 'h1'],
  'Intraday': ['m5', 'm15', 'h1', 'h4'],
  'Swing':    ['m15', 'h1', 'h4', 'd1'],
};
const BOT_TF_NEEDED = ['m1', 'm5', 'm15'];
const MAX_DIST_PIP = { 'Scalping': 150, 'Intraday': 500, 'Swing': 2000 };
const MAX_DIST_OVERRIDE = { BTCUSD: 800, XAUUSD: 1000 };
const MAX_DIST_SCALP_GOLD_PIP = 50;
function maxDistFor(symbol, styleName) {
  if (styleName === 'Scalping' && isGold(symbol)) return MAX_DIST_SCALP_GOLD_PIP;
  return MAX_DIST_OVERRIDE[symbol] ?? MAX_DIST_PIP[styleName] ?? 150;
}

const BOT_CFG = {
  storyTtlMs: 15000, storyTtlBotMs: 5 * 60e3, signalTtlMs: 15 * 60e3,
  flipCooldownMs: 5 * 60e3,
  storyBudgetBotMs: 2500,
  storyBudgetManualMs: 3000,
};
const MANUAL_STORY_TTL_MS = 180000;
const MANUAL_STANDBY_TTL_MS = 20000;
const GATE_TTL_MS = 10 * 60 * 1000;
const OUTCOME_COOLDOWN_MS = 5 * 60e3;

const isoDate = d => d.toISOString().slice(0, 10);
function fail(res, reason, status = 200) { return res.status(status).json({ ok:false, reason, message:reason, msg:reason, error:reason }); }

async function httpJson(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    const text = await r.text();
    let data = null; try { data = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, data, text };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timeout: layanan eksternal lama merespons');
    throw e;
  } finally { clearTimeout(timer); }
}

const MSG = {
  id: { noEmail:'Email tidak ditemukan.', notRegistered:'Email belum terdaftar.', expired:'Masa akses berakhir.', kvError:'Layanan akses bermasalah.', trialLimit:'Batas trial habis.', noPrice:'Harga live belum tersedia.', noCandles:'Data candle belum cukup.', noSetup:'Belum ada setup valid.', noKey:'OPENAI_API_KEY belum diatur.', badImage:'Gambar tidak valid.' },
  en: { noEmail:'Email not found.', notRegistered:'Email not registered.', expired:'Access expired.', kvError:'Access service issue.', trialLimit:'Trial limit reached.', noPrice:'Live price unavailable.', noCandles:'Insufficient candles.', noSetup:'No valid setup.', noKey:'OPENAI_API_KEY not set.', badImage:'Invalid image.' },
};
const msg = (lang, key) => ((MSG[lang] || MSG.id)[key] || key);
const markTrialAsUsed = markTrialBotUsed;

// ── DATA CANDLE & CACHE ──
const tlCooldown = new Map();
const candleCache = new Map();
function setCandleCache(symbol, tf, rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  candleCache.set(`${symbol}:${tf}`, { t: Date.now(), rows });
  if (candleCache.size > 400) candleCache.delete(candleCache.keys().next().value);
}
function getCandleCache(symbol, tf) {
  const hit = candleCache.get(`${symbol}:${tf}`);
  if (!hit) return [];
  if (Date.now() - hit.t > CANDLE_CACHE_TTL_MS) return [];
  return hit.rows;
}
async function tlGet(url) {
  if (TL_DISABLED) return null;
  const now = Date.now();
  const usable = API_KEYS.map((_, i) => i).filter(i => API_KEYS[i] && (tlCooldown.get(i) || 0) <= now).slice(0, TL_MAX_TRY);
  for (const i of usable) {
    try {
      const r = await httpJson(url, { headers: { 'x-api-key': API_KEYS[i] } }, TL_TIMEOUT_MS);
      if (r.status === 429) { tlCooldown.set(i, Date.now() + 60000); continue; }
      if (r.ok && r.data) return r.data;
    } catch (e) { console.warn(`TL key ${i}:`, e.message); }
  }
  return null;
}
function tlCandidate(symbol) {
  const s = symbol.toUpperCase().trim();
  if (TL_ROUTE[s]) { const [asset, sym] = TL_ROUTE[s]; return { asset, symbol: sym }; }
  if (CRYPTO_LIST.includes(s)) return { asset: 'crypto', symbol: s };
  return { asset: 'forex', symbol: s };
}
function toEpochMs(v) {
  if (typeof v === 'string' && Number.isNaN(Number(v))) return Date.parse(v) || 0;
  const n = Number(v); return n < 1e11 ? n * 1000 : n;
}
function cleanCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(c => ({ t: Number(c?.t ?? c?.time), o: Number(c?.o ?? c?.open), h: Number(c?.h ?? c?.high), l: Number(c?.l ?? c?.low), c: Number(c?.c ?? c?.close) }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
}
async function fetchTickerLayerRows(symbol, interval, need) {
  const tf = TL_SPAN[interval]; if (!tf) return [];
  const cand = tlCandidate(symbol);
  const now = Date.now();
  const windowMs = Math.max(need * 1.2 * tf.minutes * 60000, TL_MIN_WINDOW_MS) + 86400000;
  const startMs = now - windowMs;
  const url = `${TICKERLAYER_BASE_URL}/${cand.asset}/agg/${cand.symbol}/${tf.mult}/${tf.span}/${isoDate(new Date(startMs))}/${isoDate(new Date(now + 86400000))}?sort=desc&limit=5000`;
  const data = await tlGet(url);
  if (!data) return [];
  const raw = Array.isArray(data) ? data : (data.results || []);
  const rows = raw.map(bar => ({ t: toEpochMs(bar.t ?? bar.timestamp), o: bar.o ?? bar.open, h: bar.h ?? bar.high, l: bar.l ?? bar.low, c: bar.c ?? bar.close }));
  return cleanCandles(rows).slice(-Math.max(1, Math.ceil(need)));
}
function clientCandles(body, tf) {
  const c = body?.candles || {};
  const rows = c[tf] ?? body?.[tf];
  return Array.isArray(rows) ? cleanCandles(rows) : [];
}
const tsMs = t => (t < 1e12 ? t * 1000 : t);
function closedOnly(c, ms) {
  if (!c || !c.length) return c || [];
  return Date.now() < tsMs(c[c.length - 1].t) + ms ? c.slice(0, -1) : c;
}
function getFormingM1(m1) {
  if (!Array.isArray(m1) || !m1.length) return null;
  const forming = m1[m1.length - 1];
  return forming && Date.now() < tsMs(forming.t) + TF_MS.m1 ? forming : null;
}
function getKillzoneStatus(nowMs = Date.now()) {
  try {
    const ny = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const m = ny.getHours() * 60 + ny.getMinutes();
    if (m >= 120 && m <= 300) return { active: true, name: 'London KZ' };
    if (m >= 420 && m <= 600) return { active: true, name: 'New York KZ' };
    if (m >= 600 && m <= 660) return { active: true, name: 'Silver Bullet KZ' };
    return { active: false, name: 'di luar KZ' };
  } catch { return { active: true, name: 'sesi aktif' }; }
}
const safeNum = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

function toSignal(plan, ctx, extra) {
  const f = v => Number(safeNum(v, 0).toFixed(ctx.dec));
  const isMarket = plan.orderType === 'MARKET';
  const tps = Array.isArray(plan.tps) && plan.tps.length >= 3 ? plan.tps : [plan.entry, plan.entry, plan.entry];
  return {
    signal: plan.dir === 1 ? 'BUY' : 'SELL',
    orderType: plan.orderType,
    fill: isMarket ? 'NOW' : 'LIMIT',
    status: isMarket ? 'RUNNING' : 'PENDING',
    entry: f(plan.entry), sl: f(plan.sl), tp1: f(tps[0]), tp2: f(tps[1]), tp3: f(tps[2]),
    invalidLevel: plan.invalidLevel != null ? f(plan.invalidLevel) : null,
    setup: plan.setup || '',
    confidence: extra.confidence || 'MEDIUM',
    risk: extra.risk || 'MEDIUM',
    zone: plan.zone ? { min: f(plan.zone.lower), max: f(plan.zone.upper), timeframe: plan.zone.timeframe || '' } : null,
    zoneLabel: plan.zone ? plan.zone.label : '',
    zoneNote: '',
    chartContext: `${plan.setup || 'Signal'}: ${isMarket ? 'NOW' : 'LIMIT'} ${f(plan.entry)}`,
    rr: Number(safeNum(plan.rr, 1).toFixed(2)),
    tpMode: plan.tpMode || null,
    riskPips: plan.riskPips != null ? Number(Number(plan.riskPips).toFixed(1)) : null,
    checklist: extra.checklist || [],
    scanSummary: extra.scanSummary || '',
    topDown: extra.topDown || null,
    state: isMarket ? 'CONFIRMED' : 'LIMIT_PLACED',
    score: null,
    reason: '', reasons: { id: '', en: '' }, aiReasoning: false, reasonSource: null,
  };
}
function standbyOut(facts, standbyReason, checklist, topDown) {
  return {
    signal: {
      signal: 'NONE', orderType: 'NONE', fill: 'NONE', status: 'STANDBY',
      entry: null, sl: null, tp1: null, tp2: null, tp3: null, invalidLevel: null,
      setup: 'STANDBY / SCANNING', confidence: 'NONE', risk: 'NONE',
      zone: null, zoneLabel: '', zoneNote: '', chartContext: '',
      checklist: checklist || [], scanSummary: (checklist || []).join('\n'),
      topDown: topDown || null, state: 'STANDBY', score: null,
      reason: '', reasons: { id: '', en: '' }, aiReasoning: false, reasonSource: null,
    },
    facts: { ...facts, status: 'STANDBY', standbyReason },
  };
}

// ── MANUAL ENGINE ──
const DOC_STYLE_LABEL = {
  'Scalping': 'Scalping SMC (Zona M5)', 'Intraday': 'Intraday', 'Swing': 'Swing S&D/OB',
};
const DOC_STYLE_TF = {
  'Scalping': { htf: 'M5 Struktur', zone: 'S&D / FVG M5', trig: 'M5' },
  'Intraday': { htf: 'H4',          zone: 'VWAP M15',     trig: 'M15' },
  'Swing':    { htf: 'D1',          zone: 'S&D/OB H4+D1', trig: 'H4' },
};
const gateCache = new Map();

function legView(l, ctx) {
  const f = v => Number(safeNum(v, 0).toFixed(ctx.dec));
  return {
    signal: l.side === 'buy' ? 'BUY' : 'SELL',
    role: l.role || 'main',
    orderType: l.orderType,
    entry: f(l.entryPrice), sl: f(l.sl),
    tp1: f(l.tp1), tp2: f(l.tp2), tp3: f(l.tp3),
    tpMode: l.tpMode || null,
    riskPips: l.riskPips != null ? Number(Number(l.riskPips).toFixed(1)) : null,
    invalidLevel: f(l.invalidLevel),
    reason: l.reason,
  };
}
function atrSimple(rows, n = 14) {
  if (!Array.isArray(rows) || rows.length < n + 1) return 0;
  const tr = i => Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - rows[i - 1].c), Math.abs(rows[i].l - rows[i - 1].c));
  let a = 0;
  for (let i = 1; i <= n; i++) a += tr(i);
  a /= n;
  for (let i = n + 1; i < rows.length; i++) a = (a * (n - 1) + tr(i)) / n;
  return a;
}
function nearestZonePlan(watch, ctx, m5) {
  const list = (Array.isArray(watch) ? watch : [])
    .map(w => ({
      lo: Number(w.bawah ?? w.bottom ?? w.lo),
      hi: Number(w.atas ?? w.top ?? w.hi),
      tf: String(w.tf || 'M5'),
      type: String(w.tipe ?? w.type ?? ''),
      jarak: Number.isFinite(Number(w.jarak_pip)) ? Number(w.jarak_pip) : null,
    }))
    .filter(w => Number.isFinite(w.lo) && Number.isFinite(w.hi) && w.hi > w.lo && (w.hi - w.lo) / ctx.price < 0.02);
  if (!list.length) return { ok: false, checks: ['Belum ada zona M5 valid di sekitar harga.'] };
  list.sort((a, b) => (a.jarak ?? 1e9) - (b.jarak ?? 1e9));
  const z = list[0];
  const dir = ctx.price <= z.lo ? -1
    : ctx.price >= z.hi ? 1
    : (m5.length > 1 && m5[m5.length - 1].c >= m5[m5.length - 2].c ? 1 : -1);
  const entry = dir === 1 ? z.hi - 0.4 * (z.hi - z.lo) : z.lo + 0.4 * (z.hi - z.lo);
  const atr = atrSimple(m5);
  const buf = atr > 0 ? 0.1 * atr : 0.15 * (z.hi - z.lo);
  const sl = dir === 1 ? z.lo - buf : z.hi + buf;
  const risk = Math.abs(entry - sl);
  if (!(risk > ctx.pip * 2)) return { ok: false, checks: ['Zona terlalu tipis untuk SL.'] };
  const tp = k => entry + dir * risk * k;
  const label = z.type || (dir === 1 ? 'Demand' : 'Supply');
  const distPip = Math.round(Math.abs(ctx.price - entry) / ctx.pip);
  return {
    ok: true,
    order: {
      side: dir === 1 ? 'buy' : 'sell', role: 'nearest', orderType: 'LIMIT',
      entryPrice: entry, sl, tp1: tp(1), tp2: tp(2), tp3: tp(3),
      rr: 2, tpMode: 'RR', riskPips: Math.round(risk / ctx.pip),
      invalidLevel: dir === 1 ? z.lo : z.hi,
      reason: `Zona ${z.tf} ${label} terdekat, ${distPip} pip dari harga`,
    },
    zone: { top: z.hi, bottom: z.lo, timeframe: z.tf, type: label, fresh: true },
    regime: '', bias: '',
    checks: ['Fallback dipakai: struktur M1/M5 belum memberi setup, memakai zona terdekat.'],
  };
}
function wnsLine(ctx, p) {
  if (!p || !p.wns) return '';
  const f = ctx.f;
  return `CRT High ${f(p.wns.rh)} · CRT Low ${f(p.wns.rl)} | WNS SELL ${f(p.wns.sell.lo)}–${f(p.wns.sell.hi)} · WNS BUY ${f(p.wns.buy.lo)}–${f(p.wns.buy.hi)}`;
}
function runCrtManual(ctx, closed, styleName, facts) {
  const isSwing = styleName === 'Swing';
  const plan = planCrt({
    style: styleName,
    range: isSwing ? closed.d1 : closed.h4,
    mid:   isSwing ? closed.h1 : closed.m15,
    exec:  isSwing ? closed.m15 : closed.m5,
    price: ctx.price, sym: ctx.symbol, tNow: Date.now(),
  });
  const line = wnsLine(ctx, plan);
  facts.crtStatus = plan.status;
  if (plan.wns) facts.wns = plan.wns;
  facts.crtHigh = plan.crtHigh != null ? ctx.f(plan.crtHigh) : null;
  facts.crtLow = plan.crtLow != null ? ctx.f(plan.crtLow) : null;
  if (plan.status !== 'limit') {
    const why = `${line ? line + '. ' : ''}${plan.reason || 'Menunggu setup CRT'}`;
    facts.standbyReason = why;
    return standbyOut(facts, why, line ? [line] : [], `CRT ${styleName}`);
  }
  const dir = plan.dir === 'BUY' ? 1 : -1;
  const riskPips = Math.round(Math.abs(plan.entry - plan.sl) / ctx.pip);
  const p = {
    dir, entry: plan.entry, sl: plan.sl, orderType: 'LIMIT',
    tps: [plan.tp1, plan.tp2, plan.tp3], rr: 1, tpMode: 'CRT', riskPips,
    setup: `Manual · ${DOC_STYLE_LABEL[styleName] || styleName} · CRT ${plan.zone.kind}`,
    zone: { lower: plan.zone.lo, upper: plan.zone.hi, timeframe: '', label: `CRT ${plan.zone.kind}`, mid: (plan.zone.lo + plan.zone.hi) / 2 },
  };
  const sig = toSignal(p, ctx, {
    confidence: 'MEDIUM', risk: 'MEDIUM',
    checklist: line ? [line] : [], scanSummary: line, topDown: `CRT ${styleName}`,
  });
  sig.expiresAt = plan.expiresAt;
  sig.symbol = ctx.symbol;
  sig.style = styleName;
  sig.role = 'main';
  sig.crt = { wns: plan.wns || null, sweep: plan.sweep || null, crtHigh: facts.crtHigh, crtLow: facts.crtLow };
  facts.signal = plan.dir;
  facts.role = 'main';
  facts.orderType = 'LIMIT';
  facts.entry = sig.entry;
  facts.sl = sig.sl;
  facts.tp = [sig.tp1, sig.tp2, sig.tp3];
  facts.rr = '1.00';
  facts.tpMode = 'CRT';
  facts.riskPips = riskPips;
  facts.trigger = `CRT ${plan.zone.kind}`;
  facts.zone = { label: `CRT ${plan.zone.kind}`, lower: sig.zone.min, upper: sig.zone.max };
  return { signal: sig, facts: { ...facts, status: sig.status } };
}

// ── Multi-TF manual (Scalping/Intraday/Swing) + gate LTF + entry NOW/LIMIT ──
function runMtfStyle(ctx, closed, styleName, facts) {
  const now = Date.now();
  let plan;
  if (styleName === 'Intraday') plan = planIntraday({ h4: closed.h4, h1: closed.h1, m15: closed.m15, m5: closed.m5, price: ctx.price, sym: ctx.symbol, tNow: now });
  else if (styleName === 'Swing') plan = planSwing({ d1: closed.d1, h4: closed.h4, h1: closed.h1, m15: closed.m15, price: ctx.price, sym: ctx.symbol, tNow: now });
  else plan = planScalping({ m15: closed.m15, m5: closed.m5, m1: closed.m1, price: ctx.price, sym: ctx.symbol, tNow: now });

  facts.styleMode = 'mtf';
  facts.steps = plan?.steps || [];
  facts.bias = plan?.bias || plan?.regime || 'netral';
  let stepChecks = facts.steps.map(st => `${st.tf}: ${st.text}`);
  const push = (tf, text) => { facts.steps = [...facts.steps, { tf, text }]; stepChecks = facts.steps.map(st => `${st.tf}: ${st.text}`); };

  const finishStandby = (why) => {
    facts.standbyReason = why;
    facts.status = 'STANDBY';
    facts.reasonId = mtfFallbackReason(facts, false);
    facts.reasonEn = mtfFallbackReason(facts, true);
    const so = standbyOut(facts, why, plan?.checks || stepChecks, `${styleName} MTF`);
    so.signal.reasonFormat = 'mtf';
    so.signal.reasonId = facts.reasonId;
    so.signal.reasonEn = facts.reasonEn;
    return so;
  };

  if (!plan || plan.status !== 'limit') return finishStandby(plan?.reason || 'Menunggu setup MTF valid.');

  const dir0 = plan.dir === 'BUY' ? 1 : -1;
  let orderType = plan.orderType || 'LIMIT';
  let entry = safeNum(plan.entry, ctx.price);
  const sl0 = safeNum(plan.sl, ctx.price);
  const wrongSide = orderType === 'LIMIT' &&
    ((dir0 === 1 && entry > ctx.price) || (dir0 === -1 && entry < ctx.price));
  if (wrongSide) { orderType = 'MARKET'; entry = ctx.price; }
  if ((dir0 === 1 && sl0 >= entry) || (dir0 === -1 && sl0 <= entry))
    return finishStandby('Harga sudah melewati SL setup. Menunggu zona baru.');

  const label0 = plan.source ? `${styleName} · ${plan.source}` : styleName;
  let p = {
    dir: dir0, entry, sl: sl0, orderType,
    tps: [plan.tps?.[0], plan.tps?.[1], plan.tps?.[2]],
    rr: 1, tpMode: 'RISK_R',
    riskPips: Math.round(Math.abs(entry - sl0) / ctx.pip),
    setup: `Manual · ${label0} · ${plan.zone.kind}`,
    zone: { lower: plan.zone.lo, upper: plan.zone.hi, timeframe: plan.zone.tf || '', label: plan.zone.kind, mid: (plan.zone.lo + plan.zone.hi) / 2 },
  };
  if (styleName === 'Swing') { p.tp4 = plan.tps?.[3]; p.tp5 = plan.tps?.[4]; }

  const execBars = styleName === 'Intraday' ? closed.m15 : styleName === 'Swing' ? closed.h4 : closed.m5;
  let confidence = 'MEDIUM';

  if (styleName === 'Scalping') {
    // 1) gate internal LTF: HTF tidak boleh sendirian menentukan arah
    const gate = scalpLtfGate(ctx, closed, p, facts);
    const { htf, itf, ltf } = gate.info;
    facts.internal = { m15: htf.dir, m5: itf.dir, m1: ltf.dir, m5Event: itf.event, m1Event: ltf.event };
    push('M15', `Bias ${htf.dir === 1 ? 'bullish' : htf.dir === -1 ? 'bearish' : 'netral'} (${htf.event || 'momentum EMA20'}).`);
    push('M5', `Internal ${itf.dir === 1 ? 'bullish' : 'bearish'}${itf.event ? ` · ${itf.event}` : ''} · harga ${itf.momentum === 1 ? 'di atas' : 'di bawah'} EMA20.`);
    push('M1', `Trigger ${ltf.dir === 1 ? 'bullish' : 'bearish'}${ltf.event ? ` · ${ltf.event}` : ''}.`);
    if (!gate.ok) return finishStandby(gate.reason);
    if (gate.follow) {
      p = gate.follow;
      push('M5', `Follow internal: ${p.source} di ${p.zone.label} ${ctx.f(p.zone.lower)}–${ctx.f(p.zone.upper)}.`);
    } else if (gate.bounce) {
      push('M1', 'Harga di zona HTF + konfirmasi balik M1: bounce searah HTF diizinkan.');
    }
    // 2) pertimbangan NOW vs LIMIT pullback
    const em = decideEntryMode(ctx, closed, p, gate.info);
    if (em.reject) return finishStandby(em.note);
    p.orderType = em.orderType;
    p.entry = em.entry;
    facts.entryNote = em.note;
    push('Entry', em.note);
    // 3) SL/TP final setelah entry diputuskan
    const adj = applySlTpRules(p, ctx, execBars, styleName);
    if (adj && adj.reject)
      return finishStandby(`Risk ${styleName} ${adj.need} pip melebihi batas ${adj.max} pip (invalidasi ${adj.invalid ?? '-'} di luar zona terlalu jauh). Menunggu zona lebih rapat.`);
    p.riskPips = Math.round(Math.abs(p.entry - p.sl) / ctx.pip);
    if (adj && adj.invalid != null) p.invalidLevel = adj.invalid;
  } else {
    const adj = applySlTpRules(p, ctx, execBars, styleName);
    if (adj && adj.reject)
      return finishStandby(`Risk ${styleName} ${adj.need} pip melebihi batas ${adj.max} pip (invalidasi ${adj.invalid ?? '-'} di luar zona terlalu jauh). Menunggu zona lebih rapat.`);
    p.riskPips = Math.round(Math.abs(p.entry - p.sl) / ctx.pip);
    if (adj && adj.invalid != null) p.invalidLevel = adj.invalid;
  }

  if (!zoneSideOk(p))
    return finishStandby(`Setup ditolak: arah ${p.dir === 1 ? 'BUY' : 'SELL'} bertabrakan dengan ${zoneTxt(p)}. Menunggu zona searah.`);

  const sig = toSignal(p, ctx, {
    confidence, risk: 'MEDIUM',
    checklist: stepChecks.length ? stepChecks : [plan.reason || ''],
    scanSummary: plan.reason || '', topDown: p.source ? `${styleName} · ${p.source}` : label0,
  });
  sig.entryMode = p.orderType === 'MARKET' ? 'NOW' : 'PULLBACK';
  sig.entryNote = facts.entryNote || null;
  if (Number.isFinite(Number(p.tp4))) sig.tp4 = Number(ctx.f(p.tp4));
  if (Number.isFinite(Number(p.tp5))) sig.tp5 = Number(ctx.f(p.tp5));
  sig.expiresAt = plan.expiresAt;
  sig.symbol = ctx.symbol;
  sig.style = styleName;
  sig.role = 'main';

  facts.signal = p.dir === 1 ? 'BUY' : 'SELL';
  facts.role = 'main';
  facts.orderType = sig.orderType;
  facts.trigger = `${p.zone.label}${p.source ? ' · ' + p.source : ''}`;
  facts.entry = sig.entry;
  facts.sl = sig.sl;
  facts.tp = [sig.tp1, sig.tp2, sig.tp3, sig.tp4, sig.tp5].filter(v => Number.isFinite(Number(v)));
  facts.rr = Number(p.rr).toFixed(2);
  facts.riskPips = sig.riskPips;
  facts.tpMode = p.tpMode;
  facts.confirmed = p.orderType === 'MARKET';
  facts.zone = { label: p.zone.label, lower: sig.zone.min, upper: sig.zone.max };
  facts.invalid = sig.invalidLevel;
  facts.status = sig.status;
  facts.reasonId = mtfFallbackReason(facts, false);
  facts.reasonEn = mtfFallbackReason(facts, true);

  sig.reasonFormat = 'mtf';
  sig.reasonId = facts.reasonId;
  sig.reasonEn = facts.reasonEn;
  sig.reason = ctx.lang === 'en' ? sig.reasonEn : sig.reasonId;
  return { signal: sig, facts: { ...facts, status: sig.status } };
}

async function runDocManual(ctx, d, styleName) {
  const tf = DOC_STYLE_TF[styleName] || DOC_STYLE_TF['Scalping'];
  const facts = {
    mode: 'manual', symbol: ctx.symbol, style: styleName, kz: ctx.kz.name, price: ctx.f(ctx.price),
    htfTf: tf.htf, zoneTf: tf.zone, trigTf: tf.trig, dec: ctx.dec,
  };
  const closed = {
    m1: closedOnly(d.m1, TF_MS.m1),
    m5: closedOnly(d.m5, TF_MS.m5), m15: closedOnly(d.m15, TF_MS.m15), m30: closedOnly(d.m30, TF_MS.m30),
    h1: closedOnly(d.h1, TF_MS.h1), h4: closedOnly(d.h4, TF_MS.h4), d1: closedOnly(d.d1, TF_MS.d1),
  };
  facts.watch = styleName === 'Scalping'
    ? scalpWatch({ m1: closed.m1, m5: closed.m5 }, { price: ctx.price, pip: ctx.pip, dec: ctx.dec, symbol: ctx.symbol })
    : buildWatchlist({ ...closed, price: ctx.price, pip: ctx.pip, styleName });
  facts.syarat = SYARAT_MASUK[styleName] || null;

  if ((styleName === 'Intraday' || styleName === 'Swing') && MTF_MODE === 'mtf') {
    return runMtfStyle(ctx, closed, styleName, facts);
  }
  if (styleName === 'Intraday' || styleName === 'Swing') {
    return runCrtManual(ctx, closed, styleName, facts);
  }
  if (styleName === 'Scalping' && MTF_MODE === 'mtf' && (isGold(ctx.symbol) || ctx.symbol === 'BTCUSD')) {
    return runMtfStyle(ctx, closed, 'Scalping', facts);
  }

  const live = getFormingM1(d.m1);
  const barsClosed = { m1: closed.m1, m5: closed.m5, m15: closed.m15, h1: closed.h1, live };
  let out = { ok: false, checks: [] };
  if (styleName === 'Scalping') {
    const pctx = { price: ctx.price, dec: ctx.dec, pip: ctx.pip, now: Date.now(), symbol: ctx.symbol };
    out = simpleZonePlan(barsClosed, pctx, { tfs: ['M5', 'M1'] });
    if (!out.ok) {
      const st = scalpStructPlan(barsClosed, pctx);
      out = st.ok ? st : { ...out, checks: [...(out.checks || []), ...(st.checks || [])] };
    }
    if (!out.ok) {
      const fx = flexScalpPlan(barsClosed, pctx);
      out = fx.ok ? fx : { ...out, checks: [...(out.checks || []), ...(fx.checks || [])] };
    }
    if (!out.ok) {
      const pb = pullbackPlan(barsClosed, pctx);
      out = pb.ok ? pb : { ...out, checks: [...(out.checks || []), ...(pb.checks || [])] };
    }
    if (!out.ok) {
      const nz = nearestZonePlan(facts.watch, ctx, closed.m5);
      out = nz.ok ? nz : { ...out, checks: [...(out.checks || []), ...(nz.checks || [])] };
    }
  } else {
    out = generateManualPlan({
      ...closed, tickSize: 10 ** -ctx.dec, price: ctx.price, pip: ctx.pip, rr: ctx.rr, symbol: ctx.symbol,
    }, styleName);
  }

  const rawBias = out.bias || (out.regime ? out.regime.replace('_', ' ') : 'netral');
  const srcPart = out.biasTf ? `· ${out.biasTf}` : (out.regimeSrc ? `· ${out.regimeSrc}` : '');
  const regimeTxt = `${rawBias}${srcPart}`;
  facts.bias = regimeTxt;
  const checks = Array.isArray(out.checks) ? out.checks : [];
  if (!out.ok) {
    const why = out.reason || (checks.length ? checks[checks.length - 1] : 'Belum ada setup valid.');
    facts.standbyReason = why;
    facts.checklist = checks.slice(-6);
    return standbyOut(facts, why, checks, regimeTxt);
  }

  const o = out.order;
  const dir = o.side === 'buy' ? 1 : -1;
  const sideTxt = dir === 1 ? 'BUY' : 'SELL';
  const isCounter = o.role === 'counter';
  const isBounce = o.role === 'bounce';
  const z = out.zone;
  const plan = {
    dir, entry: o.entryPrice, sl: o.sl, orderType: o.orderType || 'LIMIT',
    tps: [o.tp1, o.tp2, o.tp3], rr: o.rr, tpMode: o.tpMode, riskPips: o.riskPips, invalidLevel: o.invalidLevel,
    setup: `Manual · ${DOC_STYLE_LABEL[styleName] || styleName} · ${o.reason}`,
    zone: z ? { lower: z.bottom, upper: z.top, timeframe: z.timeframe || '', label: `${z.timeframe} ${z.type}`, mid: (z.top + z.bottom) / 2 } : null,
  };
  const arahHtf = out.regime === 'trending_up' ? 'BUY' : out.regime === 'trending_down' ? 'SELL' : 'NETRAL';
  const refPx = closed.m1.length ? closed.m1[closed.m1.length - 1].c : ctx.price;
  const jarakPip = Math.round(Math.abs(refPx - o.entryPrice) / ctx.pip);
  const maxDist = maxDistFor(ctx.symbol, styleName);

  let gate;
  if (styleName === 'Scalping') {
    gate = { keputusan: 'AMBIL', alasan: 'Scalping zona/struktur valid', ai: false };
  } else if (isBounce) {
    gate = { keputusan: 'AMBIL', alasan: 'Bounce scalp di zona S&D fresh', ai: false };
  } else if (out.regime === 'choppy') {
    gate = { keputusan: 'TUNGGU', alasan: 'Market Structure HTF choppy/belum searah.', ai: false };
  } else if (!isCounter && arahHtf !== 'NETRAL' && arahHtf !== sideTxt) {
    gate = { keputusan: 'TUNGGU', alasan: `Arah setup ${sideTxt} berlawanan dengan bias HTF ${arahHtf}.`, ai: false };
  } else if (jarakPip > maxDist) {
    gate = { keputusan: 'TUNGGU', alasan: `Entry ${jarakPip} pip dari harga, melebihi batas ${maxDist} pip.`, ai: false };
  } else {
    const gKey = `${ctx.symbol}|${styleName}|${sideTxt}|${o.role}|${plan.orderType}|${ctx.f(o.entryPrice)}|${o.tpMode}|${out.oco ? 'oco' : ''}`;
    const hit = gateCache.get(gKey);
    if (hit && Date.now() - hit.t < hit.ttl) gate = hit.v;
    else {
      gate = await aiGateManual({
        gaya: styleName, simbol: ctx.symbol, arah_setup: sideTxt,
        role: o.role || 'main', oco: !!out.oco, tipe_order: plan.orderType,
        arah_htf: arahHtf, regime_htf: out.regime || 'neutral', regime_sumber: out.regimeSrc || null,
        alasan_aturan: o.reason,
        zona: z ? { jenis: `${z.timeframe} ${z.type}`, bawah: ctx.f(z.bottom), atas: ctx.f(z.top), fresh: !!z.fresh } : null,
        entry: ctx.f(o.entryPrice), harga_sekarang: ctx.f(ctx.price),
        jarak_entry_pip: jarakPip, batas_jarak_pip: maxDist,
      });
      gateCache.set(gKey, { t: Date.now(), ttl: gate.ai ? GATE_TTL_MS : 60e3, v: gate });
      if (gateCache.size > 200) gateCache.delete(gateCache.keys().next().value);
    }
  }
  if (gate.keputusan !== 'AMBIL') {
    const why = `Gate TUNGGU: ${gate.alasan}`;
    facts.standbyReason = why;
    facts.gateDecision = 'TUNGGU';
    return standbyOut(facts, why, checks, regimeTxt);
  }

  if (styleName === 'Scalping' && !zoneSideOk(plan)) {
    const why = `Setup ditolak: arah ${plan.dir === 1 ? 'BUY' : 'SELL'} bertabrakan dengan ${zoneTxt(plan)}. Menunggu zona searah.`;
    facts.standbyReason = why;
    return standbyOut(facts, why, checks, regimeTxt);
  }

  let slNote = null;
  if (styleName === 'Scalping' && (isGold(ctx.symbol) || ctx.symbol === 'BTCUSD')) {
    slNote = applySlTpRules(plan, ctx, closed.m5, 'Scalping');
    if (slNote && slNote.reject) {
      const why = `Risk scalping ${slNote.need} pip melebihi batas ${slNote.max} pip (invalidasi ${slNote.invalid ?? '-'} di luar zona terlalu jauh). Menunggu zona lebih rapat.`;
      facts.standbyReason = why;
      return standbyOut(facts, why, checks, regimeTxt);
    }
    if (slNote && slNote.invalid != null) plan.invalidLevel = slNote.invalid;
  }
  if (slNote && slNote.clamped) plan.setup = `${plan.setup} · SL ${slNote.before}→${slNote.after} pip`;
  plan.setup = `${plan.setup}${gate.ai ? ' · AI AMBIL' : ''}`;

  const sig = toSignal(plan, ctx, {
    confidence: o.confirmed && z?.fresh ? 'HIGH' : 'MEDIUM', risk: 'MEDIUM',
    checklist: checks, scanSummary: (checks || []).join('\n'), topDown: regimeTxt,
  });
  sig.expiresAt = Number.isFinite(Number(o.expiryTime)) ? Number(o.expiryTime) : Date.now() + (VISION_EXPIRY_MS[styleName] || 30 * 60e3);
  sig.symbol = ctx.symbol;
  sig.style = styleName;
  sig.role = o.role || 'main';
  if (o.role === 'nearest') { sig.fallback = true; sig.role = 'nearest'; }
  if (out.oco) {
    sig.oco = { rule: out.oco.rule, legs: out.oco.legs.map(l => legView(l, ctx)) };
  }
  if (Number.isFinite(Number(plan.tp4))) sig.tp4 = Number(ctx.f(plan.tp4));
  if (Number.isFinite(Number(plan.tp5))) sig.tp5 = Number(ctx.f(plan.tp5));

  facts.signal = sideTxt;
  facts.role = o.role || 'main';
  facts.orderType = plan.orderType;
  facts.entry = sig.entry;
  facts.sl = sig.sl;
  facts.tp = [sig.tp1, sig.tp2, sig.tp3, sig.tp4, sig.tp5].filter(v => Number.isFinite(Number(v)));
  facts.rr = Number(o.rr).toFixed(2);
  facts.tpMode = o.tpMode;
  facts.riskPips = sig.riskPips;
  facts.trigger = o.reason;
  facts.confirmed = !!o.confirmed;
  if (sig.oco) facts.oco = sig.oco;
  if (plan.zone) facts.zone = { label: plan.zone.label, lower: sig.zone.min, upper: sig.zone.max };
  return { signal: sig, facts: { ...facts, status: sig.status } };
}

const zoneTxt = plan => String((plan.zone && plan.zone.label) || plan.zoneLabel || plan.setup || '');
function zoneSideOk(plan) {
  const lab = zoneTxt(plan);
  const isSupply = /SELL|Supply/i.test(lab);
  const isDemand = /BUY|Demand/i.test(lab);
  if (!isSupply && !isDemand) return true;
  if (plan.dir === 1 && isSupply && !isDemand) return false;
  if (plan.dir !== 1 && isDemand && !isSupply) return false;
  return true;
}

// ── ATURAN SL/TP PER STYLE + INVALIDASI STRUKTUR ──
const SL_TP_RULES = {
  Scalping: { goldMinPip: 35, goldMaxPip: 50,  btcMinPct: 0.0025, btcMaxPct: 0.0060, tps: [1, 1.5, 2, 3, 5] },
  Intraday: { goldMinPip: 35, goldMaxPip: 100, btcMinPct: 0.0050, btcMaxPct: 0.0120, tps: [1.5, 3, 5] },
  Swing:    { goldMinPip: 50, goldMaxPip: 300, btcMinPct: 0.0100, btcMaxPct: 0.0250, tps: null },
};
const INV_LOOKBACK = 30;
const INV_SWING_LR = 2;
function slBounds(entry, ctx, styleName) {
  const r = SL_TP_RULES[styleName] || SL_TP_RULES.Scalping;
  if (isGold(ctx.symbol)) return { min: r.goldMinPip * ctx.pip, max: r.goldMaxPip * ctx.pip };
  return { min: entry * r.btcMinPct, max: entry * r.btcMaxPct };
}
function swingLevels(rows, lookback = INV_LOOKBACK, lr = INV_SWING_LR) {
  const out = { highs: [], lows: [] };
  if (!Array.isArray(rows) || rows.length < lr * 2 + 3) return out;
  const a = rows.slice(-lookback);
  for (let i = lr; i < a.length - lr; i++) {
    let isH = true, isL = true;
    for (let j = i - lr; j <= i + lr; j++) {
      if (j === i) continue;
      if (a[j].h >= a[i].h) isH = false;
      if (a[j].l <= a[i].l) isL = false;
    }
    if (isH) out.highs.push(a[i].h);
    if (isL) out.lows.push(a[i].l);
  }
  return out;
}
function gapEdges(rows, lookback = INV_LOOKBACK) {
  const out = { bullLower: [], bearUpper: [] };
  if (!Array.isArray(rows) || rows.length < 3) return out;
  const a = rows.slice(-lookback);
  for (let i = 1; i < a.length - 1; i++) {
    if (a[i - 1].h < a[i + 1].l) out.bullLower.push(a[i - 1].h);
    if (a[i - 1].l > a[i + 1].h) out.bearUpper.push(a[i - 1].l);
  }
  return out;
}
function deriveInvalidation(plan, ctx, bars) {
  const dir = plan.dir === 1 ? 1 : -1;
  const zLo = Number(plan.zone?.lower), zHi = Number(plan.zone?.upper);
  const hasZone = Number.isFinite(zLo) && Number.isFinite(zHi) && zHi > zLo;
  const distal = hasZone ? (dir === 1 ? zLo : zHi) : NaN;
  const zw = hasZone ? (zHi - zLo) : 0;
  const atr = atrSimple(bars || []);
  const reach = zw > 0 ? zw : (atr > 0 ? atr : ctx.pip * 10);
  const cands = [];
  if (Number.isFinite(Number(plan.invalidLevel))) cands.push(Number(plan.invalidLevel));
  if (Number.isFinite(distal)) cands.push(distal);
  const sw = swingLevels(bars);
  const gp = gapEdges(bars);
  if (dir === 1) {
    for (const v of [...sw.lows, ...gp.bullLower]) if (Number.isFinite(v) && Number.isFinite(distal) && v <= distal && v >= distal - reach) cands.push(v);
    for (const v of gp.bullLower) if (Number.isFinite(v) && hasZone && v > distal && v <= zHi) cands.push(v);
    const valid = cands.filter(v => v < plan.entry);
    return valid.length ? Math.min(...valid) : NaN;
  }
  for (const v of [...sw.highs, ...gp.bearUpper]) if (Number.isFinite(v) && Number.isFinite(distal) && v >= distal && v <= distal + reach) cands.push(v);
  for (const v of gp.bearUpper) if (Number.isFinite(v) && hasZone && v < distal && v >= zLo) cands.push(v);
  const valid = cands.filter(v => v > plan.entry);
  return valid.length ? Math.max(...valid) : NaN;
}
function applySlTpRules(plan, ctx, bars, styleName) {
  if (!plan || !Number.isFinite(plan.entry) || !Number.isFinite(plan.sl) || !(ctx.pip > 0)) return null;
  const rule = SL_TP_RULES[styleName] || SL_TP_RULES.Scalping;
  const dir = plan.dir === 1 ? 1 : -1;
  const b = slBounds(plan.entry, ctx, styleName);
  const beforeDist = Math.abs(plan.entry - plan.sl);
  const inv = deriveInvalidation(plan, ctx, bars);
  const atr = atrSimple(bars || []);
  const zoneWidth = Number(plan.zone?.upper) - Number(plan.zone?.lower);
  const buffer = atr > 0 ? 0.1 * atr : 0.1 * (zoneWidth > 0 ? zoneWidth : ctx.pip * 10);
  const invDist = Number.isFinite(inv) ? Math.abs(plan.entry - inv) + buffer : 0;
  const dist = Math.max(beforeDist, invDist, b.min);
  const needPip = Math.round(dist / ctx.pip);
  const maxPip = Math.round(b.max / ctx.pip);
  const invFmt = Number.isFinite(inv) ? Number(ctx.f(inv)) : null;
  if (dist > b.max) {
    return { reject: true, clamped: false, before: Math.round(beforeDist / ctx.pip), need: needPip, max: maxPip, invalid: invFmt };
  }
  const clamped = Math.abs(dist - beforeDist) > 1e-9;
  plan.sl = plan.entry - dir * dist;
  if (Array.isArray(rule.tps)) {
    plan.tps = rule.tps.slice(0, 3).map(m => plan.entry + dir * dist * m);
    plan.tp4 = rule.tps[3] != null ? plan.entry + dir * dist * rule.tps[3] : undefined;
    plan.tp5 = rule.tps[4] != null ? plan.entry + dir * dist * rule.tps[4] : undefined;
    plan.rr = rule.tps[0];
    plan.tpMode = 'RISK_R';
  }
  plan.riskPips = Math.round(dist / ctx.pip);
  if (Number.isFinite(inv)) plan.invalidLevel = inv;
  return { before: Math.round(beforeDist / ctx.pip), after: needPip, clamped, invalid: invFmt };
}
function tpListTxt(tp, id) {
  const v = (tp || []).filter(x => x != null);
  if (v.length <= 1) return String(v[0] ?? '-');
  const last = v[v.length - 1], head = v.slice(0, -1);
  return id ? `${head.join(', ')}, serta ${last}` : `${head.join(', ')}, and ${last}`;
}

// ── Layout reasoning manual = format vision ──
function mtfLayoutReason(f, en, perTfLines, setupText) {
  const head = `[${f.symbol} · ${en ? 'Multi-TF Analysis' : 'Analisa Multi-TF'} · ${f.style}]`;
  const bullets = (perTfLines || []).map(t => `• ${t}`).join('\n');
  return `${head}\n${bullets}\n\n[Setup]\n${setupText}`;
}
function mtfFallbackReason(f, en) {
  const lines = (f.steps || []).map(s => `${s.tf}: ${s.text}`);
  let setup;
  if (f.status === 'STANDBY') {
    setup = `${f.symbol}: ${f.standbyReason || (en ? 'Waiting for a valid setup.' : 'Menunggu setup valid.')}`;
  } else {
    const orderWord = f.orderType === 'MARKET' ? 'MARKET (NOW)' : 'LIMIT';
    const invTxt = f.invalid != null ? (en ? ` Invalidation ${f.invalid}.` : ` Invalidasi ${f.invalid}.`) : '';
    setup = en
      ? `${f.symbol}: final decision ${f.signal} ${orderWord} @ ${f.entry}, SL ${f.sl}, targets ${tpListTxt(f.tp, false)}.${invTxt}`
      : `${f.symbol}: keputusan final ${f.signal} ${orderWord} @ ${f.entry}, SL ${f.sl}, target ${tpListTxt(f.tp, true)}.${invTxt}`;
  }
  return mtfLayoutReason(f, en, lines, setup);
}

// ── v172: SCALPING LTF INTERNAL-STRUCTURE GATE ──
function emaLast(rows, n = 20) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const k = 2 / (n + 1);
  let e = rows[0].c;
  for (let i = 1; i < rows.length; i++) e = rows[i].c * k + e * (1 - k);
  return e;
}
function readInternal(rows, lookback = 60, lr = 2) {
  const out = { dir: 0, event: null, fresh: false, momentum: 0, run: 0, ema: null, close: null, swingHigh: null, swingLow: null, strong: false };
  if (!Array.isArray(rows) || rows.length < 25) return out;
  const a = rows.slice(-lookback);
  const n = a.length;
  out.ema = emaLast(a, 20);
  out.close = a[n - 1].c;
  out.momentum = out.close > out.ema ? 1 : out.close < out.ema ? -1 : 0;
  const lastDir = a[n - 1].c >= a[n - 1].o ? 1 : -1;
  let run = 0;
  for (let i = n - 1; i >= 0; i--) { const d = a[i].c >= a[i].o ? 1 : -1; if (d === lastDir) run++; else break; }
  out.run = run;
  const highs = [], lows = [];
  for (let i = lr; i < n - lr; i++) {
    let isH = true, isL = true;
    for (let j = i - lr; j <= i + lr; j++) { if (j === i) continue; if (a[j].h >= a[i].h) isH = false; if (a[j].l <= a[i].l) isL = false; }
    if (isH) highs.push({ i, v: a[i].h });
    if (isL) lows.push({ i, v: a[i].l });
  }
  out.swingHigh = highs.length ? highs[highs.length - 1].v : null;
  out.swingLow = lows.length ? lows[lows.length - 1].v : null;
  let trend = 0, event = null, breakI = -1, hi = 0, li = 0;
  for (let i = lr * 2; i < n; i++) {
    while (hi < highs.length && highs[hi].i < i - lr) hi++;
    while (li < lows.length && lows[li].i < i - lr) li++;
    const pH = hi > 0 ? highs[hi - 1] : null;
    const pL = li > 0 ? lows[li - 1] : null;
    const c = a[i].c;
    if (pH && c > pH.v) { event = trend === -1 ? 'CHOCH_UP' : 'BOS_UP'; trend = 1; breakI = i; }
    else if (pL && c < pL.v) { event = trend === 1 ? 'CHOCH_DOWN' : 'BOS_DOWN'; trend = -1; breakI = i; }
  }
  out.fresh = breakI >= n - 12;
  out.event = event;
  out.dir = trend !== 0 && out.fresh ? trend : out.momentum;
  out.strong = out.fresh && trend !== 0 && out.momentum === trend;
  return out;
}
function fvgZones(rows, lookback = 40) {
  const out = [];
  if (!Array.isArray(rows) || rows.length < 3) return out;
  const a = rows.slice(-lookback);
  for (let i = 1; i < a.length - 1; i++) {
    if (a[i - 1].h < a[i + 1].l) out.push({ lo: a[i - 1].h, hi: a[i + 1].l, side: 'demand', kind: 'FVG bull' });
    if (a[i - 1].l > a[i + 1].h) out.push({ lo: a[i + 1].h, hi: a[i - 1].l, side: 'supply', kind: 'FVG bear' });
  }
  return out;
}
function zoneSideOf(label, fallback) {
  const s = String(label || '');
  if (/supply|sell|rbd|dbd|bear/i.test(s)) return 'supply';
  if (/demand|buy|rbr|dbr|bull/i.test(s)) return 'demand';
  return fallback || null;
}
function nearestSideZone(ctx, closed, facts, dir) {
  const atr = atrSimple(closed.m5) || ctx.pip * 10;
  const list = [];
  for (const w of facts.watch || []) {
    const lo = Number(w.bawah ?? w.bottom ?? w.lo), hi = Number(w.atas ?? w.top ?? w.hi);
    if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)) continue;
    if ((hi - lo) / ctx.price > 0.02) continue;
    const side = zoneSideOf(w.tipe ?? w.type, null) || (lo >= ctx.price ? 'supply' : hi <= ctx.price ? 'demand' : null);
    list.push({ lo, hi, tf: String(w.tf || 'M5'), kind: String(w.tipe ?? w.type || 'Zona'), side });
  }
  for (const z of fvgZones(closed.m5)) list.push({ ...z, tf: 'M5' });
  const want = dir === 1 ? 'demand' : 'supply';
  return list
    .filter(z => z.side === want || z.side == null)
    .filter(z => dir === 1 ? z.hi <= ctx.price + 0.2 * atr : z.lo >= ctx.price - 0.2 * atr)
    .map(z => ({ ...z, d: dir === 1 ? ctx.price - z.hi : z.lo - ctx.price }))
    .filter(z => z.d > -0.5 * atr)
    .sort((a, b) => a.d - b.d)[0] || null;
}
function oppositeRoomOk(ctx, closed, facts, dir, entry, tp1) {
  const opp = nearestSideZone(ctx, closed, facts, -dir);
  if (!opp) return true;
  const dist = dir === 1 ? opp.lo - entry : entry - opp.hi;
  return !(dist > 0 && Math.abs(tp1 - entry) > dist);
}
function buildFollowPlan(ctx, closed, facts, dir) {
  const z = nearestSideZone(ctx, closed, facts, dir);
  if (!z) return null;
  const width = z.hi - z.lo;
  const atr = atrSimple(closed.m5) || ctx.pip * 10;
  const inside = ctx.price >= z.lo && ctx.price <= z.hi;
  const entry = inside ? ctx.price : (dir === 1 ? z.hi - 0.4 * width : z.lo + 0.4 * width);
  const buf = 0.1 * atr;
  const sl = dir === 1 ? z.lo - buf : z.hi + buf;
  const p = {
    dir, entry, sl, orderType: inside ? 'MARKET' : 'LIMIT',
    tps: [entry, entry, entry], rr: 1, tpMode: 'RISK_R',
    riskPips: Math.round(Math.abs(entry - sl) / ctx.pip),
    setup: `Manual · Scalping · LTF follow ${z.kind}`,
    zone: { lower: z.lo, upper: z.hi, timeframe: z.tf, label: `${z.tf} ${z.kind}`, mid: (z.lo + z.hi) / 2 },
    source: `LTF ${dir === 1 ? 'BUY' : 'SELL'} follow`,
    steps: [{ tf: 'M5', text: `Internal ${dir === 1 ? 'bullish' : 'bearish'}; harga ${inside ? 'di dalam' : 'menuju'} ${z.kind} ${ctx.f(z.lo)}–${ctx.f(z.hi)}.` }],
    invalidLevel: dir === 1 ? z.lo : z.hi,
  };
  const adj = applySlTpRules(p, ctx, closed.m5, 'Scalping');
  if (!adj || adj.reject) return null;
  if (!oppositeRoomOk(ctx, closed, facts, dir, p.entry, p.tps[0])) return null;
  return p;
}
function scalpLtfGate(ctx, closed, plan, facts) {
  const htf = readInternal(closed.m15, 60);
  const itf = readInternal(closed.m5, 60);
  const ltf = readInternal(closed.m1, 40);
  const dir = plan.dir === 1 ? 1 : -1;
  const info = { htf, itf, ltf };
  if (itf.dir === 0 || itf.dir === dir) return { ok: true, info };
  const atr = atrSimple(closed.m5) || ctx.pip * 10;
  const zl = plan.zone?.lower, zh = plan.zone?.upper;
  const atZone = Number.isFinite(zl) && Number.isFinite(zh) && ctx.price >= zl - 0.15 * atr && ctx.price <= zh + 0.15 * atr;
  const ltfTurn = ltf.dir === dir && ltf.fresh;
  if (atZone && ltfTurn) return { ok: true, bounce: true, info };
  const follow = buildFollowPlan(ctx, closed, facts, itf.dir);
  if (follow) return { ok: true, follow, info };
  const ev = itf.event || (itf.dir === -1 ? 'BOS_DOWN' : 'BOS_UP');
  const wait = nearestSideZone(ctx, closed, facts, dir);
  const reason = `HTF ${htf.dir === 1 ? 'bullish' : htf.dir === -1 ? 'bearish' : 'netral'} tapi internal M5 ${itf.dir === 1 ? 'bullish' : 'bearish'} (${ev}, harga ${itf.momentum === -1 ? 'di bawah' : 'di atas'} EMA20). Scalping tidak melawan internal: menunggu ${wait ? `${wait.kind} ${ctx.f(wait.lo)}–${ctx.f(wait.hi)}` : 'zona searah internal'} + konfirmasi M1.`;
  return { ok: false, info, reason };
}

// ── v173: pertimbangan entry NOW vs LIMIT pullback ──
function decideEntryMode(ctx, closed, p, info) {
  const dir = p.dir === 1 ? 1 : -1;
  const zl = Number(p.zone?.lower), zh = Number(p.zone?.upper);
  if (!(Number.isFinite(zl) && Number.isFinite(zh) && zh > zl))
    return { orderType: p.orderType || 'LIMIT', entry: p.entry, note: 'Zona tidak terbaca; memakai entry engine.' };
  const width = zh - zl;
  const atr = atrSimple(closed.m5) || ctx.pip * 10;
  const prox = dir === 1 ? zh : zl;
  const inZone = ctx.price >= zl && ctx.price <= zh;
  const beyond = dir === 1 ? ctx.price < zl : ctx.price > zh;
  if (beyond) return { reject: true, note: `Harga sudah menembus ${p.zone.label} (${ctx.f(dir === 1 ? zl : zh)}); setup batal, menunggu zona baru.` };
  const itf = info?.itf, ltf = info?.ltf;
  const mom = !!itf && itf.dir === dir && itf.strong;
  const ltfOk = !!ltf && ltf.dir === dir;
  const distProx = dir === 1 ? ctx.price - prox : prox - ctx.price;
  if (inZone) {
    if (mom && ltfOk) return { orderType: 'MARKET', entry: ctx.price, note: `NOW: harga di dalam ${p.zone.label} + internal M5 dan trigger M1 searah ${dir === 1 ? 'BUY' : 'SELL'}.` };
    const lim = dir === 1 ? Math.min(zl + 0.5 * width, ctx.price - 0.05 * atr) : Math.max(zh - 0.5 * width, ctx.price + 0.05 * atr);
    return { orderType: 'LIMIT', entry: lim, note: `LIMIT pullback dalam zona @ ${ctx.f(lim)}: harga di zona tapi konfirmasi internal/M1 belum searah.` };
  }
  if (mom && ltfOk && distProx <= 0.3 * atr)
    return { orderType: 'MARKET', entry: ctx.price, note: `NOW: momentum internal kuat searah dan harga hanya ${Math.round(distProx / ctx.pip)} pip dari proximal zona.` };
  const lim = dir === 1 ? zh - 0.4 * width : zl + 0.4 * width;
  return { orderType: 'LIMIT', entry: lim, note: `LIMIT pullback @ ${ctx.f(lim)} (40% zona): harga belum retest zona; tunggu pantulan, bukan kejar harga.` };
}

function runManual(ctx, d, styleName) {
  return runDocManual(ctx, d, styleName);
}
function legFields(l) {
  return {
    signal: l.signal, orderType: l.orderType,
    fill: l.orderType === 'MARKET' ? 'NOW' : 'LIMIT',
    entry: l.entry, sl: l.sl, tp1: l.tp1, tp2: l.tp2, tp3: l.tp3,
    tpMode: l.tpMode, riskPips: l.riskPips,
    invalidLevel: l.invalidLevel, role: l.role,
  };
}
function resolveOcoFill(prev, price) {
  const legs = prev.oco.legs;
  const aliveIdx = legs.map((_, i) => i).filter(i => {
    const l = legs[i];
    return l.signal === 'BUY'
      ? price > Math.max(l.sl, l.invalidLevel ?? -Infinity)
      : price < Math.min(l.sl, l.invalidLevel ?? Infinity);
  });
  if (!aliveIdx.length) return null;
  const filledIdx = aliveIdx.find(i => {
    const l = legs[i];
    return l.signal === 'BUY' ? price <= l.entry : price >= l.entry;
  });
  if (filledIdx !== undefined) {
    const l = legs[filledIdx];
    return {
      ...prev, ...legFields(l),
      status: 'RUNNING', state: 'FILLED',
      chartContext: `${l.signal} FILLED ${l.entry}`,
      oco: { ...prev.oco, filled: filledIdx, cancelled: legs.map((_, i) => i).filter(i => i !== filledIdx) },
    };
  }
  const primary = aliveIdx.includes(0) ? legs[0] : legs[aliveIdx[0]];
  return { ...prev, ...legFields(primary), oco: { ...prev.oco, alive: aliveIdx } };
}

// ── v173: lifecycle signal hidup (anti berkedip/batal) + cooldown setelah SL ──
const outcomeCache = new Map();
function prevLifecycle(prev, symbol, styleName, price, pip) {
  if (!prev || typeof prev !== 'object') return null;
  if (prev.symbol !== symbol || prev.style !== styleName) return null;
  if (prev.signal !== 'BUY' && prev.signal !== 'SELL') return null;
  if (Array.isArray(prev.oco?.legs) && prev.oco.legs.length) {
    const r = resolveOcoFill(prev, price);
    if (!r) return { dead: true, outcome: 'OCO_DEAD', prev };
    prev = r;
  }
  const exp = Number(prev.expiresAt);
  if (!Number.isFinite(exp) || Date.now() > exp) return { dead: true, outcome: 'EXPIRED', prev };
  const dir = prev.signal === 'BUY' ? 1 : -1;
  const sl = Number(prev.sl), tp1 = Number(prev.tp1), tp2 = Number(prev.tp2), tp3 = Number(prev.tp3), entry = Number(prev.entry);
  const inv = prev.invalidLevel != null ? Number(prev.invalidLevel) : null;
  if (![sl, tp1, entry].every(Number.isFinite)) return null;
  const hit = v => dir === 1 ? price >= v : price <= v;
  if (hit(sl)) return { dead: true, outcome: 'SL', prev };
  if (inv != null && (dir === 1 ? price < inv : price > inv)) return { dead: true, outcome: 'INVALID', prev };
  if (Number.isFinite(tp3) && hit(tp3)) return { dead: true, outcome: 'TP3', prev };
  const maxDist = maxDistFor(symbol, styleName) * (prev.fallback ? 3 : 1);
  if (prev.status === 'PENDING' && Math.abs(entry - price) > maxDist * pip) return { dead: true, outcome: 'TOO_FAR', prev };
  let status = prev.status, state = prev.state || 'CONFIRMED', be = !!prev.be;
  if (Number.isFinite(tp2) && hit(tp2)) { status = 'TP2_HIT'; state = 'TP2'; be = true; }
  else if (hit(tp1)) { status = 'TP1_HIT'; state = 'TP1'; be = true; }
  else if (prev.status === 'PENDING') {
    const filled = dir === 1 ? price <= entry : price >= entry;
    if (filled) { status = 'RUNNING'; state = 'FILLED'; }
  } else { status = 'RUNNING'; }
  return { dead: false, prev, patch: { status, state, be, slBe: be ? entry : null, tp1Hit: hit(tp1), tp2Hit: Number.isFinite(tp2) && hit(tp2) } };
}

// ── BOT ENGINE ──
const BOT_STYLE = 'scalperbot';
function ictToBot(p) {
  return {
    ok: true,
    dir: p.dir === 'BUY' ? 1 : -1,
    dirTxt: p.dir,
    entry: p.entry, sl: p.sl,
    tps: [p.tp1, p.tp2, p.tp3], rr: 2, tpMode: 'ICT',
    orderType: 'LIMIT', tier: 'ICT_POI', confidence: 'MEDIUM',
    setup: `Bot ICT · ${p.mode} · POI ${p.poi.kind} M15`,
    trigger: `POI ${p.poi.kind} M15 ${p.poi.lo}-${p.poi.hi}`,
    bias: `M15 ${p.dir}`, trendTxt: `M15 ${p.dir}`, structTxt: `M5 ${p.mode}`,
    checklist: [
      `POI ${p.poi.kind} M15 ${p.poi.lo}-${p.poi.hi}`,
      `Entry 40% zona ${p.entry}`,
      `SL buffer ATR ${p.sl}`,
      `TP1 ${p.tp1} · TP2 ${p.tp2} · TP3 ${p.tp3}`,
    ],
    zone: { label: `${p.poi.kind} M15`, lower: p.poi.lo, upper: p.poi.hi, timeframe: 'M15' },
    watch: [{ tf: 'M15', tipe: p.poi.kind, bawah: p.poi.lo, atas: p.poi.hi, status: p.mode, di_dalam: false, jarak_pip: 0 }],
  };
}
function runBot(ctx, d) {
  const m1 = closedOnly(d.m1, TF_MS.m1);
  const m5 = closedOnly(d.m5, TF_MS.m5);
  const m15 = closedOnly(d.m15, TF_MS.m15);
  const live = getFormingM1(d.m1);
  const bars = { m1, m5, m15, live };
  let r = runBotFlex(bars, { price: ctx.price, dec: ctx.dec, pip: ctx.pip, symbol: ctx.symbol, prevCandleT: ctx.prevCandleT ?? null });
  if (!r || !r.ok) {
    let ict = null;
    try { ict = planBot({ m15, m5, price: ctx.price, sym: ctx.symbol, tNow: Date.now() }); }
    catch (e) { console.warn('planBot:', e.message); }
    if (ict && ict.status === 'limit') r = ictToBot(ict);
  }
  const F = v => ctx.f(safeNum(v, ctx.price));
  const facts = {
    mode: 'bot', symbol: ctx.symbol, style: 'Scalping', kz: ctx.kz.name, dec: ctx.dec,
    price: F(ctx.price), bias: r.bias || 'NETRAL', dirTxt: r.dirTxt || '-',
    trigger: r.trigger || null, checklist: Array.isArray(r.checklist) ? r.checklist : [],
    htf: r.trendTxt || '-', m1: r.structTxt || '-',
    zone: r.zone ? { label: r.zone.label, lower: F(r.zone.lower), upper: F(r.zone.upper) } : null,
    watch: Array.isArray(r.watch) ? r.watch : [],
    tier: r.tier || 'EA_PULLBACK',
    status: r.ok ? 'SIGNAL' : 'STANDBY',
  };
  if (!r || !r.ok) return standbyOut(facts, r?.reason || 'Menunggu setup valid.', facts.checklist, facts.bias);
  const tpsArr = Array.isArray(r.tps) && r.tps.length >= 3 ? r.tps : [r.entry, r.entry, r.entry];
  const plan = {
    dir: r.dir, entry: safeNum(r.entry, ctx.price), sl: safeNum(r.sl, ctx.price),
    tps: tpsArr, rr: safeNum(r.rr, 1.5), tpMode: r.tpMode || 'RR',
    orderType: r.orderType || 'MARKET', setup: r.setup || 'Bot Signal',
    zone: r.zone
      ? { lower: safeNum(r.zone.lower, ctx.price), upper: safeNum(r.zone.upper, ctx.price), timeframe: r.zone.timeframe || 'M15', label: r.zone.label || '' }
      : null,
  };
  const out = toSignal(plan, ctx, {
    confidence: r.confidence || 'HIGH',
    risk: ['LOOSE', 'MOMENTUM', 'PEMBALIKAN'].includes(r.tier) ? 'HIGH' : 'MEDIUM',
    checklist: facts.checklist, scanSummary: facts.checklist.join('\n'), topDown: facts.bias,
  });
  out.tier = r.tier || 'STRICT';
  out.candleT = r.candleT ?? null;
  out.symbol = ctx.symbol;
  out.style = BOT_STYLE;
  out.expiresAt = Date.now() + BOT_CFG.signalTtlMs;
  facts.tier = out.tier;
  facts.signal = r.dirTxt;
  facts.role = r.role || 'main';
  facts.orderType = plan.orderType;
  facts.status = out.status;
  facts.entry = F(plan.entry);
  facts.sl = F(plan.sl);
  facts.tp = tpsArr.map(F);
  facts.rr = Number(plan.rr).toFixed(2);
  return { signal: out, facts };
}

// ── AI REASONING ──
const SYS_MANUAL = `Kamu adalah konsultan analis trading spesialis SMC (Market Structure, Fibonacci OTE, Order Block, FVG, Supply & Demand) yang menjelaskan hasil scan sistem secara faktual dan santai.
ATURAN MUTLAK ANTI-HALUSINASI:
DILARANG KERAS mengarang atau mengubah angka harga yang TIDAK ADA di dalam JSON input. Salin angka persis dari JSON.
DILARANG mengubah tipe order (jika orderType = "MARKET" sebut eksekusi sekarang; jika orderType = "LIMIT" sebut pending LIMIT).
Jika role = "counter": jelaskan bahwa ini counter-trend yang valid karena struktur M5 dan zona pantulan sendiri, dan targetnya mengarah ke zona utama.
Jika role = "bounce": jelaskan bahwa ini bounce scalp di zona Supply/Demand fresh, tanpa konfirmasi CHoCH M5, dan tunggu harga menyentuh zona.
Jika role = "nearest": jelaskan bahwa ini sinyal zona terdekat karena belum ada setup struktur, sebut jarak entry dari harga persis dari JSON, dan sebutkan CRT High/CRT Low bila ada field crtHigh/crtLow.
Jika field oco ada: jelaskan dua limit (legs) beserta angkanya, dan bahwa jika salah satu terisi, yang lain dibatalkan.
Jika tpMode ada: sebutkan bahwa TP mengikuti band risk (riskPips) beserta rasio TP-nya. Jika tpMode = "CRT", sebutkan TP3 menuju sisi range berlawanan.
Jika field crtHigh dan crtLow ada (Intraday/Swing): sebutkan CRT High dan CRT Low serta area WNS SELL dan WNS BUY persis angkanya, walau status STANDBY.
Jika field invalid ada: sebutkan bahwa SL berada di luar level invalidasi struktur (swing/gap/distal zona) pada angka itu.
Jika field entryNote ada: sebutkan alasan pilihan NOW atau LIMIT pullback persis dari field itu.
Jika status = "RUNNING" atau "PENDING": sebutkan arah, bias HTF (bias), zona POI, serta angka persis entry, SL, dan TP. Jika confirmed = false, sebutkan bahwa konfirmasi M1 belum ada.
Jika status = "STANDBY": sebutkan alasan dari standbyReason, checklist yang OK dan yang BELUM, zona dari watch (jika ada), dan syarat dari syarat.
Pakai "saya" atau "kita". JANGAN pakai daftar/bullet atau tanda bintang (*). WAJIB tulis 4 sampai 6 kalimat lengkap.
Tulis "id" dalam Bahasa Indonesia dan "en" dalam Bahasa Inggris natural dengan isi/angka yang sama persis.
Balas HANYA JSON valid tanpa kode blok: {"id":"...","en":"..."}`;

const SYS_BOT_EA = `Kamu adalah mentor trading yang menjelaskan keputusan bot scalper bergaya EA (aturan pasti berbasis EMA dan ATR) dengan bahasa santai dan mengalir.
ATURAN MUTLAK:
DILARANG mengarang atau mengubah angka yang tidak ada di JSON input. Salin angka persis dari JSON.
JANGAN pakai bullet, daftar, atau tanda bintang. Tulis paragraf utuh, 4 sampai 6 kalimat.
Jelaskan alur bot: tren M5 (EMA20 vs EMA50, field "htf" dan "bias"), filter M15, lalu pemicu M1 yaitu pullback ke EMA20 dan candle konfirmasi (field "checklist" dan "m1").
Jika STANDBY: sebutkan persis syarat mana yang BELUM terpenuhi dari "checklist" dan "standbyReason", dan apa yang ditunggu bot.
Jika RUNNING/PENDING: sebutkan arah, entry, SL, dan TP persis dari JSON. Jelaskan bahwa SL berbasis ATR dan TP hanya satu target (tp1, sama dengan tp2 dan tp3) dengan rasio 1:1,5 dari jarak SL.
Jangan menyebut zona Supply/Demand, Order Block, atau CHoCH karena bot ini tidak memakainya.
Pakai kata "saya" atau "kita".
Tulis "id" dalam Bahasa Indonesia dan "en" dalam Bahasa Inggris natural dengan isi/angka yang sama persis.
Balas HANYA JSON valid tanpa kode blok: {"id":"...","en":"..."}`;

const SYS_BOT = `Kamu adalah mentor trading senior spesialis SMC (Market Structure, Order Block, FVG, Supply & Demand) yang sedang menjelaskan analisa bot scalper ke muridnya dengan gaya bercerita (story telling) yang santai, dinamis, dan mengalir.
ATURAN MUTLAK:
DILARANG KERAS mengarang atau mengubah angka harga yang tidak ada di JSON input. Salin angka persis dari JSON.
JANGAN gunakan bullet points, daftar angka, atau tanda bintang (*). Tulis dalam bentuk paragraf utuh yang mengalir (minimal 5-7 kalimat).
Buka cerita dengan kondisi HTF berdasarkan field "bias" dan "htf" (misal M15 atau H1), apakah sedang tren naik, turun, atau ranging, dan apakah ada BOS, MSS, atau CHoCH mengacu ke field "m1".
Lanjut ke rencana eksekusi dari field "checklist" dan "trigger": POI mana yang dipakai bot, apakah bot menunggu retracement ke POI, dan sebutkan batas bawah dan atas zona dari field "watch" bila ada.
Berikan skenario dinamis: jika harga berbalik (reversal) apa rencananya, jika lanjut (continuation) targetnya ke mana, dan syarat konfirmasi strukturnya, memakai level yang ada di JSON.
Jika bot STANDBY: jelaskan dengan santai apa yang sedang ditunggu berdasarkan "checklist" dan "standbyReason", serta zona dari "watch".
Jika bot RUNNING/PENDING: jelaskan arah, tier, trigger, entry, SL, dan TP persis dari JSON. Jika tier diawali "ICT", tegaskan bahwa ini setup POI ICT M15 dengan eksekusi limit M5.
Gunakan kata "saya" atau "kita".
Tulis "id" dalam Bahasa Indonesia dan "en" dalam Bahasa Inggris natural dengan isi/angka yang sama persis.
Balas HANYA JSON valid tanpa kode blok: {"id":"...","en":"..."}`;

const NUM_RE = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;
function parseNum(tok) {
  let s = String(tok);
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  return Number(s);
}
function collectNums(v, out = []) {
  if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  else if (typeof v === 'string') {
    for (const t of v.match(NUM_RE) || []) { const n = parseNum(t); if (Number.isFinite(n)) out.push(n); }
  } else if (Array.isArray(v)) v.forEach(x => collectNums(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => collectNums(x, out));
  return out;
}
function findUnknownPrice(text, facts) {
  try {
    if (!text || typeof text !== 'string') return null;
    const price = Number(facts?.price);
    if (!(price > 0)) return null;
    const allowed = collectNums(facts);
    const dec = Number.isFinite(facts?.dec) ? facts.dec : 2;
    const tol = dec >= 2 ? 0.5 * Math.pow(10, -(dec - 1)) : 0.6 * Math.pow(10, -dec);
    for (const t of text.match(NUM_RE) || []) {
      const n = parseNum(t);
      if (!Number.isFinite(n)) continue;
      if (Math.abs(n - price) / price >= 0.05) continue;
      if (!allowed.some(a => Math.abs(a - n) <= tol)) return t;
    }
    return null;
  } catch { return null; }
}
function extractContent(data) {
  const c = data?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => p?.text || '').join('');
  return '';
}
function stripThink(s) {
  return String(s || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}
function parseJsonLoose(text) {
  const s = String(text || '')
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1')
    .trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
async function qwenJson(sys, userObj, maxTokens = QWEN_MAX_TOKENS, deadlineMs = QWEN_DEADLINE_MS, models = QWEN_MODELS, keys = QWEN_KEYS) {
  if (!keys.length) return { json: null, error: 'API key AI belum diatur (QWEN_API_KEY / OPENAI_API_KEY)' };
  const user = JSON.stringify(userObj);
  const deadline = Date.now() + deadlineMs;
  let lastErr = 'semua model gagal';
  for (const m of models) {
    for (const k of keys.slice(0, 2)) {
      const left = deadline - Date.now();
      if (left < 2500) return { json: null, error: `timeout AI (sisa ${left} ms)` };
      try {
        const r = await httpJson(`${QWEN_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: m, max_tokens: maxTokens, temperature: 0.1,
            messages: [
              { role: 'system', content: sys + '\nBalas hanya objek JSON tanpa penjelasan dan tanpa markdown.' },
              { role: 'user', content: user },
            ],
          }),
        }, Math.min(QWEN_TIMEOUT_MS, left));
        if (!r.ok) {
          lastErr = `${m} HTTP ${r.status}: ${(r.data?.error?.message || r.text || '').slice(0, 160)}`;
          console.warn('qwenJson:', lastErr);
          continue;
        }
        const raw = stripThink(extractContent(r.data));
        const parsed = parseJsonLoose(raw);
        if (parsed && parsed.id && parsed.en) return { json: parsed, error: '' };
        const finish = r.data?.choices?.[0]?.finish_reason || '-';
        lastErr = raw
          ? `${m}: respons bukan JSON {id,en}. Potongan: ${raw.slice(0, 120)}`
          : `${m}: respons kosong (finish_reason=${finish})`;
        console.warn('qwenJson:', lastErr);
      } catch (e) {
        lastErr = `${m}: ${e.message}`;
        console.warn('qwenJson:', lastErr);
      }
    }
  }
  return { json: null, error: lastErr };
}
function fbZone(f, id) {
  if (!f.zone) return id ? `area ${f.zoneTf || f.trigTf || 'M5'}` : `${f.zoneTf || f.trigTf || 'M5'} area`;
  return id ? `zona ${f.zone.label} di ${f.zone.lower}–${f.zone.upper}` : `${f.zone.label} zone at ${f.zone.lower}–${f.zone.upper}`;
}
function fbWatch(f, id) {
  const list = (f.watch || []).map(w => `${w.tf} ${w.tipe} ${w.bawah}–${w.atas} (${w.status}, ${w.di_dalam ? 'harga di dalam' : w.jarak_pip + ' pip'})`).join('; ');
  if (!list) return id ? 'Belum ada zona POI fresh di dekat harga.' : 'No fresh POI zone near price yet.';
  return id ? `Zona yang sedang saya pantau: ${list}.` : `Zones currently watched: ${list}.`;
}
function fallbackStory(f, lang) {
  const id = lang === 'id';
  const biasTxt = f.bias || (id ? 'netral' : 'neutral');
  const trigTxt = f.trigger || (f.zone && f.zone.label) || f.style || 'setup';
  if (f.mode === 'manual') {
    const wns = f.crtHigh != null && f.crtLow != null
      ? (id
        ? `Area CRT High ${f.crtHigh} dan CRT Low ${f.crtLow}${f.wns ? `, dengan WNS SELL ${f.wns.sell.lo}–${f.wns.sell.hi} dan WNS BUY ${f.wns.buy.lo}–${f.wns.buy.hi}` : ''}.`
        : `CRT High ${f.crtHigh} and CRT Low ${f.crtLow}${f.wns ? `, WNS SELL ${f.wns.sell.lo}–${f.wns.sell.hi} and WNS BUY ${f.wns.buy.lo}–${f.wns.buy.hi}` : ''}.`)
      : '';
    if (f.status === 'STANDBY') {
      const checkTxt = (f.checklist || []).slice(0, 4).join(' ');
      return id
        ? `Saya masih menunggu setup valid di ${f.symbol}. Bias saat ini ${biasTxt}. ${wns} ${f.standbyReason || ''} ${checkTxt} ${fbWatch(f, true)}`
        : `I am still waiting for a valid setup on ${f.symbol}. Current bias is ${biasTxt}. ${wns} ${f.standbyReason || ''} ${checkTxt} ${fbWatch(f, false)}`;
    }
    const now = f.orderType === 'MARKET';
    const crtTxt = f.tpMode === 'CRT'
      ? (id ? ' Ini setup CRT: TP3 menuju sisi range berlawanan.' : ' This is a CRT setup: TP3 targets the opposite side of the range.')
      : '';
    const roleTxt = f.role === 'nearest' ? (id ? 'Zona terdekat' : 'Nearest zone')
      : f.role === 'bounce' ? 'Bounce scalp'
      : f.role === 'counter' ? 'Counter-trend' : 'Main';
    return id
      ? `${roleTxt} ${f.signal} valid di ${f.symbol} dengan bias ${biasTxt} pada ${fbZone(f, true)} (${trigTxt}). ${wns} ${now ? `Eksekusi MARKET sekarang di ${f.entry}` : `Pasang pending LIMIT di ${f.entry}`}, SL di ${f.sl}, dan target TP di ${tpListTxt(f.tp, true)}.${crtTxt}`
      : `${roleTxt} ${f.signal} valid on ${f.symbol} aligned with ${biasTxt} bias at ${fbZone(f, false)} (${trigTxt}). ${wns} ${now ? `Execute MARKET now at ${f.entry}` : `Place pending LIMIT at ${f.entry}`}, SL at ${f.sl}, and targets at ${tpListTxt(f.tp, false)}.${crtTxt}`;
  }
  if (f.signal === 'BUY' || f.signal === 'SELL') {
    const now = f.orderType === 'MARKET';
    return id
      ? `Sinyal ${f.dirTxt} bot aktif melalui ${f.trigger}. ${now ? `Eksekusi MARKET di ${f.entry}` : `Pasang LIMIT di ${f.entry}`}, SL di ${f.sl}, dan TP di ${f.tp[0]}, ${f.tp[1]}, ${f.tp[2]}. ${fbWatch(f, true)}`
      : `Bot ${f.dirTxt} signal triggered via ${f.trigger}. ${now ? `Execute MARKET at ${f.entry}` : `Place LIMIT at ${f.entry}`}, SL at ${f.sl}, and TP at ${f.tp[0]}, ${f.tp[1]}, ${f.tp[2]}. ${fbWatch(f, false)}`;
  }
  const checkTxt = (f.checklist || []).slice(0, 3).join(' ');
  return id
    ? `Bot sedang memantau ${f.symbol} M1. Bias HTF ${biasTxt}. Status: ${f.m1 || '-'}. ${f.standbyReason || ''} ${checkTxt} ${fbWatch(f, true)}`
    : `Bot is scanning ${f.symbol} M1. HTF bias ${biasTxt}. Status: ${f.m1 || '-'}. ${f.standbyReason || ''} ${checkTxt} ${fbWatch(f, false)}`;
}
function isUsableStory(s, facts) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 40) return false;
  if (t.split(/\s+/).length < 6) return false;
  if (facts?.symbol && t.toUpperCase() === String(facts.symbol).toUpperCase()) return false;
  return true;
}
const storyCache = new Map();
const aiStickyCache = new Map();
const AI_STICKY_MS = 3 * 60 * 1000;
const sv = v => (v == null ? '' : String(v));
function setupKey(f) {
  return [f.mode, f.symbol, f.style, f.status, f.signal, f.entry, f.sl, f.trigger, f.tier, f.bias, f.standbyReason].map(sv).join('|');
}
async function getStory(facts, cacheKey, ttl = BOT_CFG.storyTtlMs) {
  if (cacheKey) {
    const hit = storyCache.get(cacheKey);
    if (hit && Date.now() - hit.t < hit.ttl) return hit.v;
  }
  const key = setupKey(facts);
  let story = null, aiError = '';
  try {
    const deadlineMs = facts.mode === 'manual' ? QWEN_MANUAL_DEADLINE_MS : QWEN_DEADLINE_MS;
    const isBotStory = facts.mode === 'bot';
    const sysPrompt = !isBotStory
      ? SYS_MANUAL
      : String(facts.tier || '').startsWith('ICT') ? SYS_BOT : SYS_BOT_EA;
    const { json, error } = await qwenJson(
      sysPrompt, facts, QWEN_MAX_TOKENS, deadlineMs,
      isBotStory ? QWEN_BOT_MODELS : QWEN_MANUAL_MODELS,
      isBotStory ? QWEN_KEYS : QWEN_MANUAL_KEYS,
    );
    if (!json) aiError = error || 'AI tidak memberi jawaban';
    else if (!isUsableStory(json.id, facts) || !isUsableStory(json.en, facts)) {
      aiError = 'jawaban AI terlalu pendek atau hanya nama simbol';
    } else {
      const badNum = findUnknownPrice(json.id, facts) || findUnknownPrice(json.en, facts);
      if (badNum) aiError = `angka ${badNum} di jawaban AI tidak ada di data`;
      else story = { id: String(json.id), en: String(json.en), ai: true };
    }
  } catch (e) { aiError = e.message; }
  if (story) {
    aiStickyCache.set(key, { t: Date.now(), story });
    if (aiStickyCache.size > 300) aiStickyCache.delete(aiStickyCache.keys().next().value);
  } else if (facts.status !== 'STANDBY') {
    const st = aiStickyCache.get(key);
    if (st && Date.now() - st.t < AI_STICKY_MS) story = { ...st.story, sticky: true, aiError };
  }
  if (!story) {
    console.warn('getStory fallback:', aiError);
    story = { id: fallbackStory(facts, 'id'), en: fallbackStory(facts, 'en'), ai: false, aiError };
  }
  if (cacheKey) {
    const effTtl = facts.status === 'STANDBY' && facts.mode === 'manual'
      ? Math.min(ttl, MANUAL_STANDBY_TTL_MS)
      : (story.ai ? ttl : Math.min(ttl, 60000));
    storyCache.set(cacheKey, { t: Date.now(), ttl: effTtl, v: story });
    if (storyCache.size > 300) storyCache.delete(storyCache.keys().next().value);
  }
  return story;
}
const storyPending = new Map();
async function getStoryFast(facts, cacheKey, ttl, budgetMs) {
  if (cacheKey) {
    const hit = storyCache.get(cacheKey);
    if (hit && Date.now() - hit.t < hit.ttl) return hit.v;
  }
  let p = cacheKey ? storyPending.get(cacheKey) : null;
  if (!p) {
    p = getStory(facts, cacheKey, ttl).finally(() => { if (cacheKey) storyPending.delete(cacheKey); });
    if (cacheKey) storyPending.set(cacheKey, p);
  }
  let timer;
  const budget = new Promise(res => { timer = setTimeout(() => res(null), budgetMs); });
  const got = await Promise.race([p, budget]);
  clearTimeout(timer);
  if (got) return got;
  return { id: fallbackStory(facts, 'id'), en: fallbackStory(facts, 'en'), ai: false, aiError: 'AI masih berjalan', pending: true };
}

// ── AI REASONING MANUAL MTF (format vision, dual bahasa) ──
const SYS_MANUAL_MTF = `Kamu analis trading spesialis SMC (Market Structure, Order Block, FVG, Supply & Demand). Kamu menjelaskan hasil scan multi-timeframe sistem secara faktual dan santai, seperti analis yang membaca beberapa chart sekaligus.
ATURAN MUTLAK ANTI-HALUSINASI:
DILARANG mengarang atau mengubah angka harga yang TIDAK ADA di JSON input. Salin angka persis dari JSON.
DILARANG mengubah tipe order: orderType "MARKET" = eksekusi sekarang, "LIMIT" = pending limit.
Untuk SETIAP item di array "steps" (urutan TF tertinggi ke terendah), tulis maksimal 2 kalimat pendek: struktur tren TF tersebut + zona S&D/OB/FVG terdekat dan posisi harga terhadap zona itu. Awali tiap item dengan nama TF-nya, contoh "M15: ...".
Lalu tulis ringkasan setup 2-3 kalimat diawali nama pair: keputusan final (arah + tipe order + entry + SL + TP persis dari JSON) dan alasan konfluensi utama dari steps.
Jika field "invalid" ada: sebutkan bahwa SL ditempatkan di luar level invalidasi struktur (swing high/low, tepi gap, atau distal zona) pada angka itu.
Jika field "entryNote" ada: sebutkan alasan pilihan NOW atau LIMIT pullback persis dari field itu.
Jika status "STANDBY": ringkasan menjelaskan apa yang ditunggu berdasarkan standbyReason dan steps, tanpa menyebut entry/SL/TP.
Pakai "saya" atau "kita". Jangan pakai bullet atau tanda bintang di dalam string.
WAJIB dual bahasa: perTfId & id dalam Bahasa Indonesia; perTfEn & en dalam Bahasa Inggris natural, isi dan angka sama persis.
Balas HANYA JSON valid tanpa kode blok: {"perTfId":["M15: ...","M5: ..."],"perTfEn":["M15: ...","M5: ..."],"id":"...","en":"..."}`;

async function getMtfStory(facts, cacheKey, ttl = MANUAL_STORY_TTL_MS) {
  if (cacheKey) {
    const hit = storyCache.get(cacheKey);
    if (hit && Date.now() - hit.t < hit.ttl) return hit.v;
  }
  const fb = {
    id: facts.reasonId || mtfFallbackReason(facts, false),
    en: facts.reasonEn || mtfFallbackReason(facts, true),
    ai: false,
  };
  let story = null, aiError = '';
  try {
    const { json, error } = await qwenJson(SYS_MANUAL_MTF, facts, QWEN_MAX_TOKENS, QWEN_MANUAL_DEADLINE_MS, QWEN_MANUAL_MODELS, QWEN_MANUAL_KEYS);
    if (!json) aiError = error || 'AI tidak memberi jawaban';
    else if (!isUsableStory(json.id, facts) || !isUsableStory(json.en, facts)) aiError = 'jawaban AI terlalu pendek';
    else {
      const perId = Array.isArray(json.perTfId) ? json.perTfId.map(String) : null;
      const perEn = Array.isArray(json.perTfEn) ? json.perTfEn.map(String) : null;
      const allTxt = [json.id, json.en, ...(perId || []), ...(perEn || [])].join(' ');
      const badNum = findUnknownPrice(allTxt, facts);
      if (badNum) aiError = `angka ${badNum} di jawaban AI tidak ada di data`;
      else {
        const sym = String(facts.symbol || '');
        const sumId = String(json.id).toUpperCase().includes(sym) ? String(json.id) : `${sym}: ${json.id}`;
        const sumEn = String(json.en).toUpperCase().includes(sym) ? String(json.en) : `${sym}: ${json.en}`;
        const defLines = (facts.steps || []).map(s => `${s.tf}: ${s.text}`);
        story = {
          id: mtfLayoutReason(facts, false, perId || defLines, sumId),
          en: mtfLayoutReason(facts, true, perEn || defLines, sumEn),
          ai: true,
        };
      }
    }
  } catch (e) { aiError = e.message; }
  if (!story) { console.warn('getMtfStory fallback:', aiError); story = { ...fb, aiError }; }
  if (cacheKey) {
    const effTtl = facts.status === 'STANDBY' ? Math.min(ttl, MANUAL_STANDBY_TTL_MS) : (story.ai ? ttl : Math.min(ttl, 60000));
    storyCache.set(cacheKey, { t: Date.now(), ttl: effTtl, v: story });
    if (storyCache.size > 300) storyCache.delete(storyCache.keys().next().value);
  }
  return story;
}
async function getMtfStoryFast(facts, cacheKey, ttl, budgetMs) {
  if (cacheKey) {
    const hit = storyCache.get(cacheKey);
    if (hit && Date.now() - hit.t < hit.ttl) return hit.v;
  }
  let p = cacheKey ? storyPending.get(cacheKey) : null;
  if (!p) {
    p = getMtfStory(facts, cacheKey, ttl).finally(() => { if (cacheKey) storyPending.delete(cacheKey); });
    if (cacheKey) storyPending.set(cacheKey, p);
  }
  let timer;
  const budget = new Promise(res => { timer = setTimeout(() => res(null), budgetMs); });
  const got = await Promise.race([p, budget]);
  clearTimeout(timer);
  if (got) return got;
  return {
    id: facts.reasonId || mtfFallbackReason(facts, false),
    en: facts.reasonEn || mtfFallbackReason(facts, true),
    ai: false, aiError: 'AI masih berjalan', pending: true,
  };
}

// ── DUAL BAHASA: fallback translate bila versi EN tidak tersedia ──
const SYS_TRANSLATE = `Terjemahkan teks analisa trading ke Bahasa Inggris yang natural dan profesional.
PERTAHANKAN semua angka, nama pair, simbol, dan struktur baris (bullet "•", header "[...]", blok "[Setup]", nama TF).
Jangan menambah atau mengurangi informasi.
Balas HANYA JSON valid: {"id":"<teks asli apa adanya>","en":"<terjemahan Inggris>"}`;
async function ensureEnglishReason(sig, lang) {
  if (!sig || !sig.reasons) return sig;
  if (sig.reasons.en && sig.reasons.en !== sig.reasons.id) {
    sig.reason = lang === 'en' ? sig.reasons.en : sig.reasons.id;
    return sig;
  }
  try {
    const { json } = await qwenJson(SYS_TRANSLATE, { text: sig.reasons.id }, 900, 6000, QWEN_MANUAL_MODELS, QWEN_MANUAL_KEYS);
    if (json && typeof json.en === 'string' && json.en.trim().length > 20) sig.reasons.en = json.en.trim();
  } catch (e) { console.warn('ensureEnglishReason:', e.message); }
  sig.reason = lang === 'en' ? sig.reasons.en : sig.reasons.id;
  return sig;
}

const SYS_GATE_MANUAL = `Kamu adalah filter veto untuk kandidat setup MANUAL SMC.
Kamu DILARANG membuat setup baru dan DILARANG mengubah angka entry, SL, TP, atau tipe order.
Jawab "TUNGGU" HANYA jika terbukti ada salah satu kontradiksi berikut:
arah_setup berlawanan dengan arah_htf, KECUALI role = "counter" atau role = "bounce". Counter-trend dan bounce sudah divalidasi struktur/zona sendiri, jadi jangan tolak karena arah.
regime_htf = "choppy".
jarak_entry_pip > batas_jarak_pip.
alasan_aturan kosong.
Jika tidak ada satupun dari 4 pelanggaran di atas, WAJIB jawab "AMBIL".
Jangan terlalu kaku pada syarat POI jika struktur M5 atau zona bounce sudah valid. Prioritaskan arah dan momentum.
FORMAT OUTPUT (hanya JSON, tanpa markdown):
{"keputusan":"AMBIL" atau "TUNGGU","alasan":"..."}`;
async function aiGateManual(input) {
  const fallback = { keputusan: 'AMBIL', alasan: 'Sesuai validasi aturan SMC', ai: false };
  if (!QWEN_MANUAL_KEYS.length) return fallback;
  const deadline = Date.now() + QWEN_MANUAL_DEADLINE_MS;
  for (const k of QWEN_MANUAL_KEYS.slice(0, 2)) {
    const left = deadline - Date.now();
    if (left < 1500) return fallback;
    try {
      const r = await httpJson(`${QWEN_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: QWEN_MANUAL_MODEL, max_tokens: 800, temperature: 0,
          messages: [{ role: 'system', content: SYS_GATE_MANUAL }, { role: 'user', content: JSON.stringify(input) }],
        }),
      }, Math.min(QWEN_MANUAL_DEADLINE_MS, left));
      if (!r.ok) continue;
      const parsed = parseJsonLoose(stripThink(extractContent(r.data)));
      if (parsed && ['AMBIL', 'TUNGGU'].includes(parsed.keputusan)) {
        return { keputusan: parsed.keputusan, alasan: String(parsed.alasan || '').slice(0, 200), ai: true };
      }
    } catch (e) { console.warn('aiGateManual:', e.message); }
  }
  return fallback;
}

// ── VISION (dual bahasa) ──
const VISION_BASE = `Kamu adalah analis trading spesialis SUPPLY & DEMAND (RBR/DBR/RBD/DBD), Order Block, dan Market Structure.
ATURAN MUTLAK:
Analisis SETIAP GAMBAR di array "perImageAnalyses" (Bahasa Indonesia, maks 2 kalimat pendek per gambar: struktur tren + zona S&D/OB terdekat) dan "perImageAnalysesEn" (versi Inggris natural, isi sama).
Top-down: struktur tren dari TF tertinggi menentukan arah utama, zona S&D dari TF menengah, Order Block dari TF terendah.
Pilih SATU zona S&D/OB terbaik yang searah struktur tren dan terdekat dengan harga sekarang.
WAJIB MENGHASILKAN SIGNAL BUY atau SELL. Jawab "NONE" HANYA jika gambar bukan chart atau tidak terbaca.
Entry: LIMIT di proximal atau 50% body OB jika harga belum menyentuh zona. MARKET hanya jika harga sudah berada di dalam zona OB dan ada penolakan (wick / engulfing / CHoCH mikro).
SL di luar distal zona + buffer kecil (di luar swing low/high atau tepi gap yang menjadi invalidasi). BUY: sl < entry. SELL: sl > entry.
Semua level (entry, sl, tp, zoneLow, zoneHigh) WAJIB dibaca persis dari skala sumbu kanan chart.
"reason" maksimal 3 kalimat Bahasa Indonesia diawali nama pair; "reasonEn" versi Inggris natural dengan angka yang sama persis.
PAIR: salin NAMA PAIR persis seperti tertulis di judul/header chart, lalu ubah ke format tanpa spasi/garis miring (contoh: judul 'XXX / YYY' -> XXXYYY). Jangan memakai contoh pair lain dan jangan menebak dari harga atau pengetahuanmu. Jika tidak terbaca, isi pair dengan "".
DESIMAL: hitung jumlah digit desimal dari label harga pada sumbu harga chart yang sedang dianalisa, lalu isi "decimals". Semua harga harus memakai desimal itu.
Balas HANYA JSON valid tanpa kode blok:
{"signal":"BUY|SELL","orderType":"MARKET|LIMIT","entry":0,"sl":0,"tp1":0,"tp2":0,"tp3":0,"setup":"","confidence":"HIGH|MEDIUM|LOW","risk":"LOW|MEDIUM|HIGH","perImageAnalyses":["Gambar 1: ..."],"perImageAnalysesEn":["Image 1: ..."],"reason":"PAIR: ...","reasonEn":"PAIR: ...","topDown":"...","zone":"Demand","pair":"PEPEUSDT","pairRaw":"PEPE / TetherUS","decimals":0,"zoneLow":0,"zoneHigh":0}`;
function buildVisionSystem(style) {
  const map = {
    'Scalping': 'STYLE: SCALPING S&D/OB (M15 Bias & S&D -> M5 OB -> M1 Konfirmasi). Cari zona S&D/OB terdekat searah struktur M15.',
    'Intraday': 'STYLE: INTRADAY S&D/OB (H4 Bias -> H1 S&D -> M15 OB). Arah dari H4, zona H1/M15.',
    'Swing': 'STYLE: SWING S&D/OB (Weekly/Daily Bias -> H4 OB). Arah dari Daily/Weekly, zona H4/Daily.',
  };
  return `${VISION_BASE}\n\n${map[style] || map['Scalping']}`;
}
const PAIR_ALIAS = {
  GOLD: 'XAUUSD', XAUUSDX: 'XAUUSD', SILVER: 'XAGUSD', XAGUSDX: 'XAGUSD',
  BTCUSDT: 'BTCUSD', ETHUSDT: 'ETHUSD', SOLUSDT: 'SOLUSD', XRPUSDT: 'XRPUSD', BNBUSDT: 'BNBUSD', ADAUSDT: 'ADAUSD', DOGEUSDT: 'DOGEUSD',
  US500: 'SPX500', SPX: 'SPX500', SP500: 'SPX500', US100: 'NAS100', NDX: 'NAS100', NASDAQ: 'NAS100', NASDAQ100: 'NAS100',
  DJI: 'US30', DOW: 'US30', DOWJONES: 'US30', DE40: 'GER40', DAX: 'GER40', GER30: 'GER40', DE30: 'GER40',
  JP225: 'JPN225', NIKKEI: 'JPN225', NI225: 'JPN225', FTSE: 'UK100', FTSE100: 'UK100', 'CAC 40': 'FRA40',
  USOIL: 'WTI', CRUDEOIL: 'WTI', UKOIL: 'BRENT', BRENTOIL: 'BRENT', DOLLARINDEX: 'DXY', USDX: 'DXY',
};
function normPair(raw) {
  let k = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!k) return null;
  if (PAIR_ALIAS[k]) k = PAIR_ALIAS[k];
  return k;
}
function pairSpec(pair, price, decHint) {
  const sym = normPair(pair);
  let dec = sym ? DECIMALS[sym] : undefined;
  if (dec === undefined && Number.isInteger(decHint) && decHint >= 0 && decHint <= 10) dec = decHint;
  if (dec === undefined) {
    if (sym && /^[A-Z]{6}$/.test(sym)) dec = sym.includes('JPY') ? 3 : 5;
    else dec = price < 10 ? 5 : price < 500 ? 3 : 2;
  }
  let pip = pipSizeOf(sym || '', dec);
  if (!(Number.isFinite(pip) && pip > 0)) pip = Math.pow(10, -dec) * 10;
  return { sym: sym || 'CHART', dec, pip };
}
function fmtPriceText(text, entry, dec) {
  return String(text || '').replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+/g, tok => {
    const v = Number(tok.replace(/,/g, ''));
    if (!Number.isFinite(v) || !(entry > 0)) return tok;
    return Math.abs(v - entry) / entry < 0.05 ? v.toFixed(dec) : tok;
  });
}
function checkVisionSignal(j) {
  if (!j || typeof j !== 'object') return 'Respons AI tidak bisa dibaca.';
  const sig = String(j.signal || 'NONE').toUpperCase();
  if (sig === 'NONE') return String(j.reason || 'Tidak ada setup valid pada gambar.');
  if (sig !== 'BUY' && sig !== 'SELL') return 'Sinyal AI tidak dikenali.';
  const e = Number(j.entry), s = Number(j.sl);
  if (![e, s].every(Number.isFinite) || e <= 0 || s <= 0) return 'Entry/SL tidak lengkap.';
  if (!(sig === 'BUY' ? s < e : s > e)) return 'Level SL tidak konsisten dengan arah sinyal.';
  if (Math.abs(e - s) / e > 0.05) return 'Level SL tidak sesuai skala harga chart.';
  return null;
}
function buildVisionSignal(j, style, lang, imgCount) {
  const sig = String(j.signal).toUpperCase();
  const isLimit = String(j.orderType || '').toUpperCase() === 'LIMIT';
  const lvl = (v, allowed, dflt) => (allowed.includes(String(v || '').toUpperCase()) ? String(v).toUpperCase() : dflt);
  const rawEntry = Number(j.entry), rawSl = Number(j.sl);
  const { sym, dec, pip } = pairSpec(j.pair || j.pairRaw, rawEntry, Number(j.decimals));
  const f = v => Number(Number(v).toFixed(dec));
  const dir = sig === 'BUY' ? 1 : -1;
  const entry = f(rawEntry);
  let risk = Math.abs(rawEntry - rawSl);
  if (!(risk > 0)) risk = pip * 10;
  const sl = f(entry - dir * risk);

  const aiTps = [j.tp1, j.tp2, j.tp3].map(Number);
  const sideOk = aiTps.every(v => Number.isFinite(v) && v > 0 && (dir === 1 ? v > entry : v < entry));
  const orderOk = dir === 1 ? (aiTps[0] < aiTps[1] && aiTps[1] < aiTps[2]) : (aiTps[0] > aiTps[1] && aiTps[1] > aiTps[2]);
  const scaleOk = aiTps.every(v => Math.abs(v - entry) / entry < 0.05);
  const tpsFromAi = sideOk && orderOk && scaleOk;
  const [tp1, tp2, tp3] = tpsFromAi ? aiTps.map(f) : [1.5, 2.25, 3].map(k => f(entry + dir * risk * k));
  const tp4 = f(entry + dir * risk * 4);
  const tp5 = f(entry + dir * risk * 5);

  let zLo = Number(j.zoneLow), zHi = Number(j.zoneHigh);
  const zOk = Number.isFinite(zLo) && Number.isFinite(zHi) && zLo > 0 && zHi > zLo && Math.abs(zLo - entry) / entry < 0.05 && Math.abs(zHi - entry) / entry < 0.05;
  if (!zOk) { zLo = Math.min(entry, entry - dir * risk * 0.5); zHi = Math.max(entry, entry - dir * risk * 0.5); }
  zLo = f(zLo); zHi = f(zHi);
  const zoneName = String(j.zone || (dir === 1 ? 'Demand' : 'Supply')).replace(/[0-9.,\s-–]+$/g, '').trim() || (dir === 1 ? 'Demand' : 'Supply');
  const fix = t => fmtPriceText(t, entry, dec);

  const perImgId = Array.isArray(j.perImageAnalyses) && j.perImageAnalyses.length ? j.perImageAnalyses.map(item => `• ${fix(String(item).trim())}`).join('\n') : '';
  const perImgEn = Array.isArray(j.perImageAnalysesEn) && j.perImageAnalysesEn.length ? j.perImageAnalysesEn.map(item => `• ${fix(String(item).trim())}`).join('\n') : perImgId;
  let sumId = fix(String(j.reason || '').trim()) || 'Analisis AI dari chart.';
  let sumEn = fix(String(j.reasonEn || '').trim()) || sumId;
  if (!sumId.toUpperCase().includes(sym)) sumId = `${sym}: ${sumId}`;
  if (!sumEn.toUpperCase().includes(sym)) sumEn = `${sym}: ${sumEn}`;
  if (!tpsFromAi) {
    sumId += ` Target final: TP1 ${tp1}, TP2 ${tp2}, TP3 ${tp3}.`;
    sumEn += ` Final targets: TP1 ${tp1}, TP2 ${tp2}, TP3 ${tp3}.`;
  }
  const fullId = perImgId ? `[${sym} · Analisa ${imgCount} Gambar]\n${perImgId}\n\n[Setup]\n${sumId}` : sumId;
  const fullEn = perImgEn ? `[${sym} · ${imgCount}-Image Analysis]\n${perImgEn}\n\n[Setup]\n${sumEn}` : sumEn;

  const now = Date.now();
  const pips = v => Number((Math.abs(v - entry) / pip).toFixed(1));
  const rr = Number((Math.abs(tp3 - entry) / risk).toFixed(2));
  return {
    signal: sig, orderType: isLimit ? 'LIMIT' : 'MARKET', fill: isLimit ? 'LIMIT' : 'NOW', status: isLimit ? 'PENDING' : 'RUNNING',
    state: isLimit ? 'LIMIT_PLACED' : 'CONFIRMED',
    symbol: sym, pair: sym, dec, pip, style,
    entry, sl, tp1, tp2, tp3, tp4, tp5, rr,
    slPips: pips(sl), tp1Pips: pips(tp1), tp2Pips: pips(tp2), tp3Pips: pips(tp3), tp4Pips: pips(tp4), tp5Pips: pips(tp5),
    setup: fix(String(j.setup || `Vision ${style}`)),
    confidence: lvl(j.confidence, ['HIGH', 'MEDIUM', 'LOW'], 'MEDIUM'), risk: lvl(j.risk, ['LOW', 'MEDIUM', 'HIGH'], 'MEDIUM'),
    reason: lang === 'en' ? fullEn : fullId,
    reasons: { id: fullId, en: fullEn },
    chartContext: `${sym} ${sig} ${isLimit ? 'LIMIT' : 'MARKET'} ${entry.toFixed(dec)}`,
    zone: { min: zLo, max: zHi, label: `${zoneName} ${zLo.toFixed(dec)}–${zHi.toFixed(dec)}` },
    zoneLabel: `${zoneName} ${zLo.toFixed(dec)}–${zHi.toFixed(dec)}`, zoneNote: '',
    topDown: j.topDown ? fix(String(j.topDown)) : null,
    createdAt: now, time: now, ts: now, expiresAt: now + (VISION_EXPIRY_MS[style] || VISION_EXPIRY_MS['Scalping']),
    source: 'VISION_AI', aiReasoning: true, reasonSource: 'AI',
  };
}
async function runVisionAnalysis(images, style, lang) {
  if (!OPENAI_API_KEY) return { ok: false, reason: msg(lang, 'noKey') };
  const imgs = images.filter(s => typeof s === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(s));
  if (!imgs.length) return { ok: false, reason: msg(lang, 'badImage') };
  const userContent = [
    { type: 'text', text: `Jumlah gambar: ${imgs.length}. Style: ${style}. Analisa tiap gambar. Wajib isi reasonEn dan perImageAnalysesEn (Bahasa Inggris).` },
    ...imgs.flatMap((url, i) => [{ type: 'text', text: `Gambar ${i + 1}/${imgs.length}:` }, { type: 'image_url', image_url: { url } }]),
  ];
  const deadline = Date.now() + VISION_DEADLINE_MS;
  const FORCE_TXT = { type: 'text', text: 'PENTING: jawaban NONE tidak diterima. Pilih zona S&D/OB terdekat dari harga, lalu berikan BUY atau SELL lengkap dengan entry dan SL dari skala chart. Sertakan reasonEn dan perImageAnalysesEn.' };
  const callAI = (v, force = false) => {
    const left = deadline - Date.now();
    if (left < 8000) throw new Error('Timeout: layanan eksternal lama merespons');
    const body = { model: AI_VISION_MODEL, messages: [{ role: 'system', content: buildVisionSystem(style) }, { role: 'user', content: force ? [...userContent, FORCE_TXT] : userContent }] };
    if (v === 'new') body.max_completion_tokens = VISION_MAX_TOKENS; else { body.max_tokens = VISION_MAX_TOKENS; body.temperature = 0.1; }
    return httpJson(`${OPENAI_BASE_URL}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, Math.min(VISION_TIMEOUT_MS, left));
  };
  let r;
  try {
    r = await callAI('new'); if (!r.ok && r.status === 400) r = await callAI('legacy');
  } catch (e) {
    if (/Timeout/i.test(e.message)) return { ok: false, reason: 'AI terlalu lama membaca gambar. Coba lagi.' };
    return { ok: false, reason: `AI gagal: ${e.message}` };
  }
  if (!r.ok) { const detail = r.data?.error?.message || (typeof r.data?.error === 'string' ? r.data.error : '') || r.text.slice(0, 160); return { ok: false, reason: `AI gagal (HTTP ${r.status}): ${detail}` }; }
  const usage = r.data?.usage || {};
  console.log(`VISION model=${AI_VISION_MODEL} images=${imgs.length} promptTokens=${usage.prompt_tokens ?? '?'} completionTokens=${usage.completion_tokens ?? '?'}`);
  const pt = Number(usage.prompt_tokens);
  if (Number.isFinite(pt) && pt < 300 * imgs.length) {
    return { ok: false, reason: `Gambar tidak terbaca oleh model AI (${AI_VISION_MODEL}, prompt_tokens=${pt}). Cek AI_VISION_MODEL atau format gambar.` };
  }
  let parsed = parseJsonLoose(extractContent(r.data));
  const isNone = p => !p || String(p.signal || 'NONE').toUpperCase() === 'NONE' || checkVisionSignal(p);
  if (isNone(parsed) && deadline - Date.now() > 22000) {
    try {
      const r2 = await callAI('new', true);
      if (r2.ok) { const p2 = parseJsonLoose(extractContent(r2.data)); if (!isNone(p2)) parsed = p2; }
    } catch (e) { console.warn('vision retry:', e.message); }
  }
  const bad = checkVisionSignal(parsed); if (bad) return { ok: false, reason: bad };
  const sigOut = buildVisionSignal(parsed, style, lang, imgs.length);
  await ensureEnglishReason(sigOut, lang);
  sigOut.visionDebug = { model: AI_VISION_MODEL, images: imgs.length, promptTokens: usage.prompt_tokens ?? null };
  return { ok: true, signal: sigOut };
}
async function handleVision(body, lang, res) {
  const images = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
  if (!images.length) return fail(res, msg(lang, 'badImage'));
  const style = normStyle(body.style || body.mode);
  const out = await runVisionAnalysis(images, style, lang);
  if (!out.ok) return fail(res, out.reason);
  const sg = out.signal;
  return res.status(200).json({ ok: true, mode: 'vision', symbol: sg.symbol, pair: sg.pair, dec: sg.dec, pip: sg.pip, visionSymbol: 'VISION', price: sg.entry, style, signal: sg });
}

// ── UTAMA ──
function normStyle(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (k.includes('swing')) return 'Swing';
  if (k.includes('intraday')) return 'Intraday';
  return 'Scalping';
}
function manualTfs(styleName) {
  return MANUAL_TF_NEEDED[styleName] || MANUAL_TF_NEEDED['Scalping'];
}
async function handleCandles(body, lang, res, { email, isAutoBot }) {
  const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
  const styleName = isAutoBot ? BOT_STYLE : normStyle(body.style || body.mode || 'Scalping');
  const price = Number(body.price ?? body.livePrice ?? body.currentPrice ?? 0);
  if (!(price > 0)) return fail(res, msg(lang, 'noPrice'));
  const rrChoice = [0.5, 1, 1.5, 2].includes(Number(body.rr)) ? Number(body.rr) : 1;
  const dec = DECIMALS[symbol] ?? 2;
  const ctx = {
    symbol, lang, dec, price, pip: pipSizeOf(symbol, dec), gold: isGold(symbol),
    kz: getKillzoneStatus(), rr: rrChoice, debug: !!body.debug,
    f: v => Number(safeNum(v, price).toFixed(dec)),
  };
  const allTfs = ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1'];
  const candleMap = {};
  const src = {};
  for (const tf of allTfs) {
    const incoming = clientCandles(body, tf);
    if (incoming.length) {
      candleMap[tf] = incoming;
      src[tf] = 'client';
      setCandleCache(symbol, tf, incoming);
    } else {
      candleMap[tf] = [];
    }
  }
  const need = isAutoBot ? BOT_TF_NEEDED : manualTfs(styleName);
  try {
    await Promise.all(need.map(async tf => {
      if (candleMap[tf] && candleMap[tf].length >= (MIN_BARS[tf] || 25)) return;
      try {
        const rows = await fetchTickerLayerRows(symbol, TF_IV[tf], TF_NEED[tf] || 200);
        if (rows.length) {
          candleMap[tf] = rows;
          src[tf] = 'TL';
          setCandleCache(symbol, tf, rows);
          return;
        }
      } catch (e) {
        console.warn(`TL ${symbol} ${tf}:`, e.message);
      }
      const cached = getCandleCache(symbol, tf);
      if (cached.length && (!candleMap[tf] || cached.length > candleMap[tf].length)) {
        candleMap[tf] = cached;
        src[tf] = 'cache';
      }
    }));
  } catch (e) { console.warn('fallback TL parallel:', e.message); }
  const data = { price };
  for (const tf of allTfs) {
    if (!candleMap[tf] || !candleMap[tf].length) {
      const cached = getCandleCache(symbol, tf);
      if (cached.length) { candleMap[tf] = cached; src[tf] = 'cache'; }
    }
    data[tf] = candleMap[tf] || [];
  }
  if (!data.m5.length && !data.m15.length && !data.m1.length) {
    console.warn(`DIAG ${isAutoBot ? 'BOT' : 'MANUAL'} ${symbol} ${styleName} noCandles src=${JSON.stringify(src)}`);
    return fail(res, msg(lang, 'noCandles'));
  }
  let out;
  try {
    ctx.prevCandleT = (isAutoBot && body.prevSignal?.style === BOT_STYLE && Number.isFinite(Number(body.prevSignal?.candleT))) ? Number(body.prevSignal.candleT) : null;
    out = isAutoBot ? runBot(ctx, data) : await runManual(ctx, data, styleName);
  } catch (e) {
    console.error('engine error:', e);
    out = standbyOut({ mode: isAutoBot ? 'bot' : 'manual', symbol, style: styleName, status: 'STANDBY', dec }, `Analisa sementara gagal (${e.message}). Akan dicoba lagi.`, [], null);
  }
  if (!out || !out.signal) {
    out = standbyOut({ mode: isAutoBot ? 'bot' : 'manual', symbol, style: styleName, status: 'STANDBY', dec }, 'Menunggu data/setup valid.', [], null);
  }
  if (isAutoBot && out.signal.status !== 'STANDBY') {
    try { await markTrialAsUsed(email); } catch (e) { console.warn('markTrialAsUsed:', e.message); }
  }
  const diagFacts = out.facts || {};
  const diag = {
    who: isAutoBot ? 'BOT' : 'MANUAL',
    at: new Date().toISOString(),
    status: out.signal.status,
    reason: diagFacts.standbyReason || null,
    wns: diagFacts.wns || null,
    crtHigh: diagFacts.crtHigh ?? null,
    crtLow: diagFacts.crtLow ?? null,
    tier: diagFacts.tier || null,
    internal: diagFacts.internal || null,
    entryNote: diagFacts.entryNote || null,
    checks: (Array.isArray(out.signal.checklist) ? out.signal.checklist : []).slice(-8),
    bars: Object.fromEntries(['m1', 'm5', 'm15', 'h1', 'h4', 'd1'].map(t => [t, (data[t] || []).length])),
    src,
    liveM1: !!getFormingM1(data.m1),
    sticky: false,
  };
  console.log(`DIAG ${diag.who} ${symbol} ${styleName} ${diag.status} tier=${diag.tier || '-'} | ${diag.reason || '-'} | bars=${JSON.stringify(diag.bars)} src=${JSON.stringify(src)} live=${diag.liveM1}`);

  // Lifecycle: signal hidup dipertahankan & dikelola, tidak dibatalkan scanner/gate.
  const life = prevLifecycle(body.prevSignal, symbol, styleName, price, ctx.pip);
  const ocKey = `${symbol}|${styleName}`;
  if (life && life.dead) outcomeCache.set(ocKey, { dir: life.prev.signal, outcome: life.outcome, t: Date.now() });
  if (life && !life.dead) {
    const managed = { ...life.prev, ...life.patch, sticky: true };
    const newSig = out.signal;
    const oc = outcomeCache.get(ocKey);
    const cooldownBlock = oc && oc.outcome !== 'TP3' && Date.now() - oc.t < OUTCOME_COOLDOWN_MS && newSig.signal === oc.dir;
    const oppositeNew = newSig.status !== 'STANDBY' && newSig.signal !== managed.signal;
    const replace = oppositeNew && !cooldownBlock &&
      (body.forceNew || (isAutoBot && Date.now() - Number(managed.createdAt || 0) > BOT_CFG.flipCooldownMs));
    if (!replace) {
      const lastM1 = data.m1 && data.m1.length ? data.m1[data.m1.length - 1] : null;
      if (isAutoBot) managed.nextCloseAt = lastM1 ? tsMs(lastM1.t) + TF_MS.m1 : null;
      if (managed.reasons) managed.reason = lang === 'en' ? (managed.reasons.en || managed.reasons.id) : (managed.reasons.id || managed.reasons.en);
      return res.status(200).json({ ok: true, mode: isAutoBot ? 'bot' : 'candles', symbol, style: styleName, price, signal: managed, diag: { ...diag, sticky: true, lifecycle: managed.state } });
    }
  }
  // Cooldown arah sama setelah SL/INVALID (mencegah entry berulang ke arah yang sama).
  const oc2 = outcomeCache.get(ocKey);
  if (out.signal.status !== 'STANDBY' && oc2 && ['SL', 'INVALID'].includes(oc2.outcome) &&
      Date.now() - oc2.t < OUTCOME_COOLDOWN_MS && out.signal.signal === oc2.dir) {
    const mins = Math.ceil((OUTCOME_COOLDOWN_MS - (Date.now() - oc2.t)) / 60000);
    out = standbyOut(out.facts || { mode: isAutoBot ? 'bot' : 'manual', symbol, style: styleName, dec },
      `Cooldown ${mins} menit setelah ${oc2.outcome} ${oc2.dir}; menunggu struktur internal baru searah.`,
      out.signal.checklist || [], out.signal.topDown);
  }

  if (out.signal.status !== 'STANDBY') {
    out.signal.createdAt = Date.now();
  }
  if (isAutoBot) {
    const last = data.m1 && data.m1.length ? data.m1[data.m1.length - 1] : null;
    out.signal.nextCloseAt = last ? tsMs(last.t) + TF_MS.m1 : null;
  }
  const f = out.facts || { mode: isAutoBot ? 'bot' : 'manual', symbol, style: styleName, status: out.signal.status, dec };
  const cacheKey = isAutoBot
    ? `${symbol}|${styleName}|${f.status}|${f.signal || ''}|${f.trigger || ''}|${f.bias || ''}|${f.tier || ''}`
    : `M|${symbol}|${styleName}|${f.status}|${f.signal || ''}|${f.entry || ''}|${String(f.standbyReason || '').slice(0, 60)}`;

  const isMtf = !isAutoBot && out.signal.reasonFormat === 'mtf';
  const story = isMtf
    ? await getMtfStoryFast(f, `MTF|${cacheKey}`, MANUAL_STORY_TTL_MS, BOT_CFG.storyBudgetManualMs)
    : await getStoryFast(f, cacheKey, isAutoBot ? BOT_CFG.storyTtlBotMs : MANUAL_STORY_TTL_MS, isAutoBot ? BOT_CFG.storyBudgetBotMs : BOT_CFG.storyBudgetManualMs);

  const signal = {
    ...out.signal,
    reason: lang === 'en' ? story.en : story.id,
    reasons: { id: story.id, en: story.en },
    reasonSource: story.ai ? 'AI' : (isMtf ? 'MTF' : 'RULES'),
    aiReasoning: !!story.ai,
    ...(ctx.debug ? { aiError: story.aiError || null } : {}),
  };
  return res.status(200).json({ ok: true, mode: isAutoBot ? 'bot' : 'candles', symbol, style: styleName, price, signal, diag });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-email');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);
  try {
    let body = req.body || {};
    if (typeof body === 'string') try
