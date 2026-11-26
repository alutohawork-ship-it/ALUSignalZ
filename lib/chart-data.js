// lib/chart-data.js — Fallback chain: API → XBTFX → localStorage cache → agregasi
const LS_KEY = 'candles_v1_';
const TTL = { '1m': 60e3, '5m': 120e3, '15m': 180e3, '1h': 300e3, '4h': 600e3 };
const MINS = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 };
const LOWER = { '5m': '1m', '15m': '5m', '1h': '15m', '4h': '1h' };

const cooldown = {};
const inCd = ep => (cooldown[ep] || 0) > Date.now();
const setCd = (ep, ms) => { cooldown[ep] = Date.now() + ms; };

const lsGet = k => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

async function tryFetch(url, opts, ep, tries = 2) {
  for (let i = 0; i < tries; i++) {
    if (inCd(ep)) return null;
    try {
      const r = await fetch(url, opts);
      if (r.status === 429) {
        const ra = Number(r.headers.get('retry-after')) || 30;
        setCd(ep, Math.min(ra, 120) * 1000 * (i + 1)); // backoff bertingkat
        continue;
      }
      if (r.ok) return await r.json();
    } catch {}
  }
  return null;
}

function aggregate(rows, bucketMin) {
  const bms = bucketMin * 60000;
  const map = new Map();
  for (const r of rows) {
    const bt = Math.floor(r.t / bms) * bms;
    const b = map.get(bt);
    if (!b) map.set(bt, { t: bt, o: r.o, h: r.h, l: r.l, c: r.c });
    else { b.h = Math.max(b.h, r.h); b.l = Math.min(b.l, r.l); b.c = r.c; }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

export async function loadCandles(symbol, tf, limit, email) {
  const ck = LS_KEY + symbol + '_' + tf;
  const cached = lsGet(ck);

  // 1) Proxy backend (rotasi key TickerLayer + stale-cache saat 429)
  if (!inCd('api')) {
    const j = await tryFetch('/api/candles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, interval: tf, limit, value: email || '' }),
    }, 'api');
    if (j && j.ok && Array.isArray(j.candles) && j.candles.length) {
      lsSet(ck, { t: Date.now(), rows: j.candles });
      return { rows: j.candles, source: j.source || 'api', stale: !!j.stale };
    }
  }

  // 2) Cache localStorage (fresh)
  if (cached && cached.rows && cached.rows.length && (Date.now() - cached.t) < (TTL[tf] || 60e3)) {
    return { rows: cached.rows, source: 'local', stale: false };
  }

  // 3) Agregasi dari TF lebih kecil yang ada di cache
  const low = LOWER[tf];
  if (low) {
    const lc = lsGet(LS_KEY + symbol + '_' + low);
    const need = limit * (MINS[tf] / MINS[low]);
    if (lc && lc.rows && lc.rows.length >= need) {
      const agg = aggregate(lc.rows, MINS[tf]).slice(-limit);
      if (agg.length) {
        lsSet(ck, { t: Date.now(), rows: agg });
        return { rows: agg, source: 'derived', stale: false };
      }
    }
  }

  // 4) Cache localStorage (stale) — lebih baik daripada kosong
  if (cached && cached.rows && cached.rows.length) {
    return { rows: cached.rows, source: 'local-stale', stale: true };
  }

  return { rows: [], source: 'none', stale: true };
}
