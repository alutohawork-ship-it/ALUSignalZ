// lib/bot_3candle.js — BOT SCALPER POLA THREE CANDLE (menggantikan gaya EA / SMC)
//   SELL : Hijau -> Merah -> Merah  (3 candle tertutup berurutan)
//   BUY  : Merah -> Hijau -> Hijau
//   Entry: MARKET di close candle ke-3 (candle tertutup terakhir).
//   SL   : ekstrem terjauh dari 3 candle pola + buffer ATR.
//          Jika jarak SL alami melebihi maxSlPips, sinyal DITOLAK (SL tidak dipaksa).
//          Jika lebih kecil dari minSlPips, SL dilebarkan ke minSlPips.
//   TP   : single TP = rr x jarak SL.
//   Filter: ATR minimal, body candle minimal (buang doji), jam sesi (UTC), cooldown per candle.
//   Fungsi murni: hasil sama untuk input sama.
// Kontrak output sama dengan runBotSma lama (dipakai generate.js -> runBot).

export const CFG = {
  tf: 'm5',                  // timeframe pola: 'm1' | 'm5' | 'm15'
  rr: 1.5,                   // single TP = 1.5 x jarak SL
  slBufferAtr: 0.1,          // buffer SL di luar ekstrem pola, dalam ATR
  minSlPips: 20,
  maxSlPips: 30,
  minAtrPips: 12,            // ATR di bawah ini dianggap sepi
  minBodyAtr: 0.15,          // body tiap candle minimal 15% ATR (doji ditolak)
  atrPeriod: 14,
  sessionFilter: true,
  sessionUtc: { start: 6, end: 21 },
  cooldownMs: 5 * 60e3,      // cooldown dihitung terhadap candleT sinyal sebelumnya
  minBars: 40,
};

const LABEL = { G: 'Hijau', R: 'Merah', D: 'Doji' };
const colorOf = b => (b.c > b.o ? 'G' : b.c < b.o ? 'R' : 'D');

function atr(bars, period = CFG.atrPeriod) {
  if (!bars || bars.length < period + 1) return 0;
  const tr = i => Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
  let a = 0;
  for (let i = 1; i <= period; i++) a += tr(i);
  a /= period;
  for (let i = period + 1; i < bars.length; i++) a = (a * (period - 1) + tr(i)) / period;
  return a;
}

