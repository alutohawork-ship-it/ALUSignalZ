// lib/session.js — Session & Liquidity Engine (nol API eksternal, DST-aware)
// Sumber waktu: timestamp candle yang sudah ada / Date.now(). Tidak butuh kalender news.

const HOUR = 3600e3;

function nthSundayUTC(y, m, n) {
  const first = new Date(Date.UTC(y, m, 1));
  const firstSun = 1 + ((7 - first.getUTCDay()) % 7);
  return firstSun + (n - 1) * 7;
}
function lastSundayUTC(y, m) {
  const last = new Date(Date.UTC(y, m + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}
function isUsDst(ms) {
  const y = new Date(ms).getUTCFullYear();
  const start = Date.UTC(y, 2, nthSundayUTC(y, 2, 2), 7); // 2am EST = 07 UTC
  const end = Date.UTC(y, 10, nthSundayUTC(y, 10, 1), 6); // 2am EDT = 06 UTC
  return ms >= start && ms < end;
}
function isEuDst(ms) {
  const y = new Date(ms).getUTCFullYear();
  return ms >= Date.UTC(y, 2, lastSundayUTC(y, 2), 1) && ms < Date.UTC(y, 9, lastSundayUTC(y, 9), 1);
}

// Bucket sesi berlabuh jam New York (auto DST)
const BUCKETS = [
  { key: 'ASIA',         from: 19, to: 26, liq: 0.6, wib: '07:00-14:00', id: 'Sesi Asia — likuiditas tipis, range sempit, rawan BOS palsu.', en: 'Asia — thin liquidity, tight range, false BOS risk.', mode: 'RANGE' },
  { key: 'LONDON_KZ',    from: 2,  to: 5,  liq: 1.3, wib: '14:00-17:00', id: 'London killzone — sweep Asian range, gerak real dimulai.', en: 'London killzone — Asian range sweep, real move begins.', mode: 'SWEEP' },
  { key: 'LONDON_MID',   from: 5,  to: 7,  liq: 1.0, wib: '17:00-19:00', id: 'London mid — continuation trend.', en: 'London mid — trend continuation.', mode: 'TREND' },
  { key: 'NY_AM_KZ',     from: 7,  to: 10, liq: 1.5, wib: '19:00-22:00', id: 'NY AM killzone — overlap London/NY, likuiditas puncak.', en: 'NY AM killzone — London/NY overlap, peak liquidity.', mode: 'TREND' },
  { key: 'LONDON_CLOSE', from: 10, to: 12, liq: 1.1, wib: '22:00-00:00', id: 'London close — window reversal / profit taking.', en: 'London close — reversal / profit taking window.', mode: 'REVERSAL' },
  { key: 'NY_PM',        from: 12, to: 16, liq: 0.8, wib: '00:00-04:00', id: 'NY PM — momentum melemah, drift.', en: 'NY PM — fading momentum, drift.', mode: 'DRIFT' },
  { key: 'DEAD',         from: 16, to: 19, liq: 0.3, wib: '04:00-07:00', id: 'Dead zone / rollover — spread melebar, hindari entry tipis.', en: 'Dead zone / rollover — wide spread, avoid tight entries.', mode: 'AVOID' },
];

export function sessionOf(ms, symbol = 'XAUUSD') {
  const d = new Date(ms);
  const us = isUsDst(ms), eu = isEuDst(ms);
  const nyOff = us ? -4 : -5;
  const ny = new Date(ms + nyOff * HOUR);
  let h = ny.getUTCHours() + ny.getUTCMinutes() / 60;
  const hAdj = h < 2 ? h + 24 : h; // supaya ASIA 19→26 kontinu

  let b = BUCKETS.find(x => hAdj >= x.from && hAdj < x.to) || BUCKETS.find(x => h >= x.from && h < x.to) || BUCKETS[6];

  const dowUtc = d.getUTCDay();
  const isBtc = String(symbol).toUpperCase() === 'BTCUSD';
  const weekend = isBtc && (dowUtc === 6 || dowUtc === 0);

  let liq = b.liq;
  let note = b.id, noteEn = b.en, mode = b.mode;
  if (weekend) { liq = Math.min(liq, 0.4); mode = 'AVOID'; note = 'BTC weekend — likuiditas tipis, rawan fakeout.'; noteEn = 'BTC weekend — thin liquidity, fakeout risk.'; }

  // batas sesi berikutnya (untuk expiry "ganti sesi")
  const endH = b.to % 24;
  const next = new Date(ny); next.setUTCMinutes(0, 0, 0); next.setUTCHours(endH);
  let nextMs = next.getTime() - nyOff * HOUR;
  if (nextMs <= ms) nextMs += 24 * HOUR;

  return {
    key: b.key, liq, mode, weekend, note, noteEn,
    nyHour: Number(h.toFixed(2)), utcHour: d.getUTCHours(),
    wib: b.wib, usDst: us, euDst: eu,
    nextBoundaryMs: nextMs,
    minsToBoundary: Math.round((nextMs - ms) / 60000),
  };
}

// Asian range: blok candle ASIA terakhir (high/low) — target sweep London
export function asianRange(rows, symbol = 'XAUUSD') {
  if (!Array.isArray(rows) || rows.length < 8) return null;
  const tagged = rows.map(c => ({ c, s: sessionOf(c.t < 1e12 ? c.t * 1000 : c.t, symbol) }));
  const asia = tagged.filter(x => x.s.key === 'ASIA');
  if (asia.length < 6) return null;
  // ambil blok kontinu terakhir
  let block = [asia[asia.length - 1]];
  for (let i = asia.length - 2; i >= 0; i--) {
    const gap = (block[0].c.t - asia[i].c.t);
    if (gap > 40 * 60000) break;
    block.unshift(asia[i]);
  }
  if (block.length < 6) return null;
  const hi = Math.max(...block.map(x => x.c.h));
  const lo = Math.min(...block.map(x => x.c.l));
  if (!(hi > lo)) return null;
  return { hi, lo, h: hi - lo, bars: block.length };
}

// Sweep Asian range lalu reclaim → setup judas swing (SC-09 / ID-07)
export function asianSweep(rows, range, ctx) {
  if (!range || !Array.isArray(rows) || rows.length < 4) return null;
  const last = rows.slice(-6);
  for (let i = last.length - 1; i >= 0; i--) {
    const c = last[i];
    if (c.l < range.lo && c.c > range.lo) return { dir: 1, extreme: c.l, swept: 'low',  id: 'Sweep low Asian range lalu reclaim — judas swing bullish.', en: 'Asian range low swept then reclaimed — bullish judas swing.' };
    if (c.h > range.hi && c.c < range.hi) return { dir: -1, extreme: c.h, swept: 'high', id: 'Sweep high Asian range lalu reclaim — judas swing bearish.', en: 'Asian range high swept then reclaimed — bearish judas swing.' };
  }
  return null;
}

// Skor sesi untuk pilar conviction ke-4 (0-15)
export function sessionScore(sess, setupMode) {
  let s;
  if (sess.mode === 'AVOID') s = 2;
  else if (sess.key === 'NY_AM_KZ') s = 15;
  else if (sess.key === 'LONDON_KZ') s = 13;
  else if (sess.key === 'LONDON_MID') s = 11;
  else if (sess.key === 'LONDON_CLOSE') s = 9;
  else if (sess.key === 'NY_PM') s = 7;
  else s = 5; // ASIA
  // Asia + setup range-edge = cocok, naikkan
  if (sess.key === 'ASIA' && setupMode === 'RANGE') s = 10;
  // London KZ + setup sweep = pasangan ideal
  if (sess.key === 'LONDON_KZ' && setupMode === 'SWEEP') s = 15;
  return s;
}

// Sanity ATR vs ekspektasi sesi → deteksi kompresi / spike tanpa kalender news
export function volatilityRegime(atrNow, atrBase, sess) {
  const ratio = atrBase > 0 ? atrNow / atrBase : 1;
  if (ratio >= 3) return { regime: 'SPIKE', ratio, penalty: 15, id: 'Lonjakan volatilitas ' + ratio.toFixed(1) + 'x — kemungkinan news/impulse. Risk 0.25x.', en: 'Volatility spike — possible news/impulse.' };
  if (ratio <= 0.45) return { regime: 'COMPRESSION', ratio, penalty: 0, id: 'Kompresi ATR ' + ratio.toFixed(2) + 'x — potensi ekspansi (setup B3).', en: 'ATR compression — expansion potential.' };
  return { regime: 'NORMAL', ratio, penalty: 0, id: 'Volatilitas normal untuk sesi ' + sess.key + '.', en: 'Normal volatility for session.' };
}
