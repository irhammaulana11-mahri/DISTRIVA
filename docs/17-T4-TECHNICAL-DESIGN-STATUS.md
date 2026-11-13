# 17 — T4 Technical Design Status

## 1. Tahapan T4

T4 adalah tahap technical design setelah business design T1–T3.13. Status di bawah mencerminkan pembahasan yang telah dilakukan; bukan klaim implementasi atau deployment.

| ID | Topik | Status |
|---|---|---|
| T4.1.1 | Arsitektur keseluruhan | Disetujui |
| T4.1.2 | Pembagian server dan deployment | Inventaris server aktual tercatat; strategi development lokal dahulu dan deployment setelah pengujian disepakati; validasi kapasitas produksi masih diperlukan |
| T4.1.3 | Jaringan, domain, port, firewall, komunikasi antarserver | Port dan UFW server sudah diperiksa; DNS/domain, TLS, nftables, dan pemetaan virtual host masih perlu diverifikasi |
| T4.2 | Desain database PostgreSQL final | T4.2.1 desain disetujui; migration/seeder dan integrity smoke tests PASS terbatas pada disposable PostgreSQL lalu di-rollback; T4.2.2 final desain, T4.2.3 masih memiliki open issues |
| T4.3 | ERD final | ERD fondasi konseptual awal tersedia; ERD fisik seluruh domain belum final |
| T4.4 | Laravel migrations/seeders dan authorization | T4.2.1 baseline migration/seeder diuji up/down pada disposable PostgreSQL; fondasi ScopedAuthorizationService/unit tests tersedia; matrix Policy/resource-scope T4.2.1.2 disetujui sebagai desain saja; permission keys, Policy, query scope, write paths, cache, PostgreSQL service integration, dan domain T4.2.2+ belum selesai |
| T4.5 | API specification final | Belum final; integrasi eksternal menunggu kontrak |
| T4.6 | Integrasi Python Auto MTO | Rancangan bisnis tersedia; kontrak service dan implementasi belum final |
| T4.7 | Struktur frontend React | Rancangan awal tersedia; belum final |
| T4.8 | UI/UX | Belum final |
| T4.9 | Testing strategy | Perlu disusun rinci |
| T4.10 | Deployment/operasional | Rancangan awal tersedia; konfigurasi aktual menunggu inspeksi |

## 2. T4.1.1 — Keputusan arsitektur disetujui

1. Backend Laravel Modular Monolith.
2. Frontend React + Vite + Tailwind CSS terpisah.
3. PostgreSQL sebagai source of truth transaksi internal.
4. Sanctum untuk authentication.
5. Spatie Permission + organizational scope untuk authorization.
6. Python Auto MTO dan Forecasting sebagai service terpisah melalui API Laravel.
7. Redis untuk cache dan queue.
8. Laravel Reverb untuk realtime notification.
9. Private file storage.
10. Integration Service Laravel untuk seluruh koneksi eksternal.

## 3. T4.1.2 — Keputusan infrastruktur disetujui

| Aspek | Keputusan |
|---|---|
| Deployment awal | Satu server untuk semua komponen |
| Server | Menggunakan server Ubuntu yang sudah tersedia |
| Dokumen | Storage terpisah dari aplikasi |
| Database | PostgreSQL pada server Ubuntu yang sama |
| Redis/Queue | Pada server Ubuntu yang sama |
| Python services | Auto MTO dan Forecasting pada server Ubuntu yang sama |
| Web server | Nginx |
| PHP runtime | PHP-FPM |
| Process manager | Supervisor dan/atau systemd |
| External storage | NAS/storage server terpisah; NFS rekomendasi awal, belum final |

### Komponen pada server Ubuntu

- Nginx + HTTPS reverse proxy.
- React production build.
- Laravel API + PHP-FPM.
- PostgreSQL.
- Redis.
- Laravel Queue Workers.
- Laravel Reverb.
- Python Auto MTO.
- Python Forecasting.
- Laravel Scheduler.
- Supervisor/systemd.

### Target kapasitas perencanaan

- Target nyaman: 8 core/16 thread, RAM 32 GB, NVMe 500 GB untuk OS/aplikasi/database.
- External document storage: estimasi awal 2 TB.
- Backup storage: estimasi awal 4 TB atau hasil sizing berdasarkan pertumbuhan dan retensi.
- Ini estimasi, belum menjadi spesifikasi final. Inspeksi server yang tersedia wajib dilakukan sebelum konfigurasi.
- Concurrency Auto MTO harus dibatasi agar OCR/CAD tidak mengganggu API/database.
- GPU tidak wajib tahap awal.

### Pemeriksaan server

```bash
lsb_release -a
uname -a
lscpu
free -h
df -h
lsblk
top -b -n 1 | head -20
systemctl --type=service --state=running | grep -Ei 'nginx|apache|php|postgres|redis|supervisor|docker'
ip -br addr
ip route
```

## 4. Prinsip backup/DR

- Backup database dan dokumen pada lokasi terpisah.
- WAL archiving untuk mendukung point-in-time recovery dan target RPO 1 jam.
- Retensi: harian 30 hari, mingguan 12 minggu, bulanan 12 bulan.
- Target RTO 4 jam.
- Target RPO/RTO hanya dinyatakan tercapai setelah diuji dengan restore drill.

## 5. Catatan risiko single-server

