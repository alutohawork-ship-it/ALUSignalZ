/* pintu-ui.js — Alu Signal Z × Pintu-style UI (Home/Signal/Vision/Bot/History)
   Inject via middleware. Tidak mengubah index.html. Aman: abort bila anchor tak ditemukan. */
(() => {
'use strict';
if (window.__PT_UI__) return; window.__PT_UI__ = 1;

/* ---------- utils ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const txt = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
function parseNum(s) {
  if (s == null) return null; s = String(s).trim();
  if (!/\d/.test(s)) return null;
  const idFmt = /\d\.\d{3}(\D|$)/.test(s) || /,\d{1,2}$/.test(s);
  if (idFmt) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const m = s.match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null;
}
const fmt = (n, d = 2) => n == null ? '—' : n.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
function findAnchor(re) {
  const c = $$('button,h1,h2,h3,h4,div,section,span,label').filter(e => e.children.length < 8 && re.test(txt(e)) && txt(e).length < 400);
  c.sort((a, b) => txt(a).length - txt(b).length); return c[0] || null;
}
function lca(a, b) { const s = new Set(); for (let n = a; n; n = n.parentElement) s.add(n); for (let n = b; n; n = n.parentElement) if (s.has(n)) return n; return document.body; }

/* ---------- state ---------- */
const TABS = ['home', 'signal', 'vision', 'bot', 'history'];
const pages = {}, blocks = { home: [], signal: [], vision: [], bot: [], history: [] };
let main = null, activeTab = localStorage.getItem('pt_tab') || 'home';
const feed = { XAUUSD: { s: [], p: null }, BTCUSD: { s: [], p: null } };
const cache = {};
function ref(key, finder) { let el = cache[key]; if (!el || !el.isConnected) { el = cache[key] = finder(); } return el; }

/* ---------- CSS ---------- */
const CSS = `
:root{--pt-bg:#000;--pt-card:#0c0e13;--pt-line:#1b202b;--pt-txt:#e8eaf0;--pt-mut:#8b93a3;--pt-blue:#2f7bff;--pt-green:#16c784;--pt-red:#ea3943}
html{color-scheme:dark}
body{background:radial-gradient(1100px 520px at 50% -8%,#0b1322 0%,#000 58%) fixed #000!important;color:var(--pt-txt)!important;
 font-family:-apple-system,'Segoe UI',Roboto,Inter,system-ui,sans-serif!important;-webkit-font-smoothing:antialiased;
 padding-top:64px!important;padding-bottom:96px!important;margin:0}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-thumb{background:#232a37;border-radius:3px}
#pt-topbar{position:fixed;top:0;left:0;right:0;height:56px;z-index:9000;display:flex;align-items:center;gap:10px;
 padding:0 14px;background:rgba(0,0,0,.82);backdrop-filter:blur(14px);border-bottom:1px solid #12161e}
#pt-topbar .brand{font-weight:800;font-size:16px;letter-spacing:.3px}
#pt-topbar .pro{font-size:9px;font-weight:800;background:linear-gradient(90deg,#2f7bff,#7b3fff);padding:2px 7px;border-radius:6px;margin-left:6px;vertical-align:2px}
#pt-topbar .sp{flex:1}
#pt-ws{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--pt-mut);font-weight:700}
#pt-ws i{width:7px;height:7px;border-radius:50%;background:var(--pt-red);display:inline-block}
#pt-ws.on i{background:var(--pt-green);box-shadow:0 0 8px var(--pt-green)}
#pt-bell{position:relative;background:#12151c;border:1px solid #222835;color:#fff;width:36px;height:36px;border-radius:12px;font-size:15px;cursor:pointer}
#pt-bell.has:after{content:'';position:absolute;top:7px;right:8px;width:7px;height:7px;border-radius:50%;background:var(--pt-red)}
#pt-ava{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#2f7bff,#12305e);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px}
.pt-page{position:absolute;top:0;left:0;width:100%;visibility:hidden;pointer-events:none}
.pt-page.on{position:relative;visibility:visible;pointer-events:auto}
.pt-block{background:var(--pt-card);border:1px solid var(--pt-line);border-radius:18px;padding:14px;margin:0 0 14px;box-shadow:0 1px 0 rgba(255,255,255,.03) inset}
.pt-group{margin:0 0 14px}
.pt-page select,.pt-page input:not([type=file]):not([type=range]):not([type=checkbox]){background:#12151c!important;border:1px solid #232833!important;color:var(--pt-txt)!important;border-radius:12px!important;padding:9px 12px!important;font-size:13px!important;outline:none}
.pt-page button{border-radius:12px}
.pt-primary{background:var(--pt-blue)!important;color:#fff!important;border:none!important;font-weight:800!important;box-shadow:0 6px 18px rgba(47,123,255,.25)}
.pt-h{font-size:13px;font-weight:800;color:var(--pt-mut);letter-spacing:1.2px;text-transform:uppercase;margin:2px 0 10px}
/* ticker */
#pt-ticker{overflow:hidden;border:1px solid var(--pt-line);background:#0a0d12;border-radius:14px;margin:0 0 14px;padding:9px 0}
#pt-ticker .in{display:flex;gap:34px;width:max-content;animation:ptmq 26s linear infinite;padding-left:14px}
#pt-ticker .it{display:flex;gap:7px;align-items:center;font-size:12px;white-space:nowrap}
#pt-ticker b{font-weight:800}#pt-ticker .up{color:var(--pt-green)}#pt-ticker .dn{color:var(--pt-red)}
@keyframes ptmq{to{transform:translateX(-50%)}}
/* asset cards */
#pt-assets{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 14px}
.pt-asset{background:var(--pt-card);border:1px solid var(--pt-line);border-radius:18px;padding:12px 12px 8px;position:relative;overflow:hidden}
.pt-asset .nm{display:flex;align-items:center;gap:7px;font-weight:800;font-size:13px}
.pt-asset .nm i{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-style:normal}
.pt-asset .sy{font-size:10px;color:var(--pt-mut);font-weight:700;letter-spacing:.8px;margin:3px 0 5px}
.pt-asset .pr{font-size:17px;font-weight:800;letter-spacing:.2px}
.pt-asset .ch{font-size:11px;font-weight:800;margin-top:2px}
.pt-asset canvas{width:100%;height:58px;display:block;margin-top:6px}
.pt-asset .lv{position:absolute;top:12px;right:12px;font-size:8px;font-weight:800;color:var(--pt-mut);display:flex;gap:4px;align-items:center}
.pt-asset .lv i{width:6px;height:6px;border-radius:50%;background:#3a4150}
.pt-asset .lv.on i{background:var(--pt-green);animation:ptpulse 1.4s infinite}
@keyframes ptpulse{50%{opacity:.35}}
/* quick stats */
#pt-quick{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 14px}
.pt-q{background:var(--pt-card);border:1px solid var(--pt-line);border-radius:14px;padding:10px;text-align:center}
.pt-q b{display:block;font-size:16px;font-weight:800}.pt-q span{font-size:9px;color:var(--pt-mut);font-weight:700;letter-spacing:.6px}
/* chips */
.pt-chiprow{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
.pt-chip{display:inline-flex;align-items:center;gap:6px;background:#12151c;border:1px solid #232833;border-radius:999px;padding:6px 12px;font-size:11px;font-weight:800}
.pt-chip.blue{color:#7db1ff;border-color:#1d3357}.pt-chip.green{color:var(--pt-green);border-color:#14432f}.pt-chip.red{color:var(--pt-red);border-color:#4a1a20}
.pt-cd{font-variant-numeric:tabular-nums;color:#ffd166;border-color:#4a3a12}
/* vision overlay */
.pt-vwrap{position:relative;display:block;line-height:0;border-radius:14px;overflow:hidden}
.pt-vwrap>img,.pt-vwrap>canvas{max-width:100%;width:100%;height:auto}
.pt-voverlay{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair}
.pt-vctl{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 4px;line-height:normal}
.pt-vctl button{background:#12151c;border:1px solid #232833;color:var(--pt-txt);padding:8px 12px;font-size:11px;font-weight:800;cursor:pointer}
.pt-vctl button.acc{background:var(--pt-blue);border-color:var(--pt-blue);color:#fff}
.pt-vctl input{width:120px}
.pt-vhint{font-size:10px;color:var(--pt-mut);margin:4px 0 10px;line-height:normal}
/* calendar */
.pt-cal{background:var(--pt-card);border:1px solid var(--pt-line);border-radius:18px;padding:14px;margin:0 0 14px}
.pt-cal .hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.pt-cal .hd b{font-size:14px;font-weight:800}
.pt-cal .hd button{background:#12151c;border:1px solid #232833;color:#fff;width:32px;height:32px;border-radius:10px;cursor:pointer;font-size:14px}
.pt-cal .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
.pt-cal .dow{font-size:9px;color:var(--pt-mut);text-align:center;font-weight:800;padding:3px 0}
.pt-cal .cell{aspect-ratio:1;border-radius:10px;background:#0f1218;border:1px solid #171c26;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;font-weight:700}
.pt-cal .cell small{font-size:8px;font-weight:800;margin-top:1px}
.pt-cal .cell.pos{background:rgba(22,199,132,.14);border-color:rgba(22,199,132,.4);color:var(--pt-green)}
.pt-cal .cell.neg{background:rgba(234,57,67,.13);border-color:rgba(234,57,67,.4);color:var(--pt-red)}
.pt-cal .cell.today{outline:2px solid var(--pt-blue);outline-offset:-2px}
.pt-cal .tot{margin-top:10px;font-size:12px;font-weight:800}
.pt-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
.pt-table th{color:var(--pt-mut);font-size:9px;text-transform:uppercase;letter-spacing:.6px;text-align:left;padding:5px 6px;border-bottom:1px solid var(--pt-line)}
.pt-table td{padding:6px;border-bottom:1px solid #12161e;font-weight:700}
.pt-manual{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0}
.pt-manual input,.pt-manual select{flex:1;min-width:90px}
/* bottom nav */
#pt-nav{position:fixed;left:0;right:0;bottom:0;z-index:9000;display:flex;background:rgba(2,3,6,.92);backdrop-filter:blur(16px);border-top:1px solid #12161e;padding:6px 4px calc(8px + env(safe-area-inset-bottom))}
#pt-nav .it{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:none;color:var(--pt-mut);cursor:pointer;padding:2px 0}
#pt-nav .ic{padding:5px 18px;border-radius:999px;transition:.18s}
#pt-nav .it.on{color:#fff}
#pt-nav .it.on .ic{background:#1b202b}
#pt-nav .lb{font-size:10px;font-weight:700}
#pt-nav svg{width:21px;height:21px;display:block}
.pt-toast{position:fixed;bottom:104px;left:50%;transform:translateX(-50%);background:#12151c;border:1px solid #2a3140;color:#fff;font-size:12px;font-weight:700;padding:10px 16px;border-radius:12px;z-index:9999;opacity:0;transition:.25s;pointer-events:none}
.pt-toast.show{opacity:1}
@media(min-width:760px){#pt-assets{grid-template-columns:repeat(2,1fr)}#pt-nav{max-width:560px;left:50%;transform:translateX(-50%);border-radius:20px 20px 0 0}}
`;

/* ---------- icons ---------- */
const IC = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V21h-6v-6h-6v6H3z"/></svg>',
  signal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 4v3M6 17v3M12 2v4M12 14v4M18 6v3M18 19v2"/><rect x="4" y="7" width="4" height="10" rx="1"/><rect x="10" y="6" width="4" height="8" rx="1"/><rect x="16" y="9" width="4" height="10" rx="1"/></svg>',
  vision: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V4M9 4h6"/><circle cx="9.5" cy="13" r="1" fill="currentColor"/><circle cx="14.5" cy="13" r="1" fill="currentColor"/><path d="M9.5 16.5h5"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>'
};
const LBL = { home: 'Home', signal: 'Signal', vision: 'Vision', bot: 'Bot', history: 'History' };

/* ---------- classification ---------- */
function tabFor(el) {
  const t = txt(el).toLowerCase(); if (!t) return null;
  if (/riwayat|history/.test(t)) return 'history';
  if (/pip/.test(t) && /pnl|📅|semua waktu|berjalan|win rate/.test(t)) return 'history';
  if (/upload|vision chart|pilih gambar|drop chart/.test(t)) return 'vision';
  if (/start scanner|autobot|scanning|auto-loop|scanner bot/.test(t)) return 'bot';
  if (/live map|smc|fvg|bos|choch|bsl/.test(t)) return 'signal';
  if (/tp1|confidence/.test(t)) return 'signal';
  if (/xauusd|btcusd|style|bias|pair/.test(t) && el.querySelector('select,button')) return 'signal';
  if (/notifikasi/.test(t)) return 'home';
  return 'home';
}
function isCardLike(el) {
  const kids = [...el.children].slice(0, 4);
  if (kids.length < 2) return true;
  let cardy = 0;
  for (const k of kids) { const cs = getComputedStyle(k); if (parseFloat(cs.borderRadius) > 8 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') cardy++; }
  return cardy < 2;
}
function place(el) {
  if (!el || el.nodeType !== 1 || el.dataset.pt || el.closest('.pt-page')) return;
  if (/^(SCRIPT|STYLE|LINK|NOSCRIPT|DIALOG)$/.test(el.tagName)) return;
  const cs = getComputedStyle(el);
  if (cs.position === 'fixed' || /toast|modal|overlay|popup/i.test(el.className + '')) return;
  const tab = tabFor(el) || 'home';
  el.classList.add(isCardLike(el) ? 'pt-block' : 'pt-group');
  pages[tab].appendChild(el); blocks[tab].push(el);
}

/* ---------- shell ---------- */
function buildShell() {
  const st = document.createElement('style'); st.id = 'pt-css'; st.dataset.pt = 1; st.textContent = CSS; document.head.appendChild(st);
  if (!$('meta[name=viewport]')) { const m = document.createElement('meta'); m.name = 'viewport'; m.content = 'width=device-width,initial-scale=1,viewport-fit=cover'; document.head.appendChild(m); }
  main.style.position = 'relative';
  for (const t of TABS) { const p = document.createElement('div'); p.className = 'pt-page'; p.id = 'pt-page-' + t; p.dataset.pt = 1; pages[t] = p; main.appendChild(p); }
  // topbar
  const tb = document.createElement('div'); tb.id = 'pt-topbar'; tb.dataset.pt = 1;
  tb.innerHTML = '<span class="brand">Alu Signal Z<span class="pro">PRO</span></span><span class="sp"></span>' +
    '<span id="pt-ws"><i></i><em id="pt-ws-t" style="font-style:normal">WS</em></span>' +
    '<button id="pt-bell">🔔</button><div id="pt-ava">Z</div>';
  document.body.appendChild(tb);
  $('#pt-bell').onclick = () => { const b = $$('button').find(x => /🔔|PUSH ID/i.test(txt(x))); if (b) b.click(); else show('home'); };
  // bottom nav
  const nv = document.createElement('nav'); nv.id = 'pt-nav'; nv.dataset.pt = 1;
  nv.innerHTML = TABS.map(t => '<button class="it" data-tab="' + t + '"><span class="ic">' + IC[t] + '</span><span class="lb">' + LBL[t] + '</span></button>').join('');
  document.body.appendChild(nv);
  $$('#pt-nav .it').forEach(b => b.onclick = () => show(b.dataset.tab));
  const toast = document.createElement('div'); toast.className = 'pt-toast'; toast.dataset.pt = 1; document.body.appendChild(toast);
  window.ptToast = m => { toast.textContent = m; toast.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => toast.classList.remove('show'), 2200); };
}
function show(tab) {
  if (!TABS.includes(tab)) tab = 'home';
  activeTab = tab; localStorage.setItem('pt_tab', tab);
  for (const t of TABS) { const on = t === tab; pages[t].classList.toggle('on', on); pages[t].toggleAttribute('inert', !on); pages[t].setAttribute('aria-hidden', String(!on)); }
  $$('#pt-nav .it').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  window.scrollTo({ top: 0 });
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
  if (tab === 'history') { ingestRows(); renderCal(); }
  if (tab === 'home') drawSparks();
}

/* ---------- HOME: ticker + assets + quick ---------- */
function buildHome() {
  const p = pages.home;
  const tk = document.createElement('div'); tk.id = 'pt-ticker'; tk.dataset.pt = 1;
  const items = '<span class="it">🥇 <b>XAUUSD</b> <span class="tk-xau">—</span> <span class="tk-xauc"></span></span>' +
    '<span class="it">₿ <b>BTCUSD</b> <span class="tk-btc">—</span> <span class="tk-btcc"></span></span>' +
    '<span class="it">📅 PnL hari ini <b class="tk-pnl">—</b></span>' +
    '<span class="it">🎯 Win rate <b class="tk-wr">—</b></span>' +
    '<span class="it">🏃 <b class="tk-run">0</b> berjalan</span>';
  tk.innerHTML = '<div class="in">' + items + items + '</div>';
  p.prepend(tk);
  const as = document.createElement('div'); as.id = 'pt-assets'; as.dataset.pt = 1;
  as.innerHTML = ['XAUUSD', 'BTCUSD'].map(s => {
    const gold = s === 'XAUUSD';
    return '<div class="pt-asset" data-s="' + s + '"><span class="lv"><i></i>LIVE</span>' +
      '<div class="nm"><i style="background:' + (gold ? '#3a2c0a;color:#ffd166' : '#3a220a;color:#f7931a') + '">' + (gold ? '🥇' : '₿') + '</i>' + (gold ? 'Gold' : 'Bitcoin') + '</div>' +
      '<div class="sy">' + s + '</div><div class="pr">—</div><div class="ch"> </div><canvas></canvas></div>';
  }).join('');
  tk.after(as);
  const q = document.createElement('div'); q.id = 'pt-quick'; q.dataset.pt = 1;
  q.innerHTML = [['tt', 'TOTAL'], ['tw', 'WIN'], ['tl', 'LOSS'], ['tr', 'WINRATE']].map(x => '<div class="pt-q"><b id="pt-q-' + x[0] + '">0</b><span>' + x[1] + '</span></div>').join('');
  as.after(q);
  const h = document.createElement('div'); h.className = 'pt-h'; h.dataset.pt = 1; h.textContent = 'Status & Akun'; q.after(h);
}
function activePair() {
  const sel = $$('select').find(s => /XAU/i.test(s.textContent) && /BTC/i.test(s.textContent));
  if (sel) return /BTC/i.test(sel.value) ? 'BTCUSD' : 'XAUUSD';
  return 'XAUUSD';
}
function readLive() {
  // 1) custom hook: window.dispatchEvent(new CustomEvent('pt-price',{detail:{symbol:'XAUUSD',price:2650.5}}))
  // 2) probe global candle arrays (best-effort, aman)
  try {
    for (const g of [window.candles, window.__candles, window.lastCandles, window.state && window.state.candles]) {
      if (Array.isArray(g) && g.length) { const c = g[g.length - 1]; const v = parseNum(c && (c.close ?? c.c ?? c[4])); if (v > 50) return { sym: activePair(), v }; }
    }
  } catch (e) {}
  // 3) mirror elemen harga live di DOM
  const els = $$('[id*=price i],[class*=price i],[id*=live i],[class*=live i]').filter(e => e.children.length === 0);
  for (const e of els) { const v = parseNum(txt(e)); if (v != null && v > 50) return { sym: activePair(), v }; }
  return null;
}
window.addEventListener('pt-price', e => { const d = e.detail || {}; const s = /BTC/i.test(d.symbol || '') ? 'BTCUSD' : 'XAUUSD'; const v = parseNum(d.price); if (v) pushPrice(s, v); });
function pushPrice(sym, v) { const f = feed[sym]; if (f.p !== v) { f.p = v; f.s.push(v); if (f.s.length > 160) f.s.shift(); } }
function drawSpark(cv, s, up) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  cv.width = w * dpr; cv.height = h * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr); c.clearRect(0, 0, w, h);
  if (s.length < 2) { c.strokeStyle = '#2a3140'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke(); return; }
  const mn = Math.min(...s), mx = Math.max(...s), r = (mx - mn) || 1, col = up ? '#16c784' : '#ea3943';
  const pts = s.map((v, i) => [i / (s.length - 1) * w, h - 4 - ((v - mn) / r) * (h - 10)]);
  c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
  c.strokeStyle = col; c.lineWidth = 1.7; c.lineJoin = 'round'; c.stroke();
  c.lineTo(w, h); c.lineTo(0, h); c.closePath();
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col + '30'); g.addColorStop(1, col + '00'); c.fillStyle = g; c.fill();
}
function drawSparks() {
  $$('#pt-assets .pt-asset').forEach(card => {
    const sym = card.dataset.s, f = feed[sym], up = f.s.length > 1 ? f.s[f.s.length - 1] >= f.s[0] : true;
    card.querySelector('.pr').textContent = f.p != null ? fmt(f.p, sym === 'XAUUSD' ? 2 : 0) : '—';
    const ch = card.querySelector('.ch');
    if (f.s.length > 1) { const pc = (f.s[f.s.length - 1] - f.s[0]) / f.s[0] * 100; ch.textContent = (pc >= 0 ? '▲ ' : '▼ ') + fmt(Math.abs(pc), 2) + '%'; ch.style.color = pc >= 0 ? 'var(--pt-green)' : 'var(--pt-red)'; }
    else { ch.textContent = 'menunggu feed…'; ch.style.color = 'var(--pt-mut)'; }
    card.querySelector('.lv').classList.toggle('on', f.p != null);
    drawSpark(card.querySelector('canvas'), f.s, up);
  });
}

