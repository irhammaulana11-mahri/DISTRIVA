# 80 — Desain Master Gardu untuk KKO (backend, frontend, bot sinkron harian)

Status: **tahap A (backend) selesai 2026-11-10**; tahap B (frontend) dan C (bot Maximo) belum. Sumber data contoh: `tools/samples/gardu-SEP2026.xlsx` (lembar `gardu`, 1.296 baris, 157 kolom). Lanjutan §51 (KKO) di docs/62.

## 1. Tujuan

Saat survey, petugas **memilih gardu** (bukan mengetik) lalu kapasitas, beban, tegangan ujung, dan data operasional terakhir terisi otomatis ke KKO. Data gardu diperbarui harian oleh bot. KKO tetap tidak pernah memblokir alur (aturan §51 tidak berubah).

## 2. Hasil pembacaan file contoh

| Temuan | Angka | Dampak desain |
|---|---|---|
| Baris total / baris berisi gardu | 1.296 / 971 | 325 baris hampir kosong (hanya sebagian kolom): **ditolak** saat impor, dilaporkan. |
| Kunci unik | `KD_GARDU` 971 unik; `ASSETNUM` 956 unik; `LOCATION` 956 unik (`GD01.xxxxxxxx`); `SSOTNUMG` 956 unik | Kunci bisnis = `KD_GARDU` (kode lapangan, mis. HD0001). `ASSETNUM`/`LOCATION` kunci kedua (ID aset Maximo), 15 gardu belum punya. |
| Satu UP3 | `UPJ`=JBG (Jombang); 15 ULP/penyulang lewat `ULPPYLG` (mis. `JBG/WTGLH`) | Petakan ke `organizational_units` lewat kode ULP; ULP tak dikenal = ditolak. |
| Jenis | 2 tiang 627, 1 tiang 294, beton (cubicle) 50 | Master jenis gardu (kode tetap). |
| Kepemilikan / status | PLN 921, Pelanggan 50; UMUM 583, KHUSUS 387 | **Gardu khusus (milik pelanggan) tidak dipilih untuk KKO beban PLN**; tetap disimpan sebagai master. |
| Kapasitas | `KAP_TOTAL` (kVA) 23 nilai berbeda; sebagian trafo 2–3 unit (`JMLTRF1..3`, `KAPSTAS`) | Simpan kapasitas total dan daftar trafo (maks. 3). |
| Data operasional | `PERSEN` 0 pada 598 baris, `BEBAN`=0 pada 767, `TEG_UJUNG`=0 pada 703; `BLTHUKUR` hanya 062016/122016 (2016) | **Nilai 0 = belum diukur, bukan beban nol.** Pembacaan operasional harus punya tanggal ukur dan umur data; data lebih tua dari batas (usul 12 bulan) ditandai kedaluwarsa. |
| Koordinat | `DY`/`DZ` (desimal titik) dan `EY`/`EZ` (koma); `DV` rusak encoding (derajat) | Pakai `LATITUDEY/LONGITUDEX` (diganti koma→titik), abaikan `DV`. |
| Wilayah | kabupaten, kecamatan, kelurahan, provinsi | Disimpan sebagai teks untuk pencarian. |

Catatan nilai: `LOADFKTR` selalu 0 (faktor beban **tidak** dipakai dari gardu; tetap dari parameter KKF 0,8 sesuai keputusan pemilik). `BEBAN` diasumsikan kVA dan `PERSEN` pembebanan %; **perlu konfirmasi pemilik** (lihat §9).

## 3. Model data

Tiga tabel baru, mengikuti pola yang sudah ada (UUID, `timestampsTz`, tabel riwayat append-only dengan snapshot).

