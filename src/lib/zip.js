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

module.exports = { writeZip, listFiles };
