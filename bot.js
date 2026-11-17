// =========================================================================
// MODUL AUTO BOT (EA) XAUUSD
// =========================================================================
let botRunning = false;
let botTimer = null;
let botStatsObj = { total: 0, wins: 0, losses: 0 };
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTradeAlert() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const playTone = (freq, startTime, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.3, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    playTone(587.33, now, 0.4);
    playTone(880.00, now + 0.12, 0.6);
  } catch (e) {}
}

function renderBotUI() {
  const btn = document.getElementById('botBtn');
  const badge = document.getElementById('botBadge');
  const stats = document.getElementById('botStats');
  if(!btn || !badge) return;

  if (botRunning) {
    btn.textContent = 'STOP BOT (EA)';
    btn.className = 'w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2 rounded-lg text-xs transition shadow-lg';
    badge.textContent = 'RUNNING';
    badge.className = 'text-[8px] font-mono font-bold px-2 py-0.5 rounded border bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
  } else {
    btn.textContent = 'START BOT (EA)';
    btn.className = 'w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 rounded-lg text-xs transition shadow-lg';
    badge.textContent = 'OFF';
    badge.className = 'text-[8px] font-mono font-bold px-2 py-0.5 rounded border bg-red-500/20 text-red-400 border-red-500/40';
  }
  if (stats) stats.textContent = `Total Bot Trade: ${botStatsObj.total} | Win: ${botStatsObj.wins} | Loss: ${botStatsObj.losses}`;
}

async function toggleBot() {
  botRunning = !botRunning;
  renderBotUI();
  const msg = document.getElementById('botMsg');
  if (botRunning) {
    if(msg) msg.textContent = 'Bot diaktifkan. Memantau pasar XAUUSD secara otomatis...';
    runBotCycle();
    botTimer = setInterval(runBotCycle, 15000);
  } else {
    if(msg) msg.textContent = 'Bot dihentikan.';
    if (botTimer) clearInterval(botTimer);
  }
}

async function runBotCycle() {
  if (!botRunning) return;
  const openTrades = typeof trades !== 'undefined' ? trades.filter(x => x.key === 'XAUUSD' && x.status !== 'CLOSED') : [];
  if (openTrades.length > 0) return;

  const email = localStorage.getItem('alu_user_email');
  if (!email) return;
  const style = document.getElementById('botStyle') ? document.getElementById('botStyle').value : 'Scalping';
  const livePx = (typeof prices !== 'undefined' && prices['XAUUSD']) ? prices['XAUUSD'].price : 0;
  const rowsOf = iv => (typeof seriesRows === 'function') ? seriesRows('XAUUSD', iv).slice(-300).map(c => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c })) : [];
  
  const payload = {
    email: email,
    symbol: 'XAUUSD',
    style: style,
    price: livePx,
    currentPrice: livePx,
    candles: { m1: rowsOf('1m'), m5: rowsOf('5m'), m15: rowsOf('15m') },
    lang: typeof lang !== 'undefined' ? lang : 'id'
  };

  try {
    const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const json = await res.json();
    if (res.ok && json && json.ok) {
      const sig = json.signal;
      const trade = {
        id: 'bot_' + Math.random().toString(36).slice(2, 9),
        no: typeof nextNo === 'function' ? nextNo() : 1,
        key: 'XAUUSD', style: style, signal: sig.signal,
        dir: sig.signal === 'BUY' ? 1 : -1,
        mode: sig.orderType === 'LIMIT' ? 'LIMIT' : 'MARKET',
        entry: Number(sig.entry), sl: Number(sig.sl),
        tp1: Number(sig.tp1), tp2: Number(sig.tp2), tp3: Number(sig.tp3),
        status: sig.orderType === 'LIMIT' ? 'PENDING' : 'RUNNING',
        createdAt: Date.now(),
        hits: {}, pip: 0.1
      };
      if (typeof trades !== 'undefined') trades.push(trade);
      if (typeof activeId !== 'undefined') activeId = trade.id;
      if (typeof saveTrades === 'function') saveTrades();
      botStatsObj.total++;
      if (typeof renderAll === 'function') renderAll();
      playTradeAlert();
      renderBotUI();
    }
  } catch (e) {}
}
