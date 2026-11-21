// lib/push.js — kirim Web Push ke semua langganan (dipakai api/push-send.js dan api/notices.js)
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
  tableReady = true;
}

export async function sendPush(payload) {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!pub || !priv) return { sent: 0, failed: 0, msg: 'VAPID belum diisi di Vercel.' };
  webpush.setVapidDetails(subj, pub, priv);
  await ensureTable();
  const r = await db.query('select endpoint, p256dh, auth from push_subs');
  let sent = 0, failed = 0;
  await Promise.all(r.rows.map(async s => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (e) {
      failed++;
      // langganan kadaluarsa / dicabut: hapus agar tidak dikirim lagi
      if (e.statusCode === 404 || e.statusCode === 410) {
        await db.query('delete from push_subs where endpoint = $1', [s.endpoint]);
      }
    }
  }));
  return { sent, failed };
}
