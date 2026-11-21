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
      hits: {}, expiresAt: sg.expiresAt,
      card: { reason: text, reasons: { id: text, en: text }, reasonLang: lang },
    });
    ensureStyleSelect();
    refreshCard();
    setTxt('cardSub', label(visionTrade));
  };

  // Jaga label & pilihan gaya tetap tampil (refreshCard menulis ulang setiap detik)
  setInterval(() => {
    ensureStyleSelect();
    if (typeof market !== 'undefined' && market === 'VISION' && visionTrade && visionTrade.vision) {
      setTxt('cardSub', label(visionTrade));
    }
  }, 1000);
})();
