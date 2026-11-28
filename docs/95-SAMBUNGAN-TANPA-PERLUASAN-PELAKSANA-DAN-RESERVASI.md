# 95 — Sambungan tanpa perluasan: pelaksana dan reservasi material

Keputusan pemilik 28 November 2026. Mengubah [docs/82](82-ALUR-SURVEI-KKO-KKF-DAN-IMPOR-EIS.md):

- **1 phasa langsung dipasang tanpa survei dan KKO** setelah dibayar. Perluasan baru diusulkan bila saat penyambungan ditemukan jaringan panjang.
- **3 phasa tetap wajib survei**; yang "tanpa perluasan" tidak lagi berhenti di "siap pasang".
- Keduanya dilanjutkan penetapan pelaksana dan reservasi material, tanpa gambar, MTO, RAB, KKF, SPK, progres, dan BASTP.

## 1. Alur

Reservasi **kolektif**, mengikuti MIMS (keputusan pemilik 28 November 2026): satu reservasi memuat banyak nomor agenda. **Tanpa persetujuan.**

```
1 phasa: Bayar / Cetak PK ───────────────────────────────┐
3 phasa: survei diterima Manager ULP, tanpa perluasan ───┤
                                                         ↓
DRAFT      pilih agenda; total per material (jumlah BOM semua agenda, kabel 35 m per pelanggan), boleh dikoreksi
  ↓        catat nomor permohonan dari MIMS
REQUESTED  stok ditahan; isi per agenda: nomor seri kWh meter dan MCB, panjang kabel, nomor segel
  ↓        total harus sama dengan realisasi
SAP_SENT   ditandai terkirim ke SAP
CANCELLED  dari DRAFT atau REQUESTED (alasan wajib)

1 phasa, saat penyambungan ternyata jaringan panjang:
  Teknik ULP mencatat "perlu perluasan" → survei + KKO → usulan → gambar → MTO → persetujuan → RAB → KKF → alokasi → SPK
```

MIMS dan SAP masih diisi manual (`mims_send_method` = `MANUAL`). Pengiriman otomatis menyusul setelah diketahui apa yang perlu dikirim.

## 2. Aturan

| Hal | Aturan |
|---|---|
| Fasa | 1 phasa: daya di bawah 6.600 VA, 7.700 VA, 11.000 VA. Selain itu 3 phasa |
| Syarat 1 phasa | Status `PAID`/`PK_PRINTED`; tanpa survei. Ditolak bila ada survei berjalan atau survei yang menyatakan perlu perluasan, usulan berjalan, atau temuan lapangan. Draf yang sudah dibuat tetap boleh dimohonkan bila status bergerak ke `CONNECTION_IN_PROGRESS` |
| Syarat 3 phasa | Survei terakhir `ACCEPTED` tanpa perluasan; status `APPROVED`/`PAID`/`PK_PRINTED` |
| Syarat umum | Daya baru terisi, belum punya alokasi, agenda belum punya reservasi di MIMS |
| Sudah direservasi di MIMS | Agenda (atau permohonan) yang ada pada tarikan reservasi atau pengeluaran MIMS ditandai `already_reserved` dengan nomornya, dan tidak dapat direncanakan lagi |
| Isi satu reservasi | Satu ULP, satu jumlah phasa, satu gudang, satu pelaksana; maksimal 100 agenda per permintaan. Bila satu agenda tidak memenuhi syarat, seluruhnya ditolak dan agenda itu disebut. Satu permohonan hanya pada satu reservasi yang berjalan |
| Gudang sumber | 1 phasa: **hanya gudang ULP**. 3 phasa: gudang ULP atau UP3 induknya. Tidak dapat diganti |
| Pelaksana 1 phasa | Otomatis dari kontrak 1 phasa ULP yang berlaku; tidak dapat diganti. Tanpa kontrak: ditolak |
| Pelaksana 3 phasa | Dipilih penyusun dari vendor aktif berlingkup Jaringan atau Keduanya |
| Kontrak 1 phasa | Satu per ULP pada tanggal yang sama |
| BOM | 1 phasa `SR1PH`; 3 phasa sampai 41,5 kVA `PBPD_6_41`; 53 sampai 197 kVA `PBPD_53_197`. Di atas 197 kVA ditolak |
| Kabel SR | Bawaan 35 m per pelanggan (`sr_length_m`), diubah hanya saat `DRAFT` |
| Total material | Jumlah kebutuhan semua agenda. Boleh dikoreksi dan ditambah (mis. segel dari PLN) saat `DRAFT` atau `REQUESTED`; berbeda dari hasil hitung wajib beralasan. Tambah atau keluarkan agenda: total mengikuti, selisih koreksi dipertahankan |
| Keluarkan agenda | Saat `DRAFT`/`REQUESTED`, alasan wajib; realisasinya dibuang. Agenda terakhir: batalkan reservasi |
| Stok | Diperiksa saat nomor permohonan dicatat, dan saat total dinaikkan sesudahnya. `REQUESTED`/`SAP_SENT` mengurangi stok tersedia sampai ada tarikan stok yang lebih baru |
| Nomor material SAP | Dipilih per baris dari nomor yang dipetakan ke KHS itu (`/master-data/mapping`); satu baris boleh dibagi ke beberapa nomor. Satu pilihan saja: terisi sendiri. Wajib sama dengan total saat nomor permohonan dicatat dan sesudahnya. KHS tanpa pemetaan tidak punya pilihan dan tidak menghalangi |
| Stok per nomor | Diperiksa dari tarikan stok terakhir bila tarikan itu memuat nomor material, dikurangi reservasi lain sesudahnya |
| Nomor seri per nomor material | Bila satu KHS dibagi ke beberapa nomor, tiap nomor seri menyebut `material_no` dan banyaknya per nomor harus sama dengan pembagian; "Samakan total" mengikuti nomor seri |
| Nomor seri | Hanya kWh meter dan MCB/MCCB (`serial_codes`); tidak boleh dipakai dua agenda |
| Segel | Nomor dicatat per agenda (boleh lebih dari satu), tidak boleh dobel. Ikut total hanya bila disediakan PLN |
| Syarat Kirim SAP | Tiap agenda: nomor seri kWh meter dan MCB (bila agendanya memakai) serta panjang kabel terisi. **Total harus sama**: per material bernomor seri = banyaknya nomor seri; kabel = jumlah panjang per agenda; segel (bila direservasi) = banyaknya nomor segel |
| Samakan total | Mengubah total kabel, material bernomor seri, dan segel menjadi angka realisasi (alasan otomatis). Petugas juga mengoreksi di MIMS |
| Material | Hanya material PLN. Yang berstatus disediakan vendor (`PRICED`) pada buku harga tidak ikut |
| Temuan "perlu perluasan" | Hanya 1 phasa berstatus `PAID`/`PK_PRINTED`/`CONNECTION_IN_PROGRESS`; satu yang berlaku per permohonan. Agenda pada reservasi `DRAFT` dikeluarkan otomatis |
| Salah tandai | `TEKNIK` membatalkan dengan alasan, selama belum ada survei sesudah temuan (batalkan dulu), usulan, gambar, atau alokasi. Riwayat tetap disimpan. Yang sudah dikeluarkan tidak kembali sendiri |
| Survei setelah temuan | Survei, gambar, MTO, dan usulan boleh dikerjakan walau status sudah `CONNECTION_IN_PROGRESS` |
| Material setelah temuan | Pada reservasi `REQUESTED`/`SAP_SENT` **tetap dipakai** dan dikurangkan dari alokasi perluasan (kabel memakai panjang nyata). Pada `DRAFT`, agendanya dikeluarkan otomatis |

