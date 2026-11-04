export const config = { maxDuration: 30 };

// ======================= SPESIFIKASI MARKET =======================
const SPEC = {
  XAUUSD:   { pip: 0.1,    dec: 2, hl: ['xyz:GOLD', 'xyz:XAU'], yf: 'GC=F' },
  XAGUSD:   { pip: 0.01,   dec: 3, hl: ['xyz:SILVER'], yf: 'SI=F' },
  EURUSD:   { pip: 0.0001, dec: 5, yf: 'EURUSD=X' },
  USDJPY:   { pip: 0.01,   dec: 3, yf: 'JPY=X' },
  GBPUSD:   { pip: 0.0001, dec: 5, yf: 'GBPUSD=X' },
  GBPJPY:   { pip: 0.01,   dec: 3, yf: 'GBPJPY=X' },
  BTCUSDT:  { pip: 1,      dec: 2, bn: 'BTCUSDT', yf: 'BTC-USD' },
  ETHUSDT:  { pip: 0.1,    dec: 2, bn: 'ETHUSDT', yf: 'ETH-USD' },
  SOLUSDT:  { pip: 0.01,   dec: 2, bn: 'SOLUSDT', yf: 'SOL-USD' },
  XRPUSDT:  { pip: 0.0001, dec: 4, bn: 'XRPUSDT', yf: 'XRP-USD' },
  NVDAUSDT: { pip: 0.01,   dec: 2, yf: 'NVDA' },
  TSLAUSDT: { pip: 0.01,   dec: 2, yf: 'TSLA' },
  'xyz:BRENTOIL': { pip: 0.01, dec: 2, hl: ['xyz:BRENTOIL'], yf: 'BZ=F' },
  'xyz:SP500':    { pip: 0.1,  dec: 2, hl: ['xyz:SP500'], yf: 'ES=F' },
  'xyz:NAS100':   { pip: 1,    dec: 2, hl: ['xyz:XYZ100', 'xyz:NAS100'], yf: 'NQ=F' },
  'xyz:AAPL':     { pip: 0.01, dec: 2, hl: ['xyz:AAPL'], yf: 'AAPL' },
  DJI:    { pip: 1, dec: 2, yf: 'YM=F' },
  NIKKEI: { pip: 1, dec: 2, yf: 'NIY=F' },
  DAX:    { pip: 1, dec: 2, yf: '^GDAXI' },
};

// ======================= GAYA TRADING =======================
// htf / mtf / ltf : HTF = bias | MTF = struktur & POI | LTF = trigger saja
// bufM / bufL     : buffer SL = max(bufM x ATR_MTF, bufL x ATR_LTF)
// minSl / maxSl   : jarak SL dalam satuan ATR_MTF
// maxPull         : jarak maksimal POI dari harga (x ATR_MTF)
// confirm         : true = intraday/swing wajib konfirmasi, false = scalp/day boleh reaksi
// sweepLook       : sweep dianggap relevan jika terjadi dalam N candle LTF terakhir
// maxTpR          : batas pencarian target likuiditas (x R)
const STYLES = {
  scalp: { htf: '15m', mtf: '5m',  ltf: '1m',  confirm: false, maxPull: 2.5, bufM: 0.5, bufL: 0.8, minSl: 1.2, maxSl: 2.5, rr: [1.2, 2.0, 3.0], maxTpR: 5, sweepLook: 8 },
  day:   { htf: '1h',  mtf: '15m', ltf: '5m',  confirm: false, maxPull: 2.5, bufM: 0.5, bufL: 0.6, minSl: 1.0, maxSl: 2.5, rr: [1.2, 2.2, 3.2], maxTpR: 6, sweepLook: 8 },
  intra: { htf: '4h',  mtf: '1h',  ltf: '5m',  confirm: true,  maxPull: 3.0, bufM: 0.4, bufL: 0.5, minSl: 1.0, maxSl: 2.5, rr: [1.5, 2.5, 3.5], maxTpR: 7, sweepLook: 10 },
  swing: { htf: '1d',  mtf: '4h',  ltf: '15m', confirm: true,  maxPull: 3.0, bufM: 0.4, bufL: 0.4, minSl: 1.0, maxSl: 3.0, rr: [1.5, 2.8, 4.5], maxTpR: 8, sweepLook: 10 },
};
const pickStyle = s => /scalp/i.test(s) ? 'scalp' : /day/i.test(s) ? 'day' : /swing/i.test(s) ? 'swing' : 'intra';