Single-server adalah keputusan deployment awal, bukan jaminan high availability. Kegagalan server dapat menghentikan API, database, queue, Reverb, dan Python service sekaligus. Karena itu backup eksternal, monitoring, UPS/jaringan yang memadai, prosedur restore, dan pembatasan resource worker menjadi penting. Pemisahan service ke server lain dapat dilakukan pada tahap pertumbuhan tanpa mengubah prinsip modular dan API boundary.


## 6. Hasil inspeksi server aktual

Inventaris aktual dan rekomendasi resource dicatat pada [`19-SERVER-INVENTORY-AS-BUILT.md`](19-SERVER-INVENTORY-AS-BUILT.md). Server memiliki 4 core/4 thread dan sekitar 15 GiB RAM, di bawah target awal 8 core/16 thread dan 32 GB RAM. Karena itu kapasitas produksi belum dinyatakan tervalidasi.


### 6.1 Pemeriksaan runtime, jaringan, dan proses (5 November 2026)

- Node.js `v22.23.4`, npm `10.9.9`, PHP CLI `8.5.4`.
- Nginx listen pada port 80 dan `10.5.119.251:8081`; tidak terlihat listener port 443 pada snapshot.
- PostgreSQL `127.0.0.1:5432`, Redis `127.0.0.1:6379`.
- UFW aktif, default incoming deny; 22/80/443 terbuka global, XRDP dan 8081 dibatasi ke LAN `10.5.119.0/24`.
- Supervisor menjalankan dua worker dan satu Reverb untuk ANTRIAN-KU. Belum ada bukti program Supervisor DISTRIVA.
- Disk DATA `/dev/sda1` ter-mount, tetapi belum tercantum dalam `/etc/fstab`; persistensi reboot belum dijamin.
- Rincian observasi dan risiko: `19-SERVER-INVENTORY-AS-BUILT.md`.


## 7. Environment development lokal (5 November 2026)

Pengembangan DISTRIVA diputuskan dilakukan di PC lokal terlebih dahulu. Project belum dibuat di server Ubuntu agar tidak mengganggu ANTRIAN-KU dan Bimbel Reng Kraksaan. Deployment ke server dilakukan setelah implementasi dan pengujian lokal.

| Komponen lokal | Hasil terverifikasi |
|---|---|
| OS | Ubuntu 26.04.1 LTS (Resolute) |
| Node.js / npm | v22.22.3 / 10.9.8 |
| PHP CLI | 8.5.4 |
| Composer | 2.9.5, `/usr/bin/composer` |
| PostgreSQL client | 18.6 |
| Git | 2.53.0 |
| PHP extensions | `bcmath`, `zip`, `pdo_pgsql`, `pgsql`, serta ekstensi inti yang diperiksa tersedia |
| PostgreSQL cluster | 18/main online port 5432; 16/main port 5433 down |
| Laravel Installer | Belum tersedia; tidak wajib karena Composer dapat membuat project |

Database lokal `distriva_db` dengan role `distriva_user` telah dibuat dan koneksi diuji berhasil (`current_database`, `current_user`, dan versi PostgreSQL terverifikasi). Password tidak dicatat dalam dokumentasi. PostgreSQL 16 cluster dibiarkan tidak aktif dan tidak digunakan.

`composer diagnose` berhasil pada konektivitas Packagist/GitHub dan platform settings, tetapi memberi peringatan bahwa `installed.json` tidak ditemukan pada instalasi Composer non-standar. Ini belum menghalangi penggunaan Composer; lakukan pemeriksaan ulang bila muncul masalah instalasi dependency.

Belum dilakukan: pembuatan repository `~/Projects/DISTRIVA`, instalasi Laravel, instalasi React/Vite, pemasangan Sanctum/Spatie, pembuatan migrations, dan seeding.

## 8. T4.2 — Rancangan fondasi database

Keputusan desain awal yang sudah disepakati:
- `organizational_units` satu tabel hierarkis: UP3 tanpa parent, ULP memiliki parent UP3; UUID PK dan kode resmi PLN sebagai unique business key.
- `users.id` UUID; NIP opsional dan unique bila diisi; email unique. Status akun: `PENDING_ACTIVATION`, `ACTIVE`, `SUSPENDED`, `INACTIVE`.
- Role operasional wajib memiliki organizational unit; `SYS_ADMIN` boleh tanpa unit. User dapat memiliki beberapa role dan unit melalui `user_role_assignments`, dengan `valid_from`, `valid_until`, dan histori assignment.
- Katalog role terdiri dari 14 role yang telah disepakati; `KONSTRUKSI_ULP` tidak digunakan dan `ASMAN_TEKNIK` telah digantikan `ASMAN_KONSTRUKSI`; `ENGINEERING` tetap berbeda.
- Spatie Permission menangani role/permission; organizational scope dan masa berlaku tetap divalidasi oleh policy/service DISTRIVA.
- Rencana ID: UUID untuk entitas bisnis dan tabel assignment; BIGINT untuk tabel master `roles`/`permissions` Spatie. Jika `users` memakai UUID, pivot Spatie `model_has_roles` dan `model_has_permissions` harus dikonfigurasi agar `model_id` UUID. Jangan menjalankan migration pivot default yang mengasumsikan BIGINT.
- Tabel fondasi draft: `users`, `organizational_units`, `organizational_unit_histories`, tabel Spatie (`roles`, `permissions`, pivots), `user_role_assignments`, dan `personal_access_tokens` Sanctum.

