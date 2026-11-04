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
Harga Live Saat Ini: ${currentPrice}
Gaya Eksekusi: ${tradingStyle}

TUGAS UTAMA: Berdasarkan harga live ${currentPrice} tersebut, hitung secara matematis level harga riil untuk scalping/daytrading prop firm. Jangan pernah bilang tidak punya akses harga. 

Wajib kembalikan format JSON MURNI tanpa teks pembuka/penutup, tanpa markdown block (contoh: jangan pakai \`\`\`json):
{
  "signal": "BUY",
  "entry_min": "1.1250",
  "entry_max": "1.1255",
  "current_price": "${currentPrice}",
  "sl": "1.1220",
  "sl_pips": "-30 pips",
  "tp1": "1.1275",
  "tp1_pips": "+25 pips",
  "tp2": "1.1290",
  "tp2_pips": "+40 pips",
  "tp3": "1.1320",
  "tp3_pips": "+70 pips",
  "reason": "Konfluensi struktur market terdekat pada harga ${currentPrice} dengan manajemen risiko ketat prop firm."
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
                    { role: 'user', content: `Buat format JSON sinyal untuk ${marketId} di harga ${currentPrice}.` }
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
