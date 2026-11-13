# 19 — Server Inventory & Infrastruktur Aktual DISTRIVA

**Versi dokumentasi:** 2.2  
**Tanggal pencatatan:** 5 November 2026  
**Sumber:** output perintah inspeksi server yang diberikan pemilik sistem.  
**Status:** hasil observasi; belum merupakan hasil audit keamanan, benchmark beban, atau uji kapasitas.

## 1. Ringkasan spesifikasi aktual

| Komponen | Hasil observasi |
|---|---|
| Distribusi OS | Ubuntu 26.04.1 LTS (Resolute) |
| Kernel | Linux 7.0.0-38-generic, x86_64 |
| CPU | Intel Core i5-6600 @ 3.30 GHz |
| CPU topology | 4 CPU online, 4 core, 1 thread/core, 1 socket |
| Frekuensi maksimum terlapor | 3.90 GHz |
| RAM | 15 GiB terdeteksi (kelas perangkat 16 GB) |
| Swap | 5.0 GiB |
| Root filesystem | `/dev/nvme0n1p2`, 463 GB; 23 GB terpakai; 416 GB tersedia pada saat pemeriksaan |
| NVMe fisik | `nvme0n1`, 476.9 GB |
| EFI | `/dev/nvme0n1p1`, 1 GB |
| Disk data | `/dev/sda1`, 458 GB filesystem; perangkat fisik 465.8 GB |
| Mount disk data | `/run/media/adminserver/DATA` |
| PostgreSQL | Cluster `18-main`, service aktif |
| PHP CLI | PHP 8.5.4 (NTS), Zend OPcache |
| PHP-FPM | `php8.5-fpm.service`, aktif pada pemeriksaan service sebelumnya |
| Node.js | v22.23.4 |
| npm | 10.9.9 |
| Web server | Nginx, aktif |
| Redis | `redis-server.service`, aktif |
| Process manager | `supervisor.service`, aktif |
| Laravel Reverb | Supervisor program `antrian-ku-reverb`, RUNNING |
| Queue Worker | Dua proses `antrian-ku-worker`, RUNNING |
| Docker | Tidak terlihat pada daftar service yang cocok dengan perintah inspeksi; status instalasi belum diverifikasi |
| Alamat LAN | `10.5.119.251/24` pada `enp0s31f6` |
| Default gateway | `10.5.119.119` |
| Wi-Fi | `wlp4s0` dalam kondisi DOWN saat pemeriksaan |

## 2. Kondisi resource pada saat pemeriksaan

### 2.1 Memori
- RAM total yang dilaporkan: sekitar 15 GiB.
- Memori tersedia: sekitar 9 GiB.
- Swap terpakai: sekitar 5.3 MiB dari 5 GiB.
- Angka `free` dapat berubah karena Linux menggunakan RAM untuk cache/buffer. Gunakan `available` untuk estimasi memori yang masih dapat digunakan tanpa tekanan berat.

### 2.2 CPU dan beban
- Load average: `0.38, 0.18, 0.06`.
- CPU idle pada sampel `top`: 84.6%.
- Terdapat proses Python dan Chrome pada saat pengambilan sampel. Proses tersebut belum dapat dipastikan sebagai bagian dari DISTRIVA; inventaris proses harus dilakukan terpisah.
- Ini hanya snapshot sesaat, bukan benchmark kapasitas atau beban puncak.

### 2.3 Penyimpanan
- Root berada pada NVMe dan masih memiliki ruang kosong yang cukup besar pada saat pemeriksaan.
- Disk SATA kedua terpasang pada `/run/media/adminserver/DATA`.
- `findmnt` menunjukkan `/dev/sda1` bertipe ext4 ter-mount pada `/run/media/adminserver/DATA`. Namun `/etc/fstab` yang diperiksa hanya berisi root, swap, dan EFI; tidak ada entri untuk disk DATA. Karena itu persistensi mount setelah reboot belum dijamin. Mount path `/run/media/...` juga lazim dipakai automount desktop. Sebelum dipakai untuk dokumen produksi, buat mount point server permanen (misalnya `/srv/distriva-data`), gunakan UUID dari `blkid` pada `/etc/fstab`, atur permission, lalu uji `mount -a` dan reboot terencana.
- Disk SATA tersebut adalah disk lokal kedua, bukan bukti adanya NAS atau network storage. Kebutuhan backup tetap harus dipenuhi pada media/server terpisah.

