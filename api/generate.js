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

// confirm : true  -> setup lemah jadi "TUNGGU KONFIRMASI" (intraday/swing)
//           false -> setup lemah tetap ambil reaksi zona (scalping/day trade)
// maxPull : jarak maksimal zona limit (kelipatan rata-rata candle LTF)
const STYLES = {
  scalp: { ltf: '1m',  htf: '15m', slMin: 1.0, slMax: 2.5, rr: [1.0, 1.8, 3.0], confirm: false, maxPull: 3 },
  day:   { ltf: '3m',  htf: '30m', slMin: 1.0, slMax: 2.8, rr: [1.0, 2.0, 3.2], confirm: false, maxPull: 3.5 },
  intra: { ltf: '5m',  htf: '1h',  slMin: 1.2, slMax: 3.0, rr: [1.2, 2.2, 3.5], confirm: true,  maxPull: 5 },
  swing: { ltf: '15m', htf: '4h',  slMin: 1.3, slMax: 3.5, rr: [1.5, 2.8, 4.5], confirm: true,  maxPull: 6 },
};
const pickStyle = s => /scalp/i.test(s) ? 'scalp' : /day/i.test(s) ? 'day' : /swing/i.test(s) ? 'swing' : 'intra';
const TF_LABEL = { '1m': 'M1', '3m': 'M3', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4' };
const TF_MS = { '1m': 6e4, '3m': 18e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5 };
const YF_TF = {
  '1m': { i: '1m', r: '5d' }, '3m': { i: '1m', r: '5d', agg: 3 }, '5m': { i: '5m', r: '5d' },
  '15m': { i: '15m', r: '1mo' }, '30m': { i: '30m', r: '1mo' }, '1h': { i: '60m', r: '3mo' }, '4h': { i: '60m', r: '6mo', agg: 4 },
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
// Rata-rata panjang candle -> hanya untuk skala buffer/SL, BUKAN sinyal
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

// Market structure: BOS / CHoCH + protected level + HH/HL
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

// Liquidity pool (swing belum diambil) + equal highs/lows
function liquidity(c, sw, tol) {
  const n = c.length;
  const untaken = s => { for (let j = s.i + 1; j < n; j++) if (s.type === 'H' ? c[j].h > s.p : c[j].l < s.p) return false; return true; };
  const pools = sw.filter(untaken).map(s => ({ type: s.type, p: s.p, i: s.i, eq: false }));
  for (const a of pools) a.eq = pools.some(b => b !== a && b.type === a.type && Math.abs(b.p - a.p) <= tol);
  return pools;
}

// Liquidity sweep: wick tembus swing lalu close kembali
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

// Supply & Demand: base -> candle impuls
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

// Fair Value Gap belum terisi
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
    if (g.length >= 2) {
      const p = g.reduce((a, x) => a + x.p, 0) / g.length;
      out.push({ p, n: g.length, hRatio: g.filter(x => x.type === 'H').length / g.length });
    }
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

// Momentum price action: displacement + close beruntun
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
    const k = c[i], rng = k.h - k.l, body = Math.abs(k.c - k.o);
    if (body >= 1.5 * R && body >= 0.65 * rng) { disp = { dir: Math.sign(k.c - k.o), i }; break; }
  }
  return { dir: bull >= 4 ? 1 : bear >= 4 ? -1 : 0, run, rd, disp };
}

