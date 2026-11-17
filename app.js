// =========================================================================
// TERMINAL UTAMA & WEBSOCKET XBTFX
// =========================================================================
const MARKETS = {
  XAUUSD: { aliases: ['XAUUSD', 'GOLD'], min: 1000, max: 5000, pip: 0.1 },
  BTCUSD: { aliases: ['BTCUSD', 'BTCUSDT', 'BTC'], min: 1000, max: 1000000, pip: 1 },
  VISION: { aliases: ['VISION', 'IMAGE'], min: 0, max: 0, pip: 1 }
};
const KEYS = Object.keys(MARKETS);
const WS_URL = 'wss://ws.xbtfx.com/v1/ws';
const STORE_KEY = 'aluGold_history_v1';
const LIVE_KEY = 'aluLive_v1';
const K = { type: 'alu_session_type', email: 'alu_user_email', admin: 'alu_admin_code' };

let lang = 'id', market = 'XAUUSD', ws = null, connId = 0, reconT = null, pingT = null, authFailed = false, streamStarted = false;
let trades = [], activeId = null;
const prices = {}, hist = {}, candles = {}, workingSym = {}, aliasIdx = {}, subAt = {};
const SER = {}, CSYM = {}, dispCache = {};
let pumping = false;

const cv = document.getElementById('priceChart');
const cx = cv ? cv.getContext('2d') : null;
const scv = document.getElementById('smcCanvas');
const sx = scv ? scv.getContext('2d') : null;

function setTxt(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = s => String(s ?? '').toUpperCase().replace(/^XYZ:/, '').replace(/\.[A-Z]+$/, '').replace(/[^A-Z0-9]/g, '');
const ALIAS_MAP = new Map();
KEYS.forEach(k => MARKETS[k].aliases.forEach(a => ALIAS_MAP.set(norm(a), k)));

const fmt = p => {
  const n = Number(p);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

async function api(path, opts) {
  try {
    const res = await fetch(path, opts || {});
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { msg: 'Server error' }; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, network: true, data: { msg: 'Koneksi terputus.' } };
  }
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function handleLogin(e) {
  e.preventDefault();
  const val = document.getElementById('authInput').value.trim();
  const r = await post('/api/login', { value: val });
  if (!r.ok || !r.data || !r.data.ok) return alert('Login ditolak');
  if (r.data.role === 'admin') {
    localStorage.setItem(K.type, 'admin_reg');
    localStorage.setItem(K.admin, val);
    showAdmin();
  } else {
    localStorage.setItem(K.type, 'terminal');
    localStorage.setItem(K.email, r.data.email);
    showApp();
  }
}

function showApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('registerDashboard').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
  document.getElementById('mainApp').classList.add('flex');
  if (!streamStarted) { streamStarted = true; connect(); }
}

function showAdmin() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('mainApp').classList.add('hidden');
  document.getElementById('registerDashboard').classList.remove('hidden');
}

function logout() { localStorage.clear(); location.reload(); }

function connect() {
  clearTimeout(reconT);
  clearInterval(pingT);
  if (ws) { ws.close(); }
  const my = ++connId;
  const email = localStorage.getItem(K.email);
  if (!email) return;

  post('/api/stream-token', { value: email }).then(r => {
    if (my !== connId) return;
    openSocket(r.ok && r.data ? r.data.token : null);
  });
}

function openSocket(token) {
  const sock = new WebSocket(WS_URL);
  ws = sock;
  sock.onopen = () => {
    if (token) sock.send(JSON.stringify({ action: 'auth', token }));
    else sock.send(JSON.stringify({ action: 'subscribe', channel: 'quotes', symbols: KEYS.filter(k => k !== 'VISION').map(k => MARKETS[k].aliases[0]) }));
  };
  sock.onmessage = e => {
    try {
      const m = JSON.parse(e.data);
      if (m.action === 'auth_ok') {
        sock.send(JSON.stringify({ action: 'subscribe', channel: 'quotes', symbols: KEYS.filter(k => k !== 'VISION').map(k => MARKETS[k].aliases[0]) }));
      } else if (m.channel === 'quote') {
        onQuote(m);
      }
    } catch(err) {}
  };
  sock.onclose = () => { if (ws === sock) reconT = setTimeout(connect, 4000); };
}

