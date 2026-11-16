# 84. Panduan kesiapan server produksi (Tahap 12)

Semua pemeriksaan di bawah dirangkum oleh satu perintah. Jalankan setelah setiap pemasangan atau perubahan server; tidak ada nilai rahasia yang dicetak.

```bash
cd backend && php artisan distriva:preflight
```

Hasilnya PASS / WARN / FAIL per butir. Kode keluar 1 bila ada FAIL.

## 1. Cron penjadwal (wajib)
Hampir semua pekerjaan otomatis (backup, sinkronisasi EIS dan MIMS, pengingat tugas, forecast bulanan) berjalan lewat penjadwal Laravel. Pasang satu baris cron untuk pengguna yang menjalankan aplikasi:

```
* * * * * cd /path/ke/DISTRIVA/backend && php artisan schedule:run >> /dev/null 2>&1
```

Detak penjadwal dicatat tiap menit; `distriva:preflight` memberi FAIL bila lebih dari 3 menit tidak berdetak.

## 2. Folder backup
Isi `DISTRIVA_BACKUP_ROOT` dengan folder **di luar proyek** pada drive yang berbeda dari basis data (mis. `/media/data/distriva-backups`), dapat ditulis oleh pengguna aplikasi, dengan ruang kosong yang cukup (peringatan di bawah 5 GB). Jadwal dan retensi diatur di menu Backup.

## 3. Chrome untuk PDF
PDF dibuat server dengan Chrome/Chromium headless. Pasang `google-chrome` atau `chromium` (otomatis ditemukan di PATH) atau isi `DISTRIVA_PDF_BINARY`. Tanpa Chrome, unduhan PDF menjawab 503 dan XLSX tetap berfungsi.

## 4. Python dan PyTorch untuk forecast
```bash
cd tools/forecast
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple
```
Cukup versi CPU. Jumlah utas dapat diatur `DISTRIVA_FORECAST_THREADS`. Server yang tidak punya venv ini tidak bisa menjalankan forecast (run berakhir GAGAL dengan pesan jelas).

## 5. Lingkungan aman
`APP_ENV=production`, `APP_DEBUG=false`, `APP_KEY` terisi, `DISTRIVA_MIMS_VERIFY_SSL` tidak dimatikan di produksi. Folder dokumen (`DISTRIVA_DOCUMENTS_ROOT`) di luar proyek dan di luar folder publik; periksa juga dengan `php artisan distriva:documents-check`.

## 6. Setelah pemasangan
1. `php artisan migrate --force` (hanya migrasi tambahan; tinjau dengan `--pretend` lebih dulu).
2. Jalankan seeder izin hanya bila ada kunci izin baru, dan catat bahwa itu dijalankan.
3. `php artisan config:cache && php artisan route:cache`.
4. Jalankan `distriva:preflight` sekali lagi; semua FAIL harus nol.

## 7. Verifikasi kolom reservasi MIMS
Kolom jawaban `getDataReservasiHeader` belum pernah terlihat pada jawaban asli (penarikan reservasi sejauh ini kehabisan waktu tunggu). Periksa pada satu gudang, hanya nama kolom yang dicetak dan tidak ada yang disimpan:

```bash
php artisan distriva:mims-reservations-probe 5118-2810 --user=email@pengguna --days=30
```

Pengguna itu harus sudah menyimpan token di halaman Tarik Stok MIMS. Bila kolom nomor reservasi "TIDAK DITEMUKAN", kirim daftar kolom yang tercetak agar pemetaan diperbaiki. Bila terus kehabisan waktu, naikkan `DISTRIVA_MIMS_MIRROR_TIMEOUT` atau persempit `--days`.

