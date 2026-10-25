const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// kunci uji sementara (bukan kunci penjual)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lisensi-'));
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubFile = path.join(dir, 'publik.pem');
fs.writeFileSync(pubFile, publicKey.export({ type: 'spki', format: 'pem' }));
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.LISENSI_PUBLIK = pubFile;
const { buatKode, periksaKode } = require('../src/lib/lisensi');
const DATA = { npsn: '10200000', sekolah: 'SD NEGERI 1 NUSANTARA', seri: 'ABCD1234', berlaku: 'selamanya', dibuat: '2026-10-20' };

test('kode asli diterima, kode diubah/palsu ditolak', () => {
  const kode = buatKode(DATA, priv);
  assert.deepStrictEqual(periksaKode(kode), DATA);
  assert.deepStrictEqual(periksaKode(`  ${kode.slice(0, 40)}\n${kode.slice(40)} `), DATA, 'spasi/baris baru diabaikan');
  const [p, s] = kode.slice(7).split('.');
  const palsu = Buffer.from(JSON.stringify({ ...DATA, npsn: '99999999' })).toString('base64url');
  assert.strictEqual(periksaKode(`ERAPOR-${palsu}.${s}`), null);
  // ubah satu karakter di tengah tanda tangan (selalu mengubah byte, tidak bergantung acak)
  const tengah = Math.floor(s.length / 2);
  const sigPalsu = s.slice(0, tengah) + (s[tengah] === 'A' ? 'B' : 'A') + s.slice(tengah + 1);
  assert.strictEqual(periksaKode(`ERAPOR-${p}.${sigPalsu}`), null);
  const lain = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.strictEqual(periksaKode(buatKode(DATA, lain)), null, 'kode dari kunci lain ditolak');
});

test('aplikasi wajib aktivasi: kode → buat akun → nama sekolah terkunci', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-lis-'));
  const port = 3400 + Math.floor(Math.random() * 500);
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: data, PORT: String(port), HOST: '127.0.0.1', LISENSI_WAJIB: '1', LISENSI_PUBLIK: pubFile },
  });
  try {
    const B = `http://127.0.0.1:${port}`;
    const jar = {};
    const req = async (method, url, body) => {
      for (let i = 0; i < 50; i += 1) {
        try {
          const r = await fetch(B + url, { method, redirect: 'manual', headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: body && new URLSearchParams(body) });
          for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i2 = kv.indexOf('='); jar[kv.slice(0, i2)] = kv.slice(i2 + 1); }
          return { status: r.status, location: r.headers.get('location'), text: await r.text() };
        } catch { await new Promise((r) => setTimeout(r, 100)); }
      }
      throw new Error('server tidak menyala');
    };
    const csrf = (t) => /name="_csrf" value="([^"]+)"/.exec(t)[1];
    let r = await req('GET', '/app');
    assert.strictEqual(r.location, '/aktivasi');
    r = await req('GET', '/aktivasi');
    r = await req('POST', '/aktivasi', { _csrf: csrf(r.text), kode: 'ERAPOR-palsu.palsu' });
    assert.strictEqual(r.status, 400);
    r = await req('POST', '/aktivasi', { _csrf: csrf(r.text), kode: buatKode(DATA, priv) });
    r = await req('GET', '/aktivasi');
    assert.match(r.text, /SD NEGERI 1 NUSANTARA/);
    r = await req('POST', '/aktivasi/akun', { _csrf: csrf(r.text), nama: 'Operator Sekolah', username: 'operator', password: 'rahasia123', password2: 'rahasia123' });
    assert.strictEqual(r.location, '/app/sekolah');
    r = await req('GET', '/app/sekolah');
    assert.match(r.text, /Berlisensi/);
    // nama sekolah tidak bisa diganti lewat formulir
    r = await req('POST', '/app/sekolah', { _csrf: csrf(r.text), nama_sekolah: 'SEKOLAH LAIN', npsn: '11111111', kecamatan: 'X' });
    r = await req('GET', '/app/sekolah');
    assert.match(r.text, /value="SD NEGERI 1 NUSANTARA"/);
    assert.match(r.text, /value="10200000"/);
    // akun bawaan admin/admin123 sudah tidak berlaku
    jar.rapor_sess = ''; jar['rapor_sess.sig'] = '';
    r = await req('GET', '/login');
    r = await req('POST', '/login', { _csrf: csrf(r.text), username: 'admin', password: 'admin123' });
    assert.strictEqual(r.status, 401);
    r = await req('GET', '/login');
    r = await req('POST', '/login', { _csrf: csrf(r.text), username: 'operator', password: 'rahasia123' });
    assert.strictEqual(r.location, '/app');
  } finally {
    srv.kill();
  }
});

