# 60 — Desain 2C: BOM dan Mesin Rumus

**Tanggal:** 6 November 2026 · **Status:** 2C-1 (mesin rumus + uji emas) **SELESAI dan TESTED**. 2C-2 (tabel BOM, impor, persetujuan, kalkulator) **desain DISETUJUI pemilik (6 Nov 2026) dan kode SELESAI + TESTED di basis data test; migrasi 170000 DITERAPKAN ke `distriva_db` 6 Nov 2026** (backup `backups/distriva_db_pre-bom_*.dump`, uji restore identik, seeder dua kali; `bom.manage` = ENGINEERING/PERENCANAAN/SYS_ADMIN, `bom.approve` = SYS_ADMIN/UP3_MANAGER; 20 permission; `bom_headers` kosong — impor oleh engineer/manager menunggu).

## 1. 2C-1 — Mesin rumus (selesai)
`backend/app/Formula/`: `Parser` (teks → AST JSON, tata bahasa tertutup), `Evaluator` (deterministik, tanpa `eval`), `Resolver` (antarmuka sumber nilai), `FormulaException`.
- **Tata bahasa:** angka, teks, sel/rentang (`GAMBAR!U6`, `I13:I18`), variabel DISTRIVA `{nama}`, `+ − × ÷ ^ %`, `&`, perbandingan; fungsi diizinkan **hanya** `IF OR AND SUM TRUNC ROUND ROUNDUP SUMIF`. Fungsi lain, titik koma, panjang > 2.000, kedalaman > 40, rentang > 5.000 sel → ditolak. AST murni data (round-trip JSON diuji).
- **Semantik (keputusan K-3, pembulatan workbook dipertahankan):** `TRUNC` ke arah nol; `ROUND` setengah menjauhi nol; `ROUNDUP` menjauhi nol dengan toleransi 1e-12 (menyerap derau biner); `IF` malas; **sel kosong = 0 = ""** (kunci kecocokan PBPD, lihat §3); urutan angka < teks < boolean, teks tak peka huruf besar-kecil.
- **Uji emas** (`tests/Unit/FormulaGoldenWorkbookTest`, fixture `tests/fixtures/golden_bom.json.gz` dari `tools/golden_vectors.py`): 6.408 rumus volume (kolom H–K) di 9 sheet BOM, dibaca ulang dari workbook, dievaluasi oleh mesin produksi, dibandingkan dengan hasil tersimpan Excel → **6.408 dari 6.408 cocok**. Tes unit: 6 tes (prioritas operator, pembulatan, sel kosong, SUMIF/rentang, penolakan kode/fungsi asing, AST sebagai JSON).
- **Menutup temuan terbuka docs/59:** "9 selisih PBPD 53–197 kVA" (dengan pembacaan penuh: 17 sel) bukan data basi: rumus `IF(B13="",0,…)` memperlakukan sel kosong sebagai `""`; evaluator analisis lama menganggapnya `0`. Mesin produksi menanganinya dan semua cocok.
- **Batas bukti:** satu skenario input (nilai contoh tersimpan di `GAMBAR`); membuktikan semantik rumus, bukan semua kombinasi input. Kolom harga, REKAP, K3L/asuransi/commissioning belum dicakup.

