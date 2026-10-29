const test = require('node:test');
const assert = require('node:assert');
const { hitungMapel, deskripsiMapel, ranking } = require('../src/lib/calc');

const settings = {
  desk_mode: 'predikat', desk_nama: '1', kalimat_tinggi: 'menunjukkan penguasaan dalam', kalimat_rendah: 'perlu bimbingan dalam',
  predikat: [
    { min: 88, label: 'Sangat Baik', kalimat: 'menunjukkan penguasaan yang sangat baik dalam' },
    { min: 74, label: 'Baik', kalimat: 'menunjukkan penguasaan yang baik dalam' },
    { min: 60, label: 'Cukup', kalimat: 'menunjukkan penguasaan yang cukup dalam' },
    { min: 0, label: 'Perlu Bimbingan', kalimat: 'perlu bimbingan dalam' },
  ],
};
const bobot = { f: 1, s: 2, as: 2 };
const tp = (vals) => vals.map((nilai, i) => ({ id: i + 1, urutan: i + 1, deskripsi: `materi ${i + 1}`, nilai }));

test('rumus sama dengan baris contoh di Excel (NA 61)', () => {
  const r = hitungMapel({ tp: tp([58, 60, 60, 65, 60, 60, 60, 60, 60, 60, 60]), lm: [58, 65, 60], sas: [65, 60], bobot });
  assert.strictEqual(r.na, 61);
  assert.strictEqual(r.tinggi.id, 4);
  assert.strictEqual(r.rendah.id, 1);
  const d = deskripsiMapel(r, { panggilan: 'Geger', settings });
  assert.deepStrictEqual(d, ['Geger menunjukkan penguasaan yang cukup dalam materi 4.', 'Geger perlu bimbingan dalam materi 1.']);
});

test('komponen kosong tidak ikut pembagi (F + AS saja)', () => {
  const r = hitungMapel({ tp: tp([90, 70, 75, 75]), lm: [], sas: [null, 80], bobot });
  assert.strictEqual(r.na, 79); // (77.5 + 2*80) / 3
});

test('deskripsi tanpa nama & tanpa predikat', () => {
  const r = hitungMapel({ tp: tp([80, 70]), lm: [], sas: [], bobot });
  const d = deskripsiMapel(r, { panggilan: 'X', settings: { ...settings, desk_nama: '0', desk_mode: 'sederhana' } });
  assert.deepStrictEqual(d, ['Menunjukkan penguasaan dalam materi 1.', 'Perlu bimbingan dalam materi 2.']);
});

test('ranking dengan nilai sama', () => {
  const items = [{ j: 300 }, { j: 320 }, { j: 300 }, { j: null }];
  const r = ranking(items, 'j');
  assert.deepStrictEqual(items.map((i) => r.get(i) || null), [2, 1, 2, null]);
});

test('sebutan peringkat untuk berapa pun juara', () => {
  const { peringkatKata } = require('../src/lib/calc');
  assert.deepStrictEqual([1, 2, 3, 10, 11, 12, 19, 20, 21, 35, 100, 125].map(peringkatKata), [
    'Pertama', 'Kedua', 'Ketiga', 'Kesepuluh', 'Kesebelas', 'Kedua Belas', 'Kesembilan Belas', 'Kedua Puluh',
    'Kedua Puluh Satu', 'Ketiga Puluh Lima', 'Keseratus', 'Keseratus Dua Puluh Lima']);
});

test('STS ikut dihitung sebagai komponen berbobot; kosong tidak mengubah nilai', () => {
  const b = { f: 1, s: 2, sts: 1, as: 2 };
  // F 80, S 85, STS 70, AS 75 → (80 + 170 + 70 + 150) / 6 = 78,3 → 78
  const r = hitungMapel({ tp: tp([80]), lm: [85], sts: 70, sas: [75], bobot: b });
  assert.strictEqual(r.naSTS, 70);
  assert.strictEqual(r.na, 78);
  // STS belum diisi: sama dengan rumus lama (80 + 170 + 150) / 5 = 80
  assert.strictEqual(hitungMapel({ tp: tp([80]), lm: [85], sts: null, sas: [75], bobot: b }).na, 80);
  // bobot STS 0: STS diabaikan
  assert.strictEqual(hitungMapel({ tp: tp([80]), lm: [85], sts: 10, sas: [75], bobot: { ...b, sts: 0 } }).na, 80);
});
