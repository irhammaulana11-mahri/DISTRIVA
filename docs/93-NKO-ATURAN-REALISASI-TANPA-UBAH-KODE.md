# 93 — Aturan Realisasi NKO Tanpa Ubah Kode

Status: rancangan disetujui pemilik (26 Nov 2026). **Tahap 1 sampai 3 selesai** (pemetaan dan rumus realisasi di data dengan hasil identik, pencocokan definisi). Tahap 4 belum.

## 1. Tujuan

Item kinerja NKO bisa bertambah, berkurang, berganti nama, atau berubah cara hitungnya, sementara data pengusahaan yang dipakai umumnya tetap. Perubahan seperti itu tidak boleh memerlukan perubahan aplikasi.

## 2. Tiga lapisan

| Lapisan | Isi | Tempat |
|---|---|---|
| Definisi | Item, bobot, target, rumus nilai | Impor workbook berversi (docs/89), sudah ada |
| Katalog besaran | Cara mengambil data pengusahaan dan penjumlahannya ke UP3 | Kode (jarang berubah) |
| Aturan realisasi | Indikator mana memakai besaran/rumus apa, status validasi, berlaku mulai kapan | Tabel `kpi_realization_rules` |

## 3. Tabel aturan (tahap 1 dan 2, selesai)

`kpi_realization_rules`:

| Kolom | Arti |
|---|---|
| `definition_code` | kode indikator |
| `formula` | rumus atas besaran katalog atau masukan yang dideklarasikan |
| `inputs` | masukan manual baru yang dipakai rumus: `[{"code","name","unit_label"}]` |
| `is_validated` | sudah cocok dengan workbook (`system_validated`) |
| `flag_when_negative` | nilai minus ditandai `NEGATIF` |
| `effective_from` | berlaku mulai periode ini; per indikator dipakai baris terbaru yang tidak melewati periode |

Kode: `NkoSourceCatalog` (daftar besaran), `NkoFormula` (evaluator), `NkoRealizationRules` (aturan per periode), `NkoRealizationResolver` (menghitung besaran dan mengevaluasi rumus).

Isi awal: 12 aturan dengan rumus satu besaran jadi, sama dengan pemetaan sebelum tahap 1. Hasil resolver pada data nyata (semua unit, 12 bulan 2026) identik sebelum dan sesudah. Bentuk API tidak berubah.

## 4. Bahasa rumus

- Angka (desimal dengan titik), nama besaran, `+ - * /`, kurung.
- Fungsi: `abs(x)`, `min(a, b, ...)`, `max(a, b, ...)`, `atau(x, pengganti)`.
- Data belum ada membuat hasil kosong, tidak dianggap 0, kecuali diberi pengganti dengan `atau`. Pembagian nol juga kosong.
- Nama tidak dikenal atau rumus salah susun melempar galat (tidak diam-diam kosong). Tidak memakai `eval`; maksimal 500 karakter.

Evaluator ditulis sendiri, bukan PhpSpreadsheet seperti rencana awal, agar "data kosong" tidak menjadi 0 dan hanya nama katalog yang dapat dipakai.

## 5. Katalog besaran

Semua kumulatif Januari sampai bulan berjalan, kecuali posisi (`_akhir`, `_awal`). Penjumlahan UP3: **JUMLAH** = jumlah semua ULP (satu ULP kosong membuat UP3 kosong); **LANGSUNG** = dihitung dari data seluruh ULP. Rumus dievaluasi sesudah penjumlahan, sehingga rasio di UP3 adalah rasio dari jumlah.

| Besaran jadi (rumus baku, docs/90) | UP3 |
|---|---|
| `saidi_menit`, `saifi_kali`, `ens_mwh`, `gangguan_penyulang`, `response_ggnall`, `rating_negatif_ggn`, `susut_hitung` (%), `hpl_bp` (Rp miliar) | LANGSUNG |
| `pelanggan_309`, `daya_309` (MVA), `penjualan_selisih` (GWh), `pelunasan_prabayar` (Rp juta) | JUMLAH |

