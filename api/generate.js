function wnsLine(ctx, p) {
  if (!p || !p.wns) return '';
  const f = ctx.f;
  return `CRT High ${f(p.wns.rh)} · CRT Low ${f(p.wns.rl)} | WNS SELL ${f(p.wns.sell.lo)}–${f(p.wns.sell.hi)} · WNS BUY ${f(p.wns.buy.lo)}–${f(p.wns.buy.hi)}`;
}

function runCrtManual(ctx, closed, styleName, facts) {
  const isSwing = styleName === 'Swing';
  const plan = planCrt({
    style: styleName,
    range: isSwing ? closed.d1 : closed.h4,
    mid:   isSwing ? closed.h1 : closed.m15,
    exec:  isSwing ? closed.m15 : closed.m5,
    price: ctx.price, sym: ctx.symbol, tNow: Date.now(),
  });
  const line = wnsLine(ctx, plan);
  facts.crtStatus = plan.status;
  if (plan.wns) facts.wns = plan.wns;
  facts.crtHigh = plan.crtHigh ?? null;
  facts.crtLow = plan.crtLow ?? null;

  if (plan.status !== 'limit') {
    const why = `${line ? line + '. ' : ''}${plan.reason || 'Menunggu setup CRT'}`;
    facts.standbyReason = why;
    return standbyOut(facts, why, line ? [line] : [], `CRT ${styleName}`);
  }

  const dir = plan.dir === 'BUY' ? 1 : -1;
  const riskPips = Math.round(Math.abs(plan.entry - plan.sl) / ctx.pip);
  const p = {
    dir, entry: plan.entry, sl: plan.sl, orderType: 'LIMIT',
    tps: [plan.tp1, plan.tp2, plan.tp3], rr: 1, tpMode: 'CRT', riskPips,
    setup: `Manual · ${DOC_STYLE_LABEL[styleName] || styleName} · CRT ${plan.zone.kind}`,
    zone: { lower: plan.zone.lo, upper: plan.zone.hi, timeframe: '', label: `CRT ${plan.zone.kind}`, mid: (plan.zone.lo + plan.zone.hi) / 2 },
  };
  const sig = toSignal(p, ctx, { confidence: 'MEDIUM', risk: 'MEDIUM', checklist: [line], scanSummary: line, topDown: `CRT ${styleName}` });
  sig.expiresAt = plan.expiresAt;
  sig.symbol = ctx.symbol; sig.style = styleName; sig.role = 'main';
  sig.crt = { wns: plan.wns || null, sweep: plan.sweep || null, crtHigh: plan.crtHigh, crtLow: plan.crtLow };
  Object.assign(facts, {
    signal: plan.dir, entry: sig.entry, sl: sig.sl, tp: [sig.tp1, sig.tp2, sig.tp3],
    tpMode: 'CRT', riskPips, trigger: `CRT ${plan.zone.kind}`, status: sig.status,
  });
  return { signal: sig, facts };
}
