// lib/fxopen.js — FXOpen TickTrader REST: autentikasi HMAC, candle BID, tick BID.
// Env: FXOPEN_WEB_API_ID, FXOPEN_WEB_API_KEY, FXOPEN_WEB_API_SECRET, FXOPEN_BASE_URL (opsional)
// Pacing 150 ms antar request (batas 10 request/detik dari /api/v2/account).
import crypto from 'crypto';

const BASE = (process.env.FXOPEN_BASE_URL || 'https://ttlivewebapi.fxopen.net').replace(/\/+$/, '');
const ID = process.env.FXOPEN_WEB_API_ID || '';
const KEY = process.env.FXOPEN_WEB_API_KEY || '';
const SECRET = process.env.FXOPEN_WEB_API_SECRET || '';

// Simbol sistem -> simbol FXOpen (tanpa akhiran _L)
export const SYMBOL_MAP = { XAUUSD: 'XAUUSD', BTCUSD: 'BTCUSD', BTC: 'BTCUSD' };
// Timeframe sistem -> periodicity FXOpen
export const TF_MAP = { m1: 'M1', m5: 'M5', m15: 'M15', m30: 'M30', h1: 'H1', h4: 'H4', d1: 'D1' };

// Signature sesuai contoh resmi FXOpen (ExecuteGetRequest):
// payload = timestamp(ms) + Id + Key + METHOD + URL_LENGKAP + body; HMAC-SHA256(secret, ASCII) -> Base64
export function signRest({ id, key, secret, method, url, body = '', ts = Date.now() }) {
  const payload = String(ts) + id + key + method.toUpperCase() + url + body;
  const hash = crypto.createHmac('sha256', Buffer.from(secret, 'ascii'))
    .update(Buffer.from(payload, 'ascii')).digest('base64');
  return 'HMAC ' + id + ':' + key + ':' + ts + ':' + hash;
}

let chain = Promise.resolve();
let lastAt = 0;
const GAP_MS = 150;
function paced(fn) {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastAt + GAP_MS - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    lastAt = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

async function getJson(path, query = {}, { retries = 2 } = {}) {
  if (!ID || !KEY || !SECRET) throw new Error('FXOPEN env belum lengkap');
  const qs = Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';
  const url = BASE + path + qs;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await paced(() => fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(6000),
      headers: {
        Accept: 'application/json',
        Authorization: signRest({ id: ID, key: KEY, secret: SECRET, method: 'GET', url }),
      },
    }));
    if (res.status === 429 && attempt < retries) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error('FXOpen HTTP ' + res.status + ' ' + path);
    try { return JSON.parse(text); } catch { throw new Error('FXOpen JSON tidak valid'); }
  }
}

// Bars bid atau ask. timestamp (ms) = titik acuan; count negatif = mundur dari timestamp (max ±1000)
export async function fetchBars(symbol, tf, side, timestamp, count) {
  const sym = SYMBOL_MAP[symbol] || symbol;
  const per = TF_MAP[tf];
  if (!per) throw new Error('timeframe tidak didukung: ' + tf);
  const data = await getJson(`/api/v2/quotehistory/${encodeURIComponent(sym)}/${per}/bars/${side}`,
    { timestamp: String(timestamp), count: String(count) });
  return Array.isArray(data.Bars) ? data.Bars : [];
}

// Konversi bar FXOpen ke format sistem {t,o,h,l,c} (t dalam ms, awal bar)
export function barsToCandles(bars) {
  return (bars || []).map(b => ({ t: Number(b.Timestamp), o: Number(b.Open), h: Number(b.High), l: Number(b.Low), c: Number(b.Close) }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite))
    .sort((a, b) => a.t - b.t);
}

// Candle BID untuk satu timeframe (format {t,o,h,l,c}).
export async function getBidCandles(symbol, tf, count = -300, timestamp = Date.now()) {
  return barsToCandles(await fetchBars(symbol, tf, 'bid', timestamp, count));
}

// Tick BID sejak timestamp (untuk chart TICK dan harga live).
export async function getBidTicks(symbol, timestamp, count = -50) {
  const sym = SYMBOL_MAP[symbol] || symbol;
  const data = await getJson(`/api/v2/quotehistory/${encodeURIComponent(sym)}/ticks`,
    { timestamp: String(timestamp), count: String(count) });
  return (data.Ticks || []).map(t => ({ t: Number(t.Timestamp), p: Number(t.BestBid.Price) }))
    .filter(x => Number.isFinite(x.t) && Number.isFinite(x.p));
}

// Snapshot harga terbaru beberapa simbol sekaligus: GET /api/v2/tick/{filter} (filter dipisah spasi).
// Mengembalikan [{symbol, bid, ask, t}] dengan bid sebagai harga utama.
export async function getBidSnapshot(symbols) {
  const syms = symbols.map(s => SYMBOL_MAP[s] || s);
  const filter = syms.map(s => encodeURIComponent(s)).join('%20');
  const data = await getJson(`/api/v2/tick/${filter}`);
  const list = Array.isArray(data) ? data : [];
  return list.map(t => ({
    symbol: String(t.Symbol || ''),
    bid: Number(t.BestBid && t.BestBid.Price),
    ask: Number(t.BestAsk && t.BestAsk.Price),
    t: Number(t.Timestamp),
  })).filter(x => Number.isFinite(x.bid) && x.bid > 0);
}

