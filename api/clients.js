const KEY = 'alu_clients';
const STATUS_DAYS = { trial: 3, monthly: 30, lifetime: 3650 };

async function kv(command) {
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || `KV HTTP ${r.status}`);
  return data.result;
}

async function readClients() {
  const raw = await kv(['GET', KEY]);
  return raw ? JSON.parse(raw) : [];
}

async function writeClients(list) {
  await kv(['SET', KEY, JSON.stringify(list)]);
}

export default async function handler(req, res) {
  try {
    const adminCode = process.env.ADMIN_CODE;
    if (!adminCode || req.headers['x-admin-code'] !== adminCode) {
      return res.status(401).json({ error: 'Kode admin salah.' });
    }

    if (req.method === 'GET') {
      return res.status(200).json(await readClients());
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const email = String(body.email || '').trim().toLowerCase();
      const status = body.status;
      if (!email) return res.status(400).json({ error: 'Email kosong.' });
      if (!Object.keys(STATUS_DAYS).includes(status)) {
        return res.status(400).json({ error: 'Status tidak valid.' });
      }

      const clients = await readClients();
      if (clients.some(c => c.email === email)) {
        return res.status(409).json({ error: `Email ${email} sudah terdaftar.` });
      }

      const expires_at = new Date(Date.now() + STATUS_DAYS[status] * 86400000).toISOString();
      clients.push({ id: 'client_' + Date.now(), email, status, expires_at });
      await writeClients(clients);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      const clients = (await readClients()).filter(c => c.id !== id);
      await writeClients(clients);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('clients error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
