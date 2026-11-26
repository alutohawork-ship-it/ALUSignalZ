// lib/reason.js — Reasoning ringkas 6-7 baris berbasis skenario (Framework §9)
const isNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

export function buildReason(f, en) {
  const S = en ? {
    head: '[' + f.symbol + ' · ' + f.style + ' · Scenario: ' + (f.scenarioName || '?') + ']',
    sess: 'Session', entry: 'Entry', sl: 'SL', tp: 'TP', conv: 'Conviction', exp: 'Expiry',
  } : {
    head: '[' + f.symbol + ' · ' + f.style + ' · Skenario: ' + (f.scenarioName || '?') + ']',
    sess: 'Sesi', entry: 'Entry', sl: 'SL', tp: 'TP', conv: 'Conviction', exp: 'Expiry',
  };
  
  const tpList = [f.tp1, f.tp2, f.tp3].filter(isNum).map(Number).join(' / ');
  const L = [];
  
  L.push('• ' + S.sess + ': ' + (f.session || '?') + ' (' + (f.sessionWib || '') + ') liq ' + (f.sessionLiq || '?') + 'x');
  
  if (f.tfSummary) f.tfSummary.forEach(s => L.push('• ' + s));
  
  L.push('• ' + S.entry + ': ' + f.signal + ' ' + (f.orderType === 'MARKET' ? 'NOW' : 'LIMIT') + ' @ ' + f.entry + ' — ' + (f.orderReason || ''));
  L.push('• ' + S.sl + ': ' + f.sl + ' (' + f.riskPips + ' pip) — ' + (f.slReason || ''));
  L.push('• ' + S.tp + ': ' + tpList);
  L.push('• ' + S.conv + ': ' + f.conviction + '/100 ' + f.convictionLevel + ' · Risk ' + f.riskMultiplier + 'x · Prob ' + f.probability);
  
  if (f.orderType !== 'MARKET' && f.expiry) {
    L.push('• ' + S.exp + ': ' + f.expiry.id);
  }
  
  return L.join('\n');
}
