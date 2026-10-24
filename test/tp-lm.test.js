// TP dikaitkan ke lingkup materi (LM 1 = Bab 1 berisi beberapa TP).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-tplm-'));
process.env.DATA_DIR = dir;
execFileSync(process.execPath, [path.join(__dirname, '..', 'src', 'seed-demo.js')], { env: { ...process.env, DATA_DIR: dir } });
const app = require('../server');
const { db } = require('../src/db');
const { getActivePeriod } = require('../src/lib/rapor');

const kelas = db.prepare("SELECT id FROM classes WHERE nama = 'IV A'").get().id;
const mapel = db.prepare("SELECT id FROM subjects WHERE kode = 'PJOK'").get().id;
let server; let base; const jar = {};
async function req(method, url, body) {
  const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
  if (body) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + url, { method, headers, body: body && new URLSearchParams(body).toString(), redirect: 'manual' });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return { status: res.status, text: await res.text() };
}
const csrf = (html) => /name="_csrf" value="([^"]+)"/.exec(html)[1];
let token;
const url = `/app/kelas/${kelas}/tp/${mapel}`;
const tpDb = () => db.prepare(`SELECT t.id, t.deskripsi, t.urutan, l.nama AS lm FROM tujuan_pembelajaran t LEFT JOIN lingkup_materi l ON l.id = t.lm_id
  WHERE t.period_id = ? AND t.class_id = ? AND t.subject_id = ? ORDER BY t.urutan`).all(getActivePeriod().id, kelas, mapel);
const lmDb = () => db.prepare('SELECT id, nama FROM lingkup_materi WHERE period_id = ? AND class_id = ? AND subject_id = ? ORDER BY urutan').all(getActivePeriod().id, kelas, mapel);

function form(lms, tps) {
  const p = new URLSearchParams({ _csrf: token });
  for (const l of lms) { p.append('lm_id', l.id || ''); p.append('lm_key', l.key); p.append('lm', l.nama); }
  for (const t of tps) { p.append('tp_id', t.id || ''); p.append('tp_lm', t.lm || ''); p.append('tp', t.text); }
  return p;
}
async function kirim(p) {
  const res = await fetch(base + url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') }, body: p.toString() });
  assert.strictEqual(res.status, 302);
}

test.before(() => new Promise((resolve) => { server = app.listen(0, async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await req('GET', '/login');
  await req('POST', '/login', { _csrf: csrf(r.text), username: 'guru4a', password: 'guru123' });
  token = csrf((await req('GET', '/app')).text);
  resolve();
}); }));
test.after(() => server.close());

test('LM baru beserta TP-nya tersimpan terkait, urutan TP mengikuti LM', async () => {
  await kirim(form(
    [{ key: 'baru1', nama: 'Bab 1 Gerak Dasar' }, { key: 'baru2', nama: 'Bab 2 Permainan' }],
    [{ lm: 'baru1', text: 'melakukan gerak lokomotor' }, { lm: 'baru1', text: 'melakukan gerak non-lokomotor' },
      { lm: 'baru2', text: 'memainkan permainan bola kecil' }, { lm: '', text: 'menjaga kebersihan diri' }],
  ));
  assert.deepStrictEqual(tpDb().map((t) => [t.urutan, t.lm, t.deskripsi]), [
    [1, 'Bab 1 Gerak Dasar', 'melakukan gerak lokomotor'], [2, 'Bab 1 Gerak Dasar', 'melakukan gerak non-lokomotor'],
    [3, 'Bab 2 Permainan', 'memainkan permainan bola kecil'], [4, null, 'menjaga kebersihan diri']]);
  const r = await req('GET', url);
  assert.match(r.text, /data-tp-editor/);
  const n = await req('GET', `/app/kelas/${kelas}/nilai/${mapel}`);
  assert.match(n.text, /TP1<small>LM1<\/small>/);
  assert.match(n.text, /TP3<small>LM2<\/small>/);
});

