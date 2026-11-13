# 07 — Master Data, KHS, Kontrak, dan BOM

## 1. Master material

Master material perlu membedakan:
- kategori material;
- identitas material yang dapat dipesan/dikelola stok;
- spesifikasi/varian;
- satuan dasar;
- lingkup pengelolaan stok (`UP3` atau `ULP_ALLOWED`);
- sumber harga dan kode KHS;
- status aktif.

Contoh empat kelompok yang dapat dikelola stok di ULP:
1. kWh meter 1 phase — prabayar.
2. kWh meter 1 phase — pascabayar.
3. Kabel pelanggan 2×10 mm².
4. Kabel pelanggan 2×16 mm².
5. MCB pelanggan 1 phase — dibedakan menurut rating ampere.

Daftar ini menghasilkan lebih dari empat SKU/kode material karena meter memiliki dua jenis dan MCB memiliki beberapa rating.

## 2. Spesifikasi material yang telah diputuskan

| Kategori | Atribut pembeda yang dikonfirmasi | Contoh |
|---|---|---|
| kWh meter 1 phase | Jenis pembayaran | Prabayar, Pascabayar |
| Kabel pelanggan | Ukuran penampang | 2×10 mm², 2×16 mm² |
| MCB pelanggan 1 phase | Rating ampere | 2A, 4A, 6A, 10A, dan seterusnya (daftar final belum disahkan) |

**Belum diputuskan:** apakah merek, tipe, kelas akurasi, standar, atau pabrikan harus memisahkan SKU. Jika dua barang tidak dapat saling menggantikan secara teknis/operasional, pisahkan kode material.

## 3. Pengelolaan stok berdasarkan unit

- Gudang ULP hanya menerima dan mengeluarkan/mencatat pemakaian empat kelompok di atas, berdasarkan spesifikasi.
- Material lain seperti tiang, trafo, pin, material SUTM/SUTR, kubikel, dan material konstruksi lain dikelola di gudang UP3.
- Material UP3 dapat dialokasikan untuk pekerjaan di ULP melalui transaksi alokasi/issue dari gudang UP3.
- Alokasi bukan berarti material tersebut menjadi saldo stok reguler gudang ULP, kecuali proses transfer resmi memang ditetapkan.
- Enforcement wajib dilakukan di backend dan database, bukan hanya menyembunyikan menu.

## 4. Struktur BOM

Workbook MASTER RAB & KKF yang dianalisis memiliki 35 sheet dan katalog 518 kode KHS. Kelompok konstruksi yang teridentifikasi meliputi SUTM, MVTIC, SKTM, GTT Umum, GTT Khusus, Kubikel, SUTR, SR/APP, serta kelompok terkait lainnya.

Koefisien BOM dalam workbook sebagian ditanam di formula, misalnya jumlah konstruksi dikalikan faktor tetap. Untuk web, koefisien perlu diekstrak ke `bom_items` dengan:
- jenis konstruksi;
- kode KHS/material;
- koefisien;
- basis perhitungan (per unit konstruksi, meter, set, konfigurasi, dan lain-lain);
- waste factor bila berlaku;
- aturan pembulatan;
- periode berlaku dan versi.

Jangan mengasumsikan semua koefisien berbasis satu konstruksi. Basis harus diperiksa per baris BOM.

## 5. Versi BOM dan harga

- Setiap perubahan BOM membuat versi baru.
- Harga kontrak memiliki nomor kontrak, masa berlaku, dan versi paket.
- Satu sumber harga material dipakai konsisten untuk perhitungan.
- Harga jasa pasang/bongkar dibedakan menurut zona.
- Zona jasa ditentukan pada tingkat UP3, bukan diinput bebas per permohonan.
- Calculation run menyimpan versi BOM dan kontrak yang digunakan.

## 6. Impor master

Setiap impor:
1. unggah file;
2. parse dan validasi;
3. tampilkan preview;
4. tampilkan error dan warning;
5. minta konfirmasi;
6. simpan versi baru;
7. simpan file sumber, uploader, timestamp, dan checksum.

Impor tidak boleh menimpa riwayat versi yang telah dipakai permohonan lama.


## 7. Pembaruan rancangan database T4.2.2 (5 November 2026)

