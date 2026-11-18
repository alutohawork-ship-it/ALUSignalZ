// api/generate.js
// v133 — Active Structure Analyzer + Agressive TPs + Tolerant Filters
// Update: minRR 1.8→1.5, minRRCisd 1.5→1.2, maxZoneBars 5→8, smarter botTargets.

export const config = { maxDuration: 60 };

const KV_KEY = 'alu_clients';
const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/$/, '');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || 'gpt-6-luna';
const VISION_TIMEOUT_MS = 55000;

const QWEN_BASE_URL = (process.env.QWEN_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.gutsai.id/v1').replace(/\/$/, '');
const QWEN_KEYS = [process.env.QWEN_API_KEY, process.env.QWEN_API_KEY_2, process.env.OPENAI_API_KEY].filter(Boolean);
const QWEN_MODELS = [process.env.QWEN_MODEL || 'qwen-3.8-max', process.env.QWEN_MODEL_2].filter(Boolean);
const QWEN_TIMEOUT_MS = 15000;
const QWEN_MAX_TOKENS = 700;
const VISION_MAX_TOKENS = 2600;

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
const GOLD_SYMBOLS = ['XAUUSD','XAUUSDX'];
const isGold = s => GOLD_SYMBOLS.includes(s);

const pairClassOf = symbol => {
  if (isGold(symbol)) return 'gold';
  if (symbol === 'XAGUSD' || symbol === 'XAGEUR') return 'silver';
  if (['XPTUSD','XPDUSD'].includes(symbol)) return 'metal';
  if (CRYPTO_LIST.includes(symbol) || symbol.endsWith('BTC') || symbol.endsWith('USDT')) return 'crypto';
  if (['US30','NAS100','SPX500','GER40','UK100','JPN225','FRA40','AUS200'].includes(symbol)) return 'index';
  if (['BRENT','WTI','NATGAS','COPPER','COFFEE','SUGAR'].includes(symbol)) return 'commodity';
  if (symbol.includes('JPY')) return 'fx_jpy';
  return 'fx';
};

const PAIR_CLASS_PROFILE = {
  gold:      { label: 'Emas',      slMul: 1.0, bufAtr: 0.22 },
  silver:    { label: 'Perak',     slMul: 1.1, bufAtr: 0.25 },
  metal:     { label: 'Logam',     slMul: 1.1, bufAtr: 0.25 },
  fx:        { label: 'Forex',     slMul: 1.0, bufAtr: 0.20 },
  fx_jpy:    { label: 'Forex JPY', slMul: 1.0, bufAtr: 0.20 },
  index:     { label: 'Indeks',    slMul: 1.1, bufAtr: 0.25 },
  commodity: { label: 'Komoditas', slMul: 1.2, bufAtr: 0.25 },
  crypto:    { label: 'Kripto',    slMul: 1.3, bufAtr: 0.30 },
};
const pairProfile = symbol => ({ cls: pairClassOf(symbol), ...PAIR_CLASS_PROFILE[pairClassOf(symbol)] });

const PIP_OVERRIDE = { XAUUSD: 0.1, XAUUSDX: 0.1, DXY: 0.01, US30: 1, NAS100: 1, BTCUSD: 1 };
const pipSizeOf = (symbol, dec) => PIP_OVERRIDE[symbol] ?? Math.pow(10, -(dec - 1));

const MIN_SL_PIPS = { fx: 5, fx_jpy: 5, gold: 25, silver: 8, metal: 8, crypto: 20, index: 10, commodity: 10 };
const slFloor = (kind, ctx) => {
  const base = MIN_SL_PIPS[ctx.prof.cls] || 5;
  const mult = { scalp: 1, scalp_cons: 1.1, intraday: 1.5, swing: 2.2, bot: 1 }[kind] || 1;
  return base * mult * ctx.pip;
};

const STYLES = {
  'Scalping':     { label: 'Scalping Agresif · M30+M15+M5+M1 + SMA20', kind: 'scalp',      rr: [1, 2, 3], tfs: ['m30','m15','m5','m1'] },
  'Scalping EMA': { label: 'Scalping Agresif · M30+M15+M5+M1 + SMA20', kind: 'scalp',      rr: [1, 2, 3], tfs: ['m30','m15','m5','m1'] },
  'Day Trading':  { label: 'Scalping Konservatif · H1+M15+M5',         kind: 'scalp_cons', rr: [1, 2, 3], tfs: ['h1','m15','m5'] },
  'Intraday':     { label: 'Intraday · H4+H1+M15+M5',                  kind: 'intraday',   rr: [1, 2, 3], tfs: ['h4','h1','m15','m5'] },
  'Swing':        { label: 'Swing · Daily+H4+H1+M15',                  kind: 'swing',      rr: [1, 2, 3], tfs: ['d1','h4','h1','m15'] },
};

const MIN_BARS = { m1: 60, m5: 40, m15: 40, m30: 35, h1: 35, h4: 25, d1: 20 };
const ZONE_ATR_PERIOD = 14;
const ZONE_DISP_ATR = 1.0;
const MAX_DIST_ATR = { scalp: 4.0, scalp_cons: 5.0, intraday: 7.0, swing: 12.0, bot: 2.0 };
const GOLD_SL_PIPS = { scalp: [25,65], scalp_cons: [35,110], intraday: [70,190], swing: [140,320], bot: [25,75] };
const ATR_SL_MULT = { scalp: [0.9,2.8], scalp_cons: [1.0,3.0], intraday: [1.1,3.5], swing: [1.2,4.0], bot: [0.3,1.5] };

const TL_SPAN = { '1m': { mult:1, span:'minute', minutes:1 }, '5m': { mult:5, span:'minute', minutes:5 }, '15m': { mult:15, span:'minute', minutes:15 }, '30m': { mult:30, span:'minute', minutes:30 }, '1h': { mult:1, span:'hour', minutes:60 }, '4h': { mult:4, span:'hour', minutes:240 }, '1d': { mult:1, span:'day', minutes:1440 } };
const TL_MIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const TL_ROUTE = { XAUUSD: ['commodities','XAUUSD'], XAUUSDX: ['commodities','XAUUSD'], XAGUSD: ['commodities','XAGUSD'], US30: ['indices','US30'], SPX500: ['indices','US500'], NAS100: ['indices','US100'] };

const msg = (lang, key) => ((MSG[lang] || MSG.id)[key] || key);
const MSG = {
  id: { noEmail:'Email tidak ditemukan.', notRegistered:'Email belum terdaftar.', expired:'Masa akses berakhir.', kvError:'Layanan akses bermasalah.', trialLimit:'Batas trial habis.', noPrice:'Harga live belum tersedia.', noCandles:'Data candle belum cukup.', noSetup:'Belum ada setup valid.', noKey:'OPENAI_API_KEY belum diatur.', badImage:'Gambar tidak valid.' },
  en: { noEmail:'Email not found.', notRegistered:'Email not registered.', expired:'Access expired.', kvError:'Access service issue.', trialLimit:'Trial limit reached.', noPrice:'Live price unavailable.', noCandles:'Insufficient candles.', noSetup:'No valid setup.', noKey:'OPENAI_API_KEY not set.', badImage:'Invalid image.' },
};

const isoDate = d => d.toISOString().slice(0, 10);
const withPair = (sym, text) => {
  const body = String(text || '').trim();
  if (!sym || sym === 'UNKNOWN_PAIR') return body;
  if (body.toUpperCase().startsWith(sym.toUpperCase())) return body;
  return `${sym}: ${body}`;
};

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

const kvEnabled = () => !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
async function kvCmd(command) {
  const r = await httpJson(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  }, 5000);
  if (!r.ok || !r.data || r.data.error) throw new Error((r.data && r.data.error) || `KV HTTP ${r.status}`);
  return r.data.result;
}

async function checkAccess(email, isAutoBot) {
  if (!email) return { ok: false, key: 'noEmail' };
  if (!kvEnabled()) return { ok: true, status: 'dev' };
  let raw; try { raw = await kvCmd(['GET', KV_KEY]); } catch { return { ok: false, key: 'kvError' }; }
  if (!raw) return { ok: false, key: 'notRegistered' };
  let clients; try { clients = JSON.parse(raw); } catch { return { ok: false, key: 'kvError' }; }
  const c = clients.find(x => String(x.email || '').toLowerCase() === email);
  if (!c) return { ok: false, key: 'notRegistered' };
  if (new Date(c.expires_at) <= new Date()) return { ok: false, key: 'expired' };
  if (c.status === 'trial' && isAutoBot && c.trialBotUsed) return { ok: false, key: 'trialLimit' };
  return { ok: true, status: c.status };
}

async function markTrialAsUsed(email) {
  try {
    const raw = await kvCmd(['GET', KV_KEY]);
    if (!raw) return;
    const clients = JSON.parse(raw);
    const idx = clients.findIndex(x => String(x.email || '').toLowerCase() === email);
    if (idx !== -1 && clients[idx].status === 'trial') {
      clients[idx].trialBotUsed = true;
      await kvCmd(['SET', KV_KEY, JSON.stringify(clients)]);
    }
  } catch (e) { console.error('markTrialAsUsed:', e.message); }
}

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

function cleanCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(c => ({ t: Number(c?.t ?? c?.time), o: Number(c?.o ?? c?.open), h: Number(c?.h ?? c?.high), l: Number(c?.l ?? c?.low), c: Number(c?.c ?? c?.close) }))
    .filter(c => [c.t,c.o,c.h,c.l,c.c].every(Number.isFinite)).sort((a,b) => a.t - b.t);
}

function clientCandles(body, tf) {
  const c = body?.candles || {};
  const rows = c[tf] ?? body?.[tf];
  return Array.isArray(rows) ? cleanCandles(rows) : [];
}

function getKillzoneStatus(nowMs = Date.now()) {
  try {
    const ny = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const m = ny.getHours() * 60 + ny.getMinutes();
    if (m >= 120 && m <= 300) return { active: true, name: 'LONDON KZ' };
    if (m >= 420 && m <= 600) return { active: true, name: 'NEWYORK KZ' };
    if (m >= 600 && m <= 660) return { active: true, name: 'SILVER BULLET KZ' };
    return { active: false, name: 'OUTSIDE KZ' };
  } catch { return { active: true, name: 'ACTIVE SESSION' }; }
}