### 3.1 `substations` (master, satu baris per gardu)
- `id` uuid, `code` (KD_GARDU, unik), `asset_number`, `location_code` (GD01…), `ssot_gardu_id`, `gadis_number` (NO_GADIS)
- `organizational_unit_id` (ULP) → `organizational_units`; `feeder_code` (KD_PYLG), `gi_code` (KD_GI), `jtm_number` (NO_JTM)
- `type_code` (`GD2T|GD1T|BETON|…`), `ownership` (`PLN|PELANGGAN`), `usage` (`UMUM|KHUSUS|CAMPURAN`)
- `name`/`address` (LOKASI), `kabupaten`, `kecamatan`, `kelurahan`, `latitude`, `longitude`
- `capacity_kva` (KAP_TOTAL), `transformer_count`, `phase_count`
- `status` (`AKTIF|NONAKTIF`), `source_batch_id`, `last_seen_at` (terakhir muncul di sinkron)
- Indeks: `code` unik, `(organizational_unit_id, status)`, trigram/`lower(name)` untuk pencarian; `latitude/longitude` bagi pencarian terdekat.

### 3.2 `substation_transformers` (maks. 3 per gardu)
`substation_id`, `slot` (1–3), `brand`, `serial_number`, `year_made`, `capacity_kva`, `phase`, `vector_group`, `tap`, `impedance`, `status_trf`. Menyimpan MRKTRF/NOSERITRF/THNTRF/JNSHUB/TAP/IMPEDAN 1–3. Tanpa kolom wajib kecuali `slot` dan `capacity_kva`.

### 3.3 `substation_readings` (pembacaan operasional, append-only)
`id`, `substation_id`, `measured_on` (tanggal ukur), `load_kva`, `loading_pct`, `end_voltage_v` (TEG_UJUNG), `kwh_total` (JMLKWH), `source` (`SYNC|MANUAL|SURVEY`), `batch_id`, `created_at`.
- Unik `(substation_id, measured_on, source)`: sinkron ulang hari yang sama tidak menggandakan.
- `0` pada beban/persen/tegangan **tidak disimpan sebagai pembacaan** (dianggap belum diukur) kecuali sumber menyatakan eksplisit.
- Tampilan "terkini" = pembacaan terbaru; `age_days` dihitung; `stale` bila lebih tua dari `config('distriva.substation_reading_max_age_days')` (usul 365).
- Tabel ini append-only (trigger imutabel seperti `application_kko_events`): koreksi = pembacaan baru.

### 3.4 `substation_sync_batches` (impor/sinkron, mengikuti `application_import_batches`)
`id`, `source` (`FILE|BOT`), `status` (`STAGED|CONFIRMED|DISCARDED`), `file_name`, `file_sha256`, `counts` jsonb (`NEW|CHANGED|UNCHANGED|REJECT|DEACTIVATE`), `initiated_by`, waktu. Baris staging: `substation_sync_rows` (nomor baris, kode, aksi, perubahan jsonb, galat) agar tinjauan sebelum konfirmasi sama dengan impor permohonan.

### 3.5 Perubahan di KKO (`application_kko`)
- Tambah `substation_id` (nullable, FK) — gardu yang dipilih saat survey.
- Kolom yang ada (`substation_code`, `substation_name`, `transformer_capacity_kva`, `measured_load_kva`, `measured_at`, `voltage_location_v`) **tetap sebagai snapshot** pada saat dicatat: perhitungan KKO tidak berubah ketika master gardu berubah kemudian (audit). Bila `substation_id` diisi, nilai awalnya diambil dari master + pembacaan terkini, dan petugas boleh menimpa hasil survey lapangan (beban hasil ukur survey lebih baru daripada master).
- Tanpa `substation_id` (gardu belum ada di master) KKO tetap bisa diisi manual seperti sekarang.

## 4. API (pola grant 403 → validasi 422 → aturan 409)

