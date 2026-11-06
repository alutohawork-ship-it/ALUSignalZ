// api/generate.js
// Analisis Pure SMC dijalankan di server. Tidak memanggil API eksternal.
// Hanya klien terdaftar dan masih aktif yang boleh memakai endpoint ini.

const KV_KEY = 'alu_clients';

const DECIMALS = { XAUUSD: 2, XAGUSD: 3, EURUSD: 5, USDJPY: 3, GBPUSD: 5, BTCUSDT: 2, ETHUSDT: 2, SOLUSDT: 2, XRPUSDT: 4, DJI: 2, DAX: 2 };

// Ukuran 1 pip per simbol. Harus sama dengan MARKETS.pip di index.html
const PIP = { XAUUSD: 0.1, XAGUSD: 0.01, EURUSD: 0.0001, USDJPY: 0.01, GBPUSD: 0.0001, BTCUSDT: 1, ETHUSDT: 0.1, SOLUSDT: 0.01, XRPUSDT: 0.0001, DJI: 1, DAX: 1 };

// Scalping: rentang jarak SL dalam pip [min, max] dari entry.
// SL mengikuti swing struktur, lalu dijepit ke rentang ini.
const SCALP_SL_PIPS = {
  XAUUSD: [20, 30], XAGUSD: [25, 40],
  EURUSD: [10, 15], GBPUSD: [12, 18], USDJPY: [10, 15],
  BTCUSDT: [150, 250], ETHUSDT: [60, 100],
  SOLUSDT: [40, 70], XRPUSDT: [50, 80],
  DJI: [40, 70], DAX: [40, 70],
};

// Scalping: buffer entry limit dari harga sekarang (pip) [min, max].
// Offset = clamp(0.5 × ATR M5, min, max). Zona entry lebar = setengah offset.
const SCALP_ENTRY_PIPS = {
  XAUUSD: [8, 15], XAGUSD: [8, 15],
  EURUSD: [3, 6], GBPUSD: [4, 8], USDJPY: [3, 6],
  BTCUSDT: [40, 80], ETHUSDT: [15, 30],
  SOLUSDT: [10, 20], XRPUSDT: [10, 20],
  DJI: [15, 30], DAX: [15, 30],
};

// Minimal jarak TP1 (pip) untuk Day Trading. Jika TP1 (2R) di bawah ini, setup dilewati.
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

// Scalping: TP target 1:1.2 / 1:2 / 1:2.5. Boleh bergeser ke level struktur terdekat dalam band ini. 0 = TP fixed.
const TP_FLEX_BAND = 0.15;