// ======================= ENGINE SINYAL (SELALU BUY / SELL) =======================
function analyze(L, H, price, st, spec) {
  const n = L.length, ltfL = TF_LABEL[st.ltf], htfL = TF_LABEL[st.htf];
  const R = avgRange(L.slice(0, -1)), RH = avgRange(H.slice(0, -1));
  const sL = structure(L, 2), sH = structure(H, 3);
  const tolL = 0.25 * R, tolH = 0.3 * RH;

  const liqL = liquidity(L, sL.swings, tolL), liqH = liquidity(H, sH.swings, tolH);
  const sweep = findSweep(L, sL.swings, tolL);
  const htfSweep = findSweep(H, sH.swings, tolH, 3);
  const lastEv = (s, d) => [...s.events].reverse().find(e => e.dir === d);
  const zones = [
    ...sndZones(L, R),
    ...sndZones(H, RH, 80).map(z => ({ ...z, htf: true })),
    ...fvgs(L, R),
    orderBlock(L, lastEv(sL, 1)), orderBlock(L, lastEv(sL, -1)),
  ].filter(Boolean);
  // Kontinuasi: level BOS yang baru ditembus = zona retest (S/R flip)
  if (sL.last && n - 1 - sL.last.i <= 40) {
    zones.push({ kind: 'BOS retest', dir: sL.last.dir, lo: sL.last.level - 0.25 * R, hi: sL.last.level + 0.25 * R, i: sL.last.i });
  }
  const levels = snrLevels([...sH.swings, ...sL.swings.filter(s => s.i >= n - 120)], tolH);
  const cs = candleSignal(L, R);
  const mo = momentum(L, R);

  // Dealing range HTF -> premium / discount
  const hsw = sH.swings, lh = hsw.filter(s => s.type === 'H').at(-1), ll = hsw.filter(s => s.type === 'L').at(-1);
  const startI = lh && ll ? Math.min(lh.i, ll.i) : Math.max(0, H.length - 60);
  const seg = H.slice(startI);
  const dHi = Math.max(...seg.map(k => k.h)), dLo = Math.min(...seg.map(k => k.l));
  const pos = dHi > dLo ? clamp((price - dLo) / (dHi - dLo), 0, 1) : 0.5;

  const sc = { 1: 0, [-1]: 0 }, why = { 1: [], [-1]: [] };
  const add = (d, w, t) => { if (!d) return; sc[d] += w; why[d].push(t); };
  const bw = d => d > 0 ? 'bullish' : 'bearish';

  // 1. Struktur HTF
  if (sH.trend) add(sH.trend, 2, `${htfL} ${bw(sH.trend)} (${sH.last.type})`);
  if (sH.seq?.hh && sH.seq?.hl) add(1, 1, `${htfL} HH-HL`);
  if (sH.seq && !sH.seq.hh && !sH.seq.hl) add(-1, 1, `${htfL} LH-LL`);

  // 2. Struktur LTF
  if (sL.last && n - 1 - sL.last.i <= 25) {
    const aligned = sL.last.dir === sH.trend;
    const w = sL.last.type === 'CHoCH' ? (aligned ? 2 : 1.5) : 1.5;
    add(sL.last.dir, w, `${sL.last.type} ${ltfL} ${bw(sL.last.dir)}`);
  }

  // 3. Likuiditas
  if (sweep) add(sweep.dir, sweep.eq ? 2 : 1.5, `sweep ${sweep.dir > 0 ? (sweep.eq ? 'EQL' : 'SSL') : (sweep.eq ? 'EQH' : 'BSL')} ${ltfL}`);
  if (htfSweep) add(htfSweep.dir, 1.5, `sweep ${htfSweep.dir > 0 ? 'SSL' : 'BSL'} ${htfL}`);

  // 4. POI
  const zDist = (z, d) => d > 0
    ? (price < z.lo ? Infinity : Math.max(0, price - z.hi))
    : (price > z.hi ? Infinity : Math.max(0, z.lo - price));
  const zW = z => z.kind === 'FVG' ? 0.75 : z.kind === 'OB' || z.kind === 'BOS retest' ? 1 : z.htf ? 2 : 1.5;
  const zName = z => z.kind === 'BOS retest' || z.kind === 'S/R' ? z.kind : `${z.htf ? htfL : ltfL} ${z.kind}${z.touches === 0 ? ' fresh' : ''}`;
  for (const d of [1, -1]) {
    const at = zones.filter(z => z.dir === d && zDist(z, d) <= 0.5 * R).sort((a, b) => zW(b) - zW(a))[0];
    if (at) add(d, zW(at), `di ${zName(at)}`);
  }

  // 5. Support / Resistance
  const sup = levels.filter(l => l.p <= price && price - l.p <= 0.6 * R).sort((a, b) => b.p - a.p)[0];
  const res = levels.filter(l => l.p >= price && l.p - price <= 0.6 * R).sort((a, b) => a.p - b.p)[0];
  if (sup) add(1, sup.hRatio >= 0.6 ? 1.5 : 1, sup.hRatio >= 0.6 ? 'S/R flip jadi support' : `support ${sup.n}x`);
  if (res) add(-1, res.hRatio <= 0.4 ? 1.5 : 1, res.hRatio <= 0.4 ? 'S/R flip jadi resistance' : `resistance ${res.n}x`);

  // 6. Premium / Discount
  if (pos < 0.5) add(1, pos < 0.3 ? 1.5 : 0.75, `discount ${htfL}`);
  else add(-1, pos > 0.7 ? 1.5 : 0.75, `premium ${htfL}`);
  if (pos > 0.85) sc[1] -= 1.5;
  if (pos < 0.15) sc[-1] -= 1.5;

  // 7. Konfirmasi candle & momentum
  if (cs) add(cs.dir, 1, cs.name);
  if (mo.disp) add(mo.disp.dir, 1.25, `displacement ${ltfL}`);
  if (mo.dir) add(mo.dir, 0.5, 'close beruntun searah');

  // ===== Arah: selalu dipilih (tanpa HOLD) =====
  let dir = sc[1] > sc[-1] ? 1 : -1;
  if (Math.abs(sc[1] - sc[-1]) < 1) dir = sH.trend || sL.last?.dir || mo.dir || (pos < 0.5 ? 1 : -1);

  const zoneNear = d => zones.filter(z => z.dir === d && zDist(z, d) <= 0.3 * R).sort((a, b) => zW(b) - zW(a))[0];

  // Counter-trend hanya jika reversal valid (sweep + CHoCH) atau reaksi jelas di zona (scalp/day)
  let counter = false;
  if (sH.trend && dir !== sH.trend) {
    const reversal = (sweep?.dir === dir || htfSweep?.dir === dir) && sL.last?.type === 'CHoCH' && sL.last.dir === dir;
    const scalpReact = !st.confirm && zoneNear(dir) && (cs?.dir === dir || sweep?.dir === dir);
    if (reversal || scalpReact) counter = true;
    else dir = sH.trend;
  }

  const win = sc[dir], edge = win - sc[-dir];
  const strong = win >= 5 && edge >= 2.5;
  const conf = clamp(Math.round(40 + edge * 5 + win * 2), 30, 95);

  // ===== Trigger =====
  const zoneAt = zoneNear(dir);
  const sweepNow = sweep?.dir === dir && n - 1 - sweep.i <= 3;
  const csNow = cs?.dir === dir;
  const bosFresh = sL.last?.dir === dir && n - 1 - sL.last.i <= 5;
  const dispFresh = mo.disp?.dir === dir;
  const hasTrigger = !!(zoneAt || sweepNow || csNow || bosFresh || dispFresh);
  const overext = (mo.rd === dir && mo.run >= 7) ||
    (sL.last?.dir === dir && (price - sL.last.level) * dir > 3 * R);

  // ===== POI untuk limit =====
  const snrPoi = levels
    .filter(l => dir > 0 ? l.p < price : l.p > price)
    .map(l => ({ kind: 'S/R', dir, lo: l.p - 0.2 * R, hi: l.p + 0.2 * R, n: l.n }));
  const pullPoi = [...zones.filter(z => z.dir === dir), ...snrPoi]
    .map(z => ({ ...z, dist: zDist(z, dir) }))
    .filter(z => z.dist > 0.3 * R && z.dist <= st.maxPull * R)
    .sort((a, b) => (a.dist - zW(a) * 0.3 * R) - (b.dist - zW(b) * 0.3 * R))[0];

  // Cadangan: swing terdekat sebagai zona reaksi
  const swingPoi = () => {
    const sw = sL.swings
      .filter(s => s.i >= n - 60 && s.type === (dir > 0 ? 'L' : 'H') &&
        (dir > 0 ? s.p < price - 0.3 * R : s.p > price + 0.3 * R) && Math.abs(price - s.p) <= st.maxPull * R)
      .sort((a, b) => Math.abs(price - a.p) - Math.abs(price - b.p))[0];
    if (sw) return { kind: dir > 0 ? 'swing low' : 'swing high', dir, lo: dir > 0 ? sw.p : sw.p - 0.4 * R, hi: dir > 0 ? sw.p + 0.4 * R : sw.p };
    const e = price - dir * 0.8 * R;
    return { kind: 'zona reaksi', dir, lo: e - 0.25 * R, hi: e + 0.25 * R };
  };

  // ===== Pilih mode =====
  let mode, P = null;
  const needConfirm = st.confirm && (!strong || !hasTrigger || counter);
  if (needConfirm) { mode = 'CONFIRM'; P = pullPoi || swingPoi(); }
  else if ((zoneAt || sweepNow || csNow) && !overext) { mode = 'REACTION'; P = zoneAt || null; }
  else if ((bosFresh || dispFresh) && !overext) mode = 'CONTINUATION';
  else if (pullPoi) { mode = strong ? 'PULLBACK' : 'REACTION_LIMIT'; P = pullPoi; }
  else { mode = st.confirm ? 'CONFIRM' : 'REACTION_LIMIT'; P = swingPoi(); }

  const isMarket = m => m === 'REACTION' || m === 'CONTINUATION';

  // ===== Bangun plan: entry, SL, TP =====
  const buildPlan = (mode, P) => {
    let zLo, zHi;
    if (!isMarket(mode)) {
      const mid = (P.lo + P.hi) / 2;
      if (dir > 0) { zHi = P.hi; zLo = mid; } else { zLo = P.lo; zHi = mid; }
      // zona limit tidak boleh menempel harga sekarang
      if (dir > 0) { zHi = Math.min(zHi, price - 0.15 * R); if (zLo >= zHi) zLo = zHi - 0.3 * R; }
      else         { zLo = Math.max(zLo, price + 0.15 * R); if (zHi <= zLo) zHi = zLo + 0.3 * R; }
    } else if (dir > 0) { zLo = price - 0.2 * R; zHi = price + 0.05 * R; }
    else { zLo = price - 0.05 * R; zHi = price + 0.2 * R; }
    if (zHi - zLo < 2 * spec.pip) { const m = (zHi + zLo) / 2; zLo = m - spec.pip; zHi = m + spec.pip; }
    const entry = (zLo + zHi) / 2;

    // SL struktural
    const cands = [];
    if (P) cands.push(dir > 0 ? P.lo : P.hi);
    if (sweep?.dir === dir) cands.push(dir > 0 ? L[sweep.i].l : L[sweep.i].h);
    if (cs?.dir === dir && isMarket(mode)) cands.push(dir > 0 ? L[cs.i].l : L[cs.i].h);
    if (!cands.length) {
      const sw = sL.swings.filter(s => s.i >= n - 40 && s.type === (dir > 0 ? 'L' : 'H') && (dir > 0 ? s.p < zLo : s.p > zHi)).map(s => s.p);
      if (sw.length) cands.push(dir > 0 ? Math.max(...sw) : Math.min(...sw));
      else if (sL.last?.dir === dir && sL.last.prot != null) cands.push(sL.last.prot);
    }
    let slBase = cands.length ? (dir > 0 ? Math.min(...cands) : Math.max(...cands)) : entry - dir * st.slMin * R;
    slBase = dir > 0 ? Math.min(slBase, zLo) : Math.max(slBase, zHi);
    const rawR = Math.abs(entry - (slBase - dir * 0.25 * R));
    const Rk = Math.max(clamp(rawR, st.slMin * R, st.slMax * R), 3 * spec.pip);
    const sl = entry - dir * Rk;
    const xR = p => (p - entry) * dir / Rk;

    // Hambatan di depan
    const obstacles = [
      ...zones.filter(z => z.dir === -dir).map(z => ({ p: dir > 0 ? z.lo : z.hi, name: zName(z) })),
      ...levels.map(l => ({ p: l.p, name: dir > 0 ? 'resistance' : 'support' })),
    ].filter(o => (o.p - entry) * dir > 0.15 * R).map(o => ({ ...o, r: xR(o.p) })).sort((a, b) => a.r - b.r);

    // TP ke likuiditas
    const targets = [
      ...[...liqL, ...liqH].filter(p => p.type === (dir > 0 ? 'H' : 'L'))
        .map(p => ({ p: p.p, name: p.eq ? (dir > 0 ? 'EQH' : 'EQL') : (dir > 0 ? 'BSL' : 'SSL') })),
      ...obstacles,
    ].map(t => ({ ...t, r: xR(t.p) })).filter(t => t.r > 0.5).sort((a, b) => a.r - b.r);
    const front = t => t.p - dir * 0.1 * R;
    const pick = (lo, hi) => targets.find(t => t.r >= lo && t.r <= hi);
    const rr = st.rr;

    const t1 = pick(0.9, rr[0] + 0.6);
    let tp1 = t1 ? front(t1) : entry + dir * rr[0] * Rk;
    // hit & run: TP1 sebelum hambatan terdekat
    const ob = obstacles[0];
    if (ob && ob.r >= 0.6 && ob.r < xR(tp1)) tp1 = front(ob);
    const t2 = pick(xR(tp1) + 0.6, rr[2]);
    const tp2 = t2 ? front(t2) : entry + dir * Math.max(rr[1], xR(tp1) + 0.8) * Rk;
    const t3 = targets.find(t => t.r >= xR(tp2) + 0.6 && t.r <= 7);
    const tp3 = t3 ? front(t3) : entry + dir * Math.max(rr[2], xR(tp2) + 1) * Rk;

    return {
      mode, poi: P, zLo, zHi, entry, sl, Rk, tp1, tp2, tp3,
      tpNames: [t1?.name, t2?.name, t3?.name], room: ob ? ob.r : 99, obstacle: ob?.name,
    };
  };

  let plan = buildPlan(mode, P);

  // Ruang sempit di depan entry market -> pindah ke limit di POI
  if (isMarket(mode) && plan.room < 0.6) {
    const alt = pullPoi || swingPoi();
    const m2 = st.confirm ? 'CONFIRM' : (strong ? 'PULLBACK' : 'REACTION_LIMIT');
    const p2 = buildPlan(m2, alt);
    if (p2.room > plan.room) plan = p2;
  }

  return { R, pos, sc, why, dir, conf, ltfL, htfL, strong, counter, signal: dir > 0 ? 'BUY' : 'SELL', ...plan };
}

