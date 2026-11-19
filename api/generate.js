// api/generate.js — v141
// MANUAL (Scalping Agresif, Konservatif, Intraday, Swing) : logika lib/manual_scalp.js → gate AI (veto saja) → signal LIMIT.
// BOT (AUTOBOT Xauusd)           : scalping berbasis struktur LTF (M5 arah, M1 trigger), zona HTF opsional.
// AI REASONING                   : konsultan analis yang ngobrol santai, fallback narasi manusiawi jika AI gagal.
//
// Perubahan v141:
//  - manualTfs: semua TF yang dipakai tiap gaya ikut diambil (M30/M15/H1/H4/D1 tidak lagi diisi duplikat).
//  - Gate AI jadi veto: fallback AMBIL, syarat KZ & arah candle dibuang, jarak entry dicek lokal per gaya.
//  - Keputusan gate & narasi manual di-cache per setup, jadi hasil tidak acak antar generate.
//  - Signal PENDING dari client (body.prevSignal) dipertahankan sampai expired / SL / TP1, tidak ditimpa STANDBY.
//  - Kode manual lama yang tidak pernah terpanggil (runAggressive, jalur zona legacy) dibuang.

import { checkAccess, markTrialBotUsed } from '../lib/access.js';
import { generateManualPlan, buildWatchlist, SYARAT_MASUK } from '../lib/manual_scalp.js';

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
  'Day Trading': ['m5', 'm15', 'm30', 'h1'],
  'Intraday':    ['m15', 'h1', 'h4'],
  'Swing':       ['h4', 'd1'],
};
// Batas jarak entry dari harga (pip) per gaya, dipakai sebagai veto lokal + dikirim ke AI
const MAX_DIST_PIP = { 'Scalping': 150, 'Day Trading': 150, 'Intraday': 500, 'Swing': 2000 };

// ── Parameter BOT (LTF scalper) ──
const BOT_CFG = { chaseAtr5: 2.0, zoneMaxAtr15: 1.5, maxSlAtr5: 1.2, minSlAtr1: 0.3, maxSlPips: 60, storyTtlMs: 45000 };
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

