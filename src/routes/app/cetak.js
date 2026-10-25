const express = require('express');
const { db } = require('../../db');
const { canAccessClass } = require('../../lib/auth');
const {
  buildClassReport, buildStudentRapor, buildProjectRapor, buildBukuInduk, studentsOfClass, legerColumns, legerValue, getPeriod, classOfStudent, getSettings,
} = require('../../lib/rapor');
const { toCSV } = require('../../lib/csv');
const { loadClass, workingPeriod } = require('./_util');

const router = express.Router();
const { requireAdmin } = require('../../lib/auth');
const TEMPLATE_PIAGAM = ['Klasik biru', 'Elegan emas', 'Modern pita samping', 'Sudut ornamen', 'Pita judul', 'Bingkai tebal', 'Gradasi warna', 'Minimalis', 'Ceria anak', 'Pola garis formal'];
const nomorTpl = (v) => { const n = Number(v); return n >= 1 && n <= TEMPLATE_PIAGAM.length ? n : null; };

const KINDS = {
  akhir: { label: 'Rapor Akhir Semester', partial: 'rapor' },
  tts: { label: 'Rapor Tengah Semester', partial: 'tts' },
  projek: { label: 'Rapor Projek P5', partial: 'projek' },
  piagam: { label: 'Piagam Penghargaan', partial: 'piagam' },
  induk: { label: 'Buku Induk', partial: 'induk' },
  pindah: { label: 'Keterangan Pindah Sekolah', partial: 'pindah' },
};
const PARTS = ['cover', 'sekolah', 'identitas', 'nilai'];

function buildFor(kind, periodId, studentId) {
  if (kind === 'induk') return buildBukuInduk(studentId);
  return kind === 'projek' ? buildProjectRapor(periodId, studentId) : buildStudentRapor(periodId, studentId);
}

function parseParts(q) {
  const p = [].concat(q.part || []).filter((x) => PARTS.includes(x));
  return p.length ? p : ['nilai'];
}

