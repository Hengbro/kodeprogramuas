// Membuat ZIP uji seperti ZIP sekolah dari server, untuk uji otomatis di Windows (GitHub Actions).
// Pemakaian: node scripts/buat-zip-uji.js <ZIP dasar> <folder keluaran>
// Hasil: uji-1.zip (akun admin.uji@sekolah / Sandi-Satu-1), uji-2.zip (akun yang sama, username & sandi diganti di "server":
// admin.baru@sekolah / Sandi-Dua-2), publik.pem (kunci publik uji; lisensi uji ditandatangani kunci uji, bukan kunci penjual).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buatZipDenganFolder, verifikasiZip } = require('../src/lib/zip');
const { kodeTerbaru } = require('../src/lib/segarkan-zip');
const { folderPaketSekolah, BERKAS_INTI_ZIP } = require('../src/lib/master');
const { buatKode } = require('../src/lib/lisensi');
const { hashPassword } = require('../src/lib/password');

const [dasar, keluar] = process.argv.slice(2);
if (!dasar || !keluar) { console.error('Pemakaian: node scripts/buat-zip-uji.js <dasar.zip> <folder keluaran>'); process.exit(2); }
fs.mkdirSync(keluar, { recursive: true });
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(path.join(keluar, 'publik.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
const kode = buatKode({ npsn: '10220010', sekolah: 'SD NEGERI UJI WINDOWS', seri: 'UJI00001', berlaku: 'selamanya', dibuat: '2026-10-29' }, privateKey.export({ type: 'pkcs8', format: 'pem' }));
const uid = crypto.randomUUID();
const paket = (username, sandi) => ({
  format: 'e-rapor-sd', versi: 1, dibuat: new Date().toISOString(), sumber: { sekolah: 'SD NEGERI UJI WINDOWS' }, sekolah: null, kelas: [],
  jenis: 'sekolah', lisensi: kode, akun: [{ uid, username, password_hash: hashPassword(sandi), nama: 'Admin Uji', nip: null, role: 'admin' }],
});
const baru = kodeTerbaru();
for (const [nama, username, sandi] of [['uji-1.zip', 'admin.uji@sekolah', 'Sandi-Satu-1'], ['uji-2.zip', 'admin.baru@sekolah', 'Sandi-Dua-2']]) {
  const hasil = path.join(keluar, nama);
  buatZipDenganFolder(dasar, hasil, {
    folder: folderPaketSekolah({ npsn: '10220010' }),
    hapus: baru.hapus,
    entries: [...baru.entries, { name: 'data/kode-aktivasi.txt', data: kode }, { name: 'data/paket-awal.rapor.json', data: JSON.stringify(paket(username, sandi)) }],
  });
  const info = verifikasiZip(hasil, [...BERKAS_INTI_ZIP, 'Pasang-E-Rapor-SD.exe', 'data/kode-aktivasi.txt', 'data/paket-awal.rapor.json']);
  console.log(`${nama}: ${info.jumlah} berkas, folder ${info.folder}, nama terpanjang ${info.terpanjang} karakter`);
}
