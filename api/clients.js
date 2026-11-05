import { kv } from '@vercel/kv';

const KEY = 'alu_clients';
const STATUS_DAYS = { trial: 3, monthly: 30, lifetime: 3650 };

export default async function handler(req, res) {
  const adminCode = process.env.ADMIN_CODE;
  if (!adminCode || req.headers['x-admin-code'] !== adminCode)
    return res.status(401).json({ error: 'Kode admin salah.' });

  let clients = (await kv.get(KEY)) || [];

  if (req.method === 'GET') return res.json(clients);

  if (req.method === 'POST') {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const status = req.body?.status;
    if (!email) return res.status(400).json({ error: 'Email kosong.' });
    if (!['trial', 'monthly', 'lifetime'].includes(status))
      return res.status(400).json({ error: 'Status tidak valid.' });
    if (clients.some(c => c.email === email))
      return res.status(409).json({ error: `Email ${email} sudah terdaftar.` });

    const expires_at = new Date(Date.now() + STATUS_DAYS[status] * 86400000).toISOString();
    clients.push({ id: 'client_' + Date.now(), email, status, expires_at });
    await kv.set(KEY, clients);
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const id = req.query?.id;
    clients = clients.filter(c => c.id !== id);
    await kv.set(KEY, clients);
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
