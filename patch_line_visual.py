#!/usr/bin/env python3
"""
patch_line_visual.py - garis Entry/SL/TP di LIVE MAP mulai dari candle entry, bukan dari tepi kiri layar (visual saja)

Garis level hanya menggambar; logika trade membaca harga tick. Patch ini hanya mengubah titik awal
garis saat trade berjalan: dari candle tempat limit terisi sampai tepi kanan.

Pemakaian: python3 patch_line_visual.py index.html   (file asli -> index.html.bak)
Jika pola tidak ditemukan tepat sekali, file TIDAK diubah. Perlu patch_index.py v2 sudah diterapkan.
"""
import shutil, sys

OLD = """    cx.setLineDash(l.dash);
    cx.beginPath(); cx.moveTo(plotL, y); cx.lineTo(plotR, y); cx.stroke();"""
NEW = """    cx.setLineDash(l.dash);
    // Garis mulai dari candle entry (saat trade berjalan), bukan dari tepi kiri layar
    const lx = (t && t.status !== 'CLOSED' && t.status !== 'PENDING' && t.filledAt)
      ? clampX(xOfT(Math.floor(t.filledAt / 60000) * 60000), plotL, plotR) : plotL;
    cx.beginPath(); cx.moveTo(lx, y); cx.lineTo(plotR, y); cx.stroke();"""

def main():
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(1)
    path = sys.argv[1]
    src = open(path, encoding='utf-8').read()
    if 'Garis mulai dari candle entry' in src:
        print("SUDAH DITERAPKAN sebelumnya. File TIDAK diubah."); sys.exit(0)
    n = src.count(OLD)
    if n != 1:
        print(f"GAGAL: pola ditemukan {n} kali (harus 1). File TIDAK diubah."); sys.exit(2)
    shutil.copyfile(path, path + '.bak')
    open(path, 'w', encoding='utf-8').write(src.replace(OLD, NEW, 1))
    print(f"OK. File asli disimpan di {path}.bak")

if __name__ == '__main__':
    main()