test('ZIP khusus sekolah: kode di dalam paket dipakai otomatis dan tidak bisa dialihkan ke sekolah lain', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-lis-zip-'));
  fs.writeFileSync(path.join(data, 'kode-aktivasi.txt'), `${buatKode(DATA, priv)}\n`);
  const lain = buatKode({ ...DATA, npsn: '10200099', sekolah: 'SD NEGERI LAIN', seri: 'ZZZZ9999' }, priv);
  const port = 3400 + Math.floor(Math.random() * 500);
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: data, PORT: String(port), HOST: '127.0.0.1', LISENSI_WAJIB: '1', LISENSI_PUBLIK: pubFile },
  });
  try {
    const B = `http://127.0.0.1:${port}`;
    const jar = {};
    const req = async (method, url, body) => {
      for (let i = 0; i < 50; i += 1) {
        try {
          const r = await fetch(B + url, { method, redirect: 'manual', headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: body && new URLSearchParams(body) });
          for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i2 = kv.indexOf('='); jar[kv.slice(0, i2)] = kv.slice(i2 + 1); }
          return { status: r.status, location: r.headers.get('location'), text: await r.text() };
        } catch { await new Promise((r) => setTimeout(r, 100)); }
      }
      throw new Error('server tidak menyala');
    };
    const csrf = (t) => /name="_csrf" value="([^"]+)"/.exec(t)[1];
    let r = await req('GET', '/aktivasi');
    // langsung ke langkah membuat akun: nama sekolah & NPSN dari kode di dalam paket
    assert.match(r.text, /Buat akun admin sekolah/);
    assert.match(r.text, /SD NEGERI 1 NUSANTARA/);
    assert.match(r.text, /10200000/);
    // kode sekolah lain tidak bisa dipakai pada aplikasi ini
    const sesi2 = {}; Object.assign(sesi2, jar);
    for (const k of Object.keys(jar)) delete jar[k];
    r = await req('GET', '/aktivasi');
    r = await req('POST', '/aktivasi', { _csrf: csrf(r.text), kode: lain });
    assert.strictEqual(r.status, 400);
    assert.match(r.text, /khusus untuk SD NEGERI 1 NUSANTARA/);
    // selesaikan aktivasi dengan kode bawaan
    r = await req('GET', '/aktivasi');
    // nama pengguna bebas (tanda @, spasi, titik, dll. diperbolehkan); yang wajib hanya tidak kosong dan sandi valid
    r = await req('POST', '/aktivasi/akun', { _csrf: csrf(r.text), nama: 'Kepala Sekolah', nip: '1980', username: '', password: 'rahasia123', password2: 'rahasia123' });
    assert.strictEqual(r.status, 400);
    assert.match(r.text, /value="Kepala Sekolah"/);
    assert.match(r.text, /value="1980"/);
    r = await req('POST', '/aktivasi/akun', { _csrf: csrf(r.text), nama: 'Kepala Sekolah', username: 'kepsek@siwalawa 1', password: 'rahasia123', password2: 'rahasia123' });
    assert.strictEqual(r.location, '/app/sekolah');
    r = await req('GET', '/app/sekolah');
    assert.match(r.text, /value="SD NEGERI 1 NUSANTARA"/);
  } finally {
    srv.kill();
  }
});

test('aplikasi guru dengan paket berlisensi: langsung ke halaman login (tanpa kode aktivasi) dan akun guru dari admin berfungsi', async () => {
  const { execFileSync } = require('child_process');
  const akar = path.join(__dirname, '..');
  const dataAdmin = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-lis-admin-'));
  const dataGuru = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-lis-guru-'));
  execFileSync(process.execPath, ['src/seed-demo.js'], { cwd: akar, env: { ...process.env, DATA_DIR: dataAdmin } });
  // "server/admin": sekolah berlisensi mengekspor paket untuk guru4a (sama seperti tombol Unduh aplikasi ZIP)
  const kode = buatKode(DATA, priv);
  execFileSync(process.execPath, ['-e', `
    const { db } = require('./src/db');
    db.prepare("INSERT INTO settings (key, value) VALUES ('_lisensi', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(${JSON.stringify(kode)});
    const { exportPaketGuru } = require('./src/lib/paket');
    const id = db.prepare("SELECT id FROM users WHERE username = 'guru4a'").get().id;
    require('fs').writeFileSync(${JSON.stringify(path.join(dataGuru, 'paket-awal.rapor.json'))}, JSON.stringify(exportPaketGuru([id])));
  `], { cwd: akar, env: { ...process.env, DATA_DIR: dataAdmin, LISENSI_PUBLIK: pubFile } });
  // laptop guru: data kosong + paket-awal.rapor.json (persis isi ZIP guru)
  const port = 3400 + Math.floor(Math.random() * 500);
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: akar, env: { ...process.env, DATA_DIR: dataGuru, PORT: String(port), HOST: '127.0.0.1', LISENSI_WAJIB: '1', LISENSI_PUBLIK: pubFile },
  });
  try {
    const B = `http://127.0.0.1:${port}`;
    const jar = {};
    const req = async (method, url, body) => {
      for (let i = 0; i < 50; i += 1) {
        try {
          const r = await fetch(B + url, { method, redirect: 'manual', headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: body && new URLSearchParams(body) });
          for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i2 = kv.indexOf('='); jar[kv.slice(0, i2)] = kv.slice(i2 + 1); }
          return { status: r.status, location: r.headers.get('location'), text: await r.text() };
        } catch { await new Promise((r2) => setTimeout(r2, 100)); }
      }
      throw new Error('server tidak menyala');
    };
    const csrf = (t) => /name="_csrf" value="([^"]+)"/.exec(t)[1];
    let r = await req('GET', '/app');
    assert.notStrictEqual(r.location, '/aktivasi', 'guru tidak boleh diminta kode aktivasi');
    assert.strictEqual(r.location, '/login');
    r = await req('GET', '/login');
    r = await req('POST', '/login', { _csrf: csrf(r.text), username: 'guru4a', password: 'guru123' });
    assert.match(r.location, /^\/app\/?$/);
  } finally {
    srv.kill();
  }
});