## 3. Peran

| Aksi | Gudang ULP | Gudang UP3 |
|---|---|---|
| Semua langkah reservasi | `NIAGA_RETAIL` | `KONSTRUKSI` |

Tidak ada persetujuan. Temuan "perlu perluasan" dicatat `TEKNIK` ULP. Kontrak 1 phasa dikelola `KONSTRUKSI`. `SYS_ADMIN` memegang semuanya (MFA). Kunci pada `GET /planning/access`: `sr_reservations.view`, `sr_reservations.prepare_ulp`, `sr_reservations.prepare_up3`, `sr_vendor_contracts.manage`, `sr_reservations.report_extension`. Kunci `approve_ulp` dan `approve_up3` dihapus.

## 4. API

Galat aturan = 409 `{message}`; tanpa izin = 403; di luar unit = 404; validasi = 422.

### Kontrak pelaksana 1 phasa

| Endpoint | Isi |
|---|---|
| `GET /api/sr-vendor-contracts` | `data[]`: `id, contract_number, valid_from, valid_until, unit{id,code,name}, vendor{id,code,name,status}` |
| `POST /api/sr-vendor-contracts` | `organizational_unit_id` (ULP), `vendor_company_id`, `contract_number`, `valid_from`, `valid_until?` → 201 `data.id` |
| `PUT /api/sr-vendor-contracts/{id}` | `contract_number?`, `valid_until?` |

### Reservasi

