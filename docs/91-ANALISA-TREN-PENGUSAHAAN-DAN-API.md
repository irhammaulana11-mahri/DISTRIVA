# 91 — Analisa dan Tren Pengusahaan (Tahap 1–2) dan API

Modul untuk melihat tren dan analisa indikator pengusahaan per ULP atau UP3 sesuai kewenangan. Satu katalog metrik di backend, satu pola halaman untuk semua menu. Dokumen ini menjadi kontrak API untuk agen frontend.

## 1. Katalog metrik dan sumbernya

Semua angka bulanan per ULP. UP3 = gabungan semua ULP di bawahnya: angka arus dan saldo dijumlahkan, rata-rata waktu ditimbang jumlah kejadian, dan SAIDI/SAIFI ditimbang jumlah pelanggan DIFI.

| Kode | Menu | Sumber | Seri | Kumulatif tahun berjalan |
|---|---|---|---|---|
| `pelanggan` | Pelanggan | 309, baris JUMLAH; rincian per kelompok tarif (JUMLAH S/R/B/I/P, baris T/C/L) | jumlah pelanggan | posisi akhir |
| `daya` | Daya | 309 | MVA | posisi akhir |
| `kwh-jual` | kWh Jual | 309 | kWh | jumlah |
| `pendapatan` | Pendapatan | 309 (`rp_jumlah`) | Rp; Rp/kWh | jumlah |
| `piutang-prabayar` | Piutang Pra | PIUTANGLPB_EIS; rincian BARU/BERJALAN/TUNGGAKAN (baris total tidak dipakai) | saldo Rp; lembar | posisi akhir |
| `piutang-pascabayar` | Piutang Pasca | AKHIEPERIODE_EIS per kogol (baris "SEMUA KOGOL" tidak dipakai) | saldo lewat tanggal 20; rekening baru; persen saldo/rekening baru; lembar | posisi akhir |
| `piutang-pascabayar-umur` | Piutang Pasca (umur) | UMURPIUTANG: tunggakan per jumlah lembar dan kogol; rincian per umur (1, 2, 3, 4-6, 7-12, > 12 bulan, urutan tetap), rincian kedua per kogol, dan matriks kogol × umur | tunggakan Rp; pelanggan; lembar; umur rata-rata (lembar/pelanggan, bulan); % tunggakan > 3 bulan | posisi akhir |
| `rpt-rct-keluhan` | RPT-RCT Keluhan | KLHALL (baris "Total" tidak dipakai) | response dan recovery rata-rata (jam); jumlah keluhan; % respons dalam SLA | tertimbang |
| `rpt-rct-gangguan` | RPT-RCT Gangguan | GGNALL (baris "Total" tidak dipakai) | response dan recovery rata-rata (menit); jumlah; % respons dalam SLA | tertimbang |
| `saidi-saifi` | SAIDI SAIFI | ringkasan DIFI | menit/plg; kali/plg | jumlah bulanan |
| `ens` | ENS | DIFI, baris TOTAL KELOMPOK Distribusi | MWh | jumlah |
| `kwh-p2tl` | kWh P2TL | TAGSUS golongan P1-P4, K2, tanpa golongan (baris TS kWh dan DKRP tidak dipakai) | kWh; Rp; jumlah pelanggan | jumlah |
| `gangguan` | Gangguan | data gangguan penyulang tersinkron; rincian permanen/temporer | jumlah; permanen; temporer | jumlah |
| `anomali-keluhan` | Anomali Keluhan | KLHBERULANG dan KLHNEGATIF (docs/88); bulan dihitung hanya bila **kedua** laporan ada | total pengaduan keluhan (WO); keluhan berulang; berulang terhadap total (%); rating negatif; rating negatif terhadap total (%) | jumlah (persen: rasio jumlah) |
| `anomali-gangguan` | Anomali Gangguan | GGNBERULANG dan GGNNEGATIF; bulan dihitung hanya bila kedua laporan ada | seri sama dengan keluhan ditambah rating negatif tanpa marking (`negatif_nonmarking`, ukuran NKO) | jumlah (persen: rasio jumlah) |
| `hpl-bp` | HPL Biaya BP | permohonan PB/PD menurut tanggal lunas (`paid_at`, WIB), tanpa yang dibatalkan atau direstitusi; rincian PB/PD | Rp; jumlah permohonan | jumlah |
| `susut` | Susut | masukan bulanan kWh beli, E-Min, PSSD (§3a) dan kWh jual 309 (baris JUMLAH); bulan dihitung hanya bila kWh beli dan laporan 309 ada | susut %; susut kWh; kWh beli; kWh jual | rasio jumlah (= rumus susut NKO) |

