# 20 — Environment Development Lokal (As-Built)

**Tanggal pencatatan:** 5 November 2026  
**Sumber:** output terminal PC lokal yang diberikan pengguna.  
**Status:** runtime dan PostgreSQL dasar terverifikasi; backend Laravel tersedia. Migration T4.2.1 dan RoleSeeder telah diuji pada target disposable, lalu semua migration di-rollback.

## 1. Strategi pengembangan

Keputusan: DISTRIVA dikembangkan di PC lokal terlebih dahulu. Setelah implementasi, pengujian, dan validasi siap, barulah aplikasi dimigrasikan/deploy ke server Ubuntu. Server saat ini tetap menjalankan aplikasi lain dan tidak digunakan untuk membuat project DISTRIVA pada tahap ini.

Struktur workspace yang tersedia:

```text
DISTRIVA/
├── backend/
├── docs/
├── database/testing/postgresql/
├── test-evidence/
└── README.md
```

Frontend React/Vite dan deployment project belum dibuat.

## 2. Runtime lokal terverifikasi

| Komponen | Versi/status |
|---|---|
| OS | Ubuntu 26.04.1 LTS, codename resolute |
| Node.js | v22.22.3 |
| npm | 10.9.8 |
| PHP CLI | 8.5.4 NTS |
| Composer | 2.9.5, `/usr/bin/composer` |
| PostgreSQL client | 18.6 |
| Git | 2.53.0 |
| Laravel Installer | `laravel` command belum tersedia; tidak wajib |

### 2.1 Ekstensi PHP

Pemeriksaan awal menunjukkan `bcmath` dan `zip` belum tersedia; keduanya kemudian dipasang dan diverifikasi `OK`. `pdo_pgsql` dan `pgsql` tersedia. `pdo_sqlite` tidak tersedia, sehingga perintah `install:api` tidak dapat menyelesaikan pemeriksaan tabel migration SQLite. Ekstensi lain yang diperiksa dan tersedia: `ctype`, `curl`, `dom`, `fileinfo`, `filter`, `mbstring`, `openssl`, `pdo`, `session`, `tokenizer`, `xml`, `gd`, `intl`.

### 2.2 Backend Laravel

| Komponen | Versi/status |
|---|---|
| Laravel Framework | 13.40.0 |
| Laravel Sanctum | 4.3.3 |
| Spatie Laravel Permission | 8.3.2 |
| Guard katalog | `web` |
| Composer manifest/lock | tersedia di `backend/` |
| API route | `GET /api/user` terdaftar |
| Frontend | belum dibuat |

Full Laravel test suite lulus 5/5 (10 assertions), termasuk 3 test bootstrap T4.2.1 (8 assertions). `composer validate --strict`, `php artisan route:list`, Pint, dan PHP syntax lulus. Ini belum memvalidasi koneksi atau migration PostgreSQL.

### 2.2 Composer

`composer diagnose` menunjukkan konektivitas Packagist dan GitHub OK, platform settings OK, tetapi memberi warning `Could not find Composer's installed.json, this must be a non-standard Composer installation.`. Binary berada di `/usr/bin/composer`. Warning tersebut belum menunjukkan kegagalan penggunaan Composer, namun perlu dicatat bila ada masalah saat install dependency.

## 3. PostgreSQL lokal

Output `pg_lsclusters`:

```text
16  main  5433  down
18  main  5432  online
```

PostgreSQL 18.6 terverifikasi menerima koneksi. Query `SELECT version()` berhasil. Cluster PostgreSQL 16 dibiarkan down dan tidak dipakai DISTRIVA.

Database dan role development telah dibuat:

| Parameter | Nilai |
|---|---|
| Database | `distriva_db` |
| Role/login | `distriva_user` |
| Engine | PostgreSQL 18.6 |
| Port | 5432 |
| Encoding | UTF8 (ditetapkan saat pembuatan database) |

Koneksi berhasil diverifikasi dengan `current_database() = distriva_db` dan `current_user = distriva_user`. Password tidak dicatat di dokumentasi.

Konfigurasi `.env` backend yang direncanakan:

```env
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=distriva_db
DB_USERNAME=distriva_user
DB_PASSWORD=ISI_PASSWORD_LOKAL
```

Jangan commit `.env` ke Git.

## 4. Status database setelah uji T4.2.1

- Semua 11 migration pada `distriva_db` telah diterapkan dan di-rollback setelah pengujian; database kini hanya memiliki tabel Laravel `migrations` yang kosong.
- RoleSeeder dijalankan dua kali dan menghasilkan 14 role serta 14 audit records tanpa duplikasi.
- `btree_gist` dipasang pada `distriva_db` setelah persetujuan eksplisit pengguna dan tetap terpasang setelah rollback.
- Integrity smoke tests pada constraint/trigger berhasil; concurrency stress test dan Sanctum UUID end-to-end belum dilakukan.

## 5. Belum dilakukan

- Membuat React/Vite frontend.
- Membuat tabel bisnis permanen atau mengisi data master.
- Membuat Laravel Policies, assignment/unit write services, dan assignment/audit write paths.
- Menguji query authorization service melalui PostgreSQL, concurrency, Sanctum token UUID end-to-end, dan cache invalidation.

## 6. Langkah berikutnya

1. Implementasikan Policies dan write paths di atas fondasi `ScopedAuthorizationService`; finalkan permission keys pada T4.4.
2. Tambahkan test concurrency serta Sanctum UUID end-to-end.
3. Buat React + Vite frontend setelah kontrak API dan struktur backend disiapkan.
