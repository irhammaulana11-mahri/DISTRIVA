# DISTRIVA

**Distribution Management Platform**

DISTRIVA adalah platform terpadu untuk mengelola siklus permohonan Pasang Baru (PB) dan Perubahan/Penambahan Daya (PD), survei dan gambar teknik, perhitungan RAB/KKF, proses persetujuan, pelaksanaan konstruksi, pengelolaan material, serta perencanaan dan alokasi kebutuhan distribusi (RKM).

> Nama proyek yang digunakan: **DISTRIVA**. Ketersediaan merek dagang, domain, dan persetujuan penggunaan identitas PLN belum diverifikasi.

## Status dokumentasi dan cara kerja

- Versi dokumentasi: **3.16.0** (reorganisasi dokumentasi untuk iterative development).
- Tanggal pembaruan: 6 November 2026.
- Repository ini adalah snapshot source v3.15.0 yang ditata ulang dokumentasinya. Reorganisasi ini tidak mengubah source code, migration, database, atau status pengujian aplikasi.
- Pengembangan dilakukan per modul melalui requirement → design → review → implementation → test → verification.
- Tidak ada kewajiban nama asli, tanda tangan, SK, surat tugas, atau dokumen fisik untuk review/pengembangan internal proyek.
- Open issue hanya memblokir bagian yang bergantung langsung padanya; pekerjaan independen tetap dapat berjalan.
- Keamanan, authorization, audit, backup, dan verifikasi target database tetap wajib.
- Status teknis yang tercantum dalam dokumen audit sebelumnya adalah snapshot historis 5 November 2026. Periksa ulang source code dan lingkungan aktual sebelum menganggapnya sebagai kondisi saat ini.

**Panduan utama:** [`docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md`](docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md).


## Tujuan dokumentasi

Folder `docs/` menjadi **single source of truth** untuk kebutuhan bisnis, aturan perhitungan, arsitektur, data, API, dan tahapan pengembangan DISTRIVA. Setiap perubahan keputusan harus diperbarui di dokumen terkait dan dicatat pada `docs/15-DECISIONS-AND-OPEN-ISSUES.md`.

## Struktur repository yang disarankan

```text
DISTRIVA/
├── backend/                 # Laravel API
├── frontend/                # React + Vite
├── services/
│   ├── auto-mto/            # Python OCR/CAD/vision/extraction
│   └── forecasting/         # Python forecasting service
├── database/                # SQL, seed, data dictionary (opsional)
├── docs/
│   ├── 00-PROJECT-OVERVIEW.md
│   ├── 01-BUSINESS-REQUIREMENTS.md
│   ├── 02-SYSTEM-ARCHITECTURE.md
│   ├── 03-ROLES-AND-ACCESS.md
│   ├── 04-BUSINESS-WORKFLOW.md
│   ├── 05-DATABASE-DESIGN.md
│   ├── 06-ERD.md
│   ├── 07-MASTER-DATA-AND-BOM.md
│   ├── 08-RAB-KKF-ENGINE.md
│   ├── 09-APPROVAL-AND-DRAWING.md
│   ├── 10-WAREHOUSE-INVENTORY.md
│   ├── 11-FORECASTING-ML.md
│   ├── 12-RKM-PLANNING.md
│   ├── 13-API-SPECIFICATION.md
│   ├── 14-DEVELOPMENT-ROADMAP.md
│   ├── 15-DECISIONS-AND-OPEN-ISSUES.md
│   ├── 16-FINALIZED-BUSINESS-DECISIONS.md
│   ├── 17-T4-TECHNICAL-DESIGN-STATUS.md
│   ├── 18-CHANGELOG-AND-SUPERSEDED-DECISIONS.md
│   └── PROJECT-CONTEXT-FOR-AI.md
├── .env.example
├── .gitignore
└── README.md
```

