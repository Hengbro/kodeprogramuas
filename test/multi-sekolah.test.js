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
// kunci penjual khusus tes (tidak memakai kunci asli)
{
  const crypto = require('crypto');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.join(dir, 'kunci'));
  fs.writeFileSync(path.join(dir, 'kunci', 'rahasia.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(path.join(dir, 'kunci', 'publik.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  process.env.LISENSI_PRIVAT = path.join(dir, 'kunci', 'rahasia.pem');
  process.env.LISENSI_PUBLIK = path.join(dir, 'kunci', 'publik.pem');
  fs.writeFileSync(path.join(dir, 'app.zip'), 'ZIPDUMMY');
  process.env.ZIP_WINDOWS = path.join(dir, 'app.zip');
}
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
  const tok = await req('GET', `/sekolah/${sekolah}/login`);
  const m = /name="_csrf" value="([^"]+)"/.exec(tok.text);
  const r = await req('POST', `/sekolah/${sekolah}/login`, { _csrf: m ? m[1] : 'x', username, password });
  return { req, r, s: (url) => `/sekolah/${sekolah}${url}` };
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
  assert.match(r.text, /\/sekolah\/60100001\/login/);
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
  assert.strictEqual(a.r.location, `/sekolah/${A.kode}/app`);
  const b = await masuk(B.kode, B.user, B.pass);
  assert.strictEqual(b.r.location, `/sekolah/${B.kode}/app`);
  // akun sekolah A tidak berlaku di sekolah B
  const salah = await masuk(B.kode, A.user, A.pass);
  assert.strictEqual(salah.r.status, 401);
  const tidakAda = await masuk('tidak-ada', 'admin', 'admin123');
  assert.strictEqual(tidakAda.r.status, 404);

  let tok = await a.req.token(a.s('/app/kelas'));
  await a.req('POST', a.s('/app/kelas'), { _csrf: tok, nama: 'KELAS AMBON', tingkat: '4' });
  tok = await a.req.token(a.s('/app/sekolah'));
  await a.req('POST', a.s('/app/sekolah'), { _csrf: tok, nama_sekolah: 'SD NEGERI 1 AMBON', kepsek_nama: 'Ibu Ambon' });
  let r = await a.req('GET', a.s('/app/kelas'));
  assert.match(r.text, /KELAS AMBON/);
  assert.doesNotMatch(r.text, /KELAS LAMA/);
  // semua tautan di halaman sekolah berawalan kode sekolah
  assert.match(r.text, new RegExp(`href="/sekolah/${A.kode}/app/siswa"`));
  assert.doesNotMatch(r.text, /href="\/app\//);
  assert.match(r.text, /href="\/static\/css\/app.css/);
  // admin A membuka alamat sekolah B → diminta masuk ke sekolah B, bukan melihat data B
  r = await a.req('GET', `/sekolah/${B.kode}/app/kelas`);
  assert.strictEqual(r.location, `/sekolah/${B.kode}/login`);
  // alamat tanpa kode sekolah diarahkan ke alamat sekolahnya
  r = await a.req('GET', '/app/kelas');
  assert.strictEqual(r.location, `/sekolah/${A.kode}/app/kelas`);
  r = await b.req('GET', b.s('/app/kelas'));
  assert.doesNotMatch(r.text, /KELAS AMBON/);
  r = await b.req('GET', b.s('/app/sekolah'));
  assert.match(r.text, /SD INPRES 2 TUAL/);
  // nama sekolah & NPSN diatur superadmin, admin sekolah tidak bisa mengubahnya
  tok = await b.req.token(b.s('/app/sekolah'));
  await b.req('POST', b.s('/app/sekolah'), { _csrf: tok, nama_sekolah: 'DIGANTI ADMIN', npsn: '999' });
  assert.strictEqual(master.dbSekolah(master.cari(B.kode)).prepare("SELECT value FROM settings WHERE key = 'nama_sekolah'").get().value, 'SD INPRES 2 TUAL');
  r = await b.req('GET', b.s('/app/sekolah'));
  assert.doesNotMatch(r.text, /Ibu Ambon/);
  // admin sekolah tidak bisa membuka panel superadmin
  r = await a.req('GET', '/super');
  assert.strictEqual(r.location, '/super/login');
  // sekolah lama tetap utuh dan bisa dimasuki dengan akun lamanya
  const lama = await masuk('11112222', 'admin', 'admin123');
  r = await lama.req('GET', lama.s('/app/kelas'));
  assert.match(r.text, /KELAS LAMA/);
  // keluar → kembali ke halaman masuk sekolah yang sama
  tok = await lama.req.token(lama.s('/app'));
  r = await lama.req('POST', lama.s('/logout'), { _csrf: tok });
  assert.strictEqual(r.location, '/sekolah/11112222/login');
});

