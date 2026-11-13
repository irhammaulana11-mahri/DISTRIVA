# 10 — Warehouse and Inventory

## 1. Kebijakan organisasi gudang

### Gudang ULP
ULP hanya mengelola penerimaan dan pengeluaran/pemakaian untuk:
1. kWh meter 1 phase prabayar;
2. kWh meter 1 phase pascabayar;
3. kabel pelanggan 2×10 mm²;
4. kabel pelanggan 2×16 mm²;
5. MCB pelanggan 1 phase berdasarkan rating ampere.

Kelima baris tersebut adalah kelompok/varian stok yang dapat memiliki banyak SKU, bukan berarti hanya lima kode material.

### Gudang UP3
UP3 mengelola material konstruksi lainnya, misalnya tiang, trafo, pin, material SUTM/SUTR, kubikel, dan material lain yang ditetapkan sebagai lingkup UP3.

ULP dapat mengajukan/alokasikan kebutuhan material UP3 untuk pekerjaan, tetapi material tersebut tetap dikelola sebagai stok UP3 kecuali ada proses transfer resmi yang disahkan.

## 2. Master material

Kolom usulan:
- `id`, `code`, `name`;
- `category_id`, `base_unit_id`;
- `inventory_scope` (`UP3_ONLY`, `UP3_AND_ULP`);
- `ulp_stock_allowed` (derived/policy-controlled);
- status aktif;
- atribut spesifikasi atau relasi `material_specifications`.

Contoh:
- `KWH-1PH-PR`: kWh meter 1 phase prabayar.
- `KWH-1PH-PS`: kWh meter 1 phase pascabayar.
- `KBL-2X10`: kabel 2×10 mm².
- `KBL-2X16`: kabel 2×16 mm².
- `MCB-1PH-06A`: MCB 1 phase 6A.
- `MCB-1PH-10A`: MCB 1 phase 10A.

Contoh kode hanya rancangan; kode resmi harus mengikuti master yang disetujui.

## 3. Enforcement wajib

Validasi dilakukan pada beberapa lapisan:
1. Laravel Policy/Service sebelum mutasi.
2. Database constraint/trigger atau desain transaksi yang mencegah material non-ULP masuk ke ledger gudang ULP.
3. Test otomatis untuk semua jalur API/import.
4. Audit log atas setiap perubahan policy.

Jangan hanya mengandalkan UI.

## 4. Jenis mutasi

- `RECEIPT`: penerimaan.
- `ISSUE`: pengeluaran/pemakaian.
- `TRANSFER_OUT` dan `TRANSFER_IN`: hanya jika transfer antar gudang resmi diaktifkan.
- `ADJUSTMENT_IN` / `ADJUSTMENT_OUT`: koreksi stok dengan alasan dan approval.
- `RETURN`: pengembalian material jika proses bisnis mendukung.
- `RESERVATION` / `RELEASE`: komitmen alokasi; bukan mutasi fisik.

Semua jenis mutasi harus punya sumber dokumen, actor, tanggal, qty, satuan, dan referensi pekerjaan bila relevan.

## 5. Saldo dan ketersediaan

- Ledger `stock_movements` adalah jejak transaksi.
- `stock_balances` adalah ringkasan saldo untuk performa.
- `on_hand`: stok fisik.
- `reserved`: stok yang sudah dialokasikan/reservasi.
- `available = on_hand - reserved`.
- `incoming`: penerimaan yang telah dikonfirmasi/dijadwalkan sesuai kebijakan.
- Cegah double counting antara stok yang dialokasikan dan permintaan yang masih pipeline.

## 6. Alokasi UP3 ke ULP/pekerjaan

Untuk material UP3 yang digunakan pekerjaan ULP:
1. ULP/pekerjaan mengajukan kebutuhan.
2. UP3 memeriksa stok dan kebutuhan lain.
3. UP3 menyetujui alokasi.
4. Sistem membuat reservation atau issue sesuai model operasional.
5. Penggunaan aktual dicatat pada work order.
6. Sisa material dikembalikan atau direkonsiliasi sesuai prosedur.

Pilih antara reservation, issue langsung, atau transfer fisik setelah SOP gudang dikonfirmasi.

## 7. Rekonsiliasi

- Stock opname periodik.
- Selisih harus memiliki alasan dan approval.
- Saldo tidak boleh diedit langsung tanpa movement koreksi.
- Simpan histori harga jika valuasi stok diperlukan pada fase lanjutan.

## 8. Pertanyaan terbuka

- Apakah merek/tipe kWh meter harus menjadi SKU berbeda?
- Apakah MCB perlu atribut tambahan selain rating ampere (curve, breaking capacity, merek)?
- Apakah kabel dicatat dalam meter dengan lot/roll/nomor drum?
- Apakah ULP boleh melakukan transfer fisik dari UP3 atau hanya menerima material alokasi?
- Apakah diperlukan serial number untuk kWh meter?

## PERUBAHAN KEPUTUSAN — inventory tidak dibangun di DISTRIVA

Bagian desain inventory internal pada dokumen ini (warehouse ledger, saldo, movement, allocation, transfer, stock opname) adalah rancangan lama dan **tidak menjadi ruang lingkup implementasi DISTRIVA**. Keputusan T3.8 menetapkan aplikasi material eksisting sebagai source of truth untuk master material operasional, gudang, saldo, alokasi, issue, transfer, retur, dan stock opname.

DISTRIVA hanya: (1) mengelola kebutuhan material dari drawing/BOM/WO; (2) mengirim kebutuhan setelah WO disetujui ASMAN_KONSTRUKSI dan diterbitkan; (3) menerima status dan snapshot stok read-only; (4) mencatat log integrasi, idempotency, retry, dan rekonsiliasi. Jangan membuat atau mengubah saldo stok dari DISTRIVA. Lihat dokumen 16 dan 17.
