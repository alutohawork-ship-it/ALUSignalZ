import engine from '../smc-signal-engine.js';

const MIN_CANDLES = 150;
const MAX_CANDLES = 1000;

function isValidCandle(x) {
  return x && [x.t, x.o, x.h, x.l, x.c].every(v => Number.isFinite(Number(v)));
}

function validateBody(body) {
  if (!body.marketId || typeof body.marketId !== 'string') {
    return 'marketId wajib diisi.';
  }
  if (!body.tradingStyle || typeof body.tradingStyle !== 'string') {
    return 'tradingStyle wajib diisi.';
  }
  for (const key of ['htf', 'ltf']) {
    const rows = body[key];
    if (!Array.isArray(rows)) return `${key} harus berupa array.`;
    if (rows.length < MIN_CANDLES) {
      return `${key} minimal ${MIN_CANDLES} candle (saat ini ${rows.length}).`;
    }
    if (rows.length > MAX_CANDLES) {
      return `${key} maksimal ${MAX_CANDLES} candle (saat ini ${rows.length}).`;
    }
    if (!rows.every(isValidCandle)) {
      return `${key} berisi candle yang tidak valid (butuh t, o, h, l, c).`;
    }
  }
  return null;
}

export default async function generate(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    let body = req.body ?? {};
    if (typeof body === 'string') body = JSON.parse(body);

    const error = validateBody(body);
    if (error) return res.status(400).json({ error });

    req.body = body;
    return await engine(req, res);
  } catch (e) {
    console.error('generate error:', e);
    if (!res.headersSent) {
      return res.status(500).json({ error: e.message || 'Terjadi kesalahan pada server.' });
    }
  }
}
