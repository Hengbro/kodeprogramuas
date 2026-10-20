const { db } = require('../db');
const { lisensiAktif } = require('./lisensi');
const { hitungMapel, deskripsiMapel, ranking, avg, predikatFor, P5_LEVEL } = require('./calc');

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  try { s.predikat = JSON.parse(s.predikat); } catch { s.predikat = []; }
  s.bobot = { f: Number(s.bobot_f) || 0, s: Number(s.bobot_s) || 0, as: Number(s.bobot_as) || 0 };
  // nama sekolah & NPSN selalu mengikuti lisensi (tidak bisa diganti sekolah lain)
  const lis = lisensiAktif(db);
  if (lis) { s.nama_sekolah = lis.sekolah; s.npsn = lis.npsn; }
  s.lisensi = lis;
  return s;
}

function getActivePeriod() {
  return db.prepare('SELECT * FROM periods WHERE is_active = 1').get()
    || db.prepare('SELECT * FROM periods ORDER BY tahun_pelajaran DESC, semester DESC LIMIT 1').get();
}

function getPeriod(id) {
  return db.prepare('SELECT * FROM periods WHERE id = ?').get(id);
}

function classSubjects(classId) {
  return db.prepare(`
    SELECT s.*, cs.kktp, cs.aktif
    FROM subjects s JOIN class_subjects cs ON cs.subject_id = s.id AND cs.class_id = ?
    WHERE cs.aktif = 1
    ORDER BY s.urutan, s.id`).all(classId);
}

/** Pastikan setiap mapel punya baris class_subjects untuk kelas ini. */
function ensureClassSubjects(cls) {
  const ins = db.prepare('INSERT OR IGNORE INTO class_subjects (class_id, subject_id, aktif, kktp) VALUES (?, ?, ?, 70)');
  for (const s of db.prepare('SELECT * FROM subjects').all()) {
    let aktif = 1;
    if (s.kode === 'IPAS' && cls.tingkat < 3) aktif = 0;
    if (s.kelompok === 'seni' && s.kode !== 'SENI-RUPA') aktif = 0;
    ins.run(cls.id, s.id, aktif);
  }
}

/** Siswa sebuah kelas pada periode tertentu (memakai snapshot rapor_siswa bila ada). */
function studentsOfClass(periodId, classId) {
  return db.prepare(`
    SELECT st.* FROM students st
    LEFT JOIN rapor_siswa rs ON rs.student_id = st.id AND rs.period_id = ?
    WHERE COALESCE(rs.class_id, CASE WHEN st.status = 'aktif' THEN st.class_id END) = ?
    ORDER BY st.nama COLLATE NOCASE`).all(periodId, classId);
}

function classOfStudent(periodId, student) {
  const rs = db.prepare('SELECT class_id FROM rapor_siswa WHERE period_id = ? AND student_id = ?').get(periodId, student.id);
  const classId = (rs && rs.class_id) || student.class_id;
  return classId ? db.prepare(`
    SELECT c.*, u.nama AS guru_nama, u.nip AS guru_nip FROM classes c LEFT JOIN users u ON u.id = c.guru_id
    WHERE c.id = ?`).get(classId) : null;
}

/** Simpan snapshot kelas siswa untuk periode (dipanggil setiap kali data rapor disimpan). */
function touchRaporSiswa(periodId, studentId, classId) {
  db.prepare(`INSERT INTO rapor_siswa (period_id, student_id, class_id) VALUES (?, ?, ?)
    ON CONFLICT (period_id, student_id) DO UPDATE SET class_id = COALESCE(rapor_siswa.class_id, excluded.class_id)`)
    .run(periodId, studentId, classId);
}

