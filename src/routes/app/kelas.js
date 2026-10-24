const express = require('express');
const { db } = require('../../db');
const { requireAdmin, allowedClasses } = require('../../lib/auth');
const { ensureClassSubjects, studentsOfClass, loadSubjectData } = require('../../lib/rapor');
const { loadClass, workingPeriod, str } = require('./_util');

const router = express.Router();
const TP_CONTOH = require('../../../db/seed/tp_kelas4.json');

const FASE_OF = { 1: 'A', 2: 'A', 3: 'B', 4: 'B', 5: 'C', 6: 'C' };

router.get('/', (req, res) => {
  const classes = allowedClasses(res.locals.user);
  const gurus = db.prepare('SELECT id, nama, role FROM users ORDER BY nama').all();
  res.render('app/kelas-list', { title: 'Kelas / Rombel', classes, gurus });
});

router.post('/', requireAdmin, (req, res) => {
  // satu atau banyak baris: nama__0, tingkat__0, guru_id__0, ... (bentuk lama nama/tingkat/guru_id tetap diterima)
  const n = req.body.n ? Math.min(200, Number(req.body.n) || 0) : 1;
  const ambil = (k, i) => (req.body.n ? req.body[`${k}__${i}`] : req.body[k]);
  const ins = db.prepare('INSERT INTO classes (nama, tingkat, fase, guru_id) VALUES (?, ?, ?, ?)');
  const dibuat = [];
  db.transaction(() => {
    for (let i = 0; i < n; i += 1) {
      const nama = str(ambil('nama', i));
      if (!nama) continue;
      const tingkat = Math.min(6, Math.max(1, Number(ambil('tingkat', i)) || 1));
      const id = ins.run(nama, tingkat, FASE_OF[tingkat], Number(ambil('guru_id', i)) || null).lastInsertRowid;
      ensureClassSubjects({ id, tingkat });
      dibuat.push({ id, nama });
    }
  })();
  if (!dibuat.length) { req.flash('error', 'Nama kelas wajib diisi.'); return res.redirect('/app/kelas'); }
  req.flash('success', `Kelas ${dibuat.map((k) => k.nama).join(', ')} dibuat.`);
  res.redirect(dibuat.length === 1 ? `/app/kelas/${dibuat[0].id}` : '/app/kelas');
});

router.post('/:classId/ubah', requireAdmin, loadClass, (req, res) => {
  const cls = req.cls;
  if (req.body.action === 'delete') {
    db.prepare('DELETE FROM classes WHERE id = ?').run(cls.id);
    req.flash('success', `Kelas ${cls.nama} dihapus. Siswa di kelas tersebut kini tanpa kelas.`);
    return res.redirect('/app/kelas');
  }
  const tingkat = Math.min(6, Math.max(1, Number(req.body.tingkat) || cls.tingkat));
  db.prepare('UPDATE classes SET nama = ?, tingkat = ?, fase = ?, guru_id = ? WHERE id = ?')
    .run(str(req.body.nama) || cls.nama, tingkat, FASE_OF[tingkat], Number(req.body.guru_id) || null, cls.id);
  req.flash('success', 'Data kelas diperbarui.');
  res.redirect(`/app/kelas/${cls.id}`);
});

router.get('/:classId', loadClass, (req, res) => {
  const period = workingPeriod(req, res);
  const students = studentsOfClass(period.id, req.cls.id);
  const subjects = db.prepare(`SELECT s.*, cs.aktif, cs.kktp,
      (SELECT COUNT(*) FROM tujuan_pembelajaran t WHERE t.subject_id = s.id AND t.class_id = ? AND t.period_id = ?) AS jml_tp,
      (SELECT COUNT(*) FROM lingkup_materi l WHERE l.subject_id = s.id AND l.class_id = ? AND l.period_id = ?) AS jml_lm,
      (SELECT COUNT(DISTINCT nf.student_id) FROM nilai_formatif nf JOIN tujuan_pembelajaran t ON t.id = nf.tp_id
        WHERE t.subject_id = s.id AND t.class_id = ? AND t.period_id = ?) AS jml_dinilai
    FROM subjects s JOIN class_subjects cs ON cs.subject_id = s.id AND cs.class_id = ?
    WHERE cs.aktif = 1 ORDER BY s.urutan, s.id`).all(req.cls.id, period.id, req.cls.id, period.id, req.cls.id, period.id, req.cls.id);
  const agamaCount = {};
  for (const s of students) agamaCount[s.agama || '-'] = (agamaCount[s.agama || '-'] || 0) + 1;
  const projects = db.prepare('SELECT COUNT(*) n FROM projects WHERE period_id = ? AND class_id = ?').get(period.id, req.cls.id).n;
  const gurus = db.prepare('SELECT id, nama FROM users ORDER BY nama').all();
  res.render('app/kelas-detail', { title: `Kelas ${req.cls.nama}`, period, students, subjects, agamaCount, projects, gurus });
});

// ===== Pengaturan mapel & KKTP per kelas =====
router.get('/:classId/mapel', loadClass, (req, res) => {
  const subjects = db.prepare(`SELECT s.*, cs.aktif, cs.kktp FROM subjects s
    JOIN class_subjects cs ON cs.subject_id = s.id AND cs.class_id = ? ORDER BY s.urutan, s.id`).all(req.cls.id);
  res.render('app/kelas-mapel', { title: `Mapel & KKTP ${req.cls.nama}`, subjects });
});

