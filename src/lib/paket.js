// Paket Data: pertukaran data antar komputer yang masing-masing punya database sendiri.
//  - Operator → guru : "paket awal" (profil sekolah, pengaturan nilai, mapel, periode, TP kelas)
//  - Guru → operator : data kelas lengkap (siswa, TP, nilai, ekskul, absensi, catatan, P5)
// Kunci pencocokan memakai nilai alami (kode mapel, tahun pelajaran+semester, NISN, nama kelas),
// bukan id database, karena id di tiap komputer berbeda.
const crypto = require('crypto');
const { db, BUKU_INDUK_FIELDS } = require('../db');
const { hashPassword } = require('./password');
const { ensureClassSubjects } = require('./rapor');

const FORMAT = 'e-rapor-sd';
const VERSI = 1;
const STUDENT_FIELDS = ['nis', 'nisn', 'nama', 'panggilan', 'tempat_lahir', 'tanggal_lahir', 'jenis_kelamin', 'agama',
  'pendidikan_sebelumnya', 'alamat', 'ayah_nama', 'ibu_nama', 'ayah_pekerjaan', 'ibu_pekerjaan', 'ortu_jalan', 'ortu_desa',
  'ortu_kecamatan', 'ortu_kabupaten', 'ortu_provinsi', 'wali_nama', 'wali_pekerjaan', 'wali_alamat', 'status', ...BUKU_INDUK_FIELDS];

function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj[k] !== undefined) o[k] = obj[k];
  return o;
}

// ===================== EKSPOR =====================

function exportSekolah() {
  const settings = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) if (!r.key.startsWith('_')) settings[r.key] = r.value;
  const active = db.prepare('SELECT tahun_pelajaran, semester FROM periods WHERE is_active = 1').get();
  return {
    settings,
    bank_kalimat: db.prepare('SELECT jenis, teks FROM bank_kalimat ORDER BY id').all(),
    mapel: db.prepare('SELECT kode, nama, singkat, kelompok, agama, urutan FROM subjects ORDER BY urutan, id').all(),
    periode: db.prepare('SELECT tahun_pelajaran, semester, tempat_rapor, tanggal_rapor, tanggal_rapor_tts FROM periods ORDER BY tahun_pelajaran, semester').all(),
    periodeAktif: active || null,
  };
}

