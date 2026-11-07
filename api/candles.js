// api/candles.js (Versi MT5 API XBTFX)
const BASE = process.env.XBTFX_BASE_URL || 'https://interface.xbtfx.com';

const TF = { '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D1' };
const TF_MS = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3, '4h': 14400e3, '1d': 86400e3 };

async function xfetch(path, opts = {}) {
    // Menyesuaikan header untuk MT5 API Key (tergantung dokumentasi XBTFX, 
    // biasanya menggunakan Bearer atau header khusus seperti x-api-key)
    const r = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: {
            'Authorization': `Bearer ${process.env.XBTFX_TOKEN}`,
            'x-mt5-account': '2121955946', // Menyertakan akun MT5 Anda jika diperlukan oleh API
            'Content-Type': 'application/json',
            ...(opts.headers || {})
        },
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ msg: 'Method not allowed' });
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
    }
    const value = String(body?.value || '').trim();
    const symbol = String(body?.symbol || '').trim().toUpperCase();
    const interval = String(body?.interval || '');
    const limit = Math.min(Math.max(parseInt(body?.limit, 10) || 500, 1), 1000);

    // Verifikasi sesi klien
    let session = {};
    try {
        const r = await fetch(`https://${req.headers.host}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value }),
        });
        session = await r.json();
    } catch {
        return res.status(502).json({ msg: 'Gagal memverifikasi sesi.' });
    }
    if (!session.ok || session.role !== 'client') {
        return res.status(401).json({ msg: 'Sesi tidak valid, silakan login ulang.' });
    }

    const tf = TF[interval];
    if (!tf || !symbol) {
        return res.status(400).json({ msg: 'Simbol atau interval tidak valid.' });
    }
    if (!process.env.XBTFX_TOKEN) {
        return res.status(500).json({ msg: 'XBTFX_TOKEN belum diisi di Vercel.' });
    }

    // Panggil endpoint chart MT5 langsung menggunakan nama simbol
    const r = await xfetch('/v1/chart', {
        method: 'POST',
        body: JSON.stringify({ 
            symbol: symbol, 
            timeframe: tf, 
            limit, 
            price_side: 'Bid' 
        }),
    });

    if (!r.ok) {
        return res.status(502).json({ msg: r.data?.message || `MT5 Chart API gagal (HTTP ${r.status})` });
    }

    const now = Date.now();
    const tfMs = TF_MS[interval];
    const candles = (r.data?.candles || [])
        .map(c => ({
            openTime: Date.parse(c.open_time),
            open: +c.open,
            high: +c.high,
            low: +c.low,
            close: +c.close,
        }))
        .filter(c => [c.openTime, c.open, c.high, c.low, c.close].every(Number.isFinite)
            && c.openTime + tfMs <= now)
        .sort((a, b) => a.openTime - b.openTime);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ candles });
};