- **Anomali keluhan dan gangguan**: berulang = pengaduan yang berulang, rating negatif = pengaduan yang mendapat penilaian negatif; angka = pengaduan yang diselesaikan secara anomali (jumlah kedua kanal PLN Mobile dan CC 123; gangguan juga dipisah marking dan non marking). `breakdown` = komposisi kanal pengaduan masuk (CC 123, PLN Mobile, Loket, Lainnya) dari total WO; `breakdown_secondary` = komposisi anomali menurut jenis (berulang atau rating negatif), kanal, dan (gangguan) penandaan; tanpa `matrix`. Polarity `down` (makin kecil makin baik). Kelengkapan dan histori sumber menghitung bulan lengkap hanya bila kedua jenis laporan ada (`families` pada `GET /metrics/{code}/history`).
Catatan sumber:
- **HPL Biaya BP**: kolom `BP` pada AKHIRBULAN_EIS bernilai 0 di semua 46 bulan contoh, begitu pula baris "Penetapan Cicilan BP" pada 309EIS. Karena itu sumbernya adalah biaya permohonan yang sudah lunas (data untuk semua ULP sejak 2022).
- **Umur piutang pascabayar**: dari laporan UMURPIUTANG (docs/88), yaitu tunggakan menurut jumlah lembar per pelanggan. `piutang-pascabayar` (AKHIEPERIODE) tetap untuk saldo lewat tanggal 20 terhadap rekening baru; totalnya berbeda karena cakupannya berbeda (contoh Jombang Oktober 2026: tunggakan Rp 680,8 juta, saldo lewat tanggal 20 Rp 2,53 miliar). Contoh UMURPIUTANG baru satu bulan (Jombang Oktober 2026), jadi tren dan YoY terbentuk setelah bulan lain diunggah.
- **Susut** = (kWh beli − E-Min − PSSD − kWh jual) / (kWh beli − E-Min − PSSD) × 100, per bulan dan kumulatif (jumlah susut kWh dibagi jumlah beli bersih). E-Min dan PSSD dianggap 0 bila kosong. Belum ada data kWh beli di sistem, jadi metrik ini kosong sampai masukan diisi.
- Data EIS saat ini hanya ULP Jombang (Januari 2023 sampai Oktober 2026; DIFI 18 bulan). Tampilan UP3 lengkap setelah laporan semua ULP diimpor.

## 2. Izin

`pengusahaan.view` diberikan ke peran yang sama dengan `nko.view`: MANAGER_ULP, MANAGER_UP3, TEKNIK, NIAGA_RETAIL, ASMAN_NIAGA, ASMAN_PERENCANAAN, PERENCANAAN, ASMAN_JARINGAN, dan SYS_ADMIN. Seeder: `NkoPermissionSeeder`. Cakupan:
- peran ULP hanya melihat ULP-nya;
- peran tingkat UP3 melihat UP3 itu dan semua ULP di bawahnya;
- SYS_ADMIN melihat semua unit;
- unit di luar cakupan dijawab 404.

`pengusahaan.input` (mengisi masukan bulanan kWh beli, E-Min, PSSD): PERENCANAAN, ASMAN_PERENCANAAN, SYS_ADMIN (MFA), sama dengan pengisi masukan NKO. Peran tingkat UP3 mengisi untuk ULP di bawahnya; masukan hanya per ULP (UP3 dijawab 404).

Peta izin frontend: `GET /planning/access` memuat `pengusahaan.view` dan `pengusahaan.input`.

## 3. API (di bawah `/api/pengusahaan`, auth, throttle `admin`)

| Metode dan jalur | Fungsi |
|---|---|
| `GET /metrics` | `metrics[]`: `code, name, source, polarity` (`up` = makin besar makin baik, `down` = sebaliknya), `available`, `breakdown` (nama dimensi atau null), `series[]` (`key, name, unit`). `units[]`: unit yang boleh dilihat (`id, name, unit_type, parent_id`) untuk filter |
| `GET /metrics/{code}?unit_id=&from=YYYY-MM&to=YYYY-MM` | Analisa satu metrik. Bawaan `to` = bulan laporan terakhir (susut: bulan kWh beli terakhir; sumber non-laporan lain: bulan lalu); `from` = 23 bulan sebelum `to`. Rentang paling panjang 60 bulan |
| `GET /metrics/{code}/forecast?unit_id=` | Prakiraan 12 bulan tiap seri beserta analisa teks (lihat §3c) |
| `GET /metrics/{code}/history?unit_id=` | Histori sumber data: berkas laporan masuk, kelengkapan ULP x 24 bulan, sesi sinkronisasi terkait (lihat §3c) |
| `GET /metrics/{code}/export?unit_id=&from=&to=` | Unduhan Excel metrik itu (lihat §3c) |
| `GET /inputs?unit_id=&year=` | Masukan bulanan satu ULP setahun (lihat §3a) |
| `PUT /inputs` | Simpan masukan bulanan (lihat §3a), butuh `pengusahaan.input` |

