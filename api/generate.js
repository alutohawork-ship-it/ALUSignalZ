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

// htf / mtf / ltf : 3 timeframe per gaya
// bufL / bufM     : buffer SL = max(bufL x range LTF, bufM x range MTF)
// minR / maxR     : jarak SL min/maks (x range LTF / MTF)
// confirm         : true = intraday/swing (tunggu konfirmasi), false = scalp/day (reaksi zona)
// maxPull         : jarak maksimal POI dari harga (x range MTF)
const STYLES = {
  scalp: { htf: '15m', mtf: '3m',  ltf: '1m',  confirm: false, bufL: 1.2, bufM: 0.5, minR: 2.5, maxR: 2.2, maxPull: 3, rr: [1.0, 1.8, 3.0], maxTp: 5 },
  day:   { htf: '30m', mtf: '15m', ltf: '5m',  confirm: false, bufL: 1.0, bufM: 0.5, minR: 2.5, maxR: 2.5, maxPull: 3, rr: [1.0, 2.0, 3.2], maxTp: 6 },
  intra: { htf: '4h',  mtf: '1h',  ltf: '5m',  confirm: true,  bufL: 0.8, bufM: 0.5, minR: 2.0, maxR: 3.0, maxPull: 4, rr: [1.2, 2.2, 3.5], maxTp: 7 },
  swing: { htf: '1d',  mtf: '4h',  ltf: '15m', confirm: true,  bufL: 0.8, bufM: 0.6, minR: 2.0, maxR: 3.5, maxPull: 4, rr: [1.5, 2.8, 4.5], maxTp: 8 },
};
const pickStyle = s => /scalp/i.test(s) ? 'scalp' : /day/i.test(s) ? 'day' : /swing/i.test(s) ? 'swing' : 'intra';

