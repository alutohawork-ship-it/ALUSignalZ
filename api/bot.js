// api/bot.js — Bot ICT: POI dari M15, struktur dan limit dari M5, TP psikologis, kunci sesi.
//   GET /api/bot?a=tick&secret=CRON_SECRET   (dipanggil cron-check tiap 5 menit)
//   GET /api/bot?a=signals&email=...         (riwayat untuk browser)
// URL lama (/api/bot-tick, /api/bot-signals) tetap jalan lewat vercel.json.
import { db } from '../lib/db.js';
import { checkAccess } from '../lib/access.js';
import { sendPush } from '../lib/push.js';
import { planBot, reviewLimit, structure } from '../lib/bot-ict.js';
import {
  M1, M5, PIP, closedBars, applyOutcome, isLocked, checkFill, trackTrade, utcDay,
  msgPoi, msgCancel, msgMoved, msgFilled, msgResult, msgLock,
} from '../lib/bot-engine.js';

export const config = { maxDuration: 60 };
const SYM = 'XAUUSD';
const M15 = 15 * 60e3;

let tablesReady = false;
async function ensureTables() {
  if (tablesReady) return;
  await db.query(`create table if not exists bot_state (key text primary key, value jsonb not null default '{}'::jsonb)`);
  await db.query(`create table if not exists bot_signals (id bigserial primary key, created_at timestamptz not null default now())`);
  const cols = [
    ['side', 'text'], ['sym', 'text'], ['poi_no', 'int'], ['poi_kind', 'text'], ['poi_lo', 'double precision'],
    ['poi_hi', 'double precision'], ['entry', 'double precision'], ['sl', 'double precision'],
    ['tp1', 'double precision'], ['tp2', 'double precision'], ['tp3', 'double precision'],
    ['status', 'text'], ['mode', 'text'], ['day', 'text'], ['placed_at', 'bigint'], ['filled_at', 'bigint'],
    ['hits', 'jsonb default \'{}\'::jsonb'], ['result', 'text'], ['exit_price', 'double precision'],
    ['pips', 'double precision'], ['closed_at', 'bigint'],
  ];
  for (const [c, t] of cols) await db.query(`alter table bot_signals add column if not exists ${c} ${t}`);
  await db.query(`create table if not exists bot_deliveries (email text, signal_id bigint, primary key (email, signal_id))`);
  tablesReady = true;
}

async function getState(key, fallback) {
  const r = await db.query('select value from bot_state where key = $1', [key]);
  return r.rows.length ? r.rows[0].value : fallback;
}
async function setState(key, value) {
  await db.query(
    `insert into bot_state (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`,
    [key, JSON.stringify(value)]
  );
}

async function pickSysEmail() {
  const env = (process.env.BOT_SYS_EMAIL || '').trim().toLowerCase();
  if (env) return env;
  const r = await db.query(
    `select email from clients where expires_at > now()
     order by case status when 'lifetime' then 0 when 'monthly' then 1 else 2 end limit 1`
  );
  return r.rows.length ? r.rows[0].email : null;
}

