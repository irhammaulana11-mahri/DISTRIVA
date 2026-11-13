# 81 — Master Penyulang dan Master Pelanggan (terhubung dengan Master Gardu)

Permintaan pemilik 2026-11-12: master penyulang (dimiliki unit mana) dan master pelanggan, semuanya saling terhubung. Keputusan pemilik: pelanggan diisi dari **file DIL + dari survei (KKO)**; penyulang dimiliki **satu unit pengelola** (UP3 atau ULP, dapat diubah), ULP yang dilayani diturunkan dari gardu.

## 1. Rantai hubungan
```
UP3/ULP pemilik ──< penyulang ──< gardu ──< pelanggan (IDPEL) ── pemohon (customers) ── permohonan
        GI (kode)        distribution_feeders   substations   customer_connections   customers   applications
```
- `substations.feeder_id` → penyulang. `customer_connections.substation_id` → gardu; penyulang pelanggan = penyulang gardunya. `customer_connections.customer_id` → pemohon (lewat IDPEL pada `customer_external_references`).
- ULP yang dilayani penyulang tidak disimpan: dihitung dari gardu (satu penyulang dapat melintasi beberapa ULP).

## 2. Master penyulang (`distribution_feeders`)
Kolom: `code` (KD_PYLG, unik), `name`, `gi_code`, `gi_transformer_no`, `owner_unit_id`, `status` AKTIF/NONAKTIF, `notes`. Setiap perubahan tercatat di `distribution_feeder_changes` (append-only, alasan wajib; urutan riwayat memakai kolom `seq` karena `created_at` hanya berpresisi detik).
- **Terbentuk otomatis** dari kode penyulang pada impor gardu (pemilik awal = UP3 di atas ULP gardu). Migrasi mengisi awal dari gardu yang sudah ada: 14 penyulang, milik UP3 Mojokerto.
- **Akses.** Terlihat oleh unit pemilik (UP3 terlihat dari ULP di bawahnya) dan oleh setiap unit yang punya gardu pada penyulang itu. Diubah hanya oleh unit pemilik (kunci `feeders.manage`: PERENCANAAN, ENGINEERING, SYS_ADMIN dengan MFA). Pemilik baru harus UP3/ULP aktif dalam cakupan pengubah.
- Koreksi kode penyulang pada sebuah gardu (`PATCH substations/{id}` dengan `feeder_code`) memindahkan gardu ke penyulang itu (dibuat bila belum ada).
- Detail memuat: jumlah gardu dan kapasitas, ULP yang dilayani (per ULP: gardu, kVA), **pembebanan penyulang** = beban kVA terakhir gardu ÷ kapasitasnya, hanya atas gardu yang punya beban kVA (jumlah gardu terukur dilaporkan, sisanya tidak ditebak), ringkasan pelanggan aktif dan daya kontrak, riwayat perubahan.

## 3. Master pelanggan (`customer_connections`)
Satu baris per **IDPEL** (12 digit, unik). Kolom: unit (ULP), `customer_id` (pemohon, bila diketahui), `substation_id`, `gardu_ref` (nomor gardu dari DIL), `link_source` (DIL = GADIS cocok, DIL_KODE = kode pendek dilengkapi, KKO, MANUAL), `name`, `kelurahan`/`kecamatan`/`kabupaten`, `tariff_code`, `power_va`, `service_type` (PASKABAYAR/PRABAYAR), `phase_code`, `meter_number`, `energized_on`, `status` (AKTIF, BONGKAR, HAPUS, PROSES = permohonan belum tersambung), `source` (DIL / APPLICATION), `snapshot_month`.

**Data pribadi tidak disimpan.** Tidak ada kolom NIK, NPWP, telepon, email, alamat jalan, atau koordinat. DIL contoh sudah dimasker oleh sumbernya (nama, alamat, telepon, NIK, email, koordinat berisi `***`). Nama disimpan seperti yang diberikan (bertopeng); alat pemuat menyamarkan nama yang belum bertopeng. Bila pelanggan tertaut ke pemohon, nama pemohon yang ditampilkan (`name_masked=false`).

### Sumber 1 — DIL (`tools/dil_sync`)
Contoh: `tools/samples/DIL_SALDO_MASK_202210_51MJK.mdb` (Access, 1,9 GB, **1.306.414 pelanggan seluruh UP3 Mojokerto, periode 2022-10**, satu tabel). Kolom yang dipakai: IDPEL, UNITUP (kode ULP), NAMA, TARIF, DAYA (VA), JENISLAYANAN, KODE_FASA, NOMOR_METER_KWH / _PREPAID, NAMA_KELURAHAN/KECAMATAN/KABUPATEN, TGLNYALA_PB, **NOMOR_GARDU**, STATUS_DIL, V_BULAN_REKAP.
- **Kunci ke gardu: `NOMOR_GARDU` = nomor GADIS gardu** (`substations.gadis_number`, mis. `GD514530761`), dicocokkan dalam ULP yang sama. Uji nyata ULP Jombang: **171.487 dari 175.100 pelanggan (97,9 %) tertaut**.
- Pelanggan yang gardunya belum ada di master tetap disimpan dengan `gardu_ref`, dan **tertaut otomatis begitu gardu itu diimpor** (`applied.customers_linked` pada konfirmasi impor gardu). Tautan MANUAL tidak pernah ditimpa pemuatan berikutnya.
- Pemuatan per **batch** berpotongan (≤ 2.000 baris), idempoten per IDPEL (baru / berubah / tetap), karena 1,3 juta baris terlalu berat untuk pratinjau per baris. Baris tanpa IDPEL 12 digit, dengan ULP tak dikenal, atau di luar cakupan ditolak dan dihitung.
- Pembaca `.mdb`: `mdb-export` dari mdbtools (`sudo apt install mdbtools`), atau ekspor CSV.

