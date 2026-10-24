@echo off
title E-Rapor SD
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
rem HOST=127.0.0.1 : hanya bisa dibuka dari komputer ini.
rem Ganti menjadi 0.0.0.0 jika ingin dibuka dari HP/laptop lain lewat WiFi yang sama.
set "HOST=127.0.0.1"
echo.
echo   Menyalakan E-Rapor SD ...
"%~dp0node\node.exe" server.js
if "%ERRORLEVEL%"=="0" exit /b
echo.
echo   E-Rapor berhenti. Jika muncul pesan error di atas, foto layar ini dan kirim ke operator.
pause
