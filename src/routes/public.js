const express = require('express');
const { db } = require('../db');
const { buildStudentRapor, buildProjectRapor } = require('../lib/rapor');
const { rateLimit } = require('../lib/rate-limit');

const router = express.Router();
const cekLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

function portalEnabled(res) {
  return res.locals.settings.public_portal === '1';
}

router.get('/', (req, res) => {
  const stats = {
    siswa: db.prepare("SELECT COUNT(*) n FROM students WHERE status = 'aktif'").get().n,
    kelas: db.prepare('SELECT COUNT(*) n FROM classes').get().n,
    guru: db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'guru'").get().n,
  };
  res.render('home', { title: 'Beranda', stats, error: null, portal: portalEnabled(res) });
});

router.post('/cek-rapor', cekLimiter, (req, res) => {
  if (!portalEnabled(res)) return res.redirect('/');
  const nisn = String(req.body.nisn || '').trim();
  const tgl = String(req.body.tanggal_lahir || '').trim();
  const st = nisn && tgl
    ? db.prepare('SELECT id FROM students WHERE (nisn = ? OR nis = ?) AND tanggal_lahir = ?').get(nisn, nisn, tgl)
    : null;
  if (!st) {
    return res.status(404).render('home', {
      title: 'Beranda', stats: null, portal: true,
      error: 'Data tidak ditemukan. Periksa kembali NISN/NIS dan tanggal lahir.',
    });
  }
  req.session.publicStudentId = st.id;
  res.redirect('/rapor-saya');
});

router.get('/rapor-saya', (req, res) => {
  const id = req.session.publicStudentId;
  if (!id || !portalEnabled(res)) return res.redirect('/');
  const student = db.prepare('SELECT id, nama, nisn, nis FROM students WHERE id = ?').get(id);
  if (!student) return res.redirect('/');
  const periods = db.prepare(`SELECT p.* FROM periods p WHERE p.is_published = 1
    AND EXISTS (SELECT 1 FROM rapor_siswa rs WHERE rs.period_id = p.id AND rs.student_id = ?)
    ORDER BY p.tahun_pelajaran DESC, p.semester DESC`).all(student.id);
  const projectCount = db.prepare('SELECT period_id, COUNT(*) n FROM projects GROUP BY period_id').all();
  const hasProject = new Set(projectCount.filter((p) => p.n > 0).map((p) => p.period_id));
  res.render('public-rapor-list', { title: 'Rapor Saya', student, periods, hasProject });
});

router.get('/rapor-saya/:periodId/:jenis', (req, res) => {
  const id = req.session.publicStudentId;
  if (!id || !portalEnabled(res)) return res.redirect('/');
  const period = db.prepare(`SELECT p.* FROM periods p WHERE p.id = ? AND p.is_published = 1
    AND EXISTS (SELECT 1 FROM rapor_siswa rs WHERE rs.period_id = p.id AND rs.student_id = ?)`).get(req.params.periodId, id);
  if (!period) return res.redirect('/rapor-saya');
  const jenis = req.params.jenis === 'projek' ? 'projek' : 'akhir';
  const data = jenis === 'projek' ? buildProjectRapor(period.id, id) : buildStudentRapor(period.id, id);
  if (!data || !data.cls) return res.redirect('/rapor-saya');
  res.render('print/doc', {
    title: `Rapor ${data.student.nama}`, items: [data], kind: jenis, partial: jenis === 'projek' ? 'projek' : 'rapor',
    parts: ['nilai'], back: '/rapor-saya',
  });
});

router.post('/keluar-portal', (req, res) => {
  delete req.session.publicStudentId;
  res.redirect('/');
});

module.exports = router;
