@echo off
title E-Rapor SD
cd /d "%~dp0app"
set "DATA_DIR=%~dp0data"
set "PORT=3210"
set "NODE_ENV=production"
set "COOKIE_SECURE=0"
set "OPEN_BROWSER=1"
rem HOST=127.0.0.1 : hanya bisa dibuka dari komputer ini.
rem Ganti menjadi 0.0.0.0 jika ingin dibuka dari HP/laptop lain lewat WiFi yang sama.
set "HOST=127.0.0.1"
echo.
echo   Menyalakan E-Rapor SD ...
"%~dp0node\node.exe" server.js
echo.
echo   E-Rapor berhenti. Jika muncul pesan error di atas, foto layar ini dan kirim ke operator.
pause
