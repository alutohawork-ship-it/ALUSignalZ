// livemap-fix.js — LIVE MAP: mode CANDLE / LINE / TICK (tick dinamis), tanpa indikator, tanpa TP4 & TP5.
// Mode fokus saat posisi terisi: zoom ke sekitar entry. Tanpa edit index.html.
(function () {
  const MULTS_TP = ['tp1', 'tp2', 'tp3'];
  const is5 = t => !!t && t.style === 'Scalping' && (t.key === 'XAUUSD' || t.key === 'BTCUSD') && t.src !== 'bot' && !/CRT/.test(String(t.setup || ''));
  const TICK_MS = 10 * 60e3; // selaras dengan HISTORY_MS di index

  // Sembunyikan indikator: tombol FVG/OB/BSL/BOS/SMA dimatikan; tambah tombol TICK di baris tipe chart
  function fixToolbar() {
    document.querySelectorAll('[data-live-ind]').forEach(b => { b.style.display = 'none'; });
    const line = document.querySelector('[data-live-type="line"]');
    if (line && !document.querySelector('[data-live-type="tick"]')) {
      const b = line.cloneNode(true);
      b.dataset.liveType = 'tick';
      b.textContent = 'TICK';
      b.setAttribute('onclick', "setLiveType('tick')");
      line.parentNode.insertBefore(b, line.nextSibling);
    }
  }
  setInterval(fixToolbar, 1000);

  window.drawLiveMap = function drawLiveMap(cv, cx, t, k) {
    if (!cx) return;
    syncLiveBtns();
    const d = fitCv(cv, cx);
    if (!d) return;
    const CW = d.w, CH = d.h;
    const iv = '1m';
    const tfMs = TF_MIN[iv] * 60000;
    const allRows = displayRows(k, iv);
    const live = prices[k] ? prices[k].price : null;
    const liveDir = prices[k] ? prices[k].dir : 0;
    const plotL = 6, plotT = 20, plotB = CH - 14, plotR = CW - CHART_GUT;
    const plotH = plotB - plotT;
    const mode = (typeof LIVE_TYPE !== 'undefined' ? LIVE_TYPE : 'candle');

    cx.font = '8px ui-monospace, monospace';
    cx.textAlign = 'left';
    cx.textBaseline = 'top';
    cx.fillStyle = 'rgba(148,163,184,.9)';
    cx.fillText(srcLabel(k, iv) + ' · ' + mode.toUpperCase(), plotL + 2, 3);

    const ticks = (hist[k] || []).slice();
    if (!allRows.length && live == null && !ticks.length) {
      cx.font = 'bold 11px ui-monospace, monospace';
      cx.fillStyle = '#94a3b8';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText(T('waitTick'), CW / 2, CH / 2);
      cx.textAlign = 'left';
      return;
    }

    const showLv = !!t && t.status !== 'CLOSED';
    const focus = !!t && t.status !== 'CLOSED' && t.status !== 'PENDING' && !!t.filledAt;
    const now = Date.now();

    // Level yang digambar: ENTRY, SL, TP1-3 (TP4 & TP5 tidak digambar)
    const L = showLv ? [
      { label: 'ENTRY', main: true, v: t.entry, c: '#93c5fd', bg: 'rgba(147,197,253,.14)', dash: [] },
      { label: slLabel(t), v: effSL(t), c: '#f87171', bg: 'rgba(248,113,113,.14)', dash: [4, 4], hit: t.result === 'SL' },
      { label: 'TP1', v: t.tp1, c: '#34d399', bg: 'rgba(52,211,153,.14)', dash: [4, 4], hit: !!(t.hits && t.hits.tp1) },
      { label: 'TP2', v: t.tp2, c: '#34d399', bg: 'rgba(52,211,153,.14)', dash: [4, 4], hit: !!(t.hits && t.hits.tp2) },
      { label: 'TP3', v: t.tp3, c: '#38bdf8', bg: 'rgba(56,189,248,.14)', dash: [4, 4], hit: !!(t.hits && t.hits.tp3) },
    ].filter(l => Number.isFinite(l.v)) : [];

    // Jendela waktu untuk tick: sejak entry (fokus) atau 10 menit terakhir
    const tStart = focus ? Math.floor(t.filledAt / 60000) * 60000 - 60000 : now - TICK_MS;
    const tickView = ticks.filter(x => x.t >= tStart);

    // Candle/line: 80 candle terakhir, fokus ke entry bila posisi terisi
    let rows = focus ? liveViewRows(allRows, t).slice(-80) : allRows;
    const { vis, slot, xOfT } = layoutX(rows, plotL, plotR, tfMs);

    // Skala harga
    let lo = Infinity, hi = -Infinity;
    if (mode === 'tick') {
      tickView.forEach(x => { if (x.p < lo) lo = x.p; if (x.p > hi) hi = x.p; });
    } else {
      vis.forEach(c => { if (c.h < lo) lo = c.h; if (c.h > hi) hi = c.h; if (c.l < lo) lo = c.l; if (c.l > hi) hi = c.l; });
    }
    if (live != null) { if (live < lo) lo = live; if (live > hi) hi = live; }
    const span0 = (hi - lo) || (Math.abs(hi) * 0.001) || 1;
    const within = v => v >= lo - 1.5 * span0 && v <= hi + 1.5 * span0;
    L.forEach(l => { if (!focus || within(l.v)) { if (l.v < lo) lo = l.v; if (l.v > hi) hi = l.v; } });
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
    if (!(hi - lo > 0)) { const dd = Math.abs(hi) * 0.001 || 1; lo -= dd; hi += dd; }
    const pad = (hi - lo) * 0.12;
    lo -= pad; hi += pad;
    const yOf = p => plotT + (1 - (p - lo) / (hi - lo)) * plotH;

    // Grid
    cx.lineWidth = 1;
    cx.strokeStyle = 'rgba(148,163,184,.08)';
    for (let i = 1; i < 4; i++) {
      const y = plotT + plotH * i / 4;
      cx.beginPath(); cx.moveTo(plotL, y); cx.lineTo(plotR, y); cx.stroke();
    }

    if (mode === 'tick') {
      const xOfTime = tm => plotL + (tm - tStart) / Math.max(1, now - tStart) * (plotR - plotL);
      if (tickView.length) {
        cx.save();
        cx.strokeStyle = '#60a5fa';
        cx.lineWidth = 1.4;
        cx.beginPath();
        tickView.forEach((x, j) => {
          const px = xOfTime(x.t), py = yOf(x.p);
          if (j) cx.lineTo(px, py); else cx.moveTo(px, py);
        });
        cx.stroke();
        cx.fillStyle = 'rgba(96,165,250,.9)';
        tickView.forEach(x => { cx.beginPath(); cx.arc(xOfTime(x.t), yOf(x.p), 1.2, 0, Math.PI * 2); cx.fill(); });
        cx.restore();
      }
    } else if (mode === 'line') {
      cx.save();
      cx.strokeStyle = '#93c5fd';
      cx.lineWidth = 1.4;
      cx.beginPath();
      vis.forEach((c, j) => { const x = xOfT(c.t), y = yOf(c.c); if (j) cx.lineTo(x, y); else cx.moveTo(x, y); });
      cx.stroke();
      cx.restore();
    } else {
      const bodyW = Math.max(1.5, slot * 0.62);
      cx.lineWidth = 1;
      for (const c of vis) {
        const x = xOfT(c.t);
        if (x < plotL || x > plotR) continue;
        const up = c.c >= c.o;
        const col = up ? '#34d399' : '#f87171';
        const yH = yOf(c.h), yL = yOf(c.l), yO = yOf(c.o), yC = yOf(c.c);
        cx.strokeStyle = col;
        cx.beginPath(); cx.moveTo(x, yH); cx.lineTo(x, yL); cx.stroke();
        cx.fillStyle = col;
        cx.fillRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)));
      }
    }

    // Garis level (ENTRY, SL, TP1-3)
    L.forEach(l => {
      const y = yOf(l.v);
      cx.save();
      cx.strokeStyle = l.c;
      cx.globalAlpha = l.main ? .95 : .8;
      cx.lineWidth = l.main ? 1.4 : 1;
      cx.setLineDash(l.dash);
      const lx = (focus && t.filledAt) ? clampX(mode === 'tick' ? plotL : xOfT(Math.floor(t.filledAt / 60000) * 60000), plotL, plotR) : plotL;
      cx.beginPath(); cx.moveTo(lx, y); cx.lineTo(plotR, y); cx.stroke();
      cx.restore();
    });

    // Harga live
    if (live != null) {
      const y = yOf(live);
      const lc = liveDir < 0 ? '#f87171' : '#34d399';
      cx.save();
      cx.strokeStyle = lc; cx.globalAlpha = .6; cx.lineWidth = 1; cx.setLineDash([1, 3]);
      cx.beginPath(); cx.moveTo(plotL, y); cx.lineTo(plotR, y); cx.stroke();
      cx.restore();
    }

    // Label harga di kanan
    const tags = L.filter(l => !focus || (yOf(l.v) >= plotT - 4 && yOf(l.v) <= plotB + 4))
      .map(l => ({ text: (l.hit ? '✓ ' : '') + l.label + ' ' + fmt(l.v), c: l.c, bg: l.bg, y: yOf(l.v) }));
    if (live != null) tags.push({ text: fmt(live), c: liveDir < 0 ? '#fca5a5' : '#86efac', bg: liveDir < 0 ? 'rgba(239,68,68,.25)' : 'rgba(16,185,129,.25)', y: yOf(live) });
    tags.sort((a, b) => a.y - b.y);
    const GAP = 13, capT = plotT + 6, capB = plotB - 6;
    tags.forEach(g => { g.y = Math.max(capT, Math.min(capB, g.y)); });
    for (let i = 1; i < tags.length; i++) if (tags[i].y < tags[i - 1].y + GAP) tags[i].y = tags[i - 1].y + GAP;
    cx.font = 'bold 8px ui-monospace, monospace';
    cx.textAlign = 'left';
    cx.textBaseline = 'middle';
    for (const g of tags) {
      const x = plotR + 6, w = CHART_GUT - 12, h = 13, y = g.y - h / 2;
      rr(cx, x, y, w, h, 3);
      cx.fillStyle = g.bg; cx.fill();
      cx.strokeStyle = g.c; cx.lineWidth = .8; cx.stroke();
      cx.fillStyle = g.c;
      cx.fillText(g.text, x + 4, g.y + .5);
    }
  };
})();
