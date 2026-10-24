const express = require('express');
const { db } = require('../db');
const { verifyPassword } = require('../lib/password');
const { rateLimit } = require('../lib/rate-limit');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.get('/login', (req, res) => {
  if (res.locals.user) return res.redirect('/app');
  res.render('login', { title: 'Masuk', error: null, username: '' });
});

router.post('/login', loginLimiter, (req, res) => {
  const username = String(req.body.username || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(req.body.password || '', user.password_hash)) {
    return res.status(401).render('login', { title: 'Masuk', error: 'Nama pengguna atau kata sandi salah.', username });
  }
  const returnTo = req.session.returnTo;
  req.session.userId = user.id;
  delete req.session.returnTo;
  res.redirect(returnTo && returnTo.startsWith('/app') ? returnTo : '/app');
});

// Login ulang dari halaman "Sesi berakhir", lalu isian yang tertunda diproses seperti dikirim biasa
router.post('/lanjutkan', loginLimiter, (req, res) => {
  const tujuan = String(req.body._tujuan || '');
  let data;
  try { data = JSON.parse(String(req.body._data || '{}')); } catch { data = null; }
  if (!tujuan.startsWith('/app/') || !data || typeof data !== 'object' || Array.isArray(data)) return res.redirect('/login');
  const username = String(req.body.username || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(req.body.password || '', user.password_hash)) {
    return res.status(401).render('sesi-habis', { title: 'Sesi berakhir', tujuan, data: JSON.stringify(data), error: 'Nama pengguna atau kata sandi salah.', username });
  }
  req.session.userId = user.id;
  res.render('kirim-ulang', { title: 'Menyimpan…', tujuan, fields: ratakan(data) });
});

/** Objek hasil body-parser → daftar [nama, nilai] yang menghasilkan objek yang sama saat dikirim ulang. */
function ratakan(obj, awalan = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const nama = awalan ? `${awalan}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x) => (x && typeof x === 'object' ? ratakan(x, nama, out) : out.push([nama, String(x)])));
    else if (v && typeof v === 'object') ratakan(v, nama, out);
    else out.push([nama, String(v ?? '')]);
  }
  return out;
}

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

module.exports = router;
