// api/generate.js
// Analisis Pure SMC dijalankan di server. Tidak memanggil API eksternal.
// Hanya klien terdaftar dan masih aktif yang boleh memakai endpoint ini.
// Scalping: selalu memberi sinyal (BUY/SELL NOW atau LIMIT). Day, Intraday, dan Swing tidak berubah.

const KV_KEY = 'alu_clients';

const DECIMALS = { XAUUSD: 2, XAGUSD: 3, EURUSD: 5, USDJPY: 3, GBPUSD: 5, AUDUSD: 5, USDCAD: 5, USDCHF: 5, BTCUSDT: 2, ETHUSDT: 2, SOLUSDT: 2, XRPUSDT: 4, DJI: 2, DAX: 2 };

// Ukuran 1 pip per simbol. Harus sama dengan MARKETS.pip di index.html
const PIP = { XAUUSD: 0.1, XAGUSD: 0.01, EURUSD: 0.0001, USDJPY: 0.01, GBPUSD: 0.0001, AUDUSD: 0.0001, USDCAD: 0.0001, USDCHF: 0.0001, BTCUSDT: 1, ETHUSDT: 0.1, SOLUSDT: 0.01, XRPUSDT: 0.0001, DJI: 1, DAX: 1 };

// Scalping: rentang jarak SL dalam pip [min, max]. Tidak diubah dari ketentuan.
const SCALP_SL_PIPS = {
  XAUUSD: [25, 30], XAGUSD: [25, 40],
  EURUSD: [10, 15], GBPUSD: [12, 18], USDJPY: [10, 15],
  AUDUSD: [10, 15], USDCAD: [10, 15], USDCHF: [10, 15],
  BTCUSDT: [150, 250], ETHUSDT: [75, 120],
  SOLUSDT: [40, 70], XRPUSDT: [55, 90],
  DJI: [40, 70], DAX: [40, 70],
};

// Minimal jarak TP1 (pip) untuk Day Trading. Jika TP1 (2R) di bawah ini, setup dilewati.
const DAY_MIN_TP1_PIPS = {
  XAUUSD: 80, XAGUSD: 40,
  EURUSD: 30, USDJPY: 30, GBPUSD: 40,
  AUDUSD: 30, USDCAD: 30, USDCHF: 30,
  BTCUSDT: 300, ETHUSDT: 300, SOLUSDT: 300, XRPUSDT: 300,
  DJI: 150, DAX: 100,
};

const TF_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
const TF_LABEL = { '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D1' };
const KIND_NAME = { OB: 'Order Block', FVG: 'FVG', OTE: 'OTE 62-79%' };
const ROLE_W = { htf: 3, mtf: 2, ltf: 1 };

// ---------- Scalping ----------
const SCALP_WINDOWS = [6, 4, 3];           // jendela kaki reaksi (candle M5), dicoba dari yang terlebar
const SCALP_MIN_REACTION_ATR = 0.5;        // kaki reaksi minimal 0.5 ATR (kalau lebih kecil, diperlebar)
const SCALP_NEAR_ATR = 0.5;                // harga dianggap dekat tepi zona jika selisihnya <= nilai ini (ATR)
const SCALP_REVERSE_TOL_ATR = 0.1;         // jika harga menembus kaki reaksi lebih dari ini, kandidat itu dilewati
const SCALP_MAX_WAIT_MS = 20 * 60 * 1000;  // LIMIT scalping batal setelah 20 menit
// Jika SL struktur melebihi batas max pair:
//   'FLAG' = SL struktur tetap dipakai (tidak dipersempit), risk HIGH, confidence LOW
//   'CAP'  = SL dipaksa masuk batas max pair, risk HIGH, confidence LOW
const SCALP_OVER_CAP = 'FLAG';

// Harus sama dengan STYLE_TF di index.html
// kind: 'scalp'    = trigger M5, BUY/SELL NOW atau LIMIT, selalu memberi sinyal, TP 1R / 2R / 3R
//       'day'      = zona terbaik (skor), dekat harga diutamakan, TP 2R / 3R / 4R
//       'intraday' = zona terbaik (skor probabilitas), TP 1.5R / 3R / 5.5R
//       'zone'     = Swing: zona fresh, TP 2R / 4.5R / 8.5R. Wajib searah HTF.
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

// BUY NOW / SELL NOW / BUY LIMIT / SELL LIMIT
const orderLabel = (dir, orderType) => `${dir === 1 ? 'BUY' : 'SELL'} ${orderType === 'LIMIT' ? 'LIMIT' : 'NOW'}`;

