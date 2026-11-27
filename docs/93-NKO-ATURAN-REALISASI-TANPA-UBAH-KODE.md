# 93 — Aturan Realisasi NKO Tanpa Ubah Kode

Status: rancangan disetujui pemilik (26 Nov 2026). **Tahap 1 sampai 4 selesai di backend** (rumus realisasi di data, pencocokan definisi, API usulan dan persetujuan). Layar frontend: lihat README-REVISI.

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

- Menambah besaran baru (sumber data baru) tetap perlu kode.
- `kpi_baselines` (baseline adjustment) tetap disimpan dan dibaca dengan kode `penjualan-tenaga-listrik`, apa pun nama itemnya; besaran `ba_penjualan` tetap bisa dipakai rumus mana pun.
- Aturan berlaku menurut kode indikator untuk semua unit; belum ada rumus khusus per unit.
- Tidak ada penghapusan aturan. Untuk mematikan sumber otomatis, usulkan mode MANUAL.
- Bila sudah ada aturan dengan `effective_from` lebih baru, aturan itu tetap menang untuk periodenya.
- Aturan yang disisipkan langsung ke database tidak diperiksa; selalu lewat usulan.

## 8. Pencocokan definisi (tahap 3, selesai)

Dijalankan otomatis setelah `distriva:nko-import-definitions` membuat versi baru atau setelah unggahan workbook disetujui (§10), dan dapat diulang kapan saja:

```
php artisan distriva:nko-mapping 2026
```

Isi laporan (`NkoMappingCheckService`, hanya membaca):

- **Bertambah / hilang**: dibanding versi sebelumnya tahun itu, atau set terakhir tahun sebelumnya, per tingkat unit.
- **Aturan tanpa item** (item dihapus atau berganti nama): beserta jumlah masukan manual tahun itu yang masih memakai kode lama, menu pengusahaan yang targetnya menunjuk kode itu, dan paling banyak tiga saran pengganti (skor minimal 0,6: kemiripan nama 0,6, lembar sumber 0,2, satuan 0,1, polaritas 0,1).
- **Item tanpa aturan**: item yang butuh realisasi tetapi diisi manual.

Saran tidak diterapkan otomatis; perubahan aturan menunggu persetujuan berjenjang (tahap 4). Kode indikator diturunkan dari nama (`kpi_definitions.code`), jadi ganti nama selalu berarti kode baru; nama kembar mendapat akhiran nomor baris yang ikut bergeser bila baris disisipkan.

Hasil pada data 2026 (26 Nov 2026): 12 aturan semuanya masih cocok dengan item; 18 item tanpa aturan.

## 9. Pengaturan aturan (tahap 4)

Alur: **PERENCANAAN mengusulkan, ASMAN_PERENCANAAN menyetujui atau menolak**. Aturan berubah hanya setelah disetujui. Pengusul tidak boleh memutus usulannya sendiri (berlaku juga untuk SYS_ADMIN). Persetujuan tidak menghitung ulang NKO.

### Mode

| Mode | Nilai sistem | Masukan manual |
|---|---|---|
| `SISTEM_BOLEH_KOREKSI` (bawaan) | ya | boleh mengoreksi, wajib alasan |
| `SISTEM` | ya | ditolak (422); masukan lama diabaikan |
| `MANUAL` | tidak | diisi manual; tanpa rumus |

### Izin

| Izin | Peran |
|---|---|
| `nko.view` | membaca aturan, katalog, pencocokan, usulan, pratinjau |
| `nko.rules.propose` | PERENCANAAN, SYS_ADMIN (MFA) |
| `nko.rules.approve` | ASMAN_PERENCANAAN, SYS_ADMIN (MFA) |

Karena aturan berlaku untuk semua unit, kedua izin tulis hanya berlaku bila perannya bertugas di UP3 (peran tingkat ULP dijawab 403). `GET /planning/access` memuat kedua kunci. Seeder: `NkoPermissionSeeder`.

### API (di bawah `/api/nko`)

Galat: 403 tanpa izin, 404 usulan tidak ada, 409 bentrok keadaan, 422 isi tidak sah (`message` memuat alasannya).