/* ---------- SIGNAL: countdown, bias, berjalan, rekap ---------- */
const TFMS = { '1m': 6e4, '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5 };
function activeTF() {
  const btns = $$('#pt-page-signal button').filter(b => /^(1m|5m|15m|1H|4H)$/i.test(txt(b)));
  const on = btns.find(b => /active|selected|\bon\b/i.test(b.className + ''));
  return ((on || btns[0]) ? txt(on || btns[0]) : '1m').toLowerCase();
}
function buildSignal() {
  const row = document.createElement('div'); row.className = 'pt-chiprow'; row.dataset.pt = 1; row.id = 'pt-sigchips';
  row.innerHTML = '<span class="pt-chip pt-cd" id="pt-cd">⏱ —</span><span class="pt-chip blue" id="pt-bias">BIAS —</span>' +
    '<span class="pt-chip" id="pt-run">🏃 0 berjalan</span><span class="pt-chip green" id="pt-day">📅 —</span>';
  pages.signal.prepend(row);
  const lm = blocks.signal.find(b => /LIVE MAP/i.test(txt(b)));
  if (lm && !lm.querySelector('.pt-cd')) { const c = document.createElement('div'); c.className = 'pt-chiprow'; c.dataset.pt = 1; c.innerHTML = '<span class="pt-chip pt-cd" id="pt-cd2">⏱ —</span>'; lm.prepend(c); }
}
function sigText() { const b = blocks.signal.find(x => /TP1/i.test(txt(x))); return b ? txt(b) : ''; }
function readLevels() {
  const t = sigText(); if (!t) return null;
  const grab = lab => { const m = t.match(new RegExp(lab + '\\s*[:#]?\\s*(-?\\d[\\d.,]*)', 'i')); return m ? parseNum(m[1]) : null; };
  const live = t.match(/LIVE\s*(-?\d[\d.,]*)/i);
  const L = { ENTRY: grab('entry') || (live ? parseNum(live[1]) : null), SL: grab('SL'), TP1: grab('TP1'), TP2: grab('TP2'), TP3: grab('TP3') };
  return Object.values(L).some(v => v != null) ? L : null;
}

/* ---------- VISION: overlay Entry/SL/TP di atas chart upload ---------- */
const V = { target: null, wrap: null, cv: null, levels: null, ys: {}, scale: null, drag: null, H: 0 };
function buildVision() {
  const p = pages.vision;
  if (!p.querySelector('select') || !/scalp/i.test(p.textContent)) {
    const src = $$('#pt-page-signal select').find(s => /scalp/i.test(s.textContent));
    if (src) { const c = src.cloneNode(true); c.dataset.pt = 1; c.id = 'pt-vstyle'; c.onchange = () => { src.value = c.value; src.dispatchEvent(new Event('change', { bubbles: true })); }; const h = document.createElement('div'); h.dataset.pt = 1; h.className = 'pt-h'; h.textContent = 'Style'; p.prepend(c); p.prepend(h); }
  }
  const ctl = document.createElement('div'); ctl.className = 'pt-vctl'; ctl.dataset.pt = 1;
  ctl.innerHTML = '<button class="acc" id="pt-v-auto">⚡ Auto Gambar</button><input id="pt-v-top" placeholder="Harga tepi atas"><input id="pt-v-bot" placeholder="Harga tepi bawah"><button id="pt-v-cal">Set Skala</button><button id="pt-v-dl">⬇ Simpan PNG</button><button id="pt-v-clear">Hapus</button>';
  const hint = document.createElement('div'); hint.className = 'pt-vhint'; hint.dataset.pt = 1;
  hint.textContent = 'Garis Entry (biru), SL (merah), TP1-3 (hijau) digambar dari angka card signal. Tarik garis utk geser. Isi harga tepi atas/bawah agar presisi dgn skala chart.';
  p.prepend(hint); p.prepend(ctl);
  $('#pt-v-auto').onclick = () => { V.levels = readLevels(); V.ys = autoYs(); vDraw(); ptToast(V.levels ? 'Garis digambar ulang ✅' : 'Belum ada angka SL/TP di signal'); };
  $('#pt-v-clear').onclick = () => { V.ys = {}; vDraw(); };
  $('#pt-v-cal').onclick = () => {
    let a = parseNum($('#pt-v-top').value), b = parseNum($('#pt-v-bot').value);
    if (a == null || b == null) return ptToast('Isi kedua harga tepi dulu');
    if (a < b) [a, b] = [b, a];
    const pr = capturePrices(); V.scale = { top: a, bot: b };
    for (const k in pr) if (pr[k] != null) V.ys[k] = priceToY(pr[k]);
    vDraw(); ptToast('Skala dikalibrasi ✅');
  };
  $('#pt-v-dl').onclick = vDownload;
  setInterval(vScan, 900);
  const sigBlock = blocks.signal.find(x => /TP1/i.test(txt(x)));
  if (sigBlock) new MutationObserver(() => { clearTimeout(V._t); V._t = setTimeout(() => { const L = readLevels(); if (L && JSON.stringify(L) !== JSON.stringify(V.levels)) { V.levels = L; V.ys = autoYs(); vDraw(); } }, 350); }).observe(sigBlock, { childList: true, subtree: true, characterData: true });
}
function vScan() {
  const p = pages.vision;
  const imgs = $$('img,canvas', p).filter(e => !e.classList.contains('pt-voverlay') && e.getBoundingClientRect().width > 180);
  imgs.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
  const t = imgs[0]; if (!t || t === V.target) return;
  V.target = t;
  const wrap = document.createElement('div'); wrap.className = 'pt-vwrap'; wrap.dataset.pt = 1;
  t.replaceWith(wrap); wrap.appendChild(t);
  const cv = document.createElement('canvas'); cv.className = 'pt-voverlay'; wrap.appendChild(cv); V.wrap = wrap; V.cv = cv;
  V.levels = readLevels();
  new ResizeObserver(() => { const r = t.getBoundingClientRect(); if (!r.height) return; const dpr = devicePixelRatio || 1; const old = V.H || r.height; V.H = r.height; cv.width = r.width * dpr; cv.height = r.height * dpr; for (const k in V.ys) V.ys[k] *= r.height / old; if (!Object.keys(V.ys).length) V.ys = autoYs(); vDraw(); }).observe(t);
  cv.addEventListener('pointerdown', e => { const y = e.clientY - cv.getBoundingClientRect().top; let best = null, bd = 14; for (const k in V.ys) { const d = Math.abs(V.ys[k] - y); if (d < bd) { bd = d; best = k; } } if (best) { V.drag = best; cv.setPointerCapture(e.pointerId); } });
  cv.addEventListener('pointermove', e => { if (!V.drag) return; V.ys[V.drag] = Math.max(6, Math.min(V.H - 6, e.clientY - cv.getBoundingClientRect().top)); vDraw(); });
  cv.addEventListener('pointerup', () => V.drag = null);
}
function vRange() {
  if (V.scale) return { max: V.scale.top, min: V.scale.bot };
  const vals = Object.values(V.levels || {}).filter(v => v != null);
  if (!vals.length) return null;
  let mn = Math.min(...vals), mx = Math.max(...vals); const padv = (mx - mn) * .2 || mx * .002;
  return { max: mx + padv, min: mn - padv };
}
function priceToY(p) { const r = vRange(); return r ? (r.max - p) / (r.max - r.min) * V.H : V.H / 2; }
function yToPrice(y) { const r = vRange(); return r ? r.max - (y / V.H) * (r.max - r.min) : null; }
function autoYs() { const ys = {}; if (V.levels && V.H) for (const k in V.levels) if (V.levels[k] != null) ys[k] = priceToY(V.levels[k]); return ys; }
function capturePrices() { const o = {}; for (const k in V.ys) o[k] = yToPrice(V.ys[k]); return o; }
function vDrawTo(c, W, H, ys) {
  c.clearRect(0, 0, W, H);
  if (!Object.keys(ys).length) { c.font = '600 12px system-ui'; c.fillStyle = 'rgba(232,234,240,.75)'; c.fillText('Menunggu angka Entry/SL/TP dari tab Signal…', 10, 20); return; }
  const col = { ENTRY: '#2f7bff', SL: '#ea3943', TP1: '#16c784', TP2: '#16c784', TP3: '#16c784' };
  if (ys.ENTRY != null && ys.SL != null) { c.fillStyle = 'rgba(234,57,67,.12)'; c.fillRect(0, Math.min(ys.ENTRY, ys.SL), W, Math.abs(ys.ENTRY - ys.SL)); }
  if (ys.ENTRY != null && ys.TP1 != null) { c.fillStyle = 'rgba(22,199,132,.10)'; c.fillRect(0, Math.min(ys.ENTRY, ys.TP1), W, Math.abs(ys.ENTRY - ys.TP1)); }
  const r = vRange(); const pr = y => r ? r.max - (y / H) * (r.max - r.min) : null;
  for (const k of ['SL', 'TP3', 'TP2', 'TP1', 'ENTRY']) {
    const y = ys[k]; if (y == null) continue;
    c.strokeStyle = col[k]; c.lineWidth = k === 'ENTRY' ? 2.2 : 1.6; c.setLineDash(k === 'ENTRY' ? [] : k === 'SL' ? [7, 4] : [3, 4]);
    c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); c.setLineDash([]);
    const p = pr(y), label = k + '  ' + (p != null ? fmt(p, p > 5000 ? 0 : 2) : '');
    c.font = '700 11px system-ui'; const tw = c.measureText(label).width;
    c.fillStyle = 'rgba(0,0,0,.78)'; c.fillRect(W - tw - 18, y - 9, tw + 12, 18);
    c.strokeStyle = col[k]; c.lineWidth = 1; c.strokeRect(W - tw - 18, y - 9, tw + 12, 18);
    c.fillStyle = col[k]; c.fillText(label, W - tw - 12, y + 4);
  }
}
function vDraw() { if (!V.cv || !V.H) return; const dpr = devicePixelRatio || 1, c = V.cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); vDrawTo(c, V.cv.width / dpr, V.H, V.ys); }
function vDownload() {
  if (!V.target) return ptToast('Upload chart dulu di Vision');
  const t = V.target, W = t.naturalWidth || t.width, H = t.naturalHeight || t.height;
  const out = document.createElement('canvas'); out.width = W; out.height = H; const c = out.getContext('2d');
  try { c.drawImage(t, 0, 0, W, H); } catch (e) { return ptToast('Gambar tidak bisa di-copy'); }
  const f = H / (V.H || H), ys = {}; for (const k in V.ys) ys[k] = V.ys[k] * f;
  const keep = V.H; V.H = H; vDrawTo(c, W, H, ys); V.H = keep;
  const a = document.createElement('a'); a.download = 'alu-vision-marked.png'; a.href = out.toDataURL('image/png'); a.click();
  ptToast('PNG tersimpan ✅');
}