| Endpoint | Isi |
|---|---|
| `GET /api/sr-reservations/pending` | Daftar agenda yang bisa dipilih. Filter `unit_id`, `search`, `phase`, `reserved` (0/1), `per_page`. Baris: `application_id, application_number, application_type, status, customer_name, unit, power_va, phase, default_vendor, already_reserved, mims_reservation_numbers[]` |
| `GET /api/applications/{id}/sr-reservations` | `power_va, phase, blockers[], default_sr_length_m, survey_sr_length_m, contract, warehouses[], mims_reservation_numbers[], extension_finding, reservations[]` |
| `POST /api/sr-reservations` | `application_ids[]`, `warehouse_id?` (wajib bila pilihan lebih dari satu), `vendor_company_id` (wajib 3 phasa), `sr_length_m?`, `notes?` → 201 `data.id` |
| `GET /api/sr-reservations` | Filter `status`, `source_level`, `unit_id`, `search` (nomor permohonan MIMS, agenda, pelanggan), `per_page` |
| `GET /api/sr-reservations/{id}` | Ringkasan + `notes, cancel_reason, mims_found_in_mirror, lines[]{khs_code,khs_name,unit_text,material_numbers[],quantity_bom,quantity,correction_reason,realised,material_options[]{material_no,name,unit_text,stock_ready,available},materials[]{material_no,quantity}}, applications[]{application_id,application_number,agenda_number,customer_name,power_va,needs[]{khs_code,quantity},cable_m,seals[],serials[]{khs_code,serial_number,material_no},released_at,release_reason}, serial_codes{kwh[],mcb[]}, cable_codes[], seal_codes[], material_blockers[] (saat `DRAFT`), sap_blockers[], events[]` |
| `PUT /api/sr-reservations/{id}` | `corrections[]{khs_code,quantity,reason}`, `materials[]{khs_code,items[]{material_no,quantity}}` (mengganti pilihan baris itu), `notes?`; hanya `DRAFT`: `sr_length_m?`, `vendor_company_id?`, `add_application_ids[]?` |
| `POST …/{id}/applications/{applicationId}/remove` | `reason` |
| `POST …/{id}/request` | `reservation_no` (nomor permohonan MIMS; boleh dikoreksi saat `REQUESTED`) |
| `PUT …/{id}/realization` | `items[]{application_id, cable_m?, seals[]?, serials[]?{khs_code,serial_number,material_no?}}`; boleh bertahap, isian yang dikirim menggantikan yang lama |
| `POST …/{id}/match` | Samakan total dengan realisasi |
| `POST …/{id}/sap` | `sap_reference?` |
| `POST …/{id}/cancel` | `reason` |
| `POST /api/applications/{id}/sr-extension` | `reason`, `distance_m?` → 201 |
| `POST /api/applications/{id}/sr-extension/cancel` | `reason` |

Ringkasan: `id, status, phase, source_level, applications_count, unit, warehouse{id,code,name,plant,stor_loc}, vendor{id,code,name,contract_number}, sr_length_m, mims_reservation_no, sap_reference, created_at, requested_at, sap_sent_at, cancelled_at`.

**Dihapus:** `POST /applications/{id}/sr-reservations`, `/sr-reservations/batch`, `/batch-actions`, `/submit`, `/decision`, `/mims`.

### Perubahan pada API permohonan dan laporan

| Tempat | Perubahan |
|---|---|
| `GET /api/applications` (tiap baris) dan `GET /api/applications/{id}` | Kunci baru `survey_required` (false untuk 1 phasa tanpa temuan) dan `extension_finding` (boolean). `ready_to_install` ada di tingkat atas rincian juga |
| `ready_to_install` dan filter `ready_to_install=1` | Selain survei "tanpa perluasan": 1 phasa `PAID`/`PK_PRINTED` tanpa survei dan di luar usulan. Tidak pernah benar selama ada temuan |
| Laporan SLA dan umur | 1 phasa tanpa survei: tahap "Menunggu Pembayaran" (`APPROVED`) atau "Penyambungan"; tidak dianggap terlambat karena belum disurvei (batas umum 25 hari tetap berlaku) |
| Dashboard `waiting_survey` | Tidak menghitung 1 phasa tanpa survei |

### Notifikasi dan SLA 1 phasa

| Hal | Aturan |
|---|---|
| Permohonan baru | "Siap disurvei" hanya untuk yang perlu survei (3 phasa atau daya belum diisi) |
| Reservasi menunggu | Setelah impor EIS: 1 phasa yang masuk sudah bayar atau berubah menjadi `PAID`/`PK_PRINTED` diberitahukan per ULP ke pemegang `sr_reservations.prepare_ulp`, "N pelanggan 1 phasa menunggu reservasi" |
| SLA layanan | 1 phasa tanpa survei, tanpa temuan, dan tanpa MTO: `LAYANAN_TANPA_PERLUASAN` (4 hari kerja) dari tanggal bayar. Semua yang masih berjalan dihitung |
| Riwayat | Yang sudah tersambung hanya dihitung bila dibayar sejak `distriva.sr_reservation.sla_since` (2026-11-28) |
| Pengingat terlambat | Hanya untuk yang dibayar sejak `sla_since`; tunggakan lama tampil di daftar SLA tanpa notifikasi. Baris SLA memuat `announce` |

Saat diterapkan di server lain, sesuaikan `sla_since` dengan tanggal penerapan.

## 5. Penerapan

1. `php artisan migrate` (migrasi `2026_12_31_200000`, `210000`, `220000` (tidak dapat di-rollback), dan `230000`).
2. `php artisan db:seed --class=PlanningPermissionSeeder`.
3. Isi kontrak pelaksana 1 phasa tiap ULP.
4. Tarik data reservasi MIMS secara berkala: pencocokan "sudah direservasi" hanya sebaik tarikan terakhir. Reservasi hanya ikut tarik manual, tidak ikut jadwal otomatis.

## 6. Belum termasuk

- Pengiriman otomatis ke MIMS.
- Notifikasi, cetak formulir reservasi, tampilan akun vendor.
- Material yang direservasi langsung di MIMS (di luar DISTRIVA) tidak dikurangkan dari alokasi perluasan.
