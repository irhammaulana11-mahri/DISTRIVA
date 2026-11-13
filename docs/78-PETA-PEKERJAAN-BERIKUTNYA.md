# 78 — Peta pekerjaan berikutnya (celah terhadap docs, 7 Nov 2026)
Dasar: roadmap docs/14 (tahap 0–12), docs/10, 11, 12, 13, 16/17 (batas integrasi), 24, 25, 39–41, 56 dan keadaan kode hari ini (513 tes backend lulus; frontend 176 tes lulus saat audit docs/77).
## 1. Sudah ada (menurut tahap roadmap)
1–2 fondasi, otorisasi, master data (material, KHS, konstruksi, BOM, buku harga, tarif, parameter, jadwal SR 1 fasa) · 3 PB/PD (+ impor EIS berkas, usulan banyak pelanggan) · 4 survey, gambar (berbasis peran TEKNIK ULP) · 5 Auto MTO · 6 RKM (+ stok minimal, alokasi, Kontrak Rinci) · 7 RAB/KKF + dokumen keluaran (JSON/XLSX) · 8 WO, vendor, progres, **BASTP** · 12 sebagian: backup/restore terverifikasi.
## 2. Koreksi atas ucapan saya sebelumnya: "transaksi gudang" BUKAN celah
docs/10 ("Perubahan keputusan") dan docs/16/17 menetapkan **aplikasi material eksisting sebagai sumber kebenaran stok, alokasi, issue, transfer, retur, stock opname**; DISTRIVA **tidak membuat atau mengubah saldo stok**. DISTRIVA hanya: mengelola kebutuhan material dari gambar/BOM/WO, **mengirim kebutuhan setelah WO diterbitkan ASMAN_KONSTRUKSI**, menerima snapshot stok **read-only**, dan mencatat log integrasi/idempotensi/retry/rekonsiliasi. Maka "penerimaan/pengeluaran material" dan "pengembalian sisa material ke gudang" **di luar lingkup** (modul stok minimal dan alokasi yang dibangun atas permintaan pemilik tetap berupa cuplikan baca-saja dan rencana alokasi, bukan buku besar gudang).
## 3. Celah yang nyata (urut usulan)
1. **Data pemetaan SKU ERP ↔ KHS (menunggu pemilik).** File stok asli `Monitoring_Stock_07-11-2026.xlsx` (1.254 SKU, satu gudang "Gd Ry Jombang") berkunci nomor material ERP; sistem berkunci KHS. Impor xlsx ERP dan tabel pemetaan sudah dibangun (docs/62 §39); isinya kosong sampai pemilik menyediakan tabel `kode_khs,no_material` (pencocokan nama otomatis terlalu lemah: hanya 73 kandidat pada skor ≥ 0,3, banyak yang ambigu — jangan dipakai tanpa pemeriksaan).
2. **Tahap 11 — Dashboard dan pelaporan** (KPI, rekap, filter, ekspor, enforcement lingkup): belum ada, termasuk laporan RKM docs/12 §7 (per ULP, usulan vs validasi vs persetujuan, kebutuhan kotor/stok/pasokan/bersih, material kritis, forecast vs aktual).
3. **Tahap 9 — Integrasi aplikasi material (kirim kebutuhan setelah WO terbit):** belum ada. Kontrak API aplikasi material belum tersedia (docs/13 addendum); yang dapat dibangun sekarang: **outbox** kebutuhan material per WO terbit (idempotensi, status, retry, log) dan **berkas ekspor** untuk penyerahan manual, serta laporan rekonsiliasi snapshot.
4. **SLA dan tugas (docs/24 `application_tasks`)** serta **notifikasi peristiwa alur** (penugasan, pengembalian, tenggat): saluran email/WhatsApp ada (OTP), notifikasi alur kerja belum.
5. **PDF sisi server** untuk dokumen keluaran (roadmap tahap 7) dan **studi kelayakan** sebagai agregat terpisah (docs/41 §4, keputusan pemilik masih terbuka).
6. **Otomatisasi sinkronisasi Bot Daftung/EIS** (kini impor berkas) dan integrasi pembayaran/ERP: menunggu kontrak API resmi.
7. **Penutupan permohonan `COMPLETED`** dan hubungan BASTP dengan verifikasi meter (docs/39): menunggu keputusan pemilik.
8. **Tahap 10 — Forecast ML:** ditunda sampai aplikasi selesai (arahan pemilik).
9. **Tahap 12 — hardening dan deployment:** tinjauan keamanan, kinerja, observabilitas, `DISTRIVA_BACKUP_ROOT`, penjadwal `schedule:run`, lokasi dokumen definitif, penggantian kata sandi `distriva_user`; **pemulihan `distriva_db` + migrasi 120000–200000 + seeder izin + data awal** (ditahan sampai modul selesai).
## 4. Keputusan pemilik yang membuka pekerjaan
Tabel pemetaan SKU↔KHS (1) · kebijakan penutupan permohonan dan verifikasi meter (7) · apakah studi kelayakan terpisah dari KKF (5) · kontrak API aplikasi material, Bot Daftung/EIS, pembayaran (3, 6) · waktu pemulihan database (9).


## 5. Pembaruan 14 Nov 2026
- **Pembayaran:** pemilik memutuskan status "Bayar" dari EIS = terverifikasi; integrasi pembayaran terpisah tidak diperlukan (docs/16).
- **MIMS:** arah dipilih pemilik = DISTRIVA **menarik** stok, penerimaan, dan pengeluaran material dari MIMS lalu menyinkronkannya dengan data DISTRIVA (bukan mengirim JSON ke MIMS, karena alurnya bertahap dan lintas pengguna). Stok sudah ada; penerimaan dan pengeluaran menunggu contoh endpoint/respons MIMS.
