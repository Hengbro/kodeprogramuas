// Aplikasi untuk guru: pengaturan admin + akun guru dipasang otomatis di komputer guru.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const run = (dataDir, code) => execFileSync(process.execPath, ['-e', code], { cwd: ROOT, env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' });

test('paket guru: akun, kelas, dan pengaturan admin terpasang di komputer guru', () => {
  const admin = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-admin-'));
  const guru = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-guru-'));
  execFileSync(process.execPath, ['src/seed-demo.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: admin } });
  run(admin, `const { db } = require('./src/db');
    db.prepare("INSERT INTO settings (key, value) VALUES ('kepsek_nama', 'Kepala Uji') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('logo_sekolah', 'data:image/png;base64,iVBORw0KGgo=') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    const { exportPaketGuru } = require('./src/lib/paket');
    const id = db.prepare("SELECT id FROM users WHERE username = 'guru4a'").get().id;
    require('fs').writeFileSync(${JSON.stringify(path.join(guru, 'paket-awal.rapor.json'))}, JSON.stringify(exportPaketGuru([id])));`);
  const out = JSON.parse(run(guru, `require('./server');
    const { db } = require('./src/db');
    const { verifyPassword } = require('./src/lib/password');
    const u = db.prepare("SELECT * FROM users WHERE username = 'guru4a'").get();
    process.stdout.write(JSON.stringify({
      login: verifyPassword('guru123', u.password_hash), role: u.role,
      admin: db.prepare("SELECT COUNT(*) n FROM users WHERE username = 'admin'").get().n,
      kelas: db.prepare('SELECT nama, guru_id FROM classes').all(), guruId: u.id,
      siswa: db.prepare('SELECT COUNT(*) n FROM students').get().n,
      kepsek: db.prepare("SELECT value FROM settings WHERE key = 'kepsek_nama'").get().value,
      logo: !!db.prepare("SELECT value FROM settings WHERE key = 'logo_sekolah'").get(),
      instalasi: db.prepare("SELECT value FROM settings WHERE key = '_instalasi_guru'").get().value,
      terpasang: require('fs').existsSync(${JSON.stringify(path.join(guru, 'paket-awal.terpasang.json'))}),
    }));`).split('\n').pop());
  assert.strictEqual(out.login, true);
  assert.strictEqual(out.role, 'guru');
  assert.strictEqual(out.admin, 0);
  assert.deepStrictEqual(out.kelas, [{ nama: 'IV A', guru_id: out.guruId }]);
  assert.strictEqual(out.siswa, 10);
  assert.strictEqual(out.kepsek, 'Kepala Uji');
  assert.strictEqual(out.logo, true);
  assert.strictEqual(out.instalasi, '1');
  assert.strictEqual(out.terpasang, true);
});

test('penulis ZIP menghasilkan arsip yang valid', { skip: !fs.existsSync('/usr/bin/unzip') && 'unzip tidak tersedia' }, () => {
  const { writeZip } = require('../src/lib/zip');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
  const src = path.join(dir, 'a.txt');
  fs.writeFileSync(src, 'halo '.repeat(1000));
  const zip = path.join(dir, 'uji.zip');
  writeZip(zip, [{ name: 'folder/a.txt', file: src }, { name: 'folder/data/b.json', data: '{"x":1}' }]);
  execFileSync('unzip', ['-tq', zip]);
  assert.strictEqual(execFileSync('unzip', ['-p', zip, 'folder/data/b.json']).toString(), '{"x":1}');
});

test('aplikasi guru tidak meminta aktivasi: langsung ke halaman login, akun admin tidak bisa dibuat', () => {
  const admin = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-admin-'));
  const guru = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-guru-'));
  execFileSync(process.execPath, ['src/seed-demo.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: admin } });
  run(admin, `const { db } = require('./src/db');
    const { exportPaketGuru } = require('./src/lib/paket');
    const id = db.prepare("SELECT id FROM users WHERE username = 'guru4a'").get().id;
    require('fs').writeFileSync(${JSON.stringify(path.join(guru, 'paket-awal.rapor.json'))}, JSON.stringify(exportPaketGuru([id])));`);
  const out = JSON.parse(execFileSync(process.execPath, ['-e', `
    require('./src/lib/paket-otomatis').pasangJikaAda();
    const app = require('./server');
    const srv = app.listen(0, '127.0.0.1', async () => {
      const url = 'http://127.0.0.1:' + srv.address().port;
      const lokasi = async (p, opt) => (await fetch(url + p, { redirect: 'manual', ...opt })).headers.get('location');
      const hasil = {
        app: await lokasi('/app'),
        aktivasi: await lokasi('/aktivasi'),
        akun: await lokasi('/aktivasi/akun', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: url },
          body: 'nama=X&username=penyusup&password=rahasia123&password2=rahasia123' }),
      };
      const { db } = require('./src/db');
      hasil.admin = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin'").get().n;
      process.stdout.write('\\n' + JSON.stringify(hasil)); srv.close(); process.exit(0);
    });`], { cwd: ROOT, env: { ...process.env, DATA_DIR: guru, LISENSI_WAJIB: '1' }, encoding: 'utf8' }).split('\n').pop());
  assert.match(out.app, /login/);
  assert.strictEqual(out.aktivasi, '/app');
  assert.strictEqual(out.akun, '/app');
  assert.strictEqual(out.admin, 0);
});
