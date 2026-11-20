#!/usr/bin/env python3
"""
patch_manual_flicker.py - perbaiki sinyal manual yang berkedip dan tidak memberi sinyal

Penyebab:
  - Saat sudah ada trade aktif, respons STANDBY ditampilkan ke standbyView, tetapi refreshCard()
    (berjalan tiap detik) menyembunyikannya lagi karena trade aktif. Hasilnya: berkedip, sinyal tidak terlihat.
  - Frontend tidak mengirim prevSignal, jadi server tidak mengunci sinyal yang masih valid.
  - Respons sticky dari server dibuat sebagai trade baru (duplikat) setiap klik.

Perubahan:
  A. Variabel standbyNote
  B. Fungsi prevSignalOf(): mengirim sinyal aktif (manual) ke server sebagai prevSignal
  C. Payload generateSignal menyertakan prevSignal
  D. Respons sticky dipakai ulang tanpa membuat trade baru; standbyNote dihapus saat ada respons baru
  E. Saat STANDBY dan ada trade aktif, alasan standby ditampilkan di kartu aktif (tidak menutup sinyal)
  F. refreshCard menghormati standbyNote agar tidak tertimpa tiap detik

Pemakaian: python3 patch_manual_flicker.py index.html
File asli disimpan sebagai index.html.bak. Jika salah satu pola tidak ditemukan tepat sekali, file TIDAK diubah.
"""
import shutil
import sys

PATCHES = [
    ("A. variabel standbyNote",
     "let visionTrade = null;",
     "let visionTrade = null;\nlet standbyNote = null; // alasan STANDBY saat sinyal aktif tetap berjalan"),

    ("B. fungsi prevSignalOf",
     "async function generateSignal() {",
     """// Sinyal manual aktif dikirim ke server agar dikunci selama masih valid (tidak berkedip)
function prevSignalOf(t) {
  if (!t || t.src === 'bot' || t.status === 'CLOSED' || t.ocoId) return null;
  return {
    status: t.status === 'PENDING' ? 'PENDING' : 'RUNNING',
    signal: t.signal, symbol: t.key, style: t.style,
    entry: t.entry, sl: t.sl, tp1: t.tp1,
    expiresAt: t.expiresAt, createdAt: t.createdAt,
    invalidLevel: t.invalidLevel ?? null,
  };
}

async function generateSignal() {"""),

    ("C. payload menyertakan prevSignal",
     "      lang: lang\n    };\n\n    const res = await post('/api/generate', payload);",
     "      lang: lang,\n      prevSignal: prevSignalOf(activeTrade())\n    };\n\n    const res = await post('/api/generate', payload);"),

    ("D. respons sticky dipakai ulang, tanpa trade duplikat",
     "    const sig = data.signal;\n",
     "    const sig = data.signal;\n"
     "    standbyNote = null;\n"
     "    if (sig && sig.sticky && activeTrade()) { renderAll(); return; }\n"),

    ("E. STANDBY saat trade aktif: tampilkan di kartu aktif",
     "  if (ac && !activeId) ac.classList.add('hidden');\n",
     "  if (ac && !activeId) ac.classList.add('hidden');\n"
     "  if (activeTrade()) { standbyNote = 'STANDBY · sinyal aktif tetap berjalan\\n' + text; renderAll(); return; }\n"),

    ("F. refreshCard menghormati standbyNote",
     "  setTxt('cardReason', cleanReason(reasonFor(t)));",
     "  setTxt('cardReason', standbyNote ? standbyNote : cleanReason(reasonFor(t)));"),
]

GUARD = "prevSignalOf("


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    src = open(path, encoding="utf-8").read()
    if "function prevSignalOf(" in src:
        print("SUDAH DITERAPKAN sebelumnya. File TIDAK diubah.")
        sys.exit(0)
    for name, old, _ in PATCHES:
        n = src.count(old)
        if n != 1:
            print(f"GAGAL: '{name}' ditemukan {n} kali (harus 1). File TIDAK diubah.")
            sys.exit(2)
    for name, old, new in PATCHES:
        src = src.replace(old, new, 1)
        print(f"OK: {name}")
    shutil.copyfile(path, path + ".bak")
    open(path, "w", encoding="utf-8").write(src)
    print(f"Selesai. File asli disimpan di {path}.bak")


if __name__ == "__main__":
    main()
