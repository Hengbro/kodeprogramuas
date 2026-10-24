// Mode banyak sekolah: superadmin mengelola beberapa sekolah, data tiap sekolah terpisah.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-multi-'));
process.env.DATA_DIR = dir;
process.env.MULTI_SEKOLAH = '1';
process.env.SUPERADMIN_PASSWORD = 'rahasia-super';
// database satu sekolah lama sudah berisi data → harus menjadi sekolah pertama
{
  const { bukaDb } = require('../src/db');
  const lama = bukaDb(path.join(dir, 'rapor.sqlite'));
  lama.prepare("UPDATE settings SET value = 'SD LAMA' WHERE key = 'nama_sekolah'").run();
  lama.prepare("INSERT INTO settings (key, value) VALUES ('npsn', '11112222') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  lama.prepare("INSERT INTO classes (nama, tingkat, fase) VALUES ('KELAS LAMA', 1, 'A')").run();
  lama.close();
}
const app = require('../server');
const master = require('../src/lib/master');

let server; let base;
function klien() {
  const jar = {};
  const req = async (method, url, body) => {
    const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
    const res = await fetch(base + url, { method, headers, body: body && new URLSearchParams(body).toString(), redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  };
  req.token = async (url = '/login') => /name="_csrf" value="([^"]+)"/.exec((await req('GET', url)).text)[1];
  return req;
}
async function masuk(sekolah, username, password) {
  const req = klien();
  const r = await req('POST', '/login', { _csrf: await req.token(`/login?sekolah=${sekolah}`), sekolah, username, password });
  return { req, r };
}
const ambil = (html, label) => { const m = new RegExp(`${label}\\s*:\\s*([^\\n<]+)`).exec(html); return m && m[1].trim(); };

test.before(() => new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); }));
test.after(() => server.close());

let A; let B;
test('superadmin membuat dua sekolah; data lama menjadi sekolah pertama', async () => {
  assert.deepStrictEqual(master.daftar().map((s) => [s.kode, s.nama]), [['11112222', 'SD LAMA']]);
  const su = klien();
  let r = await su('POST', '/super/login', { _csrf: await su.token('/super/login'), username: 'superadmin', password: 'salah' });
  assert.strictEqual(r.status, 401);
  r = await su('POST', '/super/login', { _csrf: await su.token('/super/login'), username: 'superadmin', password: 'rahasia-super' });
  assert.strictEqual(r.location, '/super');
  const tok = await su.token('/super');
  r = await su('POST', '/super/sekolah', { _csrf: tok, nama: 'SD NEGERI 1 AMBON', npsn: '60100001', admin_username: 'kepsek', admin_password: 'sandi-ambon' });
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /login\?sekolah=60100001/);
  r = await su('POST', '/super/sekolah', { _csrf: tok, nama: 'SD INPRES 2 TUAL', kode: 'sd-tual' });
  B = { kode: 'sd-tual', user: ambil(r.text, 'Username'), pass: ambil(r.text, 'Sandi') };
  assert.strictEqual(B.user, 'admin');
  assert.ok(B.pass && B.pass.length >= 8);
  A = { kode: '60100001', user: 'kepsek', pass: 'sandi-ambon' };
  r = await su('POST', '/super/sekolah', { _csrf: tok, nama: 'Dobel', kode: 'sd-tual' });
  assert.strictEqual(r.location, '/super');
  r = await su('GET', '/super');
  assert.match(r.text, /SD NEGERI 1 AMBON/);
  assert.match(r.text, /SD INPRES 2 TUAL/);
  assert.match(r.text, /Kode sekolah \(untuk masuk\)|Kode <code>/);
});