## Sinkron DIL dari Master Pelanggan (folder berkas)
Tombol **Sinkron DIL** (Master Data → Master Pelanggan, untuk yang berhak `customers.import`) memuat berkas DIL yang diletakkan di folder server, tanpa mengunggah lewat browser (berkas `.mdb` bisa ratusan MB).
- **Folder**: `backend/storage/app/dil-inbox` (ubah dengan `DISTRIVA_DIL_INBOX`, harus di luar folder publik). Hanya `.mdb` dan `.csv` yang dibaca; tautan simbolik dan berkas lain diabaikan. Berkas yang selesai dimuat dipindah ke `diproses/` di dalamnya.
- **Pembaca .mdb**: `sudo apt install mdbtools` (`mdb-export` dan `mdb-tables` harus ada di PATH; atau atur `DISTRIVA_DIL_MDB_EXPORT` / `DISTRIVA_DIL_MDB_TABLES`). Tanpa itu, taruh berkas dalam bentuk `.csv`.
- **Keamanan**: hanya 17 kolom master yang dibaca; nama pelanggan disamarkan; NIK, NPWP, telepon, email, alamat, dan koordinat tidak pernah dibaca. Idempoten per IDPEL.
- **Per ULP, seperti penarikan MIMS per gudang**: panel menampilkan satu baris per ULP (berkas yang menunggu, jumlah pelanggan, bulan data, hasil terakhir). Centang ULP yang disinkronkan (atau "Pilih yang gagal" untuk mengulang), lalu ULP dimuat **satu per satu berurutan**; satu ULP yang gagal tidak menghentikan yang lain dan berkasnya tetap di folder. Kemajuan: ULP ke berapa, ULP yang sedang dibaca, waktu berjalan, dan perkiraan sisa (menurut ukuran berkas).
- **Monitoring**: ringkasan jumlah ULP berhasil, gagal, dan belum pernah; hasil terakhir tiap ULP dengan alasan bila gagal; riwayat 10 sinkron terakhir (berhasil/gagal per ULP, baris, lama, siapa yang menjalankan). Datanya dari tabel `dil_sync_runs`.
- **Proses**: berjalan di latar belakang (`php artisan distriva:dil-sync-execute`), satu run pada satu waktu; kemajuan terlihat di panel. Tabel `dil_sync_runs` menyimpan riwayatnya.

## Sinkronisasi EIS: Python dan venv
Tombol **Sinkronkan Sekarang** (Operasional → Sinkronisasi EIS) menjalankan `tools/eis_sync/main.py`. Alat ini punya venv sendiri (`tools/eis_sync/.venv`: python-dotenv, requests, playwright, beautifulsoup4, pandas, …) yang **dipakai otomatis bila ada**; bila tidak ada, dipakai `python3` sistem dan akan gagal dengan `ModuleNotFoundError: No module named 'dotenv'`. Di server baru: `python3 -m venv tools/eis_sync/.venv && tools/eis_sync/.venv/bin/pip install -r tools/eis_sync/requirements.txt && tools/eis_sync/.venv/bin/playwright install chromium`. `DISTRIVA_EIS_PYTHON` dapat menunjuk interpreter lain.

**Pilih unit yang disinkronkan:** pada halaman Sinkronisasi EIS, bagian "Unit yang disinkronkan" menampilkan ULP yang boleh diakses akun (semua terpilih bawaan). Centang satu atau dua unit, atau semuanya; unit diproses berurutan sesuai urutan di EIS, dan tiap unit diunduh lalu diunggah sebelum lanjut ke unit berikutnya. Pilihan disimpan pada riwayat (kolom Unit; kosong = semua unit). Penjadwalan otomatis harian selalu menjalankan semua unit. Migrasi `2026_12_08_100000` menambah kolom `units` pada `eis_sync_runs`.

**Cakupan status sinkron EIS (16 Nov 2026):** sinkron EIS sekarang menyimpan **semua status** permohonan baru (sebelumnya hanya Bayar, Cetak PK, PDL Awal, dan Peremajaan). Tabel Permohonan PB/PD menampilkan semua permohonan dan tinggal disaring lewat filter Aktif/Riwayat/Semua, Status, Daya, dan Unit; tabel pilihan Tambah Survei tetap tidak memuat status Peremajaan. Untuk membatasi lagi, isi `DISTRIVA_EIS_NEW_STATUSES` (mis. `PAID,PK_PRINTED`). Permohonan baru yang dulu dilewati ("di luar cakupan") baru masuk bila rentang tanggalnya disinkronkan ulang.
