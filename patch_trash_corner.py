#!/usr/bin/env python3
"""
patch_trash_corner.py - pindahkan tombol hapus sinyal ke pojok kanan atas kartu (jauh dari tombol copy)

Sebelumnya tombol hapus ada di sebelah tombol copy (mudah salah pencet).
Sekarang: tombol copy kembali sendirian di tengah, tombol hapus di pojok kanan atas di atas kartu.

Pemakaian: python3 patch_trash_corner.py index.html   (file asli -> index.html.bak)
Jika pola tidak ditemukan tepat sekali, file TIDAK diubah.
Perlu patch_style_cards.py sudah diterapkan lebih dulu.
"""
import shutil, sys

OLD_COPY = ('<button onclick="copySignal()" class="text-gray-400 hover:text-white transition" title="Copy Signal"><i class="fa-solid fa-copy"></i></button>'
            ' <button onclick="deleteActiveSignal()" class="text-gray-400 hover:text-red-400 transition" title="Hapus sinyal"><i class="fa-solid fa-trash"></i></button>')
NEW_COPY = '<button onclick="copySignal()" class="text-gray-400 hover:text-white transition" title="Copy Signal"><i class="fa-solid fa-copy"></i></button>'

OLD_TAB = ('        <div id="styleTabs" class="flex gap-1"></div>\n'
           '        <div id="activeCard" class="hidden space-y-3">')
NEW_TAB = ('        <div id="styleTabs" class="flex gap-1"></div>\n'
           '        <div class="flex justify-end -mb-1">\n'
           '          <button id="btnDelSig" onclick="deleteActiveSignal()" class="text-gray-500 hover:text-red-400 transition text-[10px] px-2 py-0.5 rounded border border-panelborder" title="Hapus sinyal aktif"><i class="fa-solid fa-trash"></i> Hapus</button>\n'
           '        </div>\n'
           '        <div id="activeCard" class="hidden space-y-3">')

def main():
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(1)
    path = sys.argv[1]
    src = open(path, encoding='utf-8').read()
    if 'id="btnDelSig"' in src:
        print("SUDAH DITERAPKAN sebelumnya. File TIDAK diubah."); sys.exit(0)
    for name, old in [("tombol copy + hapus", OLD_COPY), ("baris styleTabs + activeCard", OLD_TAB)]:
        n = src.count(old)
        if n != 1:
            print(f"GAGAL: '{name}' ditemukan {n} kali (harus 1). File TIDAK diubah."); sys.exit(2)
    src = src.replace(OLD_COPY, NEW_COPY, 1).replace(OLD_TAB, NEW_TAB, 1)
    shutil.copyfile(path, path + '.bak')
    open(path, 'w', encoding='utf-8').write(src)
    print("OK: tombol hapus dipindah ke pojok kanan atas kartu.")
    print(f"Selesai. File asli disimpan di {path}.bak")

if __name__ == '__main__':
    main()
