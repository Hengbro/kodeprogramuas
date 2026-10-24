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
| DIMENSI, Skenario Projek, PENILAIAN P.1–3, Cat. Proses, R.Projek | **Projek P5**: rancangan (dimensi/elemen/sub-elemen fase A–C), penilaian umum per dimensi + fokus sub-elemen (BB/MB/BSH/SB), catatan proses, rapor projek (dengan sampul) |
| REKAP SEMUA, REKAP AGAMA, Rekap SENI | **Rekap Deskripsi**: nilai + deskripsi capaian tertinggi/terendah semua mapel, ekspor CSV |
| Progres | **Progres**: persentase ketuntasan pengisian (TUNTAS / DALAM PROSES) |
| cover B Induk, Indenitas Buku Induk | **Buku Induk**: sampul, identitas A–H, keadaan jasmani per semester, rapor tiap semester |
| Pindah Sekolah | **Keterangan Pindah Sekolah** (keluar & masuk) |
| contoh tp | Petunjuk penulisan TP di halaman TP |

Di dalam aplikasi ada menu **Panduan dari Excel** yang memetakan setiap sheet Excel ke menu web, agar guru mudah beradaptasi.

### Kesesuaian dengan Excel (diuji otomatis)
`test/excel-parity.test.js` menghitung ulang 236 baris nilai asli dari file Excel dengan mesin hitung website: nilai akhir (NA), TP tertinggi, dan TP terendah semuanya sama persis.

### Perbaikan dibanding versi Excel
- **Multi-kelas & multi-guru**: admin mengelola semua kelas, guru hanya bisa membuka kelas yang ia ampu.
- **Arsip per tahun pelajaran & semester**: nilai semester sebelumnya tetap tersimpan dan bisa dicetak ulang.
- **Portal orang tua**: orang tua melihat rapor dengan NISN/NIS + tanggal lahir, setelah sekolah menekan **Publikasikan**.
- Jumlah TP, lingkup materi, dan siswa tidak dibatasi.
- Deskripsi capaian bisa ditulis manual per siswa jika perlu.
- Bisa tempel (paste) blok data langsung dari Excel ke semua lembar isian.
- **Input massal**: banyak siswa sekaligus (Data Siswa → Input banyak siswa), nilai SAS semua mapel dalam satu lembar,
  serta tambah banyak kelas dan banyak akun guru sekaligus. Lembar nilai per mapel, ketidakhadiran, ekskul, catatan,
  kenaikan, dan penilaian P5 juga sudah berbentuk satu lembar untuk seluruh siswa.
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

## Versi offline Windows (tiap komputer punya database sendiri)

Untuk sekolah tanpa internet atau yang ingin tiap guru bekerja di komputernya sendiri:

```bash
./scripts/build-windows.sh      # menghasilkan dist/E-Rapor-SD-Windows.zip
```

ZIP berisi Node.js portabel, aplikasi, dan modul SQLite versi Windows — tidak perlu instal apa pun.
Guru cukup ekstrak lalu klik **Jalankan-Rapor.bat**; browser terbuka di `http://localhost:3210`
(login bawaan `admin` / `admin123`, aplikasi mengingatkan untuk mengganti kata sandi).
Data tersimpan di folder `data/` di samping file .bat.

### Penjualan ke sekolah: kode aktivasi per sekolah
Versi Windows wajib aktivasi (`LISENSI_WAJIB=1` di file .bat). Saat pertama dibuka, sekolah memasukkan
**Kode Aktivasi** lalu membuat akun admin sendiri (akun bawaan `admin` diganti). Kode ditandatangani digital
(Ed25519) dan memuat NPSN + nama sekolah; nama sekolah & NPSN di rapor terkunci sesuai kode, sehingga kode
tidak berguna bagi sekolah lain. Lisensi berlaku seumur hidup.

- `node tools/buat-kunci.js` — membuat kunci penjual (sekali). Kunci rahasia di `kunci-penjual/` (tidak di-commit),
  kunci publik di `src/lib/lisensi-publik.pem` (ikut aplikasi).
- `node tools/buat-kode.js --npsn 12345678 --sekolah "SD NEGERI ..."` — membuat kode untuk satu sekolah,
  dicatat di `kunci-penjual/daftar-lisensi.csv`.