/* ---------- HISTORY: store, kalender, rekap pair, manual ---------- */
const KEY = 'pt_pnl_v1';
let store = { days: {}, pairs: {}, hashes: [], rows: [] };
try { store = Object.assign(store, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }
let calMonth = new Date(); calMonth.setDate(1);
function buildHistory() {
  const p = pages.history;
  const cal = document.createElement('div'); cal.className = 'pt-cal'; cal.dataset.pt = 1; cal.id = 'pt-cal';
  p.prepend(cal);
  const man = document.createElement('div'); man.className = 'pt-block'; man.dataset.pt = 1;
  man.innerHTML = '<div class="pt-h">＋ Catat Trade Manual</div><div class="pt-manual">' +
    '<input type="date" id="pt-m-date"><select id="pt-m-pair"><option>XAUUSD</option><option>BTCUSD</option><option>LAIN</option></select>' +
    '<input type="number" step="0.1" id="pt-m-pip" placeholder="pip (+/-)"><select id="pt-m-res"><option value="w">WIN</option><option value="l">LOSS</option></select>' +
    '<button class="pt-primary" id="pt-m-save" style="padding:9px 16px">SIMPAN</button></div><div id="pt-m-list"></div>';
  cal.after(man);
  $('#pt-m-date').value = iso(new Date());
  $('#pt-m-save').onclick = () => {
    const d = $('#pt-m-date').value || iso(new Date()), pip = parseNum($('#pt-m-pip').value) || 0, pair = $('#pt-m-pair').value, w = $('#pt-m-res').value === 'w' ? 1 : 0;
    addTrade(d, pair, pip, w, 1 - w, true); renderCal(); renderManual(); ptToast('Trade manual dicatat ✅');
  };
  renderManual(); renderCal();
}
function addTrade(d, pair, pip, w, l, manual) {
  const day = store.days[d] || (store.days[d] = { pip: 0, w: 0, l: 0 });
  day.pip += pip; day.w += w; day.l += l;
  const pr = store.pairs[pair] || (store.pairs[pair] = { pip: 0, w: 0, l: 0, n: 0 });
  pr.pip += pip; pr.w += w; pr.l += l; pr.n++;
  if (manual) { store.rows.unshift({ d, pair, pip, w, l }); store.rows = store.rows.slice(0, 60); }
  save();
}
function ingestRows() {
  const p = pages.history;
  $$('li,tr,[class*=item],[class*=row]', p).forEach(r => {
    if (r.closest('[data-pt]')) return;
    const t = txt(r); if (t.length < 12 || t.length > 300) return;
    const h = t.slice(0, 120); if (store.hashes.includes(h)) return;
    let d = null; const now = new Date();
    let m = t.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) d = m[0];
    if (!d) { m = t.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/); if (m) { let y = m[3] ? +m[3] : now.getFullYear(); if (y < 100) y += 2000; d = y + '-' + pad(+m[2]) + '-' + pad(+m[1]); } }
    if (!d) { m = t.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|Mei|May|Jun|Jul|Agu|Aug|Sep|Okt|Oct|Nov|Des|Dec)/i); if (m) { const ms = ['jan','feb','mar','apr','mei','jun','jul','agu','sep','okt','nov','des']; let mi = ms.findIndex(x => m[2].toLowerCase().startsWith(x)); if (mi === 4) mi = 4; if (mi >= 0) d = now.getFullYear() + '-' + pad(mi + 1) + '-' + pad(+m[1]); } }
    if (!d) d = iso(now);
    const pm = t.match(/([+-]\d+(?:[.,]\d+)?)\s*pip/i) || t.match(/([+-]\d+(?:[.,]\d+)?)/);
    const pip = pm ? parseNum(pm[1]) || 0 : 0;
    const w = /win|✅|tp\s*hit|profit/i.test(t) ? 1 : 0, l = /loss|❌|sl\s*hit|lose/i.test(t) ? 1 : 0;
    const pair = /btc/i.test(t) ? 'BTCUSD' : /xau|gold/i.test(t) ? 'XAUUSD' : 'LAIN';
    store.hashes.push(h); if (store.hashes.length > 600) store.hashes.shift();
    addTrade(d, pair, pip, w, l, false);
  });
}
function renderManual() {
  const el = $('#pt-m-list'); if (!el) return;
  el.innerHTML = store.rows.length ? '<table class="pt-table"><tr><th>Tgl</th><th>Pair</th><th>Pip</th><th>Hasil</th></tr>' +
    store.rows.slice(0, 12).map(r => '<tr><td>' + r.d + '</td><td>' + r.pair + '</td><td style="color:' + (r.pip >= 0 ? 'var(--pt-green)' : 'var(--pt-red)') + '">' + (r.pip >= 0 ? '+' : '') + fmt(r.pip, 1) + '</td><td>' + (r.w ? '✅' : '❌') + '</td></tr>').join('') + '</table>' : '<div class="pt-vhint">Belum ada trade manual.</div>';
}
function renderCal() {
  const el = $('#pt-cal'); if (!el) return;
  const y = calMonth.getFullYear(), mo = calMonth.getMonth();
  const first = new Date(y, mo, 1), start = (first.getDay() + 6) % 7, days = new Date(y, mo + 1, 0).getDate(), today = iso(new Date());
  let tot = 0, cells = '';
  for (let i = 0; i < start; i++) cells += '<div></div>';
  for (let d = 1; d <= days; d++) {
    const k = y + '-' + pad(mo + 1) + '-' + pad(d), v = store.days[k];
    if (v) tot += v.pip;
    const cls = v ? (v.pip > 0 ? 'pos' : v.pip < 0 ? 'neg' : '') : '';
    cells += '<div class="cell ' + cls + (k === today ? ' today' : '') + '" title="' + (v ? v.w + 'W/' + v.l + 'L' : '') + '">' + d + (v ? '<small>' + (v.pip >= 0 ? '+' : '') + fmt(v.pip, 0) + '</small>' : '') + '</div>';
  }
  const pairs = Object.entries(store.pairs);
  el.innerHTML = '<div class="hd"><button id="pt-cal-p">‹</button><b>' + first.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) + '</b><button id="pt-cal-n">›</button></div>' +
    '<div class="grid">' + ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(d => '<div class="dow">' + d + '</div>').join('') + cells + '</div>' +
    '<div class="tot" style="color:' + (tot >= 0 ? 'var(--pt-green)' : 'var(--pt-red)') + '">Total bulan ini: ' + (tot >= 0 ? '+' : '') + fmt(tot, 1) + ' pip</div>' +
    (pairs.length ? '<table class="pt-table"><tr><th>Pair</th><th>Trade</th><th>W/L</th><th>Pip</th></tr>' + pairs.map(([p, v]) => '<tr><td>' + p + '</td><td>' + v.n + '</td><td>' + v.w + '/' + v.l + '</td><td style="color:' + (v.pip >= 0 ? 'var(--pt-green)' : 'var(--pt-red)') + '">' + (v.pip >= 0 ? '+' : '') + fmt(v.pip, 1) + '</td></tr>').join('') + '</table>' : '');
  $('#pt-cal-p').onclick = () => { calMonth.setMonth(mo - 1); renderCal(); };
  $('#pt-cal-n').onclick = () => { calMonth.setMonth(mo + 1); renderCal(); };
}