function atr(c, period = 14) {
  if (!c || c.length < 2) return 15;
  const trs = [];
  for (let i = 1; i < c.length; i++) trs.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c)));
  const s = trs.slice(-period); return s.reduce((a,b) => a+b, 0) / s.length;
}
const atrOf = (c, pip) => (c && c.length >= 15 ? atr(c, ZONE_ATR_PERIOD) : 10 * pip);

function smaLast(v, p = 20) {
  if (!v || v.length < p) return null;
  let s = 0; for (let i = v.length - p; i < v.length; i++) s += v[i]; return s / p;
}

function findSwings(c, L = 2) {
  const highs = [], lows = [];
  for (let i = L; i < c.length - L; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= L; j++) {
      if (!(c[i].h > c[i-j].h && c[i].h >= c[i+j].h)) isH = false;
      if (!(c[i].l < c[i-j].l && c[i].l <= c[i+j].l)) isL = false;
    }
    if (isH) highs.push({ i, p: c[i].h });
    if (isL) lows.push({ i, p: c[i].l });
  }
  return { highs, lows };
}

function readStructure(c, price) {
  if (!c || c.length < 20) return null;
  const { highs, lows } = findSwings(c, 2);
  if (highs.length < 2 || lows.length < 2) return null;
  const h1 = highs[highs.length-1], h0 = highs[highs.length-2];
  const l1 = lows[lows.length-1], l0 = lows[lows.length-2];
  if (price > h1.p) return { dir: 1, src: 'BOS Bullish', bos: true, h1, l1, h0, l0 };
  if (price < l1.p) return { dir: -1, src: 'BOS Bearish', bos: true, h1, l1, h0, l0 };
  if (h1.p > h0.p && l1.p > l0.p) return { dir: 1, src: 'HH-HL Uptrend', bos: false, h1, l1, h0, l0 };
  if (h1.p < h0.p && l1.p < l0.p) return { dir: -1, src: 'LH-LL Downtrend', bos: false, h1, l1, h0, l0 };
  return null;
}

function findSDZones(c, dir, price) {
  const n = c.length; if (n < 20) return [];
  const a = atr(c, ZONE_ATR_PERIOD);
  const zones = [];
  for (let k = 2; k < n - 1; k++) {
    const d = c[k];
    if (dir === 1 && d.c <= d.o) continue;
    if (dir === -1 && d.c >= d.o) continue;
    if (Math.abs(d.c - d.o) < ZONE_DISP_ATR * a) continue;
    let base = -1;
    for (let b = k - 1; b >= Math.max(0, k - 3); b--) {
      if ((dir === 1 && c[b].c < c[b].o) || (dir === -1 && c[b].c > c[b].o)) { base = b; break; }
    }
    if (base < 0) continue;
    const bc = c[base]; const top = Math.max(bc.o, bc.c), bottom = Math.min(bc.o, bc.c);
    const sl = dir === 1 ? bc.l : bc.h;
    let broken = false;
    for (let j = k + 1; j < n; j++) {
      if (dir === 1 && c[j].l < bottom) { broken = true; break; }
      if (dir === -1 && c[j].h > top) { broken = true; break; }
    }
    if (broken) continue;
    const dist = dir === 1 ? Math.max(0, price - top) : Math.max(0, bottom - price);
    zones.push({ top, bottom, sl, dist, fresh: true, dir, kind: dir === 1 ? 'Demand/OB' : 'Supply/OB' });
  }
  return zones.sort((x,y) => x.dist - y.dist);
}

function detectSweep(c, lookback = 25) {
  if (!c || c.length < lookback + 3) return null;
  const n = c.length;
  const { highs, lows } = findSwings(c.slice(0, n - 1), 2);
  const recentH = highs.slice(-4);
  const recentL = lows.slice(-4);
  for (let k = n - 1; k >= Math.max(0, n - 3); k--) {
    for (const h of recentH) if (c[k].h > h.p && c[k].c < h.p) return { type: 'BSL', level: h.p, sweepExtreme: c[k].h, dir: -1, idx: k };
    for (const l of recentL) if (c[k].l < l.p && c[k].c > l.p) return { type: 'SSL', level: l.p, sweepExtreme: c[k].l, dir: 1, idx: k };
  }
  return null;
}

function lastDisplacement(c, atrVal, lookback = 4) {
  if (!c) return null;
  const n = c.length;
  for (let i = n - 1; i >= Math.max(0, n - lookback); i--) {
    const body = Math.abs(c[i].c - c[i].o);
    if (body < 1.0 * atrVal) continue;
    return { dir: c[i].c > c[i].o ? 1 : -1, idx: i, body, open: c[i].o, close: c[i].c };
  }
  return null;
}

function detectCISD(c, atrVal) {
  const n = c.length; if (n < 6) return null;
  const last = c[n-1];
  if (last.c > last.o) {
    let bear = [];
    for (let i = n-2; i >= Math.max(0, n-8); i--) {
      if (c[i].c < c[i].o) bear.push(c[i]);
      else if (bear.length > 0) break;
    }
    if (bear.length >= 2) {
      const hi = Math.max(...bear.map(b => b.o));
      const lo = Math.min(...bear.map(b => b.l));
      if (last.c > hi) return { dir: 1, level: hi, obLow: lo, obHigh: hi, dispIdx: n-1, seriesCount: bear.length };
    }
  }
  if (last.c < last.o) {
    let bull = [];
    for (let i = n-2; i >= Math.max(0, n-8); i--) {
      if (c[i].c > c[i].o) bull.push(c[i]);
      else if (bull.length > 0) break;
    }
    if (bull.length >= 2) {
      const lo = Math.min(...bull.map(b => b.o));
      const hi = Math.max(...bull.map(b => b.h));
      if (last.c < lo) return { dir: -1, level: lo, obHigh: hi, obLow: lo, dispIdx: n-1, seriesCount: bull.length };
    }
  }
  return null;
}

function validateStructureAndCISD(c, atrVal) {
  if (!c || c.length < 10) return { valid: false };
  const { highs, lows } = findSwings(c.slice(0, -1), 2);
  const last = c[c.length-1];
  const rH = highs.length ? highs[highs.length-1].p : null;
  const rL = lows.length ? lows[lows.length-1].p : null;
  if (rH && last.c > rH && last.c > last.o) {
    const body = Math.abs(last.c - last.o);
    if (body >= 0.75 * atrVal) return { valid: true, dir: 1, model: 'CHoCH/BOS', type: 'Micro CHoCH/BOS Bullish (Close Confirmed)' };
  }
  if (rL && last.c < rL && last.c < last.o) {
    const body = Math.abs(last.c - last.o);
    if (body >= 0.75 * atrVal) return { valid: true, dir: -1, model: 'CHoCH/BOS', type: 'Micro CHoCH/BOS Bearish (Close Confirmed)' };
  }
  const cisd = detectCISD(c, atrVal);
  if (cisd) return { valid: true, dir: cisd.dir, model: 'CISD', cisdLevel: cisd.level, obLow: cisd.obLow, obHigh: cisd.obHigh, type: `CISD ${cisd.dir === 1 ? 'Bullish' : 'Bearish'} Reversal (${cisd.seriesCount} candles)` };
  return { valid: false };
}

function multiTfBias(tfCandles, tfOrder) {
  const w = { d1:4, h4:3, h1:2.5, m30:2, m15:1.5, m5:1, m1:0.5 };
  let score = 0, total = 0;
  const details = {};
  for (const tf of tfOrder) {
    const c = tfCandles[tf]; if (!c || c.length < 20) continue;
    const price = c[c.length-1].c;
    const st = readStructure(c, price); if (!st) continue;
    details[tf] = `${st.dir === 1 ? 'BULL' : 'BEAR'} (${st.src})`;
    score += st.dir * (w[tf] || 1); total += (w[tf] || 1);
  }
  if (!total) return { dir: 0, bias: 'NEUTRAL', score: 0, details };
  const n = score / total;
  return { dir: n > 0.15 ? 1 : n < -0.15 ? -1 : 0, bias: n > 0.15 ? 'BULLISH' : n < -0.15 ? 'BEARISH' : 'NEUTRAL', score: Number(n.toFixed(2)), details };
}

function clampRisk(risk, kind, ctx, atrVal) {
  let min = slFloor(kind, ctx), max;
  if (ctx.gold && GOLD_SL_PIPS[kind]) { min = Math.max(min, GOLD_SL_PIPS[kind][0] * ctx.pip); max = GOLD_SL_PIPS[kind][1] * ctx.pip; }
  else { const m = ATR_SL_MULT[kind] || [1, 3]; min = Math.max(min, m[0] * atrVal); max = m[1] * atrVal; }
  if (max < min) max = min;
  return Math.min(Math.max(risk, min), max);
}

function buildOrderFromLevels({ dir, entry, invLevel, atrVal, ctx, kind, rrList }) {
  const buf = (ctx.prof.bufAtr || 0.2) * atrVal;
  const rawSl = dir === 1 ? invLevel - buf : invLevel + buf;
  const risk = clampRisk(Math.abs(entry - rawSl), kind, ctx, atrVal);
  return { dir, entry, sl: entry - dir * risk, risk, tps: rrList.map(m => entry + dir * risk * m) };
}

