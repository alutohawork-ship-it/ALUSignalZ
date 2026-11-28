// api/candles.js — v11 (FXOpen TickTrader, bid)
// Kontrak sama dengan v10: POST {email,value,symbol,interval,limit} -> {ok,candles:[{t,o,h,l,c}],source,stale}
// - Sumber: FXOpen REST /quotehistory/{symbol}/{tf}/bars/bid (native M1..D1, tanpa agregasi).
// - Cache memori + KV (bersama antar instance). TTL per timeframe.
// - 429/401/5xx/timeout -> sajikan candle terakhir yang valid (stale:true).
// Env: FXOPEN_WEB_API_ID, FXOPEN_WEB_API_KEY, FXOPEN_WEB_API_SECRET, KV_REST_API_URL, KV_REST_API_TOKEN (opsional)
import { checkAccess } from '../lib/access.js';
import { getBidCandles, SYMBOL_MAP as FX_SYMBOL, TF_MAP } from '../lib/fxopen.js';

export const config = { maxDuration: 60 };

const SYMBOL_ALIAS = {
  XAUUSD: 'XAUUSD', GOLD: 'XAUUSD',
  BTCUSD: 'BTCUSD', BTCUSDT: 'BTCUSD', BTC: 'BTCUSD',
};
// interval (dari index.html) -> kunci TF_MAP (lib/fxopen.js)
const INTERVAL_TF = { '1m': 'm1', '5m': 'm5', '15m': 'm15', '30m': 'm30', '1h': 'h1', '4h': 'h4', '1d': 'd1' };
const MIN = 60 * 1000;
const TTL = { '1m': 30, '5m': 60, '15m': 120, '30m': 180, '1h': 300, '4h': 600, '1d': 1800 };
const TF_MS = { '1m': MIN, '5m': 5 * MIN, '15m': 15 * MIN, '30m': 30 * MIN, '1h': 60 * MIN, '4h': 240 * MIN, '1d': 1440 * MIN };

const KV_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const kvOn = !!(KV_URL && KV_TOKEN);

const memCache = new Map();   // key -> { exp, value }
const lastGood = new Map();   // key -> rows terakhir yang valid

async function kvCmd(args) {
  if (!kvOn) return null;
  try {
    const r = await fetch(KV_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.result !== undefined ? j.result : null;
  } catch { return null; }
}

async function cacheGet(key) {
  const hit = memCache.get(key);
  if (hit && Date.now() < hit.exp) return hit.value;
  const raw = await kvCmd(['GET', key]);
  if (raw == null) return null;
  try { const v = JSON.parse(raw); if (Array.isArray(v) && v.length) { memCache.set(key, { exp: Date.now() + 15000, value: v }); return v; } } catch {}
  return null;
}

async function cacheSet(key, rows, ttlSec) {
  if (memCache.size > 300) for (const [k, v] of memCache) if (Date.now() > v.exp) memCache.delete(k);
  memCache.set(key, { exp: Date.now() + ttlSec * 1000, value: rows });
  lastGood.set(key, rows);
  await kvCmd(['SET', key, JSON.stringify(rows), 'EX', String(Math.max(ttlSec * 4, 120))]);
}

// Sanitasi: buang OHLC tidak valid, dedupe timestamp kembar (yang terakhir menang)
function sanitize(rows) {
  const valid = rows.filter(c =>
    [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite) &&
    c.h >= Math.max(c.o, c.c, c.l) && c.l <= Math.min(c.o, c.c, c.h));
  const out = [];
  for (const c of valid) {
    if (out.length && out[out.length - 1].t === c.t) out[out.length - 1] = c;
    else out.push(c);
  }
  return out;
}

function stale(key, lim, reason, retryInSec = 30) {
  const good = lastGood.get(key);
  if (Array.isArray(good) && good.length) return { ok: true, candles: good.slice(-lim), source: 'stale-cache', stale: true, retryInSec, note: reason };
  return null;
}

const ACCESS_MSG = {
  noEmail: { status: 401, msg: 'Email tidak ditemukan. Silakan login ulang.' },
  notRegistered: { status: 403, msg: 'Email ini belum terdaftar sebagai klien.' },
  expired: { status: 403, msg: 'Masa akses sudah berakhir. Hubungi admin.' },
  kvError: { status: 503, msg: 'Akses tidak bisa diverifikasi. Coba lagi.' },
  trialLimit: { status: 403, msg: 'Batas trial habis.' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const email = String(body.email || body.value || '').trim().toLowerCase();
  const access = await checkAccess(email, false);
  if (!access.ok) {
    const m = ACCESS_MSG[access.key] || { status: 403, msg: 'Akses ditolak.' };
    return res.status(m.status).json({ error: m.msg });
  }

  const { symbol, interval, limit } = body;
  if (!symbol || !interval) return res.status(400).json({ error: 'Symbol & interval required' });
  const tfKey = INTERVAL_TF[interval];
  if (!tfKey) return res.status(400).json({ error: `Interval tidak valid: ${interval}` });

  const key0 = String(symbol).toUpperCase().replace(/^[A-Z]+:/, '').replace(/[^A-Z0-9]/g, '');
  const canon = SYMBOL_ALIAS[key0];
  if (!canon || !FX_SYMBOL[canon]) return res.status(400).json({ error: `Simbol tidak dikenal: ${symbol}` });

  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 10), 1000);
  const cacheKey = `candles_fx_v11_${canon}_${interval}`;
  const minOk = Math.min(lim, 60);

  const hit = await cacheGet(cacheKey);
  if (Array.isArray(hit) && hit.length >= minOk) {
    return res.status(200).json({ ok: true, candles: hit.slice(-lim), source: 'cache', stale: false });
  }

  try {
    // count negatif = mundur dari timestamp (sekarang); max 1000 bar
    const raw = await getBidCandles(canon, tfKey, -Math.min(lim + 5, 1000), Date.now());
    let rows = sanitize(raw);
    // bar yang masih berjalan dibiarkan (chart live); engine membuangnya sendiri via closed()
    if (!rows.length) {
      const st = stale(cacheKey, lim, 'FXOpen mengembalikan data kosong. Menampilkan data terakhir yang valid.', 20);
      if (st) return res.status(200).json(st);
      return res.status(200).json({ ok: true, candles: [], source: 'fxopen-empty', stale: true });
    }
    await cacheSet(cacheKey, rows, TTL[interval]);
    return res.status(200).json({ ok: true, candles: rows.slice(-lim), source: 'fxopen', stale: false });
  } catch (err) {
    const msg = String(err.message || '');
    const isRate = /HTTP 429/.test(msg);
    const reason = isRate
      ? 'Batas request FXOpen tercapai (429). Menampilkan data terakhir yang valid.'
      : 'Upstream FXOpen bermasalah. Menampilkan data terakhir yang valid.';
    const st = stale(cacheKey, lim, reason, isRate ? 10 : 20);
    if (st) return res.status(200).json(st);
    const status = isRate ? 429 : 503;
    return res.status(status).json({ error: isRate ? 'Batas request FXOpen tercapai' : 'Upstream FXOpen tidak tersedia', detail: msg });
  }
}
