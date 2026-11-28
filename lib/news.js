// lib/news.js — berita crypto dari RSS (CoinDesk, Cointelegraph, Decrypt), cache 10 menit.
export const FEEDS = [
  { src: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { src: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { src: 'Decrypt', url: 'https://decrypt.co/feed' },
];
const TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, items: [] };

const unwrap = s => String(s || '').replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
const decode = s => unwrap(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#8217;/g, '’').replace(/&#8211;|&#8212;/g, '–');
const tag = (block, name) => {
  const m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? decode(m[1]) : '';
};
const attr = (block, name, attrName) => {
  const m = block.match(new RegExp('<' + name + '\\b[^>]*\\b' + attrName + '="([^"]+)"', 'i'));
  return m ? m[1] : '';
};

// Parse RSS 2.0 (<item>): title, link, pubDate, gambar dari media:content / enclosure / img di description
export function parseRss(xml, src) {
  const out = [];
  const items = String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const it of items) {
    const title = tag(it, 'title');
    const link = tag(it, 'link') || attr(it, 'link', 'href');
    const pub = Date.parse(tag(it, 'pubDate') || tag(it, 'dc:date') || '');
    const img = attr(it, 'media:content', 'url') || attr(it, 'media:thumbnail', 'url') || attr(it, 'enclosure', 'url')
      || ((tag(it, 'description').match(/<img[^>]+src="([^"]+)"/i) || [])[1] || '');
    if (!title || !/^https?:\/\//.test(link)) continue;
    out.push({ src, title, link, img, t: Number.isFinite(pub) ? pub : 0 });
  }
  return out;
}

// Label waktu relatif bahasa Indonesia, mengikuti gaya aplikasi pembanding
export function relTime(t, now = Date.now()) {
  if (!t) return '';
  const m = Math.max(0, Math.floor((now - t) / 60000));
  if (m < 1) return 'baru saja';
  if (m < 60) return 'sekitar ' + m + ' menit';
  const h = Math.floor(m / 60);
  if (h < 24) return 'sekitar ' + h + ' jam';
  return Math.floor(h / 24) + ' hari lalu';
}

async function fetchFeed(f) {
  try {
    const r = await fetch(f.url, { headers: { 'user-agent': 'AluSignalZ/1.0' }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];
    return parseRss(await r.text(), f.src);
  } catch { return []; }
}

// Semua sumber digabung, dedupe per link, terbaru dulu. Jika semua gagal, pakai cache lama.
export async function getNews({ source = '', limit = 20, force = false } = {}) {
  if (force || Date.now() - cache.at > TTL_MS) {
    const lists = await Promise.all(FEEDS.map(fetchFeed));
    const all = lists.flat();
    if (all.length) {
      const seen = new Set();
      const merged = all.filter(x => (seen.has(x.link) ? false : (seen.add(x.link), true))).sort((a, b) => b.t - a.t);
      cache = { at: Date.now(), items: merged };
    } else if (!cache.items.length) cache.at = Date.now() - TTL_MS + 60000; // coba lagi 1 menit
  }
  const want = String(source || '').toLowerCase();
  const items = cache.items.filter(x => !want || want === 'semua' || x.src.toLowerCase() === want);
  return items.slice(0, Math.min(Math.max(limit, 1), 50)).map(x => ({ ...x, ago: relTime(x.t) }));
}
