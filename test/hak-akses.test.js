// Guru tidak boleh mengubah pengaturan sekolah; guru boleh mengelola (termasuk menghapus) data kelasnya sendiri.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-akses-'));
process.env.DATA_DIR = dir;
execFileSync(process.execPath, [path.join(__dirname, '..', 'src', 'seed-demo.js')], { env: { ...process.env, DATA_DIR: dir } });
const app = require('../server');
const { db } = require('../src/db');
const { hashPassword } = require('../src/lib/password');

// kelas kedua milik guru lain, dengan satu siswa
const guruLain = db.prepare("INSERT INTO users (username, password_hash, nama, role) VALUES ('gurulain', ?, 'Guru Lain', 'guru')").run(hashPassword('rahasia123')).lastInsertRowid;
const kelasLain = db.prepare("INSERT INTO classes (nama, tingkat, fase, guru_id) VALUES ('V A', 5, 'C', ?)").run(guruLain).lastInsertRowid;
const siswaLain = db.prepare("INSERT INTO students (nama, class_id, agama) VALUES ('Siswa Kelas Lain', ?, 'Islam')").run(kelasLain).lastInsertRowid;
const kelasGuru = db.prepare("SELECT id FROM classes WHERE nama = 'IV A'").get().id;
const siswaGuru = db.prepare('SELECT id FROM students WHERE class_id = ? ORDER BY id LIMIT 1').get(kelasGuru).id;

let server; let base; const jar = {};
async function req(method, url, body) {
  const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
  if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + url, { method, headers, body: body && new URLSearchParams(body).toString(), redirect: 'manual' });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return { status: res.status, text: await res.text(), location: res.headers.get('location') };
}
const csrf = (html) => /name="_csrf" value="([^"]+)"/.exec(html)[1];
let token;

test.before(() => new Promise((resolve) => { server = app.listen(0, async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  let r = await req('GET', '/login');
  await req('POST', '/login', { _csrf: csrf(r.text), username: 'guru4a', password: 'guru123' });
  r = await req('GET', '/app'); token = csrf(r.text);
  resolve();
}); }));
test.after(() => server.close());

test('menu & halaman pengaturan sekolah tidak tersedia untuk guru', async () => {
  const r = await req('GET', '/app');
  for (const menu of ['/app/sekolah', '/app/pengaturan', '/app/periode', '/app/mapel', '/app/pengguna']) {
    assert.ok(!r.text.includes(`href="${menu}"`), `menu ${menu} tidak tampil`);
  }
  for (const url of ['/app/sekolah', '/app/pengaturan', '/app/periode', '/app/mapel', '/app/pengguna', '/app/backup', '/app/paket/guru?guru=semua&bentuk=json']) {
    assert.strictEqual((await req('GET', url)).status, 403, `GET ${url}`);
  }
});

test('guru tidak bisa mengubah pengaturan sekolah lewat kiriman formulir langsung', async () => {
  const sebelum = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  const nKelas = db.prepare('SELECT COUNT(*) n FROM classes').get().n;
  const nUser = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const coba = [
    ['/app/sekolah', { nama_sekolah: 'SEKOLAH LAIN', npsn: '99999999', logo_sekolah: 'data:image/png;base64,iVBORw0KGgo=' }],
    ['/app/pengaturan', { bobot_f: '5', juara_jumlah: '50' }],
    ['/app/pengaturan/bank', { jenis: 'catatan', teks: 'diubah guru' }],
    ['/app/periode', { tahun_pelajaran: '2030/2031', semester: '1' }],
    ['/app/periode/1', { action: 'publish' }],
    ['/app/mapel', { nama: 'Mapel Baru', kelompok: 'mulok' }],
    ['/app/mapel/1', { nama: 'Diubah' }],
    ['/app/pengguna', { username: 'baru', nama: 'Baru', password: 'rahasia123', role: 'admin' }],
    ['/app/pengguna/1', { nama: 'Diubah', role: 'guru' }],
    ['/app/kelas', { nama: 'IX', tingkat: '6' }],
    [`/app/kelas/${kelasGuru}/ubah`, { nama: 'Ganti Nama', tingkat: '4' }],
    ['/app/paket/periksa', { isi: '{}' }],
    ['/app/paket/impor', { isi: '{}' }],
  ];
  for (const [url, body] of coba) {
    assert.strictEqual((await req('POST', url, { _csrf: token, ...body })).status, 403, `POST ${url}`);
  }
  const sesudah = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  assert.deepStrictEqual(sesudah, sebelum, 'pengaturan tidak berubah');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM classes').get().n, nKelas);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM users').get().n, nUser);
  assert.strictEqual(db.prepare('SELECT nama FROM classes WHERE id = ?').get(kelasGuru).nama, 'IV A');
});

