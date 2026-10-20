// Lisensi per sekolah dengan tanda tangan digital Ed25519.
// Kode aktivasi = "ERAPOR-" + base64url(JSON data) + "." + base64url(tanda tangan).
// Aplikasi hanya menyimpan kunci publik, jadi kode tidak bisa dipalsukan tanpa kunci rahasia penjual.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PREFIX = 'ERAPOR-';
const PUBLIK = process.env.LISENSI_PUBLIK || path.join(__dirname, 'lisensi-publik.pem');
let publicKey = null;
function kunciPublik() {
  if (!publicKey && fs.existsSync(PUBLIK)) publicKey = crypto.createPublicKey(fs.readFileSync(PUBLIK));
  return publicKey;
}

function wajib() {
  return process.env.LISENSI_WAJIB === '1';
}

function normalisasi(kode) {
  return String(kode || '').replace(/\s+/g, '').trim();
}

/** Membuat kode (dipakai alat penjual). */
function buatKode(data, privateKeyPem) {
  const payload = Buffer.from(JSON.stringify(data), 'utf8');
  const sig = crypto.sign(null, payload, crypto.createPrivateKey(privateKeyPem));
  return `${PREFIX}${payload.toString('base64url')}.${sig.toString('base64url')}`;
}

/** @returns {{ npsn: string, sekolah: string, seri: string, berlaku: string, dibuat: string } | null} */
function periksaKode(kode) {
  const k = normalisasi(kode);
  if (!k.startsWith(PREFIX) || !kunciPublik()) return null;
  const [p, s] = k.slice(PREFIX.length).split('.');
  if (!p || !s) return null;
  try {
    const payload = Buffer.from(p, 'base64url');
    if (!crypto.verify(null, payload, kunciPublik(), Buffer.from(s, 'base64url'))) return null;
    const data = JSON.parse(payload.toString('utf8'));
    if (!data.npsn || !data.sekolah) return null;
    if (data.berlaku && data.berlaku !== 'selamanya' && new Date(data.berlaku) < new Date()) return null;
    return data;
  } catch {
    return null;
  }
}

let cache = { kode: null, data: null };
/** Lisensi yang tersimpan di database (null jika belum aktivasi). */
function lisensiAktif(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = '_lisensi'").get();
  const kode = row ? row.value : null;
  if (kode !== cache.kode) cache = { kode, data: kode ? periksaKode(kode) : null };
  return cache.data;
}

module.exports = { wajib, buatKode, periksaKode, lisensiAktif, normalisasi };
