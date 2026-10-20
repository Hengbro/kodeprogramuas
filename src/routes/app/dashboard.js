const express = require('express');
const { db } = require('../../db');
const { allowedClasses } = require('../../lib/auth');
const { verifyPassword } = require('../../lib/password');

const router = express.Router();

router.get('/', (req, res) => {
  const classes = allowedClasses(res.locals.user);
  const period = res.locals.activePeriod;
  for (const c of classes) {
    const tp = db.prepare('SELECT COUNT(*) n FROM tujuan_pembelajaran WHERE period_id = ? AND class_id = ?').get(period.id, c.id).n;
    const nilai = db.prepare(`SELECT COUNT(DISTINCT tp.subject_id) n FROM nilai_formatif nf
      JOIN tujuan_pembelajaran tp ON tp.id = nf.tp_id WHERE tp.period_id = ? AND tp.class_id = ?`).get(period.id, c.id).n;
    const mapel = db.prepare(`SELECT COUNT(*) n FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id
      WHERE cs.class_id = ? AND cs.aktif = 1 AND s.kelompok != 'agama'`).get(c.id).n + 1;
    c.progress = { tp, nilai, mapel };
  }
  const stats = {
    siswa: db.prepare("SELECT COUNT(*) n FROM students WHERE status = 'aktif'").get().n,
    kelas: db.prepare('SELECT COUNT(*) n FROM classes').get().n,
    guru: db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'guru'").get().n,
    tanpaKelas: db.prepare("SELECT COUNT(*) n FROM students WHERE status = 'aktif' AND class_id IS NULL").get().n,
  };
  const me = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(res.locals.user.id);
  const sandiBawaan = verifyPassword('admin123', me.password_hash) || verifyPassword('guru123', me.password_hash);
  res.render('app/dashboard', { title: 'Dasbor', classes, stats, sandiBawaan });
});

module.exports = router;
