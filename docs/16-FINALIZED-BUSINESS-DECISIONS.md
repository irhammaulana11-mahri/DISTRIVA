# 16 — Finalized Business Decisions T1–T3.13

Dokumen ini adalah ringkasan keputusan bisnis yang telah disepakati dalam pembahasan. Jika ada konflik dengan blueprint awal v1, keputusan dalam dokumen ini yang menjadi acuan terbaru. Detail teknis final tetap diturunkan pada T4.

## 1. Organisasi, role, dan akses

- Banyak UP3 dapat berada dalam satu instalasi; setiap UP3 memiliki banyak ULP.
- Satu tabel hierarkis `organizational_units`: UP3 tanpa parent; ULP memiliki parent UP3.
- Kode resmi PLN adalah business identifier; UUID adalah primary key internal.
- Unit dinonaktifkan, bukan dihapus, jika sudah memiliki histori transaksi.
- User dapat memiliki beberapa role dan beberapa unit melalui `user_role_assignments` dengan masa berlaku.
- Role assignment berscope unit; transaksi menyimpan unit asal pada saat transaksi, tidak diturunkan dari assignment user terkini.
- RBAC memakai Spatie Permission ditambah policy/service organizational scope.
- SYS_ADMIN mengelola sistem; **diubah pemilik 6 Nov 2026: SYS_ADMIN role penuh** (semua key yang diberikan, termasuk persetujuan master data) dengan MFA wajib; pemisahan pembuat ≠ penyetuju tidak dilonggarkan. Pembacaan dokumen bisnis terbatas mengikuti key yang diberikan per iterasi.

### Role aktif (14)

`SYS_ADMIN`, `UP3_ADMIN`, `UP3_MANAGER`, `NIAGA_RETAIL`, `TEKNIK`, `ENGINEERING`, `PERENCANAAN`, `KONSTRUKSI_UP3`, `VENDOR`, `VIEWER`, `MANAGER_ULP`, `ASMAN_PERENCANAAN`, `ASMAN_NIAGA`, `ASMAN_KONSTRUKSI`.

`KONSTRUKSI_ULP` dihapus. `ASMAN_TEKNIK` digantikan `ASMAN_KONSTRUKSI`. `ENGINEERING` tetap role berbeda.

## 2. PB/PD dan proses layanan

- Jenis utama: PB dan PD. Penambahan daya dan perubahan daya diperlakukan sebagai PD.
- PD menggunakan delta daya `daya_baru - daya_lama`; PB memakai daya lama = 0.
- Input manual oleh NIAGA_RETAIL dan integrasi Bot Daftung.
- Survey wajib untuk PB/PD. Gambar teknik dan studi kelayakan bersifat kondisional. Konstruksi dilakukan bila perluasan jaringan diperlukan.
- Nomor register/agenda diterbitkan aplikasi lain; DISTRIVA menerima melalui API atau input manual dan menyimpan sebagai referensi eksternal.
- Status EIS AP2T dan hari layanan disinkronkan otomatis terjadwal dan dapat dijalankan manual. Status eksternal terpisah dari workflow internal.
- Pembayaran harus terverifikasi sebelum status bergerak ke tahap setelah pembayaran.
- PK hanya diterbitkan jika ada perluasan jaringan. Tanpa perluasan, setelah pembayaran proses menuju pemasangan meter.
- Pemasangan meter harus diverifikasi sebelum COMPLETED.
- API Bot Daftung, EIS AP2T, dan payment belum memiliki kontrak final; jangan mengarang endpoint/payload.

## 3. Task assignment, SLA, dan revisi

- Penugasan manual menjadi mekanisme awal; satu primary assignee per task dan dapat memiliki contributors.
- Assignment, acceptance, start, submit, review, approval memiliki timestamp.
- Revisi membuat nomor revisi dan versi dokumen baru; alasan dan riwayat tidak dihapus.
- SLA internal proses terpisah dari SLA layanan PB/PD (kategori 4, 14, 24, dan >25 hari).
- Hari kerja menjadi default SLA; kalender dapat dipilih untuk layanan tertentu. Kalender, hari libur, jam operasional dapat dikonfigurasi.
- Waktu menunggu eksternal dan revisi dicatat terpisah; aturan pause/resume rinci masih perlu SOP.

