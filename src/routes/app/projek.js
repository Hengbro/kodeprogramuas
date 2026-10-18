const express = require('express');
const { db } = require('../../db');
const { studentsOfClass, touchRaporSiswa } = require('../../lib/rapor');
const { P5_LEVEL } = require('../../lib/calc');
const { loadClass, workingPeriod, str } = require('./_util');

const router = express.Router();

function p5Tree() {
  const dims = db.prepare('SELECT * FROM p5_dimensi ORDER BY urutan').all();
  const elemen = db.prepare('SELECT * FROM p5_elemen ORDER BY id').all();
  const sub = db.prepare('SELECT * FROM p5_subelemen ORDER BY id').all();
  for (const d of dims) {
    d.elemen = elemen.filter((e) => e.dimensi_id === d.id);
    for (const e of d.elemen) e.subelemen = sub.filter((s) => s.elemen_id === e.id);
  }
  return dims;
}

function loadProject(req, res, next) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ? AND class_id = ?').get(req.params.projectId, req.cls.id);
  if (!p) return res.redirect(`/app/kelas/${req.cls.id}/projek`);
  req.project = p;
  next();
}

function targetsOf(projectId, fase) {
  return db.prepare(`SELECT se.*, se.fase_${fase.toLowerCase()} AS capaian, e.nama AS elemen, d.nama AS dimensi, d.id AS dimensi_id
    FROM project_targets pt JOIN p5_subelemen se ON se.id = pt.subelemen_id
    JOIN p5_elemen e ON e.id = se.elemen_id JOIN p5_dimensi d ON d.id = e.dimensi_id
    WHERE pt.project_id = ? ORDER BY d.urutan, pt.urutan, se.id`).all(projectId);
}

router.get('/:classId/projek', loadClass, (req, res) => {
  const period = workingPeriod(req, res);
  const projects = db.prepare('SELECT * FROM projects WHERE period_id = ? AND class_id = ? ORDER BY urutan, id').all(period.id, req.cls.id);
  for (const p of projects) {
    p.targets = targetsOf(p.id, req.cls.fase);
    p.dinilai = db.prepare('SELECT COUNT(DISTINCT student_id) n FROM project_scores WHERE project_id = ?').get(p.id).n;
  }
  res.render('app/projek-list', { title: `Projek P5 ${req.cls.nama}`, period, projects });
});

router.post('/:classId/projek', loadClass, (req, res) => {
  const period = workingPeriod(req, res);
  const nama = str(req.body.nama);
  if (!nama) { req.flash('error', 'Nama projek wajib diisi.'); return res.redirect(`/app/kelas/${req.cls.id}/projek`); }
  const urutan = db.prepare('SELECT COALESCE(MAX(urutan), 0) + 1 n FROM projects WHERE period_id = ? AND class_id = ?').get(period.id, req.cls.id).n;
  const id = db.prepare('INSERT INTO projects (period_id, class_id, urutan, nama, tema, deskripsi) VALUES (?, ?, ?, ?, ?, ?)')
    .run(period.id, req.cls.id, urutan, nama, str(req.body.tema), str(req.body.deskripsi)).lastInsertRowid;
  req.flash('success', 'Projek dibuat. Pilih dimensi & sub-elemen yang menjadi target.');
  res.redirect(`/app/kelas/${req.cls.id}/projek/${id}`);
});

router.get('/:classId/projek/:projectId', loadClass, loadProject, (req, res) => {
  const selected = new Set(db.prepare('SELECT subelemen_id FROM project_targets WHERE project_id = ?').all(req.project.id).map((r) => r.subelemen_id));
  res.render('app/projek-form', { title: `Rancangan ${req.project.nama}`, project: req.project, tree: p5Tree(), selected });
});