test('guru tidak bisa membuka atau mengubah kelas & siswa guru lain', async () => {
  for (const url of [`/app/kelas/${kelasLain}`, `/app/kelas/${kelasLain}/nilai/9`, `/app/kelas/${kelasLain}/leger`, `/app/rapor/${siswaLain}/akhir`]) {
    assert.strictEqual((await req('GET', url)).status, 403, `GET ${url}`);
  }
  assert.strictEqual((await req('POST', `/app/kelas/${kelasLain}/absensi`, { _csrf: token })).status, 403);
  await req('POST', `/app/siswa/${siswaLain}`, { _csrf: token, nama: 'Diubah Guru Lain' });
  await req('POST', `/app/siswa/${siswaLain}`, { _csrf: token, action: 'delete' });
  assert.strictEqual(db.prepare('SELECT nama FROM students WHERE id = ?').get(siswaLain).nama, 'Siswa Kelas Lain');
  // tidak bisa memindahkan siswanya ke kelas guru lain atau mengosongkan kelasnya
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(siswaGuru);
  await req('POST', `/app/siswa/${siswaGuru}`, { _csrf: token, nama: s.nama, class_id: String(kelasLain) });
  await req('POST', `/app/siswa/${siswaGuru}`, { _csrf: token, nama: s.nama, class_id: '' });
  assert.strictEqual(db.prepare('SELECT class_id FROM students WHERE id = ?').get(siswaGuru).class_id, kelasGuru);
});

test('guru bisa menambah, mengubah, dan menghapus siswa serta nilai di kelasnya', async () => {
  let r = await req('POST', '/app/siswa/baru', { _csrf: token, nama: 'Siswa Baru Guru', class_id: String(kelasGuru), agama: 'Islam' });
  assert.strictEqual(r.status, 302);
  const id = db.prepare("SELECT id FROM students WHERE nama = 'Siswa Baru Guru'").get().id;
  r = await req('POST', `/app/siswa/${id}`, { _csrf: token, nama: 'Siswa Diubah Guru', class_id: String(kelasGuru) });
  assert.strictEqual(db.prepare('SELECT nama FROM students WHERE id = ?').get(id).nama, 'Siswa Diubah Guru');
  r = await req('GET', `/app/siswa/${id}/edit`);
  assert.match(r.text, /Hapus siswa/);
  r = await req('POST', `/app/siswa/${id}`, { _csrf: token, action: 'delete' });
  assert.strictEqual(db.prepare('SELECT 1 FROM students WHERE id = ?').get(id), undefined);
  // nilai: isi lalu kosongkan
  r = await req('GET', `/app/kelas/${kelasGuru}/nilai/9`);
  const field = /name="(f_\d+_\d+)"/.exec(r.text)[1];
  await req('POST', `/app/kelas/${kelasGuru}/nilai/9`, { _csrf: token, [field]: '91' });
  const [, tp, st] = field.split('_');
  assert.strictEqual(db.prepare('SELECT nilai FROM nilai_formatif WHERE tp_id = ? AND student_id = ?').get(tp, st).nilai, 91);
  await req('POST', `/app/kelas/${kelasGuru}/nilai/9`, { _csrf: token, [field]: '' });
  assert.strictEqual(db.prepare('SELECT 1 FROM nilai_formatif WHERE tp_id = ? AND student_id = ?').get(tp, st), undefined);
});
