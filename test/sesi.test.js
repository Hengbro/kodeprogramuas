// Sesi habis atau token formulir lama tidak boleh membuat isian guru hilang.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-sesi-'));
process.env.DATA_DIR = dir;
execFileSync(process.execPath, [path.join(__dirname, '..', 'src', 'seed-demo.js')], { env: { ...process.env, DATA_DIR: dir } });
const app = require('../server');
const { db } = require('../src/db');

const kelas = db.prepare("SELECT id FROM classes WHERE nama = 'IV A'").get().id;
const siswa = db.prepare('SELECT * FROM students WHERE class_id = ? ORDER BY id LIMIT 1').get(kelas);

let server; let base;
async function req(jar, method, url, body, extra = {}) {
  const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), ...extra };
  if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + url, { method, headers, body: body && new URLSearchParams(body).toString(), redirect: 'manual' });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return { status: res.status, text: await res.text(), location: res.headers.get('location') };
}
const csrf = (html) => /name="_csrf" value="([^"]+)"/.exec(html)[1];
const unescape = (s) => s.replace(/&#34;/g, '"').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
async function masuk(jar) {
  const r = await req(jar, 'GET', '/login');
  await req(jar, 'POST', '/login', { _csrf: csrf(r.text), username: 'guru4a', password: 'guru123' });
  return csrf((await req(jar, 'GET', '/app')).text);
}

test.before(() => new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); }));
test.after(() => server.close());

test('sesi tahan lama dan diperpanjang selama dipakai', async () => {
  const jar = {};
  const r = await req(jar, 'GET', '/login');
  const res = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') }, body: new URLSearchParams({ _csrf: csrf(r.text), username: 'guru4a', password: 'guru123' }) });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('rapor_sess='));
  const exp = new Date(/expires=([^;]+)/i.exec(cookie)[1]);
  assert.ok(exp - Date.now() > 20 * 24 * 3600 * 1000, 'sesi berlaku lebih dari 20 hari');
});

test('token lama dari halaman aplikasi sendiri tetap diterima, dari situs lain ditolak', async () => {
  const jar = {};
  await masuk(jar);
  const host = new URL(base).host;
  let r = await req(jar, 'POST', `/app/siswa/${siswa.id}`, { _csrf: 'token-lama', nama: 'Nama Dari Tab Lama' }, { origin: `http://${host}` });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(db.prepare('SELECT nama FROM students WHERE id = ?').get(siswa.id).nama, 'Nama Dari Tab Lama');
  r = await req(jar, 'POST', `/app/siswa/${siswa.id}`, { _csrf: 'token-lama', nama: 'Diubah Situs Jahat' }, { origin: 'https://jahat.example' });
  assert.strictEqual(r.status, 403);
  r = await req(jar, 'POST', `/app/siswa/${siswa.id}`, { _csrf: 'token-lama', nama: 'Tanpa Asal' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(db.prepare('SELECT nama FROM students WHERE id = ?').get(siswa.id).nama, 'Nama Dari Tab Lama');
});

test('sesi habis saat menyimpan: login ulang lalu isian tersimpan', async () => {
  const jar = {};
  const token = await masuk(jar);
  // sesi berakhir (cookie hilang), guru menekan Simpan dari halaman yang masih terbuka
  const kosong = {};
  let r = await req(kosong, 'POST', `/app/siswa/${siswa.id}`, { _csrf: token, nama: 'Nama Setelah Sesi Habis', panggilan: 'Budi & "Kawan"' }, { origin: base });
  assert.strictEqual(r.status, 401);
  assert.match(r.text, /belum hilang/);
  const tujuan = unescape(/name="_tujuan" value="([^"]*)"/.exec(r.text)[1]);
  const data = unescape(/name="_data" value="([^"]*)"/.exec(r.text)[1]);
  assert.deepStrictEqual(JSON.parse(data), { nama: 'Nama Setelah Sesi Habis', panggilan: 'Budi & "Kawan"' });

  r = await req(kosong, 'POST', '/lanjutkan', { _csrf: csrf(r.text), _tujuan: tujuan, _data: data, username: 'guru4a', password: 'salah' });
  assert.strictEqual(r.status, 401);
  r = await req(kosong, 'POST', '/lanjutkan', { _csrf: csrf(r.text), _tujuan: tujuan, _data: data, username: 'guru4a', password: 'guru123' });
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /id="kirim-ulang"/);
  // halaman kirim-ulang mengirim formulir otomatis; tiru dengan membaca field tersembunyinya
  const fields = [...r.text.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [unescape(m[1]), unescape(m[2])]);
  const action = /action="([^"]+)" id="kirim-ulang"/.exec(r.text)[1];
  const kirim = await fetch(base + action, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: Object.entries(kosong).map(([k, v]) => `${k}=${v}`).join('; ') }, body: new URLSearchParams(fields).toString() });
  assert.strictEqual(kirim.status, 302);
  const s = db.prepare('SELECT nama, panggilan FROM students WHERE id = ?').get(siswa.id);
  assert.deepStrictEqual({ ...s }, { nama: 'Nama Setelah Sesi Habis', panggilan: 'Budi & "Kawan"' });
});

test('lanjutkan menolak tujuan di luar aplikasi', async () => {
  const jar = {};
  const r = await req(jar, 'GET', '/login');
  const res = await req(jar, 'POST', '/lanjutkan', { _csrf: csrf(r.text), _tujuan: 'https://jahat.example/', _data: '{}', username: 'guru4a', password: 'guru123' });
  assert.strictEqual(res.location, '/login');
});

test('endpoint sehat untuk cek koneksi', async () => {
  const r = await req({}, 'GET', '/sehat');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(JSON.parse(r.text), { ok: true });
});
