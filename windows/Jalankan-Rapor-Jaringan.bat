@echo off
title E-Rapor SD (jaringan)
cd /d "%~dp0app"
set "DATA_DIR=%~dp0data"
set "PORT=3210"
set "NODE_ENV=production"
set "COOKIE_SECURE=0"
set "OPEN_BROWSER=1"
set "HOST=0.0.0.0"
echo.
echo   Menyalakan E-Rapor SD untuk jaringan WiFi/LAN ...
echo   Jika Windows Firewall bertanya, pilih "Izinkan" untuk jaringan pribadi.
"%~dp0node\node.exe" server.js
echo.
pause
