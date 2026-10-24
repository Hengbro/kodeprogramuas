// Panel superadmin (penyedia aplikasi): mengelola banyak sekolah dalam satu web.
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { DATA_DIR } = require('../db');
const master = require('../lib/master');
const { hashPassword, verifyPassword } = require('../lib/password');
const { rateLimit } = require('../lib/rate-limit');

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.use((req, res, next) => {
  res.locals.baseUrl = `${req.protocol}://${req.get('host')}`;
  next();
});

function superAkun(req) {
  return req.session.superId ? master.m().prepare('SELECT id, username, nama FROM superadmin WHERE id = ?').get(req.session.superId) : null;
}

function wajibSuper(req, res, next) {
  res.locals.superAkun = superAkun(req);
  if (!res.locals.superAkun) return res.redirect('/super/login');
  next();
}

function sekolahDari(req, res, next) {
  const s = master.cari(req.params.kode);
  if (!s) { req.flash('error', 'Sekolah tidak ditemukan.'); return res.redirect('/super'); }
  req.sek = s;
  next();
}

router.get('/login', (req, res) => {
  if (superAkun(req)) return res.redirect('/super');
  res.render('super/login', { title: 'Masuk Superadmin', error: null, username: '' });
});

router.post('/login', limiter, (req, res) => {
  const username = String(req.body.username || '').trim();
  const a = master.m().prepare('SELECT * FROM superadmin WHERE username = ?').get(username);
  if (!a || !verifyPassword(req.body.password || '', a.password_hash)) {
    return res.status(401).render('super/login', { title: 'Masuk Superadmin', error: 'Nama pengguna atau kata sandi salah.', username });
  }
  req.session.superId = a.id;
  res.redirect('/super');
});

router.post('/keluar', (req, res) => {
  delete req.session.superId;
  delete req.session.dariSuper;
  res.redirect('/super/login');
});

router.get('/', wajibSuper, (req, res) => {
  const daftar = master.daftar().map((s) => ({ ...s, stat: master.statistik(s) }));
  res.render('super/panel', { title: 'Panel Superadmin', daftar, hasil: null, offline: master.infoOffline() });
});

// ===== Versi offline (Windows) =====
router.post('/offline/kode', wajibSuper, (req, res) => {
  try {
    const l = master.buatLisensiOffline({ npsn: req.body.npsn, sekolah: req.body.sekolah, catatan: req.body.catatan });
    res.render('super/offline-hasil', { title: 'Kode aktivasi offline', l, offline: master.infoOffline() });
  } catch (e) {
    req.flash('error', e.message);
    res.redirect('/super#offline');
  }
});

router.get('/offline/:id', wajibSuper, (req, res) => {
  const l = master.m().prepare('SELECT * FROM lisensi_offline WHERE id = ?').get(req.params.id);
  if (!l) return res.redirect('/super#offline');
  res.render('super/offline-hasil', { title: 'Kode aktivasi offline', l, offline: master.infoOffline() });
});

router.get('/unduh/windows', wajibSuper, (req, res) => {
  if (!fs.existsSync(master.ZIP_WINDOWS)) { req.flash('error', 'Berkas ZIP Windows belum dibuat di server (jalankan scripts/build-windows.sh).'); return res.redirect('/super#offline'); }
  res.download(master.ZIP_WINDOWS, 'E-Rapor-SD-Windows.zip');
});

router.get('/unduh/panduan', wajibSuper, (req, res) => {
  if (!fs.existsSync(master.PANDUAN_PDF)) return res.redirect('/super#offline');
  res.download(master.PANDUAN_PDF, 'Panduan-Instalasi-E-Rapor-SD.pdf');
});

router.post('/sekolah', wajibSuper, (req, res) => {
  try {
    const r = master.buatSekolah({
      nama: req.body.nama, npsn: req.body.npsn, kode: req.body.kode,
      adminUsername: req.body.admin_username, adminPassword: req.body.admin_password, adminNama: req.body.admin_nama,
    });
    res.render('super/hasil', { title: 'Sekolah dibuat', judul: `Sekolah ${r.sekolah.nama} dibuat`, sekolah: r.sekolah, username: r.username, password: r.password });
  } catch (e) {
    req.flash('error', e.message);
    res.redirect('/super');
  }
});

router.post('/sekolah/:kode/ubah', wajibSuper, sekolahDari, (req, res) => {
  const nama = String(req.body.nama || '').trim() || req.sek.nama;
  const npsn = String(req.body.npsn || '').trim() || null;
  master.m().prepare('UPDATE sekolah SET nama = ?, npsn = ?, catatan = ? WHERE id = ?').run(nama, npsn, String(req.body.catatan || '').trim() || null, req.sek.id);
  // nama & NPSN di rapor ikut disamakan
  const d = master.dbSekolah(req.sek);
  const set = d.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  set.run('nama_sekolah', nama);
  set.run('npsn', npsn || '');
  req.flash('success', `Data ${nama} disimpan.`);
  res.redirect('/super');
});

