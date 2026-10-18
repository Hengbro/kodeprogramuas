const express = require('express');
const { db } = require('../db');
const { verifyPassword } = require('../lib/password');
const { rateLimit } = require('../lib/rate-limit');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.get('/login', (req, res) => {
  if (res.locals.user) return res.redirect('/app');
  res.render('login', { title: 'Masuk', error: null, username: '' });
});

router.post('/login', loginLimiter, (req, res) => {
  const username = String(req.body.username || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(req.body.password || '', user.password_hash)) {
    return res.status(401).render('login', { title: 'Masuk', error: 'Nama pengguna atau kata sandi salah.', username });
  }
  const returnTo = req.session.returnTo;
  req.session.userId = user.id;
  delete req.session.returnTo;
  res.redirect(returnTo && returnTo.startsWith('/app') ? returnTo : '/app');
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

module.exports = router;
