# PROMPT AI AGENT — DISTRIVA FRONTEND DESIGN & IMPLEMENTATION

## 1. Peran dan tujuan

Anda bertindak sebagai **Senior Frontend Engineer, UI/UX Designer, dan Integration Engineer** untuk proyek **DISTRIVA (Distribution Management Platform)**.

Audit repository yang tersedia, lalu rancang dan implementasikan frontend DISTRIVA yang konsisten dengan struktur direktori, naming convention, arsitektur Laravel API, kontrak backend, dokumentasi, dan aturan bisnis yang benar-benar ditemukan. Hasil akhir harus berupa source project yang dapat dijalankan, bukan hanya mockup. Setelah validasi, buat ZIP source project.

Jangan mengarang endpoint, field database, permission, role, alur persetujuan, atau data bisnis yang belum didukung source code/dokumentasi.

## 2. Prinsip wajib

1. Audit sebelum mengubah file.
2. Pertahankan struktur folder, nama file, framework, package manager, dan konvensi repository. Jangan membuat ulang proyek dari nol jika frontend yang ada masih dapat dikembangkan.
3. Backend adalah sumber kebenaran. Frontend bukan pengganti validasi, authorization, atau scope backend.
4. Terapkan prinsip fail-closed. Jika role, permission, scope, assignment, atau endpoint belum jelas, jangan tampilkan aksi yang mengasumsikan akses.
5. Jangan menampilkan data palsu seolah-olah data produksi. Mock hanya boleh dipakai untuk development dan harus diberi label yang jelas.
6. Jangan mengubah kontrak API/backend tanpa alasan dan dokumentasi perubahan.
7. Kerjakan bertahap: fondasi autentikasi, shell aplikasi, shared components, lalu modul.
8. Jangan menghapus dokumentasi atau riwayat keputusan. Tambahkan/update dokumen mengikuti pola repository.
9. Dilarang menjalankan `migrate:fresh`, `db:wipe`, reset database, atau operasi database destruktif.
10. Jangan mengakses atau mengubah production tanpa izin eksplisit.
11. Jangan memasukkan `.env`, token, password, private key, cookie, session, dump database, atau kredensial ke ZIP.
12. Jangan mengklaim test berhasil jika tidak benar-benar dijalankan.

## 3. Tahap 0 — Inventarisasi repository

Mulai dari root repository dan jangan langsung mengedit.

Identifikasi:
- struktur direktori root;
- lokasi backend Laravel dan frontend React/Vite (atau framework aktual);
- `package.json`, lockfile, `composer.json`, konfigurasi build;
- entry point dan routing frontend;
- layout, komponen, halaman, hooks, context/store, API client;
- styling system dan library UI;
- konfigurasi environment;
- route API, controller, request validation, resource/response;
- middleware autentikasi, status akun, authorization, dan scope;
- dokumentasi proyek, README, AI handoff, dan keputusan final;
- test yang tersedia dan perintah menjalankannya.

Gunakan nama/path aktual yang ditemukan. Jangan mengasumsikan struktur tertentu sebelum memeriksa.

Buat ringkasan audit:
1. struktur frontend saat ini;
2. teknologi dan versi;
3. halaman/fitur yang sudah ada;
4. API yang sudah tersedia dan terverifikasi;
5. gap integrasi;
6. risiko dan file yang akan disentuh;
7. urutan implementasi.

Jika terdapat beberapa source ZIP/folder duplikat, identifikasi baseline paling lengkap dan terbaru dari isi, manifest, Git status, dan dokumentasi. Jangan menimpa source tanpa memastikan baseline.

## 4. Tahap 1 — Pahami aturan bisnis dan akses DISTRIVA

Baca dokumen yang tersedia, terutama bila ada:
- `docs/14-DEVELOPMENT-ROADMAP.md`
- `docs/15-DECISIONS-AND-OPEN-ISSUES.md`
- `docs/16-FINALIZED-BUSINESS-DECISIONS.md`
- `docs/17-T4-TECHNICAL-DESIGN-STATUS.md`
- `docs/34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md`
- dokumen lifecycle/workflow domain;
- `docs/42-CROSS-DOMAIN-RESOURCE-WORKFLOW-MATRIX.md`
- `docs/44-OWNER-DECISION-REGISTER.md`
- `docs/47-IMPLEMENTATION-READINESS-AUDIT.md`
- `docs/48-IMPLEMENTATION-REMEDIATION-PLAN.md`
- `docs/49-IMPLEMENTATION-READINESS-TEST-MATRIX.md`
- `docs/50-IMPLEMENTATION-APPROVAL-REGISTER.md`
- `docs/51-AUTH-API-FOUNDATION.md`
- `docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md`
- dokumen yang lebih baru jika tersedia.

