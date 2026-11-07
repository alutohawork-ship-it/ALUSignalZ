// api/generate.js
// Analisis Pure SMC dijalankan di server. Tidak memanggil API eksternal.
// Hanya klien terdaftar dan masih aktif yang boleh memakai endpoint ini.
// Scalping: Hit & Run (arah M5, filter M15, pullback M5 sehat, trigger M1/M5).
// Day Trading: Zone Strength (zona kuat H1/M30, trend atau counter, konfirmasi M15/M5, TP 1.5R / 2R / psikologi).
// Intraday dan Swing tidak berubah.

const KV_KEY = 'alu_clients';

// Harus sama dengan decimals di MARKETS (index.html)
const DECIMALS = {
  XAUUSD: 2, XAGUSD: 3, EURUSD: 5, USDJPY: 3, GBPUSD: 5, DJI: 2,
  AUDUSD: 5, USDCAD: 5, USDCHF: 5,
  CLUSDT: 2, NATGASUSDT: 3, COPPERUSDT: 4, XPDUSDT: 2, XPTUSDT: 2,
  BRENTOIL: 2, PALLADIUM: 2, PLATINUM: 2, SP500: 2, XYZ100: 2, JP225: 0, QQQUSDT: 2,
  BTCUSDT: 2, ETHUSDT: 2, SOLUSDT: 2, XRPUSDT: 4, BNBUSDT: 2, ADAUSDT: 4,
  LINKUSDT: 3, AVAXUSDT: 3, DOGEUSDT: 5, SUIUSDT: 4, NEARUSDT: 4, DOTUSDT: 4,
  LTCUSDT: 2, TAOUSDT: 2, HYPEUSDT: 2,
};

// Ukuran 1 pip per simbol. Harus sama dengan MARKETS.pip di index.html
const PIP = {
  XAUUSD: 0.1, XAGUSD: 0.01, EURUSD: 0.0001, USDJPY: 0.01, GBPUSD: 0.0001, DJI: 1,
  AUDUSD: 0.0001, USDCAD: 0.0001, USDCHF: 0.0001,
  CLUSDT: 0.01, NATGASUSDT: 0.001, COPPERUSDT: 0.0001, XPDUSDT: 0.1, XPTUSDT: 0.1,
  BRENTOIL: 0.01, PALLADIUM: 0.1, PLATINUM: 0.1, SP500: 1, XYZ100: 1, JP225: 1, QQQUSDT: 0.1,
  BTCUSDT: 1, ETHUSDT: 0.1, SOLUSDT: 0.01, XRPUSDT: 0.0001, BNBUSDT: 0.1, ADAUSDT: 0.0001,
  LINKUSDT: 0.001, AVAXUSDT: 0.001, DOGEUSDT: 0.00001, SUIUSDT: 0.0001, NEARUSDT: 0.0001,
  DOTUSDT: 0.0001, LTCUSDT: 0.01, TAOUSDT: 0.01, HYPEUSDT: 0.01,
};

// Scalping: rentang jarak SL dalam pip [min, max] dari entry.
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
};

// Jika SL struktur melebihi batas max pair (Scalping):
//   'FLAG' = SL tetap dipakai, risk HIGH, confidence LOW
//   'CAP'  = SL dipaksa masuk batas max pair, risk HIGH, confidence LOW
const SCALP_OVER_CAP = 'FLAG';

// Level psikologi per pair (perkiraan, sesuaikan dengan harga live)
const DAY_PSY_STEP = {
  XAUUSD: 50, XAGUSD: 1, EURUSD: 0.005, USDJPY: 0.5, GBPUSD: 0.005,
  AUDUSD: 0.005, USDCAD: 0.005, USDCHF: 0.005,
  CLUSDT: 5, NATGASUSDT: 0.5, COPPERUSDT: 0.1, XPDUSDT: 50, XPTUSDT: 50,
  BRENTOIL: 5, PALLADIUM: 50, PLATINUM: 50, SP500: 100, XYZ100: 500, JP225: 500, QQQUSDT: 5,
  BTCUSDT: 1000, ETHUSDT: 100, SOLUSDT: 10, XRPUSDT: 0.1, BNBUSDT: 10, ADAUSDT: 0.05,
  LINKUSDT: 0.5, AVAXUSDT: 0.5, DOGEUSDT: 0.01, SUIUSDT: 0.1, NEARUSDT: 0.1, DOTUSDT: 0.5,
  LTCUSDT: 5, TAOUSDT: 5, HYPEUSDT: 1, DJI: 500,
};

