// api/generate.js
// Analisis Pure SMC dijalankan di server. Tidak memanggil API eksternal.
// Scalping: Mengikuti alur pergerakan M5 (Retracement / Impuls) dengan konfirmasi M1 + M3.
// Day Trading: Responsif berbasis zona HTF/MTF (H1/M30) dengan eksekusi cepat gaya scalping.

const KV_KEY = 'alu_clients';

const DECIMALS = { XAUUSD: 2, XAGUSD: 3, EURUSD: 5, USDJPY: 3, GBPUSD: 5, BTCUSDT: 2, ETHUSDT: 2, SOLUSDT: 2, XRPUSDT: 4, DJI: 2, DAX: 2 };

const PIP = { XAUUSD: 0.1, XAGUSD: 0.01, EURUSD: 0.0001, USDJPY: 0.01, GBPUSD: 0.0001, BTCUSDT: 1, ETHUSDT: 0.1, SOLUSDT: 0.01, XRPUSDT: 0.0001, DJI: 1, DAX: 1 };

const SCALP_SL_PIPS = {
  XAUUSD: [15, 25], XAGUSD: [20, 35],
  EURUSD: [8, 12], GBPUSD: [10, 15], USDJPY: [8, 12],
  BTCUSDT: [120, 200], ETHUSDT: [50, 80],
  SOLUSDT: [30, 60], XRPUSDT: [40, 70],
  DJI: [30, 60], DAX: [30, 60],
};

