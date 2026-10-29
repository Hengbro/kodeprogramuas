const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const { db, MULTI, konteks } = require('./src/db');
const { getSettings, getActivePeriod } = require('./src/lib/rapor');
const helpers = require('./src/lib/view-helpers');
const lisensi = require('./src/lib/lisensi');

const master = MULTI ? require('./src/lib/master') : null;
if (MULTI) master.siapkan();
else require('./src/lib/paket-otomatis').pasangJikaAda();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

let secret = process.env.SESSION_SECRET;
if (!secret && MULTI) secret = master.pengaturan('session_secret', () => crypto.randomBytes(32).toString('hex'));
if (!secret) {
  // simpan secret acak di database agar sesi tetap valid setelah restart
  const row = db.prepare("SELECT value FROM settings WHERE key = '_session_secret'").get();
  secret = row ? row.value : crypto.randomBytes(32).toString('hex');
  if (!row) db.prepare("INSERT INTO settings (key, value) VALUES ('_session_secret', ?)").run(secret);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
if (process.env.TRUST_PROXY !== '0') app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
// Mode banyak sekolah: setiap halaman sekolah beralamat /sekolah/<kode>/... (login, menu aplikasi, portal orang tua).
// Awalan dilepas sebelum routing, lalu ditambahkan kembali pada tautan HTML dan redirect.
const BEBAS_AWALAN = /^\/(?:\/|static\/|super(?:[/?#]|$)|sekolah\/|sehat(?:[?#]|$)|pilih-sekolah(?:[?#]|$)|anak(?:[?#]|$)|unduh\/)/;
function pasangAwalan(url, awalan) {
  return typeof url === 'string' && url.startsWith('/') && !BEBAS_AWALAN.test(url) ? awalan + url : url;
}
if (MULTI) {
  app.use((req, res, next) => {
    const m = /^\/sekolah\/([A-Za-z0-9-]+)(\/.*)?$/.exec(req.path);
    if (!m) return next();
    if (!m[2]) return res.redirect(301, `/sekolah/${m[1]}/${req.url.slice(req.path.length)}`);
    const awalan = `/sekolah/${m[1].toLowerCase()}`;
    req.kodeUrl = m[1].toLowerCase();
    req.url = req.url.slice(`/sekolah/${m[1]}`.length);
    res.locals.awalan = awalan;
    const redirect = res.redirect.bind(res);
    res.redirect = (a, b) => (typeof a === 'number' ? redirect(a, pasangAwalan(b, awalan)) : redirect(pasangAwalan(a, awalan)));
    const send = res.send.bind(res);
    res.send = (body) => {
      const ct = String(res.get('Content-Type') || '');
      if (typeof body === 'string' && (ct.includes('html') || (!ct && body.trimStart().startsWith('<')))) {
        body = body
          .replace(/(\s(?:href|action|src|formaction)=["'])(\/[^"']*)/g, (_, a, u) => a + pasangAwalan(u, awalan))
          .replace(/(location\.href\s*=\s*')(\/[^']*)/g, (_, a, u) => a + pasangAwalan(u, awalan));
      }
      return send(body);
    };
    next();
  });
}
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));
app.get('/sehat', (req, res) => res.set('Cache-Control', 'no-store').json({ ok: true }));
app.use(express.urlencoded({ extended: true, limit: '50mb', parameterLimit: 50000 }));
app.use(cookieSession({
  name: 'rapor_sess',
  secret,
  httpOnly: true,
  sameSite: 'lax',
  secure: isProd && process.env.COOKIE_SECURE !== '0',
  maxAge: 30 * 24 * 60 * 60 * 1000,
}));
// perpanjang sesi selama aplikasi dipakai (cookie diperbarui paling lambat tiap 10 menit)
app.use((req, res, next) => {
  if (req.session && req.session.userId) req.session.aktif = Math.floor(Date.now() / 600000);
  next();
});

// Mode banyak sekolah: pilih database sekolah untuk permintaan ini.
// Sekolah diambil dari sesi; formulir masuk/cek rapor dan halaman depan boleh menyebut sekolah lain
// (konteksLain = tidak memakai akun/siswa yang tersimpan di sesi).
if (MULTI) {
  app.use((req, res, next) => {
    // sesi dari masa satu sekolah (sebelum mode banyak sekolah) milik sekolah pertama
    if (!req.session.sekolah && (req.session.userId || req.session.publicStudentId)) {
      const lama = master.pengaturan('sekolah_lama');
      if (lama) req.session.sekolah = lama; else { delete req.session.userId; delete req.session.publicStudentId; }
    }
    res.locals.dariSuper = !!(req.session.superId && req.session.dariSuper);
    res.locals.kodeDiminta = req.kodeUrl || req.session.sekolah || req.session.terakhir || '';
    if (!req.kodeUrl) {
      // tanpa awalan sekolah: hanya halaman umum; selebihnya diarahkan ke alamat sekolah yang benar
      const pilih = String(req.query.sekolah || '').trim().toLowerCase();
      if (req.method === 'GET' && pilih && ['/', '/login', '/pilih-sekolah'].includes(req.path)) {
        if (!master.cari(pilih)) return res.redirect(req.path === '/login' ? '/login?salah=1' : '/pilih-sekolah?salah=1');
        return res.redirect(`/sekolah/${encodeURIComponent(pilih)}${req.path === '/login' ? '/login' : '/'}`);
      }
      if (['/', '/login', '/pilih-sekolah', '/logout', '/anak', '/keluar-portal'].includes(req.path) || req.path.startsWith('/super') || req.path.startsWith('/unduh/')) {
        res.locals.sekolah = null;
        return next();
      }
      if (req.session.sekolah) return res.redirect(307, `/sekolah/${req.session.sekolah}${req.url}`);
      return res.redirect('/');
    }
    const s = master.cari(req.kodeUrl);
    if (!s || !s.aktif) {
      res.locals.sekolah = null;
      res.locals.settings = { nama_sekolah: 'Kurikulum Merdeka', logo: {} };
      res.locals.user = null;
      res.locals.h = helpers;
      return res.status(404).render('error', { title: 'Sekolah tidak ditemukan', message: `Kode sekolah "${req.kodeUrl}" tidak ditemukan atau sedang dinonaktifkan. Periksa alamat yang diberikan penyedia aplikasi.` });
    }
    res.locals.sekolah = s;
    res.locals.konteksLain = s.kode !== req.session.sekolah;
    return konteks.run({ db: master.dbSekolah(s), sekolah: s }, next);
  });
}
app.use('/', require('./src/routes/logo'));

app.use((req, res, next) => {
  const adaSekolah = !MULTI || res.locals.sekolah;
  res.locals.multi = MULTI;
  if (res.locals.sekolah === undefined) res.locals.sekolah = null;
  if (res.locals.kodeDiminta === undefined) res.locals.kodeDiminta = '';
  if (res.locals.dariSuper === undefined) res.locals.dariSuper = false;
  res.locals.settings = adaSekolah ? getSettings() : { nama_sekolah: 'Kurikulum Merdeka', logo: {} };
  res.locals.activePeriod = adaSekolah ? getActivePeriod() : null;
  // akun di sesi hanya berlaku pada database sekolah tempat ia masuk
  const akunBerlaku = adaSekolah && !(MULTI && (res.locals.konteksLain || res.locals.sekolah.kode !== req.session.sekolah));
  res.locals.user = req.session.userId && akunBerlaku
    ? db.prepare('SELECT id, username, nama, nip, role FROM users WHERE id = ?').get(req.session.userId)
    : null;
  if (req.session.userId && akunBerlaku && !res.locals.user) { delete req.session.userId; }
  res.locals.flash = req.session && req.session.flash;
  if (req.session) delete req.session.flash;
  // path relatif terhadap /app (mis. /kelas/1/nilai/3) untuk menandai menu yang sedang dibuka
  res.locals.path = req.path.replace(/^\/app(?=\/|$)/, '') || '/';
  res.locals.h = helpers;
  req.flash = (type, message) => { req.session.flash = { type, message }; };
  next();
});

// Permintaan dari halaman aplikasi ini sendiri (header Origin/Referer sama dengan host)
function dariSitusSendiri(req) {
  const asal = req.get('origin') || req.get('referer');
  if (!asal) return false;
  try { return new URL(asal).host === req.get('host'); } catch { return false; }
}

// CSRF token sederhana berbasis sesi
app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (req.method === 'POST') {
    const token = req.body && req.body._csrf;
    // token bisa berbeda bila halaman dibuka sebelum sesi diperbarui; asal yang sama tetap aman diterima
    if (token !== req.session.csrf && !dariSitusSendiri(req)) {
      return res.status(403).render('error', { title: 'Sesi kedaluwarsa', message: 'Formulir kedaluwarsa. Muat ulang halaman lalu coba lagi.' });
    }
  }
  next();
});

// Wajib aktivasi (versi offline yang dijual ke sekolah): semua halaman diarahkan ke /aktivasi
app.use((req, res, next) => {
  // Aplikasi guru (ZIP "Bagikan ke guru") membawa lisensi sekolahnya di dalam paket, jadi langsung ke halaman login.
  // Sengaja TIDAK ada pengecualian tanpa lisensi: berkas paket yang dibuat sendiri tidak boleh melewati aktivasi.
  if (!lisensi.wajib() || res.locals.settings.lisensi || req.path.startsWith('/aktivasi')) return next();
  return res.redirect('/aktivasi');
});
if (MULTI) {
  app.use('/super', require('./src/routes/super'));
  // tautan unduhan versi offline untuk satu sekolah (token rahasia dari panel superadmin)
  app.get('/unduh/offline/:token', (req, res) => {
    const l = master.m().prepare('SELECT * FROM lisensi_offline WHERE token = ?').get(req.params.token);
    if (!l) return res.status(404).render('error', { title: 'Tautan tidak berlaku', message: 'Tautan unduhan tidak ditemukan. Minta tautan baru kepada penyedia aplikasi.' });
    if (req.query.berkas === 'panduan' && require('fs').existsSync(master.PANDUAN_PDF)) return res.download(master.PANDUAN_PDF, 'Panduan-Admin-Sekolah.pdf');
    if (req.query.berkas === 'panduan-guru' && require('fs').existsSync(master.PANDUAN_GURU_PDF)) return res.download(master.PANDUAN_GURU_PDF, 'Panduan-Guru.pdf');
    if (req.query.berkas === 'zip' && require('fs').existsSync(master.ZIP_WINDOWS)) {
      // ZIP khusus sekolah ini: nama folder = sekolah + NPSN, Kode Aktivasi sudah di dalamnya
      try {
        const z = master.buatZipSekolah(l);
        master.m().prepare('UPDATE lisensi_offline SET unduhan = unduhan + 1 WHERE id = ?').run(l.id);
        return res.download(z.file, z.nama, () => require('fs').unlink(z.file, () => {}));
      } catch (e) { console.error(e); return res.status(500).render('error', { title: 'Gagal menyiapkan unduhan', message: 'Berkas aplikasi belum bisa disiapkan. Hubungi penyedia aplikasi.' }); }
    }
    const ada = (f) => require('fs').existsSync(f);
    res.render('unduh-offline', { title: 'Unduh E-Rapor SD (offline)', l, adaPanduan: ada(master.PANDUAN_PDF), adaSetup: false, adaZip: ada(master.ZIP_WINDOWS), namaZip: master.namaPaketSekolah(l) + '.zip' });
  });
}
app.use('/', require('./src/routes/aktivasi'));
app.use('/', require('./src/routes/public'));
app.use('/', require('./src/routes/auth'));
app.use('/app', require('./src/routes/app'));

app.use((req, res) => res.status(404).render('error', { title: 'Tidak ditemukan', message: 'Halaman yang Anda cari tidak ada.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Terjadi kesalahan', message: isProd ? 'Terjadi kesalahan pada server.' : err.message });
});

if (require.main === module) {
  // HOST=127.0.0.1 → hanya komputer ini; kosong/0.0.0.0 → bisa dibuka perangkat lain di jaringan yang sama
  const HOST = process.env.HOST || '0.0.0.0';
  const bukaBrowser = (url) => {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    require('child_process').exec(cmd, () => {});
  };
  const server = app.listen(PORT, HOST, () => {
    const lokal = `http://localhost:${PORT}`;
    console.log('');
    console.log('  E-Rapor SD sudah berjalan.');
    console.log(`  Buka di komputer ini : ${lokal}`);
    if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
      const os = require('os');
      for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list || []) {
          if (a.family === 'IPv4' && !a.internal) console.log(`  Buka dari HP/laptop lain di jaringan yang sama : http://${a.address}:${PORT}`);
        }
      }
    }
    console.log('  Jangan tutup jendela ini selama aplikasi dipakai.');
    console.log('');
    if (process.env.OPEN_BROWSER === '1') bukaBrowser(lokal);
  });
  server.on('error', (e) => {
    // ikon diklik lagi padahal aplikasi sudah menyala: cukup buka browsernya
    if (e.code === 'EADDRINUSE' && process.env.OPEN_BROWSER === '1') {
      console.log('  E-Rapor SD sudah menyala. Membuka browser ...');
      bukaBrowser(`http://localhost:${PORT}`);
      setTimeout(() => process.exit(0), 1500);
      return;
    }
    throw e;
  });
}

module.exports = app;
