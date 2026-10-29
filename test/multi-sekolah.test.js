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
  // ZIP dasar aplikasi Windows tiruan (kecil, tetapi berbentuk paket yang sah)
  require('../src/lib/zip').writeZip(path.join(dir, 'app.zip'), [{ name: 'E-Rapor-SD-Windows/Jalankan-Rapor.bat', data: '@echo off' }, { name: 'E-Rapor-SD-Windows/Pasang-E-Rapor-SD.exe', data: 'MZ' }, { name: 'E-Rapor-SD-Windows/node/node.exe', data: 'MZ' }, { name: 'E-Rapor-SD-Windows/data/', data: '' }]);
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
  req.cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
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
  r = await su('POST', '/super/sekolah', { _csrf: tok, online: '1', nama: 'SD NEGERI 1 AMBON', npsn: '60100001', admin_username: 'kepsek', admin_password: 'sandi-ambon' });
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /\/sekolah\/60100001\/login/);
  r = await su('POST', '/super/sekolah', { _csrf: tok, online: '1', nama: 'SD INPRES 2 TUAL', kode: 'sd-tual' });
  B = { kode: 'sd-tual', user: ambil(r.text, 'Username'), pass: ambil(r.text, 'Kata sandi') };
  assert.strictEqual(B.user, 'admin');
  assert.ok(B.pass && B.pass.length >= 8);
  A = { kode: '60100001', user: 'kepsek', pass: 'sandi-ambon' };
  r = await su('POST', '/super/sekolah', { _csrf: tok, online: '1', nama: 'Dobel', kode: 'sd-tual' });
  assert.strictEqual(r.location, '/super#tambah');
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
  const baru = ambil(r.text, 'Kata sandi');
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
  assert.match(r.text, /Sekolah versi offline \(Windows\)/);
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
  // ZIP yang diunduh sekolah KHUSUS sekolah itu: folder bernama sekolah+NPSN dan kode aktivasi sudah di dalamnya
  const { execFileSync } = require('child_process');
  const unduh = await fetch(`${base}/unduh/offline/${link}?berkas=zip`);
  assert.strictEqual(unduh.status, 200);
  assert.match(unduh.headers.get('content-disposition'), /E-Rapor-SD-NEGERI-9-SAUMLAKI-60109999\.zip/);
  const berkas = path.join(dir, 'sekolah-9.zip');
  fs.writeFileSync(berkas, Buffer.from(await unduh.arrayBuffer()));
  execFileSync('unzip', ['-tq', berkas]);
  const daftar = execFileSync('unzip', ['-Z1', berkas]).toString().trim().split('\n');
  assert.ok(daftar.every((n) => n.startsWith('E-Rapor-60109999/')), daftar.join(','));
  assert.ok(daftar.includes('E-Rapor-60109999/Jalankan-Rapor.bat'));
  assert.strictEqual(execFileSync('unzip', ['-p', berkas, 'E-Rapor-60109999/data/kode-aktivasi.txt']).toString(), kode);
  assert.strictEqual(master.m().prepare('SELECT unduhan FROM lisensi_offline WHERE token = ?').get(link).unduhan, 1);
  r = await tamu('GET', '/unduh/offline/salah');
  assert.strictEqual(r.status, 404);
  // ZIP dasar (tanpa identitas sekolah) hanya untuk superadmin
  r = await tamu('GET', '/super/unduh/windows');
  assert.strictEqual(r.location, '/super/login');
  r = await su('GET', '/super/unduh/windows');
  assert.strictEqual(r.status, 200);
  // ZIP khusus sekolah dari panel superadmin, dan tidak bisa diambil tanpa login
  const idLisensi = master.m().prepare('SELECT id FROM lisensi_offline WHERE token = ?').get(link).id;
  r = await tamu('GET', `/super/offline/${idLisensi}/zip`);
  assert.strictEqual(r.location, '/super/login');
  const dariPanel = await fetch(`${base}/super/offline/${idLisensi}/zip`, { headers: { cookie: su.cookie() } });
  assert.strictEqual(dariPanel.status, 200);
  assert.match(dariPanel.headers.get('content-disposition'), /60109999\.zip/);
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