const TF_LABEL = { '1m': 'M1', '3m': 'M3', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D1' };
const TF_MS = { '1m': 6e4, '3m': 18e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };
const YF_TF = {
  '1m': { i: '1m', r: '5d' },
  '3m': { i: '1m', r: '5d', agg: 3 },
  '5m': { i: '5m', r: '5d' },
  '15m': { i: '15m', r: '1mo' },
  '30m': { i: '30m', r: '1mo' },
  '1h': { i: '60m', r: '3mo' },
  '4h': { i: '60m', r: '6mo', agg: 4 },
  '1d': { i: '1d', r: '2y' },
};

// ======================= DATA CANDLE =======================
async function fetchJSON(url, opts = {}, ms = 4500) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(tm); }
}

function aggregate(c, ms) {
  const out = [];
  for (const k of c) {
    const b = Math.floor(k.t / ms) * ms, last = out[out.length - 1];
    if (last && last.t === b) { last.h = Math.max(last.h, k.h); last.l = Math.min(last.l, k.l); last.c = k.c; last.v += k.v; }
    else out.push({ ...k, t: b });
  }
  return out;
}

async function fromHL(coin, tf) {
  const end = Date.now(), start = end - TF_MS[tf] * 300;
  const j = await fetchJSON('https://api.hyperliquid.xyz/info', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'candleSnapshot', req: { coin, interval: tf, startTime: start, endTime: end } }),
  });
  return (Array.isArray(j) ? j : []).map(k => ({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }));
}