router.post('/:classId/projek/:projectId', loadClass, loadProject, (req, res) => {
  const p = req.project;
  if (req.body.action === 'delete') {
    db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
    req.flash('success', 'Projek dihapus.');
    return res.redirect(`/app/kelas/${req.cls.id}/projek`);
  }
  const ids = [].concat(req.body.subelemen || []).map(Number).filter(Boolean);
  db.transaction(() => {
    db.prepare('UPDATE projects SET nama = ?, tema = ?, deskripsi = ?, urutan = ? WHERE id = ?')
      .run(str(req.body.nama) || p.nama, str(req.body.tema), str(req.body.deskripsi), Number(req.body.urutan) || p.urutan, p.id);
    db.prepare(`DELETE FROM project_targets WHERE project_id = ? AND subelemen_id NOT IN (${ids.map(() => '?').join(',') || 'NULL'})`)
      .run(p.id, ...ids);
    const ins = db.prepare('INSERT OR IGNORE INTO project_targets (project_id, subelemen_id, urutan) VALUES (?, ?, ?)');
    ids.forEach((id, i) => ins.run(p.id, id, i));
  })();
  req.flash('success', 'Rancangan projek disimpan.');
  res.redirect(req.body.next === 'nilai' ? `/app/kelas/${req.cls.id}/projek/${p.id}/nilai` : `/app/kelas/${req.cls.id}/projek/${p.id}`);
});

router.get('/:classId/projek/:projectId/nilai', loadClass, loadProject, (req, res) => {
  const period = db.prepare('SELECT * FROM periods WHERE id = ?').get(req.project.period_id);
  const students = studentsOfClass(period.id, req.cls.id);
  const targets = targetsOf(req.project.id, req.cls.fase);
  const scores = new Map(db.prepare('SELECT * FROM project_scores WHERE project_id = ?').all(req.project.id)
    .map((r) => [`${r.subelemen_id}:${r.student_id}`, r.nilai]));
  const notes = new Map(db.prepare('SELECT * FROM project_notes WHERE project_id = ?').all(req.project.id).map((r) => [r.student_id, r.catatan]));
  const bank = db.prepare("SELECT teks FROM bank_kalimat WHERE jenis = 'proses' ORDER BY id").all().map((r) => r.teks);
  const dims = db.prepare('SELECT * FROM p5_dimensi ORDER BY urutan').all();
  const dimScores = new Map(db.prepare('SELECT * FROM project_dim_scores WHERE project_id = ?').all(req.project.id)
    .map((r) => [`${r.dimensi_id}:${r.student_id}`, r.nilai]));
  res.render('app/projek-nilai', {
    title: `Penilaian ${req.project.nama}`, project: req.project, students, targets, scores, notes, bank, P5_LEVEL, dims, dimScores,
  });
});

router.post('/:classId/projek/:projectId/nilai', loadClass, loadProject, (req, res) => {
  const p = req.project;
  const students = studentsOfClass(p.period_id, req.cls.id);
  const targets = targetsOf(p.id, req.cls.fase);
  const dims = db.prepare('SELECT id FROM p5_dimensi').all();
  const b = req.body;
  db.transaction(() => {
    for (const st of students) {
      for (const d of dims) {
        const v = Number(b[`d_${d.id}_${st.id}`]);
        if (v >= 1 && v <= 4) {
          db.prepare(`INSERT INTO project_dim_scores (project_id, student_id, dimensi_id, nilai) VALUES (?, ?, ?, ?)
            ON CONFLICT DO UPDATE SET nilai = excluded.nilai`).run(p.id, st.id, d.id, v);
        } else {
          db.prepare('DELETE FROM project_dim_scores WHERE project_id = ? AND student_id = ? AND dimensi_id = ?').run(p.id, st.id, d.id);
        }
      }
      for (const t of targets) {
        const v = Number(b[`p_${t.id}_${st.id}`]);
        if (v >= 1 && v <= 4) {
          db.prepare(`INSERT INTO project_scores (project_id, student_id, subelemen_id, nilai) VALUES (?, ?, ?, ?)
            ON CONFLICT DO UPDATE SET nilai = excluded.nilai`).run(p.id, st.id, t.id, v);
        } else {
          db.prepare('DELETE FROM project_scores WHERE project_id = ? AND student_id = ? AND subelemen_id = ?').run(p.id, st.id, t.id);
        }
      }
      db.prepare(`INSERT INTO project_notes (project_id, student_id, catatan) VALUES (?, ?, ?)
        ON CONFLICT DO UPDATE SET catatan = excluded.catatan`).run(p.id, st.id, str(b[`cat_${st.id}`]));
      touchRaporSiswa(p.period_id, st.id, req.cls.id);
    }
  })();
  req.flash('success', 'Penilaian projek tersimpan.');
  res.redirect(`/app/kelas/${req.cls.id}/projek/${p.id}/nilai`);
});

module.exports = router;
