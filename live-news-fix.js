// live-news-fix.js — blok "Berita" (gaya Jelajah > Berita) di Home & Signal. Tanpa edit index.html.
// Data: POST /api/candles { mode:'news' }. Judul & sumber di-escape; link dibuka di tab baru.
(function () {
  const SOURCES = ['Semua', 'CoinDesk', 'Cointelegraph', 'Decrypt'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => (/^https?:\/\//.test(String(u || '')) ? String(u) : '#');

  function buildNewsHtml(items, active, expanded) {
    const list = (items || []).filter(x => active === 'Semua' || x.src === active).slice(0, expanded ? 20 : 6);
    const pills = SOURCES.map(s => `<button data-src="${esc(s)}" style="padding:6px 14px;border-radius:999px;border:1px solid ${s === active ? '#3b82f6' : '#334155'};background:${s === active ? '#0b2a4a' : 'transparent'};color:${s === active ? '#93c5fd' : '#94a3b8'};font-size:12px;margin-right:8px;white-space:nowrap">${esc(s)}</button>`).join('');
    const cards = list.map(x => `
      <a href="${esc(safeUrl(x.link))}" target="_blank" rel="noopener" style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #1e293b;text-decoration:none;color:inherit">
        ${x.img ? `<img src="${esc(safeUrl(x.img))}" alt="" loading="lazy" style="width:88px;height:64px;object-fit:cover;border-radius:10px;flex:0 0 88px">` : `<div style="width:88px;height:64px;border-radius:10px;background:#1e293b;flex:0 0 88px"></div>`}
        <div style="min-width:0"><div style="font-weight:600;font-size:14px;line-height:1.3;color:#f1f5f9;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(x.title)}</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:6px">${esc(x.src)} • ${esc(x.ago || '')}</div></div>
      </a>`).join('');
    return `<div id="alu-news" style="margin:14px 0;padding:16px;border-radius:16px;background:#0f172a;border:1px solid #1e293b">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-weight:700;font-size:16px;color:#f1f5f9">Berita Pasar</div>
        <div style="font-size:12px;color:#64748b">update otomatis</div></div>
      <div style="display:flex;overflow-x:auto;margin-bottom:6px">${pills}</div>
      ${cards || '<div style="padding:16px 0;color:#64748b;font-size:13px">Belum ada berita.</div>'}
      <button id="alu-news-more" style="width:100%;margin-top:10px;padding:10px;border-radius:10px;border:1px solid #334155;background:transparent;color:#93c5fd;font-size:13px">${expanded ? 'Tutup' : 'Lihat semua'}</button>
    </div>`;
  }

  let state = { items: [], active: 'Semua', expanded: false, at: 0 };

  async function load(force) {
    if (!force && Date.now() - state.at < 300000 && state.items.length) return;
    const email = (typeof K !== 'undefined' && localStorage.getItem(K.email)) || '';
    if (!email) return;
    try {
      const r = await post('/api/candles', { value: email, email: email, mode: 'news', limit: 20 });
      if (r && r.ok && r.data && Array.isArray(r.data.items)) { state.items = r.data.items; state.at = Date.now(); }
    } catch (e) {}
    render();
  }

  function render() {
    let box = document.getElementById('alu-news');
    if (!box) {
      const anchor = [...document.querySelectorAll('button')].find(b => /Analisa Signal/i.test(b.textContent || ''));
      if (!anchor) return;
      const wrap = document.createElement('div');
      anchor.parentNode.insertBefore(wrap, anchor);
      box = wrap;
    }
    const holder = box.id === 'alu-news' ? box.parentNode : box;
    const html = buildNewsHtml(state.items, state.active, state.expanded);
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const node = tmp.firstElementChild;
    if (box.id === 'alu-news') box.replaceWith(node); else box.replaceWith(node);
    node.addEventListener('click', e => {
      const pill = e.target.closest('[data-src]');
      if (pill) { state.active = pill.getAttribute('data-src'); render(); return; }
      if (e.target.id === 'alu-news-more') { state.expanded = !state.expanded; render(); }
    });
  }

  window.__aluNews = { buildNewsHtml, SOURCES };
  window.addEventListener('load', () => { setTimeout(() => { load(true); setInterval(() => load(false), 60000); }, 1500); });
})();
