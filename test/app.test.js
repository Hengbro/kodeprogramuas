const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-test-'));
process.env.DATA_DIR = dir;
execFileSync(process.execPath, [path.join(__dirname, '..', 'src', 'seed-demo.js')], { env: { ...process.env, DATA_DIR: dir } });
const app = require('../server');

let server;
let base;
const jar = {};

async function req(method, url, body) {
  const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
  if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + url, { method, headers, body: body && new URLSearchParams(body).toString(), redirect: 'manual' });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return { status: res.status, text: await res.text(), location: res.headers.get('location') };
}
const csrf = (html) => /name="_csrf" value="([^"]+)"/.exec(html)[1];

test.before(() => new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); }));
test.after(() => { server.close(); });

test('alur admin & halaman utama', async () => {
  let r = await req('GET', '/');
  assert.strictEqual(r.status, 200);
  r = await req('GET', '/login');
  r = await req('POST', '/login', { _csrf: csrf(r.text), username: 'admin', password: 'admin123' });
  assert.strictEqual(r.status, 302);
  const pages = ['/app', '/app/sekolah', '/app/pengaturan', '/app/periode', '/app/mapel', '/app/pengguna', '/app/akun', '/app/siswa',
    '/app/siswa/baru', '/app/siswa/impor', '/app/kelas', '/app/kelas/1', '/app/kelas/1/mapel', '/app/kelas/1/absensi', '/app/kelas/1/ekskul',
    '/app/kelas/1/catatan', '/app/kelas/1/kenaikan', '/app/kelas/1/projek', '/app/kelas/1/projek/1', '/app/kelas/1/projek/1/nilai',
    '/app/kelas/1/leger', '/app/kelas/1/leger?print=1', '/app/kelas/1/cetak', '/app/siswa/1', '/app/siswa/1/edit',
    '/app/rapor/1/akhir?part=cover&part=sekolah&part=identitas&part=nilai', '/app/rapor/1/tts', '/app/rapor/1/projek', '/app/rapor/1/piagam',
    '/app/kelas/1/cetak-semua/akhir', '/app/kelas/1/cetak-semua/projek', '/app/kelas/1/cetak-semua/piagam', '/app/kelas/1/cetak-semua/tts',
    '/app/panduan', '/app/paket', '/app/kelas/1/progres', '/app/kelas/1/rekap', '/app/kelas/1/rekap?mapel=agama', '/app/rapor/1/induk', '/app/rapor/1/pindah',
    '/app/kelas/1/cetak-semua/induk?part=cover&part=nilai', '/app/kelas/1/cetak-semua/projek?part=cover&part=nilai'];
  for (let sid = 1; sid <= 16; sid += 1) pages.push(`/app/kelas/1/tp/${sid}`, `/app/kelas/1/nilai/${sid}`);
  for (const p of pages) {
    const res = await req('GET', p);
    assert.ok([200, 302].includes(res.status), `${p} -> ${res.status}`);
  }
  r = await req('GET', '/app/rapor/1/induk');
  assert.match(r.text, /KETERANGAN TENTANG DIRI PESERTA DIDIK/);
  assert.match(r.text, /BUKU INDUK SISWA/);
  r = await req('GET', '/app/kelas/1/rekap?format=csv');
  assert.match(r.text, /Deskripsi capaian tertinggi/);
  r = await req('GET', '/app/kelas/1/leger?format=csv');
  assert.match(r.text, /Rata-rata/);
  r = await req('GET', '/app/rapor/1/akhir');
  assert.match(r.text, /RAPOR DAN PROFIL PESERTA DIDIK/);
  assert.match(r.text, /menunjukkan penguasaan/);
});

test('formulir tanpa token keamanan ditolak dengan halaman yang benar', async () => {
  const r = await req('POST', '/cek-rapor', { nisn: '1', tanggal_lahir: '2015-01-01' });
  assert.strictEqual(r.status, 403);
  assert.match(r.text, /Formulir kedaluwarsa/);
});

