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

Menyediakan satu platform terintegrasi untuk mengelola permohonan PB/PD sampai pekerjaan distribusi selesai, sekaligus menyediakan informasi material, biaya, persediaan, dan proyeksi kebutuhan untuk mendukung perencanaan RKM.

## 3. Ruang lingkup utama

1. Registrasi dan monitoring permohonan PB/PD.
2. Sinkronisasi data pelanggan dari Bot Daftung atau sumber lain yang disetujui.
3. Survei, gambar teknik, lampiran, dan versi revisi gambar.
4. Pemeriksaan kelayakan dan perhitungan RAB/KKF.
5. Persetujuan teknis, permintaan revisi, dan penetapan pekerjaan.
6. Penunjukan vendor dan monitoring pelaksanaan.
7. Pengelolaan master material, KHS, kontrak, harga, dan BOM.
8. Pengelolaan gudang UP3 serta stok terbatas pada gudang ULP.
9. Forecast jumlah/jenis pekerjaan berdasarkan histori permohonan.
10. Konversi prediksi pekerjaan menjadi estimasi material menggunakan BOM.
11. Penyusunan, validasi, dan persetujuan RKM di tingkat UP3.
12. Dashboard dan laporan untuk ULP dan UP3.

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
