# 86 — Arah Platform Terpadu DISTRIVA dan Perluasan Domain

**Tanggal:** 22 November 2026  
**Status:** Arah pengembangan dan konsolidasi dokumentasi. Dokumen ini tidak dengan sendirinya mengesahkan formula, permission, workflow, atau kontrak integrasi baru.

## 1. Visi platform

DISTRIVA dikembangkan sebagai satu aplikasi terpadu yang merangkum pekerjaan lintas bagian pada tingkat ULP dan UP3. Platform ini menyatukan monitoring, histori, workflow, analisis, dan pelaporan dari berbagai domain distribusi.

DISTRIVA bukan pengganti EIS, AP2T, APKT, OMT/Maximo, ERP, atau sistem sumber resmi lainnya. Sistem tersebut tetap menjadi sumber data sesuai domainnya. DISTRIVA mengintegrasikan dan mengonsolidasikan data yang diperlukan, menghubungkan data lintas domain, menjalankan analisis internal yang disetujui, dan menjaga jejak asal data.

## 2. Domain dan kesinambungan dokumentasi

| Domain | Kondisi dalam dokumentasi saat ini | Sumber / referensi |
|---|---|---|
| PB/PD dan pelayanan | Sudah memiliki spesifikasi, alur, API, dan beberapa implementasi yang dicatat pada dokumen domain; status aktual tetap harus diverifikasi | EIS/AP2T, Bot Daftung, input internal |
| Engineering & konstruksi | Sudah memiliki dokumen drawing, Auto MTO, RAB/KKF, WO, vendor, BASTP dan handoff | DISTRIVA dan sumber resmi terkait |
| Material & perencanaan | Sudah memiliki dokumen master material, KHS/BOM, RKM, forecasting dan integrasi stok eksternal | ERP/sistem material, master internal |
| Master gardu & KKO | Sudah didokumentasikan pada `docs/80-DESAIN-MASTER-GARDU-KKO.md` | Master internal, Maximo/OMT, KKO |
| Master penyulang & pelanggan | Sudah didokumentasikan pada `docs/81-MASTER-PENYULANG-PELANGGAN.md` atau nama aktual dokumen 81 di arsip | DIL, Maximo/OMT, data pelanggan |
| Pengukuran gardu | Sudah memiliki desain, pemetaan OMT, histori pembacaan dan catatan pemuatan pada `docs/83-DATA-PENGUKURAN-GARDU-OMT.md`; audit source/database terkini tetap diperlukan | OMT/Maximo |
| Histori gangguan & keandalan | Perluasan baru; belum ditemukan spesifikasi domain gangguan tersendiri dalam Markdown baseline yang diperiksa | APKT |
| NKO/KPI | Perluasan baru; workbook referensi tersedia, tetapi formula/aturan harus divalidasi sebelum spesifikasi final | Workbook NKO dan TRP |
| Pengusahaan | Perluasan baru; spreadsheet Google Sheets yang ditunjuk belum terbaca dalam sesi ini | Google Sheets dan sistem sumber terkait |
| Analisis energi & susut | Perluasan baru; hanya disebut terbatas pada dokumen lama, belum ditemukan spesifikasi metode susut per penyulang/gardu | EIS/AP2T, data pengukuran OMT, APKT bila relevan, sumber energi resmi |

**Penting:** keberadaan dokumen desain atau laporan implementasi tidak otomatis membuktikan fitur masih aktif pada source/runtime terkini. Gunakan source, migration, API, test, dan database yang disetujui untuk memverifikasi status.

## 3. Domain aset dan pengukuran yang sudah ada

Paket Markdown sebelumnya sudah memuat materi penting berikut:

- `docs/80-DESAIN-MASTER-GARDU-KKO.md`: master gardu dan keterkaitannya dengan KKO.
- `docs/81-DESAIN-MASTER-PENYULANG-PELANGGAN.md`: master penyulang, master pelanggan, relasi pelanggan-gardu, serta API dan izin terkait.
- `docs/83-DATA-PENGUKURAN-GARDU-OMT.md`: pemeriksaan berkas OMT 2022–2026, normalisasi format, deduplikasi, pemetaan kolom, kapasitas pada saat pengukuran, pemuatan idempoten, dan relasi penyulang.

