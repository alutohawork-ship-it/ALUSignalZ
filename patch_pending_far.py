#!/usr/bin/env python3
"""
patch_pending_far.py - batalkan pending LIMIT yang harganya sudah menjauh dari entry (frontend)

Sebelumnya pending hanya dibatalkan oleh expiry, SL tersentuh, atau OCO.
Akibatnya pending bisa menggantung ratusan pip dari harga. Sekarang pending
XAUUSD Scalping dibatalkan jika jarak harga live ke entry > 50 pip (sama dengan batas server).

Pemakaian: python3 patch_pending_far.py index.html
File asli disimpan sebagai index.html.bak. Jika pola tidak ditemukan tepat sekali, file TIDAK diubah.
"""
import shutil, sys

OLD = """    if (t.expiresAt && now > t.expiresAt) {
      cancelTrade(t, 'Zona tidak tersentuh (Expired)');
      return true;
    }
"""
NEW = """    if (t.expiresAt && now > t.expiresAt) {
      cancelTrade(t, 'Zona tidak tersentuh (Expired)');
      return true;
    }
    // Pending menjauh dari harga (XAUUSD Scalping > 50 pip): batalkan, sama dengan batas di server
    if (t.key === 'XAUUSD' && t.style === 'Scalping' && Math.abs(p - t.entry) / (t.pip || 0.1) > 50) {
      cancelTrade(t, 'Harga menjauh dari entry (> 50 pip)');
      return true;
    }
"""

def main():
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(1)
    path = sys.argv[1]
    src = open(path, encoding='utf-8').read()
    if 'Harga menjauh dari entry' in src:
        print("SUDAH DITERAPKAN sebelumnya. File TIDAK diubah."); sys.exit(0)
    n = src.count(OLD)
    if n != 1:
        print(f"GAGAL: pola ditemukan {n} kali (harus 1). File TIDAK diubah."); sys.exit(2)
    shutil.copyfile(path, path + '.bak')
    open(path, 'w', encoding='utf-8').write(src.replace(OLD, NEW, 1))
    print(f"OK. File asli disimpan di {path}.bak")

if __name__ == '__main__':
    main()