## 4. Dokumen

- File disimpan pada private storage di luar public web root.
- Format: PDF, JPG, JPEG, PNG, XLS, XLSX, DOC, DOCX; DWG/DXF juga diterima untuk gambar teknis/Auto MTO.
- Versi lama immutable; versi baru tidak mewarisi approval versi lama.
- Approval berlaku sesuai kategori dokumen dan tahap workflow; tidak semua dokumen perlu approval formal.
- Validasi ekstensi, MIME, signature, ukuran, malware, nama file aman, checksum SHA-256.
- File download/preview melalui Laravel dengan pemeriksaan akses.
- Backup dokumen terkoordinasi dengan backup database.

## 5. Gambar dan Auto MTO

- Satu file gambar utama jika memungkinkan; lampiran pendukung opsional. Semuanya satu package dan satu versi.
- Format: XLS/XLSX, PDF, DWG/DXF, JPG/PNG.
- Data tabel Excel dan visual gambar dianalisis bersama. Ketidaksesuaian ditandai, tidak otomatis diputuskan.
- KHS code menjadi kunci utama; nama konstruksi dan simbol menjadi pendukung. KHS yang tidak ditemukan harus direview manual, tidak ditebak dari kemiripan nama.
- BOM menentukan kebutuhan material. Jumlah konstruksi × koefisien BOM adalah pola umum; formula spesifik mengikuti basis KHS.
- Psg menentukan kebutuhan pemasangan baru; Bkr dicatat terpisah dan tidak otomatis mengurangi kebutuhan.
- Retur pada perhitungan RAB bersifat informasi; retur fisik dikelola aplikasi material.
- Petugas teknis ULP wajib memverifikasi semua hasil. Koreksi kuantitas, KHS, tambah/hapus material harus memiliki alasan.
- Manager ULP menyetujui paket sebelum masuk antrean UP3. Perencanaan dan Konstruksi UP3 review paralel; keduanya harus approve versi yang sama.
- Revisi membuat versi baru; hasil review versi lama hanya histori.
- BOM terverifikasi menjadi dasar RAB dan WO. Perubahan yang berdampak investasi memicu hitung ulang RAB/KKF.
- Python membantu ekstraksi; Laravel menjalankan aturan hitung deterministik dan workflow approval.

## 6. Material, gudang, dan integrasi aplikasi material

- ERP adalah sumber master material (kode, nama, unit, spesifikasi); kategori dipetakan DISTRIVA bila ERP tidak menyediakan.
- Jangan menciptakan kode material baru. Sync master harus staging, preview, validasi, log, dan tidak mengubah saldo/riwayat stok.
- Master SKU terpusat; harga/stok berbeda menurut UP3.
- Aplikasi material eksisting adalah source of truth untuk master operasional, gudang, stok, alokasi, issue, transfer, retur, dan stock opname.
- DISTRIVA tidak membangun ulang modul persediaan. DISTRIVA menyimpan kebutuhan BOM/WO dan menerima snapshot/status eksternal secara read-only.
- Kebutuhan dikirim ke aplikasi material hanya setelah WO disetujui ASMAN_KONSTRUKSI dan diterbitkan. Gunakan idempotency key berbasis WO dan versinya.
- Integrasi menggunakan adapter API/webhook/file atau akses DB resmi; kontrak aktual masih menunggu informasi aplikasi.
- Kebijakan ULP: KWH meter 1-phase prabayar/pascabayar, seluruh rating MCB 1-phase, TC 2×10 dan TC 2×16. TC di ULP dihitung dalam meter. Material lainnya dikelola UP3.
- Variasi material dan kategori lengkap dicatat pada master data; kode ERP tetap menjadi identitas material.

## 7. RAB, KKF, dan studi kelayakan

