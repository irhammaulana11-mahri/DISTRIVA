# 55 — Foundation Administration: Implementation Status

**Tanggal:** 6 November 2026 · **Dasar keputusan:** `docs/54` §6a (D-1…D-8 DECIDED) · **Status:** `TESTED` — backend 230 tests / 911 assertions (PostgreSQL `distriva_backend_test`), frontend 38 Vitest tests, browser E2E 27/27 (OTP activation/recovery with real SMTP/HTTP sinks). Migrasi `2026_11_06_120000_create_otp_challenges_table` **belum diterapkan ke `distriva_db`**. Belum `VERIFIED` penuh: belum ada MFA, belum ada admin pertama di `distriva_db`, belum ada pengirim email/WhatsApp.

## Endpoint pendukung UI (ditambahkan 6 Nov 2026)
`GET /api/admin/access` (kemampuan pengguna per key; tidak pernah 403), `GET /api/admin/roles` (butuh `role_assignments.assign`; UP3_ADMIN tidak melihat `SYS_ADMIN`/`VENDOR`), `GET /api/admin/users/{id}` (scope; di luar scope → 404). Hanya petunjuk untuk UI; setiap aksi tetap diotorisasi ulang server.

## Pembuatan pengguna, aktivasi dan pemulihan (keputusan 6 Nov 2026, docs/18)
Administrator menambah pengguna lewat web; **pengguna mengaktifkan akunnya sendiri dengan OTP** (email/WhatsApp). Tidak ada password sementara; administrator tidak pernah menerbitkan atau mengetahui password.
| Endpoint | Akses | Perilaku |
|---|---|---|
| `POST /api/admin/users` | `users.create` (+ aturan `role_assignments.assign` pada unit tujuan) | Membuat pengguna **dan** penugasan pertama dalam satu transaksi. Akun berstatus `PENDING_ACTIVATION` dengan hash acak yang tidak dapat dipakai. Mengirim **undangan** (tanpa password/kode) ke semua kanal tersedia; kegagalan pengiriman **tidak** membatalkan pembuatan dan dilaporkan di `delivery` (UI memberi peringatan jelas). |
| `POST /api/admin/users/{id}/resend-invitation` | `users.create` | Kirim ulang undangan untuk akun `PENDING_ACTIVATION` (409 bila sudah aktif; self dan di luar scope ditolak); body: reason; audit `USER_INVITATION_SENT`. |
| `POST /api/auth/otp/request` | publik, throttle `otp-request` | Body `email`, `purpose` (`activation`\|`recovery`). Jawaban **selalu sama** (202) untuk akun ada/tidak ada/tidak memenuhi syarat/jeda kirim ulang; 429 bila >5 permintaan/jam per alamat (menghitung juga alamat yang tidak ada). Kode dikirim **setelah respons** (`defer`) agar waktu respons tidak membocorkan keberadaan akun. |
| `POST /api/auth/otp/verify` | publik, throttle `otp-verify` | Body `email`, `purpose`, `otp` (6 digit), `password`, `password_confirmation`. Kode salah/kedaluwarsa/terpakai/tidak ada/akun tidak memenuhi syarat → **satu jawaban** 422 "Kode OTP salah atau sudah kedaluwarsa". Hanya bila kode benar, password diperiksa kebijakan (semua pelanggaran dikembalikan, kode tidak hangus dan tidak dihitung sebagai tebakan). |
Aturan OTP: 6 digit acak; hanya HMAC-SHA256 (dikunci dengan `APP_KEY` + id tantangan) yang disimpan; berlaku 10 menit; 5 tebakan salah membatalkan kode; satu kode aktif per pengguna dan tujuan (indeks unik parsial di database); permintaan baru membatalkan kode lama; jeda kirim ulang 60 detik; tujuan `activation` hanya untuk `PENDING_ACTIVATION`, `recovery` hanya untuk `ACTIVE` (akun `SUSPENDED`/`INACTIVE` adalah keputusan administrator). Keberhasilan: password diset (kebijakan docs/16 + riwayat 5), status `ACTIVE`, penghitung/penguncian login dihapus (**membuka akun terkunci seketika**, termasuk pembatas laju login alamat itu), **semua token dicabut**, audit `USER_ACTIVATED` / `USER_PASSWORD_RECOVERED`. Tabel `otp_challenges` dibersihkan harian (>7 hari).
UI: halaman publik `/aktivasi` dan `/pemulihan` (tautan di halaman login), form admin tanpa kolom password, ringkasan pengiriman undangan per kanal, tombol "Kirim ulang undangan aktivasi…" hanya untuk akun menunggu aktivasi.
Pengecualian: admin pertama dari `distriva:bootstrap-admin` memakai password dari konsol (belum ada kanal/akun untuk OTP).
Batasan: bila tidak ada kanal yang dapat mengirim, undangan/OTP tidak sampai dan pengguna tidak dapat aktivasi sampai kanal siap (pengguna tetap tersimpan); belum ada CAPTCHA/MFA.

