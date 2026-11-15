// api/user-info.js
const KV_KEY = 'alu_clients';

async function kv(command) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  return data.result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let body = req.body || {};
  const email = body.value;

  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const raw = await kv(['GET', KV_KEY]);
    // Jika KV kosong, anggap Admin
    if (!raw) {
       return res.status(200).json({ status: 'lifetime', expires_at: null, requests_today: 0, max_daily: 999, requests_total: 0 });
    }
    
    const clients = JSON.parse(raw);
    const c = clients.find(x => x.email === email);
    if (!c) return res.status(404).json({ error: 'User not found' });

    let reqToday = 0;
    let reqTotal = 0;
    
    // Hanya hitung pemakaian jika status trial
    if (c.status === 'trial') {
       const today = new Date().toISOString().slice(0, 10);
       const dailyKey = `trial_daily:${email}:${today}`;
       const totalKey = `trial_total:${email}`;
       reqToday = parseInt(await kv(['GET', dailyKey]) || '0', 10);
       reqTotal = parseInt(await kv(['GET', totalKey]) || '0', 10);
    }

    return res.status(200).json({
      status: c.status, // 'trial', 'monthly', 'lifetime'
      expires_at: c.expires_at,
      requests_today: reqToday,
      requests_total: reqTotal,
      max_daily: 5,
      max_total: 15
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
