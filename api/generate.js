// api/generate.js
// Analisis Pure SMC dijalankan di server. Tidak memanggil API eksternal.
// Hanya klien terdaftar dan masih aktif yang boleh memakai endpoint ini.

const KV_KEY = 'alu_clients';

const DECIMALS = {
  XAUUSD: 2, XAGUSD: 3, EURUSD: 5, USDJPY: 3, GBPUSD: 5, DJI: 2,
  AUDUSD: 5, USDCAD: 5, USDCHF: 5,
  CLUSDT: 2, NATGASUSDT: 3, COPPERUSDT: 4, XPDUSDT: 2, XPTUSDT: 2,
  BRENTOIL: 2, PALLADIUM: 2, PLATINUM: 2, SP500: 2, XYZ100: 2, JP225: 0, QQQUSDT: 2,
  BTCUSDT: 2, ETHUSDT: 2, SOLUSDT: 2, XRPUSDT: 4, BNBUSDT: 2, ADAUSDT: 4,
  LINKUSDT: 3, AVAXUSDT: 3, DOGEUSDT: 5, SUIUSDT: 4, NEARUSDT: 4, DOTUSDT: 4,
  LTCUSDT: 2, TAOUSDT: 2, HYPEUSDT: 2,
  BTCUSD: 2, ETHUSD: 2,
};

const PIP = {
  XAUUSD: 0.1, XAGUSD: 0.01, EURUSD: 0.0001, USDJPY: 0.01, GBPUSD: 0.0001, DJI: 1,
  AUDUSD: 0.0001, USDCAD: 0.0001, USDCHF: 0.0001,
  CLUSDT: 0.01, NATGASUSDT: 0.001, COPPERUSDT: 0.0001, XPDUSDT: 0.1, XPTUSDT: 0.1,
  BRENTOIL: 0.01, PALLADIUM: 0.1, PLATINUM: 0.1, SP500: 1, XYZ100: 1, JP225: 1, QQQUSDT: 0.1,
  BTCUSDT: 1, ETHUSDT: 0.1, SOLUSDT: 0.01, XRPUSDT: 0.0001, BNBUSDT: 0.1, ADAUSDT: 0.0001,
  LINKUSDT: 0.001, AVAXUSDT: 0.001, DOGEUSDT: 0.00001, SUIUSDT: 0.0001, NEARUSDT: 0.0001,
  DOTUSDT: 0.0001, LTCUSDT: 0.01, TAOUSDT: 0.01, HYPEUSDT: 0.01,
  BTCUSD: 1, ETHUSD: 0.1,
};

const SCALP_SL_PIPS = {
  XAUUSD: [20, 30], XAGUSD: [25, 40],
  EURUSD: [10, 15], GBPUSD: [12, 18], USDJPY: [10, 15],
  AUDUSD: [10, 15], USDCAD: [10, 15], USDCHF: [10, 15],
  CLUSDT: [8, 15], NATGASUSDT: [10, 20], COPPERUSDT: [30, 50], XPDUSDT: [20, 35], XPTUSDT: [20, 30],
  BRENTOIL: [8, 15], PALLADIUM: [20, 35], PLATINUM: [20, 30],
  SP500: [15, 30], XYZ100: [25, 45], JP225: [20, 40], QQQUSDT: [15, 30],
  BTCUSDT: [150, 250], ETHUSDT: [60, 100], SOLUSDT: [40, 70], XRPUSDT: [50, 80],
  BNBUSDT: [15, 30], ADAUSDT: [6, 12], LINKUSDT: [25, 40], AVAXUSDT: [25, 40],
  DOGEUSDT: [25, 45], SUIUSDT: [20, 35], NEARUSDT: [50, 90], DOTUSDT: [30, 60],
  LTCUSDT: [20, 35], TAOUSDT: [40, 70], HYPEUSDT: [20, 35],
  BTCUSD: [150, 250], ETHUSD: [60, 100],
};

