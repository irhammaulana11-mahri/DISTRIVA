# AI HANDOFF — DISTRIVA

**Checkpoint dokumentasi:** 6 November 2026  
**Source package:** `DISTRIVA-full-source(1).zip`  
**Source documentation baseline:** v3.15.0  
**Documentation reorganization:** v3.16.0  
**Jenis perubahan:** dokumentasi saja; source code dan database tidak diubah.


## Checkpoint Foundation Auth + Assignment — 6 November 2026

- Status: `TESTED` (backend 73 tests/222 assertions pada PostgreSQL `distriva_backend_test`; frontend 8 Vitest + build; browser E2E 14/14 pada Chrome). Bukan `VERIFIED` penuh: lihat gap di bawah.
- Perubahan: `GET /api/user` dihapus; semua service tulis menolak actor non-ACTIVE; `sanctum:prune-expired` dijadwalkan; token idle timeout 30 menit; password min 8 (keputusan proyek, doc 15).
- `distriva_db` hanya berisi tabel `migrations` dan tidak diubah. Folder `backend/bootstrap/cache` hilang saat sync dan dibuat ulang (kosong, aman).
- Gap: endpoint administrasi assignment/status/unit tidak dibuat (menunggu kontrak O-033); `must_change_password` hanya ditegakkan frontend; reset/aktivasi password belum ada; scheduler harus dijalankan agar token kedaluwarsa dibersihkan.
- Draf kontrak O-033 untuk administrasi fondasi: `docs/54-O-033-FOUNDATION-ADMIN-PERMISSION-CONTRACT-DRAFT.md` (`PROPOSED`, belum ada key/grant/endpoint). Doc 54 §1 mencatat selisih dengan doc 16: password complexity/riwayat, lockout 5x/15 menit, CAPTCHA, MFA SYS_ADMIN, password awal, OTP recovery belum diimplementasikan; password policy saat ini konflik dengan doc 16 (`IN_REVIEW`).
- Lockout akun 5x/15 menit diimplementasikan (doc 16); migration `2026_11_06_090000` BELUM dijalankan pada `distriva_db` (hanya test DB). Bug zona waktu DB (timestamptz bergeser 7 jam) ditemukan dan diperbaiki lewat `database.connections.pgsql.timezone=UTC`. Backend 83 tests/290 assertions.
- Password policy doc 16 DITERAPKAN (kompleksitas, riwayat 5 via `password_histories`, denylist umum, larangan nama/email); migration `2026_11_06_100000` hanya di test DB. HIBP opsional, nonaktif. Backend 97 tests/327 assertions; frontend 9 tests; browser E2E 16/16. Konflik D-1 selesai.
- D-2…D-8 (docs/54) DECIDED sesuai rekomendasi; D-7 = email + WhatsApp. Endpoint `/api/admin/*` (6 endpoint) + katalog key/grant + mode scope `UP3_ADMIN_DELEGATION` diimplementasikan: `docs/55`. Backend 118 tests/425 assertions. `distriva_db` DIMIGRATE (2 migrasi) setelah backup + uji restore; TIDAK diseed. SYS_ADMIN tulis tertutup sampai MFA; admin pertama belum bisa dibuat via API (bootstrap, lihat docs/55).
- Admin pertama: perintah `distriva:bootstrap-admin` (docs/55) selesai dan diuji. `distriva_db` DISEED (14 role, 6 permission, 12 grant); belum ada user/unit — jalankan perintah bootstrap dengan identitas nyata. UI admin (Pengguna, Detail+penugasan, Unit) selesai: backend 127 tests/478 assertions, frontend 19 tests, browser E2E 25/25 (`frontend/e2e/admin-browser-e2e.mjs`). Tersisa: MFA, CAPTCHA, email/WhatsApp, password awal 24 jam, OTP, users.create/update, pencarian user lintas UP3.
- Lapisan notifikasi email+WhatsApp (D-7) `IMPLEMENTED/TESTED` (docs/56, `distriva:notify-test`): kegagalan per kanal terisolasi, pesan sensitif tidak di-log. WhatsApp = penyedia API NON-RESMI (keputusan pemilik): driver HTTP generik `http` selesai dan diuji dengan HTTP palsu; belum ada URL/token sehingga kanal dilewati. Email: `MAIL_MAILER=log` (tidak terkirim) sampai `MAIL_*` diisi. Backend 159 tests/537 assertions. Admin pertama (Irham Maulana, UP3 5145 Mojokerto) sudah dibuat di `distriva_db` oleh pemilik; password sementara wajib diganti.
- `users.create` + password awal 24 jam + re-issue SELESAI (docs/55): atomik dengan pengiriman email+WhatsApp (tanpa kanal → 503, tidak ada yang tersimpan); mailer `log` dianggap tidak mengirim. Backend 172 tests/641 assertions, frontend 25, browser E2E 24/24 dengan SMTP/HTTP sink lokal. **Diterapkan di `distriva_db` 6 Nov 2026 (setelah backup + uji restore, persetujuan pemilik):** migrasi `2026_11_06_110000_add_temporary_password_expiry` dan seeder (7 permission, 14 grant, key `users.create`); tidak ada migrasi pending. Selain itu `.env` masih `MAIL_MAILER=log` + WhatsApp `null`, sehingga pembuatan pengguna di `distriva_db` akan 503 sampai email/WhatsApp dikonfigurasi.
- WhatsApp = Starsender (`https://api.starsender.online/api/send`, header Authorization tanpa Bearer, body JSON messageType/to/body, sukses `success:true`; sumber: docs.starsender.online). Profil sudah ada di `backend/.env` KECUALI `DISTRIVA_WHATSAPP_TOKEN` (pemilik wajib mengisi). Email: `MAIL_*` belum diisi (daftar variabel di docs/56). Cek tanpa kirim: `php artisan distriva:notify-check`. WhatsApp Starsender TERBUKTI mengirim pesan uji nyata (pemilik, 6 Nov 2026, `[OK] whatsapp`) setelah perbaikan bug perbandingan `success` (env() mengubah `true` jadi boolean). Email belum dikonfigurasi/diuji (`MAIL_MAILER=log`).
- PERINGATAN KOLABORASI (6 Nov 2026): folder `frontend/` diubah oleh proses/alat lain di luar sesi Claude Code ini antara 07:39–08:16 (berkas baru `features/modules/moduleRegistry.js`, `pages/ModuleStatusPage.jsx`, `components/Components.test.jsx`, `Button.jsx`, `Card.jsx`, `icons.jsx`; tampilan login berubah; `.env`, `.env.example`, `.gitignore` ditulis ulang 08:16). Perubahan itu juga mengembalikan `vite.config.js` ke versi yang hanya membaca `process.env`, sehingga alamat backend di `frontend/.env` diabaikan dan login kembali dijawab 400 oleh layanan lain di port 8000. `vite.config.js` dipulihkan memakai `loadEnv` (hanya berkas ini yang disentuh). Frontend setelah perubahan itu: Vitest 31/31, build lulus. Jangan menjalankan dua alat yang sama-sama mengedit berkas pada waktu yang sama; backup versi sebelum perbaikan: scratchpad `vite.config.js.before-fix`.
- **KEPUTUSAN 6 Nov 2026 (docs/18, docs/15): aktivasi awal dan pemulihan akun terblokir memakai OTP email/WhatsApp; administrator tidak lagi menerbitkan password** (menggantikan mekanisme password awal 24 jam di atas). Pengguna dibuat `PENDING_ACTIVATION`; undangan tanpa rahasia; halaman publik `/aktivasi`, `/pemulihan`; endpoint `/api/auth/otp/request|verify`; `resend-invitation` menggantikan `reissue-credentials`. Backend 230 tests/911 assertions, frontend 38, browser E2E 27/27 (`frontend/e2e/otp-browser-e2e.mjs`). Pembatas laju kini bernama per tujuan (bug bersama sebelumnya diperbaiki). **Migrasi `2026_11_06_120000_create_otp_challenges_table` BELUM diterapkan ke `distriva_db`** (butuh persetujuan + backup); hingga itu, `/aktivasi` dan `/pemulihan` di `distriva_db` gagal karena tabel belum ada, dan pembuatan pengguna lewat UI memakai alur baru (tanpa password).
- **D-4 DIPUTUSKAN: OPSI A (pemilik, 6 Nov 2026) dan sudah diterapkan** — `organizational_units.create/update` hanya `SYS_ADMIN` (tertutup MFA); endpoint dipertahankan, kini bertest; bug `children` kosong pada detail unit diperbaiki. Suite: 284 test, semua lulus. Grant unit-write belum ada di `distriva_db` (belum di-seed; seeder Foundation akan memberikannya hanya ke SYS_ADMIN). Catatan lama di bawah dipertahankan sebagai riwayat.
- (RIWAYAT) **TEMUAN (6 Nov 2026): perubahan di luar sesi ini pada backend** (±08:59–09:04): endpoint `GET /admin/organizational-units/{id}`, `POST /admin/organizational-units`, `POST|PATCH /admin/organizational-units/{id}` ditambahkan dan `config/distriva_permissions.php` memberi `organizational_units.create/update` juga kepada `UP3_ADMIN`. Ini **menyimpang dari D-4** (docs/54 §6a: hanya SYS_ADMIN, menunggu MFA). Kode: ULP dapat dibuat/diubah oleh pemegang hak pada UP3 induk dalam scope; UP3 hanya SYS_ADMIN (+MFA→403). Belum ada test untuk endpoint tulis/detail; test seeder lama (`AdminEndpointsTest::the_seeder_creates_only_the_approved_keys…`) kini GAGAL (mengharapkan 7 key/14 grant; config kini 9/18) — 229 lulus, 1 gagal. Risiko tercatat: UP3_ADMIN dapat menonaktifkan UP3-nya sendiri bila tanpa ULP aktif (mengunci diri); riwayat unit memuat email pengubah. Grant belum di-seed ke `distriva_db` (hanya `organizational_units.view` di sana). Opsi: (A) kembalikan sesuai D-4; (B) terima ULP-oleh-UP3_ADMIN sebagai keputusan baru, perbarui test hitungan + tambah test unit + lindungi penonaktifan UP3 sendiri.
- **ANALISIS 2B-2/2C selesai (baca-saja): `docs/59`** — jenis konstruksi = 147 label di GAMBAR (tanpa kode), BOM = graf rumus; evaluator terkontrol mereproduksi 99,85% rumus workbook. Keputusan pemilik: K-2 = 7 kelompok + SKTR/SKSR/GD PSG DLM (PBPD terpisah); K-3 = pertahankan perilaku workbook. TERBUKA: K-1 (pemilik menyebut kode resmi MATERIAL dari aplikasi lain — belum menjawab kode JENIS KONSTRUKSI) dan K-4 (tanggal `--valid-from` KHS, tidak ada di workbook). **TEMUAN: SKTR/SKSR/GD PSG DLM rusak (#REF!/#N/A) dan memakai 71 kode bergaya lama (TM089, TR021, SR1PHS28, CUB02, GTT008, VIP01…) yang tidak ada di KHS numerik 1–518 maupun di mana pun di workbook; mungkin kode resmi di aplikasi internal lain → kode KHS yang akan diimpor perlu dikaji ulang SEBELUM impor KHS ke distriva_db.** Belum ada kode 2B-2 (sengaja dihentikan menunggu klarifikasi).
- **MASTER DATA (Tahap 2) iterasi 2A + 2B-1 SELESAI dan TESTED** (docs/58, docs/57 §3a): kategori/satuan/material + impor ERP bertahap; katalog KHS berversi (draf→disetujui→immutable, pemisahan tugas di API dan database). Keputusan role (pemilik menerima usulan): ENGINEERING/PERENCANAAN mengelola, UP3_MANAGER menyetujui. Data asli: 518/518 kode KHS terbukti (cacat sel multi-baris pada kode 186/187 ditemukan dan diperbaiki). Backend 278 tests (277 lulus), 1 GAGAL (test seeder lama akibat perubahan unit di luar sesi; lihat TEMUAN di atas). **Di `distriva_db`: 2 migrasi dan seeder SUDAH diterapkan** (migrasi oleh pemilik; seeder oleh sesi ini setelah backup; pengguna ENGINEERING dan UP3_MANAGER sudah dibuat pemilik). **Impor KHS BELUM dilakukan** — sengaja: harus dijalankan oleh engineer (impor) dan manager (setujui) sendiri lewat `tools/khs_admin.py` agar audit akurat (docs/58 §5); `--valid-from` perlu dikonfirmasi pemilik. Laravel Boost: pemilik memutuskan TIDAK dipasang; pengingat di `backend/CLAUDE.md` adalah teks bawaan, abaikan kecuali pemilik minta. Belum ada: UI master data, konstruksi, BOM, formula, harga, konversi satuan.
- Kontrak API aktual: `docs/57-API-CONTRACT.md` (untuk agen frontend; kolom Uji menandai endpoint tanpa test).
- Bukti: `test-evidence/2026-11-06-otp-activation.md`, `test-evidence/2026-11-06-foundation-auth-assignment.md`, `test-evidence/2026-11-06-admin-ui.md`, `test-evidence/2026-11-06-user-provisioning.md`. Doc 52 (panduan tanda tangan) SUPERSEDED oleh doc 53.

## 1. Aturan kerja aktif

Gunakan `docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md` sebagai panduan kerja. Pengembangan berjalan iteratif per modul. Tidak ada kewajiban nama asli, tanda tangan, SK, surat tugas, surat delegasi, atau dokumen fisik untuk review/pengembangan internal proyek.

Open issue hanya memblokir fitur yang bergantung langsung padanya. Jangan menganggap seluruh proyek `BLOCKED` hanya karena ada issue terbuka. Jangan pula menutup issue atau menganggap proposal telah menjadi keputusan tanpa keputusan eksplisit.

## 2. Arsitektur dan prinsip yang harus dijaga

- Backend Laravel API; frontend React + Vite + Tailwind.
- PostgreSQL sebagai database utama.
- Sanctum untuk authentication; Spatie Permission sebagai katalog role/permission.
- `user_role_assignments` adalah sumber assignment user-role-unit.
- Python services direncanakan terpisah untuk Auto MTO dan Forecasting; paket source ini tidak memuat direktori `services/`.
- Pertahankan aturan bisnis final pada docs 16 dan aturan teknis domain yang relevan.
- Vendor authorization tetap fail-closed sampai relasi dan aturan vendor diverifikasi.
- Warehouse/material eksternal tetap menjadi source of truth; DISTRIVA tidak membangun ulang inventory eksternal.

## 3. Kondisi source package yang diperiksa

Pemeriksaan struktur ZIP menunjukkan:
- `backend/`: 103 file.
- `frontend/`: 24 file.
- `database/`: 8 file (7 SQL dan 1 shell script).
- `docs/`: 55 Markdown dan 1 SQL.
- `test-evidence/`: 11 Markdown.
- Root mencakup README, master prompt, manifest, analisis RAB/KKF, dan dua workbook.
- `services/` tidak ditemukan dalam paket ini.

Angka di atas adalah inventaris file, bukan bukti bahwa semua fitur berjalan. Reorganisasi ini tidak menjalankan PHP/Composer/npm test, tidak membuka koneksi database, dan tidak menjalankan migration.

## 4. Status teknis yang harus diverifikasi sebelum melanjutkan

Manifest source menyebut baseline dokumentasi v3.15.0. Handoff sebelumnya mencatat:
- T4.2.1 design/runtime evidence terbatas pada target PostgreSQL disposable dan telah di-rollback.
- Unit/full test suite yang tercatat pada audit sebelumnya: 22 tests / 33 assertions; jangan menganggap hasil tersebut berasal dari checkpoint ini.
- PostgreSQL integration dan persisted Sanctum bearer-token E2E belum terverifikasi.
- Konfigurasi backend pada audit sebelumnya memilih SQLite dan mencantumkan port 3306, berbeda dari target PostgreSQL yang direncanakan.
- `distriva_backend_test` belum terverifikasi keberadaan dan sifat disposable-nya.
- O-033/O-034/O-036/O-038/O-039/O-041 dan isu lain tetap mengikuti status di dokumen 15; reorganisasi tidak mengubah status bisnis/teknis tersebut.

Sebelum menyatakan status terkini, periksa source code, `backend/.env` (jangan tampilkan secret), migration, route, test, konfigurasi frontend, dan target database yang benar-benar digunakan.

## 5. Prioritas pekerjaan berikutnya

1. Jalankan aplikasi backend dan frontend secara lokal menggunakan environment yang sudah diverifikasi.
2. Audit Foundation Auth + Assignment dari source aktual: route, controller, middleware, model, service, migration, test, dan frontend auth.
3. Buat daftar gap konkret antara acceptance criteria dan implementasi.
4. Selesaikan test auth dan assignment pada database test yang teridentifikasi; jangan memakai database utama secara tidak sengaja.
5. Setelah Foundation terverifikasi, pilih modul berikutnya berdasarkan roadmap dan dependensi nyata.
6. Perbarui dokumen 15, 14, dan handoff setiap kali keputusan atau status implementasi berubah.

## 6. Batas keselamatan

- Jangan menjalankan `migrate:fresh`, `db:wipe`, atau operasi destruktif pada database yang belum dipastikan aman.
- Jangan menganggap nama database dalam dokumentasi membuktikan konektivitas atau izin.
- Backup dan verifikasi restore sebelum perubahan pada database yang berisi data penting.
- Jangan menyimpan credential/token/secret di Markdown atau output.
- Jangan mengaktifkan vendor access atau permission grant yang belum memiliki aturan terverifikasi.
- Catat keterbatasan test; jangan klaim test lulus jika belum dijalankan pada checkpoint saat ini.

## 7. Dokumen yang dibaca untuk tugas berikutnya

Mulai dari:
1. `README.md`
2. `docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md`
3. `docs/PROJECT-CONTEXT-FOR-AI.md`
4. Dokumen domain yang sedang dikerjakan
5. `docs/15-DECISIONS-AND-OPEN-ISSUES.md` untuk dependensi terkait
6. Source code dan test yang relevan

Dokumen 34–52 dipertahankan sebagai arsip analisis/audit. Gunakan sebagai referensi bila relevan, bukan sebagai formulir atau gate administrasi wajib.

- **2B-2 SELESAI dan TESTED (jenis konstruksi + pemetaan KHS), BELUM di `distriva_db`** (docs/58 §5a, docs/57 §3a, docs/59 §5). Keputusan final: tanpa kode resmi → `<KELOMPOK>-<NN>`; 7 kelompok saja (SKTR/SKSR/GD PSG DLM dikecualikan); tanggal berlaku oleh admin saat impor. D-4 A ditegaskan: hanya SYS_ADMIN menulis unit (config dikembalikan; `.env` MFA flag = true; tes dikunci di phpunit.xml). Backend 308 tes lulus. Berikutnya: migrate 150000 + seeder di distriva_db (backup+restore+persetujuan), lalu 2C (BOM/rumus/evaluator). Terbuka: 3 jenis tanpa pemetaan; 9 selisih PBPD.
- **2B-2 DITERAPKAN ke `distriva_db`** (backup+uji restore+migrate 150000+seeder; docs/58 §5a). 3 jenis tanpa pemetaan dikecualikan (keputusan pemilik; CSV 129 jenis). Impor data (KHS → jenis → pemetaan → persetujuan) menunggu engineer/manager lewat `tools/khs_admin.py`. Berikutnya: 2C.
- **SYS_ADMIN role penuh + MFA TOTP SELESAI** (keputusan pemilik 6 Nov 2026; docs/15, docs/57 §3b): SYS_ADMIN memegang semua key master data; MFA wajib (middleware `EnsureActiveAccount`, `MfaService`, `MfaController`, `distriva:mfa-reset`, migrasi `160000` — BELUM di distriva_db). Pembuat ≠ penyetuju tetap. Frontend perlu halaman enrol/verifikasi MFA (kontrak docs/57 §3b). Untuk distriva_db: migrate 160000 + seeder MasterDataPermissionSeeder (menambah grant SYS_ADMIN) dengan backup+restore+persetujuan.
- **distriva_db (6 Nov 2026):** migrasi 150000 dan 160000 + seeder master data diterapkan (backup+uji restore). Impor oleh engineer/manager SELESAI: 518 KHS APPROVED, 129 jenis konstruksi APPROVED, 1.617 pemetaan. Izin `organizational_units.create/update` UP3_ADMIN dicabut (2 baris ROLE_PERMISSION_REVOKED); `FoundationPermissionSeeder` kini mencabut grant fondasi yang tidak ada di config (teraudit, dites). Berikutnya: 2C (BOM/rumus/evaluator).
- **2C-1 SELESAI (mesin rumus)** — `backend/app/Formula/*`, uji emas 6.408/6.408 rumus workbook (`tests/Unit/FormulaGoldenWorkbookTest`, fixture dari `tools/golden_vectors.py`), docs/60. Temuan PBPD terbuka ditutup (sel kosong = ""). **2C-2 (tabel BOM per kelompok, impor, persetujuan) menunggu persetujuan desain docs/60 §3**; belum ada tabel BOM.
- **2C-2 SELESAI di kode + TESTED (basis data test), BELUM di distriva_db** (docs/60 §4, docs/57 §3a): BOM per kelompok, `bom.manage/bom.approve`, impor/kalkulator/persetujuan; uji emas end-to-end seluruh 7 BOM nyata cocok dengan Excel. Migrasi `170000` + `MasterDataPermissionSeeder` menunggu backup+uji restore+persetujuan pemilik; setelah itu engineer `bom-import` dan manager `bom-approve` lewat `tools/khs_admin.py`. Terbuka: 6 rumus H menunjuk sel kosong GAMBAR (docs/60 §4); BOM PBPD/SKTR/SKSR/GD PSG DLM di luar cakupan.
- **2C-2 DITERAPKAN ke distriva_db** (migrasi 170000 + seeder; backup+uji restore). Menunggu: engineer `bom-import --apply`, manager `bom-approve` (tanggal berlaku = admin; harus ≥ tanggal KHS/jenis konstruksi). Keputusan engineer terbuka: 6 rumus H menunjuk sel kosong GAMBAR (docs/60 §4).
- **Parameter BOM (jawaban engineer 6 Nov 2026):** volume commissioning test = masukan dari halaman gambar → parameter `COMMISSIONING:<KELOMPOK>` (migrasi 180000, `bom_headers.parameters`, `calculate` menerima `params`). BELUM di distriva_db; BOM v1 immutable → perlu v2 untuk 6 kelompok (bom-import --group …, valid_from setelah 2026-11-01) setelah migrasi 180000 + backup/uji restore + persetujuan.
- **Migrasi 180000 DITERAPKAN ke distriva_db** (backup+uji restore). Menunggu engineer `bom-import --group SUTM --group MVTIC --group SKTM --group KUBIKEL --group GTT_UMUM --group GTT_KHUSUS --valid-from <> 2026-11-01 --apply` lalu manager `bom-approve` (membuat BOM v2 dengan parameter COMMISSIONING).
- **Serah-terima frontend:** `docs/61-FRONTEND-HANDOFF-BOM-AND-MFA-FIXES.md` (perbaikan MfaPage untuk non-SYS_ADMIN; halaman BOM: daftar, detail, impor, kalkulator dengan `params`). Backend selesai; `.env` MFA flag = true (diset ulang pemilik 6 Nov 2026).
- **Rencana tahapan backend mengikuti alur Beranda: `docs/62-BACKEND-STAGE-PLAN-END-TO-END.md`** (PB/PD → Survey → Drawing → Auto MTO → RAB&KKF → RKM → SPK/WO → BASTP). Tahap 1 dipecah 1A (input manual) / 1B (impor Bot Daftung) / 1C (sinkron status) / 1D (pembayaran); 1A menunggu 5 keputusan pemilik (docs/62 §3). Belum ada kode.
- **Tahap 1A (PB/PD input manual) SELESAI di kode + TESTED, BELUM di distriva_db** (docs/62 §5, docs/57 §3c): customers, applications, referensi eksternal, riwayat status, scope ULP; migrasi 190000 + ApplicationPermissionSeeder menunggu backup/uji restore/persetujuan. Berikutnya 1B (impor Bot Daftung → staging).
- **distriva_db: migrasi 190000 + ApplicationPermissionSeeder DITERAPKAN** (backup+uji restore). Analisis 1B dari contoh CSV EIS: docs/62 §6 (presisi Excel merusak No. Agenda/telepon; daya berstatus VA; JENIS_TRANSAKSI/UNITTUJUAN pemetaan; usulan 1B+1C satu berkas). Menunggu keputusan pemilik (docs/62 §6, 6 butir). `tools/eis_sync/eis_session.json` = data sesi (rahasia), tidak dibaca.
- **Tahap 1B+1C (impor EIS + sinkronisasi) SELESAI di kode + TESTED, migrasi 200000 + seeder (applications.import) BELUM di distriva_db** (docs/62 §7, docs/57 §3c). Keputusan pemilik: pemetaan status EIS→internal, sinkron boleh update IDPEL/nama/alamat/tarif/daya (menggantikan aturan 3 kolom), VA, UNITTUJUAN=kode unit. Koreksi: temuan 'presisi Excel' pada analisis awal SALAH (NOAGENDA teks 18 digit sah; yang nyata: tanggal serial Excel tertukar hari/bulan → tidak dipakai). Menunggu: contoh .xls asli dari EIS (pembaca mendukung CSV/XLSX/HTML; .xls biner ditolak). Bot unduh otomatis belum (perlu keputusan akun layanan).
- **distriva_db: migrasi 200000 + seeder applications.import DITERAPKAN** (backup+uji restore). Pembaca berkas kini mendukung XLS biner/XLSX lewat `phpoffice/phpspreadsheet` (composer require; `composer install` saat deploy). Uji pada unduhan asli `tools/samples/GV.xls` (data pribadi — lokal saja): 207 baru, 22 ditolak; kode status asli `BAYAR` dipetakan; UNITTUJUAN kosong pada 78 baris → NAMAUP persis. Bot = pengguna NIAGA_RETAIL. Berikutnya: tahap 2 Survey (menunggu keputusan O-038) dan halaman frontend permohonan/impor.
- **Tahap 2 (Survey) + modul Dokumen SELESAI di kode + TESTED, migrasi 220000/230000 + SurveyPermissionSeeder BELUM di distriva_db** (docs/62 §9, docs/57 §3d). Rantai: TEKNIK → MANAGER_ULP → review PERENCANAAN+KONSTRUKSI_UP3 → ASMAN_PERENCANAAN+ASMAN_KONSTRUKSI → UP3_MANAGER; penolakan mana pun → versi baru mulai dari awal. Dokumen: penyimpanan privat, dicek isi, versi immutable. Migrasi 210000 (seq riwayat status) sudah diterapkan.
- **Serah-terima frontend (permohonan, impor EIS, survey, dokumen):** `docs/63-FRONTEND-HANDOFF-APPLICATIONS-IMPORT-SURVEY.md` + prompt siap-tempel `docs/PROMPT-FRONTEND-APPLICATIONS-IMPORT-SURVEY.md`.
- **distriva_db: migrasi 220000 (dokumen) + 230000 (survey) + SurveyPermissionSeeder DITERAPKAN** (backup+uji restore). Status survey: DRAFT→SUBMITTED→UNDER_REVIEW→ACCEPTED (+RETURNED) dengan `stage`. Dokumen disimpan di disk `documents` (`DISTRIVA_DOCUMENTS_ROOT`, keputusan pemilik: drive media; BELUM diisi di .env — `php artisan distriva:documents-check`). Tahap 3 (Drawing): usulan + pertanyaan (a–f) di docs/62 §10, menunggu jawaban pemilik.
- **Tahap 3 (Drawing) SELESAI di kode + TESTED, migrasi 240000 + DrawingPermissionSeeder BELUM di distriva_db** (docs/62 §11, docs/57 §3e). Paket per permohonan, versi dengan satu berkas MAIN + lampiran; rantai TEKNIK→MANAGER_ULP→PERENCANAAN+KONSTRUKSI_UP3 (→APPROVED); `extended_approval` (kajian tidak layak/PBP>5) menambah ASMAN×3→UP3_MANAGER; penolakan mengulang pada versi baru; revisi pasca-APPROVED mengganti (SUPERSEDED) hanya setelah versi baru disetujui. Penanda extended dinaikkan manual (MANAGER_ULP/PERENCANAAN/KONSTRUKSI_UP3) sampai tahap 5 mengisinya otomatis — perlu konfirmasi pemilik.
- **Revisi rantai gambar (pemilik 6 Nov 2026):** rantai NORMAL kini TEKNIK→MANAGER_ULP→PERENCANAAN+KONSTRUKSI_UP3→ASMAN_PERENCANAAN+ASMAN_KONSTRUKSI (keduanya)→APPROVED; satu penolakan mengembalikan ke TEKNIK; diperluas menambah ASMAN_NIAGA lalu UP3_MANAGER. Migrasi 240000 diubah (belum diterapkan ke distriva_db).
- **distriva_db: migrasi 240000 + DrawingPermissionSeeder DITERAPKAN** (backup+uji restore). `.env` DISTRIVA_DOCUMENTS_ROOT=…/backend/storage/app/private/documents (sementara). docs/63 + prompt frontend kini mencakup Gambar (§E). Tahap 4 Auto MTO: analisis + usulan 4A/4B/4C di docs/62 §12 (menunggu keputusan a–e; catatan: BOM PBPD belum diimpor; docs/26 menempatkan MTO sebelum review UP3).
- **Tahap 4A (MTO terstruktur) SELESAI di kode + TESTED, migrasi 250000 + MtoPermissionSeeder BELUM di distriva_db** (docs/62 §13, docs/57 §3f, docs/63 §F). Jumlah psg/bkr per jenis konstruksi → BomCalculator (BOM APPROVED berlaku) → verifikasi TEKNIK (snapshot+hash) → persetujuan MANAGER_ULP (pemeriksa≠penyetuju); gerbang: persetujuan ULP_MANAGER gambar butuh MTO APPROVED. Contoh `tools/samples/CARGO GUDANG BONGKAR MUAT.xlsx` = lembar GAMBAR terisi; 9 label cocok jenis konstruksi → 4B = pembaca templat deterministik. PBPD (2 lembar, parameter teks, tabel tier) belum — butuh penjelasan pemilik.
- **distriva_db: migrasi 250000 (MTO) + MtoPermissionSeeder DITERAPKAN** (backup+uji restore). distriva_db kini berisi 208 permohonan hasil impor EIS oleh pemilik. Berikutnya: 4B (pembaca templat GAMBAR) dan penjelasan PBPD.
- **Tahap 4B SELESAI + TESTED** (docs/62 §14; `GambarReader`, `POST /mto/{id}/extract`, tanpa migrasi baru). PBPD: sel AM7:AM10/S55 diabaikan (pengingat); `SR 1 PHASE (2022)` = komponen biaya sejenis dua lembar BOM PBPD; `GAMBAR!Z51:AB56` = jumlah pelanggan PB/PD per rentang daya (sumber angka belum diputuskan). 4C belum: tidak ada contoh PDF/gambar/DWG, tidak ada OCR/pembaca DWG di mesin.
- **Backup/Restore SELESAI di kode + TESTED (BackupTest 14); migrasi 260000 + BackupPermissionSeeder BELUM di distriva_db** (menunggu persetujuan pemilik). Lihat `docs/64-BACKUP-RESTORE.md`, API `docs/57` §3g, handoff frontend `docs/65` + `docs/PROMPT-FRONTEND-BACKUP-RESTORE.md`. Restore hanya dari cadangan terverifikasi, ada cadangan pengaman, satu transaksi, frasa+kata sandi; tabel riwayat `backup_*` tidak ikut dump. Butuh cron `schedule:run` untuk jadwal; `DISTRIVA_BACKUP_ROOT` sementara di `storage/app/private/backups` (pindahkan ke drive media). Tes restore hanya ke database scratch.
- **Tahap 4C (PDF hasil ekspor Excel) SELESAI + TESTED** (docs/62 §15; `PdfGambarReader`, `pdftotext -bbox`; `extract` menerima xlsx/xls/PDF + `document_id`; laporan `pbpd`). Gambar/foto/DWG belum dibaca (tanpa OCR/pembaca DWG; manual). `CARGO GUDANG BONGKAR MUAT.xlsx` sudah tidak ada di tools/samples (PDF-nya ada; tes contoh asli memakai PDF).
- **distriva_db: migrasi 260000 (backup/restore) + BackupPermissionSeeder DITERAPKAN** 6 Nov 2026 (backup+uji restore identik; 55 permission). Belum: DISTRIVA_BACKUP_ROOT dan cron schedule:run.

## 7 Nov 2026 — BOM PBPD (docs/62 §16.1, §17)
Kelompok BOM `PBPD_6_41` dan `PBPD_53_197` diimplementasikan (parameter teks pilihan, kolom B berupa rumus, `constants`), diekstrak oleh `tools/extract_bom_json.py`, fixture `backend/tests/fixtures/golden_pbpd.json.gz`. MTO extract mengisi `PBPD:*` bila kedua BOM APPROVED. `SR 1 PHASE`, tabel harga AD3:AK15, dan impor ke `distriva_db` belum (butuh keputusan/persetujuan pemilik).

## 7 Nov 2026 — Serah-terima halaman BOM
`docs/66` + `docs/PROMPT-FRONTEND-BOM-PAGES.md`: halaman BOM (docs/61 §3) belum dibangun frontend; ditambah PBPD (kelompok, parameter teks, kolom B). Dua draf BOM PBPD di distriva_db menunggu persetujuan UP3_MANAGER lewat layar/API.

## 7 Nov 2026 — Tahap 5A buku harga
Backend buku harga per kontrak selesai (docs/62 §19, docs/67, docs/57). Migrasi 2026_11_07_100000 + kunci prices.* BELUM diterapkan ke distriva_db (butuh persetujuan pemilik, backup + restore-test dulu).
Buku harga awal sudah dimasukkan ke distriva_db sebagai DRAFT (id f8d287b7-a07b-4f84-a67e-4f50b06f2759); menunggu persetujuan UP3_MANAGER/SYS_ADMIN.
Prompt frontend buku harga: docs/PROMPT-FRONTEND-PRICE-BOOKS.md

## 7 Nov 2026 — Tahap 5B mesin RAB
Backend RAB selesai (docs/62 §21, docs/57). Migrasi 2026_11_07_110000 + RabPermissionSeeder BELUM diterapkan ke distriva_db. Buku harga draf di distriva_db tidak memuat nilai_asuransi (dibuat sebelum kolomnya ada).
Buku harga baru de6af174-0606-4523-bcac-4aeb91fe59ed (DRAFT; berisi nilai asuransi) menunggu persetujuan; migrasi RAB 110000 sudah diterapkan ke distriva_db.

## 7 Nov 2026 — SR-APP 1 fasa dalam RAB
Jadwal harga SR 1 fasa (docs/62 §23, docs/57): migrasi 2026_11_07_120000 BELUM diterapkan ke distriva_db; CSV dari tools/extract_sr1_csv.py (/tmp, buat ulang dari tools/samples/MASTER RAB & KKF.xlsx).
Jadwal SR 1 fasa f279bc7e-0c49-43ce-a652-cb35cfb4fb5e (DRAFT) dan buku harga de6af174-... (DRAFT) menunggu persetujuan; migrasi 120000 sudah diterapkan.

## 7 Nov 2026 — Tahap 5C awal
KkfCalculator (murni) + 7 tes golden (docs/62 §24). Belum ada tabel/endpoint KKF; menunggu keputusan discount rate, BPP, alur persetujuan, sumber tarif/jam nyala.

## 7 Nov 2026 — Parameter KKF berversi
Keputusan pemilik: discount rate 7,78 %, BPP 552 (dibaca dari "5,52", minta konfirmasi), dapat diubah via front end. Backend + tes selesai (docs/62 §25, docs/57); migrasi 2026_11_07_130000 + seeder izin BELUM diterapkan ke distriva_db. Prompt frontend: docs/PROMPT-FRONTEND-KKF-PARAMETERS.md (docs/68).

## 7 Nov 2026 — Master tarif dan run KKF
Backend + tes selesai (docs/62 §26, docs/57): buku tarif berversi, run KKF tak-berubah dengan snapshot/hash. Rantai persetujuan KKF = persetujuan gambar (tidak digandakan). Migrasi 130000 + 140000 dan seeder izin BELUM diterapkan ke distriva_db. Prompt frontend: docs/PROMPT-FRONTEND-TARIFF-AND-KKF.md (docs/69).

## 7 Nov 2026 — Tahap 5D dokumen keluaran
Backend + tes selesai (docs/62 §28, docs/57), tanpa migrasi. Prompt frontend: docs/PROMPT-FRONTEND-OUTPUT-DOCUMENTS.md (docs/70). Belum: REKAP RINCI per sumber material (MDU/DPT/…), nomor dokumen KKF, PDF server.

## 7 Nov 2026 — Tahap 6 (stok, tiang/KR, alokasi, RKM)
Backend + tes selesai (docs/62 §30–31, docs/57). Migrasi 160000/170000 dan PlanningPermissionSeeder BELUM diterapkan ke distriva_db (pemilik: selesaikan aplikasi dulu, lalu pemulihan + migrasi sekaligus). Prompt frontend: docs/PROMPT-FRONTEND-STOCK-POLES-ALLOCATION-RKM.md (docs/71). Berikutnya: tahap 7 SPK/WO + vendor, tahap 8 BASTP (desain dulu).

## 7 Nov 2026 — Tahap 7 vendor dan SPK/WO
Backend + tes selesai (docs/62 §32, docs/57). Migrasi 180000 BELUM diterapkan ke distriva_db. Prompt frontend: docs/PROMPT-FRONTEND-VENDOR-WORK-ORDERS.md (docs/72). Berikutnya: tahap 8 BASTP (desain dulu, docs/62 §33).

## 7 Nov 2026 — Tahap 8 BASTP: hanya usulan desain
docs/73-BASTP-DESIGN-PROPOSAL.md (menunggu koreksi pemilik; belum ada kode). Docs/62 §33.

## 7 Nov 2026 — Koreksi pemilik tahap 5D–7 diterapkan
Peran stok/alokasi dipisah (PERENCANAAN = KR + tiang beton; KONSTRUKSI_UP3 = stok + material selain tiang; alokasi dua bagian), nomor dokumen KKF `nomor urut/tahunbulan/kodeunit`, WO selesai butuh status PEREMAJAAN (docs/62 §34). Prompt baru: docs/PROMPT-FRONTEND-RAB-SR1.md (docs/74). Migrasi 140000 dan 160000 diubah (belum pernah diterapkan ke distriva_db).

## 7 Nov 2026 — Survey/gambar/MTO berbasis peran
Tahap 2–4 dilonggarkan: setiap TEKNIK ULP dapat survey, mengunggah gambar, dan mengerjakan MTO semua pelanggan ULP-nya; penugasan MANAGER_ULP opsional (docs/62 §35). Frontend: tombol 'mulai survey/buka gambar' kini untuk TEKNIK tanpa memilih petugas.

## 7 Nov 2026 — Tahap 8 BASTP dibangun
BASTP menjadi syarat WO selesai; vendor/TEKNIK mengajukan, MANAGER_ULP menerima, KONSTRUKSI_UP3 menandatangani, ASMAN_KONSTRUKSI menutup (menyelesaikan WO); TTE internal dengan kata sandi (docs/62 §36, docs/57, docs/73 §6). Migrasi 190000 BELUM diterapkan ke distriva_db. Prompt frontend: docs/PROMPT-FRONTEND-BASTP.md (docs/75).

## 7 Nov 2026 — Usulan dengan banyak pelanggan
Backend + tes selesai (docs/62 §37): usulan memuat banyak pelanggan 3 fasa, pipeline lewat permohonan perwakilan, KKF satu proses agregat, WO selesai bila semua anggota PEREMAJAAN. Migrasi 200000 BELUM diterapkan ke distriva_db (pemulihan ditahan sampai semua modul selesai). Prompt frontend: docs/PROMPT-FRONTEND-PROPOSALS-MULTI-CUSTOMER.md (docs/76).

## 7 Nov 2026 — Audit frontend
docs/77 + docs/PROMPT-FRONTEND-AUDIT-FIXES.md: 8 celah (izin tahap 5–8 tidak dimuat, alokasi dua bagian, tombol Selesai WO → BASTP, survey/gambar berbasis peran, listing=pbpd, portal vendor, KKF anggota usulan, registri modul). Backend menambah GET /planning/access. Frontend: 19 berkas / 176 tes lulus saat diaudit; frontend/ tidak diubah.

## 7 Nov 2026 — Gudang ERP, sinkronisasi MIMS, meja pemetaan, outbox material, laporan
Backend + tes selesai (docs/62 §39–41, docs/57): impor gudang ERP (11 lokasi), stok xlsx ERP (Stock Siap di luar reservasi), meja kerja pemetaan SKU↔KHS, sinkronisasi MIMS (token hanya dari env; butuh contoh respons JSON), outbox kebutuhan material per WO terbit, dashboard + laporan RKM. Migrasi 160000 (diubah) dan 210000 BELUM diterapkan ke distriva_db. Prompt frontend: docs/PROMPT-FRONTEND-WAREHOUSES-MAPPING-OUTBOX-REPORTS.md (docs/79).

## 7 Nov 2026 — Token MIMS dari pengguna
POST /master-data/stock-sync: tarik stok dengan token sesi MIMS pengguna yang login (hanya untuk panggilan itu, tidak disimpan — kecuali pengguna memilih `save_token`: tersimpan terenkripsi per pengguna dan dapat dipakai lagi lewat `use_saved_token`, docs/82 §19.15). Draf pemetaan SKU↔KHS: tools/output/pemetaan_khs_sku_kandidat.csv (19 keyakinan tinggi dari 185 kandidat; wajib diverifikasi). Panduan mengunduh contoh respons: docs/62 §42. Migrasi 160000 menambah stock_sync_runs.triggered_by.
