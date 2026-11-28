// tab-layout-fix.js — Tata letak Luxury 5-Tab + History/PnL (Home, News, Signal, Vision, Bot, PnL)
(function () {
  if (window.__tabLayoutLoaded) return;
  window.__tabLayoutLoaded = true;

  // 1. INJECT LUXURY CSS THEME & BOTTOM NAV
  const style = document.createElement('style');
  style.textContent = `
    body {
      background: radial-gradient(circle at top, #0f172a 0%, #06080d 100%) !important;
      padding-bottom: 84px !important;
    }
    #mainApp header {
      background: rgba(11, 14, 20, 0.85);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
      position: sticky;
      top: 0;
      z-index: 35;
      padding: 10px 12px !important;
      border-radius: 0 0 16px 16px;
    }
    .lux-card {
      background: linear-gradient(145deg, rgba(21, 25, 36, 0.92), rgba(12, 15, 23, 0.96)) !important;
      border: 1px solid rgba(255, 255, 255, 0.07) !important;
      box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.65) !important;
      border-radius: 16px !important;
    }
    .lux-tab-pane { display: none; width: 100%; max-width: 720px; margin: 0 auto; padding: 8px 4px; }
    .lux-tab-pane.active { display: flex; flex-direction: column; gap: 10px; animation: fadeInTab .2s ease; }
    @keyframes fadeInTab { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    #luxBottomNav {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 45;
      background: rgba(9, 12, 18, 0.94);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex; justify-content: space-around; align-items: center;
      padding: 8px 4px calc(8px + env(safe-area-inset-bottom));
    }
    .lux-nav-btn {
      flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px;
      color: #64748b; font-size: 10px; font-weight: 700; transition: all .2s;
      background: transparent; border: none; cursor: pointer; padding: 4px 0;
    }
    .lux-nav-btn i { font-size: 15px; transition: transform .2s; }
    .lux-nav-btn.active { color: #f8fafc; }
    .lux-nav-btn.active .nav-pill {
      background: rgba(255, 255, 255, 0.12);
      padding: 4px 14px; border-radius: 999px; color: #facc15;
    }
    .nav-pill { padding: 4px 14px; border-radius: 999px; transition: all .2s; }
    .lux-cd-badge {
      display: inline-flex; align-items: center; gap: 5px;
      background: rgba(245, 158, 11, 0.14); border: 1px solid rgba(245, 158, 11, 0.35);
      color: #fbbf24; font-family: ui-monospace, monospace; font-size: 9px; font-weight: 700;
      padding: 2px 8px; border-radius: 999px;
    }
  `;
  document.head.appendChild(style);

  let currentTab = 'home';
  let homeChartCanvas = null;

  function initLayout() {
    const mainApp = document.getElementById('mainApp');
    const mainEl = mainApp ? mainApp.querySelector('main') : null;
    if (!mainEl || document.getElementById('luxBottomNav')) return;

    // 2. BUAT KONTAINER 6 TAB (Home, News, Signal, Vision, Bot, History/PnL)
    const tabShell = document.createElement('div');
    tabShell.id = 'luxTabShell';
    tabShell.className = 'w-full flex-1 px-1 pt-2';

    const panes = {
      home: createPane('pane-home', true),
      news: createPane('pane-news', false),
      signal: createPane('pane-signal', false),
      vision: createPane('pane-vision', false),
      bot: createPane('pane-bot', false),
      history: createPane('pane-history', false)
    };
    Object.values(panes).forEach(p => tabShell.appendChild(p));
    mainEl.parentNode.insertBefore(tabShell, mainEl);
    mainEl.style.display = 'none'; // Sembunyikan grid 2-kolom lama tanpa menghapus elemennya

    // Ambil referensi semua elemen existing di index.html
    const streamPanel = document.getElementById('streamPanel');
    const highlightList = document.getElementById('highlightList');
    const sessionPanel = document.getElementById('sessionPanel');
    const marketSelect = document.getElementById('marketSelect');
    const marketCard = marketSelect ? marketSelect.closest('.bg-cardbg') : null;
    const styleContainer = document.getElementById('styleContainer');
    const biasPanel = document.getElementById('biasPanel');
    const signalBtn = document.getElementById('signalBtn');
    const standbyView = document.getElementById('standbyView');
    const signalResultCard = standbyView ? standbyView.parentElement : null;
    const chartPanel = document.getElementById('chartPanel');
    const smcPanel = document.getElementById('smcPanel');
    const visionPanel = document.getElementById('visionPanel');
    const botPanel = document.getElementById('botPanel');
    const recapCard = document.getElementById('recapCard');
    const calCard = document.getElementById('calCard');
    const historyList = document.getElementById('historyList');
    const historyCard = historyList ? historyList.closest('.bg-cardbg') : null;

    // =========================================================
    // TAB 1: HOME (Header status, Stream Live, Kotak Line Chart)
    // =========================================================
    const homeLineBox = document.createElement('div');
    homeLineBox.className = 'lux-card p-3 space-y-2';
    homeLineBox.innerHTML = `
      <div class="flex justify-between items-center">
        <div>
          <span class="text-[9px] font-bold text-gray-400 tracking-wider uppercase block">LIVE PRICE LINE PULSE</span>
          <span id="homeLinePair" class="text-sm font-black text-white font-mono">XAUUSD</span>
        </div>
        <div class="text-right">
          <span id="homeLinePrice" class="text-base font-black text-yellow-400 font-mono">--.--</span>
          <div class="flex gap-1 mt-1 justify-end">
            <button data-home-sym="XAUUSD" class="text-[9px] font-bold px-2 py-0.5 rounded bg-accentblue text-white">XAUUSD</button>
            <button data-home-sym="BTCUSD" class="text-[9px] font-bold px-2 py-0.5 rounded bg-darkbg border border-panelborder text-gray-400">BTCUSD</button>
          </div>
        </div>
      </div>
      <div class="relative w-full h-[170px] bg-darkbg/70 rounded-xl border border-panelborder overflow-hidden">
        <canvas id="homeSparkCanvas" class="w-full h-full block"></canvas>
      </div>
    `;
    homeChartCanvas = homeLineBox.querySelector('#homeSparkCanvas');

    if (streamPanel) { streamPanel.classList.add('lux-card'); panes.home.appendChild(streamPanel); }
    panes.home.appendChild(homeLineBox);
    if (highlightList) panes.home.appendChild(highlightList);
    if (sessionPanel) { sessionPanel.classList.add('lux-card'); panes.home.appendChild(sessionPanel); }

    homeLineBox.addEventListener('click', e => {
      const btn = e.target.closest('[data-home-sym]');
      if (!btn) return;
      const sym = btn.dataset.homeSym;
      window.__homeSparkSym = sym;
      homeLineBox.querySelectorAll('[data-home-sym]').forEach(b => {
        const active = b.dataset.homeSym === sym;
        b.className = active
          ? 'text-[9px] font-bold px-2 py-0.5 rounded bg-accentblue text-white'
          : 'text-[9px] font-bold px-2 py-0.5 rounded bg-darkbg border border-panelborder text-gray-400';
      });
      drawHomeSparkline();
    });

    // =========================================================
    // TAB 2: NEWS (Memindahkan #alu-news dari live-news-fix.js)
    // =========================================================
    const newsHolder = document.createElement('div');
    newsHolder.id = 'luxNewsSlot';
    newsHolder.innerHTML = `<div class="lux-card p-4 text-center text-xs text-gray-400">Memuat berita pasar terbaru...</div>`;
    panes.news.appendChild(newsHolder);

    // Observer otomatis memindahkan #alu-news begitu selesai di-render live-news-fix.js
    const moveNewsNode = () => {
      const newsNode = document.getElementById('alu-news');
      if (newsNode && newsNode.parentElement !== panes.news) {
        newsNode.style.margin = '0';
        newsNode.classList.add('lux-card');
        panes.news.innerHTML = '';
        panes.news.appendChild(newsNode);
      }
    };
    moveNewsNode();
    const newsObs = new MutationObserver(moveNewsNode);
    newsObs.observe(document.body, { childList: true, subtree: true });

    // =========================================================
    // TAB 3: SIGNAL (Search Pair, Style, Bias, Card, Live Map + SMC + Countdown + Rekap)
    // =========================================================
    const sigControlCard = document.createElement('div');
    sigControlCard.className = 'lux-card p-3 space-y-2.5';
    sigControlCard.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="text-[9px] font-bold text-gray-400 tracking-wider uppercase"><i class="fa-solid fa-magnifying-glass text-accentblue mr-1"></i> PILIH / CARI PAIR</span>
        <span id="sigCountdownBadge" class="lux-cd-badge"><i class="fa-regular fa-clock"></i> <span id="sigCdText">M1: --s</span></span>
      </div>
      <div class="relative">
        <input id="pairSearchInput" type="text" placeholder="Ketik pair (contoh: XAUUSD, BTCUSD)..." autocomplete="off"
          class="w-full bg-darkbg border border-panelborder rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-accentblue">
        <div id="pairDropdownList" class="hidden absolute left-0 right-0 top-full mt-1 bg-cardbg border border-panelborder rounded-xl shadow-2xl z-30 overflow-hidden"></div>
      </div>
    `;
    panes.signal.appendChild(sigControlCard);

    if (styleContainer) sigControlCard.appendChild(styleContainer);
    if (biasPanel) { biasPanel.classList.add('lux-card'); panes.signal.appendChild(biasPanel); }
    if (signalBtn) panes.signal.appendChild(signalBtn);
    if (signalResultCard) { signalResultCard.classList.add('lux-card'); panes.signal.appendChild(signalResultCard); }

    // Tambahkan badge Entry Berjalan + Countdown pada Live Map & Map SMC
    if (chartPanel) {
      chartPanel.classList.add('lux-card');
      const liveCdBar = document.createElement('div');
      liveCdBar.id = 'liveMapRunningBar';
      liveCdBar.className = 'flex flex-wrap justify-between items-center gap-1 bg-darkbg/90 border border-panelborder rounded-lg px-2.5 py-1.5 text-[9px] font-mono';
      liveCdBar.innerHTML = `<span id="liveEntrySummary" class="text-gray-300 font-bold">Belum ada entry aktif</span><span id="liveMapTimer" class="text-amber-400 font-bold">⏱ --:--</span>`;
      chartPanel.insertBefore(liveCdBar, chartPanel.children[1]);
      panes.signal.appendChild(chartPanel);
    }
    if (smcPanel) {
      smcPanel.classList.add('lux-card');
      const smcCdBar = document.createElement('div');
      smcCdBar.id = 'smcRunningBar';
      smcCdBar.className = 'flex flex-wrap justify-between items-center gap-1 bg-darkbg/90 border border-panelborder rounded-lg px-2.5 py-1.5 text-[9px] font-mono';
      smcCdBar.innerHTML = `<span id="smcEntrySummary" class="text-sky-300 font-bold">SMC Map Ready</span><span id="smcMapTimer" class="text-amber-400 font-bold">⏱ --:--</span>`;
      smcPanel.insertBefore(smcCdBar, smcPanel.firstChild);
      panes.signal.appendChild(smcPanel);
    }

    // Rekap Harian ringkas di bawah Signal
    const dailyRecapSlot = document.createElement('div');
    dailyRecapSlot.id = 'signalDailyRecap';
    dailyRecapSlot.className = 'lux-card p-3 space-y-1.5';
    panes.signal.appendChild(dailyRecapSlot);

    setupPairSearch(sigControlCard);

    // =========================================================
    // TAB 4: VISION (Upload Chart, Style, Card Reason, Re-Drawing Entry/SL/TP di Gambar LTF)
    // =========================================================
    const visionHolder = document.createElement('div');
    visionHolder.className = 'space-y-2.5';
    panes.vision.appendChild(visionHolder);

    const visionStyleSlot = document.createElement('div');
    visionStyleSlot.className = 'lux-card p-3 space-y-2';
    visionStyleSlot.innerHTML = `<span class="text-[9px] font-bold text-gray-400 uppercase tracking-wider">STYLE ANALISA VISION</span>`;
    panes.vision.appendChild(visionStyleSlot);

    const visionBtnSlot = document.createElement('div');
    panes.vision.appendChild(visionBtnSlot);

    // Kotak Re-Drawing Visual Entry SL TP di atas Copy Gambar LTF yang di-upload
    const visionRedrawCard = document.createElement('div');
    visionRedrawCard.id = 'visionRedrawCard';
    visionRedrawCard.className = 'lux-card p-3 space-y-2';
    visionRedrawCard.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="text-[9px] font-bold text-yellow-400 uppercase tracking-wider"><i class="fa-solid fa-pen-ruler mr-1"></i> VISUAL RE-DRAWING LTF (ENTRY / SL / TP)</span>
        <select id="visionLtfIndex" class="bg-darkbg border border-panelborder text-[9px] font-bold text-white px-2 py-0.5 rounded">
          <option value="last">Gambar LTF Terakhir</option>
          <option value="0">Gambar #1</option>
          <option value="1">Gambar #2</option>
          <option value="2">Gambar #3</option>
        </select>
      </div>
      <div class="relative w-full rounded-xl overflow-hidden border border-panelborder bg-black">
        <canvas id="visionOverlayCanvas" class="w-full h-auto block"></canvas>
      </div>
      <p class="text-[8px] font-mono text-gray-400">Otomatis menyalin chart LTF yang di-upload dan menggambar garis Entry, SL, serta TP1–TP3 setelah analisa selesai.</p>
    `;
    panes.vision.appendChild(visionRedrawCard);
    const visionCardSlot = document.createElement('div');
    panes.vision.appendChild(visionCardSlot);

    // =========================================================
    // TAB 5: BOT (Autobot XAUUSD)
    // =========================================================
    if (botPanel) {
      botPanel.classList.remove('hidden');
      botPanel.classList.add('lux-card');
      panes.bot.appendChild(botPanel);
    }

    // =========================================================
    // TAB 6: HISTORY + BOT PNL HARIAN + REKAP PAIR + KALENDER
    // =========================================================
    const pairRecapCard = document.createElement('div');
    pairRecapCard.id = 'pairRecapBox';
    pairRecapCard.className = 'lux-card p-3 space-y-2';
    panes.history.appendChild(pairRecapCard);

    if (recapCard) { recapCard.classList.add('lux-card'); panes.history.appendChild(recapCard); }
    if (calCard) { calCard.classList.remove('hidden'); calCard.classList.add('lux-card'); panes.history.appendChild(calCard); }
    if (historyCard) { historyCard.classList.add('lux-card'); panes.history.appendChild(historyCard); }

    // 3. NAVIGASI BAWAH (5 TAB UTAMA + PNL)
    const nav = document.createElement('nav');
    nav.id = 'luxBottomNav';
    nav.innerHTML = `
      <button class="lux-nav-btn active" data-tab="home"><span class="nav-pill"><i class="fa-solid fa-house"></i></span><span>Home</span></button>
      <button class="lux-nav-btn" data-tab="news"><span class="nav-pill"><i class="fa-solid fa-newspaper"></i></span><span>News</span></button>
      <button class="lux-nav-btn" data-tab="signal"><span class="nav-pill"><i class="fa-solid fa-bolt"></i></span><span>Signal</span></button>
      <button class="lux-nav-btn" data-tab="vision"><span class="nav-pill"><i class="fa-solid fa-eye"></i></span><span>Vision</span></button>
      <button class="lux-nav-btn" data-tab="bot"><span class="nav-pill"><i class="fa-solid fa-robot"></i></span><span>Bot</span></button>
      <button class="lux-nav-btn" data-tab="history"><span class="nav-pill"><i class="fa-solid fa-calendar-days"></i></span><span>PnL</span></button>
    `;
    document.body.appendChild(nav);

    nav.addEventListener('click', e => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      switchTab(btn.dataset.tab);
    });

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.lux-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      Object.entries(panes).forEach(([k, el]) => el.classList.toggle('active', k === tab));

      // Sinkronkan mode internal index.html saat berpindah tab
      if (tab === 'signal') {
        if (styleContainer && !sigControlCard.contains(styleContainer)) sigControlCard.appendChild(styleContainer);
        if (signalBtn && !panes.signal.contains(signalBtn)) panes.signal.insertBefore(signalBtn, signalResultCard);
        if (signalResultCard && !panes.signal.contains(signalResultCard)) panes.signal.insertBefore(signalResultCard, chartPanel);
        if (marketSelect) {
          const curPair = (window.__selectedSignalPair || 'XAUUSD');
          marketSelect.value = curPair;
          if (typeof syncMarket === 'function') syncMarket();
        }
        if (styleContainer) styleContainer.classList.remove('hidden');
        if (signalBtn) signalBtn.classList.remove('hidden');
        if (biasPanel) biasPanel.classList.remove('hidden');
        if (chartPanel) chartPanel.classList.remove('hidden');
        if (smcPanel) smcPanel.classList.remove('hidden');
      } else if (tab === 'vision') {
        if (visionPanel) { visionPanel.classList.remove('hidden'); visionHolder.appendChild(visionPanel); }
        if (styleContainer) { styleContainer.classList.remove('hidden'); visionStyleSlot.appendChild(styleContainer); }
        if (signalBtn) { signalBtn.classList.remove('hidden'); visionBtnSlot.appendChild(signalBtn); }
        if (signalResultCard) { signalResultCard.classList.remove('hidden'); visionCardSlot.appendChild(signalResultCard); }
        if (marketSelect) {
          marketSelect.value = 'VISION';
          if (typeof syncMarket === 'function') syncMarket();
        }
        renderVisionRedraw();
      } else if (tab === 'bot') {
        if (marketSelect) {
          marketSelect.value = 'AUTOBOT';
          if (typeof syncMarket === 'function') syncMarket();
        }
        if (botPanel) botPanel.classList.remove('hidden');
        const botBtn = document.getElementById('botBtn');
        if (botBtn) botBtn.classList.remove('hidden');
      } else if (tab === 'history') {
        if (typeof renderCalendar === 'function') renderCalendar();
        if (typeof renderHistory === 'function') renderHistory();
        renderPairRecap();
      } else if (tab === 'home') {
        if (streamPanel) streamPanel.classList.remove('hidden');
        if (sessionPanel) sessionPanel.classList.remove('hidden');
        drawHomeSparkline();
      } else if (tab === 'news') {
        moveNewsNode();
      }
    }

    // Hook select index untuk Vision redraw
    const ltfSel = document.getElementById('visionLtfIndex');
    if (ltfSel) ltfSel.addEventListener('change', renderVisionRedraw);

    // Loop sinkronisasi visual setiap 1 detik (Countdown, Line Chart Home, Vision Overlay, Rekap)
    setInterval(() => {
      if (currentTab === 'home') drawHomeSparkline();
      if (currentTab === 'signal') updateSignalCountdownsAndRecap();
      if (currentTab === 'vision') renderVisionRedraw();
      if (currentTab === 'history') renderPairRecap();
    }, 1000);

    switchTab('home');
  }

  function createPane(id, active) {
    const d = document.createElement('div');
    d.id = id;
    d.className = 'lux-tab-pane' + (active ? ' active' : '');
    return d;
  }

  // 4. PENCARIAN PAIR YANG BISA DIKETIK DI TAB SIGNAL
  function setupPairSearch(container) {
    const input = container.querySelector('#pairSearchInput');
    const drop = container.querySelector('#pairDropdownList');
    if (!input || !drop) return;

    const getAvailablePairs = () => {
      const m = (typeof MARKETS !== 'undefined') ? Object.keys(MARKETS).filter(k => k !== 'VISION') : ['XAUUSD', 'BTCUSD'];
      return m.map(k => ({
        code: k,
        name: k === 'XAUUSD' ? 'XAUUSD · Gold Spot' : k === 'BTCUSD' ? 'BTCUSD · Bitcoin' : k
      }));
    };

    input.value = 'XAUUSD';
    window.__selectedSignalPair = 'XAUUSD';

    const showList = (q) => {
      const query = String(q || '').trim().toUpperCase();
      const items = getAvailablePairs().filter(p => !query || p.code.includes(query) || p.name.toUpperCase().includes(query));
      if (!items.length) {
        drop.innerHTML = `<div class="px-3 py-2 text-[10px] text-gray-400 font-mono">Pair tidak ditemukan</div>`;
      } else {
        drop.innerHTML = items.map(p => `
          <button type="button" data-pick-pair="${p.code}" class="w-full text-left px-3 py-2 text-xs font-mono text-white hover:bg-accentblue/20 flex justify-between items-center border-b border-panelborder/50 last:border-0">
            <span class="font-bold">${p.name}</span>
            <span class="text-[9px] text-yellow-400">PILIH</span>
          </button>
        `).join('');
      }
      drop.classList.remove('hidden');
    };

    input.addEventListener('focus', () => showList(''));
    input.addEventListener('input', e => showList(e.target.value));
    drop.addEventListener('click', e => {
      const btn = e.target.closest('[data-pick-pair]');
      if (!btn) return;
      const code = btn.dataset.pickPair;
      input.value = code;
      window.__selectedSignalPair = code;
      drop.classList.add('hidden');
      const sel = document.getElementById('marketSelect');
      if (sel) {
        sel.value = code;
        if (typeof syncMarket === 'function') syncMarket();
      }
    });
    document.addEventListener('click', e => {
      if (!container.contains(e.target)) drop.classList.add('hidden');
    });
  }

  // 5. KOTAK LINE CHART STREAM DI TAB HOME
  function drawHomeSparkline() {
    if (!homeChartCanvas) return;
    const sym = window.__homeSparkSym || 'XAUUSD';
    const pairLbl = document.getElementById('homeLinePair');
    const priceLbl = document.getElementById('homeLinePrice');
    if (pairLbl) pairLbl.textContent = sym;

    const live = (typeof prices !== 'undefined' && prices[sym]) ? prices[sym].price : null;
    if (priceLbl && typeof fmt === 'function') priceLbl.textContent = live != null ? fmt(live) : '--.--';

    const rect = homeChartCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    homeChartCanvas.width = Math.round(rect.width * dpr);
    homeChartCanvas.height = Math.round(rect.height * dpr);
    const ctx = homeChartCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    let pts = [];
    if (typeof seriesRows === 'function') {
      pts = seriesRows(sym, '1m').slice(-60).map(r => r.c);
    }
    if (live != null) pts.push(live);
    if (pts.length < 2) {
      ctx.fillStyle = '#64748b';
      ctx.font = '11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Menunggu stream harga live ' + sym + '...', W / 2, H / 2);
      return;
    }

    const min = Math.min(...pts), max = Math.max(...pts);
    const span = (max - min) || 1;
    const padY = 18;
    const up = pts[pts.length - 1] >= pts[0];
    const strokeCol = up ? '#10b981' : '#ef4444';

    ctx.beginPath();
    pts.forEach((v, i) => {
      const x = (i / (pts.length - 1)) * (W - 16) + 8;
      const y = padY + (1 - (v - min) / span) * (H - padY * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Area gradient di bawah garis
    ctx.lineTo(W - 8, H);
    ctx.lineTo(8, H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, up ? 'rgba(16, 185, 129, 0.28)' : 'rgba(239, 68, 68, 0.28)');
    grad.addColorStop(1, 'rgba(11, 14, 20, 0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // 6. COUNTDOWN TIMER + ENTRY BERJALAN DI LIVE MAP & MAP SMC + REKAP HARIAN
  function updateSignalCountdownsAndRecap() {
    const now = Date.now();
    // Countdown Candle M1 (detik tersisa)
    const secM1 = 60 - Math.floor((now / 1000) % 60);
    const cdTop = document.getElementById('sigCdText');
    if (cdTop) cdTop.textContent = `Candle M1: ${secM1}s`;

    const tr = (typeof activeTrade === 'function') ? activeTrade() : null;
    const liveSum = document.getElementById('liveEntrySummary');
    const smcSum = document.getElementById('smcEntrySummary');
    const liveTmr = document.getElementById('liveMapTimer');
    const smcTmr = document.getElementById('smcMapTimer');

    if (tr && tr.status !== 'CLOSED') {
      const f = (typeof tradeFlow === 'function') ? tradeFlow(tr) : { main: `${tr.signal} @ ${tr.entry}` };
      const txt = `● ${tr.key} ${tr.signal} | ${f.main}`;
      if (liveSum) liveSum.textContent = txt;
      if (smcSum) smcSum.textContent = txt;

      let expTxt = `M1: ${secM1}s`;
      if (tr.expiresAt && tr.expiresAt > now) {
        const rem = Math.floor((tr.expiresAt - now) / 1000);
        const hh = Math.floor(rem / 3600);
        const mm = Math.floor((rem % 3600) / 60);
        const ss = rem % 60;
        expTxt = `Exp: ${hh > 0 ? hh + 'j ' : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')} · M1: ${secM1}s`;
      }
      if (liveTmr) liveTmr.textContent = `⏱ ${expTxt}`;
      if (smcTmr) smcTmr.textContent = `⏱ ${expTxt}`;
    } else {
      if (liveSum) liveSum.textContent = 'Standby — Belum ada entry berjalan';
      if (smcSum) smcSum.textContent = 'SMC Map — Menunggu setup entry';
      if (liveTmr) liveTmr.textContent = `⏱ Next M1: ${secM1}s`;
      if (smcTmr) smcTmr.textContent = `⏱ Next M1: ${secM1}s`;
    }

    // Rekap harian ringkas di tab Signal
    const recapBox = document.getElementById('signalDailyRecap');
    if (recapBox && typeof trades !== 'undefined') {
      const today = new Date().toDateString();
      const closedToday = trades.filter(t => t.status === 'CLOSED' && t.result !== 'CANCEL' && new Date(t.closedAt || t.createdAt).toDateString() === today);
      const net = closedToday.reduce((s, t) => s + (Number(t.pips) || 0), 0);
      const wins = closedToday.filter(t => t.pips > 0).length;
      const losses = closedToday.filter(t => t.pips < 0).length;
      const running = trades.filter(t => t.status !== 'CLOSED' && t.key !== 'VISION').length;
      recapBox.innerHTML = `
        <div class="flex justify-between items-center">
          <span class="text-[9px] font-bold text-gray-400 uppercase">REKAP HARIAN SIGNAL & BOT</span>
          <span class="text-[10px] font-mono font-extrabold ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}">${net >= 0 ? '+' : ''}${net.toFixed(1)} pip</span>
        </div>
        <div class="grid grid-cols-3 gap-1.5 text-center text-[9px] font-mono">
          <div class="bg-darkbg rounded-lg p-1.5 border border-panelborder"><span class="text-gray-400 block text-[8px]">WIN / LOSE</span><strong class="text-white">${wins}W / ${losses}L</strong></div>
          <div class="bg-darkbg rounded-lg p-1.5 border border-panelborder"><span class="text-gray-400 block text-[8px]">BERJALAN</span><strong class="text-sky-400">${running} Trade</strong></div>
          <div class="bg-darkbg rounded-lg p-1.5 border border-panelborder"><span class="text-gray-400 block text-[8px]">TOTAL CLOSE</span><strong class="text-yellow-400">${closedToday.length}</strong></div>
        </div>
      `;
    }
  }

  // 7. VISION: COPY GAMBAR LTF + RE-DRAWING GARIS ENTRY, SL, TP1-TP3
  function renderVisionRedraw() {
    const canvas = document.getElementById('visionOverlayCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const imgs = (typeof visionImages !== 'undefined' && Array.isArray(visionImages)) ? visionImages : [];
    const sel = document.getElementById('visionLtfIndex');
    const idxVal = sel ? sel.value : 'last';

    if (!imgs.length) {
      canvas.width = 600; canvas.height = 220;
      ctx.fillStyle = '#0b0e14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Upload gambar chart LTF untuk menampilkan visual Entry / SL / TP', canvas.width / 2, canvas.height / 2);
      return;
    }

    const imgSrc = idxVal === 'last' ? imgs[imgs.length - 1] : (imgs[Number(idxVal)] || imgs[imgs.length - 1]);
    const tr = (typeof visionTrade !== 'undefined') ? visionTrade : null;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      if (!tr || !tr.entry || !tr.sl) return;

      // Hitung skala Y proporsional antara level SL, Entry, TP1, TP2, TP3
      const levels = [
        { label: `ENTRY (${tr.signal})`, val: Number(tr.entry), color: '#38bdf8', dash: [] },
        { label: 'SL', val: Number(tr.sl), color: '#ef4444', dash: [8, 6] },
        tr.tp1 ? { label: 'TP1', val: Number(tr.tp1), color: '#10b981', dash: [6, 5] } : null,
        tr.tp2 ? { label: 'TP2', val: Number(tr.tp2), color: '#34d399', dash: [6, 5] } : null,
        tr.tp3 ? { label: 'TP3', val: Number(tr.tp3), color: '#a7f3d0', dash: [6, 5] } : null
      ].filter(Boolean);

      const vals = levels.map(l => l.val);
      const minV = Math.min(...vals), maxV = Math.max(...vals);
      const span = (maxV - minV) || 1;
      const topPad = canvas.height * 0.16;
      const usableH = canvas.height * 0.68;

      const yOf = v => topPad + (1 - (v - minV) / span) * usableH;

      // Arsiran zona Risk (Entry ke SL) & Reward (Entry ke TP terjauh)
      const yEntry = yOf(Number(tr.entry));
      const ySl = yOf(Number(tr.sl));
      const farTp = tr.tp3 || tr.tp2 || tr.tp1;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
      ctx.fillRect(0, Math.min(yEntry, ySl), canvas.width, Math.abs(ySl - yEntry));
      if (farTp) {
        const yTp = yOf(Number(farTp));
        ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
        ctx.fillRect(0, Math.min(yEntry, yTp), canvas.width, Math.abs(yTp - yEntry));
      }

      // Gambar garis horizontal + badge harga di sisi kanan
      const fontSize = Math.max(12, Math.round(canvas.width * 0.018));
      ctx.font = `bold ${fontSize}px ui-monospace, monospace`;

      levels.forEach(lv => {
        const y = yOf(lv.val);
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash(lv.dash);
        ctx.strokeStyle = lv.color;
        ctx.lineWidth = Math.max(2, Math.round(canvas.width * 0.003));
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
        ctx.restore();

        const tagText = `${lv.label}: ${lv.val}`;
        const tw = ctx.measureText(tagText).width + 16;
        const th = fontSize + 10;
        const bx = canvas.width - tw - 10;
        const by = Math.max(4, Math.min(canvas.height - th - 4, y - th / 2));

        ctx.fillStyle = '#0b0e14';
        ctx.fillRect(bx, by, tw, th);
        ctx.strokeStyle = lv.color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, tw, th);
        ctx.fillStyle = lv.color;
        ctx.textBaseline = 'middle';
        ctx.fillText(tagText, bx + 8, by + th / 2);
      });
    };
    img.src = imgSrc;
  }

  // 8. REKAP PAIR YANG DI-TRADING-KAN & PNL (MANUAL + BOT)
  function renderPairRecap() {
    const box = document.getElementById('pairRecapBox');
    if (!box || typeof trades === 'undefined') return;

    const valid = trades.filter(t => t.key !== 'VISION' && t.result !== 'CANCEL');
    const byPair = {};
    let manualPnl = 0, botPnl = 0;

    valid.forEach(t => {
      const p = Number(t.pips) || 0;
      if (t.status === 'CLOSED') {
        if (t.src === 'bot') botPnl += p; else manualPnl += p;
      }
      if (!byPair[t.key]) byPair[t.key] = { count: 0, wins: 0, losses: 0, pips: 0 };
      byPair[t.key].count++;
      if (t.status === 'CLOSED') {
        byPair[t.key].pips += p;
        if (p > 0) byPair[t.key].wins++; else if (p < 0) byPair[t.key].losses++;
      }
    });

    const pairRows = Object.entries(byPair).map(([k, d]) => `
      <div class="flex justify-between items-center bg-darkbg border border-panelborder rounded-lg px-2.5 py-1.5 text-[10px] font-mono">
        <div>
          <span class="font-extrabold text-white">${k}</span>
          <span class="text-gray-400 text-[9px] ml-1.5">${d.count} trade (${d.wins}W/${d.losses}L)</span>
        </div>
        <span class="font-bold ${d.pips >= 0 ? 'text-emerald-400' : 'text-red-400'}">${d.pips >= 0 ? '+' : ''}${d.pips.toFixed(1)} pip</span>
      </div>
    `).join('') || `<p class="text-[10px] text-gray-500 text-center py-2">Belum ada transaksi pair tercatat.</p>`;

    box.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="text-[9px] font-bold text-gray-400 uppercase"><i class="fa-solid fa-layer-group text-accentblue mr-1"></i> REKAP PAIR & PNL (MANUAL + BOT)</span>
      </div>
      <div class="grid grid-cols-2 gap-1.5 text-center font-mono">
        <div class="bg-darkbg border border-panelborder rounded-lg p-2">
          <span class="text-[8px] text-gray-400 block">MANUAL SIGNAL PNL</span>
          <strong class="text-xs ${manualPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}">${manualPnl >= 0 ? '+' : ''}${manualPnl.toFixed(1)} pip</strong>
        </div>
        <div class="bg-darkbg border border-panelborder rounded-lg p-2">
          <span class="text-[8px] text-gray-400 block">AUTOBOT PNL</span>
          <strong class="text-xs ${botPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}">${botPnl >= 0 ? '+' : ''}${botPnl.toFixed(1)} pip</strong>
        </div>
      </div>
      <div class="space-y-1">${pairRows}</div>
    `;
  }

  window.addEventListener('load', () => setTimeout(initLayout, 250));
})();
