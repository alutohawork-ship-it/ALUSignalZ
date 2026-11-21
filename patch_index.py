#!/usr/bin/env python3
"""
patch_index.py v2 - menerapkan perbaikan frontend ke index.html (Alu Signal Z)

Perubahan:
  1. Konstanta LIVE_FOCUS_N
  2. replayMissed : limit yang terisi di sebuah candle tidak lanjut cek TP/SL di candle yang sama
  3. checkTrades  : trade yang baru terisi hanya dicek TP/SL dari tick setelah fill
  4. Toolbar LIVE MAP: tombol on/off FVG, OB, BSL/SSL, BOS/CHoCH, SMA20 dan tipe chart CANDLE / LINE
  5. drawLiveMap  : fungsi diganti lengkap.
       - indikator bisa dimatikan lewat tombol
       - tipe chart candle atau line
       - saat entry terisi (RUNNING/BE): zoom ke candle sekitar fill sampai sekarang,
         rentang harga mencakup entry, SL, dan TP3 (ujung garis SL dan TP3 terlihat)
       - saat CLOSED: level dihapus, chart kembali ke tampilan penuh

Pemakaian:
  python3 patch_index.py index.html

Hasil: index.html ditimpa, file asli disimpan sebagai index.html.bak
Jika salah satu potongan tidak ditemukan tepat satu kali, skrip berhenti dan file TIDAK diubah.
"""
import shutil
import sys

# ---------- potongan sederhana (old -> new) ----------
PATCHES = []

PATCHES.append((
    "konstanta LIVE_FOCUS_N",
    "const HISTORY_MS = 600000, STALE_MS = 30000, CHART_GUT = 80, CH_PAD = 4;",
    "const HISTORY_MS = 600000, STALE_MS = 30000, CHART_GUT = 80, CH_PAD = 4;\n"
    "const LIVE_FOCUS_N = 60; // jumlah candle minimum yang tampil saat trade berjalan",
))

PATCHES.append((
    "replayMissed: stop setelah fill di candle yang sama",
    """      const path = c.c >= c.o ? [c.o, c.l, c.h, c.c] : [c.o, c.h, c.l, c.c];
      for (const pt of path) {
        if (t.status === 'CLOSED') break;
        if (evalTrade(t, pt, pt, pt, end)) ch = true;
      }
      t.scanAt = end;""",
    """      const path = c.c >= c.o ? [c.o, c.l, c.h, c.c] : [c.o, c.h, c.l, c.c];
      const wasPending = t.status === 'PENDING';
      for (const pt of path) {
        if (t.status === 'CLOSED') break;
        if (evalTrade(t, pt, pt, pt, end)) ch = true;
        // Limit terisi di candle ini: urutan intra-candle tidak diketahui, jadi TP/SL candle ini dilewati
        if (wasPending && t.status !== 'PENDING') break;
      }
      t.scanAt = end;""",
))

PATCHES.append((
    "checkTrades: fill-fresh hanya pakai tick sekarang",
    """  let ch = false;
  for (const t of trades) {
    if (t.key !== k || t.status === 'CLOSED') continue;
    if (evalTrade(t, p, lo, hi, now)) ch = true;
  }""",
    """  let ch = false;
  for (const t of trades) {
    if (t.key !== k || t.status === 'CLOSED') continue;
    // Trade yang baru terisi (limit kesentuh) hanya dicek TP/SL dari tick setelah fill,
    // bukan dari rentang harga sebelum fill
    const fillFresh = t.filledAt && (!prev || t.filledAt >= prev.at);
    const tlo = fillFresh ? p : lo, thi = fillFresh ? p : hi;
    if (evalTrade(t, p, tlo, thi, now)) ch = true;
  }""",
))

# Toolbar LIVE MAP: disisipkan tepat sebelum baris tradePnl di chartPanel
TOOLBAR_BTN = ('class="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border '
               'border-panelborder text-gray-500 hover:text-white transition"')
