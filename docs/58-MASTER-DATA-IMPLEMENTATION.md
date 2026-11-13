# 58 — Master Data (T4.2.2): Status Implementasi Iterasi 2A, 2B-1 dan 2B-2

**Tanggal:** 6 November 2026 · **Dasar:** `docs/23` (desain final level database), `docs/16` §14, `docs/53` · **Status:** `TESTED` pada PostgreSQL `distriva_backend_test` (48 test master data; seluruh suite 278 test, 1 gagal bukan dari pekerjaan ini); **belum diterapkan ke `distriva_db`**.

## 1. Cakupan
| Iterasi | Isi | Status |
|---|---|---|
| 2A | Kategori material (9 kategori awal), satuan, material (satu kode ERP = satu record), impor ERP bertahap, change log append-only | TESTED |
| 2B-1 | Katalog KHS berversi (draf → persetujuan → versi aktif immutable), impor CSV, riwayat peristiwa | TESTED; data asli 518/518 kode terbukti |
| 2B-2 | Jenis konstruksi berversi + pemetaan ke KHS | belum |
| 2C | BOM + formula terstruktur (tanpa `eval`) | belum |
| 2D | Harga material (penyimpanan saja; prioritas harga menunggu O-041) | belum |
| — | Konversi satuan (`material_unit_conversions`) dan normalisasi satuan ke `units_of_measure` | sengaja belum: butuh daftar satuan ERP dan data konversi yang disetujui (tidak boleh dikarang) |

## 2. Otorisasi (keputusan pemilik, 6 Nov 2026: menerima usulan)
Data referensi bersifat **pusat** (doc 16: master SKU terpusat) sehingga key dievaluasi **tanpa target unit**: aktor cukup memiliki penugasan efektif (akun ACTIVE, tanggal berlaku, unit aktif, guard `web`) yang role-nya memegang key. `VENDOR` tidak pernah lolos; kecocokan nama role saja tidak cukup (grant harus ada).
- **Mengelola** (`materials.import`, `materials.update`, `material_categories.manage`, `units_of_measure.manage`, `khs.manage`): `ENGINEERING`, `PERENCANAAN`.
- **Menyetujui versi KHS aktif** (`khs.approve`): `UP3_MANAGER`; selalu orang **berbeda** dari pembuat (API + CHECK database).
- **Membaca** (`master_data.view`): `ENGINEERING`, `PERENCANAAN`, `TEKNIK`, `KONSTRUKSI_UP3`, `UP3_MANAGER`, `MANAGER_ULP`, `ASMAN_PERENCANAAN`, `ASMAN_NIAGA`, `ASMAN_KONSTRUKSI`, `NIAGA_RETAIL`, `VIEWER`.
- **Tidak memegang apa pun:** `SYS_ADMIN`, `UP3_ADMIN`, `VENDOR` (tidak ada akses bisnis otomatis).
Katalog dan grant: `config/distriva_permissions.php` (`master_data`), di-seed oleh `MasterDataPermissionSeeder` (idempoten, menulis `authorization_change_histories`, juga 9 kategori awal).

## 3. Aturan yang ditegakkan
- DISTRIVA **tidak membuat kode material** dan tidak menyentuh stok; tidak ada endpoint pembuatan manual. Kode tidak pernah di-trim-lalu-dilipat-huruf, di-nol-kan, atau dicocokkan dengan kemiripan; `"SKU-LOWER"` bukan `"sku-lower"`.
- Impor material: berkas → staging (divalidasi + dibandingkan dengan master) → pratinjau → konfirmasi eksplisit → upsert dalam satu transaksi → change log. Kode kosong atau berulang dalam berkas ditolak (semua kemunculannya). Material yang tidak ada di berkas tidak disentuh. **Perubahan satuan** memerlukan persetujuan eksplisit. Kolom yang tidak ada di berkas tidak mengosongkan nilai lama (`spec`, `category`). Batch hanya dapat dikonfirmasi sekali.
- ERP memiliki kode/nama/satuan/spesifikasi; yang dapat diubah manual hanya pemetaan kategori dan flag aktif (dengan alasan + change log).
- KHS: kode adalah kunci; atribut berada di versi. Impor hanya membuat **DRAFT**; ada `dry_run`. Satu draf tertunda per kode (impor berikutnya ditolak, tidak ditumpuk). Versi disetujui **immutable** (trigger), status hanya maju (DRAFT→APPROVED→INACTIVE), tidak dapat dihapus, dua versi APPROVED satu kode tidak boleh tumpang-tindih (exclusion constraint), persetujuan menutup versi lama otomatis sehari sebelum versi baru berlaku. Setiap peristiwa dicatat (`khs_version_events`, append-only).
- Spasi berulang dan pindah baris di uraian KHS dirapikan menjadi satu spasi (aturan yang sama di setiap impor, sehingga impor ulang berkas yang sama = `UNCHANGED`).

