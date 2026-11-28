export async function checkAccess(email){ return email ? { ok: true, key: 'ok' } : { ok: false, key: 'noEmail' }; }
export async function markTrialBotUsed(){}
