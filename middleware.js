// middleware.js — menyisipkan <script src="/notif-fix.js"> ke halaman utama tanpa mengubah index.html
// Berjalan di Vercel Edge. Aman dijalankan berulang: script hanya disisipkan sekali.
export const config = { matcher: ['/'] };

export default async function middleware(request) {
  const res = await fetch(new URL('/index.html', request.url));
  const type = res.headers.get('content-type') || '';
  if (!type.includes('text/html')) return res;
  let html = await res.text();
  if (!html.includes('notif-fix.js')) {
    html = html.replace('</body>', '<script src="/notif-fix.js"></script>\n</body>');
  }
  return new Response(html, {
    status: res.status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
