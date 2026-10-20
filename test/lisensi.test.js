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
  assert.strictEqual(periksaKode(`ERAPOR-${p}.${s.slice(0, -2)}AA`), null);
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
