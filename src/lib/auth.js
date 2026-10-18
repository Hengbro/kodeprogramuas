const { db } = require('../db');

function requireLogin(req, res, next) {
  if (!res.locals.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!res.locals.user || res.locals.user.role !== 'admin') {
    return res.status(403).render('error', { title: 'Akses ditolak', message: 'Halaman ini hanya untuk administrator.' });
  }
  next();
}

/** Kelas yang boleh diakses user (admin: semua, guru: kelas yang diampu). */
function allowedClasses(user) {
  if (!user) return [];
  const sql = `SELECT c.*, u.nama AS guru_nama, u.nip AS guru_nip,
      (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status = 'aktif') AS jumlah_siswa
    FROM classes c LEFT JOIN users u ON u.id = c.guru_id`;
  if (user.role === 'admin') return db.prepare(`${sql} ORDER BY c.tingkat, c.nama`).all();
  return db.prepare(`${sql} WHERE c.guru_id = ? ORDER BY c.tingkat, c.nama`).all(user.id);
}

function canAccessClass(user, classId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return !!db.prepare('SELECT 1 FROM classes WHERE id = ? AND guru_id = ?').get(classId, user.id);
}

module.exports = { requireLogin, requireAdmin, allowedClasses, canAccessClass };