test('tambah sekolah online + offline sekaligus, atau offline saja', async () => {
  const su = klien();
  await su('POST', '/super/login', { _csrf: await su.token('/super/login'), username: 'superadmin', password: 'rahasia-super' });
  const tok = await su.token('/super');
  // offline dengan NPSN tidak valid: tidak ada yang dibuat sama sekali
  let r = await su('POST', '/super/sekolah', { _csrf: tok, online: '1', offline: '1', nama: 'SD GAGAL', npsn: '12' });
  assert.strictEqual(r.location, '/super#tambah');
  assert.ok(!master.daftar().some((s) => s.nama === 'SD GAGAL'));
  r = await su('POST', '/super/sekolah', { _csrf: tok, nama: 'SD TANPA VERSI', npsn: '60100005' });
  assert.ok(!master.daftar().some((s) => s.nama === 'SD TANPA VERSI'));
  // keduanya
  r = await su('POST', '/super/sekolah', { _csrf: tok, online: '1', offline: '1', nama: 'SD NEGERI 5 MASOHI', npsn: '60100005', catatan: 'paket lengkap' });
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /VERSI ONLINE/);
  assert.match(r.text, /VERSI OFFLINE/);
  assert.match(r.text, /\/sekolah\/60100005\/login/);
  const kode = /(ERAPOR-[A-Za-z0-9_.-]+)/.exec(r.text)[1];
  assert.strictEqual(require('../src/lib/lisensi').periksaKode(kode).npsn, '60100005');
  const l = master.m().prepare('SELECT * FROM lisensi_offline WHERE kode = ?').get(kode);
  assert.strictEqual(l.sekolah_kode, '60100005');
  assert.strictEqual(master.cari('60100005').catatan, 'paket lengkap');
  // offline saja: tidak membuat sekolah online
  r = await su('POST', '/super/sekolah', { _csrf: tok, offline: '1', nama: 'SD TERPENCIL', npsn: '60100006' });
  assert.match(r.text, /VERSI OFFLINE/);
  assert.doesNotMatch(r.text, /VERSI ONLINE/);
  assert.ok(!master.cari('60100006'));
  r = await su('GET', '/super');
  // sekolah online+offline ditandai di kartunya; offline saja tampil di bagian offline
  assert.match(r.text, /SD NEGERI 5 MASOHI[\s\S]*badge-success">Offline/);
  assert.match(r.text, /SD TERPENCIL/);
});

test('halaman detail sekolah menampilkan alamat, akun, dan kode aktivasi untuk akses ulang', async () => {
  const su = klien();
  await su('POST', '/super/login', { _csrf: await su.token('/super/login'), username: 'superadmin', password: 'rahasia-super' });
  let r = await su('GET', '/super');
  assert.match(r.text, /href="\/super\/sekolah\/60100005"/);
  r = await su('GET', '/super/sekolah/60100005');
  assert.strictEqual(r.status, 200);
  const l = master.m().prepare("SELECT * FROM lisensi_offline WHERE sekolah_kode = '60100005'").get();
  assert.ok(r.text.includes(l.kode));
  assert.ok(r.text.includes(`/unduh/offline/${l.token}`));
  assert.match(r.text, /\/sekolah\/60100005\/login/);
  assert.match(r.text, /Reset sandi/);
  // aksi dari halaman detail kembali ke halaman detail
  const tok = await su.token('/super/sekolah/60100005');
  r = await su('POST', '/super/sekolah/60100005/ubah', { _csrf: tok, nama: 'SD NEGERI 5 MASOHI', npsn: '60100005', catatan: 'diperbarui', kembali: '/super/sekolah/60100005' });
  assert.strictEqual(r.location, '/super/sekolah/60100005');
  r = await su('POST', '/super/sekolah/60100005/ubah', { _csrf: tok, nama: 'SD NEGERI 5 MASOHI', kembali: 'https://jahat.example' });
  assert.strictEqual(r.location, '/super');
  r = await su('GET', '/super/sekolah/tidak-ada');
  assert.strictEqual(r.location, '/super');
  // halaman lain tidak bisa dibuka tanpa login superadmin
  r = await klien()('GET', '/super/sekolah/60100005');
  assert.strictEqual(r.location, '/super/login');
});

