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
  const req = async function (method, url, body) {
    const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
    // nilai berupa array dikirim sebagai beberapa field bernama sama (seperti kotak centang)
    const isi = body && new URLSearchParams(Object.entries(body).flatMap(([k, v]) => [].concat(v).map((x) => [k, x])));
    const res = await fetch(base + url, { method, headers, body: isi && isi.toString(), redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  };
  req.cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  return req;
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

test('input banyak siswa: NISN tidak dobel dan bisa hapus beberapa siswa sekaligus', async () => {
  const { req, token } = await masuk('guru4a', 'guru123');
  const siswa = db.prepare("SELECT * FROM students WHERE class_id = ? AND status = 'aktif' ORDER BY id").all(kelas);
  const n0 = siswa.length;
  // tempel ulang siswa yang sudah ada (NISN sama) → diperbarui, bukan ditambah; NISN siswa kelas lain → ditolak
  const lain = db.prepare("SELECT nisn FROM students WHERE nama = 'Siswa Lain'").get();
  db.prepare("UPDATE students SET nisn = '7770001' WHERE nama = 'Siswa Lain'").run();
  let r = await req('POST', '/app/siswa/massal', { _csrf: token, class_id: String(kelas), n: '4',
    nama__0: 'Ani Baru Diperbarui', nisn__0: siswa.find((s) => s.nama === 'Ani Baru').nisn || '',
    nama__1: 'Dobel A', nisn__1: '5550001', nama__2: 'Dobel A lagi', nisn__2: '5550001', nama__3: 'Pakai NISN Kelas Lain', nisn__3: '7770001' });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM students WHERE nisn = '5550001'").get().n, 1);
  assert.strictEqual(db.prepare("SELECT nama FROM students WHERE nisn = '5550001'").get().nama, 'Dobel A lagi');
  assert.ok(!db.prepare("SELECT 1 FROM students WHERE nama = 'Pakai NISN Kelas Lain'").get());
  r = await req('GET', `/app/siswa/massal?kelas=${kelas}`);
  assert.match(r.text, /Tidak disimpan: Pakai NISN Kelas Lain \(NISN 7770001 sudah terdaftar di kelas VI Z\)/);
  assert.ok(lain);
  // hapus dua siswa sekaligus
  const sekarang = db.prepare("SELECT id FROM students WHERE class_id = ? AND status = 'aktif' ORDER BY id").all(kelas);
  const hapus = sekarang.slice(-2).map((s) => s.id);
  r = await req('POST', '/app/siswa/massal', { _csrf: token, class_id: String(kelas), n: '2',
    id__0: String(hapus[0]), nama__0: 'x', hapus__0: '1', id__1: String(hapus[1]), nama__1: 'y', hapus__1: '1' });
  assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM students WHERE id IN (${hapus.join(',')})`).get().n, 0);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM students WHERE class_id = ? AND status = 'aktif'").get(kelas).n, sekarang.length - 2);
  assert.ok(n0 > 0);
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

test('menu yang sedang dibuka ditandai (sidebar, tab kelas, dan mapel)', async () => {
  const { req } = await masuk('guru4a', 'guru123');
  const aktif = (html, sel) => [...html.matchAll(new RegExp(`<a href="([^"]+)" class="${sel}"`, 'g'))].map((m) => m[1]);
  let r = await req('GET', `/app/kelas/${kelas}/nilai`);
  assert.strictEqual(r.status, 302);
  r = await req('GET', r.location);
  assert.deepStrictEqual(aktif(r.text, 'active'), ['/app/kelas', `/app/kelas/${kelas}/nilai`]);
  assert.match(r.text, /class="chip active"/);
  r = await req('GET', `/app/kelas/${kelas}/sas`);
  assert.deepStrictEqual(aktif(r.text, 'active'), ['/app/kelas', `/app/kelas/${kelas}/sas`]);
  r = await req('GET', `/app/kelas/${kelas}`);
  assert.deepStrictEqual(aktif(r.text, 'active'), ['/app/kelas', `/app/kelas/${kelas}`]);
  r = await req('GET', '/app');
  assert.deepStrictEqual(aktif(r.text, 'active'), ['/app']);
  r = await req('GET', '/app/siswa');
  assert.deepStrictEqual(aktif(r.text, 'active'), ['/app/siswa']);
});

