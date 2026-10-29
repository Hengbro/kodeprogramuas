#!/usr/bin/env bash
# Membuat paket siap pakai Windows (x64) tanpa instalasi:
#   E-Rapor-SD-Windows/
#     Jalankan-Rapor.bat, Jalankan-Rapor-Jaringan.bat, BACA-SAYA.txt
#     node/node.exe        (Node.js portabel)
#     app/                 (kode aplikasi + node_modules dengan modul SQLite versi Windows)
#     data/                (database dibuat otomatis saat pertama jalan)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSION="${NODE_VERSION:-22.22.0}"
NODE_ABI="${NODE_ABI:-127}"           # ABI Node 22
OUT="${OUT:-$ROOT/dist}"
NAME="E-Rapor-SD-Windows"
STAGE="$OUT/$NAME"
CACHE="$OUT/.cache"

rm -rf "$STAGE" "$OUT/$NAME.zip"
mkdir -p "$STAGE/node" "$STAGE/app" "$STAGE/data" "$CACHE"

echo "1/5 Node.js $NODE_VERSION untuk Windows"
[ -f "$CACHE/node-$NODE_VERSION.exe" ] || curl -fsSL -o "$CACHE/node-$NODE_VERSION.exe" "https://nodejs.org/dist/v$NODE_VERSION/win-x64/node.exe"
cp "$CACHE/node-$NODE_VERSION.exe" "$STAGE/node/node.exe"

echo "2/5 Kode aplikasi"
cp -r "$ROOT/server.js" "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/src" "$ROOT/views" "$ROOT/public" "$STAGE/app/"
mkdir -p "$STAGE/app/db" && cp -r "$ROOT/db/seed" "$STAGE/app/db/"

echo "3/5 Dependensi produksi"
(cd "$STAGE/app" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)

echo "4/5 Modul SQLite (better-sqlite3) versi Windows"
BSV="$(node -p "require('$STAGE/app/node_modules/better-sqlite3/package.json').version")"
TGZ="better-sqlite3-v$BSV-node-v$NODE_ABI-win32-x64.tar.gz"
[ -f "$CACHE/$TGZ" ] || curl -fsSL -o "$CACHE/$TGZ" "https://github.com/WiseLibs/better-sqlite3/releases/download/v$BSV/$TGZ"
rm -rf "$STAGE/app/node_modules/better-sqlite3/build"
tar -xzf "$CACHE/$TGZ" -C "$STAGE/app/node_modules/better-sqlite3"
test -f "$STAGE/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
rm -rf "$STAGE/app/node_modules/better-sqlite3/deps" "$STAGE/app/node_modules/better-sqlite3/src"

echo "5/5 Berkas peluncur, ZIP & pemasang"
cp "$ROOT/windows/"Jalankan-*.bat "$ROOT/windows/BACA-SAYA.txt" "$ROOT/windows/e-rapor.ico" "$STAGE/"
cp "$ROOT/docs/Panduan-Admin-Sekolah.pdf" "$ROOT/docs/Panduan-Guru.pdf" "$STAGE/"
# baris CRLF agar Notepad & cmd.exe membaca dengan benar
for f in "$STAGE"/*.bat "$STAGE"/BACA-SAYA.txt; do awk '{ sub(/\r$/, ""); printf "%s\r\n", $0 }' "$f" > "$f.tmp" && mv "$f.tmp" "$f"; done

# Pemasang kecil (NSIS) di dalam paket: menyalin isi folder ini ke komputer + ikon desktop.
# Bila pemasang gagal, Jalankan-Rapor.bat di folder yang sama tetap bisa dipakai.
rm -f "$OUT/Pasang-E-Rapor-SD.exe" "$OUT/E-Rapor-SD-Pemasang.zip"; rm -rf "$OUT/E-Rapor-SD-Pemasang"
if command -v makensis >/dev/null; then
  VERSI="$(node -p "require('$ROOT/package.json').version")"
  makensis -V2 -DSRC="$STAGE" -DOUT="$STAGE/Pasang-E-Rapor-SD.exe" -DVERSI="$VERSI" "$ROOT/windows/pemasang.nsi"
  cp "$STAGE/Pasang-E-Rapor-SD.exe" "$CACHE/Pasang-E-Rapor-SD.exe"   # disimpan agar bisa dipakai di komputer tanpa NSIS
elif [ -f "$CACHE/Pasang-E-Rapor-SD.exe" ]; then
  # Pemasang tidak berisi kode aplikasi (hanya menyalin isi folder), jadi salinan lama tetap dipakai.
  cp "$CACHE/Pasang-E-Rapor-SD.exe" "$STAGE/Pasang-E-Rapor-SD.exe"
  echo "makensis tidak ada: memakai Pasang-E-Rapor-SD.exe yang tersimpan di $CACHE"
elif [ -n "${PEMASANG_EXE:-}" ] && [ -f "$PEMASANG_EXE" ]; then
  cp "$PEMASANG_EXE" "$STAGE/Pasang-E-Rapor-SD.exe"
else
  echo "PERINGATAN: makensis (NSIS) tidak ada, paket dibuat tanpa Pasang-E-Rapor-SD.exe."
  echo "  Letakkan Pasang-E-Rapor-SD.exe di $CACHE (atau set PEMASANG_EXE=/jalur/Pasang-E-Rapor-SD.exe), lalu jalankan ulang."
fi
(cd "$OUT" && rm -f "$NAME.zip" && zip -qr "$NAME.zip" "$NAME")
echo "Selesai: $OUT/$NAME.zip ($(du -h "$OUT/$NAME.zip" | cut -f1))"
