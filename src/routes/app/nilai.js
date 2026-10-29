const express = require('express');
const { db } = require('../../db');
const { studentsOfClass, loadSubjectData, touchRaporSiswa, getSettings } = require('../../lib/rapor');
const { hitungMapel, deskripsiMapel, predikatFor } = require('../../lib/calc');
const { loadClass, workingPeriod, num, str } = require('./_util');

const router = express.Router();

function subjectFor(req) {
  return db.prepare(`SELECT s.*, cs.kktp FROM subjects s JOIN class_subjects cs ON cs.subject_id = s.id AND cs.class_id = ?
    WHERE s.id = ? AND cs.aktif = 1`).get(req.cls.id, req.params.subjectId);
}

function studentsFor(period, cls, subject) {
  const list = studentsOfClass(period.id, cls.id);
  return subject.kelompok === 'agama' ? list.filter((s) => s.agama === subject.agama) : list;
}

// Tab "Nilai TP per Mapel": buka lembar nilai mapel pertama yang aktif (pindah mapel lewat pilihan di halaman nilai)
router.get('/:classId/nilai', loadClass, (req, res) => {
  const s = db.prepare(`SELECT s.id FROM subjects s JOIN class_subjects cs ON cs.subject_id = s.id AND cs.class_id = ?
    WHERE cs.aktif = 1 ORDER BY s.urutan, s.id LIMIT 1`).get(req.cls.id);
  const q = req.query.period ? `?period=${encodeURIComponent(req.query.period)}` : '';
  res.redirect(s ? `/app/kelas/${req.cls.id}/nilai/${s.id}${q}` : `/app/kelas/${req.cls.id}/mapel`);
});

// ===== Nilai Sumatif Akhir Semester semua mapel dalam satu lembar =====
function sasSheet(req, res) {
  const period = workingPeriod(req, res);
  const subjects = db.prepare(`SELECT s.* FROM subjects s JOIN class_subjects cs ON cs.subject_id = s.id AND cs.class_id = ?
    WHERE cs.aktif = 1 ORDER BY s.urutan, s.id`).all(req.cls.id);
  const agama = subjects.filter((s) => s.kelompok === 'agama');
  // mapel agama digabung menjadi satu kolom: tiap siswa mengikuti mapel agamanya sendiri
  const kolom = [];
  if (agama.length) kolom.push({ key: 'agama', nama: 'Pendidikan Agama', singkat: 'Agama' });
  for (const s of subjects) if (s.kelompok !== 'agama') kolom.push({ key: String(s.id), nama: s.nama, singkat: s.singkat || s.nama, subject: s });
  const students = studentsOfClass(period.id, req.cls.id);
  const subjectOf = (k, st) => (k.key === 'agama' ? agama.find((a) => a.agama === st.agama) : k.subject);
  return { period, kolom, students, subjectOf };
}

router.get('/:classId/sas', loadClass, (req, res) => {
  const { period, kolom, students, subjectOf } = sasSheet(req, res);
  const akhir = new Map(db.prepare('SELECT * FROM nilai_akhir WHERE period_id = ?').all(period.id).map((r) => [`${r.subject_id}:${r.student_id}`, r]));
  const rows = students.map((st) => ({ st, cells: kolom.map((k) => { const s = subjectOf(k, st); return s ? { s, a: akhir.get(`${s.id}:${st.id}`) || {} } : null; }) }));
  res.render('app/nilai-sas', { title: 'Nilai STS & SAS semua mapel', period, kolom, rows });
});

router.post('/:classId/sas', loadClass, (req, res) => {
  const { period, kolom, students, subjectOf } = sasSheet(req, res);
  const b = req.body;
  const ada = db.prepare('SELECT 1 FROM nilai_akhir WHERE period_id = ? AND subject_id = ? AND student_id = ?');
  const up = db.prepare(`INSERT INTO nilai_akhir (period_id, subject_id, student_id, sts, sas_nontes, sas_tes) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT DO UPDATE SET sts = excluded.sts, sas_nontes = excluded.sas_nontes, sas_tes = excluded.sas_tes`);
  db.transaction(() => {
    for (const st of students) {
      for (const k of kolom) {
        const s = subjectOf(k, st);
        if (!s) continue;
        const sts = num(b[`sts_${k.key}_${st.id}`]);
        const nt = num(b[`nt_${k.key}_${st.id}`]);
        const ts = num(b[`t_${k.key}_${st.id}`]);
        if (sts == null && nt == null && ts == null && !ada.get(period.id, s.id, st.id)) continue;
        up.run(period.id, s.id, st.id, sts, nt, ts);
      }
      touchRaporSiswa(period.id, st.id, req.cls.id);
    }
  })();
  req.flash('success', 'Nilai STS & SAS semua mapel tersimpan.');
  res.redirect(`/app/kelas/${req.cls.id}/sas${req.query.period ? `?period=${req.query.period}` : ''}`);
});