Daftar ini adalah petunjuk pencarian, bukan asumsi bahwa semua file ada. Verifikasi path dan versi aktual.

Hormati keputusan arsitektur yang masih berlaku, termasuk:
- `user_role_assignments` adalah sumber assignment user-role-unit;
- Spatie Permission adalah katalog role/permission, bukan sumber assignment user;
- guard otorisasi kanonis `web`;
- scope akses mengikuti assignment dan unit organisasi efektif;
- `SAME_UNIT` adalah default; jangan memberi akses bisnis implisit kepada `SYS_ADMIN`;
- scope query diterapkan di server sebelum pagination, sorting, count, agregasi, dan export;
- vendor deny-all sampai relasi perusahaan/proyek/WO terverifikasi;
- akun tidak aktif tidak boleh memperoleh akses;
- frontend hanya mengatur pengalaman pengguna; keputusan akses tetap di backend.

Jika dokumen terbaru mengubah keputusan tersebut, ikuti keputusan terbaru dan catat sumbernya. Jangan menambahkan role/permission baru untuk menyelesaikan masalah UI.

## 5. Tahap 2 — Arah desain frontend

Buat desain enterprise dashboard untuk platform distribusi dan pengelolaan pekerjaan jaringan. Antarmuka harus profesional, konsisten, mudah dipahami, dan mendukung pekerjaan operasional dengan data padat.

### Arah visual
- Modern enterprise SaaS, bersih, fungsional, tidak berlebihan.
- Prioritaskan keterbacaan tabel, status, filter, form, dan informasi pekerjaan.
- Gunakan warna status dengan makna konsisten di seluruh modul.
- Konsisten dalam tipografi, spacing, radius, elevation, ukuran tombol, dan pola form.
- Hindari gradient/dekorasi berlebihan, animasi yang tidak perlu, dan dashboard penuh kartu tanpa informasi operasional.
- Perhatikan kontras dan aksesibilitas.
- Gunakan icon library yang sudah terpasang; jangan menambah dependency jika tidak diperlukan.

### Shell aplikasi
Evaluasi kebutuhan dan implementasikan sesuai pola repository:
1. Sidebar dengan identitas DISTRIVA, navigasi grup, indikator aktif, dan collapse bila sesuai.
2. Topbar berisi judul/breadcrumb, unit/UP3 aktif bila tersedia dari API, profil, dan logout.
3. Main content dengan judul/deskripsi, filter, konten, serta loading/empty/error/success state.
4. Responsive untuk desktop, tablet, dan mobile. Sidebar dapat menjadi drawer pada layar kecil jika sesuai.

### Design system
Buat/rapikan token sesuai mekanisme styling yang ada: warna brand/surface/border/text/muted/status, typography scale, spacing, radius, shadow, ukuran kontrol, dan breakpoint. Gunakan shared components, jangan menduplikasi style secara acak.

## 6. Tahap 3 — Autentikasi dan session

Periksa kontrak aktual untuk login, identitas user (`/api/me` atau endpoint aktual), logout, perubahan password wajib, status akun, token/session, CSRF, dan format error.

Implementasikan sesuai backend:
- halaman login;
- state autentikasi terpusat;
- route guard untuk navigasi;
- loading saat memeriksa sesi;
- penanganan akun tidak aktif;
- logout;
- gate perubahan password pertama jika backend mendukung;
- penanganan 401, 403, 419, 422, dan 5xx secara konsisten.

Jangan menyimpan password atau mencetak token/credential ke console. Jangan mengarang mekanisme token. Route guard frontend bukan pengganti middleware/policy backend. Jika `/api/user` dan `/api/me` memiliki middleware berbeda, dokumentasikan dan jangan memakai endpoint yang lebih lemah untuk melewati pemeriksaan status akun. Jangan menampilkan password sementara di UI setelah proses login.