Rancangan kolom dan migration masih perlu review pada T4.2/T4.4. Validasi parent UP3/ULP lintas baris, role wajib unit, penugasan yang overlap, dan histori immutable belum ditetapkan implementasinya (constraint/trigger/service). Contoh migration dalam percakapan belum dianggap migration final. Belum ada migration yang dibuat atau dijalankan.

## 9. Status storage server (5 November 2026)

Disk DATA server `/dev/sda1`, UUID `8d910585-b015-4a17-8e69-fd939c583d9f`, filesystem ext4 telah dikonfigurasi pada `/srv/distriva-data` melalui `/etc/fstab` dengan opsi `defaults,nofail 0 2`. `findmnt --verify --verbose` menghasilkan `Success, no errors or warnings detected`; `findmnt` dan `df` mengonfirmasi mount read-write, kapasitas filesystem 458 GB, tersedia sekitar 435 GB saat pemeriksaan. Uji file tulis/hapus berhasil. Uji reboot belum dilakukan.

Struktur `/srv/distriva-data/distriva/` telah dibuat: `documents/` (applications, survey, drawings, rab-kkf, feasibility, registration, payment, work-orders, construction, meter-installation, completion), `exports/`, `imports/`, `backups/`, `temp/`, `logs/`.

Group sistem `distriva` dibuat dan `www-data` ditambahkan sebagai anggota. Direktori aplikasi dimiliki `adminserver:distriva`; direktori documents/exports/imports/temp/logs memakai mode 2770 dan default ACL group; backups memakai mode 2750 tanpa ACL tambahan. Uji `sudo -u www-data touch` dan penghapusan file di documents berhasil. Proses PHP-FPM/worker yang sudah berjalan belum dibuktikan telah memuat supplementary group baru; belum ada aplikasi Laravel DISTRIVA untuk menguji integrasi storage. Backup masih berada pada disk lokal yang sama dan bukan pengganti backup off-site. Detail ada di `20-LOCAL-DEVELOPMENT-ENVIRONMENT-AS-BUILT.md` dan `21-STORAGE-SETUP-AS-BUILT.md`.


### 8.1 T4.2.1 — Fondasi organisasi dan akses (baseline implementasi v3.5.0)

**Status:** desain integrasi disetujui. Laravel 13.40.0, Sanctum 4.3.3, dan Spatie Permission 8.3.2 dipasang; migration/schema awal, model User/Role, RoleSeeder, dan unit tests tersedia. Migration up/down dan integrity smoke tests lulus terbatas pada PostgreSQL disposable; seluruh tabel aplikasi telah di-rollback.

- Satu tabel `organizational_units` untuk UP3/ULP; UP3 parent NULL, ULP parent UP3.
- `organizational_unit_histories` menyimpan perubahan kode/nama beserta alasan, aktor, dan waktu.
- `users.id` UUID; NIP nullable unique bila diisi; email unique; status akun empat nilai.
- 14 role final; hanya `SYS_ADMIN` boleh tanpa unit.
- `user_role_assignments` adalah sumber kebenaran tunggal role-user-unit dan masa berlaku.
- Spatie mengelola katalog role/permission dan `role_has_permissions`; `model_has_roles` tidak digunakan untuk assignment pengguna. Tidak menggunakan Spatie Teams.
- `ScopedAuthorizationService` membaca assignment hanya dari `user_role_assignments`; Spatie tetap catalog-only (`roles`, `permissions`, `role_has_permissions`) tanpa user pivots/Teams dan `register_permission_check_method=false`.
- Service memeriksa user ACTIVE, assignment aktif/tanggal inklusif pada `Asia/Jakarta`, role/permission guard `web`, unit aktif, konteks unit, SYS_ADMIN system-only, dan boundary vendor fail-closed. UP3 ke ULP hanya melalui mode read-only eksplisit.
- Policy belum dibuat dan belum ada route/domain action yang memanggil service. Assignment/unit write paths, audit atomic, cache invalidation, permission keys final, dan vendor-domain resolver juga belum dibuat.
- Migration mencakup append-only `user_role_assignment_histories` dan `authorization_change_histories`; histori organisasi pada `organizational_unit_histories`.
- Migration PostgreSQL menambahkan FK/check, trigger unit-parent dan role-scope, exclusion constraints assignment (scoped/global), lowercase email dan status/type checks. `btree_gist` harus tersedia sebelum migration.
- RoleSeeder memuat 14 role tanpa user/assignment/permission produksi dan mencatat perubahan metadata role pada authorization history.
- ERD fondasi diperbarui pada `06-ERD.md`; detail struktur dan constraint pada `05-DATABASE-DESIGN.md`; role/access pada `03-ROLES-AND-ACCESS.md`; keputusan dan isu terbuka pada `15-DECISIONS-AND-OPEN-ISSUES.md`.
- Review lengkap, migration/seeder order dan test matrix: `32-T4.2.1-DESIGN-REVIEW.md`.