// Jenis order dari plan. Plan tanpa orderType diturunkan dari status.
const resolveOrder = plan => plan.orderType || (plan.status === 'PENDING' ? 'LIMIT' : 'NOW');

// Teks catatan kualitas (hanya scalping yang memakai flag)
const FLAG_TXT = {
  NO_TRIGGER: ['tanpa trigger M5 yang jelas, entry mengikuti arah struktur', 'no clear M5 trigger, entry follows structure'],
  HTF_OPPOSITE: ['arah berlawanan dengan HTF', 'against HTF direction'],
};

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

// ---------- Impuls & kandidat zona (Day, Intraday, Swing) ----------

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

// Kaki reaksi dalam 'lookback' candle terakhir.
// BUY = low terendah, lalu high tertinggi sesudahnya. SELL = kebalikannya.
function scalpLeg(candles, isBuy, lookback) {
  const win = candles.slice(-lookback);
  let idx = 0;
  if (isBuy) {
    for (let i = 1; i < win.length; i++) if (win[i].l < win[idx].l) idx = i;
    let high = -Infinity;
    for (let i = idx; i < win.length; i++) if (win[i].h > high) high = win[i].h;
    return { low: win[idx].l, high };
  }
  for (let i = 1; i < win.length; i++) if (win[i].h > win[idx].h) idx = i;
  let low = Infinity;
  for (let i = idx; i < win.length; i++) if (win[i].l < low) low = win[i].l;
  return { low, high: win[idx].h };
}

// Jarak SL: di bawah floor dilebarkan. Di atas cap ditandai (over), dan dipersempit hanya jika SCALP_OVER_CAP = 'CAP'.
function scalpSlFrom(entry, rawStop, isBuy, a, slFloor, slCap) {
  let stop = rawStop;
  let risk = Math.abs(entry - stop);
  if (risk < slFloor) {
    stop = isBuy ? entry - slFloor : entry + slFloor;
    risk = slFloor;
  }
  let over = false, rawRiskAtr = null;
  if (risk > slCap) {
    over = true;
    rawRiskAtr = risk / a;
    if (SCALP_OVER_CAP === 'CAP') {
      stop = isBuy ? entry - slCap : entry + slCap;
      risk = slCap;
    }
  }
  return { stop, risk, over, rawRiskAtr };
}

// Satu kandidat scalping untuk satu arah dan satu jendela kaki. Mengembalikan plan, atau null jika kaki sudah dilanggar.
function scalpCandidate(candles, dir, price, a, htfDir, slFloor, slCap, lookback) {
  const isBuy = dir === 1;
  const n = candles.length;
  const sw = swings(candles.slice(0, -3), 2);
  const sh = lastSwing(sw, 'H');
  const sl0 = lastSwing(sw, 'L');
  const recent = candles.slice(-3);
  const lastC = candles[n - 1];
  const flags = [];

  // 1) Trigger: sweep lalu reclaim, atau break struktur M5. Jika tidak ada, pakai pullback.
  let trigger = null;
  if (sh && sl0) {
    if (isBuy) {
      if (recent.some(c => c.l < sl0.price) && lastC.c > sl0.price) trigger = 'sweep';
      else if (recent.some(c => c.c > sh.price)) trigger = 'bos';
    } else {
      if (recent.some(c => c.h > sh.price) && lastC.c < sh.price) trigger = 'sweep';
      else if (recent.some(c => c.c < sl0.price)) trigger = 'bos';
    }
  }
  if (!trigger) trigger = 'pullback';
  if (htfDir !== 0 && htfDir !== dir) flags.push('HTF_OPPOSITE');

  // 2) Kaki reaksi. Jika terlalu kecil, diperlebar dari sisi yang benar agar zona tetap terbentuk.
  let { low, high } = scalpLeg(candles, isBuy, lookback);
  const need = SCALP_MIN_REACTION_ATR * a;
  if (high - low < need) {
    if (isBuy) high = low + need;
    else low = high - need;
  }
  const leg = high - low;
  const zTop = isBuy ? high - 0.382 * leg : low + 0.618 * leg;
  const zBot = isBuy ? high - 0.618 * leg : low + 0.382 * leg;
  const mid = isBuy ? high - 0.5 * leg : low + 0.5 * leg;

  // 3) Kaki sudah ditembus dari sisi lawan: kandidat ini tidak dipakai
  const broke = isBuy
    ? price <= low + SCALP_REVERSE_TOL_ATR * a
    : price >= high - SCALP_REVERSE_TOL_ATR * a;
  if (broke) return null;

  // 4) Entry: NOW jika di dalam, dekat, atau sudah lebih dalam dari zona. LIMIT di tengah zona jika harga sudah lari jauh.
  let kind, orderType, entry;
  if (price >= zBot && price <= zTop) {
    kind = 'inside'; orderType = 'NOW'; entry = price;
  } else if (isBuy ? price > zTop : price < zBot) {
    const edgeDist = isBuy ? price - zTop : zBot - price;
    if (edgeDist <= SCALP_NEAR_ATR * a) {
      kind = 'near'; orderType = 'NOW'; entry = price;
    } else {
      kind = 'limit'; orderType = 'LIMIT'; entry = mid;
    }
  } else {
    kind = 'deep'; orderType = 'NOW'; entry = price;
  }

  // 5) SL di luar kaki reaksi
  const rawStop = isBuy ? low - SL_BUFFER * a : high + SL_BUFFER * a;
  if (isBuy ? rawStop >= entry : rawStop <= entry) return null;
  const s = scalpSlFrom(entry, rawStop, isBuy, a, slFloor, slCap);

  return {
    kind,
    orderType,
    mode: orderType === 'NOW' ? 'DIRECT' : 'WAIT',
    fill: orderType === 'LIMIT' ? 'LIMIT' : null,
    entry,
    status: orderType === 'NOW' ? 'RUNNING' : 'PENDING',
    sl: s.stop,
    zone: { min: zBot, max: zTop },
    mid,
    trigger,
    expireMs: orderType === 'NOW' ? 0 : SCALP_MAX_WAIT_MS,
    distAtr: Math.abs(price - mid) / a,
    touches: 0,
    zoneType: null,
    flags,
    over: s.over,
    rawRiskAtr: s.rawRiskAtr,
    lookback,
  };
}