Rancangan teknis master data dikembangkan pada `23-T4.2.2-MASTER-DATA-SCHEMA.md`. Arah desain: ERP/aplikasi material menjadi sumber kebenaran material; DISTRIVA mengelola kategori internal, KHS, jenis konstruksi, BOM dan formula. Satu SKU/kode ERP = satu record `materials`; varian bisnis baru menjadi record terpisah bila ERP memiliki kode masing-masing.

Tabel usulan: `material_categories`, `materials`, `units_of_measure`, `material_unit_conversions`, `khs_items`, `khs_item_versions`, `construction_types`, `construction_type_versions`, `construction_khs_mappings`, `bom_headers`, `bom_items`, `bom_formula_definitions`, `material_sync_logs`, `material_sync_staging`, `material_change_logs`, serta `material_prices` (opsional/belum disetujui).

Formula BOM disimpan sebagai ekspresi terstruktur yang aman, bukan kode bebas/`eval()`. Basis koefisien ditentukan per item KHS/BOM; tidak diasumsikan seluruhnya per unit konstruksi. Snapshot versi master diperlukan pada perhitungan/transaksi. Detail, indeks, constraint dan isu terbuka tercatat pada dokumen T4.2.2.

**Status:** rancangan konseptual untuk review, belum final dan belum diimplementasikan. ERP API/file, SKU aktual, master satuan, sumber harga, formula lengkap, dan otoritas approval versi KHS/BOM masih perlu dikonfirmasi.


## 8. Keputusan final desain T4.2.2 (5 November 2026)

Keputusan yang mengikat untuk rancangan database: **setiap varian material wajib memiliki kode ERP tersendiri**. Satu kode SKU ERP menjadi satu record `materials`. Daftar varian pada dokumen ini merupakan daftar kebutuhan yang harus dicocokkan dengan master ERP, bukan izin membuat SKU lokal. Varian tanpa kode ERP yang terverifikasi belum dapat diaktifkan sebagai master material.

**Harga material:** DISTRIVA mendukung sumber eksternal dan master harga internal per UP3 melalui `material_prices`. Jenis harga dan sumber dibedakan; keduanya tidak dijumlahkan atau dipilih otomatis. Calculation run menyimpan snapshot harga terpilih dan referensi sumber/dokumen/versi yang dipakai. Harga stok dari ERP tidak otomatis diperlakukan sebagai harga RAB. Harga kontrak dan jasa mengikuti domain kontrak/RAB/KKF.

Setiap harga memiliki lingkup (global atau UP3), masa berlaku, versi, status, sumber, dan alasan. Kebijakan prioritas saat lebih dari satu harga valid tersedia masih harus diputuskan. Harga persediaan ERP tidak otomatis menjadi harga RAB.

**Approval KHS/BOM:** `UP3_MANAGER` menjadi approver utama versi master KHS dan BOM. Versi approved immutable; perubahan harus melalui versi baru dan approval ulang. Catat pejabat, role/unit, timestamp, keputusan, dan catatan.

**Rekonsiliasi blueprint lama:** uraian awal pada bagian 1–6 yang menyebut `inventory_scope`, pengelolaan stok ULP/UP3, `stock_movements`, saldo, alokasi atau transfer internal adalah konteks blueprint terdahulu dan telah digantikan keputusan integrasi aplikasi material eksternal. DISTRIVA tidak membangun modul persediaan. Demikian pula usulan satu master harga internal digantikan keputusan penggunaan sumber harga eksternal dan snapshot perhitungan.

Detail skema final desain dan open items teknis terdapat pada `23-T4.2.2-MASTER-DATA-SCHEMA.md`.


## Integrasi Auto MTO v3.2
Auto MTO menggunakan ulang `khs_items`, `khs_item_versions`, `materials`, `units_of_measure`, `bom_headers`, `bom_items`, dan `bom_formula_definitions`. Jangan membuat salinan master KHS/material/BOM di domain dokumen. Kebutuhan material menyimpan referensi versi BOM/item/formula dan snapshot formula/input. `materials.unit` pada rancangan T4.2.2 tetap VARCHAR(30); jangan mengasumsikan FK `unit_id` pada tabel materials.
