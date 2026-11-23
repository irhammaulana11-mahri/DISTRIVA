# 88. Impor laporan bulanan EIS/AP2T (tahap 1 domain NKO dan Pengusahaan)

Tahap pertama dari urutan *impor → definisi KPI berversi → hitung realisasi dan ranking* (lihat docs/86). Tahap ini hanya mengimpor dan menormalkan; belum menghitung KPI.
Berlaku untuk semua unit: tiap ULP dan tiap UP3, tidak hanya UP3 Mojokerto. Rujukan nilai KPI untuk NKO adalah workbook `REALISASI UP3 MJK&ULP 2026 REV 3 (2 JUN 2026)`; SAIDI/SAIFI/ENS NKO diambil dari laporan DIFI yang diunggah, hasil hitung DISTRIVA (docs/87) hanya pembanding.

## 1. Berkas yang dikenali
Nama berkas wajib `JENIS-KODEUNIT-BBTTTT.xls|xlsx` (kode unit 5 karakter, contoh `309EIS-51453-042026.xls`). Jenis:

| Jenis | Isi | Catatan |
|---|---|---|
| `309` | Laporan penjualan tenaga listrik per tarif (pelanggan, daya VA, kWh, rupiah) | tata letak baris tarif berubah antar tahun; baris disimpan dengan label dan nomor baris aslinya, pemetaan ke golongan (MAPPING_RUMUS) dilakukan di tahap berikutnya |
| `309EIS` | Versi tabel datar laporan 309 (kode, keterangan, sumber laporan) | |
| `DIFI` | Laporan SAIDI/SAIFI: nilai pada kepala laporan (`summary`) dan tabel per penyebab gangguan | sumber SAIDI/SAIFI/ENS untuk NKO |
| `GGNALL`, `GGNPERJENIS` | Rekap gangguan: dispatch, response, recovery time, jumlah laporan, dalam/lewat SLA | dua tata letak (lama dan baru) dibaca |
| `GGNBERULANG`, `GGNNEGATIF`, `KLHBERULANG`, `KLHNEGATIF` | Anomali penanganan pengaduan (berulang, rating negatif) | nilai disimpan menurut huruf kolom `c_B` ... `c_R`; makna kolom menunggu keputusan tahap KPI |
| `KLHALL` | Rekap keluhan: total, selesai, rata-rata response/penyelesaian (jam), SLA | |
| `PIUTANGLPB_EIS` | Piutang per golongan dan skema bayar | |
| `AKHIRBULAN_EIS`, `AKHIEPERIODE_EIS` | Rekening akhir bulan dan akhir periode | |
| `TAGSUS` | Tagihan susulan | hanya ringkasan per golongan tarif; nama, alamat, dan nomor pelanggan tidak dibaca dan tidak disimpan |

## 2. Aturan impor
- Unit dibaca dari kode pada nama berkas dan dicocokkan dengan nama ULP/UP3 di dalam berkas; tidak cocok berarti ditolak. Kode yang tidak dikenal (salah ketik, mis. `15453`) dipulihkan dari nama di isi berkas dengan peringatan.
- Bulan pada nama berkas harus sama dengan bulan di dalam berkas (judul, "BULAN", "PERIODE TANGGAL", atau `THBLLAP`); berbeda berarti ditolak.
- Idempoten menurut sidik jari isi (SHA-256). Isi sama = `DUPLIKAT`. Isi berbeda untuk jenis, unit, dan bulan yang sama menggantikan versi aktif (`DIGANTIKAN`, riwayat tetap). Mengunggah isi lama yang sudah pernah digantikan tidak mengaktifkannya lagi (`SUDAH_DIGANTIKAN`).
- Berkas asli diarsipkan di disk `documents` (`eis-reports/<unit>/<jenis>/<tahun-bulan>-<sidik>.<ext>`), ikut cadangan dokumen.
- Format angka berbeda antar laporan: DIFI kepala laporan memakai koma desimal; laporan lain titik desimal dengan koma ribuan; laporan gangguan/keluhan tata letak lama menulis cacah dengan titik ribuan tanpa nol di belakang (3.37 = 3.370 = 3.370 laporan) sehingga kolom cacah dibaca khusus. Durasi `h - j : m : d` disimpan dalam menit.