// Cadangan scalping: selalu tersedia untuk kedua arah. Entry NOW di harga sekarang, SL dari 3 candle terakhir.
function scalpFallback(candles, dir, price, a, slFloor, slCap) {
  const isBuy = dir === 1;
  const win = candles.slice(-3);
  const low = Math.min(...win.map(c => c.l));
  const high = Math.max(...win.map(c => c.h));
  let rawStop = isBuy ? low - SL_BUFFER * a : high + SL_BUFFER * a;
  if (isBuy ? rawStop >= price : rawStop <= price) {
    rawStop = isBuy ? price - slFloor : price + slFloor;
  }
  const s = scalpSlFrom(price, rawStop, isBuy, a, slFloor, slCap);
  return {
    kind: 'fallback',
    orderType: 'NOW',
    mode: 'DIRECT',
    fill: null,
    entry: price,
    status: 'RUNNING',
    sl: s.stop,
    zone: { min: price - 0.1 * a, max: price + 0.1 * a },
    mid: price,
    trigger: 'fallback',
    expireMs: 0,
    distAtr: 0,
    touches: 0,
    zoneType: null,
    flags: ['NO_TRIGGER'],
    over: s.over,
    rawRiskAtr: s.rawRiskAtr,
    lookback: 3,
  };
}

