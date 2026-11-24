# README-REVISI — Daftar perubahan backend yang perlu ditindaklanjuti frontend

Satu pintu bagi agen frontend. Setiap progres cukup membaca berkas ini: bagian **Terbuka** menunjuk apa yang perlu dibuat atau diperbaiki beserta dokumen kontraknya. Detail API tidak ditulis di sini, tetapi di dokumen yang ditunjuk.

## Aturan pakai

**Agen backend** — setiap kali membuat atau mengubah backend yang menyentuh frontend (endpoint baru atau berubah, kolom respons, izin, perilaku, galat, data contoh):
1. Perbarui dokumen kontraknya (docs/NN atau PROMPT-FRONTEND-*) agar sesuai kode.
2. Tambahkan satu baris pada tabel **Terbuka** di sini (tanggal, commit, apa yang berubah, dokumen rujukan, kebutuhan frontend). Perubahan murni internal tanpa dampak ke frontend tidak perlu dicatat.
3. Jangan menghapus baris Terbuka milik orang lain; ubah statusnya hanya bila memang sudah dikerjakan.

**Agen frontend** — kerjakan baris Terbuka dari atas ke bawah, baca dokumen rujukannya, lalu pindahkan baris ke **Selesai** dengan commit dan catatan singkat (tes yang ditambah). Bila kontrak tidak jelas atau respons tidak sesuai dokumen, tulis temuan pada kolom Catatan baris itu supaya backend memperbaikinya, jangan menebak.

Status: `BARU` (belum disentuh), `SEBAGIAN` (sebagian dikerjakan), `BLOKIR` (menunggu backend atau keputusan pemilik).

## Terbuka

| # | Tanggal | Commit backend | Perubahan | Dokumen | Kebutuhan frontend | Status | Catatan |
|---|---|---|---|---|---|---|---|
| 8 | 2026-11-24 | f7b0723 | **Unggah laporan EIS dipermudah**: nama berkas bebas (unduhan EIS apa adanya dikenali dari isi), `POST /eis-reports/import` menerima **.zip** (unit/bulan dari nama folder) serta opsional `unit_id` dan `period`; `GET /eis-reports/coverage?up3_id=&year=` kelengkapan semua ULP satu UP3 dengan daftar yang belum masuk | docs/88 §1, §1a, §4 | (a) `EisReportsPage.jsx`: hapus kewajiban/petunjuk ganti nama berkas (pola lama tetap boleh); terima `.zip` dan folder (`webkitdirectory`); pilihan opsional **Bulan** dan **Unit** pada form unggah dengan keterangan "hanya untuk laporan yang tidak menyebut bulan/unit: 309EIS, AKHIEPERIODE_EIS, PIUTANGLPB_EIS (bulan) dan UMURPIUTANG (unit)"; contoh susunan ZIP satu UP3: `JOMBANG/2026-10/Rekap.xls`. (b) Kirim berkas lepas **paling banyak 20 per permintaan** (batas PHP `max_file_uploads`, kelebihan dibuang diam-diam), bertahap dengan kemajuan; satukan hasil per berkas, tampilkan `name` (isi ZIP berbentuk `arsip.zip › jalur`), status, jenis, unit, bulan, pesan galat apa adanya. (c) Matriks kelengkapan UP3: baris ULP × jenis laporan per bulan (atau ringkas `missing_count` per ULP, buka untuk rincian `missing[]`), hanya bulan ≤ `expected_until_month` yang dihitung kurang; tautan dari Analisa Pengusahaan bila banner "angka UP3 belum utuh" muncul | BARU | |

## Selesai

