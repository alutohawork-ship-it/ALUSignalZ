// vision-fix.js — mode Vision: gaya sendiri (terpisah dari Manual), reasoning & nama pair tampil, label jelas.
// Dimuat lewat middleware.js (tanpa edit index.html).
(function () {
  const origGen = window.generateSignal;
  const KEY = 'aluVisionStyle_v1';
  const STYLES = ['Scalping', 'Intraday', 'Swing'];
  window.visionStyle = localStorage.getItem(KEY) || 'Scalping';

  function ensureStyleSelect() {
    const panel = document.getElementById('visionPanel');
    if (!panel || document.getElementById('visionStyleSel')) return;
    const wrap = document.createElement('div');
    wrap.id = 'visionStyleWrap';
    wrap.className = 'space-y-1';
    wrap.innerHTML = '<p class="text-[9px] font-bold text-gray-400">GAYA VISION (terpisah dari Manual)</p>' +
      '<select id="visionStyleSel" class="w-full bg-darkbg border border-panelborder text-xs font-bold text-white p-2 rounded-lg focus:outline-none">' +
      STYLES.map(s => '<option value="' + s + '">' + s + '</option>').join('') + '</select>';
    panel.insertBefore(wrap, panel.firstChild);
    const sel = document.getElementById('visionStyleSel');
    sel.value = window.visionStyle;
    sel.addEventListener('change', () => { window.visionStyle = sel.value; localStorage.setItem(KEY, sel.value); });
  }

  function label(t) {
    const sym = t.symbolLabel || 'CHART';
    return 'VISION · ' + sym + ' · ' + (t.style || '') + ' · ' + (t.orderType || '');
  }

  window.generateSignal = async function () {
    if (typeof market === 'undefined' || market !== 'VISION') return origGen.apply(this, arguments);
    if (!visionImages.length) return alert('Silakan upload gambar chart terlebih dahulu.');
    const email = localStorage.getItem(K.email);
    if (!email) return alert('Sesi berakhir.');
    const btn = $('signalBtn');
    btn.disabled = true;
    setTxt('btnText', T('btnGenBusy'));
    await runValidationSteps();
    const style = window.visionStyle || 'Scalping';
    let r;
    try {
      r = await post('/api/generate', { value: email, email, symbol: 'VISION', mode: 'vision', images: visionImages, style, lang });
    } finally {
      btn.disabled = false;
      setTxt('btnText', T('btnGenVision'));
    }
    if (!r.ok || !r.data || !r.data.ok) return alert(errOf(r, 'Analisis vision gagal.'));
    const sg = r.data.signal;
    const dec = Number.isInteger(sg.dec) ? sg.dec : 2;
    const pip = Number(sg.pip) > 0 ? Number(sg.pip) : Math.pow(10, -dec) * 10;
    const text = String(sg.reason || '').trim();
    visionTrade = Object.assign({}, sg, {
      key: 'VISION', vision: true, symbolLabel: sg.symbol || 'CHART', dec, pip, style,
      dir: sg.signal === 'BUY' ? 1 : -1,
      hits: {}, expiresAt: sg.expiresAt,
      card: { reason: text, reasons: { id: text, en: text }, reasonLang: lang },
    });
    window.visionDone = true;
    ensureStyleSelect();
    refreshCard();
    setTxt('cardSub', label(visionTrade));
  };

  const origUpload = window.handleImageUpload;
  if (typeof origUpload === 'function') {
    window.handleImageUpload = function () {
      if (window.visionDone) { visionImages.length = 0; window.visionDone = false; try { renderVisionPreview(); } catch (e) {} }
      return origUpload.apply(this, arguments);
    };
  }
  function ensureClearBtn() {
    const wrap = document.getElementById('visionStyleWrap');
    if (!wrap || document.getElementById('visionClearBtn')) return;
    const b = document.createElement('button');
    b.id = 'visionClearBtn';
    b.textContent = 'Kosongkan semua gambar';
    b.className = 'w-full text-[10px] font-bold py-1 rounded border border-panelborder text-gray-400 hover:text-red-400';
    b.onclick = () => { visionImages.length = 0; window.visionDone = false; try { renderVisionPreview(); } catch (e) {} };
    wrap.appendChild(b);
  }

  // Jaga label & pilihan gaya tetap tampil (refreshCard menulis ulang setiap detik)
  setInterval(() => {
    ensureStyleSelect();
    ensureClearBtn();
    // Sembunyikan elemen manual saat mode Vision (gaya manual, tombol hapus manual, pesan standby manual)
    const isV = typeof market !== 'undefined' && market === 'VISION';
    const manualBits = ['styleContainer', 'btnDelSig'];
    manualBits.forEach(id => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', isV || (window.__vHid && window.__vHid[id] && false)); });
    const sv = document.getElementById('standbyView');
    if (sv && isV && !(visionTrade && visionTrade.vision)) sv.classList.add('hidden');
    if (isV) { window.__vWasV = true; }
    else if (window.__vWasV) { window.__vWasV = false; const sc = document.getElementById('styleContainer'); if (sc && !(typeof isBotView === 'function' && isBotView())) sc.classList.remove('hidden'); }
    if (typeof market !== 'undefined' && market === 'VISION' && visionTrade && visionTrade.vision) {
      setTxt('cardSub', label(visionTrade));
    }
  }, 1000);
})();
