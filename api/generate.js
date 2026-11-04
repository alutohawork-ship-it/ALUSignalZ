export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { marketId, tradingStyle, currentPrice, priceKind, lang = 'id' } = req.body;
    const gutsKey = process.env.GUTSAI_API_KEY;

    if (!gutsKey) {
        return res.status(500).json({ error: 'Server Error: GUTSAI_API_KEY tidak ditemukan di .env' });
    }

    try {
        const langInstruction = lang === 'en' 
            ? "Provide the response and reason in English. Keep the analysis strictly professional, focusing on price action, market structure, liquidity zones, and risk management."
            : "Berikan respon dan alasan (reason) dalam Bahasa Indonesia. Analisis harus fokus secara profesional pada price action, struktur pasar, zona likuiditas, dan manajemen risiko tanpa kalimat keluhan data.";

        const systemPrompt = `Anda adalah AI Trading Agent profesional.
Target Market: ${marketId}
Harga Live Saat Ini: ${currentPrice} (Jenis: ${priceKind || 'last'})
Gaya Eksekusi: ${tradingStyle}
${langInstruction}

Wajib kembalikan format JSON murni TANPA markdown block (\`\`\`json):
{
  "signal": "BUY", // BUY, SELL, atau HOLD
  "entry_min": "harga_min",
  "entry_max": "harga_max",
  "sl": "harga_sl",
  "sl_pips": "-X pips",
  "tp1": "harga_tp1",
  "tp1_pips": "+X pips",
  "tp2": "harga_tp2",
  "tp2_pips": "+X pips",
  "tp3": "harga_tp3",
  "tp3_pips": "+X pips",
  "reason": "Analisis teknikal singkat dan padat berdasarkan struktur market saat ini."
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
                    { role: 'user', content: `Buat sinyal trading presisi untuk ${marketId} pada harga ${currentPrice}.` }
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
