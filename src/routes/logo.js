const express = require('express');
const { db } = require('../db');

const router = express.Router();

// Menyajikan logo yang disimpan di database (data URI) sebagai berkas gambar.
router.get('/logo/:jenis', (req, res) => {
  if (!['sekolah', 'pemda'].includes(req.params.jenis)) return res.status(404).end();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`logo_${req.params.jenis}`);
  const m = row && /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(row.value);
  if (!m) return res.status(404).end();
  res.setHeader('Content-Type', m[1]);
  res.setHeader('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.send(Buffer.from(m[2], 'base64'));
});

module.exports = router;
