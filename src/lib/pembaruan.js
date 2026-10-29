// Pembaruan aplikasi dari GitHub langsung dari panel superadmin (untuk server yang dijalankan dari salinan git,
// mis. di komputer penyedia). Hanya menjalankan perintah git/npm yang tetap, tanpa masukan dari pengguna.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = process.env.PEMBARUAN_DIR || path.join(__dirname, '..', '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Kode keluar yang diartikan peluncur sebagai "jalankan ulang aplikasi". */
const KODE_ULANG = 75;
const bisaMulaiUlang = () => process.env.E_RAPOR_PENGAWAS === '1';

function status({ ambil = true } = {}) {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return { git: false, pesan: 'Aplikasi ini tidak dijalankan dari salinan git, jadi tidak bisa diperbarui otomatis.' };
  try {
    const cabang = git('rev-parse', '--abbrev-ref', 'HEAD');
    if (ambil) git('fetch', 'origin', cabang);
    const lokal = git('log', '-1', '--pretty=%h %s');
    const tertinggal = Number(git('rev-list', '--count', `HEAD..origin/${cabang}`)) || 0;
    const maju = Number(git('rev-list', '--count', `origin/${cabang}..HEAD`)) || 0;
    const baru = tertinggal ? git('log', '--pretty=%s', '-n', '15', `HEAD..origin/${cabang}`).split('\n').filter(Boolean) : [];
    const kotor = git('status', '--porcelain', '--untracked-files=no').split('\n').filter(Boolean);
    return { git: true, cabang, lokal, tertinggal, maju, baru, kotor, bisaMulaiUlang: bisaMulaiUlang() };
  } catch (e) {
    return { git: true, galat: String(e.stderr || e.message).trim().split('\n').slice(0, 3).join(' ') };
  }
}

/** Mengambil versi terbaru (hanya maju, tidak menimpa perubahan lokal) dan memasang paket bila daftar paketnya berubah. */
function perbarui() {
  const cabang = git('rev-parse', '--abbrev-ref', 'HEAD');
  const sebelum = git('rev-parse', 'HEAD');
  const log = [];
  git('fetch', 'origin', cabang);
  try {
    log.push(git('pull', '--ff-only', 'origin', cabang).split('\n').slice(-6).join('\n'));
  } catch (e) {
    const pesan = String(e.stderr || e.message);
    if (/would be overwritten|Please commit your changes|untracked working tree/i.test(pesan)) {
      throw new Error('Ada perubahan di komputer ini yang belum disimpan dan bentrok dengan versi baru. Simpan dulu perubahan itu (git add -A lalu git commit -m "perubahan saya"), lalu coba lagi.');
    }
    // Riwayat berbeda (ada perubahan sendiri yang sudah di-commit di komputer ini): gabungkan. Perubahan sendiri tetap ada.
    // Bila ada berkas yang diubah di kedua sisi pada baris yang sama, penggabungan dibatalkan dan semuanya kembali seperti semula.
    try {
      git('-c', 'user.name=E-Rapor', '-c', 'user.email=e-rapor@localhost', 'merge', '--no-edit', `origin/${cabang}`);
      log.push('Perubahan Anda digabung dengan versi terbaru (merge).');
    } catch (e2) {
      let bentrok = '';
      try { bentrok = git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean).join(', '); } catch (e3) { /* abaikan */ }
      try { git('merge', '--abort'); } catch (e3) { /* tidak ada merge berjalan */ }
      throw new Error(`Perubahan Anda bentrok dengan versi baru${bentrok ? ` pada: ${bentrok}` : ''}. Tidak ada yang diubah (perubahan Anda aman). Kirim pesan ini ke pengembang agar digabungkan.`);
    }
  }
  const sesudah = git('rev-parse', 'HEAD');
  if (sesudah !== sebelum) {
    const berubah = git('diff', '--name-only', sebelum, sesudah).split('\n');
    if (berubah.some((f) => f === 'package.json' || f === 'package-lock.json')) {
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, encoding: 'utf8', timeout: 10 * 60 * 1000, stdio: ['ignore', 'pipe', 'pipe'] });
      log.push('Paket pendukung diperbarui (npm install).');
    }
  }
  return { berubah: sesudah !== sebelum, log: log.join('\n'), versi: git('log', '-1', '--pretty=%h %s') };
}

module.exports = { status, perbarui, bisaMulaiUlang, KODE_ULANG };
