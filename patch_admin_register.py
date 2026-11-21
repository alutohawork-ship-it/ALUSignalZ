#!/usr/bin/env python3
"""
patch_admin_register.py - perbaiki pendaftaran klien di dashboard admin (index.html)

Masalah:
  - Email yang sudah terdaftar bisa didaftarkan ulang tanpa peringatan.
  - Setelah berhasil, klien baru sering tidak terlihat di daftar (box 300px, urutan bawah).

Perubahan (hanya fungsi registerClient):
  1. Cek dulu daftar klien. Kalau email sudah ada, tampilkan peringatan dengan status dan masa aktif.
  2. Kalau server menolak, tampilkan pesan dari server.
  3. Setelah berhasil, daftar dimuat ulang dan klien baru di-scroll ke tengah daftar.

Pemakaian: python3 patch_admin_register.py index.html   (file asli -> index.html.bak)
Jika pola tidak ditemukan tepat sekali, file TIDAK diubah.
"""
import shutil, sys

OLD = """async function registerClient() {
  const email = $('newClientEmail').value.trim().toLowerCase();
  if (!email) return alert('Masukkan email klien.');
  const r = await post('/api/clients', { email, status: $('newClientStatus').value }, adminH());
  // Server membalas HTTP 200 dengan ok:false untuk email duplikat, jadi cek data.ok juga
  if (!r.ok || !r.data || !r.data.ok) return alert((r.data && r.data.msg) || errOf(r, 'Gagal mendaftarkan klien.'));
  alert('Berhasil mendaftarkan klien: ' + email);
  $('newClientEmail').value = '';
  loadClients();
}"""

NEW = """async function registerClient() {
  const email = $('newClientEmail').value.trim().toLowerCase();
  if (!email) return alert('Masukkan email klien.');
  // Cek dulu: email yang sudah terdaftar tidak didaftarkan ulang
  const cur = await api('/api/clients', { headers: adminH() });
  const existing = cur.ok && Array.isArray(cur.data) ? cur.data.find(d => String(d.email).toLowerCase() === email) : null;
  if (existing) {
    const exp = existing.expires_at ? new Date(existing.expires_at).toLocaleDateString('id-ID') : '-';
    return alert(`Email ini sudah terdaftar.\\nStatus: ${existing.status}\\nBerlaku s/d: ${exp}\\n\\nHapus dulu dari daftar jika ingin mendaftarkan ulang.`);
  }
  const r = await post('/api/clients', { email, status: $('newClientStatus').value }, adminH());
  // Server membalas HTTP 200 dengan ok:false untuk email duplikat, jadi cek data.ok juga
  if (!r.ok || !r.data || !r.data.ok) return alert((r.data && r.data.msg) || errOf(r, 'Gagal mendaftarkan klien.'));
  alert('Berhasil mendaftarkan klien: ' + email);
  $('newClientEmail').value = '';
  await loadClients();
  // Tampilkan klien baru di tengah daftar agar tidak tertinggal di bawah
  setTimeout(() => {
    const el = [...document.querySelectorAll('#adminClientTableList p.font-mono')].find(p => p.textContent === email);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 300);
}"""


def main():
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(1)
    path = sys.argv[1]
    src = open(path, encoding='utf-8').read()
    if 'Email ini sudah terdaftar' in src:
        print("SUDAH DITERAPKAN sebelumnya. File TIDAK diubah."); sys.exit(0)
    n = src.count(OLD)
    if n != 1:
        print(f"GAGAL: fungsi registerClient ditemukan {n} kali (harus 1). File TIDAK diubah."); sys.exit(2)
    shutil.copyfile(path, path + '.bak')
    open(path, 'w', encoding='utf-8').write(src.replace(OLD, NEW, 1))
    print("OK: registerClient diperbarui.")
    print(f"Selesai. File asli disimpan di {path}.bak")


if __name__ == '__main__':
    main()
