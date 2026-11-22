// crt-fix.js — pelacakan trade manual CRT (Intraday & Swing) di browser, tanpa edit index.html.
// Aturan: TP1 -> stop ke entry (BE). TP2 -> TIDAK ditutup, stop dikunci di TP1.
// TP3 -> ditutup di TP3. Stop/BE/SL -> ditutup. Batas waktu: Intraday 8 jam atau ganti hari UTC,
// Swing 30 hari. Saat ditutup tanpa TP3, pips dicatat = pips terbaik yang sempat tercapai.
// Trade non-CRT tetap memakai evalTrade asli.
(function () {
  const origEval = window.evalTrade;
  if (typeof origEval !== 'function') return;

  const isCrt = t => !!t && (t.style === 'Intraday' || t.style === 'Swing') && /CRT/.test(String(t.setup || ''));
  const nextUtcMidnight = ms => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
  const crtExpiry = t => {
    const c = t.createdAt || Date.now();
    return t.style === 'Swing' ? c + 30 * 86400e3 : Math.min(c + 8 * 3600e3, nextUtcMidnight(c));
  };

  window.evalTrade = function (t, p, lo, hi, now) {
    lo = lo == null ? p : lo; hi = hi == null ? p : hi; now = now || Date.now();
    if (!isCrt(t) || t.status === 'CLOSED') return origEval.apply(this, arguments);

    if (!t.crtExpFixed) { t.expiresAt = crtExpiry(t); t.crtExpFixed = true; }

    // Pending: pakai logika asli (isi limit, batal karena expired / SL sebelum entry)
    if (t.status === 'PENDING') {
      const r = origEval.call(this, t, p, lo, hi, now);
      if (t.status === 'RUNNING' && !t.crt) t.crt = { hitTP1: false, hitTP2: false, maxPips: 0, stop: t.sl };
      return r;
    }

    if (!t.crt) t.crt = { hitTP1: false, hitTP2: false, maxPips: 0, stop: t.sl };
    const c = t.crt;
    t.hits = t.hits || {};
    const d = t.dir, pip = t.pip || 0.1, eps = pip * 0.5;
    const px = v => (v - t.entry) * d / pip;
    const best = d > 0 ? hi : lo, worst = d > 0 ? lo : hi;
    const reached = (v, x) => v != null && (d > 0 ? x >= v - eps : x <= v + eps);
    const r1 = v => Math.round(v * 10) / 10;

    const finish = (result, exit, maxTp, pips) => {
      Object.assign(t, { status: 'CLOSED', result, exitPrice: exit, closedAt: now, maxTp, pips: r1(pips) });
      return true;
    };

    c.maxPips = Math.max(c.maxPips, px(best));
    if (!c.hitTP1 && reached(t.tp1, best)) { c.hitTP1 = true; c.stop = t.entry; t.hits.tp1 = { at: now, price: t.tp1 }; }
    if (!c.hitTP2 && reached(t.tp2, best)) { c.hitTP2 = true; c.stop = t.tp1; t.hits.tp2 = { at: now, price: t.tp2 }; }
    if (reached(t.tp3, best)) return finish('TP', t.tp3, 3, px(t.tp3));

    const stopHit = d > 0 ? worst <= c.stop + eps : worst >= c.stop - eps;
    if (stopHit) {
      if (c.hitTP2) return finish('TP', c.stop, 2, c.maxPips);
      if (c.hitTP1) return finish('BE', t.entry, 1, c.maxPips);
      return finish('SL', c.stop, 0, px(c.stop));
    }

    if (now >= (t.expiresAt || 0)) {
      if (c.hitTP2) return finish('TP', p, 2, c.maxPips);
      if (c.hitTP1) return finish('TP', p, 1, c.maxPips);
      return finish('BE', p, 0, px(p));
    }
    if (c.hitTP1 || c.hitTP2) t.status = 'BE';   // status tampilan: sudah ada TP
    return c.hitTP1 || c.hitTP2;
  };

  // ================= TAMPILAN: zona WNS saat menunggu & bot server =================
  // 1) Simpan alasan STANDBY terakhir (berisi area WNS) agar tidak hilang saat status "menunggu" tampil
  const origStandby = window.showManualStandby;
  if (typeof origStandby === 'function') {
    window.showManualStandby = function (sig) {
      try { window.__lastStandby = { style: (typeof $ === 'function' && $('tradingStyleSelect')) ? $('tradingStyleSelect').value : '', text: String((sig && (sig.reason || (sig.reasons && sig.reasons.id))) || '') }; } catch (e) {}
      return origStandby.apply(this, arguments);
    };
  }

  // 2) Kartu "TUNGGU SIGNAL" Intraday/Swing: tampilkan zona WNS (bukan hanya tulisan menunggu)
  window.srvPaintWaiting = function () {
    const sv = document.getElementById('standbyView');
    if (!sv || market === 'VISION' || isBotView() || isChatBotView()) return;
    const style = document.getElementById('tradingStyleSelect') ? document.getElementById('tradingStyleSelect').value : '';
    if (!['Intraday', 'Swing'].includes(style) || activeTrade()) return;
    if (srvStyleState(style) !== 'watch') {
      if (sv.dataset.waitHtml && sv.innerHTML === sv.dataset.waitHtml) { sv.innerHTML = T('standby1'); delete sv.dataset.waitHtml; }
      return;
    }
    const ls = window.__lastStandby;
    const txt = ls && ls.style === style && ls.text ? ls.text : '';
    const html = '<div class="bg-darkbg border border-yellow-500/40 rounded-lg p-3 space-y-1">' +
      '<p class="text-sm font-black text-yellow-300 text-center">⌛ TUNGGU SIGNAL</p>' +
      '<p class="text-[10px] font-mono text-gray-300 text-center">' + esc(style) + ' · ' + esc(market) + ' · cek tiap ' + (style === 'Intraday' ? '5' : '15') + ' menit</p>' +
      (txt ? '<pre class="text-[10px] font-mono text-gray-300 whitespace-pre-wrap leading-relaxed">' + esc(txt) + '</pre>' : '') +
      '</div>';
    if (sv.dataset.waitHtml !== html) { sv.innerHTML = html; sv.dataset.waitHtml = html; }
    sv.classList.remove('hidden');
  };

  // 3) Panel AUTOBOT lama (scanner di browser) berkedip karena beberapa fungsi menulis teks yang sama.
  //    Dimatikan; panel menampilkan status bot server (lock, POI aktif) dari /api/bot?a=signals.
  window.runBotCycle = async function () {};
  window.updateBotInteractiveReason = function () {};

  let srvBotTimer = null;
  async function renderServerBot() {
    const msg = document.getElementById('botMsg');
    const ai = document.getElementById('botAiReason');
    const email = localStorage.getItem('alu_user_email');
    if (!msg || !email || typeof isBotView !== 'function' || !isBotView()) return;
    try {
      const r = await fetch('/api/bot?a=signals&email=' + encodeURIComponent(email));
      const d = await r.json();
      if (!d || !d.ok) { msg.textContent = (d && d.msg) || 'Status bot server belum tersedia.'; return; }
      const lk = d.lock || {};
      const now = Date.now();
      const locked = lk.locked_until && now < new Date(lk.locked_until).getTime();
      msg.style.whiteSpace = 'pre-line';
      msg.textContent = locked
        ? '🔒 Bot server terkunci sampai ' + new Date(lk.locked_until).toISOString().slice(11, 16) + ' UTC\n' + (lk.lock_reason || '')
        : 'Bot server aktif. Memantau M15 dan M5 setiap candle M5 tutup.';
      const p = d.pending || null;
      const o = d.open || null;
      if (ai) ai.textContent = o ? ('Posisi berjalan: ' + o.side + ' ' + o.entry + ' · TP1 ' + o.tp1 + ' · TP2 ' + o.tp2 + ' · TP3 ' + o.tp3)
        : p ? ('POI #' + p.poi_no + ' · ' + p.side + ' LIMIT ' + p.entry + ' · SL ' + p.sl)
        : 'Belum ada POI aktif.';
    } catch (e) { msg.textContent = 'Status bot server tidak bisa dimuat.'; }
  }
  if (srvBotTimer) clearInterval(srvBotTimer);
  srvBotTimer = setInterval(renderServerBot, 20000);
  setTimeout(renderServerBot, 3000);

})();
