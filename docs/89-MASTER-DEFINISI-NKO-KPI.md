# 89 — Master Definisi NKO/KPI Berversi (Tahap 2)

Lanjutan docs/86 dan docs/88. Tahap ini mengekstrak **definisi** NKO/KPI dari workbook realisasi (`REALISASI UP3 MJK&ULP 2026 REV 3 (2 JUN 2026).xlsx`) menjadi master berversi di database. Angka realisasi belum dihitung di sini (tahap 3); yang disimpan adalah struktur indikator, polaritas, bobot, target kumulatif bulanan per unit, serta aturan pencapaian dan nilai agar tahap 3 dapat dihitung dan **divalidasi terhadap workbook**.

## 1. Temuan dari workbook

- Tab `UP3 MOJOKERTO` dan sepuluh tab `ULP ...`. Set indikator UP3 (51 baris, 12 kelompok) berbeda dari ULP (47 baris, 11 kelompok): bobot dan sebagian indikator tidak sama, maka definisi disimpan **per tingkat unit**. Semua ULP memakai definisi dan bobot yang sama.
- **Polaritas**: 1 = makin kecil makin baik (SAIDI, SAIFI, ENS, susut, kerusakan, gangguan TM, response time, saldo piutang, NAC), 2 = rentang (anggaran investasi sesuai RKAP, target "95 - 105"), 3 = makin besar makin baik.
- **Target dan realisasi bersifat kumulatif (YTD)** per bulan; target tahunan = nilai Desember (kolom X), target semester I = nilai Juni (kolom R).
- **Pencapaian** (rumus bulan pertama): `STANDARD` — polaritas 3: realisasi/target, polaritas 1: 2 − realisasi/target, dibatasi 0 sampai 1,1, lalu ×100; `FLOOR_60` — hanya Penjualan Tenaga Listrik: bila di bawah target, 0,6 + 0,4 × rasio; `RANGE_BAND` — indikator berpolaritas 2; `FIXED` — nilai tetap 100 (indikator yang belum diukur, mis. RUPTL, Lisdes, penghapusan ATTB/NAC); `RATIO_DEFAULT_100` — rasio, bernilai 100 bila target 0.
- **Nilai indikator** = pencapaian/100 × bobot, maksimum bobot × 1,1. Pada ULP, empat kelompok (RUPTL, Cash In, Digitalisasi, Layanan Pelanggan sebagian) memakai `TRUNC(RATA-RATA pencapaian × bobot, 2)/100`; dua baris induk menjumlahkan anak (`SUM_CHILDREN`).
- **Aturan total dan NKO akhir berubah menurut bulan.** Januari sampai Mei ULP: jumlah nilai dikurangi anak yang sudah terhitung pada induknya dan indikator Lisdes, NKO akhir dibagi `(100 − bobot Lisdes)`. Mulai Juni: pengurang berbeda dan NKO akhir = jumlah nilai tanpa pembagian. UP3 mengganti `SUM(...)` dengan penjumlahan eksplisit mulai Juni. Karena itu aturan disimpan **per bulan** (`kpi_definition_sets.month_rules`), bersama nilai total dan NKO akhir dari workbook sebagai angka acuan rekonsiliasi.
- **Sumber realisasi workbook** berupa lembar pada workbook perantara luar (`[48]`), 30 lembar, mis. `SAIDI`, `SAIFI`, `ENS`, `PENJUALAN TL`, `SUSUT TOTAL TNP E MIN`, `MVOD`, `PENAMBAHAN JML PELANGGAN`. Nama lembar disimpan pada `kpi_definitions.source_sheet` sebagai dasar pemetaan data (tahap pemetaan ke sumber DISTRIVA: SAIDI/SAIFI/ENS dari laporan DIFI hasil impor, sesuai keputusan pemilik).
- **Ketidakselarasan workbook** (dicatat sebagai peringatan pada set, bukan diperbaiki diam-diam):
  1. Tab ULP, indikator "Perolehan kWh P2TL" dan "Penyelesaian Ganti Meter": rumus pencapaian merujuk polaritas dan satuan baris lain (`$C52`, `$C53`). Hasil kebetulan sama karena polaritas dan satuannya sama.
  2. Aturan pencapaian berbeda pada satu-dua tab dibanding tab lain: Penjualan TL dan Penambahan Aset RUPTL (ULP Jombang), Pelunasan PRR (ULP Mojokerto dan Nganjuk).
  3. Bobot "Kepatuhan, Maturity Level, Tata Kelola" berbentuk "Max - 3" (pengurang), disimpan pada `weight_note`, bukan bobot.

