@echo off
title Pembuat Kode Aktivasi E-Rapor SD
set "KUNCI_DIR=%~dp0kunci-penjual"
:ulang
echo.
"%~dp0node\node.exe" "%~dp0alat\tools\buat-kode.js"
echo.
set /p lagi=Buat kode untuk sekolah lain? (y/n): 
if /i "%lagi%"=="y" goto ulang
