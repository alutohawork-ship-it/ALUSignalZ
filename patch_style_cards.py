#!/usr/bin/env python3
"""
patch_style_cards.py - satu kartu sinyal, pindah antar style lewat tab; batas 3 Scalping aktif; tombol hapus sinyal

Perubahan:
  A. Tab SCALPING / INTRADAY / SWING di atas kartu. Klik tab = tampilkan sinyal aktif style itu.
     Tab menampilkan jumlah sinyal aktif per style.
  B. Tombol hapus (ikon sampah) di kartu: membatalkan sinyal yang sedang tampil, slot kembali kosong.
  C. Batas Scalping: maksimal 3 sinyal Scalping aktif (belum CLOSED dan belum expired) per pair.
     Request baru ditolak sampai ada yang expired, kena SL / TP max, atau dihapus.

Pemakaian: python3 patch_style_cards.py index.html   (file asli -> index.html.bak)
Jika salah satu pola tidak ditemukan tepat sekali, file TIDAK diubah.
"""
import shutil, sys

GUARD = "function pickStyleTab("

TAB_HTML = (
    '        <div id="styleTabs" class="flex gap-1"></div>\n'
    '        <div id="activeCard" class="hidden space-y-3">'
)

DELETE_BTN = (
    '<button onclick="copySignal()" class="text-gray-400 hover:text-white transition" title="Copy Signal"><i class="fa-solid fa-copy"></i></button>'
    ' <button onclick="deleteActiveSignal()" class="text-gray-400 hover:text-red-400 transition" title="Hapus sinyal"><i class="fa-solid fa-trash"></i></button>'
)

NEW_FUNCS = r"""// ── Satu kartu, pindah antar style lewat tab ──
const STYLE_TABS = ['Scalping', 'Intraday', 'Swing'];
function pickStyleTab(style) {
  const sel = $('tradingStyleSelect');
  if (sel) sel.value = style;
  const list = trades.filter(x => x.key === market && x.src !== 'bot' && x.style === style);
  const open = list.filter(x => x.status !== 'CLOSED');
  const pick = (open.length ? open : list).slice(-1)[0];
  activeId = pick ? pick.id : null;
  renderAll();
}
function renderStyleTabs() {
  const box = $('styleTabs');
  if (!box) return;
  if (!box.children.length) {
    box.innerHTML = STYLE_TABS.map(s => `<button data-style-tab="${s}" onclick="pickStyleTab('${s}')" class="flex-1 text-[9px] font-bold py-1 rounded border border-panelborder text-gray-400"></button>`).join('');
  }
  const sel = $('tradingStyleSelect') ? $('tradingStyleSelect').value : 'Scalping';
  [...box.children].forEach(b => {
    const s = b.dataset.styleTab;
    const n = trades.filter(x => x.key === market && x.src !== 'bot' && x.style === s && x.status !== 'CLOSED').length;
    b.textContent = s.toUpperCase() + (n ? ` · ${n}` : '');
    const on = s === sel;
    b.classList.toggle('bg-accentblue', on);
    b.classList.toggle('text-white', on);
    b.classList.toggle('border-accentblue', on);
  });
  box.classList.toggle('hidden', market === 'VISION' || isBotView() || isChatBotView());
}
function deleteActiveSignal() {
  const t = activeTrade();
  if (!t || !confirm('Hapus sinyal ini? Slot akan kembali kosong untuk sinyal baru.')) return;
  cancelTrade(t, 'Dihapus pengguna');
  activeId = null;
  saveTrades();
  renderAll();
}
"""

PATCHES = [
    ("A. tab style di atas kartu",
     '        <div id="activeCard" class="hidden space-y-3">',
     TAB_HTML),
    ("B. tombol hapus di kartu",
     '<button onclick="copySignal()" class="text-gray-400 hover:text-white transition" title="Copy Signal"><i class="fa-solid fa-copy"></i></button>',
     DELETE_BTN),
    ("C. fungsi tab, hapus, dan render tab",
     "function refreshCard() {\n  if (isBotView() || isChatBotView()) {",
     NEW_FUNCS + "function refreshCard() {\n  renderStyleTabs();\n  if (isBotView() || isChatBotView()) {"),
    ("D. batas 3 Scalping aktif",
     "  const originalText = btnText.textContent;\n",
     "  {\n"
     "    const selStyle = $('tradingStyleSelect').value;\n"
     "    const openSc = trades.filter(x => x.key === market && x.src !== 'bot' && x.style === selStyle && x.status !== 'CLOSED' && Date.now() < (x.expiresAt || 0));\n"
     "    if (selStyle === 'Scalping' && openSc.length >= 3) return alert('Batas 3 sinyal Scalping aktif. Tunggu expired / SL / TP max, atau hapus salah satu sinyal.');\n"
     "  }\n"
     "  const originalText = btnText.textContent;\n"),
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
