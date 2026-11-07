/* =====================================================================
   PATCH CANDLE untuk index-xbtfx.html
   Candle diambil lewat /api/candles (XBTFX POST /v1/chart), bukan WebSocket.

   LANGKAH 1: HAPUS seluruh blok "PATCH CANDLE & HISTORY XBTFX"
   (termasuk function wsReq(...) yang membuat data acak dengan Math.random).
   Pastikan tidak ada lagi "wsReq" di file.

   LANGKAH 2: GANTI function fetchCandles yang lama dengan yang di bawah.

   LANGKAH 3: di function refreshBias, GANTI baris:
       if (!ws || ws.readyState !== WebSocket.OPEN || biasBusy) return;
   dengan:
       if (biasBusy) return;
   (agar bias tetap bisa dihitung walau WebSocket sedang putus)
   ===================================================================== */

async function fetchCandles(provider, symbol, interval) {
    const r = await api('/api/candles', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
            value: localStorage.getItem(SESSION_EMAIL_KEY) || '',
            symbol,
            interval,
            limit: 1000,
        }),
    });
    if (!r.ok) throw new Error(r.data.msg || `Gagal mengambil candle (HTTP ${r.status})`);

    // Bentuk field yang dipakai calcBias, shiftCandles, dan chart
    return (r.data.candles || [])
        .map(c => ({ t: c.openTime, o: c.open, h: c.high, l: c.low, c: c.close }))
        .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite))
        .sort((a, b) => a.t - b.t);
}
