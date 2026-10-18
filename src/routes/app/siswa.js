const express = require('express');
const { db, BUKU_INDUK_FIELDS } = require('../../db');
const { allowedClasses, canAccessClass } = require('../../lib/auth');
const { buildStudentRapor } = require('../../lib/rapor');
const { str } = require('./_util');
const { parseCSV } = require('../../lib/csv');

const router = express.Router();

const FIELDS = ['nis', 'nisn', 'nama', 'panggilan', 'tempat_lahir', 'tanggal_lahir', 'jenis_kelamin', 'agama',
  'pendidikan_sebelumnya', 'alamat', 'ayah_nama', 'ibu_nama', 'ayah_pekerjaan', 'ibu_pekerjaan', 'ortu_jalan',
  'ortu_desa', 'ortu_kecamatan', 'ortu_kabupaten', 'ortu_provinsi', 'wali_nama', 'wali_pekerjaan', 'wali_alamat'];
// semua kolom yang disimpan (identitas rapor + Buku Induk)
const ALL_FIELDS = [...FIELDS, ...BUKU_INDUK_FIELDS];
const AGAMA = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Khonghucu'];

function normAgama(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s.startsWith('bud') || s === 'budha') return 'Buddha';
  if (s.startsWith('kong') || s.startsWith('khong')) return 'Khonghucu';
  return AGAMA.find((a) => a.toLowerCase() === s) || null;
}

function normJK(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s.startsWith('l')) return 'L';
  if (s.startsWith('p')) return 'P';
  return null;
}

function normDate(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s || null;
}

function studentFromBody(b) {
  const data = {};
  for (const f of ALL_FIELDS) data[f] = str(b[f]);
  data.jenis_kelamin = normJK(data.jenis_kelamin);
  data.agama = normAgama(data.agama);
  data.tanggal_lahir = normDate(data.tanggal_lahir);
  data.diterima_tanggal = normDate(data.diterima_tanggal);
  data.keluar_tanggal = normDate(data.keluar_tanggal);
  return data;
}

function canEditStudent(user, st) {
  if (user.role === 'admin') return true;
  return st.class_id && canAccessClass(user, st.class_id);
}

