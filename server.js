const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const { db } = require('./src/db');
const { getSettings, getActivePeriod } = require('./src/lib/rapor');
const helpers = require('./src/lib/view-helpers');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

let secret = process.env.SESSION_SECRET;
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
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));
app.use(express.urlencoded({ extended: true, limit: '50mb', parameterLimit: 50000 }));
app.use(cookieSession({
  name: 'rapor_sess',
  secret,
  httpOnly: true,
  sameSite: 'lax',
  secure: isProd && process.env.COOKIE_SECURE !== '0',
  maxAge: 12 * 60 * 60 * 1000,
}));

app.use((req, res, next) => {
  res.locals.settings = getSettings();
  res.locals.activePeriod = getActivePeriod();
  res.locals.user = req.session.userId
    ? db.prepare('SELECT id, username, nama, nip, role FROM users WHERE id = ?').get(req.session.userId)
    : null;
  if (req.session.userId && !res.locals.user) req.session = null;
  res.locals.flash = req.session && req.session.flash;
  if (req.session) delete req.session.flash;
  res.locals.path = req.path;
  res.locals.h = helpers;
  req.flash = (type, message) => { req.session.flash = { type, message }; };
  next();
});

// CSRF token sederhana berbasis sesi
app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (req.method === 'POST') {
    const token = req.body && req.body._csrf;
    if (token !== req.session.csrf) {
      return res.status(403).render('error', { title: 'Sesi kedaluwarsa', message: 'Formulir kedaluwarsa. Muat ulang halaman lalu coba lagi.' });
    }
  }
  next();
});

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
  app.listen(PORT, HOST, () => {
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
    if (process.env.OPEN_BROWSER === '1') {
      const cmd = process.platform === 'win32' ? `start "" "${lokal}"` : process.platform === 'darwin' ? `open "${lokal}"` : `xdg-open "${lokal}"`;
      require('child_process').exec(cmd, () => {});
    }
  });
}

module.exports = app;