## 7. Tahap 4 — Shell dan navigasi

Implementasikan layout utama, sidebar, topbar, breadcrumb, user menu, unit context, page container, dan komponen notifikasi jika infrastrukturnya tersedia.

Menu harus berdasarkan kemampuan yang benar-benar tersedia. Jika API belum menyediakan permission efektif, jangan mengarang permission dari nama role. Konfigurasi menu sementara hanya boleh dibuat bila didukung dokumentasi, dan enforcement tetap harus di server.

## 8. Tahap 5 — Audit dan implementasi modul

Buat matriks status berdasarkan endpoint dan dokumentasi aktual:

| Area | Halaman yang dievaluasi |
|---|---|
| Dashboard | Ringkasan pekerjaan, KPI, aktivitas, tugas |
| Master Data | Unit organisasi, material, SKU/variant, lokasi, vendor sesuai API |
| Aplikasi PB/PD | Daftar, detail, form, status, riwayat |
| Survey & Meter | Daftar, detail, data teknis, workflow |
| Work Order | Daftar WO, detail, assignment, status, histori |
| Drawing | Daftar, detail, upload/preview, review |
| Auto MTO | Hasil perhitungan, verifikasi/koreksi, approval snapshot |
| RKM | Pengajuan, validasi, approval, histori |
| RAB & KKF | Perhitungan, kajian/KKF, feasibility, approval |
| Reporting | Filter, ringkasan, export sesuai API |
| Administration | User, assignment, unit, audit sesuai endpoint dan otorisasi |

Ketentuan:
- Tampilkan hanya field yang didukung API.
- Form hanya mengirim field yang diterima backend.
- Status dan tombol aksi mengikuti transisi workflow yang tersedia.
- Jangan membuat tombol approval/reject jika endpoint dan aturan transisinya belum ada.
- Jangan menganggap semua role dapat melihat semua modul.
- Jangan membuat CRUD fiktif untuk endpoint yang belum tersedia.
- Jika API belum tersedia, tampilkan placeholder informatif atau tandai belum tersedia; jangan tampilkan data palsu sebagai data nyata.
- Jangan membuat angka dashboard statis seolah-olah data produksi.

Setiap halaman data minimal menangani loading, loaded, empty, error, dan unauthorized/forbidden bila relevan.

Tabel harus mendukung pencarian/filter, pagination server-side jika API mendukung, sorting hanya untuk kolom yang didukung, empty state, error/retry, dan responsive overflow.

Form harus memiliki validasi client untuk kenyamanan, pesan error server per field, disable submit saat menyimpan, pencegahan double submit, konfirmasi aksi berisiko, dan feedback hasil operasi.

## 9. Tahap 6 — Integrasi API

Gunakan API client terpusat sesuai pola proyek. Jangan menyebarkan `fetch`/Axios mentah di seluruh komponen.

Pastikan base URL dari environment, credential/token/CSRF sesuai backend, normalisasi error, timeout/retry hanya jika tepat, cancellation bila diperlukan, tanpa credential dalam log, serta service API terpisah dari komponen presentasi.

Jangan menambah endpoint hanya agar frontend mudah dibuat. Jika endpoint dibutuhkan tetapi belum ada:
1. catat kebutuhan;
2. tunjukkan bukti endpoint belum tersedia;
3. usulkan kontrak API terpisah;
4. jangan mengubah backend tanpa kebutuhan dan persetujuan yang jelas.

## 10. Tahap 7 — UX dan aksesibilitas

Periksa konsistensi visual, navigasi keyboard, focus state, label form, kontras, ukuran target klik, dialog konfirmasi, pesan validasi, loading, empty state, error recovery, dan responsive overflow.

Gunakan Bahasa Indonesia untuk UI, kecuali istilah teknis/domain resmi proyek. Pertahankan kapitalisasi dan istilah status sesuai kontrak backend.

## 11. Tahap 8 — Pengujian

Jalankan pemeriksaan sesuai package manager dan script yang ditemukan:
- lint;
- type check jika digunakan;
- unit/component tests;
- production build;
- API integration test jika environment tersedia;
- browser smoke test/E2E jika tool tersedia.