| Metode & jalur | Fungsi | Izin |
|---|---|---|
| `GET /master-data/substations?q=&unit=&feeder=&type=&usage=&near=lat,lng&page=` | daftar/cari (pilihan saat survey) | `substations.read` (cakupan unit) |
| `GET /master-data/substations/{id}` | detail + trafo + pembacaan terkini + 12 pembacaan terakhir | `substations.read` |
| `POST /master-data/substations/imports` → `POST …/imports/{batch}/confirm` / `DELETE …/{batch}` | impor berkas Excel/CSV, tinjau, konfirmasi | `substations.import` |
| `GET /master-data/substations/imports/{batch}` (+ baris, filter aksi) | tinjauan staging | `substations.import` |
| `POST /master-data/substations/{id}/readings` | pembacaan manual (mis. dari survey) | `substations.reading` |
| `POST /master-data/substations/readings/bulk` | dipakai bot harian (batch pembacaan, idempoten) | `substations.sync` |
| `PATCH /master-data/substations/{id}` | koreksi data master (alasan wajib; riwayat) | `substations.manage` |
| `GET /applications/{id}/kko/substation-suggestions` | gardu terdekat dari koordinat pemohon di ULP yang sama | `kko.read` |

Aturan: kode ULP harus dikenal; pembacaan tidak boleh berumur di masa depan; kapasitas > 0; `PUT /applications/{id}/kko` menerima `substation_id` dan menolak (409) bila gardu `NONAKTIF` atau di luar cakupan unit pengguna. Cakupan unit memakai mekanisme yang sama dengan impor permohonan (ULP dan keturunan UP3).

Izin baru ditambah di `config/distriva_permissions.php`: `substations.read` (ULP, UP3, Perencanaan, Teknik), `substations.manage` & `substations.import` (UP3 Perencanaan/Teknik, SYS_ADMIN dengan MFA), `substations.reading` (survey), `substations.sync` (akun bot khusus, tanpa hak lain).

## 5. Alur impor dan pembaruan master

1. Unggah berkas (format sama dengan `gardu-SEP2026`, kolom dikenali dari judul; kolom tak dikenal diabaikan dan dilaporkan).
2. Tiap baris diklasifikasi: `NEW`, `CHANGED` (daftar kolom berubah), `UNCHANGED`, `REJECT` (alasan), `MISSING` (ada di DB, tak ada di berkas penuh: hanya ditandai `needs_review`).
3. Tinjau → konfirmasi (transaksi tunggal) → master dan pembacaan terbarui; seluruhnya tercatat di batch.
4. Aturan tolak: kode kosong, ULP tak dikenal, kapasitas ≤ 0 atau bukan angka, kode ganda dalam berkas, baris "setengah kosong" (kasus 325 baris contoh).
5. Gardu yang hilang dari berkas penuh hanya ditandai `needs_review` (keputusan pemilik); penonaktifan tidak menghapus apa pun; KKO lama tetap merujuk snapshot-nya.

## 6. Frontend

**Halaman baru** `Master Data › Gardu` (`SubstationsPage.jsx`):
- Tabel dengan pencarian kode/nama/alamat, filter ULP, penyulang, jenis, kepemilikan, status data (`Terbaru | Kedaluwarsa | Belum ada`), kolom kapasitas, pembebanan terakhir (dengan label kelas Underload/Normal/Overload/Overblast dan warna yang sama dengan KKO), tegangan ujung, tanggal ukur.
- Drawer detail: identitas, peta mini (koordinat), daftar trafo, grafik/tabel 12 pembacaan terakhir, riwayat perubahan.
- Tombol "Impor" (`SubstationImportModal.jsx`) dengan alur uji → tinjau → terapkan seperti modal impor lain (kirim `dry_run` sebagai `1/0`).

**Komponen pilihan gardu** `SubstationPicker.jsx` (dipakai di `ApplicationKkoPanel.jsx`):
- Kotak pencarian bertahap (kode/nama/alamat), diurutkan terdekat dari koordinat permohonan bila ada; hanya gardu aktif di cakupan unit; gardu milik pelanggan ditandai dan dinonaktifkan sebagai pilihan.
- Setelah dipilih, otomatis mengisi: kode, nama, kapasitas, beban dan tanggal ukur terakhir, tegangan ujung; menampilkan lencana **"Data diukur 12/2016 — kedaluwarsa"** bila lebih tua dari batas, agar petugas menimpa dengan hasil survey.
- Bidang tetap bisa diubah (hasil survey menimpa master); tautan "gardu tidak ada di daftar" membuka isian manual seperti sekarang.
- Nilai pembebanan sebelum/sesudah tetap dihitung server (rumus §51 tidak berubah); frontend hanya menampilkan.