## 3. Izin dan cakupan
- `eis_reports.view`: membaca daftar dan isi. UP3 melihat ULP di bawahnya; laporan tingkat UP3 terlihat oleh peran yang bertugas di ULP di bawahnya atau di UP3 itu.
- `eis_reports.import`: mengunggah untuk ULP dalam cakupan; untuk laporan tingkat UP3 hanya peran yang bertugas pada UP3 itu atau SYS_ADMIN (MFA).
- Pembagian peran awal ada di `config/distriva_permissions.php` grup `eis_reports` dan perlu disetujui pemilik. Seeder: `EisReportPermissionSeeder` (ada pada daftar `release.sh`).

## 4. API (untuk agen frontend)
Semua di bawah `/api`, throttle `admin`, respons `{data, ...}`.
- `GET /eis-reports?family=&unit_id=&up3_id=&from=YYYY-MM&to=YYYY-MM&status=AKTIF|DIGANTIKAN&per_page=` daftar berkas (`id, family, period, unit_id, unit_name, unit_type, original_name, status, line_count, warnings, imported_at`) dengan `meta` halaman dan `families`.
- `GET /eis-reports/coverage?unit_id=&year=` matriks kelengkapan: `data.families.<JENIS>.<bulan 1..12>` true/false (berkas aktif).
- `GET /eis-reports/{file}/lines` isi: `file` (dengan `summary` untuk DIFI) dan `lines[] {line_no, group_label, label, code, values{...}}`.
- `POST /eis-reports/import` multipart `files[]` (maks 60 berkas, 20 MB per berkas, xls/xlsx). Respons per berkas: `{name, ok, status: BARU|DUPLIKAT|DIGANTIKAN|SUDAH_DIGANTIKAN, family, unit, period, lines, warnings}` atau `{name, ok:false, message}`. HTTP 200 bila ada yang berhasil, 422 bila semua gagal. Unit tujuan dibaca dari berkas, bukan dipilih pengunggah.

## 5. Operasional
- Impor massal dari folder: `php artisan distriva:eis-import "<folder atau berkas>"` (rekursif, idempoten).
- Tabel: `eis_report_files` (berkas, jenis, unit, periode, sidik, status, `summary`, peringatan) dan `eis_report_lines` (baris bernama). Lapisan ini adalah normalisasi, bukan angka KPI.
- Tes: `EisReportImportTest` dan `EisReportApiTest`.

## 6. Hasil muat contoh (DATA PENDUKUNG, ULP Jombang, 2023-01 s.d. 2026-07)
652 berkas: 610 baru, 33 duplikat isi, 4 menggantikan versi (pasangan `TAGSUS-15453-*` dan `TAGSUS-51453-*` yang isinya berbeda; versi kode benar 51453 yang aktif), 5 ditolak karena data berkas bermasalah: `309-51453-072025` (isi bulan 2025-06), `DIFI-51453-102023` (isi bulan 2023-01), `TAGSUS-15453-012024` dan `TAGSUS-51453-012024` (isi bulan 2020-10), `TAGSUS-51540-122024` (unit Ponorogo belum ada di master). Berkas-berkas ini perlu diperiksa atau diunduh ulang dari EIS.

## 7. Berikutnya
Tahap 2: master definisi KPI berversi dari workbook REALISASI (formula, bobot, polaritas, target, periode berlaku; pisahkan definisi dari realisasi). Tahap 3: hitung realisasi, pencapaian, nilai, dan ranking per periode sebagai snapshot. Hubungan baris laporan ke indikator (mis. golongan tarif pada 309 lewat MAPPING_RUMUS, SAIDI/SAIFI dari DIFI) disusun pada tahap 2 setelah formula divalidasi terhadap workbook.
