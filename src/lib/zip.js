// Penulis ZIP sederhana (deflate) tanpa dependensi, untuk membuat paket aplikasi guru.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** Semua berkas di dalam folder (rekursif), sebagai [pathRelatif, pathAbsolut]. */
function listFiles(dir, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(abs, rel));
    else if (e.isFile()) out.push([rel, abs]);
  }
  return out;
}

/**
 * Menulis ZIP ke berkas.
 * @param {string} target path berkas .zip
 * @param {{ name: string, file?: string, data?: Buffer|string }[]} entries
 */
function writeZip(target, entries) {
  const fd = fs.openSync(target, 'w');
  const central = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  try {
    for (const e of entries) {
      const raw = e.file ? fs.readFileSync(e.file) : Buffer.from(e.data);
      const deflated = zlib.deflateRawSync(raw, { level: 6 });
      const useDeflate = deflated.length < raw.length;
      const body = useDeflate ? deflated : raw;
      const crc = zlib.crc32(raw);
      const name = Buffer.from(e.name, 'utf8');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6); // nama berkas UTF-8
      local.writeUInt16LE(useDeflate ? 8 : 0, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc >>> 0, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      fs.writeSync(fd, local);
      fs.writeSync(fd, name);
      fs.writeSync(fd, body);
      central.push({ name, crc, comp: body.length, size: raw.length, method: useDeflate ? 8 : 0, offset });
      offset += local.length + name.length + body.length;
    }
    const cdStart = offset;
    for (const c of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(c.method, 10);
      h.writeUInt16LE(time, 12);
      h.writeUInt16LE(date, 14);
      h.writeUInt32LE(c.crc >>> 0, 16);
      h.writeUInt32LE(c.comp, 20);
      h.writeUInt32LE(c.size, 24);
      h.writeUInt16LE(c.name.length, 28);
      h.writeUInt32LE(c.offset, 42);
      fs.writeSync(fd, h);
      fs.writeSync(fd, c.name);
      offset += h.length + c.name.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - cdStart, 12);
    end.writeUInt32LE(cdStart, 16);
    fs.writeSync(fd, end);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Menyalin ZIP yang sudah jadi lalu menambahkan berkas baru di dalamnya, tanpa mengompres ulang isi lama
 * (cepat walau ZIP-nya puluhan MB). Folder utama ZIP sumber dipakai sebagai awalan nama berkas baru.
 * @param {string} sumber ZIP dasar (bukan ZIP64)
 * @param {string} target ZIP hasil
 * @param {{ name: string, data: Buffer|string }[]} entries nama relatif terhadap folder utama ZIP sumber
 * @returns {string} nama folder utama ZIP
 */
function tambahkanKeZip(sumber, target, entries) {
  const zip = fs.readFileSync(sumber);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Berkas ZIP dasar tidak valid.');
  const jumlah = zip.readUInt16LE(eocd + 10);
  const cdSize = zip.readUInt32LE(eocd + 12);
  const cdStart = zip.readUInt32LE(eocd + 16);
  if (jumlah === 0xffff || cdStart === 0xffffffff) throw new Error('ZIP dasar terlalu besar (ZIP64) dan tidak didukung.');
  const nameLen = zip.readUInt16LE(cdStart + 28);
  const first = zip.toString('utf8', cdStart + 46, cdStart + 46 + nameLen);
  const folder = first.includes('/') ? first.slice(0, first.indexOf('/')) : '';

  const { time, date } = dosTime(new Date());
  const locals = []; const centrals = [];
  let offset = cdStart;
  for (const e of entries) {
    const raw = Buffer.from(e.data);
    const deflated = zlib.deflateRawSync(raw, { level: 6 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const crc = zlib.crc32(raw) >>> 0;
    const name = Buffer.from(folder ? `${folder}/${e.name}` : e.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8);
    h.writeUInt16LE(useDeflate ? 8 : 0, 10); h.writeUInt16LE(time, 12); h.writeUInt16LE(date, 14);
    h.writeUInt32LE(crc, 16); h.writeUInt32LE(body.length, 20); h.writeUInt32LE(raw.length, 24);
    h.writeUInt16LE(name.length, 28); h.writeUInt32LE(offset, 42);
    centrals.push(h, name);
    offset += local.length + name.length + body.length;
  }
  const tambahan = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(jumlah + entries.length, 8); end.writeUInt16LE(jumlah + entries.length, 10);
  end.writeUInt32LE(cdSize + tambahan, 12); end.writeUInt32LE(offset, 16);
  const fd = fs.openSync(target, 'w');
  try {
    fs.writeSync(fd, zip, 0, cdStart);                       // isi lama apa adanya
    for (const b of locals) fs.writeSync(fd, b);             // berkas baru
    fs.writeSync(fd, zip, cdStart, cdSize);                  // daftar isi lama (posisi tetap)
    for (const b of centrals) fs.writeSync(fd, b);           // daftar isi baru
    fs.writeSync(fd, end);
  } finally { fs.closeSync(fd); }
  return folder;
}

/** Memastikan berkas adalah ZIP biasa yang utuh; mengembalikan { folder, jumlah, nama[] } (nama = semua entri) atau melempar galat. */
function periksaZip(file) {
  const zip = fs.readFileSync(file);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Berkas ini bukan ZIP yang utuh (unduhannya mungkin terputus).');
  const jumlah = zip.readUInt16LE(eocd + 10);
  let pos = zip.readUInt32LE(eocd + 16);
  const nama = [];
  for (let n = 0; n < jumlah; n += 1) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) throw new Error('Daftar isi ZIP rusak.');
    const len = zip.readUInt16LE(pos + 28); const ext = zip.readUInt16LE(pos + 30); const kom = zip.readUInt16LE(pos + 32);
    nama.push(zip.toString('utf8', pos + 46, pos + 46 + len));
    pos += 46 + len + ext + kom;
  }
  const folder = nama[0] && nama[0].includes('/') ? nama[0].slice(0, nama[0].indexOf('/')) : '';
  return { folder, jumlah, nama };
}

/**
 * Membuat ZIP baru dari ZIP yang sudah jadi: folder utamanya diganti nama dan berkas baru ditambahkan.
 * Isi lama disalin tanpa dikompres ulang (cepat). Dipakai untuk ZIP khusus satu sekolah.
 * @param {string} sumber ZIP dasar (bukan ZIP64)
 * @param {string} target ZIP hasil
 * @param {{ folder: string, entries: { name: string, data: Buffer|string }[], hapus?: (relatif: string) => boolean }} opsi
 *   nama relatif terhadap folder baru; `hapus` membuang berkas lama (mis. kode aplikasi yang akan diganti versi terbaru)
 */
function buatZipDenganFolder(sumber, target, { folder, entries = [], hapus = null }) {
  const zip = fs.readFileSync(sumber);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Berkas ZIP dasar tidak valid.');
  const jumlah = zip.readUInt16LE(eocd + 10);
  if (jumlah === 0xffff || zip.readUInt32LE(eocd + 16) === 0xffffffff) throw new Error('ZIP dasar terlalu besar (ZIP64) dan tidak didukung.');
  let pos = zip.readUInt32LE(eocd + 16);
  const lama = [];
  for (let n = 0; n < jumlah; n += 1) {
    const len = zip.readUInt16LE(pos + 28);
    lama.push({ c: pos, name: zip.toString('utf8', pos + 46, pos + 46 + len), total: 46 + len + zip.readUInt16LE(pos + 30) + zip.readUInt16LE(pos + 32) });
    pos += lama[lama.length - 1].total;
  }
  const folderLama = lama[0] && lama[0].name.includes('/') ? lama[0].name.slice(0, lama[0].name.indexOf('/')) : '';
  const relatif = (nama) => (folderLama && nama.startsWith(`${folderLama}/`) ? nama.slice(folderLama.length + 1) : nama);
  const dipakai = hapus ? lama.filter((e) => !hapus(relatif(e.name))) : lama;
  const { time, date } = dosTime(new Date());
  const fd = fs.openSync(target, 'w');
  const central = []; let offset = 0;
  const tulis = (b) => { fs.writeSync(fd, b); offset += b.length; };
  try {
    // berkas baru (kode aplikasi, kode aktivasi) ditulis DULUAN: bila ekstraksi di Windows terhenti di tengah, berkas inti tetap ada
    for (const e of entries) {
      const raw = Buffer.from(e.data);
      const deflated = zlib.deflateRawSync(raw, { level: 6 });
      const useDeflate = deflated.length < raw.length;
      const body = useDeflate ? deflated : raw;
      const crc = zlib.crc32(raw) >>> 0;
      const name = Buffer.from(`${folder}/${e.name}`, 'utf8');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(useDeflate ? 8 : 0, 10); h.writeUInt16LE(time, 12); h.writeUInt16LE(date, 14);
      h.writeUInt32LE(crc, 16); h.writeUInt32LE(body.length, 20); h.writeUInt32LE(raw.length, 24); h.writeUInt16LE(name.length, 28); h.writeUInt32LE(offset, 42);
      central.push(h, name);
      tulis(local); tulis(name); tulis(body);
    }
    for (const e of dipakai) {
      const c = e.c;
      const baru = Buffer.from(folderLama && e.name.startsWith(`${folderLama}/`) ? `${folder}/${e.name.slice(folderLama.length + 1)}` : `${folder}/${e.name}`, 'utf8');
      const comp = zip.readUInt32LE(c + 20);
      const lo = zip.readUInt32LE(c + 42);
      const data = zip.subarray(lo + 30 + zip.readUInt16LE(lo + 26) + zip.readUInt16LE(lo + 28), lo + 30 + zip.readUInt16LE(lo + 26) + zip.readUInt16LE(lo + 28) + comp);
      const flags = (zip.readUInt16LE(c + 8) | 0x0800) & ~0x0008;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(zip.readUInt16LE(c + 6), 4); local.writeUInt16LE(flags, 6);
      local.writeUInt16LE(zip.readUInt16LE(c + 10), 8); local.writeUInt16LE(zip.readUInt16LE(c + 12), 10); local.writeUInt16LE(zip.readUInt16LE(c + 14), 12);
      local.writeUInt32LE(zip.readUInt32LE(c + 16), 14); local.writeUInt32LE(comp, 18); local.writeUInt32LE(zip.readUInt32LE(c + 24), 22);
      local.writeUInt16LE(baru.length, 26);
      const h = Buffer.from(zip.subarray(c, c + 46));
      h.writeUInt16LE(flags, 8); h.writeUInt16LE(baru.length, 28); h.writeUInt16LE(0, 30); h.writeUInt16LE(0, 32); h.writeUInt32LE(offset, 42);
      central.push(h, baru);
      tulis(local); tulis(baru); tulis(data);
    }
    const cdStart = offset;
    for (const b of central) tulis(b);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(dipakai.length + entries.length, 8); end.writeUInt16LE(dipakai.length + entries.length, 10);
    end.writeUInt32LE(offset - cdStart, 12); end.writeUInt32LE(cdStart, 16);
    tulis(end);
  } finally { fs.closeSync(fd); }
}

/** Isi satu berkas di dalam ZIP (nama relatif terhadap folder utama), atau null bila tidak ada. */
function bacaEntriZip(file, relatif) {
  const zip = fs.readFileSync(file);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const jumlah = zip.readUInt16LE(eocd + 10);
  let pos = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < jumlah; n += 1) {
    const len = zip.readUInt16LE(pos + 28);
    const nama = zip.toString('utf8', pos + 46, pos + 46 + len);
    const rel = nama.includes('/') ? nama.slice(nama.indexOf('/') + 1) : nama;
    if (rel === relatif) {
      const metode = zip.readUInt16LE(pos + 10); const comp = zip.readUInt32LE(pos + 20); const lo = zip.readUInt32LE(pos + 42);
      const awal = lo + 30 + zip.readUInt16LE(lo + 26) + zip.readUInt16LE(lo + 28);
      const data = zip.subarray(awal, awal + comp);
      return metode === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    }
    pos += 46 + len + zip.readUInt16LE(pos + 30) + zip.readUInt16LE(pos + 32);
  }
  return null;
}

/**
 * Memeriksa ZIP seperti pembaca ketat (Windows Explorer): tiap entri dibuka, nama di header lokal cocok,
 * data bisa dikembangkan dan CRC/ukurannya benar. Mengembalikan { jumlah, terpanjang } atau melempar galat.
 * @param {string} file
 * @param {string[]} wajib berkas yang harus ada (nama relatif terhadap folder utama)
 */
function verifikasiZip(file, wajib = []) {
  const zip = fs.readFileSync(file);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP tidak utuh (daftar isi tidak ditemukan).');
  const jumlah = zip.readUInt16LE(eocd + 10);
  let pos = zip.readUInt32LE(eocd + 16);
  const ada = new Set(); let terpanjang = 0; let folder = '';
  for (let n = 0; n < jumlah; n += 1) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) throw new Error('Daftar isi ZIP rusak.');
    const metode = zip.readUInt16LE(pos + 10); const crc = zip.readUInt32LE(pos + 16); const comp = zip.readUInt32LE(pos + 20); const size = zip.readUInt32LE(pos + 24);
    const len = zip.readUInt16LE(pos + 28); const lo = zip.readUInt32LE(pos + 42);
    const nama = zip.toString('utf8', pos + 46, pos + 46 + len);
    if (zip.readUInt32LE(lo) !== 0x04034b50) throw new Error(`Header berkas rusak: ${nama}`);
    const lnama = zip.toString('utf8', lo + 30, lo + 30 + zip.readUInt16LE(lo + 26));
    if (lnama !== nama) throw new Error(`Nama berkas tidak cocok: ${nama}`);
    if (!nama.endsWith('/')) {
      const awal = lo + 30 + zip.readUInt16LE(lo + 26) + zip.readUInt16LE(lo + 28);
      if (awal + comp > zip.length) throw new Error(`Data terpotong: ${nama}`);
      const data = zip.subarray(awal, awal + comp);
      const isi = metode === 8 ? zlib.inflateRawSync(data) : data;
      if (isi.length !== size || (zlib.crc32(isi) >>> 0) !== crc) throw new Error(`Isi berkas rusak (CRC): ${nama}`);
    }
    if (!folder && nama.includes('/')) folder = nama.slice(0, nama.indexOf('/'));
    ada.add(nama.includes('/') ? nama.slice(nama.indexOf('/') + 1) : nama);
    terpanjang = Math.max(terpanjang, nama.length);
    pos += 46 + len + zip.readUInt16LE(pos + 30) + zip.readUInt16LE(pos + 32);
  }
  const hilang = wajib.filter((w) => !ada.has(w));
  if (hilang.length) throw new Error(`Berkas inti tidak ada di ZIP: ${hilang.join(', ')}`);
  return { jumlah, terpanjang, folder };
}

module.exports = { writeZip, listFiles, tambahkanKeZip, periksaZip, buatZipDenganFolder, bacaEntriZip, verifikasiZip };
