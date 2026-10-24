// Mode banyak sekolah: daftar sekolah dan akun superadmin (penyedia aplikasi) di database master terpisah.
// Setiap sekolah memakai file database sendiri di DATA_DIR/sekolah/<kode>.sqlite.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { DATA_DIR, DB_PATH, bukaDb } = require('../db');
const { hashPassword } = require('./password');

const MASTER_PATH = process.env.MASTER_DB_PATH || path.join(DATA_DIR, 'master.sqlite');
const KODE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

let master = null;
const terbuka = new Map(); // kode → Database

function m() {
  if (master) return master;
  fs.mkdirSync(path.dirname(MASTER_PATH), { recursive: true });
  master = new Database(MASTER_PATH);
  master.pragma('journal_mode = WAL');
  master.pragma('busy_timeout = 5000');
  master.exec(`
    CREATE TABLE IF NOT EXISTS pengaturan (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS superadmin (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
      nama TEXT NOT NULL, dibuat TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sekolah (
      id INTEGER PRIMARY KEY, kode TEXT NOT NULL UNIQUE, nama TEXT NOT NULL, npsn TEXT, file TEXT NOT NULL,
      aktif INTEGER NOT NULL DEFAULT 1, catatan TEXT, dibuat TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return master;
}

function slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function sandiAcak() {
  return crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').slice(0, 10);
}

function pengaturan(key, buat) {
  const row = m().prepare('SELECT value FROM pengaturan WHERE key = ?').get(key);
  if (row || !buat) return row ? row.value : null;
  const v = buat();
  m().prepare('INSERT INTO pengaturan (key, value) VALUES (?, ?)').run(key, v);
  return v;
}

const daftar = () => m().prepare('SELECT * FROM sekolah ORDER BY nama COLLATE NOCASE').all();
const cari = (kode) => m().prepare('SELECT * FROM sekolah WHERE kode = ?').get(String(kode || '').trim().toLowerCase());

/** Database milik sekolah (dibuka sekali lalu disimpan). */
function dbSekolah(s) {
  if (!terbuka.has(s.kode)) terbuka.set(s.kode, bukaDb(path.resolve(DATA_DIR, s.file)));
  return terbuka.get(s.kode);
}

/** Membuat sekolah baru beserta database dan akun admin sekolahnya. */
function buatSekolah({ nama, npsn, kode, adminUsername, adminPassword, adminNama }) {
  nama = String(nama || '').trim();
  kode = slug(kode || npsn || nama);
  if (!nama) throw new Error('Nama sekolah wajib diisi.');
  if (!KODE_RE.test(kode)) throw new Error('Kode sekolah hanya boleh huruf kecil, angka, dan tanda minus (2–40 karakter).');
  if (cari(kode)) throw new Error(`Kode sekolah "${kode}" sudah dipakai.`);
  const username = String(adminUsername || 'admin').trim();
  const password = String(adminPassword || '') || sandiAcak();
  if (password.length < 6) throw new Error('Kata sandi admin minimal 6 karakter.');
  const file = path.join('sekolah', `${kode}.sqlite`);
  const abs = path.resolve(DATA_DIR, file);
  if (fs.existsSync(abs)) throw new Error(`Berkas database ${file} sudah ada.`);
  const d = bukaDb(abs);
  d.transaction(() => {
    const set = d.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    set.run('nama_sekolah', nama);
    if (npsn) set.run('npsn', String(npsn).trim());
    // akun bawaan admin/admin123 diganti dengan akun admin sekolah yang dibuat superadmin
    d.prepare('DELETE FROM users').run();
    d.prepare("INSERT INTO users (username, password_hash, nama, role) VALUES (?, ?, ?, 'admin')")
      .run(username, hashPassword(password), String(adminNama || '').trim() || `Admin ${nama}`);
  })();
  terbuka.set(kode, d);
  m().prepare('INSERT INTO sekolah (kode, nama, npsn, file) VALUES (?, ?, ?, ?)').run(kode, nama, npsn ? String(npsn).trim() : null, file);
  return { sekolah: cari(kode), username, password };
}

/**
 * Persiapan pertama mode banyak sekolah:
 * - database lama (satu sekolah) didaftarkan sebagai sekolah pertama agar datanya tidak hilang;
 * - akun superadmin dibuat bila belum ada (sandi dari SUPERADMIN_PASSWORD atau acak, dicatat ke berkas).
 */
function siapkan() {
  if (!daftar().length && fs.existsSync(DB_PATH)) {
    const d = bukaDb(DB_PATH);
    const get = (k) => (d.prepare('SELECT value FROM settings WHERE key = ?').get(k) || {}).value || '';
    const nama = get('nama_sekolah') || 'Sekolah Pertama';
    const npsn = get('npsn');
    let kode = slug(npsn || nama) || 'sekolah-1';
    if (!KODE_RE.test(kode)) kode = 'sekolah-1';
    terbuka.set(kode, d);
    // pakai rahasia sesi lama agar pengguna yang sedang masuk tidak terlempar keluar
    const rahasia = get('_session_secret');
    if (rahasia) m().prepare('INSERT OR IGNORE INTO pengaturan (key, value) VALUES (?, ?)').run('session_secret', rahasia);
    m().prepare('INSERT OR REPLACE INTO pengaturan (key, value) VALUES (?, ?)').run('sekolah_lama', kode);
    m().prepare('INSERT INTO sekolah (kode, nama, npsn, file) VALUES (?, ?, ?, ?)')
      .run(kode, nama, npsn || null, path.relative(DATA_DIR, DB_PATH) || 'rapor.sqlite');
  }
  if (!m().prepare('SELECT 1 FROM superadmin').get()) {
    const username = process.env.SUPERADMIN_USER || 'superadmin';
    const password = process.env.SUPERADMIN_PASSWORD || sandiAcak();
    m().prepare('INSERT INTO superadmin (username, password_hash, nama) VALUES (?, ?, ?)').run(username, hashPassword(password), 'Superadmin');
    if (!process.env.SUPERADMIN_PASSWORD) {
      const file = path.join(DATA_DIR, 'superadmin-awal.txt');
      fs.writeFileSync(file, `Akun superadmin E-Rapor\nusername: ${username}\nkata sandi: ${password}\n\nSegera ganti kata sandi lalu hapus berkas ini.\n`, { mode: 0o600 });
      console.log(`  Akun superadmin dibuat: ${username} (kata sandi di ${file})`);
    }
  }
}

/** Ringkasan isi database sekolah untuk panel superadmin. */
function statistik(s) {
  try {
    const d = dbSekolah(s);
    const n = (sql) => d.prepare(sql).get().n;
    return {
      siswa: n("SELECT COUNT(*) n FROM students WHERE status = 'aktif'"),
      kelas: n('SELECT COUNT(*) n FROM classes'),
      guru: n("SELECT COUNT(*) n FROM users WHERE role = 'guru'"),
      admin: d.prepare("SELECT id, username, nama FROM users WHERE role = 'admin' ORDER BY id").all(),
      ukuran: fs.statSync(path.resolve(DATA_DIR, s.file)).size,
    };
  } catch (e) {
    return { error: e.message, admin: [] };
  }
}

function tutup(kode) {
  const d = terbuka.get(kode);
  if (d) { d.close(); terbuka.delete(kode); }
}

module.exports = { m, daftar, cari, dbSekolah, buatSekolah, siapkan, statistik, pengaturan, sandiAcak, slug, tutup, KODE_RE, MASTER_PATH };
