# 95 — Sambungan tanpa perluasan: pelaksana dan reservasi material

Keputusan pemilik 28 November 2026. Mengubah [docs/82](82-ALUR-SURVEI-KKO-KKF-DAN-IMPOR-EIS.md):

- **1 phasa langsung dipasang tanpa survei dan KKO** setelah dibayar. Perluasan baru diusulkan bila saat penyambungan ditemukan jaringan panjang.
- **3 phasa tetap wajib survei**; yang "tanpa perluasan" tidak lagi berhenti di "siap pasang".
- Keduanya dilanjutkan penetapan pelaksana dan reservasi material, tanpa gambar, MTO, RAB, KKF, SPK, progres, dan BASTP.

## 1. Alur

```
1 phasa: Bayar / Cetak PK ──────────────────────────┐
3 phasa: survei diterima Manager ULP, tanpa perluasan ┤
                                                      ↓
  rencana reservasi: gudang sumber, pelaksana, material dari BOM APP
  → DRAFT → SUBMITTED → APPROVED (stok ditahan) → RECORDED (nomor reservasi MIMS dicatat)
  CANCELLED dari status mana pun (alasan wajib)

1 phasa, saat penyambungan ternyata jaringan panjang:
  Teknik ULP mencatat "perlu perluasan" → survei + KKO → usulan → gambar → MTO → persetujuan → RAB → KKF → alokasi → SPK
```

Input ke MIMS masih manual. `mims_send_method` bernilai `MANUAL`; pengiriman otomatis menyusul dan membutuhkan contoh request simpan reservasi MIMS.

## 2. Aturan

| Hal | Aturan |
|---|---|
| Fasa | 1 phasa: daya di bawah 6.600 VA, 7.700 VA, 11.000 VA. Selain itu 3 phasa |
| Syarat 1 phasa | Status `PAID`/`PK_PRINTED`; tanpa survei. Ditolak bila ada survei berjalan atau survei yang menyatakan perlu perluasan, usulan berjalan, atau temuan lapangan. Rencana yang sudah dibuat tetap boleh diteruskan bila status bergerak ke `CONNECTION_IN_PROGRESS` |
| Syarat 3 phasa | Survei terakhir `ACCEPTED` tanpa perluasan; status `APPROVED`/`PAID`/`PK_PRINTED` |
| Syarat umum | Daya baru terisi, belum punya alokasi, agenda belum punya reservasi di MIMS |
| Sudah direservasi di MIMS | Agenda (atau permohonan) yang ada pada tarikan reservasi atau pengeluaran MIMS ditandai `already_reserved` dengan nomornya, dan tidak dapat direncanakan lagi |
| Pelaksana 1 phasa | Otomatis dari kontrak 1 phasa ULP yang berlaku; tidak dapat diganti. Tanpa kontrak: ditolak |
| Pelaksana 3 phasa | Dipilih penyusun dari vendor aktif berlingkup Jaringan atau Keduanya |
| Kontrak 1 phasa | Satu per ULP pada tanggal yang sama |
| Gudang sumber | 1 phasa: **hanya gudang ULP** permohonan. 3 phasa: gudang ULP atau UP3 induknya. Bila hanya ada satu pilihan, terisi sendiri. Tidak dapat diganti sesudah dibuat |
| Sekaligus | Pembuatan hanya 1 phasa; ajukan, setujui, dan catat nomor MIMS untuk keduanya. Maksimal 100; tiap baris berhasil atau gagal sendiri |
| BOM | 1 phasa `SR1PH`; 3 phasa sampai 41,5 kVA `PBPD_6_41`; 53 sampai 197 kVA `PBPD_53_197`. Di atas 197 kVA ditolak |
| Material | Hanya material PLN. Yang berstatus disediakan vendor (`PRICED`) pada buku harga tidak ikut |
| Kabel SR | Bawaan 35 m, dapat diubah (`sr_length_m`) |
| Koreksi | Jumlah boleh diubah dan material boleh ditambah; berbeda dari hasil hitung wajib beralasan |
| Stok | Diperiksa saat disetujui. `APPROVED` selalu mengurangi stok tersedia; `RECORDED` sampai ada tarikan stok yang lebih baru dari tanggal pencatatan |
| Nomor MIMS | Boleh dikoreksi; satu nomor boleh dipakai beberapa agenda |
| Temuan "perlu perluasan" | Hanya 1 phasa berstatus `PAID`/`PK_PRINTED`/`CONNECTION_IN_PROGRESS`; satu yang berlaku per permohonan. Rencana `DRAFT`/`SUBMITTED` dibatalkan otomatis |
| Material setelah temuan | Rencana `APPROVED`/`RECORDED` **tetap dipakai**. Jumlahnya dikurangkan dari kebutuhan alokasi, peringatan kekurangan SPK, dan outbox, sehingga tidak dialokasikan dua kali |
| Salah tandai | `TEKNIK` membatalkan dengan alasan, selama belum ada survei sesudah temuan (batalkan dulu), usulan, gambar, atau alokasi. Riwayat tetap disimpan. Rencana yang sudah dibatalkan otomatis tidak hidup lagi; buat baru |
| Survei setelah temuan | Survei, gambar, MTO, dan usulan boleh dikerjakan walau status sudah `CONNECTION_IN_PROGRESS` |

## 3. Peran

