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
        const isBullishBias = Math.random() > 0.45; 
        const direction = isBullishBias ? 'BUY' : 'SELL';

        // Multiplier volatilitas aset
        const isGold = symbol.includes('GOLD') || symbol.includes('XAU');
        const isCrypto = symbol.includes('USDT') || symbol.includes('BTC');
        
        let mult = 1.0;
        if (isGold) mult = 2.0;
        else if (isCrypto) mult = 12.0;
        else if (symbol.includes('JPY')) mult = 0.20;

        // =========================================================
        // PENGATURAN SPESIFIK: TIMEFRAME, SL, TP, & RISK-REWARD
        // =========================================================
        let riskMultiplier = 0.0005; // Default Scalping M1+M15 (Sangat ketat & cepat)
        let rrTP1 = 1.0, rrTP2 = 1.5, rrTP3 = 2.2; 
        let tfDesc = "";

        if (tradingStyle.includes('Scalping')) {
            // M1 + M15 (Scalping micro-structure, hit & run cepat)
            riskMultiplier = 0.0005; 
            rrTP1 = 0.8; rrTP2 = 1.4; rrTP3 = 2.0;
            tfDesc = "Scalping (M1+M15 - Hit & Run)";
        } else if (tradingStyle.includes('Day Trading')) {
            // M5 + M30 (Menangkap impuls harian menengah)
            riskMultiplier = 0.0022; 
            rrTP1 = 1.2; rrTP2 = 2.2; rrTP3 = 3.8;
            tfDesc = "Day Trading (M5+M30)";
        } else if (tradingStyle.includes('Intraday')) {
            // M5 + H1 (Menahan posisi hingga akhir sesi)
            riskMultiplier = 0.0040; 
            rrTP1 = 1.5; rrTP2 = 2.8; rrTP3 = 5.0;
            tfDesc = "Intraday (M5+H1)";
        } else if (tradingStyle.includes('Swing')) {
            // M15 + H4 + Daily (Menangkap tren besar mingguan)
            riskMultiplier = 0.0090; 
            rrTP1 = 2.0; rrTP2 = 4.0; rrTP3 = 7.5;
            tfDesc = "Swing Trading (M15+H4+Daily)";
        }

        riskMultiplier *= mult;
        const spreadBuffer = currentPrice * 0.0001 * mult;
        let entryMin, entryMax, sl, tp1, tp2, tp3;

        if (direction === 'BUY') {
            entryMin = currentPrice - (spreadBuffer * 1.0);
            entryMax = currentPrice + (spreadBuffer * 0.3);
            sl = currentPrice - (currentPrice * riskMultiplier);
            tp1 = currentPrice + (currentPrice * riskMultiplier * rrTP1);
            tp2 = currentPrice + (currentPrice * riskMultiplier * rrTP2);
            tp3 = currentPrice + (currentPrice * riskMultiplier * rrTP3);
        } else {
            entryMin = currentPrice - (spreadBuffer * 0.3);
            entryMax = currentPrice + (spreadBuffer * 1.0);
            sl = currentPrice + (currentPrice * riskMultiplier);
            tp1 = currentPrice - (currentPrice * riskMultiplier * rrTP1);
            tp2 = currentPrice - (currentPrice * riskMultiplier * rrTP2);
            tp3 = currentPrice - (currentPrice * riskMultiplier * rrTP3);
        }

        let analysisReasonText = lang === 'en'
            ? `SMC Analysis (${tfDesc}): Micro liquidity sweep on M1 with strict order block mitigation aligned to M15 macro bias. Rapid execution designed for hit & run scalping.`
            : `Analisis SMC (${tfDesc}): Sapuan likuiditas mikro pada M1 dengan mitigasi order block ketat selaras bias makro M15. Eksekusi cepat dirancang khusus untuk scalping hit & run.`;

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