## 2. 2C-2 — Model BOM (usulan, menunggu persetujuan)
**Penyimpangan dari docs/23 §2.7 yang diusulkan** (alasan terukur di docs/59): BOM di workbook **bukan** koefisien per konstruksi. Baris dapat bergantung pada beberapa konstruksi (±98 baris), pada baris lain, atau tetap (105), dan `TRUNC` bekerja pada kuantitas **agregat** (K-3). Karena itu:
- `bom_headers`: **satu per kelompok** (SUTM, MVTIC, SUTR, SKTM, KUBIKEL, GTT_UMUM, GTT_KHUSUS), bukan per versi jenis konstruksi; `version_number`, `valid_from/until`, status `DRAFT→APPROVED→INACTIVE`, pembuat ≠ penyetuju (CHECK database), APPROVED immutable, satu versi aktif per kelompok per tanggal, penutupan otomatis — pola persis KHS/jenis konstruksi.
- `bom_lines`: `bom_header_id`, `sequence`, `khs_item_id` (butir KHS), empat rumus AST jsonb (`material`, `install`, `remove`, `return` = kolom H/I/J/K), `source_reference` (sheet!baris), catatan. Kuantitas = hasil evaluasi, bukan kolom tetap.
- Variabel rumus (nama `{…}`): `PSG:<kode jenis>` dan `BKR:<kode jenis>` (jumlah pasang/bongkar tiap jenis konstruksi, mis. `{PSG:SUTM-05}`), `LINE:<sequence>:<H|I|J|K>` (keluaran baris lain), `PARAM:<nama>` (masukan lain di sheet GAMBAR, mis. pilihan dropdown; terdaftar di `bom_parameters` dengan tipe, bawaan, deskripsi — wajib ditinjau manusia).
- Impor oleh alat Python (pola `khs_admin.py`): menerjemahkan referensi sel `GAMBAR` ke variabel lewat pemetaan jenis konstruksi 2B-2; baris yang tak dapat diterjemahkan **ditolak dan dilaporkan**, tidak ditebak (docs/23).
- Kalkulator `BomCalculator::calculate(header, input)` → hasil per baris; deteksi siklus; batas kedalaman.
- Izin: `bom.manage` (ENGINEERING, PERENCANAAN, SYS_ADMIN), `bom.approve` (UP3_MANAGER, SYS_ADMIN); baca = `master_data.view`.
- **Uji emas end-to-end:** setelah impor ke basis data test, mengevaluasi BOM dengan input tersimpan harus mereproduksi nilai H–K tiap baris (7 kelompok; ±1.500 baris × 4 kolom).
- **Di luar cakupan:** sheet PBPD (`6,6-41,5 KVA`, `53-197 KVA`; iterasi terpisah, mesin sudah terbukti cocok), SKTR/SKSR/GD PSG DLM, harga (BPP/RAB/KKF), konversi satuan.

## 3. Keputusan yang diminta dari pemilik
1. Setuju BOM **per kelompok** (bukan per versi jenis konstruksi seperti docs/23)?
2. Setuju izin `bom.manage`/`bom.approve` seperti usulan?
3. `PARAM:*` (masukan non-jumlah di GAMBAR): ditinjau oleh engineer saat impor (daftar disajikan, bawaan diambil dari nilai tersimpan workbook)?

## 4. Keputusan pemilik (6 Nov 2026) dan hasil implementasi 2C-2
Disetujui: (1) BOM per kelompok; (2) izin `bom.manage` (ENGINEERING, PERENCANAAN, SYS_ADMIN) dan `bom.approve` (UP3_MANAGER, SYS_ADMIN), pembuat ≠ penyetuju; (3) masukan non-jumlah ditinjau engineer.
**Temuan:** pada 7 kelompok **tidak ada** `PARAM:*` — seluruh referensi `GAMBAR` hanyalah kolom jumlah (U, V, X, Y, AA, AB). Maka tabel `bom_parameters` tidak dibuat (tidak diperlukan).
**Implementasi:**
- Migrasi `2026_11_06_170000_create_bom_tables`: `bom_headers` (status DRAFT→APPROVED→INACTIVE, CHECK pembuat ≠ penyetuju, exclusion constraint satu versi APPROVED per kelompok per tanggal, trigger immutable), `bom_lines` (sequence = nomor baris workbook; `formulas` jsonb {H,I,J,K}=AST; `source_formulas` teks asli; trigger: baris versi non-DRAFT immutable), `bom_events` (append-only).
- `App\Services\Bom\BomService` (impor dry-run/nyata, ubah draf, setujui, nonaktifkan), `BomAst` (menerjemahkan `GAMBAR!U6` → `{PSG:<kode>}`, rentang kolom jumlah GAMBAR → node `list`, memeriksa semua rujukan lain), `BomCalculator` (kalkulasi murni; baris lain = rujukan sel; deteksi siklus).
- Impor **menolak seluruh berkas** bila satu baris tak dapat diterjemahkan (BOM saling bergantung) dan melaporkan baris/alasan; tidak menebak. Persetujuan mensyaratkan: bebas siklus, setiap kode KHS punya versi KHS APPROVED pada `valid_from`, setiap jenis konstruksi yang dipakai APPROVED pada `valid_from`.
- API (docs/57 §3a): `GET /master-data/bom`, `GET /bom/{id}`, `GET /bom/{id}/lines`, `POST /bom/import`, `PATCH /bom/{id}`, `POST /bom/versions/approve`, `POST /bom/{id}/retire`, `POST /bom/{id}/calculate`.
- Alat: `tools/extract_bom_json.py` (bom_<GROUP>.json + fixture uji emas), `tools/khs_admin.py bom-import | bom-approve`.
- **Uji emas end-to-end** (`MasterDataBomTest::every_line_of_the_seven_real_boms…`): 7 BOM nyata (1.628 baris) diimpor lewat API, disetujui orang lain, lalu dihitung dengan jumlah tersimpan di `GAMBAR`; **seluruh nilai H–K (6.512) cocok** dengan hasil Excel.
- **Cacat yang ditemukan oleh uji dan diperbaiki:** (a) closure panah menyalin `$problems` sehingga rujukan tak dikenal di dalam argumen fungsi lolos tak terlapor — kini ditolak (tes regresi); (b) agregat `SUM(GAMBAR!U6:U9)` dan `SUMIF(B9:B647,…)` pada rekap SUTM perlu didukung (node `list`, rentang kolom B).
- **Temuan data untuk pemilik (6 formula dikeluarkan dari impor, bukan ditebak):** pada 6 kelompok, satu baris (uji commissioning, kode KHS 69) memiliki rumus kolom H `+GAMBAR!<kolom jumlah><baris judul>` yang menunjuk **sel kosong** di judul tabel GAMBAR (SUTM 651 → U5, MVTIC 490 → X5, SKTM 56 → U54, KUBIKEL 35 → X54, GTT_UMUM 222 → AA5, GTT_KHUSUS 192 → AA24); nilai tersimpan 0. Alat ekstraksi memisahkannya ke daftar `review` (`bom_<GROUP>.json`); baris tetap diimpor tanpa rumus H. Perlu keputusan engineer apakah volume material baris itu memang 0 atau salah rujuk.