function exportKelas(classId, { denganNilai }) {
  const cls = db.prepare('SELECT c.*, u.nama AS guru_nama, u.nip AS guru_nip FROM classes c LEFT JOIN users u ON u.id = c.guru_id WHERE c.id = ?').get(classId);
  if (!cls) return null;
  const subj = new Map(db.prepare('SELECT * FROM subjects').all().map((s) => [s.id, s]));
  const mapel = db.prepare('SELECT * FROM class_subjects WHERE class_id = ?').all(classId).map((cs) => {
    const s = subj.get(cs.subject_id);
    return { kode: s.kode, nama: s.nama, singkat: s.singkat, kelompok: s.kelompok, agama: s.agama, urutan: s.urutan, aktif: cs.aktif, kktp: cs.kktp };
  });

  // siswa = siswa aktif di kelas + siswa yang tercatat di kelas ini pada periode mana pun
  const ids = new Set(db.prepare("SELECT id FROM students WHERE class_id = ? AND status = 'aktif'").all(classId).map((r) => r.id));
  if (denganNilai) for (const r of db.prepare('SELECT student_id FROM rapor_siswa WHERE class_id = ?').all(classId)) ids.add(r.student_id);
  const siswaRows = [...ids].map((id) => db.prepare('SELECT * FROM students WHERE id = ?').get(id)).filter(Boolean)
    .sort((a, b) => a.nama.localeCompare(b.nama));
  const key = new Map(siswaRows.map((s, i) => [s.id, i]));
  const siswa = denganNilai ? siswaRows.map((s) => ({ ...pick(s, STUDENT_FIELDS), aktifDiKelas: s.class_id === classId })) : [];

  const periods = db.prepare('SELECT * FROM periods ORDER BY tahun_pelajaran, semester').all();
  const data = [];
  for (const p of periods) {
    const tp = db.prepare('SELECT * FROM tujuan_pembelajaran WHERE period_id = ? AND class_id = ? ORDER BY subject_id, urutan').all(p.id, classId);
    const lm = db.prepare('SELECT * FROM lingkup_materi WHERE period_id = ? AND class_id = ? ORDER BY subject_id, urutan').all(p.id, classId);
    const projects = db.prepare('SELECT * FROM projects WHERE period_id = ? AND class_id = ? ORDER BY urutan').all(p.id, classId);
    const blok = {
      periode: { tahun_pelajaran: p.tahun_pelajaran, semester: p.semester },
      tp: tp.map((t) => ({
        mapel: subj.get(t.subject_id).kode, urutan: t.urutan, deskripsi: t.deskripsi,
        lm: (lm.find((l) => l.id === t.lm_id) || {}).urutan || null,
        nilai: denganNilai ? db.prepare('SELECT student_id, nilai FROM nilai_formatif WHERE tp_id = ?').all(t.id)
          .filter((r) => key.has(r.student_id)).map((r) => [key.get(r.student_id), r.nilai]) : [],
      })),
      lm: lm.map((l) => ({
        mapel: subj.get(l.subject_id).kode, urutan: l.urutan, nama: l.nama,
        nilai: denganNilai ? db.prepare('SELECT student_id, nilai FROM nilai_sumatif WHERE lm_id = ?').all(l.id)
          .filter((r) => key.has(r.student_id)).map((r) => [key.get(r.student_id), r.nilai]) : [],
      })),
      projek: projects.map((pr) => ({
        urutan: pr.urutan, nama: pr.nama, tema: pr.tema, deskripsi: pr.deskripsi,
        target: db.prepare(`SELECT se.nama FROM project_targets pt JOIN p5_subelemen se ON se.id = pt.subelemen_id
          WHERE pt.project_id = ? ORDER BY pt.urutan`).all(pr.id).map((r) => r.nama),
        nilai: denganNilai ? db.prepare(`SELECT ps.student_id, se.nama, ps.nilai FROM project_scores ps JOIN p5_subelemen se ON se.id = ps.subelemen_id
          WHERE ps.project_id = ?`).all(pr.id).filter((r) => key.has(r.student_id)).map((r) => [key.get(r.student_id), r.nama, r.nilai]) : [],
        umum: denganNilai ? db.prepare(`SELECT pd.student_id, d.nama, pd.nilai FROM project_dim_scores pd JOIN p5_dimensi d ON d.id = pd.dimensi_id
          WHERE pd.project_id = ?`).all(pr.id).filter((r) => key.has(r.student_id)).map((r) => [key.get(r.student_id), r.nama, r.nilai]) : [],
        catatan: denganNilai ? db.prepare('SELECT student_id, catatan FROM project_notes WHERE project_id = ?').all(pr.id)
          .filter((r) => key.has(r.student_id)).map((r) => [key.get(r.student_id), r.catatan]) : [],
      })),
      akhir: [], rapor: [], ekskul: [],
    };
    if (denganNilai && siswaRows.length) {
      const inIds = `(${siswaRows.map((s) => s.id).join(',')})`;
      blok.akhir = db.prepare(`SELECT * FROM nilai_akhir WHERE period_id = ? AND student_id IN ${inIds}`).all(p.id)
        .map((a) => ({ siswa: key.get(a.student_id), mapel: subj.get(a.subject_id).kode, ...pick(a, ['sts', 'sas_nontes', 'sas_tes', 'desk_tinggi', 'desk_rendah']) }));
      blok.rapor = db.prepare(`SELECT * FROM rapor_siswa WHERE period_id = ? AND student_id IN ${inIds} AND (class_id = ? OR class_id IS NULL)`).all(p.id, classId)
        .map((r) => ({ siswa: key.get(r.student_id), ...pick(r, ['sakit', 'izin', 'alpa', 'catatan', 'naik', 'tinggi', 'berat']) }));
      const diKelas = new Set(blok.rapor.map((r) => r.siswa));
      blok.ekskul = db.prepare(`SELECT * FROM ekstrakurikuler WHERE period_id = ? AND student_id IN ${inIds} ORDER BY urutan`).all(p.id)
        .filter((e) => diKelas.has(key.get(e.student_id)))
        .map((e) => ({ siswa: key.get(e.student_id), ...pick(e, ['urutan', 'nama', 'keterangan']) }));
    }
    const kosong = !blok.tp.length && !blok.lm.length && !blok.projek.length && !blok.rapor.length && !blok.akhir.length;
    if (!kosong) data.push(blok);
  }
  return {
    nama: cls.nama, tingkat: cls.tingkat, fase: cls.fase,
    guru: cls.guru_nama ? { nama: cls.guru_nama, nip: cls.guru_nip } : null,
    mapel, siswa, data,
  };
}