## 3. Runtime, port, firewall, dan proses

### 3.1 Runtime

| Runtime | Versi/hasil |
|---|---|
| Node.js | `v22.23.4` |
| npm | `10.9.9` |
| PHP CLI | `8.5.4` (NTS) |

Versi Laravel, ekstensi PHP, dan build toolchain frontend belum diperiksa dari direktori aplikasi DISTRIVA.

### 3.2 TCP/UDP listening yang relevan

| Bind address:port | Proses terlapor | Catatan |
|---|---|---|
| `0.0.0.0:22`, `[::]:22` | sshd | SSH terbuka pada semua interface |
| `0.0.0.0:80`, `[::]:80` | Nginx | HTTP terbuka |
| `10.5.119.251:8081` | Nginx | Hanya bind pada alamat LAN ini |
| `127.0.0.1:5432` | PostgreSQL | Tidak listen pada interface LAN |
| `127.0.0.1:6379`, `[::1]:6379` | Redis | Loopback saja |
| `127.0.0.1:8080` | proses `php8.5` | PID sama dengan program Reverb di Supervisor pada saat pemeriksaan; verifikasi konfigurasi Reverb sebelum menyimpulkan fungsi port |
| `127.0.0.1:20241` | cloudflared | Listener lokal; konfigurasi tunnel belum diperiksa |
| `*:3389` | xrdp | Firewall membatasi ke `10.5.119.0/24` |
| port acak localhost | Chrome/ChromeDriver | Listener lokal proses otomasi browser |

Tidak terlihat listener TCP pada port 443 dalam snapshot `ss`, meskipun UFW mengizinkan 443. HTTPS/TLS belum terbukti aktif dari pemeriksaan ini. Port 8081 perlu dipetakan ke virtual host/aplikasi yang sesuai sebelum dipakai DISTRIVA.

### 3.3 Firewall UFW

- Status: aktif; logging `low`.
- Default incoming: `deny`; outgoing: `allow`; routed: `disabled`.
- Diizinkan: 22/tcp, 80/tcp, 443/tcp dari semua alamat; 3389/tcp dan `10.5.119.251:8081/tcp` hanya dari `10.5.119.0/24`.
- Aturan IPv6 yang terlihat mengizinkan 22, 80, dan 443 dari semua alamat IPv6.
- SSH yang terbuka global perlu ditinjau (key-based authentication, nonaktifkan password login bila sesuai, pembatasan sumber/VPN/fail2ban sesuai kebijakan).
- Port 443 yang diizinkan firewall bukan bukti layanan HTTPS sudah listening.

### 3.4 Supervisor

Snapshot `supervisorctl status`:

```text
antrian-ku-reverb                        RUNNING
antrian-ku-worker:antrian-ku-worker_00   RUNNING
antrian-ku-worker:antrian-ku-worker_01   RUNNING
```

Ketiga program tersebut milik aplikasi ANTRIAN-KU, bukan DISTRIVA. DISTRIVA harus memiliki program, queue, log, working directory, user proses, dan environment tersendiri. Jangan menggunakan ulang konfigurasi ANTRIAN-KU tanpa penyesuaian.

## 4. Penilaian terhadap target perencanaan T4.1.2

Target perencanaan sebelumnya adalah 8 core/16 thread dan RAM 32 GB. Kondisi aktual adalah 4 core/4 thread dan sekitar 15 GiB RAM.

| Aspek | Target awal | Aktual | Penilaian |
|---|---:|---:|---|
| CPU | 8 core/16 thread | 4 core/4 thread | Di bawah target |
| RAM | 32 GB | 16 GB kelas perangkat | Di bawah target |
| Disk sistem | NVMe sekitar 500 GB | NVMe 476.9 GB | Mendekati target |
| Storage dokumen | Storage terpisah/NAS | Disk SATA lokal 465.8 GB | Belum memenuhi pemisahan lokasi |
| Backup terpisah | Wajib | Belum terverifikasi | Perlu disiapkan |

