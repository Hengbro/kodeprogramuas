const express = require('express');

const router = express.Router();

// Peta setiap sheet di file Excel "RAPOR SAH Kurikulum Merdeka" ke menu di sistem web.
const PETA = [
  ['Data Utama', [
    ['Menu', 'Halaman menu utama', 'Menu samping kiri & Dasbor', '/app'],
    ['profil sekolah', 'Identitas sekolah, kepala sekolah, guru kelas, semester, tahun pelajaran, tanggal rapor',
      'Profil Sekolah (identitas & kepala sekolah) · Tahun Pelajaran (semester & tanggal rapor) · Kelas (guru kelas)', '/app/sekolah'],
    ['IDENTITAS SISWA', 'Data rapor siswa & orang tua', 'Data Siswa (bisa impor dari Excel/CSV)', '/app/siswa'],
    ['KKM', 'Mata pelajaran, KKTP, bobot nilai, rentang predikat, pilihan deskripsi', 'Kelas › Mapel & KKTP · Pengaturan Nilai (bobot, predikat, deskripsi)', '/app/pengaturan'],
    ['contoh tp', 'Contoh cara menulis TP', 'Petunjuk di halaman Kelas › TP', '/app/kelas'],
  ]],
  ['Input Nilai', [
    ['INPUT LM TP', 'Lingkup materi & TP per mapel', 'Kelas › Ringkasan › tombol “TP” pada mapel', '/app/kelas'],
    ['LM TP AGAMA', 'Lingkup materi & TP mapel agama', 'Kelas › Ringkasan › tombol “TP” pada mapel agama', '/app/kelas'],
    ['Hindu, Islam, Kristen, Katolik, Budha, Konghucu', 'Nilai agama (formatif, sumatif, SAS)', 'Kelas › tombol “Nilai” pada mapel agama (otomatis hanya siswa seagama)', '/app/kelas'],
    ['PPKn, BI, Mat, IPAS, PJOK, B. Inggris', 'Nilai per mapel', 'Kelas › tombol “Nilai” pada mapel', '/app/kelas'],
    ['Seni Musik, Seni Tari, Seni Rupa, Seni Teater', 'Nilai seni pilihan', 'Kelas › Mapel & KKTP (aktifkan seni) › “Nilai”', '/app/kelas'],
    ['Mulok 1–5', 'Nilai muatan lokal', 'Mata Pelajaran › Tambah mulok › Kelas › “Nilai”', '/app/mapel'],
  ]],
  ['Catatan Siswa', [
    ['EKTRAKURIKULER', 'Ekskul wajib & pilihan (5 kolom)', 'Kelas › Ekstrakurikuler', '/app/kelas'],
    ['Saran', 'Catatan guru + ranking', 'Kelas › Catatan (ranking diatur di Pengaturan Nilai)', '/app/kelas'],
    ['ABSENSI', 'Sakit, izin, tanpa keterangan', 'Kelas › Ketidakhadiran', '/app/kelas'],
    ['NAIK-TIDAK', 'Keputusan naik kelas (semester 2)', 'Kelas › Kenaikan', '/app/kelas'],
    ['Progres', 'Ketuntasan pengisian aplikasi', 'Kelas › Progres', '/app/kelas'],
  ]],
  ['Rapor Semesteran & Rekap', [
    ['raport Epson a4', 'Sampul, identitas sekolah, identitas siswa, rapor nilai', 'Kelas › Cetak Rapor › Rapor akhir semester', '/app/kelas'],
    ['Rapor TTS', 'Rapor tengah semester', 'Kelas › Cetak Rapor › Rapor tengah semester', '/app/kelas'],
    ['LEGER UMUM', 'Rekap nilai, jumlah, rata-rata, ranking', 'Kelas › Leger (bisa unduh CSV & cetak)', '/app/kelas'],
    ['REKAP SEMUA, REKAP AGAMA, Rekap SENI', 'Nilai + deskripsi capaian semua mapel', 'Kelas › Rekap Deskripsi', '/app/kelas'],
    ['Grafik Capaian Siswa', 'Grafik nilai per mapel', 'Data Siswa › klik nama siswa', '/app/siswa'],
    ['Piagam', 'Piagam peringkat', 'Kelas › Cetak Rapor › Piagam peringkat 1–3', '/app/kelas'],
  ]],
  ['Rapor Projek (P5)', [
    ['DIMENSI', 'Daftar dimensi, elemen, sub-elemen, capaian fase A/B/C', 'Sudah tersimpan; dipilih di Projek P5 › Rancangan', '/app/kelas'],
    ['Skenario Projek', 'Nama projek, deskripsi, dimensi & sub-elemen', 'Kelas › Projek P5 › Rancangan', '/app/kelas'],
    ['PENILAIAN P.1, P.2, P.3', 'Penilaian umum per dimensi & fokus sub-elemen', 'Kelas › Projek P5 › Penilaian (bagian A & B)', '/app/kelas'],
    ['Cat. Proses pro 1–3', 'Catatan proses projek', 'Kelas › Projek P5 › Penilaian (kolom catatan proses)', '/app/kelas'],
    ['R.Projek 1–3, R. 2 Projek, R. 3 Projek', 'Rapor projek 1, 2, atau 3 projek', 'Kelas › Cetak Rapor › Rapor projek P5 (jumlah projek otomatis)', '/app/kelas'],
  ]],
  ['Buku Induk & Mutasi', [
    ['cover B Induk', 'Sampul & petunjuk Buku Induk', 'Kelas › Cetak Rapor › Buku Induk kelas (+ sampul)', '/app/kelas'],
    ['Indenitas Buku Induk', 'Data lengkap Buku Induk (A–H)', 'Data Siswa › Ubah › “Data Buku Induk”; tinggi/berat per semester di Ketidakhadiran', '/app/siswa'],
    ['Pindah Sekolah', 'Keterangan pindah keluar & masuk', 'Data Siswa › klik nama › Ket. Pindah Sekolah', '/app/siswa'],
  ]],
  ['Tidak diperlukan lagi', [
    ['Sheet1 (2)', 'Cara membuka blokir macro Excel', 'Tidak perlu: website tidak memakai macro', null],
    ['a, Sheet2', 'Kode aktivasi aplikasi', 'Tidak perlu: tanpa kode aktivasi', null],
  ]],
];

