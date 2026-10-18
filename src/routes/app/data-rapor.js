const express = require('express');
const { db } = require('../../db');
const { studentsOfClass, touchRaporSiswa } = require('../../lib/rapor');
const { loadClass, workingPeriod, str } = require('./_util');

const router = express.Router();

function raporMap(periodId, students) {
  const m = new Map();
  if (!students.length) return m;
  const rows = db.prepare(`SELECT * FROM rapor_siswa WHERE period_id = ? AND student_id IN (${students.map(() => '?').join(',')})`)
    .all(periodId, ...students.map((s) => s.id));
  for (const r of rows) m.set(r.student_id, r);
  return m;
}

function int(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 365) : 0;
}

// ===== Absensi, catatan wali kelas, kenaikan kelas =====
const PAGES = {
  absensi: { title: 'Ketidakhadiran' },
  catatan: { title: 'Catatan Wali Kelas' },
  kenaikan: { title: 'Kenaikan Kelas' },
};

for (const [key, meta] of Object.entries(PAGES)) {
  router.get(`/:classId/${key}`, loadClass, (req, res) => {
    const period = workingPeriod(req, res);
    const students = studentsOfClass(period.id, req.cls.id);
    const data = raporMap(period.id, students);
    const bank = db.prepare("SELECT teks FROM bank_kalimat WHERE jenis = 'catatan' ORDER BY id").all().map((r) => r.teks);
    res.render(`app/data-${key}`, { title: `${meta.title} ${req.cls.nama}`, period, students, data, bank });
  });

  router.post(`/:classId/${key}`, loadClass, (req, res) => {
    const period = workingPeriod(req, res);
    const students = studentsOfClass(period.id, req.cls.id);
    const b = req.body;
    db.transaction(() => {
      for (const st of students) {
        touchRaporSiswa(period.id, st.id, req.cls.id);
        if (key === 'absensi') {
          db.prepare('UPDATE rapor_siswa SET sakit = ?, izin = ?, alpa = ? WHERE period_id = ? AND student_id = ?')
            .run(int(b[`sakit_${st.id}`]), int(b[`izin_${st.id}`]), int(b[`alpa_${st.id}`]), period.id, st.id);
        } else if (key === 'catatan') {
          db.prepare('UPDATE rapor_siswa SET catatan = ? WHERE period_id = ? AND student_id = ?').run(str(b[`catatan_${st.id}`]), period.id, st.id);
        } else {
          const v = b[`naik_${st.id}`];
          db.prepare('UPDATE rapor_siswa SET naik = ? WHERE period_id = ? AND student_id = ?')
            .run(v === '1' ? 1 : v === '0' ? 0 : null, period.id, st.id);
        }
      }
    })();
    req.flash('success', `${meta.title} tersimpan.`);
    res.redirect(`/app/kelas/${req.cls.id}/${key}`);
  });
}

// ===== Ekstrakurikuler =====
const MAX_EKSKUL = 5;

router.get('/:classId/ekskul', loadClass, (req, res) => {
  const period = workingPeriod(req, res);
  const students = studentsOfClass(period.id, req.cls.id);
  const rows = db.prepare('SELECT * FROM ekstrakurikuler WHERE period_id = ? ORDER BY urutan').all(period.id);
  const data = new Map();
  for (const r of rows) {
    if (!data.has(r.student_id)) data.set(r.student_id, []);
    data.get(r.student_id).push(r);
  }
  const bank = db.prepare("SELECT teks FROM bank_kalimat WHERE jenis = 'ekskul' ORDER BY id").all().map((r) => r.teks);
  const namaEkskul = db.prepare('SELECT DISTINCT nama FROM ekstrakurikuler ORDER BY nama').all().map((r) => r.nama);
  if (!namaEkskul.includes('Pramuka')) namaEkskul.unshift('Pramuka');
  res.render('app/data-ekskul', { title: `Ekstrakurikuler ${req.cls.nama}`, period, students, data, bank, namaEkskul, MAX_EKSKUL });
});

router.post('/:classId/ekskul', loadClass, (req, res) => {
  const period = workingPeriod(req, res);
  const students = studentsOfClass(period.id, req.cls.id);
  const b = req.body;
  const ins = db.prepare('INSERT INTO ekstrakurikuler (period_id, student_id, urutan, nama, keterangan) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const st of students) {
      db.prepare('DELETE FROM ekstrakurikuler WHERE period_id = ? AND student_id = ?').run(period.id, st.id);
      let u = 0;
      for (let i = 1; i <= MAX_EKSKUL; i += 1) {
        const nama = str(b[`en_${st.id}_${i}`]);
        if (nama) ins.run(period.id, st.id, ++u, nama, str(b[`ek_${st.id}_${i}`]));
      }
      touchRaporSiswa(period.id, st.id, req.cls.id);
    }
  })();
  req.flash('success', 'Data ekstrakurikuler tersimpan.');
  res.redirect(`/app/kelas/${req.cls.id}/ekskul`);
});

// Isi massal ekskul wajib (mis. Pramuka) untuk semua siswa yang belum punya
router.post('/:classId/ekskul/massal', loadClass, (req, res) => {
  const period = workingPeriod(req, res);
  const nama = str(req.body.nama);
  if (nama) {
    const students = studentsOfClass(period.id, req.cls.id);
    db.transaction(() => {
      for (const st of students) {
        const exists = db.prepare('SELECT 1 FROM ekstrakurikuler WHERE period_id = ? AND student_id = ? AND nama = ?').get(period.id, st.id, nama);
        if (exists) continue;
        const max = db.prepare('SELECT COALESCE(MAX(urutan), 0) m FROM ekstrakurikuler WHERE period_id = ? AND student_id = ?').get(period.id, st.id).m;
        if (max >= MAX_EKSKUL) continue;
        db.prepare('INSERT INTO ekstrakurikuler (period_id, student_id, urutan, nama, keterangan) VALUES (?, ?, ?, ?, ?)')
          .run(period.id, st.id, max + 1, nama, str(req.body.keterangan));
        touchRaporSiswa(period.id, st.id, req.cls.id);
      }
    })();
    req.flash('success', `Ekstrakurikuler ${nama} ditambahkan ke semua siswa.`);
  }
  res.redirect(`/app/kelas/${req.cls.id}/ekskul`);
});

module.exports = router;