Respons `GET /metrics/{code}` (`data`):
- `unit` (`id, name, unit_type`); `metric` (`code, name, source, polarity, ytd_mode`); `from`, `to`, `months[]`.
- `units_expected` (jumlah ULP yang digabung; 1 untuk ULP) dan `units_reporting[]` (sejajar `months`: jumlah ULP yang punya data bulan itu). Bila `units_reporting` < `units_expected`, angka UP3 bulan itu **belum utuh**: tampilkan penanda (mis. "1/10 ULP") pada grafik dan kartu.
- `comparison_basis` (`mom`, `yoy`, `ytd`): jumlah ULP yang dipakai untuk menghitung persentase perubahan.
- `series[]`: `key, name, unit, values[]` (sejajar `months`), dan `previous_year[]` (bulan yang sama tahun lalu). Nilai `null` berarti tidak ada data, bukan nol.
- `summary[]` per seri: `latest`, `previous_month`, `mom_pct`, `same_month_last_year`, `yoy_pct`, `ytd`, `ytd_previous_year`, `ytd_pct`. Nilai (`latest`, `ytd`, dst.) memakai semua ULP yang melapor; **persentase (`mom_pct`, `yoy_pct`, `ytd_pct`) dihitung setara**, hanya dari ULP yang punya data di kedua periode (jumlahnya pada `comparison_basis`), sehingga persentase bisa berbeda dari selisih dua angka yang tampil. Persentase null bila tidak ada ULP yang setara. Arti `ytd` mengikuti `ytd_mode`:
  - `last`: posisi akhir bulan;
  - `sum`: jumlah nilai bulanan;
  - `ratio`: jumlah angka mentah Januari sampai `to` lalu dihitung (rata-rata tertimbang).
  - `ytd` bernilai null bila ada bulan yang datanya kosong sama sekali.