## Endpoint (prefix `/api/admin`, bearer + akun ACTIVE + grant + scope)
| Endpoint | Key | Perilaku |
|---|---|---|
| `GET /organizational-units` | `organizational_units.view` | UP3_ADMIN: UP3-nya + ULP anak; SYS_ADMIN: semua. Scope sebelum paginate/count. |
| `GET /users` | `users.view` | User yang punya assignment di unit dalam scope. Filter `status`, `search` (wildcard di-escape), `unit_id` (di luar scope → 404), `per_page` ≤ 100. |
| `GET /users/{id}/assignments` | `role_assignments.view` | Hanya baris di unit dalam scope; user tak terlihat → 404. |
| `POST /role-assignments` | `role_assignments.assign` | Body: user_id, role_id, organizational_unit_id, valid_from, valid_until?, reason, assignment_document (wajib). |
| `POST /role-assignments/{id}/end` | `role_assignments.end` | Body: reason. |
| `POST /users/{id}/status` | `users.change_status` | Body: status, reason. |

Kode status: 401 tanpa token; 403 tanpa grant / dilarang aturan; 404 di luar scope atau tidak ada (tanpa membocorkan keberadaan); 409 pelanggaran aturan domain (overlap, admin terakhir, sudah diakhiri); 422 validasi. **Cek grant dilakukan sebelum validasi** agar pemanggil tanpa hak tidak bisa menebak ID.

## Aturan yang ditegakkan (docs/54 §4)
Unit target dari data tersimpan; UP3_ADMIN tidak boleh memberi `SYS_ADMIN`/`VENDOR`; `UP3_ADMIN` hanya pada unit UP3; tidak boleh mengubah penugasan/status diri sendiri; status user hanya bila SEMUA assignment-nya berada dalam scope dan tidak ada role sistem; UP3_ADMIN terakhir (aktif, efektif) per unit tidak boleh diakhiri/dinonaktifkan (D-8); dokumen penugasan wajib; alasan wajib; aksi tulis `SYS_ADMIN` tertutup sampai MFA (`distriva.system_writes_require_mfa`, default true).

## Komponen
`config/distriva_permissions.php` (katalog + grant disetujui) · `FoundationPermissionSeeder` (idempoten, menulis `authorization_change_histories`) · `AuthorizationScopeMode::UP3_ADMIN_DELEGATION` (hanya key admin, hanya role UP3_ADMIN, tulis diizinkan—berbeda dari descendant-read) · `AdministrationAuthorizer` · `Admin\AdminController` · exception render di `bootstrap/app.php`.

## Bootstrap admin pertama (selesai)
`php artisan distriva:bootstrap-admin --role=UP3_ADMIN --email=… --name=… --unit-code=… --unit-name=…` (atau `--role=SYS_ADMIN` tanpa opsi unit). Membuat akun ACTIVE dengan password sementara acak yang memenuhi policy (ditampilkan sekali di konsol, tidak disimpan/di-log, `must_change_password=true`), UP3 pertama, dan penugasan — semua lewat service ber-audit dalam satu transaksi (actor audit = akun baru itu sendiri, dokumen `BOOTSTRAP-CONSOLE`). Menolak bila role sudah punya penugasan apa pun, bila email/kode unit sudah ada, bila role belum di-seed, atau input tidak valid. Meminta konfirmasi (menampilkan nama database) kecuali `--force`. Kedaluwarsa 24 jam password awal (docs/54 G-5) belum ada.
**Perintah ini belum dijalankan pada `distriva_db`** — membutuhkan identitas admin yang sebenarnya (email, nama, kode/nama UP3).