test('halaman depan meminta pilih sekolah; portal orang tua & login beralamat kode sekolah', async () => {
  const tamu = klien();
  let r = await tamu('GET', '/');
  // daftar sekolah pelanggan tidak ditampilkan ke umum; orang tua memakai tautan/kode sekolah
  assert.match(r.text, /Kode sekolah/);
  assert.doesNotMatch(r.text, /SD INPRES 2 TUAL/);
  r = await tamu('GET', '/?sekolah=tidak-ada');
  assert.strictEqual(r.location, '/pilih-sekolah?salah=1');
  r = await tamu('GET', '/?sekolah=sd-tual');
  assert.strictEqual(r.location, '/sekolah/sd-tual/');
  r = await tamu('GET', '/sekolah/sd-tual/');
  assert.match(r.text, /Rapor digital SD INPRES 2 TUAL/);
  assert.match(r.text, /action="\/sekolah\/sd-tual\/cek-rapor"/);
  // portal orang tua tidak menonjolkan pindah sekolah / tombol aplikasi
  assert.doesNotMatch(r.text, /Ganti sekolah/);
  assert.doesNotMatch(r.text, /class="btn[^"]*"[^>]*>Masuk Guru/);
  r = await tamu('GET', '/login?sekolah=sd-tual');
  assert.strictEqual(r.location, '/sekolah/sd-tual/login');
  r = await tamu('GET', '/login');
  assert.match(r.text, /kode sekolah/i);
  assert.doesNotMatch(r.text, /name="password"/);
  r = await tamu('GET', '/app');
  assert.strictEqual(r.location, '/');
  r = await tamu('GET', '/sekolah/tidak-ada/');
  assert.strictEqual(r.status, 404);
});

test('superadmin: buka sekolah sebagai admin, nonaktifkan, reset sandi', async () => {
  const su = klien();
  await su('POST', '/super/login', { _csrf: await su.token('/super/login'), username: 'superadmin', password: 'rahasia-super' });
  let tok = await su.token('/super');
  let r = await su('POST', `/super/sekolah/${A.kode}/masuk`, { _csrf: tok });
  assert.strictEqual(r.location, `/sekolah/${A.kode}/app`);
  r = await su('GET', `/sekolah/${A.kode}/app/kelas`);
  assert.match(r.text, /KELAS AMBON/);
  assert.match(r.text, /Mode superadmin/);
  tok = await su.token(`/sekolah/${A.kode}/app`);
  r = await su('POST', `/sekolah/${A.kode}/logout`, { _csrf: tok });
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
  assert.strictEqual((await masuk(B.kode, B.user, baru)).r.location, `/sekolah/${B.kode}/app`);

  r = await su('POST', `/super/sekolah/${B.kode}/hapus`, { _csrf: tok, konfirmasi: 'salah' });
  assert.ok(master.cari(B.kode));
  r = await su('POST', `/super/sekolah/${B.kode}/hapus`, { _csrf: tok, konfirmasi: B.kode });
  assert.ok(!master.cari(B.kode));
  assert.ok(fs.readdirSync(path.join(dir, 'terhapus')).some((f) => f.startsWith('sd-tual-')));
});