test('memindahkan TP ke LM lain tidak menghapus nilainya; menghapus LM membuat TP-nya tanpa LM', async () => {
  const [l1, l2] = lmDb();
  const tps = tpDb();
  const siswa = db.prepare("SELECT id FROM students WHERE class_id = ? AND status = 'aktif' LIMIT 1").get(kelas).id;
  db.prepare('INSERT INTO nilai_formatif (tp_id, student_id, nilai) VALUES (?, ?, 88)').run(tps[0].id, siswa);
  await kirim(form(
    [{ id: l1.id, key: `id${l1.id}`, nama: l1.nama }, { id: l2.id, key: `id${l2.id}`, nama: l2.nama }],
    [{ id: tps[1].id, lm: `id${l1.id}`, text: tps[1].deskripsi }, { id: tps[0].id, lm: `id${l2.id}`, text: tps[0].deskripsi },
      { id: tps[2].id, lm: `id${l2.id}`, text: tps[2].deskripsi }, { id: tps[3].id, lm: '', text: tps[3].deskripsi }],
  ));
  const pindah = tpDb().find((t) => t.id === tps[0].id);
  assert.strictEqual(pindah.lm, 'Bab 2 Permainan');
  assert.strictEqual(db.prepare('SELECT nilai FROM nilai_formatif WHERE tp_id = ? AND student_id = ?').get(tps[0].id, siswa).nilai, 88);
  // LM 2 dihapus (tidak dikirim); TP-nya dikirim sebagai "tanpa LM"
  await kirim(form(
    [{ id: l1.id, key: `id${l1.id}`, nama: l1.nama }],
    [{ id: tps[1].id, lm: `id${l1.id}`, text: tps[1].deskripsi }, { id: tps[0].id, lm: '', text: tps[0].deskripsi },
      { id: tps[2].id, lm: '', text: tps[2].deskripsi }, { id: tps[3].id, lm: '', text: tps[3].deskripsi }],
  ));
  assert.deepStrictEqual(lmDb().map((l) => l.nama), ['Bab 1 Gerak Dasar']);
  assert.deepStrictEqual(tpDb().map((t) => t.lm), ['Bab 1 Gerak Dasar', null, null, null]);
  assert.strictEqual(db.prepare('SELECT nilai FROM nilai_formatif WHERE tp_id = ? AND student_id = ?').get(tps[0].id, siswa).nilai, 88);
});

test('kaitan TP–LM ikut terbawa saat menyalin TP ke periode baru dan di paket data', async () => {
  const { exportPaket } = require('../src/lib/paket');
  const pkg = exportPaket({ kelas: [kelas], denganNilai: false });
  const blok = pkg.kelas[0].data.find((d) => d.tp.some((t) => t.mapel === 'PJOK'));
  const tpPjok = blok.tp.filter((t) => t.mapel === 'PJOK');
  assert.deepStrictEqual(tpPjok.map((t) => t.lm), [1, null, null, null]);

  const admin = {};
  const r0 = await fetch(`${base}/login`); for (const c of r0.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); admin[kv.slice(0, i)] = kv.slice(i + 1); }
  const ck = () => Object.entries(admin).map(([k, v]) => `${k}=${v}`).join('; ');
  const tok0 = csrf(await r0.text());
  const r1 = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: ck() }, body: new URLSearchParams({ _csrf: tok0, username: 'admin', password: 'admin123' }) });
  for (const c of r1.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); admin[kv.slice(0, i)] = kv.slice(i + 1); }
  const tok = csrf(await (await fetch(`${base}/app/periode`, { headers: { cookie: ck() } })).text());
  const src = getActivePeriod().id;
  await fetch(`${base}/app/periode`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: ck() },
    body: new URLSearchParams({ _csrf: tok, tahun_pelajaran: '2031/2032', semester: '1', copy_tp: '1', copy_from: String(src) }) });
  const p = db.prepare("SELECT id FROM periods WHERE tahun_pelajaran = '2031/2032'").get().id;
  const salinan = db.prepare(`SELECT t.deskripsi, l.nama AS lm, l.period_id FROM tujuan_pembelajaran t LEFT JOIN lingkup_materi l ON l.id = t.lm_id
    WHERE t.period_id = ? AND t.class_id = ? AND t.subject_id = ? ORDER BY t.urutan`).all(p, kelas, mapel);
  assert.deepStrictEqual(salinan.map((s) => [s.lm, s.period_id]), [['Bab 1 Gerak Dasar', p], [null, null], [null, null], [null, null]]);
});
