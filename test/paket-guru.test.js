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
      adminRole: (db.prepare("SELECT role FROM users WHERE username = 'admin'").get() || {}).role,
      adminLogin: verifyPassword('admin123', (db.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get() || {}).password_hash || ''),
      kelas: db.prepare('SELECT nama, guru_id FROM classes').all(), guruId: u.id,
      siswa: db.prepare('SELECT COUNT(*) n FROM students').get().n,
      kepsek: db.prepare("SELECT value FROM settings WHERE key = 'kepsek_nama'").get().value,
      logo: !!db.prepare("SELECT value FROM settings WHERE key = 'logo_sekolah'").get(),
      instalasi: db.prepare("SELECT value FROM settings WHERE key = '_instalasi_guru'").get().value,
      terpasang: require('fs').existsSync(${JSON.stringify(path.join(guru, 'paket-awal.terpasang.json'))}),
    }));`).split('\n').pop());
  assert.strictEqual(out.login, true);
  assert.strictEqual(out.role, 'guru');
  // akun admin sekolah ikut (peran & sandi sama seperti di server), agar admin juga bisa masuk di laptop guru
  assert.deepStrictEqual([out.admin, out.adminRole, out.adminLogin], [1, 'admin', true]);
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

test('aplikasi guru (paket berlisensi) tidak meminta aktivasi: langsung ke halaman login, akun admin tidak bisa dibuat', () => {
  const crypto = require('crypto');
  const { buatKode } = require('../src/lib/lisensi');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const admin = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-admin-'));
  const guru = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-guru-'));
  const pub = path.join(guru, 'publik.pem');
  fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }));
  const kode = buatKode({ npsn: '10200000', sekolah: 'SD NEGERI 1 NUSANTARA', seri: 'AAAA1111', berlaku: 'selamanya', dibuat: '2026-10-29' }, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  execFileSync(process.execPath, ['src/seed-demo.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: admin } });
  run(admin, `const { db } = require('./src/db');
    db.prepare("INSERT INTO settings (key, value) VALUES ('_lisensi', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(${JSON.stringify(kode)});
    const { exportPaketGuru } = require('./src/lib/paket');
    const id = db.prepare("SELECT id FROM users WHERE username = 'guru4a'").get().id;
    require('fs').writeFileSync(${JSON.stringify(path.join(guru, 'paket-awal.rapor.json'))}, JSON.stringify(exportPaketGuru([id])));`);
  const skrip = (lisensiWajib) => `
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
      hasil.penyusup = db.prepare("SELECT COUNT(*) n FROM users WHERE username = 'penyusup'").get().n;
      process.stdout.write('\\n' + JSON.stringify(hasil)); srv.close(); process.exit(0);
    });`;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', skrip()], { cwd: ROOT, env: { ...process.env, DATA_DIR: guru, LISENSI_WAJIB: '1', LISENSI_PUBLIK: pub }, encoding: 'utf8' }).split('\n').pop());
  assert.match(out.app, /login/);
  assert.strictEqual(out.aktivasi, '/app');
  assert.strictEqual(out.akun, '/app');
  assert.strictEqual(out.penyusup, 0, 'akun admin baru tidak bisa dibuat lewat halaman aktivasi');
  assert.strictEqual(out.admin, 1, 'hanya admin sekolah dari paket');
});

test('ZIP baru di laptop yang sudah terpasang: username & sandi yang diganti di server ikut berlaku, data rapor tidak berubah', () => {
  const server = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-server-'));
  const laptop = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-laptop-'));
  execFileSync(process.execPath, ['src/seed-demo.js'], { cwd: ROOT, env: { ...process.env, DATA_DIR: server } });
  const ekspor = () => run(server, `const { db } = require('./src/db');
    const { exportPaketGuru } = require('./src/lib/paket');
    const id = db.prepare("SELECT id FROM users WHERE username IN ('guru4a', 'guru.baru') ORDER BY id LIMIT 1").get().id;
    require('fs').writeFileSync(${JSON.stringify(path.join(laptop, 'paket-awal.rapor.json'))}, JSON.stringify(exportPaketGuru([id])));`);
  // pemasangan pertama
  ekspor();
  run(laptop, "require('./src/lib/paket-otomatis').pasangJikaAda();");
  // guru mengisi nilai di laptop (data yang tidak boleh hilang)
  run(laptop, `const { db } = require('./src/db');
    db.prepare("INSERT INTO settings (key, value) VALUES ('penanda_laptop', 'nilai-guru') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();`);
  // di server: username guru diganti dan sandi admin diganti
  run(server, `const { db } = require('./src/db');
    const { hashPassword } = require('./src/lib/password');
    db.prepare("UPDATE users SET username = 'guru.baru', password_hash = ? WHERE username = 'guru4a'").run(hashPassword('sandi-guru-baru'));
    db.prepare("UPDATE users SET password_hash = ? WHERE username = 'admin'").run(hashPassword('sandi-admin-baru'));`);
  // ZIP baru dipasang di laptop yang sama (paket baru di folder data) → aplikasi dibuka
  ekspor();
  const out = JSON.parse(run(laptop, `require('./src/lib/paket-otomatis').pasangJikaAda();
    const { db } = require('./src/db');
    const { verifyPassword } = require('./src/lib/password');
    const u = (n) => db.prepare('SELECT * FROM users WHERE username = ?').get(n);
    process.stdout.write('\\n' + JSON.stringify({
      guruBaru: !!u('guru.baru') && verifyPassword('sandi-guru-baru', u('guru.baru').password_hash),
      guruLamaMasihAda: !!u('guru4a'),
      adminBaru: verifyPassword('sandi-admin-baru', u('admin').password_hash),
      adminLama: verifyPassword('admin123', u('admin').password_hash),
      penanda: db.prepare("SELECT value FROM settings WHERE key = 'penanda_laptop'").get().value,
      siswa: db.prepare('SELECT COUNT(*) n FROM students').get().n,
    }));`).split('\n').pop());
  assert.deepStrictEqual(out, { guruBaru: true, guruLamaMasihAda: false, adminBaru: true, adminLama: false, penanda: 'nilai-guru', siswa: 10 });
});