**Validasi berhasil:** full suite 20/20 tests (30 assertions), termasuk 15 unit tests T4.2.1.1; route list, Composer validation, PHP syntax, Pint, service dependency resolution, PostgreSQL migration up/down sebelum perubahan ini, RoleSeeder dua kali (14 role dan 14 audit tanpa duplikasi), dan integrity smoke tests. T4.2.1.1 test menggunakan model/relasi in-memory dan tidak membuka koneksi database.

**Hasil dan batas:** migration/runtime T4.2.1 lama tetap PASS terbatas; semua 11 migration telah di-rollback. Tidak ada migration atau database runtime untuk T4.2.1.1. Query Eloquent `effectiveAssignments`, policy/route integration, PostgreSQL service integration, concurrency stress, Sanctum UUID end-to-end, assignment/audit write path, cache invalidation, permission keys T4.4, dan production target masih belum diverifikasi. Vendor relationship resolver sengaja menolak semua akses sampai schema domain tersedia.


### 8.2 T4.2.2 — Master data (FINAL PADA LEVEL DESAIN, 5 November 2026)

**Status:** selesai pada level desain database setelah tiga keputusan pengguna dikonfirmasi.

- Usulan tabel kategori/material ERP, satuan/konversi, KHS dan versinya, jenis konstruksi dan versinya, mapping KHS, BOM dan versinya, formula BOM terstruktur, staging sinkronisasi, log batch, dan change log.
- ERP tetap menjadi sumber kebenaran material; DISTRIVA tidak mengelola stok. Setiap SKU ERP adalah satu record material; varian harus dicocokkan dengan kode ERP.
- Formula BOM harus aman dan deterministik; tidak memakai `eval()`/kode bebas. KHS yang tidak cocok harus direview manual.
- Keputusan varian: satu varian material satu kode SKU ERP tersendiri; satu kode ERP = satu record `materials`. Daftar SKU aktual masih menunggu verifikasi ERP.
- Keputusan harga: BOTH — sumber eksternal dan master harga internal per UP3 melalui `material_prices`; setiap record membedakan jenis harga dan sumber. Calculation run menyimpan snapshot harga terpilih. Aturan prioritas dan approval perubahan harga internal masih terbuka.
- Keputusan approval: `UP3_MANAGER` menjadi approver utama versi master KHS dan BOM; versi approved immutable, perubahan melalui versi baru.
- Detail ada pada `23-T4.2.2-MASTER-DATA-SCHEMA.md`; dokumen master data `07-MASTER-DATA-AND-BOM.md`, database `05-DATABASE-DESIGN.md`, ERD `06-ERD.md`, dan keputusan `15-DECISIONS-AND-OPEN-ISSUES.md` telah diselaraskan.

**Belum selesai/terbuka:** kontrak API/file ERP dan autentikasi; daftar SKU aktual untuk semua varian; kode/master satuan ERP; formula lengkap dan basis BOM; aturan validitas temporal dan detail approval history; sumber eksternal spesifik dan aturan pemilihan harga untuk tiap komponen RAB. Tidak ada migration, seeder, import, atau sinkronisasi ERP yang telah dibuat. T4.2.3–T4.2.7 dan T4.3 masih menunggu.


## T4.2.3 — Database Permohonan PB/PD (v2.9)

**Status: rancangan konseptual diperbarui; belum final penuh dan belum diimplementasikan.**

- Rancangan mencakup customers, external customer references, applications, Bot Daftung import staging/batches, agenda/register references, external status history/mapping, payments, surveys/versions/measurements, status histories, serta reuse task/SLA T3.3.
- Kebijakan nomor telepon telah dikonfirmasi: boleh kosong saat staging, wajib dilengkapi NIAGA_RETAIL sebelum submit resmi.
- Contoh spreadsheet Bot Daftung telah dipetakan pada dokumen schema khusus.
- Kardinalitas utama telah dikonfirmasi: satu customer memiliki banyak applications; IDPEL adalah external reference customer; No. Register (`PAYMENT_REGISTER`) dan No. Agenda (`AGENDA`) adalah referensi per application. Nomor-nomor tersebut dapat belum tersedia pada awal permohonan.
- Isu terbuka tersisa: prosedur rekonsiliasi/merge saat konflik IDPEL, satuan daya aktual, kontrak API Bot Daftung, payment verification, status dictionary, definisi TMP, formulir survei, pause/resume SLA.
- Relasi utama customer–IDPEL–applications–register/agenda telah dikonfirmasi pada level desain konseptual; T4.2.3 masih perlu menutup isu integrasi, validasi data, dan aturan operasional sebelum final penuh.
- Belum ada Laravel migration, seeder, API connector, atau workflow code.


### Pembaruan T4.2.3 — sinkronisasi status Bot Daftung (v3.0)
**Keputusan terkonfirmasi:** untuk permohonan existing yang ditemukan melalui No. Agenda, jalur sinkronisasi hanya mengubah `DURASI_HARI_KERJA`, `STATUS_PERMOHONAN`, dan `TGL_UPDATE_PERMOHONAN`. Semua kolom customer/application lainnya dilindungi dari overwrite. Status eksternal terpisah dari workflow internal. Histori, timestamp sumber, dan waktu sinkronisasi dicatat; data stale/conflict tidak diterapkan otomatis.

**Belum diimplementasikan:** migration, API/file connector, job/queue, allowlist service, dan automated tests. Masih perlu kontrak Bot Daftung, format tanggal/timezone, status dictionary, validasi durasi, dan source ID untuk permohonan baru tanpa No. Agenda.

