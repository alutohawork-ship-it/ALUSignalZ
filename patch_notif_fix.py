#!/usr/bin/env python3
"""
patch_notif_fix.py - perbaikan panel notifikasi (index.html):
  1. Panel notifikasi punya tombol ✕ dan tertutup saat klik di luar panel.
  2. Notifikasi duplikat di tampilan disembunyikan (judul+isi sama).
  3. Tombol TAMBAH NOTIFIKASI tidak bisa dikirim berulang (anti double-click).
Pemakaian: python3 patch_notif_fix.py index.html   (file asli -> index.html.bak)
"""
import shutil, sys

NEW_RENDER = r"""function renderBell() {
  const box = $('bellPanel');
  if (!box) return;
  const head = `<div class="flex justify-between items-center border-b border-panelborder pb-1 mb-1.5">
      <span class="text-[9px] font-bold text-gray-400">NOTIFIKASI</span>
      <button onclick="toggleBell()" class="text-gray-300 hover:text-white text-sm px-2 leading-none" title="Tutup">✕</button></div>`;
  if (!noticeList.length) { box.innerHTML = head + '<p class="text-[10px] text-gray-500 text-center py-3">Belum ada notifikasi.</p>'; return; }
  box.innerHTML = head + noticeList.map(n => {
    const d = new Date(n.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
    return `<div class="bg-darkbg border border-panelborder rounded-lg p-2 mb-1.5">
      <p class="text-[10px] font-bold text-yellow-300">${esc(n.title)}</p>
      <p class="text-[9px] text-gray-300 whitespace-pre-line leading-relaxed">${esc(n.body)}</p>
      <p class="text-[8px] text-gray-500 font-mono mt-1">${esc(d)}</p></div>`;
  }).join('');
}
"""
GUARD = "__noticeBusy"

def main():
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(1)
    path = sys.argv[1]
    src = open(path, encoding='utf-8').read()
    if GUARD in src:
        print("SUDAH DITERAPKAN sebelumnya. File TIDAK diubah."); sys.exit(0)

    # 1) ganti renderBell (dari 'function renderBell() {' sampai 'function toggleBell() {')
    s_i = src.find("function renderBell() {"); e_i = src.find("function toggleBell() {")
    if src.count("function renderBell() {") != 1 or src.count("function toggleBell() {") != 1 or e_i < s_i:
        print("GAGAL: blok renderBell/toggleBell tidak ditemukan tepat. File TIDAK diubah."); sys.exit(2)
    src = src[:s_i] + NEW_RENDER + src[e_i:]

    # 2) sembunyikan duplikat saat memuat
    old = "  noticeList = r.data;\n"
    if src.count(old) != 1:
        print("GAGAL: 'noticeList = r.data;' tidak tepat 1. File TIDAK diubah."); sys.exit(2)
    src = src.replace(old,
        "  const seenKey = new Set();\n"
        "  noticeList = r.data.filter(n => { const k = n.title + '|' + n.body; if (seenKey.has(k)) return false; seenKey.add(k); return true; });\n", 1)

    # 3) anti double-click
    old = "async function adminAddNotice() {\n"
    if src.count(old) != 1:
        print("GAGAL: adminAddNotice tidak tepat 1. File TIDAK diubah."); sys.exit(2)
    src = src.replace(old, old +
        "  if (window.__noticeBusy) return;\n"
        "  window.__noticeBusy = true;\n"
        "  setTimeout(() => { window.__noticeBusy = false; }, 3000);\n", 1)

    # 4) tutup panel saat klik di luar
    old = "setTimeout(loadNotices, 1500);"
    if src.count(old) != 1:
        print("GAGAL: 'setTimeout(loadNotices, 1500);' tidak tepat 1. File TIDAK diubah."); sys.exit(2)
    src = src.replace(old, old +
        "\ndocument.addEventListener('click', e => {\n"
        "  const p = $('bellPanel'), b = $('bellBtn');\n"
        "  if (p && !p.classList.contains('hidden') && !p.contains(e.target) && !(b && b.contains(e.target))) p.classList.add('hidden');\n"
        "});", 1)

    shutil.copyfile(path, path + '.bak')
    open(path, 'w', encoding='utf-8').write(src)
    print("OK: panel notifikasi diperbaiki (tombol ✕, tutup di luar, anti duplikat, anti double-click).")
    print(f"Selesai. File asli disimpan di {path}.bak")

if __name__ == '__main__':
    main()