**Kesimpulan kapasitas:** server dapat dipakai untuk tahap pengembangan, integrasi awal, dan uji coba dengan beban terbatas. Kelayakan produksi belum dapat diputuskan hanya dari spesifikasi dan snapshot ini. Perlu uji beban, pengukuran pertumbuhan data, concurrency, serta pemulihan backup.

## 5. Rekomendasi pembagian resource awal

1. Jalankan Nginx, Laravel/PHP-FPM, PostgreSQL, Redis, Reverb, Scheduler, dan worker pada server yang sama sesuai keputusan single-server tahap awal.
2. Batasi jumlah Laravel queue workers dan proses Python secara eksplisit.
3. Jalankan Auto MTO secara asynchronous melalui queue; batasi concurrency OCR/CAD dan ukuran file.
4. Jadwalkan pekerjaan berat Auto MTO/Forecasting di luar jam sibuk bila memungkinkan.
5. Tetapkan batas memori dan timeout untuk worker; pantau OOM kill, swap, CPU load, query lambat, dan panjang antrean.
6. Jangan menempatkan backup satu-satunya pada disk SATA yang berada di mesin yang sama.
7. Pertimbangkan upgrade RAM ke 32 GB dan CPU/platform lebih baru sebelum beban produksi meningkat.

## 6. Informasi yang belum tersedia

Belum ada bukti dari output yang diberikan mengenai:
- Versi Laravel dan daftar ekstensi PHP.
- Status build React dan konfigurasi virtual host Nginx.
- Versi Redis dan konfigurasi persistence.
- Konfigurasi PostgreSQL (port, listen address, memory settings, backup/WAL).
- Status Scheduler dan konfigurasi rinci program Supervisor.
- Status nftables selain aturan UFW, DNS/domain, TLS/HTTPS, dan akses dari jaringan luar.
- Persistensi mount disk data dan metode backup.
- SMART/health NVMe dan SATA.
- Jumlah pengguna serentak dan hasil load test.

## 7. Pemeriksaan lanjutan yang disarankan

Jalankan perintah berikut secara bertahap. Periksa output sebelum membagikan; sensor password, token, secret, dan alamat publik bila ada.

```bash
# Runtime dan framework
php artisan --version   # jalankan dari direktori backend Laravel
php -m

# Service dan proses
systemctl status nginx php8.5-fpm postgresql@18-main redis-server supervisor --no-pager
sudo supervisorctl status
systemctl list-units --type=service --all | grep -Ei 'reverb|queue|distriva'

# Port dan firewall
sudo ss -lntup
sudo ufw status verbose
sudo nft list ruleset

# Mount dan filesystem
findmnt / /run/media/adminserver/DATA
cat /etc/fstab
sudo blkid
ls -ld /run/media/adminserver/DATA
ls -ld /run/media/adminserver/DATA

# Disk health (pastikan device benar sebelum menjalankan)
sudo smartctl -a /dev/nvme0
sudo smartctl -a /dev/sda

# PostgreSQL - jalankan sebagai user postgres
sudo -u postgres psql -c "SELECT version();"
sudo -u postgres psql -c "SHOW port;"
sudo -u postgres psql -c "SHOW listen_addresses;"
```

Jangan mengirim isi `.env`, private key, token integrasi, password database, atau output yang mengandung kredensial.

## 8. Status T4 setelah inspeksi

- **T4.1.1 Arsitektur keseluruhan:** keputusan arsitektur telah disetujui.
- **T4.1.2 Pembagian server dan deployment:** spesifikasi, runtime dasar, dan layanan yang sedang aktif sudah tercatat; sizing produksi masih perlu validasi beban.
- **T4.1.3 Jaringan, domain, port, firewall, komunikasi antarservice:** port listening dan aturan UFW telah diperiksa; DNS/domain, TLS, nftables, serta pemetaan virtual host masih perlu diverifikasi.
- **T4.10 Deployment/operasional:** inventaris awal tersedia; mount permanen disk DATA dan konfigurasi deployment DISTRIVA belum diverifikasi.

## 9. Catatan keamanan

Alamat `10.5.119.251` dan gateway `10.5.119.119` adalah informasi jaringan privat internal yang dicatat untuk dokumentasi operasional. Jangan mempublikasikan dokumentasi inventaris ini secara terbuka. Kredensial, token, private key, dan konfigurasi rahasia tidak boleh dimasukkan ke dokumentasi.
