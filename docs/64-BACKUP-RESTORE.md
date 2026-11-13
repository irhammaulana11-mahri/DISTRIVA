# 64 — Backup dan Restore (database + folder dokumen)

Permintaan pemilik 6 Nov 2026: backend backup **manual atau terjadwal** dan **restore**, disertai prompt untuk agen frontend. **Diterapkan ke `distriva_db` 6 Nov 2026** (backup `backups/distriva_db_pre-backupmodule_*.dump` 807 KB/501 entri, uji restore identik; migrasi `260000`; `BackupPermissionSeeder` dua kali: 55 permission, 6 hak `backups.*` hanya SYS_ADMIN; jadwal nonaktif bawaan; `backup_runs` kosong). **Belum diatur:** `DISTRIVA_BACKUP_ROOT` (drive media) dan cron `schedule:run`.

## 1. Prinsip keselamatan
- **Hanya SYS_ADMIN** (MFA wajib) yang memegang hak `backups.*` (view, create, verify, download, manage, restore). Berkas dump memuat semua tabel (termasuk hash kata sandi) — jangan diberikan ke peran lain.
- **Restore hanya dari cadangan yang sudah diverifikasi.** Verifikasi = memulihkan dump ke *database sementara* (`distriva_verify_*`), memeriksa checksum sha256, kecocokan jumlah tabel `migrations` dan versi skema, lalu menghapus database sementara. Database asli tidak disentuh.
- **Pengaman otomatis:** sebelum restore dibuat cadangan `PRE_RESTORE` dari keadaan sekarang (gagal = restore dibatalkan, data tidak berubah).
- **Satu transaksi:** `pg_restore --clean --if-exists --single-transaction --exit-on-error`. Gagal di tengah = tidak ada yang berubah.
- **Konfirmasi berlapis di API:** hak `backups.restore`, frasa ketik persis `PULIHKAN <nomor cadangan>`, **kata sandi pelaku**, alasan wajib. Satu pemulihan pada satu waktu (indeks unik database); tidak boleh bersamaan dengan pencadangan.
- **Versi skema harus sama:** cadangan dari versi migrasi lain ditolak (409) — pulihkan manual oleh administrator.
- **Tabel riwayat tidak ikut dump** (`backup_runs`, `restore_runs`, `backup_settings`, `backup_events`): restore tidak dapat memundurkan atau menghilangkan catatan. `backup_events` append-only (trigger).
- **Folder dokumen:** diarsipkan `tar.gz` bila diminta; saat restore dokumen hanya **menambahkan berkas yang hilang** (`--skip-old-files`), tidak menimpa atau menghapus.
- **Rahasia:** kata sandi database hanya lewat environment proses anak; pesan galat dipotong dan disamarkan sebelum disimpan. Folder cadangan wajib privat (ditolak bila di folder publik, relatif, atau di dalam folder dokumen), berkas `chmod 600`.
- **Efek samping restore:** token login (`personal_access_tokens`) ikut kembali ke keadaan cadangan → pengguna (termasuk pelaku) dapat harus login ulang.

## 2. Konfigurasi
| Variabel | Arti |
|---|---|
| `DISTRIVA_BACKUP_ROOT` | Path **absolut** di drive media (bawaan sementara: `storage/app/private/backups`). Pantau dengan `GET /api/backups/status` (`health`). |
| `DISTRIVA_PG_DUMP` / `_PG_RESTORE` / `_PSQL` / `_TAR` | Nama/path biner bila tidak ada di PATH. |
| `DISTRIVA_PHP_BINARY` | PHP CLI untuk proses latar belakang (bawaan `php`). |
| `DISTRIVA_BACKUP_TIMEOUT` | Detik per proses (bawaan 3600). |

Jadwal (aktif/jam/sertakan dokumen/jumlah salinan disimpan) disimpan di tabel `backup_settings` dan diubah lewat API. **Cron server wajib ada:** `* * * * * cd /path/backend && php artisan schedule:run >> /dev/null 2>&1`. Satu percobaan terjadwal per hari bisnis (gagal terlihat di daftar, tidak diulang terus-menerus). Retensi: `retention_count` cadangan MANUAL/SCHEDULED terbaru disimpan, `PRE_RESTORE` 5 terbaru; yang lebih lama dihapus berkasnya (catatan tetap, status `DELETED`).

## 3. Perintah terminal
| Perintah | Fungsi |
|---|---|
| `php artisan distriva:backup [--documents] [--notes=]` | Cadangan manual sekarang. |
| `php artisan distriva:backup-verify <nomor>` | Uji pemulihan ke database sementara. |
| `php artisan distriva:backup-scheduled` | Dipanggil scheduler tiap menit. |
| `php artisan distriva:restore <nomor> --as=<email SYS_ADMIN> --reason="…" [--documents] [--yes]` | **Darurat** bila aplikasi tidak dapat melayani API. Pengaman yang sama (harus terverifikasi, cadangan pengaman, satu transaksi). |
Perintah internal tersembunyi `distriva:backup-execute` / `distriva:restore-execute` menjalankan proses latar belakang yang diluncurkan API (`nohup`).

## 4. Runbook pemulihan
1. Pastikan penyebabnya sudah diperbaiki; pilih cadangan terbaru yang **terverifikasi** (atau jalankan Verifikasi).
2. (Disarankan) unduh cadangan pengaman ke media lain.
3. Mulai restore dari halaman Backup (atau terminal). Tunggu status `SUCCEEDED` (halaman memeriksa tiap beberapa detik).
4. Login ulang; periksa jumlah permohonan/dokumen. Bila hasil tidak sesuai, pulihkan cadangan `PRE_RESTORE` yang dibuat otomatis.
5. Kebakaran total (database kosong): jalankan migrasi pada database baru, lalu `pg_restore --clean --if-exists -d <db> <berkas.dump>` manual, dan ekstrak arsip dokumen ke `DISTRIVA_DOCUMENTS_ROOT`.

## 5. Yang sengaja belum ada
Enkripsi cadangan, salinan otomatis ke lokasi lain (drive/awan), notifikasi gagal jadwal, restore sebagian per tabel, dan restore antar-versi skema. Cadangan yang hanya berada di mesin yang sama **bukan** perlindungan terhadap kegagalan disk: salin berkala ke media lain (unduh dari API atau `rsync` folder `DISTRIVA_BACKUP_ROOT`).

## 6. Pengujian
`BackupTest` (14): hak hanya SYS_ADMIN; dump privat + sha256 + hitungan + peristiwa; tabel riwayat tidak ikut dump; arsip dokumen; satu proses sekaligus; kegagalan tercatat tanpa berkas dan tanpa kata sandi; folder publik/di dalam dokumen/relatif ditolak; verifikasi memakai database sementara dan menghapusnya (berkas rusak gagal); restore butuh verifikasi, frasa, kata sandi, skema sama; restore sungguhan ke database *scratch* (data kembali, dokumen kembali, cadangan pengaman, riwayat utuh); berkas diubah → batal sebelum menyentuh data; kegagalan restore tidak mengubah apa pun; jadwal sekali sehari; retensi dan hapus dengan alasan; `backup_events` append-only. Tes restore memakai database sementara, **tidak pernah** `distriva_db` atau `distriva_backend_test` sebagai target restore.
