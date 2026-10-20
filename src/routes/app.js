const express = require('express');
const { requireLogin } = require('../lib/auth');

const router = express.Router();
router.use(requireLogin);

router.use('/', require('./app/dashboard'));
router.use('/', require('./app/sekolah'));
router.use('/', require('./app/users'));
router.use('/', require('./app/siswa'));
router.use('/kelas', require('./app/kelas'));
router.use('/kelas', require('./app/nilai'));
router.use('/kelas', require('./app/data-rapor'));
router.use('/kelas', require('./app/projek'));
router.use('/kelas', require('./app/progres'));
router.use('/', require('./app/cetak'));
router.use('/', require('./app/panduan'));
router.use('/', require('./app/paket'));

module.exports = router;