export function runBotSma(bars, { price, dec = 2, pip = 0.1, symbol = 'XAUUSD', prevCandleT = null } = {}) {
  const R = v => Number(Number(v).toFixed(dec));
  const series = (bars && bars[CFG.tf]) || [];
  const checks = [];
  const standby = (reason, extra = {}) => ({
    ok: false, reason, dirTxt: '-', trigger: null,
    bias: extra.bias || 'NETRAL', trendTxt: extra.trendTxt || '-', structTxt: extra.structTxt || '-',
    checklist: checks.slice(-12), candleT: null,
  });

  if (series.length < CFG.minBars) {
    return standby(`Data belum cukup (${CFG.tf.toUpperCase()} ${series.length}/${CFG.minBars}).`);
  }

  // Waktu referensi = candle tertutup terakhir (deterministik, bukan jam server)
  const n = series.length - 1;
  const candleT = series[n].t;

  // 1) Sesi
  if (CFG.sessionFilter) {
    const h = new Date(candleT).getUTCHours();
    if (h < CFG.sessionUtc.start || h >= CFG.sessionUtc.end) {
      checks.push(`BELUM: di luar jam sesi (${CFG.sessionUtc.start}:00–${CFG.sessionUtc.end}:00 UTC).`);
      return standby('Di luar jam sesi bot.');
    }
    checks.push('OK: jam sesi aktif.');
  }

  // 2) Volatilitas
  const a = atr(series);
  if (!(a > 0)) return standby('ATR belum bisa dihitung.');
  const atrPips = a / pip;
  if (atrPips < CFG.minAtrPips) {
    checks.push(`BELUM: market sepi, ATR ${R(atrPips)} pip (minimal ${CFG.minAtrPips}).`);
    return standby('Market terlalu sepi untuk scalping.');
  }
  checks.push(`OK: ATR ${R(atrPips)} pip.`);

  // 3) Pola three candle
  const trio = [series[n - 2], series[n - 1], series[n]];
  const pat = trio.map(colorOf).join('');
  const patTxt = trio.map(c => LABEL[colorOf(c)]).join(' → ');
  const structTxt = `Pola ${patTxt}`;
  const trendTxt = `${CFG.tf.toUpperCase()} three candle`;

  let dir = 0;
  if (pat === 'GRR') dir = -1;        // Hijau -> Merah -> Merah = SELL
  else if (pat === 'RGG') dir = 1;    // Merah -> Hijau -> Hijau = BUY

  if (!dir) {
    checks.push(`BELUM: pola ${patTxt} belum cocok (SELL: Hijau-Merah-Merah, BUY: Merah-Hijau-Hijau).`);
    return standby('Pola three candle belum terbentuk.', { trendTxt, structTxt });
  }
  const bias = dir === 1 ? 'bullish' : 'bearish';
  checks.push(`OK: pola ${patTxt} → ${dir === 1 ? 'BUY' : 'SELL'}.`);

  // 4) Body tiap candle harus cukup besar (buang doji / candle lemah)
  const minBody = CFG.minBodyAtr * a;
  const smallBody = trio.some(c => Math.abs(c.c - c.o) < minBody);
  if (smallBody) {
    checks.push('BELUM: ada body candle pola yang terlalu kecil.');
    return standby('Body candle pola terlalu kecil.', { bias, trendTxt, structTxt });
  }
  checks.push('OK: body tiap candle cukup.');

  // 5) Cooldown (berdasarkan candle, bukan jam dinding)
  if (prevCandleT && candleT - prevCandleT < CFG.cooldownMs) {
    const sisa = Math.ceil((CFG.cooldownMs - (candleT - prevCandleT)) / 1000);
    checks.push(`BELUM: cooldown ${sisa} detik.`);
    return standby('Cooldown setelah sinyal terakhir.', { bias, trendTxt, structTxt });
  }

  // 6) SL dari ekstrem pola + buffer, lalu cek batas
  const entry = R(series[n].c);
  const buffer = CFG.slBufferAtr * a;
  const extreme = dir === 1
    ? Math.min(...trio.map(c => c.l)) - buffer     // BUY: di bawah low terendah pola
    : Math.max(...trio.map(c => c.h)) + buffer;    // SELL: di atas high tertinggi pola
  let slDist = Math.abs(entry - extreme);
  const naturalPips = slDist / pip;

  if (naturalPips > CFG.maxSlPips) {
    checks.push(`BELUM: SL alami ${R(naturalPips)} pip melebihi batas ${CFG.maxSlPips} pip, sinyal ditolak.`);
    return standby('Risiko pola terlalu besar.', { bias, trendTxt, structTxt });
  }
  if (naturalPips < CFG.minSlPips) slDist = CFG.minSlPips * pip;   // dilebarkan ke minimum

  const sl = R(entry - dir * slDist);
  const tp = R(entry + dir * slDist * CFG.rr);
  const tps = [tp, tp, tp];
  const slPips = slDist / pip;
  const rr = Math.abs(tp - entry) / slDist;
  checks.push(`OK: SL ${R(slPips)} pip, TP ${R(slPips * CFG.rr)} pip, RR 1:${R(rr)}.`);

  const dirTxt = dir === 1 ? 'BUY' : 'SELL';
  const trigger = `Bot Three Candle · ${dirTxt} · ${patTxt} · MARKET`;

  return {
    ok: true, dir, dirTxt, role: 'three_candle', tier: 'THREE_CANDLE', bias, trigger,
    checklist: checks.slice(-12), trendTxt, structTxt,
    entry, sl, tps, rr: R(rr), tpMode: 'THREE_CANDLE_RR', orderType: 'MARKET', confidence: 'MEDIUM',
    setup: `Bot Three Candle · ${dirTxt} · ${pat}`, reason: null,
    candleT,
  };
}