- `docs/22-T4.2.1-FOUNDATION-SCHEMA.md` merinci fondasi organisasi dan akses yang telah difinalisasi pada level desain.
- `docs/32-T4.2.1-DESIGN-REVIEW.md` mencatat desain T4.2.1 yang disetujui dan status implementasi/validasinya.
- `docs/34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md` mencatat matrix authorization yang disetujui sebagai desain saja; permission keys dan implementasi tetap pending.
- Addendum v3.7.0 pada dokumen 34 mencatat actor/approval/SoD/scope dan permission candidates sebagai audit desain; gate implementasi tetap BLOCKED.
- Koreksi dokumentasi v3.7.1 menamespace Decision ID lintas domain dan menyelaraskan cross-reference/status issue; tidak mengubah keputusan bisnis atau mengklaim test aplikasi lulus.
- Dokumen 35 mengusulkan model resource/lifecycle O-034 dan tetap `PROPOSED`. O-034 tetap `OPEN/BLOCKING`; audit ada di dokumen 36 dan readiness di dokumen 37. Belum boleh migration, Policy, query scope, atau perubahan database sebelum approval.
- Dokumen 38–43 menganalisis O-036/O-038/O-039/O-041; rekomendasi bukan keputusan final dan seluruh status open/partial tetap berlaku sampai pemilik proses memutuskan.
- Dokumen 44 menampung keputusan pemilik proses yang masih pending; audit konsistensi integrasi tersedia di dokumen 45. `PACKAGE-MANIFEST.json` ada di root, bukan di `docs/`.
- Dokumen 45 v3.11.0 menyatukan rekomendasi actor, lifecycle, authorization, schema, pricing/UOM, report/export serta disposition seluruh open issues untuk review. Dokumen 46 v3.12.0 menyajikan paket rapat dan pilihan owner atas seluruh issue OPEN/PARTIAL; rekomendasi tidak menutup blocker atau mengesahkan implementasi.
- Dokumen 47–50 pertama dibuat pada v3.13.0; audit v3.15.0 memperbarui readiness, remediation, test matrix, dan approval gates. Addendum v3.14.0 mencatat input bahwa approval matrix KKF existing tidak berubah; identitas/kewenangan dan bukti formal belum tersedia, sehingga catatan masih `PENDING`. Status keseluruhan `BLOCKED`; konflik historis Pengawas Jaringan pada dokumen 16 section 9 menunggu klarifikasi berwenang. Detail ada pada dokumen 47.
- `docs/23-T4.2.2-MASTER-DATA-SCHEMA.md` merinci master data yang telah difinalisasi pada level desain, termasuk keputusan SKU ERP, dua sumber harga, dan approval `UP3_MANAGER` untuk versi KHS/BOM.

## Urutan membaca

1. `00-PROJECT-OVERVIEW.md`
2. `01-BUSINESS-REQUIREMENTS.md`
3. `04-BUSINESS-WORKFLOW.md`
4. `03-ROLES-AND-ACCESS.md`
5. `16-FINALIZED-BUSINESS-DECISIONS.md` dan `18-CHANGELOG-AND-SUPERSEDED-DECISIONS.md`
6. `05-DATABASE-DESIGN.md` dan `06-ERD.md`
7. Dokumen modul 07–12
8. `13-API-SPECIFICATION.md`
9. `14-DEVELOPMENT-ROADMAP.md`
10. `17-T4-TECHNICAL-DESIGN-STATUS.md`

## Prinsip penting

- Satu database PostgreSQL sebagai sumber data utama.
- UUID sebagai primary key untuk entitas inti.
- Laravel sebagai backend API; React + Vite sebagai frontend.
- Python dipisahkan sebagai layanan forecasting.
- Hasil perhitungan RAB/KKF harus menyimpan snapshot versi data dan parameter yang digunakan.
- Forecasting menghasilkan rekomendasi, bukan keputusan pengadaan otomatis.
- Persetujuan RKM berada di tingkat UP3; persetujuan RKM berbeda dari proses PO/pengadaan.
- Hak stok ULP dibatasi secara backend/database pada empat kelompok material yang telah ditetapkan.
- Dokumen ini bukan pengganti peraturan, standar teknik, atau keputusan pejabat yang berwenang. Validasi proses bisnis dan regulasi tetap diperlukan.