test('superadmin mengunggah ZIP aplikasi Windows dari panel (hanya ZIP paket yang sah diterima)', async () => {
  const su = klien();
  await su('POST', '/super/login', { _csrf: await su.token('/super/login'), username: 'superadmin', password: 'rahasia-super' });
  const kirim = (isi, cookie = su.cookie()) => fetch(`${base}/super/unggah-zip`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', origin: base, cookie }, body: isi, redirect: 'manual' });
  const asli = fs.readFileSync(process.env.ZIP_WINDOWS);
  // bukan ZIP → ditolak, berkas lama utuh
  let r = await kirim(Buffer.from('bukan zip'));
  assert.strictEqual(r.status, 400);
  assert.ok(!(await r.json()).ok);
  // ZIP lain (bukan paket aplikasi) → ditolak
  const { writeZip } = require('../src/lib/zip');
  const salah = path.join(dir, 'salah.zip'); writeZip(salah, [{ name: 'x/a.txt', data: 'a' }]);
  r = await kirim(fs.readFileSync(salah));
  assert.strictEqual(r.status, 400);
  assert.deepStrictEqual(fs.readFileSync(process.env.ZIP_WINDOWS), asli);
  // paket yang sah → tersimpan dan halaman panel menampilkannya
  const sah = path.join(dir, 'sah.zip');
  writeZip(sah, [{ name: 'E-Rapor-SD-Windows/Jalankan-Rapor.bat', data: '@echo off' }, { name: 'E-Rapor-SD-Windows/Pasang-E-Rapor-SD.exe', data: 'MZ' }, { name: 'E-Rapor-SD-Windows/node/node.exe', data: 'MZ' }]);
  r = await kirim(fs.readFileSync(sah));
  const j = await r.json();
  assert.strictEqual(r.status, 200); assert.ok(j.ok);
  assert.deepStrictEqual(fs.readFileSync(process.env.ZIP_WINDOWS), fs.readFileSync(sah));
  assert.deepStrictEqual(fs.readdirSync(path.dirname(process.env.ZIP_WINDOWS)).filter((f) => f.endsWith('.unggah')), [], 'tidak ada berkas sementara tersisa');
  assert.match((await su('GET', '/super')).text, /Ganti ZIP aplikasi Windows/);
  // tanpa login superadmin → tidak boleh
  r = await kirim(fs.readFileSync(sah), '');
  assert.ok(r.status === 302 || r.status === 401 || r.status === 403);
});

test('ZIP guru dari sekolah di server: lisensi offline ikut (dibuat otomatis oleh superadmin), admin sekolah biasa tidak bisa membuatnya', async () => {
  const { execFileSync } = require('child_process');
  const su = klien();
  await su('POST', '/super/login', { _csrf: await su.token('/super/login'), username: 'superadmin', password: 'rahasia-super' });
  const tok = await su.token('/super');
  await su('POST', '/super/sekolah', { _csrf: tok, online: '1', nama: 'SD NEGERI GURU ZIP', npsn: '60105555', kode: 'guru-zip', admin_username: 'kepsek', admin_password: 'sandi-kepsek-1' });
  const d = master.dbSekolah(master.cari('guru-zip'));
  const guru = d.prepare("INSERT INTO users (username, password_hash, nama, role) VALUES ('bu.guru', 'x', 'Bu Guru', 'guru')").run().lastInsertRowid;
  d.prepare("INSERT INTO classes (nama, tingkat, fase, guru_id) VALUES ('IV A', 4, 'B', ?)").run(guru);
  const url = `/sekolah/guru-zip/app/paket/guru?guru=${guru}&bentuk=zip`;
  // admin sekolah (bukan superadmin): belum ada lisensi offline → ditolak
  const kepsek = await masuk('guru-zip', 'kepsek', 'sandi-kepsek-1');
  let res = await fetch(base + url, { headers: { cookie: kepsek.req.cookie() }, redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(master.m().prepare("SELECT COUNT(*) n FROM lisensi_offline WHERE sekolah_kode = 'guru-zip'").get().n, 0);
  // superadmin masuk ke sekolah itu → lisensi dibuat otomatis dan ikut di ZIP
  await su('POST', '/super/sekolah/guru-zip/masuk', { _csrf: await su.token('/super') });
  res = await fetch(base + url, { headers: { cookie: su.cookie() }, redirect: 'manual' });
  assert.strictEqual(res.status, 200);
  const l = master.m().prepare("SELECT * FROM lisensi_offline WHERE sekolah_kode = 'guru-zip'").get();
  assert.ok(l); assert.strictEqual(l.npsn, '60105555'); assert.match(l.catatan, /otomatis/);
  assert.match(res.headers.get('content-disposition'), /E-Rapor-SD-NEGERI-GURU-ZIP-60105555-GURU-buguru\.zip/);
  const berkas = path.join(dir, 'guru-zip.zip');
  fs.writeFileSync(berkas, Buffer.from(await res.arrayBuffer()));
  execFileSync('unzip', ['-tq', berkas]);
  const folder = 'E-Rapor-60105555-GURU';
  assert.strictEqual(execFileSync('unzip', ['-p', berkas, `${folder}/data/kode-aktivasi.txt`]).toString(), l.kode);
  assert.strictEqual(JSON.parse(execFileSync('unzip', ['-p', berkas, `${folder}/data/paket-awal.rapor.json`]).toString()).lisensi, l.kode);
  // permintaan berikutnya memakai lisensi yang sama (tidak membuat lisensi baru), juga oleh admin sekolah
  res = await fetch(base + url, { headers: { cookie: kepsek.req.cookie() }, redirect: 'manual' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(master.m().prepare("SELECT COUNT(*) n FROM lisensi_offline WHERE sekolah_kode = 'guru-zip'").get().n, 1);
});

test('ZIP sekolah memakai kode aplikasi TERBARU dari server (tanpa NSIS): kode lama diganti, node_modules dan pemasang tetap dari ZIP dasar', async () => {
  const { execFileSync } = require('child_process');
  const { writeZip } = require('../src/lib/zip');
  const dasar = path.join(dir, 'dasar-basi.zip');
  writeZip(dasar, [
    { name: 'E-Rapor-SD-Windows/Pasang-E-Rapor-SD.exe', data: 'EXE-LAMA' },
    { name: 'E-Rapor-SD-Windows/node/node.exe', data: 'MZ' },
    { name: 'E-Rapor-SD-Windows/Jalankan-Rapor.bat', data: '@echo lama' },
    { name: 'E-Rapor-SD-Windows/app/', data: '' },
    { name: 'E-Rapor-SD-Windows/app/server.js', data: '// kode LAMA' },
    { name: 'E-Rapor-SD-Windows/app/src/berkas-yang-sudah-dihapus.js', data: 'x' },
    { name: 'E-Rapor-SD-Windows/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node', data: 'BINARI-WINDOWS' },
  ]);
  const asli = process.env.ZIP_WINDOWS;
  const master2 = require('../src/lib/master');
  const l = master2.buatLisensiOffline({ npsn: '60107777', sekolah: 'SD Segar' });
  // ZIP_WINDOWS dibaca saat modul dimuat; ganti isi berkas dasar yang dipakai
  fs.copyFileSync(dasar, asli);
  const z = master2.buatZipSekolah(l);
  try {
    const nama = execFileSync('unzip', ['-Z1', z.file]).toString().trim().split('\n');
    const folder = 'E-Rapor-60107777';
    const ada = (rel) => nama.includes(`${folder}/${rel}`);
    assert.ok(nama.every((n) => n.startsWith(`${folder}/`)));
    assert.ok(!ada('app/src/berkas-yang-sudah-dihapus.js'), 'kode lama dibuang');
    assert.ok(ada('app/src/lib/zip.js') && ada('app/views/aktivasi.ejs') && ada('app/package.json'), 'kode terbaru dari server ikut');
    assert.ok(ada('app/node_modules/better-sqlite3/build/Release/better_sqlite3.node'), 'node_modules dari ZIP dasar tetap');
    assert.ok(ada('Pasang-E-Rapor-SD.exe') && ada('node/node.exe'), 'pemasang & node dari ZIP dasar tetap');
    assert.strictEqual(execFileSync('unzip', ['-p', z.file, `${folder}/app/server.js`]).toString(), fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'));
    assert.match(execFileSync('unzip', ['-p', z.file, `${folder}/Jalankan-Rapor.bat`]).toString(), /\r\n/, 'peluncur memakai CRLF');
    assert.strictEqual(execFileSync('unzip', ['-p', z.file, `${folder}/data/kode-aktivasi.txt`]).toString(), l.kode);
    execFileSync('unzip', ['-tq', z.file]);
  } finally { fs.rmSync(z.file, { force: true }); }
});

test('ZIP yang dibagikan: berkas inti ditulis lebih dulu, jalur pendek, dan pemeriksa ketat menolak ZIP rusak', () => {
  const { execFileSync } = require('child_process');
  const { writeZip, verifikasiZip, buatZipDenganFolder } = require('../src/lib/zip');
  const dasar = path.join(dir, 'dasar-urutan.zip');
  writeZip(dasar, [
    { name: 'X/node/node.exe', data: 'MZ' }, { name: 'X/Jalankan-Rapor.bat', data: '@echo off' },
    { name: 'X/app/node_modules/a/b.js', data: 'a'.repeat(5000) }, { name: 'X/app/server.js', data: '//lama' },
  ]);
  const hasil = path.join(dir, 'hasil-urutan.zip');
  buatZipDenganFolder(dasar, hasil, { folder: 'E-Rapor-1', hapus: (r) => r === 'app/server.js', entries: [{ name: 'app/server.js', data: '//baru' }, { name: 'data/kode-aktivasi.txt', data: 'K' }] });
  const nama = execFileSync('unzip', ['-Z1', hasil]).toString().trim().split('\n');
  assert.ok(nama.indexOf('E-Rapor-1/app/server.js') < nama.indexOf('E-Rapor-1/app/node_modules/a/b.js'), 'kode inti sebelum node_modules');
  const info = verifikasiZip(hasil, ['app/server.js', 'node/node.exe', 'data/kode-aktivasi.txt']);
  assert.strictEqual(info.folder, 'E-Rapor-1');
  assert.throws(() => verifikasiZip(hasil, ['app/tidak-ada.js']), /tidak ada/);
  // satu byte isi berubah → CRC tidak cocok; ZIP terpotong → ditolak
  const rusak = Buffer.from(fs.readFileSync(hasil));
  const i = rusak.indexOf(Buffer.from('//baru'));
  rusak[i] = 0x58;
  const berkasRusak = path.join(dir, 'rusak.zip'); fs.writeFileSync(berkasRusak, rusak);
  assert.throws(() => verifikasiZip(berkasRusak), /CRC|rusak/);
  const potong = path.join(dir, 'potong.zip'); fs.writeFileSync(potong, fs.readFileSync(hasil).subarray(0, 120));
  assert.throws(() => verifikasiZip(potong), /tidak utuh|rusak/);
});
