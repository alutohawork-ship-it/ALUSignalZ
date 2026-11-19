// api/generate.js — v142
// MANUAL (Scalping tunggal, Intraday, Swing): lib/manual_scalp.js → gate AI (veto saja) → signal NOW atau LIMIT sesuai kondisi.
// BOT (AUTOBOT XAUUSD)                      : lib/bot_sma.js — SMA20 + Market Structure M1 (continuation). Tanpa CHoCH/OB/FVG.
// AI REASONING                              : konsultan ngobrol, fallback narasi bila AI gagal.
//
// Perubahan v142:
//  - Gaya manual hanya "Scalping". Agresif & Konservatif dihapus (Day Trading dipetakan ke Scalping).
//  - Scalping manual bisa NOW (reaksi zona / momentum) atau LIMIT (tepi zona / pullback).
//  - Bot diganti ke SMA20 + Market Structure M1, hanya candle M1, satu order per sinyal.
//  - Kode ICT yang tidak terpakai (CISD, Breaker, OB, FVG, sweep, planFrom) dibuang.
//  - Status sinyal mengikuti orderType: RUNNING untuk NOW, PENDING untuk LIMIT.

import { checkAccess, markTrialBotUsed } from '../lib/access.js';
import { generateManualPlan, buildWatchlist, SYARAT_MASUK } from '../lib/manual_scalp.js';
import { runBotSma } from '../lib/bot_sma.js';

export const config = { maxDuration: 60 };

const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/$/, '');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || 'gpt-6-luna';
const VISION_TIMEOUT_MS = 50000;
const VISION_DEADLINE_MS = 54000;   // total budget vision (< maxDuration 60s), termasuk retry
const VISION_MAX_TOKENS = 1800;

const QWEN_BASE_URL = (process.env.QWEN_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/$/, '');
const QWEN_KEYS = [process.env.QWEN_API_KEY, process.env.QWEN_API_KEY_2, process.env.OPENAI_API_KEY].filter(Boolean);
const QWEN_MODELS = [...new Set([process.env.QWEN_MODEL || 'qwen-3.8-max', process.env.QWEN_MODEL_2, AI_VISION_MODEL].filter(Boolean))];
const QWEN_TIMEOUT_MS = 20000;
const QWEN_DEADLINE_MS = 22000;   // total budget agar tidak melewati maxDuration Vercel
const QWEN_MAX_TOKENS = 1000;
const QWEN_MANUAL_MODEL = process.env.QWEN_MANUAL_MODEL || 'qwen-3.8-max'; // manual: veto AI
// Vision memakai AI_VISION_MODEL (default gpt-6-luna). Bot tidak memakai AI untuk keputusan.

const TL_KEY_NAMES = ['TICKERLAYER_API_KEY', ...Array.from({ length: 19 }, (_, i) => `TICKERLAYER_API_KEY_${i + 1}`)];
const API_KEYS = TL_KEY_NAMES.map(n => process.env[n] || '');
const TL_MAX_TRY = Math.max(1, Number(process.env.TICKERLAYER_MAX_TRY || 6));
const TL_DISABLED = process.env.TICKERLAYER_DISABLED === '1';

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

// ── Gaya MANUAL: TF yang dibutuhkan tiap gaya (dipakai untuk fetch data) ──
const MANUAL_TF_NEEDED = {
  'Scalping':    ['m5', 'm15', 'm30'],
  'Intraday':    ['m15', 'h1', 'h4'],
  'Swing':       ['h4', 'd1'],
};
// Batas jarak entry dari harga (pip) per gaya, dipakai sebagai veto lokal + dikirim ke AI
const MAX_DIST_PIP = { 'Scalping': 150, 'Intraday': 500, 'Swing': 2000 };

// ── Parameter BOT (LTF scalper) ──
const BOT_CFG = { storyTtlMs: 45000 };
const MANUAL_STORY_TTL_MS = 180000;
const GATE_TTL_MS = 10 * 60 * 1000;

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

// ── AKSES / KV ──
const MSG = {
  id: { noEmail:'Email tidak ditemukan.', notRegistered:'Email belum terdaftar.', expired:'Masa akses berakhir.', kvError:'Layanan akses bermasalah.', trialLimit:'Batas trial habis.', noPrice:'Harga live belum tersedia.', noCandles:'Data candle belum cukup.', noSetup:'Belum ada setup valid.', noKey:'OPENAI_API_KEY belum diatur.', badImage:'Gambar tidak valid.' },
  en: { noEmail:'Email not found.', notRegistered:'Email not registered.', expired:'Access expired.', kvError:'Access service issue.', trialLimit:'Trial limit reached.', noPrice:'Live price unavailable.', noCandles:'Insufficient candles.', noSetup:'No valid setup.', noKey:'OPENAI_API_KEY not set.', badImage:'Invalid image.' },
};
const msg = (lang, key) => ((MSG[lang] || MSG.id)[key] || key);

const markTrialAsUsed = markTrialBotUsed;