| Aksi | Gudang ULP | Gudang UP3 |
|---|---|---|
| Menyusun, mengajukan | `NIAGA_RETAIL` | `KONSTRUKSI` |
| Menyetujui, mengembalikan | `NIAGA_RETAIL` (boleh akun yang sama) | `ASMAN_KONSTRUKSI` (bukan pengaju) |
| Mencatat nomor MIMS, membatalkan | `NIAGA_RETAIL` | `KONSTRUKSI` atau `ASMAN_KONSTRUKSI` |

Temuan "perlu perluasan" dicatat `TEKNIK` ULP. Kontrak 1 phasa dikelola `KONSTRUKSI`. `SYS_ADMIN` memegang semuanya (MFA). Kunci pada `GET /planning/access`: `sr_reservations.view`, `sr_reservations.prepare_ulp`, `sr_reservations.approve_ulp`, `sr_reservations.prepare_up3`, `sr_reservations.approve_up3`, `sr_vendor_contracts.manage`, `sr_reservations.report_extension`.

## 4. API

Galat aturan = 409 `{message}`; tanpa izin = 403; di luar unit = 404; validasi = 422.

### Kontrak pelaksana 1 phasa

| Endpoint | Isi |
|---|---|
| `GET /api/sr-vendor-contracts` | `data[]`: `id, contract_number, valid_from, valid_until, unit{id,code,name}, vendor{id,code,name,status}` |
| `POST /api/sr-vendor-contracts` | `organizational_unit_id` (ULP), `vendor_company_id`, `contract_number`, `valid_from`, `valid_until?` → 201 `data.id` |
| `PUT /api/sr-vendor-contracts/{id}` | `contract_number?`, `valid_until?` |

### Rencana reservasi

| Endpoint | Isi |
|---|---|
| `GET /api/sr-reservations/pending` | Daftar kerja: 1 phasa yang sudah bayar dan 3 phasa tanpa perluasan, tanpa rencana berjalan. Filter `unit_id`, `search`, `phase` (1/3), `reserved` (0/1), `per_page`. Baris: `application_id, application_number, application_type, status, customer_name, unit, power_va, phase, default_vendor{id,name}, already_reserved, mims_reservation_numbers[]`; `meta` |
| `GET /api/applications/{id}/sr-reservations` | Bahan formulir: `power_va, phase, blockers[], default_sr_length_m, survey_sr_length_m, contract, warehouses[]{id,code,name,level}, mims_reservation_numbers[], extension_finding{reason,distance_m,reported_by,reported_at}, reservations[]` |
| `POST /api/applications/{id}/sr-reservations` | `warehouse_id?` (wajib bila pilihan lebih dari satu), `vendor_company_id` (wajib 3 phasa), `sr_length_m?`, `notes?` → 201 `data.id` |
| `POST /api/sr-reservations/batch` | `application_ids[]`, `warehouse_id?`, `sr_length_m?` → 200 `data[]{application_id,ok,id?,message?}`, `summary{succeeded,failed}` |
| `POST /api/sr-reservations/batch-actions` | `ids[]`, `action` `submit`/`approve`/`mims`, `reservation_no` (untuk `mims`) → bentuk sama, kunci `id` |
| `POST /api/applications/{id}/sr-extension` | `reason`, `distance_m?` → 201 |
| `POST /api/applications/{id}/sr-extension/cancel` | `reason` → membatalkan tanda yang salah |
| `GET /api/sr-reservations` | Filter `status`, `source_level`, `unit_id`, `per_page`; `data[]` ringkasan, `meta` |
| `GET /api/sr-reservations/{id}` | Ringkasan + `notes, bom_group, cancel_reason, mims_found_in_mirror, lines[]{khs_code,khs_name,unit_text,material_numbers[],quantity_bom,quantity,correction_reason}, events[]{type,actor,reason,details,occurred_at}` |
| `PUT /api/sr-reservations/{id}` | Hanya `DRAFT`: `sr_length_m?`, `vendor_company_id?` (3 phasa), `notes?`, `corrections[]?{khs_code,quantity,reason}`. `sr_length_m` baru menimpa baris kabel |
| `POST /api/sr-reservations/{id}/submit` | Mengajukan |
| `POST /api/sr-reservations/{id}/decision` | `decision` `APPROVE`/`RETURN`, `reason` (wajib untuk `RETURN`) |
| `POST /api/sr-reservations/{id}/mims` | `reservation_no` |
| `POST /api/sr-reservations/{id}/cancel` | `reason` |

Ringkasan: `id, version_number, status, phase, power_va, source_level, application{id,number,agenda_number,customer_name}, unit{id,code,name}, warehouse{id,code,name,plant,stor_loc}, vendor{id,code,name,contract_number}, sr_length_m, mims_reservation_no, created_at, submitted_at, approved_at, mims_recorded_at, cancelled_at`.

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

1. `php artisan migrate` (migrasi `2026_12_31_200000` dan `2026_12_31_210000`).
2. `php artisan db:seed --class=PlanningPermissionSeeder`.
3. Isi kontrak pelaksana 1 phasa tiap ULP.
4. Tarik data reservasi MIMS secara berkala: pencocokan "sudah direservasi" hanya sebaik tarikan terakhir. Reservasi hanya ikut tarik manual, tidak ikut jadwal otomatis.

## 6. Belum termasuk

- Pengiriman otomatis ke MIMS.
- Notifikasi, cetak formulir reservasi, tampilan akun vendor.
- Material yang direservasi langsung di MIMS (di luar DISTRIVA) tidak dikurangkan dari alokasi perluasan.
