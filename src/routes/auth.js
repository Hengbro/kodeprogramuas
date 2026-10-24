const express = require('express');
const { db } = require('../db');
const { verifyPassword } = require('../lib/password');
const { rateLimit } = require('../lib/rate-limit');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

/** Mode banyak sekolah: sesi dipindah ke sekolah yang baru saja dimasuki (akun/siswa sekolah lain dilepas). */
function pakaiSekolah(req, res) {
  if (!res.locals.multi) return;
  const kode = res.locals.sekolah.kode;
  if (req.session.sekolah !== kode) { delete req.session.userId; delete req.session.publicStudentId; delete req.session.dariSuper; }
  req.session.sekolah = kode;
  req.session.terakhir = kode;
}

function sekolahTidakAda(res, username) {
  return res.status(404).render('login', { title: 'Masuk', error: 'Kode sekolah tidak ditemukan atau sedang dinonaktifkan. Tanyakan kode sekolah kepada penyedia aplikasi.', username });
}

router.get('/login', (req, res) => {
  if (res.locals.user) return res.redirect('/app');
  res.render('login', { title: 'Masuk', error: null, username: '' });
});

router.post('/login', loginLimiter, (req, res) => {
  if (res.locals.multi && !res.locals.sekolah) return sekolahTidakAda(res, String(req.body.username || ''));
  const username = String(req.body.username || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(req.body.password || '', user.password_hash)) {
    return res.status(401).render('login', { title: 'Masuk', error: 'Nama pengguna atau kata sandi salah.', username });
  }
  const returnTo = req.session.returnTo;
  pakaiSekolah(req, res);
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
  if (res.locals.multi && !res.locals.sekolah) {
    return res.status(404).render('sesi-habis', { title: 'Sesi berakhir', tujuan, data: JSON.stringify(data), error: 'Kode sekolah tidak ditemukan.', username: String(req.body.username || '') });
  }
  const username = String(req.body.username || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(req.body.password || '', user.password_hash)) {
    return res.status(401).render('sesi-habis', { title: 'Sesi berakhir', tujuan, data: JSON.stringify(data), error: 'Nama pengguna atau kata sandi salah.', username });
  }
  pakaiSekolah(req, res);
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
  // superadmin yang sedang membuka sekolah kembali ke panelnya
  if (req.session.superId && req.session.dariSuper) {
    delete req.session.userId; delete req.session.dariSuper; delete req.session.sekolah;
    return res.redirect('/super');
  }
  const terakhir = req.session.sekolah;
  req.session = terakhir ? { terakhir } : null;
  // mode banyak sekolah: redirect '/login' otomatis berawalan /sekolah/<kode>
  res.redirect('/login');
});

router.pakaiSekolah = pakaiSekolah;

module.exports = router;
