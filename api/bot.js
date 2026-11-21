import { db } from '../lib/db.js';
import { sendPush } from '../lib/push.js';
import { detectSignal, trackSignal, closedBars } from '../lib/bot-engine.js';
import { checkAccess } from '../lib/access.js';

export const config = { maxDuration: 60 };

// ── bot-tick ──
// api/bot-tick.js — bot server XAUUSD: deteksi sinyal tiap candle M5 tutup, lacak TP/SL/BE, kirim push.
// Dipanggil dari cron-check (GET ?secret=CRON_SECRET). Memakai akun sistem BOT_SYS_EMAIL untuk akses candle.
// Env: CRON_SECRET, DATABASE_URL, VAPID_*. Opsional: BOT_SYS_EMAIL (kalau kosong, otomatis pilih klien aktif).

const SYM = 'XAUUSD';

async function ensureBotTables() {
  await db.query(`create table if not exists bot_signals (
    id serial primary key,
    dir int not null,
    entry double precision not null,
    sl double precision not null,
    tp1 double precision,
    candle_t bigint not null,
    created_at timestamptz not null default now(),
    status text not null default 'open',
    result text,
    exit_price double precision,
    pips double precision,
    hits jsonb not null default '{}',
    closed_at timestamptz
  )`);
  await db.query(`create table if not exists bot_state (k text primary key, v text)`);
}

async function candles(base, email, interval, limit) {
  const r = await fetch(`${base}/api/candles`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, symbol: SYM, interval, limit }),
  });
  const j = await r.json().catch(() => ({}));
  return Array.isArray(j.candles) ? j.candles : [];
}

async function pickSysEmail() {
  if (process.env.BOT_SYS_EMAIL) return process.env.BOT_SYS_EMAIL;
  const r = await db.query(
    `select email from clients where expires_at > now()
     order by case status when 'lifetime' then 0 when 'monthly' then 1 else 2 end, expires_at desc
     limit 1`
  );
  return r.rows.length ? r.rows[0].email : null;
}

const dirTxt = d => (d > 0 ? 'BUY' : 'SELL');

async function botTick(req, res) {
  if (!process.env.CRON_SECRET || req.query?.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ ok: false, msg: 'Unauthorized' });
  }
  try {
    await ensureBotTables();
    // Akun untuk akses candle: otomatis pilih klien aktif (lifetime > monthly > trial).
    // Kalau BOT_SYS_EMAIL diisi, itu dipakai dulu (opsional).
    const sys = await pickSysEmail();
    if (!sys) return res.status(200).json({ ok: false, msg: 'Tidak ada klien aktif untuk akses candle.' });

    const base = `https://${req.headers.host}`;
    const report = { signal: null, closed: [] };

    // 1) Deteksi sinyal hanya saat candle M5 baru sudah tutup
    const m5 = closedBars(await candles(base, sys, '5m', 300), 5 * 60000);
    const m1 = closedBars(await candles(base, sys, '1m', 600), 60000);
    const last = m1.length ? m1[m1.length - 1].c : 0;

    if (m5.length && last) {
      const lastM5 = String(m5[m5.length - 1].t);
      const st = await db.query(`select v from bot_state where k = 'last_m5'`);
      if (!st.rows.length || st.rows[0].v !== lastM5) {
        await db.query(
          `insert into bot_state (k, v) values ('last_m5', $1)
           on conflict (k) do update set v = excluded.v`, [lastM5]
        );
        const prev = await db.query(`select candle_t from bot_signals order by id desc limit 1`);
        const prevT = prev.rows.length ? Number(prev.rows[0].candle_t) : null;
        const sig = detectSignal(m5, last, prevT);
        if (sig && sig.ok && sig.tps && sig.tps.length) {
          const ins = await db.query(
            `insert into bot_signals (dir, entry, sl, tp1, candle_t) values ($1,$2,$3,$4,$5) returning id`,
            [sig.dir, sig.entry, sig.sl, sig.tps[0], Number(sig.candleT)]
          );
          report.signal = { id: ins.rows[0].id, dir: dirTxt(sig.dir), entry: sig.entry };
          await sendPush({
            title: `🤖 Bot ${dirTxt(sig.dir)} ${SYM}`,
            body: `Entry ${sig.entry} · SL ${sig.sl} · TP ${sig.tps[0]}`,
            url: '/', tag: `bot-${ins.rows[0].id}`,
          });
        }
      }
    }

    // 2) Lacak sinyal yang masih berjalan terhadap candle M1
    const open = await db.query(`select * from bot_signals where status = 'open' order by id asc limit 50`);
    for (const row of open.rows) {
      const sig = {
        id: row.id, dir: row.dir, entry: row.entry, sl: row.sl, tp1: row.tp1,
        candle_t: Number(row.candle_t), hits: row.hits || {},
      };
      const done = trackSignal(sig, m1);
      if (!done) continue;
      await db.query(
        `update bot_signals set status = 'closed', result = $1, exit_price = $2, pips = $3, hits = $4, closed_at = now()
         where id = $5`,
        [done.result, done.exit, done.pips, JSON.stringify(done.hits), row.id]
      );
      report.closed.push({ id: row.id, result: done.result, pips: done.pips });
      const icon = done.result === 'TP' ? '✅' : done.result === 'BE' ? '🟡' : '❌';
      await sendPush({
        title: `${icon} Bot ${done.result} ${dirTxt(row.dir)} ${SYM}`,
        body: `${done.pips > 0 ? '+' : ''}${done.pips} pip`,
        url: '/', tag: `bot-close-${row.id}`,
      });
    }

    return res.status(200).json({ ok: true, ...report });
  } catch (err) {
    console.error('bot-tick error:', err);
    return res.status(500).json({ ok: false, msg: 'Server error: ' + err.message });
  }
}

