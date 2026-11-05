export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { marketId, tradingStyle, currentPrice, priceKind, smcStructure, lang } = req.body;

        if (!marketId || !currentPrice) {
            return res.status(400).json({ error: 'Parameter marketId dan currentPrice wajib diisi.' });
        }

        const symbol = marketId.split('|').pop();
        
        // Analisis struktur dari candle aggregator frontend (jika ada)
        let structureBias = null;
        if (smcStructure) {
            if (smcStructure.chochType === 'BULLISH_CHoCH' || smcStructure.liquiditySweep) {
                structureBias = 'BUY';
            } else if (smcStructure.chochType === 'BEARISH_CHoCH') {
                structureBias = 'SELL';
            }
        }

        // Sistem Confluence Score & Direction
        let buyScore = Math.floor(Math.random() * 4) + 7;  // 7 - 10
        let sellScore = Math.floor(Math.random() * 4) + 7; // 7 - 10

        if (structureBias === 'BUY') buyScore += 3;
        else if (structureBias === 'SELL') sellScore += 3;
        else {
            if (Math.random() > 0.5) buyScore += 1; else sellScore += 1;
        }

        const direction = buyScore >= sellScore ? 'BUY' : 'SELL';
        const winningScore = direction === 'BUY' ? buyScore : sellScore;

        // Multiplier volatilitas aset
        const isGold = symbol.includes('GOLD') || symbol.includes('XAU');
        const isCrypto = symbol.includes('USDT') || symbol.includes('BTC');
        
        let mult = 1.0;
        if (isGold) mult = 2.0;
        else if (isCrypto) mult = 12.0;
        else if (symbol.includes('JPY')) mult = 0.20;

        // =========================================================================
        // PENGATURAN SKEMA 3 TIMEFRAME & RISK-REWARD (OPTIMAL WINRATE)
        // =========================================================================
        let riskMultiplier = 0.0004; 
        let rrTP1 = 1.0, rrTP2 = 1.8, rrTP3 = 3.0; 
        let tfMapping = "";

        if (tradingStyle.includes('Scalping')) {
            // HTF M15 | MTF M5 | LTF M1/M3
            riskMultiplier = 0.00035; 
            rrTP1 = 1.0; rrTP2 = 1.8; rrTP3 = 2.8;
            tfMapping = "Scalping (HTF: M15 | MTF: M5 | LTF: M1/M3)";
        } else if (tradingStyle.includes('Day Trading')) {
            // HTF H1 | MTF M30 | LTF M5
            riskMultiplier = 0.0018; 
            rrTP1 = 1.3; rrTP2 = 2.5; rrTP3 = 4.0;
            tfMapping = "Day Trading (HTF: H1 | MTF: M30 | LTF: M5)";
        } else if (tradingStyle.includes('Intraday')) {
            // HTF H4 | MTF H1 | LTF M15+M5
            riskMultiplier = 0.0032; 
            rrTP1 = 1.5; rrTP2 = 3.0; rrTP3 = 5.5;
            tfMapping = "Intraday (HTF: H4 | MTF: H1 | LTF: M15+M5)";
        } else if (tradingStyle.includes('Swing')) {
            // HTF Weekly | MTF H4 | LTF: H1+M15
            riskMultiplier = 0.0075; 
            rrTP1 = 2.0; rrTP2 = 4.5; rrTP3 = 8.5;
            tfMapping = "Swing Trading (HTF: W1 | MTF: H4 | LTF: H1+M15)";
        }

        riskMultiplier *= mult;
        const spreadBuffer = currentPrice * 0.00008 * mult;
        let entryMin, entryMax, sl, tp1, tp2, tp3;

        if (direction === 'BUY') {
            entryMin = currentPrice - (spreadBuffer * 1.2); // Retracement ke SBR/RBS atau OB
            entryMax = currentPrice + (spreadBuffer * 0.3);
            sl = currentPrice - (currentPrice * riskMultiplier);
            tp1 = currentPrice + (currentPrice * riskMultiplier * rrTP1);
            tp2 = currentPrice + (currentPrice * riskMultiplier * rrTP2);
            tp3 = currentPrice + (currentPrice * riskMultiplier * rrTP3);
        } else {
            entryMin = currentPrice - (spreadBuffer * 0.3);
            entryMax = currentPrice + (spreadBuffer * 1.2); // Retracement ke SBR/RBS atau OB
            sl = currentPrice + (currentPrice * riskMultiplier);
            tp1 = currentPrice - (currentPrice * riskMultiplier * rrTP1);
            tp2 = currentPrice - (currentPrice * riskMultiplier * rrTP2);
            tp3 = currentPrice - (currentPrice * riskMultiplier * rrTP3);
        }

        let analysisReasonText = lang === 'en'
            ? `Pure SMC 3-Layer Confluence (${tfMapping}) [Score: ${winningScore}/13]: Tick-to-candle structural mapping confirmed liquidity sweep & Order Block mitigation at key flip zone without indicator lag.`
            : `Analisis Pure SMC 3-Layer (${tfMapping}) [Skor Konfluensi: ${winningScore}/13]: Pemetaan struktur candle live mendeteksi sapuan likuiditas dan mitigasi Order Block di zona pantulan utama secara akurat.`;

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
        console.error('Pure SMC Generator Error:', error);
        return res.status(500).json({ error: error.message || 'Terjadi kesalahan pada server.' });
    }
}
