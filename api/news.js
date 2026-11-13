// api/news.js
// Menggunakan ShowMyTrades API (gratis, tanpa API Key)
const KV_NEWS_KEY = 'economic_calendar_v2';

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
    // 1. Cek cache Vercel KV terlebih dahulu
    const cachedRaw = await kv(['GET', KV_NEWS_KEY]);
    if (cachedRaw) {
      return res.status(200).json({ ok: true, events: JSON.parse(cachedRaw), source: 'cache' });
    }

    // 2. Ambil data dari ShowMyTrades API
    const url = 'https://showmytrades.com/api/public/calendar/v1?currency=USD,EUR,GBP,JPY,AUD,NZD,CAD,CHF,CNY&impact=high,medium,low&days=7&format=json';
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ShowMyTrades API Error: HTTP ${response.status}`);
    }

    const data = await response.json();
    const events = (data.events || []).map(e => ({
      date: new Date(e.ts * 1000).toISOString(),
      country: e.currency || '',
      currency: e.currency || '',
      event: e.title || '',
      impact: e.impact || 'Low',
      actual: e.actual,
      estimate: e.forecast,
      previous: e.previous
    }));

    // 3. Simpan ke cache Vercel KV selama 1 jam (3600 detik)
    if (process.env.KV_REST_API_URL) {
      await kv(['SET', KV_NEWS_KEY, JSON.stringify(events), 'EX', 3600]);
    }

    return res.status(200).json({ ok: true, events, source: 'api' });

  } catch (error) {
    console.error('News API Error:', error);
    // Fallback ke cache jika API error
    const fallbackCache = await kv(['GET', KV_NEWS_KEY]);
    if (fallbackCache) {
      return res.status(200).json({ ok: true, events: JSON.parse(fallbackCache), source: 'cache-fallback' });
    }
    return res.status(500).json({ ok: false, error: error.message });
  }
}
