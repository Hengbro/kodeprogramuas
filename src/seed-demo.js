// Mengisi database dengan data contoh (fiktif) agar sistem bisa langsung dicoba.
// Jalankan: npm run seed:demo
const { db } = require('./db');
const { hashPassword } = require('./lib/password');
const { ensureClassSubjects, getActivePeriod } = require('./lib/rapor');
const TP = require('../db/seed/tp_kelas4.json');

if (db.prepare('SELECT 1 FROM students LIMIT 1').get() && !process.argv.includes('--force')) {
  console.log('Database sudah berisi siswa. Tambahkan --force untuk tetap menambah data demo.');
  process.exit(0);
}

// pseudo-random deterministik
let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const between = (a, b) => Math.round(a + rnd() * (b - a));

const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

db.transaction(() => {
  const profil = {
    pemda: 'PEMERINTAH KABUPATEN CONTOH', instansi: 'DINAS PENDIDIKAN', nama_sekolah: 'SD NEGERI 1 NUSANTARA',
    npsn: '10200000', nss: '101000000000', alamat: 'Jl. Pendidikan No. 1', desa: 'Sukamaju', kecamatan: 'Sukamaju',
    kabupaten: 'Kabupaten Contoh', provinsi: 'Provinsi Contoh', kode_pos: '12345', telp: '(021) 000000',
    email: 'sdn1nusantara@example.sch.id', website: 'sdn1nusantara.sch.id', kepsek_nama: 'Dra. Siti Rahmawati, M.Pd.', kepsek_nip: '196805121990032004',
  };
  for (const [k, v] of Object.entries(profil)) set.run(k, v);

  const period = getActivePeriod();
  db.prepare('UPDATE periods SET tempat_rapor = ?, tanggal_rapor = ?, tanggal_rapor_tts = ?, is_published = 1 WHERE id = ?')
    .run('Sukamaju', `${period.tahun_pelajaran.slice(period.semester === 1 ? 0 : 5, period.semester === 1 ? 4 : 9)}-${period.semester === 1 ? '12-19' : '06-20'}`,
      `${period.tahun_pelajaran.slice(period.semester === 1 ? 0 : 5, period.semester === 1 ? 4 : 9)}-${period.semester === 1 ? '10-10' : '03-20'}`, period.id);

  let guru = db.prepare("SELECT id FROM users WHERE username = 'guru4a'").get();
  if (!guru) {
    guru = { id: db.prepare("INSERT INTO users (username, password_hash, nama, nip, role) VALUES ('guru4a', ?, 'Budi Santoso, S.Pd.', '198703152010011002', 'guru')")
      .run(hashPassword('guru123')).lastInsertRowid };
  }
  const classId = db.prepare("INSERT INTO classes (nama, tingkat, fase, guru_id) VALUES ('IV A', 4, 'B', ?)").run(guru.id).lastInsertRowid;
  ensureClassSubjects({ id: classId, tingkat: 4 });

  const nama = [
    ['Adinda Putri Lestari', 'Dinda', 'P', 'Islam'], ['Bagas Pratama', 'Bagas', 'L', 'Islam'],
    ['Clara Natalia Simanjuntak', 'Clara', 'P', 'Kristen'], ['Dimas Aditya Nugraha', 'Dimas', 'L', 'Islam'],
    ['Elisabeth Maria Gea', 'Elis', 'P', 'Katolik'], ['Fajar Ramadhan', 'Fajar', 'L', 'Islam'],
    ['Gede Wira Pranata', 'Wira', 'L', 'Hindu'], ['Hana Salsabila', 'Hana', 'P', 'Islam'],
    ['Imanuel Zebua', 'Nuel', 'L', 'Kristen'], ['Jessica Halawa', 'Jessi', 'P', 'Katolik'],
  ];
  const insSt = db.prepare(`INSERT INTO students (class_id, nis, nisn, nama, panggilan, tempat_lahir, tanggal_lahir, jenis_kelamin, agama,
    pendidikan_sebelumnya, alamat, ayah_nama, ibu_nama, ayah_pekerjaan, ibu_pekerjaan, ortu_jalan, ortu_desa, ortu_kecamatan, ortu_kabupaten, ortu_provinsi)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'TK', ?, ?, ?, ?, ?, ?, 'Sukamaju', 'Sukamaju', 'Kabupaten Contoh', 'Provinsi Contoh')`);
  const ayah = ['Ahmad', 'Slamet', 'Robert', 'Hendra', 'Yohanes', 'Rahmat', 'Ketut', 'Sutrisno', 'Daniel', 'Markus'];
  const ibu = ['Aisyah', 'Sri Wahyuni', 'Maria', 'Dewi', 'Theresia', 'Nur Aini', 'Made Sari', 'Lestari', 'Ruth', 'Agnes'];
  const kerja = ['Petani', 'Wiraswasta', 'PNS', 'Pedagang', 'Nelayan'];
  const studentIds = nama.map(([n, p, jk, ag], i) => insSt.run(classId, String(1001 + i), `01${String(30000000 + i * 7919).padStart(8, '0')}`,
    n, p, 'Sukamaju', `2015-${String(1 + (i % 12)).padStart(2, '0')}-${String(3 + i * 2).padStart(2, '0')}`, jk, ag,
    `Jl. Melati No. ${i + 3}`, ayah[i], ibu[i], kerja[i % kerja.length], i % 3 ? 'Ibu Rumah Tangga' : 'Pedagang', `Jl. Melati No. ${i + 3}`).lastInsertRowid);

  // TP & nilai
  const subjects = db.prepare(`SELECT s.* FROM subjects s JOIN class_subjects cs ON cs.subject_id = s.id AND cs.class_id = ? WHERE cs.aktif = 1`).all(classId);
  const keyMap = { 'AG-BUDDHA': 'Agama Budha', 'AG-KHONGHUCU': 'Agama Konghucu', PPKN: 'Pendidikan Pancasila dan Kewarganegaraan', PJOK: 'Pendidikan Jasmani, Olahraga dan Kesehatan' };
  const students = db.prepare('SELECT * FROM students WHERE class_id = ?').all(classId);
  for (const s of subjects) {
    const key = keyMap[s.kode] || (s.agama ? `Agama ${s.agama}` : s.nama);
    const src = TP[key];
    if (!src) continue;
    const tpIds = src.tp.slice(0, 8).map((t, i) => db.prepare('INSERT INTO tujuan_pembelajaran (period_id, class_id, subject_id, urutan, deskripsi) VALUES (?, ?, ?, ?, ?)')
      .run(period.id, classId, s.id, i + 1, t).lastInsertRowid);
    const lmIds = src.lm.slice(0, 4).map((l, i) => db.prepare('INSERT INTO lingkup_materi (period_id, class_id, subject_id, urutan, nama) VALUES (?, ?, ?, ?, ?)')
      .run(period.id, classId, s.id, i + 1, l).lastInsertRowid);
    for (const st of students) {
      if (s.kelompok === 'agama' && st.agama !== s.agama) continue;
      const base = between(62, 90);
      for (const id of tpIds) db.prepare('INSERT INTO nilai_formatif (tp_id, student_id, nilai) VALUES (?, ?, ?)').run(id, st.id, Math.min(100, base + between(-10, 10)));
      for (const id of lmIds) db.prepare('INSERT INTO nilai_sumatif (lm_id, student_id, nilai) VALUES (?, ?, ?)').run(id, st.id, Math.min(100, base + between(-8, 8)));
      db.prepare('INSERT INTO nilai_akhir (period_id, subject_id, student_id, sas_nontes, sas_tes) VALUES (?, ?, ?, ?, ?)')
        .run(period.id, s.id, st.id, Math.min(100, base + between(-6, 8)), Math.min(100, base + between(-8, 6)));
    }
  }

  const catatan = db.prepare("SELECT teks FROM bank_kalimat WHERE jenis = 'catatan'").all().map((r) => r.teks);
  const ekskulKet = db.prepare("SELECT teks FROM bank_kalimat WHERE jenis = 'ekskul'").all().map((r) => r.teks);
  studentIds.forEach((id, i) => {
    db.prepare('INSERT INTO rapor_siswa (period_id, student_id, class_id, sakit, izin, alpa, catatan, naik) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
      .run(period.id, id, classId, between(0, 3), between(0, 2), between(0, 1), catatan[i % catatan.length]);
    db.prepare("INSERT INTO ekstrakurikuler (period_id, student_id, urutan, nama, keterangan) VALUES (?, ?, 1, 'Pramuka', ?)").run(period.id, id, ekskulKet[i % ekskulKet.length]);
    if (i % 3 === 0) db.prepare("INSERT INTO ekstrakurikuler (period_id, student_id, urutan, nama, keterangan) VALUES (?, ?, 2, 'Seni Tari', 'Aktif dan bersemangat dalam setiap latihan.')").run(period.id, id);
  });

  // Projek P5
  const sub = (nama) => db.prepare('SELECT id FROM p5_subelemen WHERE nama LIKE ?').get(`${nama}%`).id;
  const projek = [
    { nama: 'Aku Cinta Budaya Daerahku', tema: 'Kearifan Lokal', deskripsi: 'Peserta didik mengenal, mendokumentasikan, dan menampilkan kembali kearifan lokal di lingkungan sekitarnya melalui pameran karya.',
      targets: ['Mendalami budaya dan identitas budaya', 'Kerja sama', 'Menghasilkan karya dan tindakan yang orisinal'] },
    { nama: 'Sampahku Tanggung Jawabku', tema: 'Gaya Hidup Berkelanjutan', deskripsi: 'Peserta didik mengidentifikasi masalah sampah di sekolah lalu merancang aksi pemilahan dan daur ulang sederhana.',
      targets: ['Menjaga Lingkungan Alam Sekitar', 'Mengidentifikasi, mengklarifikasi, dan mengolah informasi dan gagasan', 'Menghasilkan gagasan yang orisinal'] },
  ];
  const proses = db.prepare("SELECT teks FROM bank_kalimat WHERE jenis = 'proses'").all().map((r) => r.teks);
  projek.forEach((p, idx) => {
    const pid = db.prepare('INSERT INTO projects (period_id, class_id, urutan, nama, tema, deskripsi) VALUES (?, ?, ?, ?, ?, ?)')
      .run(period.id, classId, idx + 1, p.nama, p.tema, p.deskripsi).lastInsertRowid;
    const sids = p.targets.map(sub);
    sids.forEach((sid, i) => db.prepare('INSERT INTO project_targets (project_id, subelemen_id, urutan) VALUES (?, ?, ?)').run(pid, sid, i));
    studentIds.forEach((stId, i) => {
      for (const sid of sids) db.prepare('INSERT INTO project_scores (project_id, student_id, subelemen_id, nilai) VALUES (?, ?, ?, ?)').run(pid, stId, sid, between(2, 4));
      db.prepare('INSERT INTO project_notes (project_id, student_id, catatan) VALUES (?, ?, ?)').run(pid, stId, proses[(i + idx) % proses.length]);
    });
  });
})();

console.log('Data demo dibuat. Login guru: guru4a / guru123 · admin: admin / (ADMIN_PASSWORD atau admin123)');
