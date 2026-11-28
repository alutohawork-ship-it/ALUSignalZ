// ui-luxury-fix.js — Transformasi UI Luxury Fintech, Navigasi Tab & Live Tick Card
(function () {
  if (window.__UI_LUXURY_INIT__) return;
  window.__UI_LUXURY_INIT__ = true;

  const PAIRS_LIST = [
    { val: 'XAUUSD', label: 'XAUUSD / Gold (Spot)' },
    { val: 'BTCUSD', label: 'BTCUSD / Bitcoin' }
  ];

  let currentTab = 'home';
  const prevPx = { XAUUSD: null, BTCUSD: null };

  function injectStyles() {
    if (document.getElementById('luxury-ui-css')) return;
    const style = document.createElement('style');
    style.id = 'luxury-ui-css';
    style.textContent = `
      body {
        background-color: #05070a !important;
        color: #f1f5f9 !important;
        padding-bottom: 84px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
      }
      #mainApp header {
        background: rgba(11, 14, 20, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        position: sticky;
        top: 0;
        z-index: 35;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
        border-radius: 0 0 16px 16px;
      }
      .lux-card {
        background: linear-gradient(180deg, #121722 0%, #0c1017 100%) !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        border-radius: 16px !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45) !important;
      }
      .bg-cardbg {
        background: #10141d !important;
        border-color: rgba(255, 255, 255, 0.08) !important;
        border-radius: 16px !important;
      }
      .bg-darkbg {
        background: #080b10 !important;
        border-color: rgba(255, 255, 255, 0.07) !important;
      }
      #luxBottomNav {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 45;
        background: rgba(10, 13, 19, 0.95);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
      }
      .lux-nav-inner {
        max-width: 680px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 2px;
      }
      .lux-nav-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        padding: 6px 2px;
        border-radius: 12px;
        color: #64748b;
        font-size: 9.5px;
        font-weight: 700;
        transition: all 0.2s ease;
        background: transparent;
        border: none;
        cursor: pointer;
      }
      .lux-nav-btn i {
        font-size: 15px;
        transition: transform 0.2s ease;
      }
      .lux-nav-btn.active {
        color: #fbbf24;
        background: rgba(251, 191, 36, 0.12);
      }
      .lux-nav-btn.active i {
        transform: translateY(-1px);
        color: #fbbf24;
      }
      .lux-tab-pane {
        display: none;
        flex-direction: column;
        gap: 10px;
        width: 100%;
      }
      .lux-tab-pane.active {
        display: flex;
      }
      .lux-cd-badge {
        background: rgba(251, 191, 36, 0.12);
        border: 1px solid rgba(251, 191, 36, 0.35);
        color: #fbbf24;
        font-family: ui-monospace, monospace;
        font-size: 9px;
        font-weight: 800;
        padding: 2px 7px;
        border-radius: 6px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
    `;
    document.head.appendChild(style);
  }

  function createPane(id) {
    const d = document.createElement('div');
    d.id = id;
    d.className = 'lux-tab-pane';
    return d;
  }

  function buildLuxuryLayout() {
    const mainApp = document.getElementById('mainApp');
    const mainEl = mainApp ? mainApp.querySelector('main') : null;
    if (!mainEl) return;

    const streamPanel = document.getElementById('streamPanel');
    const highlightList = document.getElementById('highlightList');
    const sessionPanel = document.getElementById('sessionPanel');

    const marketSelect = document.getElementById('marketSelect');
    const marketCard = marketSelect ? marketSelect.closest('.bg-cardbg') : null;
    const styleContainer = document.getElementById('styleContainer');
    const botPanel = document.getElementById('botPanel');
    const visionPanel = document.getElementById('visionPanel');
    const biasPanel = document.getElementById('biasPanel');
    const signalBtn = document.getElementById('signalBtn');
    const standbyView = document.getElementById('standbyView');
    const signalCard = standbyView ? standbyView.parentElement : null;
    const chartPanel = document.getElementById('chartPanel');
    const smcPanel = document.getElementById('smcPanel');

    const calCard = document.getElementById('calCard');
    const recapCard = document.getElementById('recapCard');
    const histFilter = document.getElementById('histFilter');
    const historyCard = histFilter ? histFilter.closest('.bg-cardbg') : null;

    mainEl.className = 'max-w-md md:max-w-2xl mx-auto w-full flex-1 flex flex-col gap-2.5 pt-2.5 px-1';

    const panes = {
      home: createPane('pane-home'),
      news: createPane('pane-news'),
      signal: createPane('pane-signal'),
      vision: createPane('pane-vision'),
      bot: createPane('pane-bot'),
      history: createPane('pane-history')
    };

    // --- TAB 1: HOME (Tanpa Live Market Stream, 2 Card Sparkline Live WS di atas) ---
    if (streamPanel) {
      streamPanel.remove();
    }

    const homeSparkGrid = document.createElement('div');
    homeSparkGrid.id = 'luxHomeSparkGrid';
    homeSparkGrid.className = 'grid grid-cols-2 gap-2.5';
    homeSparkGrid.innerHTML = ['XAUUSD', 'BTCUSD'].map(sym => `
      <div id="lux-card-${sym}" onclick="window.luxGoSignal('${sym}')" class="lux-card p-3 cursor-pointer active:scale-[0.98] transition relative overflow-hidden">
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-1.5">
            <span class="w-5 h-5 rounded-full bg-darkbg border border-panelborder flex items-center justify-center text-[10px] font-black ${sym === 'XAUUSD' ? 'text-yellow-400' : 'text-orange-400'}">
              ${sym === 'XAUUSD' ? 'Au' : '₿'}
            </span>
            <div>
              <p class="text-[11px] font-extrabold text-white leading-none">${sym === 'XAUUSD' ? 'Gold Spot' : 'Bitcoin'}</p>
              <p class="text-[8px] font-mono text-gray-400 mt-0.5 flex items-center gap-1">
                <span>${sym}</span>
                <span id="lux-dot-${sym}" class="inline-block w-1.5 h-1.5 rounded-full bg-gray-500"></span>
              </p>
            </div>
          </div>
          <span id="lux-pct-${sym}" class="text-[9px] font-mono font-bold text-gray-400">0.00%</span>
        </div>
        <p id="lux-px-${sym}" class="text-sm font-black font-mono text-white tracking-tight my-1 transition-colors duration-150">--.--</p>
        <div class="w-full h-[50px] mt-1">
          <canvas id="lux-spark-${sym}" class="w-full h-full"></canvas>
        </div>
      </div>
    `).join('');

    panes.home.appendChild(homeSparkGrid);
    if (highlightList) panes.home.appendChild(highlightList);
    if (sessionPanel) panes.home.appendChild(sessionPanel);

    // --- TAB 2: NEWS ---
    const newsWrapper = document.createElement('div');
    newsWrapper.id = 'newsTabContainer';
    newsWrapper.className = 'lux-card p-3 space-y-2.5';
    newsWrapper.innerHTML = `
      <div class="flex items-center justify-between border-b border-panelborder pb-2">
        <span class="text-[10px] font-extrabold text-white tracking-wider flex items-center gap-1.5">
          <i class="fa-solid fa-newspaper text-yellow-400"></i> ECONOMIC CALENDAR & MARKET NEWS
        </span>
        <span class="text-[8px] font-mono px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">LIVE FEED</span>
      </div>
      <div id="newsReleaseMount" class="space-y-2 text-xs text-gray-300">
        <div id="newsList" class="space-y-2">
          <p class="text-[10px] text-gray-400 font-mono text-center py-6">Wadah Berita Rilis siap. Sambungkan kode news Anda ke <code>#newsList</code>.</p>
        </div>
      </div>
    `;
    panes.news.appendChild(newsWrapper);

    // --- TAB 3: SIGNAL ---
    if (marketCard && marketSelect) {
      const searchWrap = document.createElement('div');
      searchWrap.className = 'relative mb-1.5';
      searchWrap.innerHTML = `
        <div class="relative flex items-center">
          <i class="fa-solid fa-magnifying-glass text-gray-400 text-[10px] absolute left-2.5"></i>
          <input id="pairSearchInput" type="text" autocomplete="off" placeholder="Ketik pair (contoh: XAUUSD, BTCUSD)..."
            class="w-full bg-darkbg border border-panelborder rounded-lg pl-7 pr-7 py-2 text-xs font-mono font-bold text-white focus:outline-none focus:border-yellow-500">
          <button type="button" id="clearPairSearch" class="hidden absolute right-2 text-gray-400 hover:text-white text-xs"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div id="pairDropdownList" class="hidden absolute left-0 right-0 top-full mt-1 bg-cardbg border border-panelborder rounded-lg shadow-2xl z-30 max-h-40 overflow-y-auto"></div>
      `;
      marketSelect.parentNode.insertBefore(searchWrap, marketSelect);
      marketSelect.classList.add('hidden');
    }

    injectCountdownBadges(chartPanel, smcPanel);

    const signalDailyRecap = document.createElement('div');
    signalDailyRecap.id = 'signalDailyRecapBox';
    signalDailyRecap.className = 'lux-card p-2.5 space-y-1.5';
    signalDailyRecap.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="text-[9px] font-bold text-gray-400 flex items-center gap-1"><i class="fa-solid fa-calendar-day text-yellow-400"></i> REKAP HARIAN (TODAY)</span>
        <button onclick="window.luxSwitchTab('history')" class="text-[8px] font-mono text-accentblue hover:underline">Lihat Kalender & Detail →</button>
      </div>
      <div id="sigDailyStatsGrid" class="grid grid-cols-4 gap-1.5 text-center font-mono"></div>
    `;

    if (marketCard) panes.signal.appendChild(marketCard);
    if (biasPanel) panes.signal.appendChild(biasPanel);
    if (signalBtn) panes.signal.appendChild(signalBtn);
    if (signalCard) panes.signal.appendChild(signalCard);
    if (chartPanel) panes.signal.appendChild(chartPanel);
    if (smcPanel) panes.signal.appendChild(smcPanel);
    panes.signal.appendChild(signalDailyRecap);

    // --- TAB 4: VISION ---
    const visionDrawBox = document.createElement('div');
    visionDrawBox.id = 'visionDrawingCard';
    visionDrawBox.className = 'hidden lux-card p-2.5 space-y-2';
    visionDrawBox.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="text-[9px] font-bold text-yellow-400 flex items-center gap-1">
          <i class="fa-solid fa-pen-ruler"></i> VISUAL RE-DRAWING ENTRY / SL / TP (LTF)
        </span>
        <button onclick="window.redrawVisionOverlay()" class="text-[8px] font-mono px-2 py-0.5 rounded bg-darkbg border border-panelborder text-gray-300 hover:text-white">
          <i class="fa-solid fa-rotate"></i> Redraw
        </button>
      </div>
      <div class="relative w-full rounded-xl overflow-hidden border border-panelborder bg-black">
        <canvas id="visionOverlayCanvas" class="w-full h-auto block"></canvas>
      </div>
      <p class="text-[8px] font-mono text-gray-400 text-center">Garis Entry, SL, dan TP digambar otomatis di atas salinan chart LTF Anda.</p>
    `;

    const visionSlotTop = document.createElement('div');
    visionSlotTop.id = 'visionSlotTop';
    visionSlotTop.className = 'space-y-2';

    const visionSlotCard = document.createElement('div');
    visionSlotCard.id = 'visionSlotCard';
    visionSlotCard.className = 'space-y-2';

    if (visionPanel) panes.vision.appendChild(visionPanel);
    panes.vision.appendChild(visionSlotTop);
    panes.vision.appendChild(visionDrawBox);
    panes.vision.appendChild(visionSlotCard);

    // --- TAB 5: BOT ---
    if (botPanel) {
      botPanel.classList.remove('hidden');
      panes.bot.appendChild(botPanel);
    }

    // --- TAB 6: HISTORY ---
    if (calCard) {
      calCard.classList.remove('hidden');
      panes.history.appendChild(calCard);
    }
    if (recapCard) panes.history.appendChild(recapCard);
    if (historyCard) panes.history.appendChild(historyCard);

    mainEl.innerHTML = '';
    Object.values(panes).forEach(p => mainEl.appendChild(p));

    const nav = document.createElement('nav');
    nav.id = 'luxBottomNav';
    nav.innerHTML = `
      <div class="lux-nav-inner">
        <button class="lux-nav-btn active" data-lux-tab="home"><i class="fa-solid fa-house"></i><span>Home</span></button>
        <button class="lux-nav-btn" data-lux-tab="news"><i class="fa-solid fa-newspaper"></i><span>News</span></button>
        <button class="lux-nav-btn" data-lux-tab="signal"><i class="fa-solid fa-bolt"></i><span>Signal</span></button>
        <button class="lux-nav-btn" data-lux-tab="vision"><i class="fa-solid fa-eye"></i><span>Vision</span></button>
        <button class="lux-nav-btn" data-lux-tab="bot"><i class="fa-solid fa-robot"></i><span>Bot</span></button>
        <button class="lux-nav-btn" data-lux-tab="history"><i class="fa-solid fa-clock-rotate-left"></i><span>History</span></button>
      </div>
    `;
    document.body.appendChild(nav);

    nav.addEventListener('click', e => {
      const btn = e.target.closest('[data-lux-tab]');
      if (btn) switchTab(btn.dataset.luxTab);
    });

    setupSearchablePair();
    hookVisionReDraw();
    hookLiveTickUpdates();
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.lux-tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.lux-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.luxTab === tab));

    const targetPane = document.getElementById('pane-' + tab);
    if (targetPane) targetPane.classList.add('active');

    const marketSel = document.getElementById('marketSelect');
    const styleContainer = document.getElementById('styleContainer');
    const signalBtn = document.getElementById('signalBtn');
    const standbyView = document.getElementById('standbyView');
    const signalCard = standbyView ? standbyView.parentElement : null;
    const marketCard = marketSel ? marketSel.closest('.bg-cardbg') : null;
    const botPanel = document.getElementById('botPanel');
    const visionPanel = document.getElementById('visionPanel');

    if (tab === 'signal') {
      if (marketCard && styleContainer) marketCard.appendChild(styleContainer);
      const biasPanel = document.getElementById('biasPanel');
      if (signalBtn && biasPanel) biasPanel.after(signalBtn);
      if (signalCard && signalBtn) signalBtn.after(signalCard);

      const savedPair = document.getElementById('pairSearchInput')?.dataset.val || 'XAUUSD';
      if (marketSel && marketSel.value !== savedPair) {
        marketSel.value = savedPair;
        if (typeof syncMarket === 'function') syncMarket();
      }
      if (botPanel) botPanel.classList.add('hidden');
      if (styleContainer) styleContainer.classList.remove('hidden');
      if (signalBtn) signalBtn.classList.remove('hidden');
      if (signalCard) signalCard.classList.remove('hidden');
    } else if (tab === 'vision') {
      const vTop = document.getElementById('visionSlotTop');
      const vCard = document.getElementById('visionSlotCard');
      if (vTop && styleContainer) vTop.appendChild(styleContainer);
      if (vTop && signalBtn) vTop.appendChild(signalBtn);
      if (vCard && signalCard) vCard.appendChild(signalCard);

      if (marketSel && marketSel.value !== 'VISION') {
        marketSel.value = 'VISION';
        if (typeof syncMarket === 'function') syncMarket();
      }
      if (visionPanel) visionPanel.classList.remove('hidden');
      if (styleContainer) styleContainer.classList.remove('hidden');
      if (signalBtn) signalBtn.classList.remove('hidden');
      if (signalCard) signalCard.classList.remove('hidden');
      window.redrawVisionOverlay();
    } else if (tab === 'bot') {
      if (marketSel && marketSel.value !== 'AUTOBOT') {
        marketSel.value = 'AUTOBOT';
        if (typeof syncMarket === 'function') syncMarket();
      }
      if (botPanel) botPanel.classList.remove('hidden');
    } else if (tab === 'history') {
      if (typeof renderCalendar === 'function') renderCalendar();
      if (typeof renderRecap === 'function') renderRecap();
      if (typeof renderHistory === 'function') renderHistory();
    } else if (tab === 'home') {
      updateHomeSparklines();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.luxSwitchTab = switchTab;
  window.luxGoSignal = function (pair) {
    const inp = document.getElementById('pairSearchInput');
    if (inp) {
      inp.value = pair;
      inp.dataset.val = pair;
    }
    switchTab('signal');
  };

  function setupSearchablePair() {
    const inp = document.getElementById('pairSearchInput');
    const dd = document.getElementById('pairDropdownList');
    const clr = document.getElementById('clearPairSearch');
    const sel = document.getElementById('marketSelect');
    if (!inp || !dd || !sel) return;

    inp.value = 'XAUUSD';
    inp.dataset.val = 'XAUUSD';

    const renderList = (q) => {
      const term = (q || '').trim().toUpperCase();
      const filtered = PAIRS_LIST.filter(p => p.val.includes(term) || p.label.toUpperCase().includes(term));
      if (!filtered.length) {
        dd.innerHTML = `<div class="p-2.5 text-[10px] font-mono text-gray-400">Pair "${term}" tidak tersedia.</div>`;
      } else {
        dd.innerHTML = filtered.map(p => `
          <div data-pick-pair="${p.val}" class="px-3 py-2 text-xs font-mono hover:bg-panelborder cursor-pointer flex justify-between items-center border-b border-panelborder/50 last:border-0">
            <span class="font-bold text-white">${p.val}</span>
            <span class="text-[9px] text-gray-400">${p.label}</span>
          </div>
        `).join('');
      }
      dd.classList.remove('hidden');
    };

    inp.addEventListener('focus', () => { inp.select(); renderList(''); });
    inp.addEventListener('input', () => { clr.classList.toggle('hidden', !inp.value); renderList(inp.value); });
    clr.addEventListener('click', () => { inp.value = ''; clr.classList.add('hidden'); inp.focus(); renderList(''); });

    dd.addEventListener('click', e => {
      const item = e.target.closest('[data-pick-pair]');
      if (!item) return;
      const val = item.dataset.pickPair;
      inp.value = val;
      inp.dataset.val = val;
      dd.classList.add('hidden');
      clr.classList.add('hidden');
      sel.value = val;
      if (typeof syncMarket === 'function') syncMarket();
    });

    document.addEventListener('click', e => {
      if (!inp.contains(e.target) && !dd.contains(e.target)) dd.classList.add('hidden');
    });
  }

  function injectCountdownBadges(chartPanel, smcPanel) {
    if (chartPanel) {
      const topRow = chartPanel.querySelector('.flex.flex-wrap.justify-between');
      if (topRow && !document.getElementById('liveMapCountdown')) {
        const badge = document.createElement('span');
        badge.id = 'liveMapCountdown';
        badge.className = 'lux-cd-badge';
        badge.innerHTML = '<i class="fa-regular fa-clock"></i> M1: --s';
        topRow.appendChild(badge);
      }
    }
    if (smcPanel) {
      const infoP = document.getElementById('smcInfo');
      if (infoP && !document.getElementById('smcHeaderBar')) {
        const bar = document.createElement('div');
        bar.id = 'smcHeaderBar';
        bar.className = 'flex flex-wrap justify-between items-center gap-1 pb-1';
        infoP.parentNode.insertBefore(bar, infoP);
        bar.appendChild(infoP);

        const rightGroup = document.createElement('div');
        rightGroup.className = 'flex items-center gap-1.5';
        rightGroup.innerHTML = `
          <span id="smcActiveBadge" class="hidden text-[8px] font-mono font-bold px-2 py-0.5 rounded border bg-blue-500/20 text-blue-400 border-blue-500/40"></span>
          <span id="smcMapCountdown" class="lux-cd-badge"><i class="fa-regular fa-clock"></i> --:--</span>
        `;
        bar.appendChild(rightGroup);
      }
    }
  }

  function updateCountdownsAndRecap() {
    const now = Date.now();
    const m1Rem = 60 - Math.floor((now % 60000) / 1000);
    const lmCd = document.getElementById('liveMapCountdown');
    if (lmCd) lmCd.innerHTML = `<i class="fa-regular fa-clock"></i> M1: ${String(m1Rem).padStart(2, '0')}s`;

    const activeSmcBtn = document.querySelector('.smc-tf-btn.active');
    const tf = activeSmcBtn ? activeSmcBtn.dataset.tf : '5m';
    const tfMinMap = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 };
    const tfMs = (tfMinMap[tf] || 5) * 60000;
    const remSec = Math.max(0, Math.floor((tfMs - (now % tfMs)) / 1000));
    const mm = Math.floor(remSec / 60);
    const ss = remSec % 60;
    const smcCd = document.getElementById('smcMapCountdown');
    if (smcCd) smcCd.innerHTML = `<i class="fa-regular fa-clock"></i> ${tf.toUpperCase()}: ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

    const trStatus = document.getElementById('tradeStatus');
    const smcAct = document.getElementById('smcActiveBadge');
    if (trStatus && smcAct) {
      if (!trStatus.classList.contains('hidden') && trStatus.textContent) {
        smcAct.textContent = trStatus.textContent;
        smcAct.className = trStatus.className;
        smcAct.classList.remove('hidden');
      } else {
        smcAct.classList.add('hidden');
      }
    }

    const sigGrid = document.getElementById('sigDailyStatsGrid');
    if (sigGrid) {
      const w = document.getElementById('sumWin')?.textContent || '+0 pip';
      const l = document.getElementById('sumLose')?.textContent || '-0 pip';
      const tot = document.getElementById('sumTotal')?.textContent || '0 pip';
      const wr = document.getElementById('sumRatio')?.textContent || '0%';
      sigGrid.innerHTML = `
        <div class="bg-darkbg border border-emerald-500/25 rounded-lg p-1.5">
          <p class="text-[7px] text-gray-400">WIN</p>
          <p class="text-[10px] font-bold text-emerald-400">${w}</p>
        </div>
        <div class="bg-darkbg border border-red-500/25 rounded-lg p-1.5">
          <p class="text-[7px] text-gray-400">LOSE</p>
          <p class="text-[10px] font-bold text-red-400">${l}</p>
        </div>
        <div class="bg-darkbg border border-panelborder rounded-lg p-1.5">
          <p class="text-[7px] text-gray-400">NET PNL</p>
          <p class="text-[10px] font-bold text-white">${tot}</p>
        </div>
        <div class="bg-darkbg border border-panelborder rounded-lg p-1.5">
          <p class="text-[7px] text-gray-400">WIN RATE</p>
          <p class="text-[10px] font-bold text-accentblue">${wr}</p>
        </div>
      `;
    }
  }

  // Hook langsung ke addTick / onQuote agar setiap tick WebSocket langsung menggerakkan card atas
  function hookLiveTickUpdates() {
    if (typeof window.addTick === 'function' && !window.__LUX_TICK_HOOKED__) {
      window.__LUX_TICK_HOOKED__ = true;
      const origAddTick = window.addTick;
      window.addTick = function (k, p) {
        const res = origAddTick.apply(this, arguments);
        if (currentTab === 'home' && (k === 'XAUUSD' || k === 'BTCUSD')) {
          updateHomeSparklines();
        }
        return res;
      };
    }
  }

  function updateHomeSparklines() {
    if (currentTab !== 'home') return;
    const now = Date.now();

    ['XAUUSD', 'BTCUSD'].forEach(sym => {
      const pxEl = document.getElementById('lux-px-' + sym);
      const pctEl = document.getElementById('lux-pct-' + sym);
      const dotEl = document.getElementById('lux-dot-' + sym);
      const canvas = document.getElementById('lux-spark-' + sym);
      if (!canvas) return;

      const pObj = (typeof prices !== 'undefined' && prices[sym]) ? prices[sym] : null;
      const liveVal = pObj && Number.isFinite(Number(pObj.price)) ? Number(pObj.price) : null;
      const isLive = !!(pObj && (now - (pObj.recv || 0) < 30000));

      if (dotEl) {
        dotEl.className = 'inline-block w-1.5 h-1.5 rounded-full ' + (isLive ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500');
      }

      // Ambil titik harga live tick (hist -> candles 1m -> seriesRows)
      let pts = [];
      if (typeof hist !== 'undefined' && Array.isArray(hist[sym]) && hist[sym].length > 1) {
        pts = hist[sym].slice(-60).map(h => h.p).filter(Number.isFinite);
      }
      if (pts.length < 2 && typeof candles !== 'undefined' && candles[sym] && Array.isArray(candles[sym][1])) {
        pts = candles[sym][1].slice(-60).map(c => c.close).filter(Number.isFinite);
      }
      if (pts.length < 2 && typeof seriesRows === 'function') {
        const rows = seriesRows(sym, '5m');
        if (rows && rows.length > 1) pts = rows.slice(-60).map(r => r.c).filter(Number.isFinite);
      }
      if (liveVal != null && (!pts.length || pts[pts.length - 1] !== liveVal)) {
        pts.push(liveVal);
      }

      const displayPx = liveVal != null ? liveVal : (pts.length ? pts[pts.length - 1] : null);
      if (pxEl) {
        pxEl.textContent = (displayPx != null && typeof fmt === 'function')
          ? fmt(displayPx)
          : (displayPx != null ? displayPx.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--.--');

        // Flash warna naik/turun per tick
        if (prevPx[sym] != null && displayPx != null && displayPx !== prevPx[sym]) {
          pxEl.classList.remove('text-white', 'text-emerald-400', 'text-red-400');
          pxEl.classList.add(displayPx > prevPx[sym] ? 'text-emerald-400' : 'text-red-400');
          setTimeout(() => {
            pxEl.classList.remove('text-emerald-400', 'text-red-400');
            pxEl.classList.add('text-white');
          }, 260);
        }
        if (displayPx != null) prevPx[sym] = displayPx;
      }

      // Hitung persentase perubahan dari titik awal series atau open candle
      let pct = 0;
      if (pts.length >= 2 && pts[0] > 0) {
        pct = ((pts[pts.length - 1] - pts[0]) / pts[0]) * 100;
      } else if (typeof candles !== 'undefined' && candles[sym] && candles[sym][15] && candles[sym][15].length && displayPx != null) {
        const o = candles[sym][15][candles[sym][15].length - 1].open;
        if (o > 0) pct = ((displayPx - o) / o) * 100;
      }

      const isNeg = pct < 0;
      if (pctEl) {
        const sign = pct > 0 ? '+' : '';
        pctEl.textContent = (isNeg ? '▼ ' : '▲ ') + sign + pct.toFixed(2) + '%';
        pctEl.className = `text-[9px] font-mono font-bold ${pct > 0 ? 'text-emerald-400' : pct < 0 ? 'text-red-400' : 'text-gray-400'}`;
      }

      // Gambar grafik garis + gradasi bawah seperti live chart tick berjalan
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height || pts.length < 2) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const min = Math.min(...pts);
      const max = Math.max(...pts);
      const span = max - min || (displayPx ? displayPx * 0.0005 : 1);
      const w = rect.width;
      const h = rect.height;
      const padY = 5;

      const lineColor = isNeg ? '#f87171' : '#38bdf8';
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, isNeg ? 'rgba(248, 113, 113, 0.30)' : 'rgba(56, 189, 248, 0.30)');
      grad.addColorStop(1, 'rgba(5, 7, 10, 0.0)');

      const xAt = i => (i / (pts.length - 1)) * (w - 8) + 2;
      const yAt = v => padY + (1 - (v - min) / span) * (h - padY * 2);

      ctx.beginPath();
      pts.forEach((v, i) => {
        const x = xAt(i);
        const y = yAt(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.lineTo(xAt(pts.length - 1), h);
      ctx.lineTo(xAt(0), h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Titik live di ujung kanan grafik
      const lastX = xAt(pts.length - 1);
      const lastY = yAt(pts[pts.length - 1]);
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
      ctx.fillStyle = isNeg ? '#f87171' : '#38bdf8';
      ctx.fill();
    });
  }

  function hookVisionReDraw() {
    if (typeof window.refreshCard === 'function') {
      const origRefreshCard = window.refreshCard;
      window.refreshCard = function () {
        origRefreshCard.apply(this, arguments);
        if (currentTab === 'vision') window.redrawVisionOverlay();
      };
    }
  }

  window.redrawVisionOverlay = function () {
    const box = document.getElementById('visionDrawingCard');
    const canvas = document.getElementById('visionOverlayCanvas');
    if (!box || !canvas) return;

    const imgs = document.querySelectorAll('#visionPreview img');
    const activeCard = document.getElementById('activeCard');
    const isCardVisible = activeCard && !activeCard.classList.contains('hidden');

    if (!imgs.length || !isCardVisible) {
      box.classList.add('hidden');
      return;
    }

    const ltfImgSrc = imgs[imgs.length - 1].src;
    const sigType = (document.getElementById('sigBadge')?.textContent || 'BUY').trim();
    const entryTxt = (document.getElementById('cardZone')?.textContent || '').split('-')[0].trim();
    const slTxt = (document.getElementById('lv-sl')?.textContent || '').trim();
    const tp1Txt = (document.getElementById('lv-tp1')?.textContent || '').trim();
    const tp2Txt = (document.getElementById('lv-tp2')?.textContent || '').trim();
    const tp3Txt = (document.getElementById('lv-tp3')?.textContent || '').trim();

    const parseNum = s => parseFloat(String(s).replace(/,/g, ''));
    const entry = parseNum(entryTxt);
    const sl = parseNum(slTxt);
    const tp1 = parseNum(tp1Txt);
    const tp2 = parseNum(tp2Txt);
    const tp3 = parseNum(tp3Txt);

    if (!Number.isFinite(entry) || !Number.isFinite(sl)) {
      box.classList.add('hidden');
      return;
    }

    box.classList.remove('hidden');

    const img = new Image();
    img.onload = () => {
      const W = img.width || 800;
      const H = img.height || 450;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);

      ctx.fillStyle = 'rgba(5, 7, 10, 0.22)';
      ctx.fillRect(0, 0, W, H);

      const levels = [
        { label: `ENTRY (${sigType})`, val: entry, color: '#38bdf8', dash: [] },
        { label: 'STOP LOSS', val: sl, color: '#f87171', dash: [8, 6] },
        { label: 'TP 1', val: tp1, color: '#34d399', dash: [6, 4] },
        { label: 'TP 2', val: tp2, color: '#10b981', dash: [6, 4] },
        { label: 'TP 3', val: tp3, color: '#fbbf24', dash: [6, 4] }
      ].filter(l => Number.isFinite(l.val));

      const vals = levels.map(l => l.val);
      const minV = Math.min(...vals);
      const maxV = Math.max(...vals);
      const span = maxV - minV || 1;
      const padTop = H * 0.14;
      const padBot = H * 0.14;
      const yOf = v => padTop + (1 - (v - minV) / span) * (H - padTop - padBot);

      const startX = Math.round(W * 0.35);
      const endX = W - 12;

      const yEntry = yOf(entry);
      const ySl = yOf(sl);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
      ctx.fillRect(startX, Math.min(yEntry, ySl), endX - startX, Math.abs(ySl - yEntry));

      const tps = [tp3, tp2, tp1].filter(Number.isFinite);
      if (tps.length) {
        const yTpMax = yOf(tps[0]);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
        ctx.fillRect(startX, Math.min(yEntry, yTpMax), endX - startX, Math.abs(yTpMax - yEntry));
      }

      const fontSize = Math.max(12, Math.round(W * 0.016));
      ctx.font = `bold ${fontSize}px ui-monospace, monospace`;

      levels.forEach(l => {
        const y = yOf(l.val);
        ctx.save();
        ctx.strokeStyle = l.color;
        ctx.lineWidth = Math.max(2, Math.round(W * 0.0025));
        ctx.setLineDash(l.dash);
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
        ctx.restore();

        const tag = `${l.label}: ${l.val}`;
        const tw = ctx.measureText(tag).width + 14;
        const th = fontSize + 8;
        const bx = endX - tw;
        const by = Math.max(4, Math.min(H - th - 4, y - th / 2));

        ctx.fillStyle = '#090d16';
        ctx.fillRect(bx, by, tw, th);
        ctx.strokeStyle = l.color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, tw, th);

        ctx.fillStyle = l.color;
        ctx.textBaseline = 'middle';
        ctx.fillText(tag, bx + 7, by + th / 2);
      });
    };
    img.src = ltfImgSrc;
  };

  function init() {
    injectStyles();
    buildLuxuryLayout();
    switchTab('home');
    setInterval(() => {
      updateCountdownsAndRecap();
      updateHomeSparklines();
      hookLiveTickUpdates();
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
