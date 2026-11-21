// notif-fix.js — perbaikan panel notifikasi (dimuat lewat middleware.js, tanpa edit index.html)
// Menimpa renderBell lama, menyembunyikan duplikat di tampilan, anti double-click, dan tutup panel di luar.
(function () {
  function dedupe(list) {
    const seen = new Set();
    return (list || []).filter(n => {
      const k = String(n.title) + '|' + String(n.body);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  window.renderBell = function renderBell() {
    const box = document.getElementById('bellPanel');
    if (!box) return;
    const head = '<div class="flex justify-between items-center border-b border-panelborder pb-1 mb-1.5">' +
      '<span class="text-[9px] font-bold text-gray-400">NOTIFIKASI</span>' +
      '<button onclick="toggleBell()" class="text-gray-300 hover:text-white text-sm px-2 leading-none" title="Tutup">✕</button></div>';
    const list = dedupe(window.noticeList);
    if (!list.length) {
      box.innerHTML = head + '<p class="text-[10px] text-gray-500 text-center py-3">Belum ada notifikasi.</p>';
      return;
    }
    box.innerHTML = head + list.map(n => {
      const d = new Date(n.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
      return '<div class="bg-darkbg border border-panelborder rounded-lg p-2 mb-1.5">' +
        '<p class="text-[10px] font-bold text-yellow-300">' + esc(n.title) + '</p>' +
        '<p class="text-[9px] text-gray-300 whitespace-pre-line leading-relaxed">' + esc(n.body) + '</p>' +
        '<p class="text-[8px] text-gray-500 font-mono mt-1">' + esc(d) + '</p></div>';
    }).join('');
  };

  // Anti double-click untuk tombol TAMBAH NOTIFIKASI
  const origAdd = window.adminAddNotice;
  if (typeof origAdd === 'function') {
    window.adminAddNotice = async function () {
      if (window.__noticeBusy) return;
      window.__noticeBusy = true;
      setTimeout(() => { window.__noticeBusy = false; }, 3000);
      return origAdd.apply(this, arguments);
    };
  }

  // Tutup panel notifikasi saat klik di luar panel
  document.addEventListener('click', function (e) {
    const p = document.getElementById('bellPanel');
    const b = document.getElementById('bellBtn');
    if (p && !p.classList.contains('hidden') && !p.contains(e.target) && !(b && b.contains(e.target))) {
      p.classList.add('hidden');
    }
  });

  // Segera tampilkan ulang dengan data yang sudah ada
  try { if (typeof window.renderBell === 'function') window.renderBell(); } catch (e) {}
})();