function loadSubjectData(periodId, classId, subjectId) {
  const tp = db.prepare('SELECT * FROM tujuan_pembelajaran WHERE period_id = ? AND class_id = ? AND subject_id = ? ORDER BY urutan, id')
    .all(periodId, classId, subjectId);
  const lm = db.prepare('SELECT * FROM lingkup_materi WHERE period_id = ? AND class_id = ? AND subject_id = ? ORDER BY urutan, id')
    .all(periodId, classId, subjectId);
  return { tp, lm };
}

/**
 * Menghitung seluruh nilai sebuah kelas pada satu periode.
 * Mengembalikan { subjects, students: [{ student, mapel: {subjectId: {...}}, jumlah, rata, rank }] }
 */
function buildClassReport(periodId, classId, settings = getSettings()) {
  const subjects = classSubjects(classId);
  const students = studentsOfClass(periodId, classId);
  const ids = students.map((s) => s.id);
  if (!ids.length) return { subjects, students: [] };

  const tpAll = db.prepare('SELECT * FROM tujuan_pembelajaran WHERE period_id = ? AND class_id = ? ORDER BY urutan, id').all(periodId, classId);
  const lmAll = db.prepare('SELECT * FROM lingkup_materi WHERE period_id = ? AND class_id = ? ORDER BY urutan, id').all(periodId, classId);
  const fAll = db.prepare(`SELECT nf.* FROM nilai_formatif nf JOIN tujuan_pembelajaran tp ON tp.id = nf.tp_id
    WHERE tp.period_id = ? AND tp.class_id = ?`).all(periodId, classId);
  const sAll = db.prepare(`SELECT ns.* FROM nilai_sumatif ns JOIN lingkup_materi lm ON lm.id = ns.lm_id
    WHERE lm.period_id = ? AND lm.class_id = ?`).all(periodId, classId);
  const naAll = db.prepare(`SELECT * FROM nilai_akhir WHERE period_id = ? AND student_id IN (${ids.map(() => '?').join(',')})`)
    .all(periodId, ...ids);

  const fMap = new Map(fAll.map((r) => [`${r.tp_id}:${r.student_id}`, r.nilai]));
  const sMap = new Map(sAll.map((r) => [`${r.lm_id}:${r.student_id}`, r.nilai]));
  const naMap = new Map(naAll.map((r) => [`${r.subject_id}:${r.student_id}`, r]));

  const rows = students.map((st) => {
    const mapel = {};
    for (const sub of subjects) {
      if (sub.kelompok === 'agama' && sub.agama !== st.agama) continue;
      const tps = tpAll.filter((t) => t.subject_id === sub.id)
        .map((t) => ({ ...t, nilai: fMap.has(`${t.id}:${st.id}`) ? fMap.get(`${t.id}:${st.id}`) : null }));
      const lms = lmAll.filter((l) => l.subject_id === sub.id).map((l) => sMap.get(`${l.id}:${st.id}`) ?? null);
      const akhir = naMap.get(`${sub.id}:${st.id}`) || {};
      const hasil = hitungMapel({ tp: tps, lm: lms, sas: [akhir.sas_nontes ?? null, akhir.sas_tes ?? null], bobot: settings.bobot });
      if (hasil.na == null && sub.kelompok === 'seni') continue; // seni hanya tampil bila diikuti
      let desk = deskripsiMapel(hasil, { panggilan: st.panggilan || st.nama.split(' ')[0], settings });
      if (akhir.desk_tinggi || akhir.desk_rendah) {
        desk = [akhir.desk_tinggi || desk[0], akhir.desk_rendah || desk[1]].filter(Boolean);
      }
      mapel[sub.id] = { ...hasil, deskripsi: desk, predikat: predikatFor(hasil.na, settings.predikat), subject: sub };
    }
    const nilaiList = Object.values(mapel).map((m) => m.na).filter((n) => n != null);
    const jumlah = nilaiList.reduce((a, b) => a + b, 0);
    return { student: st, mapel, jumlah: nilaiList.length ? jumlah : null, rata: avg(nilaiList) };
  });

  const ranks = ranking(rows, 'jumlah');
  rows.forEach((r) => { r.rank = ranks.get(r) || null; });
  return { subjects, students: rows };
}

