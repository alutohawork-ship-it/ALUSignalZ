// api/scan.js
// v1 — Pure SMC/ICT Scanner. Fast, deterministic, no narrative.

export const config = { maxDuration: 30 };

const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';
const KV_KEY = 'alu_clients';

const DECIMALS = { DXY:2, EURUSD:5, GBPUSD:5, USDJPY:3, AUDUSD:5, USDCAD:5, USDCHF:5, NZDUSD:5, EURGBP:5, EURJPY:3, GBPJPY:3, AUDJPY:3, EURAUD:5, GBPAUD:5, AUDNZD:5, CADJPY:3, CHFJPY:3, EURNZD:5, XAUUSD:2, XAGUSD:3, XPTUSD:2, XPDUSD:2, XAUEUR:2, XAGEUR:3, BRENT:2, WTI:2, NATGAS:3, COPPER:4, COFFEE:2, SUGAR:2, US30:2, NAS100:2, SPX500:2, GER40:2, UK100:2, JPN225:0, FRA40:2, AUS200:2, BTCUSD:2, ETHUSD:2, SOLUSD:2, XRPUSD:4, BNBUSD:2, ADAUSD:4, DOGEUSD:5, AVAXUSD:3, LINKUSD:3, DOTUSD:4, MATICUSD:4, UNIUSD:3 };

const GOLD_SYMBOLS = ['XAUUSD', 'XAUUSDX'];
const CRYPTO_LIST = ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','ADAUSD','DOGEUSD','AVAXUSD','LINKUSD','DOTUSD','MATICUSD','UNIUSD'];

const isGold = s => GOLD_SYMBOLS.includes(s);
const pairClassOf = s => {
  if (isGold(s)) return 'gold';
  if (s === 'XAGUSD' || s === 'XAGEUR') return 'silver';
  if (['XPTUSD','XPDUSD'].includes(s)) return 'metal';
  if (CRYPTO_LIST.includes(s) || s.endsWith('BTC')) return 'crypto';
  if (['US30','NAS100','SPX500','GER40','UK100','JPN225','FRA40','AUS200'].includes(s)) return 'index';
  if (['BRENT','WTI','NATGAS','COPPER','COFFEE','SUGAR'].includes(s)) return 'commodity';
  if (s.includes('JPY')) return 'fx_jpy';
  return 'fx';
};
const PAIR_PROFILE = {
  gold: { slMul:1.0, bufAtr:0.22 }, silver: { slMul:1.1, bufAtr:0.25 }, metal: { slMul:1.1, bufAtr:0.25 },
  fx: { slMul:1.0, bufAtr:0.20 }, fx_jpy: { slMul:1.0, bufAtr:0.20 }, index: { slMul:1.1, bufAtr:0.25 },
  commodity: { slMul:1.2, bufAtr:0.25 }, crypto: { slMul:1.3, bufAtr:0.30 },
};
const pairProfile = s => ({ cls: pairClassOf(s), ...PAIR_PROFILE[pairClassOf(s)] });
const PIP_OVERRIDE = { XAUUSD:0.1, XAUUSDX:0.1, DXY:0.01, US30:1, NAS100:1, BTCUSD:1 };
const pipSizeOf = (s, d) => PIP_OVERRIDE[s] ?? Math.pow(10, -(d-1));

const TL_KEY_NAMES = ['TICKERLAYER_API_KEY', ...Array.from({ length: 19 }, (_, i) => `TICKERLAYER_API_KEY_${i+1}`)];
const API_KEYS = TL_KEY_NAMES.map(n => process.env[n] || '');
const TL_ROUTE = { XAUUSD: ['commodities','XAUUSD'], XAUUSDX: ['commodities','XAUUSD'], XAGUSD: ['commodities','XAGUSD'], US30: ['indices','US30'], SPX500: ['indices','US500'], NAS100: ['indices','US100'] };
const TL_SPAN = { '1m': { mult:1, span:'minute', minutes:1 }, '5m': { mult:5, span:'minute', minutes:5 }, '15m': { mult:15, span:'minute', minutes:15 }, '30m': { mult:30, span:'minute', minutes:30 }, '1h': { mult:1, span:'hour', minutes:60 }, '4h': { mult:4, span:'hour', minutes:240 }, '1d': { mult:1, span:'day', minutes:1440 } };