| Metode dan jalur | Fungsi |
|---|---|
| `GET /rules?year=&month=` | `items[]` semua indikator yang butuh realisasi: `definition_code, name, unit_label, levels[], has_rule, mode, formula, inputs[]` (`code, name, unit_label`), `is_validated, flag_when_negative, effective_from` (`YYYY-MM`; `2000-01` = aturan bawaan), `replaces_code`. `has_rule=false`: kolom aturan null (diisi manual) |
| `GET /rules/catalog` | `quantities[]` (`name, label, unit_label, up3_aggregation`), `functions[]` (`name, min_args, max_args`), `operators[]`, `modes[]` |
| `GET /rules/mapping?year=` | `year`, `changes` (per tingkat: `compared_with, added[], removed[]`; `[]` bila definisi tahun itu belum ada), `orphaned[]` (`code, name, formula, manual_inputs, linked_menus[], suggestions[]` berisi `code, name, level, score`), `unmapped[]` (`code, name, levels[]`) |
| `POST /rules/preview` | body `{definition_code, formula, inputs?[], year, to_month?}`; tidak menyimpan. `rows[]`: `unit_id, unit_name, unit_type, month, proposed, current, reference` (angka workbook), `matches` (null bila salah satunya kosong); `summary`: `with_value, compared, matched, tolerance_pct` (0,5%). Hanya unit dalam cakupan pembaca. Masukan baru yang belum pernah diisi membuat `proposed` kosong. Pada data nyata 4 sampai 15 detik untuk 9 bulan semua unit (diukur 26 Nov 2026), jadi tampilkan indikator muat dan batasi `to_month` bila perlu |
| `GET /rule-proposals?status=` | maksimal 200, terbaru dulu: `id, definition_code, definition_name, mode, formula, inputs, is_validated, flag_when_negative, effective_from, replaces_code, reason, status` (`MENUNGGU, DISETUJUI, DITOLAK, DIBATALKAN`), `proposed_by {id,name}, proposed_at, decided_by, decided_at, decision_note` |
| `POST /rule-proposals` | body `{definition_code, mode, formula?, inputs?[], effective_from: "YYYY-MM", is_validated?, flag_when_negative?, replaces_code?, reason}`; 201 `data.id`. 409 bila masih ada usulan menunggu untuk indikator dan bulan yang sama |
| `POST /rule-proposals/{id}/decision` | `{decision: "approve"\|"reject", note?}`; `note` wajib saat menolak. Respons `data {status, copied_inputs}` |
| `DELETE /rule-proposals/{id}` | pengusul membatalkan usulan yang masih menunggu |

Pemeriksaan usulan (diulang saat disetujui): indikator ada di definisi aktif tahun berlaku dan butuh realisasi; rumus sah dan hanya memakai besaran katalog atau masukan yang dideklarasikan; kode masukan huruf kecil/angka/garis bawah, dipakai rumus, tidak sama dengan besaran, fungsi, atau indikator; mode MANUAL tanpa rumus.

### Item berganti nama

Usulkan aturan untuk kode baru dengan `replaces_code` kode lama (rumus lama dan saran pengganti ada di `GET /rules/mapping`). Saat disetujui: masukan manual kode lama sejak bulan berlaku **disalin** ke kode baru (yang sudah ada tidak ditimpa), target menu pengusahaan mengikuti kode baru, dan kode lama tidak lagi dilaporkan sebagai aturan tanpa item. Lewat template dengan KODE tetap (§11), ganti nama tidak memerlukan langkah ini.

### Perubahan pada API yang sudah ada

- `GET /nko/inputs`: butir indikator memuat `mode` (null bila tanpa aturan) dan `required` (butuh realisasi bulan itu); masukan pembantu tidak memuat keduanya. `editable=false` juga pada mode `SISTEM`; `system_source=false` pada mode `MANUAL`.
- `GET /nko/gaps`: indikator mode `SISTEM` yang kosong tetap dilaporkan.
- `GET /nko/snapshots/{id}`: `values[]` memuat `formula`, rumus yang menghasilkan nilai sistem (null untuk nilai manual dan snapshot lama).

## 10. Unggah workbook definisi (tahap 5)

Item kinerja bertambah, berkurang, atau berganti nama, serta bobot dan target, tetap berasal dari workbook realisasi (docs/89). Sekarang workbook bisa diunggah dari aplikasi:

1. PERENCANAAN mengunduh template (definisi aktif), mengubahnya, lalu memeriksa dan mengunggahnya dengan memilih tahun. Unggahan yang tidak lolos pemeriksaan ditolak. Berkas yang diterima disimpan di disk dokumen (`nko-workbooks/`, ikut cadangan); **definisi belum berubah**.
2. Hasil pemeriksaan dan pratinjau perubahan dibaca siapa pun yang punya `nko.view`.
3. ASMAN_PERENCANAAN menyetujui (workbook diperiksa ulang; definisi versi baru aktif, versi lama `ARSIP`) atau menolak.

Izin sama dengan aturan (§9): `nko.rules.propose` untuk mengunggah dan membatalkan, `nko.rules.approve` untuk memutus, keduanya hanya tingkat UP3. Tidak ada izin atau seeder baru. Pengunggah tidak boleh memutus unggahannya sendiri. Perintah `distriva:nko-import-definitions` tetap ada.