/** Kolom leger: Agama digabung jadi satu kolom, sisanya per mapel. */
function legerColumns(subjects) {
  const cols = [];
  if (subjects.some((s) => s.kelompok === 'agama')) cols.push({ key: 'agama', nama: 'Pendidikan Agama dan Budi Pekerti', singkat: 'Agama' });
  for (const s of subjects) if (s.kelompok !== 'agama') cols.push({ key: s.id, nama: s.nama, singkat: s.singkat, subject: s });
  return cols;
}

function legerValue(row, col) {
  if (col.key === 'agama') {
    const m = Object.values(row.mapel).find((x) => x.subject.kelompok === 'agama');
    return m ? m.na : null;
  }
  return row.mapel[col.key] ? row.mapel[col.key].na : null;
}

/** Data lengkap untuk mencetak rapor satu siswa. */
function buildStudentRapor(periodId, studentId) {
  const settings = getSettings();
  const period = getPeriod(periodId);
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!period || !student) return null;
  const cls = classOfStudent(periodId, student);
  if (!cls) return { settings, period, student, cls: null, rows: [] };
  const report = buildClassReport(periodId, cls.id, settings);
  const row = report.students.find((r) => r.student.id === student.id);
  const rs = db.prepare('SELECT * FROM rapor_siswa WHERE period_id = ? AND student_id = ?').get(periodId, student.id) || {};
  const ekskul = db.prepare('SELECT * FROM ekstrakurikuler WHERE period_id = ? AND student_id = ? ORDER BY urutan').all(periodId, student.id);

  let catatan = rs.catatan || '';
  const n = report.students.length;
  if (row && row.rank && (settings.catatan_ranking === 'all' || (settings.catatan_ranking === 'top10' && row.rank <= 10))) {
    catatan = `${catatan} (Ranking ${row.rank} dari ${n} siswa)`.trim();
  }

  // susun baris rapor sesuai urutan & kelompok
  const mapelRows = [];
  const mapel = row ? row.mapel : {};
  const list = report.subjects.filter((s) => mapel[s.id]);
  let no = 0;
  const agama = list.find((s) => s.kelompok === 'agama');
  const seni = list.filter((s) => s.kelompok === 'seni');
  const mulok = list.filter((s) => s.kelompok === 'mulok');
  const seen = new Set();
  for (const s of list) {
    if (s.kelompok === 'agama') {
      if (seen.has('agama')) continue; seen.add('agama');
      mapelRows.push({ no: ++no, nama: agama.nama, kktp: agama.kktp, ...mapel[agama.id] });
    } else if (s.kelompok === 'seni') {
      if (seen.has('seni')) continue; seen.add('seni');
      mapelRows.push({ no: ++no, nama: 'Seni (Pilihan)', header: true });
      seni.forEach((x, i) => mapelRows.push({ sub: String.fromCharCode(97 + i), nama: x.nama, kktp: x.kktp, ...mapel[x.id] }));
    } else if (s.kelompok === 'mulok') {
      if (seen.has('mulok')) continue; seen.add('mulok');
      mapelRows.push({ no: ++no, nama: 'Muatan Lokal', header: true });
      mulok.forEach((x, i) => mapelRows.push({ sub: String.fromCharCode(97 + i), nama: x.nama, kktp: x.kktp, ...mapel[x.id] }));
    } else {
      mapelRows.push({ no: ++no, nama: s.nama, kktp: s.kktp, ...mapel[s.id] });
    }
  }

  return {
    settings, period, student, cls, rs, ekskul, catatan, mapelRows,
    jumlah: row ? row.jumlah : null, rata: row ? row.rata : null, rank: row ? row.rank : null, totalSiswa: report.students.length,
  };
}

