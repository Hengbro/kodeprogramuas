PRAGMA foreign_keys = ON;

-- Pengaturan umum & profil sekolah (key/value)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  nama          TEXT NOT NULL,
  nip           TEXT,
  role          TEXT NOT NULL CHECK (role IN ('admin','guru')),
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Periode = tahun pelajaran + semester
CREATE TABLE IF NOT EXISTS periods (
  id               INTEGER PRIMARY KEY,
  tahun_pelajaran  TEXT NOT NULL,
  semester         INTEGER NOT NULL CHECK (semester IN (1,2)),
  tempat_rapor     TEXT,
  tanggal_rapor    TEXT,
  tanggal_rapor_tts TEXT,
  is_active        INTEGER NOT NULL DEFAULT 0,
  is_published     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tahun_pelajaran, semester)
);

CREATE TABLE IF NOT EXISTS classes (
  id        INTEGER PRIMARY KEY,
  nama      TEXT NOT NULL,           -- contoh: "IV A"
  tingkat   INTEGER NOT NULL CHECK (tingkat BETWEEN 1 AND 6),
  fase      TEXT NOT NULL CHECK (fase IN ('A','B','C')),
  guru_id   INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS students (
  id                  INTEGER PRIMARY KEY,
  class_id            INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  nis                 TEXT,
  nisn                TEXT,
  nama                TEXT NOT NULL,
  panggilan           TEXT,
  tempat_lahir        TEXT,
  tanggal_lahir       TEXT,
  jenis_kelamin       TEXT CHECK (jenis_kelamin IN ('L','P')),
  agama               TEXT,
  pendidikan_sebelumnya TEXT,
  alamat              TEXT,
  ayah_nama           TEXT,
  ibu_nama            TEXT,
  ayah_pekerjaan      TEXT,
  ibu_pekerjaan       TEXT,
  ortu_jalan          TEXT,
  ortu_desa           TEXT,
  ortu_kecamatan      TEXT,
  ortu_kabupaten      TEXT,
  ortu_provinsi       TEXT,
  wali_nama           TEXT,
  wali_pekerjaan      TEXT,
  wali_alamat         TEXT,
  status              TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','pindah','lulus','keluar')),
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_students_nisn ON students(nisn);

-- Mata pelajaran. kelompok: agama | umum | seni | mulok
CREATE TABLE IF NOT EXISTS subjects (
  id        INTEGER PRIMARY KEY,
  kode      TEXT NOT NULL UNIQUE,
  nama      TEXT NOT NULL,
  singkat   TEXT NOT NULL,
  kelompok  TEXT NOT NULL CHECK (kelompok IN ('agama','umum','seni','mulok')),
  agama     TEXT,
  urutan    INTEGER NOT NULL DEFAULT 0
);

-- Mapel yang aktif di sebuah kelas + KKTP
CREATE TABLE IF NOT EXISTS class_subjects (
  class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  aktif      INTEGER NOT NULL DEFAULT 1,
  kktp       INTEGER NOT NULL DEFAULT 70,
  PRIMARY KEY (class_id, subject_id)
);

-- Lingkup Materi (untuk sumatif lingkup materi)
CREATE TABLE IF NOT EXISTS lingkup_materi (
  id         INTEGER PRIMARY KEY,
  period_id  INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  urutan     INTEGER NOT NULL,
  nama       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lm ON lingkup_materi(period_id, class_id, subject_id);

-- Tujuan Pembelajaran (untuk formatif & deskripsi capaian)
CREATE TABLE IF NOT EXISTS tujuan_pembelajaran (
  id         INTEGER PRIMARY KEY,
  period_id  INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  urutan     INTEGER NOT NULL,
  deskripsi  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tp ON tujuan_pembelajaran(period_id, class_id, subject_id);

CREATE TABLE IF NOT EXISTS nilai_formatif (
  tp_id      INTEGER NOT NULL REFERENCES tujuan_pembelajaran(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  nilai      REAL NOT NULL,
  PRIMARY KEY (tp_id, student_id)
);

CREATE TABLE IF NOT EXISTS nilai_sumatif (
  lm_id      INTEGER NOT NULL REFERENCES lingkup_materi(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  nilai      REAL NOT NULL,
  PRIMARY KEY (lm_id, student_id)
);

-- Sumatif akhir semester + deskripsi manual (opsional)
CREATE TABLE IF NOT EXISTS nilai_akhir (
  period_id   INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  sas_nontes  REAL,
  sas_tes     REAL,
  desk_tinggi TEXT,
  desk_rendah TEXT,
  PRIMARY KEY (period_id, subject_id, student_id)
);

-- Data rapor per siswa per periode (absensi, catatan, kenaikan)
CREATE TABLE IF NOT EXISTS rapor_siswa (
  period_id  INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id   INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  sakit      INTEGER NOT NULL DEFAULT 0,
  izin       INTEGER NOT NULL DEFAULT 0,
  alpa       INTEGER NOT NULL DEFAULT 0,
  catatan    TEXT,
  naik       INTEGER,               -- 1 naik, 0 tinggal, NULL belum ditentukan
  PRIMARY KEY (period_id, student_id)
);

CREATE TABLE IF NOT EXISTS ekstrakurikuler (
  id         INTEGER PRIMARY KEY,
  period_id  INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  urutan     INTEGER NOT NULL,
  nama       TEXT NOT NULL,
  keterangan TEXT
);
CREATE INDEX IF NOT EXISTS idx_ekskul ON ekstrakurikuler(period_id, student_id);

-- Bank kalimat (saran catatan guru & deskripsi ekskul)
CREATE TABLE IF NOT EXISTS bank_kalimat (
  id     INTEGER PRIMARY KEY,
  jenis  TEXT NOT NULL CHECK (jenis IN ('catatan','ekskul','proses')),
  teks   TEXT NOT NULL
);

-- ===== Projek Penguatan Profil Pelajar Pancasila (P5) =====
CREATE TABLE IF NOT EXISTS p5_dimensi (
  id     INTEGER PRIMARY KEY,
  urutan INTEGER NOT NULL,
  nama   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS p5_elemen (
  id         INTEGER PRIMARY KEY,
  dimensi_id INTEGER NOT NULL REFERENCES p5_dimensi(id) ON DELETE CASCADE,
  nama       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS p5_subelemen (
  id        INTEGER PRIMARY KEY,
  elemen_id INTEGER NOT NULL REFERENCES p5_elemen(id) ON DELETE CASCADE,
  nama      TEXT NOT NULL,
  fase_a    TEXT,
  fase_b    TEXT,
  fase_c    TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id        INTEGER PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  class_id  INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  urutan    INTEGER NOT NULL DEFAULT 1,
  nama      TEXT NOT NULL,
  tema      TEXT,
  deskripsi TEXT
);
CREATE TABLE IF NOT EXISTS project_targets (
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subelemen_id  INTEGER NOT NULL REFERENCES p5_subelemen(id) ON DELETE CASCADE,
  urutan        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, subelemen_id)
);
CREATE TABLE IF NOT EXISTS project_scores (
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subelemen_id INTEGER NOT NULL REFERENCES p5_subelemen(id) ON DELETE CASCADE,
  nilai        INTEGER NOT NULL CHECK (nilai BETWEEN 1 AND 4),
  PRIMARY KEY (project_id, student_id, subelemen_id)
);
CREATE TABLE IF NOT EXISTS project_notes (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  catatan    TEXT,
  PRIMARY KEY (project_id, student_id)
);

-- Penilaian dimensi profil secara umum per projek (sheet PENILAIAN P.x, bagian "secara umum")
CREATE TABLE IF NOT EXISTS project_dim_scores (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  dimensi_id INTEGER NOT NULL REFERENCES p5_dimensi(id) ON DELETE CASCADE,
  nilai      INTEGER NOT NULL CHECK (nilai BETWEEN 1 AND 4),
  PRIMARY KEY (project_id, student_id, dimensi_id)
);