router.post('/:classId/mapel', loadClass, (req, res) => {
  const subjects = db.prepare('SELECT subject_id FROM class_subjects WHERE class_id = ?').all(req.cls.id);
  const upd = db.prepare('UPDATE class_subjects SET aktif = ?, kktp = ? WHERE class_id = ? AND subject_id = ?');
  db.transaction(() => {
    for (const { subject_id: sid } of subjects) {
      const kktp = Math.max(0, Math.min(100, Number(req.body[`kktp_${sid}`]) || 70));
      upd.run(req.body[`aktif_${sid}`] ? 1 : 0, kktp, req.cls.id, sid);
    }
  })();
  req.flash('success', 'Pengaturan mapel kelas disimpan.');
  res.redirect(`/app/kelas/${req.cls.id}/mapel`);
});

// ===== Lingkup Materi & Tujuan Pembelajaran =====
function subjectFor(req, res) {
  return db.prepare(`SELECT s.*, cs.kktp FROM subjects s JOIN class_subjects cs ON cs.subject_id = s.id AND cs.class_id = ?
    WHERE s.id = ?`).get(req.cls.id, req.params.subjectId);
}

function contohFor(subject) {
  const keyMap = { 'AG-BUDDHA': 'Agama Budha', 'AG-KHONGHUCU': 'Agama Konghucu', PPKN: 'Pendidikan Pancasila dan Kewarganegaraan',
    PJOK: 'Pendidikan Jasmani, Olahraga dan Kesehatan' };
  const key = keyMap[subject.kode] || (subject.agama ? `Agama ${subject.agama}` : subject.nama);
  return TP_CONTOH[key] || null;
}

router.get('/:classId/tp/:subjectId', loadClass, (req, res) => {
  const period = workingPeriod(req, res);
  const subject = subjectFor(req, res);
  if (!subject) return res.redirect(`/app/kelas/${req.cls.id}`);
  const data = loadSubjectData(period.id, req.cls.id, subject.id);
  const subjects = db.prepare(`SELECT s.id, s.nama, s.kelompok FROM subjects s JOIN class_subjects cs ON cs.subject_id = s.id
    AND cs.class_id = ? WHERE cs.aktif = 1 ORDER BY s.urutan, s.id`).all(req.cls.id);
  res.render('app/tp', { title: `TP ${subject.nama}`, period, subject, subjects, ...data, contoh: contohFor(subject) });
});

router.post('/:classId/tp/:subjectId', loadClass, (req, res) => {
  const period = workingPeriod(req, res);
  const subject = subjectFor(req, res);
  if (!subject) return res.redirect(`/app/kelas/${req.cls.id}`);
  const base = `/app/kelas/${req.cls.id}/tp/${subject.id}`;
  let lmLines;
  let tpLines;
  if (req.body.action === 'contoh') {
    const c = contohFor(subject);
    if (!c) return res.redirect(base);
    lmLines = c.lm; tpLines = c.tp;
  } else {
    lmLines = [].concat(req.body.lm || []).map((x) => String(x).trim());
    tpLines = [].concat(req.body.tp || []).map((x) => String(x).trim());
  }
  const lmIds = [].concat(req.body.lm_id || []);
  const tpIds = [].concat(req.body.tp_id || []);
  const lmKeys = [].concat(req.body.lm_key || []);
  const tpLm = [].concat(req.body.tp_lm || []);
  const replaceAll = req.body.action === 'contoh';

  // Sinkronisasi daftar dengan tetap mempertahankan id (agar nilai yang sudah diinput tidak hilang).
  // Mengembalikan id baris ke-i (null bila baris kosong).
  function sync(table, col, lines, ids, extra = () => ({})) {
    const existing = db.prepare(`SELECT id FROM ${table} WHERE period_id = ? AND class_id = ? AND subject_id = ?`)
      .all(period.id, req.cls.id, subject.id).map((r) => r.id);
    const keep = new Set();
    const hasil = [];
    let urut = 0;
    lines.forEach((text, i) => {
      if (!text) { hasil.push(null); return; }
      urut += 1;
      const ex = extra(i);
      const cols = Object.keys(ex);
      const id = replaceAll ? null : Number(ids[i]);
      if (id && existing.includes(id)) {
        db.prepare(`UPDATE ${table} SET ${col} = ?, urutan = ?${cols.map((c) => `, ${c} = ?`).join('')} WHERE id = ?`).run(text, urut, ...Object.values(ex), id);
        keep.add(id);
        hasil.push(id);
      } else {
        hasil.push(db.prepare(`INSERT INTO ${table} (period_id, class_id, subject_id, urutan, ${col}${cols.map((c) => `, ${c}`).join('')})
          VALUES (?, ?, ?, ?, ?${cols.map(() => ', ?').join('')})`).run(period.id, req.cls.id, subject.id, urut, text, ...Object.values(ex)).lastInsertRowid);
      }
    });
    for (const id of existing) if (!keep.has(id)) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    return hasil;
  }

  db.transaction(() => {
    const lmBaru = sync('lingkup_materi', 'nama', lmLines, lmIds);
    // kunci LM di formulir → id LM tersimpan (LM baru belum punya id saat formulir diisi)
    const lmOf = new Map();
    lmLines.forEach((_, i) => { if (lmKeys[i] && lmBaru[i]) lmOf.set(String(lmKeys[i]), lmBaru[i]); });
    sync('tujuan_pembelajaran', 'deskripsi', tpLines, tpIds, (i) => ({ lm_id: replaceAll ? null : lmOf.get(String(tpLm[i] || '')) || null }));
  })();
  req.flash('success', 'Lingkup materi & tujuan pembelajaran disimpan.');
  res.redirect(req.body.next === 'nilai' ? `/app/kelas/${req.cls.id}/nilai/${subject.id}` : base);
});

module.exports = router;
