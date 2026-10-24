; Pemasang E-Rapor SD untuk Windows (dibuat dengan NSIS: makensis -DSRC=<folder hasil build> -DOUT=<berkas .exe>)
; - Dipasang per pengguna (tidak perlu hak administrator) di %LOCALAPPDATA%\E-Rapor-SD
; - Ikon "E-Rapor SD" di desktop dan Start Menu
; - Memasang ulang/memperbarui TIDAK menghapus data rapor (folder data)
Unicode true
!include "MUI2.nsh"

!ifndef SRC
  !error "Tentukan -DSRC=folder hasil scripts/build-windows.sh"
!endif
!ifndef OUT
  !define OUT "Pasang-E-Rapor-SD.exe"
!endif
!ifndef VERSI
  !define VERSI "1.0"
!endif

Name "E-Rapor SD"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\E-Rapor-SD"
InstallDirRegKey HKCU "Software\E-Rapor-SD" "Folder"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "E-Rapor SD Kurikulum Merdeka"
VIProductVersion "${VERSI}.0"
VIAddVersionKey "ProductName" "E-Rapor SD"
VIAddVersionKey "FileDescription" "Pemasang E-Rapor SD Kurikulum Merdeka"
VIAddVersionKey "FileVersion" "${VERSI}"
VIAddVersionKey "LegalCopyright" "E-Rapor SD"

!define MUI_ICON "${SRC}\e-rapor.ico"
!define MUI_UNICON "${SRC}\e-rapor.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Pasang E-Rapor SD"
!define MUI_WELCOMEPAGE_TEXT "Aplikasi rapor Kurikulum Merdeka untuk SD.$\r$\n$\r$\nTidak perlu internet. Setelah terpasang, ikon E-Rapor SD muncul di desktop.$\r$\n$\r$\nKlik Lanjut untuk memulai."
!define MUI_FINISHPAGE_TITLE "E-Rapor SD sudah terpasang"
!define MUI_FINISHPAGE_TEXT "Mulai sekarang cukup klik dua kali ikon E-Rapor SD di desktop.$\r$\n$\r$\nSaat pertama dibuka, masukkan Kode Aktivasi sekolah lalu buat akun admin."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Buka E-Rapor SD sekarang"
!define MUI_FINISHPAGE_RUN_FUNCTION BukaAplikasi

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Indonesian"

Function BukaAplikasi
  ExecShell "open" "$DESKTOP\E-Rapor SD.lnk"
FunctionEnd

Section "E-Rapor SD"
  SetOutPath "$INSTDIR"
  ; ganti kode aplikasi lama sepenuhnya, data rapor tetap
  RMDir /r "$INSTDIR\app"
  File /r /x "data" "${SRC}\*"
  CreateDirectory "$INSTDIR\data"
  ; paket dari admin sekolah (untuk guru), diletakkan di folder yang sama dengan pemasang, ikut dipasang
  ; (nama file dari menu admin: paket-awal-<username>.rapor.json)
  FindFirst $0 $1 "$EXEDIR\paket-awal*.rapor.json"
  StrCmp $1 "" +3
    CopyFiles /SILENT "$EXEDIR\$1" "$INSTDIR\data\paket-awal.rapor.json"
    DetailPrint "Paket dari admin sekolah dipasang: $1"
  FindClose $0

  CreateShortcut "$DESKTOP\E-Rapor SD.lnk" "$INSTDIR\Jalankan-Rapor.bat" "" "$INSTDIR\e-rapor.ico" 0 SW_SHOWMINIMIZED
  CreateDirectory "$SMPROGRAMS\E-Rapor SD"
  CreateShortcut "$SMPROGRAMS\E-Rapor SD\E-Rapor SD.lnk" "$INSTDIR\Jalankan-Rapor.bat" "" "$INSTDIR\e-rapor.ico" 0 SW_SHOWMINIMIZED
  CreateShortcut "$SMPROGRAMS\E-Rapor SD\E-Rapor SD (bisa dibuka dari HP).lnk" "$INSTDIR\Jalankan-Rapor-Jaringan.bat" "" "$INSTDIR\e-rapor.ico" 0
  IfFileExists "$INSTDIR\Panduan-Admin-Sekolah.pdf" 0 +2
    CreateShortcut "$SMPROGRAMS\E-Rapor SD\Panduan Admin Sekolah.lnk" "$INSTDIR\Panduan-Admin-Sekolah.pdf"
  IfFileExists "$INSTDIR\Panduan-Guru.pdf" 0 +2
    CreateShortcut "$SMPROGRAMS\E-Rapor SD\Panduan Guru.lnk" "$INSTDIR\Panduan-Guru.pdf"
  CreateShortcut "$SMPROGRAMS\E-Rapor SD\Folder data (cadangan).lnk" "$INSTDIR\data"
  CreateShortcut "$SMPROGRAMS\E-Rapor SD\Hapus E-Rapor SD.lnk" "$INSTDIR\Hapus-E-Rapor-SD.exe"

  WriteUninstaller "$INSTDIR\Hapus-E-Rapor-SD.exe"
  WriteRegStr HKCU "Software\E-Rapor-SD" "Folder" "$INSTDIR"
  !define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\E-Rapor-SD"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "E-Rapor SD"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\e-rapor.ico"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSI}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "E-Rapor SD"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\Hapus-E-Rapor-SD.exe"'
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\E-Rapor SD.lnk"
  RMDir /r "$SMPROGRAMS\E-Rapor SD"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\node"
  Delete "$INSTDIR\*.bat"
  Delete "$INSTDIR\*.txt"
  Delete "$INSTDIR\*.pdf"
  Delete "$INSTDIR\e-rapor.ico"
  Delete "$INSTDIR\Hapus-E-Rapor-SD.exe"
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Hapus juga SEMUA DATA RAPOR (nilai, siswa, akun)?$\r$\n$\r$\nPilih Tidak jika ingin memasang ulang nanti dengan data yang sama." IDNO +2
    RMDir /r "$INSTDIR\data"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\E-Rapor-SD"
  DeleteRegKey HKCU "Software\E-Rapor-SD"
SectionEnd
