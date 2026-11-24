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
| `hpl-bp` | HPL Biaya BP | permohonan PB/PD menurut tanggal lunas (`paid_at`, WIB), tanpa yang dibatalkan atau direstitusi; rincian PB/PD | Rp; jumlah permohonan | jumlah |
| `susut` | Susut | masukan bulanan kWh beli, E-Min, PSSD (§3a) dan kWh jual 309 (baris JUMLAH); bulan dihitung hanya bila kWh beli dan laporan 309 ada | susut %; susut kWh; kWh beli; kWh jual | rasio jumlah (= rumus susut NKO) |

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
  | `saidi-saifi` | DIFI SAIDI dan SAIFI | SAIDI dan SAIFI hitung DISTRIVA dari data gangguan tersinkron (`saidi_hitung`, `saifi_hitung`): gangguan lebih dari ambang menit, pelanggan penyulang dari potret DIL sebagai batas atas | `flow` (dua rekonsiliasi: `saidi`, `saifi`) |
  | `ens` | DIFI ENS | ENS kolom sheet gangguan tersinkron menurut ULP peristiwa (`ens_sheet`, MWh) | `flow` |
  | `gangguan` | data gangguan tersinkron (jumlah) | jumlah gangguan menurut DIFI baris TOTAL KELOMPOK Distribusi (`difi_jumlah`) | `flow` |

  `rpt-rct-gangguan` dan `rpt-rct-keluhan` belum punya pendamping (laporan pengaduan pelanggan, bukan gangguan penyulang). Dasar permohonan sama dengan Analisa Pelanggan (`/reports/customer-growth`): tersambung menurut status PEREMAJAAN, bukan dibatalkan atau direstitusi.
- `reconciliations` (null bila tanpa pendamping) adalah daftar rekonsiliasi; `reconciliation` = elemen pertama (untuk metrik satu rekonsiliasi keduanya sama). Tiap elemen: `key`, `mode`, `unit`, `official_name`, `companion_name`, `monthly[]` (`month, official_net, companion, difference, units_compared`; `difference` = pendamping dikurangi resmi), `ytd` (`year, base_month, to_month, official_net, companion, difference, units_compared, units_expected`), `note`. Dua mode:
  - `net`: angka resmi berupa posisi (jumlah pelanggan, daya). `official_net` = tambahan bersih (selisih antar bulan; `ytd`: `to_month` dikurangi Desember tahun sebelumnya `base_month`). ULP dibandingkan bila punya angka resmi di kedua ujung.
  - `flow`: angka resmi berupa arus bulanan (SAIDI, SAIFI, ENS, jumlah gangguan). `official_net` = nilai resmi bulan itu; `ytd` = jumlah nilai bulanan Januari (`base_month`) sampai `to_month`. ULP dibandingkan bila punya angka resmi pada semua bulan yang dihitung (metrik tanpa laporan seperti `gangguan`: bulan tanpa kejadian dianggap nol).
  - `ytd` null bila tidak ada ULP yang memenuhi syarat itu. **Hanya ULP yang memenuhi syarat yang dibandingkan, dan angka pendampingnya diambil dari ULP yang sama.** Dua sumber dicatat menurut waktu yang bisa bergeser antar bulan, sehingga nilai per bulan hanya informasi dan penilaian dilakukan pada `ytd`. Selisih besar menjadi catatan `insights` (`net`: permohonan menambah tetapi 309 tidak naik, lebih dari separuh tidak tampak di 309, tambahan 309 melebihi permohonan 20%; `flow`: pendamping di bawah 50% atau di atas 150% dari angka resmi, atau resmi nol tetapi pendamping mencatat kejadian).
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

**Pola resmi + pendamping + rekonsiliasi + prakiraan (Pelanggan dan Daya, berlaku untuk menu lain bertahap):** angka utama halaman selalu dari sumber resmi (`series`, `summary`, `breakdown`, `comparison`, `insights`). Data pendamping (`companions`) tampil sebagai bagian terpisah berlabel sumbernya, tabel rekonsiliasi (`reconciliation`) menghubungkan keduanya, dan tab Prakiraan memakai `forecast.kind`. Halaman rinci lama (analisa per permohonan, per penyulang) menjadi tab Rincian, bukan pengganti angka resmi.

## 5. Kode dan tes

`app/Services/Analytics/BusinessMetricService.php` (katalog dan pengambilan angka mentah), `BusinessTrendBuilder.php` (deret, ringkasan, rincian, perbandingan, catatan), `app/Http/Controllers/BusinessAnalyticsController.php`; tabel `business_monthly_inputs`; tes `tests/Feature/BusinessAnalyticsTest.php`. Angka dihitung saat diminta dari data sumber (tanpa tabel antara). Pada data Jombang tiap metrik selesai di bawah 0,3 detik.

## 6. Belum dikerjakan

- Target NKO pada grafik untuk metrik yang punya indikator NKO padanan.