## T4.2.4 dan bukti runtime v3.2.3

- T4.2.4 diuji pada PostgreSQL 18.6 di database disposable `distriva_t424_test`, memakai contract-minimal dependency fixtures, bukan migration produksi/upstream.
- Positive relational flow lulus, 17/17 negative checks lulus, tiga concurrency uniqueness checks lulus, dan rollback atomik lulus. Bukti lengkap di `test-evidence/2026-11-05-t424-runtime.md`.
- Hasil tersebut tidak membuktikan kompatibilitas dengan migration final T4.2.1–T4.2.3, Laravel policies, Python idempotency, queue retry, atau produksi. Migration T4.2.1 lulus runtime terbatas pada target disposable `distriva_db`, lalu di-rollback; tabel aplikasi tidak tersisa, sementara extension `btree_gist` tetap terpasang dengan persetujuan pengguna. Bukti: `test-evidence/2026-11-05-t421-runtime.md`.

## Strategi pengembangan dan deployment

- Pengembangan dilakukan di PC lokal terlebih dahulu. Project belum dibuat di server Ubuntu.
- Backend Laravel tersedia di `backend/`; frontend React/Vite dan deployment project belum dibuat. Workspace ini belum terdeteksi sebagai Git repository.
- Server Ubuntu dipertahankan untuk aplikasi yang sudah berjalan; deployment DISTRIVA dilakukan setelah pengembangan dan pengujian lokal memadai.
- Database development lokal: PostgreSQL 18.6, database `distriva_db`, user `distriva_user`; koneksi telah diuji berhasil. Jangan menyimpan password di repository.
- Environment lokal terverifikasi: Ubuntu 26.04.1, Node.js 22.22.3, npm 10.9.8, PHP 8.5.4, Composer 2.9.5, PostgreSQL client 18.6, Git 2.53.0. Ekstensi PHP `bcmath`, `zip`, `pdo_pgsql`, dan `pgsql` tersedia.
- PostgreSQL lokal memiliki cluster 18/main online pada port 5432; cluster 16/main pada port 5433 berstatus down dan tidak digunakan untuk DISTRIVA.

## Keputusan terbaru T4.1

- Backend adalah Laravel Modular Monolith; frontend React + Vite + Tailwind.
- PostgreSQL adalah source of truth transaksi internal.
- Redis untuk cache/queue; Reverb untuk realtime.
- Python Auto MTO dan Forecasting adalah service terpisah melalui API Laravel.
- Deployment awal: satu server Ubuntu yang sudah tersedia untuk seluruh komponen aplikasi.
- Dokumen berada pada private storage di luar public web root. Pada server Ubuntu tersedia disk SATA lokal `/dev/sda1` yang telah dipasang permanen di `/srv/distriva-data`; ini bukan NAS atau backup off-site. Kebutuhan backup pada media/server terpisah tetap berlaku.
- Kapasitas hardware server aktual dicatat di `docs/19-SERVER-INVENTORY-AS-BUILT.md`.

## Catatan status

Blueprint v1 dan migration awal yang ada di paket bukan skema final siap produksi. Khususnya, bagian inventory pada blueprint lama telah digantikan oleh keputusan integrasi aplikasi material eksternal. Review dan rekonsiliasi database design/ERD/migrations wajib dilakukan pada T4.2–T4.4 sebelum implementasi.


## Pembaruan v2.5 (5 November 2026)
T4.2.2 memiliki rancangan konseptual master data: material ERP, kategori, satuan/konversi, KHS, konstruksi, BOM, formula aman, dan sinkronisasi staging. Rancangan belum final dan belum diimplementasikan; lihat `docs/23-T4.2.2-MASTER-DATA-SCHEMA.md`.