## Pembaruan T4.2.3 v3.1

Pola download Bot Daftung dikonfirmasi sebagai range-based snapshot dengan acuan tanggal permohonan pertama kali dibuat. File memuat data lama dan baru di rentang pilihan dan antar-batch dapat overlap. Metadata batch menyimpan `period_start`, `period_end`, `downloaded_at`, dan `imported_at`. Ketidakmunculan record tidak memicu penghapusan atau perubahan status. Aturan detail ada di `25-T4.2.3-BOT-DAFTUNG-SYNC-RULES.md`. Desain belum diimplementasikan.


## Pembaruan v3.2 — T4.2.4

| Item | Status | Catatan |
|---|---|---|
| T4.2.4 dokumen/versioning | DESAIN DIREVISI | Logical document + immutable versions, composite FK current pointer |
| Workflow review dokumen | DESAIN DIREVISI | Template/rules/stages, snapshot actor rules, assignments/comments, append-only snapshot/approval protections |
| Auto MTO | DESAIN DIREVISI | Package multi-file, per-file job/attempt/token/result/extraction |
| KHS/BOM integration | VALIDASI STRUKTURAL | Reuse T4.2.2; KHS version dan BOM item/header/formula harus konsisten |
| PB/PD integration | VALIDASI STRUKTURAL | Reuse `applications` T4.2.3 |
| PostgreSQL DDL | BASELINE DRAFT | Dokumen 27; belum dijalankan pada database |
| ERD gabungan | DIPERBARUI | Dokumen 06 |
| Migration Laravel | BELUM DIMULAI | Menunggu persetujuan desain v3.2 |

### Batas validasi
Validasi v3.2 dilakukan terhadap struktur dan keputusan tertulis T4.2.1–T4.2.3, bukan terhadap migration/database fisik. DDL memerlukan test execution pada PostgreSQL target, test trigger/constraint, serta review Laravel migration strategy sebelum implementasi.


## Pembaruan v3.2.1 — Audit statis T4.2.4 (5 November 2026)

- T4.2.4 DDL baseline direvisi untuk validasi sumber actor snapshot, konsistensi paket pada extraction, dan konsistensi paket pada item sources.
- Ditambahkan unique partial index untuk key rule aktif dalam satu template.
- Status: audit statis selesai; eksekusi pada PostgreSQL runtime belum dilakukan dari sesi ini karena tidak tersedia koneksi/executable PostgreSQL di lingkungan kerja.
- T4.2.1–T4.2.3 tetap diperlakukan sebagai dependency existing; DDL T4.2.4 tidak membuat ulang tabel dependency tersebut.
- Laravel migrations belum dimulai dan tetap menunggu persetujuan desain serta hasil uji runtime.


## Checkpoint v3.2.2 — PostgreSQL test fixture supplement (5 November 2026)

- T4.2.1/T4.2.2: dependency contract fixture disiapkan berdasarkan dokumen desain.
- T4.2.3: contract-minimal fixture disiapkan hanya untuk target FK T4.2.4; isu terbuka tidak dianggap selesai.
- T4.2.4: runner dan seed data sintetis disiapkan.
- PostgreSQL runtime: NOT RUN. Tidak ada klaim bahwa DDL telah lolos runtime.
- Migration Laravel: belum dimulai.


## Checkpoint v3.2.3 — T4.2.4 PostgreSQL runtime evidence (5 November 2026)

- DDL T4.2.4 berhasil dijalankan pada PostgreSQL 18.6 di database disposable `distriva_t424_test`.
- Dependency menggunakan contract-minimal fixtures T4.2.1–T4.2.3; bukan migration produksi dan bukan schema penuh upstream.
- Katalog: 53 tabel total (32 T4.2.4 + 21 fixture), 149 indeks total, 23 indeks eksplisit T4.2.4, 8 function, 10 trigger.
- Constraint target: 74 CHECK, 82 FK, 252 NOT NULL, 32 PK, 44 UNIQUE.
- Positive relational flow: PASS.
- Negative checks: 17/17 PASS dengan SQLSTATE aktual sesuai hasil evidence.
- Tiga concurrent uniqueness checks: PASS.
- Transaction rollback: PASS.
- Kasus previous_version_id lintas dokumen ditolak oleh trigger `trg_document_version_chain` (`P0001`) sebelum composite FK; test plan telah diselaraskan.
- Laravel policy, Python callback idempotency, queue retry/per-file recovery, dan integrasi dengan migration final T4.2.1–T4.2.3: NOT RUN.
- Kesimpulan: T4.2.4 DDL/constraint integration test PASS terbatas; bukan production migration approval.
- Migration Laravel: belum dimulai.


## Checkpoint v3.3.0 — T4.2.1 design review (5 November 2026)