const TF_LABEL = { '1m': 'M1', '3m': 'M3', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D1' };
const TF_MS = { '1m': 6e4, '3m': 18e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };
const YF_TF = {
  '1m': { i: '1m', r: '5d' }, '3m': { i: '1m', r: '5d', agg: 3 }, '5m': { i: '5m', r: '5d' },
  '15m': { i: '15m', r: '1mo' }, '30m': { i: '30m', r: '1mo' }, '1h': { i: '60m', r: '3mo' },
  '4h': { i: '60m', r: '6mo', agg: 4 }, '1d': { i: '1d', r: '2y' },
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

// ======================= PRICE ACTION TOOLS =======================
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// Rata-rata range candle: hanya untuk skala buffer/SL/zona, bukan sinyal
const avgRange = (c, n = 20) => { const s = c.slice(-n); return s.reduce((a, k) => a + (k.h - k.l), 0) / (s.length || 1); };

// Swing high/low (fractal)
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

// Market structure: BOS / CHoCH, trend, HH/HL
function structure(c, k) {
  const sw = swings(c, k), events = [];
  let trend = 0, lastH = null, lastL = null, si = 0;
  for (let i = 0; i < c.length; i++) {
    while (si < sw.length && sw[si].i + k <= i) { const s = { ...sw[si++] }; s.type === 'H' ? lastH = s : lastL = s; }
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

// Leg terakhir (swing low ke high atau sebaliknya) untuk menghitung retrace
function legOf(sw) {
  const lh = sw.filter(s => s.type === 'H').at(-1), ll = sw.filter(s => s.type === 'L').at(-1);
  if (!lh || !ll) return null;
  return { up: lh.i > ll.i, hi: lh.p, lo: ll.p, range: Math.max(lh.p - ll.p, 1e-9) };
}
// Kedalaman pullback 0..1 terhadap leg searah dir (null jika leg tidak searah)
function depth(leg, dir, p) {
  if (!leg || leg.up !== (dir > 0)) return null;
  return dir > 0 ? (leg.hi - p) / leg.range : (p - leg.lo) / leg.range;
}

// Liquidity pool: swing yang belum diambil + equal highs/lows
function liquidity(c, sw, tol) {
  const n = c.length;
  const untaken = s => { for (let j = s.i + 1; j < n; j++) if (s.type === 'H' ? c[j].h > s.p : c[j].l < s.p) return false; return true; };
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

// Supply & Demand: base -> candle impuls, belum disentuh ulang lebih dari sekali
function sndZones(c, R, look = 120) {
  const out = [], n = c.length;
  for (let i = Math.max(3, n - look); i < n - 1; i++) {
    const k = c[i], rng = k.h - k.l, body = Math.abs(k.c - k.o);
    if (rng < 1.5 * R || body < 0.6 * rng) continue;
    const dir = Math.sign(k.c - k.o);
    let j = i - 1; const base = [c[j]];
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
    if (c[i].l > c[i - 2].h) out.push({ kind: 'FVG', dir: 1, lo: c[i - 2].h, hi: c[i].l, i });
    if (c[i].h < c[i - 2].l) out.push({ kind: 'FVG', dir: -1, lo: c[i].h, hi: c[i - 2].l, i });
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
      return { kind: 'OB', dir: ev.dir, lo: k.l, hi: k.h, i: j };
    }
  }
  return null;
}

// Support & Resistance: cluster swing (min 2 sentuhan)
function snrLevels(points, tol) {
  const s = [...points].sort((a, b) => a.p - b.p), out = [];
  let g = [];
  const flush = () => {
    if (g.length >= 2) out.push({ p: g.reduce((a, x) => a + x.p, 0) / g.length, n: g.length });
    g = [];
  };
  for (const x of s) { if (g.length && x.p - g[0].p > tol) flush(); g.push(x); }
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
function frame(c, k, tf) {
  const lbl = TF_LABEL[tf];
  const R = avgRange(c.slice(0, -1));
  const s = structure(c, k);
  const tol = 0.25 * R;
  const lastEv = d => [...s.events].reverse().find(e => e.dir === d);
  const zones = [
    ...sndZones(c, R), ...fvgs(c, R),
    orderBlock(c, lastEv(1)), orderBlock(c, lastEv(-1)),
  ].filter(Boolean);
  // Kontinuasi: level BOS terakhir menjadi zona retest (S/R flip)
  if (s.last && c.length - 1 - s.last.i <= 40) {
    zones.push({ kind: 'BOS retest', dir: s.last.dir, lo: s.last.level - 0.25 * R, hi: s.last.level + 0.25 * R, i: s.last.i, touches: 0 });
  }
  return {
    tf: lbl, c, R, s, trend: s.trend, last: s.last,
    pools: liquidity(c, s.swings, tol).map(p => ({ ...p, tf: lbl })),
    sweep: findSweep(c, s.swings, tol, 6),
    zones: zones.map(z => ({ ...z, tf: lbl })),
    levels: snrLevels(s.swings.filter(x => c.length - 1 - x.i <= 120), 0.3 * R).map(l => ({ ...l, tf: lbl, R })),
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
  if (L.sweep?.dir === dir && n - 1 - L.sweep.i <= 3)
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
  const RL = L.R, RM = M.R, nL = L.c.length;
  const KIND_W = { Demand: 1.2, Supply: 1.2, OB: 1.0, 'BOS retest': 1.0, FVG: 0.8, 'S/R': 0.8 };

  // 1) BIAS: HTF memimpin. LTF hanya boleh membalik arah jika ada reversal valid
  let dir = H.trend || M.trend || L.trend || (L.last?.dir ?? 1);
  let counter = false;
  const ltfDir = L.last?.dir || 0;
  if (ltfDir && ltfDir !== dir) {
    const choch = L.last.type === 'CHoCH' && nL - 1 - L.last.i <= 10;
    const swept = [H, M, L].some(f => f.sweep?.dir === ltfDir);
    const inZone = [H, M].some(f => f.zones.some(z => z.dir === ltfDir && zdist(z, ltfDir, price) === 0));
    if (choch && swept && inZone) { dir = ltfDir; counter = true; }
  }

  const trig = trigger(F, dir);
  const dM = depth(M.leg, dir, price);
  const depthOK = dM != null && dM >= 0.3 && dM <= 0.9;

  // 2) POI: zona terbaik searah dir dari HTF / MTF / LTF
  const pois = [];
  for (const [tw, f] of [[3, H], [2, M], [1, L]]) {
    for (const z of f.zones) {
      if (z.dir !== dir) continue;
      const d = zdist(z, dir, price);
      if (!Number.isFinite(d) || d > st.maxPull * RM) continue;
      const fresh = z.touches === 0 ? 0.3 : 0;
      const w = tw * (KIND_W[z.kind] ?? 1) + fresh;
      pois.push({ lo: z.lo, hi: z.hi, kind: z.kind, name: `${z.tf} ${z.kind}${fresh ? ' fresh' : ''}`, dist: d, w, score: w - d / RM * 0.4 });
    }
    for (const lv of f.levels) {
      const z = { lo: lv.p - 0.2 * f.R, hi: lv.p + 0.2 * f.R };
      const d = zdist(z, dir, price);
      if (!Number.isFinite(d) || d > st.maxPull * RM) continue;
      const w = tw * 0.8;
      pois.push({ ...z, kind: 'S/R', name: `${f.tf} S/R ${lv.n}x`, dist: d, w, score: w - d / RM * 0.4 });
    }
  }
  pois.sort((a, b) => b.score - a.score);
  const poi = pois[0] || null;
  const inPoi = !!poi && poi.dist === 0;
  const scalp = !st.confirm;
  const contTrig = !!trig && (trig.kind === 'bos' || trig.kind === 'disp');
  const mAligned = M.trend === dir || M.last?.dir === dir;

  // 3) MODE ENTRY
  let mode;
  if (inPoi && trig) mode = 'REACTION';
  else if (inPoi) mode = scalp ? 'REACTION' : 'CONFIRM';
  else if (contTrig && mAligned && (!poi || poi.dist > 0.5 * RL)) mode = 'CONTINUATION';
  else if (poi) mode = 'PULLBACK';
  else mode = scalp ? 'REACTION_LIMIT' : 'CONFIRM';
  const market = mode === 'REACTION' || mode === 'CONTINUATION';

  const swingPoi = () => {
    const sw = L.s.swings
      .filter(s => s.type === (dir > 0 ? 'L' : 'H') && nL - 1 - s.i <= 60 && (dir > 0 ? s.p < price - 0.2 * RL : s.p > price + 0.2 * RL))
      .sort((a, b) => Math.abs(price - a.p) - Math.abs(price - b.p))[0];
    if (sw) return { lo: sw.p - 0.25 * RL, hi: sw.p + 0.25 * RL, name: `${L.tf} swing ${dir > 0 ? 'low' : 'high'}` };
    const e = price - dir * 0.8 * RL;
    return { lo: e - 0.25 * RL, hi: e + 0.25 * RL, name: 'zona reaksi' };
  };
  const P = poi || (market ? null : swingPoi());

  // 4) ZONA ENTRY (limit tidak pernah menempel harga sekarang)
  let zLo, zHi;
  if (market) {
    zLo = dir > 0 ? price - 0.15 * RL : price - 0.05 * RL;
    zHi = dir > 0 ? price + 0.05 * RL : price + 0.15 * RL;
  } else {
    const h = Math.max(0.25 * RL, Math.min(P.hi - P.lo, RM));
    if (dir > 0) { zHi = Math.min(P.hi, price - 0.1 * RL); zLo = zHi - h; }
    else { zLo = Math.max(P.lo, price + 0.1 * RL); zHi = zLo + h; }
  }
  const entry = (zLo + zHi) / 2;

  // 5) SL STRUKTURAL + BUFFER
  const buf = Math.max(st.bufL * RL, st.bufM * RM);
  const sideOk = p => dir > 0 ? p < zLo : p > zHi;
  const cands = [];
  if (P) cands.push(dir > 0 ? P.lo : P.hi);                       // ujung jauh POI
  if (L.sweep?.dir === dir) cands.push(dir > 0 ? L.c[L.sweep.i].l : L.c[L.sweep.i].h); // wick sweep
  const near = [
    ...L.s.swings.filter(s => nL - 1 - s.i <= 40),
    ...M.s.swings.filter(s => M.c.length - 1 - s.i <= 30),
  ].filter(s => s.type === (dir > 0 ? 'L' : 'H') && sideOk(s.p));
  if (near.length) cands.push(dir > 0 ? Math.max(...near.map(s => s.p)) : Math.min(...near.map(s => s.p)));
  if (!cands.length) cands.push(entry - dir * st.minR * RL);

  const protective = dir > 0 ? Math.min(...cands) : Math.max(...cands);  // paling aman, SL paling jauh
  const nearest = dir > 0 ? Math.max(...cands) : Math.min(...cands);     // paling dekat
  const minRk = Math.max(st.minR * RL, 2 * spec.pip);
  const maxRk = Math.max(st.maxR * RM, minRk);
  const distTo = inv => dir * (entry - inv) + buf;                        // jarak entry -> SL
  let inv = protective;
  if (distTo(inv) > maxRk) inv = nearest;
  let Rk = distTo(inv);
  let capped = false;
  if (Rk > maxRk) { Rk = maxRk; capped = true; }
  if (Rk < minRk) Rk = minRk;
  const sl = entry - dir * Rk;

  // 6) TP DARI LIKUIDITAS & ZONA LAWAN
  const xR = p => dir * (p - entry) / Rk;
  const liq = [H, M, L].flatMap(f => f.pools
    .filter(p => p.type === (dir > 0 ? 'H' : 'L'))
    .map(p => ({ p: p.p, name: `${p.eq ? (dir > 0 ? 'EQH' : 'EQL') : (dir > 0 ? 'BSL' : 'SSL')} ${f.tf}` })));
  const opp = [H, M, L].flatMap(f => f.zones
    .filter(z => z.dir === -dir)
    .map(z => ({ p: dir > 0 ? z.lo : z.hi, name: `${z.tf} ${z.kind}`, opp: true })));
  const targets = [...liq, ...opp].map(t => ({ ...t, r: xR(t.p) })).filter(t => t.r > 0.6).sort((a, b) => a.r - b.r);
  const front = t => t.p - dir * 0.1 * RL;
  const pick = (lo, hi) => targets.find(t => t.r >= lo && t.r <= hi);
  const rr = st.rr;

  const t1 = pick(0.9, 2.2);
  let tp1 = t1 ? front(t1) : entry + dir * rr[0] * Rk;
  const oppN = targets.find(t => t.opp);
  if (oppN && oppN.r >= 0.6 && oppN.r < xR(tp1)) tp1 = front(oppN); // hit & run: TP1 sebelum zona lawan
  const r1 = xR(tp1);
  const t2 = pick(r1 + 0.5, st.maxTp);
  const tp2 = t2 ? front(t2) : entry + dir * Math.max(rr[1], r1 + 0.7) * Rk;
  const r2 = xR(tp2);
  const t3 = pick(r2 + 0.5, st.maxTp);
  const tp3 = t3 ? front(t3) : entry + dir * Math.max(rr[2], r2 + 1) * Rk;

  // 7) WHY & CONFIDENCE
  const why = [];
  if (H.trend) why.push(`${H.tf} ${H.trend > 0 ? 'bullish' : 'bearish'}`);
  if (M.trend && M.trend !== H.trend) why.push(`${M.tf} ${M.trend > 0 ? 'bullish' : 'bearish'}`);
  if (depthOK) why.push(`pullback ${Math.round(dM * 100)}% ${M.tf}`);
  if (poi) why.push(poi.name);
  if (trig) why.push(trig.name);
  if (counter) why.push(`reversal ${L.tf} CHoCH`);

  const conf = clamp(Math.round(
    40 + 6 * (H.trend === dir) + 6 * (M.trend === dir) + 4 * (L.trend === dir)
    + (trig ? 8 : 0) + (inPoi ? 6 : 0) + (poi ? (poi.w >= 3 ? 5 : poi.w >= 2 ? 3 : 0) : 0)
    + (depthOK ? 5 : 0) - (counter ? 8 : 0) - (capped ? 3 : 0)
  ), 30, 95);

  return {
    dir, signal: dir > 0 ? 'BUY' : 'SELL', mode, counter, capped, conf, why,
    poi, trig, dM, zLo, zHi, entry, sl, Rk,
    tp1, tp2, tp3, tpNames: [t1?.name, t2?.name, t3?.name],
    H, M, L,
  };
}

// ======================= REASON =======================
const MODE_LABEL = {
  id: { REACTION: 'REAKSI ZONA', REACTION_LIMIT: 'LIMIT REAKSI', CONTINUATION: 'KONTINUASI', PULLBACK: 'PULLBACK LIMIT', CONFIRM: 'TUNGGU KONFIRMASI' },
  en: { REACTION: 'ZONE REACTION', REACTION_LIMIT: 'REACTION LIMIT', CONTINUATION: 'CONTINUATION', PULLBACK: 'PULLBACK LIMIT', CONFIRM: 'WAIT CONFIRMATION' },
};
const PLAN = {
  id: {
    REACTION: 'Harga di zona dengan trigger, entry sekarang. Setelah TP1 kena, geser SL ke BE.',
    CONTINUATION: 'Kontinuasi setelah BOS/displacement searah HTF. Hit & run di TP1, lalu BE.',
    PULLBACK: 'Pasang limit di POI, konfirmasi rejection saat harga mengisi zona.',
    REACTION_LIMIT: 'Limit di swing terdekat, ambil reaksi cepat ke TP1.',
    CONFIRM: 'Tunggu harga masuk zona lalu rejection atau CHoCH LTF, baru entry.',
  },
  en: {
    REACTION: 'Price in zone with trigger, enter now. Move SL to BE after TP1.',
    CONTINUATION: 'Continuation after BOS/displacement with HTF. Hit & run at TP1, then BE.',
    PULLBACK: 'Limit at POI, confirm rejection when price fills the zone.',
    REACTION_LIMIT: 'Limit at nearest swing, take quick reaction to TP1.',
    CONFIRM: 'Wait for price into zone plus LTF rejection or CHoCH, then enter.',
  },
};

function templateReason(a, lang) {
  const en = lang === 'en';
  const why = a.why.length ? a.why : [`${a.H.tf} ${a.dir > 0 ? 'bullish' : 'bearish'} bias`];
  return `${why.slice(0, 4).join(' · ')}. ${PLAN[en ? 'en' : 'id'][a.mode]}`;
}

async function aiReason(a, ctx, lang, apiKey) {
  if (!apiKey) return null;
  const facts = {
    market: ctx.key, style: ctx.style, signal: a.signal, mode: a.mode, counter_trend_reversal: a.counter,
    timeframes: [a.H.tf, a.M.tf, a.L.tf], trends: { htf: a.H.trend, mtf: a.M.trend, ltf: a.L.trend },
    pullback_depth_mtf_pct: a.dM != null ? Math.round(a.dM * 100) : null,
    poi: a.poi?.name || null, trigger: a.trig?.name || null, confluence: a.why,
    entry_zone: [ctx.f(a.zLo), ctx.f(a.zHi)], sl: ctx.f(a.sl), tp_targets: a.tpNames,
  };
  const sys = `You are a senior pure price-action trader (SMC, market structure, liquidity, supply & demand, S/R, multi-timeframe). Write ONE trade reason, max 2 short sentences (max 200 characters), in ${lang === 'en' ? 'English' : 'Bahasa Indonesia'}. Use ONLY the given facts. Never mention indicators. Never invent prices. Never say HOLD, no trade, or avoid. Mention the HTF bias, the key confluence, and the execution plan that matches the mode. Plain text, no markdown.`;
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch('https://api.gutsai.id/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.GUTSAI_MODEL || 'claude-opus-5.5',
        temperature: 0.2, max_tokens: 160,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(facts) }],
      }),
    });
    const j = await r.json();
    if (!r.ok) return null;
    const txt = String(j?.choices?.[0]?.message?.content || '').replace(/[`*#"]/g, '').replace(/\s+/g, ' ').trim();
    if (!txt || /\bhold\b/i.test(txt)) return null;
    return txt.slice(0, 260);
  } catch { return null; } finally { clearTimeout(tm); }
}

// ======================= HANDLER =======================
const reply = (res, payload, analysis = {}) =>
  res.status(200).json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(payload) } }], analysis });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { marketId, tradingStyle = '', currentPrice, lang = 'id' } = req.body || {};
  const id = lang !== 'en';
  const key = String(marketId || '').split('|').pop();
  const spec = SPEC[key];
  const price = Number(currentPrice);
  if (!spec) return res.status(400).json({ error: `Market ${key} tidak dikenal` });
  if (!(price > 0)) return res.status(400).json({ error: 'currentPrice tidak valid' });

  const st = STYLES[pickStyle(tradingStyle)];
  const f = p => Number(p).toFixed(spec.dec);

  try {
    // 1. Candle 3 timeframe (paralel)
    let Ld, Md, Hd;
    try {
      [Ld, Md, Hd] = await Promise.all([getCandles(spec, st.ltf), getCandles(spec, st.mtf), getCandles(spec, st.htf)]);
    } catch (e) {
      return res.status(503).json({ error: id ? `Data candle belum tersedia (${e.message}). Silakan generate ulang.` : `Candle data unavailable (${e.message}). Please regenerate.` });
    }
    if (Ld.stale) {
      return res.status(503).json({ error: id ? 'Market sedang tutup / feed candle tidak aktif. Generate saat sesi buka.' : 'Market closed / candle feed inactive. Generate during open session.' });
    }

    // 2. Samakan basis tiap TF ke harga live (ikut kalibrasi MT)
    const rebase = c => {
      const shift = price - c[c.length - 1].c;
      if (Math.abs(shift) / price > 0.05) throw new Error('out of sync');
      return c.map(k => ({ ...k, o: k.o + shift, h: k.h + shift, l: k.l + shift, c: k.c + shift }));
    };
    let L, M, H;
    try { L = rebase(Ld.c); M = rebase(Md.c); H = rebase(Hd.c); }
    catch { return res.status(503).json({ error: id ? 'Sumber data tidak sinkron dengan harga live. Generate ulang.' : 'Data source out of sync. Please regenerate.' }); }

    // 3. Analisis multi-timeframe
    const F = { L: frame(L, 2, st.ltf), M: frame(M, 2, st.mtf), H: frame(H, 3, st.htf) };
    const a = analyze(F, price, st, spec);
    const text = (await aiReason(a, { key, style: tradingStyle, f }, lang, process.env.GUTSAI_API_KEY)) || templateReason(a, lang);

    // 4. Output
    const pips = (p, neg) => `${neg ? '-' : '+'}${(Math.abs(p - a.entry) / spec.pip).toFixed(1)} pips`;
    const rr2 = (Math.abs(a.tp2 - a.entry) / a.Rk).toFixed(1);
    const label = MODE_LABEL[id ? 'id' : 'en'][a.mode];

    return reply(res, {
      signal: a.signal,
      entry_min: f(a.zLo), entry_max: f(a.zHi),
      sl: f(a.sl),   sl_pips: pips(a.sl, true),
      tp1: f(a.tp1), tp1_pips: pips(a.tp1),
      tp2: f(a.tp2), tp2_pips: pips(a.tp2),
      tp3: f(a.tp3), tp3_pips: pips(a.tp3),
      mode: a.mode, confidence: a.conf,
      reason: `[${label} · ${a.conf}% · RR 1:${rr2}] ${text}`,
    }, {
      source: `${Ld.src} ${F.L.tf} / ${Md.src} ${F.M.tf} / ${Hd.src} ${F.H.tf}`,
      confidence: a.conf, counter: a.counter, capped: a.capped,
      trends: { htf: F.H.trend, mtf: F.M.trend, ltf: F.L.trend },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
