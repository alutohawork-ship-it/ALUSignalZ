// api/candles.js
const BASE = process.env.XBTFX_BASE_URL || 'https://interface.xbtfx.com';

const TF = { '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D1' };
const TF_MS = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3, '4h': 14400e3, '1d': 86400e3 };

let symbolCache = { at: 0, map: null };

async function xfetch(path, opts = {}) {
    const r = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: {
            Authorization: `Bearer ${process.env.XBTFX_TOKEN}`,
            'Content-Type': 'application/json',
        },
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data };
}

// Peta kode simbol -> UUID / String Simbol
async function symbolIdMap() {
    if (symbolCache.map && Date.now() - symbolCache.at < 3600e3) return symbolCache.map;

    const map = {};

    // 1. Coba panggil endpoint publik dulu jika ada
    const rPublic = await xfetch('/v1/symbols'); 
    if (rPublic.ok && Array.isArray(rPublic.data)) {
        for (const s of rPublic.data) {
            if (s.code && (s.id || s.symbol_id)) {
                map[String(s.code).toUpperCase()] = s.id || s.symbol_id;
            }
        }
    }

    // 2. Jika publik gagal, coba panggil endpoint privat /my/symbols
    if (Object.keys(map).length === 0) {
        const rPrivate = await xfetch('/v1/my/symbols');
        if (rPrivate.ok && Array.isArray(rPrivate.data)) {
            for (const s of rPrivate.data) {
                if (s.code && s.id) {
                    map[String(s.code).toUpperCase()] = s.id;
                }
            }
        }
    }

    symbolCache = { at: Date.now(), map };
    return map;
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

    // Verifikasi sesi klien lewat endpoint login
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

    // Ambil mapping simbol. Jika tidak ditemukan/error 401, gunakan string 'symbol' secara langsung
    let map = {};
    try {
        map = await symbolIdMap();
    } catch (e) {
        // Jangan biarkan error menghentikan aplikasi, teruskan dengan string nama simbol
        console.warn('Gagal memuat peta simbol, fallback ke string simbol:', e.message);
    }

    const symbolId = map[symbol] || symbol; // Gunakan ID dari map jika ada, jika tidak ada pakai nama simbol langsung (e.g. "GBPUSD")

    // Panggil chart endpoint XBTFX
    const r = await xfetch('/v1/chart', {
        method: 'POST',
        body: JSON.stringify({ 
            symbol_id: symbolId, 
            symbol: symbol, // Sertakan juga parameter symbol sebagai cadangan jika API XBTFX mendukungnya
            timeframe: tf, 
            limit, 
            price_side: 'Bid' 
        }),
    });

    if (!r.ok) {
        return res.status(502).json({ msg: r.data?.message || `Chart XBTFX gagal (HTTP ${r.status})` });
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
