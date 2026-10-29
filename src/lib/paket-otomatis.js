// Saat aplikasi dijalankan: pasang data/paket-awal.rapor.json dari ZIP (pertama kali), atau bila aplikasi sudah terpasang,
// samakan akunnya dengan server (ZIP terbaru membawa username & sandi terbaru).
const fs = require('fs');
const path = require('path');
const { db, DB_PATH } = require('../db');
const { parsePaket, pasangPaketGuru, sinkronAkun } = require('./paket');

const NAMA = 'paket-awal.rapor.json';

function pasangJikaAda() {
  const folder = path.dirname(DB_PATH);
  const file = path.join(folder, NAMA);
  if (!fs.existsSync(file)) return null;
  const sudah = db.prepare("SELECT 1 FROM settings WHERE key = '_instalasi_guru'").get() || db.prepare('SELECT 1 FROM classes LIMIT 1').get()
    || db.prepare("SELECT 1 FROM settings WHERE key = '_lisensi'").get();
  try {
    const pkg = parsePaket(fs.readFileSync(file, 'utf8'));
    let hasil;
    if (!sudah) {
      hasil = pasangPaketGuru(pkg);
      console.log(`  Pengaturan dari admin sekolah terpasang. ${hasil.pesan.join(' ')}`);
    } else {
      // Aplikasi sudah terpasang dan berisi data: hanya AKUN yang disamakan dengan server (username & sandi terbaru),
      // data rapor di komputer ini tidak diubah.
      hasil = db.transaction(() => {
        const r = sinkronAkun(pkg.akun);
        if (pkg.lisensi && !db.prepare("SELECT 1 FROM settings WHERE key = '_lisensi'").get()) {
          db.prepare("INSERT INTO settings (key, value) VALUES ('_lisensi', ?)").run(pkg.lisensi);
        }
        return r;
      })();
      console.log(`  Akun disamakan dengan server: ${hasil.diperbarui} diperbarui, ${hasil.baru} baru.`);
    }
    fs.renameSync(file, path.join(folder, 'paket-awal.terpasang.json'));
    return hasil;
  } catch (e) {
    console.error(`  Gagal memasang ${NAMA}: ${e.message}`);
    return null;
  }
}

module.exports = { pasangJikaAda, NAMA };
