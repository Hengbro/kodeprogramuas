const express = require('express');
const { db } = require('../../db');
const { requireAdmin } = require('../../lib/auth');
const { hashPassword, verifyPassword } = require('../../lib/password');
const { str } = require('./_util');
const { sandiAcak } = require('../../lib/sandi-acak');

const router = express.Router();

router.get('/pengguna', requireAdmin, (req, res) => {
  const users = db.prepare(`SELECT u.*, (SELECT GROUP_CONCAT(nama, ', ') FROM classes WHERE guru_id = u.id) AS kelas
    FROM users u ORDER BY u.role, u.nama`).all();
  res.render('app/pengguna', { title: 'Pengguna & Guru', users });
});

router.post('/pengguna', requireAdmin, (req, res) => {
  // satu atau banyak baris: nama__0, nip__0, username__0, password__0, role__0, ...
  const n = req.body.n ? Math.min(200, Number(req.body.n) || 0) : 1;
  const ambil = (k, i) => (req.body.n ? req.body[`${k}__${i}`] : req.body[k]);
  const ins = db.prepare('INSERT INTO users (username, password_hash, nama, nip, role) VALUES (?, ?, ?, ?, ?)');
  const ada = db.prepare('SELECT 1 FROM users WHERE username = ?');
  const masuk = []; const gagal = [];
  for (let i = 0; i < n; i += 1) {
    const username = str(ambil('username', i));
    const nama = str(ambil('nama', i));
    let password = String(ambil('password', i) || '');
    if (!username && !nama && !password) continue;
    const label = username || nama;
    // sandi dikosongkan → dibuat acak dan ditampilkan sekali
    const acak = !password;
    if (acak) password = sandiAcak();
    if (!username || !nama || password.length < 6) { gagal.push(`${label} (nama, username, dan kata sandi min. 6 karakter wajib)`); continue; }
    if (ada.get(username)) { gagal.push(`${username} (username sudah dipakai)`); continue; }
    ins.run(username, hashPassword(password), nama, str(ambil('nip', i)), ambil('role', i) === 'admin' ? 'admin' : 'guru');
    masuk.push(acak ? `${username} (sandi: ${password})` : username);
  }
  const catat = masuk.some((x) => x.includes('(sandi:')) ? ' Catat kata sandi yang dibuat otomatis sekarang — hanya ditampilkan sekali.' : '';
  if (gagal.length) req.flash('error', `${masuk.length ? `Ditambahkan: ${masuk.join(', ')}.${catat} ` : ''}Tidak disimpan: ${gagal.join('; ')}.`);
  else if (masuk.length) req.flash('success', `Pengguna ditambahkan: ${masuk.join(', ')}.${catat}`);
  else req.flash('error', 'Nama dan username wajib diisi.');
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
  if (req.body.action === 'sandi_acak') {
    const sandi = sandiAcak();
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(sandi), u.id);
    req.flash('success', `Kata sandi baru untuk ${u.username}: ${sandi} — catat sekarang, hanya ditampilkan sekali.`);
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
