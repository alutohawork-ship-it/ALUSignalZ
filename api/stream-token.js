// api/stream-token.js
// Mengembalikan token xbtfx hanya untuk klien yang sudah login.
// Token dibaca dari environment variable XBTFX_TOKEN di Vercel.

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ msg: 'Method not allowed' });
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
    }
    const value = String(body?.value || '').trim();
    if (!value) {
        return res.status(401).json({ msg: 'Sesi tidak valid, silakan login ulang.' });
    }

    // Verifikasi sesi memakai endpoint login yang sudah ada
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

    const token = process.env.XBTFX_TOKEN;
    if (!token) {
        return res.status(500).json({ msg: 'XBTFX_TOKEN belum diisi di Vercel.' });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ token });
};
