// api/stream-token.js
// Mengembalikan token XBTFX hanya untuk klien yang sesinya valid.
// Token dibaca dari environment variable XBTFX_TOKEN di Vercel.
//
// Perubahan:
// - Gangguan KV / layanan login (ok:false dengan key kvError, atau respons tidak terbaca)
//   sekarang membalas 503, bukan 401. Frontend jadi tidak salah menampilkan "SESI INVALID".
// - 401 hanya dipakai jika sesi benar-benar tidak valid (email tidak terdaftar, expired, dll).
// - Role admin juga diizinkan (sebelumnya hanya 'client', sehingga admin selalu 401).

const LOGIN_RETRY = 2;

async function verifySession(host, value) {
    let lastErr = null;
    for (let attempt = 0; attempt < LOGIN_RETRY; attempt++) {
        try {
            const r = await fetch(`https://${host}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value }),
            });
            const text = await r.text();
            let data = null;
            try { data = JSON.parse(text); } catch {}
            if (data && typeof data === 'object') return { ok: true, data };
            lastErr = new Error(`login HTTP ${r.status}: respons tidak valid`);
        } catch (e) {
            lastErr = e;
        }
        await new Promise(res => setTimeout(res, 300));
    }
    console.error('stream-token verify:', lastErr && lastErr.message);
    return { ok: false, unreachable: true };
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
    if (!value) {
        return res.status(401).json({ msg: 'Sesi tidak valid, silakan login ulang.' });
    }

    const check = await verifySession(req.headers.host, value);
    if (!check.ok) {
        return res.status(503).json({ msg: 'Layanan verifikasi sedang gangguan, coba lagi sebentar.' });
    }

    const session = check.data;

    // Login gagal karena gangguan layanan (mis. KV), bukan karena sesinya salah
    if (!session.ok && session.key === 'kvError') {
        return res.status(503).json({ msg: 'Layanan akses sedang gangguan, coba lagi sebentar.' });
    }

    if (!session.ok || !['client', 'admin'].includes(session.role)) {
        return res.status(401).json({ msg: 'Sesi tidak valid, silakan login ulang.' });
    }

    const token = process.env.XBTFX_TOKEN;
    if (!token) {
        return res.status(500).json({ msg: 'XBTFX_TOKEN belum diisi di Vercel.' });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ token });
};