TOOLBAR = (
    '        <div class="flex flex-wrap gap-1 pb-1">\n'
    f'          <button data-live-type="candle" onclick="setLiveType(\'candle\')" {TOOLBAR_BTN}>CANDLE</button>\n'
    f'          <button data-live-type="line" onclick="setLiveType(\'line\')" {TOOLBAR_BTN}>LINE</button>\n'
    f'          <button data-live-ind="fvg" onclick="toggleLiveInd(\'fvg\')" {TOOLBAR_BTN}>FVG</button>\n'
    f'          <button data-live-ind="ob" onclick="toggleLiveInd(\'ob\')" {TOOLBAR_BTN}>OB</button>\n'
    f'          <button data-live-ind="liq" onclick="toggleLiveInd(\'liq\')" {TOOLBAR_BTN}>BSL/SSL</button>\n'
    f'          <button data-live-ind="str" onclick="toggleLiveInd(\'str\')" {TOOLBAR_BTN}>BOS/CHoCH</button>\n'
    f'          <button data-live-ind="sma" onclick="toggleLiveInd(\'sma\')" {TOOLBAR_BTN}>SMA20</button>\n'
    '        </div>\n'
)
PATCHES.append((
    "toolbar LIVE MAP (tombol indikator & tipe chart)",
    '        <p id="tradePnl" class="text-[10px] font-mono font-bold text-gray-400"></p>',
    TOOLBAR + '        <p id="tradePnl" class="text-[10px] font-mono font-bold text-gray-400"></p>',
))

# ---------- drawLiveMap: diganti lengkap (blok dari 'function drawLiveMap' sampai 'function smaSeries') ----------
NEW_DRAW_LIVE_MAP = r"""// ── Tombol LIVE MAP: indikator on/off dan tipe chart ──
const LIVE_IND = { fvg: true, ob: true, liq: true, str: true, sma: true };
let LIVE_TYPE = 'candle';
function toggleLiveInd(key) { LIVE_IND[key] = !LIVE_IND[key]; syncLiveBtns(); }
function setLiveType(tp) { LIVE_TYPE = tp; syncLiveBtns(); }
function syncLiveBtns() {
  const mark = (el, on) => {
    el.classList.toggle('bg-accentblue/30', on);
    el.classList.toggle('text-white', on);
    el.classList.toggle('text-gray-500', !on);
  };
  document.querySelectorAll('[data-live-ind]').forEach(b => mark(b, !!LIVE_IND[b.dataset.liveInd]));
  document.querySelectorAll('[data-live-type]').forEach(b => mark(b, b.dataset.liveType === LIVE_TYPE));
}

// Mode fokus: trade sudah terisi (RUNNING/BE) -> tampil dari sekitar candle fill sampai sekarang
function liveViewRows(rows, t) {
  if (!t || t.status === 'CLOSED' || t.status === 'PENDING') return rows;
  let start = rows.length - LIVE_FOCUS_N;
  if (t.filledAt) {
    const fillMin = Math.floor(t.filledAt / 60000) * 60000;
    const idx = rows.findIndex(c => c.t >= fillMin);
    if (idx >= 0) start = idx - 10;
  }
  start = Math.max(0, Math.min(start, rows.length - 30));
  return rows.slice(start);
}

function drawLiveMap(cv, cx, t, k) {
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

  const rows = liveViewRows(allRows, t);
  const { vis, slot, xOfT } = layoutX(rows, plotL, plotR, tfMs);
  const smcData = getSmc(k, iv);

  // Level trade hanya tampil saat trade belum CLOSED
  const showLv = !!t && t.status !== 'CLOSED';
  const pre = t && t.ocoId ? (t.signal === 'BUY' ? 'B ' : 'S ') : '';
  const L = showLv ? [
    { label: pre + 'ENTRY', main: true, v: t.entry, c: '#93c5fd', bg: 'rgba(147,197,253,.14)', dash: [] },
    { label: pre + slLabel(t), v: effSL(t), c: '#f87171', bg: 'rgba(248,113,113,.14)', dash: [4, 4], hit: t.result === 'SL' },
    { label: pre + 'TP1', v: t.tp1, c: '#34d399', bg: 'rgba(52,211,153,.14)', dash: [4, 4], hit: !!t.hits.tp1 },
    { label: pre + 'TP2', v: t.tp2, c: '#34d399', bg: 'rgba(52,211,153,.14)', dash: [4, 4], hit: !!t.hits.tp2 },
    { label: pre + 'TP3', v: t.tp3, c: '#38bdf8', bg: 'rgba(56,189,248,.14)', dash: [4, 4], hit: !!t.hits.tp3 }
  ].filter(l => Number.isFinite(l.v)) : [];

  // Rentang harga: candle yang tampil + harga live + seluruh level (SL sampai TP3)
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

  // SMA20 dihitung dari seluruh candle agar garisnya tidak terpotong saat zoom
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

  // Garis entry, SL, dan TP sampai ujung plot
  L.forEach(l => {
    const y = yOf(l.v);
    cx.save();
    cx.strokeStyle = l.c;
    cx.globalAlpha = l.main ? .95 : .8;
    cx.lineWidth = l.main ? 1.4 : 1;
    cx.setLineDash(l.dash);
    cx.beginPath(); cx.moveTo(plotL, y); cx.lineTo(plotR, y); cx.stroke();
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

  const GAP = 15, capT = plotT + 6, capB = plotB - 6;
  tags.forEach(g => { g.y = Math.max(capT, Math.min(capB, g.y)); });
  for (let i = 1; i < tags.length; i++) if (tags[i].y < tags[i - 1].y + GAP) tags[i].y = tags[i - 1].y + GAP;

  cx.font = 'bold 8px ui-monospace, monospace';
  cx.textAlign = 'left';
  cx.textBaseline = 'middle';
  for (const g of tags) {
    const x = plotR + 6, w = CHART_GUT - 12, h = 14, y = g.y - h / 2;
    rr(cx, x, y, w, h, 3);
    cx.fillStyle = g.bg; cx.fill();
    cx.strokeStyle = g.c; cx.lineWidth = .8; cx.stroke();
    cx.fillStyle = g.c;
    cx.fillText(g.text, x + 4, g.y + .5);
  }
}

"""