Dokumen 83 mencatat snapshot historis hasil pemuatan pada database development: 5.902 gardu, 177 penyulang, dan 48.852 pembacaan setelah pemuatan OMT/penambahan data yang dicatat di dokumen tersebut. Angka ini adalah catatan pada saat audit/pemuatan, bukan klaim kondisi runtime saat ini.

Karena fondasi master dan pengukuran telah terdokumentasi, pekerjaan berikutnya bukan membuat master gardu/penyulang/pelanggan baru. Lakukan audit kesinambungan data dan gunakan entitas yang sudah ada untuk pengembangan analisis.

## 4. Referensi NKO yang telah diperiksa

Workbook yang diberikan:
- `REALISASI UP3 MJK&ULP 2026 REV 3 (2 JUN 2026).xlsx`
- `TRP ULP&UP3 MJK 2026 REV 3 (2 JUN 2026).xlsx`

Struktur workbook realisasi menunjukkan antara lain:
- KPI tingkat UP3 dan ULP;
- kelompok KPI dan indikator turunan;
- polaritas;
- formula dan satuan;
- bobot;
- target semester/tahun;
- realisasi per bulan;
- pencapaian/nilai/keterangan;
- rekap gabungan ULP;
- ranking NKO ULP dan ranking 10 KPI utama per bulan.

Workbook TRP berisi indikator/target bulanan, antara lain Penjualan TL, Susut Total Tanpa E-Min, SAIDI, SAIFI, ENS, aset RUPTL, aset fisik investasi, penambahan pelanggan/daya, pendapatan BP, feedback, response time gangguan, auto dispatch, transaksi PLN Mobile, kerusakan peralatan distribusi, gangguan TM, MVOD, MTTR, piutang, PRR, dan indikator lain yang terdapat pada workbook.

Catatan:
- Workbook adalah referensi struktur dan formula awal, bukan bukti bahwa semua target/rumus masih berlaku untuk periode berikutnya.
- Formula, bobot, polaritas, satuan, aturan pembulatan, batas pencapaian, periode efektif, dan cara agregasi harus diekstrak dan diuji terhadap workbook asli.
- Jangan hardcode target 2026 untuk tahun berikutnya.
- Pisahkan master definisi KPI dari realisasi periodik.
- Simpan versi definisi/formula dan snapshot hasil per periode.
- Ranking hanya membandingkan unit dengan definisi, periode, dan kelengkapan data yang sebanding.

## 5. Pengusahaan

Tautan spreadsheet yang diberikan pemilik:
`https://docs.google.com/spreadsheets/d/1zB2cP55a2U4o6I7x_o3cuS-ikQZDS6JVMQsCPVZhpPA/edit?gid=1511354061#gid=1511354061`

Isi spreadsheet belum terbaca dalam sesi ini. Jangan mengarang nama tab, kolom, indikator, rumus, aktor, status, atau output.

Langkah berikutnya:
1. Minta ekspor XLSX/CSV atau akses konektor Google Sheets yang aktif.
2. Inventarisasi semua tab dan hubungan antar tab.
3. Petakan kolom, formula, validasi, sumber data, periode, unit, output, dan pekerjaan manual.
4. Pisahkan data sumber, input manual, hasil hitung, dan laporan.
5. Cocokkan indikator dengan EIS/AP2T/APKT atau sumber lain jika terbukti.
6. Baru susun spesifikasi modul, API, database, role, workflow dan UI.

## 6. Histori gangguan dan keandalan

APKT menjadi sumber utama histori gangguan sesuai kontrak yang tersedia. Sebelum implementasi, petakan:
- external ID kejadian;
- waktu mulai dan pulih;
- unit, penyulang, gardu/aset;
- jenis/penyebab gangguan jika tersedia;
- durasi;
- jumlah pelanggan terdampak;
- status penanganan;
- sumber, waktu sinkronisasi dan koreksi.

