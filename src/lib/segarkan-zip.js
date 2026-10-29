// Menyegarkan ZIP aplikasi Windows dengan kode aplikasi TERBARU dari salinan git di server ini, tanpa alat pembangun
// (tidak perlu NSIS/makensis). Yang diganti hanya kode (app/ kecuali node_modules), peluncur .bat, dan BACA-SAYA.txt.
// Tetap dipakai dari ZIP dasar: node.exe, node_modules (modul SQLite Windows), Pasang-E-Rapor-SD.exe, ikon, panduan PDF.
const fs = require('fs');
const path = require('path');
const { listFiles, bacaEntriZip } = require('./zip');

const ROOT = path.join(__dirname, '..', '..');
const crlf = (teks) => Buffer.from(String(teks).replace(/\r?\n/g, '\r\n'), 'utf8');

/** Kode aplikasi + peluncur dari repo ini, dalam bentuk entri ZIP (nama relatif terhadap folder utama). */
function kodeTerbaru() {
  const entries = [];
  const tambah = (nama, file, ubah) => { const isi = fs.readFileSync(file); entries.push({ name: nama, data: ubah ? ubah(isi) : isi }); };
  for (const f of ['server.js', 'package.json', 'package-lock.json']) tambah(`app/${f}`, path.join(ROOT, f));
  for (const d of ['src', 'views', 'public']) for (const [rel, abs] of listFiles(path.join(ROOT, d), `app/${d}`)) tambah(rel, abs);
  for (const [rel, abs] of listFiles(path.join(ROOT, 'db', 'seed'), 'app/db/seed')) tambah(rel, abs);
  for (const f of fs.readdirSync(path.join(ROOT, 'windows'))) if (/^Jalankan-.*\.bat$/.test(f) || f === 'BACA-SAYA.txt') tambah(f, path.join(ROOT, 'windows', f), crlf);
  const nama = new Set(entries.map((e) => e.name));
  const hapus = (rel) => nama.has(rel) || (rel.startsWith('app/') && !rel.startsWith('app/node_modules/') && rel !== 'app/');
  return { entries, hapus };
}

const paketProduksi = (lockJson) => {
  try {
    const out = {};
    for (const [k, v] of Object.entries(JSON.parse(lockJson).packages || {})) if (k && !v.dev) out[k] = v.version;
    return out;
  } catch (e) { return null; }
};

/** Apakah paket pendukung (node_modules) di ZIP dasar berbeda dengan yang dibutuhkan kode terbaru? Bila ya, ZIP dasar perlu dibangun ulang. */
function dependensiBerbeda(zipDasar) {
  try {
    const dalamZip = bacaEntriZip(zipDasar, 'app/package-lock.json');
    if (!dalamZip) return false;
    const a = paketProduksi(dalamZip.toString('utf8'));
    const b = paketProduksi(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    return !!(a && b && JSON.stringify(Object.entries(a).sort()) !== JSON.stringify(Object.entries(b).sort()));
  } catch (e) { return false; }
}

module.exports = { kodeTerbaru, dependensiBerbeda };