## 7. Bot sinkron harian (`tools/gardu_sync`)

Mengikuti pola `tools/eis_sync` (login ke DISTRIVA dengan akun bot, unggah bertahap, jadwal harian).

- **Akun**: pengguna khusus dengan izin `substations.sync` saja; kata sandi di `.env`, tidak dicatat di keluaran.
- **Dua jenis sinkron** (dipisah karena frekuensinya berbeda):
  1. *Pembacaan operasional harian* → `POST /readings/bulk` (kunci `code` + `measured_on`; idempoten; maks. N baris per permintaan).
  2. *Master (kapasitas, trafo, lokasi)* mingguan/bulanan atau saat ada perubahan → jalur impor bertahap yang sama dengan unggah berkas (STAGED lalu konfirmasi bila `--konfirmasi`).
- **Sumber data: belum ditetapkan** (lihat §9). Struktur bot memisahkan `sumber` (modul yang menghasilkan baris standar) dari `pengirim` (yang memanggil API), sehingga pergantian sumber (Maximo, AP2T, portal pengukuran, berkas di folder bersama) hanya mengganti satu modul.
- **Pengaman** (sama dengan EIS): bandingkan jumlah baris sumber dan yang diterima; tidak menerapkan otomatis bila beda; hapus berkas unduhan setelah berhasil; percobaan ulang dengan login ulang; tidak melewati data secara diam-diam bila sumber kosong setelah gagal; nilai 0 tidak dianggap pengukuran.
- **Perintah**: `python3 main.py cek | sync [--konfirmasi] | schedule --jam 05:30`.

## 8. Pengujian dan tahapan

Tahap A — backend (±2 hari): migrasi, model/service, impor berkas dengan staging, pembacaan manual dan bulk, `substation_id` di KKO, izin, tes fitur (cakupan, kedaluwarsa, nilai 0, idempotensi, baris tolak, KKO tetap memakai snapshot).
Tahap B — frontend (±2 hari): halaman Gardu, impor, `SubstationPicker` di panel KKO, tes alur.
Tahap C — bot (±1 hari setelah sumber jelas): modul sumber + pengirim, tes offline dengan stub.
Data awal: impor `gardu-SEP2026.xlsx` (971 gardu, 325 baris ditolak) sebagai uji nyata pertama.

## 9. Keputusan pemilik (2026-11-10)

1. **Sumber data harian**: web internal **Maximo PLN**. Bot memakai pola `tools/eis_sync` (login dengan akun bot, ambil lewat HTTP, peramban hanya untuk login). Alamat, menu, dan jenis ekspor Maximo masih perlu ditinjau (langkah `inspect` seperti EIS) sebelum modul sumber ditulis.
2. **Arti kolom**: `BEBAN` = arus (ampere); pembebanan dalam kVA dihitung dari beban dan tegangan, lalu dinyatakan dalam persen (`PERSEN`); `TEG_UJUNG` = tegangan ujung (volt).
3. **Kedaluwarsa**: 12 bulan (`substation_reading_max_age_days` = 365).
4. **Gardu milik pelanggan**: disimpan, **tidak bisa dipilih** untuk KKO.
5. **Gardu yang hilang dari berkas penuh**: **hanya ditandai** untuk ditinjau (`needs_review`), tidak dinonaktifkan otomatis; petugas menonaktifkan secara manual.

