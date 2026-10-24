const express = require('express');
const { db } = require('../../db');
const { requireAdmin } = require('../../lib/auth');
const { str } = require('./_util');

const router = express.Router();

const PROFIL_FIELDS = ['kementerian', 'korwil', 'status_sekolah', 'pemda', 'instansi', 'nama_sekolah', 'nss', 'npsn', 'alamat', 'desa', 'kecamatan', 'kabupaten',
  'provinsi', 'kode_pos', 'telp', 'faks', 'website', 'email', 'kepsek_nama', 'kepsek_nip'];

// disiapkan per pemanggilan karena database bisa berbeda per sekolah
const setSetting = { run: (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v) };

router.get('/sekolah', requireAdmin, (req, res) => {
  res.render('app/sekolah', { title: 'Profil Sekolah' });
});

const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const LOGO_MAX = Math.ceil((1024 * 1024 * 4) / 3) + 40; // ±1 MB berkas asli

router.post('/sekolah', requireAdmin, (req, res) => {
  let pesanLogo = null;
  db.transaction(() => {
    const terkunci = res.locals.settings.lisensi || res.locals.multi ? ['nama_sekolah', 'npsn'] : [];
    for (const f of PROFIL_FIELDS) if (!terkunci.includes(f)) setSetting.run(f, String(req.body[f] || '').trim());
    for (const jenis of ['sekolah', 'pemda']) {
      if (req.body[`hapus_logo_${jenis}`]) setSetting.run(`logo_${jenis}`, '');
      const data = String(req.body[`logo_${jenis}`] || '');
      if (!data) continue;
      if (!LOGO_RE.test(data) || data.length > LOGO_MAX) {
        pesanLogo = 'Logo harus berupa gambar PNG, JPG, atau WEBP dengan ukuran maksimal 1 MB.';
        continue;
      }
      setSetting.run(`logo_${jenis}`, data);
    }
  })();
  if (pesanLogo) { req.flash('error', `Profil disimpan, tetapi ${pesanLogo.charAt(0).toLowerCase()}${pesanLogo.slice(1)}`); return res.redirect('/app/sekolah'); }
  req.flash('success', 'Profil sekolah disimpan.');
  res.redirect('/app/sekolah');
});

// ===== Pengaturan penilaian =====
router.get('/pengaturan', requireAdmin, (req, res) => {
  const bank = db.prepare('SELECT * FROM bank_kalimat ORDER BY jenis, id').all();
  res.render('app/pengaturan', { title: 'Pengaturan Penilaian', bank });
});

router.post('/pengaturan', requireAdmin, (req, res) => {
  const b = req.body;
  const predikat = [];
  const mins = [].concat(b.p_min || []);
  const labels = [].concat(b.p_label || []);
  const kal = [].concat(b.p_kalimat || []);
  mins.forEach((m, i) => {
    if (labels[i] && String(labels[i]).trim()) {
      predikat.push({ min: Number(m) || 0, label: String(labels[i]).trim(), kalimat: String(kal[i] || '').trim() });
    }
  });
  predikat.sort((x, y) => y.min - x.min);
  db.transaction(() => {
    for (const k of ['bobot_f', 'bobot_s', 'bobot_as']) setSetting.run(k, String(Math.max(0, Number(b[k]) || 0)));
    setSetting.run('predikat', JSON.stringify(predikat));
    setSetting.run('desk_mode', b.desk_mode === 'sederhana' ? 'sederhana' : 'predikat');
    setSetting.run('desk_nama', b.desk_nama ? '1' : '0');
    setSetting.run('kalimat_tinggi', String(b.kalimat_tinggi || '').trim());
    setSetting.run('kalimat_rendah', String(b.kalimat_rendah || '').trim());
    setSetting.run('catatan_ranking', ['none', 'all', 'top'].includes(b.catatan_ranking) ? b.catatan_ranking : 'none');
    setSetting.run('ranking_batas', String(Math.max(1, Math.min(200, parseInt(b.ranking_batas, 10) || 10))));
    setSetting.run('juara_jumlah', String(Math.max(1, Math.min(200, parseInt(b.juara_jumlah, 10) || 3))));
    setSetting.run('ttd_ortu', String(b.ttd_ortu || 'Orang Tua/Wali').trim());
    setSetting.run('public_portal', b.public_portal ? '1' : '0');
  })();
  req.flash('success', 'Pengaturan penilaian disimpan.');
  res.redirect('/app/pengaturan');
});

