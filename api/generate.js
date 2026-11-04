export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { marketId, tradingStyle } = req.body;
    const gutsKey = process.env.GUTSAI_API_KEY;

    if (!gutsKey) {
        return res.status(500).json({ error: 'Server Error: GUTSAI_API_KEY tidak ditemukan di .env' });
    }

    try {
        const systemPrompt = `Anda adalah AI Prop Firm Trading Agent spesialis MyFundedPerps. 
Target Market: ${marketId}
Gaya Eksekusi: ${tradingStyle}

Evaluasi kondisi teknikal sesuai gaya trading tersebut dan berikan output terstruktur dalam Bahasa Indonesia:
- SIGNAL: [BUY / SELL / HOLD]
- ENTRY: [Harga entry]
- SL: [Stop Loss]
- TP: [Take Profit]
- REASON: [Alasan konfluensi price action]`;

        const gutsRes = await fetch('https://api.gutsai.id/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${gutsKey}`
            },
            body: JSON.stringify({
                model: 'guts-default', // Sesuaikan dengan model GutsAI Anda jika berbeda
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Analisis sinyal live untuk ${marketId} dengan gaya ${tradingStyle}.` }
                ],
                temperature: 0.2
            })
        });

        const data = await gutsRes.json();
        if (!gutsRes.ok) throw new Error(data.error?.message || `HTTP Error ${gutsRes.status}`);

        return res.status(200).json(data);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
