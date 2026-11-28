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

// ---- Label sumber di chart: ganti teks XBTFX dengan FXOpen (srcLabel/srcOf di index adalah const, tidak bisa ditimpa)
(function () {
  const rep = s => s.replace(/server XBTFX/g, 'server FXOpen').replace(/lokal \(XBTFX WS\)/g, 'lokal (FXOpen)').replace(/XBTFX/g, 'FXOpen');
  try {
    const proto = CanvasRenderingContext2D.prototype;
    const origFill = proto.fillText;
    proto.fillText = function (t) {
      const a = Array.prototype.slice.call(arguments);
      if (typeof t === 'string' && t.indexOf('XBTFX') >= 0) a[0] = rep(t);
      return origFill.apply(this, a);
    };
  } catch (e) {}
  function fixDom(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeValue && n.nodeValue.indexOf('XBTFX') >= 0) n.nodeValue = rep(n.nodeValue);
    }
  }
  window.addEventListener('load', () => {
    fixDom(document.body);
    new MutationObserver(() => fixDom(document.body))
      .observe(document.body, { childList: true, subtree: true, characterData: true });
  });
})();
