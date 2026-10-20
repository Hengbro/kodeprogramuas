// Saat aplikasi guru pertama kali dijalankan: pasang data/paket-awal.rapor.json yang disiapkan admin sekolah.
const fs = require('fs');
const path = require('path');
const { db, DB_PATH } = require('../db');
const { parsePaket, pasangPaketGuru } = require('./paket');

const NAMA = 'paket-awal.rapor.json';

function pasangJikaAda() {
  const file = path.join(path.dirname(DB_PATH), NAMA);
  if (!fs.existsSync(file)) return null;
  const sudah = db.prepare("SELECT 1 FROM settings WHERE key = '_instalasi_guru'").get() || db.prepare('SELECT 1 FROM classes LIMIT 1').get();
  if (sudah) return null;
  try {
    const hasil = pasangPaketGuru(parsePaket(fs.readFileSync(file, 'utf8')));
    fs.renameSync(file, path.join(path.dirname(DB_PATH), 'paket-awal.terpasang.json'));
    console.log(`  Pengaturan dari admin sekolah terpasang. ${hasil.pesan.join(' ')}`);
    return hasil;
  } catch (e) {
    console.error(`  Gagal memasang ${NAMA}: ${e.message}`);
    return null;
  }
}

module.exports = { pasangJikaAda, NAMA };