router.post('/pengaturan/bank', requireAdmin, (req, res) => {
  const jenis = ['catatan', 'ekskul', 'proses'].includes(req.body.jenis) ? req.body.jenis : null;
  const lines = String(req.body.teks || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (jenis) {
    db.transaction(() => {
      db.prepare('DELETE FROM bank_kalimat WHERE jenis = ?').run(jenis);
      const ins = db.prepare('INSERT INTO bank_kalimat (jenis, teks) VALUES (?, ?)');
      for (const l of lines) ins.run(jenis, l);
    })();
    req.flash('success', 'Bank kalimat diperbarui.');
  }
  res.redirect('/app/pengaturan#bank');
});

// ===== Periode (tahun pelajaran & semester) =====
router.get('/periode', requireAdmin, (req, res) => {
  const periods = db.prepare('SELECT * FROM periods ORDER BY tahun_pelajaran DESC, semester DESC').all();
  res.render('app/periode', { title: 'Tahun Pelajaran & Semester', periods });
});

router.post('/periode', requireAdmin, (req, res) => {
  const tp = String(req.body.tahun_pelajaran || '').trim();
  const sem = Number(req.body.semester) === 2 ? 2 : 1;
  if (!/^\d{4}\/\d{4}$/.test(tp)) {
    req.flash('error', 'Format tahun pelajaran harus seperti 2025/2026.');
    return res.redirect('/app/periode');
  }
  const info = db.prepare('INSERT OR IGNORE INTO periods (tahun_pelajaran, semester) VALUES (?, ?)').run(tp, sem);
  if (info.changes && req.body.copy_tp) {
    // salin LM & TP dari periode aktif dengan semester yang sama atau periode aktif
    const src = db.prepare('SELECT * FROM periods WHERE id = ?').get(req.body.copy_from);
    if (src) {
      db.transaction(() => {
        const baru = info.lastInsertRowid;
        const lmBaru = new Map();
        const insLm = db.prepare('INSERT INTO lingkup_materi (period_id, class_id, subject_id, urutan, nama) VALUES (?, ?, ?, ?, ?)');
        for (const l of db.prepare('SELECT * FROM lingkup_materi WHERE period_id = ?').all(src.id)) {
          lmBaru.set(l.id, insLm.run(baru, l.class_id, l.subject_id, l.urutan, l.nama).lastInsertRowid);
        }
        const insTp = db.prepare('INSERT INTO tujuan_pembelajaran (period_id, class_id, subject_id, urutan, deskripsi, lm_id) VALUES (?, ?, ?, ?, ?, ?)');
        for (const x of db.prepare('SELECT * FROM tujuan_pembelajaran WHERE period_id = ?').all(src.id)) {
          insTp.run(baru, x.class_id, x.subject_id, x.urutan, x.deskripsi, lmBaru.get(x.lm_id) || null);
        }
      })();
    }
  }
  req.flash(info.changes ? 'success' : 'error', info.changes ? 'Periode ditambahkan.' : 'Periode tersebut sudah ada.');
  res.redirect('/app/periode');
});

router.post('/periode/:id', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM periods WHERE id = ?').get(req.params.id);
  if (!p) return res.redirect('/app/periode');
  const action = req.body.action;
  if (action === 'activate') {
    db.transaction(() => {
      // bekukan susunan kelas pada periode lama agar arsip rapor tetap benar
      const old = db.prepare('SELECT id FROM periods WHERE is_active = 1').get();
      if (old) {
        db.prepare(`INSERT OR IGNORE INTO rapor_siswa (period_id, student_id, class_id)
          SELECT ?, id, class_id FROM students WHERE status = 'aktif' AND class_id IS NOT NULL`).run(old.id);
      }
      db.prepare('UPDATE periods SET is_active = 0').run();
      db.prepare('UPDATE periods SET is_active = 1 WHERE id = ?').run(p.id);
    })();
    req.flash('success', `Periode ${p.tahun_pelajaran} semester ${p.semester} sekarang aktif.`);
  } else if (action === 'publish') {
    db.prepare('UPDATE periods SET is_published = 1 - is_published WHERE id = ?').run(p.id);
    req.flash('success', p.is_published ? 'Rapor disembunyikan dari portal orang tua.' : 'Rapor dipublikasikan ke portal orang tua.');
  } else if (action === 'delete') {
    if (p.is_active) {
      req.flash('error', 'Periode aktif tidak dapat dihapus.');
    } else {
      db.prepare('DELETE FROM periods WHERE id = ?').run(p.id);
      req.flash('success', 'Periode beserta seluruh nilainya dihapus.');
    }
  } else {
    db.prepare('UPDATE periods SET tempat_rapor = ?, tanggal_rapor = ?, tanggal_rapor_tts = ? WHERE id = ?')
      .run(str(req.body.tempat_rapor), str(req.body.tanggal_rapor), str(req.body.tanggal_rapor_tts), p.id);
    req.flash('success', 'Tanggal rapor disimpan.');
  }
  res.redirect('/app/periode');
});