test('kata sandi acak: kosong saat tambah guru dan reset sandi oleh admin', async () => {
  const { sandiAcak } = require('../src/lib/sandi-acak');
  const contoh = new Set(Array.from({ length: 50 }, () => sandiAcak()));
  assert.strictEqual(contoh.size, 50);
  for (const s of contoh) assert.match(s, /^(?=.*[A-Z])(?=.*[a-z])(?=.*[2-9])[A-HJ-NP-Za-km-z2-9]{12}$/);

  const { req, token } = await masuk('admin', 'admin123');
  let r = await req('POST', '/app/pengguna', { _csrf: token, n: '1', nama__0: 'Guru Acak', username__0: 'guruacak', password__0: '' });
  r = await req('GET', '/app/pengguna');
  const sandi = /guruacak \(sandi: ([A-Za-z0-9]{12})\)/.exec(r.text)[1];
  assert.ok((await masuk('guruacak', sandi)).token);

  const id = db.prepare("SELECT id FROM users WHERE username = 'guruacak'").get().id;
  await req('POST', `/app/pengguna/${id}`, { _csrf: token, action: 'sandi_acak' });
  r = await req('GET', '/app/pengguna');
  const baru = /Kata sandi baru untuk guruacak: ([A-Za-z0-9]{12})/.exec(r.text)[1];
  assert.notStrictEqual(baru, sandi);
  assert.ok((await masuk('guruacak', baru)).token);
  assert.match(r.text, /data-sandi-acak/);
});

test('piagam: tombol cetak membuka piagam (bukan rapor) dan isinya bisa diatur admin', async () => {
  const { req, token } = await masuk('admin', 'admin123');
  let r = await req('GET', `/app/kelas/${kelas}/cetak`);
  // formulir piagam tidak boleh berada di dalam formulir lain (formulir bersarang membuat tombol membuka rapor akhir)
  let dalam = 0;
  for (const m of r.text.matchAll(/<form\b|<\/form>/g)) { dalam += m[0] === '</form>' ? -1 : 1; assert.ok(dalam <= 1, 'ada formulir bersarang'); }
  assert.match(r.text, /<form class="cetak-tile" id="form-piagam" method="get" action="\/app\/kelas\/\d+\/cetak-semua\/piagam"/);
  await req('POST', '/app/pengaturan', { _csrf: token, bobot_f: '1', bobot_s: '2', bobot_as: '2', juara_jumlah: '3',
    piagam_judul: 'PIAGAM PRESTASI', piagam_kalimat: 'atas prestasi {nama} di kelas {kelas} ({tahun})', piagam_ttd_kanan: 'Wali Kelas', piagam_warna: 'emas' });
  r = await req('GET', `/app/kelas/${kelas}/cetak-semua/piagam?top=3`);
  assert.match(r.text, /PIAGAM PRESTASI/);
  assert.match(r.text, /Wali Kelas/);
  assert.match(r.text, /warna-emas/);
  assert.match(r.text, /atas prestasi .+ di kelas IV A \(\d{4}\/\d{4}\)/);
  assert.match(r.text, /contenteditable="true"/);
  assert.doesNotMatch(r.text, /RAPOR DAN PROFIL PESERTA DIDIK/);
});

test('piagam tetap bisa dilihat sebagai contoh walau belum ada nilai / siswa', async () => {
  const { req, token } = await masuk('admin', 'admin123');
  let r = await req('POST', '/app/kelas', { _csrf: token, nama: 'KELAS TANPA NILAI', tingkat: '2' });
  const id = /\/app\/kelas\/(\d+)/.exec(r.location)[1];
  r = await req('GET', `/app/kelas/${id}/cetak-semua/piagam?top=3`);
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /Contoh tampilan piagam/);
  assert.match(r.text, /Nama Siswa/);
  assert.match(r.text, /Peringkat …\.\./);
  const sid = db.prepare("INSERT INTO students (nama, class_id) VALUES ('Siswa Belum Dinilai', ?)").run(id).lastInsertRowid;
  r = await req('GET', `/app/kelas/${id}/cetak-semua/piagam`);
  assert.match(r.text, /Siswa Belum Dinilai/);
  r = await req('GET', `/app/rapor/${sid}/piagam`);
  assert.match(r.text, /Contoh tampilan piagam/);
  r = await req('GET', `/app/kelas/${id}/cetak`);
  assert.match(r.text, new RegExp(`/app/rapor/${sid}/piagam`));
});