// Day Trading
const DAY_ZONE_MIN_LEG_ATR = 1.2;          // kaki impuls minimal 1.2 ATR agar zona dianggap kuat
const DAY_FAR_ATR = 2.0;                   // harga lebih dari ini dari zona trend = counter boleh dipakai
const DAY_NEAR_ATR = 1.0;                  // harga dalam jarak ini dari zona = entry NOW
const DAY_MAX_DIST_ATR = 5.0;              // zona lebih jauh dari ini tidak dipakai
const DAY_SL_MIN_ATR = 0.8;                // SL minimal 0.8 ATR M15
const DAY_SL_MAX_ATR = 2.5;                // SL maksimal 2.5 ATR M15 (lebih lebar diberi flag WIDE_SL)
const DAY_LIMIT_EXPIRE_MS = 90 * 60 * 1000; // LIMIT Day Trading batal setelah 90 menit

// ---------- Scalping: Hit & Run ----------
const HR_PULLBACK_MIN = 0.236;   // pullback minimal 23,6% dari kaki impuls
const HR_PULLBACK_MAX = 0.786;   // pullback maksimal 78,6%. Lebih dalam = struktur melemah
const HR_SWING_AGE_M5 = 30;      // kaki M5: swing maksimal 30 candle M5 yang lalu
const HR_SWING_AGE_M1 = 60;      // kaki M1: swing maksimal 60 candle M1 yang lalu
const HR_MAX_SPIKE_ATR = 2.5;    // candle trigger lebih besar dari ini = spike, tidak dikejar
const HR_MAX_CHASE_ATR = 3.5;    // harga lebih dari ini jauh dari titik pullback, tidak dikejar

const TF_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
const TF_LABEL = { '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D1' };
const KIND_NAME = { OB: 'Order Block', FVG: 'FVG', OTE: 'OTE 62-79%', FALLBACK: 'Swing' };
const ROLE_W = { htf: 3, mtf: 2, ltf: 1 };

// Harus sama dengan STYLE_TF di index.html
// kind: 'scalp'    = Hit & Run: arah M5, entry NOW saat trigger M1/M5, TP 1R / 2R / 3R
//       'day'      = Zone Strength: zona H1/M30, konfirmasi M15/M5, entry NOW atau LIMIT, TP 1.5R / 2R / psikologi
//       'intraday' = zona terbaik (skor probabilitas), TP 1.5R / 3R / 5.5R
//       'zone'     = Swing: zona fresh, TP 2R / 4.5R / 8.5R. Wajib searah HTF.
const STYLES = {
  'Scalping': {
    label: 'Scalping Hit & Run (HTF: M15 | MTF: M5 | LTF: M1)',
    mode: 'MARKET',
    kind: 'scalp',
    tf: { htf: '15m', mtf: '5m', ltf: '1m' },
    rr: [1, 2, 3],
  },
  'Day Trading': {
    label: 'Day Trading Zone (HTF: H1 | MTF: M30 | Konfirmasi: M15 + M5)',
    mode: 'MARKET',
    kind: 'day',
    tf: { htf: '1h', mtf: '30m', ltf: '5m' },
    rr: [1.5, 2, 3],
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

// Catatan kualitas (id, en). Setiap kunci yang dipakai di flags harus ada di sini.
const FLAG_TXT = {
  WIDE_SL: ['SL melebihi 2,5 ATR M15, risiko tinggi', 'SL above 2.5 ATR M15, high risk'],
  NO_TRIGGER: ['belum ada konfirmasi M5, entry mengikuti zona', 'no M5 confirmation yet, entry follows zone'],
  PSY_NONE: ['tidak ada level psikologi dalam rentang, TP3 memakai 3R', 'no psychological level in range, TP3 uses 3R'],
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

// ---------- Scalping: Hit & Run ----------

// Kaki impuls: dari swing terkonfirmasi terakhir (L untuk BUY, H untuk SELL)
// sampai ekstrem sesudahnya. Kosong jika belum ada kaki yang valid.
function hr
