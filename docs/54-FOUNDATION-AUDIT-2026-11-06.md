# DISTRIVA — Audit Awal Foundation Auth + Assignment

**Tanggal audit:** 6 November 2026  
**Basis pemeriksaan:** `DISTRIVA-full-source-v3.16.0-reorganized.zip`  
**Jenis pemeriksaan:** inspeksi statis source code, struktur repository, konfigurasi, test, dan evidence yang disertakan.  
**Bukan:** pengujian runtime baru, koneksi ke database lokal pengguna, atau audit production.

## 1. Ringkasan

Repository sudah memiliki fondasi backend Laravel dan frontend React untuk autentikasi dasar. Beberapa layanan tulis untuk assignment, status akun, dan organizational unit juga sudah tersedia. Namun, fondasi ini belum boleh dianggap sebagai modul administrasi pengguna yang lengkap: endpoint manajemen assignment/unit/status belum tersedia, authorization Policy/permission grant belum terpasang, dan bukti browser E2E belum tersedia.

**Kesimpulan:** lanjutkan hardening dan verifikasi Foundation Auth + Assignment. Jangan mulai Master Data sebelum acceptance criteria fondasi terpenuhi. Pekerjaan yang bergantung pada O-033 (permission catalog/grants) tetap ditahan, tetapi pengujian dan perbaikan autentikasi yang independen dapat dilanjutkan.

## 2. Struktur dan teknologi terdeteksi

| Area | Kondisi pada ZIP |
|---|---|
| Backend | Laravel 13, PHP requirement `^8.3` |
| Authentication | Laravel Sanctum 4 |
| Role/permission package | Spatie Laravel Permission 8 |
| Database target desain | PostgreSQL |
| Frontend | React 19, React Router 7, Vite 8, Tailwind 4 |
| Backend migrations | 11 file migration |
| Backend test annotations | 64 atribut `#[Test]` terdeteksi secara statis |
| Frontend test | 8 test pada `App.test.jsx` |
| Business domain routes/models | Belum ditemukan pada snapshot ini |
| Python services | Tidak ditemukan pada snapshot ini |

Dependensi runtime (`backend/vendor` dan `frontend/node_modules`) tidak disertakan dalam ZIP. Karena itu test tidak dijalankan ulang dalam audit ini.

## 3. Komponen yang sudah tersedia

### 3.1 Backend authentication

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `POST /api/me/password`
- `EnsureActiveAccount` middleware untuk grup route yang memuat logout, me, dan change password.
- Login throttling dan change-password throttling.
- Email dinormalisasi menjadi lowercase.
- Token Sanctum memiliki `expires_at` berdasarkan konfigurasi idle timeout 30 menit.
- Password minimum dikonfigurasi 8 karakter.
- Pergantian password menghapus token lain dan mempertahankan token aktif.

### 3.2 Backend authorization foundation

- Model `User`, `Role`, `OrganizationalUnit`, `UserRoleAssignment`.
- `ScopedAuthorizationService` dan explicit authorization context.
- Vendor authorizer masih fail-closed.
- `AssignmentWriteService` menulis assignment dan history dalam satu transaksi, memvalidasi reason, serta memicu event setelah commit.
- `AccountStatusService` mengubah status akun, menulis history, dan mencabut token ketika status bukan ACTIVE.
- `OrganizationalUnitWriteService` membuat/memperbarui unit dan menulis history; code/type/parent tidak dapat diubah melalui service.
- Model User tidak menggunakan Spatie user-role pivot; assignment terpisah menjadi sumber relasi penugasan.

### 3.3 Frontend authentication

- `AuthContext` untuk memulihkan session, login, logout, dan status autentikasi.
- Token disimpan di `sessionStorage`, bukan `localStorage`. **Login bersama antar tab (16 Nov 2026):** token tetap di `sessionStorage` per tab; tab baru yang belum punya token memintanya lewat BroadcastChannel (`frontend/src/features/auth/tabSession.js`) dari tab DISTRIVA lain yang sudah login, hanya selama minimal satu tab masih terbuka (setelah semua tab ditutup, login hilang). Jawaban hanya diberikan kepada permintaan yang sedang menunggu (nonce), BroadcastChannel hanya menjangkau origin yang sama, dan logout di satu tab mengeluarkan tab lain. Tidak ada token di `localStorage`.
- API client menambahkan Bearer token dan menghapus sesi lokal ketika request bertoken menerima 401.
- Halaman Login, Profil, Ubah Password, Home, dan layout terlindungi tersedia.
- Pengujian frontend menggunakan mocked fetch; bukan browser E2E terhadap server Laravel.

## 4. Temuan dan gap yang perlu ditangani

