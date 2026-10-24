const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { db } = require('../../db');
const { requireAdmin, allowedClasses } = require('../../lib/auth');
const { exportPaket, parsePaket, ringkas, importPaket, exportPaketGuru } = require('../../lib/paket');
const { writeZip, listFiles } = require('../../lib/zip');
const { NAMA: NAMA_PAKET_AWAL } = require('../../lib/paket-otomatis');

const router = express.Router();

// Folder paket Windows: <root>/app (kode ini), <root>/node/node.exe, <root>/Jalankan-Rapor.bat
const APP_DIR = path.join(__dirname, '..', '..', '..');
const ROOT = path.dirname(APP_DIR);
function paketWindowsTersedia() {
  return fs.existsSync(path.join(ROOT, 'node', 'node.exe')) && fs.existsSync(path.join(ROOT, 'Jalankan-Rapor.bat'));
}

function guruList() {
  return db.prepare(`SELECT u.id, u.nama, u.username, (SELECT GROUP_CONCAT(nama, ', ') FROM classes WHERE guru_id = u.id) AS kelas
    FROM users u WHERE u.role = 'guru' ORDER BY u.nama`).all();
}

router.get('/paket', (req, res) => {
  const isAdmin = res.locals.user.role === 'admin';
  const classes = isAdmin
    ? db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = 'aktif') AS jumlah
      FROM classes c ORDER BY tingkat, nama`).all()
    : allowedClasses(res.locals.user).map((c) => ({ ...c, jumlah: c.jumlah_siswa }));
  res.render('app/paket', {
    title: isAdmin ? 'Paket Data' : 'Kirim Data ke Admin', classes, isAdmin,
    gurus: isAdmin ? guruList() : [], windows: paketWindowsTersedia(),
  });
});

router.get('/paket/ekspor', (req, res) => {
  const isAdmin = res.locals.user.role === 'admin';
  const boleh = new Set(allowedClasses(res.locals.user).map((c) => c.id));
  const kelas = [].concat(req.query.kelas || []).map(Number).filter((id) => id && boleh.has(id));
  const sekolah = isAdmin && !!req.query.sekolah;
  if (!sekolah && !kelas.length) {
    req.flash('error', 'Pilih minimal satu isi paket.');
    return res.redirect('/app/paket');
  }
  const awal = isAdmin && req.query.isi === 'awal';
  const pkg = exportPaket({ sekolah, kelas, denganNilai: !awal });
  const namaKelas = pkg.kelas.map((k) => k.nama.replace(/\s+/g, '')).join('-');
  const file = `${awal ? 'paket-awal' : 'paket-data'}${namaKelas ? `-${namaKelas}` : ''}-${new Date().toISOString().slice(0, 10)}.rapor.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
  res.send(JSON.stringify(pkg));
});

// ===== Bagikan aplikasi ke guru =====
function guruTerpilih(req) {
  const gurus = guruList();
  if (req.query.guru === 'semua') return gurus;
  return gurus.filter((g) => String(g.id) === String(req.query.guru));
}

router.get('/paket/guru', requireAdmin, (req, res, next) => {
  const gurus = guruTerpilih(req);
  if (!gurus.length) { req.flash('error', 'Pilih guru terlebih dahulu.'); return res.redirect('/app/paket#bagikan'); }
  const pkg = exportPaketGuru(gurus.map((g) => g.id));
  const label = gurus.length === 1 ? gurus[0].username : 'semua-guru';

  if (req.query.bentuk !== 'zip') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${NAMA_PAKET_AWAL.replace('.rapor.json', '')}-${label}.rapor.json"`);
    return res.send(JSON.stringify(pkg));
  }
  if (!paketWindowsTersedia()) {
    req.flash('error', 'ZIP aplikasi hanya bisa dibuat dari aplikasi versi Windows. Unduh file paketnya saja.');
    return res.redirect('/app/paket#bagikan');
  }
  try {
    const folder = `E-Rapor-SD-${label}`;
    const entries = [];
    for (const name of fs.readdirSync(ROOT)) {
      const abs = path.join(ROOT, name);
      // aplikasi yang dipasang lewat pemasang: jangan ikutkan program penghapus & pemasang
      if (name === 'data' || /\.zip$/i.test(name) || (/\.exe$/i.test(name) && name !== 'Pasang-E-Rapor-SD.exe')) continue;
      if (fs.statSync(abs).isDirectory()) {
        for (const [rel, file] of listFiles(abs, name)) entries.push({ name: `${folder}/${rel}`, file });
      } else {
        entries.push({ name: `${folder}/${name}`, file: abs });
      }
    }
    entries.push({ name: `${folder}/data/${NAMA_PAKET_AWAL}`, data: JSON.stringify(pkg) });
    const tmp = path.join(os.tmpdir(), `${folder}-${Date.now()}.zip`);
    writeZip(tmp, entries);
    res.download(tmp, `${folder}.zip`, () => fs.unlink(tmp, () => {}));
  } catch (e) { next(e); }
});

router.post('/paket/periksa', requireAdmin, (req, res) => {
  try {
    const pkg = parsePaket(req.body.isi);
    res.render('app/paket-periksa', { title: 'Periksa Paket Data', info: ringkas(pkg), isi: req.body.isi });
  } catch (e) {
    req.flash('error', e.message);
    res.redirect('/app/paket');
  }
});

router.post('/paket/impor', requireAdmin, (req, res) => {
  try {
    const pkg = parsePaket(req.body.isi);
    const hasil = importPaket(pkg, {
      sekolah: !!req.body.sekolah,
      aktifkanPeriode: !!req.body.aktifkan,
      kelas: [].concat(req.body.kelas || []),
    });
    res.render('app/paket-hasil', { title: 'Impor Selesai', hasil });
  } catch (e) {
    console.error(e);
    req.flash('error', `Impor gagal: ${e.message}`);
    res.redirect('/app/paket');
  }
});

module.exports = router;