async function runAggressiveScalp(ctx, d) {
  const { price, m1, m5, m15, m30 } = d;
  const base = m5.length >= 30 ? m5 : m15;
  if (!base || base.length < 25) return { reason: withPair(ctx.symbol, '[SCAN] Data M5/M15 belum cukup.'), reasonEn: withPair(ctx.symbol, '[SCAN] M5/M15 insufficient.') };
  const bias = multiTfBias({ h1: d.h1, m30, m15, m5, m1 }, ['h1','m30','m15','m5','m1']);
  const atr5 = atrOf(base, ctx.pip);
  const closes = base.map(c => c.c);
  const sma20 = smaLast(closes, 20);
  if (!sma20) return { reason: withPair(ctx.symbol, '[SCAN] SMA20 belum terbentuk.'), reasonEn: withPair(ctx.symbol, '[SCAN] SMA20 not formed.') };

  const triggerTF = m1.length >= 25 ? m1 : base;
  const triggerAtr = atrOf(triggerTF, ctx.pip);
  const structConf = validateStructureAndCISD(triggerTF, triggerAtr);

  if (!structConf.valid) return { reason: withPair(ctx.symbol, '[WAIT] Belum ada CHoCH/BOS/CISD close-confirmed.'), reasonEn: withPair(ctx.symbol, '[WAIT] No close-confirmed CHoCH/BOS/CISD.') };

  const dir = structConf.dir;
  const isCisd = structConf.model === 'CISD';
  const stM1 = readStructure(triggerTF, price) || readStructure(base, price);
  const origin = dir === 1 ? (structConf.obLow ?? stM1?.l1?.p ?? price - 1.2 * atr5) : (structConf.obHigh ?? stM1?.h1?.p ?? price + 1.2 * atr5);

  const order = buildOrderFromLevels({ dir, entry: price, invLevel: dir === 1 ? Math.min(origin, sma20 - 0.4 * atr5) : Math.max(origin, sma20 + 0.4 * atr5), atrVal: atr5, ctx, kind: 'scalp', rrList: STYLES['Scalping'].rr });
  const minRR = isCisd ? 1.2 : 1.5;
  const actualRR = Math.abs(order.tps[2] - order.entry) / Math.abs(order.entry - order.sl);

  if (actualRR < minRR) return { reason: withPair(ctx.symbol, `[SKIP] RR ${actualRR.toFixed(2)} < ${minRR}.`), reasonEn: withPair(ctx.symbol, `[SKIP] RR ${actualRR.toFixed(2)} < ${minRR}.`) };

  const side = dir === 1 ? 'BUY' : 'SELL';
  const setup = `Scalping ICTxSMC · ${isCisd ? 'CISD Reversal' : 'Structure Confirmed'}`;
  const tdStr = Object.entries(bias.details).map(([k, v]) => `${k.toUpperCase()}:${v}`).join(' | ');
  const reasonId = withPair(ctx.symbol, `${side} NOW @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])}, TP2 ${ctx.f(order.tps[1])}, TP3 ${ctx.f(order.tps[2])}. ${structConf.type}. Top-Down [${tdStr}].`);
  const reasonEn = withPair(ctx.symbol, `${side} NOW @ ${ctx.f(order.entry)}, SL ${ctx.f(order.sl)}, TP1 ${ctx.f(order.tps[0])}, TP2 ${ctx.f(order.tps[1])}, TP3 ${ctx.f(order.tps[2])}. ${structConf.type}. Top-Down [${tdStr}].`);

  return {
    dir,
    plan: { isOCO: false, orderType: 'MARKET', status: 'RUNNING', entry: order.entry, sl: order.sl, tps: order.tps, setup, chartContext: `${setup}: ${side} NOW ${ctx.f(order.entry)}`, zone: null, tag: dir === 1 ? 'Demand/CISD' : 'Supply/CISD' },
    meta: { setup, confidence: 'HIGH', riskLabel: 'MEDIUM', reason: reasonId, reasons: { id: reasonId, en: reasonEn }, topDown: bias, sma20 },
  };
}

async function runTopDownLimit(ctx, d, styleName) {
  const cfg = STYLES[styleName]; const kind = cfg.kind; const rr = cfg.rr; const { price } = d;
  const tfMap = {};
  for (const tf of cfg.tfs) if (d[tf] && d[tf].length) tfMap[tf] = d[tf];
  const bias = multiTfBias(tfMap, cfg.tfs);
  const entryTF = cfg.tfs[cfg.tfs.length - 1];
  const zoneRows = d[entryTF] || d.m15 || d.m5;
  if (!zoneRows || zoneRows.length < 25) return { reason: withPair(ctx.symbol, `Data ${entryTF.toUpperCase()} belum cukup.`), reasonEn: withPair(ctx.symbol, `${entryTF.toUpperCase()} data insufficient.`) };

  const atrVal = atrOf(zoneRows, ctx.pip);
  const maxDist = (MAX_DIST_ATR[kind] || 5) * atrVal;
  const rawDemand = findSDZones(zoneRows, 1, price).filter(z => z.top < price && (price - (z.top+z.bottom)/2) <= maxDist);
  const rawSupply = findSDZones(zoneRows, -1, price).filter(z => z.bottom > price && ((z.top+z.bottom)/2 - price) <= maxDist);

  const base = { atrVal, ctx, kind, rrList: rr };
  let buy = rawDemand.length ? buildOrderFromLevels({ dir: 1, entry: (rawDemand[0].top + rawDemand[0].bottom)/2, invLevel: rawDemand[0].sl, ...base }) : null;
  let sell = rawSupply.length ? buildOrderFromLevels({ dir: -1, entry: (rawSupply[0].top + rawSupply[0].bottom)/2, invLevel: rawSupply[0].sl, ...base }) : null;

  if (bias.dir === 1) sell = null;
  if (bias.dir === -1) buy = null;
  const tdStr = Object.entries(bias.details).map(([k, v]) => `${k.toUpperCase()}:${v}`).join(' | ');

  if (!buy && !sell) {
    const st = readStructure(zoneRows, price);
    if (!st) return { reason: withPair(ctx.symbol, `[WAIT] Tidak ada zona / struktur valid pada ${cfg.label}.`), reasonEn: withPair(ctx.symbol, `[WAIT] No valid zone on ${cfg.label}.`) };
    const dir = st.dir;
    const entryF = dir === 1 ? price - 0.5 * atrVal : price + 0.5 * atrVal;
    const invF = dir === 1 ? st.l1.p : st.h1.p;
    const ord = buildOrderFromLevels({ dir, entry: entryF, invLevel: invF, atrVal, ctx, kind, rrList: rr });
    const side = dir === 1 ? 'BUY' : 'SELL';
    const reasonId = withPair(ctx.symbol, `${side} LIMIT @ ${ctx.f(ord.entry)}, SL ${ctx.f(ord.sl)}, TP1 ${ctx.f(ord.tps[0])}, TP2 ${ctx.f(ord.tps[1])}, TP3 ${ctx.f(ord.tps[2])}. Struktur ${st.src}. [${tdStr}].`);
    return {
      dir,
      plan: { isOCO: false, orderType: 'LIMIT', status: 'PENDING', entry: ord.entry, sl: ord.sl, tps: ord.tps, setup: `${cfg.label} · Dinamis`, chartContext: `${side} Limit ${ctx.f(ord.entry)}`, zone: { min: ord.entry - 0.2*atrVal, max: ord.entry + 0.2*atrVal }, tag: dir === 1 ? 'Demand' : 'Supply' },
      meta: { setup: `${cfg.label} · Dinamis`, confidence: 'MEDIUM', riskLabel: 'MEDIUM', reason: reasonId, reasons: { id: reasonId, en: reasonId }, topDown: bias },
    };
  }

  if (buy && sell) {
    const reasonId = withPair(ctx.symbol, `BUY LIMIT @ ${ctx.f(buy.entry)} (SL ${ctx.f(buy.sl)}) & SELL LIMIT @ ${ctx.f(sell.entry)} (SL ${ctx.f(sell.sl)}). Netral HTF. [${tdStr}].`);
    return {
      plan: { isOCO: true, orders: [{ ...buy, orderType: 'LIMIT', status: 'PENDING' }, { ...sell, orderType: 'LIMIT', status: 'PENDING' }], setup: cfg.label, chartContext: `${cfg.label} OCO` },
      meta: { setup: cfg.label, confidence: 'HIGH', riskLabel: 'MEDIUM', reason: reasonId, reasons: { id: reasonId, en: reasonId }, topDown: bias },
    };
  }

  const o = buy || sell;
  const side = o.dir === 1 ? 'BUY' : 'SELL';
  const setup = `${cfg.label} · Zona Terkuat`;
  const reasonId = withPair(ctx.symbol, `${side} LIMIT @ ${ctx.f(o.entry)}, SL ${ctx.f(o.sl)}, TP1 ${ctx.f(o.tps[0])}, TP2 ${ctx.f(o.tps[1])}, TP3 ${ctx.f(o.tps[2])}. [${tdStr}].`);
  return {
    dir: o.dir,
    plan: { isOCO: false, orderType: 'LIMIT', status: 'PENDING', entry: o.entry, sl: o.sl, tps: o.tps, setup, chartContext: `${side} Limit ${ctx.f(o.entry)}`, zone: { min: o.entry - 0.2*atrVal, max: o.entry + 0.2*atrVal }, tag: o.dir === 1 ? 'Demand' : 'Supply' },
    meta: { setup, confidence: 'HIGH', riskLabel: 'MEDIUM', reason: reasonId, reasons: { id: reasonId, en: reasonId }, topDown: bias },
  };
}

// ── BOT ENGINE (AGGRESSIVE v133) ──
const BOT_CFG = {
  minScore: 5,           
  confidentScore: 8,     
  splitScore: 8,         
  minRR: 1.5,            // DIUBAH: 1.8 -> 1.5
  minRRCisd: 1.2,        // DIUBAH: 1.5 -> 1.2
  dispBodyAtr: 1.0,      
  strongDispAtr: 1.5,    
  fvgMinAtr: 0.15,
  bufAtr: 0.10,
  minSlAtr: 0.30,
  maxSlAtrScalp: 1.50,
  maxChaseAtr: 2.0,      
  lookback: 80,          
  maxZoneBars: 8,        // DIUBAH: 5 -> 8 (Beri waktu 40 menit di M5)
  recentBars: 5,         
};

const tsMs = t => (t < 1e12 ? t * 1000 : t);
function closedOnly(c, ms) { if (!c || !c.length) return c || []; return Date.now() < tsMs(c[c.length-1].t) + ms ? c.slice(0, -1) : c; }

const mkZone = (type, dir, upper, lower, extra = {}) => ({ type, direction: dir, upper, lower, mid: (upper+lower)/2, ...extra });
const inZone = (p, z) => p >= z.lower && p <= z.upper;
const overlaps = (a, b) => a.lower <= b.upper && b.lower <= a.upper;

function zoneMitigation(z, candles, fromIdx) {
  const size = z.upper - z.lower; if (size <= 0) return 1;
  let pct = 0;
  for (let i = Math.max(0, fromIdx); i < candles.length; i++) {
    if (candles[i].h < z.lower || candles[i].l > z.upper) continue;
    const depth = z.direction === 1 ? (z.upper - Math.max(candles[i].l, z.lower)) : (Math.min(candles[i].h, z.upper) - z.lower);
    pct = Math.max(pct, depth / size);
  }
  return Math.min(1, pct);
}
const zoneBroken = (z, candles, fromIdx) => candles.slice(Math.max(0, fromIdx)).some(c => z.direction === 1 ? c.c < z.lower : c.c > z.upper);