const BOT_CFG = {
  minScore: 7, confidentScore: 9, minRR: 2.0, minRRCisd: 1.5,
  dispBodyAtr: 1.2, fvgMinAtr: 0.15, bufAtr: 0.10,
  minSlAtr: 0.30, maxSlAtrScalp: 1.50, maxChaseAtr: 1.50,
  lookback: 60, maxZoneBars: 3,
};

// ── HTTP ──
async function httpJson(url, opts = {}, timeout = 8000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), timeout);
  try { const r = await fetch(url, { ...opts, signal: c.signal }); const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch {} return { ok: r.ok, status: r.status, data, text }; }
  catch (e) { if (e.name === 'AbortError') throw new Error('Timeout'); throw e; } finally { clearTimeout(t); }
}
async function kvCmd(cmd) {
  const r = await httpJson(process.env.KV_REST_API_URL, { method: 'POST', headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) }, 5000);
  if (!r.ok || !r.data || r.data.error) throw new Error(r.data?.error || `KV ${r.status}`);
  return r.data.result;
}
async function checkAccess(email, isAutoBot) {
  if (!email) return { ok: false, reason: 'Email tidak ditemukan.' };
  if (!process.env.KV_REST_API_URL) return { ok: true, status: 'dev' };
  let raw; try { raw = await kvCmd(['GET', KV_KEY]); } catch { return { ok: false, reason: 'KV error.' }; }
  if (!raw) return { ok: false, reason: 'Email belum terdaftar.' };
  let clients; try { clients = JSON.parse(raw); } catch { return { ok: false, reason: 'KV parse error.' }; }
  const c = clients.find(x => String(x.email || '').toLowerCase() === email);
  if (!c) return { ok: false, reason: 'Email belum terdaftar.' };
  if (new Date(c.expires_at) <= new Date()) return { ok: false, reason: 'Masa akses berakhir.' };
  if (c.status === 'trial' && isAutoBot && c.trialBotUsed) return { ok: false, reason: 'Trial habis.' };
  return { ok: true, status: c.status };
}

const tlCooldown = new Map();
async function tlGet(url) {
  const now = Date.now();
  const usable = API_KEYS.map((_, i) => i).filter(i => API_KEYS[i] && (tlCooldown.get(i) || 0) <= now).slice(0, 6);
  for (const i of usable) {
    try { const r = await httpJson(url, { headers: { 'x-api-key': API_KEYS[i] } }, 8000); if (r.status === 429) { tlCooldown.set(i, Date.now()+60000); continue; } if (r.ok && r.data) return r.data; }
    catch {}
  }
  return null;
}
function toEpochMs(v) { if (typeof v === 'string' && Number.isNaN(Number(v))) return Date.parse(v) || 0; const n = Number(v); return n < 1e11 ? n*1000 : n; }
function tlCandidate(s) { const u = s.toUpperCase().trim(); if (TL_ROUTE[u]) { const [a, sy] = TL_ROUTE[u]; return { asset: a, symbol: sy }; } if (CRYPTO_LIST.includes(u)) return { asset: 'crypto', symbol: u }; return { asset: 'forex', symbol: u }; }
function isoDate(d) { return d.toISOString().slice(0,10); }
function cleanCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(c => ({ t: Number(c?.t ?? c?.time), o: Number(c?.o ?? c?.open), h: Number(c?.h ?? c?.high), l: Number(c?.l ?? c?.low), c: Number(c?.c ?? c?.close) }))
    .filter(c => [c.t,c.o,c.h,c.l,c.c].every(Number.isFinite)).sort((a,b) => a.t - b.t);
}
async function fetchRows(symbol, interval, need) {
  const tf = TL_SPAN[interval]; if (!tf) return [];
  const cand = tlCandidate(symbol); const now = Date.now();
  const winMs = Math.max(need * 1.2 * tf.minutes * 60000, 7*24*3600*1000) + 86400000;
  const url = `${TICKERLAYER_BASE_URL}/${cand.asset}/agg/${cand.symbol}/${tf.mult}/${tf.span}/${isoDate(new Date(now - winMs))}/${isoDate(new Date(now + 86400000))}?sort=desc&limit=5000`;
  const data = await tlGet(url); if (!data) return [];
  const raw = Array.isArray(data) ? data : (data.results || []);
  return cleanCandles(raw.map(b => ({ t: toEpochMs(b.t ?? b.timestamp), o: b.o ?? b.open, h: b.h ?? b.high, l: b.l ?? b.low, c: b.c ?? b.close }))).slice(-Math.ceil(need));
}
function clientCandles(body, tf) {
  const c = body?.candles || {};
  const rows = c[tf] ?? body?.[tf];
  return Array.isArray(rows) ? cleanCandles(rows) : [];
}