- `breakdown` (null bila metrik tanpa rincian): `dimension`, `period`, dan `rows[]` (`key, value, share_pct, same_month_last_year, yoy_pct`, urut dari terbesar). Rincian adalah komposisi seri pertama pada bulan `to`. Urutan baris: terbesar dulu, kecuali dimensi berurutan tetap (umur tunggakan).
- `breakdown_secondary` (null bila tidak ada): rincian kedua dengan bentuk sama seperti `breakdown` (saat ini kogol pada `piutang-pascabayar-umur`).
- `matrix` (null bila tidak ada): `rows_dimension`, `columns_dimension`, `period`, `rows[]`, `columns[]`, `values[][]` (baris × kolom, nilai seri pertama), mis. kogol × umur. Tampilkan sebagai tabel silang (heatmap opsional).
- `comparison[]` (hanya bila unit UP3): per ULP `unit_id, unit_name, latest, yoy_pct, ytd` untuk seri pertama, urut `latest` turun.
- `coverage`: `months_expected`, dan `missing[]` (`unit_id, unit_name, months[]`) berisi bulan yang laporannya belum diunggah per ULP. Untuk metrik berbasis laporan EIS dan susut (bulan tanpa kWh beli atau tanpa laporan 309). Bulan kosong tidak dihitung nol: angka UP3 bulan itu hanya memuat ULP yang ada datanya.
- `companions` (null bila metrik tak punya pendamping): data operasional DISTRIVA yang **menjelaskan** angka resmi, dari unit dan rentang yang sama dengan seri resmi. `source` dan `series[]` (`key, name, unit, values[]` sejajar `months`, `previous_year[]`, `latest`, `ytd`, `ytd_previous_year`). Bulan tanpa kejadian bernilai 0 (rasio tanpa penyebut: null). Pendamping per metrik:

  | Metrik | Resmi | Pendamping (`series[].key`) | Mode rekonsiliasi |
  |---|---|---|---|
  | `pelanggan` | Laporan 309 jumlah pelanggan | permohonan PB tersambung (`pb`), permohonan PB masuk (`req_pb`) | `net` |
  | `daya` | Laporan 309 daya tersambung | daya PB tersambung (`pb_kva`) dan PD neto (`pd_net_kva`), MVA | `net` |
  | `saidi-saifi` | DIFI SAIDI dan SAIFI (total, angka utama dan NKO) ditambah seri `saidi_penyulang`, `saifi_penyulang` = bagian **gangguan penyulang** DIFI | SAIDI dan SAIFI hitung DISTRIVA dari spreadsheet gangguan penyulang (`saidi_hitung`, `saifi_hitung`): gangguan lebih dari ambang menit, pelanggan penyulang dari potret DIL (batas atas) | `flow`, dua rekonsiliasi (`saidi`, `saifi`) **lawan bagian gangguan penyulang DIFI**, bukan total (total juga memuat padam JTR, sambungan rumah, dan pemeliharaan) |
  | `ens` | DIFI ENS (TOTAL KELOMPOK Distribusi, angka utama) ditambah `ens_penyulang` = ENS gangguan penyulang DIFI | ENS kolom spreadsheet gangguan penyulang menurut ULP peristiwa (`ens_sheet`, MWh) | `flow` lawan ENS gangguan penyulang DIFI |
  | `gangguan` | **spreadsheet gangguan penyulang** (gangguan feeder: PMT dan recloser): jumlah, permanen, temporer, `dihitung` (lebih dari ambang menit, aturan SAIDI/SAIFI) | DIFI **tingkat penyulang** (`reported`: bulan tanpa laporan DIFI tidak dibandingkan): `difi_gangguan`, `difi_pelanggan_gangguan` (pelanggan padam pada penyulang yang mengalami gangguan), `difi_pemeliharaan`, `difi_pelanggan_pemeliharaan` (pelanggan padam karena pemeliharaan penyulang) | `flow`: gangguan spreadsheet lebih dari ambang menit lawan gangguan penyulang DIFI; pemeliharaan tidak ada di spreadsheet sehingga hanya ditampilkan |
  | `kwh-jual` | Laporan 309 kWh jual | perkiraan kWh dari pelanggan baru (`est_kwh`) | `yoy` |
  | `pendapatan` | Laporan 309 rupiah | perkiraan pendapatan dari pelanggan baru (`est_rp`) | `yoy` |

  **DIFI tingkat penyulang** = baris subtotal fasilitas *Gardu Induk* (20 kV) dan *Penyulang* pada kelompok Distribusi: gangguan = sub kelompok Padam Tidak Terencana dan Bencana Alam, pemeliharaan = Padam Terencana; padam JTR, gardu distribusi, dan sambungan rumah/APP (di bawah penyulang) serta kelompok Transmisi dan Pembangkit tidak ikut. Pelanggan padam DIFI = pelanggan pada penyulang yang padam karena gangguan atau pemeliharaan; SAIDI bagian = jam x pelanggan x 60 / pelanggan unit, SAIFI bagian = pelanggan padam / pelanggan unit (rumus yang sama memberi SAIDI/SAIFI total pada ringkasan DIFI). Contoh Jombang Oktober 2026: TOTAL KELOMPOK Distribusi 1.962 kejadian, tetapi gangguan penyulang 0 dan pemeliharaan penyulang 5 (1.022 pelanggan); sisanya padam sambungan rumah dan JTR. Pendamping yang ditandai `reported` (berbasis laporan) membuat bulan tanpa laporan dikeluarkan dari perbandingan, bukan dianggap nol.
  `piutang-*`, `rpt-rct-gangguan`, `rpt-rct-keluhan`, `kwh-p2tl`, `hpl-bp`, dan `susut` belum punya pendamping (laporan pengaduan pelanggan, bukan gangguan penyulang). Dasar permohonan sama dengan Analisa Pelanggan (`/reports/customer-growth`): tersambung menurut status PEREMAJAAN, bukan dibatalkan atau direstitusi.
