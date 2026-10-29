// Membuat ZIP "sekolah/guru" seperti yang dibuat server (kode terbaru + kode aktivasi tiruan), untuk uji otomatis di Windows.
// Pemakaian: node scripts/buat-zip-uji.js <ZIP dasar> <ZIP hasil>
const { buatZipDenganFolder, verifikasiZip } = require('../src/lib/zip');
const { kodeTerbaru } = require('../src/lib/segarkan-zip');
const { folderPaketSekolah, BERKAS_INTI_ZIP } = require('../src/lib/master');

const [dasar, hasil] = process.argv.slice(2);
if (!dasar || !hasil) { console.error('Pemakaian: node scripts/buat-zip-uji.js <dasar.zip> <hasil.zip>'); process.exit(2); }
const baru = kodeTerbaru();
buatZipDenganFolder(dasar, hasil, {
  folder: `${folderPaketSekolah({ npsn: '10220010' })}-GURU`,
  hapus: baru.hapus,
  entries: [...baru.entries, { name: 'data/kode-aktivasi.txt', data: 'ERAPOR-uji.uji' }],
});
const info = verifikasiZip(hasil, [...BERKAS_INTI_ZIP, 'Pasang-E-Rapor-SD.exe', 'data/kode-aktivasi.txt']);
console.log(`ZIP uji dibuat: ${info.jumlah} berkas, folder ${info.folder}, nama terpanjang ${info.terpanjang} karakter`);
