# 95 — Sambungan tanpa perluasan: pelaksana dan reservasi material

Keputusan pemilik 28 November 2026. Mengubah [docs/82](82-ALUR-SURVEI-KKO-KKF-DAN-IMPOR-EIS.md) §1: survei "tanpa perluasan" tidak lagi berhenti di "siap pasang", melainkan dilanjutkan penetapan pelaksana dan reservasi material. Tetap tanpa gambar, MTO, RAB, KKF, SPK, progres, dan BASTP. Survei tetap wajib untuk semua permohonan karena hasilnya menentukan jalur.

## 1. Alur

```
Survei diterima Manager ULP (tanpa perluasan)
  → rencana reservasi: gudang sumber, pelaksana, material dari BOM APP
  → DRAFT → SUBMITTED (diajukan) → APPROVED (disetujui, stok ditahan) → RECORDED (nomor reservasi MIMS dicatat)
  CANCELLED dari status mana pun (alasan wajib)
```

Input ke MIMS masih manual. `mims_send_method` bernilai `MANUAL`; pengiriman otomatis menyusul dan membutuhkan contoh request simpan reservasi MIMS.

## 2. Aturan

| Hal | Aturan |
|---|---|
| Syarat | Survei terakhir `ACCEPTED` tanpa perluasan, status permohonan `APPROVED`/`PAID`/`PK_PRINTED`, daya baru terisi, agenda belum punya reservasi di tarikan MIMS. Berlaku juga bagi survei yang disetujui sebelum fitur ini |
| Fasa | 1 phasa: daya di bawah 6.600 VA, 7.700 VA, 11.000 VA. Selain itu 3 phasa |
| Pelaksana 1 phasa | Otomatis dari kontrak 1 phasa ULP yang berlaku; tidak dapat diganti. Tanpa kontrak: ditolak |
| Pelaksana 3 phasa | Dipilih penyusun dari vendor aktif berlingkup Jaringan atau Keduanya |
| Kontrak 1 phasa | Satu per ULP pada tanggal yang sama |
| Gudang sumber | Gudang aktif milik ULP permohonan (`source_level` = `ULP`) atau UP3 induknya (`UP3`). Tidak dapat diganti; batalkan lalu buat ulang |
| BOM | 1 phasa `SR1PH`; 3 phasa sampai 41,5 kVA `PBPD_6_41`; 53 sampai 197 kVA `PBPD_53_197`. Di atas 197 kVA ditolak |
| Material | Hanya material PLN. Yang berstatus disediakan vendor (`PRICED`) pada buku harga tidak ikut |
| Kabel SR | Bawaan 35 m, dapat diubah (`sr_length_m`). Panjang hasil survei hanya ditampilkan sebagai pembanding |
| Koreksi | Jumlah boleh diubah dan material boleh ditambah; berbeda dari hasil hitung wajib beralasan |
| Stok | Diperiksa saat disetujui. `APPROVED` selalu mengurangi stok tersedia; `RECORDED` sampai ada tarikan stok yang lebih baru dari tanggal pencatatan |
| Nomor MIMS | Boleh dikoreksi; satu nomor boleh dipakai beberapa agenda |

## 3. Peran

| Aksi | Gudang ULP | Gudang UP3 |
|---|---|---|
| Menyusun, mengajukan | `NIAGA_RETAIL` | `KONSTRUKSI` |
| Menyetujui, mengembalikan | `NIAGA_RETAIL` (boleh akun yang sama) | `ASMAN_KONSTRUKSI` (bukan pengaju) |
| Mencatat nomor MIMS, membatalkan | `NIAGA_RETAIL` | `KONSTRUKSI` atau `ASMAN_KONSTRUKSI` |

Kontrak 1 phasa dikelola `KONSTRUKSI`. `SYS_ADMIN` memegang semuanya (MFA). Kunci pada `GET /planning/access`: `sr_reservations.view`, `sr_reservations.prepare_ulp`, `sr_reservations.approve_ulp`, `sr_reservations.prepare_up3`, `sr_reservations.approve_up3`, `sr_vendor_contracts.manage`.

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
| `GET /api/sr-reservations/pending` | Siap pasang tanpa rencana berjalan. Filter `unit_id`, `search`, `per_page`. Baris: `application_id, application_number, application_type, status, customer_name, unit, power_va, phase, default_vendor{id,name}` (null untuk 3 phasa atau tanpa kontrak); `meta` |
| `GET /api/applications/{id}/sr-reservations` | Bahan formulir: `power_va, phase, blockers[], default_sr_length_m, survey_sr_length_m, contract{id,contract_number,vendor}, warehouses[]{id,code,name,level}, reservations[]` |
| `POST /api/applications/{id}/sr-reservations` | `warehouse_id`, `vendor_company_id` (wajib 3 phasa), `sr_length_m?`, `notes?` → 201 `data.id` |
| `GET /api/sr-reservations` | Filter `status`, `source_level`, `unit_id`, `per_page`; `data[]` ringkasan, `meta` |
| `GET /api/sr-reservations/{id}` | Ringkasan + `notes, bom_group, cancel_reason, mims_found_in_mirror, lines[]{khs_code,khs_name,unit_text,material_numbers[],quantity_bom,quantity,correction_reason}, events[]{type,actor,reason,details,occurred_at}` |
| `PUT /api/sr-reservations/{id}` | Hanya `DRAFT`: `sr_length_m?`, `vendor_company_id?` (3 phasa), `notes?`, `corrections[]?{khs_code,quantity,reason}`. `sr_length_m` baru menimpa baris kabel |
| `POST /api/sr-reservations/{id}/submit` | Mengajukan |
| `POST /api/sr-reservations/{id}/decision` | `decision` `APPROVE`/`RETURN`, `reason` (wajib untuk `RETURN`) |
| `POST /api/sr-reservations/{id}/mims` | `reservation_no` |
| `POST /api/sr-reservations/{id}/cancel` | `reason` |

Ringkasan: `id, version_number, status, phase, power_va, source_level, application{id,number,agenda_number,customer_name}, unit{id,code,name}, warehouse{id,code,name,plant,stor_loc}, vendor{id,code,name,contract_number}, sr_length_m, mims_reservation_no, created_at, submitted_at, approved_at, mims_recorded_at, cancelled_at`.

## 5. Penerapan

1. `php artisan migrate` (migrasi `2026_12_31_200000_create_sr_reservations`).
2. `php artisan db:seed --class=PlanningPermissionSeeder`.
3. Isi kontrak pelaksana 1 phasa tiap ULP.

## 6. Belum termasuk

- Pengiriman otomatis ke MIMS.
- Notifikasi pengajuan dan persetujuan.
- Cetak formulir reservasi.
- Tampilan untuk akun vendor.
