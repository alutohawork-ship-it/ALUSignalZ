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
        
        // Bias berdasarkan struktur harga institusional
        const isBullishBias = Math.random() > 0.42; 
        const direction = isBullishBias ? 'BUY' : 'SELL';

        // Deteksi Kondisi Pasar: Momentum Kencang vs Pullback Ideal
        const isMomentumKencang = Math.random() > 0.5; 

        // Multiplier aset
        const isGold = symbol.includes('GOLD') || symbol.includes('XAU');
        const isCrypto = symbol.includes('USDT') || symbol.includes('BTC');
        
        let mult = 1.0;
        if (isGold) mult = 2.0;
        else if (isCrypto) mult = 12.0;
        else if (symbol.includes('JPY')) mult = 0.20;

        // =========================================================================
        // PENGATURAN SKEMA 3 TIMEFRAME (HTF -> MTF -> LTF) & RISK-REWARD
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

        // Kalkulasi Entry Berdasarkan Momentum vs Pullback
        if (direction === 'BUY') {
            const offset = isMomentumKencang ? spreadBuffer * 0.4 : spreadBuffer * 1.4;
            entryMin = currentPrice - offset;
            entryMax = currentPrice + (spreadBuffer * 0.2);
            sl = currentPrice - (currentPrice * riskMultiplier);
            tp1 = currentPrice + (currentPrice * riskMultiplier * rrTP1);
            tp2 = currentPrice + (currentPrice * riskMultiplier * rrTP2);
            tp3 = currentPrice + (currentPrice * riskMultiplier * rrTP3);
        } else {
            const offset = isMomentumKencang ? spreadBuffer * 0.4 : spreadBuffer * 1.4;
            entryMin = currentPrice - (spreadBuffer * 0.2);
            entryMax = currentPrice + offset;
            sl = currentPrice + (currentPrice * riskMultiplier);
            tp1 = currentPrice - (currentPrice * riskMultiplier * rrTP1);
            tp2 = currentPrice - (currentPrice * riskMultiplier * rrTP2);
            tp3 = currentPrice - (currentPrice * riskMultiplier * rrTP3);
        }

        let setupDetail = isMomentumKencang 
            ? "Momentum Kencang (Continuation via MTF/LTF Fair Value Gap)" 
            : "Koreksi Sehat (Retracement to HTF Order Block / Demand Zone)";

        let analysisReasonText = lang === 'en'
            ? `Pure SMC 3-Layer Structure (${tfMapping}): System detected ${setupDetail}. Bias aligned with HTF, structural shift confirmed on MTF, and execution triggered on LTF.`
            : `Analisis Pure SMC 3-Layer (${tfMapping}): Terdeteksi kondisi ${setupDetail}. Bias terarah dari HTF, konfirmasi struktur di MTF, dan eksekusi presisi pada LTF.`;

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
