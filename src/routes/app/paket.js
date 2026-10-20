const express = require('express');
const { db } = require('../../db');
const { requireAdmin } = require('../../lib/auth');
const { exportPaket, parsePaket, ringkas, importPaket } = require('../../lib/paket');

const router = express.Router();

router.get('/paket', requireAdmin, (req, res) => {
  const classes = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = 'aktif') AS jumlah
    FROM classes c ORDER BY tingkat, nama`).all();
  res.render('app/paket', { title: 'Paket Data', classes });
});

router.get('/paket/ekspor', requireAdmin, (req, res) => {
  const kelas = [].concat(req.query.kelas || []).map(Number).filter(Boolean);
  const sekolah = !!req.query.sekolah;
  if (!sekolah && !kelas.length) {
    req.flash('error', 'Pilih minimal satu isi paket.');
    return res.redirect('/app/paket');
  }
  const pkg = exportPaket({ sekolah, kelas, denganNilai: req.query.isi !== 'awal' });
  const namaKelas = pkg.kelas.map((k) => k.nama.replace(/\s+/g, '')).join('-');
  const jenis = req.query.isi === 'awal' ? 'paket-awal' : 'paket-data';
  const file = `${jenis}${namaKelas ? `-${namaKelas}` : ''}-${new Date().toISOString().slice(0, 10)}.rapor.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
  res.send(JSON.stringify(pkg));
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
