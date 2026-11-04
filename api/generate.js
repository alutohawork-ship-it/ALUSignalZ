export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { marketId, tradingStyle, currentPrice } = req.body;
    const gutsKey = process.env.GUTSAI_API_KEY;

    if (!gutsKey) {
        return res.status(500).json({ error: 'Server Error: GUTSAI_API_KEY tidak ditemukan di .env' });
    }

    try {
        const systemPrompt = `Anda adalah AI Prop Firm Trading Agent spesialis MyFundedPerps.
Target Market: ${marketId}
Harga Live Saat Ini: ${currentPrice || 'Gunakan harga pasar terkini'}
Gaya Eksekusi: ${tradingStyle}

Berdasarkan harga live tersebut, buatlah analisis teknikal dan Wajib kembalikan format JSON murni TANPA markdown formatting lain:
{
  "signal": "BUY", // BUY, SELL, atau HOLD
  "symbol": "${marketId}",
  "style": "${tradingStyle}",
  "entry_min": "3965",
  "entry_max": "3967",
  "current_price": "${currentPrice || '3966.30'}",
  "sl": "3962",
  "sl_pips": "-60 pips",
  "tp1": "3969",
  "tp1_pips": "+30 pips",
  "tp2": "3971",
  "tp2_pips": "+50 pips",
  "tp3": "3974",
  "tp3_pips": "+80 pips",
  "reason": "Konfluensi Break of Structure (BOS) pada timeframe LTF dengan sweep liquidity pada swing low."
}`;

        const gutsRes = await fetch('https://api.gutsai.id/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${gutsKey}`
            },
            body: JSON.stringify({
                model: 'claude-opus-5.5',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Buat sinyal trading JSON untuk ${marketId} pada harga ${currentPrice}.` }
                ],
                temperature: 0.1
            })
        });

        const data = await gutsRes.json();
        if (!gutsRes.ok) throw new Error(data.error?.message || `HTTP Error ${gutsRes.status}`);

        return res.status(200).json(data);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
