// api/generate.js
// Analisis Pure SMC dijalankan di server. Tidak memanggil API eksternal.
// Hanya klien terdaftar dan masih aktif yang boleh memakai endpoint ini.

const KV_KEY = 'alu_clients';

const DECIMALS = { XAUUSD: 2, XAGUSD: 3, EURUSD: 5, USDJPY: 3, GBPUSD: 5, BTCUSDT: 2, ETHUSDT: 2, SOLUSDT: 2, XRPUSDT: 4, DJI: 2, DAX: 2 };

const TF_MS = { '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
const TF_LABEL = { '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D1' };

// Harus sama dengan STYLE_TF di index.html
const STYLES = {
  'Scalping':    { label: 'Scalping (HTF: M15 | MTF: M5 | LTF: M1/M3)', entry: '5m',  htf: '15m', mode: 'REACTIVE', expireBars: 0, rr: [1.0, 1.8, 2.8] },
  'Day Trading': { label: 'Day Trading (HTF: H1 | MTF: M30 | LTF: M5)', entry: '30m', htf: '1h',  mode: 'LIMIT',    expireBars: 8, rr: [1.3, 2.5, 4.0] },
  'Intraday':    { label: 'Intraday (HTF: H4 | MTF: H1 | LTF: M15+M5)', entry: '1h',  htf: '4h',  mode: 'LIMIT',    expireBars: 6, rr: [1.5, 3.0, 5.5] },
  'Swing':       { label: 'Swing Trading (HTF: W1 | MTF: H4 | LTF: H1+M15)', entry: '4h', htf: '1d', mode: 'LIMIT', expireBars: 6, rr: [2.0, 4.5, 8.5] },
};

const SL_BUFFER = 0.2;       // buffer SL dalam ATR
const CHASE_MAX = 1.0;       // scalping anti-FOMO: maks jarak harga dari level trigger (ATR)
const RISK_MAX = 3.0;        // scalping: SL maks 3 ATR
const RISK_MIN = 0.5;        // SL minimal 0.5 ATR
const LIMIT_RISK_MAX = 4.0;  // zona fresh: SL maks 4 ATR dari entry
const ZONE_MAX_DIST = 4.0;   // zona fresh maks 4 ATR dari harga
const IMPULSE_MAX_AGE = 80;  // impuls harus masih baru (dalam candle)

const T = (lang, id, en) => (lang === 'en' ? en : id);

// ---------- Akses klien ----------

async function kv(command) {
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || `KV HTTP ${r.status}`);
  return data.result;
}

async function isActiveClient(email) {
  if (!email) return false;
  const raw = await kv(['GET', KV_KEY]);
  const clients = raw ? JSON.parse(raw) : [];
  const c = clients.find(x => x.email === email);
  return !!c && new Date(c.expires_at) > new Date();
}

// ---------- Helper candle ----------

function cleanCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(c => ({ t: Number(c?.t), o: Number(c?.o), h: Number(c?.h), l: Number(c?.l), c: Number(c?.c) }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite))
    .sort((a, b) => a.t - b.t)
    .slice(-200);
}

// Swing terkonfirmasi: high/low yang lebih tinggi/rendah dari n candle di kiri dan kanan
function swings(candles, n = 2) {
  const out = [];
  for (let i = n; i < candles.length - n; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= n; j++) {
      if (candles[i].h <= candles[i - j].h || candles[i].h <= candles[i + j].h) isH = false;
      if (candles[i].l >= candles[i - j].l || candles[i].l >= candles[i + j].l) isL = false;
    }
    if (isH) out.push({ type: 'H', i, price: candles[i].h });
    if (isL) out.push({ type: 'L', i, price: candles[i].l });
  }
  return out;
}

const lastSwing = (sw, type) => {
  for (let k = sw.length - 1; k >= 0; k--) if (sw[k].type === type) return sw[k];
  return null;
};

function atr(candles, period = 14) {
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const s = trs.slice(-period);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
}

