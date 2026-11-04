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

// MULTI-TIMEFRAME BERDASARKAN GAYA TRADING:
// Scalping: M15 (HTF) + M3 (MTF) + M1 (LTF)
// Day Trade: M30 (HTF) + M15 (MTF) + M3 (LTF)
// Intraday: H4 (HTF) + H1 (MTF) + M5 (LTF)
// Swing: Daily (HTF) + H4 (MTF) + M15 (LTF)
const STYLES = {
  scalp: { ltf: '1m',  mtf: '3m',  htf: '15m', slMin: 1.5, slMax: 3.2, rr: [1.0, 1.8, 3.0], confirm: false, maxPull: 3 },
  day:   { ltf: '3m',  mtf: '15m', htf: '30m', slMin: 1.8, slMax: 3.8, rr: [1.0, 2.0, 3.2], confirm: false, maxPull: 3.5 },
  intra: { ltf: '5m',  mtf: '1h',  htf: '4h',  slMin: 2.2, slMax: 4.5, rr: [1.2, 2.2, 3.5], confirm: true,  maxPull: 5 },
  swing: { ltf: '15m', mtf: '4h',  htf: '1d',  slMin: 3.0, slMax: 6.0, rr: [1.5, 2.8, 4.5], confirm: true,  maxPull: 6 },
};

const pickStyle = s => /scalp/i.test(s) ? 'scalp' : /day/i.test(s) ? 'day' : /swing/i.test(s) ? 'swing' : 'intra';
const TF_LABEL = { '1m': 'M1', '3m': 'M3', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'Daily' };
const TF_MS = { '1m': 6e4, '3m': 18e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };
const YF_TF = {
  '1m': { i: '1m', r: '5d' }, '3m': { i: '1m', r: '5d', agg: 3 }, '5m': { i: '5m', r: '5d' },
  '15m': { i: '15m', r: '1mo' }, '30m': { i: '30m', r: '1mo' }, '1h': { i: '60m', r: '3mo' }, 
  '4h': { i: '60m', r: '6mo', agg: 4 }, '1d': { i: '1d', r: '1y' },
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
  const binanceTf = tf === '1d' ? '1d' : tf;
  const j = await fetchJSON(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=${binanceTf}&limit=300`);
  return j.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
}

async function fromYahoo(sym, tf) {
  const conf = YF_TF[tf] || { i: '1d', r: '1y' };
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${conf.i}&range=${conf.r}&includePrePost=true`;
  const j = await fetchJSON(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const res = j?.chart?.result?.[0], ts = res?.timestamp || [], q = res?.indicators?.quote?.[0] || {};
  let c = [];
  ts.forEach((t, k) => {
    const o = q.open?.[k], h = q.high?.[k], l = q.low?.[k], cl = q.close?.[k];
    if ([o, h, l, cl].every(Number.isFinite)) c.push({ t: t * 1000, o, h, l, c: cl, v: q.volume?.[k] || 0 });
  });
  if (conf.agg) c = aggregate(c, TF_MS[tf]);
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
      if (c.length < 40) continue;
      const stale = Date.now() - c[c.length - 1].t > staleLimit(tf);
      if (!stale) return { src, c, stale };
      fallback ??= { src, c, stale };
    } catch {}
  }
  if (fallback) return fallback;
  throw new Error(`Data candle ${TF_LABEL[tf]} tidak tersedia`);
}

// ======================= PRICE ACTION & SMC TOOLS =======================
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const avgRange = (c, n = 20) => { const s = c.slice(-n); return s.reduce((a, k) => a + (k.h - k.l), 0) / (s.length || 1); };

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