## 4. Temuan dari data asli (workbook `MASTER RAB & KKF.xlsx`, sheet KHS)
- 518 kode unik, bilangan bulat 1–518 tanpa lubang, tanpa duplikat, tanpa uraian/satuan kosong. Satuan: `B` 315, `S` 148, `M` 37, `M3` 7, `Ls` 6, `Loks` 5 — **singkatan tidak diterjemahkan** (disimpan di `unit_text`; `unit_id` tetap NULL; menyimpang dari `docs/23` §2.5 yang menulis `unit_id FK`, sengaja sampai daftar satuan ERP diketahui).
- Kolom F: kosong 375, `MDU` 86, `DPT` 38, `PLN` 19 → diimpor ke `category` (sumber material). Harga (kolom G–I) tidak diekspor: bukan bagian KHS.
- **Cacat yang ditemukan oleh data asli dan diperbaiki:** uraian kode **186 dan 187** berisi pindah baris di dalam sel, dan pembaca CSV awal (per baris fisik) menghasilkan 516 kode + 4 baris rusak. `CsvTable` kini membaca record utuh (`fgetcsv`); dua test regresi ditambahkan (KHS dan material). Banyak uraian lain berisi spasi ganda.
- Ekstraksi: `python3 -I tools/extract_khs_csv.py "MASTER RAB & KKF.xlsx" khs.csv` (pustaka standar saja, baca-saja, nilai tersimpan dalam cache workbook; tidak mengeksekusi rumus/makro).
- Bukti (database test): dry run 518 baru; impor 518 draf; persetujuan 518 oleh pengguna berbeda (2,6 dtk); impor ulang 518 `UNCHANGED`.

## 5. Penerapan ke `distriva_db`
**Status (6 Nov 2026):** dua migrasi (`..._130000_create_master_data_tables`, `..._140000_create_khs_tables`) dijalankan oleh pemilik (tercatat `Ran`, batch 5). `MasterDataPermissionSeeder` dijalankan setelah backup `distriva_db_pre-masterdata-seed_*.dump` (100 KB): 7 permission, 22 grant, 9 kategori; dijalankan ulang tanpa perubahan. Diperiksa: `khs.approve` hanya `UP3_MANAGER`; `khs.manage` `ENGINEERING`+`PERENCANAAN`; `SYS_ADMIN`/`UP3_ADMIN`/`VENDOR` tidak punya grant master data. Pengguna sudah dibuat pemilik: ENGINEERING (`analuammahri@gmail.com`) dan UP3_MANAGER (`irham.maulana@pln.co.id`) di unit 5145; keputusan otorisasi keduanya diperiksa (tanpa login): engineer boleh `master_data.view`, `materials.*`, `material_categories.manage`, `units_of_measure.manage`, `khs.manage`; manager boleh `master_data.view`, `khs.approve`.
**Belum dilakukan: impor KHS ke `distriva_db`.** Sengaja tidak dijalankan oleh pengembang: setiap draf dan persetujuan harus tercatat atas nama orang yang melakukannya (pemisahan tugas). Prosedur, dijalankan oleh masing-masing orang dengan login sendiri (selama UI master data belum ada):
1. `python3 -I tools/extract_khs_csv.py "MASTER RAB & KKF.xlsx" tools/output/khs.csv` (sudah dibuat; 518 baris).
2. Engineer: `python3 tools/khs_admin.py import --email <engineer> --file tools/output/khs.csv --valid-from <YYYY-MM-DD>` (**dry run**), lalu tambahkan `--apply` untuk membuat 518 draf.
3. Manager (orang berbeda): `python3 tools/khs_admin.py approve --email <manager>` → ketik `ya`.
`--base` mengikuti port `php artisan serve` (default skrip `http://127.0.0.1:8001`). **`--valid-from` adalah fakta bisnis** (tanggal mulai berlaku KHS sesuai kontrak/SK): konfirmasi sebelum `--apply`; draf masih dapat dikoreksi (`PATCH /khs/versions/{id}`), versi yang sudah disetujui tidak (buat versi baru).
Skrip diuji lewat HTTP sungguhan pada database test: dry run 518 baru; impor 518 draf; engineer menyetujui → 403; manager menyetujui 518; impor ulang 518 tidak berubah; password salah → ditolak; tanpa draf → pesan; manager mengimpor → 403; di database: 518 draf dibuat oleh engineer dan 518 disetujui oleh manager.

