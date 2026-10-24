const express = require('express');
const { db } = require('../db');
const { buildStudentRapor, buildProjectRapor } = require('../lib/rapor');
const { rateLimit } = require('../lib/rate-limit');

const router = express.Router();
const cekLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

function portalEnabled(res) {
  return res.locals.settings.public_portal === '1';
}

// ===== Portal orang tua =====
// Anak yang sudah diverifikasi (NISN/NIS + tanggal lahir) disimpan di sesi browser orang tua,
// sehingga satu orang tua bisa memantau beberapa anak — juga di sekolah berbeda (mode banyak sekolah).
const MAKS_ANAK = 10;
const kodeIni = (res) => (res.locals.sekolah ? res.locals.sekolah.kode : '');
const daftarAnak = (req) => (Array.isArray(req.session.anak) ? req.session.anak : []);
/** Alamat rapor seorang anak (lengkap dengan awalan sekolahnya). */
const urlAnak = (a) => `${a.s ? `/sekolah/${a.s}` : ''}/rapor-saya/${a.id}`;

function anakDiSekolahIni(req, res, id) {
  return daftarAnak(req).find((a) => a.s === kodeIni(res) && String(a.id) === String(id));
}

router.get('/', (req, res) => {
  // mode banyak sekolah tanpa alamat sekolah: orang tua memakai tautan/kode dari sekolah
  if (res.locals.multi && !res.locals.sekolah) {
    return res.render('pilih-sekolah', { title: 'E-Rapor SD', anak: daftarAnak(req), urlAnak, error: null });
  }
  const stats = {
    siswa: db.prepare("SELECT COUNT(*) n FROM students WHERE status = 'aktif'").get().n,
    kelas: db.prepare('SELECT COUNT(*) n FROM classes').get().n,
    guru: db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'guru'").get().n,
  };
  res.render('home', { title: 'Beranda', stats, error: null, portal: portalEnabled(res), anak: daftarAnak(req), urlAnak });
});

router.get('/pilih-sekolah', (req, res) => {
  if (!res.locals.multi) return res.redirect('/');
  res.render('pilih-sekolah', { title: 'E-Rapor SD', anak: daftarAnak(req), urlAnak, error: req.query.salah ? 'Kode sekolah tidak ditemukan.' : null });
});

// Daftar semua anak yang sedang dipantau orang tua (lintas sekolah)
router.get('/anak', (req, res) => {
  const anak = daftarAnak(req);
  if (!anak.length) return res.redirect('/');
  res.render('public-anak', { title: 'Rapor Anak Saya', anak, urlAnak });
});

router.post('/cek-rapor', cekLimiter, (req, res) => {
  if (res.locals.multi && !res.locals.sekolah) return res.redirect('/');
  if (!portalEnabled(res)) return res.redirect('/');
  const nisn = String(req.body.nisn || '').trim();
  const tgl = String(req.body.tanggal_lahir || '').trim();
  const st = nisn && tgl
    ? db.prepare('SELECT id, nama FROM students WHERE (nisn = ? OR nis = ?) AND tanggal_lahir = ?').get(nisn, nisn, tgl)
    : null;
  if (!st) {
    return res.status(404).render('home', {
      title: 'Beranda', stats: null, portal: true, anak: daftarAnak(req), urlAnak,
      error: 'Data tidak ditemukan. Periksa kembali NISN/NIS dan tanggal lahir.',
    });
  }
  const s = kodeIni(res);
  const anak = daftarAnak(req).filter((a) => !(a.s === s && a.id === st.id));
  anak.unshift({ s, id: st.id, nama: st.nama, sekolah: res.locals.settings.nama_sekolah });
  req.session.anak = anak.slice(0, MAKS_ANAK);
  res.redirect(`/rapor-saya/${st.id}`);
});

router.get('/rapor-saya', (req, res) => {
  const a = daftarAnak(req).find((x) => x.s === kodeIni(res));
  res.redirect(a ? `/rapor-saya/${a.id}` : '/');
});

router.get('/rapor-saya/:anakId', (req, res) => {
  if (!portalEnabled(res)) return res.redirect('/');
  const a = anakDiSekolahIni(req, res, req.params.anakId);
  if (!a) return res.redirect('/');
  const student = db.prepare('SELECT id, nama, nisn, nis FROM students WHERE id = ?').get(a.id);
  if (!student) return res.redirect('/');
  const periods = db.prepare(`SELECT p.* FROM periods p WHERE p.is_published = 1
    AND EXISTS (SELECT 1 FROM rapor_siswa rs WHERE rs.period_id = p.id AND rs.student_id = ?)
    ORDER BY p.tahun_pelajaran DESC, p.semester DESC`).all(student.id);
  const projectCount = db.prepare('SELECT period_id, COUNT(*) n FROM projects GROUP BY period_id').all();
  const hasProject = new Set(projectCount.filter((p) => p.n > 0).map((p) => p.period_id));
  res.render('public-rapor-list', { title: 'Rapor Anak', student, periods, hasProject, anak: daftarAnak(req), urlAnak, aktif: a });
});

router.get('/rapor-saya/:anakId/:periodId/:jenis', (req, res) => {
  if (!portalEnabled(res)) return res.redirect('/');
  const a = anakDiSekolahIni(req, res, req.params.anakId);
  if (!a) return res.redirect('/');
  const period = db.prepare(`SELECT p.* FROM periods p WHERE p.id = ? AND p.is_published = 1
    AND EXISTS (SELECT 1 FROM rapor_siswa rs WHERE rs.period_id = p.id AND rs.student_id = ?)`).get(req.params.periodId, a.id);
  if (!period) return res.redirect(`/rapor-saya/${a.id}`);
  const jenis = req.params.jenis === 'projek' ? 'projek' : 'akhir';
  const data = jenis === 'projek' ? buildProjectRapor(period.id, a.id) : buildStudentRapor(period.id, a.id);
  if (!data || !data.cls) return res.redirect(`/rapor-saya/${a.id}`);
  res.render('print/doc', {
    title: `Rapor ${data.student.nama}`, items: [data], kind: jenis, partial: jenis === 'projek' ? 'projek' : 'rapor',
    parts: ['nilai'], back: `/rapor-saya/${a.id}`,
  });
});

// Keluar dari portal: semua anak yang tersimpan di browser ini dilupakan
router.post('/keluar-portal', (req, res) => {
  delete req.session.anak;
  delete req.session.publicStudentId;
  res.redirect('/');
});

module.exports = router;
