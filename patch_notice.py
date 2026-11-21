#!/usr/bin/env python3
"""
patch_notices.py - bell notifikasi di header + kelola notifikasi di dashboard admin (index.html)

Butuh file baru: api/notices.js (sudah disediakan) dan tabel 'notices' dibuat otomatis oleh API.

Perubahan:
  A. Tombol lonceng di header (dekat tombol bahasa) + panel daftar notifikasi.
  B. Form tambah dan daftar hapus notifikasi di dashboard admin.
  C. Fungsi JavaScript: ambil notifikasi, tandai sudah dibaca, bubble saat ada notifikasi baru, tambah, dan hapus.

Pemakaian: python3 patch_notices.py index.html   (file asli -> index.html.bak)
Jika pola tidak ditemukan tepat sekali, file TIDAK diubah.
"""
import shutil, sys

GUARD = "const NOTICE_SEEN_KEY = "

BELL_HTML = (
    '      <button id="bellBtn" onclick="toggleBell()" class="relative text-[10px] px-2 py-0.5 rounded bg-panelborder text-gray-300 border border-panelborder hover:border-accentblue"><i class="fa-solid fa-bell"></i>'
    '<span id="bellBadge" class="hidden absolute -top-1 -right-1 bg-red-500 text-white text-[8px] rounded-full px-1"></span></button>\n'
    '      <div id="bellPanel" class="hidden fixed top-12 right-2 z-50 w-72 max-h-[60vh] overflow-y-auto bg-cardbg border border-panelborder rounded-xl p-2 shadow-2xl"></div>\n'
    '      <button onclick="toggleLang()" id="langBtn"'
)

ADMIN_HTML = """
    <div class="bg-cardbg border border-panelborder rounded-xl p-4 space-y-2 shadow-lg">
      <h3 class="text-xs font-bold text-white flex items-center gap-1.5"><i class="fa-solid fa-bell text-yellow-400"></i> Notifikasi ke Klien (Bell)</h3>
      <input id="noticeTitle" placeholder="Judul, misal: Maintenance" class="w-full bg-darkbg border border-panelborder rounded-lg p-2 text-xs text-white focus:outline-none">
      <textarea id="noticeBody" rows="3" placeholder="Isi pesan" class="w-full bg-darkbg border border-panelborder rounded-lg p-2 text-xs text-white focus:outline-none"></textarea>
      <button onclick="adminAddNotice()" class="w-full bg-yellow-500 hover:bg-yellow-400 text-darkbg font-bold py-2 rounded-lg text-xs">+ TAMBAH NOTIFIKASI</button>
      <div id="adminNoticeList" class="space-y-1.5 max-h-[200px] overflow-y-auto pr-1"></div>
    </div>"""

ADMIN_ANCHOR = """      <div id="adminClientTableList" class="space-y-1.5 max-h-[300px] overflow-y-auto pr-1"></div>
    </div>"""