// ── bot-signals ──
// api/bot-signals.js — daftar sinyal bot untuk browser (dipakai untuk rekap & tampilan)
//   GET ?email=...  -> sinyal bot yang boleh dilihat email itu
// Aturan: trial hanya mendapat 2 sinyal bot (dicatat di bot_deliveries); monthly/lifetime semua.

const TRIAL_LIMIT = 2;

async function ensureDeliveryTables() {
  await db.query(`create table if not exists bot_deliveries (
    email text not null, signal_id int not null, primary key (email, signal_id))`);
}

async function botSignals(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, msg: 'Method not allowed' });

  const email = String(req.query?.email || '').trim().toLowerCase();
  const access = await checkAccess(email, false);
  if (!access.ok) return res.status(403).json({ ok: false, msg: 'Akses ditolak.' });

  try {
    await ensureDeliveryTables();
    if (access.status === 'trial') {
      const have = await db.query(`select count(*)::int as n from bot_deliveries where email = $1`, [email]);
      const left = TRIAL_LIMIT - have.rows[0].n;
      if (left > 0) {
        // Catat sinyal terbaru yang belum pernah dikirim ke email ini, sampai batas trial
        await db.query(
          `insert into bot_deliveries (email, signal_id)
           select $1, id from bot_signals
           where id not in (select signal_id from bot_deliveries where email = $1)
           order by id asc limit $2
           on conflict do nothing`,
          [email, left]
        );
      }
      const r = await db.query(
        `select s.* from bot_signals s
         join bot_deliveries d on d.signal_id = s.id and d.email = $1
         order by s.id asc`, [email]);
      return res.status(200).json({ ok: true, signals: r.rows, trial: true });
    }
    const r = await db.query(`select * from bot_signals order by id desc limit 50`);
    return res.status(200).json({ ok: true, signals: r.rows.reverse(), trial: false });
  } catch (err) {
    console.error('bot-signals error:', err);
    return res.status(500).json({ ok: false, msg: 'Server error: ' + err.message });
  }
}

// Router: /api/bot?a=tick | signals  (URL lama tetap jalan lewat vercel.json rewrites)
export default async function handler(req, res) {
  const a = String(req.query?.a || '');
  if (a === 'tick') return botTick(req, res);
  if (a === 'signals') return botSignals(req, res);
  return res.status(404).json({ ok: false, msg: 'Unknown action' });
}
