const express = require('express');
const { db } = require('../../db');
const { buildClassReport, studentsOfClass, getSettings } = require('../../lib/rapor');
const { toCSV } = require('../../lib/csv');
const { loadClass, workingPeriod } = require('./_util');

const router = express.Router();

function pct(done, total) {
  return total ? Math.round((done / total) * 100) : 0;
}

// ===== Ketuntasan pengisian (sheet "Progres" di Excel) =====
router.get('/:classId/progres', loadClass, (req, res) => {
  const period = workingPeriod(req, res);
  const settings = getSettings();
  const students = studentsOfClass(period.id, req.cls.id);
  const n = students.length;
  const ids = students.map((s) => s.id);
  const inIds = ids.length ? `(${ids.join(',')})` : '(NULL)';
  const sections = [];

  const profilKeys = ['nama_sekolah', 'npsn', 'alamat', 'kecamatan', 'kabupaten', 'provinsi', 'kepsek_nama', 'kepsek_nip'];
  sections.push({ grup: 'Data utama', nama: 'Profil sekolah', persen: pct(profilKeys.filter((k) => settings[k]).length, profilKeys.length), link: '/app/sekolah' });
  const idKeys = ['nisn', 'nis', 'tanggal_lahir', 'jenis_kelamin', 'agama', 'ayah_nama', 'ibu_nama'];
  const idFilled = students.reduce((a, s) => a + idKeys.filter((k) => s[k]).length, 0);
  sections.push({ grup: 'Data utama', nama: 'Identitas siswa', persen: pct(idFilled, n * idKeys.length), link: `/app/siswa?kelas=${req.cls.id}` });
  sections.push({ grup: 'Data utama', nama: 'Guru kelas & tanggal rapor', persen: pct((req.cls.guru_id ? 1 : 0) + (period.tanggal_rapor ? 1 : 0), 2), link: '/app/periode' });

  const report = buildClassReport(period.id, req.cls.id, settings);
  for (const s of report.subjects) {
    const target = s.kelompok === 'agama' ? students.filter((x) => x.agama === s.agama).length : n;
    if (!target) continue;
    const tp = db.prepare('SELECT COUNT(*) c FROM tujuan_pembelajaran WHERE period_id = ? AND class_id = ? AND subject_id = ?').get(period.id, req.cls.id, s.id).c;
    const dinilai = report.students.filter((r) => r.mapel[s.id] && r.mapel[s.id].na != null).length;
    sections.push({ grup: 'Tujuan pembelajaran', nama: s.nama, persen: tp ? 100 : 0, link: `/app/kelas/${req.cls.id}/tp/${s.id}` });
    sections.push({ grup: 'Input nilai', nama: s.nama, persen: pct(dinilai, target), info: `${dinilai}/${target} siswa`, link: `/app/kelas/${req.cls.id}/nilai/${s.id}` });
  }

  const rs = db.prepare(`SELECT * FROM rapor_siswa WHERE period_id = ? AND student_id IN ${inIds}`).all(period.id);
  const ekskul = db.prepare(`SELECT COUNT(DISTINCT student_id) c FROM ekstrakurikuler WHERE period_id = ? AND student_id IN ${inIds}`).get(period.id).c;
  sections.push({ grup: 'Catatan siswa', nama: 'Catatan guru', persen: pct(rs.filter((r) => r.catatan).length, n), link: `/app/kelas/${req.cls.id}/catatan` });
  sections.push({ grup: 'Catatan siswa', nama: 'Ekstrakurikuler', persen: pct(ekskul, n), link: `/app/kelas/${req.cls.id}/ekskul` });
  sections.push({ grup: 'Catatan siswa', nama: 'Absensi (sudah disimpan)', persen: pct(rs.length, n), link: `/app/kelas/${req.cls.id}/absensi` });
  if (Number(period.semester) === 2) {
    sections.push({ grup: 'Catatan siswa', nama: 'Naik / tidak naik', persen: pct(rs.filter((r) => r.naik != null).length, n), link: `/app/kelas/${req.cls.id}/kenaikan` });
  }

  const projects = db.prepare('SELECT * FROM projects WHERE period_id = ? AND class_id = ? ORDER BY urutan').all(period.id, req.cls.id);
  for (const p of projects) {
    const t = db.prepare('SELECT COUNT(*) c FROM project_targets WHERE project_id = ?').get(p.id).c;
    const nilai = db.prepare('SELECT COUNT(DISTINCT student_id) c FROM project_scores WHERE project_id = ?').get(p.id).c;
    const cat = db.prepare("SELECT COUNT(*) c FROM project_notes WHERE project_id = ? AND catatan IS NOT NULL AND catatan != ''").get(p.id).c;
    const g = `Projek ${p.urutan}: ${p.nama}`;
    sections.push({ grup: g, nama: 'Skenario / rancangan', persen: t ? 100 : 0, link: `/app/kelas/${req.cls.id}/projek/${p.id}` });
    sections.push({ grup: g, nama: 'Penilaian', persen: pct(nilai, n), link: `/app/kelas/${req.cls.id}/projek/${p.id}/nilai` });
    sections.push({ grup: g, nama: 'Catatan proses', persen: pct(cat, n), link: `/app/kelas/${req.cls.id}/projek/${p.id}/nilai` });
  }

  const total = sections.length ? Math.round(sections.reduce((a, s) => a + s.persen, 0) / sections.length) : 0;
  res.render('app/progres', { title: `Progres ${req.cls.nama}`, period, sections, total, n });
});

// ===== Rekap nilai + deskripsi semua mapel (sheet "REKAP SEMUA", "REKAP AGAMA", "Rekap SENI") =====
router.get('/:classId/rekap', loadClass, (req, res) => {
  const period = workingPeriod(req, res);
  const report = buildClassReport(period.id, req.cls.id);
  // agama digabung satu kolom seperti di Excel
  const cols = [];
  if (report.subjects.some((s) => s.kelompok === 'agama')) cols.push({ key: 'agama', nama: 'Pendidikan Agama dan Budi Pekerti' });
  for (const s of report.subjects) if (s.kelompok !== 'agama') cols.push({ key: s.id, nama: s.nama });
  const cell = (row, col) => (col.key === 'agama'
    ? Object.values(row.mapel).find((m) => m.subject.kelompok === 'agama')
    : row.mapel[col.key]) || null;
  const pilih = req.query.mapel && cols.find((c) => String(c.key) === req.query.mapel);
  const shown = pilih ? [pilih] : cols;

  if (req.query.format === 'csv') {
    const head = ['No', 'Nama Siswa', 'Agama'];
    for (const c of shown) head.push(`${c.nama} - Nilai`, `${c.nama} - Deskripsi capaian tertinggi`, `${c.nama} - Deskripsi capaian terendah`);
    const rows = [head];
    report.students.forEach((r, i) => {
      const line = [i + 1, r.student.nama, r.student.agama || ''];
      for (const c of shown) { const m = cell(r, c); line.push(m ? m.na ?? '' : '', m ? m.deskripsi[0] || '' : '', m ? m.deskripsi[1] || '' : ''); }
      rows.push(line);
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rekap-${req.cls.nama.replace(/\s+/g, '_')}.csv"`);
    return res.send(`﻿${toCSV(rows)}`);
  }
  res.render('app/rekap', { title: `Rekap ${req.cls.nama}`, period, report, cols, shown, cell, pilih });
});

module.exports = router;