// ── Killzone ──
function getKillzone(nowMs = Date.now()) {
  try {
    const ny = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const m = ny.getHours() * 60 + ny.getMinutes();
    if (m >= 120 && m <= 300) return { active: true, name: 'LONDON KZ' };
    if (m >= 420 && m <= 600) return { active: true, name: 'NEWYORK KZ' };
    if (m >= 600 && m <= 660) return { active: true, name: 'SILVER BULLET KZ' };
    return { active: false, name: 'OUTSIDE KZ' };
  } catch { return { active: true, name: 'ACTIVE' }; }
}

// ── Detection ──
function atr(c, p = 14) {
  if (!c || c.length < 2) return 15;
  const trs = [];
  for (let i = 1; i < c.length; i++) trs.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c)));
  const s = trs.slice(-p); return s.reduce((a,b) => a+b, 0) / s.length;
}
const atrOf = (c, pip) => (c && c.length >= 15 ? atr(c, 14) : 10*pip);

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
  if (price > h1.p) return { dir: 1, src: 'BOS Bullish', bos: true, h1, l1 };
  if (price < l1.p) return { dir: -1, src: 'BOS Bearish', bos: true, h1, l1 };
  if (h1.p > h0.p && l1.p > l0.p) return { dir: 1, src: 'HH-HL Uptrend', bos: false, h1, l1 };
  if (h1.p < h0.p && l1.p < l0.p) return { dir: -1, src: 'LH-LL Downtrend', bos: false, h1, l1 };
  return null;
}

function describeTF(tfCandles, price, label) {
  if (!tfCandles || tfCandles.length < 20) return { label, text: 'menunggu data', dir: 0 };
  const st = readStructure(tfCandles, price);
  if (!st) return { label, text: 'ranging', dir: 0 };
  return { label, text: st.src, dir: st.dir, bos: st.bos };
}

function findSDZones(c, dir, price) {
  const n = c.length; if (n < 20) return [];
  const a = atr(c, 14);
  const zones = [];
  for (let k = 2; k < n - 1; k++) {
    const d = c[k];
    if (dir === 1 && d.c <= d.o) continue;
    if (dir === -1 && d.c >= d.o) continue;
    if (Math.abs(d.c - d.o) < 1.2 * a) continue;
    let base = -1;
    for (let b = k - 1; b >= Math.max(0, k - 3); b--) {
      if ((dir === 1 && c[b].c < c[b].o) || (dir === -1 && c[b].c > c[b].o)) { base = b; break; }
    }
    if (base < 0) continue;
    const bc = c[base]; const top = Math.max(bc.o, bc.c), bottom = Math.min(bc.o, bc.c);
    let broken = false;
    for (let j = k + 1; j < n; j++) {
      if (dir === 1 && c[j].l < bottom) { broken = true; break; }
      if (dir === -1 && c[j].h > top) { broken = true; break; }
    }
    if (broken) continue;
    const dist = dir === 1 ? Math.max(0, price - top) : Math.max(0, bottom - price);
    zones.push({ top, bottom, sl: dir === 1 ? bc.l : bc.h, dist, dir, kind: dir === 1 ? 'Demand/OB' : 'Supply/OB' });
  }
  return zones.sort((x, y) => x.dist - y.dist);
}

function detectCISD(c, atrV) {
  const n = c.length; if (n < 6) return null;
  const last = c[n-1];
  if (last.c > last.o) {
    let bear = [];
    for (let i = n-2; i >= Math.max(0, n-8); i--) { if (c[i].c < c[i].o) bear.push(c[i]); else if (bear.length > 0) break; }
    if (bear.length >= 2) {
      const hi = Math.max(...bear.map(b => b.o)); const lo = Math.min(...bear.map(b => b.l));
      if (last.c > hi) return { dir: 1, level: hi, obLow: lo, obHigh: hi, seriesCount: bear.length };
    }
  }
  if (last.c < last.o) {
    let bull = [];
    for (let i = n-2; i >= Math.max(0, n-8); i--) { if (c[i].c > c[i].o) bull.push(c[i]); else if (bull.length > 0) break; }
    if (bull.length >= 2) {
      const lo = Math.min(...bull.map(b => b.o)); const hi = Math.max(...bull.map(b => b.h));
      if (last.c < lo) return { dir: -1, level: lo, obHigh: hi, obLow: lo, seriesCount: bull.length };
    }
  }
  return null;
}

