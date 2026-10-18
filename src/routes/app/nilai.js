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
    const hasil = hitungMapel({ tp: tps, lm: lms, sas: [a.sas_nontes ?? null, a.sas_tes ?? null], bobot: settings.bobot });
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
  const upA = db.prepare(`INSERT INTO nilai_akhir (period_id, subject_id, student_id, sas_nontes, sas_tes, desk_tinggi, desk_rendah)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET sas_nontes = excluded.sas_nontes, sas_tes = excluded.sas_tes,
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
      upA.run(period.id, subject.id, st.id, num(b[`nt_${st.id}`]), num(b[`t_${st.id}`]), str(b[`dt_${st.id}`]), str(b[`dr_${st.id}`]));
      touchRaporSiswa(period.id, st.id, req.cls.id);
    }
  })();
  req.flash('success', `Nilai ${subject.nama} tersimpan.`);
  res.redirect(`/app/kelas/${req.cls.id}/nilai/${subject.id}${req.query.period ? `?period=${req.query.period}` : ''}`);
});

module.exports = router;
