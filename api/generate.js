// api/generate.js
// Analisis Pure SMC dijalankan di server. Tidak memanggil API eksternal.
// Hanya klien terdaftar dan masih aktif yang boleh memakai endpoint ini.
// Scalping: Eksekusi Market berjalan langsung mengikuti pergerakan market saat ini.

const KV_KEY = 'alu_clients';

const DECIMALS = { XAUUSD: 2, XAGUSD: 3, EURUSD: 5, USDJPY: 3, GBPUSD: 5, BTCUSDT: 2, ETHUSDT: 2, SOLUSDT: 2, XRPUSDT: 4, DJI: 2, DAX: 2 };

// Ukuran 1 pip per simbol. Harus sama dengan MARKETS.pip di index.html
const PIP = { XAUUSD: 0.1, XAGUSD: 0.01, EURUSD: 0.0001, USDJPY: 0.01, GBPUSD: 0.0001, BTCUSDT: 1, ETHUSDT: 0.1, SOLUSDT: 0.01, XRPUSDT: 0.0001, DJI: 1, DAX: 1 };

// Scalping: rentang jarak SL dalam pip [min, max].
const SCALP_SL_PIPS = {
  XAUUSD: [20, 30], XAGUSD: [25, 40],
  EURUSD: [10, 15], GBPUSD: [12, 18], USDJPY: [10, 15],
  BTCUSDT: [150, 250], ETHUSDT: [60, 100],
  SOLUSDT: [40, 70], XRPUSDT: [50, 80],
  DJI: [40, 70], DAX: [40, 70],
};

const DAY_MIN_TP1_PIPS = {
  XAUUSD: 80, XAGUSD: 40,
  EURUSD: 30, USDJPY: 30, GBPUSD: 40,
  BTCUSDT: 300, ETHUSDT: 300, SOLUSDT: 300, XRPUSDT: 300,
  DJI: 150, DAX: 100,
};

const TF_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
const TF_LABEL = { '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D1' };
const KIND_NAME = { OB: 'Order Block', FVG: 'FVG', OTE: 'OTE 62-79%' };
const ROLE_W = { htf: 3, mtf: 2, ltf: 1 };

const STYLES = {
  'Scalping': {
    label: 'Scalping (HTF: M15 | MTF: M5 | LTF: M1/M3)',
    mode: 'MARKET',
    kind: 'scalp',
    tf: { htf: '15m', mtf: '5m' },
    rr: [1, 2, 3],
  },
  'Day Trading': {
    label: 'Day Trading (HTF: H1 | MTF: M30 | LTF: M5)',
    mode: 'LIMIT',
    kind: 'day',
    distW: 2,
    tf: { htf: '1h', mtf: '30m', ltf: '5m' },
    rr: [2, 3, 4],
  },
  'Intraday': {
    label: 'Intraday (HTF: H4 | MTF: H1 | LTF: M15+M5)',
    mode: 'LIMIT',
    kind: 'intraday',
    distW: 1,
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

const SL_BUFFER = 0.2;
const RISK_MIN = 0.5;
const LIMIT_RISK_MAX = 4.0;
const ZONE_MAX_DIST = 4.0;
const IMPULSE_MAX_AGE = 80;
const HOLD_ATR_MIN = 0.5;
const EXPIRE_BARS = 6;
const EXPIRE_MIN_MS = 60 * 60 * 1000;
const EXPIRE_MAX_MS = 48 * 60 * 60 * 1000;
const MIN_CANDLES = 20;

const T = (lang, id, en) => (lang === 'en' ? en : id);
const orderLabel = (dir, orderType) => `${dir === 1 ? 'BUY' : 'SELL'} ${orderType === 'LIMIT' ? 'LIMIT' : 'NOW'}`;
const resolveOrder = plan => plan.orderType || (plan.status === 'PENDING' ? 'LIMIT' : 'NOW');

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
    return { ok: false, msg: 'Email ini tidak ada di daftar klien. Silakan hubungi admin.' };
  }
  if (new Date(c.expires_at) <= new Date()) {
    return { ok: false, msg: `Masa aktif habis pada ${String(c.expires_at).slice(0, 10)}. Hubungi admin.` };
  }
  return { ok: true };
}

function cleanCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(c => ({ t: Number(c?.t), o: Number(c?.o), h: Number(c?.h), l: Number(c?.l), c: Number(c?.c) }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite))
    .sort((a, b) => a.t - b.t)
    .slice(-200);
}

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

