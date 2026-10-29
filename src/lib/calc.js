// Perhitungan nilai rapor — meniru rumus pada file Excel RAPOR SAH Kurikulum Merdeka:
//   NA Formatif (F)  = rata-rata nilai formatif per TP
//   NA Sumatif  (S)  = rata-rata sumatif lingkup materi
//   NA STS    (STS)  = nilai sumatif tengah semester
//   NA SAS     (AS)  = rata-rata sumatif akhir semester (non-tes & tes)
//   NA Rapor         = (bF*F + bS*S + bSTS*STS + bAS*AS) / (jumlah bobot komponen yang terisi), dibulatkan
// Deskripsi capaian diambil dari TP dengan nilai formatif tertinggi & terendah.

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function avg(values) {
  const nums = values.filter(isNum);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round(n) {
  return n == null ? null : Math.round(n + 1e-9);
}

function predikatFor(nilai, predikat) {
  if (!isNum(nilai)) return null;
  const sorted = [...predikat].sort((a, b) => b.min - a.min);
  return sorted.find((p) => nilai >= p.min) || sorted[sorted.length - 1];
}

/**
 * @param {object} input
 * @param {{id:number, urutan:number, deskripsi:string, nilai:number|null}[]} input.tp
 * @param {(number|null)[]} input.lm  nilai sumatif lingkup materi
 * @param {number|null} [input.sts] nilai sumatif tengah semester
 * @param {(number|null)[]} input.sas nilai SAS (non-tes, tes)
 * @param {{f:number, s:number, sts?:number, as:number}} input.bobot
 */
function hitungMapel({ tp, lm, sts = null, sas, bobot }) {
  const naF = avg(tp.map((t) => t.nilai));
  const naS = avg(lm);
  const naSTS = avg([sts]);
  const naAS = avg(sas);
  let total = 0;
  let pembagi = 0;
  if (naF != null) { total += bobot.f * naF; pembagi += bobot.f; }
  if (naS != null) { total += bobot.s * naS; pembagi += bobot.s; }
  if (naSTS != null) { total += (bobot.sts || 0) * naSTS; pembagi += bobot.sts || 0; }
  if (naAS != null) { total += bobot.as * naAS; pembagi += bobot.as; }
  const na = pembagi ? round(total / pembagi) : null;

  let tinggi = null;
  let rendah = null;
  for (const t of tp) {
    if (!isNum(t.nilai)) continue;
    if (!tinggi || t.nilai > tinggi.nilai) tinggi = t;
    if (!rendah || t.nilai < rendah.nilai) rendah = t;
  }
  return { naF, naS, naSTS, naAS, na, tinggi, rendah };
}

function lcFirst(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function kalimat(subjek, frasa, tp) {
  const isi = String(tp || '').trim().replace(/[.\s]+$/, '');
  const text = `${frasa} ${lcFirst(isi)}.`;
  if (subjek) return `${subjek} ${text}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Menyusun deskripsi capaian (tertinggi & terendah).
 * @returns {string[]} 0–2 kalimat
 */
function deskripsiMapel(hasil, { panggilan, settings }) {
  const { tinggi, rendah } = hasil;
  if (!tinggi) return [];
  const pakaiPredikat = settings.desk_mode !== 'sederhana';
  const subjek = settings.desk_nama === '1' ? panggilan || '' : '';
  const frasaTinggi = pakaiPredikat
    ? predikatFor(tinggi.nilai, settings.predikat).kalimat
    : settings.kalimat_tinggi;
  const out = [kalimat(subjek, frasaTinggi, tinggi.deskripsi)];
  if (rendah && rendah.id !== tinggi.id) {
    const frasaRendah = pakaiPredikat
      ? predikatFor(rendah.nilai, settings.predikat).kalimat
      : settings.kalimat_rendah;
    out.push(kalimat(subjek, frasaRendah, rendah.deskripsi));
  }
  return out;
}

/** Ranking kompetisi standar (nilai sama → peringkat sama). */
function ranking(items, key) {
  const sorted = items.filter((i) => isNum(i[key])).sort((a, b) => b[key] - a[key]);
  const ranks = new Map();
  sorted.forEach((item, idx) => {
    const prev = sorted[idx - 1];
    ranks.set(item, prev && Math.abs(prev[key] - item[key]) < 1e-9 ? ranks.get(prev) : idx + 1);
  });
  return ranks;
}

const P5_LEVEL = {
  1: { kode: 'BB', label: 'Belum Berkembang', ket: 'Siswa masih membutuhkan bimbingan dalam mengembangkan kemampuan' },
  2: { kode: 'MB', label: 'Mulai Berkembang', ket: 'Siswa mulai mengembangkan kemampuan namun masih belum ajek' },
  3: { kode: 'BSH', label: 'Berkembang Sesuai Harapan', ket: 'Siswa telah mengembangkan kemampuan hingga berada dalam tahap ajek' },
  4: { kode: 'SB', label: 'Sangat Berkembang', ket: 'Siswa mengembangkan kemampuannya melampaui harapan' },
};

const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
function terbilang(n) {
  n = Math.floor(n);
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${SATUAN[n - 10]} belas`;
  if (n < 100) return `${SATUAN[Math.floor(n / 10)]} puluh ${terbilang(n % 10)}`.trim();
  if (n < 200) return `seratus ${terbilang(n - 100)}`.trim();
  if (n < 1000) return `${SATUAN[Math.floor(n / 100)]} ratus ${terbilang(n % 100)}`.trim();
  return String(n);
}

/** Sebutan peringkat: 1 → Pertama, 2 → Kedua, 12 → Kedua Belas, 21 → Kedua Puluh Satu. */
function peringkatKata(n) {
  if (!n || n < 1) return '-';
  if (n === 1) return 'Pertama';
  const kata = `ke${terbilang(n)}`;
  return kata.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const ROMAWI = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const TERBILANG_KELAS = ['', 'I (Satu)', 'II (Dua)', 'III (Tiga)', 'IV (Empat)', 'V (Lima)', 'VI (Enam)'];

module.exports = {
  avg, round, predikatFor, terbilang, peringkatKata, hitungMapel, deskripsiMapel, ranking, P5_LEVEL, ROMAWI, TERBILANG_KELAS, isNum,
};