- Review source aktual tidak menemukan aplikasi Laravel, `composer.json`, migration, seeder, atau test aplikasi pada workspace.
- T4.2.1 Opsi A tetap satu-satunya sumber assignment melalui `user_role_assignments`; Spatie ditetapkan pada proposal sebagai pengelola katalog role/permission dan `role_has_permissions` saja.
- Diusulkan untuk tidak membuat `model_has_roles`/`model_has_permissions`, menonaktifkan default permission resolver Spatie, dan menjalankan pemeriksaan izin melalui DISTRIVA service + Laravel Policies.
- Ditambahkan proposal tabel append-only `user_role_assignment_histories` dan `authorization_change_histories`, diperjelas vendor scope, ERD, validasi, migration/seeder order, dan test matrix.
- Persetujuan pemilik atas proposal diwajibkan sebelum implementasi migration; tidak ada migration/seeder/trigger yang dibuat atau dijalankan.
- Open issues tetap ada untuk versi package aktual, guard canonical, permission keys, `btree_gist` provisioning, kode organisasi, dan persetujuan proposal.
- Bukti T4.2.4 v3.2.3 tetap PASS terbatas hanya dengan contract-minimal fixtures; tidak menguji migration final T4.2.1.


## Checkpoint v3.4.0 — T4.2.1 implementation baseline (5 November 2026)

- Pemilik menyetujui desain/integrasi T4.2.1; versi Laravel 13.40.0, Sanctum 4.3.3, Spatie Permission 8.3.2, dan guard `web` dicatat.
- Migration schema awal mencakup UUID users/tokens, Spatie catalog-only, organisasi dan histori, scoped assignments/histori, authorization audit, serta checks/triggers/exclusion constraints PostgreSQL.
- User/Role models, RoleSeeder 14 role dengan audit event, dan tiga unit tests (8 assertions) ditambahkan.
- `php artisan test` lulus 5/5 (10 assertions), termasuk 3 test bootstrap (8 assertions); `route:list`, `composer validate --strict`, PHP syntax, dan Pint lulus.
- `pdo_sqlite` tidak tersedia; `artisan install:api` berhenti saat memeriksa tabel migration SQLite. Route API terdaftar.
- Semua 11 migration di-up lalu di-rollback pada target disposable yang disetujui; RoleSeeder dijalankan dua kali (14 role dan 14 audit records tanpa duplikasi). Integrity smoke tests berhasil; tabel aplikasi tidak tersisa, sementara extension `btree_gist` tetap terpasang.
- PostgreSQL concurrency stress, seeder behavior pada production deployment, Sanctum UUID end-to-end, policies/services, cache, dan permission keys belum selesai. Bukti: `test-evidence/2026-11-05-t421-runtime.md`.

## Checkpoint v3.5.0 — T4.2.1.1 ScopedAuthorizationService (5 November 2026)

- Menambahkan model `OrganizationalUnit` dan `UserRoleAssignment`, relasi assignment pada `User`/`Role`, context dan scope mode, `ScopedAuthorizationService`, serta vendor scope authorizer default deny.
- Assignment tetap hanya dibaca dari `user_role_assignments`; permission diperiksa melalui relasi katalog Spatie dengan guard canonical `web`.
- Default scope exact-unit; mode UP3 descendant hanya eksplisit read-only. SYS_ADMIN global terbatas pada system context. Vendor ditolak sampai relasi company/project/work-order tersedia.
- Full suite 20/20 (30 assertions), 15 unit tests authorization 15/15 (20 assertions); Pint, PHP syntax, service container resolution, route list, dan Composer validation PASS.
- Tidak ada migration atau database runtime untuk service baru. Query Eloquent terhadap PostgreSQL, Policy/route integration, vendor resolver, write/audit path, cache, concurrency, dan Sanctum UUID tetap NOT RUN.
- Dokumentasi v3.5.0 ditambahkan secara aditif ke repository tanpa ZIP baru. Detail: `docs/33-T4.2.1.1-SCOPED-AUTHORIZATION.md`; evidence: `test-evidence/2026-11-05-t4211-authorization.md`.

## Checkpoint v3.6.0 — T4.2.1.2 Policy/resource-scope design (5 November 2026)

- Matrix resource/ability/role/scope disetujui sebagai baseline desain saja; permission keys final, mapping katalog, seeder, Policy, dan query scope belum disetujui untuk implementasi.
- Audit source menemukan belum ada Policy/middleware authorization khusus, business resource model/controller/query scope, atau route bisnis. API hanya memiliki endpoint user Sanctum.
- Fondasi `user_role_assignments`, Spatie catalog-only, guard `web`, SAME_UNIT default, descendant-read eksplisit, SYS_ADMIN system-only, dan vendor deny-all dipertahankan.
- Dependency terbuka: domain resources belum tersedia; pemetaan Pengawas Jaringan, reviewer permohonan, dan approver final RKM belum ditentukan; vendor company/project/WO belum tersedia.
- Audit ini tidak mengubah source code, schema, atau database. Test tidak dijalankan pada checkpoint desain; hasil terakhir sebelumnya ialah full suite 20/20 tests (30 assertions), bukan hasil eksekusi ulang.
- Dokumen desain: `docs/34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md`; bukti review: `test-evidence/2026-11-05-t4212-design-audit.md`.

## Checkpoint v3.7.0 — T4.2.1.2A actor, approval, SoD, dan scope audit (5 November 2026)