- Workbook `MASTER RAB & KKF.xlsx` dan `MASTER TARIF & JAM NYALA.xlsx` adalah referensi analisis, bukan mesin formula yang dieksekusi langsung.
- 518 KHS code menjadi basis KHS. BOM disusun terstruktur; rumus Excel direkonstruksi dan diuji terhadap contoh tervalidasi.
- Material PLN/TUNAI dicatat per item. Legacy sheet yang tidak terhubung ke REKAP tidak diaktifkan tanpa review.
- Pembulatan hanya pada total akhir RAB; tidak ada pembulatan antara per baris/subtotal/komponen.
- Basis asuransi dan K3L adalah total RAB pekerjaan/material sebelum PPN; tarif configurable dan harus diverifikasi terhadap ketentuan resmi.
- Biaya commissioning berdasar nilai kontrak terkait; impor Excel/CSV dan API didukung secara desain.
- HPE membandingkan BP dengan total RAB dan menampilkan rasio BP/RAB.
- KAJIAN (analisis konsumsi/pendapatan) terpisah dari RAB.
- Master tarif Rp/kWh dan jam nyala terpisah. Tarif bersumber dari penetapan resmi dengan masa berlaku; jam nyala dari laporan 309 bulanan per ULP/golongan/periode.
- Upload tarif, laporan 309, BPP, harga kontrak membuat versi baru setelah preview/validasi; tidak menimpa histori.
- User memilih periode laporan 309 yang digunakan untuk KKF. Upload baru tidak mengubah KKF lama.
- Setiap KKF menyimpan snapshot versi tarif, jam nyala, BPP, BOM, harga/kontrak, parameter, input dan template.
- Parameter Discount Rate adalah master configurable dengan nilai awal dari workbook. RWACC tetap dihitung dan ditampilkan sebagai indikator, tetapi tidak otomatis menggantikan Discount Rate.
- O&M default 2% dari investasi RAB, configurable. Horizon proyeksi default 25 tahun, configurable.
- Cashflow Year 0: investasi RAB sebagai outflow, BP dan biaya estetika (jika ada) sebagai inflow. Tahun 1–25: pendapatan energi, biaya pembelian energi, O&M, net benefit.
- NPV memakai Discount Rate; Year 0 tidak didiskontokan. IRR memakai seluruh arus kas Year 0–25. B/C = PV benefit / PV cost. PBP dihitung ketika kumulatif net cashflow positif dengan interpolasi bulan.
- Kriteria default LAYAK: `IRR > Discount Rate AND NPV > 0 AND PBP <= 5 tahun`; configurable dan perlu verifikasi formal sebelum produksi.
- Rasio BP >= 1 ditampilkan sebagai indikator tetapi tidak otomatis menjadi syarat final LAYAK pada logika workbook yang dianalisis.
- RKM bukan bagian dari approval RAB/KKF dan bukan PO.
- Output PDF: KKF, HPE/Perbandingan BP-RAB, REKAP, REKAP RINCI. Formulir 5 dan 6 tidak dibutuhkan. Template final masih perlu disahkan.

## 8. Review gambar, RAB/KKF, dan dispensasi PBP

- ULP menyerahkan gambar dan BOM; Manager ULP menyetujui paket.
- Perencanaan dan Konstruksi UP3 meninjau paralel pada versi yang sama.
- Jika salah satu meminta revisi, final approval terkunci; versi baru mengembalikan status review kedua pihak menjadi pending.
- Normal PBP <=5 tahun: ASMAN_PERENCANAAN dan ASMAN_KONSTRUKSI keduanya wajib approve; UP3_MANAGER tidak menjadi approver jalur normal.
- PBP >5 tahun: justifikasi tertulis ULP dan dokumen pendukung; persetujuan 4/4 oleh ASMAN_PERENCANAAN, ASMAN_NIAGA, ASMAN_KONSTRUKSI, dan UP3_MANAGER.
- Dispensasi tidak mengubah hasil NPV/IRR/PBP; hanya memberi dasar pengecualian workflow. Persetujuan terikat pada versi KKF; perubahan relevan mewajibkan pengajuan ulang.

