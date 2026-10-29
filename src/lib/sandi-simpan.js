// Kata sandi yang bisa dilihat superadmin (permintaan pemilik produk: pengguna awam sering lupa sandi).
// Login tetap memakai hash (users.password_hash). Salinan sandi disimpan TERENKRIPSI (AES-256-GCM) di kolom users.sandi_enc;
// kuncinya ada di master.sqlite (terpisah dari database tiap sekolah), jadi database/cadangan satu sekolah saja tidak cukup untuk membacanya.
// Hanya aktif di mode banyak sekolah (server penyedia). Aplikasi offline di laptop sekolah tidak menyimpan salinan.
const crypto = require('crypto');

function kunci() {
  const { MULTI } = require('../db');
  if (!MULTI) return null;
  const master = require('./master');
  return Buffer.from(master.pengaturan('kunci_sandi', () => crypto.randomBytes(32).toString('hex')), 'hex');
}

function enkripsi(teks, k) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const isi = Buffer.concat([c.update(String(teks), 'utf8'), c.final()]);
  return `v1.${iv.toString('hex')}.${c.getAuthTag().toString('hex')}.${isi.toString('hex')}`;
}

function dekripsi(nilai) {
  const k = kunci();
  if (!k || !nilai) return null;
  try {
    const [v, iv, tag, isi] = String(nilai).split('.');
    if (v !== 'v1') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'hex'));
    d.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([d.update(Buffer.from(isi, 'hex')), d.final()]).toString('utf8');
  } catch (e) { return null; }
}

/** Mencatat sandi (teks asli) untuk satu akun, dipanggil setiap kali sandi dibuat/diganti. */
function catat(db, userId, sandi) {
  const k = kunci();
  if (!k || !userId) return;
  db.prepare('UPDATE users SET sandi_enc = ? WHERE id = ?').run(enkripsi(sandi, k), userId);
}

module.exports = { catat, dekripsi, enkripsi };