function onQuote(m) {
  const p = [m.bid, m.mid, m.price, m.ask].map(parseFloat).find(n => n > 0);
  if (!p) return;
  const k = ALIAS_MAP.get(norm(m.symbol));
  if (!k) return;
  prices[k] = { price: p, dir: prices[k] ? (p > prices[k].price ? 1 : -1) : 0, recv: Date.now() };
  renderTickers();
}

function renderTickers() {
  const el = document.getElementById('tickerList');
  if (!el) return;
  el.innerHTML = KEYS.filter(k => k !== 'VISION').map(k => {
    const p = prices[k];
    return `<div class="bg-darkbg border border-panelborder px-2 py-1 rounded flex items-center justify-between">
      <span class="font-bold text-[10px] text-white">${k}</span>
      <span class="text-[11px] font-mono font-bold text-white">${p ? fmt(p.price) : '--.--'}</span>
    </div>`;
  }).join('');
}

function syncMarket() {
  const sel = document.getElementById('marketSelect').value;
  const isBot = sel === 'AUTOBOT';
  market = isBot ? 'XAUUSD' : sel;
  document.getElementById('botPanel').classList.toggle('hidden', !isBot);
  document.getElementById('tradingStyleSelect').classList.toggle('hidden', isBot);
  document.getElementById('signalBtn').classList.toggle('hidden', isBot);
}

async function generateSignal() {
  const email = localStorage.getItem(K.email);
  if (!email) return alert('Sesi berakhir.');
  const style = document.getElementById('tradingStyleSelect').value;
  const livePx = prices[market]?.price || 0;

  const payload = { email, symbol: market, style, price: livePx, currentPrice: livePx, candles: { m1: [], m5: [], m15: [] }, lang };

  const res = await post('/api/generate', payload);
  if (!res.ok || !res.data || !res.data.ok) return alert('Belum ada setup valid.');
  
  const sig = res.data.signal;
  const trade = {
    id: Date.now().toString(),
    no: 1, key: market, style, signal: sig.signal,
    entry: Number(sig.entry), sl: Number(sig.sl),
    tp1: Number(sig.tp1), tp2: Number(sig.tp2), tp3: Number(sig.tp3),
    status: 'RUNNING', createdAt: Date.now(), hits: {}
  };
  trades.push(trade);
  activeId = trade.id;
  document.getElementById('standbyView').classList.add('hidden');
  document.getElementById('activeCard').classList.remove('hidden');
  setTxt('sigBadge', sig.signal);
  setTxt('cardZone', fmt(sig.entry));
  setTxt('lv-sl', fmt(sig.sl));
  setTxt('lv-tp1', fmt(sig.tp1));
  setTxt('lv-tp2', fmt(sig.tp2));
  setTxt('lv-tp3', fmt(sig.tp3));
  setTxt('cardReason', sig.reason || '-');
  renderHistory();
}

function renderHistory() {
  const box = document.getElementById('historyList');
  if (!box) return;
  if (!trades.length) { box.innerHTML = '<p class="text-center text-[10px] text-gray-500 py-3">Belum ada history.</p>'; return; }
  box.innerHTML = trades.slice().reverse().map(t => `
    <div class="bg-darkbg border border-panelborder px-2 py-1.5 rounded text-[9px]">
      <span class="font-bold text-white">${t.key} · ${t.signal}</span> · Entry: ${fmt(t.entry)}
    </div>`).join('');
}

window.addEventListener('load', () => {
  if (localStorage.getItem(K.type) === 'terminal') showApp();
});