| Besaran dasar | UP3 |
|---|---|
| `pelanggan_309_akhir`, `pelanggan_309_awal`, `daya_va_309_akhir`, `daya_va_309_awal` | JUMLAH |
| `kwh_jual`, `kwh_jual_tahun_lalu`, `ba_penjualan` (kWh) | JUMLAH |
| `kwh_beli`, `e_min`, `pssd` (kWh, masukan) | JUMLAH |
| `lunas_prabayar`, `lunas_prr`, `lunas_ex_prr` (Rp juta) | JUMLAH |
| `response_total_durasi`, `response_jumlah_wo`, `bp_kas_rp`, `bp_total_biaya_rp` | LANGSUNG |

Menambah besaran baru (sumber data baru) tetap perlu kode: satu baris di `NkoSourceCatalog` dan perhitungannya di resolver.

Contoh rumus:

| Keperluan | Rumus |
|---|---|
| Penjualan TL terhadap tahun lalu (GWh) | `(kwh_jual - kwh_jual_tahun_lalu) / 1000000` |
| Pertumbuhan pelanggan (%) | `pelanggan_309 / pelanggan_309_awal * 100` |
| Pelunasan tanpa Ex-PRR (Rp juta) | `lunas_prabayar + atau(lunas_prr, 0)` |

## 6. Masukan manual baru

Dideklarasikan di `inputs`; kodenya huruf kecil, angka, dan garis bawah, tidak boleh sama dengan nama besaran atau kode indikator. Muncul otomatis di `GET /nko/inputs` sebagai masukan pembantu. UP3 = jumlah masukan semua ULP.

## 7. Batasan saat ini

- Belum ada layar atau API untuk mengubah aturan; sementara hanya lewat data. Pemeriksaan isi aturan saat disimpan (nama dikenal, kode masukan tidak bentrok) dikerjakan di tahap 4, jadi aturan salah yang disisipkan langsung membuat halaman NKO galat.
- `kpi_baselines` (baseline adjustment) dan tautan target menu pengusahaan (`BusinessTargetService::LINKS`) masih memakai kode indikator tetap.
- Mengubah rumus tidak mengubah snapshot yang sudah dihitung, tetapi hitung ulang periode lama memakai aturan yang berlaku pada periode itu.

## 8. Pencocokan definisi (tahap 3, selesai)

Dijalankan otomatis setelah `distriva:nko-import-definitions` membuat versi baru, dan dapat diulang kapan saja:

```
php artisan distriva:nko-mapping 2026
```

Isi laporan (`NkoMappingCheckService`, hanya membaca):

- **Bertambah / hilang**: dibanding versi sebelumnya tahun itu, atau set terakhir tahun sebelumnya, per tingkat unit.
- **Aturan tanpa item** (item dihapus atau berganti nama): beserta jumlah masukan manual tahun itu yang masih memakai kode lama, menu pengusahaan yang targetnya menunjuk kode itu, dan paling banyak tiga saran pengganti (skor minimal 0,6: kemiripan nama 0,6, lembar sumber 0,2, satuan 0,1, polaritas 0,1).
- **Item tanpa aturan**: item yang butuh realisasi tetapi diisi manual.

Saran tidak diterapkan otomatis; perubahan aturan menunggu persetujuan berjenjang (tahap 4). Kode indikator diturunkan dari nama (`kpi_definitions.code`), jadi ganti nama selalu berarti kode baru; nama kembar mendapat akhiran nomor baris yang ikut bergeser bila baris disisipkan.

Hasil pada data 2026 (26 Nov 2026): 12 aturan semuanya masih cocok dengan item; 18 item tanpa aturan.

## 9. Tahap berikutnya

4. **API dan layar pengaturan aturan**: mode MANUAL / SISTEM / SISTEM_BOLEH_KOREKSI, validasi, menerapkan saran pemetaan (termasuk masukan manual dan tautan kode tetap), pratinjau dan rekonsiliasi dengan angka workbook, persetujuan berjenjang **PERENCANAAN mengusulkan, ASMAN_PERENCANAAN menyetujui** (keputusan pemilik), snapshot menyimpan versi aturan. Dicatat di README-REVISI saat dikerjakan.