async function fromBinance(sym, tf) {
  const j = await fetchJSON(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=${tf}&limit=300`);
  return j.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
}

async function fromYahoo(sym, tf) {
  const { i, r, agg } = YF_TF[tf];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${i}&range=${r}&includePrePost=true`;
  const j = await fetchJSON(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const res = j?.chart?.result?.[0], ts = res?.timestamp || [], q = res?.indicators?.quote?.[0] || {};
  let c = [];
  ts.forEach((t, k) => {
    const o = q.open?.[k], h = q.high?.[k], l = q.low?.[k], cl = q.close?.[k];
    if ([o, h, l, cl].every(Number.isFinite)) c.push({ t: t * 1000, o, h, l, c: cl, v: q.volume?.[k] || 0 });
  });
  if (agg) c = aggregate(c, TF_MS[tf]);
  return c.slice(-300);
}

const staleLimit = tf => Math.max(30 * 6e4, 6 * TF_MS[tf]);

async function getCandles(spec, tf) {
  const tries = [];
  (spec.hl || []).forEach(c => tries.push(['Hyperliquid', () => fromHL(c, tf)]));
  if (spec.bn) tries.push(['Binance', () => fromBinance(spec.bn, tf)]);
  if (spec.yf) tries.push(['Yahoo', () => fromYahoo(spec.yf, tf)]);
  let fallback = null;
  for (const [src, fn] of tries) {
    try {
      const c = await fn();
      if (c.length < 60) continue;
      const stale = Date.now() - c[c.length - 1].t > staleLimit(tf);
      if (!stale) return { src, c, stale };
      fallback ??= { src, c, stale };
    } catch {}
  }
  if (fallback) return fallback;
  throw new Error(`Data candle ${TF_LABEL[tf]} tidak tersedia`);
}

// ======================= TOOLS PRICE ACTION =======================
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ATR (true range rata-rata): skala untuk buffer, SL, dan zona
function atr(c, n = 14) {
  const s = c.slice(-(n + 1));
  let sum = 0, cnt = 0;
  for (let i = 1; i < s.length; i++) {
    const k = s[i], p = s[i - 1];
    sum += Math.max(k.h - k.l, Math.abs(k.h - p.c), Math.abs(k.l - p.c));
    cnt++;
  }
  return cnt ? sum / cnt : 0;
}

// Swing high/low (fractal k candle kiri-kanan)
function swings(c, k) {
  const s = [];
  for (let i = k; i < c.length - k; i++) {
    let H = true, L = true;
    for (let j = 1; j <= k; j++) {
      if (c[i].h <= c[i - j].h || c[i].h < c[i + j].h) H = false;
      if (c[i].l >= c[i - j].l || c[i].l > c[i + j].l) L = false;
    }
    if (H) s.push({ i, type: 'H', p: c[i].h });
    if (L) s.push({ i, type: 'L', p: c[i].l });
  }
  return s;
}

// Struktur pasar: trend, BOS, CHoCH
function structure(c, k) {
  const sw = swings(c, k), events = [];
  let trend = 0, lastH = null, lastL = null, si = 0;
  for (let i = 0; i < c.length; i++) {
    while (si < sw.length && sw[si].i + k <= i) {
      const s = { ...sw[si++] };
      if (s.type === 'H') lastH = s; else lastL = s;
    }
    if (lastH && !lastH.broken && c[i].c > lastH.p) {
      lastH.broken = true;
      events.push({ i, dir: 1, type: trend === -1 ? 'CHoCH' : 'BOS', level: lastH.p });
      trend = 1;
    }
    if (lastL && !lastL.broken && c[i].c < lastL.p) {
      lastL.broken = true;
      events.push({ i, dir: -1, type: trend === 1 ? 'CHoCH' : 'BOS', level: lastL.p });
      trend = -1;
    }
  }
  return { trend, events, last: events.at(-1), swings: sw };
}

// Leg terakhir untuk menghitung kedalaman pullback
function legOf(sw) {
  const lh = sw.filter(s => s.type === 'H').at(-1), ll = sw.filter(s => s.type === 'L').at(-1);
  if (!lh || !ll) return null;
  return { up: lh.i > ll.i, hi: lh.p, lo: ll.p, range: Math.max(lh.p - ll.p, 1e-9) };
}

// Kedalaman retrace 0..1 terhadap leg searah dir
function depth(leg, dir, p) {
  if (!leg || leg.up !== (dir > 0)) return null;
  return dir > 0 ? (leg.hi - p) / leg.range : (p - leg.lo) / leg.range;
}

// Liquidity pool: swing yang belum diambil + equal highs/lows
function liquidity(c, sw, tol) {
  const n = c.length;
  const untaken = s => {
    for (let j = s.i + 1; j < n; j++) if (s.type === 'H' ? c[j].h > s.p : c[j].l < s.p) return false;
    return true;
  };
  const pools = sw.filter(untaken).map(s => ({ type: s.type, p: s.p, i: s.i, eq: false }));
  for (const a of pools) a.eq = pools.some(b => b !== a && b.type === a.type && Math.abs(b.p - a.p) <= tol);
  return pools;
}

// Sweep: wick menembus swing lalu close kembali
function findSweep(c, sw, tol, recent = 6) {
  const n = c.length;
  let best = null;
  for (let i = n - 1; i >= Math.max(1, n - recent); i--) {
    const prior = sw.filter(s => s.i < i - 1 && s.i >= i - 60);
    for (const s of prior) {
      const bull = s.type === 'L' && c[i].l < s.p && c[i].c > s.p;
      const bear = s.type === 'H' && c[i].h > s.p && c[i].c < s.p;
      if (!bull && !bear) continue;
      const eq = prior.some(o => o !== s && o.type === s.type && Math.abs(o.p - s.p) <= tol);
      const cand = { dir: bull ? 1 : -1, level: s.p, i, eq };
      if (!best || (eq && !best.eq)) best = cand;
    }
    if (best) return best;
  }
  return null;
}

// Supply & Demand: base lalu candle impuls, belum dilanggar dan belum disentuh ulang lebih dari sekali
function sndZones(c, R, look = 120) {
  const out = [], n = c.length;
  for (let i = Math.max(3, n - look); i < n - 1; i++) {
    const k = c[i], rng = k.h - k.l, body = Math.abs(k.c - k.o);
    if (rng < 1.5 * R || body < 0.6 * rng) continue;
    const dir = Math.sign(k.c - k.o);
    let j = i - 1;
    const base = [c[j]];
    while (base.length < 3 && j - 1 >= 0 && (c[j - 1].h - c[j - 1].l) < 0.8 * R) { j--; base.push(c[j]); }
    const lo = dir > 0 ? Math.min(...base.map(x => x.l)) : Math.min(...base.map(x => Math.min(x.o, x.c)));
    const hi = dir > 0 ? Math.max(...base.map(x => Math.max(x.o, x.c))) : Math.max(...base.map(x => x.h));
    if (hi <= lo) continue;
    let touches = 0, inside = false, broken = false;
    for (let m = i + 2; m < n; m++) {
      if (dir > 0 ? c[m].c < lo : c[m].c > hi) { broken = true; break; }
      const inZ = dir > 0 ? c[m].l <= hi : c[m].h >= lo;
      if (inZ && !inside) touches++;
      inside = inZ;
    }
    if (broken || touches > 1) continue;
    out.push({ kind: dir > 0 ? 'Demand' : 'Supply', dir, lo, hi, i, touches });
  }
  return out;
}

// Fair Value Gap yang belum terisi
function fvgs(c, R, lookback = 60) {
  const out = [];
  for (let i = Math.max(2, c.length - lookback); i < c.length; i++) {
    if (c[i].l > c[i - 2].h) out.push({ kind: 'FVG', dir: 1, lo: c[i - 2].h, hi: c[i].l, i, touches: 0 });
    if (c[i].h < c[i - 2].l) out.push({ kind: 'FVG', dir: -1, lo: c[i].h, hi: c[i - 2].l, i, touches: 0 });
  }
  return out.filter(g => {
    if (g.hi - g.lo < 0.15 * R) return false;
    for (let j = g.i + 1; j < c.length; j++) {
      if (g.dir > 0 && c[j].l <= g.lo) return false;
      if (g.dir < 0 && c[j].h >= g.hi) return false;
    }
    return true;
  });
}

// Order Block: candle berlawanan terakhir sebelum BOS
function orderBlock(c, ev) {
  if (!ev) return null;
  for (let j = ev.i - 1; j >= Math.max(0, ev.i - 15); j--) {
    const k = c[j];
    if (ev.dir > 0 ? k.c < k.o : k.c > k.o) {
      for (let m = j + 1; m < c.length; m++) {
        if (ev.dir > 0 && c[m].c < k.l) return null;
        if (ev.dir < 0 && c[m].c > k.h) return null;
      }
      return { kind: 'OB', dir: ev.dir, lo: k.l, hi: k.h, i: j, touches: 0 };
    }
  }
  return null;
}

// Support & Resistance: cluster swing (minimal 2 sentuhan)
function snrLevels(points, tol) {
  const s = [...points].sort((a, b) => a.p - b.p), out = [];
  let g = [];
  const flush = () => {
    if (g.length >= 2) out.push({ p: g.reduce((a, x) => a + x.p, 0) / g.length, n: g.length });
    g = [];
  };
  for (const x of s) {
    if (g.length && x.p - g[0].p > tol) flush();
    g.push(x);
  }
  flush();
  return out;
}

// Konfirmasi candle (hanya candle yang sudah close)
function candleSignal(c, R) {
  const n = c.length;
  for (const i of [n - 2, n - 3]) {
    if (i < 1) continue;
    const k = c[i], p = c[i - 1], rng = k.h - k.l, body = Math.abs(k.c - k.o);
    if (rng <= 0) continue;
    const up = k.h - Math.max(k.o, k.c), dn = Math.min(k.o, k.c) - k.l;
    if (k.c > k.o && p.c < p.o && k.c > p.o && k.o <= p.c && body >= 0.6 * R) return { dir: 1, name: 'bullish engulfing', i };
    if (k.c < k.o && p.c > p.o && k.c < p.o && k.o >= p.c && body >= 0.6 * R) return { dir: -1, name: 'bearish engulfing', i };
    if (dn >= 2 * body && dn >= 0.6 * rng && rng >= 0.8 * R) return { dir: 1, name: 'pin bar rejection', i };
    if (up >= 2 * body && up >= 0.6 * rng && rng >= 0.8 * R) return { dir: -1, name: 'pin bar rejection', i };
  }
  return null;
}

// Displacement: candle body besar
function momentum(c, R) {
  let disp = null;
  for (let i = c.length - 2; i >= c.length - 4 && i >= 0; i--) {
    const k = c[i], rng = k.h - k.l, body = Math.abs(k.c - k.o);
    if (body >= 1.5 * R && body >= 0.65 * rng) { disp = { dir: Math.sign(k.c - k.o), i }; break; }
  }
  return { disp };
}

// Ringkasan satu timeframe
function frame(c, k, tf, sweepLook) {
  const lbl = TF_LABEL[tf];
  const R = atr(c.slice(0, -1)) || Math.abs(c[c.length - 1].c) * 0.001;
  const s = structure(c, k);
  const tol = 0.25 * R;
  const lastEv = d => [...s.events].reverse().find(e => e.dir === d);
  const zones = [
    ...sndZones(c, R),
    ...fvgs(c, R),
    orderBlock(c, lastEv(1)),
    orderBlock(c, lastEv(-1)),
  ].filter(Boolean);
  // Kontinuasi: level BOS terakhir menjadi zona retest (S/R flip)
  if (s.last && c.length - 1 - s.last.i <= 40) {
    zones.push({ kind: 'BOS retest', dir: s.last.dir, lo: s.last.level - 0.25 * R, hi: s.last.level + 0.25 * R, i: s.last.i, touches: 0 });
  }
  return {
    tf: lbl, c, R, s, trend: s.trend, last: s.last,
    pools: liquidity(c, s.swings, tol).map(p => ({ ...p, tf: lbl })),
    sweep: findSweep(c, s.swings, tol, sweepLook),
    zones: zones.map(z => ({ ...z, tf: lbl })),
    levels: snrLevels(s.swings.filter(x => c.length - 1 - x.i <= 120), 0.3 * R),
    leg: legOf(s.swings),
    cs: candleSignal(c, R),
    mo: momentum(c, R),
  };
}

// Jarak harga ke zona (0 = di dalam zona, Infinity = zona di sisi yang salah)
const zdist = (z, dir, p) => dir > 0
  ? (z.hi < p ? p - z.hi : z.lo > p ? Infinity : 0)
  : (z.lo > p ? z.lo - p : z.hi < p ? Infinity : 0);

// Trigger di LTF: sweep, rejection, CHoCH/BOS, atau displacement searah dir
function trigger(F, dir) {
  const L = F.L, n = L.c.length;
  if (L.sweep?.dir === dir && n - 1 - L.sweep.i <= 4)
    return { kind: 'sweep', name: `sweep ${dir > 0 ? 'SSL' : 'BSL'} ${L.tf}` };
  if (L.cs?.dir === dir) return { kind: 'rejection', name: `${L.cs.name} ${L.tf}` };
  if (L.last?.dir === dir && n - 1 - L.last.i <= 4)
    return { kind: L.last.type === 'CHoCH' ? 'choch' : 'bos', name: `${L.last.type} ${L.tf}` };
  if (L.mo.disp?.dir === dir && n - 1 - L.mo.disp.i <= 3)
    return { kind: 'disp', name: `displacement ${L.tf}` };
  return null;
}

// ======================= ENGINE SINYAL (SELALU BUY / SELL) =======================
function analyze(F, price, st, spec) {
  const { H, M, L } = F;
  const RL = L.R, RM = M.R, nL = L.c.length, nM = M.c.length;
  const KIND_W = { Demand: 1.2