router.post('/sekolah/:kode/aktif', wajibSuper, sekolahDari, (req, res) => {
  master.m().prepare('UPDATE sekolah SET aktif = 1 - aktif WHERE id = ?').run(req.sek.id);
  req.flash('success', req.sek.aktif ? `${req.sek.nama} dinonaktifkan: guru & admin sekolah tidak bisa masuk, portal orang tua ditutup.` : `${req.sek.nama} diaktifkan kembali.`);
  res.redirect('/super');
});

router.post('/sekolah/:kode/reset', wajibSuper, sekolahDari, (req, res) => {
  const d = master.dbSekolah(req.sek);
  const u = d.prepare('SELECT * FROM users WHERE id = ?').get(req.body.user_id);
  if (!u) { req.flash('error', 'Akun tidak ditemukan.'); return res.redirect('/super'); }
  const password = master.sandiAcak();
  d.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), u.id);
  res.render('super/hasil', { title: 'Kata sandi direset', judul: `Kata sandi ${u.username} (${req.sek.nama}) direset`, sekolah: req.sek, username: u.username, password });
});

router.post('/sekolah/:kode/admin', wajibSuper, sekolahDari, (req, res) => {
  const d = master.dbSekolah(req.sek);
  const username = String(req.body.username || '').trim();
  if (!username) { req.flash('error', 'Username wajib diisi.'); return res.redirect('/super'); }
  if (d.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) { req.flash('error', `Username ${username} sudah dipakai di sekolah ini.`); return res.redirect('/super'); }
  const password = master.sandiAcak();
  d.prepare("INSERT INTO users (username, password_hash, nama, role) VALUES (?, ?, ?, 'admin')").run(username, hashPassword(password), String(req.body.nama || '').trim() || username);
  res.render('super/hasil', { title: 'Admin ditambahkan', judul: `Admin ${username} ditambahkan ke ${req.sek.nama}`, sekolah: req.sek, username, password });
});

// Membuka aplikasi sekolah sebagai admin sekolah tersebut (untuk membantu/mengecek)
router.post('/sekolah/:kode/masuk', wajibSuper, sekolahDari, (req, res) => {
  if (!req.sek.aktif) { req.flash('error', 'Aktifkan sekolah terlebih dahulu.'); return res.redirect('/super'); }
  const admin = master.dbSekolah(req.sek).prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (!admin) { req.flash('error', 'Sekolah ini belum punya akun admin.'); return res.redirect('/super'); }
  delete req.session.publicStudentId;
  req.session.sekolah = req.sek.kode;
  req.session.userId = admin.id;
  req.session.dariSuper = true;
  res.redirect(`/sekolah/${req.sek.kode}/app`);
});

router.get('/sekolah/:kode/cadangan', wajibSuper, sekolahDari, async (req, res, next) => {
  try {
    const file = path.join(os.tmpdir(), `rapor-${req.sek.kode}-${Date.now()}.sqlite`);
    await master.dbSekolah(req.sek).backup(file);
    res.download(file, `rapor-${req.sek.kode}-${new Date().toISOString().slice(0, 10)}.sqlite`, () => fs.unlink(file, () => {}));
  } catch (e) { next(e); }
});

// Menghapus sekolah: berkas database dipindah ke folder data/terhapus (tidak langsung hilang)
router.post('/sekolah/:kode/hapus', wajibSuper, sekolahDari, (req, res) => {
  if (String(req.body.konfirmasi || '').trim().toLowerCase() !== req.sek.kode) {
    req.flash('error', `Ketik kode "${req.sek.kode}" untuk menghapus sekolah.`);
    return res.redirect('/super');
  }
  master.tutup(req.sek.kode);
  const asal = path.resolve(DATA_DIR, req.sek.file);
  const tujuan = path.join(DATA_DIR, 'terhapus');
  fs.mkdirSync(tujuan, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const akhiran of ['', '-wal', '-shm']) {
    if (fs.existsSync(asal + akhiran)) fs.renameSync(asal + akhiran, path.join(tujuan, `${req.sek.kode}-${stamp}.sqlite${akhiran}`));
  }
  master.m().prepare('DELETE FROM sekolah WHERE id = ?').run(req.sek.id);
  req.flash('success', `${req.sek.nama} dihapus. Berkas databasenya disimpan di folder data/terhapus.`);
  res.redirect('/super');
});

router.get('/akun', wajibSuper, (req, res) => res.render('super/akun', { title: 'Akun Superadmin' }));

router.post('/akun', wajibSuper, (req, res) => {
  const a = master.m().prepare('SELECT * FROM superadmin WHERE id = ?').get(req.session.superId);
  if (!verifyPassword(req.body.old_password || '', a.password_hash)) { req.flash('error', 'Kata sandi lama salah.'); return res.redirect('/super/akun'); }
  if (String(req.body.new_password || '').length < 8) { req.flash('error', 'Kata sandi baru minimal 8 karakter.'); return res.redirect('/super/akun'); }
  master.m().prepare('UPDATE superadmin SET password_hash = ? WHERE id = ?').run(hashPassword(req.body.new_password), a.id);
  const awal = path.join(DATA_DIR, 'superadmin-awal.txt');
  if (fs.existsSync(awal)) fs.unlinkSync(awal);
  req.flash('success', 'Kata sandi superadmin diganti.');
  res.redirect('/super');
});

module.exports = router;