// Harus sama dengan STYLE_TF di index.html
// kind: 'scalp'    = limit entry dengan buffer dari harga sekarang, SL swing dijepit rentang pip, TP RR 1:1.2 / 1:2 / 1:2.5 (fleksibel)
//       'day'      = zona terbaik (skor), dekat harga diutamakan, TP 2R / 3R / 4R
//       'intraday' = zona terbaik (skor probabilitas), tanpa syarat fresh, TP 1.5R / 3R / 5.5R
//       'zone'     = Swing: zona fresh, TP 2R / 4.5R / 8.5R
const STYLES = {
  'Scalping': {
    label: 'Scalping (HTF: M15 | MTF: M5 | LTF: M1/M3)',
    mode: 'LIMIT',
    kind: 'scalp',
    tf: { htf: '15m', mtf: '5m' },
    rr: [1.2, 2.0, 2.5],
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

const SL_BUFFER = 0.2;                     // buffer SL dalam ATR
const RISK_MIN = 0.5;                      // SL minimal 0.5 ATR
const LIMIT_RISK_MAX = 4.0;                // swing: SL maks 4 ATR
const ZONE_MAX_DIST = 4.0;                 // swing: zona maks 4 ATR dari harga
const IMPULSE_MAX_AGE = 80;                // impuls harus masih baru (dalam candle)
const HOLD_ATR_MIN = 0.5;                  // swing: SL minimal 0.5 ATR timeframe MTF
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

// ---------- Impuls & kandidat zona ----------

// Cari impuls terakhir searah dir, lalu kumpulkan FVG, OB, dan OTE (retracement 62-79%).
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

  return {
    S, E, zones, ote,
    impulse: { low: Math.min(S.price, E.price), high: Math.max(S.price, E.price) },
  };
}

// ---------- Scalping ----------

// Limit entry konservatif: entry diberi buffer dari harga sekarang.
// BUY: entry di bawah harga, zona di bawah entry. SELL: entry di atas harga, zona di atas entry.
// Status selalu PENDING (waiting). SL dihitung dari entry lalu dijepit ke rentang pip.
function scalpPlan(candles, dir, price, a, slFloor, slCap, offLo, offHi, expireMs) {
  const sw = swings(candles, 2);
  const recent = candles.slice(-12);
  const isBuy = dir === 1;

  const offset = Math.min(Math.max(0.5 * a, offLo), offHi);
  const zoneW = offset * 0.5;
  const entry = isBuy ? price - offset : price + offset;

  let dist;
  if (isBuy) {
    const sl0 = lastSwing(sw, 'L');
    const base = sl0 && sl0.price < entry ? sl0.price : Math.min(...recent.map(c => c.l));
    dist = (entry - base) + SL_BUFFER * a;
  } else {
    const sh0 = lastSwing(sw, 'H');
    const base = sh0 && sh0.price > entry ? sh0.price : Math.max(...recent.map(c => c.h));
    dist = (base - entry) + SL_BUFFER * a;
  }

  dist = Math.min(Math.max(dist, slFloor), slCap);

  return {
    status: 'PENDING',
    entry,
    sl: isBuy ? entry - dist : entry + dist,
    zone: isBuy
      ? { min: entry - zoneW, max: entry }
      : { min: entry, max: entry + zoneW },
    zoneType: 'PULLBACK',
    touches: 0,
    distAtr: offset / a,
    trigger: 'limit',
    expireMs,
  };
}

// TP scalping: target RR tetap. Jika ada level struktur (swing) di dalam band dari target,
// TP digeser ke level itu. Urutan TP selalu naik.
function structureTargets(candles, dir, entry, risk, rrs, band) {
  const sw = swings(candles, 2);
  const levels = sw
    .filter(s => (dir === 1 ? s.type === 'H' && s.price > entry : s.type === 'L' && s.price < entry))
    .map(s => Math.abs(s.price - entry))
    .sort((a, b) => a - b);

  const out = [];
  let prev = 0;
  for (const rr of rrs) {
    const target = risk * rr;
    let d = target;
    if (band > 0) {
      const lo = target * (1 - band), hi = target * (1 + band);
      let best = null;
      for (const l of levels) {
        if (l < lo || l > hi || l <= prev) continue;
        if (best === null || Math.abs(l - target) < Math.abs(best - target)) best = l;
      }
      if (best !== null) d = best;
    }
    if (d <= prev) d = target;
    out.push(entry + dir * d);
    prev = d;
  }
  return out;
}

// ---------- Day Trading & Intraday: zona terbaik berdasarkan skor probabilitas ----------

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

      const score = ROLE_W[s.role] * 2
        + recency * 2
        + typeBonus
        + (inside ? 3 : 0)
        - touches * 1.5
        - distW * Math.min(dist / a, 5)
        - (beyond ? 6 : 0);

      pool.push({
        z, a, score, inside, beyond, edge, touches,
        distAtr: dist / a,
        role: s.role, tf: s.tf, impulse: imp.impulse,
      });
    }
  }

  if (!pool.length) return { err: 'Belum ada impuls yang terbentuk di HTF, MTF, maupun LTF.' };

  pool.sort((x, y) => y.score - x.score);
  const best = pool[0];
  const active = best.inside || best.beyond;
  const entry = active ? price : best.edge;

  let sl = isBuy ? best.z.lo - SL_BUFFER * best.a : best.z.hi + SL_BUFFER * best.a;
  let risk = Math.abs(entry - sl);
  const minRisk = RISK_MIN * refAtr;
  if (risk < minRisk) {
    sl = isBuy ? entry - minRisk : entry + minRisk;
    risk = minRisk;
  }

  return {
    status: active ? 'RUNNING' : 'PENDING',
    entry,
    sl,
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

// ---------- Swing: zona fresh ----------

function freshZonePlan(candles, dir, price, a, refAtr) {
  const n = candles.length;
  const isBuy = dir === 1;
  const imp = impulseZones(candles, isBuy, a);
  if (imp.err) return imp;
  const { S, E } = imp;

  if (n - 1 - S.i > IMPULSE_MAX_AGE) return { err: 'Impuls terlalu lama.' };

  for (let i = E.i + 1; i < n; i++) {
    const c = candles[i];
    if (isBuy ? c.l < S.price : c.h > S.price) return { err: 'Struktur sudah patah.' };
    if (isBuy ? c.h > E.price : c.l < E.price) return { err: 'Masih membuat extreme baru, tunggu pullback.' };
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

  const candidates = imp.zones
    .filter(isFresh)
    .map(build)
    .filter(p => p.risk <= maxRisk)
    .sort((x, y) => y.z.from - x.z.from);

  if (!candidates.length) return { err: 'Tidak ada zona fresh di timeframe ini.' };

  const p = candidates[0];
  return {
    status: p.inZone ? 'RUNNING' : 'PENDING',
    entry: p.entry,
    sl: p.sl,
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
    return {
      ...plan,
      zoneRole: s.role,
      zoneTf: s.tf,
      expireMs: expireFor(s.tf),
    };
  }
  return { err: 'Tidak ada zona FVG atau Order Block yang fresh di HTF, MTF, maupun LTF. Tidak ada sinyal.' };
}

// ---------- Metadata setup: confidence, risk, setup type, label zona, keterangan entry ----------

function buildMeta({ lang, style, dir, plan, price, pip, htfDir, mtfDir, refAtr, risk }) {
  const isScalp = style.kind === 'scalp';

  const setup = htfDir === 0 ? 'NEUTRAL' : htfDir === dir ? 'CONTINUATION' : 'REVERSAL';
  const setupLabel = {
    NEUTRAL: T(lang, 'Netral (HTF belum jelas)', 'Neutral (HTF unclear)'),
    CONTINUATION: T(lang, 'Continuation (searah trend HTF)', 'Continuation (with HTF trend)'),
    REVERSAL: T(lang, 'Reversal (melawan trend HTF)', 'Reversal (against HTF trend)'),
  }[setup];

  const riskAtr = risk / refAtr;
  let pts = 0;
  if (htfDir === dir) pts += 2;
  if (mtfDir === dir) pts += 1;
  if (plan.status === 'RUNNING') pts += 1;
  if (plan.zoneType === 'OB') pts += 1;
  if (plan.zoneType && (plan.touches ?? 0) === 0) pts += 1;
  if (plan.distAtr != null && plan.distAtr <= 1) pts += 1;
  if (riskAtr <= 2) pts += 1;
  const confidence = pts >= 5 ? 'HIGH' : pts >= 3 ? 'MEDIUM' : 'LOW';

  let riskCode = setup === 'REVERSAL' || riskAtr > 2.5 ? 'HIGH' : riskAtr > 1.5 ? 'MEDIUM' : 'LOW';
  if (confidence === 'LOW' && riskCode === 'LOW') riskCode = 'MEDIUM';

  const side = dir === 1 ? 'Demand' : 'Supply';
  const zoneLabel = isScalp
    ? T(lang, 'Pullback MTF', 'MTF pullback')
    : `${KIND_NAME[plan.zoneType] || plan.zoneType} ${side} ${TF_LABEL[plan.zoneTf] || ''}`.trim();

  const distPip = Math.round(Math.abs(plan.entry - price) / (pip || refAtr));
  let zoneNote;
  if (plan.status === 'RUNNING') {
    zoneNote = T(lang, 'Harga sudah di dalam area entry', 'Price already inside entry area');
  } else {
    const near = plan.distAtr != null && plan.distAtr <= 1;
    zoneNote = T(
      lang,
      `Area entry ${distPip} pip dari harga sekarang${near ? ' (dekat)' : ''}`,
      `Entry area ${distPip} pips from current price${near ? ' (near)' : ''}`
    );
  }

  return { confidence, risk: riskCode, setup, setupLabel, zoneLabel, zoneNote };
}

// ---------- Teks alasan ----------

function durText(ms, lang) {
  const m = Math.round(ms / 60000);
  if (m >= 60) {
    const h = Math.round((m / 60) * 10) / 10;
    return T(lang, `${h} jam`, `${h} hour${h === 1 ? '' : 's'}`);
  }
  return T(lang, `${m} menit`, `${m} minute${m === 1 ? '' : 's'}`);
}

function buildReason({ lang, style, dir, plan, dec, htfTxt, meta, slPips, tpPips }) {
  const f = v => v.toFixed(dec);
  const d = dir === 1 ? 'BUY' : 'SELL';
  const head = `${d} · ${style.label}.`;
  const tail = T(
    lang,
    `Setup: ${meta.setupLabel}. Confidence ${meta.confidence}, risiko ${meta.risk}. HTF ${htfTxt.id}.`,
    `Setup: ${meta.setupLabel}. Confidence ${meta.confidence}, risk ${meta.risk}. HTF ${htfTxt.en}.`
  );

  if (style.kind === 'scalp') {
    const zone = `${f(plan.zone.min)} – ${f(plan.zone.max)}`;
    const tpId = tpPips
      ? ` TP1 ${tpPips[0]} pip, TP2 ${tpPips[1]} pip, TP3 ${tpPips[2]} pip (mengikuti struktur ±${Math.round(TP_FLEX_BAND * 100)}%).`
      : '';
    const tpEn = tpPips
      ? ` TP1 ${tpPips[0]} pips, TP2 ${tpPips[1]} pips, TP3 ${tpPips[2]} pips (structure-adjusted ±${Math.round(TP_FLEX_BAND * 100)}%).`
      : '';
    const body = T(
      lang,
      `Limit entry di ${f(plan.entry)} dalam zona ${zone}. ${meta.zoneNote}. Status waiting, aktif saat harga masuk zona. Batal jika SL atau TP1 tersentuh lebih dulu, atau belum masuk dalam ${durText(plan.expireMs, lang)}. SL ${slPips ?? '-'} pip.${tpId}`,
      `Limit entry at ${f(plan.entry)} within zone ${zone}. ${meta.zoneNote}. Status waiting, active once price enters the zone. Cancelled if SL or TP1 is hit first, or not filled within ${durText(plan.expireMs, lang)}. SL ${slPips ?? '-'} pips.${tpEn}`
    );
    return `${head} ${body} ${tail}`;
  }

  const zone = `${f(plan.zone.min)} – ${f(plan.zone.max)}`;
  const rrTxt = style.rr.map(x => `${x}R`).join(' / ');
  const action = plan.status === 'RUNNING'
    ? T(lang, `Status aktif, entry di ${f(plan.entry)}.`, `Status running, entry at ${f(plan.entry)}.`)
    : T(
        lang,
        `Status waiting zone: entry limit di tepi zona ${f(plan.entry)}, aktif saat harga masuk zona. Batal jika SL atau TP1 tersentuh lebih dulu, atau belum masuk dalam ${durText(plan.expireMs, lang)}.`,
        `Waiting zone: limit entry at zone edge ${f(plan.entry)}, active once price enters the zone. Cancelled if SL or TP1 is hit first, or not filled within ${durText(plan.expireMs, lang)}.`
      );
  const tpTxt = T(lang, ` Target TP ${rrTxt}.`, ` TP targets ${rrTxt}.`);

  const body = T(
    lang,
    `${meta.zoneLabel} ${zone} di impuls ${f(plan.impulse.low)} → ${f(plan.impulse.high)}. ${meta.zoneNote}. ${action}${tpTxt}`,
    `${meta.zoneLabel} ${zone} within impulse ${f(plan.impulse.low)} → ${f(plan.impulse.high)}. ${meta.zoneNote}. ${action}${tpTxt}`
  );
  return `${head} ${body} ${tail}`;
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

    const mtfDir = structureDir(mtfC);
    const htfDir = structureDir(htfC);
    const isScalp = style.kind === 'scalp';
    // Scalping, Day Trading, dan Intraday selalu memberi setup. Swing tetap ketat.
    const flexible = isScalp || style.kind === 'day' || style.kind === 'intraday';

    let dir = mtfDir;
    if (dir === 0 && flexible) {
      const sma20 = mtfC.slice(-20).reduce((s, c) => s + c.c, 0) / 20;
      dir = htfDir || (mtfC[mtfC.length - 1].c >= sma20 ? 1 : -1);
    }
    if (dir === 0) {
      return none(T(lang, 'Struktur belum jelas di timeframe MTF. Tidak ada sinyal.', 'Structure is unclear on the MTF. No signal.'));
    }

    if (!flexible && htfDir !== 0 && htfDir !== dir) {
      return none(T(lang, 'Arah HTF berlawanan dengan arah entry. Tidak ada sinyal.', 'HTF direction conflicts with entry. No signal.'));
    }

    const htfTxt = htfDir === 0
      ? { id: 'belum jelas', en: 'unclear' }
      : htfDir === dir
        ? { id: 'searah', en: 'aligned' }
        : { id: 'berlawanan', en: 'opposite' };

    // Scalping: rentang SL per pair (pip -> harga). Pair tanpa tabel pakai ATR.
    const rng = SCALP_SL_PIPS[symbol];
    const slFloor = isScalp ? (rng && pip ? rng[0] * pip : RISK_MIN * refAtr) : 0;
    const slCap = isScalp ? (rng && pip ? rng[1] * pip : slFloor * 1.5) : 0;

    // Scalping: buffer entry dari harga sekarang (harga). Pair tanpa tabel pakai ATR.
    const eRng = SCALP_ENTRY_PIPS[symbol];
    const offLo = isScalp ? (eRng && pip ? eRng[0] * pip : 0.3 * refAtr) : 0;
    const offHi = isScalp ? (eRng && pip ? eRng[1] * pip : 0.6 * refAtr) : 0;

    // Jarak minimal TP1 (harga) untuk Day Trading. Dipakai sebagai filter, bukan untuk memperlebar TP.
    let minTp1Dist = 0;
    if (style.kind === 'day') {
      minTp1Dist = DAY_MIN_TP1_PIPS[symbol] && pip ? DAY_MIN_TP1_PIPS[symbol] * pip : 1.5 * refAtr;
    }

    const series = [
      { role: 'htf', tf: style.tf?.htf, candles: htfC },
      { role: 'mtf', tf: style.tf?.mtf, candles: mtfC },
      { role: 'ltf', tf: style.tf?.ltf, candles: ltfC },
    ];

    let plan;
    if (isScalp) {
      plan = scalpPlan(mtfC, dir, price, refAtr, slFloor, slCap, offLo, offHi, expireFor(style.tf.mtf));
    } else if (style.kind === 'day' || style.kind === 'intraday') {
      plan = bestZonePlan(series, dir, price, refAtr, style.distW);
    } else {
      plan = findZone(series, dir, price, refAtr);
    }
    if (plan.err) return none(plan.err);

    const entry = plan.entry;
    const risk = Math.abs(entry - plan.sl);
    const r = v => Number(v.toFixed(dec));

    if (style.kind === 'day' && minTp1Dist && risk * style.rr[0] < minTp1Dist) {
      const tp1Dist = (risk * style.rr[0]).toFixed(dec);
      const minDist = minTp1Dist.toFixed(dec);
      return none(T(
        lang,
        `TP1 ${style.rr[0]}R (${tp1Dist}) di bawah minimum ${minDist} untuk ${symbol}. Setup dilewati.`,
        `TP1 ${style.rr[0]}R (${tp1Dist}) is below the minimum ${minDist} for ${symbol}. Setup skipped.`
      ));
    }

    const tps = isScalp
      ? structureTargets(mtfC, dir, entry, risk, style.rr, TP_FLEX_BAND)
      : style.rr.map(x => entry + dir * risk * x);
    const tpPips = pip ? tps.map(tp => Math.round(Math.abs(tp - entry) / pip)) : null;
    const slPips = pip ? Math.round(risk / pip) : null;

    const meta = buildMeta({
      lang, style, dir, plan, price, pip, htfDir, mtfDir, refAtr, risk,
    });

    const reason = buildReason({
      lang, style, dir, plan, dec, htfTxt, meta, slPips, tpPips,
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