## 9. Vendor, WO, dan konstruksi

- Master vendor dikelola pusat; satu akun login per perusahaan vendor; vendor nonaktif tidak menerima penugasan baru.
- Sistem merekomendasikan vendor eligible berdasar status, kontrak, jenis pekerjaan, cakupan UP3, kapasitas/sisa kontrak. KONSTRUKSI_UP3 memilih; di luar rekomendasi harus disertai alasan/audit. ASMAN_KONSTRUKSI approve/reject penugasan.
- Satu aplikasi/pekerjaan PB/PD menghasilkan satu WO aktif. WO berisi paket pekerjaan, tugas, material dari drawing/BOM/RAB approved.
- WO mengacu versi approved; revisi immutable. Kebutuhan material berubah melalui change request.
- Vendor dan Pengawas Jaringan dapat mengirim progres; progres resmi adalah yang diverifikasi Pengawas Jaringan.
- Vendor mengirim dokumen selesai; Pengawas inspeksi fisik; ASMAN_KONSTRUKSI memberi approval final setelah sesuai.

## 10. Dashboard, laporan, notifikasi, SLA, administrasi

- ULP melihat scope sendiri; UP3 melihat konsolidasi ULP dalam UP3; manajemen mengikuti assignment/scope. SYS_ADMIN tidak otomatis mendapat akses dokumen bisnis terbatas.
- Dashboard filter dinamis dan drill-down; export XLSX/PDF/CSV mengikuti scope, filter, metadata resmi, dan tercatat.
- Audit trail aktivitas penting immutable; actor, role/title, unit, timestamp, action, before/after, reference. Log tidak dapat diedit/dihapus oleh user biasa maupun admin aplikasi.
- Notifikasi: in-app utama, email, WhatsApp pendukung. INFO in-app; WARNING in-app+email; HIGH in-app+email+WA; CRITICAL seluruh kanal + eskalasi. Kegagalan satu kanal tidak menghentikan workflow.
- User dapat mengatur INFO/WARNING; HIGH/CRITICAL mengikuti kebijakan wajib.
- Account status: PENDING_ACTIVATION, ACTIVE, SUSPENDED, INACTIVE.
- User internal dibuat manual atau bulk Excel/CSV melalui preview/validasi; password tidak boleh ada di file import.
- Password awal random, sekali pakai, dikirim melalui email dan WhatsApp bila tersedia; kedaluwarsa default 24 jam configurable; wajib diganti saat login pertama.
- Recovery menggunakan OTP email dan WhatsApp bila tersedia; reset mengakhiri sesi aktif.
- Login max 5 gagal lalu lock 15 menit; idle timeout default 30 menit configurable; CAPTCHA setelah beberapa kegagalan; MFA wajib SYS_ADMIN dan direkomendasikan admin/pejabat.
- Password minimal 8 karakter dengan uppercase, lowercase, angka, simbol; tidak boleh memakai 5 password terakhir; tolak password umum/terbocorkan; tidak ada expiry periodik wajib tanpa indikasi kompromi.
- Mutasi staf/pejabat dilakukan UP3_ADMIN berdasar dokumen mutasi/penugasan tanpa approval UP3_MANAGER; assignment lama diakhiri, assignment baru dibuat; Plt didukung dengan tanggal mulai/akhir.

## 11. Konfigurasi dan continuity

- Hierarki konfigurasi GLOBAL → UP3 → ULP; prioritas ULP, lalu UP3, lalu GLOBAL.
- Override lebih spesifik tidak boleh melonggarkan minimum keamanan global.
- Perubahan workflow operasional UP3 disetujui UP3_MANAGER sebelum diterapkan UP3_ADMIN.
- Template global dikelola SYS_ADMIN; custom UP3 perlu approval UP3_MANAGER; versi aktif immutable.
- Integrasi global dikelola SYS_ADMIN; konfigurasi teknis per UP3 dikelola SYS_ADMIN; UP3_ADMIN monitoring.
- Konfigurasi versioned, effective dates, approval, rollback sebagai versi baru; transaksi menyimpan snapshot konfigurasi.
- Backup harian DB dan dokumen, WAL archiving; retensi harian 30 hari, mingguan 12 minggu, bulanan 12 bulan; backup terenkripsi dan terpisah.
- Target RPO 1 jam dan RTO 4 jam; perlu restore drill.