### Sumber 2 — KKO
Saat KKO sebuah permohonan menyimpan `substation_id`, IDPEL pemohon ditautkan ke gardu itu **hanya bila pemohon punya tepat satu IDPEL**. Hasil dilaporkan di respons (`customer_link.result`): `linked`, `created` (pelanggan belum ada di DIL, dibuat berstatus PROSES), `kept_manual`, `no_customer`, `no_idpel`, `ambiguous_idpel` (lebih dari satu IDPEL: tidak menebak).

### Perbaikan manual
`PATCH customer-connections/{id}/link` `{substation_id: uuid|null}` (`customers.manage`): gardu harus di ULP yang sama dengan pelanggan; tautan menjadi MANUAL.

## 4. Hal yang perlu dipahami pembaca data
- **DIL contoh berperiode 2022-10**, sedangkan gardu 2026-09: pelanggan yang tersambung sesudahnya tidak ada, dan sebagian status sudah berubah. Muat DIL terbaru ketika tersedia (idempoten per IDPEL, status ikut diperbarui).
- **Daya kontrak bukan beban.** Total daya kontrak pelanggan pada gardu/penyulang jauh melampaui kapasitas trafo (mis. penyulang WTGLH: 26.361 kVA kontrak vs 18.630 kVA trafo) karena pelanggan tidak menyala bersamaan. Tampilkan sebagai informasi ("daya tersambung"), jangan dibagi kapasitas dan jangan disebut pembebanan.
- **Kode gardu pendek di DIL** (`HD127`) dibaca sebagai kode master dengan angka nol dilengkapi (`HD0127`) bila nomor GADIS tidak cocok (keputusan pemilik 2026-11-12). Aturannya sempit: hanya pola `HD` + 1–3 angka, hanya di ULP pelanggan itu sendiri, dan nomor GADIS tetap kunci pertama. Tautannya bersumber **`DIL_KODE`** agar dapat dibedakan dari tautan GADIS (`DIL`). Pada ULP Jombang: 3.507 pelanggan tertaut lewat cara ini (tersisa 106 yang gardunya memang belum ada di master).
- **Tautan manual dihormati, termasuk "lepas tautan":** pelepasan oleh petugas disimpan sebagai keputusan (`link_source = MANUAL`, gardu kosong) sehingga pemuatan DIL berikutnya maupun impor gardu tidak menautkannya lagi.
- Dua ULP lain dan seterusnya (51450–51460) belum punya gardu di master: pelanggannya akan tersimpan tanpa tautan sampai gardunya diimpor.

## 5. Izin (config `feeders`, `customers`; dikirim lewat `GET /applications/access`)
| Kunci | Peran |
|---|---|
| `feeders.view` | MANAGER_ULP, ASMAN_NIAGA, TEKNIK, UP3_MANAGER, ASMAN_PERENCANAAN, ASMAN_KONSTRUKSI, KONSTRUKSI_UP3, PERENCANAAN, ENGINEERING, SYS_ADMIN |
| `feeders.manage` | PERENCANAAN, ENGINEERING, SYS_ADMIN |
| `customers.view` | peran di atas + NIAGA_RETAIL |
| `customers.import` | NIAGA_RETAIL (UP3: seluruh ULP di bawahnya), PERENCANAAN, ENGINEERING, SYS_ADMIN |
| `customers.manage` | TEKNIK, PERENCANAAN, ENGINEERING, SYS_ADMIN |
Cakupan turun UP3 → ULP (`applications_descendant_keys`); SYS_ADMIN semua unit, tulis memerlukan MFA.

## 6. API
Lihat docs/57 bagian "Master penyulang dan master pelanggan". Detail gardu kini memuat `customers{active_customers, connected_va, connected_kva, large_customers}`, `feeder_id`; daftar gardu menerima `feeder_id`.

## 7. Status
Backend selesai: migrasi `2026_11_12_100000` (penyulang), `2026_11_12_110000` (urutan riwayat) dan `2026_11_12_200000` (pelanggan), `FeederService`, `ConnectionService`, `FeederController`, `ConnectionController`; alat `tools/dil_sync` (6 tes); tes `SubstationTest` (+3), `ConnectionTest` (4). Database dev: 14 penyulang; pelanggan ULP Jombang dimuat dari DIL contoh (175.100 baris, 171.487 tertaut). Frontend: selesai dan teruji (`FeedersPage`, `CustomersPage`, keterhubungan dengan `SubstationsPage`, `SubstationMeasurementsPage`, dan `ApplicationKkoPanel`, 34 test files / 326 tests passing).
**Celah riwayat perubahan gardu:** telah ditutup oleh `docs/PROMPT-FRONTEND-GARDU-PENGUKURAN.md` (`substation_changes` append-only dan ditampilkan di detail Master Gardu).

## 8. Temuan frontend untuk backend
- Tidak ada ketidaksesuaian kontrak: seluruh respons API `feeders`, `customer-connections`, perbaikan tautan `PATCH .../link`, detail gardu (`customers`), dan respons `customer_link` pada KKO telah sesuai dan beroperasi dengan lancar.
