// Pindah data antar dua database terpisah: ekspor dari A, impor ke B, hasil rapor harus sama.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
function run(dataDir, code) {
  return execFileSync(process.execPath, ['-e', code], { cwd: ROOT, env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
const SNAPSHOT = `
  const { db } = require('./src/db');
  const { buildClassReport, buildProjectRapor, getActivePeriod } = require('./src/lib/rapor');
  const p = getActivePeriod();
  const out = db.prepare('SELECT * FROM classes ORDER BY nama').all().map((c) => {
    const r = buildClassReport(p.id, c.id);
    return { kelas: c.nama, siswa: r.students.map((s) => ({ nama: s.student.nama, nisn: s.student.nisn, jumlah: s.jumlah, rank: s.rank,
      mapel: Object.values(s.mapel).map((m) => [m.subject.kode, m.na, m.deskripsi]).sort(),
      p5: buildProjectRapor(p.id, s.student.id).projects.map((x) => [x.nama, [...x.ringkasan.values()], x.catatan]) })) };
  });
  process.stdout.write(JSON.stringify({ periode: p.tahun_pelajaran + '/' + p.semester, out }));`;

test('paket data lengkap: rapor di komputer tujuan sama dengan komputer asal', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-b-'));
  execFileSync(process.execPath, ['src/seed-demo.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: a } });
  const file = path.join(a, 'paket.json');
  run(a, `const { exportPaket } = require('./src/lib/paket'); const { db } = require('./src/db');
    const ids = db.prepare('SELECT id FROM classes').all().map((r) => r.id);
    require('fs').writeFileSync(${JSON.stringify(file)}, JSON.stringify(exportPaket({ sekolah: true, kelas: ids, denganNilai: true })));`);
  run(b, `const { parsePaket, importPaket } = require('./src/lib/paket');
    importPaket(parsePaket(require('fs').readFileSync(${JSON.stringify(file)}, 'utf8')), { sekolah: true, aktifkanPeriode: true });`);
  const sa = JSON.parse(run(a, SNAPSHOT));
  const sb = JSON.parse(run(b, SNAPSHOT));
  assert.ok(sa.out[0].siswa.length >= 10);
  assert.deepStrictEqual(sb, sa);

  // impor kedua kali tidak menggandakan siswa
  run(b, `const { parsePaket, importPaket } = require('./src/lib/paket');
    importPaket(parsePaket(require('fs').readFileSync(${JSON.stringify(file)}, 'utf8')), { sekolah: true });`);
  assert.deepStrictEqual(JSON.parse(run(b, SNAPSHOT)), sa);
  const n = run(b, "process.stdout.write(String(require('./src/db').db.prepare('SELECT COUNT(*) n FROM students').get().n))");
  assert.strictEqual(Number(n), sa.out[0].siswa.length);
});

test('paket awal tidak membawa siswa dan nilai', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-a-'));
  execFileSync(process.execPath, ['src/seed-demo.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: a } });
  const pkg = JSON.parse(run(a, `const { exportPaket } = require('./src/lib/paket');
    process.stdout.write(JSON.stringify(exportPaket({ sekolah: true, kelas: [1], denganNilai: false })));`));
  assert.strictEqual(pkg.kelas[0].siswa.length, 0);
  assert.ok(pkg.kelas[0].data[0].tp.length > 0);
  assert.ok(pkg.kelas[0].data[0].tp.every((t) => t.nilai.length === 0));
  assert.ok(!('_session_secret' in pkg.sekolah.settings));
});