## 12. Hal yang masih terbuka

- Kontrak API/auth/payload Bot Daftung, EIS AP2T, payment, ERP, aplikasi material, email, WhatsApp.
- Daftar resmi organisasi, pejabat dan kewenangan yang harus sesuai surat/SOP.
- Template PDF resmi dan identitas yang diizinkan.
- Parameter dan formula workbook yang perlu validasi teknis/regulasi sebelum produksi.
- Aturan pause/resume SLA secara rinci.
- Kapasitas server aktual, domain, IP, firewall, protokol external storage, dan topologi jaringan.
- Sampel 3–5 gambar riil untuk uji akurasi Auto MTO.
- Data konsumsi material aktual untuk pengembangan model forecasting material langsung.


## 14. Finalisasi desain master data T4.2.2 (5 November 2026)

- Setiap varian material harus memiliki kode material/SKU ERP tersendiri; satu kode ERP menjadi satu record master `materials`. Varian tanpa kode ERP terverifikasi tidak boleh dibuat sebagai master resmi.
- **Catatan histori:** dua butir harga eksternal saja dan approver `ASMAN_KONSTRUKSI` mencatat keputusan awal sebelum revisi T4.2.2. Keduanya superseded oleh keputusan desain T4.2.2 yang lebih baru dan dirangkum pada v3.11.0 di bawah; jangan gunakan butir historis ini sebagai aturan berjalan.
- Kategori material, satuan/konversi, KHS, konstruksi, BOM, formula terstruktur, staging sync, dan change log mengikuti `23-T4.2.2-MASTER-DATA-SCHEMA.md`.

### Klarifikasi supersession T4.2.2 — v3.11.0 (5 November 2026)

Keputusan desain yang berlaku, tercatat dalam `docs/15-DECISIONS-AND-OPEN-ISSUES.md` dan `docs/23-T4.2.2-MASTER-DATA-SCHEMA.md`:

- Harga RAB mendukung dua sumber: harga eksternal resmi dan master harga internal per-UP3 (`D-MDM-001`). Jenis/sumber harus eksplisit dan harga terpilih disnapshot. Prioritas/default dan otoritas perubahan harga internal masih `OPEN`; harga tidak dipilih diam-diam.
- `UP3_MANAGER` adalah approver utama versi KHS dan BOM (`D-MDM-002`); approved version immutable dan perubahan menghasilkan versi baru.

Klarifikasi ini menyelaraskan ringkasan finalized decisions dengan keputusan T4.2.2 yang lebih baru; bukan keputusan owner baru pada checkpoint v3.11.0. O-041 tetap terbuka untuk prioritas harga/UOM dan detail kalkulasi. T4.2.2 tetap final hanya pada level desain yang dinyatakan di dokumen 23, bukan implementasi.


## T4.2.3 — Keputusan final yang telah dikonfirmasi (v2.9)

