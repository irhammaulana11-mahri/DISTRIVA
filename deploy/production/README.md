# Produksi DISTRIVA: skrip pemasangan di server

Tanpa rahasia di folder ini. Rahasia dibuat di server: `backend/.env` (0600, di-ignore git) dan berkas kredensial sementara `$HOME/distriva-db.env`.
Pola mengikuti `WAZAP/deploy/production`. Rujukan lain: `docs/84-PANDUAN-DEPLOY-PRODUKSI.md` (kesiapan server) dan `docs/85-RUNBOOK-PENYIAPAN-DAN-PERUBAHAN-RUMUS.md` §4 (data awal).

## Rancangan
- **Satu host**: dashboard React (berkas statis di `/var/www/distriva-web`) dan `/api` ke Laravel lewat PHP-FPM di host yang sama, jadi tanpa CORS.
- **Kolam PHP-FPM khusus `distriva`** berjalan sebagai pengguna aplikasi (bukan `www-data`): berkas unggahan, cadangan, dan proses latar belakang (`php artisan distriva:*-execute` lewat `nohup`) memakai pemilik yang sama dengan cron `schedule:run`.
- **Penyimpanan di luar proyek**: `/srv/backup-data/distriva/{documents,backups,dil-inbox}` (ubah dengan `DATA_ROOT`). `documents` = berkas yang diunggah pengguna.
- **Batas unggah**: Nginx dan PHP memakai `UPLOAD_MAX_MB` (bawaan 64; batas aplikasi untuk Excel master 60 MB). Turunkan bila ingin batas lebih kecil, mis. `UPLOAD_MAX_MB=8`.
- Tidak ada worker antrean: aplikasi tidak memakai pekerjaan antrean; semua proses berat berjalan lewat perintah `artisan` latar belakang dan penjadwal.

| Berkas | Fungsi | sudo |
|---|---|---|
| `bin/preflight.sh` | pemeriksa read-only (PHP, ekstensi, Node, PostgreSQL, Nginx, FPM, penyimpanan, DNS) | tidak |
| `bin/storage-setup.sh` | membuat folder berkas, cadangan, DIL dengan pemilik pengguna aplikasi; uji tulis | ya |
| `bin/db-setup.sh` | membuat database dan role (kata sandi acak, `btree_gist`); menolak bila sudah ada | ya (psql) |
| `bin/make-env.sh` | membuat `backend/.env` produksi dengan `APP_KEY` baru; tidak menimpa | tidak |
| `bin/install-nginx.sh`, `bin/render-nginx.sh`, `nginx/*.tpl` | kolam PHP-FPM dan vhost Nginx (mode `http`, `https`, `tunnel`); `nginx -t` dan rollback otomatis | ya |
| `bin/cron-setup.sh` | satu baris cron `schedule:run` (idempoten) | tidak |
| `bin/release.sh` | rilis: build, cadangan segar, pemeliharaan, migrasi, seeder izin (rilis pertama), cache, frontend, preflight | tidak |
| `bin/verify.sh` | verifikasi dari luar (halaman, `/up`, 401, header, HTTPS, sertifikat, batas unggah) | tidak |

Semua skrip punya `DRY_RUN=1` (kecuali `preflight.sh`, `verify.sh`, yang memang read-only).

## Aturan wajib
1. **Jangan memakai `sudo` untuk `release.sh`, `make-env.sh`, `cron-setup.sh`, `composer`, `npm`, atau `php artisan`.** Hanya langkah bertanda sudo di tabel. Berkas yang dibuat root membuat aplikasi tidak bisa menulis log, cache, dan berkas unggahan.
2. **Simpan `APP_KEY`** ke password manager dan salinan offline SEBELUM aplikasi dipakai. Kunci hilang = data terenkripsi (token, kata sandi EIS, pengaturan WhatsApp) tidak terbaca.
3. **Jangan menjalankan `db-setup.sh` dua kali** dan jangan menghapus berkas kredensial sementara sebelum `make-env.sh` berhasil.
4. **Cadangan jangan di drive yang sama dengan berkas aktif.** `storage-setup.sh` memberi peringatan; salin `backups/` ke drive atau mesin lain (`BACKUP_DIR=...`).
5. Rilis berikutnya hanya dari checkout git bersih pada tag atau commit yang dirilis.

## Urutan pemasangan
**T0. Periksa server** (tidak mengubah apa pun), ulangi sampai tidak ada GAGAL:
```bash
git clone <repo> /var/www/distriva && cd /var/www/distriva     # atau lokasi lain; jangan di dalam folder publik Nginx
DISTRIVA_DOMAIN=distriva.contoh.id SERVER_IP=<ip-server> deploy/production/bin/preflight.sh | tee preflight.txt
```
Pasang yang kurang: `sudo apt install php8.x-fpm php8.x-pgsql php8.x-mbstring php8.x-xml php8.x-curl php8.x-zip php8.x-gd php8.x-intl php8.x-bcmath nginx postgresql mdbtools poppler-utils cron`, Node 22, Composer, Chrome/Chromium (PDF); venv forecast: `python3 tools/runbook.py forecast-venv --install`.

