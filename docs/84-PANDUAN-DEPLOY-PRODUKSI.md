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
- **Proses**: berjalan di latar belakang (`php artisan distriva:dil-sync-execute`), satu run pada satu waktu; kemajuan terlihat di panel. Tabel `dil_sync_runs` menyimpan riwayatnya.
