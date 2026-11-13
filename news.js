// api/news.js
const KV_NEWS_KEY = 'fmp_economic_calendar_v1';

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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Cek apakah data berita ada di Cache Vercel KV
    const cachedRaw = await kv(['GET', KV_NEWS_KEY]);
    if (cachedRaw) {
      return res.status(200).json({ ok: true, events: JSON.parse(cachedRaw), source: 'cache' });
    }

    // 2. Jika cache kosong, ambil data baru dari FMP API
    const API_KEY = process.env.FMP_API_KEY;
    if (!API_KEY) return res.status(500).json({ error: 'FMP_API_KEY belum dikonfigurasi di Vercel.' });

    const today = new Date();
    const fromDate = new Date(today);
    fromDate.setDate(today.getDate() - 1); // Ambil dari kemarin
    const toDate = new Date(today);
    toDate.setDate(today.getDate() + 7); // Sampai 7 hari ke depan

    const fmtDate = d => d.toISOString().split('T')[0];
    const url = `https://financialmodelingprep.com/stable/economic-calendar?from=${fmtDate(fromDate)}&to=${fmtDate(toDate)}&apikey=${API_KEY}`;

    const response = await fetch(url);
    
    if (!response.ok) {
      if (response.status === 402) {
         throw new Error('Fitur FMP ini membutuhkan plan berbayar (402 Payment Required).');
      }
      throw new Error(`FMP API Error: HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    const events = (Array.isArray(data) ? data : [])
      .filter(e => e && e.event && e.date)
      .map(e => ({
        date: e.date,
        country: e.country || 'Global',
        currency: e.currency || '',
        event: e.event,
        impact: e.impact || 'Low',
        actual: e.actual,
        estimate: e.estimate,
        previous: e.previous
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // 3. Simpan ke Cache Vercel KV selama 1 Jam (3600 detik)
    if (process.env.KV_REST_API_URL) {
      await kv(['SET', KV_NEWS_KEY, JSON.stringify(events), 'EX', 3600]);
    }

    return res.status(200).json({ ok: true, events, source: 'api' });

  } catch (error) {
    console.error('News API Error:', error);
    // Fallback: Jika API error, coba tampilkan data dari cache terakhir
    const fallbackCache = await kv(['GET', KV_NEWS_KEY]);
    if (fallbackCache) {
      return res.status(200).json({ ok: true, events: JSON.parse(fallbackCache), source: 'cache-fallback' });
    }
    return res.status(500).json({ ok: false, error: error.message });
  }
}