/** Data rapor projek P5 seorang siswa. */
function buildProjectRapor(periodId, studentId) {
  const base = buildStudentRapor(periodId, studentId);
  if (!base || !base.cls) return base;
  const projects = db.prepare('SELECT * FROM projects WHERE period_id = ? AND class_id = ? ORDER BY urutan, id').all(periodId, base.cls.id);
  const fase = `fase_${base.cls.fase.toLowerCase()}`;
  for (const p of projects) {
    const targets = db.prepare(`
      SELECT se.id, se.nama, se.${fase} AS capaian, e.nama AS elemen, d.id AS dimensi_id, d.nama AS dimensi, d.urutan AS d_urut
      FROM project_targets pt
      JOIN p5_subelemen se ON se.id = pt.subelemen_id
      JOIN p5_elemen e ON e.id = se.elemen_id
      JOIN p5_dimensi d ON d.id = e.dimensi_id
      WHERE pt.project_id = ? ORDER BY d.urutan, pt.urutan, se.id`).all(p.id);
    const scores = new Map(db.prepare('SELECT subelemen_id, nilai FROM project_scores WHERE project_id = ? AND student_id = ?')
      .all(p.id, studentId).map((r) => [r.subelemen_id, r.nilai]));
    const dims = [];
    for (const t of targets) {
      let d = dims.find((x) => x.id === t.dimensi_id);
      if (!d) { d = { id: t.dimensi_id, nama: t.dimensi, items: [] }; dims.push(d); }
      d.items.push({ ...t, nilai: scores.get(t.id) || null });
    }
    for (const d of dims) {
      const vals = d.items.map((i) => i.nilai).filter(Boolean);
      d.nilai = vals.length ? Math.max(...vals) : null;
    }
    p.dimensi = dims;
    // ringkasan 6 dimensi: penilaian umum bila diisi, jika tidak pakai nilai tertinggi sub-elemen
    const umum = new Map(db.prepare('SELECT dimensi_id, nilai FROM project_dim_scores WHERE project_id = ? AND student_id = ?')
      .all(p.id, studentId).map((r) => [r.dimensi_id, r.nilai]));
    p.ringkasan = new Map();
    for (const d of db.prepare('SELECT id FROM p5_dimensi').all()) {
      const fromSub = dims.find((x) => x.id === d.id);
      p.ringkasan.set(d.id, umum.get(d.id) || (fromSub ? fromSub.nilai : null));
    }
    const note = db.prepare('SELECT catatan FROM project_notes WHERE project_id = ? AND student_id = ?').get(p.id, studentId);
    p.catatan = note ? note.catatan : '';
  }
  const allDims = db.prepare('SELECT * FROM p5_dimensi ORDER BY urutan').all();
  return { ...base, projects, allDims, P5_LEVEL };
}

/** Data Buku Induk: identitas lengkap + rapor setiap periode yang pernah diikuti. */
function buildBukuInduk(studentId) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) return null;
  const periods = db.prepare(`SELECT p.* FROM periods p JOIN rapor_siswa rs ON rs.period_id = p.id AND rs.student_id = ?
    ORDER BY p.tahun_pelajaran, p.semester`).all(studentId);
  const rapor = periods.map((p) => buildStudentRapor(p.id, studentId)).filter((r) => r && r.cls);
  const active = getActivePeriod();
  const base = buildStudentRapor(active.id, studentId);
  const jasmani = db.prepare(`SELECT p.tahun_pelajaran, p.semester, rs.tinggi, rs.berat FROM rapor_siswa rs
    JOIN periods p ON p.id = rs.period_id WHERE rs.student_id = ? ORDER BY p.tahun_pelajaran, p.semester`).all(studentId);
  return { ...base, rapor, jasmani };
}

module.exports = {
  buildBukuInduk,
  getSettings, getActivePeriod, getPeriod, classSubjects, ensureClassSubjects, studentsOfClass, classOfStudent,
  touchRaporSiswa, loadSubjectData, buildClassReport, buildStudentRapor, buildProjectRapor, legerColumns, legerValue,
};