router.get('/:classId/nilai/:subjectId', loadClass, (req, res) => {
  const period = workingPeriod(req, res);
  const subject = subjectFor(req);
  if (!subject) return res.redirect(`/app/kelas/${req.cls.id}`);
  const settings = getSettings();
  const { tp, lm } = loadSubjectData(period.id, req.cls.id, subject.id);
  const students = studentsFor(period, req.cls, subject);
  const f = new Map(db.prepare(`SELECT nf.* FROM nilai_formatif nf JOIN tujuan_pembelajaran t ON t.id = nf.tp_id
    WHERE t.period_id = ? AND t.class_id = ? AND t.subject_id = ?`).all(period.id, req.cls.id, subject.id)
    .map((r) => [`${r.tp_id}:${r.student_id}`, r.nilai]));
  const s = new Map(db.prepare(`SELECT ns.* FROM nilai_sumatif ns JOIN lingkup_materi l ON l.id = ns.lm_id
    WHERE l.period_id = ? AND l.class_id = ? AND l.subject_id = ?`).all(period.id, req.cls.id, subject.id)
    .map((r) => [`${r.lm_id}:${r.student_id}`, r.nilai]));
  const akhir = new Map(db.prepare('SELECT * FROM nilai_akhir WHERE period_id = ? AND subject_id = ?').all(period.id, subject.id)
    .map((r) => [r.student_id, r]));

  const rows = students.map((st) => {
    const tps = tp.map((t) => ({ ...t, nilai: f.has(`${t.id}:${st.id}`) ? f.get(`${t.id}:${st.id}`) : null }));
    const lms = lm.map((l) => (s.has(`${l.id}:${st.id}`) ? s.get(`${l.id}:${st.id}`) : null));
    const a = akhir.get(st.id) || {};
    const hasil = hitungMapel({ tp: tps, lm: lms, sts: a.sts ?? null, sas: [a.sas_nontes ?? null, a.sas_tes ?? null], bobot: settings.bobot });
    const auto = deskripsiMapel(hasil, { panggilan: st.panggilan || st.nama.split(' ')[0], settings });
    return { st, tps, lms, akhir: a, hasil, auto, predikat: predikatFor(hasil.na, settings.predikat) };
  });

  const subjects = db.prepare(`SELECT s.id, s.nama, s.singkat, s.kelompok, s.agama FROM subjects s
    JOIN class_subjects cs ON cs.subject_id = s.id AND cs.class_id = ? WHERE cs.aktif = 1 ORDER BY s.urutan, s.id`).all(req.cls.id);
  res.render('app/nilai', {
    title: `Nilai ${subject.nama}`, period, subject, subjects, tp, lm, rows,
    calcSettings: { bobot: settings.bobot, predikat: settings.predikat, desk_mode: settings.desk_mode, desk_nama: settings.desk_nama,
      kalimat_tinggi: settings.kalimat_tinggi, kalimat_rendah: settings.kalimat_rendah },
  });
});

router.post('/:classId/nilai/:subjectId', loadClass, (req, res) => {
  const period = workingPeriod(req, res);
  const subject = subjectFor(req);
  if (!subject) return res.redirect(`/app/kelas/${req.cls.id}`);
  const { tp, lm } = loadSubjectData(period.id, req.cls.id, subject.id);
  const students = studentsFor(period, req.cls, subject);
  const b = req.body;

  const upF = db.prepare('INSERT INTO nilai_formatif (tp_id, student_id, nilai) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET nilai = excluded.nilai');
  const delF = db.prepare('DELETE FROM nilai_formatif WHERE tp_id = ? AND student_id = ?');
  const upS = db.prepare('INSERT INTO nilai_sumatif (lm_id, student_id, nilai) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET nilai = excluded.nilai');
  const delS = db.prepare('DELETE FROM nilai_sumatif WHERE lm_id = ? AND student_id = ?');
  const upA = db.prepare(`INSERT INTO nilai_akhir (period_id, subject_id, student_id, sts, sas_nontes, sas_tes, desk_tinggi, desk_rendah)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET sts = excluded.sts, sas_nontes = excluded.sas_nontes, sas_tes = excluded.sas_tes,
    desk_tinggi = excluded.desk_tinggi, desk_rendah = excluded.desk_rendah`);

  db.transaction(() => {
    for (const st of students) {
      for (const t of tp) {
        const v = num(b[`f_${t.id}_${st.id}`]);
        if (v == null) delF.run(t.id, st.id); else upF.run(t.id, st.id, v);
      }
      for (const l of lm) {
        const v = num(b[`s_${l.id}_${st.id}`]);
        if (v == null) delS.run(l.id, st.id); else upS.run(l.id, st.id, v);
      }
      upA.run(period.id, subject.id, st.id, num(b[`sts_${st.id}`]), num(b[`nt_${st.id}`]), num(b[`t_${st.id}`]), str(b[`dt_${st.id}`]), str(b[`dr_${st.id}`]));
      touchRaporSiswa(period.id, st.id, req.cls.id);
    }
  })();
  req.flash('success', `Nilai ${subject.nama} tersimpan.`);
  res.redirect(`/app/kelas/${req.cls.id}/nilai/${subject.id}${req.query.period ? `?period=${req.query.period}` : ''}`);
});

module.exports = router;
