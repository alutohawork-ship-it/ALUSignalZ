// livemap-fix.js — LIVE MAP: garis TP1 sampai TP5 (Scalping 5 TP) dan garis CHART tetap seperti aslinya.
// Menggantikan drawLiveMap dengan versi yang juga menggambar TP4 dan TP5. Tanpa edit index.html.
(function () {
  const TPK = ['tp1', 'tp2', 'tp3', 'tp4', 'tp5'];
  const MULTS = [1, 1.5, 2, 3, 5];
  const is5 = t => !!t && t.style === 'Scalping' && (t.key === 'XAUUSD' || t.key === 'BTCUSD') && t.src !== 'bot' && !/CRT/.test(String(t.setup || ''));

  // Pastikan TP4/TP5 ada untuk trade Scalping XAUUSD (dihitung dari entry dan SL)
  function ensure5(t) {
    if (!is5(t)) return;
    if (t.tp4 == null || t.tp5 == null) {
      const R = Math.abs(t.entry - t.sl);
      t.tp1 = t.entry + t.dir * R * MULTS[0];
      t.tp2 = t.entry + t.dir * R * MULTS[1];
      t.tp3 = t.entry + t.dir * R * MULTS[2];
      t.tp4 = t.entry + t.dir * R * MULTS[3];
      t.tp5 = t.entry + t.dir * R * MULTS[4];
    }
  }

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

    cx.font = '8px ui-monospace, monospace';
    cx.textAlign = 'left';
    cx.textBaseline = 'top';
    cx.fillStyle = 'rgba(148,163,184,.9)';
    cx.fillText(srcLabel(k, iv) + (LIVE_TYPE === 'line' ? ' · LINE' : ''), plotL + 2, 3);

    if (!allRows.length && live == null) {
      cx.font = 'bold 11px ui-monospace, monospace';
      cx.fillStyle = '#94a3b8';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText(T('waitTick'), CW / 2, CH / 2);
      cx.textAlign = 'left';
      return;
    }

    ensure5(t);
    const rows = liveViewRows(allRows, t);
    const { vis, slot, xOfT } = layoutX(rows, plotL, plotR, tfMs);
    const smcData = getSmc(k, iv);

    const showLv = !!t && t.status !== 'CLOSED';
    const pre = t && t.ocoId ? (t.signal === 'BUY' ? 'B ' : 'S ') : '';
    const L = showLv ? [
      { label: pre + 'ENTRY', main: true, v: t.entry, c: '#93c5fd', bg: 'rgba(147,197,253,.14)', dash: [] },
      { label: pre + slLabel(t), v: effSL(t), c: '#f87171', bg: 'rgba(248,113,113,.14)', dash: [4, 4], hit: t.result === 'SL' },
      { label: pre + 'TP1', v: t.tp1, c: '#34d399', bg: 'rgba(52,211,153,.14)', dash: [4, 4], hit: !!(t.hits && t.hits.tp1) },
      { label: pre + 'TP2', v: t.tp2, c: '#34d399', bg: 'rgba(52,211,153,.14)', dash: [4, 4], hit: !!(t.hits && t.hits.tp2) },
      { label: pre + 'TP3', v: t.tp3, c: '#38bdf8', bg: 'rgba(56,189,248,.14)', dash: [4, 4], hit: !!(t.hits && t.hits.tp3) },
      { label: pre + 'TP4', v: t.tp4, c: '#22d3ee', bg: 'rgba(34,211,238,.14)', dash: [3, 3], hit: !!(t.hits && t.hits.tp4) },
      { label: pre + 'TP5', v: t.tp5, c: '#a78bfa', bg: 'rgba(167,139,250,.14)', dash: [3, 3], hit: !!(t.hits && t.hits.tp5) },
    ].filter(l => Number.isFinite(l.v)) : [];

    let lo = Infinity, hi = -Infinity;
    vis.forEach(c => {
      if (c.h < lo) lo = c.h; if (c.h > hi) hi = c.h;
      if (c.l < lo) lo = c.l; if (c.l > hi) hi = c.l;
    });
    if (live != null) { if (live < lo) lo = live; if (live > hi) hi = live; }
    L.forEach(l => { if (l.v < lo) lo = l.v; if (l.v > hi) hi = l.v; });

    if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
    if (!(hi - lo > 0)) { const dd = Math.abs(hi) * 0.001 || 1; lo -= dd; hi += dd; }
    const pad = (hi - lo) * 0.12;
    lo -= pad; hi += pad;
    const yOf = p => plotT + (1 - (p - lo) / (hi - lo)) * plotH;

    cx.lineWidth = 1;
    cx.strokeStyle = 'rgba(148,163,184,.08)';
    for (let i = 1; i < 4; i++) {
      const y = plotT + plotH * i / 4;
      cx.beginPath(); cx.moveTo(plotL, y); cx.lineTo(plotR, y); cx.stroke();
    }

    if (smcData.status === 'ok') {
      if (LIVE_IND.fvg) {
        smcData.fvgs.forEach(z => {
          const x0 = clampX(xOfT(z.t), plotL, plotR);
          if (plotR - x0 < 2) return;
          const y1 = yOf(z.top), y2 = yOf(z.bottom);
          cx.save();
          cx.fillStyle = z.dir > 0 ? 'rgba(59,130,246,.12)' : 'rgba(168,85,247,.12)';
          cx.fillRect(x0, Math.min(y1, y2), plotR - x0, Math.abs(y2 - y1));
          cx.restore();
        });
      }
      if (LIVE_IND.ob) {
        smcData.obs.forEach(z => {
          const x0 = clampX(xOfT(z.t), plotL, plotR);
          if (plotR - x0 < 2) return;
          const y1 = yOf(z.top), y2 = yOf(z.bottom);
          cx.save();
          cx.fillStyle = z.dir > 0 ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)';
          cx.fillRect(x0, Math.min(y1, y2), plotR - x0, Math.abs(y2 - y1));
          cx.restore();
        });
      }
      if (LIVE_IND.liq && smcData.liq && smcData.liq.pools) {
        smcData.liq.pools.forEach(p => {
          const y = yOf(p.p);
          cx.save();
          cx.strokeStyle = 'rgba(245,158,11,.85)';
          cx.lineWidth = 1.2;
          cx.setLineDash([4, 4]);
          cx.beginPath(); cx.moveTo(plotL, y); cx.lineTo(plotR, y); cx.stroke();
          cx.setLineDash([]);
          cx.font = 'bold 8px ui-monospace, monospace';
          cx.fillStyle = 'rgba(245,158,11,1)';
          cx.textAlign = 'right';
          cx.textBaseline = p.high ? 'bottom' : 'top';
          cx.fillText(p.label, plotR - 4, y + (p.high ? -2 : 2));
          cx.restore();
        });
      }
      if (LIVE_IND.str && smcData.ev) {
        smcData.ev.forEach(e => {
          const x0 = clampX(xOfT(e.fromT), plotL, plotR), x1 = clampX(xOfT(e.toT), plotL, plotR), y = yOf(e.p);
          const col = e.dir > 0 ? '125,211,252' : '251,146,60';
          cx.save();
          cx.strokeStyle = `rgba(${col},.95)`;
          cx.lineWidth = 1;
          cx.beginPath(); cx.moveTo(x0, y); cx.lineTo(x1, y); cx.stroke();
          cx.font = 'bold 8px ui-monospace, monospace';
          cx.fillStyle = `rgba(${col},1)`;
          cx.textAlign = 'right';
          cx.textBaseline = e.dir > 0 ? 'bottom' : 'top';
          cx.fillText(`${e.type} ${e.dir > 0 ? '▲' : '▼'}`, x1, y + (e.dir > 0 ? -2 : 2));
          cx.restore();
        });
      }
    }

    if (LIVE_IND.sma && allRows.length > 20) {
      const smaArr = smaSeries(allRows, 20);
      const off = allRows.length - vis.length;
      cx.save();
      cx.strokeStyle = '#facc15';
      cx.lineWidth = 1.5;
      cx.beginPath();
      let on = false;
      for (let j = 0; j < vis.length; j++) {
        const v = smaArr[off + j];
        if (v == null) { on = false; continue; }
        const x = xOfT(vis[j].t), y = yOf(v);
        if (!on) { cx.moveTo(x, y); on = true; } else cx.lineTo(x, y);
      }
      cx.stroke();
      cx.restore();
    }

    if (LIVE_TYPE === 'line') {
      cx.save();
      cx.strokeStyle = '#93c5fd';
      cx.lineWidth = 1.4;
      cx.beginPath();
      vis.forEach((c, j) => {
        const x = xOfT(c.t), y = yOf(c.c);
        if (j) cx.lineTo(x, y); else cx.moveTo(x, y);
      });
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

    L.forEach(l => {
      const y = yOf(l.v);
      cx.save();
      cx.strokeStyle = l.c;
      cx.globalAlpha = l.main ? .95 : .8;
      cx.lineWidth = l.main ? 1.4 : 1;
      cx.setLineDash(l.dash);
      const lx = (t && t.status !== 'CLOSED' && t.status !== 'PENDING' && t.filledAt)
        ? clampX(xOfT(Math.floor(t.filledAt / 60000) * 60000), plotL, plotR) : plotL;
      cx.beginPath(); cx.moveTo(lx, y); cx.lineTo(plotR, y); cx.stroke();
      cx.restore();
    });

    if (live != null) {
      const y = yOf(live);
      const lc = liveDir < 0 ? '#f87171' : '#34d399';
      cx.save();
      cx.strokeStyle = lc; cx.globalAlpha = .6; cx.lineWidth = 1; cx.setLineDash([1, 3]);
      cx.beginPath(); cx.moveTo(plotL, y); cx.lineTo(plotR, y); cx.stroke();
      cx.restore();
    }

    const tags = L.map(l => ({ text: (l.hit ? '✓ ' : '') + l.label + ' ' + fmt(l.v), c: l.c, bg: l.bg, y: yOf(l.v) }));
    if (live != null) {
      tags.push({ text: fmt(live), c: liveDir < 0 ? '#fca5a5' : '#86efac', bg: liveDir < 0 ? 'rgba(239,68,68,.25)' : 'rgba(16,185,129,.25)', y: yOf(live) });
    }
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
