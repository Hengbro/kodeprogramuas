const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { hashPassword } = require('./lib/password');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'rapor.sqlite');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const DEFAULT_SETTINGS = {
  kementerian: 'KEMENTERIAN PENDIDIKAN DASAR DAN MENENGAH',
  instansi: 'DINAS PENDIDIKAN',
  pemda: 'PEMERINTAH KABUPATEN',
  nama_sekolah: 'SD NEGERI CONTOH',
  nss: '',
  npsn: '',
  alamat: '',
  desa: '',
  kecamatan: '',
  kabupaten: '',
  provinsi: '',
  kode_pos: '',
  telp: '',
  faks: '',
  website: '',
  email: '',
  kepsek_nama: '',
  kepsek_nip: '',
  bobot_f: '1',
  bobot_s: '2',
  bobot_as: '2',
  predikat: JSON.stringify([
    { min: 88, label: 'Sangat Baik', kalimat: 'menunjukkan penguasaan yang sangat baik dalam' },
    { min: 74, label: 'Baik', kalimat: 'menunjukkan penguasaan yang baik dalam' },
    { min: 60, label: 'Cukup', kalimat: 'menunjukkan penguasaan yang cukup dalam' },
    { min: 0, label: 'Perlu Bimbingan', kalimat: 'perlu bimbingan dalam' },
  ]),
  desk_mode: 'predikat',
  desk_nama: '1',
  kalimat_tinggi: 'menunjukkan penguasaan dalam',
  kalimat_rendah: 'perlu bimbingan dalam',
  catatan_ranking: 'none',
  ttd_ortu: 'Orang Tua/Wali',
  public_portal: '1',
};

const SUBJECTS = [
  ['AG-ISLAM', 'Pendidikan Agama Islam dan Budi Pekerti', 'PAI', 'agama', 'Islam', 1],
  ['AG-KRISTEN', 'Pendidikan Agama Kristen dan Budi Pekerti', 'PAK', 'agama', 'Kristen', 1],
  ['AG-KATOLIK', 'Pendidikan Agama Katolik dan Budi Pekerti', 'PAKat', 'agama', 'Katolik', 1],
  ['AG-HINDU', 'Pendidikan Agama Hindu dan Budi Pekerti', 'PAH', 'agama', 'Hindu', 1],
  ['AG-BUDDHA', 'Pendidikan Agama Buddha dan Budi Pekerti', 'PAB', 'agama', 'Buddha', 1],
  ['AG-KHONGHUCU', 'Pendidikan Agama Khonghucu dan Budi Pekerti', 'PAKh', 'agama', 'Khonghucu', 1],
  ['PPKN', 'Pendidikan Pancasila', 'PP', 'umum', null, 2],
  ['BIND', 'Bahasa Indonesia', 'B.Ind', 'umum', null, 3],
  ['MTK', 'Matematika', 'MTK', 'umum', null, 4],
  ['IPAS', 'Ilmu Pengetahuan Alam dan Sosial', 'IPAS', 'umum', null, 5],
  ['SENI-MUSIK', 'Seni Musik', 'S.Musik', 'seni', null, 6],
  ['SENI-TARI', 'Seni Tari', 'S.Tari', 'seni', null, 6],
  ['SENI-RUPA', 'Seni Rupa', 'S.Rupa', 'seni', null, 6],
  ['SENI-TEATER', 'Seni Teater', 'S.Teater', 'seni', null, 6],
  ['PJOK', 'Pendidikan Jasmani, Olahraga, dan Kesehatan', 'PJOK', 'umum', null, 7],
  ['BING', 'Bahasa Inggris', 'B.Ing', 'umum', null, 8],
];

const BANK_KALIMAT = {
  catatan: [
    'Teruslah belajar agar dapat memiliki prestasi yang baik.',
    'Belajar merupakan kunci keberhasilan, oleh sebab itu tingkatkan motivasi belajarmu.',
    'Teruslah belajar agar kamu dapat meraih cita-cita sesuai dengan harapan.',
    'Pertahankan prestasi belajarmu dan pantang menyerah dalam menggapai cita-cita.',
    'Rajinlah membaca agar pengetahuanmu semakin meningkat dan prestasimu semakin baik.',
    'Jangan terlalu banyak bermain, teruslah belajar agar menjadi pribadi yang lebih baik.',
    'Semangat belajarmu sudah baik, terus tingkatkan untuk menuju cita-cita yang diharapkan.',
    'Prestasi yang baik adalah kunci sukses untuk meraih cita-cita. Tingkatkan terus motivasi belajarmu.',
  ],
  ekskul: [
    'Sangat disiplin selama mengikuti kegiatan.',
    'Aktif dan bersemangat dalam setiap kegiatan.',
    'Memiliki sikap yang baik selama mengikuti kegiatan.',
    'Perlu meningkatkan rasa percaya diri dalam mengikuti kegiatan.',
    'Usahakan lebih lengkap dalam memakai atribut dan perlengkapan selama kegiatan.',
  ],
  proses: [
    'aktif melibatkan diri dengan memberikan usulan dan gagasan selama projek berlangsung.',
    'mampu bekerja sama dengan baik bersama teman kelompoknya.',
    'mulai berani menyampaikan pendapat di depan teman-temannya.',
    'perlu didampingi agar lebih fokus dalam menyelesaikan tugas projek.',
  ],
};

function seedBase() {
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

  const insSubject = db.prepare(
    'INSERT OR IGNORE INTO subjects (kode, nama, singkat, kelompok, agama, urutan) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const s of SUBJECTS) insSubject.run(...s);

  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare("INSERT INTO users (username, password_hash, nama, role) VALUES ('admin', ?, 'Administrator', 'admin')")
      .run(hashPassword(password));
  }

  if (!db.prepare('SELECT 1 FROM bank_kalimat LIMIT 1').get()) {
    const ins = db.prepare('INSERT INTO bank_kalimat (jenis, teks) VALUES (?, ?)');
    for (const [jenis, list] of Object.entries(BANK_KALIMAT)) for (const t of list) ins.run(jenis, t);
  }

  if (!db.prepare('SELECT 1 FROM p5_dimensi LIMIT 1').get()) {
    const dims = require('../db/seed/p5_dimensi.json');
    const insD = db.prepare('INSERT INTO p5_dimensi (urutan, nama) VALUES (?, ?)');
    const insE = db.prepare('INSERT INTO p5_elemen (dimensi_id, nama) VALUES (?, ?)');
    const insS = db.prepare('INSERT INTO p5_subelemen (elemen_id, nama, fase_a, fase_b, fase_c) VALUES (?, ?, ?, ?, ?)');
    dims.forEach((d, i) => {
      const did = insD.run(i + 1, d.nama).lastInsertRowid;
      for (const e of d.elemen) {
        const eid = insE.run(did, e.nama).lastInsertRowid;
        for (const s of e.subelemen) insS.run(eid, s.nama, s.fase_a, s.fase_b, s.fase_c);
      }
    });
  }

  if (!db.prepare('SELECT 1 FROM periods LIMIT 1').get()) {
    const now = new Date();
    const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const sem = now.getMonth() >= 6 ? 1 : 2;
    db.prepare('INSERT INTO periods (tahun_pelajaran, semester, is_active) VALUES (?, ?, 1)').run(`${y}/${y + 1}`, sem);
  }
}

db.transaction(seedBase)();

module.exports = { db, DB_PATH };