// ── DATA CANDLE ──
const tlCooldown = new Map();
async function tlGet(url) {
  if (TL_DISABLED) return null;
  const now = Date.now();
  const usable = API_KEYS.map((_, i) => i).filter(i => API_KEYS[i] && (tlCooldown.get(i) || 0) <= now).slice(0, TL_MAX_TRY);
  for (const i of usable) {
    try {
      const r = await httpJson(url, { headers: { 'x-api-key': API_KEYS[i] } }, 8000);
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

function toSignal(plan, ctx, extra) {
  const f = v => Number(Number(v).toFixed(ctx.dec));
  const isMarket = plan.orderType === 'MARKET';
  return {
    signal: plan.dir === 1 ? 'BUY' : 'SELL',
    orderType: plan.orderType,
    fill: isMarket ? 'NOW' : 'LIMIT',
    status: isMarket ? 'RUNNING' : 'PENDING',
    entry: f(plan.entry), sl: f(plan.sl), tp1: f(plan.tps[0]), tp2: f(plan.tps[1]), tp3: f(plan.tps[2]),
    setup: plan.setup,
    confidence: extra.confidence || 'MEDIUM',
    risk: extra.risk || 'MEDIUM',
    zone: plan.zone ? { min: f(plan.zone.lower), max: f(plan.zone.upper) } : null,
    zoneLabel: plan.zone ? plan.zone.label : '',
    zoneNote: '',
    chartContext: `${plan.setup}: ${isMarket ? 'NOW' : 'LIMIT'} ${f(plan.entry)}`,
    rr: Number(plan.rr.toFixed(2)),
    checklist: extra.checklist || [],
    scanSummary: extra.scanSummary || '',
    topDown: extra.topDown || null,
    state: isMarket ? 'CONFIRMED' : 'LIMIT_PLACED',
    score: null,
    reason: '', reasons: { id: '', en: '' }, aiReasoning: false,
  };
}
function standbyOut(facts, standbyReason, checklist, topDown) {
  return {
    signal: {
      signal: 'NONE', orderType: 'NONE', fill: 'NONE', status: 'STANDBY',
      entry: null, sl: null, tp1: null, tp2: null, tp3: null,
      setup: 'STANDBY / SCANNING', confidence: 'NONE', risk: 'NONE',
      zone: null, zoneLabel: '', zoneNote: '', chartContext: '',
      checklist: checklist || [], scanSummary: (checklist || []).join('\n'),
      topDown: topDown || null, state: 'STANDBY', score: null,
      reason: '', reasons: { id: '', en: '' }, aiReasoning: false,
    },
    facts: { ...facts, status: 'STANDBY', standbyReason },
  };
}

// ── MANUAL ENGINE (logika dari lib/manual_scalp.js, order LIMIT, RR 1:1/1:2/1:3) ──
const DOC_STYLE_LABEL = {
  'Scalping': 'Scalping', 'Intraday': 'Intraday', 'Swing': 'Swing',
};
const DOC_STYLE_TF = {
  'Scalping': { htf: 'M30/M15', zone: 'M5',       trig: 'M5' },
  'Intraday': { htf: 'H4',      zone: 'VWAP M15', trig: 'M15' },
  'Swing':    { htf: 'D1',      zone: 'H4/D1',    trig: 'H4' },
};

// Cache keputusan gate per setup agar hasil tidak acak antar generate
const gateCache = new Map();

async function runDocManual(ctx, d, styleName) {
  const tf = DOC_STYLE_TF[styleName] || DOC_STYLE_TF['Scalping'];
  const facts = {
    mode: 'manual', symbol: ctx.symbol, style: styleName, kz: ctx.kz.name, price: ctx.f(ctx.price),
    htfTf: tf.htf, zoneTf: tf.zone, trigTf: tf.trig,
  };
  const closed = {
    m5: closedOnly(d.m5, TF_MS.m5), m15: closedOnly(d.m15, TF_MS.m15), m30: closedOnly(d.m30, TF_MS.m30),
    h1: closedOnly(d.h1, TF_MS.h1), h4: closedOnly(d.h4, TF_MS.h4), d1: closedOnly(d.d1, TF_MS.d1),
  };
  facts.watch = buildWatchlist({ ...closed, price: ctx.price, pip: ctx.pip, styleName });
  facts.syarat = SYARAT_MASUK[styleName] || null;
  const out = generateManualPlan({ ...closed, tickSize: 10 ** -ctx.dec, price: ctx.price }, styleName);
  const regimeTxt = (out.regime ? out.regime.replace('_', ' ') : 'netral') + (out.regimeSrc ? ` · ${out.regimeSrc}` : '');
  facts.bias = regimeTxt;
  if (!out.ok) {
    facts.standbyReason = out.reason;
    return standbyOut(facts, out.reason, [], regimeTxt);
  }
  const o = out.order;
  const dir = o.side === 'buy' ? 1 : -1;
  const sideTxt = dir === 1 ? 'BUY' : 'SELL';
  const z = out.zone;
  const plan = {
    dir, entry: o.entryPrice, sl: o.sl, orderType: o.orderType || 'LIMIT',
    tps: [o.tp1, o.tp2, o.tp3], rr: 3,
    setup: `Manual · ${DOC_STYLE_LABEL[styleName] || styleName} · ${o.reason}`,
    zone: z ? { lower: z.bottom, upper: z.top, label: `${z.timeframe} ${z.type}`, mid: (z.top + z.bottom) / 2 } : null,
  };

  // ── Gate (veto saja) ──
  const arahHtf = out.regime === 'trending_up' ? 'BUY' : out.regime === 'trending_down' ? 'SELL' : 'NETRAL';
  const jarakPip = Math.round(Math.abs(ctx.price - o.entryPrice) / ctx.pip);
  const maxDist = MAX_DIST_PIP[styleName] || 150;
  let gate;
  if (out.regime === 'choppy') gate = { keputusan: 'TUNGGU', alasan: 'Regime HTF choppy.', ai: false };
  else if (arahHtf !== 'NETRAL' && arahHtf !== sideTxt) gate = { keputusan: 'TUNGGU', alasan: `Arah setup ${sideTxt} berlawanan dengan arah HTF ${arahHtf}.`, ai: false };
  else if (jarakPip > maxDist) gate = { keputusan: 'TUNGGU', alasan: `Entry ${jarakPip} pip dari harga, melebihi batas ${maxDist} pip.`, ai: false };
  else {
    const gKey = `${ctx.symbol}|${styleName}|${sideTxt}|${ctx.f(o.entryPrice)}`;
    const hit = gateCache.get(gKey);
    if (hit && Date.now() - hit.t < GATE_TTL_MS) gate = hit.v;
    else {
      gate = await aiGateManual({
        gaya: styleName,
        simbol: ctx.symbol,
        arah_setup: sideTxt,
        tipe_order: plan.orderType,
        arah_htf: arahHtf,
        regime_htf: out.regime || 'neutral',
        regime_sumber: out.regimeSrc || null,
        alasan_aturan: o.reason,
        zona: z ? { jenis: `${z.timeframe} ${z.type}`, bawah: ctx.f(z.bottom), atas: ctx.f(z.top), fresh: !!z.fresh } : null,
        entry: ctx.f(o.entryPrice),
        harga_sekarang: ctx.f(ctx.price),
        jarak_entry_pip: jarakPip,
        batas_jarak_pip: maxDist,
      });
      if (gate.ai) {
        gateCache.set(gKey, { t: Date.now(), v: gate });
        if (gateCache.size > 200) gateCache.delete(gateCache.keys().next().value);
      }
    }
  }
  if (gate.keputusan !== 'AMBIL') {
    const why = `Gate TUNGGU: ${gate.alasan}`;
    facts.standbyReason = why;
    facts.gateDecision = 'TUNGGU';
    return standbyOut(facts, why, [], regimeTxt);
  }
  plan.setup = `${plan.setup}${gate.ai ? ' · AI AMBIL' : ''}`;
  const sig = toSignal(plan, ctx, { confidence: 'MEDIUM', risk: 'MEDIUM', topDown: regimeTxt });
  sig.expiresAt = o.expiryTime;
  sig.symbol = ctx.symbol;     // dipakai client untuk menyimpan & mengirim balik sebagai prevSignal
  sig.style = styleName;
  facts.signal = sideTxt;
  facts.orderType = plan.orderType;
  facts.entry = sig.entry; facts.sl = sig.sl;
  facts.tp = [sig.tp1, sig.tp2, sig.tp3];
  facts.rr = '3.00';
  facts.trigger = o.reason;
  return { signal: sig, facts: { ...facts, status: sig.status } };
}

function runManual(ctx, d, styleName) {
  return runDocManual(ctx, d, styleName);
}

// Pertahankan signal PENDING dari client selama masih valid (belum expired, belum kena SL / TP1)
function validPrevSignal(prev, symbol, styleName, price) {
  if (!prev || typeof prev !== 'object') return null;
  if (prev.status !== 'PENDING' || (prev.signal !== 'BUY' && prev.signal !== 'SELL')) return null;
  if (prev.symbol !== symbol || prev.style !== styleName) return null;
  const exp = Number(prev.expiresAt);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  const sl = Number(prev.sl), tp1 = Number(prev.tp1), entry = Number(prev.entry);
  if (![sl, tp1, entry].every(Number.isFinite)) return null;
  if (prev.signal === 'BUY' && (price <= sl || price >= tp1)) return null;
  if (prev.signal === 'SELL' && (price >= sl || price <= tp1)) return null;
  return prev;
}

// ── BOT ENGINE: SMA20 + Market Structure M1 (lib/bot_sma.js). Satu order per sinyal. ──
function runBot(ctx, d, styleName) {
  const c1 = closedOnly(d.m1, TF_MS.m1);
  const r = runBotSma(c1, { price: ctx.price, dec: ctx.dec });
  const F = v => ctx.f(v);
  const facts = {
    mode: 'bot', symbol: ctx.symbol, style: 'Scalping', kz: ctx.kz.name,
    price: F(ctx.price), bias: r.bias, dirTxt: r.dirTxt,
    trigger: r.trigger, checklist: r.checklist,
    sma: r.trendTxt, m1: r.structTxt, zone: null,
  };
  if (!r.ok) return standbyOut(facts, r.reason, r.checklist, r.bias);

  const plan = {
    dir: r.dir, entry: r.entry, sl: r.sl, tps: r.tps, rr: r.rr,
    orderType: r.orderType, setup: r.setup, zone: null,
  };
  const out = toSignal(plan, ctx, {
    confidence: 'HIGH', risk: 'MEDIUM',
    checklist: r.checklist, scanSummary: r.checklist.join('\n'), topDown: r.bias,
  });
  facts.signal = r.dirTxt;
  facts.orderType = r.orderType;
  facts.status = out.status;
  facts.entry = F(r.entry);
  facts.sl = F(r.sl);
  facts.tp = r.tps.map(F);
  facts.rr = r.rr.toFixed(2);
  return { signal: out, facts };
}

// ── AI REASONING (konsultan ngobrol) ──
const SYS_MANUAL = `Kamu adalah konsultan analis trading SMC/ICT senior yang sedang ngobrol langsung dengan trader. Gaya bicara santai, hangat, dan dinamis seperti rekan yang sedang menceritakan proses cari setup: kenapa bias ini kamu ambil, zona mana yang kamu incar, apa yang kamu tunggu, dan apa yang akan kamu lakukan kalau kondisinya terjadi. Pakai "saya" atau "kita". JANGAN pakai daftar, label kaku, atau tanda bintang. Tulis 4 sampai 6 kalimat. Sebut angka harga persis dari data dan jangan mengarang angka baru. Kalau ada setup, jelaskan entry, SL, dan TP dengan natural, dan ingat order ini LIMIT yang menunggu harga datang ke entry. Kalau belum ada setup, jelaskan kenapa menunggu, sebutkan zona yang sedang dipantau dari field watch (dengan batas harga persisnya), dan syarat masuk dari field syarat. Balas HANYA JSON valid tanpa kode blok: {"id":"...","en":"..."}. "id" berbahasa Indonesia, "en" English, isi percakapannya sama.`;
const SYS_BOT = `Kamu adalah konsultan analis yang menemani bot scalper XAUUSD M1 sambil ngobrol dengan trader. Strategi bot: SMA20 + market structure M1 (tren SMA20, struktur HH-HL atau LH-LL, BOS, pullback ke SMA20, lalu konfirmasi candle M1 close). Ceritakan dengan santai apa yang sedang kamu tunggu: tren SMA20, struktur, BOS terakhir, pullback, dan konfirmasi yang belum terjadi. Pakai "saya" atau "kita". JANGAN pakai daftar, label kaku, atau tanda bintang. Tulis 3 sampai 5 kalimat dengan angka harga persis dari data. Balas HANYA JSON valid tanpa kode blok: {"id":"...","en":"..."}. "id" berbahasa Indonesia, "en" English, isi percakapannya sama.`;

async function qwenJson(sys, userObj, maxTokens = QWEN_MAX_TOKENS) {
  if (!QWEN_KEYS.length) { console.warn('qwen: API key belum diatur'); return null; }
  const user = JSON.stringify(userObj);
  const deadline = Date.now() + QWEN_DEADLINE_MS;
  for (const m of QWEN_MODELS) {
    for (const k of QWEN_KEYS.slice(0, 2)) {
      const left = deadline - Date.now();
      if (left < 3000) return null;
      try {
        const r = await httpJson(`${QWEN_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m, max_tokens: maxTokens, temperature: 0.5, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
        }, Math.min(QWEN_TIMEOUT_MS, left));
        if (!r.ok) { console.warn(`qwen ${m} HTTP ${r.status}: ${String(r.text || '').slice(0, 160)}`); continue; }
        const raw = extractContent(r.data).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        const parsed = parseJsonLoose(raw);
        if (parsed && parsed.id && parsed.en) return parsed;
        console.warn(`qwen ${m}: JSON tidak valid`);
      } catch (e) { console.warn('qwenJson:', m, e.message); }
    }
  }
  return null;
}
function extractContent(data) {
  const c = data?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(p => p?.text || '').join('');
  return '';
}
function parseJsonLoose(text) {
  const s = String(text || '').replace(/```json|```/gi, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

// Narasi cadangan yang tetap terdengar seperti ngobrol (dipakai jika AI gagal)
function fbZone(f, id) {
  if (!f.zone) return id ? `area pullback ${f.zoneTf || f.trigTf}` : `pullback area on ${f.zoneTf || f.trigTf}`;
  return id ? `zona ${f.zone.label} di ${f.zone.lower}–${f.zone.upper}` : `zone ${f.zone.label} at ${f.zone.lower}–${f.zone.upper}`;
}

function fbWatch(f, id) {
  const list = (f.watch || []).map(w => `${w.tf} ${w.tipe} ${w.bawah}–${w.atas} [${w.status}, ${w.di_dalam ? 'harga di dalam' : w.jarak_pip + ' pip'}]`).join('; ');
  if (!list) return id ? 'Belum ada zona fresh di dekat harga.' : 'No fresh zone close to price yet.';
  return id ? `Zona yang saya pantau: ${list}.` : `Zones I'm watching: ${list}.`;
}

function fallbackStory(f, lang) {
  const id = lang === 'id';
  if (f.mode === 'manual') {
    if (f.status === 'STANDBY') {
      const z = f.zone ? (id
        ? `Zona ${f.zone.label} di ${f.zone.lower}–${f.zone.upper} (${f.zone.tf}), sekitar ${f.zone.distAtr}x ATR dari harga.`
        : `${f.zone.label} zone at ${f.zone.lower}–${f.zone.upper} (${f.zone.tf}), about ${f.zone.distAtr}x ATR away.`) : '';
      return id
        ? `Saya masih cari setup di ${f.symbol}. Bias ${f.bias} dari ${f.htfTf}. ${z} ${f.standbyReason || ''} ${fbWatch(f, true)} Syarat masuk: ${f.syarat || '-'}.`
        : `I'm still looking for a setup on ${f.symbol}. Bias is ${f.bias} from ${f.htfTf}. ${z} ${f.standbyReason || ''} ${fbWatch(f, false)} Entry condition: ${f.syarat || '-'}.`;
    }
    const now = f.orderType === 'MARKET';
    return id
      ? `Oke, setup ${f.signal} sudah valid di ${f.symbol}. Bias ${f.bias} dari ${f.htfTf}, ${fbZone(f, true)}. ${now ? `Saya entry sekarang di ${f.entry}` : `Saya pasang limit di ${f.entry} dan menunggu harga datang ke sana`}. SL ${f.sl}, target ${f.tp[0]}, ${f.tp[1]}, ${f.tp[2]}, RR sekitar 1:${f.rr}.`
      : `Setup ${f.signal} is valid on ${f.symbol}. Bias ${f.bias} from ${f.htfTf}, ${fbZone(f, false)}. ${now ? `I'm entering now at ${f.entry}` : `I'm placing a limit at ${f.entry} and waiting for price to come`}. SL ${f.sl}, targets ${f.tp[0]}, ${f.tp[1]}, ${f.tp[2]}, RR about 1:${f.rr}.`;
  }
  // bot
  if (f.signal === 'BUY' || f.signal === 'SELL') {
    const now = f.orderType === 'MARKET';
    return id
      ? `Setup ${f.dirTxt} sudah lengkap: tren SMA20 ${f.dirTxt === 'BUY' ? 'naik' : 'turun'}, struktur ${f.m1}, ${f.trigger} sudah terjadi, dan candle M1 sudah close searah. ${now ? `Saya entry sekarang di ${f.entry}` : `Saya pasang limit di ${f.entry}`}, SL ${f.sl}, TP ${f.tp[0]} / ${f.tp[1]} / ${f.tp[2]}, RR 1:3.`
      : `${f.dirTxt} setup is complete: SMA20 trend ${f.dirTxt === 'BUY' ? 'up' : 'down'}, structure ${f.m1}, ${f.trigger} has happened and the M1 candle closed in the same direction. ${now ? `Entering now at ${f.entry}` : `Placing a limit at ${f.entry}`}, SL ${f.sl}, TP ${f.tp[0]} / ${f.tp[1]} / ${f.tp[2]}, RR 1:3.`;
  }
  const missing = (f.checklist || []).filter(x => x.startsWith('⬜')).map(x => x.replace('⬜ ', '')).slice(0, 3).join('; ');
  return id
    ? `Saya masih scan M1 pakai SMA20 dan struktur. Tren: ${f.sma || '-'}. Struktur: ${f.m1 || '-'}. ${f.standbyReason || ''} Yang masih saya tunggu: ${missing || 'konfirmasi berikutnya'}.`
    : `I'm still scanning M1 with SMA20 and structure. Trend: ${f.sma || '-'}. Structure: ${f.m1 || '-'}. ${f.standbyReason || ''} Still waiting on: ${missing || 'the next confirmation'}.`;
}

const storyCache = new Map();
async function getStory(facts, cacheKey, ttl = BOT_CFG.storyTtlMs) {
  if (cacheKey) {
    const hit = storyCache.get(cacheKey);
    if (hit && Date.now() - hit.t < ttl) return hit.v;
  }
  let story = null;
  const j = await qwenJson(facts.mode === 'bot' ? SYS_BOT : SYS_MANUAL, facts);
  if (j) story = { id: String(j.id), en: String(j.en), ai: true };
  if (!story) story = { id: fallbackStory(facts, 'id'), en: fallbackStory(facts, 'en'), ai: false };
  if (cacheKey) {
    storyCache.set(cacheKey, { t: Date.now(), v: story });
    if (storyCache.size > 300) storyCache.delete(storyCache.keys().next().value);
  }
  return story;
}

// ── GATE AI MANUAL: veto saja. Aturan sudah membuat kandidat, AI hanya menolak jika ada kontradiksi jelas ──
const SYS_GATE_MANUAL = `Kamu filter veto untuk kandidat setup MANUAL. Kamu TIDAK membuat setup baru dan TIDAK mengubah entry, SL, atau TP.
Jawab TUNGGU hanya jika ada kontradiksi jelas di data input:
- arah_setup berlawanan dengan arah_htf (BUY lawan SELL). Jika arah_htf = "NETRAL", abaikan syarat arah.
- regime_htf = "choppy".
- jarak_entry_pip lebih besar dari batas_jarak_pip.
- alasan_aturan kosong.
Selain itu jawab AMBIL. Kill zone, arah candle terakhir, dan status zona BUKAN alasan menolak. Jika ragu, pilih AMBIL karena aturan sudah memvalidasi setup.
Gunakan HANYA data dari input, jangan menambah angka. Alasan maksimal 150 karakter, Bahasa Indonesia, sebut field yang menjadi dasar.
FORMAT OUTPUT (hanya JSON, tanpa teks lain, tanpa markdown):
{"keputusan":"AMBIL" atau "TUNGGU","alasan":"..."}`;

async function aiGateManual(input) {
  // Jika AI gagal / timeout / JSON rusak: ikuti keputusan aturan (AMBIL), jangan buang setup valid
  const fallback = { keputusan: 'AMBIL', alasan: 'AI tidak merespons, pakai keputusan aturan', ai: false };
  if (!QWEN_KEYS.length) return fallback;
  const deadline = Date.now() + QWEN_DEADLINE_MS;
  for (const k of QWEN_KEYS.slice(0, 2)) {
    const left = deadline - Date.now();
    if (left < 3000) return fallback;
    try {
      const r = await httpJson(`${QWEN_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: QWEN_MANUAL_MODEL, max_tokens: 300, temperature: 0,
          messages: [{ role: 'system', content: SYS_GATE_MANUAL }, { role: 'user', content: JSON.stringify(input) }],
        }),
      }, Math.min(QWEN_TIMEOUT_MS, left));
      if (!r.ok) { console.warn(`aiGateManual HTTP ${r.status}`); continue; }
      const raw = extractContent(r.data).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      const parsed = parseJsonLoose(raw);
      if (parsed && ['AMBIL', 'TUNGGU'].includes(parsed.keputusan)) {
        return { keputusan: parsed.keputusan, alasan: String(parsed.alasan || '').slice(0, 200), ai: true };
      }
      console.warn('aiGateManual: JSON tidak valid');
    } catch (e) { console.warn('aiGateManual:', e.message); }
  }
  return fallback;
}

// ── VISION (upload gambar) ──
const VISION_BASE = `Kamu adalah analis trading spesialis SUPPLY & DEMAND (zona pantulan / bounce zone) dan Price Action.
STRATEGI UTAMA: HARGA MEMANTUL DARI ZONA.
- Zona DEMAND (area di mana harga naik tajam meninggalkan base/konsolidasi, atau low swing yang menahan harga) = tempat BUY, harga diharapkan memantul naik.
- Zona SUPPLY (area di mana harga turun tajam meninggalkan base, atau high swing yang menahan harga) = tempat SELL, harga diharapkan memantul turun.
- Zona makin kuat jika: meninggalkan zona dengan candle besar (impulsif), belum pernah/jarang disentuh (fresh), ada sweep likuiditas sebelum pantulan, atau ada penolakan (wick panjang / engulfing) di zona.
- Zona flip: support yang sudah ditembus jadi supply, resistance yang sudah ditembus jadi demand.

ATURAN MUTLAK:
1. User mengunggah 1 hingga 3 gambar chart. Analisis SETIAP GAMBAR di array "perImageAnalyses" (maks 2 kalimat pendek per gambar: arah tren + zona supply/demand terdekat).
2. Top-down: tren dari TF tertinggi menentukan arah utama, zona dari TF menengah, entry dari TF terendah.
3. Pilih SATU zona terbaik: yang paling dekat dengan harga sekarang dan searah tren (demand di uptrend, supply di downtrend). Jika harga di tengah range, ambil zona terdekat di sisi mana pun (pantulan range: BUY di demand bawah, SELL di supply atas).
4. WAJIB MENGHASILKAN SIGNAL BUY atau SELL. Jawab "NONE" HANYA jika gambar bukan chart atau sama sekali tidak terbaca. Tidak ada jawaban "tunggu", "belum ada setup", atau "area tidak berkualitas". Jika kondisi kurang ideal, tetap beri signal dengan confidence LOW.
5. Entry: LIMIT di tepi dekat (proximal) atau tengah zona, saat harga belum menyentuh zona. MARKET hanya jika harga sekarang sudah berada di dalam zona dan ada penolakan (wick / engulfing).
6. SL di balik tepi jauh (distal) zona + buffer kecil. BUY: sl < entry. SELL: sl > entry. TP dihitung otomatis RR 1:1, 1:2, 1:3, isi tp1 = entry ± jarak SL.
7. PAIR: baca nama instrumen dari judul/ticker chart (contoh XAUUSD, EURUSD, USDJPY, BTCUSD, US30, NAS100, SPX500, GER40, WTI, BRENT). Isi field "pair" dengan kode huruf besar tanpa garis miring. Jika beberapa gambar beda pair, pakai pair pada gambar pertama.
8. ANGKA: semua level (entry, sl, tp, zoneLow, zoneHigh) WAJIB dibaca dari skala harga sumbu kanan chart pair tersebut dan berada dekat harga sekarang. DILARANG memakai level dari pair lain atau mengarang di luar skala. Tulis dengan jumlah desimal pair: emas/XAUUSD 2, perak 3, forex biasa 5, pair JPY 3, indeks 2, crypto 2 (XRP/ADA/DOT 4, DOGE 5), minyak 2.
9. zoneLow dan zoneHigh = batas bawah dan atas zona supply/demand yang kamu pilih (angka, urut kecil ke besar).
10. JAWAB RINGKAS: reason maksimal 3 kalimat dan WAJIB diawali nama pair, contoh "XAUUSD: ...". Sebut arah, zona pantulan, alasan entry, dengan angka persis seperti di field.

Balas HANYA JSON valid tanpa kode blok:
{"signal":"BUY|SELL","orderType":"MARKET|LIMIT","entry":0,"sl":0,"tp1":0,"tp2":0,"tp3":0,"setup":"","confidence":"HIGH|MEDIUM|LOW","risk":"LOW|MEDIUM|HIGH","perImageAnalyses":["Gambar 1: ..."],"reason":"XAUUSD: ...","topDown":"...","zone":"Demand","pair":"XAUUSD","zoneLow":0,"zoneHigh":0}`;
function buildVisionSystem(style) {
  const map = {
    'Scalping': 'STYLE: SCALPING AGRESIF (SIGNAL WAJIB). TF: M30+M15+M5+M1. Cari zona supply/demand M5/M15 terdekat dengan harga. Entry agresif: MARKET jika harga sudah di zona, atau LIMIT di tepi zona. SL ketat di balik zona. Kamu WAJIB memberi BUY atau SELL, jangan pernah NONE untuk chart yang terbaca.',
    'Day Trading': 'STYLE: SCALPING Konservatif (SIGNAL WAJIB). TF: H1+M15+M5. Arah dari H1/M15, zona pantulan M5/M15 searah tren, entry LIMIT di tepi atau tengah zona, SL di balik zona. Tetap wajib memberi signal.',
    'Intraday': 'STYLE: INTRADAY (SIGNAL WAJIB). TF: M15+H1+H4. Arah dari H4/H1, zona pantulan H1/M15, entry LIMIT di zona, SL di balik zona.',
    'Swing': 'STYLE: SWING (SIGNAL WAJIB). TF: H1+H4+Daily. Arah dari Daily/H4, zona pantulan H4/Daily, entry LIMIT di zona, SL di balik zona.',
  };
  return `${VISION_BASE}\n\n${map[style] || map['Day Trading']}`;
}
const PAIR_ALIAS = {
  GOLD: 'XAUUSD', XAUUSDX: 'XAUUSD', SILVER: 'XAGUSD', XAGUSDX: 'XAGUSD',
  BTCUSDT: 'BTCUSD', ETHUSDT: 'ETHUSD', SOLUSDT: 'SOLUSD', XRPUSDT: 'XRPUSD', BNBUSDT: 'BNBUSD', ADAUSDT: 'ADAUSD', DOGEUSDT: 'DOGEUSD',
  US500: 'SPX500', SPX: 'SPX500', SP500: 'SPX500', US100: 'NAS100', NDX: 'NAS100', NASDAQ: 'NAS100', NASDAQ100: 'NAS100',
  DJI: 'US30', DOW: 'US30', DOWJONES: 'US30', DE40: 'GER40', DAX: 'GER40', GER30: 'GER40', DE30: 'GER40',
  JP225: 'JPN225', NIKKEI: 'JPN225', NI225: 'JPN225', FTSE: 'UK100', FTSE100: 'UK100', CAC40: 'FRA40',
  USOIL: 'WTI', CRUDEOIL: 'WTI', UKOIL: 'BRENT', BRENTOIL: 'BRENT', DOLLARINDEX: 'DXY', USDX: 'DXY',
};
function normPair(raw) {
  let k = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!k) return null;
  if (PAIR_ALIAS[k]) k = PAIR_ALIAS[k];
  return k;
}
// desimal & pip sesuai pair; tebakan dari besaran harga hanya jika pair tidak dikenal
function pairSpec(pair, price) {
  const sym = normPair(pair);
  let dec = sym ? DECIMALS[sym] : undefined;
  if (dec === undefined) {
    if (sym && /^[A-Z]{6}$/.test(sym)) dec = sym.includes('JPY') ? 3 : 5;
    else dec = price < 10 ? 5 : price < 500 ? 3 : 2;
  }
  const pip = pipSizeOf(sym || '', dec);
  return { sym: sym || 'VISION', dec, pip };
}
// Rapikan angka harga di teks (alasan, analisa, zona) ke desimal pair
function fmtPriceText(text, entry, dec) {
  return String(text || '').replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+/g, tok => {
    const v = Number(tok.replace(/,/g, ''));
    if (!Number.isFinite(v) || !(entry > 0)) return tok;
    return Math.abs(v - entry) / entry < 0.05 ? v.toFixed(dec) : tok;
  });
}
const VISION_EXPIRY_MS = { 'Scalping': 30 * 60e3, 'Day Trading': 2 * 3600e3, 'Intraday': 8 * 3600e3, 'Swing': 4 * 86400e3 };

function checkVisionSignal(j) {
  if (!j || typeof j !== 'object') return 'Respons AI tidak bisa dibaca.';
  const sig = String(j.signal || 'NONE').toUpperCase();
  if (sig === 'NONE') return String(j.reason || 'Tidak ada setup valid pada gambar.');
  if (sig !== 'BUY' && sig !== 'SELL') return 'Sinyal AI tidak dikenali.';
  const e = Number(j.entry), s = Number(j.sl);
  if (![e, s].every(Number.isFinite) || e <= 0 || s <= 0) return 'Entry/SL tidak lengkap.';
  if (!(sig === 'BUY' ? s < e : s > e)) return 'Level SL tidak konsisten dengan arah sinyal.';
  if (Math.abs(e - s) / e > 0.05) return 'Level SL tidak sesuai skala harga chart.';   // mis. SL pair lain / salah baca skala
  return null;
}
function buildVisionSignal(j, style, lang, imgCount) {
  const sig = String(j.signal).toUpperCase();
  const isLimit = String(j.orderType || '').toUpperCase() === 'LIMIT';
  const lvl = (v, allowed, dflt) => (allowed.includes(String(v || '').toUpperCase()) ? String(v).toUpperCase() : dflt);
  const rawEntry = Number(j.entry), rawSl = Number(j.sl);
  const { sym, dec, pip } = pairSpec(j.pair, rawEntry);
  const f = v => Number(Number(v).toFixed(dec));
  const dir = sig === 'BUY' ? 1 : -1;
  const entry = f(rawEntry);
  let risk = Math.abs(rawEntry - rawSl);
  if (!(risk > 0)) risk = pip * 10;
  const sl = f(entry - dir * risk);
  const [tp1, tp2, tp3] = [1, 2, 3].map(k => f(entry + dir * risk * k)); // RR tetap 1:1, 1:2, 1:3
  // zona pantulan: dari AI bila masuk akal, kalau tidak dari entry ke arah SL
  let zLo = Number(j.zoneLow), zHi = Number(j.zoneHigh);
  const zOk = Number.isFinite(zLo) && Number.isFinite(zHi) && zLo > 0 && zHi > zLo && Math.abs(zLo - entry) / entry < 0.05 && Math.abs(zHi - entry) / entry < 0.05;
  if (!zOk) { zLo = Math.min(entry, entry - dir * risk * 0.5); zHi = Math.max(entry, entry - dir * risk * 0.5); }
  zLo = f(zLo); zHi = f(zHi);
  const zoneName = String(j.zone || (dir === 1 ? 'Demand' : 'Supply')).replace(/[0-9.,\s\-–]+$/g, '').trim() || (dir === 1 ? 'Demand' : 'Supply');
  const fix = t => fmtPriceText(t, entry, dec);
  const perImg = Array.isArray(j.perImageAnalyses) && j.perImageAnalyses.length ? j.perImageAnalyses.map(item => `• ${fix(String(item).trim())}`).join('\n') : '';
  let summary = fix(String(j.reason || '').trim()) || 'Analisis AI dari chart.';
  if (!summary.toUpperCase().includes(sym)) summary = `${sym}: ${summary}`;
  const fullReason = perImg ? `[${sym} · Analisa ${imgCount} Gambar]\n${perImg}\n\n[Setup]\n${summary}` : summary;
  const now = Date.now();
  const pips = v => Number((Math.abs(v - entry) / pip).toFixed(1));
  return {
    signal: sig, orderType: isLimit ? 'LIMIT' : 'MARKET', fill: isLimit ? 'LIMIT' : 'NOW', status: isLimit ? 'PENDING' : 'RUNNING',
    state: isLimit ? 'LIMIT_PLACED' : 'CONFIRMED',
    symbol: sym, pair: sym, dec, pip, style,
    entry, sl, tp1, tp2, tp3, rr: 3,
    slPips: pips(sl), tp1Pips: pips(tp1), tp2Pips: pips(tp2), tp3Pips: pips(tp3),
    setup: fix(String(j.setup || `Vision ${style}`)),
    confidence: lvl(j.confidence, ['HIGH', 'MEDIUM', 'LOW'], 'MEDIUM'), risk: lvl(j.risk, ['LOW', 'MEDIUM', 'HIGH'], 'MEDIUM'),
    reason: fullReason, reasons: { id: fullReason, en: fullReason },
    chartContext: `${sym} ${sig} ${isLimit ? 'LIMIT' : 'MARKET'} ${entry.toFixed(dec)}`,
    zone: { min: zLo, max: zHi, label: `${zoneName} ${zLo.toFixed(dec)}–${zHi.toFixed(dec)}` },
    zoneLabel: `${zoneName} ${zLo.toFixed(dec)}–${zHi.toFixed(dec)}`, zoneNote: '',
    topDown: j.topDown ? fix(String(j.topDown)) : null,
    createdAt: now, time: now, ts: now, expiresAt: now + (VISION_EXPIRY_MS[style] || VISION_EXPIRY_MS['Day Trading']),
    source: 'VISION_AI', aiReasoning: true,
  };
}
async function runVisionAnalysis(images, style, lang) {
  if (!OPENAI_API_KEY) return { ok: false, reason: msg(lang, 'noKey') };
  const imgs = images.filter(s => typeof s === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(s));
  if (!imgs.length) return { ok: false, reason: msg(lang, 'badImage') };
  const userContent = [
    { type: 'text', text: `Jumlah gambar: ${imgs.length}. Style: ${style}. Analisa tiap gambar.` },
    ...imgs.flatMap((url, i) => [{ type: 'text', text: `Gambar ${i + 1}/${imgs.length}:` }, { type: 'image_url', image_url: { url } }]),
  ];
  const deadline = Date.now() + VISION_DEADLINE_MS;
  const FORCE_TXT = { type: 'text', text: 'PENTING: jawaban NONE tidak diterima. Pilih zona supply/demand terdekat dari harga, lalu berikan BUY atau SELL lengkap dengan entry dan SL dari skala chart. Gunakan confidence LOW jika ragu.' };
  const callAI = (v, force = false) => {
    const left = deadline - Date.now();
    if (left < 8000) throw new Error('Timeout: layanan eksternal lama merespons');
    const body = { model: AI_VISION_MODEL, messages: [{ role: 'system', content: buildVisionSystem(style) }, { role: 'user', content: force ? [...userContent, FORCE_TXT] : userContent }] };
    if (v === 'new') body.max_completion_tokens = VISION_MAX_TOKENS; else { body.max_tokens = VISION_MAX_TOKENS; body.temperature = 0.15; }
    return httpJson(`${OPENAI_BASE_URL}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, Math.min(VISION_TIMEOUT_MS, left));
  };
  let r;
  try {
    r = await callAI('new'); if (!r.ok && r.status === 400) r = await callAI('legacy');
  } catch (e) {
    if (/Timeout/i.test(e.message)) return { ok: false, reason: 'AI terlalu lama membaca gambar. Coba lagi, atau kurangi jumlah gambar / ukuran gambar.' };
    return { ok: false, reason: `AI gagal: ${e.message}` };
  }
  if (!r.ok) { const detail = r.data?.error?.message || (typeof r.data?.error === 'string' ? r.data.error : '') || r.text.slice(0, 160); return { ok: false, reason: `AI gagal (HTTP ${r.status}): ${detail}` }; }
  let parsed = parseJsonLoose(extractContent(r.data));
  // AI menjawab NONE / tidak valid: paksa sekali lagi bila waktu masih cukup (signal wajib)
  const isNone = p => !p || String(p.signal || 'NONE').toUpperCase() === 'NONE' || checkVisionSignal(p);
  if (isNone(parsed) && deadline - Date.now() > 22000) {
    try {
      const r2 = await callAI('new', true);
      if (r2.ok) { const p2 = parseJsonLoose(extractContent(r2.data)); if (!isNone(p2)) parsed = p2; }
    } catch (e) { console.warn('vision retry:', e.message); }
  }
  const bad = checkVisionSignal(parsed); if (bad) return { ok: false, reason: bad };
  return { ok: true, signal: buildVisionSignal(parsed, style, lang, imgs.length) };
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
  return 'Scalping'; // gaya scalp tunggal; Agresif, Konservatif, dan Day Trading dipetakan ke sini
}
function manualTfs(styleName) {
  return MANUAL_TF_NEEDED[styleName] || MANUAL_TF_NEEDED['Day Trading'];
}

async function handleCandles(body, lang, res, { email, isAutoBot }) {
  const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
  const styleName = isAutoBot ? 'Scalping' : normStyle(body.style || body.mode || 'Scalping');
  const price = Number(body.price ?? body.livePrice ?? body.currentPrice ?? 0);
  if (!(price > 0)) return fail(res, msg(lang, 'noPrice'));

  const dec = DECIMALS[symbol] ?? 2;
  const ctx = { symbol, lang, dec, price, pip: pipSizeOf(symbol, dec), gold: isGold(symbol), kz: getKillzoneStatus(), useSma: !!isAutoBot && !!body.useSma, f: v => Number(Number(v).toFixed(dec)) };

  const candleMap = {};
  for (const tf of ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1']) candleMap[tf] = clientCandles(body, tf);
  const need = isAutoBot ? ['m1'] : manualTfs(styleName);
  try {
    for (const tf of need) {
      if (candleMap[tf] && candleMap[tf].length >= (MIN_BARS[tf] || 25)) continue;
      const rows = await fetchTickerLayerRows(symbol, TF_IV[tf], TF_NEED[tf] || 200);
      if (rows.length) candleMap[tf] = rows;
    }
  } catch (e) { console.warn('fallback TL:', e.message); }

  const data = { price };
  for (const tf of ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1']) data[tf] = candleMap[tf] || [];
  if (!data.m5.length && !data.m15.length && !data.m1.length) return fail(res, msg(lang, 'noCandles'));

  let out;
  try {
    out = isAutoBot ? runBot(ctx, data, styleName) : await runManual(ctx, data, styleName);
  } catch (e) {
    console.error('engine error:', e);
    out = standbyOut({ mode: isAutoBot ? 'bot' : 'manual', symbol, style: styleName, status: 'STANDBY' }, `Analisa sementara gagal (${e.message}). Akan dicoba lagi.`, [], null);
  }
  if (isAutoBot && out.signal.status !== 'STANDBY') await markTrialAsUsed(email);

  // Manual: pertahankan signal PENDING lama bila hasil baru STANDBY tapi signal lama masih valid
  if (!isAutoBot && out.signal.status === 'STANDBY') {
    const prev = validPrevSignal(body.prevSignal, symbol, styleName, price);
    if (prev) {
      return res.status(200).json({
        ok: true, mode: 'candles', symbol, style: styleName, price,
        signal: { ...prev, sticky: true },
      });
    }
  }

  if (isAutoBot) {
    const last = data.m1 && data.m1.length ? data.m1[data.m1.length - 1] : null;
    out.signal.nextCloseAt = last ? tsMs(last.t) + TF_MS.m1 : null;
  }
  const f = out.facts;
  const cacheKey = isAutoBot
    ? `${symbol}|${styleName}|${f.status}|${f.signal || ''}|${f.trigger || ''}|${f.zoneType || ''}|${f.bias}`
    : `M|${symbol}|${styleName}|${f.status}|${f.signal || ''}|${f.entry || ''}|${String(f.standbyReason || '').slice(0, 60)}`;
  const story = await getStory(f, cacheKey, isAutoBot ? BOT_CFG.storyTtlMs : MANUAL_STORY_TTL_MS);
  const signal = {
    ...out.signal,
    reason: lang === 'en' ? story.en : story.id,
    reasons: { id: story.id, en: story.en },
    aiReasoning: !!story.ai,
  };
  return res.status(200).json({ ok: true, mode: isAutoBot ? 'bot' : 'candles', symbol, style: styleName, price, signal });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-email');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return fail(res, 'Method not allowed', 405);

  try {
    let body = req.body || {};
    if (typeof body === 'string') try { body = JSON.parse(body); } catch { return fail(res, 'Body tidak valid (JSON).'); }

    const lang = body.lang === 'en' ? 'en' : 'id';
    const email = String(body.email || body.value || '').trim().toLowerCase();
    const isAutoBot = !!(body.auto || body.bot || body.mode === 'bot' || body.source === 'bot');
    const isVision = body.symbol === 'VISION' || body.mode === 'vision' || (Array.isArray(body.images) && body.images.length > 0);

    const access = await checkAccess(email, isAutoBot);
    if (!access.ok) return fail(res, msg(lang, access.key));

    if (isVision) return await handleVision(body, lang, res);
    return await handleCandles(body, lang, res, { email, isAutoBot });
  } catch (err) {
    console.error('Fatal API Error:', err);
    if (!res.headersSent) return fail(res, `Server error: ${err.message || 'unknown'}`, 500);
  }
}
