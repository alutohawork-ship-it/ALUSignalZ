// api/news.js
const KV_NEWS_KEY = 'fmp_economic_calendar_v3';
const KV_ISSUES_KEY = 'global_news_issues_v3';

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

  const type = req.query.type || 'calendar';

  try {
    if (type === 'calendar') {
      const cachedRaw = await kv(['GET', KV_NEWS_KEY]);
      if (cachedRaw) return res.status(200).json({ ok: true, data: JSON.parse(cachedRaw), source: 'cache' });

      const url = 'https://showmytrades.com/api/public/calendar/v1?currency=USD,EUR,GBP,JPY,AUD,NZD,CAD,CHF,CNY&impact=high,medium,low&days=7&format=json';
      const response = await fetch(url);
      
      if (!response.ok) throw new Error(`ShowMyTrades API Error: HTTP ${response.status}`);
      
      const data = await response.json();
      const rawEvents = data.events || [];
      
      const events = rawEvents.map(e => {
        const clean = (val) => (val === '' || val === undefined) ? null : val;
        return {
          date: new Date(e.ts * 1000).toISOString(),
          country: e.currency || '',
          currency: e.currency || '',
          event: e.event || e.title || '', // PERBAIKAN: Gunakan e.event
          impact: e.impact || 'Low',
          actual: clean(e.actual),
          estimate: clean(e.forecast),
          previous: clean(e.previous)
        };
      }).filter(e => e.event !== ''); // Buang data yang tidak punya judul

      if (process.env.KV_REST_API_URL) await kv(['SET', KV_NEWS_KEY, JSON.stringify(events), 'EX', 3600]);
      return res.status(200).json({ ok: true, data: events, source: 'api' });

    } else if (type === 'issues') {
      const cachedRaw = await kv(['GET', KV_ISSUES_KEY]);
      if (cachedRaw) return res.status(200).json({ ok: true, data: JSON.parse(cachedRaw), source: 'cache' });

      const API_KEY = process.env.GNEWS_API_KEY;
      if (!API_KEY) throw new Error('GNEWS_API_KEY belum dikonfigurasi di Vercel.');

      const url = `https://gnews.io/api/v4/top-headlines?category=world&lang=en&max=10&apikey=${API_KEY}`;
      const response = await fetch(url);
      
      if (!response.ok) {
         const errBody = await response.text();
         throw new Error(`GNews API Error: HTTP ${response.status} - ${errBody}`);
      }
      
      const data = await response.json();
      if (!data.articles || data.articles.length === 0) {
          throw new Error('API GNews tidak menemukan berita. Coba lagi nanti atau cek kuota.');
      }

      const articles = data.articles.map(a => ({
        title: a.title,
        description: a.description,
        url: a.url,
        image: a.image,
        publishedAt: a.publishedAt,
        source: a.source.name
      }));

      if (process.env.KV_REST_API_URL) await kv(['SET', KV_ISSUES_KEY, JSON.stringify(articles), 'EX', 7200]);
      
      return res.status(200).json({ ok: true, data: articles, source: 'api' });
    }

    return res.status(400).json({ ok: false, error: 'Parameter "type" tidak valid.' });

  } catch (error) {
    console.error('News API Error:', error);
    const fallbackKey = type === 'calendar' ? KV_NEWS_KEY : KV_ISSUES_KEY;
    const fallbackCache = await kv(['GET', fallbackKey]);
    if (fallbackCache) {
      return res.status(200).json({ ok: true, data: JSON.parse(fallbackCache), source: 'cache-fallback' });
    }
    return res.status(500).json({ ok: false, error: error.message });
  }
}