// ---------- Scalping Market Execution Logic ----------
function scalpMarketPlan(candles, dir, price, a, htfDir, slFloor, slCap) {
  const isBuy = dir === 1;
  const sw = swings(candles, 2);
  
  // Cari swing terdekat untuk acuan SL struktur
  const anchor = lastSwing(sw, isBuy ? 'L' : 'H');
  let rawStop;
  
  if (anchor) {
    rawStop = isBuy ? anchor.price - (SL_BUFFER * a) : anchor.price + (SL_BUFFER * a);
  } else {
    // Fallback jika swing belum terbentuk sempurna
    rawStop = isBuy ? price - (2 * a) : price + (2 * a);
  }

  // Validasi batas SL floor dan cap
  let risk = Math.abs(price - rawStop);
  if (risk < slFloor) {
    rawStop = isBuy ? price - slFloor : price + slFloor;
    risk = slFloor;
  } else if (risk > slCap) {
    rawStop = isBuy ? price - slCap : price + slCap;
    risk = slCap;
  }

  const flags = [];
  if (htfDir !== 0 && htfDir !== dir) flags.push('HTF_OPPOSITE');

  return {
    status: 'RUNNING',
    orderType: 'NOW',
    mode: 'DIRECT',
    fill: null,
    entry: price,
    sl: rawStop,
    zone: { min: price - (0.1 * a), max: price + (0.1 * a) },
    expireMs: 0,
    flags,
    riskAtr: risk / a,
  };
}

// ---------- Day Trading, Intraday & Swing ----------
function impulseZones(candles, isBuy, a) {
  const sw = swings(candles, 2);
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
  const legs = Math.abs(E.price - S.price);
  if (legs < a) return { err: 'Impuls terlalu kecil.' };

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

  const ote = isBuy
    ? { type: 'OTE', lo: E.price - 0.79 * legs, hi: E.price - 0.62 * legs, from: E.i }
    : { type: 'OTE', lo: E.price + 0.62 * legs, hi: E.price + 0.79 * legs, from: E.i };

  return { S, E, zones, ote, impulse: { low: Math.min(S.price, E.price), high: Math.max(S.price, E.price) } };
}

function bestZonePlan(series, dir, price, refAtr, distW) {
  const isBuy = dir === 1;
  const pool = [];

  for (const s of series) {
    if (!s.candles || s.candles.length < MIN_CANDLES) continue;
    const a = atr(s.candles, 14);
    if (!(a > 0)) continue;
    const imp = impulseZones(s.candles, isBuy, a);
    if (imp.err) continue;

    const n = s.candles.length;
    for (const z of [...imp.zones, imp.ote]) {
      const inside = price >= z.lo && price <= z.hi;
      const beyond = isBuy ? price < z.lo : price > z.hi;
      const edge = isBuy ? z.hi : z.lo;
      const dist = inside ? 0 : Math.abs(price - edge);

      let touches = 0;
      for (let m = z.from + 1; m <= n - 2; m++) {
        if (isBuy ? s.candles[m].l <= z.hi : s.candles[m].h >= z.lo) touches++;
      }

      const recency = Math.max(0, 1 - (n - 1 - z.from) / IMPULSE_MAX_AGE);
      const typeBonus = z.type === 'OB' ? 1 : z.type === 'FVG' ? 0.5 : 0;

      const score = ROLE_W[s.role] * 2 + recency * 2 + typeBonus + (inside ? 3 : 0) - touches * 1.5 - distW * Math.min(dist / a, 5) - (beyond ? 6 : 0);

      pool.push({ z, a, score, inside, beyond, edge, touches, distAtr: dist / a, role: s.role, tf: s.tf, impulse: imp.impulse });
    }
  }

  if (!pool.length) return { err: 'Belum ada impuls yang terbentuk.' };
  pool.sort((x, y) => y.score - x.score);
  const best = pool[0];
  const active = best.inside || best.beyond;
  const entry = active ? price : best.edge;

  let sl = isBuy ? best.z.lo - SL_BUFFER * best.a : best.z.hi + SL_BUFFER * best.a;
  let risk = Math.abs(entry - sl);
  const minRisk = RISK_MIN * refAtr;
  if (risk < minRisk) { sl = isBuy ? entry - minRisk : entry + minRisk; risk = minRisk; }

  return {
    status: active ? 'RUNNING' : 'PENDING',
    orderType: active ? 'NOW' : 'LIMIT',
    entry, sl,
    zone: { min: best.z.lo, max: best.z.hi },
    zoneType: best.z.type,
    zoneRole: best.role,
    zoneTf: best.tf,
    impulse: best.impulse,
    touches: best.touches,
    distAtr: best.distAtr,
    expireMs: expireFor(best.tf),
    score: best.score,
  };
}

