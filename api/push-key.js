// api/push-key.js — kirim public key VAPID ke browser (public key memang tidak rahasia)
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const key = process.env.VAPID_PUBLIC_KEY || '';
  if (!key) return res.status(500).json({ ok: false, msg: 'VAPID_PUBLIC_KEY belum diisi di Vercel.' });
  return res.status(200).json({ ok: true, key });
}
