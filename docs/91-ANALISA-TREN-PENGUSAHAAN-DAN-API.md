# 91 — Analisa dan Tren Pengusahaan (Tahap 1) dan API

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
| `rpt-rct-keluhan` | RPT-RCT Keluhan | KLHALL (baris "Total" tidak dipakai) | response dan recovery rata-rata (jam); jumlah keluhan; % respons dalam SLA | tertimbang |
| `rpt-rct-gangguan` | RPT-RCT Gangguan | GGNALL (baris "Total" tidak dipakai) | response dan recovery rata-rata (menit); jumlah; % respons dalam SLA | tertimbang |
| `saidi-saifi` | SAIDI SAIFI | ringkasan DIFI | menit/plg; kali/plg | jumlah bulanan |
| `ens` | ENS | DIFI, baris TOTAL KELOMPOK Distribusi | MWh | jumlah |
| `kwh-p2tl` | kWh P2TL | TAGSUS golongan P1-P4, K2, tanpa golongan (baris TS kWh dan DKRP tidak dipakai) | kWh; Rp; jumlah pelanggan | jumlah |
| `gangguan` | Gangguan | data gangguan penyulang tersinkron; rincian permanen/temporer | jumlah; permanen; temporer | jumlah |
| `hpl-bp` | HPL Biaya BP | permohonan PB/PD menurut tanggal lunas (`paid_at`, WIB), tanpa yang dibatalkan atau direstitusi; rincian PB/PD | Rp; jumlah permohonan | jumlah |
| `susut` | Susut | belum tersedia (`available=false`): butuh kWh beli, E-Min, dan PSSD bulanan | - | - |

Catatan sumber:
- **HPL Biaya BP**: kolom `BP` pada AKHIRBULAN_EIS bernilai 0 di semua 46 bulan contoh, begitu pula baris "Penetapan Cicilan BP" pada 309EIS. Karena itu sumbernya adalah biaya permohonan yang sudah lunas (data untuk semua ULP sejak 2022).
- **Umur piutang pascabayar**: laporan yang ada hanya memisahkan rekening baru dan saldo yang lewat tanggal 20 per kogol. Pemecahan umur bertingkat (mis. 1, 2, 3+ bulan) butuh laporan umur piutang tersendiri.
- Data EIS saat ini hanya ULP Jombang (Januari 2023 sampai Oktober 2026; DIFI 18 bulan). Tampilan UP3 lengkap setelah laporan semua ULP diimpor.

## 2. Izin

`pengusahaan.view` diberikan ke peran yang sama dengan `nko.view`: MANAGER_ULP, MANAGER_UP3, TEKNIK, NIAGA_RETAIL, ASMAN_NIAGA, ASMAN_PERENCANAAN, PERENCANAAN, ASMAN_JARINGAN, dan SYS_ADMIN. Seeder: `NkoPermissionSeeder`. Cakupan:
- peran ULP hanya melihat ULP-nya;
- peran tingkat UP3 melihat UP3 itu dan semua ULP di bawahnya;
- SYS_ADMIN melihat semua unit;
- unit di luar cakupan dijawab 404.

Peta izin frontend: `GET /planning/access` memuat `pengusahaan.view`.

## 3. API (di bawah `/api/pengusahaan`, auth, throttle `admin`)

| Metode dan jalur | Fungsi |
|---|---|
| `GET /metrics` | `metrics[]`: `code, name, source, polarity` (`up` = makin besar makin baik, `down` = sebaliknya), `available`, `breakdown` (nama dimensi atau null), `series[]` (`key, name, unit`). `units[]`: unit yang boleh dilihat (`id, name, unit_type, parent_id`) untuk filter |
| `GET /metrics/{code}?unit_id=&from=YYYY-MM&to=YYYY-MM` | Analisa satu metrik. Bawaan `to` = bulan laporan terakhir (atau bulan lalu untuk sumber non-laporan); `from` = 23 bulan sebelum `to`. Rentang paling panjang 60 bulan |

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
- `breakdown` (null bila metrik tanpa rincian): `dimension`, `period`, dan `rows[]` (`key, value, share_pct, same_month_last_year, yoy_pct`, urut dari terbesar). Rincian adalah komposisi seri pertama pada bulan `to`.
- `comparison[]` (hanya bila unit UP3): per ULP `unit_id, unit_name, latest, yoy_pct, ytd` untuk seri pertama, urut `latest` turun.
- `coverage`: `months_expected`, dan `missing[]` (`unit_id, unit_name, months[]`) berisi bulan yang laporannya belum diunggah per ULP. Hanya untuk metrik berbasis laporan EIS. Bulan kosong tidak dihitung nol: angka UP3 bulan itu hanya memuat ULP yang ada datanya.
- `insights[]`: `level` (`baik`, `perhatian`, `info`) dan `text`. Catatan otomatis berbasis aturan:
  - angka UP3 belum utuh (berapa dari berapa ULP melapor pada bulan terakhir);
  - kelengkapan laporan;
  - perubahan tahunan bulan terakhir ≥ 5%;
  - naik atau turun ≥ 3 bulan berturut-turut;
  - kumulatif dibanding tahun lalu;
  - porsi terbesar dan perubahan terbesar pada rincian;
  - ULP dengan perubahan tahunan terbaik dan terlemah.

  Baik atau buruk mengikuti `polarity`.

## 4. Saran layar (agen frontend)

Satu menu **Analisa Pengusahaan** dengan submenu per metrik (dari `GET /metrics`). Metrik dengan `available=false` ditampilkan nonaktif beserta `source`. Pola halaman yang sama untuk semua metrik:
1. Filter unit (dari `units`, sesuai kewenangan) dan rentang bulan.
2. Kartu ringkas tiap seri: nilai bulan terakhir, MoM, YoY, dan kumulatif lawan tahun lalu. Warna naik/turun mengikuti `polarity`.
3. Grafik garis `values` lawan `previous_year`. Seri berbeda satuan ditampilkan sebagai grafik terpisah atau dipilih lewat tab.
4. Rincian (batang atau tabel dengan porsi dan YoY) dan, untuk UP3, tabel perbandingan ULP.
5. Daftar `insights` dan penanda kelengkapan (bulan kosong per ULP).

Analisa Gangguan (`/outages/analysis`) dan Analisa Pelanggan (`/reports/customer-growth`) tetap ada untuk analisa per penyulang dan per permohonan; menu Gangguan dan Pelanggan dapat menautkannya.

## 5. Kode dan tes

`app/Services/Analytics/BusinessMetricService.php` (katalog dan pengambilan angka mentah), `BusinessTrendBuilder.php` (deret, ringkasan, rincian, perbandingan, catatan), `app/Http/Controllers/BusinessAnalyticsController.php`; tes `tests/Feature/BusinessAnalyticsTest.php`. Angka dihitung saat diminta dari data sumber (tanpa tabel antara). Pada data Jombang tiap metrik selesai di bawah 0,3 detik.

## 6. Belum dikerjakan (tahap 2)

- Susut: masukan bulanan kWh beli, E-Min, dan PSSD (atau laporan sumbernya), lalu susut = (beli − E-Min − PSSD − jual) / (beli − E-Min − PSSD).
- Umur piutang pascabayar bertingkat: menunggu laporan umur piutang.
- Target NKO pada grafik untuk metrik yang punya indikator NKO padanan.
