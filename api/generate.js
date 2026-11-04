export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { marketId, htf, ltf } = req.body;
    
    // Mengambil API Key rahasia dari Environment Variables Vercel (.env)
    const gutsKey = process.env.GUTSAI_API_KEY;
    const myfundedKey = process.env.MYFUNDED_API_KEY;

    if (!gutsKey) {
        return res.status(500).json({ error: 'Server Error: GUTSAI_API_KEY tidak ditemukan di .env' });
    }

    try {
        // 1. Ambil spesifikasi detail market dari REST API MyFundedPerps
        let marketSpecs = null;
        try {
            const cleanMarketId = encodeURIComponent(marketId);
            const specsRes = await fetch(`https://developers.myfundedperpetuals.com/v1/markets/${cleanMarketId}`, {
                headers: myfundedKey ? { 'Authorization': `Bearer ${myfundedKey}` } : {}
            });
            if (specsRes.ok) {
                const specsData = await specsRes.json();
                marketSpecs = specsData.data;
            }
        } catch (e) {
            console.log("Specs fetch fallback to default");
        }

        const maxLeverage = marketSpecs?.max_leverage || "10";
        const minNotional = marketSpecs?.min_notional || "10";

        // 2. Kirim instruksi ke GutsAI Engine
        const systemPrompt = `Anda adalah AI Prop Firm Trading Agent spesialis MyFundedPerps. 
Target Market: ${marketId}
Max Leverage Venue: ${maxLeverage}x
Min Notional: $${minNotional}
Timeframe HTF: ${htf} | LTF: ${ltf}

Evaluasi kondisi teknikal dan berikan output terstruktur dalam Bahasa Indonesia:
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
                model: 'guts-default',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Analisis sinyal live untuk ${marketId}.` }
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
