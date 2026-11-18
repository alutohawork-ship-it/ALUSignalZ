// lib/access.js — cek akses klien dari tabel `clients`
// Cache 60 detik per instance supaya query tidak berulang untuk setiap request.
import { db } from './db.js';

const CACHE_TTL_MS = 60000;
const cache = new Map(); // email -> { t, client }

export async function getClient(email) {
  const hit = cache.get(email);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.client;

  const r = await db.query(
    'select email, status, expires_at, trial_bot_used from clients where email = $1',
    [email]
  );
  const row = r.rows[0] || null;
  const client = row
    ? { email: row.email, status: row.status, expires_at: row.expires_at, trial_bot_used: !!row.trial_bot_used }
    : null;
  cache.set(email, { t: Date.now(), client });
  return client;
}

export async function checkAccess(email, isAutoBot) {
  if (!email) return { ok: false, key: 'noEmail' };
  let c;
  try {
    c = await getClient(email);
  } catch (e) {
    // fail closed: kalau database gangguan, akses ditolak (bukan dibiarkan)
    console.error('DB access check:', e.message);
    return { ok: false, key: 'kvError' };
  }
  if (!c) return { ok: false, key: 'notRegistered' };
  if (new Date(c.expires_at) <= new Date()) return { ok: false, key: 'expired' };
  if (c.status === 'trial' && isAutoBot && c.trial_bot_used) return { ok: false, key: 'trialLimit' };
  return { ok: true, status: c.status };
}

export async function markTrialBotUsed(email) {
  try {
    await db.query(
      "update clients set trial_bot_used = true where email = $1 and status = 'trial'",
      [email]
    );
    cache.delete(email);
  } catch (e) {
    console.error('markTrialBotUsed:', e.message);
  }
}
