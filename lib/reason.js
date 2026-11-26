// lib/reason.js — v2: STANDBY-safe + undefined-safe
const isNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const safe = (v, d = '-') => (v === null || v === undefined || v === '' ? d : v);

export function buildReason(f, en) {
  if (f.status === 'STANDBY') {
    const head = '[' + safe(f.symbol, '?') + ' · ' + safe(f.style, '?') + ' · STANDBY]';
    const why = safe(f.why, en ? 'waiting for a valid setup.' : 'menunggu setup valid.');
    const lines = [
      head,
      '• ' + (en ? 'Status: no active signal. ' : 'Status: tidak ada sinyal aktif. ') + why,
    ];
    if (Array.isArray(f.steps) && f.steps.length) {
      f.steps.slice(0, 3).forEach(s => lines.push('• ' + safe(s.tf, '?') + ': ' + (en ? safe(s.textEn, s.text) : safe(s.text, '-'))));
    }
    lines.push('• ' + (en ? 'Signal will appear automatically once structure confirms.' : 'Sinyal muncul otomatis begitu struktur terkonfirmasi.'));
    return lines.join('\n');
  }

  const S = en
    ? { sess: 'Session', entry: 'Entry', sl: 'SL', tp: 'TP', conv: 'Conviction', exp: 'Expiry' }
    : { sess: 'Sesi', entry: 'Entry', sl: 'SL', tp: 'TP', conv: 'Conviction', exp: 'Expiry' };

  const tpList = ([f.tp1, f.tp2, f.tp3].filter(isNum).map(Number).join(' / ')) || '-';
  const L = [];

  L.push('• ' + S.sess + ': ' + safe(f.session, '?') + ' (' + safe(f.sessionWib, '') + ') liq ' + safe(f.sessionLiq, '?') + 'x');
  if (Array.isArray(f.tfSummary)) f.tfSummary.forEach(s => L.push('• ' + s));
  L.push('• ' + S.entry + ': ' + safe(f.signal, 'NONE') + ' ' + (f.orderType === 'MARKET' ? 'NOW' : 'LIMIT') + ' @ ' + safe(f.entry) + ' — ' + safe(f.orderReason, ''));
  L.push('• ' + S.sl + ': ' + safe(f.sl) + ' (' + safe(f.riskPips, '?') + ' pip) — ' + safe(f.slReason, ''));
  L.push('• ' + S.tp + ': ' + tpList);
  L.push('• ' + S.conv + ': ' + safe(f.conviction, '?') + '/100 ' + safe(f.convictionLevel, '?') + ' · Risk ' + safe(f.riskMultiplier, '?') + 'x · Prob ' + safe(f.probability, '?'));
  if (f.orderType !== 'MARKET' && f.expiry && f.expiry.id) L.push('• ' + S.exp + ': ' + f.expiry.id);

  return L.join('\n');
}
