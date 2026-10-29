; Pemasang E-Rapor SD untuk Windows (dibuat dengan NSIS: makensis -DSRC=<folder hasil build> -DOUT=<berkas .exe>)
; Pemasang ini ikut di dalam ZIP aplikasi dan MENYALIN isi folder ZIP yang sudah diekstrak (tidak membawa salinan sendiri),
; sehingga satu paket ZIP berisi: Pasang-E-Rapor-SD.exe (cara utama) dan Jalankan-Rapor.bat (cadangan bila pemasang gagal).
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

Function .onInit
  ; dijalankan langsung dari dalam ZIP (belum diekstrak): isi aplikasi tidak ada di sampingnya
  IfFileExists "$EXEDIR\node\node.exe" +3 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "File ZIP belum diekstrak.$\r$\n$\r$\nKlik kanan file ZIP > Extract All (Ekstrak Semua), lalu buka Pasang-E-Rapor-SD.exe dari folder hasil ekstrak."
    Abort
FunctionEnd

Section "E-Rapor SD"
  SetOutPath "$INSTDIR"
  ; dijalankan dari folder yang sudah terpasang (mis. memasang ulang ikon): tidak perlu menyalin
  StrCmp "$EXEDIR" "$INSTDIR" ikon
  ; ganti kode aplikasi lama sepenuhnya, data rapor tetap
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\node"
  DetailPrint "Menyalin aplikasi (± 1 menit) ..."
  ; robocopy (bawaan Windows) menyalin ribuan berkas dengan andal dan mencoba ulang bila ada yang terkunci antivirus;
  ; kode keluar 0-7 = berhasil, 8 atau lebih = ada yang gagal. (CopyFiles /SILENT bisa gagal diam-diam di tengah jalan.)
  nsExec::ExecToLog 'robocopy "$EXEDIR\app" "$INSTDIR\app" /E /R:3 /W:2 /NFL /NDL /NJH /NJS /NP'
  Pop $0
  IntCmp $0 8 salin_gagal salin_app_ok salin_gagal
  salin_app_ok:
  nsExec::ExecToLog 'robocopy "$EXEDIR\node" "$INSTDIR\node" /E /R:3 /W:2 /NFL /NDL /NJH /NJS /NP'
  Pop $0
  IntCmp $0 8 salin_gagal salin_node_ok salin_gagal
  salin_node_ok:
  CopyFiles /SILENT "$EXEDIR\*.bat" "$INSTDIR"
  CopyFiles /SILENT "$EXEDIR\*.pdf" "$INSTDIR"
  CopyFiles /SILENT "$EXEDIR\*.txt" "$INSTDIR"
  CopyFiles /SILENT "$EXEDIR\e-rapor.ico" "$INSTDIR"
  CopyFiles /SILENT "$EXEPATH" "$INSTDIR\Pasang-E-Rapor-SD.exe"
  ; pastikan berkas inti benar-benar ada; bila tidak, hentikan dengan pesan jelas (bukan ikon yang tidak bisa dibuka)
  IfFileExists "$INSTDIR\app\server.js" 0 salin_gagal
  IfFileExists "$INSTDIR\node\node.exe" 0 salin_gagal
  CreateDirectory "$INSTDIR\data"
  ; isi folder data dari ZIP ikut dipindah bila komputer ini belum punya data:
  ; paket dari admin sekolah (paket-awal.rapor.json) atau data yang sempat diisi lewat Jalankan-Rapor.bat
  IfFileExists "$INSTDIR\data\rapor.sqlite" data_lama 0
    CopyFiles /SILENT "$EXEDIR\data\*.*" "$INSTDIR\data"
    Goto ikon
  data_lama:
  ; sudah ada data rapor di komputer ini: database TIDAK ditimpa, tetapi paket akun & kode aktivasi terbaru tetap disalin,
  ; agar username/sandi yang diganti di server berlaku di sini (disamakan otomatis saat aplikasi dibuka)
  IfFileExists "$EXEDIR\data\paket-awal.rapor.json" 0 +2
    CopyFiles /SILENT "$EXEDIR\data\paket-awal.rapor.json" "$INSTDIR\data"
  IfFileExists "$EXEDIR\data\kode-aktivasi.txt" 0 +2
    CopyFiles /SILENT "$EXEDIR\data\kode-aktivasi.txt" "$INSTDIR\data"
  ikon:
  ; ZIP dari internet membawa tanda "Mark of the Web" yang ikut tersalin; Smart App Control / SmartScreen Windows 11
  ; memblokir berkas bertanda itu. Hapus tandanya dari folder aplikasi yang baru dipasang.
  DetailPrint "Menyiapkan izin berkas ..."
  nsExec::Exec `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '$INSTDIR' -Recurse -File | Unblock-File"`
  Pop $0
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
  Goto selesai
  salin_gagal:
  MessageBox MB_OK|MB_ICONSTOP "Pemasangan GAGAL: berkas aplikasi tidak tersalin lengkap ke:$\r$\n$INSTDIR$\r$\n$\r$\nCoba: (1) tutup antivirus sementara lalu pasang ulang, atau (2) cukup klik dua kali Jalankan-Rapor.bat di folder hasil ekstrak ZIP (tanpa memasang).$\r$\n$\r$\nBila tetap gagal, foto layar ini dan kirim ke operator."
  Abort
  selesai:
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
  Delete "$INSTDIR\Pasang-E-Rapor-SD.exe"
  Delete "$INSTDIR\Hapus-E-Rapor-SD.exe"
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Hapus juga SEMUA DATA RAPOR (nilai, siswa, akun)?$\r$\n$\r$\nPilih Tidak jika ingin memasang ulang nanti dengan data yang sama." IDNO +2
    RMDir /r "$INSTDIR\data"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\E-Rapor-SD"
  DeleteRegKey HKCU "Software\E-Rapor-SD"
SectionEnd
