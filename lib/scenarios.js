// lib/scenarios.js — Registry Skenario Entry (Framework §4 & §5)
// Validasi ketat: HTF tanpa displacement ≠ Kontinuitas, CHOCH ≠ BOS

export const SCENARIOS = {
  CONTINUATION: {
    id: 'SC-01', name: 'Kontinuitas Pullback',
    why: 'HTF & MTF searah dengan displacement valid, harga koreksi terukur ke zona.',
    order: 'LIMIT',
    bias: 1.0,
  },
  RETEST_BOS: {
    id: 'SC-02', name: 'Retest BOS',
    why: 'BOS valid searah bias HTF (dengan displacement), harga kembali menguji area pemicu.',
    order: 'BOTH',
    bias: 1.0,
  },
  REVERSAL: {
    id: 'SC-03', name: 'Reversal Sweep',
    why: 'Sweep likuiditas di zona HTF + CHOCH/BOS pergeseran struktur MTF/LTF.',
    order: 'BOTH',
    bias: 0.65,
  },
  FAKEOUT: {
    id: 'SC-04', name: 'Fakeout / Trap',
    why: 'Tembus tipis/wick panjang lalu reclaim ke struktur lama.',
    order: 'BOTH',
    bias: 0.65,
  },
  RANGE_EDGE: {
    id: 'SC-05', name: 'Ranging Edge',
    why: 'Range jelas, entry di batas atas/bawah, SL di luar range.',
    order: 'LIMIT',
    bias: 0.65,
  },
  BREAKOUT: {
    id: 'SC-06', name: 'Breakout Impulse',
    why: 'Displacement + hold menembus struktur, momentum berjalan.',
    order: 'NOW',
    bias: 1.0,
  },
  LTF_MOMENTUM: {
    id: 'SC-07', name: 'LTF Momentum (counter-HTF)',
    why: 'LTF fresh memimpin melawan HTF dengan runway bersih.',
    order: 'LIMIT',
    bias: 0.25,
  },
  UNCLEAR: {
    id: 'SC-08', name: 'Struktur Belum Jelas',
    why: 'HTF netral/tanpa displacement, tidak ada setup konfluensi.',
    order: 'LIMIT',
    bias: 0.25,
  },
};

export function detectScenario({ ht, it, lt, chosen, verdict, sweepSess, rg, biasMode, dir, inside, distPip, momentum, preNews, sess }) {
  const htfClear = ht.dir !== 0 && (ht.fresh || ht.displaced);
  const htfHasDisplacement = ht.displaced;
  const mtfIsBOS = it.ev && it.ev.startsWith('BOS');
  const mtfIsCHOCH = it.ev && it.ev.startsWith('CHOCH');
  const mtfHasDisplacement = it.displaced;

  if (sweepSess) return SCENARIOS.FAKEOUT;
  if (verdict === 'SWEEP') return SCENARIOS.FAKEOUT;
  if (verdict === 'BREAK' && htfClear) return SCENARIOS.BREAKOUT;
  if (biasMode === 'LTF_COUNTER') return SCENARIOS.LTF_MOMENTUM;

  if (!htfClear) {
    if (rg) return SCENARIOS.RANGE_EDGE;
    return SCENARIOS.UNCLEAR;
  }

  if (htfClear && !htfHasDisplacement) {
    if (rg) return SCENARIOS.RANGE_EDGE;
    return SCENARIOS.UNCLEAR;
  }

  if (mtfIsCHOCH && dir !== ht.dir) {
    return SCENARIOS.REVERSAL;
  }

  if (rg && ht.dir === 0) return SCENARIOS.RANGE_EDGE;

  if (mtfIsBOS && it.fresh && mtfHasDisplacement && it.dir === dir) {
    return SCENARIOS.RETEST_BOS;
  }

  if (dir !== ht.dir && mtfIsCHOCH) return SCENARIOS.REVERSAL;

  if (htfHasDisplacement && mtfIsBOS && ht.dir === dir && it.dir === dir) {
    return SCENARIOS.CONTINUATION;
  }

  if (chosen && chosen.z) return SCENARIOS.CONTINUATION;
  return SCENARIOS.UNCLEAR;
}

export function decideOrderType(scenario, { inside, distPip, reject, momentum, preNews, sess, ltfConfidence }) {
  const near = distPip < 2;
  
  if (preNews || sess.mode === 'AVOID') {
    return { type: 'LIMIT', reason: 'Menjelang news / dead zone — hindari market yang rawan tersapu wick.' };
  }
  
  if (ltfConfidence < 60) {
    return { type: 'LIMIT', reason: 'Konfirmasi LTF lemah — tunggu zona lebih presisi.' };
  }
  
  if (scenario.order === 'NOW') {
    return { type: 'MARKET', reason: 'Momentum berjalan (breakout/displacement) — menunggu pullback berisiko tertinggal.' };
  }
  
  if (scenario.order === 'LIMIT') {
    if (inside && near) return { type: 'MARKET', reason: 'Harga sudah di tepi zona — eksekusi langsung.' };
    return { type: 'LIMIT', reason: 'Harga belum menyentuh zona/tepi range — LIMIT agar SL & R:R efisien.' };
  }
  
  if (inside && reject && momentum && ltfConfidence >= 70) {
    return { type: 'MARKET', reason: 'Harga di dalam zona + LTF reaksi aktif + momentum searah — NOW.' };
  }
  
  if (inside && near) {
    return { type: 'MARKET', reason: 'Sudah di titik reaksi zona.' };
  }
  
  return { type: 'LIMIT', reason: 'Harga belum sampai zona pemicu — LIMIT di tepi zona.' };
}

export function cancelTolerance(slPips, base = 50) {
  return Math.max(base, Math.round(slPips * 0.6));
}
