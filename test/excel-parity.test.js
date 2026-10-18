// Membandingkan mesin hitung website dengan hasil rumus di file Excel asli
// (236 baris nilai dari sheet mapel; hanya angka, tanpa identitas siswa).
const test = require('node:test');
const assert = require('node:assert');
const { hitungMapel } = require('../src/lib/calc');
const rows = require('./fixtures-excel-nilai.json');

test('NA rapor & TP tertinggi/terendah sama dengan Excel', () => {
  assert.ok(rows.length > 200);
  for (const r of rows) {
    const tp = r.f.map((nilai, i) => ({ id: i + 1, deskripsi: '', nilai }));
    const h = hitungMapel({ tp, lm: r.lm, sas: r.sas, bobot: { f: 1, s: 2, as: 2 } });
    assert.strictEqual(h.na, r.na, `${r.sheet}: NA web ${h.na} ≠ Excel ${r.na}`);
    assert.strictEqual(h.tinggi ? h.tinggi.id : null, r.tpHi, `${r.sheet}: TP tertinggi`);
    assert.strictEqual(h.rendah ? h.rendah.id : null, r.tpLo, `${r.sheet}: TP terendah`);
  }
});