### Temuan yang memengaruhi model pembacaan
Pada baris contoh yang berisi data, `BEBAN` (A) dan `PERSEN` tidak dapat dihubungkan dengan satu rumus tunggal: kVA dari persen (kapasitas × persen) dibagi arus berkisar 1,2–3,1 kVA per ampere, sedangkan √3 × 400 V × arus hanya sekitar 0,07 kVA per ampere. Artinya `BEBAN` kemungkinan arus **satu fasa atau satu jurusan** (kolom `JURUSAN` 1–3), sedangkan `PERSEN` berasal dari seluruh fasa/jurusan. Karena itu:
- `substation_readings` menyimpan **arus per fasa** (`current_r_a`, `current_s_a`, `current_t_a`, `current_n_a`) bila Maximo menyediakannya, `end_voltage_v`, **`load_kva`** dan **`loading_pct`**, ditambah `current_max_a` (nilai `BEBAN` lama).
- `load_kva` dihitung server dari data yang diberikan sumber dengan urutan: (a) `loading_pct` × kapasitas bila persen tersedia dari sumber; (b) bila hanya arus per fasa dan tegangan: jumlah (tegangan fasa-netral × arus tiap fasa) / 1000. Rumus (b) dipastikan lebih dulu dengan contoh nyata dari Maximo; sampai itu jelas, nilai yang dipakai KKO adalah (a) atau isian petugas.
- Nilai `BEBAN` tunggal tanpa fasa tidak dipakai untuk menghitung kVA.

## 10. Langkah berikutnya
Tahap A (backend) dan B (frontend) tidak bergantung pada Maximo dan dapat dimulai sekarang. Tahap C menunggu pemeriksaan halaman Maximo (menu, kolom, akun bot).

## 11. Status tahap A (backend) — 2026-11-10

Dikerjakan: migrasi `2026_11_10_100000_create_substations` (master, trafo slot 1–3, pembacaan append-only dengan trigger, batch dan baris staging, `application_kko.substation_id`); `SubstationService`
(impor bertahap, pembacaan manual dan bulk, `deriveLoad`, kedaluwarsa 365 hari, `needs_review`); `SubstationController`; izin `substations.*` (+ `SubstationPermissionSeeder`); `PUT /applications/{id}/kko` menerima
`substation_id` (kode, nama, kapasitas, beban terakhir, tegangan ujung diisi dari master bila petugas tidak mengisi; gardu pelanggan/nonaktif ditolak 409; hasil tetap menjadi snapshot).

Rute (`/api/master-data/…`): `GET substations`, `GET substations/{id}`, `PATCH substations/{id}` (alasan wajib), `POST substations/{id}/readings`, `POST substations/readings/bulk`, `POST substations/imports`,
`GET substations/imports/{batch}`, `POST substations/imports/{batch}/confirm`, `DELETE substations/imports/{batch}`.

Aturan impor: unit dari kolom `ULP_CODE`, jika kosong dari 5 digit awal `SSOTNUMG` (kode ULP), jika kosong dari unit bawaan (`unit_id`); kapasitas > 0 wajib; kode ganda ditolak; `full_snapshot` hanya menandai gardu yang hilang.
Trafo dari berkas: hanya slot 1 (slot 2–3 menunggu kapasitas per trafo dari Maximo). Pembacaan dari berkas: bulan ukur dari `BLTHUKUR` (mmYYYY, tanggal 1), `PERSEN`, `TEG_UJUNG`, `JMLKWH`, `BEBAN` disimpan sebagai `current_max_a` (tidak dijadikan kVA).

Uji nyata `gardu-SEP2026.xlsx` (tahap tinjau, tidak diterapkan): 1.296 baris → **956 baru**, 340 ditolak (325 baris tanpa KD_GARDU, 15 gardu baru HD0976 dst. tanpa SSOTNUMG sehingga unit tak dapat ditentukan: isi `unit_id` ULP Jombang pada unggahan).
Tes: `tests/Feature/SubstationTest.php` (9 tes) dan `KkoTest` lolos.