// 1 = bullish (HH & HL), -1 = bearish (LH & LL), 0 = belum jelas
function structureDir(candles) {
  const sw = swings(candles, 2);
  const highs = sw.filter(s => s.type === 'H').slice(-2);
  const lows = sw.filter(s => s.type === 'L').slice(-2);
  if (highs.length === 2 && lows.length === 2) {
    if (highs[1].price > highs[0].price && lows[1].price > lows[0].price) return 1;
    if (highs[1].price < highs[0].price && lows[1].price < lows[0].price) return -1;
  }
  const last = candles[candles.length - 1];
  const sh = lastSwing(sw, 'H'), sl = lastSwing(sw, 'L');
  if (sh && last.c > sh.price) return 1;
  if (sl && last.c < sl.price) return -1;
  return 0;
}

// ---------- Rencana entry ----------

// Scalping: entry market mengikuti reaksi (sweep + reclaim, atau break struktur terbaru)
function reactivePlan(candles, dir, price, a) {
  const sw = swings(candles.slice(0, -3), 2);
  const recent = candles.slice(-3);
  const sh = lastSwing(sw, 'H');
  const sl0 = lastSwing(sw, 'L');
  if (!sh || !sl0) return { err: 'Swing high atau low belum terbentuk.' };

  let trigger, level, stop;
  if (dir === 1) {
    const sweep = recent.some(c => c.l < sl0.price) && price > sl0.price;
    const bos = recent.some(c => c.c > sh.price);
    if (!sweep && !bos) return { err: 'Belum ada trigger: sweep low atau break high terbaru.' };
    trigger = sweep ? 'sweep' : 'bos';
    level = sweep ? sl0.price : sh.price;
    if (price - level > CHASE_MAX * a) return { err: 'Harga sudah lari dari level trigger. Tunggu pullback (anti-FOMO).' };
    stop = (sweep ? Math.min(...recent.map(c => c.l)) : sl0.price) - SL_BUFFER * a;
    if (!(stop < price)) return { err: 'SL tidak valid untuk entry market.' };
    if (price - stop > RISK_MAX * a) return { err: 'SL terlalu jauh untuk entry market.' };
    if (price - stop < RISK_MIN * a) stop = price - RISK_MIN * a;
  } else {
    const sweep = recent.some(c => c.h > sh.price) && price < sh.price;
    const bos = recent.some(c => c.c < sl0.price);
    if (!sweep && !bos) return { err: 'Belum ada trigger: sweep high atau break low terbaru.' };
    trigger = sweep ? 'sweep' : 'bos';
    level = sweep ? sh.price : sl0.price;
    if (level - price > CHASE_MAX * a) return { err: 'Harga sudah lari dari level trigger. Tunggu pullback (anti-FOMO).' };
    stop = (sweep ? Math.max(...recent.map(c => c.h)) : sh.price) + SL_BUFFER * a;
    if (!(stop > price)) return { err: 'SL tidak valid untuk entry market.' };
    if (stop - price > RISK_MAX * a) return { err: 'SL terlalu jauh untuk entry market.' };
    if (stop - price < RISK_MIN * a) stop = price + RISK_MIN * a;
  }

  return {
    status: 'RUNNING',
    entry: price,
    sl: stop,
    zone: { min: price - 0.1 * a, max: price + 0.1 * a },
    trigger,
  };
}

