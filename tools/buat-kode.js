// Alat penjual: membuat Kode Aktivasi untuk satu sekolah.
//   node tools/buat-kode.js --npsn 10200000 --sekolah "SD NEGERI 1 NUSANTARA"
// Tanpa argumen: ditanya satu per satu. Setiap kode dicatat di kunci-penjual/daftar-lisensi.csv
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { buatKode, periksaKode } = require('../src/lib/lisensi');

const DIR = process.env.KUNCI_DIR || path.join(__dirname, '..', 'kunci-penjual');
const RAHASIA = path.join(DIR, 'kunci-rahasia.pem');
const DAFTAR = path.join(DIR, 'daftar-lisensi.csv');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

async function tanya(rl, q) {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
}

(async () => {
  if (!fs.existsSync(RAHASIA)) {
    console.error(`Kunci rahasia tidak ditemukan: ${RAHASIA}`);
    process.exit(1);
  }
  let npsn = arg('npsn');
  let sekolah = arg('sekolah');
  const rl = (!npsn || !sekolah) ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  if (!npsn) npsn = await tanya(rl, 'NPSN sekolah               : ');
  if (!sekolah) sekolah = await tanya(rl, 'Nama sekolah (seperti di rapor): ');
  if (rl) rl.close();
  if (!/^\d{8}$/.test(npsn)) { console.error('NPSN harus 8 digit angka.'); process.exit(1); }
  if (!sekolah) { console.error('Nama sekolah wajib diisi.'); process.exit(1); }

  const data = {
    npsn,
    sekolah: sekolah.toUpperCase().replace(/\s+/g, ' ').trim(),
    seri: crypto.randomBytes(4).toString('hex').toUpperCase(),
    berlaku: 'selamanya',
    dibuat: new Date().toISOString().slice(0, 10),
  };
  const kode = buatKode(data, fs.readFileSync(RAHASIA));
  if (!periksaKode(kode)) {
    console.error('Kode gagal diverifikasi: kunci publik di aplikasi tidak cocok dengan kunci rahasia ini.');
    process.exit(1);
  }
  if (!fs.existsSync(DAFTAR)) fs.writeFileSync(DAFTAR, 'tanggal,npsn,sekolah,seri,kode\n');
  fs.appendFileSync(DAFTAR, `${data.dibuat},${npsn},"${data.sekolah.replace(/"/g, '""')}",${data.seri},${kode}\n`);

  console.log('\nKODE AKTIVASI E-RAPOR SD');
  console.log(`Sekolah : ${data.sekolah}`);
  console.log(`NPSN    : ${npsn}`);
  console.log(`No. seri: ${data.seri}  (berlaku seumur hidup)\n`);
  console.log(kode);
  console.log('\nSalin seluruh kode di atas dan kirim ke sekolah. Kode juga dicatat di daftar-lisensi.csv');
})();