## Pembaruan v2.6 (5 November 2026)
T4.2.2 telah difinalisasi pada level desain: satu varian material satu kode SKU ERP; harga mendukung sumber eksternal dan master internal per UP3 melalui `material_prices`, dengan snapshot harga terpilih pada calculation run; UP3_MANAGER menyetujui versi master KHS/BOM. Implementasi migration, seeder, integrasi ERP, dan calculation engine belum dimulai.


## Pembaruan v2.7 (5 November 2026)
Keputusan T4.2.2 direvisi: sumber harga menjadi BOTH (eksternal + master internal per UP3) dengan `price_type`/`source_type` dan snapshot; approver master KHS/BOM berubah menjadi UP3_MANAGER. Aturan prioritas harga dan approval perubahan harga internal masih terbuka.


## Pembaruan v2.9 (5 November 2026)
T4.2.3 mencakup rancangan pelanggan dan permohonan PB/PD, impor Bot Daftung staging, referensi agenda/register, histori status eksternal, pembayaran, survei, dan task/SLA. Nomor telepon boleh kosong saat staging tetapi wajib dilengkapi NIAGA_RETAIL sebelum submit resmi. Strategi deduplikasi pelanggan, satuan daya feed, kontrak integrasi, verifikasi pembayaran, kamus status, dan aturan SLA masih terbuka. Belum ada migration atau integrasi yang diimplementasikan.


### Pembaruan v2.9 (5 November 2026)
T4.2.3 mengunci kardinalitas identitas: satu customer dapat memiliki banyak permohonan; IDPEL adalah external reference pada customer dan satu IDPEL dapat terkait dengan banyak permohonan; No. Register pembayaran dan No. Agenda adalah referensi eksternal per permohonan. Ketiga nomor boleh belum tersedia pada awal permohonan. Prosedur rekonsiliasi konflik IDPEL dan detail integrasi masih terbuka. Belum ada migration atau integrasi yang diimplementasikan.


### Pembaruan v3.0 (5 November 2026)
T4.2.3 menetapkan allowlist sinkronisasi status Bot Daftung untuk permohonan existing yang dicocokkan melalui No. Agenda: hanya DURASI_HARI_KERJA, STATUS_PERMOHONAN, dan TGL_UPDATE_PERMOHONAN yang boleh diperbarui. Kolom customer/application lainnya tidak boleh ditimpa; status eksternal tidak mengubah workflow internal. Histori, timestamp sumber, dan waktu sinkronisasi dipisahkan. Belum ada implementasi connector/migration. Lihat `docs/24-T4.2.3-APPLICATIONS-PB-PD-SCHEMA.md`.

## Pembaruan v3.1 (5 November 2026)

T4.2.3 menetapkan pola unduhan Bot Daftung sebagai range-based snapshot berdasarkan tanggal permohonan pertama kali dibuat. File dapat memuat data lama dan baru, batch dapat overlap, dan record yang tidak muncul tidak dianggap dihapus/selesai. `TGL_UPDATE_PERMOHONAN` menjadi acuan kebaruan status. Aturan rinci ada di `docs/25-T4.2.3-BOT-DAFTUNG-SYNC-RULES.md`. Belum ada implementasi connector/importer/migration.


## Update v3.2

T4.2.4 telah direvisi pada level desain, ERD gabungan diperbarui, dan DDL PostgreSQL baseline disediakan pada `docs/26-T4.2.4-DOCUMENTS-AUTO-MTO-SCHEMA.md` dan `docs/27-T4.2.4-POSTGRESQL-DDL.sql`. Seluruhnya belum dijalankan sebagai migration. Lihat `docs/17-T4-TECHNICAL-DESIGN-STATUS.md` untuk status dan batas validasi.


## Supplement v3.2.2 — PostgreSQL Dependency Test Fixtures

