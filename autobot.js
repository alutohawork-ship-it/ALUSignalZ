/* autobot.js — Auto Bot XAUUSD (simulasi/paper).
   Pasang di index.html tepat sebelum </body>, SETELAH script utama:
   <script src="autobot.js"></script>
*/
(function () {
  'use strict';

  const BOT_KEY = 'aluBot_v1';
  const BSYM = 'XAUUSD';
  const M5 = 300000;
  const CD_WIN = 5 * 60000;
  const CD_LOSS = 10 * 60000;
  const MAX_LOSS = 3;
  const PEND_MS = 50 * 60000;
  const RUN_AWAY_ATR = 1.0;

  const BOT = { on: false, since: 0, mode: 'loop', style: 'Scalping', session: false, launched: false, lastScan: 0, msg: '', last: '', busy: false };

  function load() {
    try { Object.assign(BOT, JSON.parse(localStorage.getItem(BOT_KEY) || '{}'), { busy: false, msg: '' }); } catch (e) {}
  }
  function save() {
    try {
      localStorage.setItem(BOT_KEY, JSON.stringify({
        on: BOT.on, since: BOT.since, mode: BOT.mode, style: BOT.style,
        session: BOT.session, launched: BOT.launched, lastScan: BOT.lastScan
      }));
    } catch (e) {}
  }

  /* ---------- util ---------- */
  function atr5() {
    const r = seriesRows(BSYM, '5m').slice(-15);
    if (r.length < 5) return 0;
    let s = 0, n = 0;
    for (let i = 1; i < r.length; i++) {
      const c = r[i], p = r[i - 1];
      s += Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c));
      n++;
    }
    return n ? s / n : 0;
  }
  function lossStreak() {
    const list = trades
      .filter(t => t.auto && t.status === 'CLOSED' && t.result !== 'CANCEL' && (t.createdAt || 0) >= BOT.since)
      .sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0));
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) { if (list[i].result === 'SL') n++; else break; }
    return n;
  }
  function cooldownLeft() {
    const last = trades.filter(t => t.auto && t.status === 'CLOSED')
      .sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0)).pop();
    if (!last) return 0;
    const w = last.result === 'SL' ? CD_LOSS : CD_WIN;
    return Math.max(0, (last.closedAt || 0) + w - Date.now());
  }
  function state() {
    const open = openOf(BSYM)[0];
    if (open) return open.status === 'PENDING' ? { k: 'PENDING', c: 'yellow' } : { k: 'RUNNING', c: 'blue' };
    if (!BOT.on) return /^Berhenti/.test(BOT.msg) ? { k: 'STOPPED', c: 'red' } : { k: 'OFF', c: 'gray' };
    if (cooldownLeft() > 0) return { k: 'COOLDOWN', c: 'gray' };
    return { k: 'WAITING SETUP', c: 'green' };
  }

  /* ---------- UI ---------- */
  function buildUI() {
    const sel = $('marketSelect');
    if (!sel || $('botPanel')) return;
    sel.add(new Option('Auto Bot (XAUUSD Scalping)', 'AUTOBOT'));

    $('visionPanel').insertAdjacentHTML('beforebegin', `
      <div id="botPanel" class="hidden bg-cardbg rounded-xl border border-panelborder p-2.5 shadow-md space-y-2">
        <div class="flex justify-between items-center">
          <span class="text-[9px] font-bold text-gray-400 flex items-center gap-1"><i class="fa-solid fa-robot text-accentblue"></i> AUTO BOT · XAUUSD</span>
          <span id="botBadge" class="text-[8px] font-mono font-bold px-2 py-0.5 rounded border">OFF</span>
        </div>
        <div class="grid grid-cols-2 gap-1.5">
          <select id="botStyle" class="bg-darkbg border border-panelborder text-[10px] font-bold text-white p-1.5 rounded-lg focus:outline-none">
            <option value="Scalping">Scalping Agresif</option>
            <option value="Day Trading">Scalping Konservatif</option>
          </select>
          <select id="botMode" class="bg-darkbg border border-panelborder text-[10px] font-bold text-white p-1.5 rounded-lg focus:outline-none">
            <option value="loop">Auto-loop</option>
            <option value="once">Sekali (lanjut manual)</option>
          </select>
        </div>
        <label class="flex items-center gap-1.5 text-[9px] text-gray-400"><input type="checkbox" id="botSess"> Hanya sesi London/NY (07–21 UTC)</label>
        <button id="botBtn" class="w-full font-bold py-2 rounded-lg text-xs transition">START BOT</button>
        <p id="botMsg" class="text-[9px] font-mono text-gray-300 min-h-[12px] break-words"></p>
        <p id="botStats" class="text-[8px] font-mono text-gray-500"></p>
        <p class="text-[8px] text-gray-500 leading-snug">Simulasi: hanya menggambar garis dan mencatat hasil, tidak memasang order sungguhan. Tab harus tetap terbuka.</p>
      </div>`);

    $('botStyle').value = BOT.style;
    $('botMode').value = BOT.mode;
    $('botSess').checked = !!BOT.session;
    ['botStyle', 'botMode', 'botSess'].forEach(id => $(id).addEventListener('change', cfg));
    $('botBtn').addEventListener('click', toggle);
  }

  function cfg() {
    BOT.style = $('botStyle').value;
    BOT.mode = $('botMode').value;
    BOT.session = $('botSess').checked;
    save();
  }

  function toggle() {
    if (BOT.on) {
      BOT.on = false;
      trades.forEach(t => {
        if (t.auto && t.status === 'PENDING') cancelTrade(t, 'Bot dihentikan'); //[span_4](start_span)[span_4](end_span)
      });
      saveTrades();
      renderAll();
      BOT.msg = 'Bot dihentikan. Order pending dibatalkan, posisi berjalan tetap dipantau.'; //[span_5](start_span)[span_5](end_span)
    } else {
      BOT.on = true;
      BOT.since = Date.now();
      BOT.launched = false;
      BOT.lastScan = 0;
      BOT.last = '';
      BOT.msg = 'Bot aktif...';
    }
    save();
    render();
    tick();
  }

  function render() {
    if (!$('botPanel')) return;
    const s = state();
    const b = $('botBadge');
    b.textContent = s.k;
    b.className = 'text-[8px] font-mono font-bold px-2 py-0.5 rounded border ' + PILL[s.c];
    const btn = $('botBtn');
    btn.textContent = BOT.on ? 'STOP BOT' : 'START BOT';
    btn.className = 'w-full font-bold py-2 rounded-lg text-xs transition ' +
      (BOT.on ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-emerald-600 hover:bg-emerald-500 text-white');
    setTxt('botMsg', BOT.msg || '');

    const done = trades.filter(t => t.auto && t.status === 'CLOSED' && t.result !== 'CANCEL' && (t.createdAt || 0) >= (BOT.since || 0));
    const w = done.filter(t => t.pips > 0).length;
    const l = done.filter(t => t.pips < 0).length;
    const be = done.length - w - l;
    const net = done.reduce((a, t) => a + (Number(t.pips) || 0), 0);
    setTxt('botStats', `${w}W · ${l}L · ${be}BE · net ${fmtPips(net)} · loss beruntun ${lossStreak()}/${MAX_LOSS}`);
  }

  /* ---------- siklus bot ---------- */
  function cleanupAutoPending() {
    const px = prices[BSYM] && prices[BSYM].price;
    const a = atr5();
    let changed = false;
    trades.forEach(t => {
      if (!(t.auto && t.status === 'PENDING')) return; //[span_6](start_span)[span_6](end_span)
      if (Date.now() > (t.expiresAt || 0)) {
        cancelTrade(t, 'Kedaluwarsa');
        changed = true;
        return;
      } //[span_7](start_span)[span_7](end_span)
      if (a > 0 && px != null && t.px0 != null && t.dir * (px - t.px0) > RUN_AWAY_ATR * a) {
        cancelTrade(t, 'Harga lari menjauh dari entry');
        changed = true;
      } //[span_8](start_span)[span_8](end_span)
    });
    if (changed) {
      saveTrades();
      renderAll();
    } //[span_9](start_span)[span_9](end_span)
  }

  async function tick() {
    if (!BOT.on) {
      cleanupAutoPending(); //[span_10](start_span)[span_10](end_span)
      return render();
    }
    const now = Date.now();
    if (!marketOpen(BSYM)) { BOT.msg = 'Market tutup (weekend).'; return render(); }

    const open = openOf(BSYM);

    const pend = open.find(t => t.status === 'PENDING' && t.auto && !t.ocoId && t.px0 != null);
    if (pend) {
      const a = atr5(), px = prices[BSYM] && prices[BSYM].price;
      if (a > 0 && px != null && pend.dir * (px - pend.px0) > RUN_AWAY_ATR * a) {
        cancelTrade(pend, 'Harga lari menjauh dari entry');
        saveTrades(); renderAll();
        BOT.msg = 'Order dibatalkan: harga lari menjauh tanpa pullback.';
        return render();
      }
    }

    if (open.length) {
      BOT.msg = open[0].status === 'PENDING' ? 'Menunggu harga menyentuh entry...' : 'Posisi berjalan, dipantau sampai TP / SL / BE.';
      return render();
    }

    if (BOT.mode === 'once' && BOT.launched) {
      BOT.on = false; BOT.launched = false;
      BOT.msg = 'Selesai: trade sudah ditutup. Tekan START untuk lanjut.';
      save();
      return render();
    }

    if (lossStreak() >= MAX_LOSS) {
      BOT.on = false;
      BOT.msg = `Berhenti: ${MAX_LOSS} loss beruntun. Tekan START untuk reset.`;
      save();
      return render();
    }

    const cd = cooldownLeft();
    if (cd > 0) { BOT.msg = 'Cooldown ' + Math.ceil(cd / 1000) + ' dtk'; return render(); }

    if (BOT.session) {
      const h = new Date().getUTCHours();
      if (h < 7 || h >= 21) { BOT.msg = 'Di luar sesi London/NY, menunggu...'; return render(); }
    }

    const bucket = Math.floor(now / M5);
    if (BOT.lastScan === bucket) {
      BOT.msg = 'Menunggu setup · scan berikutnya ' + Math.ceil(((bucket + 1) * M5 - now) / 1000) + ' dtk' + (BOT.last ? ' · ' + BOT.last : '');
      return render();
    }
    if (now - bucket * M5 < 4000) return;

    const px = prices[BSYM];
    if (!px || now - px.recv > 15000) { BOT.msg = 'Menunggu harga live...'; return render(); }
    if (seriesRows(BSYM, '5m').length < 40) { BOT.msg = 'Menunggu data candle M5...'; return render(); }
    if (BOT.busy) return;

    BOT.busy = true;
    BOT.lastScan = bucket;
    BOT.msg = 'Menganalisa...';
    save(); render();
    try {
      const r = await generateLive({ auto: true });
      if (r.ok) { BOT.launched = true; BOT.last = ''; BOT.msg = 'Sinyal dibuat.'; }
      else BOT.last = r.msg || 'Belum ada setup';
    } catch (e) {
      BOT.last = 'Error: ' + e.message;
    } finally {
      BOT.busy = false;
      save(); render();
    }
  }

  /* ---------- generate (dipakai tombol manual & bot) ---------- */
  async function generateLive(opts) {
    const auto = !!(opts && opts.auto);
    const mk = auto ? BSYM : market;
    const style = auto ? BOT.style : $('tradingStyleSelect').value;
    const rowsOf = iv => seriesRows(mk, iv).slice(-300).map(c => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c }));
    const livePx = (prices[mk] && prices[mk].price) || 0;

    // PERBAIKAN: Tangkap response mentah untuk cek apakah JSON atau HTML
    let res;
    try {
      const rawRes = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: localStorage.getItem(K.email),
          bot: !!auto, //[span_11](start_span)[span_11](end_span)
          symbol: mk, style, price: livePx, currentPrice: livePx,
          candles: { m1: rowsOf('1m'), m5: rowsOf('5m'), m15: rowsOf('15m') },
          lang
        })
      });
      const text = await rawRes.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error('Server mengembalikan format tidak valid (bukan JSON). Cek log server/API.');
      }
      res = { ok: rawRes.ok, data };
    } catch (e) {
      return { ok: false, msg: 'Koneksi/API Error: ' + e.message };
    }

    const data = res.data;
    if (!res.ok || !data || !data.ok) {
      return { ok: false, msg: (data && (data.message || data.reason || data.error || data.msg)) || 'Belum ada setup valid.' };
    }

    const sig = data.signal;
    const num = v => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    const expireAfter = (auto && style === 'Scalping') ? PEND_MS : (EXPIRY_MS[style] || 4 * 3600 * 1000);

    const mkTrade = (o, forceLimit) => {
      const isLimit = forceLimit || o.orderType === 'LIMIT' || o.mode === 'LIMIT';
      return {
        id: Date.now().toString() + Math.random().toString(36).slice(2, 7),
        no: nextNo(), key: mk, style, signal: o.signal,
        dir: o.signal === 'BUY' ? 1 : -1,
        mode: isLimit ? 'LIMIT' : 'MARKET',
        orderType: o.orderType || (isLimit ? 'LIMIT' : 'MARKET'),
        fill: o.fill || 'LIMIT',
        entry: Number(o.entry), sl: Number(o.sl),
        tp1: num(o.tp1), tp2: num(o.tp2), tp3: num(o.tp3),
        status: (isLimit || o.status === 'PENDING') ? 'PENDING' : 'RUNNING',
        createdAt: Date.now(), expiresAt: Date.now() + expireAfter,
        zone: o.zone || null,
        zoneLabel: o.zoneLabel || '',
        zoneNote: o.zoneNote || o.setupLabel || '',
        setup: o.setup || o.zoneLabel || sig.setup,
        confidence: o.confidence || sig.confidence,
        risk: o.risk || sig.risk,
        pip: (MARKETS[mk] && MARKETS[mk].pip) || 0.1,
        hits: {},
        auto, px0: livePx,
        card: { reason: sig.reason, reasons: pickReasons(sig, lang), reasonLang: lang }
      };
    };

    if (Array.isArray(sig.orders) && sig.orders.length) {
      const ocoId = 'oco_' + Date.now();
      const created = sig.orders.map(o => { const tr = mkTrade(o, true); tr.ocoId = ocoId; trades.push(tr); return tr; });
      let focus = created[created.length - 1];
      if (livePx) focus = created.slice().sort((a, b) => Math.abs(a.entry - livePx) - Math.abs(b.entry - livePx))[0];
      if (market === mk) activeId = focus.id;
    } else {
      const tr = mkTrade(sig, false);
      trades.push(tr);
      if (market === mk) activeId = tr.id;
    }
    saveTrades();
    renderAll();
    return { ok: true };
  }

  /* ---------- override fungsi utama ---------- */
  const origGenerate = window.generateSignal;

  window.generateSignal = async function () {
    if (market === 'VISION') return origGenerate();
    const btn = $('signalBtn'), bt = $('btnText'), orig = bt.textContent;
    bt.textContent = 'Menganalisa...';
    btn.disabled = true;
    try {
      const r = await generateLive({ auto: false });
      if (!r.ok) alert(r.msg);
    } catch (e) {
      console.error(e);
      alert('Gagal generate sinyal: ' + e.message);
    } finally {
      bt.textContent = orig;
      btn.disabled = false;
    }
  };

  window.syncMarket = function (tradeId) {
    const sel = $('marketSelect').value;
    const isBot = sel === 'AUTOBOT';
    market = isBot ? BSYM : sel;
    setTxt('selectedPairBadge', isBot ? 'XAUUSD · BOT' : market);

    const isVision = market === 'VISION';
    $('visionPanel').classList.toggle('hidden', !isVision);
    $('streamPanel').classList.toggle('hidden', isVision);
    $('biasPanel').classList.toggle('hidden', isVision);
    $('chartPanel').classList.toggle('hidden', isVision);
    $('smcPanel').classList.toggle('hidden', isVision);
    $('sessionPanel').classList.toggle('hidden', isVision);

    $('botPanel').classList.toggle('hidden', !isBot);
    $('signalBtn').classList.toggle('hidden', isBot);
    $('tradingStyleSelect').parentElement.classList.toggle('hidden', isBot);

    setTxt('btnText', isVision ? T('btnGenVision') : T('btnGen'));
    activeId = isVision ? null : pickTradeFor(market, tradeId);
    refreshCard();
    renderHistory();
    if (!isVision) { pump(); renderAll(); }
    render();
  };

  window.pickMarket = function (k, tradeId) {
    const s = $('marketSelect');
    s.value = (s.value === 'AUTOBOT' && k === BSYM) ? 'AUTOBOT' : k;
    window.syncMarket(tradeId);
  };

  /* ---------- boot ---------- */
  load();
  buildUI();
  if (BOT.on) { $('marketSelect').value = 'AUTOBOT'; window.syncMarket(); }
  render();
  setInterval(tick, 2000);
  setInterval(render, 1000);
})();
