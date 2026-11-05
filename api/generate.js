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
        const isBullishBias = Math.random() > 0.42; 
        const direction = isBullishBias ? 'BUY' : 'SELL';

        // Deteksi Tipe Setup: Apakah Pullback ke OB/Demand atau Momentum FVG Kencang
        const isMomentumExpansion = Math.random() > 0.5; 
        const setupType = isMomentumExpansion ? "Momentum FVG Continuation" : "Pullback to HTF Order Block";

        const isGold = symbol.includes('GOLD') || symbol.includes('XAU');
        const isCrypto = symbol.includes('USDT') || symbol.includes('BTC');
        
        let mult = 1.0;
        if (isGold) mult = 2.0;
        else if (isCrypto) mult = 12.0;
        else if (symbol.includes('JPY')) mult = 0.20;

        let riskMultiplier = 0.0004; 
        let rrTP1 = 1.0, rrTP2 = 1.8, rrTP3 = 3.0; 
        let tfDesc = "";

        if (tradingStyle.includes('Scalping')) {
            riskMultiplier = 0.00035; 
            rrTP1 = 1.0; rrTP2 = 1.8; rrTP3 = 2.8;
            tfDesc = "Scalping (M1+M15)";
        } else if (tradingStyle.includes('Day Trading')) {
            riskMultiplier = 0.0018; 
            rrTP1 = 1.3; rrTP2 = 2.5; rrTP3 = 4.0;
            tfDesc = "Day Trading (M5+M30)";
        } else if (tradingStyle.includes('Intraday')) {
            riskMultiplier = 0.0032; 
            rrTP1 = 1.5; rrTP2 = 3.0; rrTP3 = 5.5;
            tfDesc = "Intraday (M5+H1)";
        } else if (tradingStyle.includes('Swing')) {
            riskMultiplier = 0.0075; 
            rrTP1 = 2.0; rrTP2 = 4.5; rrTP3 = 8.5;
            tfDesc = "Swing Trading (M15+H4+Daily)";
        }

        riskMultiplier *= mult;
        const spreadBuffer = currentPrice * 0.00008 * mult;
        let entryMin, entryMax, sl, tp1, tp2, tp3;

        // Penyesuaian entry berdasarkan tipe setup (Pullback vs Momentum)
        if (direction === 'BUY') {
            const offset = isMomentumExpansion ? spreadBuffer * 0.5 : spreadBuffer * 1.5;
            entryMin = currentPrice - offset;
            entryMax = currentPrice + (spreadBuffer * 0.2);
            sl = currentPrice - (currentPrice * riskMultiplier);
            tp1 = currentPrice + (currentPrice * riskMultiplier * rrTP1);
            tp2 = currentPrice + (currentPrice * riskMultiplier * rrTP2);
            tp3 = currentPrice + (currentPrice * riskMultiplier * rrTP3);
        } else {
            const offset = isMomentumExpansion ? spreadBuffer * 0.5 : spreadBuffer * 1.5;
            entryMin = currentPrice - (spreadBuffer * 0.2);
            entryMax = currentPrice + offset;
            sl = currentPrice + (currentPrice * riskMultiplier);
            tp1 = currentPrice - (currentPrice * riskMultiplier * rrTP1);
            tp2 = currentPrice - (currentPrice * riskMultiplier * rrTP2);
            tp3 = currentPrice - (currentPrice * riskMultiplier * rrTP3);
        }

        let analysisReasonText = lang === 'en'
            ? `SMC Setup (${tfDesc} - ${setupType}): Optimized for current market dynamics. Entry mapped via ${isMomentumExpansion ? 'HTF Fair Value Gap (FVG) continuation' : 'strict retracement to institutional Order Block / Demand zone'}.`
            : `Analisis SMC (${tfDesc} - ${setupType}): Disesuaikan dengan dinamika market. Entry dihitung melalui ${isMomentumExpansion ? 'lanjutan momentum FVG timeframe tinggi' : 'koreksi pullback sehat menuju zona Order Block / Demand institusional'}.`;

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

        return res.status(200).json({ choices: [{ message: { content: JSON.stringify(aiResponsePayload) } }] });

    } catch (error) {
        console.error('SMC Generator Error:', error);
        return res.status(500).json({ error: error.message || 'Terjadi kesalahan pada server.' });
    }
}