function validateStructureAndCISD(c, atrV) {
  if (!c || c.length < 10) return { valid: false };
  const { highs, lows } = findSwings(c.slice(0,-1), 2);
  const last = c[c.length-1];
  const rH = highs.length ? highs[highs.length-1].p : null;
  const rL = lows.length ? lows[lows.length-1].p : null;
  if (rH && last.c > rH && last.c > last.o && Math.abs(last.c - last.o) >= 0.75 * atrV) return { valid: true, dir: 1, model: 'CHoCH/BOS', type: 'CHoCH/BOS Bullish Close-Confirmed' };
  if (rL && last.c < rL && last.c < last.o && Math.abs(last.c - last.o) >= 0.75 * atrV) return { valid: true, dir: -1, model: 'CHoCH/BOS', type: 'CHoCH/BOS Bearish Close-Confirmed' };
  const cisd = detectCISD(c, atrV);
  if (cisd) return { valid: true, dir: cisd.dir, model: 'CISD', cisdLevel: cisd.level, obLow: cisd.obLow, obHigh: cisd.obHigh, type: `CISD ${cisd.dir === 1 ? 'Bullish' : 'Bearish'} Reversal (${cisd.seriesCount} candles)` };
  return { valid: false };
}

function multiTfBias(tfCandles, order) {
  const w = { d1:4, h4:3, h1:2.5, m30:2, m15:1.5, m5:1, m1:0.5 };
  let score = 0, total = 0;
  const details = {};
  for (const tf of order) {
    const c = tfCandles[tf]; if (!c || c.length < 20) continue;
    const price = c[c.length-1].c;
    const st = readStructure(c, price); if (!st) continue;
    details[tf] = `${st.dir === 1 ? 'BULL' : 'BEAR'} (${st.src})`;
    score += st.dir * (w[tf] || 1);
    total += (w[tf] || 1);
  }
  if (!total) return { dir: 0, bias: 'NEUTRAL', score: 0, details };
  const n = score / total;
  return { dir: n > 0.15 ? 1 : n < -0.15 ? -1 : 0, bias: n > 0.15 ? 'BULLISH' : n < -0.15 ? 'BEARISH' : 'NEUTRAL', score: Number(n.toFixed(2)), details };
}

// ── Zone helpers ──
const tsMs = t => (t < 1e12 ? t * 1000 : t);
function closedOnly(c, ms) { if (!c || !c.length) return c || []; return Date.now() < tsMs(c[c.length-1].t) + ms ? c.slice(0, -1) : c; }
const mkZone = (type, dir, upper, lower, extra = {}) => ({ type, direction: dir, upper, lower, mid: (upper+lower)/2, ...extra });
const inZone = (p, z) => p >= z.lower && p <= z.upper;
const overlaps = (a, b) => a.lower <= b.upper && b.lower <= a.upper;

function zoneMitigation(z, c, from) {
  const size = z.upper - z.lower; if (size <= 0) return 1;
  let pct = 0;
  for (let i = Math.max(0, from); i < c.length; i++) {
    if (c[i].h < z.lower || c[i].l > z.upper) continue;
    const depth = z.direction === 1 ? (z.upper - Math.max(c[i].l, z.lower)) : (Math.min(c[i].h, z.upper) - z.lower);
    pct = Math.max(pct, depth / size);
  }
  return Math.min(1, pct);
}
const zoneBroken = (z, c, from) => c.slice(Math.max(0, from)).some(x => z.direction === 1 ? x.c < z.lower : x.c > z.upper);