Paket ini menambahkan `database/testing/postgresql/` dan dokumen `docs/30-POSTGRESQL-DEPENDENCY-FIXTURES.md` serta `docs/31-POSTGRESQL-FIXTURE-STATIC-REVIEW.md`. Fixture bersifat test-only, bukan migration produksi. Runtime belum dijalankan.


## Documentation v3.2.3 — T4.2.4 runtime evidence

Paket ini mencatat runtime integration test DDL T4.2.4 yang lulus pada PostgreSQL 18.6 dengan contract-minimal dependency fixtures. Bukti rinci ada di `test-evidence/2026-11-05-t424-runtime.md`. Status tersebut tidak berarti migration produksi/upstream telah disetujui.

## Documentation v3.3.0 — T4.2.1 design review

Review menyelaraskan custom scoped assignment dengan Spatie sebagai catalog-only, menambahkan proposal histori assignment, scope authorization, urutan migration/seeder, ERD, serta test matrix. Tidak ditemukan source Laravel atau migration aplikasi di workspace. Proposal menunggu persetujuan pemilik; tidak ada migration/seeder yang dibuat atau dijalankan. Lihat `docs/32-T4.2.1-DESIGN-REVIEW.md` dan `docs/AI-HANDOFF.md`.

## Documentation v3.4.0 — T4.2.1 implementation baseline

Desain T4.2.1 telah disetujui dan baseline Laravel 13.40.0, Sanctum 4.3.3, serta Spatie Permission 8.3.2 dipasang. Migration mengimplementasikan UUID users/assignment/organization, katalog Spatie tanpa user pivots, audit histories, dan constraint/trigger khusus PostgreSQL; RoleSeeder idempotent mencatat event katalog. Guard canonical `web`. Pada checkpoint v3.4.0, full test suite 5/5 (10 assertions), migration up/down, seeder idempotency, dan integrity smoke tests PASS pada PostgreSQL disposable; seluruh tabel aplikasi telah di-rollback dan `btree_gist` tertinggal terpasang. Authorization service/policy saat itu belum ada. Lihat riwayat implementasi pada `docs/32-T4.2.1-DESIGN-REVIEW.md`.

## Documentation v3.5.0 — T4.2.1.1 ScopedAuthorizationService

Fondasi `ScopedAuthorizationService`, model/relasi organisasi dan assignment, konteks scope, serta fail-closed vendor boundary telah ditambahkan. Full suite kini 20/20 tests (30 assertions), termasuk 15 unit tests T4.2.1.1. Tidak ada migration atau koneksi database baru untuk perubahan ini. Policies, permission key final, vendor-domain resolver, PostgreSQL service integration, write/audit path, cache invalidation, concurrency, dan Sanctum UUID end-to-end masih pending. Catatan tahap: `docs/33-T4.2.1.1-SCOPED-AUTHORIZATION.md`; tidak dibuat ZIP baru.

## Documentation v3.6.0 — T4.2.1.2 Policy/resource-scope design

Permission-policy-resource matrix disetujui sebagai baseline desain saja. Permission identifiers, seeder, Policies, query scopes, dan business-resource integration belum dibuat atau disetujui untuk implementasi. Audit aktual menemukan belum ada business resource model/route dan vendor/project/work-order relations; vendor tetap deny-all. README sebelumnya menyebut 19 tests dan dikoreksi: hasil terakhir v3.5.0 adalah 20/20 tests (30 assertions), tidak dijalankan ulang pada checkpoint dokumentasi ini. Evidence: `test-evidence/2026-11-05-t4212-design-audit.md`; detail: `docs/34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md`. Dokumentasi ditambahkan di repository tanpa ZIP.


## Cara membaca dokumentasi

Mulai dari `docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md`, `docs/00-PROJECT-OVERVIEW.md`, `docs/PROJECT-CONTEXT-FOR-AI.md`, dan `docs/AI-HANDOFF.md`. Setelah itu baca hanya spesifikasi modul yang sedang dikerjakan. Dokumen 34–52 dipertahankan sebagai arsip analisis/audit dan bukan gate administrasi aktif.

