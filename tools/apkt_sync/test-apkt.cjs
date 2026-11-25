// Uji generator Excel APKT (tanpa peramban): node tools/apkt_sync/test-apkt.cjs
const assert = require('assert');
const { sheetRows, buildReport, idNum } = require('./apkt-saidi-saifi.console.js');

const v = (p, n) => ({ [`${p}jumlahPelangganPadam`]: n, [`${p}jamXJumlahPelangganPadam`]: n * 2, [`${p}saidi`]: 0.001, [`${p}saifi`]: 0.002, [`${p}jumlahGangguan`]: 1, [`${p}lamaPadam`]: 3, [`${p}kwhLoss`]: 4 });
const data = {
  kelompok: [{ id: 1, nama: 'Distribusi', ...v('totalKelompok_', 5), subKelompok: [{ id: 11, nama: 'Padam Tidak Terencana', ...v('totalSubKelompok_', 5), fasilitas: [{ id: 112, nama: 'Penyulang', ...v('totalFasilitas_', 5), subFasilitas: [{ id: 1121, nama: 'SUTM', ...v('totalSubFasilitas_', 5), equipment: [{ id: 11211, nama: 'Konduktor', ...v('', 5) }] }] }] }] }],
  totalKeseluruhan: { ...v('', 5), jumlahTotalPelanggan: 174571, saidi: 0.0121, saidiPelanggan: 0.7288, saifi: 0.0568 },
};
const rows = sheetRows(data, { bulan: 1, tahun: 2023, namaUid: 'DISTRIBUSI JAWA TIMUR', namaUp3: 'UP3 MOJOKERTO', namaUlp: 'JOMBANG' });
const labels = rows.slice(15).map((r) => r[1]);
assert.deepStrictEqual(labels.slice(1), ['KELOMPOK Distribusi', 'SUB KELOMPOK Padam Tidak Terencana', 'FASILITAS Penyulang', 'SUB FASILITAS SUTM', 'Konduktor', 'SUB TOTAL SUB FASILITAS SUTM', 'SUB TOTAL FASILITAS Penyulang', 'TOTAL SUB KELOMPOK Padam Tidak Terencana', 'TOTAL KELOMPOK Distribusi', 'TOTAL KESELURUHAN']);
assert.strictEqual(rows[4][0], 'UNIT LAYANAN PELANGGAN : ULP JOMBANG');
assert.strictEqual(rows[7][0], 'Januari 2023');
assert.deepStrictEqual(rows[9].slice(0, 2), ['Jumlah Pelanggan : ', '174.571']);
assert.deepStrictEqual(rows[11].slice(1, 4), ['0,0121', '(Jam/Plg)', '0,7288']);
assert.strictEqual(idNum(1234567.5, 1), '1.234.567,5');
const a = buildReport(data, { bulan: 1, tahun: 2023, namaUid: 'X', namaUp3: 'Y', namaUlp: 'Z' });
const b = buildReport(data, { bulan: 1, tahun: 2023, namaUid: 'X', namaUp3: 'Y', namaUlp: 'Z' });
assert.ok(Buffer.from(a).equals(Buffer.from(b)), 'isi sama harus menghasilkan berkas sama (hash impor idempoten)');
assert.strictEqual(a[0], 0x50); assert.strictEqual(a[1], 0x4b);
console.log('OK');