const SCALP_OVER_CAP = 'FLAG';
const DAY_PSY_STEP = {
  XAUUSD: 50, XAGUSD: 1, EURUSD: 0.005, USDJPY: 0.5, GBPUSD: 0.005,
  AUDUSD: 0.005, USDCAD: 0.005, USDCHF: 0.005,
  CLUSDT: 5, NATGASUSDT: 0.5, COPPERUSDT: 0.1, XPDUSDT: 50, XPTUSDT: 50,
  BRENTOIL: 5, PALLADIUM: 50, PLATINUM: 50, SP500: 100, XYZ100: 500, JP225: 500, QQQUSDT: 5,
  BTCUSDT: 1000, ETHUSDT: 100, SOLUSDT: 10, XRPUSDT: 0.1, BNBUSDT: 10, ADAUSDT: 0.05,
  LINKUSDT: 0.5, AVAXUSDT: 0.5, DOGEUSDT: 0.01, SUIUSDT: 0.1, NEARUSDT: 0.1, DOTUSDT: 0.5,
  LTCUSDT: 5, TAOUSDT: 5, HYPEUSDT: 1, DJI: 500,
  BTCUSD: 1000, ETHUSD: 100,
};

const DAY_ZONE_MIN_LEG_ATR = 1.2;
const DAY_FAR_ATR = 2.0;
const DAY_NEAR_ATR = 1.0;
const DAY_MAX_DIST_ATR = 5.0;
const DAY_SL_MIN_ATR = 0.8;
const DAY_SL_MAX_ATR = 2.5;
const DAY_LIMIT_EXPIRE_MS = 90 * 60 * 1000;

const HR_PULLBACK_MIN = 0.236;
const HR_PULLBACK_MAX = 0.786;
const HR_SWING_AGE_M5 = 30;
const HR_SWING_AGE_M1 = 60;
const HR_MAX_SPIKE_ATR = 2.5;
const HR_MAX_CHASE_ATR = 3.5;

const TF_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
const TF_LABEL = { '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D1' };
const KIND_NAME = { OB: 'Order Block', FVG: 'FVG', OTE: 'OTE 62-79%', FALLBACK: 'Swing' };
const ROLE_W = { htf: 3, mtf: 2, ltf: 1 };

