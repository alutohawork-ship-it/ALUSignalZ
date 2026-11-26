// lib/ltf-dynamic.js — LTF Dinamis Real-Time Monitoring (Framework §3 & §7)
// Monitoring struktur LTF berjalan, SL presisi dari swing LTF, dynamic cancellation.
// Scalping → M1, Intraday → M5, Swing → H1

export const LTF_TF = {
  Scalping: 'm1',
  Intraday: 'm5',
  Swing: 'h1',
};

export function monitorLTFStructure(rows, dir, ctx, style) {
  if (!Array.isArray(rows) || rows.length < 10) {
    return { valid: true, reason: 'Data LTF tidak cukup', confidence: 50 };
  }
  
  const n = rows.length;
  const last = rows[n - 1];
  const prev = rows[n - 2];
  
  // 1. Arah candle terakhir (momentum LTF)
  const lastDir = last.c > last.o ? 1 : -1;
  const prevDir = prev.c > prev.o ? 1 : -1;
  
  // 2. Momentum 3 candle terakhir
  const last3 = rows.slice(-3);
  const bearishCount = last3.filter(c => c.c < c.o).length;
  const bullishCount = last3.filter(c => c.c > c.o).length;
  
  let momentumShift = false;
  let shiftReason = '';
  
  if (dir === 1 && bearishCount >= 2) {
    momentumShift = true;
    shiftReason = 'LTF menunjukkan 2 dari 3 candle terakhir bearish — momentum BUY melemah.';
  } else if (dir === -1 && bullishCount >= 2) {
    momentumShift = true;
    shiftReason = 'LTF menunjukkan 2 dari 3 candle terakhir bullish — momentum SELL melemah.';
  }
  
  // 3. Swing break (harga menembus swing LTF)
  const swingWindow = rows.slice(-20);
  const swingLow = Math.min(...swingWindow.map(c => c.l));
  const swingHigh = Math.max(...swingWindow.map(c => c.h));
  
  let swingBreak = false;
  let breakReason = '';
  
  if (dir === 1 && last.l < swingLow) {
    swingBreak = true;
    breakReason = `Harga menembus swing low LTF (${ctx.f(swingLow)}) — struktur bullish rusak.`;
  } else if (dir === -1 && last.h > swingHigh) {
    swingBreak = true;
    breakReason = `Harga menembus swing high LTF (${ctx.f(swingHigh)}) — struktur bearish rusak.`;
  }
  
  // 4. Rejection candle (konfirmasi LTF)
  let rejection = false;
  let rejectionReason = '';
  
  if (dir === 1) {
    const lowerWick = Math.min(last.o, last.c) - last.l;
    const body = Math.abs(last.c - last.o);
    const range = last.h - last.l || ctx.pip;
    if (lowerWick > 0.6 * range && body < 0.3 * range) {
      rejection = true;
      rejectionReason = 'Candle terakhir menunjukkan rejection bullish (pinbar) — konfirmasi BUY.';
    }
  } else {
    const upperWick = last.h - Math.max(last.o, last.c);
    const body = Math.abs(last.c - last.o);
    const range = last.h - last.l || ctx.pip;
    if (upperWick > 0.6 * range && body < 0.3 * range) {
      rejection = true;
      rejectionReason = 'Candle terakhir menunjukkan rejection bearish (pinbar) — konfirmasi SELL.';
    }
  }
  
  // 5. Confidence LTF (0-100)
  let confidence = 50;
  if (lastDir === dir) confidence += 10;
  if (prevDir === dir) confidence += 10;
  if (rejection) confidence += 15;
  if (momentumShift) confidence -= 20;
  if (swingBreak) confidence -= 30;
  confidence = Math.max(0, Math.min(100, confidence));
  
  const valid = !momentumShift && !swingBreak;
  const reason = momentumShift ? shiftReason : (swingBreak ? breakReason : (rejection ? rejectionReason : 'LTF masih searah'));
  
  return {
    valid,
    momentumShift,
    swingBreak,
    rejection,
    reason,
    confidence,
    ltfDir: lastDir,
    candleAlignment: dir === 1 ? bullishCount : bearishCount,
    swingLow,
    swingHigh,
  };
}

export function validateEntryZone(entry, price, pip, tolerancePips = 50) {
  const dist = Math.abs(price - entry) / pip;
  return {
    valid: dist <= tolerancePips,
    distPips: Math.round(dist),
    reason: dist > tolerancePips ? `Harga menjauh ${dist.toFixed(1)} pip dari entry (>${tolerancePips} pip)` : 'Dalam toleransi'
  };
}

export function calculatePreciseSL(entry, dir, ltfRows, ctx, bufferMultiplier = 1.5) {
  if (!Array.isArray(ltfRows) || ltfRows.length < 10) return null;
  
  const swingWindow = ltfRows.slice(-20);
  const swingLow = Math.min(...swingWindow.map(c => c.l));
  const swingHigh = Math.max(...swingWindow.map(c => c.h));
  const atr = ctx.pip * 10;
  
  let sl;
  if (dir === 1) {
    sl = swingLow - (atr * bufferMultiplier);
  } else {
    sl = swingHigh + (atr * bufferMultiplier);
  }
  
  return {
    sl,
    swingLevel: dir === 1 ? swingLow : swingHigh,
    distancePips: Math.abs(entry - sl) / ctx.pip,
    reason: `SL presisi di ${dir === 1 ? 'bawah swing low' : 'atas swing high'} LTF + ${bufferMultiplier}x ATR buffer`
  };
}
