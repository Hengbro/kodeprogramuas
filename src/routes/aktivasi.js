const express = require('express');
const { db } = require('../db');
const lisensi = require('../lib/lisensi');
const { hashPassword } = require('../lib/password');
const { rateLimit } = require('../lib/rate-limit');

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

function sudahAktif(res) {
  return !!res.locals.settings.lisensi;
}

router.get('/aktivasi', (req, res) => {
  if (sudahAktif(res)) return res.redirect('/app');
  const data = req.session.kodeAktivasi ? lisensi.periksaKode(req.session.kodeAktivasi) : null;
  res.render('aktivasi', { title: 'Aktivasi', data, error: null, kode: '' });
});

router.post('/aktivasi', limiter, (req, res) => {
  if (sudahAktif(res)) return res.redirect('/app');
  const kode = lisensi.normalisasi(req.body.kode);
  const data = lisensi.periksaKode(kode);
  if (!data) {
    return res.status(400).render('aktivasi', {
      title: 'Aktivasi', data: null, kode: req.body.kode || '',
      error: 'Kode aktivasi tidak valid. Pastikan seluruh kode disalin utuh, termasuk awalan ERAPOR-.',
    });
  }
  req.session.kodeAktivasi = kode;
  res.redirect('/aktivasi');
});

router.post('/aktivasi/akun', limiter, (req, res) => {
  if (sudahAktif(res)) return res.redirect('/app');
  const kode = req.session.kodeAktivasi;
  const data = kode ? lisensi.periksaKode(kode) : null;
  if (!data) return res.redirect('/aktivasi');
  const nama = String(req.body.nama || '').trim();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  let error = null;
  if (!nama || !username) error = 'Nama dan nama pengguna wajib diisi.';
  else if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) error = 'Nama pengguna 3–30 karakter: huruf, angka, titik, garis bawah, atau tanda minus.';
  else if (password.length < 8) error = 'Kata sandi minimal 8 karakter.';
  else if (password !== req.body.password2) error = 'Ulangi kata sandi tidak sama.';
  if (error) return res.status(400).render('aktivasi', { title: 'Aktivasi', data, error, kode: '' });

  db.transaction(() => {
    const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    set.run('_lisensi', kode);
    set.run('nama_sekolah', data.sekolah);
    set.run('npsn', data.npsn);
    // akun bawaan "admin" diganti dengan akun milik sekolah
    const bawaan = db.prepare("SELECT id FROM users WHERE username = 'admin' AND role = 'admin'").get();
    const bentrok = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
    if (bawaan && (!bentrok || bentrok.id === bawaan.id)) {
      db.prepare('UPDATE users SET username = ?, password_hash = ?, nama = ?, nip = ? WHERE id = ?')
        .run(username, hashPassword(password), nama, String(req.body.nip || '').trim() || null, bawaan.id);
      req.session.userId = bawaan.id;
    } else if (bentrok) {
      db.prepare("UPDATE users SET password_hash = ?, nama = ?, role = 'admin' WHERE id = ?").run(hashPassword(password), nama, bentrok.id);
      req.session.userId = bentrok.id;
    } else {
      req.session.userId = db.prepare("INSERT INTO users (username, password_hash, nama, nip, role) VALUES (?, ?, ?, ?, 'admin')")
        .run(username, hashPassword(password), nama, String(req.body.nip || '').trim() || null).lastInsertRowid;
    }
  })();
  delete req.session.kodeAktivasi;
  req.flash('success', `Aplikasi berhasil diaktifkan untuk ${data.sekolah}. Silakan lengkapi profil sekolah.`);
  res.redirect('/app/sekolah');
});

module.exports = router;