// Day, Intraday, Swing: entry di zona FVG atau Order Block yang masih fresh
// dalam impuls terakhir. Zona fresh = belum pernah tersentuh harga sejak terbentuk.
function freshZonePlan(candles, dir, price, a) {
  const n = candles.length;
  const isBuy = dir === 1;
  const sw = swings(candles, 2);

  // Impuls terakhir: BUY = swing low -> swing high, SELL = swing high -> swing low
  let S, E;
  if (isBuy) {
    E = lastSwing(sw, 'H');
    if (!E) return { err: 'Swing high belum terbentuk.' };
    S = null;
    for (let k = sw.length - 1; k >= 0; k--) {
      if (sw[k].type === 'L' && sw[k].i < E.i) { S = sw[k]; break; }
    }
    if (!S) return { err: 'Swing low impuls belum terbentuk.' };
  } else {
    E = lastSwing(sw, 'L');
    if (!E) return { err: 'Swing low belum terbentuk.' };
    S = null;
    for (let k = sw.length - 1; k >= 0; k--) {
      if (sw[k].type === 'H' && sw[k].i < E.i) { S = sw[k]; break; }
    }
    if (!S) return { err: 'Swing high impuls belum terbentuk.' };
  }

  if (n - 1 - S.i > IMPULSE_MAX_AGE) return { err: 'Impuls terlalu lama. Tidak ada zona valid.' };
  if (Math.abs(E.price - S.price) < a) return { err: 'Impuls terlalu kecil.' };

  // Pullback harus belum menembus awal impuls, dan belum membuat extreme baru
  for (let i = E.i + 1; i < n; i++) {
    const c = candles[i];
    if (isBuy ? c.l < S.price : c.h > S.price) return { err: 'Struktur sudah patah. Tidak ada zona valid.' };
    if (isBuy ? c.h > E.price : c.l < E.price) return { err: 'Harga masih membuat extreme baru. Tunggu pullback.' };
  }

  // Kandidat zona di dalam impuls: FVG dan Order Block terakhir
  const zones = [];
  if (isBuy) {
    for (let k = S.i + 2; k <= E.i; k++) {
      const lo = candles[k - 2].h, hi = candles[k].l;
      if (hi > lo) zones.push({ type: 'FVG', lo, hi, from: k });
    }
    for (let j = E.i - 1; j >= S.i; j--) {
      const c = candles[j];
      if (c.c < c.o) { zones.push({ type: 'OB', lo: c.c, hi: c.o, from: j }); break; }
    }
  } else {
    for (let k = S.i + 2; k <= E.i; k++) {
      const lo = candles[k].h, hi = candles[k - 2].l;
      if (hi > lo) zones.push({ type: 'FVG', lo, hi, from: k });
    }
    for (let j = E.i - 1; j >= S.i; j--) {
      const c = candles[j];
      if (c.c > c.o) { zones.push({ type: 'OB', lo: c.o, hi: c.c, from: j }); break; }
    }
  }

  const last = candles[n - 1];

  const isFresh = z => {
    // Harga sudah menembus zona
    if (isBuy ? price < z.lo : price > z.hi) return false;
    // Zona pernah tersentuh sejak terbentuk
    for (let m = z.from + 1; m <= n - 2; m++) {
      if (isBuy ? candles[m].l <= z.hi : candles[m].h >= z.lo) return false;
    }
    const inside = price >= z.lo && price <= z.hi;
    // Candle terakhir sudah menyentuh zona lalu memantul
    if (!inside && (isBuy ? last.l <= z.hi : last.h >= z.lo)) return false;
    // Zona terlalu jauh dari harga
    const dist = isBuy ? price - z.hi : z.lo - price;
    if (!inside && dist > ZONE_MAX_DIST * a) return false;
    return true;
  };

  const build = z => {
    const inZone = price >= z.lo && price <= z.hi;
    const entry = inZone ? price : (z.lo + z.hi) / 2;
    let sl = isBuy ? z.lo - SL_BUFFER * a : z.hi + SL_BUFFER * a;
    let risk = Math.abs(entry - sl);
    if (risk < RISK_MIN * a) {
      sl = isBuy ? entry - RISK_MIN * a : entry + RISK_MIN * a;
      risk = RISK_MIN * a;
    }
    return { z, inZone, entry, sl, risk };
  };

  const candidates = zones
    .filter(isFresh)
    .map(build)
    .filter(p => p.risk <= LIMIT_RISK_MAX * a)
    .sort((x, y) => y.z.from - x.z.from);

  if (!candidates.length) {
    return { err: 'Tidak ada FVG atau Order Block yang masih fresh di impuls terakhir. Tidak ada sinyal.' };
  }

  const p = candidates[0];
  return {
    status: p.inZone ? 'RUNNING' : 'PENDING',
    entry: p.entry,
    sl: p.sl,
    zone: { min: p.z.lo, max: p.z.hi },
    zoneType: p.z.type,
    impulse: { low: Math.min(S.price, E.price), high: Math.max(S.price, E.price) },
  };
}