test('superadmin membuat kode aktivasi offline dan tautan unduhan untuk sekolah', async () => {
  const su = klien();
  await su('POST', '/super/login', { _csrf: await su.token('/super/login'), username: 'superadmin', password: 'rahasia-super' });
  let r = await su('GET', '/super');
  assert.match(r.text, /Versi offline \(Windows\)/);
  const tok = await su.token('/super');
  r = await su('POST', '/super/offline/kode', { _csrf: tok, sekolah: 'sd negeri 9 saumlaki', npsn: '123' });
  assert.strictEqual(r.location, '/super#offline');
  r = await su('POST', '/super/offline/kode', { _csrf: tok, sekolah: 'sd negeri 9 saumlaki', npsn: '60109999', catatan: 'lunas' });
  assert.strictEqual(r.status, 200);
  const kode = /(ERAPOR-[A-Za-z0-9_.-]+)/.exec(r.text)[1];
  const { periksaKode } = require('../src/lib/lisensi');
  assert.deepStrictEqual([periksaKode(kode).npsn, periksaKode(kode).sekolah], ['60109999', 'SD NEGERI 9 SAUMLAKI']);
  assert.ok(fs.readFileSync(path.join(dir, 'kunci', 'daftar-lisensi.csv'), 'utf8').includes(kode));
  const link = /\/unduh\/offline\/([A-Za-z0-9_-]+)/.exec(r.text)[1];
  // sekolah membuka tautan tanpa login: ada kode & tombol unduh
  const tamu = klien();
  r = await tamu('GET', `/unduh/offline/${link}`);
  assert.strictEqual(r.status, 200);
  assert.ok(r.text.includes(kode));
  r = await tamu('GET', `/unduh/offline/${link}?berkas=zip`);
  assert.strictEqual(r.text, 'ZIPDUMMY');
  assert.strictEqual(master.m().prepare('SELECT unduhan FROM lisensi_offline WHERE token = ?').get(link).unduhan, 1);
  r = await tamu('GET', '/unduh/offline/salah');
  assert.strictEqual(r.status, 404);
  // ZIP lengkap hanya untuk superadmin
  r = await tamu('GET', '/super/unduh/windows');
  assert.strictEqual(r.location, '/super/login');
  r = await su('GET', '/super/unduh/windows');
  assert.strictEqual(r.text, 'ZIPDUMMY');
});

test('orang tua memantau dua anak di sekolah berbeda dari satu perangkat', async () => {
  // anak 1 di sekolah lama, anak 2 di sekolah A (rapor dipublikasikan & portal dibuka)
  const siapkan = (s, nama, nisn) => {
    const d = master.dbSekolah(s);
    d.prepare("INSERT INTO settings (key, value) VALUES ('public_portal', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
    const kelas = d.prepare('SELECT id FROM classes LIMIT 1').get() || { id: d.prepare("INSERT INTO classes (nama, tingkat, fase) VALUES ('X', 1, 'A')").run().lastInsertRowid };
    const id = d.prepare('INSERT INTO students (nama, nisn, tanggal_lahir, class_id) VALUES (?, ?, ?, ?)').run(nama, nisn, '2016-02-03', kelas.id).lastInsertRowid;
    return id;
  };
  const satu = siapkan(master.cari('11112222'), 'Budi Kakak', '9000000001');
  const dua = siapkan(master.cari(A.kode), 'Cici Adik', '9000000002');
  const ortu = klien();
  let r = await ortu('GET', '/sekolah/11112222/');
  let tok = /name="_csrf" value="([^"]+)"/.exec(r.text)[1];
  r = await ortu('POST', '/sekolah/11112222/cek-rapor', { _csrf: tok, nisn: '9000000001', tanggal_lahir: '2016-02-03' });
  assert.strictEqual(r.location, `/sekolah/11112222/rapor-saya/${satu}`);
  r = await ortu('POST', `/sekolah/${A.kode}/cek-rapor`, { _csrf: tok, nisn: '9000000002', tanggal_lahir: '2016-02-03' });
  assert.strictEqual(r.location, `/sekolah/${A.kode}/rapor-saya/${dua}`);
  r = await ortu('GET', '/anak');
  assert.match(r.text, /Budi Kakak/);
  assert.match(r.text, /Cici Adik/);
  assert.match(r.text, new RegExp(`/sekolah/11112222/rapor-saya/${satu}`));
  r = await ortu('GET', `/sekolah/${A.kode}/rapor-saya/${dua}`);
  assert.match(r.text, /Cici Adik/);
  assert.match(r.text, /Semua anak \(2\)/);
  // siswa yang belum diverifikasi orang tua tidak bisa dibuka dengan menebak id / memakai alamat sekolah lain
  r = await ortu('GET', `/sekolah/${A.kode}/rapor-saya/${dua + 100}`);
  assert.strictEqual(r.location, `/sekolah/${A.kode}/`);
  r = await ortu('GET', `/sekolah/11112222/rapor-saya/${dua + 5}`);
  assert.strictEqual(r.location, '/sekolah/11112222/');
  r = await ortu('GET', `/sekolah/${A.kode}/rapor-saya/${dua + 101}`);
  assert.strictEqual(r.location, `/sekolah/${A.kode}/`);
  // keluar → semua anak dilupakan
  r = await ortu('POST', '/keluar-portal', { _csrf: tok });
  r = await ortu('GET', '/anak');
  assert.strictEqual(r.location, '/');
});
