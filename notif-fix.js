// notif-fix.js — notifikasi: panel, bubble, form admin dua bahasa (ID/EN), dan tutup panel di luar.
// Dimuat lewat middleware.js (tanpa edit index.html).
(function () {
  const L = () => { try { return (typeof lang !== 'undefined' && lang === 'en') ? 'en' : 'id'; } catch (e) { return 'id'; } };
  const T = { id: { title: 'NOTIFIKASI', empty: 'Belum ada notifikasi.', close: 'Tutup', add: '+ TAMBAH NOTIFIKASI',
                    tEn: 'Judul (English)', bEn: 'Isi (English, opsional)', tId: 'Judul (Indonesia)', bId: 'Isi (Indonesia)' },
               en: { title: 'NOTIFICATIONS', empty: 'No notifications yet.', close: 'Close', add: '+ ADD NOTIFICATION',
                    tEn: 'Title (English)', bEn: 'Body (English, optional)', tId: 'Title (Indonesian)', bId: 'Body (Indonesian)' } };
  const tr = k => T[L()][k];
  const pick = (n, f) => (L() === 'en' && n[f + '_en']) ? n[f + '_en'] : n[f];
  const esc2 = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function dedupe(list) {
    const seen = new Set();
    return (list || []).filter(n => { const k = n.title + '|' + n.body; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  window.renderBell = function () {
    const box = document.getElementById('bellPanel');
    if (!box) return;
    const head = '<div class="flex justify-between items-center border-b border-panelborder pb-1 mb-1.5">' +
      '<span class="text-[9px] font-bold text-gray-400">' + tr('title') + '</span>' +
      '<button onclick="toggleBell()" class="text-gray-300 hover:text-white text-sm px-2 leading-none" title="' + tr('close') + '">✕</button></div>';
    const list = dedupe(window.noticeList);
    if (!list.length) { box.innerHTML = head + '<p class="text-[10px] text-gray-500 text-center py-3">' + tr('empty') + '</p>'; return; }
    box.innerHTML = head + list.map(n => {
      const d = new Date(n.created_at).toLocaleString(L() === 'en' ? 'en-US' : 'id-ID', { dateStyle: 'short', timeStyle: 'short' });
      return '<div class="bg-darkbg border border-panelborder rounded-lg p-2 mb-1.5">' +
        '<p class="text-[10px] font-bold text-yellow-300">' + esc2(pick(n, 'title')) + '</p>' +
        '<p class="text-[9px] text-gray-300 whitespace-pre-line leading-relaxed">' + esc2(pick(n, 'body')) + '</p>' +
        '<p class="text-[8px] text-gray-500 font-mono mt-1">' + esc2(d) + '</p></div>';
    }).join('');
  };

  // Bubble bertahan sampai ditutup
  window.noticeBubble = function (n) {
    let wrap = document.getElementById('noticeBubbles');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'noticeBubbles';
      wrap.style.cssText = 'position:fixed;top:12px;left:12px;right:12px;z-index:9999;display:flex;flex-direction:column;gap:6px';
      document.body.appendChild(wrap);
    }
    const b = document.createElement('div');
    b.style.cssText = 'background:#1e293b;color:#fde68a;border:1px solid #f59e0b;border-radius:10px;padding:8px 10px;font:11px monospace;box-shadow:0 4px 14px rgba(0,0,0,.4);display:flex;gap:8px;align-items:flex-start';
    const txt = document.createElement('div');
    txt.style.cssText = 'flex:1;white-space:pre-line';
    txt.textContent = '🔔 ' + pick(n, 'title') + '\n' + pick(n, 'body');
    const x = document.createElement('button');
    x.textContent = '✕';
    x.title = tr('close');
    x.style.cssText = 'background:none;border:none;color:#fde68a;font-size:14px;line-height:1;padding:0 2px;cursor:pointer';
    x.onclick = () => b.remove();
    b.appendChild(txt); b.appendChild(x); wrap.appendChild(b);
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification(pick(n, 'title'), { body: pick(n, 'body'), tag: 'notice-' + n.id }); } catch (e) {}
  };

  // Form admin: tambah kolom Inggris, lalu kirim dua bahasa
  function ensureAdminFields() {
    const btn = document.querySelector('button[onclick="adminAddNotice()"]');
    const body = document.getElementById('noticeBody');
    if (!btn || !body || document.getElementById('noticeTitleEn')) return;
    const wrap = document.createElement('div');
    wrap.id = 'noticeEnFields';
    wrap.className = 'space-y-2';
    wrap.innerHTML =
      '<input id="noticeTitleEn" placeholder="' + T.id.tEn + '" class="w-full bg-darkbg border border-panelborder rounded-lg p-2 text-xs text-white focus:outline-none">' +
      '<textarea id="noticeBodyEn" rows="3" placeholder="' + T.id.bEn + '" class="w-full bg-darkbg border border-panelborder rounded-lg p-2 text-xs text-white focus:outline-none"></textarea>';
    btn.parentNode.insertBefore(wrap, btn);
    const tIn = document.getElementById('noticeTitle');
    if (tIn) tIn.placeholder = T.id.tId;
    body.placeholder = T.id.bId;
  }

  window.adminAddNotice = async function () {
    if (window.__noticeBusy) return;
    window.__noticeBusy = true;
    setTimeout(() => { window.__noticeBusy = false; }, 3000);
    const title = document.getElementById('noticeTitle').value.trim();
    const text = document.getElementById('noticeBody').value.trim();
    const titleEn = (document.getElementById('noticeTitleEn') || {}).value || '';
    const textEn = (document.getElementById('noticeBodyEn') || {}).value || '';
    if (!title || !text) return alert('Judul dan isi (Indonesia) wajib diisi.');
    const r = await post('/api/notices', { title, body: text, title_en: titleEn.trim(), body_en: textEn.trim() }, adminH());
    if (!r.ok || !r.data || !r.data.ok) return alert((r.data && r.data.msg) || 'Gagal menambah notifikasi.');
    document.getElementById('noticeTitle').value = '';
    document.getElementById('noticeBody').value = '';
    if (document.getElementById('noticeTitleEn')) document.getElementById('noticeTitleEn').value = '';
    if (document.getElementById('noticeBodyEn')) document.getElementById('noticeBodyEn').value = '';
    loadNotices();
  };

  document.addEventListener('click', function (e) {
    const p = document.getElementById('bellPanel'), b = document.getElementById('bellBtn');
    if (p && !p.classList.contains('hidden') && !p.contains(e.target) && !(b && b.contains(e.target))) p.classList.add('hidden');
    // Ganti bahasa: segera render ulang panel
    if (e.target && e.target.closest && e.target.closest('#langBtn')) setTimeout(() => { try { renderBell(); renderAdminNotices(); } catch (er) {} }, 60);
  });

  // Sisipan admin dan render awal
  setTimeout(() => { ensureAdminFields(); try { renderBell(); } catch (e) {} }, 1600);
})();