test('simpan nilai menghitung ulang NA', async () => {
  let r = await req('GET', '/app/kelas/1/nilai/9'); // Matematika
  const token = csrf(r.text);
  const fields = { _csrf: token };
  for (const m of r.text.matchAll(/name="((?:f|s|nt|t)_[\d_]+)" value="[^"]*"/g)) fields[m[1]] = '80';
  r = await req('POST', '/app/kelas/1/nilai/9', fields);
  assert.strictEqual(r.status, 302);
  r = await req('GET', '/app/kelas/1/nilai/9');
  assert.match(r.text, /data-out="na">80</);
});

test('penilaian umum dimensi P5 tampil di ringkasan rapor projek', async () => {
  let r = await req('GET', '/app/kelas/1/projek/1/nilai');
  const fields = { _csrf: csrf(r.text) };
  for (const m of r.text.matchAll(/name="((?:p|d)_\d+_\d+)"/g)) fields[m[1]] = '4';
  r = await req('POST', '/app/kelas/1/projek/1/nilai', fields);
  assert.strictEqual(r.status, 302);
  r = await req('GET', '/app/rapor/1/projek');
  const ringkasan = r.text.slice(r.text.indexOf('Projek Kelas'));
  assert.strictEqual((ringkasan.slice(0, ringkasan.indexOf('</table>')).match(/>SB</g) || []).length >= 6, true);
});

test('logo sekolah: unggah, tampil di cetak, dan bisa dihapus', async () => {
  // PNG 1x1 piksel
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  let r = await req('GET', '/app/sekolah');
  r = await req('POST', '/app/sekolah', { _csrf: csrf(r.text), nama_sekolah: 'SD NEGERI 1 NUSANTARA', logo_sekolah: png });
  assert.strictEqual(r.status, 302);
  r = await req('GET', '/logo/sekolah');
  assert.strictEqual(r.status, 200);
  r = await req('GET', '/app/rapor/1/akhir?part=cover');
  assert.match(r.text, /src="\/logo\/sekolah\?v=/);
  r = await req('GET', '/app/rapor/1/tts');
  assert.match(r.text, /src="\/logo\/sekolah\?v=/);
  r = await req('GET', '/app/sekolah');
  r = await req('POST', '/app/sekolah', { _csrf: csrf(r.text), nama_sekolah: 'SD NEGERI 1 NUSANTARA', logo_sekolah: 'data:text/html;base64,PHNjcmlwdD4=' });
  r = await req('GET', '/app/sekolah');
  assert.match(r.text, /PNG, JPG, atau WEBP/);
  r = await req('POST', '/app/sekolah', { _csrf: csrf(r.text), nama_sekolah: 'SD NEGERI 1 NUSANTARA', hapus_logo_sekolah: '1' });
  r = await req('GET', '/logo/sekolah');
  assert.strictEqual(r.status, 404);
});

test('piagam untuk juara lebih dari 3', async () => {
  const r = await req('GET', '/app/kelas/1/cetak-semua/piagam?top=7');
  assert.strictEqual((r.text.match(/PIAGAM PENGHARGAAN/g) || []).length >= 7, true);
  assert.match(r.text, /Peringkat Ketujuh/);
});

test('portal orang tua: NISN + tanggal lahir', async () => {
  const { db } = require('../src/db');
  const st = db.prepare('SELECT * FROM students WHERE id = 1').get();
  let r = await req('GET', '/');
  r = await req('POST', '/cek-rapor', { _csrf: csrf(r.text), nisn: st.nisn, tanggal_lahir: '1999-01-01' });
  assert.strictEqual(r.status, 404);
  r = await req('GET', '/');
  r = await req('POST', '/cek-rapor', { _csrf: csrf(r.text), nisn: st.nisn, tanggal_lahir: st.tanggal_lahir });
  assert.strictEqual(r.location, '/rapor-saya');
  r = await req('GET', '/rapor-saya');
  assert.match(r.text, new RegExp(st.nama));
  const period = /href="\/rapor-saya\/(\d+)\/akhir"/.exec(r.text)[1];
  r = await req('GET', `/rapor-saya/${period}/akhir`);
  assert.match(r.text, /RAPOR DAN PROFIL PESERTA DIDIK/);
});

test('guru tidak bisa membuka halaman admin', async () => {
  for (const k of Object.keys(jar)) delete jar[k];
  let r = await req('GET', '/login');
  r = await req('POST', '/login', { _csrf: csrf(r.text), username: 'guru4a', password: 'guru123' });
  assert.strictEqual(r.status, 302);
  r = await req('GET', '/app/pengguna');
  assert.strictEqual(r.status, 403);
  r = await req('GET', '/app/kelas/1');
  assert.strictEqual(r.status, 200);
});
