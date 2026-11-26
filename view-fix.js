// view-fix.js — sembunyikan kartu TP4 dan TP5 (kartu kembali 4 kolom: SL, TP1, TP2, TP3). Tanpa edit index.html.
(function () {
  function hideExtra() {
    ['lb-tp4', 'lb-tp5'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
    const tp3 = document.getElementById('lb-tp3');
    if (tp3 && tp3.parentElement && tp3.parentElement.dataset.s5) {
      tp3.parentElement.className = 'grid grid-cols-2 sm:grid-cols-4 gap-1.5';
    }
  }
  setInterval(hideExtra, 700);
})();