## 12. Status tahap B (frontend)
Dikerjakan: `substationsApi` (services/api.js); halaman **Master Data › Master Gardu** (`/master-data/substations`, izin `substations.view`; filter unit, kepemilikan, status pembacaan, perlu ditinjau; detail dengan trafo, 12 pembacaan, dan form pembacaan untuk yang berhak);
`SubstationImportModal` (unggah → tinjau NEW/CHANGED/UNCHANGED/REJECT → terapkan atau buang; menutup panel membuang batch yang belum dikonfirmasi); `SubstationPicker` di `ApplicationKkoPanel`
(cari gardu PLN aktif, mengisi formulir di sisi klien lalu mengirim `substation_id`; peringatan bila pembacaan kedaluwarsa, belum ada, atau tanpa kVA sehingga beban diisi manual).
Tes: `SubstationsPage.test.jsx` (5), `ApplicationKkoPanel.test.jsx` (+3); seluruh suite frontend 302 lolos, build berhasil.
Catatan: komponen `Alert` tidak meneruskan `data-testid`; tes `kko-dedicated-hint` yang sudah ada memeriksa ketiadaan elemen itu sehingga tidak membuktikan apa pun (belum diperbaiki).


## 13. Impor berkas asli ke database dev (2026-11-10)
`gardu-SEP2026.xlsx`, unit bawaan ULP Jombang (51453), daftar lengkap: 971 gardu baru, 957 trafo (slot 1), 388 pembacaan, 50 gardu milik pelanggan (tersimpan, tidak dapat dipilih); 325 baris tanpa `KD_GARDU` ditolak.
Percobaan pertama gagal seluruhnya (dibatalkan, tidak ada data setengah masuk) karena satu baris bertegangan ujung 2200 V (salah ketik untuk 220,0). Sekarang tegangan di luar 0–1000 V dianggap tidak terukur: gardu dan persen tetap masuk, hanya tegangan itu dibuang (tes `an_impossible_end_voltage…`).

## 14. Analisis gardu (permintaan pemilik 2026-11-11)
Tujuan: melihat riwayat pengukuran, keseimbangan beban antar fasa dan antar jurusan, tegangan pangkal di bawah 231 V, tegangan ujung yang drop, dan perkiraan beban trafo dari hasil ukur ditambah pelanggan baru tiap bulan.

**Data.** `substation_readings` mendapat `base_voltage_r/s/t_v` (tegangan pangkal per fasa). Tabel baru `substation_reading_feeders` (anak pembacaan, append-only): satu baris per jurusan dengan arus R/S/T/N dan tegangan ujungnya. Bila arus R/S/T gardu tidak diisi, arus gardu = jumlah semua jurusan.
Berkas `gardu-SEP2026.xlsx` tidak memuat tegangan pangkal maupun arus per jurusan (hanya `JURUSAN` = jumlah, `TEG_UJUNG`, `PERSEN`, `DAYAVA`); datanya harus datang dari Maximo (bot, tahap C) atau input survei.

**Aturan.**
- Ketidakseimbangan % = rata-rata selisih mutlak dari rata-rata ÷ rata-rata (R,S,T; atau total tiap jurusan). Perlu ketiga fasa / minimal dua jurusan; bila kurang, tidak ada angka (tidak menebak).
- Tegangan pangkal terendah < **231 V** (ketentuan pemilik) → `BASE_LOW`. Tegangan ujung ≤ 200 V (batas KKO) → `END_LOW`. Drop = pangkal terendah − ujung terendah (termasuk ujung tiap jurusan); drop > batas % dari pangkal → `END_DROP`.
- **Batas yang masih usulan, perlu dikonfirmasi pemilik**: ketidakseimbangan fasa 20 %, antar jurusan 30 %, drop 10 % (`DISTRIVA_SUBSTATION_IMBALANCE_MAX_PCT`, `…_FEEDER_IMBALANCE_MAX_PCT`, `…_DROP_MAX_PCT`; pangkal `…_BASE_VOLTAGE_MIN_V` = 231).
- Proyeksi: beban terukur terakhir yang memuat kVA + pelanggan tersambung sejak bulan ukur + pipeline (permohonan gardu ini yang belum tersambung, belum batal, KKO bukan TIDAK_LAYAK, bukan trafo khusus) di bulan pertama + rata-rata penambahan 12 bulan terakhir mulai bulan kedua. Tiap penambahan = perubahan daya × faktor beban KKO. Simulasi `growth_kva` mengganti rata-rata. Tren dari pembacaan (`trend_kva_per_month`) hanya informasi, tidak masuk hitungan.
- Penambahan pelanggan hanya dari permohonan DISTRIVA yang KKO-nya terhubung ke gardu; pelanggan yang tersambung di luar DISTRIVA belum terhitung. Beban lama yang sudah tercermin di pengukuran tidak dihitung dua kali, tetapi tanggal ukur dari berkas adalah tanggal 1 bulan, sehingga pelanggan tersambung di bulan itu bisa terhitung dua kali (konservatif).