### API (di bawah `/api/nko`)

| Metode dan jalur | Fungsi |
|---|---|
| `GET /definition-sets?year=` | versi definisi, terbaru dulu: `id, year, unit_level, version, status` (`AKTIF, ARSIP`), `source_name, total_weight, warnings[], imported_at, imported_by {id,name}` (null bila dari server) |
| `GET /definition-uploads?status=` | maksimal 100: `id, year, source_name, note, status` (`MENUNGGU, DISETUJUI, DITOLAK, DIBATALKAN`), `uploaded_by {id,name}, uploaded_at, decided_by, decided_at, decision_note` |
| `GET /definition-uploads/{id}` | sama, ditambah `changes[]` dan `check` (hasil pemeriksaan saat diunggah, tanpa `changes`; null untuk unggahan lama) |
| `GET /definition-template?year=` | berkas `TEMPLATE-DEFINISI-NKO-<tahun>.xlsx` (izin `nko.rules.propose`). Dari versi aktif tahun itu; bila belum ada, dari versi aktif tahun terakhir **tanpa target dan realisasi**. 404 bila belum ada definisi sama sekali |
| `POST /definition-uploads/check` | multipart `file` (.xlsx, maksimal 8 MB) dan `year`; tidak menyimpan. 200 `data` = hasil pemeriksaan (di bawah), juga bila tidak lolos |
| `POST /definition-uploads` | multipart `file`, `year`, `note` (wajib); 201 `data.id`. **422 dengan `data` = hasil pemeriksaan** bila tidak lolos (`message` menyebut galat pertama); 409 bila masih ada unggahan menunggu untuk tahun itu |
| `POST /definition-uploads/{id}/decision` | `{decision: "approve"\|"reject", note?}`; `note` wajib saat menolak. Respons `data {status, sets[], mapping}`; `mapping` sama dengan `GET /rules/mapping` (null bila ditolak). 409 bila sudah diputus, definisi aktif berubah sejak diunggah, atau workbook tidak lolos pemeriksaan ulang (mis. unit dihapus dari master; `data` = hasil pemeriksaan) |
| `DELETE /definition-uploads/{id}` | pengunggah membatalkan unggahan yang menunggu |

### Hasil pemeriksaan

`{year, year_found, can_upload, errors[], warnings[], tabs[], changes[]}`. `year_found` dari sel H9 (null bila tidak terbaca). `errors[]` memuat semua galat, termasuk galat per tab dengan awalan "Tab X:". Unggahan diterima hanya bila `can_upload` (`errors` kosong).

`tabs[]` (urutan tab di berkas): `sheet, status` (`DIKENALI`, `DILEWATI`, `GALAT`), `level, unit_name` (null bila nama tab tidak berpola unit), `reason` (alasan dilewati atau galat baca; "Bukan tab unit." untuk tab lain seperti PETUNJUK atau RANGKING, cukup ditampilkan redup), `unit_found, items` (jumlah indikator berpolaritas), `total_weight, errors[], warnings[]`.

Galat (menghentikan unggahan):

- berkas bukan .xlsx yang dapat dibaca; tidak ada tab unit yang terbaca (alasan tiap tab ikut, mis. tab bernama "ULP" saja);
- tab unit tanpa blok Januari, tanpa baris TOTAL, atau tanpa tahun di H9; tahun antartab berbeda; tahun berkas tidak sama dengan `year`;
- unit tab tidak ada di master unit;
- jumlah bobot kelompok bukan 100;
- sel target berisi rumus ke workbook lain tanpa nilai tersimpan;
- item berbobot (bukan kelompok) tanpa target bulanan sama sekali, atau tanpa polaritas;
- KODE (kolom J, §11) tidak sah atau dipakai dua baris dalam satu tab; sebagian tab satu tingkat memakai kolom KODE dan sebagian tidak;
- isi workbook sudah pernah dimuat.

Peringatan (unggahan tetap diterima): target sebagian bulan kosong; polaritas tertulis dikonversi (Negatif 1, Rentang 2, Positif 3; tulisan lain dilaporkan dan dianggap kosong); rumus pencapaian belum pernah dihitung (berkas belum dibuka di Excel, sehingga angka acuan pencapaian dan nilai tidak tersimpan); perbedaan definisi antartab sejenis.

### Template