/* ---------- mirrors loop ---------- */
function mirror() {
  // feed
  const r = readLive(); if (r) pushPrice(r.sym, r.v);
  for (const s of ['XAUUSD', 'BTCUSD']) {
    const f = feed[s], pre = s === 'XAUUSD' ? 'xau' : 'btc';
    $$('.tk-' + pre).forEach(e => e.textContent = f.p != null ? fmt(f.p, s === 'XAUUSD' ? 2 : 0) : '—');
    $$('.tk-' + pre + 'c').forEach(e => { if (f.s.length > 1) { const pc = (f.p - f.s[0]) / f.s[0] * 100; e.textContent = (pc >= 0 ? '▲' : '▼') + fmt(Math.abs(pc), 2) + '%'; e.className = 'tk-' + pre + 'c ' + (pc >= 0 ? 'up' : 'dn'); } });
  }
  if (activeTab === 'home') drawSparks();
  // WS + bell
  const ws = ref('ws', () => $$('span,div,b,em,small').filter(e => e.children.length === 0 && /WS:/i.test(txt(e)))[0]);
  if (ws) { const on = /ON/i.test(txt(ws)); $('#pt-ws').classList.toggle('on', on); $('#pt-ws-t').textContent = on ? 'WS ON' : 'WS OFF'; }
  // bot totals → quick stats + ticker
  const bt = ref('bt', () => findAnchor(/Total Scanner Trade/i));
  if (bt) { const m = txt(bt).match(/Trade:\s*(\d+).*?Win:\s*(\d+).*?Loss:\s*(\d+)/i); if (m) { const t = +m[1], w = +m[2], l = +m[3]; const set = (id, v) => { const e = $('#' + id); if (e) e.textContent = v; }; set('pt-q-tt', t); set('pt-q-tw', w); set('pt-q-tl', l); set('pt-q-tr', (w + l) ? Math.round(w / (w + l) * 100) + '%' : '0%'); $$('.tk-wr').forEach(e => e.textContent = (w + l) ? Math.round(w / (w + l) * 100) + '%' : '0%'); } }
  // berjalan + daily pnl
  const run = ref('run', () => $$('span,div,b,small').filter(e => e.children.length === 0 && /berjalan/i.test(txt(e)))[0]);
  const rn = run ? (txt(run).match(/(\d+)/) || [0, 0])[1] : 0;
  const runE = $('#pt-run'); if (runE) runE.textContent = '🏃 ' + rn + ' berjalan';
  $$('.tk-run').forEach(e => e.textContent = rn);
  const day = ref('day', () => findAnchor(/📅/));
  let dayPip = null;
  if (day) { const t = txt(day.parentElement || day); const m = t.match(/([+-]\d+(?:[.,]\d+)?)\s*pip/i); if (m) dayPip = parseNum(m[1]); const wl = t.match(/(\d+)W\s*\/\s*(\d+)L/i); if (dayPip != null) { const k = iso(new Date()); store.days[k] = { pip: dayPip, w: wl ? +wl[1] : 0, l: wl ? +wl[2] : 0 }; } }
  const de = $('#pt-day'); if (de) { de.textContent = '📅 ' + (dayPip != null ? (dayPip >= 0 ? '+' : '') + fmt(dayPip, 1) + ' pip' : '—'); de.className = 'pt-chip ' + (dayPip >= 0 ? 'green' : 'red'); }
  $$('.tk-pnl').forEach(e => e.textContent = dayPip != null ? (dayPip >= 0 ? '+' : '') + fmt(dayPip, 1) + ' pip' : '—');
  // bias dari card signal
  const st = sigText(), be = $('#pt-bias');
  if (be) { const buy = /\bBUY\b/i.test(st), sell = /\bSELL\b/i.test(st); be.textContent = 'BIAS ' + (buy ? '🟢 BULLISH' : sell ? '🔴 BEARISH' : '—'); be.className = 'pt-chip ' + (buy ? 'green' : sell ? 'red' : 'blue'); }
  // countdown candle
  const tf = activeTF(), ms = TFMS[tf] || 6e4, rem = ms - (Date.now() % ms);
  const hh = Math.floor(rem / 36e5), mm = Math.floor(rem % 36e5 / 6e4), ss = Math.floor(rem % 6e4 / 1e3);
  const cd = '⏱ ' + tf.toUpperCase() + ' ' + (hh ? hh + ':' : '') + pad(mm) + ':' + pad(ss);
  const c1 = $('#pt-cd'), c2 = $('#pt-cd2'); if (c1) c1.textContent = cd; if (c2) c2.textContent = cd;
}

