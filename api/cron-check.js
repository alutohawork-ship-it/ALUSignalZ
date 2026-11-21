// api/cron-check.js — dipanggil cron eksternal (cron-job.org) tiap 5 menit:
//   GET /api/cron-check?secret=CRON_SECRET
// Mengecek pemantauan yang sudah waktunya, memanggil /api/candles dan /api/generate,
// lalu mengirim push ke email pemilik pemantauan.
// Env: CRON_SECRET, DATABASE_URL, VAPID_*, BOT_SYS_EMAIL (untuk bot server)
import { db } from '../lib/db.js';
import { sendPush } from '../lib/push.js';
import { checkAccess } from '../lib/access.js';
import { nextSlot } from './monitor.js';

export const config = { maxDuration: 60 };

const PER_RUN = 3;                       // batasi agar selesai dalam batas waktu fungsi
const PENDING_MS = 12 * 3600e3;          // sinyal valid menunggu klik: maks 12 jam
const TF_KEYS = { m1: '1m', m5: '5m', m15: '15m', m30: '30m', h1: '1h', h4: '4h', d1: '1d' };

async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}

async function loadCandles(base, email, symbol) {
  const candles = {};
  for (const [k, iv] of Object.entries(TF_KEYS)) {
    const j = await postJson(`${base}/api/candles`, {
      email, symbol, interval: iv, limit: iv === '1m' ? 600 : 300,
    });
    candles[k] = Array.isArray(j.candles) ? j.candles : [];
  }
  return candles;
}

async function checkOne(base, m) {
  const now = Date.now();

  // Batas waktu habis tanpa setup
  if (now >= new Date(m.until_at).getTime()) {
    await db.query(`update monitors set status = 'expired' where id = $1`, [m.id]);
    await sendPush({ title: `⚠️ Zona ${m.style} belum valid`, body: `${m.symbol} · tidak ada setup dalam batas waktu`, url: '/' }, m.email);
    return { id: m.id, result: 'expired' };
  }

  // Akses klien sudah habis / dihapus: hentikan
  const access = await checkAccess(m.email, false);
  if (!access.ok) {
    await db.query(`update monitors set status = 'stopped' where id = $1`, [m.id]);
    return { id: m.id, result: 'stopped-no-access' };
  }

  const candles = await loadCandles(base, m.email, m.symbol);
  const last = candles.m1.length ? candles.m1[candles.m1.length - 1].c : 0;
  if (!last) {
    await db.query(`update monitors set next_at = $1 where id = $2`, [new Date(nextSlot(m.style, now)), m.id]);
    return { id: m.id, result: 'no-candles' };
  }

  const r = await postJson(`${base}/api/generate`, {
    email: m.email, symbol: m.symbol, style: m.style,
    price: last, currentPrice: last, candles, lang: 'id',
  });
  const sig = r && r.signal;
  const valid = r && r.ok && sig && sig.status !== 'STANDBY' && sig.signal !== 'NONE'
    && Number.isFinite(Number(sig.entry)) && Number.isFinite(Number(sig.sl));

  if (valid) {
    await db.query(
      `update monitors set status = 'pending', pending = $1, pending_until = $2 where id = $3`,
      [JSON.stringify(sig), new Date(now + PENDING_MS), m.id]
    );
    await sendPush({
      title: `🔔 Signal ${m.style} aktif`,
      body: `${m.symbol} ${sig.signal} · buka aplikasi dan klik tab ${m.style.toUpperCase()}`,
      url: '/', tag: `sig-${m.id}`,
    }, m.email);
    return { id: m.id, result: 'signal', dir: sig.signal };
  }

  await db.query(`update monitors set next_at = $1 where id = $2`, [new Date(nextSlot(m.style, now)), m.id]);
  return { id: m.id, result: 'standby' };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.query?.secret !== secret) return res.status(401).json({ ok: false, msg: 'Unauthorized' });

  try {
    const base = `https://${req.headers.host}`;

    // Sinyal menunggu yang sudah lewat 12 jam: tutup
    await db.query(`update monitors set status = 'done' where status = 'pending' and pending_until < now()`);

    const due = await db.query(
      `select * from monitors where status = 'watch' and next_at <= now() order by next_at limit $1`,
      [PER_RUN]
    );
    const report = [];
    for (const m of due.rows) {
      try { report.push(await checkOne(base, m)); }
      catch (e) { report.push({ id: m.id, result: 'error', msg: e.message }); }
    }
    // Bot server: panggilan terpisah (budget waktu sendiri)
    let bot = null;
    try {
      const r = await fetch(`${base}/api/bot-tick?secret=${encodeURIComponent(secret)}`);
      bot = await r.json().catch(() => ({ ok: false }));
    } catch (e) { bot = { ok: false, msg: e.message }; }
    return res.status(200).json({ ok: true, checked: report, bot });
  } catch (err) {
    console.error('cron-check error:', err);
    return res.status(500).json({ ok: false, msg: 'Server error: ' + err.message });
  }
}