## 5. Parameter BOM: volume commissioning test (jawaban pemilik/engineer, 6 Nov 2026)
Enam rumus H yang menunjuk sel kosong `GAMBAR` ternyata **masukan sengaja**: volume uji commissioning diambil dari halaman gambar (SUTM `U5`, MVTIC `X5`, SKTM `U54`, KUBIKEL `X54`, GTT_UMUM `AA5`, GTT_KHUSUS `AA24`); nilainya masih 0 di workbook, sehingga hasilnya 0. Maka rumus **tidak dibuang**, melainkan dijadikan **parameter bernama** pada versi BOM:
- Migrasi `2026_11_06_180000`: `bom_headers.parameters` jsonb `[{name,cell,description,default,group}]`, termasuk isi yang dilindungi trigger immutable. Nama: `COMMISSIONING:<KELOMPOK>`; variabel rumus `{PARAM:COMMISSIONING:SUTM}`.
- Impor: parameter harus **dideklarasikan** di berkas (`params`); sel `GAMBAR` lain yang bukan jumlah konstruksi tetap ditolak (tidak pernah ditebak). Bentrok dengan sel jumlah/duplikat/nama tidak valid/nilai bawaan negatif → ditolak.
- Hitung: `POST /master-data/bom/{id}/calculate` menerima `params:{nama: angka ≥ 0}`; bila tidak diisi dipakai nilai bawaan versi (0). Parameter yang tidak dideklarasikan → 422. `GET /bom/{id}` menampilkan `parameters`.
- Persetujuan: variabel `PARAM:*` tidak memerlukan jenis konstruksi; hanya `PSG:/BKR:` yang diperiksa.
- **Konsekuensi untuk `distriva_db`:** BOM v1 (disetujui 1 Nov 2026) tidak memuat rumus H baris commissioning (dikeluarkan saat impor) dan **immutable**. Perbaikannya adalah **versi 2** untuk 6 kelompok (SUTR tidak berubah) dengan `valid_from` lebih akhir dari 1 Nov 2026; v1 ditutup otomatis sehari sebelumnya. Migrasi 180000 **DITERAPKAN ke `distriva_db` 6 Nov 2026** (backup `backups/distriva_db_pre-bomparams_*.dump`, uji restore identik: 7 header, 1.628 baris, 14 peristiwa; 7 BOM v1 tetap APPROVED, `parameters` = `[]`). Yang tersisa: impor/persetujuan ulang oleh engineer/manager (`bom-import --group …`).
