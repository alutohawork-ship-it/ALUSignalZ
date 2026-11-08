// api/candles.js
// Riwayat candle untuk grid bias dan loadCandles di frontend.
// Urutan: cache KV (TTL per interval) → TickerLayer (native, atau dibentuk dari 15m) → simpan cache.
// Akses dibatasi: email harus terdaftar dan masih aktif (sama seperti /api/generate).

const KV_KEY = 'alu_clients';
const TICKERLAYER_BASE_URL = 'https://api.tickerlayer.com';

// native : request langsung ke TickerLayer (null = tidak dicoba)
// base   : interval sumber untuk dibentuk ulang bila native gagal atau kurang
// min    : menit per candle
// ttl    : umur cache (detik)
const TF = {
  '5m':  { native: { mult: 5,  span: 'minute' }, base: null,  min: 5,    ttl: 600 },
  '15m': { native: { mult: 15, span: 'minute' }, base: null,  min: 15,   ttl: 900 },
  '30m': { native: null,                         base: '15m', min: 30,   ttl: 900 },
  '1h':  { native: { mult: 1,  span: 'hour' },   base: '15m', min: 60,   ttl: 1800 },
  '4h':  { native: { mult: 4,  span: 'hour' },   base: '15m', min: 240,  ttl: 3600 },
  '1d':  { native: { mult: 1,  span: 'day' },    base: null,  min: 1440, ttl: 7200 },
};

// Jumlah bar yang disimpan per interval.
// 15m dibuat panjang karena dipakai untuk membentuk 30m, 1h, dan 4h.
const BARS = { '5m': 300, '15m': 1600, '30m': 300, '1h': 300, '4h': 300, '1d': 300 };
const MIN_NATIVE = 60; // di bawah ini, coba bentuk ulang dari base

async function kv(command) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || `KV HTTP ${r.status}`);
  return data.result;
}

async function checkAccess(email) {
  if (!email) return { ok: false, msg: 'Sesi tidak punya email. Silakan logout lalu login ulang.' };
  try {
    const raw = await kv(['GET', KV_KEY]);
    if (!raw) return { ok: true };
    const clients = JSON.parse(raw);
    const c = clients.find(x => x.email === email);
    if (!c) return { ok: false, msg: 'Email tidak terdaftar.' };
    if (new Date(c.expires_at) <= new Date()) return { ok: false, msg: 'Masa aktif habis.' };
  } catch (e) {}
  return { ok: true };
}