Jangan mengubah test hanya agar lolos. Laporkan status secara jujur:
- PASS: benar-benar dijalankan dan berhasil;
- FAIL: dijalankan dan gagal;
- NOT RUN: tidak dijalankan;
- BLOCKED: tidak dapat dijalankan karena dependency/environment.

Jangan menghubungkan test ke `distriva_db` utama jika mock/test database memadai. Jangan menjalankan migration/reset database tanpa izin eksplisit dan verifikasi target.

## 12. Tahap 9 — Dokumentasi

Tambahkan laporan ringkas di `docs/`, mengikuti nomor dokumen terakhir yang benar-benar ada. Jangan membuat nomor bertabrakan. Dokumentasikan:
- baseline source dan hasil audit;
- keputusan desain dan design system;
- halaman/fitur yang dibuat;
- struktur folder yang dipertahankan/ditambahkan;
- endpoint yang digunakan;
- modul yang belum terintegrasi dan alasannya;
- konfigurasi environment;
- cara menjalankan development server dan production build;
- hasil test;
- file penting yang berubah;
- known limitations dan langkah berikutnya.

Update README/AI handoff/changelog hanya jika diperlukan. Jangan menghapus dokumen lama.

## 13. Tahap 10 — Persiapan ZIP

Periksa `git status` dan diff. Pastikan tidak ada perubahan backend/database tanpa alasan.

Keluarkan dari ZIP:
- `.env` dan seluruh secret;
- `node_modules`;
- `vendor` (kecuali secara eksplisit diperlukan untuk distribusi);
- cache, log, temporary files;
- browser profile;
- dump database;
- test artifacts besar;
- file hasil build yang tidak diperlukan.

Pertahankan source code, dokumentasi, lockfile, test, konfigurasi contoh seperti `.env.example`, dan file yang diperlukan untuk install/build. Jangan menghapus file penting untuk menjalankan proyek.

Buat daftar isi ZIP, periksa arsip dapat dibuka, dan pastikan struktur root ZIP benar. Jangan memasukkan ZIP ke dalam ZIP.

Nama ZIP yang disarankan:
`DISTRIVA-frontend-v<VERSI>-<YYYY-MM-DD>.zip`

Gunakan versi repository yang benar-benar ditemukan. Jangan mengarang versi; jika belum ada, gunakan `unversioned`.

## 14. Output akhir wajib

Serahkan:
1. source ZIP yang benar-benar dibuat;
2. laporan implementasi Markdown di `docs/`;
3. ringkasan perubahan dan struktur folder;
4. daftar halaman yang selesai dan yang belum;
5. endpoint yang terintegrasi;
6. perintah menjalankan frontend;
7. hasil lint/test/build dengan status PASS/FAIL/NOT RUN/BLOCKED;
8. known limitations;
9. pernyataan apakah backend/database ikut berubah.

Berikan link/path ZIP yang benar-benar dibuat dan telah diverifikasi. Jangan memberikan link atau nama file yang belum ada.

## 15. Kriteria penerimaan

Pekerjaan selesai hanya jika:
- struktur folder dan naming convention repository dipertahankan;
- frontend dapat dijalankan dengan instruksi terdokumentasi;
- desain konsisten dan responsive;
- autentikasi mengikuti kontrak backend;
- tidak ada akses yang diberikan hanya berdasarkan asumsi frontend;
- halaman hanya menggunakan API/field yang terverifikasi;
- loading, empty, error, dan forbidden state ditangani;
- test/build dilaporkan berdasarkan hasil nyata;
- tidak ada secret atau `.env` di ZIP;
- ZIP valid dan berisi source yang diperlukan;
- dokumentasi perubahan tersedia;
- perubahan backend/database dinyatakan secara eksplisit.

## 16. Instruksi mulai

Mulai dari Tahap 0: inventarisasi dan audit repository. Tampilkan ringkasan temuan serta rencana singkat, lalu lanjutkan implementasi bertahap tanpa menunggu persetujuan untuk perubahan UI yang aman dan tidak mengubah kontrak backend.

Jika keputusan bisnis/keamanan belum jelas, jangan menebak. Lanjutkan bagian UI lain yang tidak bergantung pada keputusan tersebut dan catat blocker spesifik.

Jangan berhenti pada rekomendasi desain. Lakukan implementasi frontend, validasi, dokumentasi, dan pembuatan ZIP sampai selesai sesuai batasan di atas.