START_MARK = "function drawLiveMap(cv, cx, t, k) {"
END_MARK = "function smaSeries(rows, n = 20) {"


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    with open(path, encoding="utf-8") as f:
        src = f.read()

    # Lewati potongan yang sudah ada (mis. konstanta LIVE_FOCUS_N dari versi sebelumnya)
    global PATCHES
    PATCHES = [p for p in PATCHES if not (p[0].startswith('konstanta') and 'const LIVE_FOCUS_N' in src)]

    # 1) Cek semua potongan dulu, sebelum menulis apa pun
    for name, old, _ in PATCHES:
        n = src.count(old)
        if n != 1:
            print(f"GAGAL: '{name}' ditemukan {n} kali (harus tepat 1). File TIDAK diubah.")
            sys.exit(2)
    if src.count(START_MARK) != 1 or src.count(END_MARK) != 1:
        print("GAGAL: blok drawLiveMap tidak ditemukan tepat satu kali. File TIDAK diubah.")
        sys.exit(2)
    if src.index(END_MARK) <= src.index(START_MARK):
        print("GAGAL: urutan blok drawLiveMap tidak sesuai. File TIDAK diubah.")
        sys.exit(2)

    # 2) Terapkan
    for name, old, new in PATCHES:
        src = src.replace(old, new, 1)
        print(f"OK: {name}")

    s_idx = src.index(START_MARK)
    e_idx = src.index(END_MARK)
    src = src[:s_idx] + NEW_DRAW_LIVE_MAP + src[e_idx:]
    print("OK: drawLiveMap diganti lengkap (indikator on/off, candle/line, mode fokus)")

    shutil.copyfile(path, path + ".bak")
    with open(path, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"Selesai. File asli disimpan di {path}.bak")


if __name__ == "__main__":
    main()