**API.** `GET /master-data/substations/{id}/analysis?horizon=1..36&growth_kva=` (`substations.view`); pembacaan manual dan bulk menerima `base_voltage_r_v/s_v/t_v` dan `feeders[]{label, current_r_a, current_s_a, current_t_a, current_n_a, end_voltage_v}`; daftar gardu menerima `alert=BASE_LOW|END_LOW` (berdasarkan pembacaan terakhir tiap gardu) dan tiap `reading` memuat `flags`.
**UI.** Detail gardu punya tab Ringkasan / Analisis (Riwayat, Keseimbangan, Tegangan, Proyeksi dengan grafik dan simulasi); form pembacaan memuat tegangan pangkal dan baris per jurusan; daftar memuat penanda dan filter tegangan.
**Tes.** Backend `SubstationTest` 14 tes (rumus, jurusan, bendera, filter, proyeksi); frontend `SubstationsPage.test.jsx` 10 tes.

## 15. Pemisahan halaman: Master Gardu (aset) dan Pengukuran Gardu (kondisi) — 2026-11-13
Alasan: kolom aset hampir lengkap (nama, kapasitas, penyulang 971/971; koordinat 970; kecamatan 844; merk trafo 923 dan tahun 928 dari 957 trafo), sedangkan pembacaan hanya ada pada 388 dari 971 gardu dan semuanya tertanggal 2016-06 s.d. 2024-10 (kedaluwarsa). Dua pengguna berbeda: Perencanaan/Enjiniring mengelola data induk; Teknik ULP dan survei memakai pengukuran.
- **Master Gardu** `/master-data/substations`: kode, nama/lokasi, alamat gabungan, unit, penyulang, kapasitas, merk dan tahun (umur) trafo, koordinat, kepemilikan, status; detail data induk, trafo, pelanggan, riwayat perubahan. Impor tetap di sini.
- **Pengukuran Gardu** `/master-data/substation-measurements`: pembebanan, tegangan pangkal/ujung, usia pembacaan, peringatan; detail = analisis (riwayat, keseimbangan, tegangan, proyeksi) dan tambah pembacaan.
- **Backend (selesai):** daftar gardu memuat `address` (area_note, kelurahan, kecamatan, kabupaten), `transformer_brand`, `transformer_year`, `transformer_age_years` (trafo slot 1; umur tidak dibuat bila tahun tidak ada/tidak wajar). Filter baru: `kecamatan`, `brand`, `year_from`, `year_to`, `capacity_min|max`, `has_coordinates`, `loading_min|max`, `alert` (`BASE_LOW|END_LOW|PHASE_UNBALANCED|END_DROP`); `reading_status` kini disaring di query (sebelumnya setelah paginasi, total salah). Urutan: `sort` (`code|name|capacity|year|loading|measured_on`) dan `dir`; nilai kosong selalu di akhir.
- **Riwayat perubahan data induk gardu** (`substation_changes`, append-only): `PATCH substations/{id}` kini menyimpan siapa, apa (sebelum/sesudah, hanya isian yang benar-benar berubah), dan alasan; detail gardu memuat `history[≤20]`. Menutup celah yang dicatat di docs/81 §7.
- **Frontend:** `docs/PROMPT-FRONTEND-GARDU-PENGUKURAN.md` (selesai 2026-11-13: `SubstationsPage.jsx` untuk data induk aset dan `SubstationMeasurementsPage.jsx` untuk kondisi operasional & pengukuran; menu `AppLayout.jsx` dan rute `App.jsx` terdaftar; seluruh 34 berkas tes dengan 326 pengujian lolos, build Vite berhasil).