function findIFVG(c, dir, fromIdx, ctx, atrV) {
  const minSize = Math.max(3 * ctx.pip, BOT_CFG.fvgMinAtr * atrV);
  let best = null;
  for (let i = Math.max(2, fromIdx); i < c.length - 1; i++) {
    if (dir === 1 && c[i].h < c[i-2].l) {
      const up = c[i-2].l, lo = c[i].h; if (up - lo < minSize) continue;
      const q = c.findIndex((x, k) => k > i && x.c > up);
      if (q > 0) best = mkZone('IFVG', 1, (up+lo)/2, lo, { label: 'IFVG BUY', createdIdx: q });
    }
    if (dir === -1 && c[i].l > c[i-2].h) {
      const lo = c[i-2].h, up = c[i].l; if (up - lo < minSize) continue;
      const q = c.findIndex((x, k) => k > i && x.c < lo);
      if (q > 0) best = mkZone('IFVG', -1, up, (up+lo)/2, { label: 'IFVG SELL', createdIdx: q });
    }
  }
  return best;
}

function findBreakerAndMitigation(c, dir, k, hasSweep) {
  const zones = [];
  if (!hasSweep && k >= 1) {
    const ob = c[k-1];
    if (dir === 1 && ob.c < ob.o) zones.push(mkZone('MITIGATION', 1, ob.h, ob.l, { label: 'MIT BUY', createdIdx: k, distal: ob.l }));
    if (dir === -1 && ob.c > ob.o) zones.push(mkZone('MITIGATION', -1, ob.h, ob.l, { label: 'MIT SELL', createdIdx: k, distal: ob.h }));
  }
  for (let b = k - 2; b >= Math.max(1, k - 12); b--) {
    if (dir === 1 && c[b].c > c[b].o && c[k].c > c[b].h) { zones.push(mkZone('BREAKER', 1, c[b].h, c[b].l, { label: 'BRK BUY', createdIdx: k, distal: c[b].l })); break; }
    if (dir === -1 && c[b].c < c[b].o && c[k].c < c[b].l) { zones.push(mkZone('BREAKER', -1, c[b].h, c[b].l, { label: 'BRK SELL', createdIdx: k, distal: c[b].h })); break; }
  }
  return zones;
}

function scanSetups(c, atrV, ctx, price, biasDir, kzActive, tfLabel = 'M5') {
  const out = []; const n = c.length; if (n < 25) return out;
  const { highs, lows } = findSwings(c, 2);
  const startK = Math.max(4, n - BOT_CFG.lookback);
  const minFvg = Math.max(3 * ctx.pip, BOT_CFG.fvgMinAtr * atrV);

  for (let k = startK; k < n; k++) {
    const d = c[k];
    const bodySize = Math.abs(d.c - d.o);
    if (bodySize < BOT_CFG.dispBodyAtr * atrV) continue;
    const dir = d.c > d.o ? 1 : -1;

    const opp = (dir === 1 ? highs : lows).filter(s => s.i < k && s.i >= k - 25);
    if (!opp.length) continue;
    const mssLvl = opp[opp.length-1].p;
    let mssIdx = -1;
    for (let m = k; m <= Math.min(k+4, n-1); m++) {
      if (dir === 1 ? c[m].c > mssLvl : c[m].c < mssLvl) { mssIdx = m; break; }
    }
    if (mssIdx < 0) continue;

    let sweep = null;
    const own = dir === 1 ? lows : highs;
    for (let j = k; j >= Math.max(2, k-10) && !sweep; j--) {
      for (let q = own.length - 1; q >= 0; q--) {
        const s = own[q]; if (s.i >= j || s.i < j - 30) continue;
        const pen = dir === 1 ? s.p - c[j].l : c[j].h - s.p;
        const back = dir === 1 ? (c[j].c > s.p || (j+1 <= k && c[j+1].c > s.p)) : (c[j].c < s.p || (j+1 <= k && c[j+1].c < s.p));
        if (pen >= 1.0 * ctx.pip && back) {
          const rg = c[j].h - c[j].l || 1;
          const wick = dir === 1 ? (Math.min(c[j].o, c[j].c) - c[j].l)/rg : (c[j].h - Math.max(c[j].o, c[j].c))/rg;
          sweep = { index: j, level: s.p, extreme: dir === 1 ? c[j].l : c[j].h, wickRatio: Number(wick.toFixed(2)) };
          break;
        }
      }
    }

    const cands = [];
    let ob = null;
    for (let o = k-1; o >= Math.max(0, k-6); o--) {
      if (dir === 1 ? c[o].c < c[o].o : c[o].c > c[o].o) {
        if (dir === 1 ? d.c > c[o].h : d.c < c[o].l) ob = mkZone('OB', dir, c[o].h, c[o].l, { createdIdx: k, distal: dir === 1 ? c[o].l : c[o].h });
        break;
      }
    }
    if (ob) cands.push(ob);

    let fvg = null;
    for (let i = k; i <= Math.min(k+2, n-1); i++) {
      if (i < 2) continue;
      if (dir === 1 && c[i].l > c[i-2].h && c[i].l - c[i-2].h >= minFvg) { const z = mkZone('FVG', 1, c[i].l, c[i-2].h, { createdIdx: i }); if (!fvg || (z.upper-z.lower) > (fvg.upper-fvg.lower)) fvg = z; }
      if (dir === -1 && c[i].h < c[i-2].l && c[i-2].l - c[i].h >= minFvg) { const z = mkZone('FVG', -1, c[i-2].l, c[i].h, { createdIdx: i }); if (!fvg || (z.upper-z.lower) > (fvg.upper-fvg.lower)) fvg = z; }
    }
    if (fvg) cands.push(fvg);

    const legLo = dir === 1 ? (sweep ? sweep.extreme : Math.min(...c.slice(Math.max(0, k-6), k+1).map(x => x.l))) : null;
    const legHi = dir === -1 ? (sweep ? sweep.extreme : Math.max(...c.slice(Math.max(0, k-6), k+1).map(x => x.h))) : null;
    let ote = null;
    if (dir === 1) { const hi = Math.max(...c.slice(k).map(x => x.h)), rg = hi - legLo; if (rg >= 1.0 * atrV) ote = mkZone('OTE', 1, hi - 0.618*rg, hi - 0.79*rg, { createdIdx: mssIdx }); }
    else { const lo = Math.min(...c.slice(k).map(x => x.l)), rg = legHi - lo; if (rg >= 1.0 * atrV) ote = mkZone('OTE', -1, lo + 0.79*rg, lo + 0.618*rg, { createdIdx: mssIdx }); }
    if (ote) cands.push(ote);

    const ifvg = findIFVG(c, dir, k - 30, ctx, atrV);
    if (ifvg) cands.push(ifvg);
    cands.push(...findBreakerAndMitigation(c, dir, k, !!sweep));

    const live = cands.filter(z => {
      const from = (z.createdIdx ?? k) + 1;
      if (zoneMitigation(z, c, from) >= 0.8) return false;
      if (zoneBroken(z, c, from)) return false;
      return true;
    });
    if (!live.length) continue;

    const prio = { IFVG: 5, FVG: 3, OB: 2, BREAKER: 2, MITIGATION: 2, OTE: 1 };
    const ranked = live.map(z => ({ z, ov: live.filter(o => o !== z && overlaps(o, z)).length, p: prio[z.type] || 1 }))
      .sort((a, b) => b.p - a.p || b.ov - a.ov || Math.abs(a.z.mid - price) - Math.abs(b.z.mid - price));
    const zone = ranked[0].z;
    const touching = live.filter(o => o === zone || overlaps(o, zone));
    const has = t => touching.some(o => o.type === t);

    const bd = [];
    if (biasDir === dir) bd.push(['Bias HTF searah', 2]);
    if (kzActive) bd.push(['Dalam Killzone', 1]);
    if (sweep) bd.push(['Liquidity sweep', 2]);
    bd.push(['Displacement ≥1.0xATR', 1]);
    if (bodySize >= BOT_CFG.strongDispAtr * atrV) bd.push(['Strong displacement ≥1.5xATR', 1]);
    bd.push([sweep ? 'MSS/CHoCH valid' : 'BOS valid', 2]);
    if (has('FVG')) bd.push(['FVG fresh', 1]);
    if (has('OB')) bd.push(['OB fresh', 1]);
    if (has('OTE')) bd.push(['OTE 61.8-79%', 1]);
    if (has('IFVG')) bd.push(['IFVG terkonfirmasi', 2]);
    if (has('BREAKER') || has('MITIGATION')) bd.push(['Breaker/Mitigation', 1]);
    bd.push(['ATR normal', 1]);
    if (zoneMitigation(zone, c, (zone.createdIdx ?? k) + 1) < 0.1) bd.push(['Zone fresh (0-10%)', 1]);
    if (sweep && sweep.wickRatio >= 0.5) bd.push(['Sweep wick bersih', 1]);
    if (k >= n - BOT_CFG.recentBars) bd.push(['Setup recent ≤5 bar', 1]);

    out.push({
      dir, tf: tfLabel, score: bd.reduce((s, x) => s + x[1], 0), breakdown: bd, zone, sweep,
      mss: { index: mssIdx, level: mssLvl }, dispIdx: k, formedIdx: mssIdx,
      obDistal: ob ? ob.distal : null,
      sweepExtreme: sweep ? sweep.extreme : (dir === 1 ? legLo : legHi),
      bodySize,
    });
  }
  return out;
}

// DIUBAH: BotTargets lebih pintar agar tidak skip setup karena swing terlalu dekat
function botTargets(dir, entry, risk, c5, c15, atrV) {
  const lv = [];
  const addSw = arr => { const s = findSwings(arr, 2); (dir === 1 ? s.highs : s.lows).forEach(x => lv.push(x.p)); };
  addSw(c5.slice(-100));
  if (c15 && c15.length >= 20) addSw(c15.slice(-80));
  const beyond = lv.filter(p => (dir === 1 ? p > entry : p < entry)).sort((a, b) => (dir === 1 ? a-b : b-a));
  const uniq = [];
  beyond.forEach(p => { if (!uniq.length || Math.abs(p - uniq[uniq.length-1]) > 0.2 * atrV) uniq.push(p); });
  const R = p => Math.abs(p - entry) / risk;
  
  const pick = (mn, mx, after) => uniq.find(p => R(p) >= mn && R(p) <= mx && (after == null || (dir === 1 ? p > after : p < after)));
  
  let t1 = pick(1.0, 1.5); 
  if (t1 == null) t1 = entry + dir * risk * 1.0; // Fallback TP1 1:1
  
  let t2 = pick(1.5, 2.5, t1); 
  if (t2 == null) t2 = entry + dir * risk * 1.8; // Fallback TP2 1:1.8
  
  let t3 = pick(2.0, 4.0, t2); 
  if (t3 == null) t3 = entry + dir * risk * 2.5; // Fallback TP3 1:2.5

  return { tps: [t1, t2, t3], rr3: R(t3) };
}