- `reconciliations` (null bila tanpa pendamping) adalah daftar rekonsiliasi; `reconciliation` = elemen pertama (untuk metrik satu rekonsiliasi keduanya sama). Tiap elemen: `key`, `mode`, `unit`, `official_name`, `companion_name`, `monthly[]` (`month, official_net, companion, difference, units_compared`; `difference` = pendamping dikurangi resmi), `ytd` (`year, base_month, to_month, official_net, companion, difference, units_compared, units_expected, previous_year, official_change_pct, companion_change_pct`), `note`. `ytd.previous_year` = kumulatif yang sama satu tahun sebelumnya (`base_month, to_month, official_net, companion, difference, units_compared`) **atas ULP yang sama** dengan `ytd` (setara); null bila data tahun lalu tidak ada. `official_change_pct` dan `companion_change_pct` = perubahan kumulatif tahun ini terhadap tahun lalu (null bila pembanding nol atau tidak ada). Contoh `pelanggan`: tambahan bersih Jan–Okt tahun ini lawan Jan–Okt tahun lalu, dan PB tersambung periode yang sama. Dua mode:
  - `net`: angka resmi berupa posisi (jumlah pelanggan, daya). `official_net` = tambahan bersih (selisih antar bulan; `ytd`: `to_month` dikurangi Desember tahun sebelumnya `base_month`). ULP dibandingkan bila punya angka resmi di kedua ujung.
  - `flow`: angka resmi berupa arus bulanan (SAIDI, SAIFI, ENS, jumlah gangguan). `official_net` = nilai resmi bulan itu; `ytd` = jumlah nilai bulanan Januari (`base_month`) sampai `to_month`. ULP dibandingkan bila punya angka resmi pada semua bulan yang dihitung (metrik tanpa laporan seperti `gangguan`: bulan tanpa kejadian dianggap nol).
  - `yoy`: angka resmi berupa arus bulanan dan yang dijelaskan adalah **kenaikannya** dibanding bulan yang sama tahun lalu (kWh jual, pendapatan). `official_net` = nilai bulan itu dikurangi nilai bulan yang sama tahun lalu; `companion` = **perkiraan** sumbangan pelanggan baru; `ytd` = jumlah kenaikan bulanan Januari sampai `to_month`. ULP dibandingkan bila punya Laporan 309 pada semua bulan itu dan bulan yang sama tahun lalu. `difference` = perkiraan dikurangi kenaikan resmi (negatif: sebagian besar kenaikan bukan dari pelanggan baru). **Perkiraan, bukan angka resmi, tanpa asumsi jam nyala dari luar**: daya PB tersambung dalam 12 bulan terakhir (termasuk bulan itu) per kelompok tarif (huruf pertama kode tarif baru: S, R, B, I, P) dikali kWh (atau rupiah) per kVA aktual kelompok itu pada bulan tersebut (penjualan kelompok dibagi daya tersambung kelompok, dari baris `JUMLAH S/R/B/I/P` Laporan 309). PB yang baru tersambung dihitung penuh sehingga sedikit melebihkan; PB bertarif di luar kelompok itu tidak dihitung. Catatan otomatis: sekitar berapa persen kenaikan resmi yang dapat dijelaskan pelanggan baru; perhatian bila perkiraan melebihi kenaikan resmi atau angka resmi tidak naik padahal ada pelanggan baru.
  - `ytd` null bila tidak ada ULP yang memenuhi syarat itu. **Hanya ULP yang memenuhi syarat yang dibandingkan, dan angka pendampingnya diambil dari ULP yang sama.** Dua sumber dicatat menurut waktu yang bisa bergeser antar bulan, sehingga nilai per bulan hanya informasi dan penilaian dilakukan pada `ytd`. Selisih besar menjadi catatan `insights` (`yoy`: lihat di atas; `net`: permohonan menambah tetapi 309 tidak naik, lebih dari separuh tidak tampak di 309, tambahan 309 melebihi permohonan 20%; `flow`: pendamping di bawah 50% atau di atas 150% dari angka resmi, atau resmi nol tetapi pendamping mencatat kejadian).
- `forecast` (null bila tidak ada): `{kind}` (`CUSTOMERS_ADDED`, `VA_ADDED` dari modul Forecasting; `OUTAGES` dengan `endpoint` `/outages/forecast` untuk gangguan, SAIDI/SAIFI, dan ENS).
- `insights[]`: `level` (`baik`, `perhatian`, `info`) dan `text`. Catatan otomatis berbasis aturan:
  - angka UP3 belum utuh (berapa dari berapa ULP melapor pada bulan terakhir);
  - kelengkapan laporan;
  - perubahan tahunan bulan terakhir ≥ 5%;
  - naik atau turun ≥ 3 bulan berturut-turut;
  - kumulatif dibanding tahun lalu;
  - porsi terbesar dan perubahan terbesar pada rincian;
  - ULP dengan perubahan tahunan terbaik dan terlemah.

  Baik atau buruk mengikuti `polarity`.

### 3c. Prakiraan, histori sumber data, dan unduhan Excel

Ketiganya memakai `unit_id` (ULP, atau UP3 = gabungan ULP di bawahnya) dengan cakupan yang sama seperti `GET /metrics/{code}`; 404 untuk metrik tidak dikenal atau unit di luar cakupan.

