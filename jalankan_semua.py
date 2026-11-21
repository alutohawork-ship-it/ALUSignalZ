#!/usr/bin/env python3
"""
jalankan_semua.py - menjalankan semua patch index.html secara berurutan.

Letakkan di folder yang sama dengan index.html dan semua patch_*.py, lalu:
    python3 jalankan_semua.py index.html

Berhenti di langkah pertama yang GAGAL. Skrip yang sudah pernah diterapkan akan dilewati sendiri.
"""
import os
import subprocess
import sys

STEPS = [
    "patch_index.py",
    "patch_fill_candle.py",
    "patch_pending_far.py",
    "patch_manual_flicker.py",
    "patch_no_blink.py",
    "patch_line_visual.py",
]

def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    target = sys.argv[1]
    if not os.path.isfile(target):
        print(f"File tidak ditemukan: {target}")
        sys.exit(1)

    missing = [s for s in STEPS if not os.path.isfile(s)]
    if missing:
        print("Skrip berikut tidak ada di folder ini, salin dulu:")
        for m in missing:
            print("  -", m)
        sys.exit(1)

    for s in STEPS:
        print(f"\n== {s} ==")
        r = subprocess.run([sys.executable, s, target])
        if r.returncode not in (0,):
            print(f"\nBERHENTI di {s} (kode {r.returncode}). File yang sudah diubah ada .bak-nya.")
            sys.exit(r.returncode)
    print("\nSemua patch selesai.")

if __name__ == "__main__":
    main()