## 2. Skema

| Tabel | Isi |
|---|---|
| `kpi_definition_sets` | satu set per `year` + `unit_level` (ULP/UP3) + `version`; `source_name`, `source_sha256`, `total_weight`, `month_rules`, `warnings`, status `AKTIF`/`ARSIP` (satu aktif per tahun dan tingkat) |
| `kpi_definitions` | pohon indikator: `level` (0 kelompok, 1 indikator, 2 sub), `parent_id`, `code` (slug stabil), `number`, `name`, `polarity`, `unit_label`, `weight`, `weight_note`, `formula_text` (definisi pada kontrak manajemen), `source_sheet`, `scoring_rule`, `nilai_rule`, `rules` (rumus mentah realisasi/pencapaian/nilai) |
| `kpi_targets` | target kumulatif per `definition_id` + `organizational_unit_id` + `period` (tanggal 1 bulan): `target_value` atau `target_text` untuk rentang |

Impor idempoten dengan SHA-256 berkas: isi sama = `DUPLIKAT`; isi berbeda membuat versi berikutnya (`DIGANTIKAN`, set lama `ARSIP`); isi lama yang pernah digantikan tidak diaktifkan ulang (`SUDAH_DIGANTIKAN`). Snapshot nilai (tahap 3) akan menunjuk ke set yang dipakai.

## 3. Menjalankan

```
php artisan distriva:nko-import-definitions "tools/samples/REALISASI UP3 MJK&ULP 2026 REV 3 (2 JUN 2026).xlsx"
```

Workbook juga bisa diunggah dari aplikasi dengan persetujuan berjenjang (docs/93 §10).

Hasil muat contoh ke `distriva_db`: UP3 2026 v1 (51 definisi, 420 target, UP3 Mojokerto) dan ULP 2026 v1 (47 definisi, 3.840 target, sepuluh ULP). Unit dicocokkan dengan nama pada master (`UP3 Mojokerto`, `ULP Jombang`, dst.); tab unit yang belum ada di master dilewati dengan peringatan. Untuk UP3 lain (mis. Ponorogo) cukup tambah tab dengan tata letak yang sama pada workbook dan pastikan unitnya ada di master.

Kode: `app/Services/Nko/NkoWorkbookReader.php` (baca tab), `NkoDefinitionImportService.php` (versi dan simpan), `app/Console/Commands/NkoDefinitionsImportCommand.php`; tes `tests/Feature/NkoDefinitionImportTest.php`.

## 4. Belum dikerjakan (tahap berikutnya)

- Tahap 3: hitung realisasi, pencapaian, nilai, dan NKO akhir dengan aturan per bulan, simpan sebagai snapshot berversi, lalu rekonsiliasi terhadap angka acuan workbook (`month_rules.months[*].total_value/final_value`) dan peringkat (tab RANGKING).
- Pemetaan sumber realisasi ke data DISTRIVA: DIFI (SAIDI, SAIFI, ENS), laporan 309 (penjualan, pelanggan, daya), gangguan dan keluhan (gangguan TM, rating negatif), piutang (saldo, pelunasan), dll. Sebagian indikator (RUPTL, aset, kepatuhan, PLN Mobile) tidak punya sumber di DISTRIVA dan akan menjadi masukan manual atau tetap `FIXED`.
- API dan layar untuk agen frontend (kontrak ditulis bersama tahap 3).
- Izin akses NKO belum didefinisikan; menunggu keputusan pembagian peran.