/**
 * @param {{ sekolah: boolean, kelas: number[], denganNilai: boolean }} opts
 */
function exportPaket(opts) {
  const s = db.prepare("SELECT value FROM settings WHERE key = 'nama_sekolah'").get();
  return {
    format: FORMAT,
    versi: VERSI,
    dibuat: new Date().toISOString(),
    sumber: { sekolah: s ? s.value : '' },
    sekolah: opts.sekolah ? exportSekolah() : null,
    kelas: (opts.kelas || []).map((id) => exportKelas(id, opts)).filter(Boolean),
  };
}

// ===================== PERIKSA =====================

function parsePaket(text) {
  let pkg;
  try { pkg = JSON.parse(String(text || '').replace(/^﻿/, '')); } catch { throw new Error('File bukan Paket Data E-Rapor yang valid.'); }
  if (!pkg || pkg.format !== FORMAT) throw new Error('File bukan Paket Data E-Rapor yang valid.');
  if (pkg.versi > VERSI) throw new Error('Paket dibuat dengan versi aplikasi yang lebih baru. Perbarui aplikasi terlebih dahulu.');
  pkg.kelas = pkg.kelas || [];
  return pkg;
}

function ringkas(pkg) {
  return {
    sumber: pkg.sumber && pkg.sumber.sekolah,
    dibuat: pkg.dibuat,
    sekolah: pkg.sekolah ? {
      mapel: pkg.sekolah.mapel.length, periode: pkg.sekolah.periode.length, periodeAktif: pkg.sekolah.periodeAktif,
      namaSekolah: pkg.sekolah.settings.nama_sekolah,
    } : null,
    kelas: pkg.kelas.map((k) => {
      const ada = db.prepare('SELECT id FROM classes WHERE nama = ? COLLATE NOCASE').get(k.nama);
      return {
        nama: k.nama, tingkat: k.tingkat, guru: k.guru && k.guru.nama, siswa: k.siswa.length, ada: !!ada,
        periode: k.data.map((d) => `${d.periode.tahun_pelajaran} Smt ${d.periode.semester}`),
        tp: k.data.reduce((a, d) => a + d.tp.length, 0),
        nilai: k.data.reduce((a, d) => a + d.tp.reduce((x, t) => x + t.nilai.length, 0), 0),
        projek: k.data.reduce((a, d) => a + d.projek.length, 0),
      };
    }),
  };
}

// ===================== IMPOR =====================

function periodId(tahun, semester, extra = {}) {
  let p = db.prepare('SELECT id FROM periods WHERE tahun_pelajaran = ? AND semester = ?').get(tahun, semester);
  if (!p) {
    const id = db.prepare('INSERT INTO periods (tahun_pelajaran, semester, tempat_rapor, tanggal_rapor, tanggal_rapor_tts) VALUES (?, ?, ?, ?, ?)')
      .run(tahun, semester, extra.tempat_rapor || null, extra.tanggal_rapor || null, extra.tanggal_rapor_tts || null).lastInsertRowid;
    p = { id };
  }
  return p.id;
}

function subjectId(m) {
  const s = db.prepare('SELECT id FROM subjects WHERE kode = ?').get(m.kode);
  if (s) return s.id;
  const id = db.prepare('INSERT INTO subjects (kode, nama, singkat, kelompok, agama, urutan) VALUES (?, ?, ?, ?, ?, ?)')
    .run(m.kode, m.nama || m.kode, m.singkat || (m.nama || m.kode).slice(0, 8), m.kelompok || 'mulok', m.agama || null, m.urutan || 9).lastInsertRowid;
  db.prepare('INSERT OR IGNORE INTO class_subjects (class_id, subject_id, aktif, kktp) SELECT id, ?, 0, 70 FROM classes').run(id);
  return id;
}

