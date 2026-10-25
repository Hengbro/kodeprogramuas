@echo off
rem E-Rapor SD mode BANYAK SEKOLAH (untuk penyedia). Klik dua kali file ini untuk menjalankan.
rem Prasyarat: Node.js 22 terpasang, dan "npm install" sudah dijalankan satu kali di folder ini.
title E-Rapor SD - Server Banyak Sekolah
cd /d "%~dp0"
set MULTI_SEKOLAH=1
set PORT=3000
if not exist node_modules (
  echo Menyiapkan pertama kali, mohon tunggu...
  call npm install
)
echo.
echo E-Rapor SD berjalan di http://localhost:3000
echo JANGAN tutup jendela ini selama dipakai.
echo.
start "" http://localhost:3000/super/login
node server.js
pause
