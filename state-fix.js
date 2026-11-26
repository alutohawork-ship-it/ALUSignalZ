// state-fix.js — rapikan trade yang tersimpan di browser saat halaman dibuka (tanpa edit index.html).
// 1) PENDING yang sudah lewat masa berlakunya -> dibatalkan (CANCEL, alasan kedaluwarsa).
// 2) Trade berjalan lebih dari 9 jam -> dibatalkan (CANCEL, alasan kedaluwarsa).
// 3) Trade yang masih hidup: pemutaran candle lama DIMATIKAN (scanAt = sekarang),
//    sehingga TP/BE/SL tidak dihitung dari candle sebelum halaman dibuka lagi (penyebab BE palsu).
// Trade bot server (src 'bot' / 'bot_srv_') dan Vision tidak disentuh.
(function () {
  const LIMIT_MS = 9 * 3600e3;

  function tidy() {
    if (typeof trades === 'undefined' || !Array.isArray(trades)) return;
    const now = Date.now();
    let changed = false;
    for (const t of trades) {
      if (!t || t.status === 'CLOSED' || t.src === 'bot' || String(t.id || '').startsWith('bot_') || t.key === 'VISION') continue;
      if (t.status === 'PENDING' && t.expiresAt && now > t.expiresAt) {
        cancelTrade(t, 'Kedaluwarsa saat dibuka ulang');
        changed = true; continue;
      }
      if (t.status !== 'PENDING' && t.createdAt && now - t.createdAt > LIMIT_MS) {
        cancelTrade(t, 'Kedaluwarsa (lebih dari 9 jam)');
        changed = true; continue;
      }
      // Mulai pemantauan dari sekarang: candle sebelum halaman dibuka tidak diputar ulang
      if (!t.scanAt || t.scanAt < now - 60000) { t.scanAt = now; changed = true; }
    }
    if (changed) { saveTrades(); renderAll(); }
  }

  // Jalankan setelah index selesai memuat trade dari penyimpanan
  setTimeout(tidy, 1500);
  // Juga saat halaman kembali aktif dari background (tab dibuka lagi)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(tidy, 300); });
})();