## UI admin (frontend)
Menu "Pengguna" dan "Unit organisasi" muncul hanya jika `/admin/access` menyatakan boleh; URL langsung tanpa hak menampilkan "Halaman tidak ditemukan" dan API tetap 403. Halaman: daftar pengguna (cari, filter status, paginasi sisi server, state loading/kosong/error), detail pengguna (penugasan, akhiri penugasan dengan dialog alasan wajib, ubah status dengan dialog alasan, form tambah penugasan dengan error per field dari server), daftar unit. Kontrol tulis disembunyikan bila `can_write` false (mis. SYS_ADMIN selama MFA belum ada). Celah desain yang dicatat: pengguna tanpa penugasan tidak terlihat oleh UP3_ADMIN, sehingga staf baru/pindahan dari UP3 lain belum bisa dicari untuk ditugaskan — menunggu `users.create` dan keputusan pencarian lintas UP3.

## Belum dibuat (sengaja)
`users.update`, endpoint tulis unit organisasi, `authorization_history.view` — tidak diseed/diberi grant karena belum punya endpoint (menunggu password awal & kanal D-7; unit tulis menunggu MFA). MFA, CAPTCHA, OTP recovery, pengirim email/WhatsApp (D-7: kedua kanal, penyedia belum dipilih). UI admin di frontend.

## Masalah bootstrap (SELESAI dengan perintah konsol di atas; teks asli dipertahankan)
D-3 menetapkan assignment `SYS_ADMIN`/`UP3_ADMIN` pertama hanya oleh `SYS_ADMIN` setelah MFA. Selama MFA belum ada, **tidak ada jalur API** untuk membuat admin pertama pada `distriva_db`. Perlu jalur terkontrol (mis. perintah Artisan satu kali) atau menyelesaikan MFA lebih dulu.

## Operasional database (6 Nov 2026)
- `distriva_db` ternyata sudah memiliki 11 tabel fondasi (kosong) yang dimigrate di luar sesi ini. Backup `pg_dump -Fc` disimpan di `~/distriva-backups/` (`distriva_db_pre-migrate_*.dump`, 60 KB), restore diuji ke database sementara `distriva_restore_check` (18 tabel, 9 trigger, 2 exclusion constraint, 11 migrasi — identik), lalu database sementara dihapus.
- Seed `FoundationPermissionSeeder` dijalankan pada `distriva_db` (setelah backup `distriva_db_pre-seed_*.dump`): 14 role, 6 permission, 12 grant (hanya UP3_ADMIN dan SYS_ADMIN), 32 baris audit; dijalankan ulang → tidak ada perubahan (idempoten). Belum ada user/unit.
- **6 Nov 2026 (persetujuan pemilik):** backup `distriva_db_pre-110000_*.dump` (65 KB) diuji restore ke database sementara (19 tabel, 1 user, 1 unit, 1 penugasan, 13 migrasi, 9 trigger — identik; database sementara dihapus) → `php artisan migrate`: `2026_11_06_110000_add_temporary_password_expiry` DONE (kolom `users.password_expires_at`, CHECK audit diperluas) → `FoundationPermissionSeeder`: permissions 6→7 (`users.create`), grants 12→14, `authorization_change_histories` 32→35; seeder dijalankan ulang → tidak berubah. Akun admin (Irham Maulana) tidak berubah: ACTIVE, `must_change_password=true`, tanpa kedaluwarsa. Tidak ada migrasi pending.
- `php artisan migrate` dijalankan pada `distriva_db`: `2026_11_06_090000_add_login_lockout_to_users_table`, `2026_11_06_100000_create_password_histories_table` (keduanya DONE). Tidak ada seeder yang dijalankan di `distriva_db`.
- Rollback: `php artisan migrate:rollback --step=2` (guard menolaknya di `distriva_db`; lakukan manual dengan `--database` yang diizinkan atau pulihkan dump: `pg_restore --clean --if-exists -d distriva_db <dump>`). Karena tabel kosong, pemulihan dari dump tidak kehilangan data.

## Menjalankan aplikasi secara lokal (catatan operasional)
1. Backend: `cd backend && php artisan serve` — **perhatikan port yang dicetak.** Bila 8000 sudah dipakai proses lain, Laravel diam-diam pindah ke 8001, 8002, ….
2. Frontend: `cd frontend && npm run dev` (http://localhost:5173). Alamat backend untuk proxy `/api` dibaca dari `frontend/.env.local` (`VITE_API_PROXY=http://127.0.0.1:<port-backend>`; contoh di `frontend/.env.example`). Vite restart sendiri bila berkas ini diubah.
3. Gejala salah port: halaman login menolak/`404`/`400` teks polos (bukan JSON) dan akun tidak mencatat percobaan login. Uji cepat: `curl -i http://127.0.0.1:5173/api/me` harus menjawab `401 {"message":"Unauthenticated."}`.
