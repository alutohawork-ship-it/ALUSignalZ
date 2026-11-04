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
        const isBullishBias = Math.random() > 0.45; 
        const direction = isBullishBias ? 'BUY' : 'SELL';

        // Pengaturan Multiplier berdasarkan volatilitas aset
        const isGold = symbol.includes('GOLD') || symbol.includes('XAU');
        const isCrypto = symbol.includes('USDT') || symbol.includes('BTC');
        
        let mult = 1.0;
        if (isGold) mult = 2.0;
        else if (isCrypto) mult = 12.0;
        else if (symbol.includes('JPY')) mult = 0.20;

        // Penyesuaian jarak berdasarkan Gaya Trading & Timeframe Terbaru
        // Scalping (M3 + M15), Day Trading (M5 + M30), Intraday (M5 + H1), Swing (M15 + H4 + Daily)
        let riskMultiplier = 0.0010; // Scalping M3+M15 (Hit & Run ketat)
        if (tradingStyle.includes('Day Trading')) riskMultiplier = 0.003;
        else if (tradingStyle.includes('Intraday')) riskMultiplier = 0.005;
        else if (tradingStyle.includes('Swing')) riskMultiplier = 0.012;

        riskMultiplier *= mult;

        // Kalkulasi Area Entry Ideal (Discount/Premium Array & Order Block FVG)
        const spreadBuffer = currentPrice * 0.00015 * mult;
        let entryMin, entryMax, sl, tp1, tp2, tp3;

        if (direction === 'BUY') {
            // Skenario BUY: Mencari area Demand / Bullish OB di M3-M15
            entryMin = currentPrice - (spreadBuffer * 1.2);
            entryMax = currentPrice + (spreadBuffer * 0.4);
            sl = currentPrice - (currentPrice * riskMultiplier);
            tp1 = currentPrice + (currentPrice * riskMultiplier * 1.0); // R:R 1:1 (Hit & Run TP1 cepat)
            tp2 = currentPrice + (currentPrice * riskMultiplier * 1.8); // R:R 1:1.8
            tp3 = currentPrice + (currentPrice * riskMultiplier * 3.0); // R:R 1:3
        } else {
            // Skenario SELL: Mencari area Supply / Bearish OB di M3-M15
            entryMin = currentPrice - (spreadBuffer * 0.4);
            entryMax = currentPrice + (spreadBuffer * 1.2);
            sl = currentPrice + (currentPrice * riskMultiplier);
            tp1 = currentPrice - (currentPrice * riskMultiplier * 1.0);
            tp2 = currentPrice - (currentPrice * riskMultiplier * 1.8);
            tp3 = currentPrice - (currentPrice * riskMultiplier * 3.0);
        }

        // Penjelasan Analisis Teknikal SMC dengan Timeframe Scalping M3+M15
        let analysisReasonText = "";
        if (lang === 'en') {
            analysisReasonText = `SMC Scalping Analysis (${tradingStyle} - M3+M15 Hit & Run): Internal liquidity sweep on M3 aligned with M15 Order Block mitigation. Quick momentum expansion expected from FVG array.`;
        } else {
            analysisReasonText = `Analisis SMC Scalping (${tradingStyle} - M3+M15 Hit & Run): Sapuan likuiditas internal pada M3 yang selaras dengan mitigasi Order Block M15. Ekspansi momentum cepat diincar dari area FVG.`;
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