**T1. Penyimpanan** (drive `/srv/backup-data` harus sudah terpasang):
```bash
sudo deploy/production/bin/storage-setup.sh
```

**T2. Database dan konfigurasi**:
```bash
deploy/production/bin/db-setup.sh                                   # sudo hanya untuk psql; menulis $HOME/distriva-db.env
PUBLIC_URL=https://distriva.contoh.id DB_ENV_SOURCE=$HOME/distriva-db.env deploy/production/bin/make-env.sh
shred -u $HOME/distriva-db.env
nano backend/.env                                                   # isi MAIL_* (SMTP) untuk OTP dan kata sandi sementara
```

**T3. Nginx, PHP-FPM, dan cron**:
```bash
sudo DISTRIVA_DOMAIN=distriva.contoh.id deploy/production/bin/install-nginx.sh http     # jaringan internal tanpa TLS; atau "tunnel" untuk Cloudflare Tunnel
deploy/production/bin/cron-setup.sh
```

**T4. Rilis pertama** (database kosong):
```bash
FIRST_RUN=1 deploy/production/bin/release.sh
```
Skrip ini membangun backend dan frontend, menjalankan migrasi, 13 seeder izin (urutan docs/85 §4), men-cache konfigurasi, menyalin frontend, lalu menjalankan `distriva:preflight`.

**T5. Akun pertama**: `cd backend && php artisan distriva:bootstrap-admin --role=UP3_ADMIN --email=... --name=... --unit-code=...` (atau `--role=SYS_ADMIN`; SYS_ADMIN butuh MFA). Pastikan `MAIL_*` sudah diisi karena kata sandi sementara dikirim ke pengguna.

**T6. HTTPS** (bila bukan tunnel): `sudo certbot certonly --webroot -w /var/www/certbot -d distriva.contoh.id`, lalu
`sudo DISTRIVA_DOMAIN=distriva.contoh.id deploy/production/bin/install-nginx.sh https`. Setelah `verify.sh` lulus, naikkan HSTS: `HSTS_MAX_AGE=31536000` pada pemasangan ulang.

**T7. Verifikasi**:
```bash
DISTRIVA_URL=https://distriva.contoh.id deploy/production/bin/verify.sh
VERIFY_UPLOAD_MB=64 DISTRIVA_URL=... deploy/production/bin/verify.sh      # menguji batas unggah (mengirim 65 MB)
```

**T8. Master data dan data operasional**: ikuti `docs/85` §4 langkah 7 sampai 11 (pulihkan cadangan master data, impor gardu, pelanggan, EIS, MIMS), lalu jalankan daftar periksa akhir §6 (termasuk `php artisan distriva:backup-verify`).

## Rilis berikutnya
```bash
git pull --ff-only && deploy/production/bin/release.sh          # SEED_PERMISSIONS=1 hanya bila ada kunci izin baru dan atas persetujuan pemilik
```
`release.sh` membuat cadangan baru bila yang terakhir lebih tua dari `BACKUP_MAX_AGE_H` (26 jam), menaruh aplikasi dalam mode pemeliharaan selama migrasi, dan **membiarkannya dalam mode pemeliharaan bila migrasi gagal** (perbaiki lalu `cd backend && php artisan up`). Pemulihan: `php artisan distriva:restore <nomor> --as=<email SYS_ADMIN> --reason="..."` (docs/64).

## Memindahkan berkas yang sudah ada ke `/srv/backup-data/distriva/documents`
Berlaku bila ada instalasi lama dengan dokumen di folder lain:
```bash
sudo deploy/production/bin/storage-setup.sh
cp -a <folder-dokumen-lama>/. /srv/backup-data/distriva/documents/        # salin, jangan pindah dulu
# ubah DISTRIVA_DOCUMENTS_ROOT di backend/.env, lalu:
cd backend && php artisan config:cache && php artisan distriva:documents-check
```
Buka satu dokumen lama di aplikasi untuk memastikan terbaca (checksum diperiksa saat dilayani); hapus folder lama hanya setelah yakin.

## Yang belum diverifikasi (jujur)
- Skrip `install-nginx.sh` (langkah root) diuji hanya dengan `DRY_RUN`, `nginx -t` dan `php-fpm -t` pada konfigurasi hasil render (ketiga mode); belum dijalankan sebagai root pada server nyata.
- Alur penuh dari server kosong belum dijalankan; bagian yang sudah diuji: migrasi dan seeder dari database kosong (docs/85 §4), `make-env.sh`, `render-nginx.sh`, `verify.sh` terhadap server PHP lokal.
