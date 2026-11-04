// api/generate.js
// AI HANYA menulis penjelasan. Arah sinyal & level entry/SL/TP dihitung engine di index.html dari candle asli.

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const gutsKey = process.env.GUTSAI_API_KEY;
    const model = process.env.GUTSAI_MODEL || 'claude-opus-5.5'; // bisa diganti lewat env tanpa edit kode

    if (!gutsKey) {
        return res.status(500).json({ error: 'Server Error: GUTSAI_API_KEY tidak ditemukan di .env' });
    }

    let body = req.body || {};
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Body bukan JSON valid' }); }
    }

    const { marketId, tradingStyle, currentPrice, engine, mode } = body;

    // index.html versi lama (tanpa engine) ditolak, supaya AI tidak lagi mengarang level
    if (mode !== 'explain' || !engine) {
        return res.status(400).json({
            error: 'Request tidak berisi data engine. Update index.html ke versi yang menganalisa candle (mode "explain").'
        });
    }

    const systemPrompt = `Anda adalah analis trading prop firm (MyFundedPerps).
Data yang diberikan adalah HASIL HITUNGAN ENGINE dari candle asli: bias timeframe besar, indikator (EMA, RSI, MACD, ADX, volume), struktur market (BOS/CHoCH), dan SMC (liquidity sweep, order block, FVG).

ATURAN WAJIB:
- JANGAN mengubah, menambah, atau menghitung ulang level harga apa pun.
- JANGAN mengganti arah sinyal dari engine.
- Gunakan HANYA fakta yang ada di data engine. Jangan mengarang pola atau level lain.
- Tulis maksimal 3 kalimat bahasa Indonesia: alasan utama sinyal dan risiko yang perlu diwaspadai.
- Jika signal HOLD, jelaskan konfirmasi apa yang perlu ditunggu sebelum entry.

Balas HANYA JSON murni tanpa markdown, format:
{"reason": "..."}`;

    const userContent = JSON.stringify({
        pair: marketId,
        style: tradingStyle,
        livePrice: currentPrice,
        engine
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);

    try {
        const gutsRes = await fetch('https://api.gutsai.id/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${gutsKey}`
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent }
                ],
                temperature: 0.2,
                max_tokens: 400
            }),
            signal: ctrl.signal
        });

        const data = await gutsRes.json();
        if (!gutsRes.ok) throw new Error(data.error?.message || `HTTP Error ${gutsRes.status}`);

        return res.status(200).json(data); // format: choices[0].message.content

    } catch (error) {
        const msg = error.name === 'AbortError' ? 'AI timeout (>25 detik)' : error.message;
        return res.status(500).json({ error: msg });
    } finally {
        clearTimeout(timer);
    }
}