- Mengoreksi status aktor: tidak ada role Pengawas baru; `KONSTRUKSI_UP3` dipilih untuk verifikasi progres/inspeksi WO ULP anak pada UP3 assignment melalui kemampuan khusus terbatas. Ini bukan `UP3_DESCENDANT_READ` dan belum diimplementasikan.
- Mencatat pilihan RKM: ULP mengusulkan; `PERENCANAAN` AND `KONSTRUKSI_UP3` memvalidasi oleh user berbeda; `UP3_MANAGER` final approver; submitter tidak final-approve versinya sendiri; RKM terpisah dari procurement.
- Menambahkan actor/approval/SoD/scope/candidate-permission matrices. Keputusan lanjutan: semua approver langkah AND harus user berbeda; submitter tidak final-approve versinya; progress submitter dan verifier berbeda; report memakai scope sumber dan export permission terpisah per domain.
- Memperbarui O-033–O-042. O-033/O-034 tetap terbuka; O-035 ditutup untuk pilihan role/scope; O-036/O-037 partial; O-040 ditutup untuk progress SoD; O-042 ditutup: semua pemegang assignment efektif `KONSTRUKSI_UP3` pada UP3 terkait dapat verify/inspect seluruh WO child-ULP.
- Audit source: hanya model organisasi/assignment dan authorization foundation tersedia. Tidak ada business model, Policy, query scope, middleware bisnis, controller/route domain; vendor authorizer tetap deny-all. Scope child-WO belum tersedia di service.
- Gate implementasi: **BLOCKED**. Tidak READY untuk permission catalog finalization atau Policy design.
- Static documentation/source audit saja; automated tests, migration dan database tidak dijalankan. Git status unavailable karena workspace tidak terdeteksi sebagai Git repository. Evidence: `test-evidence/2026-11-05-t4212a-actor-scope-audit.md`.
- Dokumentasi ditambahkan aditif sebagai v3.7.0; tidak ada ZIP baru, source code, konfigurasi, seeder, schema, atau database yang diubah.

### Koreksi integritas dokumentasi v3.7.1 (5 November 2026)

- Decision ID yang berbenturan lintas MDM, AUTH, dan PB/PD dipetakan ke namespace domain; referensi diperbarui tanpa mengubah isi keputusan yang telah disetujui.
- Status O-001–O-042 diaudit; issue parsial tetap terbuka dan issue yang ditutup memiliki dasar keputusan eksplisit. Blocker diberi alasan/dependency.
- Baseline desain v3.7.0 tetap historis dan addendum T4.2.1.2A tetap menjadi keputusan authorization terbaru. Permission keys/grants belum final; Policy, query scope, dan domain authorization belum diimplementasikan.
- Documentation-only validation; automated tests, source, migration, dan database tidak diubah atau dijalankan. Git status tetap unavailable karena workspace bukan repositori Git.

### O-034 resource model/lifecycle proposal audit v3.8.0 (5 November 2026)

- Dokumen 35 diaudit terhadap T4.2.1–T4.2.4, authorization design, decision register dan dokumen pendukung. Status desain tetap `PROPOSED`; O-034 tetap `OPEN/BLOCKING`.
- Audit menemukan area rekonsiliasi UOM, tabel konseptual lama, status/version authority, hash RKM, keputusan aktor/lifecycle, dan path aktual T4.2.4. Tidak ada keputusan APPROVED yang diubah.
- Laporan: `docs/36-O-034-DOCUMENTATION-AUDIT.md`; readiness: `docs/37-O-034-IMPLEMENTATION-READINESS.md`. O-036/O-038/O-039/O-041 dan O-033 tetap unresolved sesuai register.
- Dokumentasi saja; tidak ada source, migration, seeder, Policy, query scope, API, database, atau automated test yang diubah/dijalankan. Tidak ada ZIP.

### Analisis resolusi O-036/O-038/O-039/O-041 v3.9.0 (5 November 2026)

- Dokumen 38–43 memetakan fakta APPROVED, opsi PROPOSED, pertanyaan owner, relasi resource dan authorization boundary tanpa membuat keputusan bisnis baru.
- O-036 tetap PARTIAL/OPEN; O-038 OPEN; O-039 dan O-041 OPEN/BLOCKING. RKM final approver/validator, KKF approver matrix, vendor assignment actor, one-active-WO direction, progress SoD, child-WO verify/inspect scope, dan meter completion prerequisite dipertahankan.
- Reviewer aplikasi/RKM proposer role, survey/meter actors, WO create/review/issue approval/lifecycle detail, RAB/KKF runners/reviewers, dan feasibility relations belum final.
- O-034 tetap OPEN/BLOCKING; dokumen 35 tetap PROPOSED; implementation readiness BLOCKED. Tidak ada permission key/grant final atau persetujuan implementasi.
- Dokumentasi saja; source, migration, seeder, Policy, query scope, API, database tidak diubah; application tests tidak dijalankan; tidak ada ZIP.

### Integrasi Owner Decision Register v3.10.0 (5 November 2026)

- Mengaudit `docs/44-OWNER-DECISION-REGISTER.md` terhadap keputusan final, schema 22–26, authorization design, analisis 35–43, AI-HANDOFF, README dan manifest.
- Register masih DRAFT dan seluruh pilihan owner baru tetap PENDING; baseline terdahulu tidak berubah. Tiga penanda PENDING yang bertentangan dengan baseline WO/cardinality/scope/completion diluruskan tanpa mengubah substansi keputusan.
- D-018/D-021 dicatat sebagai keputusan historis yang superseded/expanded oleh keputusan yang lebih baru pada docs 08/16 dan D-MDM-001. O-033/O-034/O-036/O-038/O-039/O-041 tetap open sesuai status sebelumnya.
- Hasil audit: `docs/45-OWNER-DECISION-INTEGRATION-AUDIT.md`. Tidak ada source, database, migration, permission, atau workflow implementation yang diubah; application tests tidak dijalankan.