| ID | Temuan | Dampak | Prioritas |
|---|---|---|---|
| FND-01 | `GET /api/user` hanya memakai `auth:sanctum`, tidak memakai `EnsureActiveAccount`, sedangkan route `/api/me` memakai middleware tersebut. | Perlu dipastikan akun non-ACTIVE tidak dapat menggunakan endpoint alternatif ini. | P0 |
| FND-02 | `AssignmentWriteService`, `AccountStatusService`, dan `OrganizationalUnitWriteService` belum memiliki HTTP management endpoints. | Layanan tersedia, tetapi belum menjadi alur administrasi yang dapat digunakan UI. | P1 |
| FND-03 | Komentar pada service menyatakan caller wajib melakukan authorization terlebih dahulu; belum ada Policy/middleware authorization yang mengikat caller untuk operasi tulis. | Jangan membuat endpoint yang memanggil service tanpa authorization yang teruji. | P0 untuk endpoint tulis |
| FND-04 | O-033 permission identifiers/grants belum final pada baseline dokumentasi historis. | Endpoint administrasi assignment/status/unit yang memerlukan permission spesifik tetap ditahan sampai kontrak authorization diputuskan. | P1 |
| FND-05 | Frontend belum memiliki halaman administrasi pengguna, assignment, status akun, atau organizational unit. | Scope UI Foundation baru mencakup auth shell. | P2 |
| FND-06 | Belum ada browser-driven E2E login flow terhadap Laravel + React dalam evidence. | Integrasi browser sesungguhnya belum terverifikasi. | P1 |
| FND-07 | Tidak ada `vendor/` dan `node_modules/` pada ZIP; environment lokal runtime tidak dapat diverifikasi dari arsip. | Test perlu dijalankan di workspace pengguna setelah dependensi tersedia. | P0 verifikasi |
| FND-08 | README menyebut snapshot dokumentasi v3.15.0 sedangkan dokumen 53 menyebut versi 3.16.0. | Metadata dokumentasi tidak konsisten. | P2 |
| FND-09 | Endpoint `/api/user` adalah route skeleton Laravel terpisah dari kontrak `AuthController::me`. | Ada dua bentuk endpoint profil yang berpotensi berbeda payload dan middleware. | P1 |

## 5. Evidence yang sudah disertakan dalam ZIP (historis)

Evidence file menyatakan:

- Phase 1: 22 backend tests / 33 assertions pada konteks saat itu, Pint PASS, Composer validate PASS; audit mencatat database test belum tersedia pada checkpoint tersebut.
- Phase 2: PostgreSQL foundation test suite 45 tests / 111 assertions pada `distriva_backend_test`, termasuk constraint, trigger, authorization query, Sanctum bearer, dan concurrency.
- Phase 2B: full suite 61 tests / 186 assertions pada `distriva_backend_test`; `AssignmentWriteService`, `AccountStatusService`, `OrganizationalUnitWriteService`, dan change-password API ditambahkan/diuji.
- Frontend auth: 8/8 Vitest PASS dan build PASS menurut evidence.
- E2E smoke: curl/live HTTP login, `/me`, change password, logout, token revocation PASS menurut evidence.

Angka di atas adalah catatan evidence yang dikirim di dalam ZIP, bukan hasil eksekusi ulang pada audit ini. File test saat ini memiliki 64 deklarasi `#[Test]` yang terdeteksi statis; angka test yang benar harus diambil dari output aktual saat agent menjalankan suite.

## 6. Environment dan database safety

- `backend/phpunit.xml` memaksa koneksi `pgsql` ke database `distriva_backend_test`.
- `PostgresTestCase` menolak test jika koneksi bukan PostgreSQL atau database bukan `distriva_backend_test`.
- `config/distriva.php` mencantumkan `distriva_backend_test` sebagai disposable database untuk destructive Artisan commands.
- `distriva_db` adalah database development utama dan tidak boleh dipakai oleh test yang menggunakan `RefreshDatabase` atau perintah destruktif.
- ZIP tidak membawa `.env` aktif, sehingga target koneksi lokal saat ini belum diverifikasi.
- Jangan menjalankan `migrate:fresh`, `db:wipe`, `schema:drop`, atau reset apa pun pada `distriva_db`.

## 7. Urutan pekerjaan yang direkomendasikan

1. Periksa ulang environment, dependency, Git status, `.env` (tanpa menampilkan secret), dan identitas database aktif.
2. Jalankan baseline frontend tests/build dan backend non-destructive checks; backend DB tests hanya jika target `distriva_backend_test` diverifikasi.
3. Tambahkan regression test untuk FND-01, kemudian lindungi atau hapus route `/api/user` agar tidak melewati pemeriksaan akun aktif dan kontrak `/api/me`.
4. Audit idle timeout, throttling, login failure, account status, password change, logout/token revocation, dan profile payload.
5. Audit service-level assignment/status/unit invariants, audit history, transaction atomicity, event-after-commit, and concurrency.
6. Jangan membuat HTTP write endpoints sampai permission contract/caller authorization jelas. Buat proposal kontrak yang minimal bila diperlukan, lalu catat keputusan proyek.
7. Setelah backend contract stabil, lakukan browser E2E frontend terhadap backend test.
8. Perbarui AI handoff dan test evidence dengan output aktual; jangan menyalin angka lama sebagai hasil baru.

## 8. Acceptance criteria Foundation

Foundation baru dapat dinyatakan VERIFIED bila:

- Semua route autentikasi memiliki middleware konsisten dan tidak ada jalur bypass untuk akun non-ACTIVE.
- Login/logout/me/change-password berjalan melalui API nyata.
- Token expiry/idle refresh dan revocation teruji.
- Assignment/status/unit services mempertahankan transactional history dan aturan integritas.
- Tidak ada endpoint tulis yang dapat dipanggil tanpa authorization server-side.
- Backend test suite lulus pada database test khusus.
- Frontend test/build lulus dan browser E2E utama lulus.
- Tidak ada perubahan tak disengaja pada `distriva_db`.
- Dokumen status dan evidence diperbarui secara akurat.

## 9. Batas audit

Audit ini bersifat statis pada isi ZIP. Tidak ada koneksi database, migration, seeder, test runtime, browser, atau source code yang dijalankan/diubah selama pemeriksaan ini.