**`GET /metrics/{code}/forecast`** (`data`): `unit`, `status` (`OK` bila ada seri yang bisa diprakirakan, `INSUFFICIENT`, `UNAVAILABLE` untuk metrik tanpa sumber), `message`, `last_month`, `metric`, `units_expected`, `series[]`, `insights[]` (= `series[0].insights`), `notes[]`.
- Model: musiman dan tren (kelas `SeasonalForecaster`, sama dengan prakiraan gangguan). Riwayat yang dipakai = rangkaian terakhir **tanpa celah** dengan laporan lengkap (pada UP3 hanya bulan ketika **semua** ULP melapor), paling jauh 84 bulan, **minimal 24 bulan**. Peredaman tren dipilih per seri lewat uji mundur (0,9 atau 1,0; `trend_damping`).
- Tiap `series[]` (`key, name, unit`): `status` (`OK` atau `INSUFFICIENT` dengan `message` dan `history_months`), `history_months`, `aggregate` (`last` = deret posisi, `sum` = jumlah, `mean` = rasio/rata-rata), `history[]` (24 bulan terakhir: `month, value`), `forecast[]` (12 bulan: `month, p10, p50, p90`), `next12m` (`p10, p50, p90`), `last12m`, `change_pct`, `quality` (`wape`, `naive_wape`, `gain_vs_naive_pct`, `backtest_points`; naif = bulan yang sama tahun lalu), `trend_damping`, `target` (bulan ke-12: `month, p10, p50, p90, same_month_last_year, change_pct`), `period` (`kind`: `year_end` posisi akhir tahun berjalan, `full_year` aktual sampai bulan terakhir ditambah prakiraan sisa tahun lawan tahun lalu, `mean12` rata-rata 12 bulan ke depan lawan 12 bulan terakhir; `label, p50, previous, change_pct`, dan `month, p10, p90` untuk `year_end`; null bila tidak bisa dihitung), dan `insights[]`.
- `insights` (`level`: `baik`, `perhatian`, `info`; baik atau buruk mengikuti `polarity`): arah bulan ke-12 dibanding bulan yang sama tahun lalu beserta rentangnya; angka tahun berjalan; **mutu model dibanding tebakan sederhana** (perhatian bila tidak lebih baik); bulan paling tidak menguntungkan yang diprakirakan (bukan untuk deret posisi).
- Pada data nyata (UP3 Mojokerto, Oktober 2026): Pelanggan, Daya, kWh Jual, dan Pendapatan bisa diprakirakan; Piutang Pascabayar belum (21 bulan lengkap), Umur Piutang belum (22 bulan), Susut belum (tanpa masukan kWh beli). Prakiraan permohonan/gangguan dari modul lama (`forecast.kind`, `/forecast/*`, `/outages/forecast`) tetap ada sebagai tambahan.

**`GET /metrics/{code}/history`** (`data`): `unit`, `metric`, `family` (jenis laporan EIS sumber atau null), `latest_month`, `months[]` (24 bulan terakhir), `files[]` (100 berkas terbaru: `id, family, period, unit_id, unit_name, original_name, status` AKTIF/DIGANTIKAN`, line_count, warnings_count, imported_at, uploaded_by`), `coverage` (`units[]`: `unit_id, unit_name, months[]` boolean sejajar `months`, `missing[]`, `missing_count`; `expected_total`, `missing_total`; null untuk metrik tanpa laporan), `inputs[]` (hanya `susut`: 100 perubahan masukan bulanan terbaru: `period, code, value, note, unit_name, entered_by, updated_at`), dan `syncs`:
- `pelanggan`, `daya`, `hpl-bp`: sesi penarikan **permohonan** EIS; `piutang-*`: sesi penarikan **piutang** EIS (dengan `options`); `gangguan`, `saidi-saifi`, `ens`: sesi sinkron **gangguan** (`counts`, `message`); metrik lain `[]` (laporan diunggah, tidak ada sesi sinkron). Paling banyak 20 sesi terbaru: `source, id, kind, trigger, status, started_by, created_at, started_at, finished_at` (+ `options`, `range_from`, `range_to`, `counts`, `message` sesuai sumber).
- `null` bila pemakai tidak punya izin (`eis_sync.manage` untuk sesi EIS, `outages.view` untuk sesi gangguan); tampilkan "tidak berwenang melihat sesi sinkronisasi", bukan daftar kosong.

