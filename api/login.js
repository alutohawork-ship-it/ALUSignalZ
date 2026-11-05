import { kv } from '@vercel/kv';

const KEY = 'alu_clients';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, msg: 'Method not allowed' });

  const input = String(req.body?.value || '').trim();
  if (!input) return res.json({ ok: false, msg: 'Input tidak boleh kosong.' });

  const adminCode = process.env.ADMIN_CODE;
  if (adminCode && input === adminCode) return res.json({ ok: true, role: 'admin' });

  const email = input.toLowerCase();
  const clients = (await kv.get(KEY)) || [];
  const c = clients.find(x => x.email === email);

  if (!c) return res.json({ ok: false, msg: 'Email belum terdaftar. Silakan hubungi admin untuk pendaftaran.' });
  if (new Date(c.expires_at) < new Date())
    return res.json({ ok: false, msg: 'Masa aktif akses email ini sudah berakhir. Hubungi admin untuk perpanjangan.' });

  return res.json({ ok: true, role: 'client', email });
}