// ── INDIKATOR & STRUKTUR ──
function atr(c, period = 14) {
  if (!c || c.length < 2) return 0;
  const n = Math.min(period, c.length - 1);
  let s = 0;
  for (let i = c.length - n; i < c.length; i++) {
    s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  }
  return s / n;
}
function swings(c, L = 2) {
  const highs = [], lows = [];
  for (let i = L; i < c.length - L; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= L; j++) {
      if (!(c[i].h > c[i - j].h && c[i].h >= c[i + j].h)) isH = false;
      if (!(c[i].l < c[i - j].l && c[i].l <= c[i + j].l)) isL = false;
    }
    if (isH) highs.push({ i, p: c[i].h });
    if (isL) lows.push({ i, p: c[i].l });
  }
  return { highs, lows };
}
// Struktur: trend dari HH/HL atau LH/LL, lalu event (BOS / CHoCH / BREAK) pada candle terakhir yang sudah close
function marketStructure(c) {
  if (!c || c.length < 20) return null;
  const { highs, lows } = swings(c.slice(0, -1), 2);
  if (highs.length < 2 || lows.length < 2) return null;
  const h1 = highs[highs.length - 1].p, h0 = highs[highs.length - 2].p;
  const l1 = lows[lows.length - 1].p, l0 = lows[lows.length - 2].p;
  const trend = (h1 > h0 && l1 > l0) ? 1 : (h1 < h0 && l1 < l0) ? -1 : 0;
  const last = c[c.length - 1];
  let dir = 0, event = null;
  if (last.c > h1) { dir = 1; event = trend === -1 ? 'CHoCH' : (trend === 1 ? 'BOS' : 'BREAK'); }
  else if (last.c < l1) { dir = -1; event = trend === 1 ? 'CHoCH' : (trend === -1 ? 'BOS' : 'BREAK'); }
  return { trend, dir, event, h1, l1, h0, l0 };
}
const trendLabel = ms => {
  if (!ms) return 'data belum cukup';
  const t = ms.trend === 1 ? 'uptrend (HH-HL)' : ms.trend === -1 ? 'downtrend (LH-LL)' : 'range';
  return ms.event ? `${t}, ${ms.event} ${ms.dir === 1 ? 'bullish' : 'bearish'}` : t;
};
// CISD: rangkaian candle berlawanan (min 2), lalu close menembus open tertinggi/terendah rangkaian
function cisd(c) {
  const n = c.length; if (n < 5) return null;
  const last = c[n - 1];
  if (last.c > last.o) {
    const series = [];
    for (let i = n - 2; i >= Math.max(0, n - 9); i--) { if (c[i].c < c[i].o) series.push(c[i]); else break; }
    if (series.length >= 2) {
      const hiOpen = Math.max(...series.map(x => x.o));
      if (last.c > hiOpen) return { dir: 1, level: hiOpen, count: series.length };
    }
  }
  if (last.c < last.o) {
    const series = [];
    for (let i = n - 2; i >= Math.max(0, n - 9); i--) { if (c[i].c > c[i].o) series.push(c[i]); else break; }
    if (series.length >= 2) {
      const loOpen = Math.min(...series.map(x => x.o));
      if (last.c < loOpen) return { dir: -1, level: loOpen, count: series.length };
    }
  }
  return null;
}
// Breaker: candle berlawanan yang ditembus close candle terakhir → zona berbalik peran
function breakerTrigger(c, dir) {
  const n = c.length; if (n < 6) return null;
  const last = c[n - 1];
  for (let b = n - 2; b >= Math.max(0, n - 12); b--) {
    const x = c[b];
    if (dir === 1 && x.c < x.o && last.c > x.h) return { lower: x.l, upper: x.h, idx: b };
    if (dir === -1 && x.c > x.o && last.c < x.l) return { lower: x.l, upper: x.h, idx: b };
  }
  return null;
}
function rejection(c, dir, zone) {
  const x = c[c.length - 1]; const rg = x.h - x.l; if (!(rg > 0)) return false;
  const mid = (x.h + x.l) / 2;
  if (dir === 1) {
    const wick = Math.min(x.o, x.c) - x.l;
    return wick / rg >= 0.6 && x.c > mid && (!zone || x.l <= zone.upper);
  }
  const wick = x.h - Math.max(x.o, x.c);
  return wick / rg >= 0.6 && x.c < mid && (!zone || x.h >= zone.lower);
}
function fvgsOf(c, minSize) {
  const out = [];
  for (let i = 2; i < c.length; i++) {
    if (c[i].l > c[i - 2].h && c[i].l - c[i - 2].h >= minSize) out.push({ dir: 1, lower: c[i - 2].h, upper: c[i].l, idx: i });
    if (c[i].h < c[i - 2].l && c[i - 2].l - c[i].h >= minSize) out.push({ dir: -1, lower: c[i].h, upper: c[i - 2].l, idx: i });
  }
  return out;
}
function obsOf(c, dir, atrV) {
  const out = [];
  for (let k = 3; k < c.length; k++) {
    const d = c[k];
    if (Math.abs(d.c - d.o) < atrV) continue;
    if (dir === 1 && !(d.c > d.o)) continue;
    if (dir === -1 && !(d.c < d.o)) continue;
    for (let o = k - 1; o >= Math.max(0, k - 4); o--) {
      const x = c[o];
      if (dir === 1 && x.c < x.o && d.c > x.h) { out.push({ lower: x.l, upper: x.h, idx: o }); break; }
      if (dir === -1 && x.c > x.o && d.c < x.l) { out.push({ lower: x.l, upper: x.h, idx: o }); break; }
    }
  }
  return out;
}
const mkZone = (type, dir, lower, upper, idx, label) => ({
  type, dir, lower, upper, mid: (lower + upper) / 2, distal: dir === 1 ? lower : upper, idx,
  label: label || `${type} ${dir === 1 ? 'BUY' : 'SELL'}`,
});
function zoneMitigation(z, c, from) {
  const size = z.upper - z.lower; if (!(size > 0)) return 1;
  let pct = 0;
  for (let i = Math.max(0, from); i < c.length; i++) {
    if (c[i].h < z.lower || c[i].l > z.upper) continue;
    const depth = z.dir === 1 ? (z.upper - Math.max(c[i].l, z.lower)) : (Math.min(c[i].h, z.upper) - z.lower);
    pct = Math.max(pct, depth / size);
  }
  return Math.min(1, pct);
}
// Zona WNS (FVG fresh, IFVG = BUY/SELL ZONE, OB) searah `dir` yang tidak terlalu jauh dari harga
function zonesOf(c, dir, price, atrV, maxDistAtr) {
  if (!c || c.length < 25 || !(atrV > 0)) return [];
  const out = [];
  const minSize = 0.15 * atrV;
  for (const f of fvgsOf(c, minSize)) {
    const after = c.slice(f.idx + 1);
    if (f.dir === dir) {
      if (after.some(x => dir === 1 ? x.c < f.lower : x.c > f.upper)) continue;
      out.push(mkZone('FVG', dir, f.lower, f.upper, f.idx));
    } else if (dir === 1 && f.dir === -1 && after.some(x => x.c > f.upper)) {
      out.push(mkZone('IFVG', 1, f.lower, (f.upper + f.lower) / 2, f.idx, 'BUY ZONE'));
    } else if (dir === -1 && f.dir === 1 && after.some(x => x.c < f.lower)) {
      out.push(mkZone('IFVG', -1, (f.upper + f.lower) / 2, f.upper, f.idx, 'SELL ZONE'));
    }
  }
  for (const o of obsOf(c, dir, atrV)) {
    const after = c.slice(o.idx + 1);
    if (after.some(x => dir === 1 ? x.c < o.lower : x.c > o.upper)) continue;
    out.push(mkZone('OB', dir, o.lower, o.upper, o.idx, dir === 1 ? 'Demand OB' : 'Supply OB'));
  }
  const res = [];
  for (const z of out) {
    if (zoneMitigation(z, c, z.idx + 1) >= 0.8) continue;
    const dist = dir === 1 ? Math.max(0, price - z.upper) : Math.max(0, z.lower - price);
    if (dist > maxDistAtr * atrV) continue;
    res.push({ ...z, dist, inside: price >= z.lower && price <= z.upper });
  }
  const prio = { IFVG: 4, FVG: 3, OB: 2 };
  res.sort((a, b) => (prio[b.type] - prio[a.type]) || (a.dist - b.dist));
  return res;
}
// Sweep likuiditas terbaru: wick menembus swing lalu close kembali
function sweepOf(c) {
  if (!c || c.length < 25) return null;
  const n = c.length;
  const { highs, lows } = swings(c.slice(0, -3), 2);
  const H = highs.slice(-4), L = lows.slice(-4);
  for (let k = n - 1; k >= n - 3; k--) {
    const x = c[k];
    for (const l of L.slice().reverse()) if (x.l < l.p && x.c > l.p) return { dir: 1, level: l.p, extreme: x.l, idx: k };
    for (const h of H.slice().reverse()) if (x.h > h.p && x.c < h.p) return { dir: -1, level: h.p, extreme: x.h, idx: k };
  }
  return null;
}
function dispOf(c, atrV, dir) {
  if (!c || !c.length) return null;
  for (let k = c.length - 1; k >= Math.max(1, c.length - 4); k--) {
    const x = c[k], b = Math.abs(x.c - x.o);
    if (b >= atrV && (dir === 1 ? x.c > x.o : x.c < x.o)) return { idx: k, body: b };
  }
  return null;
}
function liquidityLevels(c) {
  if (!c || c.length < 20) return [];
  const { highs, lows } = swings(c.slice(-100), 2);
  return [...highs.map(x => x.p), ...lows.map(x => x.p)];
}
// Bias multi-TF (berbobot)
function biasOf(tfMap, order) {
  const w = { d1: 4, h4: 3, h1: 2.5, m30: 2, m15: 1.5, m5: 1, m1: 0.5 };
  let s = 0, t = 0; const det = {};
  for (const tf of order) {
    const c = tfMap[tf]; if (!c || c.length < 25) continue;
    const ms = marketStructure(c); if (!ms) continue;
    const dr = ms.dir || ms.trend;
    det[tf] = dr === 1 ? 'BULL' : dr === -1 ? 'BEAR' : 'RANGE';
    s += dr * (w[tf] || 1); t += (w[tf] || 1);
  }
  if (!t) return { dir: 0, score: 0, details: det };
  const n = s / t;
  return { dir: n > 0.15 ? 1 : n < -0.15 ? -1 : 0, score: Number(n.toFixed(2)), details: det };
}
// Bot: TP1 = 1R, TP2 = 2R, TP3 = level likuiditas terdekat di atas 2R (fallback 3R bila tidak ada)
function botTps(dir, entry, risk, liq) {
  const R = p => Math.abs(p - entry) / risk;
  const beyond = liq
    .filter(p => (dir === 1 ? p > entry : p < entry))
    .sort((a, b) => (dir === 1 ? a - b : b - a));
  const tp3Liq = beyond.find(p => R(p) > 2.0);
  return [entry + dir * risk * 1, entry + dir * risk * 2, tp3Liq ?? entry + dir * risk * 3];
}

