// Input banyak data sekaligus: siswa, nilai SAS semua mapel, kelas, dan pengguna.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-massal-'));
process.env.DATA_DIR = dir;
execFileSync(process.execPath, [path.join(__dirname, '..', 'src', 'seed-demo.js')], { env: { ...process.env, DATA_DIR: dir } });
const app = require('../server');
const { db } = require('../src/db');
const { buildStudentRapor, getActivePeriod } = require('../src/lib/rapor');

const kelas = db.prepare("SELECT id FROM classes WHERE nama = 'IV A'").get().id;
let server; let base;
function klien() {
  const jar = {};
  return async function req(method, url, body) {
    const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
    const res = await fetch(base + url, { method, headers, body: body && new URLSearchParams(body).toString(), redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  };
}
const csrf = (html) => /name="_csrf" value="([^"]+)"/.exec(html)[1];
async function masuk(username, password) {
  const req = klien();
  const r = await req('GET', '/login');
  await req('POST', '/login', { _csrf: csrf(r.text), username, password });
  return { req, token: csrf((await req('GET', '/app')).text) };
}

test.before(() => new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); }));
test.after(() => server.close());

test('input banyak siswa: tambah baru dan ubah siswa lama dalam satu simpan', async () => {
  const { req, token } = await masuk('guru4a', 'guru123');
  const lama = db.prepare("SELECT * FROM students WHERE class_id = ? AND status = 'aktif' ORDER BY nama COLLATE NOCASE").all(kelas);
  let r = await req('GET', `/app/siswa/massal?kelas=${kelas}`);
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /data-row-template/);
  const n = lama.length + 10;
  assert.match(r.text, new RegExp(`name="n" value="${n}"`));
  const body = { _csrf: token, class_id: String(kelas), n: String(n + 2) };
  body[`id__0`] = String(lama[0].id); body[`nama__0`] = 'Nama Diubah Massal'; body[`nisn__0`] = '9990001';
  body[`jenis_kelamin__0`] = lama[0].jenis_kelamin || 'L'; body[`agama__0`] = lama[0].agama || 'Islam';
  body[`id__1`] = String(lama[1].id); body[`nama__1`] = ''; // nama dikosongkan: siswa tidak terhapus
  const baru = [['Ani Baru', 'P', 'Kristen', '17/07/2015'], ['Budi Baru', 'laki-laki', 'islam', '2015-01-02'], ['Cici Baru', 'P', 'Budha', '']];
  baru.forEach(([nama, jk, agama, tgl], k) => {
    const i = lama.length + k + (k === 2 ? 9 : 0); // baris terakhir di luar 10 baris awal (ditambah lewat tombol)
    Object.assign(body, { [`nama__${i}`]: nama, [`jenis_kelamin__${i}`]: jk, [`agama__${i}`]: agama, [`tanggal_lahir__${i}`]: tgl });
  });
  r = await req('POST', '/app/siswa/massal', body);
  assert.strictEqual(r.status, 302);
  const s0 = db.prepare('SELECT * FROM students WHERE id = ?').get(lama[0].id);
  assert.strictEqual(s0.nama, 'Nama Diubah Massal');
  assert.strictEqual(s0.nisn, '9990001');
  assert.strictEqual(db.prepare('SELECT nama FROM students WHERE id = ?').get(lama[1].id).nama, lama[1].nama);
  const ani = db.prepare("SELECT * FROM students WHERE nama = 'Ani Baru'").get();
  assert.deepStrictEqual([ani.class_id, ani.jenis_kelamin, ani.agama, ani.tanggal_lahir], [kelas, 'P', 'Kristen', '2015-07-17']);
  const budi = db.prepare("SELECT * FROM students WHERE nama = 'Budi Baru'").get();
  assert.deepStrictEqual([budi.jenis_kelamin, budi.agama, budi.tanggal_lahir], ['L', 'Islam', '2015-01-02']);
  assert.strictEqual(db.prepare("SELECT agama FROM students WHERE nama = 'Cici Baru'").get().agama, 'Buddha');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM students WHERE class_id = ? AND status = ?').get(kelas, 'aktif').n, lama.length + 3);
});

test('input banyak siswa: guru tidak bisa memakai kelas atau siswa milik guru lain', async () => {
  const kelasLain = db.prepare("INSERT INTO classes (nama, tingkat, fase) VALUES ('VI Z', 6, 'C')").run().lastInsertRowid;
  const siswaLain = db.prepare("INSERT INTO students (nama, class_id) VALUES ('Siswa Lain', ?)").run(kelasLain).lastInsertRowid;
  const { req, token } = await masuk('guru4a', 'guru123');
  const sebelum = db.prepare('SELECT COUNT(*) n FROM students').get().n;
  await req('POST', '/app/siswa/massal', { _csrf: token, class_id: String(kelasLain), n: '1', nama__0: 'Penyusup' });
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM students').get().n, sebelum);
  // id siswa kelas lain diselipkan ke kelas sendiri: tidak berubah dan tidak dipindah
  await req('POST', `/app/siswa/massal?kelas=${kelas}`, { _csrf: token, class_id: String(kelas), n: '1', id__0: String(siswaLain), nama__0: 'Diubah' });
  assert.deepStrictEqual({ ...db.prepare('SELECT nama, class_id FROM students WHERE id = ?').get(siswaLain) }, { nama: 'Siswa Lain', class_id: kelasLain });
});