async function cacheGet(key) {
  try {
    const raw = await kv(['GET', key]);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function cacheSet(key, value, ttl) {
  try {
    await kv(['SET', key, JSON.stringify(value), 'EX', ttl]);
  } catch (e) {}
}

function mapSymbolToTickerLayer(symbol) {
  const s = symbol.toUpperCase().trim();
  if (['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'BNBUSD', 'ADAUSD', 'DOGEUSD', 'AVAXUSD', 'LINKUSD'].includes(s)) {
    return { asset: 'crypto', symbol: s };
  }
  if (s === 'US30' || s === 'SPX500') return { asset: 'stocks', symbol: `US:${s}` };
  if (s === 'NAS100') return { asset: 'stocks', symbol: 'US:NDX' };
  return { asset: 'forex', symbol: s };
}

const isoDate = d => d.toISOString().slice(0, 10);

// Ambil bar dari endpoint range TickerLayer:
// GET /{asset}/agg/{symbol}/{mult}/{span}/{from}/{to}?sort=asc&limit=5000
// Untuk menit, rentang dipecah per 2 hari hanya jika estimasi bar melebihi 4.500.
async function requestBars(symbol, native, bars, apiKey) {
  const mapped = mapSymbolToTickerLayer(symbol);
  const unit = native.span === 'day' ? 1440 : native.span === 'hour' ? 60 : 1;
  const tfMs = native.mult * unit * 60000;
  const now = Date.now();
  const startMs = now - Math.ceil(bars * 1.2 * tfMs) - 86400000;

  const ranges = [];
  if (native.span === 'minute' && (now - startMs) / tfMs > 4500) {
    let to = now + 86400000;
    while (to > startMs) {
      const from = Math.max(startMs, to - 2 * 86400000);
      ranges.push([from, to]);
      to = from;
    }
  } else {
    ranges.push([startMs, now + 86400000]);
  }

  const byT = new Map();
  let status = 'OK';

  await Promise.all(ranges.map(async ([from, to]) => {
    const url = `${TICKERLAYER_BASE_URL}/${mapped.asset}/agg/${mapped.symbol}/${native.mult}/${native.span}/${isoDate(new Date(from))}/${isoDate(new Date(to))}?sort=asc&limit=5000`;
    try {
      const r = await fetch(url, {
        method: 'GET',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      });
      if (!r.ok) { status = `HTTP ${r.status}`; return; }
      const data = await r.json();
      const rows = Array.isArray(data) ? data : (data.results || []);
      for (const c of rows) {
        const t = Number(c.t || 0);
        const o = Number(c.o), h = Number(c.h), l = Number(c.l), cl = Number(c.c);
        if (t > 0 && [o, h, l, cl].every(v => Number.isFinite(v) && v > 0)) {
          byT.set(t, { t, o, h, l, c: cl });
        }
      }
    } catch (e) {
      status = 'ERR';
    }
  }));

  return { bars: [...byT.values()].sort((a, b) => a.t - b.t), status };
}

function aggregateCandles(candles, tfMin) {
  const ms = tfMin * 60000;
  const buckets = new Map();
  for (const c of candles) {
    const b = Math.floor(c.t / ms) * ms;
    const g = buckets.get(b);
    if (!g) {
      buckets.set(b, { t: b, o: c.o, h: c.h, l: c.l, c: c.c });
    } else {
      g.h = Math.max(g.h, c.h);
      g.l = Math.min(g.l, c.l);
      g.c = c.c;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

// Seri candle satu interval: cache dulu, lalu TickerLayer, lalu bentuk dari base bila perlu
async function getSeries(symbol, interval, apiKey) {
  const cfg = TF[interval];
  const key = `candles_${symbol}_${interval}`;

  const hit = await cacheGet(key);
  if (hit !== null) return { candles: hit, src: 'cache' };

  if (!apiKey) return { candles: [], src: 'KEY KOSONG' };

  const notes = [];
  let candles = [];

  if (cfg.native) {
    const nat = await requestBars(symbol, cfg.native, BARS[interval], apiKey);
    candles = nat.bars;
    notes.push(`native ${interval} ${nat.bars.length} (${nat.status})`);
  }

  if (candles.length < MIN_NATIVE && cfg.base) {
    const base = await getSeries(symbol, cfg.base, apiKey);
    const agg = aggregateCandles(base.candles, cfg.min);
    notes.push(`base ${cfg.base} ${base.candles.length} → ${interval} ${agg.length}`);
    if (agg.length > candles.length) candles = agg;
  }

  candles = candles.slice(-BARS[interval]);
  await cacheSet(key, candles, candles.length ? cfg.ttl : 30);
  return { candles, src: notes.join(' · ') };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, candles: [], error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const symbol = String(body.symbol || '').toUpperCase().trim();
    const interval = String(body.interval || '');
    const limit = Math.min(500, Math.max(1, Number(body.limit) || 100));

    if (!symbol || !interval) {
      return res.status(400).json({ ok: false, candles: [], error: 'Symbol dan interval wajib diisi.' });
    }
    if (!TF[interval]) {
      return res.status(400).json({ ok: false, candles: [], error: `Interval ${interval} tidak didukung.` });
    }

    const email = String(body.value || body.email || '').trim().toLowerCase();
    const access = await checkAccess(email);
    if (!access.ok) return res.status(403).json({ ok: false, candles: [], error: access.msg });

    const apiKey = String(process.env.TICKERLAYER_API_KEY || '').trim();
    const series = await getSeries(symbol, interval, apiKey);
    console.log(`candles ${symbol} ${interval}: ${series.candles.length} (${series.src})`);

    return res.status(200).json({ ok: true, candles: series.candles.slice(-limit) });
  } catch (err) {
    console.error('candles api error:', err);
    return res.status(500).json({ ok: false, candles: [], error: err.message });
  }
}
