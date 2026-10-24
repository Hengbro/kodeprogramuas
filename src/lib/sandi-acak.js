// Kata sandi acak yang mudah dibaca (tanpa huruf/angka yang mirip: 0/O, 1/l/I).
const crypto = require('crypto');

const HURUF = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function sandiAcak(panjang = 12) {
  for (;;) {
    let s = '';
    for (let i = 0; i < panjang; i += 1) s += HURUF[crypto.randomInt(HURUF.length)];
    // wajib ada huruf besar, huruf kecil, dan angka
    if (/[A-Z]/.test(s) && /[a-z]/.test(s) && /[2-9]/.test(s)) return s;
  }
}

module.exports = { sandiAcak, HURUF };
