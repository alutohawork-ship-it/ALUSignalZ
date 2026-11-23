// scalp5-fix.js — Scalping XAUUSD dengan 5 TP (1R, 1.5R, 2R, 3R, 5R), tanpa edit index.html.
// - TP4 dan TP5 dihitung di browser dari entry dan SL (tidak menambah panggilan API).
// - Kartu SL/TP dibuat kecil: 3 kolom, 2 baris (SL, TP1, TP2 / TP3, TP4, TP5).
// - Trade: TP1 kena -> stop ke entry (BE). Trade ditutup saat TP5 kena, stop kena, atau batas waktu.
//   Jika kena BE/stop setelah TP sudah tercapai: label 'TP{n} → BE' (pips 0). Batas waktu: BE di harga pasar.
// Trade CRT, Vision, dan Bot tidak diubah.
(function () {
  const origEval = window.evalTrade;
  if (typeof origEval !== 'function') return;

  const MULTS = [1, 1.5, 2, 3, 5];
  const is5 = t => !!t && t.style === 'Scalping' && (t.key === 'XAUUSD' || t.key === 'BTCUSD') && t.src !== 'bot' && !/CRT/.test(String(t.setup || ''));
  const levels = t => { const R = Math.abs(t.entry - t.sl); return MULTS.map(m => t.entry + t.dir * R * m); };
  const ensureLevels = t => {
    if (t.tp5 == null || t.tp4 == null) {
      const L = levels(t);
      t.tp1 = L[0]; t.tp2 = L[1]; t.tp3 = L[2]; t.tp4 = L[3]; t.tp5 = L[4];
    }
  };

  window.evalTrade = function (t, p, lo, hi, now) {
    lo = lo == null ? p : lo; hi = hi == null ? p : hi; now = now || Date.now();
    if (!is5(t) || t.status === 'CLOSED') return origEval.apply(this, arguments);

    if (t.status === 'PENDING') {
      ensureLevels(t);
      return origEval.call(this, t, p, lo, hi, now);
    }
    ensureLevels(t);
    if (!t.s5) t.s5 = { hit: [false, false, false, false, false], stop: t.sl, maxPips: 0 };
    const c = t.s5;
    t.hits = t.hits || {};
    const d = t.dir, pip = t.pip || 0.1, eps = pip * 0.5;
    const L = [t.tp1, t.tp2, t.tp3, t.tp4, t.tp5];
    const px = v => (v - t.entry) * d / pip;
    const best = d > 0 ? hi : lo, worst = d > 0 ? lo : hi;
    const reached = (v, x) => v != null && (d > 0 ? x >= v - eps : x <= v + eps);
    const r1 = v => Math.round(v * 10) / 10;
    const maxHit = () => c.hit.reduce((m, h, i) => (h ? i + 1 : m), 0);

    const finish = (result, exit, maxTp, pips) => {
      Object.assign(t, { status: 'CLOSED', result, exitPrice: exit, closedAt: now, maxTp, pips: r1(pips) });
      return true;
    };

    c.maxPips = Math.max(c.maxPips, px(best));
    let changed = false;
    for (let i = 0; i < 5; i++) {
      if (!c.hit[i] && reached(L[i], best)) {
        c.hit[i] = true; changed = true;
        t.hits['tp' + (i + 1)] = { at: now, price: L[i] };
        if (i === 0) c.stop = t.entry;      // TP1 -> BE
      }
    }
    if (c.hit[4]) return finish('TP', L[4], 5, px(L[4]));

    const stopHit = d > 0 ? worst <= c.stop + eps : worst >= c.stop - eps;
    if (stopHit) {
      const mx = maxHit();
      if (mx >= 1) return finish('BE', c.stop, mx, 0);              // sudah ada TP lalu kena stop/BE: label BE (TP terakhir tercapai)
      return finish('SL', c.stop, 0, px(c.stop));
    }

    if (now >= (t.expiresAt || 0)) {
      const mx = maxHit();
      if (mx >= 1) return finish('BE', p, mx, px(p));              // batas waktu: ditutup di harga pasar, label BE
      return finish('BE', p, 0, px(p));
    }
    if (maxHit() >= 1) t.status = 'BE';
    return changed;
  };

  // ---- Kartu: TP4 dan TP5, ukuran kecil, 3 kolom ----
  function ensureBoxes() {
    const tp3 = document.getElementById('lb-tp3');
    if (!tp3) return;
    const grid = tp3.parentElement;
    if (!grid || grid.dataset.s5) return;
    grid.dataset.s5 = '1';
    grid.className = 'grid grid-cols-3 gap-1';
    [['tp4', 'TP4', 'text-emerald-400'], ['tp5', 'TP5', 'text-sky-400']].forEach(([k, label, col]) => {
      const box = tp3.cloneNode(true);
      box.id = 'lb-' + k;
      const chk = box.querySelector('[id^="chk-"]'); if (chk) chk.id = 'chk-' + k;
      const lv = box.querySelector('[id^="lv-"]'); if (lv) { lv.id = 'lv-' + k; lv.textContent = '--'; }
      const pp = box.querySelector('[id^="pp-"]'); if (pp) { pp.id = 'pp-' + k; pp.textContent = '--'; }
      const lbl = box.querySelector('p'); if (lbl) { lbl.textContent = label; lbl.className = 'text-[8px] font-bold ' + col; }
      grid.appendChild(box);
    });
    [...grid.children].forEach(b => {
      b.classList.remove('p-2'); b.classList.add('p-1');
      b.querySelectorAll('p').forEach(p => { if (p.className.includes('text-[10px]')) p.classList.replace('text-[10px]', 'text-[9px]'); });
    });
  }

  setInterval(() => {
    ensureBoxes();
    let t = null;
    try { t = typeof activeTrade === 'function' ? activeTrade() : null; } catch (e) {}
    if (!is5(t)) return;
    ensureLevels(t);
    [['tp4', t.tp4], ['tp5', t.tp5]].forEach(([k, v]) => {
      const lv = document.getElementById('lv-' + k), pp = document.getElementById('pp-' + k);
      if (lv) lv.textContent = fmt(v);
      if (pp) pp.textContent = fmtPips(pipsOf(t, v));
    });
  }, 500);
})();