function calcBotSL({ dir, entry, setup, atrV, ctx, mode }) {
  const buf = Math.max(2 * ctx.pip, BOT_CFG.bufAtr * atrV);
  const minD = Math.max(BOT_CFG.minSlAtr * atrV, slFloor('bot', ctx));
  const maxD = BOT_CFG.maxSlAtrScalp * atrV;
  const zoneEdge = dir === 1 ? setup.zone.lower : setup.zone.upper;
  const order = mode === 'CONSERVATIVE'
    ? [['OB distal', setup.obDistal], ['sweep', setup.sweepExtreme]]
    : [['zona', zoneEdge], ['OB distal', setup.obDistal], ['sweep', setup.sweepExtreme]];
  for (const [src, L] of order) {
    if (!Number.isFinite(L)) continue;
    const sl = dir === 1 ? L - buf : L + buf;
    const dist = Math.abs(entry - sl);
    if ((dir === 1 && sl >= entry) || (dir === -1 && sl <= entry)) continue;
    if (dist < minD || dist > maxD) continue;
    return { sl, dist, src };
  }
  return { sl: entry - dir * Math.max(minD, 1.0 * atrV), dist: Math.max(minD, 1.0 * atrV), src: 'structural-fallback' };
}

// ── NARRATIVE HELPERS ──
const TF_ORDER_FULL = ['d1','h4','h1','m30','m15','m5','m1'];
const TF_LABEL = { d1:'Daily', h4:'H4', h1:'H1', m30:'M30', m15:'M15', m5:'M5', m1:'M1' };

function describeTF(tf, candles, lang) {
  const lbl = TF_LABEL[tf] || tf.toUpperCase();
  if (!candles || candles.length < 20) return lang === 'en' ? `${lbl} — waiting` : `${lbl} — menunggu data`;
  const price = candles[candles.length - 1].c;
  const st = readStructure(candles, price);
  if (!st) return lang === 'en' ? `${lbl} — ranging` : `${lbl} — ranging`;
  const dirId = st.dir === 1 ? 'bullish' : 'bearish';
  if (st.bos) return lang === 'en' ? `${lbl} — BOS ${dirId}` : `${lbl} — BOS ${dirId}`;
  return `${lbl} — ${st.src}`;
}

function buildTopDownStory(tfMap, lang, order = TF_ORDER_FULL) {
  return order.filter(tf => tfMap[tf] && tfMap[tf].length >= 20)
    .map(tf => '  • ' + describeTF(tf, tfMap[tf], lang)).join('\n');
}

function analyzeLiveStructure(c5, c15, c30, price) {
  const analyze = (candles, tfName) => {
    if (!candles || candles.length < 20) return { tf: tfName, phase: 'unknown', dir: 0, text: 'menunggu data', lastSwingHigh: null, lastSwingLow: null, lastSwingAge: 99 };
    const st = readStructure(candles, price);
    const { highs, lows } = findSwings(candles, 2);
    const lastH = highs.length ? highs[highs.length-1] : null;
    const lastL = lows.length ? lows[lows.length-1] : null;
    const ageH = lastH ? candles.length - 1 - lastH.i : 99;
    const ageL = lastL ? candles.length - 1 - lastL.i : 99;
    const age = Math.min(ageH, ageL);
    if (!st) return { tf: tfName, phase: 'ranging', dir: 0, text: 'ranging', lastSwingHigh: lastH?.p, lastSwingLow: lastL?.p, lastSwingAge: age };
    let phase = 'ranging';
    if (st.bos) phase = st.dir === 1 ? 'breakout-bullish' : 'breakout-bearish';
    else if (st.src.includes('Uptrend')) phase = 'trending-up';
    else if (st.src.includes('Downtrend')) phase = 'trending-down';
    return { tf: tfName, phase, dir: st.dir, text: st.src, lastSwingHigh: lastH?.p, lastSwingLow: lastL?.p, lastSwingAge: age };
  };
  return { m5: analyze(c5, 'M5'), m15: analyze(c15, 'M15'), m30: analyze(c30, 'M30') };
}

function buildLiveStructureBlock(live, ctx, lang) {
  const lines = [];
  const fmt = v => Number.isFinite(v) ? ctx.f(v) : '–';
  if (live.m5.phase !== 'unknown') {
    lines.push(lang === 'en'
      ? `  • M5: ${live.m5.phase}. Swing: H ${fmt(live.m5.lastSwingHigh)} / L ${fmt(live.m5.lastSwingLow)} (${live.m5.lastSwingAge} bar lalu).`
      : `  • M5: ${live.m5.phase}. Swing: H ${fmt(live.m5.lastSwingHigh)} / L ${fmt(live.m5.lastSwingLow)} (${live.m5.lastSwingAge} bar lalu).`);
  }
  if (live.m15.phase !== 'unknown') {
    lines.push(lang === 'en'
      ? `  • M15: ${live.m15.phase}. ${live.m15.text}.`
      : `  • M15: ${live.m15.phase}. ${live.m15.text}.`);
  }
  if (live.m30.phase !== 'unknown') {
    lines.push(lang === 'en'
      ? `  • M30: ${live.m30.phase}. ${live.m30.text}.`
      : `  • M30: ${live.m30.phase}. ${live.m30.text}.`);
  }
  return lines.length ? lines.join('\n') : (lang === 'en' ? '  (no live structure)' : '  (struktur belum terbaca)');
}

function buildAnalystView(ctx, { bias, tfStory, kz, liveBlock, body }) {
  const lang = ctx.lang;
  const header = lang === 'en' ? `[ANALYST — ${ctx.symbol}]` : `[ANALIS — ${ctx.symbol}]`;
  const kzTxt = kz.active ? kz.name : (lang === 'en' ? 'Outside KZ' : 'Di luar KZ');
  const biasLbl = bias.dir === 1 ? 'bullish' : bias.dir === -1 ? 'bearish' : (lang === 'en' ? 'neutral' : 'netral');
  const scoreLbl = (bias.score >= 0 ? '+' : '') + bias.score.toFixed(2);
  const synthLine = lang === 'en'
    ? `HTF bias ${biasLbl} (score ${scoreLbl}). Killzone: ${kzTxt}.`
    : `Bias HTF ${biasLbl} (skor ${scoreLbl}). Killzone: ${kzTxt}.`;

  const block = [
    header, ``,
    lang === 'en' ? `📊 TOP-DOWN SCAN (HTF → LTF):` : `📊 SCAN TOP-DOWN (HTF → LTF):`,
    tfStory || (lang === 'en' ? '  (insufficient TF data)' : '  (data TF belum cukup)'),
    ``,
    `🎯 ${lang === 'en' ? 'SYNTHESIS' : 'SINTESIS'}: ${synthLine}`,
    ``,
  ];
  if (liveBlock) { block.push(lang === 'en' ? `🔍 LIVE STRUCTURE:` : `🔍 STRUKTUR BERJALAN:`); block.push(liveBlock); block.push(``); }
  block.push(body);
  return block.join('\n');
}