test('nilai SAS semua mapel: satu lembar, agama mengikuti siswa, deskripsi manual tidak tertimpa', async () => {
  const { req, token } = await masuk('guru4a', 'guru123');
  const period = getActivePeriod();
  const r = await req('GET', `/app/kelas/${kelas}/sas`);
  assert.strictEqual(r.status, 200);
  const st = db.prepare("SELECT * FROM students WHERE class_id = ? AND status = 'aktif' AND agama = 'Islam' LIMIT 1").get(kelas);
  const mtk = db.prepare("SELECT id FROM subjects WHERE kode = 'MTK'").get().id;
  const agIslam = db.prepare("SELECT id FROM subjects WHERE kelompok = 'agama' AND agama = 'Islam'").get().id;
  db.prepare(`INSERT INTO nilai_akhir (period_id, subject_id, student_id, desk_tinggi) VALUES (?, ?, ?, 'Kalimat manual')
    ON CONFLICT DO UPDATE SET desk_tinggi = excluded.desk_tinggi`).run(period.id, mtk, st.id);
  assert.match(r.text, new RegExp(`name="nt_${mtk}_${st.id}"`));
  assert.match(r.text, new RegExp(`name="nt_agama_${st.id}"`));
  const res = await req('POST', `/app/kelas/${kelas}/sas`, { _csrf: token, [`nt_${mtk}_${st.id}`]: '81', [`t_${mtk}_${st.id}`]: '79,5', [`nt_agama_${st.id}`]: '90', [`t_agama_${st.id}`]: '' });
  assert.strictEqual(res.status, 302);
  const a = db.prepare('SELECT * FROM nilai_akhir WHERE period_id = ? AND subject_id = ? AND student_id = ?').get(period.id, mtk, st.id);
  assert.deepStrictEqual([a.sas_nontes, a.sas_tes, a.desk_tinggi], [81, 79.5, 'Kalimat manual']);
  const g = db.prepare('SELECT * FROM nilai_akhir WHERE period_id = ? AND subject_id = ? AND student_id = ?').get(period.id, agIslam, st.id);
  assert.deepStrictEqual([g.sas_nontes, g.sas_tes], [90, null]);
  // ikut dihitung di rapor
  const rapor = buildStudentRapor(period.id, st.id);
  assert.ok(rapor);
});

test('admin menambah banyak kelas dan banyak guru sekaligus', async () => {
  const { req, token } = await masuk('admin', 'admin123');
  const nKelas = db.prepare('SELECT COUNT(*) n FROM classes').get().n;
  let r = await req('POST', '/app/kelas', { _csrf: token, n: '4', nama__0: 'I A', tingkat__0: '1', nama__1: 'I B', tingkat__1: '1', nama__2: '', nama__3: 'VI A', tingkat__3: '6' });
  assert.strictEqual(r.location, '/app/kelas');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM classes').get().n, nKelas + 3);
  assert.strictEqual(db.prepare("SELECT fase FROM classes WHERE nama = 'VI A'").get().fase, 'C');
  // bentuk satu kelas lama tetap berfungsi
  r = await req('POST', '/app/kelas', { _csrf: token, nama: 'II A', tingkat: '2' });
  assert.match(r.location, /^\/app\/kelas\/\d+$/);

  r = await req('POST', '/app/pengguna', { _csrf: token, n: '4',
    nama__0: 'Guru Satu, S.Pd.', username__0: 'gurusatu', password__0: 'rahasia1', role__0: 'guru', nip__0: '1971',
    nama__1: 'Guru Dua', username__1: 'gurudua', password__1: 'rahasia2', role__1: 'guru',
    nama__2: 'Duplikat', username__2: 'guru4a', password__2: 'rahasia3',
    nama__3: 'Sandi Pendek', username__3: 'pendek', password__3: '123' });
  assert.ok(db.prepare("SELECT 1 FROM users WHERE username = 'gurusatu' AND nip = '1971'").get());
  assert.ok(db.prepare("SELECT 1 FROM users WHERE username = 'gurudua'").get());
  assert.ok(!db.prepare("SELECT 1 FROM users WHERE username = 'pendek'").get());
  r = await req('GET', '/app/pengguna');
  assert.match(r.text, /Tidak disimpan: guru4a \(username sudah dipakai\); pendek/);
  // guru baru bisa login
  const g = await masuk('gurudua', 'rahasia2');
  assert.ok(g.token);
});
