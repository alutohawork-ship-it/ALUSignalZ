=====================================================
PATCH 1 - api/candles.js  (PENYEBAB UTAMA CANDLE HILANG)
=====================================================
Frontend mengirim { value: email }, tapi candles.js membaca body.email,
sehingga semua request candle ditolak (401) dan chart hanya memakai tick lokal
("lokal (XBTFX WS)") yang hilang saat browser ditutup.

CARI:
  const access = await checkAccess(body.email);
GANTI:
  const access = await checkAccess(body.email || body.value);


=====================================================
PATCH 2 - index.html : jumlah candle
=====================================================
CARI:
  const CANDLE_LIMIT = 200;
GANTI:
  const CANDLE_LIMIT = 300;


=====================================================
PATCH 3 - index.html : replayMissed (hit TP/SL yang terlewat)
=====================================================
Ganti SELURUH fungsi replayMissed() dengan ini:

function replayMissed() {
  let ch = false;
  const nowT = Date.now();
  for (const t of trades) {
    if (t.key === 'VISION' || t.status === 'CLOSED') continue;
    const rows = seriesRows(t.key, '1m');
    if (!rows.length) continue;
    const firstFull = Math.ceil((t.createdAt || 0) / 60000) * 60000; // candle yang separuh sebelum sinyal dibuat dilewati
    const scanned = t.scanAt || 0;
    for (const c of rows) {
      if (t.status === 'CLOSED') break;
      if (c.t < firstFull) continue;
      if (c.t + 60000 <= scanned) continue;
      if (c.t + 60000 > nowT) continue;
      const path = c.c >= c.o ? [c.o, c.l, c.h, c.c] : [c.o, c.h, c.l, c.c];
      for (const pt of path) {
        if (t.status === 'CLOSED') break;
        if (evalTrade(t, pt, pt, pt, c.t + 60000)) ch = true;
      }
      t.scanAt = c.t + 60000;
    }
  }
  if (ch) { saveTrades(); renderAll(); }
}


=====================================================
PATCH 4 - index.html : simpan scanAt + pulihkan saat browser dibuka lagi
=====================================================
Di BOOT (dekat baris  window.addEventListener('beforeunload', saveLive); )
GANTI baris itu dengan blok berikut:

const persistTrades = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(trades)); } catch (e) {} };
setInterval(persistTrades, 10000);
window.addEventListener('beforeunload', () => { saveLive(); persistTrades(); });

async function resumeApp() {
  if (!localStorage.getItem(K.email)) return;
  if (!ws || ws.readyState !== 1) connect();
  await Promise.all(['1m', '5m', '15m'].map(iv => fetchSeries(market, iv, true)));
  replayMissed();
  renderAll();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) resumeApp(); });
window.addEventListener('pageshow', resumeApp);
setTimeout(resumeApp, 1500);   // pemulihan pertama setelah halaman dibuka


=====================================================
PATCH 5 - index.html : payload generate pakai candle server + harga live
=====================================================
Di generateSignal(), CARI blok:

    const formatCandles = (arr) => {
      return (arr || []).map(c => ({
        t: c.time,
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close
      }));
    };

    const payload = {
      email: localStorage.getItem(K.email),
      symbol: market,
      style: style,
      currentPrice: prices[market]?.price || 0,
      candles: {
        m1: formatCandles(candles[market]?.[1]),
        m5: formatCandles(candles[market]?.[5]),
        m15: formatCandles(candles[market]?.[15])
      },
      lang: lang
    };

GANTI dengan:

    const rowsOf = iv => seriesRows(market, iv).slice(-300).map(c => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c }));
    const livePx = prices[market]?.price || 0;

    const payload = {
      email: localStorage.getItem(K.email),
      symbol: market,
      style: style,
      price: livePx,
      currentPrice: livePx,
      candles: { m1: rowsOf('1m'), m5: rowsOf('5m'), m15: rowsOf('15m') },
      lang: lang
    };
