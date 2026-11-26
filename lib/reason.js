// lib/reason.js — Reasoning ringkas (6-7 baris) berbasis skenario, sesuai Framework §9 FORMAT
const isNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const tp = f => [f.tp1, f.tp2, f.tp3].filter(isNum).map(Number).join(' / ');
const tfLine = (lbl, txt) => '• ' + lbl + ': ' + txt;

export function buildReason(f, en) {
  const S = en ? {
    head: '[' + f.symbol + ' · ' + f.style + ' · Scenario: ' + (f.scenarioName || '?') + ']',
    sess: 'Session', vol: 'Volatility', bias: 'Bias', entry: 'Entry', sl: 'SL', tp: 'TP', conv: 'Conviction', exp: 'Expiry',
  } : {
    head: '[' + f.symbol + ' · ' + f.style + ' · Skenario: ' + (f.scenarioName || '?') + ']',
    sess: 'Sesi', vol: 'Volatilitas', bias: 'Bias', entry: 'Entry', sl: 'SL', tp: 'TP', conv: 'Conviction', exp: 'Expiry',
  };
  const L = [];
  L.push(tfLine(S.sess, (f.session || '?') + ' (' + (f.sessionWib || '') + ') liq ' + (f.sessionLiq || '?') + 'x'));
  // 3 baris struktur ringkas: HTF / MTF / LTF
  if (f.tfSummary) f.tfSummary.forEach(s => L.push('• ' + s));
  L.push(tfLine(S.entry, f.signal + ' ' + (f.orderType === 'MARKET' ? (en ? 'NOW' : 'NOW') : (en ? 'LIMIT' : 'LIMIT')) + ' @ ' + f.entry + ' — ' + (f.orderReason || '')));
  L.push(tfLine(S.sl, f.sl + ' (' + f.riskPips + ' pip) — ' + (f.slReason || '')));
  L.push(tfLine(S.tp, tp(f)));
  L.push(tfLine(S.conv, f.conviction + '/100 ' + f.convictionLevel + ' · Risk ' + f.riskMultiplier + 'x · Prob ' + f.probability));
  if (f.orderType !== 'MARKET' && f.expiry) L.push(tfLine(S.exp, f.expiry.id));
  return L.join('\n');
}