const ISTILAH = [
  ['Isi sel lalu pindah sheet', 'Isi form lalu tekan tombol Simpan (data langsung tersimpan di database)'],
  ['Satu file Excel per kelas', 'Satu website untuk semua kelas; guru hanya melihat kelasnya sendiri'],
  ['Simpan file sebagai arsip semester', 'Semua semester tersimpan otomatis; pilih periode di halaman Cetak Rapor'],
  ['Atur halaman & sembunyikan baris lalu Print', 'Tekan Cetak / Simpan PDF; baris kosong otomatis tidak dicetak'],
  ['Kirim file Excel ke operator', 'Operator/admin bisa langsung melihat semua kelas'],
  ['Rumus NA = (1×F + 2×S + 2×AS) / 5', 'Sama persis; bobot bisa diubah di Pengaturan Nilai'],
  ['Pilihan “Deskripsi dengan/tanpa nama panggilan”', 'Pengaturan Nilai › Format deskripsi rapor'],
  ['Pilihan kalimat awal deskripsi (Menunjukkan penguasaan dalam, Perlu bimbingan dalam, …)', 'Pengaturan Nilai › Kalimat capaian tertinggi/terendah (pilihan sama dengan Excel)'],
];

router.get('/panduan', (req, res) => res.render('app/panduan', { title: 'Panduan dari Excel', PETA, ISTILAH }));

module.exports = router;