// ── MAIN BOT RUNNER ──
async function runBotSma20(ctx, d, botStyleRaw) {
  const { price, m1, m5, m15, h1 } = d;
  const lang = ctx.lang;
  const c5 = closedOnly(m5, 180000);
  const c15 = m15 || [];
  const c30 = d.m30 || [];

  const tfSnapshot = { d1: d.d1, h4: d.h4, h1, m30: c30, m15: c15, m5: c5, m1: closedOnly(m1, 60000) };
  const tfStory = buildTopDownStory(tfSnapshot, lang);
  const kz = getKillzoneStatus();

  const live = analyzeLiveStructure(c5, c15, c30, price);
  const liveBlock = buildLiveStructureBlock(live, ctx, lang);

  if (!c5 || c5.length < 25) {
    const bodyTxt = lang === 'en'
      ? `⏳ Need more M5 candles (${c5?.length || 0}/25). Standby.`
      : `⏳ Butuh candle M5 lebih lengkap (${c5?.length || 0}/25). Standby.`;
    const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias: { dir: 0, score: 0 }, tfStory, kz: { active: false, name: '—' }, liveBlock, body: bodyTxt }));
    return { reason: full, reasonEn: full };
  }

  const bias = multiTfBias({ h1: h1?.length >= 20 ? h1 : null, m15: c15.length >= 15 ? c15 : null, m5: c5 }, ['h1','m15','m5']);
  const atr5 = atrOf(c5, ctx.pip);
  const atr15 = c15.length >= 20 ? atrOf(c15, ctx.pip) : atr5;
  const atr30 = c30.length >= 20 ? atrOf(c30, ctx.pip) : atr15;

  // ── MULTI-TF SCAN: M5 → M15 → M30 ──
  const scanDefs = [
    { tf: 'M5', candles: c5, atr: atr5 },
    { tf: 'M15', candles: c15, atr: atr15 },
    { tf: 'M30', candles: c30, atr: atr30 },
  ];
  let allSetups = [];
  for (const { tf, candles, atr } of scanDefs) {
    if (candles.length < 25) continue;
    const found = scanSetups(candles, atr, ctx, price, bias.dir, kz.active, tf)
      .filter(s => s.score >= BOT_CFG.minScore);
    allSetups.push(...found.map(s => ({ ...s, tf, atr, candles })));
  }
  allSetups.sort((a, b) => b.score - a.score || b.formedIdx - a.formedIdx);
  const setup = allSetups[0];

  // ═══════════ NO SETUP ═══════════
  if (!setup) {
    const nearDemand = findSDZones(c5, 1, price)[0];
    const nearSupply = findSDZones(c5, -1, price)[0];
    const poiParts = [];
    if (nearDemand) poiParts.push(`Demand ${ctx.f(nearDemand.bottom)}–${ctx.f(nearDemand.top)} (${(nearDemand.dist / atr5).toFixed(1)}x ATR)`);
    if (nearSupply) poiParts.push(`Supply ${ctx.f(nearSupply.bottom)}–${ctx.f(nearSupply.top)} (${(nearSupply.dist / atr5).toFixed(1)}x ATR)`);
    const poiTxt = poiParts.length ? poiParts.join('  |  ') : (lang === 'en' ? 'no clear POI nearby' : 'tidak ada POI jelas dekat harga');

    const body = lang === 'en'
      ? [
          `❓ WHY NO SETUP YET:`,
          `Scanned M5, M15, M30 — none passed the minimum filter (score ≥ ${BOT_CFG.minScore}).`,
          ``,
          `What's still missing (any of these in the recent bars):`,
          `  • Displacement ≥ ${BOT_CFG.dispBodyAtr}x ATR on a delivery candle`,
          `  • MSS/CHoCH confirmed by close`,
          `  • Liquidity sweep (BSL/SSL) preceding the leg`,
          `  • Fresh POI (OB/FVG/Breaker/IFVG) not yet mitigated`,
          ``,
          `🔍 Nearest POI: ${poiTxt}`,
          ``,
          `⏳ WAITING FOR:`,
          `Entry only after a valid sweep + displacement + close-confirmed MSS at a fresh POI.`,
        ].join('\n')
      : [
          `❓ MENGAPA BELUM ADA SETUP:`,
          `Saya scan M5, M15, dan M30 — belum ada yang lolos filter minimal (score ≥ ${BOT_CFG.minScore}).`,
          ``,
          `Syarat yang belum terpenuhi (minimal salah satu di bar terakhir):`,
          `  • Displacement ≥ ${BOT_CFG.dispBodyAtr}x ATR pada candle delivery`,
          `  • MSS/CHoCH close-confirmed`,
          `  • Sweep likuiditas (BSL/SSL) sebelum leg displacement`,
          `  • Zona POI fresh (OB/FVG/Breaker/IFVG) yang belum dimitigasi`,
          ``,
          `🔍 POI terdekat: ${poiTxt}`,
          ``,
          `⏳ YANG SAYA TUNGGU:`,
          `Entry hanya setelah sweep valid + displacement + MSS close-confirmed di POI fresh.`,
        ].join('\n');

    const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, liveBlock, body }));
    return { reason: full, reasonEn: full };
  }

  const dir = setup.dir;
  const side = dir === 1 ? 'BUY' : 'SELL';
  const z = setup.zone;
  const zLabel = z.label || `${z.type} ${side}`;
  const zTxt = `${zLabel} ${ctx.f(z.lower)}–${ctx.f(z.upper)} (${setup.tf})`;
  const distToZone = price < z.lower ? (z.lower - price) : (price > z.upper ? (price - z.upper) : 0);
  const setupAtr = setup.atr;
  const setupCandles = setup.candles;

  const scoreTxt = `Confluence Score ${setup.score} (${setup.tf}) — ${setup.breakdown.map(x => `${x[0]} +${x[1]}`).join(', ')}`;
  const sweepTxt = setup.sweep
    ? `Sweep ${setup.sweep.wickRatio >= 0.5 ? 'clean' : 'shallow'} ${dir === 1 ? 'SSL' : 'BSL'} @ ${ctx.f(setup.sweep.level)} (wick ${(setup.sweep.wickRatio * 100).toFixed(0)}%)`
    : `BOS continuation (no prior sweep)`;

  // ── CHASE BLOCK ──
  if (distToZone > BOT_CFG.maxChaseAtr * setupAtr) {
    const body = lang === 'en'
      ? [
          `🚫 SETUP FOUND (${setup.tf}) — CHASE BLOCKED:`,
          `${scoreTxt}`,
          `Zone ${zTxt} is ${(distToZone / setupAtr).toFixed(1)}x ATR away.`,
          `Hard-Rule 5: no chase beyond ${BOT_CFG.maxChaseAtr}x ATR.`,
          `⏳ Waiting for pullback to zone or a fresher setup.`,
        ].join('\n')
      : [
          `🚫 SETUP ADA (${setup.tf}) — CHASE DIBLOK:`,
          `${scoreTxt}`,
          `Zona ${zTxt} sudah ${(distToZone / setupAtr).toFixed(1)}x ATR dari harga.`,
          `Hard-Rule 5: no chase di atas ${BOT_CFG.maxChaseAtr}x ATR.`,
          `⏳ Menunggu pullback ke zona atau setup yang lebih fresh.`,
        ].join('\n');
    const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, liveBlock, body }));
    return { reason: full, reasonEn: full };
  }

  const priceInZone = inZone(price, z) || distToZone <= 0.15 * setupAtr;

  // ── LIMIT PLACED ──
  if (!priceInZone) {
    const slr = calcBotSL({ dir, entry: z.mid, setup, atrV: setupAtr, ctx, mode: 'CONSERVATIVE' });
    const tg = botTargets(dir, z.mid, slr.dist, setupCandles, c15, setupAtr);
    if (tg.rr3 < BOT_CFG.minRR) {
      const body = `⚠️ Setup ${zTxt} valid tapi RR 1:${tg.rr3.toFixed(2)} < 1:${BOT_CFG.minRR}. SL tidak diperkecil — setup di-skip.`;
      const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, liveBlock, body }));
      return { reason: full, reasonEn: full };
    }
    const isSplit = setup.score >= BOT_CFG.splitScore;
    const body = lang === 'en'
      ? [
          `💡 SETUP FOUND — LIMIT ORDER:`,
          `${scoreTxt}`, ``,
          `📍 Zone: ${zTxt}`,
          `📐 ${sweepTxt}`, ``,
          `🛒 ${side} LIMIT @ ${ctx.f(z.mid)} ${isSplit ? '(split 40/40/20)' : '(single fill)'}`,
          `🛡️ SL: ${ctx.f(slr.sl)} — ${slr.src}`,
          `🎯 TP1 ${ctx.f(tg.tps[0])}  |  TP2 ${ctx.f(tg.tps[1])}  |  TP3 ${ctx.f(tg.tps[2])}   (RR 1:${tg.rr3.toFixed(1)})`,
          ``,
          `SL at ${slr.src} protects against false wick sweeps. Zone break = setup invalid.`,
        ].join('\n')
      : [
          `💡 SETUP DITEMUKAN — LIMIT ORDER:`,
          `${scoreTxt}`, ``,
          `📍 Zona: ${zTxt}`,
          `📐 ${sweepTxt}`, ``,
          `🛒 ${side} LIMIT @ ${ctx.f(z.mid)} ${isSplit ? '(split 40/40/20)' : '(single fill)'}`,
          `🛡️ SL: ${ctx.f(slr.sl)} — ${slr.src}`,
          `🎯 TP1 ${ctx.f(tg.tps[0])}  |  TP2 ${ctx.f(tg.tps[1])}  |  TP3 ${ctx.f(tg.tps[2])}   (RR 1:${tg.rr3.toFixed(1)})`,
          ``,
          `SL di ${slr.src} melindungi dari wick palsu. Zona break = setup invalid.`,
        ].join('\n');
    const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, liveBlock, body }));
    const setupName = `SMC/ICT Bot · ${isSplit ? 'LIMIT SPLIT' : 'CONSERVATIVE LIMIT'} · ${z.type} · ${setup.tf}`;
    return {
      dir,
      plan: { isOCO: false, orderType: 'LIMIT', status: 'PENDING', entry: ctx.f(z.mid), sl: ctx.f(slr.sl), tps: tg.tps.map(ctx.f), setup: setupName, chartContext: `${setupName}: ${side} Limit ${ctx.f(z.mid)}`, zone: { min: z.lower, max: z.upper }, tag: zLabel },
      meta: { setup: setupName, confidence: 'HIGH', riskLabel: 'LOW', reason: full, reasons: { id: full, en: full }, topDown: bias, state: 'LIMIT_PLACED', score: setup.score },
    };
  }

  // ── HIGH CONFIDENCE DIRECT ──
  if (setup.score >= BOT_CFG.confidentScore) {
    const slr = calcBotSL({ dir, entry: price, setup, atrV: setupAtr, ctx, mode: 'AGGRESSIVE' });
    const tg = botTargets(dir, price, slr.dist, setupCandles, c15, setupAtr);
    if (tg.rr3 >= BOT_CFG.minRR) {
      const body = lang === 'en'
        ? [
            `🔥 HIGH CONFLUENCE — DIRECT ENTRY:`,
            `${scoreTxt}`,
            `📍 Price at ${zTxt} — ${sweepTxt}`, ``,
            `🛒 ${side} NOW @ ${ctx.f(price)}`,
            `🛡️ SL: ${ctx.f(slr.sl)} — ${slr.src}`,
            `🎯 TP1 ${ctx.f(tg.tps[0])}  |  TP2 ${ctx.f(tg.tps[1])}  |  TP3 ${ctx.f(tg.tps[2])}   (RR 1:${tg.rr3.toFixed(1)})`,
            ``,
            `Score ≥ ${BOT_CFG.confidentScore} + POI + displacement → direct entry.`,
          ].join('\n')
        : [
            `🔥 HIGH CONFLUENCE — DIRECT ENTRY:`,
            `${scoreTxt}`,
            `📍 Harga di ${zTxt} — ${sweepTxt}`, ``,
            `🛒 ${side} NOW @ ${ctx.f(price)}`,
            `🛡️ SL: ${ctx.f(slr.sl)} — ${slr.src}`,
            `🎯 TP1 ${ctx.f(tg.tps[0])}  |  TP2 ${ctx.f(tg.tps[1])}  |  TP3 ${ctx.f(tg.tps[2])}   (RR 1:${tg.rr3.toFixed(1)})`,
            ``,
            `Skor ≥ ${BOT_CFG.confidentScore} + POI + displacement → entry langsung.`,
          ].join('\n');
      const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, liveBlock, body }));
      const setupName = `SMC/ICT Bot · HIGH CONFIDENCE · ${z.type} · ${setup.tf}`;
      return {
        dir,
        plan: { isOCO: false, orderType: 'MARKET', status: 'RUNNING', entry: ctx.f(price), sl: ctx.f(slr.sl), tps: tg.tps.map(ctx.f), setup: setupName, chartContext: `${setupName}: ${side} NOW ${ctx.f(price)}`, zone: { min: z.lower, max: z.upper }, tag: zLabel },
        meta: { setup: setupName, confidence: 'HIGH', riskLabel: 'MEDIUM', reason: full, reasons: { id: full, en: full }, topDown: bias, state: 'CONFIRMED_DIRECT', score: setup.score },
      };
    }
  }

  // ── IN-ZONE WAIT FOR CONFIRMATION ──
  const m1c = closedOnly(m1, 60000);
  const confTF = setup.tf === 'M5' ? (m1c.length >= 10 ? m1c : c5) : setupCandles;
  const confAtr = setup.tf === 'M5' ? (m1c.length >= 10 ? atrOf(m1c, ctx.pip) : setupAtr) : setupAtr;
  const structConf = validateStructureAndCISD(confTF, confAtr);
  const barsInZone = Math.max(0, setupCandles.length - 1 - setup.formedIdx);

  if (!structConf.valid || structConf.dir !== dir) {
    if (barsInZone > BOT_CFG.maxZoneBars) {
      const body = `⏰ ZONA EXPIRED — ${barsInZone} candle di ${zTxt} tanpa CHoCH/CISD close-confirmed. Rescan area baru.`;
      const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, liveBlock, body }));
      return { reason: full, reasonEn: full };
    }
    const triggerSide = dir === 1 ? 'Micro CHoCH/BOS bullish' : 'Micro CHoCH/BOS bearish';
    const body = lang === 'en'
      ? [
          `⏳ IN ZONE — WAITING FOR TRIGGER:`,
          `${scoreTxt}`,
          `📍 ${zTxt} — price inside`,
          `⏱ ${barsInZone}/${BOT_CFG.maxZoneBars} bars in zone`, ``,
          `Before trigger I need:`,
          `  • ${triggerSide} close-confirmed on M1/M5, OR`,
          `  • CISD reversal close`, ``,
          `No confirmation = no entry. Discipline over FOMO.`,
        ].join('\n')
      : [
          `⏳ HARGA DI ZONA — MENUNGGU TRIGGER:`,
          `${scoreTxt}`,
          `📍 ${zTxt} — harga di dalam`,
          `⏱ ${barsInZone}/${BOT_CFG.maxZoneBars} candle di zona`, ``,
          `Sebelum entry saya butuh:`,
          `  • ${triggerSide} close-confirmed di M1/M5, ATAU`,
          `  • CISD reversal close`, ``,
          `Belum konfirmasi = tidak entry. Disiplin di atas FOMO.`,
        ].join('\n');
    const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, liveBlock, body }));
    return { reason: full, reasonEn: full };
  }

  // ── CONFIRMED ENTRY ──
  const isCisd = structConf.model === 'CISD';
  const minRRReq = isCisd ? BOT_CFG.minRRCisd : BOT_CFG.minRR;
  const slr = calcBotSL({ dir, entry: price, setup, atrV: setupAtr, ctx, mode: 'AGGRESSIVE' });
  const tg = botTargets(dir, price, slr.dist, setupCandles, c15, setupAtr);

  if (tg.rr3 < minRRReq) {
    const body = `⚠️ ${structConf.type} muncul tapi RR 1:${tg.rr3.toFixed(2)} < 1:${minRRReq}. SL tidak diubah — setup dibatalkan.`;
    const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, liveBlock, body }));
    return { reason: full, reasonEn: full };
  }

  const body = lang === 'en'
    ? [
        `✅ CONFIRMED — EXECUTING ${side}:`,
        `${scoreTxt}`,
        `📍 ${zTxt} + trigger: ${structConf.type}`,
        `📐 ${sweepTxt}`, ``,
        `🛒 ${side} NOW @ ${ctx.f(price)}`,
        `🛡️ SL: ${ctx.f(slr.sl)} — ${slr.src}`,
        `🎯 TP1 ${ctx.f(tg.tps[0])}  |  TP2 ${ctx.f(tg.tps[1])}  |  TP3 ${ctx.f(tg.tps[2])}   (RR 1:${tg.rr3.toFixed(1)})`,
        ``,
        `Close-candle confirmation printed at zone + HTF alignment. SL at ${slr.src} = invalidation.`,
      ].join('\n')
    : [
        `✅ TERKONFIRMASI — EKSEKUSI ${side}:`,
        `${scoreTxt}`,
        `📍 ${zTxt} + trigger: ${structConf.type}`,
        `📐 ${sweepTxt}`, ``,
        `🛒 ${side} NOW @ ${ctx.f(price)}`,
        `🛡️ SL: ${ctx.f(slr.sl)} — ${slr.src}`,
        `🎯 TP1 ${ctx.f(tg.tps[0])}  |  TP2 ${ctx.f(tg.tps[1])}  |  TP3 ${ctx.f(tg.tps[2])}   (RR 1:${tg.rr3.toFixed(1)})`,
        ``,
        `Close-candle konfirmasi di zona + arah HTF sejalan. SL di ${slr.src} = invalidasi.`,
      ].join('\n');

  const full = withPair(ctx.symbol, buildAnalystView(ctx, { bias, tfStory, kz, liveBlock, body }));
  const setupName = `SMC/ICT Bot · ${isCisd ? 'CISD Reversal' : 'Structure Confirmed'} · ${z.type} · ${setup.tf}`;

  return {
    dir,
    plan: { isOCO: false, orderType: 'MARKET', status: 'RUNNING', entry: ctx.f(price), sl: ctx.f(slr.sl), tps: tg.tps.map(ctx.f), setup: setupName, chartContext: `${setupName}: ${side} NOW ${ctx.f(price)}`, zone: { min: z.lower, max: z.upper }, tag: zLabel },
    meta: { setup: setupName, confidence: 'HIGH', riskLabel: 'MEDIUM', reason: full, reasons: { id: full, en: full }, topDown: bias, state: 'CONFIRMED', score: setup.score },
  };
}