async function candles(base, email, interval, limit) {
  const res = await fetch(`${base}/api/candles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: email, email, symbol: SYM, interval, limit }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !Array.isArray(data.candles)) return [];
  return data.candles
    .map(c => ({ t: Number(c.t ?? c.time ?? c.openTime), o: +c.o, h: +c.h, l: +c.l, c: +c.c }))
    .filter(c => [c.t, c.o, c.h, c.l, c.c].every(Number.isFinite))
    .sort((a, b) => a.t - b.t);
}

// Kirim notifikasi ke semua perangkat, bahasa sesuai langganan masing-masing
function notifyAll(builder) {
  return sendPush(lang => ({ ...builder(lang), url: '/' })).catch(() => {});
}

async function nextPoiNo(now, seqState) {
  const day = utcDay(now);
  const seq = seqState.day === day ? seqState.seq + 1 : 1;
  return { poi_no: seq, state: { day, seq } };
}

async function botTick(req, res) {
  if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({ ok: false, msg: 'secret salah' });
  await ensureTables();
  const now = Date.now();
  const lock = await getState('lock', {});
  if (isLocked(lock, now)) return res.status(200).json({ ok: true, locked: true, until: lock.locked_until, reason: lock.lock_reason });
  if (lock.locked_until && now >= lock.locked_until) {
    lock.locked_until = null; lock.lock_reason = null; lock.consec_sl = 0;
    await setState('lock', lock);
  }

  const email = await pickSysEmail();
  if (!email) return res.status(200).json({ ok: false, msg: 'Tidak ada akun sistem aktif untuk ambil candle.' });
  const base = `https://${req.headers.host}`;
  const [m1r, m5r, m15r] = await Promise.all([
    candles(base, email, '1m', 600), candles(base, email, '5m', 300), candles(base, email, '15m', 300),
  ]);
  const m1 = closedBars(m1r, M1, now);
  const m5 = closedBars(m5r, M5, now);
  const m15 = closedBars(m15r, M15, now);
  if (m1.length < 10 || m5.length < 60 || m15.length < 60) {
    return res.status(200).json({ ok: false, msg: 'Data candle belum cukup.', n: { m1: m1.length, m5: m5.length, m15: m15.length } });
  }
  const price = m1[m1.length - 1].c;
  const newM5 = (await getState('last_m5', 0)) !== m5[m5.length - 1].t;
  const events = [];

  // Satu posisi aktif sekaligus
  const cur = (await db.query(
    `select * from bot_signals where side is not null and status in ('pending','open') order by id desc limit 1`
  )).rows[0];

  if (cur && cur.status === 'pending') {
    const sig = { ...cur, sym: SYM };
    const fill = checkFill({ dir: cur.side === 'BUY' ? 1 : -1, entry: cur.entry, placed_at: cur.placed_at, sym: SYM }, m1);
    if (fill) {
      await db.query(`update bot_signals set status = 'open', filled_at = $1 where id = $2`, [fill.filledAt, cur.id]);
      events.push(notifyAll(l => msgFilled(l, sig)));
    } else {
      const after = m5.filter(c => c.t >= cur.placed_at);
      const rev = reviewLimit({ dir: cur.side, placedAt: cur.placed_at }, after, m5);
      if (rev.action === 'cancel') {
        await db.query(`update bot_signals set status = 'closed', result = 'CANCEL', closed_at = $1 where id = $2`, [now, cur.id]);
        events.push(notifyAll(l => msgCancel(l, sig, rev.reason)));
      } else if (newM5) {
        const plan = planBot({ m15, m5, price, sym: SYM, tNow: now });
        if (plan.status !== 'limit') {
          await db.query(`update bot_signals set status = 'closed', result = 'CANCEL', closed_at = $1 where id = $2`, [now, cur.id]);
          events.push(notifyAll(l => msgCancel(l, sig, plan.reason || 'setup tidak valid lagi')));
        } else if (plan.poi.lo !== cur.poi_lo || plan.poi.hi !== cur.poi_hi || plan.poi.kind !== cur.poi_kind) {
          await db.query(
            `update bot_signals set poi_kind=$1, poi_lo=$2, poi_hi=$3, entry=$4, sl=$5, tp1=$6, tp2=$7, tp3=$8, side=$9, placed_at=$10 where id=$11`,
            [plan.poi.kind, plan.poi.lo, plan.poi.hi, plan.entry, plan.sl, plan.tp1, plan.tp2, plan.tp3,
             plan.dir, plan.placedAt, cur.id]
          );
          const moved = { ...sig, ...plan, side: plan.dir, sym: SYM, poi_no: cur.poi_no };
          events.push(notifyAll(l => msgMoved(l, moved, plan.poi.kind)));
        }
      }
    }
  } else if (cur && cur.status === 'open') {
    const trade = { side: cur.side, dir: cur.side === 'BUY' ? 1 : -1, entry: cur.entry, sl: cur.sl, tp1: cur.tp1, tp2: cur.tp2, tp3: cur.tp3, filled_at: cur.filled_at, sym: SYM, hits: cur.hits || {} };
    const tr = trackTrade(trade, m1);
    const sig = { ...cur, sym: SYM };
    if (tr.done) {
      await db.query(
        `update bot_signals set status='closed', result=$1, exit_price=$2, pips=$3, closed_at=$4, hits=$5 where id=$6`,
        [tr.result, tr.exit, tr.pips, now, JSON.stringify(tr.hits), cur.id]
      );
      events.push(notifyAll(l => msgResult(l, sig, tr.result, tr.pips)));
      const { state: nextLock, lock: why } = applyOutcome(lock, tr.outcome, now);
      if (why) {
        await setState('lock', nextLock);
        events.push(notifyAll(l => msgLock(l, nextLock.locked_until, why)));
      } else {
        await setState('lock', nextLock);
      }
    } else {
      if (tr.hits.tp1 && !(cur.hits || {}).tp1) {
        events.push(notifyAll(l => msgResult(l, sig, 'TP1', 0)));
        await db.query(`update bot_signals set hits=$1 where id=$2`, [JSON.stringify(tr.hits), cur.id]);
      }
    }
  } else if (newM5) {
    const plan = planBot({ m15, m5, price, sym: SYM, tNow: now });
    if (plan.status === 'limit') {
      const seq = await getState('poi_day', { day: '', seq: 0 });
      const { poi_no, state: nextSeq } = await nextPoiNo(now, seq);
      const ins = await db.query(
        `insert into bot_signals (side, sym, poi_no, poi_kind, poi_lo, poi_hi, entry, sl, tp1, tp2, tp3, status, mode, day, placed_at, hits)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13,$14,'{}'::jsonb) returning id`,
        [plan.dir, SYM, poi_no, plan.poi.kind, plan.poi.lo, plan.poi.hi, plan.entry, plan.sl, plan.tp1, plan.tp2, plan.tp3,
         plan.mode, nextSeq.day, plan.placedAt]
      );
      await setState('poi_day', nextSeq);
      const row = { id: ins.rows[0].id, poi_no, sym: SYM, side: plan.dir, entry: plan.entry, sl: plan.sl, tp1: plan.tp1, tp2: plan.tp2, tp3: plan.tp3 };
      events.push(notifyAll(l => msgPoi(l, row)));
    }
  }

  await setState('last_m5', m5[m5.length - 1].t);
  return res.status(200).json({ ok: true, events: events.length, price, newM5 });
}

async function botSignals(req, res) {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ ok: false, msg: 'email wajib' });
  const access = await checkAccess(email);
  if (!access.ok) return res.status(200).json({ ok: false, msg: 'Akses tidak aktif.' });
  await ensureTables();
  const rows = (await db.query(
    `select id, side, poi_no, poi_kind, entry, sl, tp1, tp2, tp3, status, result, pips, placed_at, closed_at, hits
     from bot_signals where side is not null order by id desc limit 50`
  )).rows;
  const lock = await getState('lock', {});
  const pending = (await db.query(`select id, side, poi_no, entry, sl, tp1, tp2, tp3 from bot_signals where side is not null and status = 'pending' order by id desc limit 1`)).rows[0] || null;
  const open = (await db.query(`select id, side, entry, sl, tp1, tp2, tp3 from bot_signals where side is not null and status = 'open' order by id desc limit 1`)).rows[0] || null;
  return res.status(200).json({ ok: true, signals: rows, lock: { locked_until: lock.locked_until ? new Date(lock.locked_until).toISOString() : null, lock_reason: lock.lock_reason || null }, pending, open });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const a = String(req.query?.a || '');
  try {
    if (a === 'tick') return botTick(req, res);
    if (a === 'signals') return botSignals(req, res);
    return res.status(404).json({ ok: false, msg: 'Unknown action' });
  } catch (err) {
    console.error('bot error:', err);
    return res.status(500).json({ ok: false, msg: 'Server error: ' + err.message });
  }
}
