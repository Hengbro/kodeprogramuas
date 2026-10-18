const express = require('express');
const { db } = require('../../db');
const { requireAdmin } = require('../../lib/auth');
const { hashPassword, verifyPassword } = require('../../lib/password');
const { str } = require('./_util');

const router = express.Router();

router.get('/pengguna', requireAdmin, (req, res) => {
  const users = db.prepare(`SELECT u.*, (SELECT GROUP_CONCAT(nama, ', ') FROM classes WHERE guru_id = u.id) AS kelas
    FROM users u ORDER BY u.role, u.nama`).all();
  res.render('app/pengguna', { title: 'Pengguna & Guru', users });
});

router.post('/pengguna', requireAdmin, (req, res) => {
  const username = str(req.body.username);
  const nama = str(req.body.nama);
  const password = String(req.body.password || '');
  if (!username || !nama || password.length < 6) {
    req.flash('error', 'Nama, username, dan kata sandi (min. 6 karakter) wajib diisi.');
    return res.redirect('/app/pengguna');
  }
  try {
    db.prepare('INSERT INTO users (username, password_hash, nama, nip, role) VALUES (?, ?, ?, ?, ?)')
      .run(username, hashPassword(password), nama, str(req.body.nip), req.body.role === 'admin' ? 'admin' : 'guru');
    req.flash('success', `Pengguna ${username} ditambahkan.`);
  } catch {
    req.flash('error', 'Username sudah dipakai.');
  }
  res.redirect('/app/pengguna');
});

router.post('/pengguna/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.redirect('/app/pengguna');
  if (req.body.action === 'delete') {
    if (u.id === res.locals.user.id) req.flash('error', 'Tidak dapat menghapus akun sendiri.');
    else { db.prepare('DELETE FROM users WHERE id = ?').run(u.id); req.flash('success', 'Pengguna dihapus.'); }
    return res.redirect('/app/pengguna');
  }
  const role = u.id === res.locals.user.id ? u.role : (req.body.role === 'admin' ? 'admin' : 'guru');
  db.prepare('UPDATE users SET nama = ?, nip = ?, role = ? WHERE id = ?').run(str(req.body.nama) || u.nama, str(req.body.nip), role, u.id);
  if (req.body.password && String(req.body.password).length < 6) {
    req.flash('error', 'Data disimpan, tetapi kata sandi tidak diubah (minimal 6 karakter).');
  } else {
    if (req.body.password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.password), u.id);
    req.flash('success', 'Data pengguna diperbarui.');
  }
  res.redirect('/app/pengguna');
});

router.get('/akun', (req, res) => res.render('app/akun', { title: 'Akun Saya' }));

router.post('/akun', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(res.locals.user.id);
  db.prepare('UPDATE users SET nama = ?, nip = ? WHERE id = ?').run(str(req.body.nama) || u.nama, str(req.body.nip), u.id);
  if (req.body.new_password) {
    if (!verifyPassword(req.body.old_password || '', u.password_hash)) {
      req.flash('error', 'Kata sandi lama salah.');
      return res.redirect('/app/akun');
    }
    if (String(req.body.new_password).length < 6) {
      req.flash('error', 'Kata sandi baru minimal 6 karakter.');
      return res.redirect('/app/akun');
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.new_password), u.id);
  }
  req.flash('success', 'Akun diperbarui.');
  res.redirect('/app/akun');
});

module.exports = router;