Jangan menyimpulkan SAIDI, SAIFI, ENS, MTTR atau indikator lain sebelum definisi, field, denominator, batas waktu, dan aturan pengecualian divalidasi. Bedakan nilai sumber APKT dengan hasil normalisasi dan hasil hitung DISTRIVA.

## 7. Analisis susut per penyulang dan gardu

Analisis susut per penyulang/gardu tidak boleh dibuat hanya dengan membagi angka susut UP3/ULP secara proporsional.

Sebelum menetapkan formula, identifikasi:
- titik ukur energi masuk dan keluar;
- batas jaringan dan periode pencatatan;
- relasi titik ukur/meter ke gardu dan penyulang;
- energi kirim/terima, penjualan, pemakaian sendiri, transfer antarunit, dan komponen koreksi yang relevan;
- interval pembacaan dan sinkronisasi waktu;
- data hilang, estimasi, penggantian meter, serta perubahan konfigurasi jaringan;
- metode agregasi dan rekonsiliasi dengan angka resmi.

Hasil harus membedakan:
- **TERUKUR:** data dan titik ukur memenuhi prasyarat metode.
- **ESTIMASI:** memakai metode estimasi yang telah disetujui dan diberi label.
- **DATA TIDAK CUKUP:** tidak dapat dihitung secara bertanggung jawab.

Setiap hasil menampilkan formula/versi, periode, sumber, cakupan, kelengkapan, dan asumsi.

## 8. Prinsip integrasi sumber data

1. EIS/AP2T menjadi sumber data pelayanan/pengusahaan tertentu sesuai field dan kontrak yang terverifikasi.
2. APKT menjadi sumber histori gangguan sesuai kontrak yang tersedia.
3. OMT/Maximo menjadi sumber pengukuran/aset sesuai data yang tersedia; dokumen 83 menjadi rujukan pemetaan historis.
4. ERP/sistem material tetap sumber master material dan transaksi stok sesuai keputusan yang berlaku.
5. Spreadsheet resmi dapat menjadi referensi atau jalur impor sementara jika API belum tersedia.
6. Setiap impor/sinkronisasi memiliki source system, external key, waktu ekstraksi, periode data, batch, validasi, idempotency/deduplication, status dan rekonsiliasi sejauh data tersedia.
7. Bedakan raw source, normalized data, dan calculated result.
8. Jangan menimpa histori internal yang telah dibekukan/disetujui tanpa mekanisme revisi.
9. Integrasi dilakukan melalui adapter/service Laravel. Python service tidak mengakses PostgreSQL produksi secara langsung.
10. Jangan mengarang endpoint, payload, credential atau API contract.

## 9. Arsitektur, otorisasi, dan audit

- Pertahankan Laravel modular monolith, React/Vite, PostgreSQL, Redis/Queue, Reverb, dan Python service sesuai baseline.
- Tambahkan domain sebagai modul dengan batas data dan kontrak API yang jelas.
- Gunakan master organisasi dan entitas aset yang sudah ada; jangan membuat duplikat.
- Scope backend diterapkan sebelum pagination, sorting, count, aggregation, ranking, dashboard dan export.
- Export permission terpisah sesuai keputusan domain.
- Approved snapshot dan histori tidak boleh ditimpa.
- Audit trail mengikat aktor, unit, tindakan, waktu, sumber, periode, versi formula, dan record yang berubah.
- Jangan mengubah role, permission, approval matrix, atau SoD tanpa keputusan eksplisit.

## 10. Urutan pengembangan per domain

`Audit baseline → Source inventory → Data mapping → Business rule validation → Access/workflow design → Data/API design → Integration/import → Backend → Frontend → Reconciliation → Test → Documentation`

Isu terbuka hanya memblokir fitur yang bergantung langsung padanya. Domain independen dapat berjalan paralel.
