// Membuat sepasang kunci lisensi (sekali saja, oleh penjual).
//   kunci-penjual/kunci-rahasia.pem  → RAHASIA, simpan baik-baik, jangan dibagikan / di-commit
//   src/lib/lisensi-publik.pem       → ikut di dalam aplikasi, dipakai untuk memeriksa kode aktivasi
// Jika kunci diganti, kode aktivasi lama tidak berlaku lagi dan aplikasi harus dibangun ulang.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const RAHASIA = path.join(ROOT, 'kunci-penjual', 'kunci-rahasia.pem');
const PUBLIK = path.join(ROOT, 'src', 'lib', 'lisensi-publik.pem');

if (fs.existsSync(RAHASIA) && !process.argv.includes('--ganti')) {
  console.error(`Kunci sudah ada di ${RAHASIA}. Tambahkan --ganti untuk membuat kunci baru (kode lama tidak berlaku lagi).`);
  process.exit(1);
}
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(path.dirname(RAHASIA), { recursive: true });
fs.writeFileSync(RAHASIA, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(PUBLIK, publicKey.export({ type: 'spki', format: 'pem' }));
console.log(`Kunci rahasia : ${RAHASIA}\nKunci publik  : ${PUBLIK}`);
