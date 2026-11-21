#!/usr/bin/env python3
"""
patch_fill_candle.py - cegah TP/BE langsung terhitung setelah limit terisi (frontend)

Penyebab:
  Limit terisi secara live di tengah candle M1. Saat candle itu tutup, replayMissed memproses
  seluruh path OHLC candle tersebut. Karena status sudah RUNNING (bukan PENDING) ketika candle
  diproses, pengecekan "break setelah fill" dari patch sebelumnya tidak aktif, sehingga TP2/BE
  langsung tercatat tepat setelah entry.

Perbaikan:
  Candle tempat fill terjadi dilewati saat replay. Harga setelah fill sudah dipantau live.

Pemakaian: python3 patch_fill_candle.py index.html
File asli disimpan sebagai index.html.bak. Jika pola tidak ditemukan tepat sekali, file TIDAK diubah.
Perlu patch_index.py (v2) sudah diterapkan lebih dulu.
"""
import shutil, sys

OLD = """      const path = c.c >= c.o ? [c.o, c.l, c.h, c.c] : [c.o, c.h, c.l, c.c];
      const wasPending = t.status === 'PENDING';"""
NEW = """      // Candle tempat limit terisi: urutan harga di dalam candle tidak diketahui, dan
      // sejak fill sudah dipantau live. Lewati agar TP/BE tidak tercatat dari candle yang sama.
      if (t.filledAt && c.t <= Math.floor(t.filledAt / 60000) * 60000) { t.scanAt = end; continue; }
      const path = c.c >= c.o ? [c.o, c.l, c.h, c.c] : [c.o, c.h, c.l, c.c];
      const wasPending = t.status === 'PENDING';"""

def main():
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(1)
    path = sys.argv[1]
    src = open(path, encoding='utf-8').read()
    if 'Candle tempat limit terisi' in src:
        print("SUDAH DITERAPKAN sebelumnya. File TIDAK diubah."); sys.exit(0)
    n = src.count(OLD)
    if n != 1:
        print(f"GAGAL: pola ditemukan {n} kali (harus 1). File TIDAK diubah. Pastikan patch_index.py v2 sudah diterapkan."); sys.exit(2)
    shutil.copyfile(path, path + '.bak')
    open(path, 'w', encoding='utf-8').write(src.replace(OLD, NEW, 1))
    print(f"OK. File asli disimpan di {path}.bak")

if __name__ == '__main__':
    main()
