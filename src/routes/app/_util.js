const { db } = require('../../db');
const { canAccessClass } = require('../../lib/auth');
const { ensureClassSubjects, getPeriod } = require('../../lib/rapor');

/** Middleware: memuat kelas :classId dan memastikan user berhak mengaksesnya. */
function loadClass(req, res, next) {
  const cls = db.prepare(`SELECT c.*, u.nama AS guru_nama, u.nip AS guru_nip FROM classes c
    LEFT JOIN users u ON u.id = c.guru_id WHERE c.id = ?`).get(req.params.classId);
  if (!cls) return res.status(404).render('error', { title: 'Kelas tidak ditemukan', message: 'Kelas tidak ditemukan.' });
  if (!canAccessClass(res.locals.user, cls.id)) {
    return res.status(403).render('error', { title: 'Akses ditolak', message: 'Anda bukan guru kelas ini.' });
  }
  ensureClassSubjects(cls);
  res.locals.cls = cls;
  req.cls = cls;
  next();
}

/** Periode yang sedang dikerjakan: ?period=ID atau periode aktif. */
function workingPeriod(req, res) {
  const id = req.query.period || req.body?.period;
  return (id && getPeriod(id)) || res.locals.activePeriod;
}

function num(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function str(v) {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
}

module.exports = { loadClass, workingPeriod, num, str };
