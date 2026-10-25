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

module.exports = { writeZip, listFiles, tambahkanKeZip, periksaZip };