1. Nomor telepon pelanggan wajib tersedia sebelum permohonan resmi diajukan/diproses. Impor Bot Daftung boleh diterima ke staging tanpa nomor telepon; NIAGA_RETAIL melengkapi sebelum submit.
2. NOAGENDA dan NO_REGISTRASI merupakan referensi eksternal terpisah.
3. IDPEL disimpan sebagai external reference pada customer, bukan primary key; satu IDPEL dapat terkait dengan banyak permohonan milik customer yang sama.
4. Satu customer internal DISTRIVA dapat memiliki banyak applications.
5. No. Register (`PAYMENT_REGISTER`) dan No. Agenda (`AGENDA`) melekat pada masing-masing permohonan, bukan pada customer. Satu customer/IDPEL dapat memiliki banyak nomor tersebut melalui banyak permohonan. Keduanya boleh belum tersedia saat permohonan baru dibuat; penerbitan ulang/koreksi disimpan sebagai histori.
4. TOTALBIAYA tidak otomatis dianggap sebagai pembayaran; TGLBAYAR perlu verifikasi.
5. STATUS_PERMOHONAN dan DURASI_HARI_KERJA adalah data eksternal yang dipertahankan dalam histori, tidak menggantikan workflow internal.
8. Data sumber Bot Daftung dipertahankan melalui staging/payload untuk audit dan rekonsiliasi.

Prosedur rekonsiliasi/merge customer jika IDPEL konflik, satuan daya, kontrak integrasi dan payment, status mapping, serta detail formulir survei masih open.


### Keputusan T4.2.3 tambahan — sinkronisasi status Bot Daftung (v3.0)
1. Untuk data permohonan yang sudah ada dan ditemukan melalui No. Agenda, sinkronisasi hanya memperbarui tiga kolom: `DURASI_HARI_KERJA`, `STATUS_PERMOHONAN`, dan `TGL_UPDATE_PERMOHONAN`.
2. Tidak ada atribut lain pada data customer atau application yang boleh diubah oleh jalur sinkronisasi status.
3. IDPEL bukan kunci update permohonan; No. Agenda menjadi kunci pencocokan untuk status permohonan existing.
4. Status eksternal tidak menggantikan status workflow internal DISTRIVA.
5. Data stale, konflik, dan update yang diterapkan dicatat; histori dan waktu sinkronisasi dipertahankan.

## Keputusan T4.2.3 v3.1 — rentang download Bot Daftung

- Acuan rentang download adalah tanggal permohonan pertama kali dibuat.
- File dapat memuat data lama dan baru; batch dapat overlap.
- Ketidakmunculan record pada batch selanjutnya tidak berarti penghapusan, pembatalan, atau selesai.
- Untuk application existing yang cocok tepat melalui No. Agenda, hanya `DURASI_HARI_KERJA`, `STATUS_PERMOHONAN`, dan `TGL_UPDATE_PERMOHONAN` yang boleh diperbarui.
- `TGL_UPDATE_PERMOHONAN` menentukan kebaruan status; tanggal download/import hanya metadata batch.
- Bot Daftung tidak memiliki ID unik internal permohonan. Data tanpa nomor eksternal masuk staging dan deteksi kandidat; tidak auto-merge berdasarkan kemiripan.

## Keputusan desain T4.2.1.2A — authorization actor/scope (v3.7.0)

- Tidak menambah role Pengawas Jaringan. Fungsi verifikasi progres dan inspeksi berada pada `KONSTRUKSI_UP3` untuk WO di ULP anak dalam UP3 assignment terkait. Hak tersebut khusus per aksi, bukan `UP3_DESCENDANT_READ`, bukan approval final, dan bukan hak mutation lain.
- Setiap user dengan assignment efektif `KONSTRUKSI_UP3` pada UP3 terkait dapat melakukan verify/inspect seluruh WO child-ULP tanpa assignment tambahan per WO/task; kewenangan tetap terbatas pada aksi khusus tersebut.
- Pada semua workflow approval/review AND, approver harus user berbeda; submitter tidak boleh menjadi final approver atas versinya sendiri. RKM diajukan ULP, divalidasi `PERENCANAAN` AND `KONSTRUKSI_UP3`, dan final-approve oleh `UP3_MANAGER`.
- Submitter progres (vendor maupun internal) harus berbeda user dari verifier.
- Report/dashboard mewarisi permission dan organizational scope resource sumber. Export memerlukan permission terpisah per domain dan tetap memakai predicate sumber yang sama.
- Permission identifiers, role-permission grants, dan scope implementation belum disetujui. Keputusan ini mencatat workflow/scope saja; lihat candidate catalog dan unresolved actors di `34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md`.