**`GET /metrics/{code}/export`**: berkas `.xlsx` (nama `PENGUSAHAAN-<KODE>-<dari>-<sampai>.xlsx`) dari analisa yang sama dengan layar. Lembar: `Ringkasan` (metrik, sumber, unit, rentang, dan ringkasan tiap seri), `Seri` (bulan, ULP melapor, nilai dan nilai tahun lalu tiap seri), `Rincian` (rincian, rincian kedua, matriks), `Perbandingan ULP` (hanya UP3), `Rekonsiliasi <kunci>` (satu lembar per rekonsiliasi), `Pendamping`, `Prakiraan` (bila status OK), `Catatan` (catatan analisa dan bulan laporan yang belum masuk). Parameter `from`, `to` sama dengan `GET /metrics/{code}`.

### 3a. Masukan bulanan kWh beli, E-Min, PSSD

Nilai **bulan itu** (bukan kumulatif), kWh, per ULP. Satu-satunya tempat mengisi kWh beli: dipakai analisa susut dan juga realisasi susut NKO (NKO menjumlahkan Januari sampai bulan berjalan bila masukan kumulatif NKO `kwh-beli` tidak diisi; masukan kumulatif NKO lama tetap diutamakan bila ada). Riwayat tahun sebelumnya boleh diisi supaya tren dan YoY susut terbentuk.

- `GET /inputs?unit_id=&year=` (ULP saja, `pengusahaan.view`): `unit`, `year`, `codes[]` (`code, name, unit, required`; `kwh-beli` wajib untuk susut, `e-min` dan `pssd` opsional), `can_edit` (punya `pengusahaan.input`), dan `months[]` 12 bulan: `period` (YYYY-MM), `inputs` per kode (`null` atau `{value, note, entered_by, updated_at}`), `kwh_jual` (dari 309, null bila laporan belum ada), `susut_pct` (bulan itu), `susut_kumulatif_pct` (Januari sampai bulan itu, null bila ada bulan sebelumnya yang belum lengkap).
- `PUT /inputs` body `{unit_id, items:[{period: "YYYY-MM", code, value, note?}]}` (maks 200 butir). `code` salah satu `kwh-beli`, `e-min`, `pssd`; `value` ≥ 0, null menghapus; `period` tidak boleh setelah bulan berjalan. Butir yang nilai dan catatannya sama dilewati. Respons `{message, changed}`. Galat: 403 tanpa izin, 404 unit di luar cakupan atau bukan ULP, 422 validasi.

Saran layar: tabel 12 bulan × (kWh beli, E-Min, PSSD, kWh jual hanya-baca, susut bulan, susut kumulatif), pilih tahun dan ULP, simpan sekaligus. Tempatkan sebagai tab "Masukan kWh Beli" pada halaman metrik Susut (tampil hanya bila `can_edit`), dan tautkan dari butir pembantu susut di halaman masukan NKO.

### 3b. Templat dan impor Excel kWh beli

Data yang biasa diisi hanya **kWh beli** dan **PSSD** (kWh, nilai bulan itu); kolom **E-MIN** tersedia tetapi boleh kosong.

- `GET /inputs/template?year=&unit_id=` (`pengusahaan.input`): berkas `KWH-BELI-<tahun>.xlsx`, lembar "KWH BELI", kolom `KODE ULP | NAMA ULP | BULAN (YYYY-MM) | KWH BELI | PSSD | E-MIN | CATATAN`, satu baris per ULP per bulan (12 bulan) untuk ULP yang boleh diisi pengguna; `unit_id` (ULP atau UP3) membatasi. Nilai yang sudah tersimpan ikut terisi.
- `POST /inputs/import` (multipart `file`, xlsx/xls, maks 5 MB, `pengusahaan.input`). Aturan baca:
  - judul kolom dicari pada 10 baris pertama; ULP dicocokkan dengan kode, atau nama bila kode kosong;
  - `BULAN` boleh `2026-01`, `2026/1`, `01-2026`, atau tanggal Excel; tidak boleh setelah bulan berjalan;
  - angka boleh sel numerik atau teks berformat Indonesia (`1.234.567,89`) atau Inggris (`1,234,567.89`), harus ≥ 0;
  - sel nilai kosong dilewati (tidak menghapus nilai tersimpan; menghapus lewat `PUT /inputs` dengan `value` null);
  - bila ada satu baris salah (ULP tidak dikenal, di luar kewenangan, bulan salah, angka salah, ganda), **seluruh berkas ditolak** (422) dengan daftar baris yang salah dan tidak ada yang tersimpan.

  Respons sukses `{data: {rows, changed, unchanged}, message}`.

## 4. Saran layar (agen frontend)

