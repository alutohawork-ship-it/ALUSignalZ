// lib/scenarios.js — Registry Skenario Entry (sesuai Framework §4 & §7)
// Setiap signal dipetakan ke SATU skenario bernama + alasan + aturan order.

export const SCENARIOS = {
  CONTINUATION: {
    id: 'SC-01', name: 'Kontinuitas Pullback',
    why: 'HTF & MTF searah, harga koreksi terukur ke zona searah tren.',
    order: 'LIMIT', // LIMIT di zona; NOW hanya jika sudah inside + reject
    bias: 1.0,
  },
  RETEST_BOS: {
    id: 'SC-02', name: 'Retest BOS',
    why: 'BOS valid searah bias, harga kembali menguji area pemicu.',
    order: 'BOTH', // LIMIT jika belum sentuh zona, NOW jika sudah + LTF reaksi
    bias: 1.0,
  },
  REVERSAL: {
    id: 'SC-03', name: 'Reversal Sweep',
    why: 'Sweep likuiditas di zona HTF + pergeseran struktur MTF/LTF.',
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
    order: 'LIMIT', // WAJIB LIMIT di tepi
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

// htfClear = HTF punya arah + (fresh ATAU displacement)
export function detectScenario({ ht, it, lt, chosen, verdict, sweepSess, rg, biasMode, dir, inside, distPip, momentum, preNews, sess }) {
  const htfClear = ht.dir !== 0 && (ht.fresh || ht.displaced);

  // 1. Session sweep (Judas) — prioritas
  if (sweepSess) return SCENARIOS.FAKEOUT;

  // 2. Liquidity sweep general
  if (verdict === 'SWEEP') return SCENARIOS.FAKEOUT;

  // 3. Breakout confirmed
  if (verdict === 'BREAK' && htfClear) return SCENARIOS.BREAKOUT;

  // 4. LTF memimpin counter-HTF
  if (biasMode === 'LTF_COUNTER') return SCENARIOS.LTF_MOMENTUM;

  // 5. HTF netral / tidak jelas → UNCLEAR (JANGAN Retest BOS / Kontinuitas)
  if (!htfClear) {
    if (rg) return SCENARIOS.RANGE_EDGE;
    return SCENARIOS.UNCLEAR;
  }

  // 6. Ranging jelas
  if (rg && ht.dir === 0) return SCENARIOS.RANGE_EDGE;

  // 7. Retest BOS (butuh HTF jelas + MTF BOS valid searah)
  if (it.fresh && it.displaced && it.dir === dir) return SCENARIOS.RETEST_BOS;

  // 8. Reversal (HTF jelas tapi arah kita berlawanan + sweep + CHOCH MTF)
  if (dir !== ht.dir && it.ev && it.ev.startsWith('CHOCH')) return SCENARIOS.REVERSAL;

  // 9. Kontinuitas (HTF & MTF searah dengan kita)
  if (ht.dir === dir && it.dir === dir) return SCENARIOS.CONTINUATION;

  // 10. Fallback zona
  if (chosen && chosen.z) return SCENARIOS.CONTINUATION;
  return SCENARIOS.UNCLEAR;
}

// Skema NOW vs LIMIT eksplisit (Framework §5)
export function decideOrderType(scenario, { inside, distPip, reject, momentum, preNews, sess }) {
  const near = distPip < 2;
  // Pre-news / dead zone: hindari market tipis
  if (preNews || sess.mode === 'AVOID') {
    return { type: 'LIMIT', reason: 'Menjelang news / dead zone — hindari market yang rawan tersapu wick.' };
  }
  // NOW-only skenario
  if (scenario.order === 'NOW') {
    return { type: 'MARKET', reason: 'Momentum berjalan (breakout/displacement) — menunggu pullback berisiko tertinggal.' };
  }
  // LIMIT-only skenario
  if (scenario.order === 'LIMIT') {
    if (inside && near) return { type: 'MARKET', reason: 'Harga sudah di tepi zona — eksekusi langsung.' };
    return { type: 'LIMIT', reason: 'Harga belum menyentuh zona/tepi range — LIMIT agar SL & R:R efisien.' };
  }
  // BOTH
  if (inside && reject && momentum) {
    return { type: 'MARKET', reason: 'Harga di dalam zona + LTF reaksi aktif + momentum searah — NOW.' };
  }
  if (inside && near) {
    return { type: 'MARKET', reason: 'Sudah di titik reaksi zona.' };
  }
  return { type: 'LIMIT', reason: 'Harga belum sampai zona pemicu — LIMIT di tepi zona.' };
}

// Toleransi pembatalan LIMIT: proporsional dengan SL, bukan angka mati 50
export function cancelTolerance(slPips, base = 50) {
  return Math.max(base, Math.round(slPips * 0.6));
}