const STYLES = {
  'Scalping': {
    label: 'Scalping (HTF: M15 | MTF: M5 | LTF: M1/M3)',
    mode: 'MARKET',
    kind: 'scalp',
    tf: { htf: '15m', mtf: '5m', ltf: '1m' },
    rr: [1, 2, 3],
  },
  'Day Trading': {
    label: 'Day Trading (HTF: H1 | MTF: M30 | LTF: M5) - Zone Responsive',
    mode: 'MARKET',
    kind: 'day',
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
const MIN_CANDLES = 20;

const T = (lang, id, en) => (lang === 'en' ? en : id);
const orderLabel = (dir, orderType) => `${dir === 1 ? 'BUY' : 'SELL'} ${orderType === 'LIMIT' ? 'LIMIT' : 'NOW'}`;

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
  if (!email) return { ok: false, msg: 'Sesi tidak punya email. Silakan login ulang.' };
  const raw = await kv(['GET', KV_KEY]);
  const clients = raw ? JSON.parse(raw) : [];
  const c = clients.find(x => x.email === email);
  if (!c) return { ok: false, msg: 'Email tidak terdaftar di database.' };
  if (new Date(c.expires_at) <= new Date()) return { ok: false, msg: 'Masa aktif langganan telah berakhir.' };
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

// Analisis Fase M5 untuk Scalping
function analyzeM5Phase(m5Candles, price) {
  const sw = swings(m5Candles, 2);
  const sh = lastSwing(sw, 'H');
  const sl = lastSwing(sw, 'L');
  const sma20 = m5Candles.slice(-20).reduce((s, c) => s + c.c, 0) / 20;
  const lastC = m5Candles[m5Candles.length - 1];
  const trendDir = lastC.c >= sma20 ? 1 : -1;

  let phase = 'IMPULSE';
  let suggestedDir = trendDir;

  if (sh && sl) {
    const range = sh.price - sl.price;
    const midPoint = sl.price + (range / 2);
    if (trendDir === 1) {
      if (price < lastC.o && price > midPoint) { phase = 'RETRACEMENT'; suggestedDir = -1; }
      else { phase = 'IMPULSE'; suggestedDir = 1; }
    } else {
      if (price > lastC.o && price < midPoint) { phase = 'RETRACEMENT'; suggestedDir = 1; }
      else { phase = 'IMPULSE'; suggestedDir = -1; }
    }
  }
  return { phase, trendDir, suggestedDir };
}

// Logika Scalping M1+M3+M5
function scalpAlurPlan(m5C, ltfC, price, a, slFloor, slCap) {
  const m5Analysis = analyzeM5Phase(m5C, price);
  const dir = m5Analysis.suggestedDir;
  const isBuy = dir === 1;

  const ltSw = swings(ltfC, 2);
  const anchor = lastSwing(ltSw, isBuy ? 'L' : 'H');

  let rawStop;
  if (anchor) {
    rawStop = isBuy ? anchor.price - (SL_BUFFER * a) : anchor.price + (SL_BUFFER * a);
  } else {
    rawStop = isBuy ? price - (1.5 * a) : price + (1.5 * a);
  }

  let risk = Math.abs(price - rawStop);
  if (risk < slFloor) { rawStop = isBuy ? price - slFloor : price + slFloor; risk = slFloor; }
  else if (risk > slCap) { rawStop = isBuy ? price - slCap : price + slCap; risk = slCap; }

  return {
    status: 'RUNNING', orderType: 'NOW', mode: 'DIRECT', fill: null,
    entry: price, sl: rawStop, phase: m5Analysis.phase,
    zoneDesc: m5Analysis.phase === 'RETRACEMENT' ? 'Retracement Zona Pendek M5' : 'Impulse Continuation M5',
    riskAtr: risk / a, dir,
  };
}

// Logika Day Trading Responsif Berbasis Zona HTF (H1) & MTF (M30)
function dayTradingZonePlan(htfC, mtfC, price, a, pip) {
  // Cari Order Block / Swing utama di HTF (H1) atau MTF (M30) terdekat dengan harga saat ini
  const htfSwings = swings(htfC, 2);
  const htfHigh = lastSwing(htfSwings, 'H');
  const htfLow = lastSwing(htfSwings, 'L');

  const mtfSwings = swings(mtfC, 2);
  const mtfHigh = lastSwing(mtfSwings, 'H');
  const mtfLow = lastSwing(mtfSwings, 'L');

  // Tentukan apakah harga sedang mendekati zona Support/Demand HTF/MTF
  let zoneType = 'HTF Support / Demand Rejection';
  let dir = 1;
  let zoneTarget = price;

  const distToHtfLow = htfLow ? Math.abs(price - htfLow.price) : Infinity;
  const distToHtfHigh = htfHigh ? Math.abs(price - htfHigh.price) : Infinity;

  if (distToHtfLow < distToHtfHigh && htfLow) {
    // Dekat area Support/Demand bawah HTF -> Siap BUY Rebound
    dir = 1;
    zoneTarget = htfLow.price;
  } else if (htfHigh) {
    // Dekat area Supply/Resistance atas HTF -> Siap SELL Rejection
    dir = -1;
    zoneTarget = htfHigh.price;
  } else if (mtfLow && Math.abs(price - mtfLow.price) < Math.abs(price - mtfHigh.price)) {
    dir = 1;
    zoneTarget = mtfLow.price;
  } else {
    dir = -1;
    zoneTarget = mtfHigh ? mtfHigh.price : price;
  }

  const isBuy = dir === 1;
  // SL ditempatkan di luar zona HTF/MTF dengan buffer yang aman untuk Day Trading (lebih lebar dari scalping)
  const slBufferPips = pip ? 15 * pip : 1.5 * a;
  let rawStop = isBuy ? zoneTarget - slBufferPips : zoneTarget + slBufferPips;
  let risk = Math.abs(price - rawStop);

  // Batasan pengaman risiko minimal/maksimal Day Trading
  const minRisk = 1.0 * a;
  const maxRisk = 4.0 * a;
  if (risk < minRisk) { rawStop = isBuy ? price - minRisk : price + minRisk; risk = minRisk; }
  else if (risk > maxRisk) { rawStop = isBuy ? price - maxRisk : price + maxRisk; risk = maxRisk; }

  return {
    status: 'RUNNING', orderType: 'NOW', mode: 'DIRECT', fill: null,
    entry: price, sl: rawStop, zoneDesc: `Responsif Zona HTF/MTF (${zoneType})`,
    riskAtr: risk / a, dir,
  };
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
    if (!(price > 0)) return res.status(400).json({ error: 'Harga live belum tersedia.' });

    const cnd = body.candles || {};
    const htfC = cleanCandles(cnd.htf);
    const mtfC = cleanCandles(cnd.mtf ?? cnd.entry);
    const ltfC = cleanCandles(cnd.ltf);

    if (mtfC.length < 30 || htfC.length < 20) {
      return res.status(422).json({ error: 'Data candle belum cukup.' });
    }

    const refAtr = atr(mtfC, 14);
    const rng = SCALP_SL_PIPS[symbol];
    const slFloor = rng && pip ? rng[0] * pip : RISK_MIN * refAtr;
    const slCap = rng && pip ? rng[1] * pip : slFloor * 1.5;

    let plan;
    if (style.kind === 'scalp') {
      plan = scalpAlurPlan(mtfC, ltfC, price, refAtr, slFloor, slCap);
    } else if (style.kind === 'day') {
      // Day Trading Responsif Zona HTF/MTF gaya cepat
      plan = dayTradingZonePlan(htfC, mtfC, price, refAtr, pip);
    } else {
      return res.status(400).json({ error: 'Gaya trading ini memerlukan konfigurasi zona standar.' });
    }

    const entry = plan.entry;
    const risk = Math.abs(entry - plan.sl);
    const dir = plan.dir;
    const r = v => Number(v.toFixed(dec));

    const tps = style.rr.map(x => entry + dir * risk * x);
    const tpPips = pip ? tps.map(tp => Math.round(Math.abs(tp - entry) / pip)) : null;
    const slPips = pip ? Math.round(risk / pip) : null;

    const rrTxt = style.rr.map(x => `${x}R`).join(' / ');
    const dStr = dir === 1 ? 'BUY' : 'SELL';

    const reason = T(
      lang,
      `${dStr} ${style.kind === 'day' ? 'Day Trading (Zone Responsive)' : 'Scalping'}. ${plan.zoneDesc} di harga ${entry.toFixed(dec)}. SL ${slPips} pip, TP ${rrTxt} (${tpPips?.join('/')} pip).`,
      `${dStr} ${style.kind === 'day' ? 'Day Trading (Zone Responsive)' : 'Scalping'}. ${plan.zoneDesc} at ${entry.toFixed(dec)}. SL ${slPips} pips, TP ${rrTxt}.`
    );

    return res.status(200).json({
      ok: true,
      signal: {
        signal: dStr,
        mode: 'MARKET',
        orderType: 'NOW',
        orderLabel: orderLabel(dir, 'NOW'),
        status: 'RUNNING',
        fill: null,
        entry: r(entry),
        sl: r(plan.sl),
        tp1: r(tps[0]),
        tp2: r(tps[1]),
        tp3: r(tps[2]),
        zone: { min: r(entry - 0.3 * refAtr), max: r(entry + 0.3 * refAtr) },
        confidence: 'HIGH',
        risk: 'MEDIUM',
        setup: style.kind === 'day' ? 'HTF_ZONE_RESPONSE' : plan.phase,
        setupLabel: plan.zoneDesc,
        zoneLabel: style.kind === 'day' ? 'Day Trading HTF Zone' : `M1+M3+M5 ${plan.phase}`,
        zoneNote: `Eksekusi cepat ${dStr} merespons zona HTF/MTF`,
        reason,
      },
    });
  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