test('admin sekolah hanya melihat dan mengubah data sekolahnya sendiri', async () => {
  const a = await masuk(A.kode, A.user, A.pass);
  assert.strictEqual(a.r.location, '/app');
  const b = await masuk(B.kode, B.user, B.pass);
  assert.strictEqual(b.r.location, '/app');
  // akun sekolah A tidak berlaku di sekolah B
  const salah = await masuk(B.kode, A.user, A.pass);
  assert.strictEqual(salah.r.status, 401);
  const tidakAda = await masuk('tidak-ada', 'admin', 'admin123');
  assert.strictEqual(tidakAda.r.status, 404);

  let tok = await a.req.token('/app/kelas');
  await a.req('POST', '/app/kelas', { _csrf: tok, nama: 'KELAS AMBON', tingkat: '4' });
  tok = await a.req.token('/app/sekolah');
  await a.req('POST', '/app/sekolah', { _csrf: tok, nama_sekolah: 'SD NEGERI 1 AMBON', kepsek_nama: 'Ibu Ambon' });
  let r = await a.req('GET', '/app/kelas');
  assert.match(r.text, /KELAS AMBON/);
  assert.doesNotMatch(r.text, /KELAS LAMA/);
  r = await b.req('GET', '/app/kelas');
  assert.doesNotMatch(r.text, /KELAS AMBON/);
  r = await b.req('GET', '/app/sekolah');
  assert.match(r.text, /SD INPRES 2 TUAL/);
  // nama sekolah & NPSN diatur superadmin, admin sekolah tidak bisa mengubahnya
  tok = await b.req.token('/app/sekolah');
  await b.req('POST', '/app/sekolah', { _csrf: tok, nama_sekolah: 'DIGANTI ADMIN', npsn: '999' });
  assert.strictEqual(master.dbSekolah(master.cari(B.kode)).prepare("SELECT value FROM settings WHERE key = 'nama_sekolah'").get().value, 'SD INPRES 2 TUAL');
  r = await b.req('GET', '/app/sekolah');
  assert.doesNotMatch(r.text, /Ibu Ambon/);
  // admin sekolah tidak bisa membuka panel superadmin
  r = await a.req('GET', '/super');
  assert.strictEqual(r.location, '/super/login');
  // sekolah lama tetap utuh dan bisa dimasuki dengan akun lamanya
  const lama = await masuk('11112222', 'admin', 'admin123');
  r = await lama.req('GET', '/app/kelas');
  assert.match(r.text, /KELAS LAMA/);
});

test('halaman depan meminta pilih sekolah; portal & logo mengikuti sekolah', async () => {
  const tamu = klien();
  let r = await tamu('GET', '/');
  assert.match(r.text, /Pilih sekolah/);
  assert.match(r.text, /SD INPRES 2 TUAL/);
  r = await tamu('GET', '/?sekolah=sd-tual');
  assert.match(r.text, /Rapor digital SD INPRES 2 TUAL/);
  assert.match(r.text, /name="sekolah" value="sd-tual"/);
  r = await tamu('GET', '/login?sekolah=sd-tual');
  assert.match(r.text, /value="sd-tual"/);
});

test('superadmin: buka sekolah sebagai admin, nonaktifkan, reset sandi', async () => {
  const su = klien();
  await su('POST', '/super/login', { _csrf: await su.token('/super/login'), username: 'superadmin', password: 'rahasia-super' });
  let tok = await su.token('/super');
  let r = await su('POST', `/super/sekolah/${A.kode}/masuk`, { _csrf: tok });
  assert.strictEqual(r.location, '/app');
  r = await su('GET', '/app/kelas');
  assert.match(r.text, /KELAS AMBON/);
  assert.match(r.text, /Mode superadmin/);
  tok = await su.token('/app');
  r = await su('POST', '/logout', { _csrf: tok });
  assert.strictEqual(r.location, '/super');
  r = await su('GET', '/super');
  assert.strictEqual(r.status, 200);

  tok = await su.token('/super');
  await su('POST', `/super/sekolah/${B.kode}/aktif`, { _csrf: tok });
  const ditolak = await masuk(B.kode, B.user, B.pass);
  assert.strictEqual(ditolak.r.status, 404);
  await su('POST', `/super/sekolah/${B.kode}/aktif`, { _csrf: tok });

  const d = master.dbSekolah(master.cari(B.kode));
  const id = d.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
  r = await su('POST', `/super/sekolah/${B.kode}/reset`, { _csrf: tok, user_id: String(id) });
  const baru = ambil(r.text, 'Sandi');
  assert.strictEqual((await masuk(B.kode, B.user, B.pass)).r.status, 401);
  assert.strictEqual((await masuk(B.kode, B.user, baru)).r.location, '/app');

  r = await su('POST', `/super/sekolah/${B.kode}/hapus`, { _csrf: tok, konfirmasi: 'salah' });
  assert.ok(master.cari(B.kode));
  r = await su('POST', `/super/sekolah/${B.kode}/hapus`, { _csrf: tok, konfirmasi: B.kode });
  assert.ok(!master.cari(B.kode));
  assert.ok(fs.readdirSync(path.join(dir, 'terhapus')).some((f) => f.startsWith('sd-tual-')));
});
