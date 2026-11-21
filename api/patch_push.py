#!/usr/bin/env python3
"""
patch_push.py - aktifkan notifikasi push di browser (index.html)

Fungsi:
  - Tombol 🔔 PUSH di header. Klik sekali: izin notifikasi, daftar service worker (sw.js),
    langganan push ke server. Setelah itu notifikasi tetap masuk walaupun browser tertutup.
  - Saat halaman dibuka dan izin sudah ada, langganan diperbarui otomatis (diam-diam).

Butuh: sw.js di root proyek, api/push-key.js, api/push-subscribe.js, lib/push.js, env VAPID_* di Vercel.

Pemakaian: python3 patch_push.py index.html   (file asli -> index.html.bak)
Jika pola tidak ditemukan tepat sekali, file TIDAK diubah.
"""
import shutil, sys

GUARD = "function enablePush("

BTN = ('      <button onclick="enablePush()" class="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-panelborder text-gray-300 border border-panelborder hover:border-accentblue" title="Aktifkan notifikasi push">🔔 PUSH</button>\n'
       '      <button onclick="toggleLang()" id="langBtn"')

JS = r"""// ── Web Push: notifikasi walaupun browser tertutup ──
function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
async function enablePush(quiet) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    if (!quiet) alert('Browser ini tidak mendukung notifikasi push.');
    return;
  }
  if (!quiet) {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return alert('Izin notifikasi ditolak. Aktifkan lewat pengaturan situs Chrome.');
  } else if (Notification.permission !== 'granted') {
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const k = await api('/api/push-key');
    if (!k.ok || !k.data || !k.data.ok) { if (!quiet) alert((k.data && k.data.msg) || 'Kunci push belum siap.'); return; }
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(k.data.key) });
    }
    const email = localStorage.getItem(K.email) || '';
    const r = await post('/api/push-subscribe', { subscription: sub.toJSON(), email });
    if (!quiet) alert((r.data && r.data.ok) ? 'Notifikasi aktif di perangkat ini.' : ((r.data && r.data.msg) || 'Gagal menyimpan langganan.'));
  } catch (e) {
    if (!quiet) alert('Gagal mengaktifkan notifikasi: ' + e.message);
  }
}
setTimeout(() => enablePush(true), 4000);

"""

PATCHES = [
    ("A. tombol PUSH di header",
     '      <button onclick="toggleLang()" id="langBtn"',
     BTN),
    ("B. fungsi enablePush dan urlB64ToUint8",
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