test('10 template piagam: galeri, pilih template (admin), dan pilihan saat mencetak', async () => {
  const { req, token } = await masuk('admin', 'admin123');
  let r = await req('GET', '/app/piagam/template');
  assert.strictEqual(r.status, 200);
  for (let n = 1; n <= 10; n += 1) assert.match(r.text, new RegExp(`piagam tpl-${n}[ "]`));
  r = await req('POST', '/app/piagam/template', { _csrf: token, tpl: '7' });
  assert.strictEqual(db.prepare("SELECT value FROM settings WHERE key = 'piagam_template'").get().value, '7');
  r = await req('GET', `/app/kelas/${kelas}/cetak-semua/piagam`);
  assert.match(r.text, /piagam tpl-7/);
  r = await req('GET', `/app/kelas/${kelas}/cetak-semua/piagam?tpl=3`);
  assert.match(r.text, /piagam tpl-3/);
  r = await req('GET', `/app/kelas/${kelas}/cetak-semua/piagam?tpl=99`);
  assert.match(r.text, /piagam tpl-7/);
  // guru boleh melihat galeri, tetapi tidak bisa mengganti template sekolah
  const g = await masuk('guru4a', 'guru123');
  r = await g.req('POST', '/app/piagam/template', { _csrf: g.token, tpl: '2' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(db.prepare("SELECT value FROM settings WHERE key = 'piagam_template'").get().value, '7');
});

test('hapus siswa langsung dari daftar: satu per satu dan banyak sekaligus', async () => {
  const { req, token } = await masuk('guru4a', 'guru123');
  const buat = (nama) => db.prepare('INSERT INTO students (nama, class_id) VALUES (?, ?)').run(nama, kelas).lastInsertRowid;
  const a = buat('Hapus A'); const b = buat('Hapus B'); const c = buat('Hapus C'); const d = buat('Tetap D');
  let r = await req('GET', `/app/siswa?kelas=${kelas}`);
  assert.match(r.text, /id="form-hapus-siswa"/);
  assert.match(r.text, new RegExp(`name="satu" value="${a}"`));
  // tombol hapus di baris A walau B & C dicentang → hanya A
  r = await req('POST', '/app/siswa/hapus', { _csrf: token, kembali: `/app/siswa?kelas=${kelas}`, satu: String(a), ids: [String(b), String(c)] });
  assert.strictEqual(r.location, `/app/siswa?kelas=${kelas}`);
  const ada = (id) => !!db.prepare('SELECT 1 FROM students WHERE id = ?').get(id);
  assert.deepStrictEqual([ada(a), ada(b), ada(c), ada(d)], [false, true, true, true]);
  // banyak sekaligus
  const p = new URLSearchParams({ _csrf: token }); p.append('ids', String(b)); p.append('ids', String(c));
  await fetch(`${base}/app/siswa/hapus`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: req.cookie() }, body: p.toString() });
  assert.deepStrictEqual([ada(b), ada(c), ada(d)], [false, false, true]);
  // siswa kelas lain tidak bisa dihapus guru
  const lain = db.prepare("SELECT id FROM students WHERE nama = 'Siswa Lain'").get().id;
  await req('POST', '/app/siswa/hapus', { _csrf: token, satu: String(lain) });
  assert.ok(ada(lain));
});

test('Pengguna & Guru: daftar dengan Detail/Hapus, edit guru (username dan kelas yang diampu) di halaman detail', async () => {
  const { req, token } = await masuk('admin', 'admin123');
  const g = db.prepare("INSERT INTO users (username, password_hash, nama, role) VALUES ('guruedit', 'x', 'Guru Edit', 'guru')").run().lastInsertRowid;
  const kls = db.prepare('INSERT INTO classes (nama, tingkat, fase) VALUES (?, 5, ?)');
  const k1 = kls.run('V Edit', 'C').lastInsertRowid; const k2 = kls.run('VI Edit', 'C').lastInsertRowid;
  // daftar hanya menampilkan data + tombol Detail dan Hapus
  let r = await req('GET', '/app/pengguna');
  assert.match(r.text, new RegExp(`href="/app/pengguna/${g}"[^>]*>[^<]*<svg[\\s\\S]*?Detail</a>`));
  assert.match(r.text, /value="delete"[^>]*>[\s\S]*?Hapus<\/button>/);
  assert.doesNotMatch(r.text, /name="username" value="guruedit"/);
  r = await req('GET', `/app/pengguna/${g}`);
  assert.match(r.text, /name="username" value="guruedit"/);
  assert.match(r.text, new RegExp(`type="checkbox" name="kelas" value="${k1}"`));
  // ganti nama, username, dan ampu dua kelas
  r = await req('POST', `/app/pengguna/${g}`, { _csrf: token, nama: 'Guru Diubah', nip: '123', username: 'gurubaru', role: 'guru', atur_kelas: '1', kelas: [String(k1), String(k2)] });
  assert.strictEqual(r.location, '/app/pengguna');
  assert.deepStrictEqual({ ...db.prepare('SELECT nama, nip, username FROM users WHERE id = ?').get(g) }, { nama: 'Guru Diubah', nip: '123', username: 'gurubaru' });
  const guruDari = (id) => db.prepare('SELECT guru_id FROM classes WHERE id = ?').get(id).guru_id;
  assert.deepStrictEqual([guruDari(k1), guruDari(k2)], [g, g]);
  // lepas satu kelas; username yang sudah dipakai ditolak
  r = await req('POST', `/app/pengguna/${g}`, { _csrf: token, nama: 'Guru Diubah', username: 'admin', role: 'guru', atur_kelas: '1', kelas: String(k2) });
  assert.deepStrictEqual([guruDari(k1), guruDari(k2)], [null, g]);
  assert.strictEqual(db.prepare('SELECT username FROM users WHERE id = ?').get(g).username, 'gurubaru');
  // tanpa centang sama sekali → tidak mengampu kelas
  await req('POST', `/app/pengguna/${g}`, { _csrf: token, nama: 'Guru Diubah', username: 'gurubaru', role: 'guru', atur_kelas: '1' });
  assert.strictEqual(guruDari(k2), null);
});