// ======================= REASON =======================
const MODE_LABEL = {
  id: { REACTION: 'REAKSI ZONA', REACTION_LIMIT: 'LIMIT REAKSI', CONTINUATION: 'KONTINUASI', PULLBACK: 'PULLBACK LIMIT', CONFIRM: 'TUNGGU KONFIRMASI' },
  en: { REACTION: 'ZONE REACTION', REACTION_LIMIT: 'REACTION LIMIT', CONTINUATION: 'CONTINUATION', PULLBACK: 'PULLBACK LIMIT', CONFIRM: 'WAIT CONFIRMATION' },
};

function templateReason(a, lang) {
  const id = lang !== 'en';
  const f = (a.why[a.dir].length ? a.why[a.dir] : [`${a.htfL} ${a.dir > 0 ? 'bullish' : 'bearish'} bias`]).slice(0, 4).join(' · ');
  const poi = a.poi ? (a.poi.kind || 'POI') : 'zona';
  const tgt = a.tpNames.find(Boolean);
  const tg = tgt ? (id ? `, target ${tgt}` : `, target ${tgt}`) : '';
  const plan = {
    REACTION:       id ? 'Harga bereaksi di zona, entry sekarang, TP1 lalu BE.' : 'Price reacting at zone, enter now, TP1 then BE.',
    CONTINUATION:   id ? 'Kontinuasi setelah BOS/displacement, hit & run TP1 lalu BE.' : 'Continuation after BOS/displacement, hit & run TP1 then BE.',
    PULLBACK:       id ? `Limit di ${poi}${tg}.` : `Limit at ${poi}${tg}.`,
    REACTION_LIMIT: id ? `Pasang limit di ${poi}, ambil reaksi cepat ke TP1.` : `Place limit at ${poi}, take quick reaction to TP1.`,
    CONFIRM:        id ? `Tunggu harga masuk ${poi} + rejection/CHoCH ${a.ltfL}, baru entry${tg}.`
                       : `Wait for price into ${poi} + ${a.ltfL} rejection/CHoCH before entry${tg}.`,
  }[a.mode];
  return `${f}. ${plan}`;
}

