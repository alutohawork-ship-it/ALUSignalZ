// lib/push.js — kirim Web Push. Bisa ke semua langganan, ke satu email, atau dibuat per bahasa (id/en).
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
import webpush from 'web-push';
import { db } from './db.js';

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await db.query(`create table if not exists push_subs (
    endpoint text primary key,
    p256dh text not null,
    auth text not null,
    email text,
    created_at timestamptz not null default now()
  )`);
  await db.query(`alter table push_subs add column if not exists lang text not null default 'id'`);
  tableReady = true;
}

function setVapid() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subj, pub, priv);
  return true;
}

async function sendTo(rows, payloadFor) {
  let sent = 0, failed = 0;
  await Promise.all(rows.map(async s => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payloadFor(s.lang || 'id'))
      );
      sent++;
    } catch (e) {
      failed++;
      if (e.statusCode === 404 || e.statusCode === 410) {
        await db.query('delete from push_subs where endpoint = $1', [s.endpoint]);
      }
    }
  }));
  return { sent, failed };
}

// payload: objek sama untuk semua bahasa, atau fungsi (lang) => objek
export async function sendPush(payload, email) {
  if (!setVapid()) return { sent: 0, failed: 0, msg: 'VAPID belum diisi di Vercel.' };
  await ensureTable();
  const r = email
    ? await db.query('select endpoint, p256dh, auth, lang from push_subs where email = $1', [String(email).toLowerCase()])
    : await db.query('select endpoint, p256dh, auth, lang from push_subs');
  return sendTo(r.rows, typeof payload === 'function' ? payload : () => payload);
}
