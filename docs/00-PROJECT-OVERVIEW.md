# 00 — Project Overview

## 1. Identitas

| Atribut | Nilai |
|---|---|
| Nama | DISTRIVA |
| Kepanjangan/descriptor | Distribution Management Platform |
| Domain | Pengelolaan permohonan, pekerjaan, material, dan perencanaan distribusi |
| Status | Blueprint awal |
| Organisasi operasional | UP3 dan ULP |
| Bahasa aplikasi | Indonesia (default) |

## 2. Visi

Menyediakan satu platform terpadu yang merangkum pekerjaan operasional, pengusahaan, kinerja, keandalan, pengukuran aset, serta analisis teknis dan energi pada tingkat ULP dan UP3. DISTRIVA mengonsolidasikan data dari sistem sumber resmi (terutama EIS/AP2T, APKT, dan sumber operasional lain yang disetujui), menghubungkan data lintas domain, menyediakan monitoring dan analisis, serta menjaga jejak data dan keputusan.

PB/PD, survei, KKO, RAB/KKF, MTO, RKM, vendor, dan pekerjaan konstruksi tetap menjadi domain yang sudah berjalan. Cakupan platform diperluas secara bertahap ke Pengusahaan, NKO/KPI, histori gangguan, pengukuran gardu, serta analisis susut per penyulang dan gardu.

## 3. Ruang lingkup platform

### A. Domain yang sudah menjadi bagian dari baseline
1. Permohonan PB/PD dan sinkronisasi EIS/AP2T/Bot Daftung.
2. Survei, KKO, gambar teknik, Auto MTO, RAB/KKF, dan feasibility.
3. Work Order, vendor, pelaksanaan pekerjaan, dokumen, dan approval.
4. Master material, KHS, BOM, harga, parameter, serta integrasi sumber stok eksternal.
5. RKM, forecasting pekerjaan, dashboard dan pelaporan.
6. Master gardu, penyulang, pelanggan, serta histori pengukuran gardu OMT sesuai dokumentasi domain.

### B. Perluasan platform yang akan dikembangkan bertahap
1. **Pengusahaan** — monitoring indikator dan pekerjaan pengusahaan berdasarkan workbook/proses kerja yang menjadi acuan. Rincian indikator, rumus, sumber data, periode, target, dan kewenangan perlu dipetakan dari spreadsheet sumber.
2. **NKO/KPI** — pengelolaan target, realisasi, pencapaian, bobot, polaritas, nilai KPI, checkpoint, rekap dan peringkat ULP/UP3. Workbook NKO yang diberikan menjadi referensi struktur dan formula awal.
3. **Histori gangguan** — konsolidasi data gangguan dari APKT, termasuk identitas kejadian, waktu, lokasi/aset, penyulang/gardu, jenis gangguan, durasi, pelanggan terdampak, status penanganan, dan indikator keandalan jika tersedia dari sumber.
4. **Pengukuran gardu** — histori pembacaan beban/arus/tegangan/kapasitas dan parameter pengukuran lain dari OMT atau sumber resmi, terhubung dengan master gardu dan penyulang.
5. **Analisis susut** — analisis energi dan susut pada tingkat UP3, ULP, penyulang, dan gardu sesuai ketersediaan data ukur dan energi. Formula, titik ukur, periode, faktor koreksi, serta aturan rekonsiliasi wajib divalidasi sebelum implementasi.

### C. Prinsip lintas domain
- Satu aplikasi, banyak domain pekerjaan; setiap domain memiliki menu, hak akses, sumber data, workflow, dan laporan yang jelas.
- Data dari sistem eksternal tetap memiliki identitas sumber, waktu pengambilan, periode data, dan status sinkronisasi.
- Data historis dan hasil perhitungan harus dapat ditelusuri ke snapshot sumber, formula, parameter, dan versi yang digunakan.
- Data yang belum tersedia atau belum tervalidasi tidak boleh ditampilkan sebagai nilai final.
- Dashboard lintas domain hanya menggabungkan data yang memang sebanding dari sisi periode, unit, definisi, dan sumber.

## 4. Di luar ruang lingkup tahap awal

- Otomatisasi keputusan pengadaan/PO tanpa persetujuan pejabat.
- Prediksi langsung konsumsi material berbasis ML sebelum tersedia data realisasi pemakaian yang memadai.
- Akuntansi/keuangan korporat penuh.
- Integrasi langsung dengan sistem PLN yang belum memiliki API/otorisasi resmi.
- Penggantian sistem sumber resmi pelanggan atau sistem transaksi korporat.

## 5. Unit organisasi

- **UP3**: unit konsolidasi, pengendalian, gudang pusat, validasi dan persetujuan RKM.
- **ULP**: unit pelaksana yang mengajukan dan memproses permohonan serta mengelola empat kelompok stok tertentu.
- Satu UP3 dapat memiliki banyak ULP.
- Pengguna dibatasi pada unit yang menjadi cakupan tugasnya.

## 6. Prinsip desain

- Modular, audit-able, dan dapat dikembangkan.
- Multi-ULP dengan konsolidasi UP3.
- Versioned master data dan immutable calculation snapshots.
- Pemisahan workflow permohonan, approval RKM, inventory, dan procurement.
- Semua mutasi stok memiliki dokumen sumber dan jejak audit.
- Forecasting dapat ditelusuri ke data historis, model, versi BOM, dan asumsi.


### D. Kondisi domain aset dan pengukuran yang sudah terdokumentasi

Perluasan platform tidak dimulai dari nol untuk domain aset/jaringan. Dokumentasi dalam paket sebelumnya sudah memuat:
- `docs/80-DESAIN-MASTER-GARDU-KKO.md`: master gardu dan kaitannya dengan KKO.
- `docs/81-DESAIN-MASTER-PENYULANG-PELANGGAN.md`: master penyulang, pelanggan, dan relasi gardu.
- `docs/83-DATA-PENGUKURAN-GARDU-OMT.md`: pemeriksaan, pemetaan, pemuatan, dan histori pengukuran gardu OMT.

Dokumen 83 mencatat hasil pemuatan historis pada database development dan fitur yang telah dibangun pada saat dokumen dibuat. Angka/count/status di dokumen tersebut adalah snapshot historis, bukan hasil pemeriksaan runtime terbaru. Pengembangan berikutnya adalah memperluas pemanfaatan data tersebut untuk analisis jaringan, keandalan, dan susut setelah definisi serta sumber datanya tervalidasi.