function structure(c, k) {
  const sw = swings(c, k), events = [];
  let trend = 0, lastH = null, lastL = null, si = 0;
  for (let i = 0; i < c.length; i++) {
    while (si < sw.length && sw[si].i + k <= i) { const s = { ...sw[si++] }; s.type === 'H' ? lastH = s : lastL = s; }
    if (lastH && !lastH.broken && c[i].c > lastH.p) {
      lastH.broken = true;
      events.push({ i, dir: 1, type: trend === -1 ? 'CHoCH' : 'BOS', level: lastH.p, prot: lastL?.p });
      trend = 1;
    }
    if (lastL && !lastL.broken && c[i].c < lastL.p) {
      lastL.broken = true;
      events.push({ i, dir: -1, type: trend === 1 ? 'CHoCH' : 'BOS', level: lastL.p, prot: lastH?.p });
      trend = -1;
    }
  }
  const hs = sw.filter(s => s.type === 'H'), ls = sw.filter(s => s.type === 'L');
  const seq = hs.length > 1 && ls.length > 1 ? { hh: hs.at(-1).p > hs.at(-2).p, hl: ls.at(-1).p > ls.at(-2).p } : null;
  return { trend, events, last: events.at(-1), swings: sw, seq };
}

function liquidity(c, sw, tol) {
  const n = c.length;
  const untaken = s => { for (let j = s.i + 1; j < n; j++) if (s.type === 'H' ? c[j].h > s.p : c[j].l < s.p) return false; return true; };
  const pools = sw.filter(untaken).map(s => ({ type: s.type, p: s.p, i: s.i, eq: false }));
  for (const a of pools) a.eq = pools.some(b => b !== a && b.type === a.type && Math.abs(b.p - a.p) <= tol);
  return pools;
}