// Skor kandidat: sweep > BOS > pullback > fallback. Searah HTF menambah, berlawanan HTF mengurangi.
const TRIG_W = { sweep: 3, bos: 2, pullback: 1, fallback: 0 };
function scalpScore(c, htfDir) {
  const p = c.plan;
  let s = TRIG_W[p.trigger] ?? 0;
  if (htfDir !== 0) s += htfDir === c.dir ? 2 : -1;
  if (p.orderType === 'NOW') s += 1;
  if (p.over) s -= 3;
  s -= Math.min(p.distAtr, 3) * 0.5;
  return s;
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
    orderType: active ? 'NOW' : 'LIMIT',
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
    orderType: p.inZone ? 'NOW' : 'LIMIT',
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
  const orderType = resolveOrder(plan);
  const ord = orderLabel(dir, orderType);
  const flags = plan.flags || [];

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
  if (plan.trigger === 'sweep') pts += 1;
  if (plan.zoneType === 'OB') pts += 1;
  if (plan.zoneType && (plan.touches ?? 0) === 0) pts += 1;
  if (plan.distAtr != null && plan.distAtr <= 1) pts += 1;
  if (riskAtr <= 2.5) pts += 1;
  let confidence = pts >= 5 ? 'HIGH' : pts >= 3 ? 'MEDIUM' : 'LOW';
  if (flags.length || plan.over) confidence = 'LOW';

  const hiAtr = isScalp ? 3 : 2.5;
  const midAtr = isScalp ? 2 : 1.5;
  let riskCode = setup === 'REVERSAL' || riskAtr > hiAtr ? 'HIGH' : riskAtr > midAtr ? 'MEDIUM' : 'LOW';
  if (plan.over) riskCode = 'HIGH';
  if (confidence === 'LOW' && riskCode === 'LOW') riskCode = 'MEDIUM';

  const side = dir === 1 ? 'Demand' : 'Supply';
  const distPip = Math.round(Math.abs(plan.entry - price) / (pip || refAtr));

  let zoneLabel, zoneNote;
  if (isScalp) {
    zoneLabel = { sweep: 'Sweep & Reclaim M5', bos: 'BOS Retest M5', pullback: 'Pullback M5', fallback: 'Momentum M5' }[plan.trigger] || 'M5';
    zoneNote = {
      inside: `${ord} · ${T(lang, 'harga di dalam zona', 'price inside zone')}`,
      near: `${ord} · ${T(lang, 'harga dekat tepi zona', 'price near zone edge')}`,
      deep: `${ord} · ${T(lang, 'harga lebih dalam dari zona, SL di luar kaki reaksi', 'price deeper than zone, SL outside reaction leg')}`,
      limit: `${ord} · ${T(lang, `tunggu pullback, ${distPip} pip dari harga`, `wait for pullback, ${distPip} pips away`)}`,
      fallback: `${ord} · ${T(lang, 'mengikuti arah struktur', 'following structure')}`,
    }[plan.kind];
  } else {
    zoneLabel = `${KIND_NAME[plan.zoneType] || plan.zoneType} ${side} ${TF_LABEL[plan.zoneTf] || ''}`.trim();
    if (plan.status === 'RUNNING') {
      zoneNote = `${ord} · ${T(lang, 'harga sudah di dalam area entry', 'price already inside entry area')}`;
    } else {
      const near = plan.distAtr != null && plan.distAtr <= 1;
      zoneNote = `${ord} · ${T(
        lang,
        `area entry ${distPip} pip dari harga${near ? ' (dekat)' : ''}`,
        `entry area ${distPip} pips away${near ? ' (near)' : ''}`
      )}`;
    }
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

// Catatan kualitas untuk alasan scalping. Kosong jika tidak ada catatan.
function flagNotes(plan, lang) {
  const parts = (plan.flags || []).map(k => T(lang, FLAG_TXT[k][0], FLAG_TXT[k][1]));
  if (plan.over) {
    const x = Number(plan.rawRiskAtr).toFixed(1);
    parts.push(SCALP_OVER_CAP === 'CAP'
      ? T(lang, `SL dipersempit ke batas rentang pair (jarak asli ${x} ATR), risiko tinggi`, `SL tightened to pair range limit (original ${x} ATR), high risk`)
      : T(lang, `SL struktur berjarak ${x} ATR, melebihi batas rentang pair, risiko tinggi`, `structure SL is ${x} ATR, above pair range limit, high risk`));
  }
  return parts.length ? ` Catatan: ${parts.join('; ')}.` : '';
}

function buildReason({ lang, style, dir, plan, dec, htfTxt, meta, slPips, tpPips }) {
  const f = v => v.toFixed(dec);
  const d = dir === 1 ? 'BUY' : 'SELL';
  const head = `${d} · ${style.label}.`;
  const orderType = resolveOrder(plan);
  const ord = orderLabel(dir, orderType);
  const tail = T(
    lang,
    `Setup: ${meta.setupLabel}. Confidence ${meta.confidence}, risiko ${meta.risk}. HTF ${htfTxt.id}.`,
    `Setup: ${meta.setupLabel}. Confidence ${meta.confidence}, risk ${meta.risk}. HTF ${htfTxt.en}.`
  );
  const rrTxt = style.rr.map(x => `${x}R`).join(' / ');

  if (style.kind === 'scalp') {
    const trigId = {
      sweep: 'sweep likuiditas lalu reclaim M5',
      bos: 'break struktur M5',
      pullback: 'pullback searah trend HTF',
      fallback: 'arah struktur M5 dan HTF',
    }[plan.trigger];
    const trigEn = {
      sweep: 'liquidity sweep and reclaim on M5',
      bos: 'M5 structure break',
      pullback: 'pullback in HTF trend',
      fallback: 'M5 and HTF structure direction',
    }[plan.trigger];
    const zoneTxt = plan.kind === 'fallback' ? '' : T(
      lang,
      `Zona ${f(plan.zone.min)} – ${f(plan.zone.max)} (38,2–61,8% kaki reaksi). `,
      `Zone ${f(plan.zone.min)} – ${f(plan.zone.max)} (38.2–61.8% of reaction leg). `
    );
    const pendTxt = orderType === 'LIMIT'
      ? T(
          lang,
          ` Batal jika SL atau TP1 tersentuh dulu, atau belum terisi dalam ${durText(plan.expireMs, lang)}.`,
          ` Cancelled if SL or TP1 is hit first, or not filled within ${durText(plan.expireMs, lang)}.`
        )
      : '';

    const action = {
      inside: T(lang, `${ord} di ${f(plan.entry)}, harga di dalam zona.`, `${ord} at ${f(plan.entry)}, price inside zone.`),
      near: T(lang, `${ord} di ${f(plan.entry)}, harga dekat tepi zona.`, `${ord} at ${f(plan.entry)}, price near zone edge.`),
      deep: T(lang, `${ord} di ${f(plan.entry)}, harga sudah lebih dalam dari zona setelah trigger.`, `${ord} at ${f(plan.entry)}, price deeper than zone after trigger.`),
      limit: T(
        lang,
        `${ord} di ${f(plan.entry)}, harga sudah lari dari zona. Tunggu pullback ke tengah zona.${pendTxt}`,
        `${ord} at ${f(plan.entry)}, price ran ahead of zone. Wait for pullback to zone midpoint.${pendTxt}`
      ),
      fallback: T(lang, `${ord} di ${f(plan.entry)}, mengikuti arah struktur.`, `${ord} at ${f(plan.entry)}, following structure.`),
    }[plan.kind];

    const pipTxt = tpPips ? ` (${tpPips.join(' / ')} pip)` : '';
    const slTxt = plan.over && SCALP_OVER_CAP === 'CAP'
      ? T(lang, `SL ${slPips ?? '-'} pip (batas rentang pair).`, `SL ${slPips ?? '-'} pips (pair range limit).`)
      : T(
          lang,
          `SL ${slPips ?? '-'} pip di luar kaki reaksi${plan.over ? '' : ', tidak dipersempit'}.`,
          `SL ${slPips ?? '-'} pips beyond the reaction leg${plan.over ? '' : ', not tightened'}.`
        );
    const tpTxt = T(lang, ` TP ${rrTxt}${pipTxt} tetap dari jarak SL.`, ` TP ${rrTxt}${pipTxt} fixed from SL distance.`);
    const trigLine = T(lang, `Trigger: ${trigId}.`, `Trigger: ${trigEn}.`);
    const notes = flagNotes(plan, lang);

    return `${head} ${trigLine} ${zoneTxt}${action} ${slTxt}${tpTxt}${notes} ${tail}`;
  }

  const zone = `${f(plan.zone.min)} – ${f(plan.zone.max)}`;
  const action = plan.status === 'RUNNING'
    ? T(lang, `${ord} di ${f(plan.entry)}, harga sudah di dalam zona.`, `${ord} at ${f(plan.entry)}, price already inside zone.`)
    : T(
        lang,
        `${ord} di tepi zona ${f(plan.entry)}, aktif saat harga masuk zona. Batal jika SL atau TP1 tersentuh lebih dulu, atau belum masuk dalam ${durText(plan.expireMs, lang)}.`,
        `${ord} at zone edge ${f(plan.entry)}, active once price enters the zone. Cancelled if SL or TP1 is hit first, or not filled within ${durText(plan.expireMs, lang)}.`
      );
  const tpTxt = T(lang, ` Target TP ${rrTxt}.`, ` TP targets ${rrTxt}.`);

  return T(
    lang,
    `${head} ${meta.zoneLabel} ${zone} di impuls ${f(plan.impulse.low)} → ${f(plan.impulse.high)}. ${action}${tpTxt} ${tail}`,
    `${head} ${meta.zoneLabel} ${zone} within impulse ${f(plan.impulse.low)} → ${f(plan.impulse.high)}. ${action}${tpTxt} ${tail}`
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

    const htfDir = structureDir(htfC);
    const mtfDir = structureDir(mtfC);
    const isScalp = style.kind === 'scalp';

    const rng = SCALP_SL_PIPS[symbol];
    const slFloor = isScalp ? (rng && pip ? rng[0] * pip : RISK_MIN * refAtr) : 0;
    const slCap = isScalp ? (rng && pip ? rng[1] * pip : slFloor * 1.5) : 0;

    let dir = 0, plan = null, minTp1Dist = 0;

    if (isScalp) {
      // Semua jendela kaki dan kedua arah dinilai, plus cadangan momentum. Selalu ada kandidat.
      const cands = [];
      for (const lb of SCALP_WINDOWS) {
        for (const d of [1, -1]) {
          const p = scalpCandidate(mtfC, d, price, refAtr, htfDir, slFloor, slCap, lb);
          if (p) cands.push({ dir: d, plan: p });
        }
      }
      for (const d of [1, -1]) {
        cands.push({ dir: d, plan: scalpFallback(mtfC, d, price, refAtr, slFloor, slCap) });
      }
      cands.sort((x, y) => scalpScore(y, htfDir) - scalpScore(x, htfDir));
      dir = cands[0].dir;
      plan = cands[0].plan;
    } else if (style.kind === 'day') {
      // Day Trading: BUY dan SELL sama-sama dinilai, setup yang keluar adalah yang paling kuat.
      // Kekuatan = skor zona + bonus searah HTF (+2) dan searah MTF (+1).
      const series = [
        { role: 'htf', tf: style.tf?.htf, candles: htfC },
        { role: 'mtf', tf: style.tf?.mtf, candles: mtfC },
        { role: 'ltf', tf: style.tf?.ltf, candles: ltfC },
      ];
      minTp1Dist = DAY_MIN_TP1_PIPS[symbol] && pip ? DAY_MIN_TP1_PIPS[symbol] * pip : 1.5 * refAtr;

      let best = null, lastErr = null, skipMsg = null;
      for (const d of [1, -1]) {
        const p = bestZonePlan(series, d, price, refAtr, style.distW);
        if (p.err) { lastErr = p.err; continue; }
        const rk = Math.abs(p.entry - p.sl);
        if (rk * style.rr[0] < minTp1Dist) {
          skipMsg = T(
            lang,
            `TP1 ${style.rr[0]}R (${(rk * style.rr[0]).toFixed(dec)}) di bawah minimum ${minTp1Dist.toFixed(dec)} untuk ${symbol}. Setup dilewati.`,
            `TP1 ${style.rr[0]}R (${(rk * style.rr[0]).toFixed(dec)}) is below the minimum ${minTp1Dist.toFixed(dec)} for ${symbol}. Setup skipped.`
          );
          continue;
        }
        const strength = p.score + (d === htfDir ? 2 : 0) + (d === mtfDir ? 1 : 0);
        if (!best || strength > best.strength) best = { dir: d, plan: p, strength };
      }
      if (!best) return none(skipMsg || lastErr || T(lang, 'Belum ada setup Day Trading yang valid.', 'No valid Day Trading setup yet.'));
      dir = best.dir;
      plan = best.plan;
    } else {
      const flexible = style.kind === 'day' || style.kind === 'intraday';
      dir = mtfDir;
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

      const series = [
        { role: 'htf', tf: style.tf?.htf, candles: htfC },
        { role: 'mtf', tf: style.tf?.mtf, candles: mtfC },
        { role: 'ltf', tf: style.tf?.ltf, candles: ltfC },
      ];
      if (style.kind === 'day') {
        minTp1Dist = DAY_MIN_TP1_PIPS[symbol] && pip ? DAY_MIN_TP1_PIPS[symbol] * pip : 1.5 * refAtr;
      }
      plan = (style.kind === 'day' || style.kind === 'intraday')
        ? bestZonePlan(series, dir, price, refAtr, style.distW)
        : findZone(series, dir, price, refAtr);
      if (plan.err) return none(plan.err);
    }

    const htfTxt = htfDir === 0
      ? { id: 'belum jelas', en: 'unclear' }
      : htfDir === dir
        ? { id: 'searah', en: 'aligned' }
        : { id: 'berlawanan', en: 'opposite' };

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

    const tps = style.rr.map(x => entry + dir * risk * x);
    const tpPips = pip ? tps.map(tp => Math.round(Math.abs(tp - entry) / pip)) : null;
    const slPips = pip ? Math.round(risk / pip) : null;

    const meta = buildMeta({
      lang, style, dir, plan, price, pip, htfDir, mtfDir, refAtr, risk,
    });

    const reason = buildReason({
      lang, style, dir, plan, dec, htfTxt, meta, slPips, tpPips,
    });

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