| # | Tanggal | Perubahan | Dikerjakan frontend (commit) |
|---|---|---|---|
| 1 | 2026-11-24 | Modul **Analisa Pengusahaan**: `GET /pengusahaan/metrics` & `GET /pengusahaan/metrics/{code}`; izin `pengusahaan.view` | Halaman terpadu `BusinessAnalyticsPage.jsx` dengan katalog 14 metrik, filter unit & rentang bulan, kartu ringkasan KPI, grafik SVG interaktif `MetricTrendChart` (deret berjalan vs tahun lalu), rincian komposisi (breakdown), perbandingan ULP (comparison), wawasan otomatis (insights), banner angka UP3 belum utuh, dan box kelengkapan laporan EIS. Rute `/pengusahaan` & navigasi sidebar ditambahkan. Tes: `BusinessAnalyticsPage.test.jsx` |
| 2 | 2026-11-24 | Masukan pembantu NKO dibuat umum (`auxiliary=true` pada `GET /nko/inputs`) & pesan respons `PUT /inputs` | `NkoPage.jsx` menampilkan toast respon simpan (`changed` count / "Tidak ada perubahan masukan") dan keterangan/tautan pada masukan pembantu susut ke Analisa Pengusahaan > Susut. Tes: `NkoPage.test.jsx` |
| 3 | 2026-11-24 | `GET /nko/gaps?year=&month=&up3_id=`: ringkasan kekurangan per unit | `NkoPage.jsx` memanggil `loadGaps()` saat halaman pertama kali dibuka sehingga lencana/badge jumlah kekurangan pada judul tab langsung terisi sejak awal. Tes: `NkoPage.test.jsx` |
| 4 | 2026-11-24 | **Susut** pada Analisa Pengusahaan dari masukan bulanan kWh beli, E-Min, PSSD (`GET /pengusahaan/inputs`, `PUT /pengusahaan/inputs`, izin `pengusahaan.input`) | Tab "Masukan kWh Beli" di halaman Susut pada `BusinessAnalyticsPage.jsx`: tabel 12 bulan x (kWh beli, E-Min, PSSD, kWh jual 309, susut bulanan, susut kumulatif), pilihan ULP & tahun, simpan masukan batch, empty state ajakan mengisi bagi yang berwenang. Tes: `BusinessAnalyticsPage.test.jsx` |
| 5 | 2026-11-24 | Redesain Chart Gangguan Penyulang sumbu 12 bulan (Jan–Des) dan pemisah tipe gangguan | Komponen `YearlyComparisonChart` di `TrendCharts.jsx` dengan sumbu tetap 12 bulan (Jan–Des), warna legenda berbeda tiap tahun, toggle tahun interaktif, mode garis/batang. Diterapkan pada `OutageAnalysisPage.jsx` untuk Gangguan per Bulan (Total, Permanen, Temporer, dan Bandingkan Ketiganya), SAIFI, SAIDI, ENS, serta rincian penyulang FeederDrawer. Tes: `Outage.test.jsx` (9 test lulus) |
| 6 | 2026-11-24 | **Templat dan impor Excel kWh beli**: `GET /pengusahaan/inputs/template?year=&unit_id=` & `POST /pengusahaan/inputs/import` | Tombol **Unduh Templat** dan **Impor Excel** pada tab Masukan kWh Beli di `BusinessAnalyticsPage.jsx` (hanya bila `can_edit`), penanganan galat 422 dengan pesan rincian baris ditolak apa adanya, dan auto reload data masukan. API terdaftar di `api.js`. Tes: `BusinessAnalyticsPage.test.jsx` |
| 7 | 2026-11-24 | **Umur piutang pascabayar**: jenis laporan EIS `UMURPIUTANG`, metrik `piutang-pascabayar-umur`, `breakdown_secondary` dan `matrix` | (a) `EisReportsPage.jsx`: label `UMURPIUTANG: 'UMURPIUTANG (Umur Tunggakan Pascabayar)'` dan petunjuk nama berkas `UMURPIUTANG-<kodeULP>-<BBTTTT>.xls` (unduhan Rekap.xls diganti nama). (b) `BusinessAnalyticsPage.jsx`: rincian sekunder `breakdown_secondary` dan tabel matriks silang `matrix` (heatmap warna proporsional Kogol x Umur Tunggakan) dengan total baris/kolom. Tes: `BusinessAnalyticsPage.test.jsx` & `EisReportsPage.test.jsx` |

## Riwayat kontrak yang sudah ada (acuan)

- NKO/KPI: docs/89 (master definisi), docs/90 (perhitungan, masukan, koreksi beralasan, peringkat, API).
- Laporan EIS bulanan: docs/88. Data gangguan penyulang: docs/87.
- Analisa pengusahaan: docs/91.
- Prompt frontend sebelumnya: berkas `PROMPT-FRONTEND-*.md` di folder docs.
