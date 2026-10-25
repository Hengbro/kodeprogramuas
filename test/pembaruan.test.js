// Pembaruan aplikasi dari GitHub lewat panel superadmin: memakai repo git sementara (bukan repo asli).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rapor-pembaruan-'));
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
const pusat = path.join(dir, 'pusat.git');
const dev = path.join(dir, 'dev');
const app = path.join(dir, 'app');
git(dir, 'init', '--bare', '-b', 'utama', pusat);
git(dir, 'clone', pusat, dev);
fs.writeFileSync(path.join(dev, 'a.txt'), 'satu');
git(dev, 'checkout', '-B', 'utama'); git(dev, 'add', '-A'); git(dev, 'commit', '-m', 'awal'); git(dev, 'push', '-u', 'origin', 'utama');
git(dir, 'clone', '-b', 'utama', pusat, app);
process.env.PEMBARUAN_DIR = app;
const pembaruan = require('../src/lib/pembaruan');

test('pembaruan: terdeteksi tertinggal, diperbarui, dan tidak menimpa perubahan lokal yang bentrok', () => {
  let st = pembaruan.status();
  assert.ok(st.git); assert.strictEqual(st.cabang, 'utama'); assert.strictEqual(st.tertinggal, 0);
  // versi baru di pusat
  fs.writeFileSync(path.join(dev, 'b.txt'), 'dua');
  git(dev, 'add', '-A'); git(dev, 'commit', '-m', 'tambah b'); git(dev, 'push');
  st = pembaruan.status();
  assert.strictEqual(st.tertinggal, 1);
  assert.deepStrictEqual(st.baru, ['tambah b']);
  const hasil = pembaruan.perbarui();
  assert.ok(hasil.berubah);
  assert.ok(fs.existsSync(path.join(app, 'b.txt')));
  assert.strictEqual(pembaruan.status().tertinggal, 0);
  assert.strictEqual(pembaruan.perbarui().berubah, false, 'tidak ada pembaruan lagi');
  // perubahan lokal yang bentrok dengan versi baru → pembaruan ditolak, berkas lokal tetap
  fs.writeFileSync(path.join(dev, 'a.txt'), 'dari pusat');
  git(dev, 'add', '-A'); git(dev, 'commit', '-m', 'ubah a'); git(dev, 'push');
  fs.writeFileSync(path.join(app, 'a.txt'), 'ubahan lokal');
  assert.throws(() => pembaruan.perbarui());
  assert.strictEqual(fs.readFileSync(path.join(app, 'a.txt'), 'utf8'), 'ubahan lokal');
});

test('pembaruan: bukan salinan git → dilaporkan tanpa galat', () => {
  process.env.PEMBARUAN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bukan-git-'));
  delete require.cache[require.resolve('../src/lib/pembaruan')];
  const st = require('../src/lib/pembaruan').status();
  assert.strictEqual(st.git, false);
});
