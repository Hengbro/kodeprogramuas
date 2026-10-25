#!/bin/bash
# E-Rapor SD mode BANYAK SEKOLAH untuk Mac/Linux. Klik dua kali (Mac) atau jalankan: bash Jalankan-Server-Mac.command
# Prasyarat: Node.js 22 terpasang. Folder "data" dan "kunci-penjual" dari cadangan sudah disalin ke folder ini.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then echo "Node.js belum terpasang. Pasang dari nodejs.org (versi 22 LTS), lalu jalankan ulang."; read -r -p "Tekan Enter..."; exit 1; fi
if [ ! -d data ] || [ ! -d kunci-penjual ]; then echo "Folder 'data' dan/atau 'kunci-penjual' belum ada di sini. Salin dari E-Rapor-Data.zip dulu."; read -r -p "Tekan Enter..."; exit 1; fi
[ -d node_modules ] || { echo "Menyiapkan pertama kali (butuh internet)..."; npm install || { read -r -p "npm install gagal. Tekan Enter..."; exit 1; }; }
export MULTI_SEKOLAH=1 PORT=3000
echo; echo "E-Rapor SD berjalan di http://localhost:3000  (jangan tutup jendela ini; Ctrl+C untuk berhenti)"; echo
(sleep 3; open "http://localhost:3000/super/login" 2>/dev/null) &
exec caffeinate -i node server.js
