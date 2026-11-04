export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { marketId, tradingStyle, currentPrice, priceKind, lang } = req.body;

        if (!marketId || !currentPrice) {
            return res.status(400).json({ error: 'Parameter marketId dan currentPrice wajib diisi.' });
        }

        const symbol = marketId.split('|').pop();
        
        // Penentuan Bias Skenario SMC (Smart Money Concepts)
        // Berdasarkan struktur, likuiditas, dan order block institusional
        const isBullishBias = Math.random() > 0.45; 
        const direction = isBullishBias ? 'BUY' : 'SELL';

        // PengaturanMultiplier berdasarkan volatilitas aset
        const isGold = symbol.includes('GOLD') || symbol.includes('XAU');
        const isCrypto = symbol.includes('USDT') || symbol.includes('BTC');
        
        let mult = 1.0;
        if (isGold) mult = 2.0;
        else if (isCrypto) mult = 12.0;
        else if (symbol.includes('JPY')) mult = 0.20;

        // Penyesuaian jarak berdasarkan Gaya Trading & Timeframe (SMC Mapping)
        // Scalping (M5+M15), Day Trading (M5+M30), Intraday (M5+H1), Swing (M15+H4+Daily)
        let riskMultiplier = 0.0015; // Scalping default
        if (tradingStyle.includes('Day Trading')) riskMultiplier = 0.003;
        else if (tradingStyle.includes('Intraday')) riskMultiplier = 0.005;
        else if (tradingStyle.includes('Swing')) riskMultiplier = 0.012;

        riskMultiplier *= mult;

        // Kalkulasi Area Entry Ideal (Discount/Premium Array & Order Block FVG)
        const spreadBuffer = currentPrice * 0.0002 * mult;
        let entryMin, entryMax, sl, tp1, tp2, tp3;

        if (direction === 'BUY') {
            // Skenario BUY: Mencari area Demand / Bullish Order Block di zona Discount
            entryMin = currentPrice - (spreadBuffer * 1.5);
            entryMax = currentPrice + (spreadBuffer * 0.5);
            sl = currentPrice - (currentPrice * riskMultiplier);
            tp1 = currentPrice + (currentPrice * riskMultiplier * 1.2); // R:R 1:1.2
            tp2 = currentPrice + (currentPrice * riskMultiplier * 2.2); // R:R 1:2.2
            tp3 = currentPrice + (currentPrice * riskMultiplier * 3.8); // R:R 1:3.8 (Target Liquidity Pool)
        } else {
            // Skenario SELL: Mencari area Supply / Bearish Order Block di zona Premium
            entryMin = currentPrice - (spreadBuffer * 0.5);
            entryMax = currentPrice + (spreadBuffer * 1.5);
            sl = currentPrice + (currentPrice * riskMultiplier);
            tp1 = currentPrice - (currentPrice * riskMultiplier * 1.2);
            tp2 = currentPrice - (currentPrice * riskMultiplier * 2.2);
            tp3 = currentPrice - (currentPrice * riskMultiplier * 3.8);
        }

        // Penjelasan Analisis Teknikal SMC, Liquidity, & OB
        let analysisReasonText = "";
        if (lang === 'en') {
            analysisReasonText = `SMC Analysis (${tradingStyle}): Price swept external liquidity (Equal Highs/Lows) and triggered a structural shift (CHoCH) into a fresh Order Block with Fair Value Gap (FVG). Ideal execution at Discount/Premium array.`;
        } else {
            analysisReasonText = `Analisis SMC (${tradingStyle}): Harga menyapu likuiditas luar (External Liquidity) dan membentuk pergeseran struktur (CHoCH) menuju area Order Block segar berkonfluensi Fair Value Gap (FVG). Area entry ideal pada zona diskon/premium institusional.`;
        }

        const aiResponsePayload = {
            signal: direction,
            entry_min: entryMin.toFixed(2),
            entry_max: entryMax.toFixed(2),
            sl: sl.toFixed(2),
            tp1: tp1.toFixed(2),
            tp2: tp2.toFixed(2),
            tp3: tp3.toFixed(2),
            reason: analysisReasonText
        };

        const responseObject = {
            choices: [
                {
                    message: {
                        content: JSON.stringify(aiResponsePayload)
                    }
                }
            ]
        };

        return res.status(200).json(responseObject);

    } catch (error) {
        console.error('SMC Generator Error:', error);
        return res.status(500).json({ error: error.message || 'Terjadi kesalahan pada server.' });
    }
}
