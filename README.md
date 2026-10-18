# E-Rapor SD Kurikulum Merdeka (Fase A, B, C)

Versi website dari file Excel **RAPOR SAH Kurikulum Merdeka Fase B dan C (Revisi 2023)**. Alur dan rumusnya sama dengan file Excel, tampilannya dirancang ulang, dan semua data disimpan di **SQLite** (satu file database).

## Fitur (dipetakan dari sheet Excel)

| Sheet Excel | Di website |
|---|---|
| Profil Sekolah | Menu **Profil Sekolah** (admin) |
| IDENTITAS SISWA | **Data Siswa**: tambah, ubah, impor CSV/Excel |
| KKM / KKTP, bobot nilai, predikat | **Mapel & KKTP** per kelas + **Pengaturan Nilai** |
| INPUT LM TP, LM TP AGAMA | Editor **TP & Lingkup Materi** per mapel (ada contoh TP kelas IV) |
| Agama…Mulok 5 (rekap nilai) | **Input nilai** model spreadsheet: formatif per TP, sumatif lingkup materi, SAS non-tes/tes, NA & deskripsi dihitung otomatis |
| EKSTRAKURIKULER, Saran, ABSENSI, NAIK-TIDAK | Tab **Ekstrakurikuler**, **Catatan**, **Ketidakhadiran**, **Kenaikan** |
| LEGER UMUM / REKAP | **Leger**: jumlah, rata-rata, peringkat, ekspor CSV, cetak |
| raport Epson A4 | **Cetak rapor**: sampul, identitas sekolah, identitas siswa, laporan hasil belajar |
| Rapor TTS | **Rapor tengah semester** (dengan kolom KKTP) |
| Grafik Capaian Siswa | Grafik batang di halaman detail siswa |
| Piagam | **Piagam penghargaan** peringkat 1–3 |
| DIMENSI, Skenario Projek, PENILAIAN P.1–3, Cat. Proses, R.Projek | **Projek P5**: rancangan (dimensi/elemen/sub-elemen fase A–C), penilaian BB/MB/BSH/SB, catatan proses, rapor projek |

### Perbaikan dibanding versi Excel
- **Multi-kelas & multi-guru**: admin mengelola semua kelas, guru hanya bisa membuka kelas yang ia ampu.
- **Arsip per tahun pelajaran & semester**: nilai semester sebelumnya tetap tersimpan dan bisa dicetak ulang.
- **Portal orang tua**: orang tua melihat rapor dengan NISN/NIS + tanggal lahir, setelah sekolah menekan **Publikasikan**.
- Jumlah TP, lingkup materi, dan siswa tidak dibatasi.
- Deskripsi capaian bisa ditulis manual per siswa jika perlu.
- Bisa tempel nilai langsung dari Excel ke lembar nilai.
- Cadangan database bisa diunduh dengan satu klik (menu admin).

## Rumus nilai (sama dengan Excel)
- NA Formatif (F) = rata-rata nilai formatif semua TP
- NA Sumatif (S) = rata-rata sumatif lingkup materi
- NA Sumatif Akhir Semester (AS) = rata-rata SAS non-tes dan tes
- **NA Rapor = (1·F + 2·S + 2·AS) / 5**, dibulatkan. Komponen yang kosong tidak ikut dihitung (contoh: tanpa S → (F + 2·AS)/3). Bobot bisa diubah.
- Deskripsi = TP dengan nilai formatif **tertinggi** dan **terendah**, diawali kalimat predikat (88–100 sangat baik, 74–87 baik, 60–73 cukup, < 60 perlu bimbingan) dan nama panggilan siswa.

## Menjalankan secara lokal
Kebutuhan: Node.js 18.18 atau lebih baru.

```bash
npm install
npm run seed:demo   # opsional: data contoh (siswa fiktif)
npm start           # http://localhost:3000
```

Akun awal: `admin` / `admin123` (atau isi `ADMIN_PASSWORD` sebelum menjalankan pertama kali). **Segera ganti kata sandi** di menu Akun.
Data demo juga membuat akun guru `guru4a` / `guru123`.

Database tersimpan di `data/rapor.sqlite` (ubah dengan `DATA_DIR` atau `DB_PATH`).

## Supaya bisa diakses publik

### Opsi 1 — VPS dengan Docker (disarankan)
```bash
git clone <repo> e-rapor && cd e-rapor
ADMIN_PASSWORD='sandi-kuat' docker compose up -d --build
```
Aplikasi berjalan di port 3000, database tersimpan di volume `rapor-data`. Pasang domain dan HTTPS dengan reverse proxy (Caddy/Nginx), lalu set `COOKIE_SECURE=1`. Contoh Caddyfile:
```
rapor.sekolahku.sch.id {
  reverse_proxy localhost:3000
}
```

### Opsi 2 — Railway / Render / Fly.io
1. Hubungkan repository ini. Platform akan mendeteksi `Dockerfile`.
2. Tambahkan **persistent volume/disk** dan mount ke `/data`. Tanpa ini, data hilang setiap kali deploy ulang.
3. Isi environment: `ADMIN_PASSWORD`, `SESSION_SECRET` (string acak panjang), `NODE_ENV=production`.

### Opsi 3 — Komputer sekolah + tunnel
Jalankan `npm start` di komputer sekolah, lalu publikasikan dengan `cloudflared tunnel --url http://localhost:3000` atau ngrok.

## Variabel lingkungan
Lihat `.env.example`: `PORT`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `DATA_DIR`, `DB_PATH`, `COOKIE_SECURE`, `TRUST_PROXY`.

## Struktur
```
server.js              aplikasi Express
src/schema.sql         skema SQLite
src/db.js              koneksi + data awal (mapel, dimensi P5, admin)
src/lib/calc.js        rumus nilai & deskripsi
src/lib/rapor.js       penyusun data leger & rapor
src/routes/            halaman publik, login, aplikasi
views/                 template EJS (app/ dan print/ untuk cetak A4)
db/seed/               referensi P5 & contoh TP kelas IV (diambil dari file Excel)
test/                  tes otomatis (npm test)
```

## Cadangan & pemulihan
- Unduh: menu **Unduh Cadangan DB** (admin).
- Pulihkan: hentikan aplikasi, ganti file `data/rapor.sqlite` dengan file cadangan, lalu jalankan lagi.
