#!/usr/bin/env bash
# Membuat paket "Alat Penjual" (Windows) berisi pembuat kode aktivasi + KUNCI RAHASIA.
# Hasilnya hanya untuk penjual — jangan dibagikan.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSION="${NODE_VERSION:-22.22.0}"
OUT="${OUT:-$ROOT/dist}"
NAME="Alat-Penjual-E-Rapor"
STAGE="$OUT/$NAME"
CACHE="$OUT/.cache"
test -f "$ROOT/kunci-penjual/kunci-rahasia.pem" || { echo "Belum ada kunci. Jalankan: node tools/buat-kunci.js"; exit 1; }

rm -rf "$STAGE" "$OUT/$NAME.zip"
mkdir -p "$STAGE/node" "$STAGE/alat/tools" "$STAGE/alat/src/lib" "$STAGE/kunci-penjual" "$CACHE"
[ -f "$CACHE/node-$NODE_VERSION.exe" ] || curl -fsSL -o "$CACHE/node-$NODE_VERSION.exe" "https://nodejs.org/dist/v$NODE_VERSION/win-x64/node.exe"
cp "$CACHE/node-$NODE_VERSION.exe" "$STAGE/node/node.exe"
cp "$ROOT/tools/buat-kode.js" "$STAGE/alat/tools/"
cp "$ROOT/src/lib/lisensi.js" "$ROOT/src/lib/lisensi-publik.pem" "$STAGE/alat/src/lib/"
cp "$ROOT/kunci-penjual/kunci-rahasia.pem" "$STAGE/kunci-penjual/"
[ -f "$ROOT/kunci-penjual/daftar-lisensi.csv" ] && cp "$ROOT/kunci-penjual/daftar-lisensi.csv" "$STAGE/kunci-penjual/"
cp "$ROOT/windows/Buat-Kode-Aktivasi.bat" "$ROOT/windows/PENJUAL-BACA-SAYA.txt" "$STAGE/"
for f in "$STAGE"/*.bat "$STAGE"/*.txt; do sed -i 's/\r\{0,1\}$/\r/' "$f"; done
(cd "$OUT" && zip -qr "$NAME.zip" "$NAME")
echo "Selesai: $OUT/$NAME.zip (RAHASIA — berisi kunci penjual)"