- `./scripts/build-penjual.sh` — paket Windows "Alat Penjual" (Buat-Kode-Aktivasi.bat). RAHASIA.
- Versi web/online tidak mewajibkan aktivasi kecuali `LISENSI_WAJIB=1` diset.

Pertukaran data antar komputer memakai menu **Paket Data (ekspor/impor)**:
- **Paket awal** (operator → guru): profil sekolah, pengaturan nilai, mapel, periode, kelas, KKTP, TP & lingkup materi, rancangan projek — tanpa siswa dan nilai.
- **Data kelas lengkap** (guru → operator): ditambah siswa, nilai, ekskul, absensi, catatan, kenaikan, penilaian P5.
- Pencocokan memakai nama kelas, NISN siswa, kode mapel, dan tahun pelajaran + semester, sehingga impor ulang tidak menggandakan data.
  Diuji di `test/paket.test.js`: rapor di komputer tujuan identik dengan komputer asal.

**Bagikan aplikasi ke guru:** dari menu Paket Data, admin mengunduh ZIP aplikasi khusus untuk satu guru
(atau semua guru). ZIP berisi aplikasi + `data/paket-awal.rapor.json` (lisensi, pengaturan & logo sekolah,
kelas/siswa/TP guru itu, dan akun guru). Saat pertama dijalankan, paket dipasang otomatis
(`src/lib/paket-otomatis.js`): tanpa aktivasi, akun bawaan admin dihapus, guru login dengan akun dari admin,
dan menu pengaturan sekolah tidak tersedia. Guru mengirim hasil lewat menu "Kirim Data ke Admin".

**Hak akses guru** (diuji di `test/hak-akses.test.js`): guru tidak bisa membuka/mengubah profil sekolah, logo,
pengaturan nilai, periode, mata pelajaran, akun pengguna, kelas, maupun impor paket (semua 403). Guru hanya
bisa menambah, mengubah, dan menghapus siswa serta nilai di kelas yang ia ampu.

`Jalankan-Rapor-Jaringan.bat` membuka akses dari HP/laptop lain di WiFi yang sama.

## Satu web untuk banyak sekolah (superadmin)

Untuk penyedia yang melayani banyak sekolah dari satu alamat web, jalankan dengan `MULTI_SEKOLAH=1`:

- **Superadmin** (penyedia) masuk di `/super/login`. Akun dibuat otomatis saat pertama jalan
  (sandi dari `SUPERADMIN_PASSWORD`, atau acak dan dicatat di `data/superadmin-awal.txt`).
- Panel superadmin: tambah sekolah (langsung dapat database & akun admin sekolah), ubah nama/NPSN,
  aktifkan/nonaktifkan, tambah admin, reset kata sandi, buka sekolah sebagai admin, unduh cadangan,
  hapus sekolah (berkas dipindah ke `data/terhapus/`).
- Setiap sekolah punya file database sendiri (`data/sekolah/<kode>.sqlite`); daftar sekolah di `data/master.sqlite`.
  Data, akun, logo, dan pengaturan antar-sekolah tidak tercampur.
- Setiap sekolah beralamat `/sekolah/<kode>/`: masuk di `/sekolah/<kode>/login`, menu aplikasi di `/sekolah/<kode>/app/...`.
  Alamat tanpa kode sekolah diarahkan ke halaman pilih sekolah / kode sekolah.
  Portal orang tua: `/sekolah/<kode>/` (atau pilih sekolah di halaman depan).
- Admin sekolah (kepala sekolah/operator) tidak bisa mengubah nama sekolah & NPSN; itu diatur superadmin.
- Database satu sekolah yang sudah ada (`data/rapor.sqlite`) otomatis menjadi sekolah pertama.
- Diuji di `test/multi-sekolah.test.js`. Tanpa `MULTI_SEKOLAH=1` (mis. versi Windows) aplikasi tetap satu sekolah.

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
Lihat `.env.example`: `PORT`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `DATA_DIR`, `DB_PATH`, `COOKIE_SECURE`, `TRUST_PROXY`,
serta `MULTI_SEKOLAH`, `SUPERADMIN_USER`, `SUPERADMIN_PASSWORD` untuk mode banyak sekolah.

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