// ===== Mata pelajaran (global) =====
router.get('/mapel', requireAdmin, (req, res) => {
  const subjects = db.prepare('SELECT * FROM subjects ORDER BY urutan, id').all();
  res.render('app/mapel', { title: 'Mata Pelajaran', subjects });
});

router.post('/mapel', requireAdmin, (req, res) => {
  const nama = str(req.body.nama);
  const singkat = str(req.body.singkat) || (nama || '').slice(0, 8);
  const kelompok = ['umum', 'seni', 'mulok'].includes(req.body.kelompok) ? req.body.kelompok : 'mulok';
  if (nama) {
    const kode = `${kelompok.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    const urutan = kelompok === 'mulok' ? 9 : kelompok === 'seni' ? 6 : 8;
    const id = db.prepare('INSERT INTO subjects (kode, nama, singkat, kelompok, urutan) VALUES (?, ?, ?, ?, ?)')
      .run(kode, nama, singkat, kelompok, urutan).lastInsertRowid;
    db.prepare('INSERT OR IGNORE INTO class_subjects (class_id, subject_id, aktif, kktp) SELECT id, ?, 1, 70 FROM classes').run(id);
    req.flash('success', 'Mata pelajaran ditambahkan dan diaktifkan di semua kelas.');
  }
  res.redirect('/app/mapel');
});

router.post('/mapel/:id', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM subjects WHERE id = ?').get(req.params.id);
  if (!s) return res.redirect('/app/mapel');
  if (req.body.action === 'delete') {
    if (/^(AG-|PPKN$|BIND$|MTK$|IPAS$|SENI-(MUSIK|TARI|RUPA|TEATER)$|PJOK$|BING$)/.test(s.kode)) {
      req.flash('error', 'Mapel inti tidak dapat dihapus. Nonaktifkan dari pengaturan mapel kelas.');
    } else {
      db.prepare('DELETE FROM subjects WHERE id = ?').run(s.id);
      req.flash('success', 'Mata pelajaran dihapus.');
    }
  } else {
    db.prepare('UPDATE subjects SET nama = ?, singkat = ?, urutan = ? WHERE id = ?')
      .run(str(req.body.nama) || s.nama, str(req.body.singkat) || s.singkat, Number(req.body.urutan) || s.urutan, s.id);
    req.flash('success', 'Mata pelajaran diperbarui.');
  }
  res.redirect('/app/mapel');
});

// ===== Cadangan database =====
router.get('/backup', (req, res, next) => {
  if (res.locals.user.role === 'admin' || res.locals.settings._instalasi_guru === '1') return next();
  return requireAdmin(req, res, next);
}, async (req, res, next) => {
  try {
    const os = require('os');
    const path = require('path');
    const file = path.join(os.tmpdir(), `rapor-backup-${Date.now()}.sqlite`);
    await db.backup(file);
    const stamp = new Date().toISOString().slice(0, 10);
    res.download(file, `rapor-${stamp}.sqlite`, () => require('fs').unlink(file, () => {}));
  } catch (e) { next(e); }
});

module.exports = router;