/* ---------- init ---------- */
function init() {
  try {
    const anchors = [findAnchor(/START SCANNER/i), findAnchor(/LIVE MAP/i), findAnchor(/RIWAYAT/i), findAnchor(/Vision Chart|Upload/i)].filter(Boolean);
    if (anchors.length < 2) { console.warn('[pintu-ui] anchor kurang, batal (UI asli dipertahankan)'); return; }
    main = anchors.reduce((a, b) => lca(a, b));
    while (main !== document.body && main.children.length < 3) {
      const kids = [...main.children].filter(e => e.nodeType === 1);
      const next = kids.find(k => anchors.some(a => k.contains(a))); if (!next) break; main = next;
    }
    buildShell();
    [...main.children].forEach(el => { if (!el.dataset.pt) place(el); });
    buildHome(); buildSignal(); buildVision(); buildHistory();
    // primary buttons
    $$('button', main).forEach(b => { if (/START SCANNER|SIMPAN|TAMBAH NOTIF/i.test(txt(b))) b.classList.add('pt-primary'); });
    // node baru dari fix lain → tetap diklasifikasi
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && n.parentElement === main && !n.dataset.pt) place(n); }))).observe(main, { childList: true });
    show(activeTab);
    setInterval(mirror, 1000);
    setInterval(() => { if (activeTab === 'history') { ingestRows(); renderCal(); save(); } }, 6000);
    window.PT_UI = { show, feed, push: pushPrice, store };
    console.log('[pintu-ui] aktif ✅ tab:', activeTab);
  } catch (e) { console.warn('[pintu-ui] gagal, UI asli dipertahankan:', e); }
}
// tunggu fix lain selesai build DOM (poll anchor, maks 25 detik)
let tries = 0;
const boot = setInterval(() => {
  tries++;
  const ready = findAnchor(/START SCANNER/i) && (findAnchor(/RIWAYAT/i) || findAnchor(/LIVE MAP/i));
  if (ready || tries > 50) { clearInterval(boot); setTimeout(init, 600); }
}, 500);
})();
