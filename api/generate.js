// api/generate.js
// Analisis Pure SMC dijalankan di server. Tidak memanggil API eksternal.
// Hanya klien terdaftar dan masih aktif yang boleh memakai endpoint ini.

const KV_KEY = 'alu_clients';

const DECIMALS = { XAUUSD: 2, XAGUSD: 3, EURUSD: 5, USDJPY: 3, GBPUSD: 5, BTCUSDT: 2, ETHUSDT: 2, SOLUSDT: 2, XRPUSDT: 4, DJI: 2, DAX: 2 };

// Ukuran 1 pip per simbol. Harus sama dengan MARKETS.pip di index.html
const PIP = { XAUUSD: 0.1, XAGUSD: 0.01, EURUSD: 0.0001, USDJPY: 0.01, GBPUSD: 0.0001, BTCUSDT: 1, ETHUSDT: 0.1, SOLUSDT: 0.01, XRPUSDT: 0.0001, DJI: 1, DAX: 1 };

// Jarak minimal SL (pip dari entry) untuk Scalping. Sesuaikan per pair.
const SCALP_SL_PIPS = {
  XAUUSD: 30, XAGUSD: 30,
  EURUSD: 25, USDJPY: 25, GBPUSD: 25,
  BTCUSDT: 250, ETHUSDT: 25, SOLUSDT: 100, XRPUSDT: 250,
  DJI: 50, DAX: 50,
};

// Minimal jarak TP1 (pip) untuk Day Trading. Simbol yang tidak ada di sini memakai 1.5 x ATR MTF.
const DAY_MIN_TP1_PIPS = { XAUUSD: 80 };

const TF_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
const TF_LABEL = { '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D1' };

// Harus sama dengan STYLE_TF di index.html
// kind: 'scalp' = entry market searah struktur MTF, SL minimal SCALP_SL_PIPS
//       'day'   = zona terdekat (HTF/MTF/LTF), SL di luar zona, TP1 minimal DAY_MIN_TP1_PIPS
//       'zone'  = zona fresh (perilaku Intraday & Swing)
const STYLES = {
  'Scalping': {
    label: 'Scalping (HTF: M15 | MTF: M5 | LTF: M1/M3)',
    mode: 'MARKET',
    kind: 'scalp',
    tf: { htf: '15m', mtf: '5m' },
    rr: [1.5, 2.5, 3.5],
  },
  'Day Trading': {
    label: 'Day Trading (HTF: H1 | MTF: M30 | LTF: M5)',
    mode: 'LIMIT',
    kind: 'day',
    tf: { htf: '1h', mtf: '30m', ltf: '5m' },
    rr: [1.3, 2.5, 4.0],
  },
  'Intraday': {
    label: 'Intraday (HTF: H4 | MTF: H1 | LTF: M15+M5)',
    mode: 'LIMIT',
    kind: 'zone',
    tf: { htf: '4h', mtf: '1h', ltf: '15m' },
    rr: [1.5, 3.0, 5.5],
  },
  'Swing': {
    label: 'Swing Trading (HTF: D1 | MTF: H4 | LTF: H1)',
    mode: 'LIMIT',
    kind: 'zone',
    tf: { htf: '1d', mtf: '4h', ltf: '1h' },
    rr: [2.0, 4.5, 8.5],
  },
};

const SL_BUFFER = 0.2;                     // buffer SL dalam ATR
const RISK_MAX = 3.0;                      // scalping: batas SL maks dalam ATR
const RISK_MIN = 0.5;                      // SL minimal 0.5 ATR
const LIMIT_RISK_MAX = 4.0;                // zona: SL maks 4 ATR
const ZONE_MAX_DIST = 4.0;                 // zona maks 4 ATR dari harga
const IMPULSE_MAX_AGE = 80;                // impuls harus masih baru (dalam candle)
const HOLD_ATR_MIN = 0.5;                  // SL minimal 0.5 ATR timeframe MTF
const EXPIRE_BARS = 6;                     // pending batal setelah 6 candle timeframe zona
const EXPIRE_MIN_MS = 60 * 60 * 1000;      // minimal 1 jam
const EXPIRE_MAX_MS = 48 * 60 * 60 * 1000; // maksimal 48 jam
const MIN_CANDLES = 20;

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

