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


## 10. Kebutuhan platform lintas bagian (perluasan bertahap)

### FR-10 Pengusahaan
- Menyediakan monitoring pekerjaan/indikator pengusahaan berdasarkan proses dan spreadsheet acuan.
- Menampilkan target, realisasi, status, periode, unit pemilik, sumber data, dan tindak lanjut jika elemen tersebut tersedia.
- Definisi indikator, rumus, aktor, SLA, dan hak akses belum boleh diasumsikan; harus dipetakan dan disetujui dari sumber kerja yang berlaku.

### FR-11 NKO/KPI
- Mengelola hierarki KPI, indikator turunan, polaritas, formula, satuan, bobot, target, realisasi, pencapaian, nilai, keterangan, dan periode.
- Mendukung tampilan bulanan/kumulatif serta konsolidasi ULP dan UP3.
- Menyediakan ranking dan checkpoint bila memang menjadi bagian dari template resmi.
- Formula dan aturan pembobotan harus berasal dari workbook/ketentuan yang divalidasi, bukan dibuat ulang berdasarkan perkiraan.
- Perubahan formula/target harus berversi; histori periode yang telah ditutup tidak berubah diam-diam.

### FR-12 Histori gangguan
- Mengimpor/menyinkronkan histori gangguan dari APKT melalui kontrak resmi.
- Menghubungkan gangguan dengan unit, waktu, penyulang, gardu/aset, kategori gangguan, durasi, pelanggan terdampak, dan status penanganan sejauh field sumber tersedia.
- Menyediakan pencarian, filter periode, detail kejadian, histori perubahan, dan rekap indikator keandalan.
- Membedakan nilai sumber APKT dengan hasil perhitungan/normalisasi DISTRIVA.

### FR-13 Pengukuran gardu
- Mengelola histori pembacaan gardu dari OMT/sumber resmi, terkait master gardu dan penyulang.
- Mempertahankan waktu pengukuran, satuan, sumber, kapasitas pada saat pengukuran, serta status kualitas data.
- Menangani impor, deduplikasi, validasi, koreksi terkendali, dan histori batch.
- Pembacaan historis tidak boleh dihitung ulang memakai kapasitas master terkini jika kapasitas pada saat pengukuran tersedia.

### FR-14 Analisis susut per penyulang dan gardu
- Menyediakan analisis susut sesuai ketersediaan data energi masuk/keluar dan titik ukur.
- Mendukung agregasi per UP3, ULP, penyulang, dan gardu jika cakupan pengukuran memadai.
- Menampilkan periode, sumber pembacaan, kelengkapan data, formula/versi formula, asumsi, dan tingkat keandalan hasil.
- Tidak boleh mengalokasikan susut ke penyulang/gardu dengan pembagian proporsional atau asumsi lain tanpa metode yang disetujui.
- Hasil estimasi harus diberi label estimasi; jangan disamakan dengan susut terukur.

### FR-15 Data integration & lineage
- Semua impor/sinkronisasi memiliki batch, sumber sistem, waktu ekstraksi, periode data, status, jumlah diterima/ditolak/berubah, dan alasan penolakan.
- Mendukung idempotency, deduplication, retry terkendali, rekonsiliasi, dan penanganan data terlambat.
- Data eksternal tidak boleh menimpa histori internal yang sudah dibekukan atau disetujui tanpa aturan revisi.


### Catatan kesinambungan requirement aset/jaringan
Kebutuhan master gardu, master penyulang, master pelanggan, relasi pelanggan-gardu, dan pengukuran gardu OMT telah memiliki dokumen domain tersendiri (`docs/80`, `docs/81`, `docs/83`) serta handoff frontend terkait. Requirement baru untuk analisis gangguan/susut harus memanfaatkan master dan histori yang ada, bukan membuat master gardu/penyulang/pelanggan duplikat. Status implementasi aktual tetap diverifikasi terhadap source dan database sebelum pekerjaan dilanjutkan.
