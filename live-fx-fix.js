// live-fx-fix.js — harga live dari FXOpen (bid) lewat /api/live setiap 1 detik.
// Menggantikan WebSocket XBTFX di browser. Tanpa edit index.html: memakai fungsi global
// onQuote() dan post() yang sudah ada di index.
(function () {
  const POLL_MS = 1000;
  let timer = null, running = false, lastOk = 0;

  // Matikan koneksi XBTFX dan cegah reconnect
  window.connect = function () { /* XBTFX dinonaktifkan: live dari FXOpen */ };
  try {
    if (typeof ws !== 'undefined' && ws) { const o = ws; ws = null; o.onclose = null; o.close(); }
    if (typeof reconT !== 'undefined') clearTimeout(reconT);
    if (typeof pingT !== 'undefined') clearInterval(pingT);
  } catch (e) {}

  function badge(t, c) { try { if (typeof wsBadge === 'function') wsBadge(t, c); } catch (e) {} }

  async function tick() {
    if (!running) return;
    try {
      const email = (typeof K !== 'undefined' && localStorage.getItem(K.email)) || '';
      if (!email) { badge('LOGIN DULU', 'gray'); return schedule(); }
      const r = await post('/api/candles', { value: email, email: email, mode: 'live', symbols: ['XAUUSD', 'BTCUSD'] });
      if (r && r.ok && r.data && Array.isArray(r.data.quotes)) {
        for (const q of r.data.quotes) {
          if (!(q.bid > 0)) continue;
          onQuote({ channel: 'quote', symbol: q.symbol, bid: q.bid, price: q.bid, ask: q.ask });
        }
        lastOk = Date.now();
        badge(r.data.stale ? 'FX STALE' : 'FX LIVE', r.data.stale ? 'yellow' : 'green');
      } else {
        badge('FX ERR ' + (r && r.status ? r.status : ''), 'red');
      }
    } catch (e) {
      badge('FX OFFLINE', 'red');
    }
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (running) timer = setTimeout(tick, POLL_MS);
  }

  function start() {
    if (running) return;
    running = true;
    tick();
  }

  // Mulai setelah login / halaman siap
  window.addEventListener('load', () => setTimeout(start, 800));
  setTimeout(start, 1500);
})();