const RUNNERS = {
  'Scalping':     runAggressiveScalp,
  'Scalping EMA': runAggressiveScalp,
  'Day Trading':  (ctx, d) => runTopDownLimit(ctx, d, 'Day Trading'),
  'Intraday':     (ctx, d) => runTopDownLimit(ctx, d, 'Intraday'),
  'Swing':        (ctx, d) => runTopDownLimit(ctx, d, 'Swing'),
};

function normStyle(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  if (k.includes('swing')) return 'Swing';
  if (k.includes('intraday')) return 'Intraday';
  if (k.includes('konserv') || k.includes('conserv') || k.includes('daytrad')) return 'Day Trading';
  if (k.includes('scalp')) return 'Scalping';
  return 'Day Trading';
}

function buildSignal(result, lang) {
  const meta = result.meta || {}; const plan = result.plan;
  const reasonsMap = meta.reasons || { id: meta.reason || '', en: meta.reason || '' };
  const chosenReason = reasonsMap[lang] || meta.reason || '';
  const common = { setup: meta.setup || plan.setup || '', confidence: meta.confidence || 'MEDIUM', risk: meta.riskLabel || 'MEDIUM', reason: chosenReason, reasons: reasonsMap, chartContext: plan.chartContext || '', topDown: meta.topDown || null, sma20: meta.sma20 ?? null, state: meta.state || null, score: meta.score ?? null };

  if (plan.isOCO) {
    return { ...common, orders: plan.orders.map(o => ({ signal: o.dir === 1 ? 'BUY' : 'SELL', orderType: 'LIMIT', fill: 'LIMIT', status: 'PENDING', entry: o.entry, sl: o.sl, tp1: o.tps[0] ?? null, tp2: o.tps[1] ?? null, tp3: o.tps[2] ?? null, zone: o.zone || null, zoneLabel: o.tag || '', zoneNote: o.label || '', setup: plan.setup })) };
  }
  const isMarket = plan.orderType === 'MARKET';
  return { ...common, signal: result.dir === 1 ? 'BUY' : 'SELL', orderType: plan.orderType, fill: isMarket ? 'NOW' : 'LIMIT', status: plan.status, entry: plan.entry, sl: plan.sl, tp1: plan.tps[0] ?? null, tp2: plan.tps[1] ?? null, tp3: plan.tps[2] ?? null, zone: plan.zone || null, zoneLabel: plan.tag || '', zoneNote: '' };
}

function pickSingleForBot(result, price) {
  if (result.plan.isOCO) {
    const o = result.plan.orders.reduce((a, b) => (Math.abs(b.entry - price) < Math.abs(a.entry - price) ? b : a));
    return { dir: o.dir, plan: { isOCO: false, orderType: 'LIMIT', status: 'PENDING', entry: o.entry, sl: o.sl, tps: o.tps, setup: `${result.meta.setup} · Bot`, chartContext: `Bot memilih ${o.dir === 1 ? 'BUY' : 'SELL'} Limit ${o.entry}`, zone: o.zone, tag: o.tag }, meta: result.meta };
  }
  return result;
}

// ── VISION AI ──
const VISION_BASE = `Kamu adalah analis trading institusional spesialis Smart Money Concept (SMC), ICT, Supply & Demand, dan Price Action.
ATURAN MUTLAK MODE VISION:
1. User mengunggah 1 hingga 3 gambar chart. Kamu WAJIB menganalisis SETIAP GAMBAR satu per satu secara eksplisit di dalam array "perImageAnalyses" tanpa terkecuali.
2. Gabungkan seluruh analisa gambar menjadi Top-Down Analysis.
3. Identifikasi: Market Structure (BOS, CHoCH, HH-HL, LH-LL), Supply/Demand, Order Block, FVG, IFVG, Breaker/Mitigation, Liquidity Sweep (BSL/SSL), CISD + Displacement, posisi harga vs SMA 20.
4. SL WAJIB logis di balik swing/zona invalidasi di chart.

Balas HANYA JSON valid:
{"signal":"BUY|SELL|NONE","orderType":"MARKET|LIMIT","entry":0,"sl":0,"tp1":0,"tp2":0,"tp3":0,"setup":"","confidence":"HIGH|MEDIUM|LOW","risk":"LOW|MEDIUM|HIGH","perImageAnalyses":["Gambar 1: ..."],"reason":"...","topDown":"...","zone":"..."}`;

