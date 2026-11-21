#!/usr/bin/env python3
"""
patch_no_blink.py - kartu sinyal manual tidak tertutup overlay saat Analisa dijalankan dengan trade aktif

Penyebab berkedip saat ganti style:
  Setiap Analisa menjalankan overlay "Validasi Analisa Structure" (sekitar 2 detik) yang menutup kartu
  sinyal dengan blur. Kalau style diganti lalu Analisa ditekan, kartu aktif tertutup, lalu kartu baru
  atau area standby muncul. Efeknya terlihat seperti berkedip dan hilang.

Perubahan:
  Jika sudah ada trade aktif, overlay dilewati. Tombol tetap menampilkan "Menganalisa..." sebagai tanda proses.

Pemakaian: python3 patch_no_blink.py index.html   (file asli -> index.html.bak)
Jika pola tidak ditemukan tepat sekali, file TIDAK diubah.
"""
import shutil, sys

OLD = """  btnText.textContent = 'Menganalisa...';
  btn.disabled = true;
  await runValidationSteps();"""
NEW = """  btnText.textContent = 'Menganalisa...';
  btn.disabled = true;
  // Dengan trade aktif, overlay dilewati agar kartu tidak berkedip/tertutup
  if (!activeTrade()) await runValidationSteps();"""

def main():
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(1)
    path = sys.argv[1]
    src = open(path, encoding='utf-8').read()
    if 'overlay dilewati agar kartu' in src:
        print("SUDAH DITERAPKAN sebelumnya. File TIDAK diubah."); sys.exit(0)
    n = src.count(OLD)
    if n != 1:
        print(f"GAGAL: pola ditemukan {n} kali (harus 1). File TIDAK diubah."); sys.exit(2)
    shutil.copyfile(path, path + '.bak')
    open(path, 'w', encoding='utf-8').write(src.replace(OLD, NEW, 1))
    print(f"OK. File asli disimpan di {path}.bak")

if __name__ == '__main__':
    main()
