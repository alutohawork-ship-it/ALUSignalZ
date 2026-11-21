// api/notices.js — notifikasi (bell) untuk klien: dibaca publik, ditulis/dihapus admin
// Env: DATABASE_URL, ADMIN_CODE
import { db } from '../lib/db.js';
import { sendPush } from '../lib/push.js';

function isAdmin(req) {
  const code = process.env.ADMIN_CODE;
  return !!code && req.headers['x-admin-code'] === code;
}

async function ensureTable() {
  await db.query(`create table if not exists notices (
    id serial primary key,
    title text not null,
    body text not null,
    created_at timestamptz not null default now()
  )`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-code');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    await ensureTable();
    await db.query(`alter table notices add column if not exists title_en text`);
    await db.query(`alter table notices add column if not exists body_en text`);

    // ── BACA NOTIFIKASI (klien) ──
    if (req.method === 'GET') {
      const r = await db.query('select id, title, body, title_en, body_en, created_at from notices order by id desc limit 200');
      return res.status(200).json(r.rows);
    }

    if (!isAdmin(req)) return res.status(401).json({ ok: false, msg: 'Kode admin salah.' });

    // ── TAMBAH NOTIFIKASI (admin) ──
    if (req.method === 'POST') {
      let body = req.body || {};
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const title = String(body.title || '').trim().slice(0, 120);
      const text = String(body.body || '').trim().slice(0, 1000);
      // Versi Inggris opsional; kalau kosong dipakai versi Indonesia
      const titleEn = String(body.title_en || '').trim().slice(0, 120) || title;
      const textEn = String(body.body_en || '').trim().slice(0, 1000) || text;
      if (!title || !text) return res.status(200).json({ ok: false, msg: 'Judul dan isi wajib diisi.' });
      // Cegah duplikat: judul+isi yang sama dalam 10 menit terakhir tidak disimpan ulang
      const dup = await db.query(
        `select id from notices where title = $1 and body = $2 and created_at > now() - interval '10 minutes' limit 1`,
        [title, text]
      );
      if (dup.rows.length) return res.status(200).json({ ok: true, msg: 'Notifikasi sudah ada (duplikat diabaikan).' });
      await db.query('insert into notices (title, body, title_en, body_en) values ($1, $2, $3, $4)', [title, text, titleEn, textEn]);
      // Kirim juga sebagai push ke perangkat yang sudah mengaktifkan notifikasi (gagal push tidak membatalkan notifikasi)
      sendPush({ title: '🔔 ' + title, body: text.slice(0, 200), url: '/' }).catch(e => console.error('push gagal:', e.message));
      return res.status(200).json({ ok: true, msg: 'Notifikasi ditambahkan.' });
    }

    // ── HAPUS NOTIFIKASI (admin) ──
    if (req.method === 'DELETE') {
      const id = Number(req.query?.id);
      if (!Number.isInteger(id)) return res.status(200).json({ ok: false, msg: 'ID tidak valid.' });
      await db.query('delete from notices where id = $1', [id]);
      return res.status(200).json({ ok: true, msg: 'Notifikasi dihapus.' });
    }

    return res.status(405).json({ ok: false, msg: 'Method not allowed' });
  } catch (err) {
    console.error('notices error:', err);
    return res.status(500).json({ ok: false, msg: 'Server error: ' + err.message });
  }
}