function buildVisionSystem(style) {
  const map = { 'Scalping': 'STYLE: SCALPING AGRESIF. TF: M30+M15+M5+M1+SMA20.', 'Day Trading': 'STYLE: SCALPING KONSERVATIF. TF: H1+M15+M5.', 'Intraday': 'STYLE: INTRADAY. TF: M15+H1+H4.', 'Swing': 'STYLE: SWING. TF: H1+H4+Daily.' };
  return `${VISION_BASE}\n\n${map[style] || map['Day Trading']}`;
}
function extractContent(data) { const c = data?.choices?.[0]?.message?.content; if (typeof c === 'string') return c; if (Array.isArray(c)) return c.map(p => p?.text || '').join(''); return ''; }
function parseJsonLoose(text) { const s = String(text || '').replace(/```json|```/gi, '').trim(); const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a < 0 || b <= a) return null; try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; } }
function checkVisionSignal(j) {
  if (!j || typeof j !== 'object') return 'Respons AI tidak bisa dibaca.';
  const sig = String(j.signal || 'NONE').toUpperCase();
  if (sig === 'NONE') return String(j.reason || 'Tidak ada setup valid pada gambar.');
  if (sig !== 'BUY' && sig !== 'SELL') return 'Sinyal AI tidak dikenali.';
  const e = Number(j.entry), s = Number(j.sl), t1 = Number(j.tp1);
  if (![e,s,t1].every(Number.isFinite)) return 'Entry/SL/TP1 tidak lengkap.';
  const ok = sig === 'BUY' ? (s < e && e < t1) : (s > e && e > t1);
  return ok ? null : 'Level tidak konsisten dengan arah sinyal.';
}
function buildVisionSignal(j, style, lang, imgCount) {
  const sig = String(j.signal).toUpperCase();
  const isLimit = String(j.orderType || '').toUpperCase() === 'LIMIT';
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  const lvl = (v, allowed, dflt) => (allowed.includes(String(v || '').toUpperCase()) ? String(v).toUpperCase() : dflt);
  const perImg = Array.isArray(j.perImageAnalyses) && j.perImageAnalyses.length ? j.perImageAnalyses.map(item => `• ${String(item).trim()}`).join('\n') : '';
  const summary = String(j.reason || '').trim() || 'Analisis AI dari chart.';
  const fullReason = perImg ? `[Analisa ${imgCount} Gambar]\n${perImg}\n\n[Setup]\n${summary}` : summary;
  return { signal: sig, orderType: isLimit ? 'LIMIT' : 'MARKET', fill: isLimit ? 'LIMIT' : 'NOW', status: isLimit ? 'PENDING' : 'RUNNING', entry: Number(j.entry), sl: Number(j.sl), tp1: num(j.tp1), tp2: num(j.tp2), tp3: num(j.tp3), setup: String(j.setup || `Vision ${style}`), confidence: lvl(j.confidence, ['HIGH','MEDIUM','LOW'], 'MEDIUM'), risk: lvl(j.risk, ['LOW','MEDIUM','HIGH'], 'MEDIUM'), reason: fullReason, reasons: { id: fullReason, en: fullReason }, chartContext: '', zone: j.zone ? { label: String(j.zone) } : null, zoneLabel: '', zoneNote: '', topDown: j.topDown ? String(j.topDown) : null, source: 'VISION_AI' };
}
async function runVisionAnalysis(images, style, lang) {
  if (!OPENAI_API_KEY) return { ok: false, reason: msg(lang, 'noKey') };
  const imgs = images.filter(s => typeof s === 'string' && /^data:image\/(png|jpe?g|webp);base64,/i.test(s));
  if (!imgs.length) return { ok: false, reason: msg(lang, 'badImage') };
  const userContent = [
    { type: 'text', text: `Jumlah gambar: ${imgs.length}. Style: ${style}. Analisa tiap gambar.` },
    ...imgs.flatMap((url, i) => [{ type: 'text', text: `Gambar ${i+1}/${imgs.length}:` }, { type: 'image_url', image_url: { url } }]),
  ];
  const callAI = v => {
    const body = { model: AI_VISION_MODEL, messages: [{ role: 'system', content: buildVisionSystem(style) }, { role: 'user', content: userContent }] };
    if (v === 'new') body.max_completion_tokens = VISION_MAX_TOKENS; else { body.max_tokens = VISION_MAX_TOKENS; body.temperature = 0.15; }
    return httpJson(`${OPENAI_BASE_URL}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, VISION_TIMEOUT_MS);
  };
  let r = await callAI('new'); if (!r.ok && r.status === 400) r = await callAI('legacy');
  if (!r.ok) { const detail = r.data?.error?.message || (typeof r.data?.error === 'string' ? r.data.error : '') || r.text.slice(0, 160); return { ok: false, reason: `AI gagal (HTTP ${r.status}): ${detail}` }; }
  const parsed = parseJsonLoose(extractContent(r.data));
  const bad = checkVisionSignal(parsed); if (bad) return { ok: false, reason: bad };
  return { ok: true, signal: buildVisionSignal(parsed, style, lang, imgs.length) };
}
async function handleVision(body, lang, res) {
  const images = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
  if (!images.length) return fail(res, msg(lang, 'badImage'));
  const style = normStyle(body.style || body.mode);
  const out = await runVisionAnalysis(images, style, lang);
  if (!out.ok) return fail(res, out.reason);
  return res.status(200).json({ ok: true, mode: 'vision', symbol: 'VISION', style, signal: out.signal });
}

// ── QWEN REASONING (MANUAL) ──
async function qwenReasonDual(signal, ctx, styleName, lang) {
  if (!QWEN_KEYS.length) return null;
  const sys = 'You are an institutional SMC/ICT analyst. Concise, punchy reasoning in JSON: {"id":"...","en":"..."}. Preserve all prices.';
  const user = JSON.stringify({ symbol: ctx.symbol, style: styleName, signal: signal.signal, order: signal.fill, entry: signal.entry, sl: signal.sl, tp1: signal.tp1, tp2: signal.tp2, tp3: signal.tp3, setup: signal.setup, ruleReason: signal.reason, topDown: signal.topDown || null });
  const attempts = []; for (const m of QWEN_MODELS) for (const k of QWEN_KEYS.slice(0, 2)) attempts.push({ m, k });
  for (const { m, k } of attempts) {
    try {
      const r = await httpJson(`${QWEN_BASE_URL}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m, max_tokens: QWEN_MAX_TOKENS, temperature: 0.2, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }) }, QWEN_TIMEOUT_MS);
      if (!r.ok) continue;
      const parsed = parseJsonLoose(extractContent(r.data).replace(/<think>[\s\S]*?<\/think>/gi, '').trim());
      if (parsed && parsed.id && parsed.en) return parsed;
    } catch (e) { console.warn('qwenReasonDual:', e.message); }
  }
  return null;
}

// ── MAIN HANDLER ──
async function handleCandles(body, lang, res, { email, isAutoBot }) {
  const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
  const rawStyle = body.style || body.mode || 'Day Trading';
  const styleName = normStyle(rawStyle);
  const price = Number(body.price ?? body.livePrice ?? body.currentPrice ?? 0);
  if (!(price > 0)) return fail(res, msg(lang, 'noPrice'));

  const dec = DECIMALS[symbol] ?? 2;
  const ctx = { symbol, lang, dec, pip: pipSizeOf(symbol, dec), prof: pairProfile(symbol), gold: isGold(symbol), f: v => Number(Number(v).toFixed(dec)) };

  const tfsWanted = isAutoBot ? ['m1','m5','m15','h1'] : (STYLES[styleName]?.tfs || ['h1','m15','m5']);
  const candleMap = {};
  for (const tf of ['m1','m5','m15','m30','h1','h4','d1']) candleMap[tf] = clientCandles(body, tf);

  try {
    for (const tf of tfsWanted) {
      const iv = { m1:'1m', m5:'5m', m15:'15m', m30:'30m', h1:'1h', h4:'4h', d1:'1d' }[tf]; if (!iv) continue;
      if (candleMap[tf] && candleMap[tf].length >= (MIN_BARS[tf] || 25)) continue;
      const need = tf === 'd1' ? 60 : tf === 'h4' ? 80 : tf === 'h1' ? 100 : tf === 'm30' ? 100 : 200;
      const rows = await fetchTickerLayerRows(symbol, iv, need);
      if (rows.length) candleMap[tf] = rows;
    }
  } catch (e) { console.warn('fallback TL:', e.message); }

  const m5f = candleMap.m5?.length ? candleMap.m5 : candleMap.m15;
  const m15f = candleMap.m15?.length ? candleMap.m15 : candleMap.m5;
  if (!m5f?.length && !m15f?.length && !candleMap.m1?.length) return fail(res, msg(lang, 'noCandles'));

  const data = {
    price,
    m1: candleMap.m1 || [],
    m5: m5f || [],
    m15: m15f || [],
    m30: candleMap.m30?.length ? candleMap.m30 : (m15f || []),
    h1: candleMap.h1?.length ? candleMap.h1 : (candleMap.m30 || m15f || []),
    h4: candleMap.h4?.length ? candleMap.h4 : (candleMap.h1 || m15f || []),
    d1: candleMap.d1?.length ? candleMap.d1 : (candleMap.h4 || candleMap.h1 || []),
  };

  const result = isAutoBot ? await runBotSma20(ctx, data, rawStyle) : await RUNNERS[styleName](ctx, data);

  // ═══ STANDBY: tetap kirim ok:true dengan teks analis ═══
  if (!result || !result.plan) {
    const rid = result?.reason || msg('id', 'noSetup');
    const ren = result?.reasonEn || msg('en', 'noSetup');
    const standbySignal = {
      signal: 'NONE', orderType: 'NONE', fill: 'NONE', status: 'STANDBY',
      entry: null, sl: null, tp1: null, tp2: null, tp3: null,
      setup: 'STANDBY / SCANNING', confidence: 'NONE', risk: 'NONE',
      reason: lang === 'en' ? ren : rid, reasons: { id: rid, en: ren },
      chartContext: '', topDown: null, state: 'STANDBY', score: null,
    };
    return res.status(200).json({ ok: true, mode: isAutoBot ? 'bot' : 'candles', symbol, style: styleName, price, signal: standbySignal });
  }

  if (isAutoBot) await markTrialAsUsed(email);
  const final = isAutoBot ? pickSingleForBot(result, price) : result;
  const signal = buildSignal(final, lang);

  if (!isAutoBot) {
    const dual = await qwenReasonDual(signal, ctx, styleName, lang);
    if (dual) {
      signal.reasons = { id: dual.id, en: dual.en };
      signal.reason = dual[lang] || dual.id;
      signal.aiReasoning = true;
    }
  }

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