const STYLES = {
  'Scalping': { label: 'Scalping Hit & Run (Buffer Zone + MTF)', mode: 'MARKET', kind: 'scalp', tf: { htf: '15m', mtf: '5m', ltf: '1m' }, rr: [1, 2, 3] },
  'Day Trading': { label: 'Day Trading Zone (HTF: H1 | MTF: M30)', mode: 'MARKET', kind: 'day', tf: { htf: '1h', mtf: '30m', ltf: '5m' }, rr: [1.5, 2, 3] },
  'Intraday': { label: 'Intraday (HTF: H4 | MTF: H1)', mode: 'LIMIT', kind: 'intraday', distW: 1, tf: { htf: '4h', mtf: '1h', ltf: '15m' }, rr: [1.5, 3.0, 5.5] },
  'Swing': { label: 'Swing Trading (HTF: D1 | MTF: H4)', mode: 'LIMIT', kind: 'zone', tf: { htf: '1d', mtf: '4h', ltf: '1h' }, rr: [2.0, 4.5, 8.5] },
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

const FLAG_TXT = {
  WIDE_SL: ['SL melebihi 2,5 ATR M15, risiko tinggi', 'SL above 2.5 ATR M15, high risk'],
  NO_TRIGGER: ['belum ada konfirmasi M5, entry mengikuti zona', 'no M5 confirmation yet, entry follows zone'],
  PSY_NONE: ['tidak ada level psikologi dalam rentang, TP3 memakai 3R', 'no psychological level in range, TP3 uses 3R'],
};

async function kv(command) {
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
  const raw = await kv(['GET', KV_KEY]);
  const clients = raw ? JSON.parse(raw) : [];
  const c = clients.find(x => x.email === email);
  if (!c) return { ok: false, msg: 'Email tidak terdaftar.' };
  if (new Date(c.expires_at) <= new Date()) return { ok: false, msg: 'Masa aktif habis.' };
  return { ok: true };
}

function cleanCandles(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(c => ({ t: Number(c?.t), o: Number(c?.o), h: Number(c?.h), l: Number(c?.l), c: Number(c?.c) }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite)).sort((a, b) => a.t - b.t).slice(-200);
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

function impulseZones(candles, isBuy, a) {
  const sw = swings(candles, 2);
  let S = null, E;
  if (isBuy) {
    E = lastSwing(sw, 'H');
    if (!E) return { err: 'Swing high belum terbentuk.' };
    for (let k = sw.length - 1; k >= 0; k--) { if (sw[k].type === 'L' && sw[k].i < E.i) { S = sw[k]; break; } }
    if (!S) return { err: 'Swing low impuls belum terbentuk.' };
  } else {
    E = lastSwing(sw, 'L');
    if (!E) return { err: 'Swing low belum terbentuk.' };
    for (let k = sw.length - 1; k >= 0; k--) { if (sw[k].type === 'H' && sw[k].i < E.i) { S = sw[k]; break; } }
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

function hrLeg(candles, isBuy, maxAge) {
  const n = candles.length;
  const sw = swings(candles, 2).filter(s => n - 1 - s.i <= maxAge);
  const type = isBuy ? 'L' : 'H';
  const anchor = lastSwing(sw, type);
  if (!anchor) return null;

  let ext = anchor.i;
  for (let i = anchor.i + 1; i < n; i++) {
    if (isBuy ? candles[i].h > candles[ext].h : candles[i].l < candles[ext].l) ext = i;
  }
  if (ext === anchor.i) return null;

  return isBuy ? { low: anchor.price, high: candles[ext].h, extIdx: ext } : { low: candles[ext].l, high: anchor.price, extIdx: ext };
}

function hrSetup(candles, isBuy, maxAge) {
  const leg = hrLeg(candles, isBuy, maxAge);
  if (!leg) return null;

  const n = candles.length;
  const size = leg.high - leg.low;
  if (!(size > 0) || leg.extIdx >= n - 1) return null;

  let di = leg.extIdx + 1;
  for (let i = di; i < n; i++) {
    if (isBuy ? candles[i].l < candles[di].l : candles[i].h > candles[di].h) di = i;
  }
  if (di >= n - 1) return null;

  const deep = isBuy ? candles[di].l : candles[di].h;
  if (isBuy ? deep <= leg.low : deep >= leg.high) return null;

  const depth = isBuy ? (leg.high - deep) / size : (deep - leg.low) / size;
  if (depth < HR_PULLBACK_MIN || depth > HR_PULLBACK_MAX) return null;

  return { leg, deep, deepIdx: di, depth };
}

function hrTrigger(candles, pb, isBuy, a) {
  const n = candles.length;
  const last = candles[n - 1];

  let micro = null;
  for (let i = pb.deepIdx; i <= n - 2; i++) {
    const v = isBuy ? candles[i].h : candles[i].l;
    if (micro === null || (isBuy ? v > micro : v < micro)) micro = v;
  }
  if (micro === null) return null;

  const broke = isBuy ? last.c > micro : last.c < micro;
  if (!broke) return null;

  const spike = (last.h - last.l) / a;
  if (spike > HR_MAX_SPIKE_ATR) return null;

  return { level: micro, spike };
}

function scalpSlFrom(bufferEnd, rawStop, isBuy, a, slFloor, slCap) {
  let stop = rawStop;
  let risk = Math.abs(bufferEnd - stop);
  if (risk < slFloor) {
    stop = isBuy ? bufferEnd - slFloor : bufferEnd + slFloor;
    risk = slFloor;
  }
  let over = false, rawRiskAtr = null;
  if (risk > slCap) {
    over = true;
    rawRiskAtr = risk / a;
    if (SCALP_OVER_CAP === 'CAP') {
      stop = isBuy ? bufferEnd - slCap : bufferEnd + slCap;
      risk = slCap;
    }
  }
  return { stop, risk, over, rawRiskAtr };
}

function scalpHitRun(mtfC, ltfC, htfDir, price, a, slFloor, slCap, pip) {
  const dir = structureDir(mtfC);
  if (dir === 0) return { err: ['Struktur M5 belum jelas.', 'M5 structure unclear.'] };
  
  // Jika masuk ke zona day trade / HTF, struktur mengikuti zona HTF langsung
  const activeDir = htfDir !== 0 ? htfDir : dir;
  const isBuy = activeDir === 1;

  const m5 = hrSetup(mtfC, isBuy, HR_SWING_AGE_M5);
  if (!m5) return { err: ['Belum ada pullback M5 yang sehat.', 'No healthy M5 pullback.'] };

  let trig, trigSrc;
  if (ltfC.length >= 30) {
    const la = atr(ltfC, 14);
    const m1 = la > 0 ? hrSetup(ltfC, isBuy, HR_SWING_AGE_M1) : null;
    trig = m1 ? hrTrigger(ltfC, m1, isBuy, la) : null;
    trigSrc = 'M1';
  } else {
    trig = hrTrigger(mtfC, m5, isBuy, a);
    trigSrc = 'M5';
  }
  if (!trig) return { err: [`Menunggu konfirmasi ${trigSrc}.`, `Waiting for ${trigSrc}.`] };

  // Buffer Zone Calculation for Aggressive Scalping (misal 20-30 pip buffer zone dari harga sekarang)
  const bufferRange = (pip || (a * 0.1)) * 15; // Lebar buffer zone dinamis
  const bufferEnd = isBuy ? price - bufferRange : price + bufferRange;

  const stopRaw = isBuy ? bufferEnd - SL_BUFFER * a : bufferEnd + SL_BUFFER * a;
  const s = scalpSlFrom(bufferEnd, stopRaw, isBuy, a, slFloor, slCap);

  return {
    dir: activeDir,
    plan: {
      kind: 'hitrun',
      orderType: 'NOW',
      mode: 'DIRECT',
      fill: null,
      entry: price,
      bufferEnd: bufferEnd, // Garis buffer zone kedua
      status: 'RUNNING',
      sl: s.stop,
      zone: { min: Math.min(price, bufferEnd), max: Math.max(price, bufferEnd) },
      mid: price,
      trigger: 'bos',
      trigSrc,
      expireMs: 0,
      distAtr: Math.abs(price - m5.deep) / a,
      touches: 0,
      zoneType: null,
      flags: [],
      over: s.over,
      rawRiskAtr: s.rawRiskAtr,
      riskAtr: Math.abs(bufferEnd - s.stop) / a,
      pullbackDepth: m5.depth,
    },
  };
}

function aggregateM15(m5) {
  const out = [];
  const start = m5.length % 3;
  for (let i = start; i + 2 < m5.length; i += 3) {
    const g = m5.slice(i, i + 3);
    out.push({ t: g[0].t, o: g[0].o, h: Math.max(...g.map(c => c.h)), l: Math.min(...g.map(c => c.l)), c: g[2].c });
  }
  return out;
}

function m5Trigger(m5C, isBuy) {
  const n = m5C.length;
  if (n < 3) return false;
  const last = m5C[n - 1], prev = m5C[n - 2];
  return isBuy ? last.c > prev.h : last.c < prev.l;
}

function dayCollectZones(series) {
  const out = [];
  for (const s of series) {
    const a = atr(s.candles, 14);
    if (!(a > 0)) continue;
    const n = s.candles.length;
    const last = s.candles[n - 1];
    for (const isBuy of [true, false]) {
      const imp = impulseZones(s.candles, isBuy, a);
      if (imp.err) continue;
      const legAtr = Math.abs(imp.E.price - imp.S.price) / a;
      if (legAtr < DAY_ZONE_MIN_LEG_ATR) continue;

      for (const z of [...imp.zones, imp.ote]) {
        if (!(z.hi > z.lo)) continue;
        let touches = 0;
        for (let m = z.from + 1; m <= n - 2; m++) {
          if (isBuy ? s.candles[m].l <= z.hi : s.candles[m].h >= z.lo) touches++;
        }
        if (touches >= 2) continue;
        out.push({ ...z, dir: isBuy ? 1 : -1, src: s.src, tfLabel: s.tfLabel, legAtr, touches });
      }
    }
  }
  return out;
}

const zoneDist = (z, price, a15) => (price >= z.lo && price <= z.hi) ? 0 : Math.min(Math.abs(price - z.lo), Math.abs(price - z.hi)) / a15;
const DAY_TYPE_W = { OB: 3, OTE: 2, FVG: 1, FALLBACK: 0 };
const dayZoneBase = z => (DAY_TYPE_W[z.type] ?? 1) + (z.src === 'htf' ? 2 : 1) + (z.touches === 0 ? 2 : 1);

function scoreDayCand(z, role, dist, dirArr, trigger) {
  const conf = dirArr.filter(d => d === z.dir).length;
  return { z, role, dist, trigger, conf, score: dayZoneBase(z) + (role === 'TREND' ? 2 : 0) + conf + (trigger ? 2 : 0) - 1.5 * Math.min(dist, 6) };
}

function dayFallbackZone(m15C, a15, dir, price) {
  const sw = swings(m15C, 2);
  const sp = lastSwing(sw, dir === 1 ? 'L' : 'H');
  const base = sp ? sp.price : (dir === 1 ? price - a15 : price + a15);
  return { type: 'FALLBACK', lo: base - 0.2 * a15, hi: base + 0.3 * a15, from: m15C.length - 1, dir, src: 'm15', tfLabel: 'M15', touches: 0, legAtr: 0 };
}

function dayPsyTp3(symbol, entry, dir, risk, dec) {
  const step = DAY_PSY_STEP[symbol];
  if (!step || !(risk > 0)) return null;
  const target = entry + dir * 2.2 * risk;
  const lvl = dir === 1 ? Math.ceil(target / step) * step : Math.floor(target / step) * step;
  return Number(lvl.toFixed(dec));
}

function dayTradePlan({ htfC, mtfC, m5C, price, symbol, pip, dec, lang }) {
  const m15C = aggregateM15(m5C);
  if (m15C.length < MIN_CANDLES) return { err: ['Data M15 belum cukup.', 'Not enough M15 data.'] };
  const a15 = atr(m15C, 14);

  const dH1 = structureDir(htfC), dM30 = structureDir(mtfC), dM15 = structureDir(m15C), dM5 = structureDir(m5C);
  const dirArr = [dH1, dM30, dM15, dM5];
  const sc = 2 * dH1 + 2 * dM30 + dM15 + dM5;
  const trend = sc >= 2 ? 1 : sc <= -2 ? -1 : (dH1 || dM30);

  const zones = dayCollectZones([{ src: 'htf', tfLabel: 'H1', candles: htfC }, { src: 'mtf', tfLabel: 'M30', candles: mtfC }]);
  const trigBuy = m5Trigger(m5C, true), trigSell = m5Trigger(m5C, false);
  const trigOf = d => (d === 1 ? trigBuy : trigSell);

  const cands = zones.map(z => scoreDayCand(z, z.dir === trend ? 'TREND' : 'COUNTER', zoneDist(z, price, a15), dirArr, trigOf(z.dir)));
  if (!cands.length) cands.push(scoreDayCand(dayFallbackZone(m15C, a15, trend || 1, price), 'TREND', 0, dirArr, true));
  cands.sort((x, y) => y.score - x.score);

  const best = cands[0];
  const { z, role } = best;
  const dir = z.dir, isBuy = dir === 1;

  const inside = price >= z.lo && price <= z.hi;
  const orderType = (inside || zoneDist(z, price, a15) <= DAY_NEAR_ATR) ? 'NOW' : 'LIMIT';
  const entry = orderType === 'NOW' ? price : (isBuy ? z.hi : z.lo);
  
  // Buffer Zone untuk Day Trade
  const bufferRange = (pip || (a15 * 0.1)) * 10;
  const bufferEnd = isBuy ? entry - bufferRange : entry + bufferRange;

  let sl = isBuy ? bufferEnd - SL_BUFFER * a15 : bufferEnd + SL_BUFFER * a15;
  let risk = Math.abs(bufferEnd - sl);

  const tp1 = entry + dir * 1.5 * risk;
  const tp2 = entry + dir * 2 * risk;
  const tp3 = dayPsyTp3(symbol, entry, dir, risk, dec) || (entry + dir * 3 * risk);

  return {
    dir,
    plan: {
      kind: 'day', role, orderType,
      status: orderType === 'NOW' ? 'RUNNING' : 'PENDING',
      entry, bufferEnd, sl, tps: [tp1, tp2, tp3],
      zone: { min: z.lo, max: z.hi },
      zoneTf: z.tfLabel, zoneType: z.type,
      expireMs: orderType === 'LIMIT' ? DAY_LIMIT_EXPIRE_MS : 0,
      flags: [], over: false, dirs: { H1: dH1, M30: dM30, M15: dM15, M5: dM5 },
      meta: { confidence: 'HIGH', risk: 'MEDIUM', setup: 'CONTINUATION', setupLabel: 'Day Trade Setup', zoneLabel: `${z.type} Zone`, zoneNote: 'Buffer Zone Applied' }
    }
  };
}

function bestZonePlan(series, dir, price, refAtr, distW) {
  const isBuy = dir === 1;
  const pool = [];
  for (const s of series) {
    if (!s.candles || s.candles.length < MIN_CANDLES) continue;
    const a = atr(s.candles, 14);
    const imp = impulseZones(s.candles, isBuy, a);
    if (imp.err) continue;
    for (const z of [...imp.zones, imp.ote]) {
      const inside = price >= z.lo && price <= z.hi;
      const edge = isBuy ? z.hi : z.lo;
      pool.push({ z, a, score: 5, inside, edge, distAtr: Math.abs(price - edge) / a, role: s.role, tf: s.tf, impulse: imp.impulse });
    }
  }
  pool.sort((x, y) => y.score - x.score);
  const best = pool[0] || { z: { lo: price - refAtr, hi: price + refAtr, type: 'OB', from: 0 }, a: refAtr, inside: true, edge: price, distAtr: 0, role: 'mtf', tf: '1h', impulse: { low: price, high: price } };
  const entry = best.inside ? price : best.edge;
  const bufferEnd = isBuy ? entry - (refAtr * 0.1) : entry + (refAtr * 0.1);
  let sl = isBuy ? bufferEnd - SL_BUFFER * best.a : bufferEnd + SL_BUFFER * best.a;
  return { status: best.inside ? 'RUNNING' : 'PENDING', orderType: best.inside ? 'NOW' : 'LIMIT', entry, bufferEnd, sl, zone: { min: best.z.lo, max: best.z.hi }, zoneType: best.z.type, zoneRole: best.role, zoneTf: best.tf, impulse: best.impulse, distAtr: best.distAtr, expireMs: expireFor(best.tf) };
}

function freshZonePlan(candles, dir, price, a, refAtr) {
  const isBuy = dir === 1;
  const imp = impulseZones(candles, isBuy, a);
  if (imp.err) return imp;
  const z = imp.zones[0] || imp.ote;
  const entry = price >= z.lo && price <= z.hi ? price : (isBuy ? z.hi : z.lo);
  const bufferEnd = isBuy ? entry - (a * 0.1) : entry + (a * 0.1);
  let sl = isBuy ? bufferEnd - SL_BUFFER * a : bufferEnd + SL_BUFFER * a;
  return { status: 'PENDING', orderType: 'LIMIT', entry, bufferEnd, sl, zone: { min: z.lo, max: z.hi }, zoneType: z.type, distAtr: 0, impulse: imp.impulse };
}

function findZone(series, dir, price, refAtr) {
  for (const s of series) {
    if (!s.tf || !s.candles) continue;
    const a = atr(s.candles, 14);
    const plan = freshZonePlan(s.candles, dir, price, a, refAtr);
    if (!plan.err) return { ...plan, zoneRole: s.role, zoneTf: s.tf, expireMs: expireFor(s.tf) };
  }
  return { err: 'Tidak ada zona fresh.' };
}

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

    const cnd = body.candles || {};
    const htfC = cleanCandles(cnd.htf);
    const mtfC = cleanCandles(cnd.mtf ?? cnd.entry);
    const ltfC = cleanCandles(cnd.ltf);

    const refAtr = atr(mtfC, 14) || 1;
    const htfDir = structureDir(htfC);
    const mtfDir = structureDir(mtfC);
    const isScalp = style.kind === 'scalp';

    const rng = SCALP_SL_PIPS[symbol] || [20, 30];
    const slFloor = rng[0] * (pip || 0.1);
    const slCap = rng[1] * (pip || 0.1);

    let dir = 0, plan = null;

    if (isScalp) {
      const hr = scalpHitRun(mtfC, ltfC, htfDir, price, refAtr, slFloor, slCap, pip);
      if (hr.err) return res.status(200).json({ ok: true, signal: null, reason: T(lang, ...hr.err) });
      dir = hr.dir;
      plan = hr.plan;
    } else if (style.kind === 'day') {
      const dp = dayTradePlan({ htfC, mtfC, m5C: ltfC, price, symbol, pip, dec, lang });
      if (dp.err) return res.status(200).json({ ok: true, signal: null, reason: T(lang, ...dp.err) });
      dir = dp.dir;
      plan = dp.plan;
    } else {
      dir = mtfDir !== 0 ? mtfDir : (htfDir !== 0 ? htfDir : 1);
      const series = [{ role: 'htf', tf: style.tf?.htf, candles: htfC }, { role: 'mtf', tf: style.tf?.mtf, candles: mtfC }, { role: 'ltf', tf: style.tf?.ltf, candles: ltfC }];
      plan = style.kind === 'intraday' ? bestZonePlan(series, dir, price, refAtr, style.distW) : findZone(series, dir, price, refAtr);
      if (plan.err) return res.status(200).json({ ok: true, signal: null, reason: plan.err });
    }

    const entry = plan.entry;
    const r = v => Number(v.toFixed(dec));
    const tps = plan.tps || style.rr.map(x => entry + dir * Math.abs(entry - plan.sl) * x);

    return res.status(200).json({
      ok: true,
      signal: {
        signal: dir === 1 ? 'BUY' : 'SELL',
        mode: plan.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET',
        orderType: plan.orderType,
        orderLabel: orderLabel(dir, plan.orderType),
        status: plan.status,
        entry: r(entry),
        bufferEnd: r(plan.bufferEnd || entry), // Kirim garis buffer zone ke UI
        sl: r(plan.sl),
        tp1: r(tps[0]), tp2: r(tps[1]), tp3: r(tps[2]),
        zone: plan.zone ? { min: r(plan.zone.min), max: r(plan.zone.max) } : null,
        confidence: 'HIGH', risk: 'MEDIUM', setup: 'CONTINUATION',
        setupLabel: plan.meta?.setupLabel || 'Setup SMC',
        zoneLabel: plan.zoneLabel || 'Buffer Zone Active',
        zoneNote: plan.zoneNote || 'Garis Eksekusi & Buffer Zone Aktif',
        reason: 'Analisis Pure SMC berhasil dijalankan dengan dukungan Buffer Zone & Dynamic HTF Mapping.'
      }
    });
  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
