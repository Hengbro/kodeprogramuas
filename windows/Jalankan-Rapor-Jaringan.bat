@echo off
title E-Rapor SD (jaringan)
if not exist "%~dp0node\node.exe" (
  echo.
  echo   File ZIP belum diekstrak.
  echo   Klik kanan file ZIP ^> "Extract All..." ^(Ekstrak Semua^), lalu jalankan file ini dari folder hasil ekstrak.
  echo   Lebih mudah: pakai pemasang "Pasang-E-Rapor-SD.exe".
  echo.
  pause
  exit /b
)
cd /d "%~dp0app"
set "DATA_DIR=%~dp0data"
set "PORT=3210"
set "NODE_ENV=production"
set "COOKIE_SECURE=0"
set "OPEN_BROWSER=1"
set "LISENSI_WAJIB=1"
set "HOST=0.0.0.0"
echo.
echo   Menyalakan E-Rapor SD untuk jaringan WiFi/LAN ...
echo   Jika Windows Firewall bertanya, pilih "Izinkan" untuk jaringan pribadi.
"%~dp0node\node.exe" server.js
if "%ERRORLEVEL%"=="0" exit /b
echo.
pause