async function aiReason(a, ctx, lang, apiKey) {
  if (!apiKey) return null;
  const facts = {
    market: ctx.key, style: ctx.style, signal: a.signal, mode: a.mode,
    mode_meaning: {
      REACTION: 'enter now, price reacting at zone', CONTINUATION: 'enter now, trend continuation after BOS',
      PULLBACK: 'limit order at POI', REACTION_LIMIT: 'limit at nearest reaction zone, quick TP1',
      CONFIRM: 'wait for price to reach POI and show rejection or CHoCH before entry',
    }[a.mode],
    poi: a.poi?.kind || null, confluence: a.why[a.dir], opposing: a.why[-a.dir],
    premium_discount_pct: Math.round(a.pos * 100), counter_trend_reversal: a.counter,
    entry_zone: [ctx.f(a.zLo), ctx.f(a.zHi)], sl: ctx.f(a.sl), tp_targets: a.tpNames, timeframes: `${a.ltfL}/${a.htfL}`,
  };
  const sys = `You are a senior pure price-action trader (SMC, market structure, liquidity, supply & demand, S/R). Write ONE trade reason, max 2 short sentences (max 200 characters), in ${lang === 'en' ? 'English' : 'Bahasa Indonesia'}. Use ONLY the given facts. Never mention indicators. Never invent prices. Never say HOLD, no trade, or avoid. State the key confluence and the execution plan matching the mode. Plain text, no markdown.`;
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
    // 1. Candle LTF & HTF
    let Ld, Hd;
    try {
      [Ld, Hd] = await Promise.all([getCandles(spec, st.ltf), getCandles(spec, st.htf)]);
    } catch (e) {
      return res.status(503).json({ error: id ? `Data candle belum tersedia (${e.message}). Silakan generate ulang.` : `Candle data unavailable (${e.message}). Please regenerate.` });
    }
    if (Ld.stale) {
      return res.status(503).json({ error: id ? 'Market sedang tutup / feed candle tidak aktif. Generate saat sesi buka.' : 'Market closed / candle feed inactive. Generate during open session.' });
    }

    // 2. Rebase candle ke harga live (ikut kalibrasi MT)
    const rebase = c => {
      const shift = price - c[c.length - 1].c;
      if (Math.abs(shift) / price > 0.05) throw new Error('out of sync');
      return c.map(k => ({ ...k, o: k.o + shift, h: k.h + shift, l: k.l + shift, c: k.c + shift }));
    };
    let L, H;
    try { L = rebase(Ld.c); H = rebase(Hd.c); }
    catch { return res.status(503).json({ error: id ? 'Sumber data tidak sinkron dengan harga live. Generate ulang.' : 'Data source out of sync. Please regenerate.' }); }

    // 3. Analisis (selalu BUY / SELL)
    const a = analyze(L, H, price, st, spec);
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
      source: `${Ld.src} ${a.ltfL} / ${Hd.src} ${a.htfL}`,
      score: a.sc, confidence: a.conf, factors: a.why, strong: a.strong, counter: a.counter,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