// Validasi SL/TP/RR: SL tidak pernah diubah demi RR. Jika terlalu lebar → skip.
function planFrom(o) {
  let risk = Math.abs(o.entry - o.sl);
  if (!(risk > 0)) return { ok: false, reason: 'SL tidak valid.' };
  if (risk > o.maxRisk) return { ok: false, reason: `SL struktural ${(risk / o.atrRef).toFixed(1)}x ATR, melebihi batas ${(o.maxRisk / o.atrRef).toFixed(1)}x ATR. Skip, SL tidak saya utak-atik.` };
  let sl = o.sl;
  if (risk < o.minRisk) { sl = o.entry - o.dir * o.minRisk; risk = o.minRisk; }
  const tps = botTps(o.dir, o.entry, risk, o.liq || []);
  const rr = Math.abs(tps[2] - o.entry) / risk;
  if (rr < o.minRR) return { ok: false, reason: `RR 1:${rr.toFixed(2)} di bawah minimal 1:${o.minRR}. Skip.` };
  return { ok: true, plan: { dir: o.dir, entry: o.entry, sl, tps, rr, orderType: o.orderType, setup: o.setup, zone: o.zone || null } };
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
  'Scalping': 'Scalping Agresif', 'Day Trading': 'Scalping Konservatif', 'Intraday': 'Intraday', 'Swing': 'Swing',
};
const DOC_STYLE_TF = {
  'Scalping':    { htf: 'M30/M15/M5', zone: 'M5',        trig: 'M5' },
  'Day Trading': { htf: 'H1/M30/M15', zone: 'M5',        trig: 'M5' },
  'Intraday':    { htf: 'H4',         zone: 'VWAP M15',  trig: 'M15' },
  'Swing':       { htf: 'D1',         zone: 'H4/D1',     trig: 'H4' },
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
  const out = generateManualPlan({ ...closed, tickSize: 10 ** -ctx.dec }, styleName);
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
    dir, entry: o.entryPrice, sl: o.sl, orderType: 'LIMIT',
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
        tipe_order: 'LIMIT',
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
  facts.orderType = 'LIMIT';
  facts.entry = sig.entry; facts.sl = sig.sl;
  facts.tp = [sig.tp1, sig.tp2, sig.tp3];
  facts.rr = '3.00';
  facts.trigger = o.reason;
  return { signal: sig, facts: { ...facts, status: 'PENDING' } };
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

// ── BOT ENGINE (LTF structure scalper + checklist) ──
function botTrigger(c1, ms5, dir, zone) {
  const ms1 = marketStructure(c1);
  if (ms1 && ms1.dir === dir && ms1.event === 'CHoCH') return 'CHoCH M1';
  const cs = cisd(c1); if (cs && cs.dir === dir) return 'CISD M1';
  if (breakerTrigger(c1, dir)) return 'Breaker M1';
  if (ms5 && ms5.dir === dir && ms5.event === 'CHoCH') return 'CHoCH M5';
  if (zone && rejection(c1, dir, zone)) return 'Rejection WNS';
  if (ms1 && ms1.dir === dir && ms1.event === 'BOS' && ms5 && ms5.trend === dir) return 'BOS continuity M1';
  return null;
}
// Trend micro dari SMA20: harga di atas SMA dan SMA sedang naik (BUY), atau sebaliknya (SELL). 0 = tidak jelas.
function smaMicroDir(c, period = 20, lookback = 3) {
  if (!c || c.length < period + lookback + 1) return 0;
  const smaAt = end => c.slice(0, end).slice(-period).reduce((a, x) => a + x.c, 0) / period;
  const smaNow = smaAt(c.length), smaPrev = smaAt(c.length - lookback);
  const px = c[c.length - 1].c;
  if (px > smaNow && smaNow > smaPrev) return 1;
  if (px < smaNow && smaNow < smaPrev) return -1;
  return 0;
}

function runBot(ctx, d, styleName) {
  const requireHtf = false; // bot hanya Scalping (Konservatif dihapus dari bot)
  const price = ctx.price, pip = ctx.pip, F = v => ctx.f(v);
  const c1 = closedOnly(d.m1, TF_MS.m1), c5 = closedOnly(d.m5, TF_MS.m5);
  const c15 = closedOnly(d.m15, TF_MS.m15), c30 = closedOnly(d.m30, TF_MS.m30), h1 = closedOnly(d.h1, TF_MS.h1);
  const atr1 = atr(c1), atr5 = atr(c5), atr15 = atr(c15) || atr5;
  const bias = biasOf({ h1, m30: c30, m15: c15 }, ['h1', 'm30', 'm15']);
  const ms5 = marketStructure(c5), ms1 = marketStructure(c1);
  const zoneTf = c15 && c15.length >= 25 ? c15 : c30;
  const zones = bias.dir ? zonesOf(zoneTf, bias.dir, price, atr15, BOT_CFG.zoneMaxAtr15) : [];
  const zone = zones[0] || null;
  const ltfDir = (ms5 && ms5.trend) || 0; // arah M5 (HH-HL / LH-LL), CHoCH M5 tidak membatalkan

  const inZone = zone ? (price >= zone.lower && price <= zone.upper) : false;
  const touched = zone ? c1.slice(-8).some(x => x.h >= zone.lower && x.l <= zone.upper) : false;
  const zoneHit = !!zone && (inZone || touched);

  // ── TOP-DOWN SOP ──
  // 1) H1/M30/M15 menentukan bias. Netral = tidak ada entry.
  // 2) ZONE  : harga di zona utama M15 searah bias.
  // 3) TREND : M5 searah bias, lalu entry dari POI M5/M1 searah bias.
  // 4) COUNTER_POI: melawan bias HANYA jika harga di POI M15 berlawanan, ada sweep, dan M5 sudah CHoCH (reversal).
  const htfDir = bias.dir;
  const poiCounter = htfDir ? (zonesOf(zoneTf, -htfDir, price, atr15, 0.8)[0] || null) : null;
  const swAny = sweepOf(c5) || sweepOf(c1);
  const ltfSameBias = !!htfDir && ltfDir === htfDir && (!ctx.useSma || smaMicroDir(c5) === htfDir);
  const choch5Counter = !!htfDir && !!ms5 && ms5.event === 'CHoCH' && ms5.dir === -htfDir;

  let dir = 0, mode = null;
  if (htfDir && zoneHit && zone.dir === htfDir) { dir = htfDir; mode = 'ZONE'; }
  else if (htfDir && ltfSameBias) { dir = htfDir; mode = 'TREND'; }
  else if (htfDir && poiCounter && swAny && swAny.dir === -htfDir && choch5Counter) { dir = -htfDir; mode = 'COUNTER_POI'; }

  const swRaw = sweepOf(c5) || sweepOf(c1);
  const sw = swRaw && dir && swRaw.dir === dir ? swRaw : null;
  const disp = dir ? (dispOf(c1, atr1, dir) || dispOf(c5, atr5, dir)) : null;
  const trigger = dir ? botTrigger(c1, ms5, dir, zone) : null;

  // KONFIRMASI WAJIB: candle M1 terakhir (sudah close) harus searah dan belum memantul jauh.
  // Kalau ada zona: harus close DI LUAR zona, bukan sekadar menyentuh zona.
  const lastC = c1[c1.length - 1];
  const confirmSide = dir === 1 ? lastC.c > lastC.o : dir === -1 ? lastC.c < lastC.o : false;
  const notBounced = dir === 1 ? price >= lastC.c - 0.5 * atr1 : dir === -1 ? price <= lastC.c + 0.5 * atr1 : false;
  const closeOutside = zoneHit ? (dir === -1 ? lastC.c < zone.lower : lastC.c > zone.upper) : true;
  const confirmed = !!dir && confirmSide && notBounced && closeOutside;
  const smaDir = smaMicroDir(c5);
  const smaOk = !ctx.useSma || smaDir === dir;

  const T = (ok, txt) => `${ok ? '✅' : '⬜'} ${txt}`;
  const checklist = [
    T(bias.dir !== 0, `Top-down H1/M30/M15: ${bias.dir === 1 ? 'BULLISH' : bias.dir === -1 ? 'BEARISH' : 'RANGE / NETRAL'}`),
    T(!!mode, mode ? `Mode: ${mode}${mode === 'COUNTER_POI' ? ' (reversal di POI M15 + sweep + CHoCH M5)' : ''}` : 'Mode: belum ada (top-down belum lengkap)'),
    T(!!ms5, `Struktur M5: ${trendLabel(ms5)}`),
    T(!!(ms1 && ms1.event), `Struktur M1: ${trendLabel(ms1)}`),
    T(!!zone, zone ? `WNS zone ${zone.label} ${F(zone.lower)}–${F(zone.upper)} (${(zone.dist / atr15).toFixed(1)}x ATR)` : (requireHtf ? 'WNS zone HTF: belum ada, gaya Konservatif menunggu zona' : 'WNS zone HTF: belum ada (scalp pakai struktur LTF)')),
    T(!!sw, sw ? `Sweep likuiditas ${sw.dir === 1 ? 'SSL' : 'BSL'} @ ${F(sw.level)}` : 'Sweep likuiditas: belum ada yang searah'),
    T(!!disp, disp ? 'Displacement: ada' : 'Displacement: belum ada'),
    T(!!trigger, trigger ? `Trigger close-confirmed: ${trigger}` : 'Trigger: belum ada CHoCH / CISD / Breaker / BOS continuity'),
    T(confirmed, `Konfirmasi M1 close ${dir === -1 ? 'bearish' : dir === 1 ? 'bullish' : '-'}${zoneHit ? ' di luar zona' : ''}`),
    ...(ctx.useSma ? [T(smaOk, `SMA20 M5 trend micro: ${smaDir === 1 ? 'BULLISH (harga di atas SMA, SMA naik)' : smaDir === -1 ? 'BEARISH (harga di bawah SMA, SMA turun)' : 'DATAR / belum jelas'}`)] : []),
  ];
  const facts = {
    mode: 'bot', symbol: ctx.symbol, style: styleName, kz: ctx.kz.name,
    price: F(price), bias: bias.dir === 1 ? 'BULLISH' : bias.dir === -1 ? 'BEARISH' : 'NETRAL',
    dirTxt: dir === 1 ? 'BUY' : dir === -1 ? 'SELL' : '-',
    trigger, zoneType: zone ? zone.type : null, checklist,
    m5: trendLabel(ms5), m1: trendLabel(ms1),
    zone: zone ? { label: zone.label, lower: F(zone.lower), upper: F(zone.upper), inZone, touched } : null,
  };
  const topDown = facts.bias;

  // Sweep/displacement diutamakan, tapi trigger CHoCH M1 / CISD / Breaker sudah cukup (kontinuitas fleksibel)
  // Area mikro: zona M5/M1 searah yang berdekatan dengan harga (wajib untuk LTF)
  const microZone = mode === 'TREND' ? ([...zonesOf(c5, dir, price, atr5, 1.0), ...zonesOf(c1, dir, price, atr1, 1.0)][0] || null) : null;
  const slZ = mode === 'ZONE' ? zone : mode === 'COUNTER_POI' ? poiCounter : microZone;
  const ready = dir && trigger && confirmed && smaOk && (
    mode === 'ZONE' ||
    (mode === 'TREND' && microZone && (sw || disp || /CHoCH M1|CISD|Breaker/.test(trigger))) ||
    (mode === 'COUNTER_POI' && poiCounter && sw && trigger)
  );
  if (!ready) {
    let why;
    if (!htfDir) why = 'Top-down H1/M30/M15 netral (range). SOP tidak mengizinkan entry sampai bias jelas.';
    else if (!dir) why = `Top-down ${htfDir === 1 ? 'BULLISH' : 'BEARISH'}, tapi M5 belum searah dan belum ada POI M15 berlawanan + sweep + CHoCH M5.`;
    else if (mode === 'TREND' && !microZone) why = `Searah bias ${htfDir === 1 ? 'BULLISH' : 'BEARISH'}, tapi belum ada POI M5/M1 di dekat harga.`;
    else if (!trigger) why = `Struktur ${dir === 1 ? 'bullish' : 'bearish'} sudah terbaca, menunggu trigger close-confirmed di M1.`;
    else if (zone && !zoneHit && requireHtf) why = `Zona WNS ${zone.label} masih ${(zone.dist / atr15).toFixed(1)}x ATR dari harga. Gaya Konservatif menunggu harga masuk zona.`;
    else if (zoneHit && !closeOutside) why = `Harga sudah masuk zona ${zone.label}, tapi belum ada M1 close di luar zona. Saya tunggu konfirmasi, tidak masuk di dalam zona.`;
    else if (!confirmSide || !notBounced) why = `Trigger ${trigger} sudah terbaca, tapi candle M1 belum close searah atau harga sudah memantul. Menunggu konfirmasi.`;
    else if (!smaOk) why = `SMA20 M5 belum searah dengan arah ${dir === 1 ? 'BUY' : 'SELL'}. Menunggu trend micro sejalan.`;
    else why = 'Sweep / displacement searah belum lengkap.';
    return standbyOut(facts, why, checklist, topDown);
  }

  // Anti-chase: harga sudah lari terlalu jauh dari level struktur M5
  const ext = dir === 1 ? (ms5 ? price - ms5.h1 : 0) : (ms5 ? ms5.l1 - price : 0);
  if (!zoneHit && ext > BOT_CFG.chaseAtr5 * atr5) {
    const why = `Harga sudah lari ${(ext / atr5).toFixed(1)}x ATR dari level struktur. Tunggu pullback, tidak chase.`;
    facts.standbyReason = why;
    return standbyOut(facts, why, checklist, topDown);
  }

  const recent = c1.slice(-4);
  let inv = dir === 1 ? Math.min(...recent.map(x => x.l)) : Math.max(...recent.map(x => x.h));
  if (sw) inv = dir === 1 ? Math.min(inv, sw.extreme) : Math.max(inv, sw.extreme);
  if (slZ) inv = dir === 1 ? Math.min(inv, slZ.lower) : Math.max(inv, slZ.upper);
  const buf = Math.max(2 * pip, 0.1 * atr1);
  const sl0 = dir === 1 ? inv - buf : inv + buf;
  const minRR = /CISD|Breaker/.test(trigger) ? 1.5 : 2.0;
  const liq = [...liquidityLevels(c5), ...liquidityLevels(c15)];
  // Entry mengikuti close candle konfirmasi M1, bukan harga yang sudah lari
  const trig1 = c1[c1.length - 1];
  const bHi = Math.max(trig1.o, trig1.c), bLo = Math.min(trig1.o, trig1.c);
  const entryClose = trig1.c;
  const nearClose = Math.abs(price - entryClose) <= 0.25 * atr1;
  const ranAway = dir === 1 ? price > entryClose : price < entryClose;
  let orderType, entry, entryNote;
  if (nearClose) { orderType = 'MARKET'; entry = entryClose; entryNote = 'entry close M1'; }
  else if (ranAway) { orderType = 'LIMIT'; entry = (bHi + bLo) / 2; entryNote = 'limit pullback ke body M1'; }
  else { orderType = 'LIMIT'; entry = entryClose; entryNote = 'limit di close M1'; }

  const p = planFrom({
    dir, entry, sl: sl0, orderType, minRR, liq,
    maxRisk: Math.min(BOT_CFG.maxSlAtr5 * atr5, BOT_CFG.maxSlPips * pip), // SL maks: 1.2 ATR M5 dan 60 pip
    minRisk: BOT_CFG.minSlAtr1 * atr1, atrRef: atr5 || atr1,
    setup: `SMC/ICT Bot · ${zoneHit ? 'WNS ' + zone.label : 'LTF Scalp'} · ${trigger} · ${entryNote}`,
    zone: zoneHit ? { ...zone, lower: zone.lower, upper: zone.upper, label: zone.label } : null,
  });
  if (!p.ok) {
    facts.standbyReason = p.reason;
    return standbyOut(facts, p.reason, checklist, topDown);
  }
  checklist.push(`✅ Entry & RR: 1:${p.plan.rr.toFixed(2)} · SL ${F(p.plan.sl)}`);
  facts.signal = dir === 1 ? 'BUY' : 'SELL';
  facts.entry = F(p.plan.entry); facts.sl = F(p.plan.sl);
  facts.tp = [F(p.plan.tps[0]), F(p.plan.tps[1]), F(p.plan.tps[2])];
  facts.rr = p.plan.rr.toFixed(2);
  facts.status = 'RUNNING';
  const out = toSignal(p.plan, ctx, { confidence: 'HIGH', risk: 'MEDIUM', checklist, scanSummary: checklist.join('\n'), topDown });
  return { signal: out, facts };
}

// ── AI REASONING (konsultan ngobrol) ──
const SYS_MANUAL = `Kamu adalah konsultan analis trading SMC/ICT senior yang sedang ngobrol langsung dengan trader. Gaya bicara santai, hangat, dan dinamis seperti rekan yang sedang menceritakan proses cari setup: kenapa bias ini kamu ambil, zona mana yang kamu incar, apa yang kamu tunggu, dan apa yang akan kamu lakukan kalau kondisinya terjadi. Pakai "saya" atau "kita". JANGAN pakai daftar, label kaku, atau tanda bintang. Tulis 4 sampai 6 kalimat. Sebut angka harga persis dari data dan jangan mengarang angka baru. Kalau ada setup, jelaskan entry, SL, dan TP dengan natural, dan ingat order ini LIMIT yang menunggu harga datang ke entry. Kalau belum ada setup, jelaskan kenapa menunggu, sebutkan zona yang sedang dipantau dari field watch (dengan batas harga persisnya), dan syarat masuk dari field syarat. Balas HANYA JSON valid tanpa kode blok: {"id":"...","en":"..."}. "id" berbahasa Indonesia, "en" English, isi percakapannya sama.`;
const SYS_BOT = `Kamu adalah konsultan analis yang menemani bot scalper XAUUSD sambil ngobrol dengan trader. Ceritakan dengan santai dan dinamis apa yang sedang kamu cari: struktur M5 dan M1, zona WNS HTF kalau ada, sweep, displacement, dan trigger yang masih ditunggu. Kalau zona HTF masih jauh tapi struktur LTF sudah searah, jelaskan kenapa kamu tetap siap scalp dari M1. Pakai "saya" atau "kita". JANGAN pakai daftar, label kaku, atau tanda bintang. Tulis 3 sampai 5 kalimat dengan angka harga persis dari data. Balas HANYA JSON valid tanpa kode blok: {"id":"...","en":"..."}. "id" berbahasa Indonesia, "en" English, isi percakapannya sama.`;

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
      const z = f.zone ? (id ? `Zona ${f.zone.label} di ${f.zone.lower}–${f.zone.upper} (${f.zone.tf}), sekitar ${f.zone.distAtr}x ATR dari harga.` : `${f.zone.label} zone at ${f.zone.lower}–${f.zone.upper} (${f.zone.tf}), about ${f.zone.distAtr}x ATR away.`) : '';
      return id
        ? `Saya masih cari setup di ${f.symbol}. Bias ${f.bias} dari ${f.htfTf}. ${z} ${f.standbyReason || ''} ${fbWatch(f, true)} Syarat masuk: ${f.syarat || '-'}.`
        : `I'm still looking for a setup on ${f.symbol}. Bias is ${f.bias} from ${f.htfTf}. ${z} ${f.standbyReason || ''} ${fbWatch(f, false)} Entry condition: ${f.syarat || '-'}.`;
    }
    return id
      ? `Oke, setup ${f.signal} sudah valid di ${f.symbol}. Bias ${f.bias} dari ${f.htfTf}, ${fbZone(f, true)}. Saya pasang limit di ${f.entry} dan menunggu harga datang ke sana. SL ${f.sl}, target ${f.tp[0]}, ${f.tp[1]}, ${f.tp[2]}, RR sekitar 1:${f.rr}.`
      : `Setup ${f.signal} is valid on ${f.symbol}. Bias ${f.bias} from ${f.htfTf}, ${fbZone(f, false)}. I'm placing a limit at ${f.entry} and waiting for price to come. SL ${f.sl}, targets ${f.tp[0]}, ${f.tp[1]}, ${f.tp[2]}, RR about 1:${f.rr}.`;
  }
  // bot
  if (f.status === 'RUNNING') {
    return id
      ? `Setup ${f.dirTxt} sudah lengkap. ${f.trigger} sudah close-confirmed${f.zone ? ` di dalam zona ${f.zone.label}` : ' pada struktur LTF'}. Saya eksekusi di ${f.entry}, SL ${f.sl}, TP ${f.tp[0]} / ${f.tp[1]} / ${f.tp[2]}, RR sekitar 1:${f.rr}.`
      : `${f.dirTxt} setup is complete. ${f.trigger} has closed${f.zone ? ` inside the ${f.zone.label}` : ' on LTF structure'}. Entering at ${f.entry}, SL ${f.sl}, TP ${f.tp[0]} / ${f.tp[1]} / ${f.tp[2]}, RR about 1:${f.rr}.`;
  }
  const missing = f.checklist.filter(x => x.startsWith('⬜')).map(x => x.replace('⬜ ', '')).slice(0, 3).join('; ');
  return id
    ? `Saya lagi scan terus. Struktur M5 ${f.m5}, M1 ${f.m1}. ${f.standbyReason || ''} Yang masih saya tunggu: ${missing || 'konfirmasi berikutnya'}.`
    : `I'm scanning continuously. M5 structure is ${f.m5}, M1 is ${f.m1}. ${f.standbyReason || ''} Still waiting on: ${missing || 'the next confirmation'}.`;
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
  if (k.includes('konserv') || k.includes('conserv') || k.includes('daytrad')) return 'Day Trading';
  if (k.includes('scalp')) return 'Scalping';
  return 'Day Trading';
}
function manualTfs(styleName) {
  return MANUAL_TF_NEEDED[styleName] || MANUAL_TF_NEEDED['Day Trading'];
}