### Paket rekomendasi desain O-033/O-034/O-036/O-038/O-039/O-041 v3.11.0 (5 November 2026)

- Dokumen 34 section 10.10 menambahkan permission identifier/action/role/scope/SoD/export candidate matrix; tidak ada key final atau role grant.
- Dokumen 35 section 18 menambahkan proposed resource inventory, cardinality, lifecycle guard, FK/index/transaction contract; O-034 tetap `PROPOSED` dan `OPEN/BLOCKING`.
- Dokumen 38–41 memberi recommendation package konkret; dokumen 42 menyatukan alur lintas domain; dokumen 43 memetakan seluruh issue OPEN/PARTIAL O-001–O-041 beserta rekomendasi dan owner evidence.
- Dokumen 16 diklarifikasi secara aditif: harga eksternal-only dan approver KHS/BOM `ASMAN_KONSTRUKSI` adalah keputusan historis yang superseded oleh D-MDM-001/002 (harga BOTH; `UP3_MANAGER` approver KHS/BOM).
- Siap untuk owner review, bukan persetujuan implementasi. O-033/O-034/O-039/O-041 dan source-data/integration blockers tetap menghalangi implementasi sesuai scope.
- Documentation-only; tidak ada source, migration, database, seeder, Policy, query scope, API, atau test aplikasi yang diubah/dijalankan.

### Paket persetujuan keputusan owner v3.12.0 (5 November 2026)

- Dokumen 46 dibuat sebagai paket rapat: decision sheets O-039/O-029/O-036/O-038/O-041/O-033/O-034/O-037 dan decision docket bagi seluruh issue OPEN/PARTIAL lainnya.
- Rekomendasi, alternatif, dan OD IDs pada dokumen 46 belum disetujui. Register 44 tetap DRAFT/PENDING; tidak ada issue yang ditutup atau baseline approved yang diubah.
- Kesimpulan: `READY FOR OWNER REVIEW; IMPLEMENTATION BLOCKED`. Persetujuan harus melalui business process, technical design, database design, dan explicit implementation authorization untuk target bernama.
- Documentation-only. Tidak ada code/database/migration/seeder/Policy/query scope/API/frontend/production data yang diubah. Application tests tidak dijalankan; manifest diperbarui terpisah.

### Audit kesiapan implementasi v3.13.0 (5 November 2026)

- Status keseluruhan `BLOCKED`: kesiapan T4.2.1 foundation bukan kesiapan implementasi domain. O-029/O-033/O-034/O-036/O-037/O-038/O-039/O-041 dan/atau official evidence tetap unresolved; tidak ada scope-specific implementation authorization atau target database yang dikonfirmasi.
- Repository aktual: backend Laravel 13.40.0/Sanctum 4.3.3/Spatie 8.3.2; hanya dua route, tidak ada domain Policy/model/controller/request/migration; frontend, Python service dan deploy directories kosong. Tidak ada koneksi/database inspection.
- Menambah 2 route-level no-DB feature tests; suite 22/22 (33 assertions), Pint dan Composer validation PASS. Bearer-token database test terhalang `pdo_sqlite` yang tidak tersedia; PostgreSQL target belum diotorisasi.
- Laporan 47, remediation plan 48, test matrix 49, approval register 50. Konflik historis Pengawas Jaringan di docs 16 section 9 dicatat; tidak diubah tanpa klarifikasi berwenang.
- Tidak ada migration, seeder run, permission grant, Policy/query scope, domain code, database/production data, API workflow, frontend, atau Python service yang diubah. Manifest v3.13.0 divalidasi terpisah.

### Readiness re-audit backend v3.15.0 — 5 November 2026

- Seluruh 27 file wajib di `docs/` dan kedua file root wajib (Master Prompt dan manifest) tersedia. T4.2.1 tetap baseline implementation scope; dokumen 50 belum berisi otorisasi implementasi spesifik. O-033/O-034/O-039/O-041 tetap `OPEN/BLOCKING`; O-036 `PARTIAL/OPEN`; O-038 `OPEN`; dokumen 35 tetap `PROPOSED`.
- Pemeriksaan repository aktual menemukan hanya foundation T4.2.1 dan route `GET /api/user`; model bisnis, Policy, query scope, controller, dan route domain belum ada.
- `backend/.env` memilih SQLite dan port 3306, berbeda dari target PostgreSQL 18.6/5432. `distriva_backend_test` disebut sebagai test target tetapi belum diverifikasi keberadaan, akses, dan status disposable. Tidak ada database yang dihubungi; `distriva_db` tidak diperiksa.
- Safe local validation PASS: 22 tests/33 assertions dengan env SQLite in-memory (tanpa akses DB), `composer validate --strict --no-check-publish`, Pint, dan satu API route terdaftar. PDO SQLite tidak tersedia; bearer-token persisted E2E dan PostgreSQL integration belum terbukti. Evidence: `test-evidence/2026-11-05-backend-readiness-audit.md`.
- Readiness keseluruhan tetap `BLOCKED`; tidak ada keputusan owner, permission grant, migration/domain implementation, atau database authorization baru.