function guruId(guru, hasil) {
  if (!guru || !guru.nama) return null;
  const u = db.prepare('SELECT id FROM users WHERE nama = ? COLLATE NOCASE').get(guru.nama);
  if (u) return u.id;
  let base = guru.nama.toLowerCase().split(',')[0].replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'guru';
  let username = base;
  for (let i = 2; db.prepare('SELECT 1 FROM users WHERE username = ?').get(username); i += 1) username = `${base}${i}`;
  const password = crypto.randomBytes(4).toString('hex');
  const id = db.prepare("INSERT INTO users (username, password_hash, nama, nip, role) VALUES (?, ?, ?, ?, 'guru')")
    .run(username, hashPassword(password), guru.nama, guru.nip || null).lastInsertRowid;
  hasil.akunBaru.push({ nama: guru.nama, username, password });
  return id;
}

function findStudent(s) {
  if (s.nisn) {
    const r = db.prepare('SELECT id FROM students WHERE nisn = ?').get(s.nisn);
    if (r) return r.id;
  }
  if (s.nis) {
    const r = db.prepare('SELECT id FROM students WHERE nis = ? AND nama = ? COLLATE NOCASE').get(s.nis, s.nama);
    if (r) return r.id;
  }
  const r = db.prepare('SELECT id FROM students WHERE nama = ? COLLATE NOCASE AND COALESCE(tanggal_lahir, \'\') = COALESCE(?, \'\')').get(s.nama, s.tanggal_lahir || null);
  return r ? r.id : null;
}

function importSekolah(sk, opts, hasil) {
  const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(sk.settings || {})) if (!k.startsWith('_')) set.run(k, v);
  for (const m of sk.mapel || []) {
    const id = subjectId(m);
    db.prepare('UPDATE subjects SET nama = ?, singkat = ?, urutan = ? WHERE id = ?').run(m.nama, m.singkat, m.urutan, id);
  }
  for (const p of sk.periode || []) {
    const id = periodId(p.tahun_pelajaran, p.semester, p);
    db.prepare('UPDATE periods SET tempat_rapor = COALESCE(?, tempat_rapor), tanggal_rapor = COALESCE(?, tanggal_rapor), tanggal_rapor_tts = COALESCE(?, tanggal_rapor_tts) WHERE id = ?')
      .run(p.tempat_rapor || null, p.tanggal_rapor || null, p.tanggal_rapor_tts || null, id);
  }
  if (sk.bank_kalimat && sk.bank_kalimat.length) {
    db.prepare('DELETE FROM bank_kalimat').run();
    const ins = db.prepare('INSERT INTO bank_kalimat (jenis, teks) VALUES (?, ?)');
    for (const b of sk.bank_kalimat) ins.run(b.jenis, b.teks);
  }
  if (opts.aktifkanPeriode && sk.periodeAktif) {
    const id = periodId(sk.periodeAktif.tahun_pelajaran, sk.periodeAktif.semester);
    db.prepare('UPDATE periods SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END').run(id);
  }
  hasil.pesan.push('Profil sekolah, pengaturan nilai, mata pelajaran, dan periode diperbarui.');
}