async function checkAccess(email) {
  if (!email) return { ok: false, msg: 'Sesi tidak punya email. Silakan logout lalu login ulang.' };
  const raw = await kv(['GET', KV_KEY]);
  const clients = raw ? JSON.parse(raw) : [];
  const c = clients.find(x => x.email === email);
  if (!c) {
    return { ok: false, msg: 'Email ini tidak ada di daftar klien. Kalau baru dihapus admin, logout lalu login ulang.' };
  }
  if (new Date(c.expires_at) <= new Date()) {
    return { ok: false, msg: `Masa aktif habis pada ${String(c.expires_at).slice(0, 10)}. Hubungi admin untuk perpanjangan.` };
  }
  return { ok: true };
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

const expireFor = tf => Math.min(Math.max(EXPIRE_BARS * TF_MS[tf], EXPIRE_MIN_MS), EXPIRE_MAX_MS);

// ---------- Rencana entry ----------

// Scalping: entry market searah struktur MTF.
// SL = swing terdekat + buffer, tetapi minimal slFloor (jarak harga dari entry).
// Jika struktur jauh, SL dibatasi cap, tetapi tidak pernah lebih dekat dari slFloor.
function scalpPlan(candles, dir, price, a, slFloor) {
  const sw = swings(candles, 2);
  const recent = candles.slice(-10);
  const cap = Math.max(RISK_MAX * a, slFloor);
  let sl;

  if (dir === 1) {
    const sl0 = lastSwing(sw, 'L');
    const base = sl0 && sl0.price < price ? sl0.price : Math.min(...recent.map(c => c.l));
    let dist = Math.max((price - base) + SL_BUFFER * a, slFloor);
    dist = Math.min(dist, cap);
    sl = price - dist;
  } else {
    const sh0 = lastSwing(sw, 'H');
    const base = sh0 && sh0.price > price ? sh0.price : Math.max(...recent.map(c => c.h));
    let dist = Math.max((base - price) + SL_BUFFER * a, slFloor);
    dist = Math.min(dist, cap);
    sl = price + dist;
  }

  return {
    status: 'RUNNING',
    entry: price,
    sl,
    zone: { min: price - 0.1 * a, max: price + 0.1 * a },
    trigger: 'market',
  };
}

// Zona fresh (FVG atau Order Block) di impuls terakhir pada satu timeframe.
// a = ATR timeframe zona, refAtr = ATR timeframe MTF.
// Jika harga di dalam zona: status RUNNING, entry = harga sekarang.
// Jika belum: status PENDING (waiting zone), entry = tepi zona yang lebih dulu disentuh harga.
// opts.all = true -> kembalikan semua kandidat.
function freshZonePlan(candles, dir, price, a, refAtr, opts = {}) {
  const n = candles.length;
  const isBuy = dir === 1;
  const sw = swings(candles, 2);

  // Impuls terakhir: BUY = swing low -> swing high, SELL = swing high -> swing low
  let S = null, E;
  if (isBuy) {
    E = lastSwing(sw, 'H');
    if (!E) return { err: 'Swing high belum terbentuk.' };
    for (let k = sw.length - 1; k >= 0; k--) {
      if (sw[k].type === 'L' && sw[k].i < E.i) { S = sw[k]; break; }
    }
    if (!S) return { err: 'Swing low impuls belum terbentuk.' };
  } else {
    E = lastSwing(sw, 'L');
    if (!E) return { err: 'Swing low belum terbentuk.' };
    for (let k = sw.length - 1; k >= 0; k--) {
      if (sw[k].type === 'H' && sw[k].i < E.i) { S = sw[k]; break; }
    }
    if (!S) return { err: 'Swing high impuls belum terbentuk.' };
  }

  if (n - 1 - S.i > IMPULSE_MAX_AGE) return { err: 'Impuls terlalu lama.' };
  if (Math.abs(E.price - S.price) < a) return { err: 'Impuls terlalu kecil.' };

  // Pullback belum menembus awal impuls dan belum membuat extreme baru
  for (let i = E.i + 1; i < n; i++) {
    const c = candles[i];
    if (isBuy ? c.l < S.price : c.h > S.price) return { err: 'Struktur sudah patah.' };
    if (isBuy ? c.h > E.price : c.l < E.price) return { err: 'Masih membuat extreme baru, tunggu pullback.' };
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
  const maxDist = ZONE_MAX_DIST * a;
  const minRisk = Math.max(RISK_MIN * a, HOLD_ATR_MIN * refAtr);
  const maxRisk = LIMIT_RISK_MAX * Math.max(a, refAtr);

  const isFresh = z => {
    if (isBuy ? price < z.lo : price > z.hi) return false;
    for (let m = z.from + 1; m <= n - 2; m++) {
      if (isBuy ? candles[m].l <= z.hi : candles[m].h >= z.lo) return false;
    }
    const inside = price >= z.lo && price <= z.hi;
    if (!inside && (isBuy ? last.l <= z.hi : last.h >= z.lo)) return false;
    const dist = isBuy ? price - z.hi : z.lo - price;
    if (!inside && dist > maxDist) return false;
    return true;
  };

  const build = z => {
    const inZone = price >= z.lo && price <= z.hi;
    const entry = inZone ? price : (isBuy ? z.hi : z.lo);
    let sl = isBuy ? z.lo - SL_BUFFER * a : z.hi + SL_BUFFER * a;
    let risk = Math.abs(entry - sl);
    if (risk < minRisk) {
      sl = isBuy ? entry - minRisk : entry + minRisk;
      risk = minRisk;
    }
    return { z, inZone, entry, sl, risk };
  };

  const candidates = zones
    .filter(isFresh)
    .map(build)
    .filter(p => p.risk <= maxRisk)
    .sort((x, y) => y.z.from - x.z.from);

  if (!candidates.length) return { err: 'Tidak ada zona fresh di timeframe ini.' };

  const toPlan = p => ({
    status: p.inZone ? 'RUNNING' : 'PENDING',
    entry: p.entry,
    sl: p.sl,
    zone: { min: p.z.lo, max: p.z.hi },
    zoneType: p.z.type,
    impulse: { low: Math.min(S.price, E.price), high: Math.max(S.price, E.price) },
    atr: a,
  });

  if (opts.all) return { candidates: candidates.map(toPlan) };
  return toPlan(candidates[0]);
}

// Day Trading: kumpulkan zona fresh dari HTF, MTF, dan LTF, lalu pilih yang paling dekat dengan harga.
// Zona yang sudah berisi harga (RUNNING) dianggap paling dekat.
function dayPlan(series, dir, price, refAtr) {
  const pool = [];
  for (const s of series) {
    if (!s.candles || s.candles.length < MIN_CANDLES) continue;
    const a = atr(s.candles, 14);
    if (!(a > 0)) continue;
    const r = freshZonePlan(s.candles, dir, price, a, refAtr, { all: true });
    if (r.err) continue;
    for (const p of r.candidates) {
      pool.push({ ...p, zoneRole: s.role, zoneTf: s.tf, expireMs: expireFor(s.tf) });
    }
  }
  if (!pool.length) return { err: 'Tidak ada zona FVG atau Order Block yang fresh di HTF, MTF, maupun LTF.' };

  const dist = p => p.status === 'RUNNING'
    ? 0
    : Math.min(Math.abs(price - p.zone.min), Math.abs(price - p.zone.max));
  pool.sort((x, y) => dist(x) - dist(y));
  return pool[0];
}

// Intraday & Swing: cari zona fresh berurutan HTF -> MTF -> LTF
function findZone(series, dir, price, refAtr) {
  for (const s of series) {
    if (!s.tf || !s.candles || s.candles.length < MIN_CANDLES) continue;
    const a = atr(s.candles, 14);
    if (!(a > 0)) continue;
    const plan = freshZonePlan(s.candles, dir, price, a, refAtr);
    if (plan.err) continue;
    return {
      ...plan,
      zoneRole: s.role,
      zoneTf: s.tf,
      expireMs: expireFor(s.tf),
    };
  }
  return { err: 'Tidak ada zona FVG atau Order Block yang fresh di HTF, MTF, maupun LTF. Tidak ada sinyal.' };
}

function durText(ms, lang) {
  const m = Math.round(ms / 60000);
  if (m >= 60) {
    const h = Math.round((m / 60) * 10) / 10;
    return T(lang, `${h} jam`, `${h} hour${h === 1 ? '' : 's'}`);
  }
  return T(lang, `${m} menit`, `${m} minute${m === 1 ? '' : 's'}`);
}

function buildReason({ lang, style, dir, plan, htfAligned, dec, slPips, minTp1Pips }) {
  const f = v => v.toFixed(dec);
  const d = dir === 1 ? 'BUY' : 'SELL';
  const htf = htfAligned ? T(lang, 'searah', 'aligned') : T(lang, 'belum jelas', 'unclear');
  const head = `${d} · ${style.label}.`;

  if (style.kind === 'scalp') {
    return `${head} ` + T(
      lang,
      `Entry market di ${f(plan.entry)} searah struktur MTF. SL ${slPips} pip dari entry, TP1 minimal ${minTp1Pips} pip. HTF ${htf}.`,
      `Market entry at ${f(plan.entry)} following MTF structure. SL ${slPips} pips from entry, TP1 at least ${minTp1Pips} pips. HTF ${htf}.`
    );
  }

  const tfTxt = TF_LABEL[plan.zoneTf];
  const zName = plan.zoneType === 'FVG' ? 'FVG' : 'Order Block';
  const zone = `${f(plan.zone.min)} – ${f(plan.zone.max)}`;

  const fbId = plan.zoneRole === 'mtf' ? 'Zona diambil dari MTF. '
    : plan.zoneRole === 'ltf' ? 'Zona diambil dari LTF. ' : '';
  const fbEn = plan.zoneRole === 'mtf' ? 'Zone taken from MTF. '
    : plan.zoneRole === 'ltf' ? 'Zone taken from LTF. ' : '';

  const action = plan.status === 'RUNNING'
    ? T(lang, `Harga sudah di dalam zona, status aktif, entry di ${f(plan.entry)}.`, `Price already inside the zone, status running, entry at ${f(plan.entry)}.`)
    : T(
        lang,
        `Status waiting zone: entry limit di tepi zona ${f(plan.entry)}, aktif saat harga masuk zona. Batal jika SL atau TP1 tersentuh lebih dulu, atau belum masuk dalam ${durText(plan.expireMs, lang)}.`,
        `Waiting zone: limit entry at zone edge ${f(plan.entry)}, active once price enters the zone. Cancelled if SL or TP1 is hit first, or not filled within ${durText(plan.expireMs, lang)}.`
      );

  const tp1Txt = style.kind === 'day' && minTp1Pips
    ? T(lang, ` TP1 minimal ${minTp1Pips} pip.`, ` TP1 at least ${minTp1Pips} pips.`)
    : '';

  return `${head} ` + T(
    lang,
    `${fbId}Zona ${zName} ${tfTxt} ${zone} di impuls ${f(plan.impulse.low)} → ${f(plan.impulse.high)}. ${action}${tp1Txt} HTF ${htf}.`,
    `${fbEn}${zName} ${tfTxt} zone ${zone} within impulse ${f(plan.impulse.low)} → ${f(plan.impulse.high)}. ${action}${tp1Txt} HTF ${htf}.`
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
    const pip = PIP[symbol];

    const access = await checkAccess(email);
    if (!access.ok) return res.status(403).json({ error: access.msg });
    if (!style) return res.status(400).json({ error: 'Gaya trading tidak dikenal.' });
    if (!(price > 0)) return res.status(400).json({ error: 'Harga live belum tersedia.' });

    const cnd = body.candles || {};
    const htfC = cleanCandles(cnd.htf);
    const mtfC = cleanCandles(cnd.mtf ?? cnd.entry);
    const ltfC = cleanCandles(cnd.ltf);
    if (mtfC.length < 30 || htfC.length < 20) {
      return res.status(422).json({ error: 'Data candle belum cukup. Tunggu beberapa menit lalu coba lagi.' });
    }

    const none = reason => res.status(200).json({ ok: true, signal: null, reason });

    const refAtr = atr(mtfC, 14);
    if (!(refAtr > 0)) return none('Data volatilitas tidak valid.');

    // Arah ditentukan dari struktur MTF
    const dir = structureDir(mtfC);
    if (dir === 0) {
      return none(T(lang, 'Struktur belum jelas di timeframe MTF. Tidak ada sinyal.', 'Structure is unclear on the MTF. No signal.'));
    }

    const htfDir = structureDir(htfC);
    if (htfDir !== 0 && htfDir !== dir) {
      return none(T(lang, 'Arah HTF berlawanan dengan arah entry. Tidak ada sinyal.', 'HTF direction conflicts with entry. No signal.'));
    }

    // SL minimal untuk Scalping (harga)
    const slFloor = style.kind === 'scalp'
      ? (SCALP_SL_PIPS[symbol] && pip ? SCALP_SL_PIPS[symbol] * pip : RISK_MIN * refAtr)
      : 0;

    // Jarak minimal TP1 (harga)
    let minTp1Dist = 0;
    if (style.kind === 'scalp') {
      minTp1Dist = 1.5 * slFloor;
    } else if (style.kind === 'day') {
      minTp1Dist = DAY_MIN_TP1_PIPS[symbol] && pip ? DAY_MIN_TP1_PIPS[symbol] * pip : 1.5 * refAtr;
    }

    let plan;
    if (style.kind === 'scalp') {
      plan = scalpPlan(mtfC, dir, price, refAtr, slFloor);
    } else if (style.kind === 'day') {
      plan = dayPlan([
        { role: 'htf', tf: style.tf.htf, candles: htfC },
        { role: 'mtf', tf: style.tf.mtf, candles: mtfC },
        { role: 'ltf', tf: style.tf.ltf, candles: ltfC },
      ], dir, price, refAtr);
    } else {
      plan = findZone([
        { role: 'htf', tf: style.tf.htf, candles: htfC },
        { role: 'mtf', tf: style.tf.mtf, candles: mtfC },
        { role: 'ltf', tf: style.tf.ltf, candles: ltfC },
      ], dir, price, refAtr);
    }
    if (plan.err) return none(plan.err);

    const entry = plan.entry;
    const risk = Math.abs(entry - plan.sl);
    const r = v => Number(v.toFixed(dec));

    // TP: rasio RR biasa, tapi TP1 dipaksa minimal minTp1Dist. TP2/TP3 ikut proporsi.
    const tps = style.rr.map(x => entry + dir * Math.max(risk * x, minTp1Dist * (x / style.rr[0])));

    const reason = buildReason({
      lang, style, dir, plan, dec,
      htfAligned: htfDir === dir,
      slPips: pip ? Math.round(risk / pip) : null,
      minTp1Pips: pip && minTp1Dist ? Math.round(minTp1Dist / pip) : null,
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
        zoneTf: plan.zoneTf || null,
        expireMs: plan.status === 'PENDING' ? (plan.expireMs || 0) : 0,
        reason,
      },
    });
  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
