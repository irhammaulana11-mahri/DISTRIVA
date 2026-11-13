# 01 — Business Requirements

## 1. Tujuan bisnis

Mengurangi proses manual yang tersebar di Google Spreadsheet/Drive dengan alur terkontrol dan data terpusat. Sistem harus menjaga keterlacakan permohonan, versi gambar, hasil perhitungan, keputusan, pemakaian material, dan rencana kebutuhan.

## 2. Aktor bisnis

- Petugas/operator ULP
- Petugas survei/perencana ULP
- Supervisor/pejabat teknis ULP
- Tim perencanaan/konstruksi UP3
- Pengelola gudang ULP
- Pengelola gudang UP3
- Admin master data
- Pejabat pemberi persetujuan RKM UP3
- Auditor/read-only
- Administrator aplikasi

Rincian role dan permission ada pada `03-ROLES-AND-ACCESS.md`.

## 3. Kebutuhan fungsional

### FR-01 Permohonan
- Membuat permohonan PB/PD.
- Menyimpan IDPEL, identitas pelanggan, tarif/daya sebelum dan sesudah, lokasi, ULP, jenis perluasan, dan informasi agenda.
- Data pelanggan dapat diisi manual atau disinkronkan dari Bot Daftung melalui integrasi yang disetujui.
- Mencatat sumber data, waktu sinkronisasi, dan hasil sinkronisasi.

### FR-02 Survei dan gambar
- Menyimpan hasil survei dan gambar.
- Mendukung beberapa versi gambar.
- Setiap revisi memiliki alasan, pengunggah, waktu, dan status.
- Setiap perhitungan RAB harus menunjuk ke versi gambar yang digunakan.

### FR-03 RAB/KKF
- Menghitung BOM, material, jasa pasang/bongkar, biaya tambahan, PPN, RAB, KAJIAN, WACC/RWACC, NPV, IRR, PBP, B/C, dan kriteria kelayakan.
- Menggunakan versi master BOM, harga kontrak, tarif, jam nyala, dan parameter KKF yang berlaku.
- Menyimpan snapshot input dan hasil.
- Menyediakan dokumen keluaran KKF, HPE/Perbandingan BP-RAB, REKAP, REKAP RINCI, Formulir 5 (UTANG), dan Formulir 7 (ARUS KAS), sesuai template yang disahkan.

### FR-04 Kelayakan dan review
- Permohonan yang memenuhi kriteria dapat melewati gerbang kelayakan sesuai kebijakan yang disetujui.
- Permohonan tidak layak atau memerlukan penilaian khusus masuk ke review pejabat/teknis.
- Hasil otomatis tidak menggantikan kewenangan pejabat.

### FR-05 Persetujuan gambar/pekerjaan
- Konstruksi dapat menyetujui gambar atau meminta revisi.
- Perubahan gambar membuat versi baru, tidak menimpa versi lama.
- Keputusan dan komentar tercatat.

### FR-06 Vendor dan pekerjaan
- Menyimpan master vendor.
- Menetapkan vendor pada pekerjaan sesuai proses pengadaan/kontrak.
- Membuat work order dan mencatat progres, dokumen, serta realisasi.

### FR-07 Material dan gudang
- Mencatat master material, kategori, satuan, spesifikasi, BOM, harga, dan status pengelolaan stok.
- Mendukung gudang UP3 dan gudang ULP.
- ULP hanya boleh melakukan penerimaan dan pengeluaran/pemakaian untuk: kWh meter 1 phase prabayar/pascabayar, kabel 2×10 mm², kabel 2×16 mm², dan MCB pelanggan 1 phase berdasarkan rating ampere.
- Material konstruksi lainnya dikelola sebagai stok UP3; penggunaan untuk pekerjaan ULP dilakukan melalui alokasi/issue dari UP3, bukan pencatatan stok reguler ULP.

### FR-08 Forecasting
- Mengestimasi jumlah dan tipe permohonan/pekerjaan per ULP dan konsolidasi UP3.
- Mendukung horizon bulanan, triwulanan, semesteran, dan tahunan.
- Menerjemahkan forecast pekerjaan ke estimasi material melalui BOM.
- Menyediakan skenario dan interval/tingkat ketidakpastian bila memungkinkan.
- Forecast adalah rekomendasi.

### FR-09 RKM
- ULP menyiapkan usulan kebutuhan.
- UP3 Construction/perencana memvalidasi.
- Pejabat UP3 yang berwenang menyetujui RKM.
- RKM yang disetujui menjadi baseline perencanaan.
- Proses PO/pengadaan tetap terpisah dan mengikuti kewenangan serta aturan tersendiri.

### FR-10 Laporan
- Dashboard permohonan, status, kelayakan, RAB, pekerjaan, vendor, stok, forecast, dan RKM.
- Filter berdasarkan UP3, ULP, periode, jenis pekerjaan, kategori material, status.
- Ekspor sesuai hak akses.

## 4. Kebutuhan nonfungsional

- Keamanan: autentikasi, RBAC, pembatasan unit, validasi server-side.
- Audit: perubahan master, approval, perhitungan, dan stok tercatat.
- Konsistensi: transaksi database untuk mutasi stok dan approval.
- Kinerja: pagination, indeks, background jobs untuk proses berat.
- Ketersediaan: backup PostgreSQL, pemantauan aplikasi, dan pemulihan.
- Integritas: foreign key, unique constraint, check constraint, dan idempotency untuk integrasi.
- Maintainability: automated tests dan dokumentasi API.
- Privacy: minimisasi data pribadi pelanggan dan pembatasan akses sesuai kebutuhan kerja.

## 5. Kriteria penerimaan tingkat tinggi

1. Pengguna ULP hanya melihat data ULP yang diizinkan.
2. ULP tidak dapat membuat mutasi stok untuk material di luar empat kelompok yang diizinkan.
3. Hasil perhitungan lama tetap dapat direproduksi meskipun master harga/BOM/tarif berubah.
4. Satu permohonan dengan beberapa versi gambar dapat memiliki beberapa calculation run.
5. Forecast tidak menghitung ulang permohonan yang sudah tercatat sebagai permohonan aktual.
6. RKM tidak otomatis membuat PO.
7. Persetujuan RKM hanya dapat dilakukan role UP3 yang berwenang.

## Addendum keputusan final T1–T3 (menggantikan bagian yang bertentangan)

- Proses PB/PD mengikuti workflow terperinci T3.2 pada `16-FINALIZED-BUSINESS-DECISIONS.md`: survey wajib; drawing/feasibility kondisional; konstruksi hanya bila perluasan jaringan; register/agenda dari aplikasi lain; pembayaran terverifikasi; pemasangan meter diverifikasi sebelum selesai.
- Modul inventory internal tidak dibangun. Aplikasi material eksisting adalah source of truth; DISTRIVA mengintegrasikan kebutuhan WO dan membaca snapshot/status.
- Auto MTO mendukung XLS/XLSX, PDF, DWG/DXF, JPG/PNG dan wajib diverifikasi petugas teknis ULP.
- Output dokumen KKF yang diperlukan adalah KKF, HPE/Perbandingan BP-RAB, REKAP, REKAP RINCI; Formulir 5 dan 6 tidak dibutuhkan.
- Untuk daftar lengkap aturan yang telah disepakati, gunakan dokumen 16 sebagai acuan terbaru.
