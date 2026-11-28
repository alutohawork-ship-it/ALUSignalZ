// api/live.js — harga live (bid) dari FXOpen, dibagi ke semua browser lewat cache 1 detik.
// Browser memanggil POST /api/live setiap detik; server hanya memanggil FXOpen sekali per detik per instance.
// Env: sama dengan candles (FXOPEN_WEB_API_ID/KEY/SECRET).
import { checkAccess } from '../lib/access.js';
import { getBidSnapshot, SYMBOL_MAP as FX_SYMBOL } from '../lib/fxopen.js';

export const config = { maxDuration: 30 };

const TTL_MS = 1000;
const ALIAS = { XAUUSD: 'XAUUSD', GOLD: 'XAUUSD', BTCUSD: 'BTCUSD', BTCUSDT: 'BTCUSD', BTC: 'BTCUSD' };
const SYMS = ['XAUUSD', 'BTCUSD'];

let snap = { exp: 0, rows: [], at: 0 };
let inflight = null;

async function fresh() {
  if (Date.now() < snap.exp) return snap;
  if (!inflight) {
    inflight = getBidSnapshot(SYMS)
      .then(rows => { if (rows.length) snap = { exp: Date.now() + TTL_MS, rows, at: Date.now() }; return snap; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const email = String(body.email || body.value || '').trim().toLowerCase();
  const access = await checkAccess(email, false);
  if (!access.ok) return res.status(403).json({ error: 'Akses ditolak.' });

  const want = Array.isArray(body.symbols) && body.symbols.length ? body.symbols : SYMS;
  const keys = new Set(want.map(s => ALIAS[String(s).toUpperCase().replace(/[^A-Z0-9]/g, '')]).filter(Boolean));

  try {
    const s = await fresh();
    const quotes = s.rows.filter(r => keys.has(r.symbol)).map(r => ({
      symbol: r.symbol, bid: r.bid, ask: r.ask, price: r.bid, t: r.t,
    }));
    return res.status(200).json({ ok: true, quotes, at: s.at, stale: Date.now() - s.at > 5000 });
  } catch (err) {
    const rate = /HTTP 429/.test(String(err.message || ''));
    if (snap.rows.length) {
      return res.status(200).json({ ok: true, stale: true, retryInSec: rate ? 5 : 2,
        quotes: snap.rows.filter(r => keys.has(r.symbol)).map(r => ({ symbol: r.symbol, bid: r.bid, ask: r.ask, price: r.bid, t: r.t })),
        at: snap.at });
    }
    return res.status(rate ? 429 : 503).json({ error: rate ? 'Batas request FXOpen tercapai' : 'Upstream FXOpen tidak tersedia' });
  }
}