Satu tab `PETUNJUK` (aturan pengisian) dan satu tab per unit, dengan kolom J `KODE` terisi untuk setiap item (§11), yang punya target, tab acuan lebih dulu. Baris, nomor, rumus pencapaian dan nilai per bulan (termasuk aturan khusus unit), baris TOTAL, dan rumus NKO akhir sama dengan workbook asal. Bedanya: realisasi ditulis sebagai angka, bukan rumus ke workbook lain, dan lembar sumbernya di kolom I `SUMBER REALISASI` (pembaca memakai kolom ini bila rumus realisasi tidak menyebut lembar sumber). Rumus disimpan tanpa hasil hitung; Excel menghitungnya saat berkas dibuka.

Diuji pada data dev 2026 (27 Nov 2026): template dibuat dalam kurang dari 1 detik. Diunggah tanpa diubah: nol perubahan item, kolom, rumus, dan target. Setelah dibuka dan disimpan ulang di LibreOffice: 3.717 angka acuan dan 99 total identik dengan versi aktif.

### Isi `changes[]`

Satu entri per tingkat unit (`UP3`, `ULP`):

- `level`, `status` (`BARU, DIGANTIKAN`; `DUPLIKAT`/`SUDAH_DIGANTIKAN` = tingkat ini tidak berubah), `compared_with` (mis. `2026 v1`; bila tahun baru, versi aktif tahun sebelumnya; null bila belum ada), `items`
- `added[]`: `code, name, weight, needs_realization, has_rule`
- `removed[]`: `code, name, weight, has_rule`
- `possible_renames[]`: `from_code, from_name, to_code, to_name, score` (hanya saran; tindak lanjutnya usulan aturan dengan `replaces_code`, §9)
- `changed[]`: `code, name, fields`; `fields` berisi `{from, to}` per kolom: `name, level, polarity, unit_label, weight, weight_note, formula_text, source_sheet, scoring_rule, nilai_rule, scoring_formula, value_formula, monthly_formulas`. Beda spasi, huruf besar-kecil di luar tanda kutip, `FALSE()`/`TRUE()`, dan pergeseran baris workbook tidak dihitung
- `total_rule_changed`: rumus total atau nilai akhir NKO berubah
- `targets_changed`: `{nama unit: jumlah target bulanan yang berbeda}` untuk item yang ada di kedua versi (`[]` bila tidak ada, dan antartahun tidak dibandingkan)
- `units[]` yang targetnya akan dimuat, `warnings[]`
- `alerts[]`: hal yang perlu diperhatikan penyetuju: unit yang punya target di versi pembanding tetapi tidak ada di workbook, jumlah indikator turun lebih dari 20%, item hilang yang punya aturan realisasi, KODE yang diisi tetapi tidak ada di versi pembanding (dianggap item baru; biasanya salah ketik), dan jumlah dugaan ganti nama

Angka acuan realisasi di dalam workbook (dipakai pratinjau rumus §9) ikut diganti saat disetujui, tetapi perbedaannya **tidak** ditampilkan di `changes[]`.

Membaca workbook contoh (11 tab, 1,3 MB) sekitar 4 detik dan 175 MB memori; aplikasi menaikkan `memory_limit` sampai 512 MB untuk permintaan ini. `upload_max_filesize` PHP bawaan 2M, tetapi workbook contoh 1,3 MB; naikkan bila workbook membesar (docs/85).

## 11. Kode item tetap (tahap 1 pemisahan definisi dan target)

Rancangan lanjutan: definisi dan target dipisah menjadi Template Definisi dan Template Target per tingkat, dihubungkan oleh kode item; versi definisi diberi "berlaku mulai bulan" (pilihan A, bulan sebelumnya tetap memakai versi lama). Tahap 1 menyiapkan kodenya.

Kode item (`kpi_definitions.code`) dipakai aturan realisasi, usulan aturan, masukan manual, baseline, dan analitik. Sebelumnya kode selalu dibentuk dari nama, sehingga ganti nama berarti item baru dan hubungan itu putus.

- Kolom J dengan judul `KODE` di sel J9 (opsional). Bila ada, kode item dibaca dari kolom ini; sel kosong berarti item baru dan kodenya dibentuk dari nama seperti sebelumnya. Workbook lama tanpa kolom J tetap dibaca seperti dulu.
- Format: huruf kecil, angka, dan tanda minus, paling banyak 64 karakter (huruf besar dikecilkan). Kode harus unik dalam satu tab.
- Template (§10) menulis kode setiap item. Ganti nama di template dengan KODE tetap muncul di `changed[]` sebagai perubahan `name`, bukan item hilang dan item baru; target dan aturannya tetap tersambung.
- Target, angka acuan, dan aturan khusus unit tiap tab dicocokkan dengan tab acuan menurut kode, bukan nomor baris. Diuji pada data dev 2026: impor ulang workbook REV 3 menghasilkan 4.260 target, 3.717 angka acuan, dan 31 aturan khusus unit yang sama dengan versi aktif.