// ===== Leger nilai =====
router.get('/kelas/:classId/leger', loadClass, (req, res) => {
  const period = workingPeriod(req, res);
  const report = buildClassReport(period.id, req.cls.id);
  const cols = legerColumns(report.subjects);
  if (req.query.format === 'csv') {
    const rows = [['No', 'NIS', 'NISN', 'Nama', ...cols.map((c) => c.nama), 'Jumlah', 'Rata-rata', 'Peringkat']];
    report.students.forEach((r, i) => rows.push([i + 1, r.student.nis, r.student.nisn, r.student.nama,
      ...cols.map((c) => legerValue(r, c) ?? ''), r.jumlah ?? '', r.rata != null ? r.rata.toFixed(2) : '', r.rank ?? '']));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leger-${req.cls.nama.replace(/\s+/g, '_')}-${period.tahun_pelajaran.replace('/', '-')}-s${period.semester}.csv"`);
    return res.send(`﻿${toCSV(rows)}`);
  }
  // rata-rata per mapel
  const colAvg = cols.map((c) => {
    const vals = report.students.map((r) => legerValue(r, c)).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  const view = req.query.print ? 'print/leger' : 'app/leger';
  res.render(view, { title: `Leger ${req.cls.nama}`, period, report, cols, colAvg, legerValue });
});

// ===== Halaman cetak per kelas =====
router.get('/kelas/:classId/cetak', loadClass, (req, res) => {
  const periods = db.prepare('SELECT * FROM periods ORDER BY tahun_pelajaran DESC, semester DESC').all();
  const period = workingPeriod(req, res);
  const report = buildClassReport(period.id, req.cls.id);
  const projects = db.prepare('SELECT COUNT(*) n FROM projects WHERE period_id = ? AND class_id = ?').get(period.id, req.cls.id).n;
  res.render('app/cetak', { title: `Cetak Rapor ${req.cls.nama}`, period, periods, report, KINDS, projects });
});

router.get('/kelas/:classId/cetak-semua/:kind', loadClass, (req, res) => {
  const kind = KINDS[req.params.kind] ? req.params.kind : 'akhir';
  const period = workingPeriod(req, res);
  let students = studentsOfClass(period.id, req.cls.id);
  if (kind === 'piagam') {
    const report = buildClassReport(period.id, req.cls.id);
    const top = report.students.filter((r) => r.rank && r.rank <= (Number(req.query.top) || res.locals.settings.juara)).sort((a, b) => a.rank - b.rank);
    students = top.map((r) => r.student);
  }
  let items = students.map((s) => buildFor(kind, period.id, s.id)).filter((x) => x && x.cls);
  if (kind === 'piagam' && !items.length) items = [contohPiagam(period, req.cls)];
  res.render('print/doc', {
    title: `${KINDS[kind].label} ${req.cls.nama}`, items, kind, partial: KINDS[kind].partial,
    parts: parseParts(req.query), back: `/app/kelas/${req.cls.id}/cetak?period=${period.id}`, tpl: nomorTpl(req.query.tpl),
  });
});

/**
 * Piagam contoh bila belum ada peringkat (nilai belum diisi): tetap bisa dilihat & diatur tampilannya.
 * Memakai siswa pertama di kelas bila ada; peringkat dan rata-rata dibiarkan kosong.
 */
function contohPiagam(period, cls) {
  const siswa = studentsOfClass(period.id, cls.id)[0];
  const r = siswa ? buildStudentRapor(period.id, siswa.id) : null;
  return {
    ...(r && r.cls ? r : { settings: getSettings(), cls, period, student: { nama: 'Nama Siswa', nisn: '' } }),
    rank: null, rata: null, contoh: true,
  };
}

// ===== Cetak rapor satu siswa =====
router.get('/rapor/:studentId/:kind', (req, res) => {
  const kind = KINDS[req.params.kind] ? req.params.kind : 'akhir';
  const st = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.studentId);
  const period = getPeriod(req.query.period) || res.locals.activePeriod;
  if (!st) return res.redirect('/app/siswa');
  const cls = classOfStudent(period.id, st);
  if (!cls || !canAccessClass(res.locals.user, cls.id)) {
    return res.status(403).render('error', { title: 'Akses ditolak', message: 'Siswa tidak berada di kelas Anda pada periode ini.' });
  }
  let data = buildFor(kind, period.id, st.id);
  // siswa tanpa peringkat (nilai belum lengkap): tampilkan piagam contoh atas nama siswa itu
  if (kind === 'piagam' && data && data.cls && !data.rank) data = { ...data, rank: null, rata: null, contoh: true };
  res.render('print/doc', {
    title: `${KINDS[kind].label} - ${st.nama}`, items: [data], kind, partial: KINDS[kind].partial,
    parts: parseParts(req.query), back: /^\/app\/[\w/?=&-]*$/.test(req.query.back || '') ? req.query.back : `/app/kelas/${cls.id}/cetak?period=${period.id}`,
    tpl: nomorTpl(req.query.tpl),
  });
});

// ===== Galeri 10 template piagam =====
router.get('/piagam/template', (req, res) => {
  const period = res.locals.activePeriod;
  const kelas = require('../../lib/auth').allowedClasses(res.locals.user);
  let contoh = null;
  for (const c of kelas) {
    const report = buildClassReport(period.id, c.id);
    const juara = report.students.find((r) => r.rank === 1);
    if (juara) { contoh = buildStudentRapor(period.id, juara.student.id); break; }
  }
  if (!contoh) {
    const cls = kelas[0] ? db.prepare('SELECT c.*, u.nama AS guru_nama, u.nip AS guru_nip FROM classes c LEFT JOIN users u ON u.id = c.guru_id WHERE c.id = ?').get(kelas[0].id) : { nama: 'IV A' };
    contoh = kelas[0] ? contohPiagam(period, cls) : { settings: getSettings(), cls, period, student: { nama: 'Nama Siswa', nisn: '' }, rank: null, rata: null, contoh: true };
  }
  res.render('print/piagam-template', { title: 'Template Piagam', r: contoh, daftar: TEMPLATE_PIAGAM, terpilih: Number(res.locals.settings.piagam_template) || 1 });
});

router.post('/piagam/template', requireAdmin, (req, res) => {
  const n = nomorTpl(req.body.tpl);
  if (n) {
    const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    set.run('piagam_template', String(n));
    set.run('piagam_warna', 'template');
    req.flash('success', `Template piagam nomor ${n} (${TEMPLATE_PIAGAM[n - 1]}) dipakai untuk semua piagam.`);
  }
  res.redirect('/app/piagam/template');
});

module.exports = router;
