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
// htf / mtf / ltf : HTF = bias, MTF = struktur & POI, LTF = trigger & sweep
// bufM / bufL     : buffer SL = max(bufM x ATR_MTF, bufL x ATR_LTF)
// minSl / maxSl   : jarak SL (x ATR_MTF). Di bawah minSl dilebarkan.
//                   Di atas maxSl dipilih titik yang masih muat, jika tidak ada ditandai wide.
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
    if