async function handleCandles(body, lang, res, { email, isAutoBot }) {
  const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
  const styleName = isAutoBot ? 'Scalping' : normStyle(body.style || body.mode || 'Day Trading');
  const price = Number(body.price ?? body.livePrice ?? body.currentPrice ?? 0);
  if (!(price > 0)) return fail(res, msg(lang, 'noPrice'));

  const dec = DECIMALS[symbol] ?? 2;
  const ctx = { symbol, lang, dec, price, pip: pipSizeOf(symbol, dec), gold: isGold(symbol), kz: getKillzoneStatus(), useSma: !!isAutoBot && !!body.useSma, f: v => Number(Number(v).toFixed(dec)) };

  const candleMap = {};
  for (const tf of ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1']) candleMap[tf] = clientCandles(body, tf);
  const need = isAutoBot ? ['m1', 'm5', 'm15', 'm30', 'h1'] : manualTfs(styleName);
  try {
    for (const tf of need) {
      if (candleMap[tf] && candleMap[tf].length >= (MIN_BARS[tf] || 25)) continue;
      const rows = await fetchTickerLayerRows(symbol, TF_IV[tf], TF_NEED[tf] || 200);
      if (rows.length) candleMap[tf] = rows;
    }
  } catch (e) { console.warn('fallback TL:', e.message); }

  const data = { price };
  for (const tf of ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1']) data[tf] = candleMap[tf] || [];
  if (isAutoBot) {
    // Bot: boleh pakai TF terdekat bila ada yang kosong
    if (!data.m30.length) data.m30 = data.m15;
    if (!data.h1.length) data.h1 = data.m30;
  }
  if (!data.m5.length && !data.m15.length && !data.m1.length) return fail(res, msg(lang, 'noCandles'));

  let out;
  try {
    out = isAutoBot ? runBot(ctx, data, styleName) : await runManual(ctx, data, styleName);
  } catch (e) {
    console.error('engine error:', e);
    out = standbyOut({ mode: isAutoBot ? 'bot' : 'manual', symbol, style: styleName, status: 'STANDBY' }, `Analisa sementara gagal (${e.message}). Akan dicoba lagi.`, [], null);
  }
  if (isAutoBot && out.signal.status === 'RUNNING') await markTrialAsUsed(email);

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