function freshZonePlan(candles, dir, price, a, refAtr) {
  const n = candles.length;
  const isBuy = dir === 1;
  const imp = impulseZones(candles, isBuy, a);
  if (imp.err) return imp;
  const { S, E } = imp;

  if (n - 1 - S.i > IMPULSE_MAX_AGE) return { err: 'Impuls terlalu lama.' };
  const minRisk = Math.max(RISK_MIN * a, HOLD_ATR_MIN * refAtr);
  const maxRisk = LIMIT_RISK_MAX * Math.max(a, refAtr);

  const isFresh = z => {
    if (isBuy ? price < z.lo : price > z.hi) return false;
    for (let m = z.from + 1; m <= n - 2; m++) {
      if (isBuy ? candles[m].l <= z.hi : candles[m].h >= z.lo) return false;
    }
    return true;
  };

  const build = z => {
    const inZone = price >= z.lo && price <= z.hi;
    const entry = inZone ? price : (isBuy ? z.hi : z.lo);
    let sl = isBuy ? z.lo - SL_BUFFER * a : z.hi + SL_BUFFER * a;
    let risk = Math.abs(entry - sl);
    if (risk < minRisk) { sl = isBuy ? entry - minRisk : entry + minRisk; }
    return { z, inZone, entry, sl, risk };
  };

  const candidates = imp.zones.filter(isFresh).map(build).filter(p => p.risk <= maxRisk).sort((x, y) => y.z.from - x.z.from);
  if (!candidates.length) return { err: 'Tidak ada zona fresh.' };

  const p = candidates[0];
  return {
    status: p.inZone ? 'RUNNING' : 'PENDING',
    orderType: p.inZone ? 'NOW' : 'LIMIT',
    entry: p.entry, sl: p.sl,
    zone: { min: p.z.lo, max: p.z.hi },
    zoneType: p.z.type,
    touches: 0,
    distAtr: Math.abs(price - p.entry) / a,
    impulse: imp.impulse,
  };
}

function findZone(series, dir, price, refAtr) {
  for (const s of series) {
    if (!s.tf || !s.candles || s.candles.length < MIN_CANDLES) continue;
    const a = atr(s.candles, 14);
    if (!(a > 0)) continue;
    const plan = freshZonePlan(s.candles, dir, price, a, refAtr);
    if (plan.err) continue;
    return { ...plan, zoneRole: s.role, zoneTf: s.tf, expireMs: expireFor(s.tf) };
  }
  return { err: 'Tidak ada zona yang fresh.' };
}

function buildMeta({ lang, style, dir, plan, price, pip, htfDir, mtfDir, refAtr, risk }) {
  const isScalp = style.kind === 'scalp';
  const orderType = resolveOrder(plan);
  const ord = orderLabel(dir, orderType);
  const setup = htfDir === 0 ? 'NEUTRAL' : htfDir === dir ? 'CONTINUATION' : 'REVERSAL';

  const setupLabel = {
    NEUTRAL: T(lang, 'Netral (HTF belum jelas)', 'Neutral (HTF unclear)'),
    CONTINUATION: T(lang, 'Continuation (searah trend HTF)', 'Continuation (with HTF trend)'),
    REVERSAL: T(lang, 'Reversal (melawan trend HTF)', 'Reversal (against HTF trend)'),
  }[setup];

  const riskAtr = risk / refAtr;
  let confidence = 'HIGH';
  let riskCode = riskAtr > 2.5 ? 'HIGH' : 'LOW';

  let zoneLabel, zoneNote;
  if (isScalp) {
    zoneLabel = 'Market Execution M5';
    zoneNote = `${ord} · ${T(lang, 'eksekusi langsung mengikuti struktur M5 berjalan', 'direct execution following active M5 structure')}`;
  } else {
    zoneLabel = `${KIND_NAME[plan.zoneType] || plan.zoneType} ${dir === 1 ? 'Demand' : 'Supply'} ${TF_LABEL[plan.zoneTf] || ''}`.trim();
    zoneNote = `${ord} · area entry zona`;
  }

  return { confidence, risk: riskCode, setup, setupLabel, zoneLabel, zoneNote };
}

