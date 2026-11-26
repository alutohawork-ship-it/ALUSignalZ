// middleware.js — menyisipkan script tambahan ke halaman utama tanpa mengubah index.html
// Berjalan di Vercel Edge. Setiap script hanya disisipkan sekali.
export const config = { matcher: ['/'] };

const SCRIPTS = ['notif-fix.js', 'vision-fix.js', 'crt-fix.js', 'scalp5-fix.js', 'livemap-fix.js'];

export default async function middleware(request) {
  const res = await fetch(new URL('/index.html', request.url));
  const type = res.headers.get('content-type') || '';
  if (!type.includes('text/html')) return res;
  let html = await res.text();
  const add = SCRIPTS.filter(f => !html.includes(f)).map(f => '<script src="/' + f + '"></script>').join('\n');
  if (add) html = html.replace('</body>', add + '\n</body>');
  return new Response(html, {
    status: res.status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