function findSweep(c, sw, tol, recent = 8) {
  const n = c.length;
  let best = null;
  for (let i = n - 1; i >= Math.max(1, n - recent); i--) {
    const prior = sw.filter(s => s.i < i - 1 && s.i >= i - 80);
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

// Supply, Demand & Order Blocks (SMC)
function sndZones(c, R, look = 120) {
  const out = [], n = c.length;
  for (let i = Math.max(3, n - look); i < n - 1; i++) {
    const k = c[i], rng = k.h - k.l, body = Math.abs(k.c - k.o);
    if (rng < 1.4 * R || body < 0.55 * rng) continue;
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
    if (broken || touches > 2) continue;
    out.push({ kind: dir > 0 ? 'Demand' : 'Supply', dir, lo, hi, i, touches });
  }
  return out;
}

function fvgs(c, R, lookback = 70) {
  const out = [];
  for (let i = Math.max(2, c.length - lookback); i < c.length; i++) {
    if (c[i].l > c[i - 2].h) out.push({ kind: 'FVG', dir: 1, lo: c[i - 2].h, hi: c[i].l, i });
    if (c[i].h < c[i - 2].l) out.push({ kind: 'FVG', dir: -1, lo: c[i].h, hi: c[i - 2].l, i });
  }
  return out.filter(g => {
    if (g.hi - g.lo < 0.12 * R) return false;
    for (let j = g.i + 1; j < c.length; j++) {
      if (g.dir > 0 && c[j].l <= g.lo) return false;
      if (g.dir < 0 && c[j].h >= g.hi) return false;
    }
    return true;
  });
}

function orderBlock(c, ev) {
  if (!ev) return null;
  for (let j = ev.i - 1; j >= Math.max(0, ev.i - 20); j--) {
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

function candleSignal(c, R) {
  const n = c.length;
  for (const i of [n - 2, n - 3]) {
    if (i < 1) continue;
    const k = c[i], p = c[i - 1], rng = k.h - k.l, body = Math.abs(k.c - k.o);
    if (rng <= 0) continue;
    const up = k.h - Math.max(k.o, k.c), dn = Math.min(k.o, k.c) - k.l;
    if (k.c > k.o && p.c < p.o && k.c > p.o && k.o <= p.c && body >= 0.5 * R) return { dir: 1, name: 'bullish engulfing', i };
    if (k.c < k.o && p.c > p.o && k.c < p.o && k.o >= p.c && body >= 0.5 * R) return { dir: -1, name: 'bearish engulfing', i };
    if (dn >= 1.8 * body && dn >= 0.5 * rng && rng >= 0.7 * R) return { dir: 1, name: 'pin bar rejection', i };
    if (up >= 1.8 * body && up >= 0.5 * rng && rng >= 0.7 * R) return { dir: -1, name: 'pin bar rejection', i };
  }
  return null;
}

function momentum(c, R) {
  const n = c.length, last5 = c.slice(n - 6, n - 1);
  const bull = last5.filter(k => k.c > k.o).length, bear = last5.filter(k => k.c < k.o).length;
  let run = 0, rd = 0;
  for (let i = n - 2; i >= 1; i--) {
    const d = Math.sign(c[i].c - c[i - 1].c);
    if (!d) break;
    if (!rd) rd = d;
    if (d !== rd) break;
    run++;
  }
  let disp = null;
  for (let i = n - 2; i >= n - 4; i--) {
    const k = c[i], body = Math.abs(k.c - k.o);
    if (body >= 1.4 * R) { disp = { dir: Math.sign(k.c - k.o), i }; break; }
  }
  return { dir: bull >= 4 ? 1 : bear >= 4 ? -1 : 0, run, rd, disp };
}

// ======================= ENGINE ANALISIS MULTI-TIMEFRAME =======================
function analyzeMultiTF(L, M, H, price, st, spec) {
  const nL = L.length, ltfL = TF_LABEL[st.ltf], mtfL = TF_LABEL[st.mtf], htfL = TF_LABEL[st.htf];
  const RL = avgRange(L.slice(0, -1)), RM = avgRange(M.slice(0, -1)), RH = avgRange(H.slice(0, -1));

  const sL = structure(L, 2), sM = structure(M, 2), sH = structure(H, 3);
  const tolL = 0.25 * RL, tolM = 0.3 * RM, tolH = 0.35 * RH;

  const sweepL = findSweep(L, sL.swings, tolL);
  const sweepM = findSweep(M, sM.swings, tolM, 5);
  const sweepH = findSweep(H, sH.swings, tolH, 3);

  const lastEv = (s, d) => [...s.events].reverse().find(e => e.dir === d);
  const zones = [
    ...sndZones(L, RL),
    ...sndZones(M, RM, 80).map(z => ({ ...z, mtf: true })),
    ...sndZones(H, RH, 60).map(z => ({ ...z, htf: true })),
    ...fvgs(L, RL),
    ...fvgs(M, RM, 50).map(g => ({ ...g, mtf: true })),
    orderBlock(L, lastEv(sL, 1)), orderBlock(L, lastEv(sL, -1)),
    orderBlock(M, lastEv(sM, 1)), orderBlock(M, lastEv(sM, -1)),
  ].filter(Boolean);

  // Kontinuitas (BOS retest / S&P flip)
  if (sM.last && nL - 1 - sM.last.i <= 50) {
    zones.push({ kind: 'BOS continuity retest', dir: sM.last.dir, lo: sM.last.level - 0.3 * RM, hi: sM.last.level + 0.3 * RM, mtf: true });
  }

  const cs = candleSignal(L, RL);
  const mo = momentum(L, RL);

  // Dealing range MTF/HTF
  const hsw = sM.swings, lh = hsw.filter(s => s.type === 'H').at(-1), ll = hsw.filter(s => s.type === 'L').at(-1);
  const startI = lh && ll ? Math.min(lh.i, ll.i) : Math.max(0, M.length - 60);
  const seg = M.slice(startI);
  const dHi = Math.max(...seg.map(k => k.h)), dLo = Math.min(...seg.map(k => k.l));
  const pos = dHi > dLo ? clamp((price - dLo) / (dHi - dLo), 0, 1) : 0.5;

  const sc = { 1: 0, [-1]: 0 }, why = { 1: [], [-1]: [] };
  const add = (d, w, t) => { if (!d) return; sc[d] += w; why[d].push(t); };
  const bw = d => d > 0 ? 'bullish' : 'bearish';

  // 1. Struktur Multi-Timeframe
  if (sH.trend) add(sH.trend, 2.5, `${htfL} ${bw(sH.trend)} structure`);
  if (sM.trend) add(sM.trend, 2.0, `${mtfL} ${bw(sM.trend)} structure (${sM.last?.type || 'trend'})`);
  if (sL.last && nL - 1 - sL.last.i <= 30) {
    add(sL.last.dir, sL.last.type === 'CHoCH' ? 2.0 : 1.5, `${ltfL} ${sL.last.type}`);
  }

  // 2. Likuiditas & Sweep
  if (sweepL) add(sweepL.dir, sweepL.eq ? 2.0 : 1.5, `LTF sweep liquidity (${sweepL.eq ? 'EQ' : 'Swing'})`);
  if (sweepM) add(sweepM.dir, 2.0, `MTF sweep liquidity (${mtfL})`);
  if (sweepH) add(sweepH.dir, 2.5, `HTF major sweep (${htfL})`);

  // 3. POI (Supply/Demand, FVG, OB, Kontinuitas)
  const zDist = (z, d) => d > 0 ? (price < z.lo ? Infinity : Math.max(0, price - z.hi)) : (price > z.hi ? Infinity : Math.max(0, z.lo - price));
  const zW = z => z.htf ? 2.5 : z.mtf ? 2.0 : z.kind === 'FVG' ? 1.2 : 1.5;
  for (const d of [1, -1]) {
    const at = zones.filter(z => z.dir === d && zDist(z, d) <= 0.6 * RL).sort((a, b) => zW(b) - zW(a))[0];
    if (at) {
      const zName = `${at.htf ? htfL : at.mtf ? mtfL : ltfL} ${at.kind}`;
      add(d, zW(at), `reaksi di zona ${zName}`);
    }
  }

  // 4. Discount / Premium Array
  if (pos < 0.5) add(1, pos < 0.3 ? 1.5 : 0.8, `discount array zone (${mtfL})`);
  else add(-1, pos > 0.7 ? 1.5 : 0.8, `premium array zone (${mtfL})`);

  // 5. Candlestick & Momentum Rejection/Continuity
  if (cs) add(cs.dir, 1.2, `${ltfL} ${cs.name}`);
  if (mo.disp) add(mo.disp.dir, 1.5, `${ltfL} displacement impulse`);

  let dir = sc[1] > sc[-1] ? 1 : -1;
  if (Math.abs(sc[1] - sc[-1]) < 1) dir = sM.trend || sH.trend || 1;

  const win = sc[dir], edge = win - sc[-dir];
  const strong = win >= 5 && edge >= 2.0;
  const conf = clamp(Math.round(45 + edge * 4 + win * 2), 35, 96);

  // Penentuan POI Pullback / Kontinuitas untuk limit order / zona entry ideal
  const pullPoi = zones
    .filter(z => z.dir === dir && zDist(z, dir) > 0.2 * RL && zDist(z, dir) <= st.maxPull * RL)
    .sort((a, b) => zDist(a, dir) - zDist(b, dir))[0];

  const swingPoi = () => {
    const sw = sM.swings
      .filter(s => s.type === (dir > 0 ? 'L' : 'H') && (dir > 0 ? s.p < price : s.p > price))
      .sort((a, b) => Math.abs(price - a.p) - Math.abs(price - b.p))[0];
    if (sw) return { kind: dir > 0 ? 'MTF swing low' : 'MTF swing high', dir, lo: dir > 0 ? sw.p - 0.2 * RM : sw.p, hi: dir > 0 ? sw.p + 0.2 * RM : sw.p + 0.2 * RM };
    const e = price - dir * 0.8 * RL;
    return { kind: 'structural poi', dir, lo: e - 0.3 * RL, hi: e + 0.3 * RL };
  };

  const POI = pullPoi || swingPoi();
  const needConfirm = st.confirm && (!strong || !sweepM);
  const mode = needConfirm ? 'CONFIRM' : (pullPoi ? 'PULLBACK' : 'REACTION');

  // ======================= PERHITUNGAN STRUKTURAL SL & TP (ANTI-SAPUAN) =======================
  const buildPlan = (mode, P) => {
    let zLo, zHi;
    const mid = (P.lo + P.hi) / 2;
    if (dir > 0) { zHi = Math.min(price, P.hi); zLo = Math.min(mid, zHi - 0.4 * RL); }
    else         { zLo = Math.max(price, P.lo); zHi = Math.max(mid, zLo + 0.4 * RL); }
    
    if (zHi - zLo < 1.5 * spec.pip) { const m = (zHi + zLo) / 2; zLo = m - spec.pip; zHi = m + spec.pip; }
    const entry = (zLo + zHi) / 2;

    // SL Struktural berbasis swing point / struktur MTF/HTF terdekat (Buffer aman dari sapuan wick XAUUSD)
    const swCandidates = [
      ...sM.swings.filter(s => s.type === (dir > 0 ? 'L' : 'H')).map(s => s.p),
      ...sH.swings.filter(s => s.type === (dir > 0 ? 'L' : 'H')).map(s => s.p),
    ].filter(p => (dir > 0 ? p < zLo : p > zHi));

    let structuralSL = swCandidates.length ? (dir > 0 ? Math.min(...swCandidates) : Math.max(...swCandidates)) : (entry - dir * st.slMin * RL);
    // Tambahkan buffer aman proporsional agar tidak gampang tersapu noise/sweep di XAUUSD
    const safetyBuffer = Math.max(st.slMin * RL, 1.8 * spec.pip);
    if (dir > 0) structuralSL = Math.min(structuralSL, zLo - safetyBuffer);
    else structuralSL = Math.max(structuralSL, zHi + safetyBuffer);

    const riskDist = Math.max(Math.abs(entry - structuralSL), st.slMin * RL);
    const sl = entry - dir * riskDist;

    // TP berbasis Risk-to-Reward (RR) dan Liquidity Pools / S&R berikutnya
    const tp1 = entry + dir * riskDist * st.rr[0];
    const tp2 = entry + dir * riskDist * st.rr[1];
    const tp3 = entry + dir * riskDist * st.rr[2];

    return { mode, poi: P, zLo, zHi, entry, sl, Rk: riskDist, tp1, tp2, tp3, tpNames: ['liquidity target 1', 'structural array 2', 'major HTF pool'] };
  };

  const plan = buildPlan(mode, POI);
  return { RL, pos, sc, why, dir, conf, ltfL, mtfL, htfL, strong, signal: dir > 0 ? 'BUY' : 'SELL', ...plan };
}

// ======================= TEMPLATE ALASAN =======================
const MODE_LABEL = {
  id: { REACTION: 'REAKSI ZONA', PULLBACK: 'PULLBACK STRUCTURAL', CONFIRM: 'TUNGGU KONFIRMASI LTF' },
  en: { REACTION: 'ZONE REACTION', PULLBACK: 'STRUCTURAL PULLBACK', CONFIRM: 'WAIT LTF CONFIRMATION' },
};

function templateReason(a, lang) {
  const id = lang !== 'en';
  const f = (a.why[a.dir].length ? a.why[a.dir] : [`${a.htfL} trend alignment`]).slice(0, 3).join(' · ');
  const poi = a.poi?.kind || 'zona POI';
  return id 
    ? `${f}. Setup ${a.mode} di ${poi} dengan struktur ${a.mtfL}/${a.htfL}, manajemen risiko SL struktural terkalibrasi aman.`
    : `${f}. Setup ${a.mode} at ${poi} with ${a.mtfL}/${a.htfL} structure, risk-managed structural SL.`;
}

// ======================= HANDLER UTAMA =======================
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
    let Ld, Md, Hd;
    try {
      [Ld, Md, Hd] = await Promise.all([
        getCandles(spec, st.ltf),
        getCandles(spec, st.mtf),
        getCandles(spec, st.htf)
      ]);
    } catch (e) {
      return res.status(503).json({ error: id ? `Data candle multi-timeframe belum lengkap (${e.message}).` : `Multi-TF candle data incomplete (${e.message}).` });
    }

    const rebase = c => {
      const shift = price - c[c.length - 1].c;
      if (Math.abs(shift) / price > 0.08) throw new Error('out of sync');
      return c.map(k => ({ ...k, o: k.o + shift, h: k.h + shift, l: k.l + shift, c: k.c + shift }));
    };

    let L, M, H;
    try {
      L = rebase(Ld.c); M = rebase(Md.c); H = rebase(Hd.c);
    } catch {
      return res.status(503).json({ error: id ? 'Sinkronisasi harga live gagal.' : 'Live price sync failed.' });
    }

    const a = analyzeMultiTF(L, M, H, price, st, spec);
    const text = templateReason(a, lang);

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
      source: `${Ld.src} ${a.ltfL} / ${Md.src} ${a.mtfL} / ${Hd.src} ${a.htfL}`,
      score: a.sc, confidence: a.conf, factors: a.why, strong: a.strong,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