function findIFVG(c, dir, from, ctx, atrV) {
  const minSize = Math.max(3 * ctx.pip, BOT_CFG.fvgMinAtr * atrV);
  let best = null;
  for (let i = Math.max(2, from); i < c.length - 1; i++) {
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

function scanSetups(c, atrV, ctx, price, biasDir, kzActive) {
  const out = []; const n = c.length; if (n < 25) return out;
  const { highs, lows } = findSwings(c, 2);
  const startK = Math.max(4, n - BOT_CFG.lookback);
  const minFvg = Math.max(3 * ctx.pip, BOT_CFG.fvgMinAtr * atrV);

  for (let k = startK; k < n; k++) {
    const d = c[k];
    if (Math.abs(d.c - d.o) < BOT_CFG.dispBodyAtr * atrV) continue;
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

    const legLo = dir === 1 ? (sweep ? sweep.extreme : Math.min(...c.slice(Math.max(0,k-6), k+1).map(x => x.l))) : null;
    const legHi = dir === -1 ? (sweep ? sweep.extreme : Math.max(...c.slice(Math.max(0,k-6), k+1).map(x => x.h))) : null;
    let ote = null;
    if (dir === 1) { const hi = Math.max(...c.slice(k).map(x => x.h)), rg = hi - legLo; if (rg >= 1.0*atrV) ote = mkZone('OTE', 1, hi - 0.618*rg, hi - 0.79*rg, { createdIdx: mssIdx }); }
    else { const lo = Math.min(...c.slice(k).map(x => x.l)), rg = legHi - lo; if (rg >= 1.0*atrV) ote = mkZone('OTE', -1, lo + 0.79*rg, lo + 0.618*rg, { createdIdx: mssIdx }); }
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
    bd.push(['Displacement ≥1.2xATR', 1]);
    bd.push([sweep ? 'MSS/CHoCH' : 'BOS', 2]);
    if (has('FVG')) bd.push(['FVG fresh', 1]);
    if (has('OB')) bd.push(['OB fresh', 1]);
    if (has('OTE')) bd.push(['OTE 61.8-79%', 1]);
    if (has('IFVG')) bd.push(['IFVG', 2]);
    if (has('BREAKER') || has('MITIGATION')) bd.push(['Breaker/Mit', 1]);
    bd.push(['ATR normal', 1]);

    out.push({
      dir, score: bd.reduce((s, x) => s + x[1], 0), breakdown: bd, zone, sweep,
      mss: { index: mssIdx, level: mssLvl }, dispIdx: k, formedIdx: mssIdx,
      obDistal: ob ? ob.distal : null,
      sweepExtreme: sweep ? sweep.extreme : (dir === 1 ? legLo : legHi),
    });
  }
  return out;
}

function calcBotSL({ dir, entry, setup, atrV, ctx, mode }) {
  const buf = Math.max(2 * ctx.pip, BOT_CFG.bufAtr * atrV);
  const minD = Math.max(BOT_CFG.minSlAtr * atrV, 5 * ctx.pip);
  const maxD = BOT_CFG.maxSlAtrScalp * atrV;
  const z = setup.zone;
  const zoneEdge = dir === 1 ? z.lower : z.upper;
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
  return { sl: entry - dir * Math.max(minD, 1.0*atrV), dist: Math.max(minD, 1.0*atrV), src: 'fallback' };
}

function botTargets(dir, entry, risk, c5, c15, atrV) {
  const lv = [];
  const addSw = arr => { const s = findSwings(arr, 2); (dir === 1 ? s.highs : s.lows).forEach(x => lv.push(x.p)); };
  addSw(c5.slice(-100));
  if (c15 && c15.length >= 20) addSw(c15.slice(-80));
  const beyond = lv.filter(p => (dir === 1 ? p > entry : p < entry)).sort((a,b) => (dir === 1 ? a-b : b-a));
  const uniq = [];
  beyond.forEach(p => { if (!uniq.length || Math.abs(p - uniq[uniq.length-1]) > 0.2*atrV) uniq.push(p); });
  const R = p => Math.abs(p - entry) / risk;
  const pick = (mn, mx, after) => uniq.find(p => R(p) >= mn && R(p) <= mx && (after == null || (dir === 1 ? p > after : p < after)));
  let t1 = pick(0.8, 1.8); if (t1 == null) t1 = entry + dir * risk;
  let t2 = pick(1.5, 3.0, t1); if (t2 == null) t2 = dir === 1 ? Math.max(entry + 2*risk, t1 + 0.5*risk) : Math.min(entry - 2*risk, t1 - 0.5*risk);
  let t3 = pick(2.2, 5.5, t2); if (t3 == null) t3 = dir === 1 ? Math.max(entry + 3*risk, t2 + risk) : Math.min(entry - 3*risk, t2 - risk);
  return { tps: [t1, t2, t3], rr3: R(t3) };
}

// ── LEAN SCANNER ──
function runScanLean(ctx, d) {
  const { price, m1, m5, m15, h1 } = d;
  const c5 = closedOnly(m5, 180000);

  const structures = {
    d1: describeTF(d.d1, price, 'D1'),
    h4: describeTF(d.h4, price, 'H4'),
    h1: describeTF(h1, price, 'H1'),
    m15: describeTF(m15, price, 'M15'),
    m5: describeTF(c5, price, 'M5'),
    m1: describeTF(closedOnly(m1, 60000), price, 'M1'),
  };

  const noSignal = (state, extra = {}) => ({
    signal: { action: 'NONE', orderType: 'NONE', status: 'STANDBY', state, entry: null, sl: null, tp1: null, tp2: null, tp3: null, setup: null, confidence: 'NONE', risk: 'NONE', score: null, rr: null },
    diagnostics: {
      symbol: ctx.symbol, price, timestamp: Date.now(),
      killzone: getKillzone(),
      bias: { dir: 0, label: 'NEUTRAL', score: 0, perTf: {} },
      structures: Object.fromEntries(Object.entries(structures).map(([k, v]) => [k, v.text])),
      nearestZones: { demand: null, supply: null },
      activeSetup: null, waitingFor: null, barsInZone: null,
      ...extra,
    },
  });

  if (!c5 || c5.length < 25) return noSignal('INSUFFICIENT_DATA', { waitingFor: 'M5 candles ≥ 25' });

  const kz = getKillzone();
  const atrV = atrOf(c5, ctx.pip);
  const m1c = closedOnly(m1, 60000);
  const confTF = m1c.length >= 10 ? m1c : c5;
  const atrConf = atrOf(confTF, ctx.pip);

  const bias = multiTfBias({ h1: h1?.length >= 20 ? h1 : null, m15: m15?.length >= 15 ? m15 : null, m5: c5 }, ['h1', 'm15', 'm5']);

  const nearestDemand = findSDZones(c5, 1, price)[0] || null;
  const nearestSupply = findSDZones(c5, -1, price)[0] || null;
  const fmtZone = z => z ? { lower: z.bottom, upper: z.top, kind: z.kind, distAtr: Number((z.dist / atrV).toFixed(2)) } : null;

  const baseDiag = {
    symbol: ctx.symbol, price, timestamp: Date.now(),
    killzone: kz,
    bias: { dir: bias.dir, label: bias.bias, score: bias.score, perTf: bias.details },
    structures: Object.fromEntries(Object.entries(structures).map(([k, v]) => [k, v.text])),
    nearestZones: { demand: fmtZone(nearestDemand), supply: fmtZone(nearestSupply) },
    atr: Number(atrV.toFixed(ctx.dec)),
    barsInZone: null,
  };

  let setups = scanSetups(c5, atrV, ctx, price, bias.dir, kz.active);
  setups = setups.filter(s => s.score >= BOT_CFG.minScore).sort((a, b) => b.score - a.score || b.formedIdx - a.formedIdx);

  if (!setups.length) {
    return {
      signal: { action: 'NONE', orderType: 'NONE', status: 'STANDBY', state: 'SCANNING', entry: null, sl: null, tp1: null, tp2: null, tp3: null, setup: null, confidence: 'NONE', risk: 'NONE', score: null, rr: null },
      diagnostics: { ...baseDiag, activeSetup: null, waitingFor: `Confluence Score ≥ ${BOT_CFG.minScore} (Sweep + Displacement + MSS + POI)` },
    };
  }

  const setup = setups[0];
  const dir = setup.dir;
  const z = setup.zone;
  const distToZone = price < z.lower ? (z.lower - price) : (price > z.upper ? (price - z.upper) : 0);

  const activeSetup = {
    dir, type: z.type, label: z.label || z.type, score: setup.score,
    breakdown: setup.breakdown.map(([rule, w]) => ({ rule, weight: w })),
    zone: { lower: z.lower, upper: z.upper },
    sweep: setup.sweep ? { type: setup.sweep.type, level: setup.sweep.level, wickRatio: setup.sweep.wickRatio } : null,
    distToZoneAtr: Number((distToZone / atrV).toFixed(2)),
  };

  if (distToZone > BOT_CFG.maxChaseAtr * atrV) {
    return {
      signal: { action: 'NONE', orderType: 'NONE', status: 'STANDBY', state: 'MISSED_CHASE', entry: null, sl: null, tp1: null, tp2: null, tp3: null, setup: null, confidence: 'NONE', risk: 'NONE', score: setup.score, rr: null },
      diagnostics: { ...baseDiag, activeSetup, waitingFor: 'Harga kembali ke zona (Hard-Rule 5: no chase >1.5x ATR)' },
    };
  }

  const priceInZone = inZone(price, z) || distToZone <= 0.15 * atrV;

  if (!priceInZone) {
    const slr = calcBotSL({ dir, entry: z.mid, setup, atrV, ctx, mode: 'CONSERVATIVE' });
    const tg = botTargets(dir, z.mid, slr.dist, c5, m15, atrV);
    if (tg.rr3 < BOT_CFG.minRR) {
      return {
        signal: { action: 'NONE', orderType: 'NONE', status: 'STANDBY', state: 'SKIP_RR_LOW', entry: null, sl: null, tp1: null, tp2: null, tp3: null, setup: null, confidence: 'NONE', risk: 'NONE', score: setup.score, rr: tg.rr3 },
        diagnostics: { ...baseDiag, activeSetup, waitingFor: `RR ≥ ${BOT_CFG.minRR} (currently 1:${tg.rr3.toFixed(2)})` },
      };
    }
    return {
      signal: {
        action: dir === 1 ? 'BUY' : 'SELL', orderType: 'LIMIT', status: 'PENDING', state: 'LIMIT_PLACED',
        entry: ctx.f(z.mid), sl: ctx.f(slr.sl),
        tp1: ctx.f(tg.tps[0]), tp2: ctx.f(tg.tps[1]), tp3: ctx.f(tg.tps[2]),
        setup: `${z.type} · LIMIT`, confidence: 'HIGH', risk: 'LOW', score: setup.score, rr: Number(tg.rr3.toFixed(2)),
      },
      diagnostics: { ...baseDiag, activeSetup, waitingFor: 'Harga masuk ke zona untuk fill' },
    };
  }

  if (setup.score >= BOT_CFG.confidentScore) {
    const slr = calcBotSL({ dir, entry: price, setup, atrV, ctx, mode: 'AGGRESSIVE' });
    const tg = botTargets(dir, price, slr.dist, c5, m15, atrV);
    if (tg.rr3 >= BOT_CFG.minRR) {
      return {
        signal: {
          action: dir === 1 ? 'BUY' : 'SELL', orderType: 'MARKET', status: 'RUNNING', state: 'CONFIRMED_DIRECT',
          entry: ctx.f(price), sl: ctx.f(slr.sl),
          tp1: ctx.f(tg.tps[0]), tp2: ctx.f(tg.tps[1]), tp3: ctx.f(tg.tps[2]),
          setup: `${z.type} · HIGH CONFIDENCE`, confidence: 'HIGH', risk: 'MEDIUM', score: setup.score, rr: Number(tg.rr3.toFixed(2)),
        },
        diagnostics: { ...baseDiag, activeSetup, waitingFor: 'Sudah entry (high confluence)' },
      };
    }
  }

  const structConf = validateStructureAndCISD(confTF, atrConf);
  const barsInZone = Math.max(0, c5.length - 1 - setup.formedIdx);

  if (!structConf.valid || structConf.dir !== dir) {
    if (barsInZone > BOT_CFG.maxZoneBars) {
      return {
        signal: { action: 'NONE', orderType: 'NONE', status: 'STANDBY', state: 'ZONE_EXPIRED', entry: null, sl: null, tp1: null, tp2: null, tp3: null, setup: null, confidence: 'NONE', risk: 'NONE', score: setup.score, rr: null },
        diagnostics: { ...baseDiag, activeSetup, barsInZone, waitingFor: 'Zona expired, scanning area baru' },
      };
    }
    return {
      signal: { action: 'NONE', orderType: 'NONE', status: 'STANDBY', state: 'IN_ZONE_WAITING', entry: null, sl: null, tp1: null, tp2: null, tp3: null, setup: null, confidence: 'NONE', risk: 'NONE', score: setup.score, rr: null },
      diagnostics: { ...baseDiag, activeSetup, barsInZone, waitingFor: dir === 1 ? 'CHoCH/BOS Bullish OR CISD reversal (close-confirmed)' : 'CHoCH/BOS Bearish OR CISD reversal (close-confirmed)' },
    };
  }

  const isCisd = structConf.model === 'CISD';
  const minRR = isCisd ? BOT_CFG.minRRCisd : BOT_CFG.minRR;
  const slr = calcBotSL({ dir, entry: price, setup, atrV, ctx, mode: 'AGGRESSIVE' });
  const tg = botTargets(dir, price, slr.dist, c5, m15, atrV);

  if (tg.rr3 < minRR) {
    return {
      signal: { action: 'NONE', orderType: 'NONE', status: 'STANDBY', state: 'SKIP_RR_LOW', entry: null, sl: null, tp1: null, tp2: null, tp3: null, setup: null, confidence: 'NONE', risk: 'NONE', score: setup.score, rr: tg.rr3 },
      diagnostics: { ...baseDiag, activeSetup, barsInZone, waitingFor: `RR ≥ ${minRR} (currently 1:${tg.rr3.toFixed(2)})` },
    };
  }

  return {
    signal: {
      action: dir === 1 ? 'BUY' : 'SELL', orderType: 'MARKET', status: 'RUNNING', state: 'CONFIRMED',
      entry: ctx.f(price), sl: ctx.f(slr.sl),
      tp1: ctx.f(tg.tps[0]), tp2: ctx.f(tg.tps[1]), tp3: ctx.f(tg.tps[2]),
      setup: `${isCisd ? 'CISD' : 'CHoCH'} · ${z.type}`, confidence: 'HIGH', risk: 'MEDIUM', score: setup.score, rr: Number(tg.rr3.toFixed(2)),
      trigger: structConf.type,
    },
    diagnostics: { ...baseDiag, activeSetup, barsInZone, waitingFor: 'Sudah entry (confirmed)' },
  };
}

// ── Handler ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'POST only' });

  try {
    let body = req.body || {};
    if (typeof body === 'string') try { body = JSON.parse(body); } catch { return res.status(400).json({ ok: false, reason: 'Invalid JSON' }); }

    const symbol = String(body.symbol || 'XAUUSD').toUpperCase();
    const price = Number(body.price ?? body.livePrice ?? body.currentPrice ?? 0);
    if (!(price > 0)) return res.status(200).json({ ok: false, reason: 'Harga live belum tersedia.' });

    const email = String(body.email || '').trim().toLowerCase();
    const access = await checkAccess(email, true);
    if (!access.ok) return res.status(200).json({ ok: false, reason: access.reason });

    const dec = DECIMALS[symbol] ?? 2;
    const ctx = { symbol, dec, pip: pipSizeOf(symbol, dec), prof: pairProfile(symbol), f: v => Number(Number(v).toFixed(dec)) };

    const candleMap = { m1: clientCandles(body, 'm1'), m5: clientCandles(body, 'm5'), m15: clientCandles(body, 'm15'), m30: clientCandles(body, 'm30'), h1: clientCandles(body, 'h1'), h4: clientCandles(body, 'h4'), d1: clientCandles(body, 'd1') };

    const need = { m1: 200, m5: 200, m15: 100, m30: 100, h1: 100, h4: 80, d1: 60 };
    const ivs = { m1: '1m', m5: '5m', m15: '15m', m30: '30m', h1: '1h', h4: '4h', d1: '1d' };
    for (const tf of ['m1', 'm5', 'm15', 'h1']) {
      if (candleMap[tf]?.length >= (need[tf] || 50)) continue;
      const rows = await fetchRows(symbol, ivs[tf], need[tf]);
      if (rows.length) candleMap[tf] = rows;
    }

    const data = {
      price,
      m1: candleMap.m1,
      m5: candleMap.m5?.length ? candleMap.m5 : candleMap.m15,
      m15: candleMap.m15?.length ? candleMap.m15 : candleMap.m5,
      m30: candleMap.m30?.length ? candleMap.m30 : candleMap.m15,
      h1: candleMap.h1?.length ? candleMap.h1 : candleMap.m15,
      h4: candleMap.h4?.length ? candleMap.h4 : candleMap.h1,
      d1: candleMap.d1?.length ? candleMap.d1 : candleMap.h4,
    };

    const scan = runScanLean(ctx, data);
    return res.status(200).json({ ok: true, mode: 'scan', symbol, price, ...scan });
  } catch (err) {
    console.error('scan.js error:', err);
    return res.status(500).json({ ok: false, reason: err.message });
  }
}