## 5a. Iterasi 2B-2 — jenis konstruksi dan pemetaan KHS (dikerjakan, TESTED; belum di `distriva_db`)
**Tabel** (migrasi `2026_11_06_150000_create_construction_type_tables`): `construction_types` (kelompok, kode, `external_code` dicadangkan), `construction_type_versions` (DRAFT→APPROVED→INACTIVE, pola KHS: pembuat ≠ penyetuju, APPROVED immutable lewat trigger, satu versi APPROVED per jenis pada tanggal mana pun, versi lama ditutup otomatis sehari sebelum `valid_from` baru), `construction_khs_mappings`.
**Keputusan pemilik:** K-1 jenis konstruksi tanpa kode resmi → kode internal `<KELOMPOK>-<NN>`; K-2 hanya 7 kelompok (SUTM, MVTIC, SUTR, SKTM, KUBIKEL, GTT_UMUM, GTT_KHUSUS), SKTR/SKSR/GD PSG DLM tidak dipakai, PBPD terpisah; K-3 pembulatan workbook dipertahankan; K-4 tanggal berlaku ditetapkan admin saat impor. Kode KHS = angka 1–518 seperti di Excel.
**Deviasi dari docs/23 §2.6 (disengaja):** (1) pemetaan menunjuk **butir KHS** (`khs_items`), bukan versi KHS, agar tidak usang saat KHS berganti versi; saat persetujuan, setiap butir terpetakan wajib punya versi KHS APPROVED yang berlaku pada `valid_from`. (2) `external_code` dicadangkan (kosong).
**Aturan:** impor jenis menolak kelompok tak dikenal, duplikat, dan bentrok label; impor pemetaan menyelesaikan jenis dengan kode atau (kelompok, label) ke versi DRAFT, kode KHS harus ada, peran `DIRECT`/`SHARED`, kolom yang tidak ada di berkas tidak menghapus nilai; persetujuan butuh ≥1 pemetaan.
**Alat:** `tools/extract_construction_csv.py` (→ `construction_types.csv` 132 baris, `construction_mappings.csv` 1.617 baris gabungan, `fixed_items.csv` 105 butir tetap), `tools/khs_admin.py` subperintah `types-import`, `mappings-import`, `types-approve`.
**Bukti pada data asli (database test, lewat HTTP sungguhan):** 132 jenis, 1.617 pemetaan, 129 disetujui, **3 tanpa pemetaan** sehingga tidak dapat disetujui: SUTM-05 (Tibet 11/200), SUTM-26 (TM 10XC), MVTIC-02 (Tibet 11/200) — perlu keputusan pemilik. 315 baris `SHARED` dan 105 butir tetap dicadangkan untuk 2C (BOM/rumus). Tes: 24 tes baru (`MasterDataConstructionTest`).
**Penerapan ke `distriva_db` (6 Nov 2026, atas persetujuan pemilik):** backup `backups/distriva_db_pre-construction-types_20261106-122224.dump` (103 KB, 226 entri); uji restore ke database sementara (4 pengguna, 4 penugasan, 16 permission, 17 migrasi, 2 unit — identik) lalu database sementara dihapus; `php artisan migrate` (migrasi 150000, DONE); `MasterDataPermissionSeeder` dijalankan dua kali (idempoten). Diperiksa: `construction_types.manage` → ENGINEERING, PERENCANAAN; `construction_types.approve` → UP3_MANAGER; 18 permission; tabel `construction_types` kosong.
**Keputusan pemilik:** 3 jenis tanpa pemetaan (SUTM-05, SUTM-26, MVTIC-02) **dikecualikan**; alat ekstraksi kini menyaringnya dan mencatat ke stderr → `construction_types.csv` 129 baris.
**SELESAI (dilaporkan pemilik, diverifikasi baca-saja 6 Nov 2026):** `distriva_db` berisi 518 versi KHS APPROVED, 129 jenis konstruksi dengan 129 versi APPROVED, dan 1.617 pemetaan.
**(Riwayat) langkah manusia** (login masing-masing, `tools/khs_admin.py`, `--valid-from` ditetapkan admin): engineer `import` KHS (dry run lalu `--apply`) → manager `approve` KHS → engineer `types-import`, lalu `mappings-import` → manager `types-approve`.

## 6. Batasan
Tidak ada UI; audit kategori/satuan hanya timestamp (belum ada riwayat); tidak ada pencarian KHS berdasarkan uraian parsial per kata; impor hanya CSV (belum xlsx/API ERP); validasi `category` KHS bebas teks (belum katalog kategori KHS); material belum terhubung ke KHS/BOM (iterasi berikutnya).
