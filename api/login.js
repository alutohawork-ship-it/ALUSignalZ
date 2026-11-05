const KEY = 'alu_clients';

// Panggil Upstash REST API langsung, tanpa npm package
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const input = String(body.value || '').trim();
    if (!input) return res.status(200).json({ ok: false, msg: 'Input tidak boleh kosong.' });

    const adminCode = process.env.ADMIN_CODE;
    if (adminCode && input === adminCode) {
      return res.status(200).json({ ok: true, role: 'admin' });
    }

    const email = input.toLowerCase();
    const clients = await readClients();
    const c = clients.find(x => x.email === email);

    if (!c) {
      return res.status(200).json({ ok: false, msg: 'Email belum terdaftar. Silakan hubungi admin untuk pendaftaran.' });
    }
    if (new Date(c.expires_at) < new Date()) {
      return res.status(200).json({ ok: false, msg: 'Masa aktif akses email ini sudah berakhir. Hubungi admin untuk perpanjangan.' });
    }
    return res.status(200).json({ ok: true, role: 'client', email });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ ok: false, msg: 'Server error: ' + err.message });
  }
}