JS = r"""// ── Notifikasi (bell) ──
const NOTICE_SEEN_KEY = 'aluNoticeSeen_v1';
let noticeList = [];
function noticeSeen() { return Number(localStorage.getItem(NOTICE_SEEN_KEY)) || 0; }
async function loadNotices() {
  const r = await api('/api/notices');
  if (!r.ok || !Array.isArray(r.data)) return;
  const prevTop = noticeList[0] ? noticeList[0].id : null;
  noticeList = r.data;
  const unread = noticeList.filter(n => n.id > noticeSeen()).length;
  const badge = $('bellBadge');
  if (badge) { badge.textContent = unread; badge.classList.toggle('hidden', !unread); }
  if (prevTop && noticeList[0] && noticeList[0].id !== prevTop) noticeBubble(noticeList[0]);
  renderBell();
  renderAdminNotices();
}
function noticeBubble(n) {
  const text = '🔔 ' + n.title + ' — ' + n.body;
  try {
    if ('Notification' in window && Notification.permission === 'granted') new Notification(n.title, { body: n.body, tag: 'notice-' + n.id });
  } catch (e) {}
  const b = document.createElement('div');
  b.textContent = text;
  b.style.cssText = 'position:fixed;top:12px;left:12px;right:12px;z-index:9999;background:#1e293b;color:#fde68a;border:1px solid #f59e0b;border-radius:10px;padding:8px 12px;font:11px monospace;box-shadow:0 4px 14px rgba(0,0,0,.4)';
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 8000);
}
function renderBell() {
  const box = $('bellPanel');
  if (!box) return;
  if (!noticeList.length) { box.innerHTML = '<p class="text-[10px] text-gray-500 text-center py-3">Belum ada notifikasi.</p>'; return; }
  box.innerHTML = noticeList.map(n => {
    const d = new Date(n.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
    return `<div class="bg-darkbg border border-panelborder rounded-lg p-2 mb-1.5">
      <p class="text-[10px] font-bold text-yellow-300">${esc(n.title)}</p>
      <p class="text-[9px] text-gray-300 whitespace-pre-line leading-relaxed">${esc(n.body)}</p>
      <p class="text-[8px] text-gray-500 font-mono mt-1">${esc(d)}</p></div>`;
  }).join('');
}
function toggleBell() {
  const box = $('bellPanel');
  if (!box) return;
  const opening = box.classList.contains('hidden');
  box.classList.toggle('hidden');
  if (opening && noticeList[0]) {
    localStorage.setItem(NOTICE_SEEN_KEY, String(noticeList[0].id));
    const badge = $('bellBadge');
    if (badge) { badge.textContent = '0'; badge.classList.add('hidden'); }
  }
}
function renderAdminNotices() {
  const box = $('adminNoticeList');
  if (!box) return;
  if (!noticeList.length) { box.innerHTML = '<p class="text-[10px] text-gray-500 text-center py-2">Belum ada notifikasi.</p>'; return; }
  box.innerHTML = noticeList.map(n => `<div class="bg-darkbg border border-panelborder p-2 rounded flex justify-between items-start gap-2">
      <div class="min-w-0"><p class="text-[10px] font-bold text-white truncate">${esc(n.title)}</p>
      <p class="text-[9px] text-gray-400 whitespace-pre-line">${esc(n.body)}</p></div>
      <button onclick="adminDelNotice(${Number(n.id)})" class="text-red-400 hover:text-red-300 text-[10px] px-2 py-1 shrink-0"><i class="fa-solid fa-trash"></i> Hapus</button>
    </div>`).join('');
}
async function adminAddNotice() {
  const title = $('noticeTitle').value.trim();
  const body = $('noticeBody').value.trim();
  if (!title || !body) return alert('Judul dan isi wajib diisi.');
  const r = await post('/api/notices', { title, body }, adminH());
  if (!r.ok || !r.data || !r.data.ok) return alert((r.data && r.data.msg) || 'Gagal menambah notifikasi.');
  $('noticeTitle').value = '';
  $('noticeBody').value = '';
  loadNotices();
}
async function adminDelNotice(id) {
  if (!confirm('Hapus notifikasi ini?')) return;
  const r = await api('/api/notices?id=' + encodeURIComponent(id), { method: 'DELETE', headers: adminH() });
  if (!r.ok || !r.data || !r.data.ok) alert((r.data && r.data.msg) || 'Gagal menghapus.');
  loadNotices();
}
setTimeout(loadNotices, 1500);
setInterval(loadNotices, 60000);

"""

PATCHES = [
    ("A. tombol lonceng di header",
     '      <button onclick="toggleLang()" id="langBtn"',
     BELL_HTML),
    ("B. form dan daftar notifikasi di dashboard admin",
     ADMIN_ANCHOR,
     ADMIN_ANCHOR + ADMIN_HTML),
    ("C. fungsi notifikasi",
     "function toggleLang() {",
     JS + "function toggleLang() {"),
]


def main():
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(1)
    path = sys.argv[1]
    src = open(path, encoding='utf-8').read()
    if GUARD in src:
        print("SUDAH DITERAPKAN sebelumnya. File TIDAK diubah."); sys.exit(0)
    for name, old, _ in PATCHES:
        n = src.count(old)
        if n != 1:
            print(f"GAGAL: '{name}' ditemukan {n} kali (harus 1). File TIDAK diubah."); sys.exit(2)
    for name, old, new in PATCHES:
        src = src.replace(old, new, 1)
        print(f"OK: {name}")
    shutil.copyfile(path, path + '.bak')
    open(path, 'w', encoding='utf-8').write(src)
    print(f"Selesai. File asli disimpan di {path}.bak")


if __name__ == '__main__':
    main()