router.get('/siswa', (req, res) => {
  const classes = allowedClasses(res.locals.user);
  const isAdmin = res.locals.user.role === 'admin';
  const kelas = req.query.kelas || (isAdmin ? '' : (classes[0] && String(classes[0].id)) || '');
  const q = String(req.query.q || '').trim();
  const where = [];
  const params = [];
  if (kelas === 'none' && isAdmin) where.push('s.class_id IS NULL');
  else if (kelas) {
    if (!canAccessClass(res.locals.user, kelas)) return res.redirect('/app/siswa');
    where.push('s.class_id = ?'); params.push(kelas);
  } else if (!isAdmin) {
    where.push('1 = 0');
  }
  if (q) { where.push('(s.nama LIKE ? OR s.nisn LIKE ? OR s.nis LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (!req.query.semua) where.push("s.status = 'aktif'");
  const students = db.prepare(`SELECT s.*, c.nama AS kelas_nama FROM students s LEFT JOIN classes c ON c.id = s.class_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.tingkat, c.nama, s.nama COLLATE NOCASE`).all(...params);
  res.render('app/siswa-list', { title: 'Data Siswa', students, classes, kelas, q, semua: !!req.query.semua });
});

router.get('/siswa/baru', (req, res) => {
  const classes = allowedClasses(res.locals.user);
  res.render('app/siswa-form', { title: 'Tambah Siswa', st: { class_id: Number(req.query.kelas) || null }, classes, AGAMA });
});

router.post('/siswa/baru', (req, res) => {
  const data = studentFromBody(req.body);
  const classId = Number(req.body.class_id) || null;
  if (!data.nama) { req.flash('error', 'Nama siswa wajib diisi.'); return res.redirect('/app/siswa/baru'); }
  if (classId && !canAccessClass(res.locals.user, classId)) return res.redirect('/app/siswa');
  if (!classId && res.locals.user.role !== 'admin') { req.flash('error', 'Pilih kelas.'); return res.redirect('/app/siswa/baru'); }
  const cols = [...ALL_FIELDS, 'class_id'];
  const id = db.prepare(`INSERT INTO students (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...ALL_FIELDS.map((f) => data[f]), classId).lastInsertRowid;
  req.flash('success', `Siswa ${data.nama} ditambahkan.`);
  res.redirect(req.body.lagi ? `/app/siswa/baru?kelas=${classId || ''}` : `/app/siswa/${id}`);
});

router.get('/siswa/impor', (req, res) => {
  const classes = allowedClasses(res.locals.user);
  res.render('app/siswa-impor', { title: 'Impor Siswa', classes, FIELDS, EXTRA: BUKU_INDUK_FIELDS, kelas: req.query.kelas || '' });
});

router.post('/siswa/impor', (req, res) => {
  const classId = Number(req.body.class_id) || null;
  if (!classId || !canAccessClass(res.locals.user, classId)) {
    req.flash('error', 'Pilih kelas tujuan.');
    return res.redirect('/app/siswa/impor');
  }
  const rows = parseCSV(String(req.body.csv || ''));
  if (rows.length < 2) { req.flash('error', 'Data kosong. Baris pertama harus berisi judul kolom.'); return res.redirect('/app/siswa/impor'); }
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  let n = 0;
  const cols = [...ALL_FIELDS, 'class_id'];
  const ins = db.prepare(`INSERT INTO students (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  db.transaction(() => {
    for (const r of rows.slice(1)) {
      const obj = {};
      header.forEach((h, i) => { obj[h] = r[i]; });
      const data = studentFromBody(obj);
      if (!data.nama) continue;
      ins.run(...ALL_FIELDS.map((f) => data[f]), classId);
      n += 1;
    }
  })();
  req.flash('success', `${n} siswa berhasil diimpor.`);
  res.redirect(`/app/siswa?kelas=${classId}`);
});

router.get('/siswa/template.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="template-siswa.csv"');
  res.send(`﻿${FIELDS.join(',')}\n1001,0123456789,Nama Lengkap Siswa,Panggilan,Kota,2015-07-17,L,Islam,TK,Jl. Contoh No. 1,Nama Ayah,Nama Ibu,Petani,Ibu Rumah Tangga,Jl. Contoh No. 1,Desa,Kecamatan,Kabupaten,Provinsi,,,\n`);
});

router.get('/siswa/:id', (req, res) => {
  const st = db.prepare('SELECT s.*, c.nama AS kelas_nama FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = ?').get(req.params.id);
  if (!st || !canEditStudent(res.locals.user, st)) return res.redirect('/app/siswa');
  const period = res.locals.activePeriod;
  const rapor = buildStudentRapor(period.id, st.id);
  const periods = db.prepare('SELECT * FROM periods ORDER BY tahun_pelajaran DESC, semester DESC').all();
  res.render('app/siswa-detail', { title: st.nama, st, rapor, periods });
});

router.get('/siswa/:id/edit', (req, res) => {
  const st = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!st || !canEditStudent(res.locals.user, st)) return res.redirect('/app/siswa');
  res.render('app/siswa-form', { title: `Ubah ${st.nama}`, st, classes: allowedClasses(res.locals.user), AGAMA });
});

router.post('/siswa/:id', (req, res) => {
  const st = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!st || !canEditStudent(res.locals.user, st)) return res.redirect('/app/siswa');
  if (req.body.action === 'delete') {
    if (res.locals.user.role !== 'admin') { req.flash('error', 'Hanya admin yang dapat menghapus siswa.'); return res.redirect(`/app/siswa/${st.id}`); }
    db.prepare('DELETE FROM students WHERE id = ?').run(st.id);
    req.flash('success', `Data ${st.nama} dihapus.`);
    return res.redirect('/app/siswa');
  }
  const data = studentFromBody(req.body);
  if (!data.nama) { req.flash('error', 'Nama siswa wajib diisi.'); return res.redirect(`/app/siswa/${st.id}/edit`); }
  let classId = Number(req.body.class_id) || null;
  if (classId && !canAccessClass(res.locals.user, classId)) classId = st.class_id;
  const status = ['aktif', 'pindah', 'lulus', 'keluar'].includes(req.body.status) ? req.body.status : st.status;
  db.prepare(`UPDATE students SET ${ALL_FIELDS.map((f) => `${f} = ?`).join(', ')}, class_id = ?, status = ? WHERE id = ?`)
    .run(...ALL_FIELDS.map((f) => data[f]), classId, status, st.id);
  req.flash('success', 'Data siswa disimpan.');
  res.redirect(`/app/siswa/${st.id}`);
});

module.exports = router;