Satu menu **Analisa Pengusahaan** dengan submenu per metrik (dari `GET /metrics`). Metrik dengan `available=false` ditampilkan nonaktif beserta `source`. Pola halaman yang sama untuk semua metrik:
1. Filter unit (dari `units`, sesuai kewenangan) dan rentang bulan.
2. Kartu ringkas tiap seri: nilai bulan terakhir, MoM, YoY, dan kumulatif lawan tahun lalu. Warna naik/turun mengikuti `polarity`.
3. Grafik garis `values` lawan `previous_year`. Seri berbeda satuan ditampilkan sebagai grafik terpisah atau dipilih lewat tab.
4. Rincian (batang atau tabel dengan porsi dan YoY) dan, untuk UP3, tabel perbandingan ULP.
5. Daftar `insights` dan penanda kelengkapan (bulan kosong per ULP).

Analisa Gangguan (`/outages/analysis`) dan Analisa Pelanggan (`/reports/customer-growth`) tetap ada untuk analisa per penyulang dan per permohonan; menu Gangguan dan Pelanggan dapat menautkannya.

**Tata letak halaman metrik (butir 13 README-REVISI).**
- Breadcrumb mengikuti sidebar: `Analisa & Tren Pengusahaan / <Menu>` (tab Prakiraan: `/ <Menu> / Prakiraan`); judul = nama menu, subjudul = `metric.source`.
- Menu dikelompokkan: Ikhtisar; **Pelanggan & Penjualan** (Pelanggan, Daya Tersambung, kWh Jual, Pendapatan, Biaya Penyambungan (BP)); **Piutang** (Piutang Prabayar, Piutang Pascabayar, Umur Piutang); **Keandalan & Pelayanan** (Gangguan Penyulang, SAIDI & SAIFI, ENS, RPT-RCT Gangguan, RPT-RCT Keluhan, Anomali Gangguan, Anomali Keluhan); **Susut & Penertiban** (Susut Distribusi, P2TL). Kepanjangan istilah di tooltip.
- Empat kartu: (1) nilai resmi terakhir `summary[0]` (MoM, YoY); (2) pertumbuhan tahun berjalan: untuk metrik `ytd_mode = last` (posisi) pakai `reconciliation.ytd.official_net` lawan `previous_year.official_net` (`official_change_pct`), selain itu `summary[0].ytd` lawan `ytd_previous_year`; (3) pendamping utama `companions.series[0]` (`ytd` lawan `ytd_previous_year`), bila tak ada pakai seri kedua; (4) rekonsiliasi `reconciliation.ytd.difference`, bila tak ada pakai seri berikutnya. Angka satuan hitungan (plg, kali, lbr, permohonan) tanpa desimal; MVA dua desimal; Rupiah disingkat (juta, M).
- Rentang bawaan: kirim tanpa `from`/`to` (backend: 24 bulan berakhir di bulan laporan terakhir), lalu tampilkan rentang yang dipakai dari `from`/`to` respons; tombol cepat Tahun berjalan, 12 bulan, 24 bulan, Kustom.
- Grafik: metrik posisi (pelanggan, daya, saldo piutang) = batang tambahan bersih per bulan (`reconciliation.monthly[].official_net`) dengan garis pendamping; garis posisi sebagai grafik kecil atau tab. Metrik arus = perbandingan Jan–Des antar tahun dan garis kumulatif lawan tahun lalu. Rincian = batang bertumpuk atau batang porsi dengan YoY; perbandingan ULP = batang horizontal berurutan; bulan yang belum semua ULP melapor digambar putus-putus dengan penanda jumlah ULP.

**Pola resmi + pendamping + rekonsiliasi + prakiraan (Pelanggan dan Daya, berlaku untuk menu lain bertahap):** angka utama halaman selalu dari sumber resmi (`series`, `summary`, `breakdown`, `comparison`, `insights`). Data pendamping (`companions`) tampil sebagai bagian terpisah berlabel sumbernya, tabel rekonsiliasi (`reconciliation`) menghubungkan keduanya, dan tab Prakiraan memakai `forecast.kind`. Halaman rinci lama (analisa per permohonan, per penyulang) menjadi tab Rincian, bukan pengganti angka resmi.

## 5. Kode dan tes

`app/Services/Analytics/BusinessMetricService.php` (katalog dan pengambilan angka mentah), `BusinessTrendBuilder.php` (deret, ringkasan, rincian, perbandingan, catatan), `app/Http/Controllers/BusinessAnalyticsController.php`; tabel `business_monthly_inputs`; tes `tests/Feature/BusinessAnalyticsTest.php`. Angka dihitung saat diminta dari data sumber (tanpa tabel antara). Pada data Jombang tiap metrik selesai di bawah 0,3 detik.

## 6. Belum dikerjakan

- Target NKO pada grafik untuk metrik yang punya indikator NKO padanan.