function importKelas(k, hasil) {
  let cls = db.prepare('SELECT * FROM classes WHERE nama = ? COLLATE NOCASE').get(k.nama);
  const gid = guruId(k.guru, hasil);
  if (!cls) {
    const id = db.prepare('INSERT INTO classes (nama, tingkat, fase, guru_id) VALUES (?, ?, ?, ?)').run(k.nama, k.tingkat, k.fase, gid).lastInsertRowid;
    cls = { id, tingkat: k.tingkat };
  } else {
    db.prepare('UPDATE classes SET tingkat = ?, fase = ?, guru_id = COALESCE(?, guru_id) WHERE id = ?').run(k.tingkat, k.fase, gid, cls.id);
  }
  ensureClassSubjects(cls);
  const sid = new Map();
  for (const m of k.mapel || []) {
    const id = subjectId(m);
    sid.set(m.kode, id);
    db.prepare('UPDATE class_subjects SET aktif = ?, kktp = ? WHERE class_id = ? AND subject_id = ?').run(m.aktif, m.kktp, cls.id, id);
  }
  const subj = (kode) => (sid.has(kode) ? sid.get(kode) : subjectId({ kode }));

  // siswa
  const stId = [];
  const cols = STUDENT_FIELDS;
  let baru = 0;
  for (const s of k.siswa || []) {
    let id = findStudent(s);
    const vals = cols.map((c) => (s[c] === undefined ? null : s[c]));
    if (id) {
      db.prepare(`UPDATE students SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...vals, id);
    } else {
      id = db.prepare(`INSERT INTO students (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals).lastInsertRowid;
      baru += 1;
    }
    if (s.aktifDiKelas) db.prepare('UPDATE students SET class_id = ? WHERE id = ?').run(cls.id, id);
    stId.push(id);
  }

  // data per periode: ganti seluruh isi kelas ini pada periode tersebut
  for (const d of k.data || []) {
    const pid = periodId(d.periode.tahun_pelajaran, d.periode.semester);
    db.prepare('DELETE FROM tujuan_pembelajaran WHERE period_id = ? AND class_id = ?').run(pid, cls.id);
    db.prepare('DELETE FROM lingkup_materi WHERE period_id = ? AND class_id = ?').run(pid, cls.id);
    db.prepare('DELETE FROM projects WHERE period_id = ? AND class_id = ?').run(pid, cls.id);
    const lmId = new Map(); // "kode mapel:urutan LM" → id
    for (const l of d.lm) {
      const lid = db.prepare('INSERT INTO lingkup_materi (period_id, class_id, subject_id, urutan, nama) VALUES (?, ?, ?, ?, ?)')
        .run(pid, cls.id, subj(l.mapel), l.urutan, l.nama).lastInsertRowid;
      lmId.set(`${l.mapel}:${l.urutan}`, lid);
      for (const [i, v] of l.nilai) if (stId[i]) db.prepare('INSERT OR REPLACE INTO nilai_sumatif (lm_id, student_id, nilai) VALUES (?, ?, ?)').run(lid, stId[i], v);
    }
    for (const t of d.tp) {
      const tid = db.prepare('INSERT INTO tujuan_pembelajaran (period_id, class_id, subject_id, urutan, deskripsi, lm_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(pid, cls.id, subj(t.mapel), t.urutan, t.deskripsi, (t.lm && lmId.get(`${t.mapel}:${t.lm}`)) || null).lastInsertRowid;
      for (const [i, v] of t.nilai) if (stId[i]) db.prepare('INSERT OR REPLACE INTO nilai_formatif (tp_id, student_id, nilai) VALUES (?, ?, ?)').run(tid, stId[i], v);
    }
    for (const a of d.akhir) {
      if (!stId[a.siswa]) continue;
      db.prepare(`INSERT OR REPLACE INTO nilai_akhir (period_id, subject_id, student_id, sts, sas_nontes, sas_tes, desk_tinggi, desk_rendah)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(pid, subj(a.mapel), stId[a.siswa], a.sts ?? null, a.sas_nontes ?? null, a.sas_tes ?? null, a.desk_tinggi || null, a.desk_rendah || null);
    }
    for (const r of d.rapor) {
      if (!stId[r.siswa]) continue;
      db.prepare(`INSERT OR REPLACE INTO rapor_siswa (period_id, student_id, class_id, sakit, izin, alpa, catatan, naik, tinggi, berat)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(pid, stId[r.siswa], cls.id, r.sakit || 0, r.izin || 0, r.alpa || 0, r.catatan || null,
        r.naik ?? null, r.tinggi || null, r.berat || null);
    }
    const ekskulSiswa = new Set(d.ekskul.map((e) => e.siswa));
    for (const i of ekskulSiswa) if (stId[i]) db.prepare('DELETE FROM ekstrakurikuler WHERE period_id = ? AND student_id = ?').run(pid, stId[i]);
    for (const e of d.ekskul) {
      if (stId[e.siswa]) db.prepare('INSERT INTO ekstrakurikuler (period_id, student_id, urutan, nama, keterangan) VALUES (?, ?, ?, ?, ?)')
        .run(pid, stId[e.siswa], e.urutan, e.nama, e.keterangan || null);
    }
    for (const p of d.projek) {
      const prid = db.prepare('INSERT INTO projects (period_id, class_id, urutan, nama, tema, deskripsi) VALUES (?, ?, ?, ?, ?, ?)')
        .run(pid, cls.id, p.urutan, p.nama, p.tema || null, p.deskripsi || null).lastInsertRowid;
      const se = (nama) => db.prepare('SELECT id FROM p5_subelemen WHERE nama = ?').get(nama);
      p.target.forEach((nama, i) => { const s = se(nama); if (s) db.prepare('INSERT OR IGNORE INTO project_targets (project_id, subelemen_id, urutan) VALUES (?, ?, ?)').run(prid, s.id, i); });
      for (const [i, nama, v] of p.nilai) { const s = se(nama); if (s && stId[i]) db.prepare('INSERT OR REPLACE INTO project_scores (project_id, student_id, subelemen_id, nilai) VALUES (?, ?, ?, ?)').run(prid, stId[i], s.id, v); }
      for (const [i, nama, v] of p.umum) {
        const dm = db.prepare('SELECT id FROM p5_dimensi WHERE nama = ?').get(nama);
        if (dm && stId[i]) db.prepare('INSERT OR REPLACE INTO project_dim_scores (project_id, student_id, dimensi_id, nilai) VALUES (?, ?, ?, ?)').run(prid, stId[i], dm.id, v);
      }
      for (const [i, c] of p.catatan) if (stId[i]) db.prepare('INSERT OR REPLACE INTO project_notes (project_id, student_id, catatan) VALUES (?, ?, ?)').run(prid, stId[i], c);
    }
  }
  hasil.pesan.push(`Kelas ${k.nama}: ${stId.length} siswa (${baru} baru), ${k.data.length} periode data.`);
}

function importPaket(pkg, opts = {}) {
  const hasil = { pesan: [], akunBaru: [] };
  db.transaction(() => {
    if (pkg.sekolah && opts.sekolah !== false) importSekolah(pkg.sekolah, opts, hasil);
    for (const k of pkg.kelas) if (!opts.kelas || opts.kelas.includes(k.nama)) importKelas(k, hasil);
  })();
  return hasil;
}

// ===================== PAKET APLIKASI GURU / SEKOLAH =====================

/** Akun untuk dibawa ke laptop (hash sandi, bukan sandi). Tiap akun diberi uid tetap agar perubahan username ikut tersinkron. */
function akunUntukPaket(ids) {
  const isiUid = db.prepare('UPDATE users SET uid = ? WHERE id = ? AND uid IS NULL');
  const ambil = db.prepare('SELECT id, uid, username, password_hash, nama, nip, role FROM users WHERE id = ?');
  return ids.map((id) => {
    let u = ambil.get(id);
    if (!u) return null;
    if (!u.uid) { isiUid.run(crypto.randomUUID(), u.id); u = ambil.get(id); }
    return { uid: u.uid, username: u.username, password_hash: u.password_hash, nama: u.nama, nip: u.nip, role: u.role === 'admin' ? 'admin' : 'guru' };
  }).filter(Boolean);
}

/**
 * Paket untuk dipasang di komputer guru: lisensi sekolah + pengaturan sekolah + kelas guru + akun guru.
 * Akun ADMIN sekolah selalu ikut, agar admin/kepala sekolah juga bisa masuk di laptop guru dengan akun yang sama seperti online.
 * @param {number[]} userIds guru yang disertakan
 */
function exportPaketGuru(userIds) {
  const users = userIds.map((id) => db.prepare('SELECT id FROM users WHERE id = ?').get(id)).filter(Boolean);
  const kelas = [];
  for (const u of users) for (const c of db.prepare('SELECT id FROM classes WHERE guru_id = ? ORDER BY tingkat, nama').all(u.id)) kelas.push(c.id);
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id").all().map((r) => r.id);
  const lis = db.prepare("SELECT value FROM settings WHERE key = '_lisensi'").get();
  const pkg = exportPaket({ sekolah: true, kelas, denganNilai: true });
  pkg.jenis = 'guru';
  pkg.lisensi = lis ? lis.value : null;
  pkg.akun = akunUntukPaket([...new Set([...users.map((u) => u.id), ...admin])]);
  return pkg;
}

/** Paket LENGKAP satu sekolah (untuk ZIP sekolah/admin): semua kelas, siswa, nilai, dan SEMUA akun dengan peran masing-masing. */
function exportPaketSekolah() {
  const kelas = db.prepare('SELECT id FROM classes ORDER BY tingkat, nama').all().map((r) => r.id);
  const lis = db.prepare("SELECT value FROM settings WHERE key = '_lisensi'").get();
  const pkg = exportPaket({ sekolah: true, kelas, denganNilai: true });
  pkg.jenis = 'sekolah';
  pkg.lisensi = lis ? lis.value : null;
  pkg.akun = akunUntukPaket(db.prepare('SELECT id FROM users ORDER BY id').all().map((r) => r.id));
  return pkg;
}

/**
 * Menyamakan akun di komputer ini dengan akun dari paket (dari server): username, hash sandi, nama, NIP, peran.
 * Dicocokkan lewat uid dulu (agar username yang diganti di server ikut berganti), lalu lewat username.
 * Akun yang hanya ada di komputer ini tidak dihapus. Data nilai tidak disentuh.
 */
function sinkronAkun(akun) {
  const hasil = { baru: 0, diperbarui: 0 };
  for (const a of akun || []) {
    if (!a || !a.username || !a.password_hash) continue;
    const role = a.role === 'admin' ? 'admin' : 'guru';
    let u = a.uid ? db.prepare('SELECT id, username FROM users WHERE uid = ?').get(a.uid) : null;
    if (!u) u = db.prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE').get(a.username);
    if (u) {
      // username baru dipakai akun lain di komputer ini → akun lain itu yang tertimpa namanya tidak boleh; lewati penggantian nama
      const bentrok = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(a.username, u.id);
      db.prepare('UPDATE users SET username = ?, password_hash = ?, sandi_enc = NULL, nama = ?, nip = ?, role = ?, uid = ? WHERE id = ?')
        .run(bentrok ? u.username : a.username, a.password_hash, a.nama || a.username, a.nip || null, role, a.uid || null, u.id);
      hasil.diperbarui += 1;
    } else {
      db.prepare('INSERT INTO users (username, password_hash, nama, nip, role, uid) VALUES (?, ?, ?, ?, ?, ?)')
        .run(a.username, a.password_hash, a.nama || a.username, a.nip || null, role, a.uid || null);
      hasil.baru += 1;
    }
  }
  return hasil;
}

/**
 * Memasang paket di database yang masih baru (dipanggil saat aplikasi pertama kali jalan).
 * Paket guru mengunci pengaturan sekolah di laptop guru; paket sekolah (admin) tidak.
 */
function pasangPaketGuru(pkg) {
  const hasil = { pesan: [], akunBaru: [] };
  db.transaction(() => {
    const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    sinkronAkun(pkg.akun);
    // akun bawaan admin/admin123 dihapus bila paket membawa akun (kecuali paket memang memuat akun bernama admin)
    if ((pkg.akun || []).length && !(pkg.akun || []).some((a) => String(a.username).toLowerCase() === 'admin')) {
      db.prepare("DELETE FROM users WHERE username = 'admin' AND role = 'admin' AND uid IS NULL").run();
    }
    if (pkg.lisensi) set.run('_lisensi', pkg.lisensi);
    if (pkg.jenis !== 'sekolah') set.run('_instalasi_guru', '1');
    if (pkg.sekolah) importSekolah(pkg.sekolah, { aktifkanPeriode: true }, hasil);
    for (const k of pkg.kelas || []) importKelas(k, hasil);
  })();
  return hasil;
}

module.exports = { exportPaket, parsePaket, ringkas, importPaket, exportPaketGuru, exportPaketSekolah, pasangPaketGuru, sinkronAkun };