function buildReason({ lang, style, dir, plan, dec, htfTxt, meta, slPips, tpPips }) {
  const f = v => v.toFixed(dec);
  const d = dir === 1 ? 'BUY' : 'SELL';
  const head = `${d} · ${style.label}.`;
  const rrTxt = style.rr.map(x => `${x}R`).join(' / ');

  if (style.kind === 'scalp') {
    const pipTxt = tpPips ? ` (${tpPips.join(' / ')} pip)` : '';
    return `${head} Eksekusi langsung (Market Execution) searah struktur M5 di harga ${f(plan.entry)}. SL ${slPips ?? '-'} pip di luar struktur M5. TP ${rrTxt}${pipTxt}. Confidence ${meta.confidence}, risiko ${meta.risk}. HTF ${htfTxt.id}.`;
  }

  return `${head} ${meta.zoneLabel} di harga ${f(plan.entry)}. Target TP ${rrTxt}. Confidence ${meta.confidence}, risiko ${meta.risk}.`;
}

// ---------- Handler Utama ----------
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
    if (!(refAtr > 0)) return res.status(422).json({ error: 'Data volatilitas tidak valid.' });

    const htfDir = structureDir(htfC);
    const mtfDir = structureDir(mtfC);
    const isScalp = style.kind === 'scalp';

    const rng = SCALP_SL_PIPS[symbol];
    const slFloor = isScalp && rng && pip ? rng[0] * pip : RISK_MIN * refAtr;
    const slCap = isScalp && rng && pip ? rng[1] * pip : slFloor * 1.5;

    let dir = 0, plan = null, minTp1Dist = 0;

    if (isScalp) {
      // Tentukan arah berdasarkan struktur M5 berjalan
      dir = structureDir(mtfC);
      if (dir === 0) {
        const sma20 = mtfC.slice(-20).reduce((s, c) => s + c.c, 0) / 20;
        dir = htfDir || (mtfC[mtfC.length - 1].c >= sma20 ? 1 : -1);
      }
      // Langsung buat plan Market Execution
      plan = scalpMarketPlan(mtfC, dir, price, refAtr, htfDir, slFloor, slCap);
    } else {
      const flexible = style.kind === 'day' || style.kind === 'intraday';
      dir = mtfDir;
      if (dir === 0 && flexible) {
        const sma20 = mtfC.slice(-20).reduce((s, c) => s + c.c, 0) / 20;
        dir = htfDir || (mtfC[mtfC.length - 1].c >= sma20 ? 1 : -1);
      }
      if (dir === 0) return none('Struktur belum jelas.');

      const series = [
        { role: 'htf', tf: style.tf?.htf, candles: htfC },
        { role: 'mtf', tf: style.tf?.mtf, candles: mtfC },
        { role: 'ltf', tf: style.tf?.ltf, candles: ltfC },
      ];
      plan = (style.kind === 'day' || style.kind === 'intraday')
        ? bestZonePlan(series, dir, price, refAtr, style.distW)
        : findZone(series, dir, price, refAtr);
      if (plan.err) return none(plan.err);
    }

    const htfTxt = htfDir === 0 ? { id: 'belum jelas', en: 'unclear' } : htfDir === dir ? { id: 'searah', en: 'aligned' } : { id: 'berlawanan', en: 'opposite' };

    const entry = plan.entry;
    const risk = Math.abs(entry - plan.sl);
    const r = v => Number(v.toFixed(dec));

    const tps = style.rr.map(x => entry + dir * risk * x);
    const tpPips = pip ? tps.map(tp => Math.round(Math.abs(tp - entry) / pip)) : null;
    const slPips = pip ? Math.round(risk / pip) : null;

    const meta = buildMeta({ lang, style, dir, plan, price, pip, htfDir, mtfDir, refAtr, risk });
    const reason = buildReason({ lang, style, dir, plan, dec, htfTxt, meta, slPips, tpPips });
    const orderType = resolveOrder(plan);

    return res.status(200).json({
      ok: true,
      signal: {
        signal: dir === 1 ? 'BUY' : 'SELL',
        mode: orderType === 'LIMIT' ? 'LIMIT' : 'MARKET',
        orderType,
        orderLabel: orderLabel(dir, orderType),
        status: plan.status,
        fill: plan.fill || null,
        entry: r(entry),
        sl: r(plan.sl),
        tp1: r(tps[0]),
        tp2: r(tps[1]),
        tp3: r(tps[2]),
        zone: plan.zone ? { min: r(plan.zone.min), max: r(plan.zone.max) } : null,
        zoneTf: plan.zoneTf || null,
        expireMs: plan.status === 'PENDING' ? (plan.expireMs || 0) : 0,
        confidence: meta.confidence,
        risk: meta.risk,
        setup: meta.setup,
        setupLabel: meta.setupLabel,
        zoneLabel: meta.zoneLabel,
        zoneNote: meta.zoneNote,
        reason,
      },
    });
  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