function buildReason({ lang, style, dir, plan, htfAligned, dec, entryTf }) {
  const f = v => v.toFixed(dec);
  const d = dir === 1 ? 'BUY' : 'SELL';
  const htf = htfAligned ? T(lang, 'searah', 'aligned') : T(lang, 'belum jelas', 'unclear');
  const head = `${d} · ${style.label}.`;

  if (style.mode === 'REACTIVE') {
    const trig = plan.trigger === 'sweep'
      ? T(lang, 'sweep likuiditas lalu reclaim', 'liquidity sweep and reclaim')
      : T(lang, 'break struktur terbaru', 'fresh structure break');
    return `${head} ` + T(
      lang,
      `Entry market di ${f(plan.entry)} setelah ${trig}. Anti-FOMO aktif: harga tidak lebih dari 1 ATR dari level trigger. HTF ${htf}.`,
      `Market entry at ${f(plan.entry)} after ${trig}. Anti-chase active: price within 1 ATR of the trigger level. HTF ${htf}.`
    );
  }

  const tfTxt = TF_LABEL[entryTf];
  const zName = plan.zoneType === 'FVG' ? 'FVG' : 'Order Block';
  const zone = `${f(plan.zone.min)} – ${f(plan.zone.max)}`;
  const action = plan.status === 'RUNNING'
    ? T(lang, `Harga sudah di dalam zona, entry langsung di ${f(plan.entry)}.`, `Price already inside the zone, entry at ${f(plan.entry)}.`)
    : T(
        lang,
        `Entry pending di tengah zona ${f(plan.entry)}, batal jika SL tersentuh atau belum terisi dalam ${style.expireBars} candle ${tfTxt}.`,
        `Pending entry at zone midpoint ${f(plan.entry)}, cancelled if SL is hit or not filled within ${style.expireBars} ${tfTxt} candles.`
      );
  return `${head} ` + T(
    lang,
    `Zona fresh ${zName} ${zone} di impuls ${f(plan.impulse.low)} → ${f(plan.impulse.high)}. ${action} HTF ${htf}.`,
    `Fresh ${zName} zone ${zone} within impulse ${f(plan.impulse.low)} → ${f(plan.impulse.high)}. ${action} HTF ${htf}.`
  );
}

// ---------- Handler ----------

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();
    const lang = body.lang === 'en' ? 'en' : 'id';
    const style = STYLES[body.tradingStyle];
    const symbol = String(body.marketId || '').split('|').pop();
    const dec = DECIMALS[symbol] ?? 4;
    const price = Number(body.currentPrice);

    if (!(await isActiveClient(email))) {
      return res.status(403).json({ error: 'Akses tidak aktif atau email belum terdaftar. Hubungi admin.' });
    }
    if (!style) return res.status(400).json({ error: 'Gaya trading tidak dikenal.' });
    if (!(price > 0)) return res.status(400).json({ error: 'Harga live belum tersedia.' });

    const entryC = cleanCandles(body.candles?.entry);
    const htfC = cleanCandles(body.candles?.htf);
    if (entryC.length < 30 || htfC.length < 20) {
      return res.status(422).json({ error: 'Data candle belum cukup. Tunggu beberapa menit lalu coba lagi.' });
    }

    const none = reason => res.status(200).json({ ok: true, signal: null, reason });

    const a = atr(entryC, 14);
    if (!(a > 0)) return none('Data volatilitas tidak valid.');

    const dir = structureDir(entryC);
    if (dir === 0) {
      return none(T(lang, 'Struktur belum jelas di timeframe entry. Tidak ada sinyal.', 'Structure is unclear on the entry timeframe. No signal.'));
    }

    const htfDir = structureDir(htfC);
    if (htfDir !== 0 && htfDir !== dir) {
      return none(T(lang, 'Arah HTF berlawanan dengan arah entry. Tidak ada sinyal.', 'HTF direction conflicts with entry. No signal.'));
    }

    const plan = style.mode === 'REACTIVE'
      ? reactivePlan(entryC, dir, price, a)
      : freshZonePlan(entryC, dir, price, a);
    if (plan.err) return none(plan.err);

    const entry = plan.entry;
    const risk = Math.abs(entry - plan.sl);
    const r = v => Number(v.toFixed(dec));
    const tps = style.rr.map(x => entry + dir * risk * x);

    const reason = buildReason({
      lang, style, dir, plan, dec,
      htfAligned: htfDir === dir,
      entryTf: style.entry,
    });

    return res.status(200).json({
      ok: true,
      signal: {
        signal: dir === 1 ? 'BUY' : 'SELL',
        mode: style.mode,
        status: plan.status,
        entry: r(entry),
        sl: r(plan.sl),
        tp1: r(tps[0]),
        tp2: r(tps[1]),
        tp3: r(tps[2]),
        zone: plan.zone ? { min: r(plan.zone.min), max: r(plan.zone.max) } : null,
        expireMs: style.mode === 'LIMIT' ? style.expireBars * TF_MS[style.entry] : 0,
        reason,
      },
    });
  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
