# 18 — Change Log dan Koreksi Blueprint Awal

Dokumen ini mencegah keputusan pada blueprint awal v1 yang sudah berubah tetap dianggap berlaku.

## Koreksi penting terhadap v1

| Topik | Pernyataan lama/blueprint v1 | Acuan terbaru |
|---|---|---|
| Discount rate | RWACC otomatis menjadi discount rate | Discount Rate adalah master parameter configurable; RWACC dihitung dan ditampilkan, tidak otomatis menggantikan Discount Rate |
| Inventory | DISTRIVA membangun gudang, saldo, movement, transfer, allocation | Aplikasi material eksternal adalah source of truth; DISTRIVA hanya integrasi dan monitoring read-only |
| ULP stock | Deskripsi awal terbatas pada sebagian varian material | Kebijakan rinci T2: kWh meter 1-phase prepaid/postpaid; semua rating MCB 1-phase; TC 2×10 dan 2×16; TC di ULP dalam meter; material lainnya UP3 |
| Role | Blueprint awal belum memuat katalog final | 14 role aktif; `KONSTRUKSI_ULP` dihapus; `ASMAN_TEKNIK` diganti `ASMAN_KONSTRUKSI`; `ENGINEERING` tetap terpisah |
| Storage | Referensi lama menyebut Google Drive/object storage | Private storage pada server DISTRIVA; keputusan T4.1.2: external storage terpisah dari aplikasi |
| Python | Hanya forecasting service | Dua service Python terpisah: Auto MTO dan Forecasting; komunikasi melalui API Laravel |
| Output KKF | Formulir 5 dan Formulir 7 tercantum sebagai keluaran | Output yang diperlukan: KKF, HPE/Perbandingan BP-RAB, REKAP, REKAP RINCI. Formulir 5 dan 6 tidak diperlukan |
| Forecast material | Berpotensi dipahami sebagai konsumsi aktual | Tahap awal forecast volume pekerjaan dari histori permohonan, lalu konversi material melalui BOM |
| Application workflow | Status umum pada blueprint awal | Ikuti workflow PB/PD T3.2, status external registration terpisah, cabang konstruksi kondisional, pembayaran terverifikasi, meter installation diverifikasi |
| Drawing | Hanya versioning gambar umum | Auto MTO untuk XLS/XLSX, PDF, DWG/DXF, JPG/PNG; verifikasi teknis manusia wajib; dual review UP3 pada versi sama |
| Architecture | Blueprint awal belum memutuskan deployment | T4.1.1 Modular Monolith Laravel; T4.1.2 satu server Ubuntu tersedia + external storage |

## Change log

| Versi | Tanggal | Perubahan |
|---|---|---|
| 1.0 | 2026-11-04 | Blueprint awal DISTRIVA |
| 2.0 | 2026-11-05 | Sinkronisasi keputusan bisnis T1–T3.13, koreksi keputusan yang berubah, penambahan arsitektur T4.1.1 dan infrastruktur T4.1.2 |

## Aturan pemeliharaan

- Dokumen ini menjadi catatan perubahan, bukan pengganti dokumen domain.
- Jika ada konflik, keputusan terbaru yang disetujui pengguna dan dokumen domain terbaru menjadi acuan.
- Perubahan keputusan harus memperbarui dokumen domain terkait dan tabel change log ini.
- Status “disetujui” pada blueprint berarti disetujui pada level bisnis/desain, bukan sudah diimplementasikan, diuji, atau disahkan secara formal oleh organisasi.

| 2.4 | 2026-11-05 | Finalisasi desain T4.2.1; Opsi A Custom Scoped Assignment; `user_role_assignments` sebagai sumber kebenaran; Spatie role/permission catalog saja; update database design, ERD, role/access, decisions, technical status; tambah spesifikasi T4.2.1 |


## v2.5 — 5 November 2026
- Menambahkan rancangan konseptual T4.2.2 pada `23-T4.2.2-MASTER-DATA-SCHEMA.md`.
- Menyelaraskan `05-DATABASE-DESIGN.md`, `06-ERD.md`, `07-MASTER-DATA-AND-BOM.md`, `15-DECISIONS-AND-OPEN-ISSUES.md`, dan `17-T4-TECHNICAL-DESIGN-STATUS.md`.
- Mempertegas ERP sebagai sumber kebenaran master material dan stok; DISTRIVA tidak mengelola inventory.
- Menambahkan usulan tabel KHS/construction/BOM berversi, formula terstruktur aman, staging sinkronisasi, dan change log.
- Menandai `material_prices` opsional dan belum disetujui; kontrak ERP, SKU, master satuan, harga, formula, serta approval authority tetap terbuka.
- T4.2.2 berstatus rancangan konseptual untuk review, belum final dan belum diimplementasikan.


### Versi 2.6 — 5 November 2026

- Finalisasi T4.2.2 pada level desain database berdasarkan konfirmasi pengguna.
- Ditetapkan satu varian material = satu kode SKU ERP tersendiri = satu record `materials`; SKU aktual tetap diverifikasi dari ERP.
- Keputusan awal v2.6 (kemudian direvisi pada v2.7): harga RAB hanya bersumber eksternal tanpa master `material_prices` per UP3; approver KHS/BOM adalah `ASMAN_KONSTRUKSI`.
- Menyelaraskan `05-DATABASE-DESIGN.md`, `06-ERD.md`, `07-MASTER-DATA-AND-BOM.md`, `15-DECISIONS-AND-OPEN-ISSUES.md`, `16-FINALIZED-BUSINESS-DECISIONS.md`, dan `17-T4-TECHNICAL-DESIGN-STATUS.md`.
- Memperbarui `23-T4.2.2-MASTER-DATA-SCHEMA.md` menjadi final pada level desain.
- Tidak ada migration, seeder, integrasi ERP, atau calculation engine yang diklaim telah diimplementasikan.


### Versi 2.7 — 5 November 2026 (revisi keputusan T4.2.2)

- Pengguna merevisi keputusan harga dari EXTERNAL menjadi BOTH: DISTRIVA mendukung sumber eksternal dan master harga internal per UP3 melalui `material_prices`; `price_type` dan `source_type` dibedakan; snapshot harga terpilih disimpan pada calculation run.
- Pengguna merevisi approver master KHS/BOM dari `ASMAN_KONSTRUKSI` menjadi `UP3_MANAGER`; versi approved tetap immutable dan perubahan melalui versi baru.
- Keputusan v2.6 mengenai harga EXTERNAL-only dan approver ASMAN_KONSTRUKSI dinyatakan superseded oleh keputusan v2.7.
- Aturan prioritas pemilihan harga jika dua jalur sama-sama memiliki harga valid, serta approval perubahan harga internal, dicatat sebagai open issues.
- Memperbarui schema T4.2.2, database design, ERD, master data/BOM, decision log, finalized decisions, technical status, README, dan project context. Tidak ada migration atau integrasi yang diimplementasikan.


## v2.8 — 5 November 2026

- Menambahkan desain T4.2.3 untuk pelanggan, permohonan PB/PD, impor Bot Daftung, referensi eksternal, pembayaran, survei, task/SLA, dan histori status.
- Mengonfirmasi kebijakan nomor telepon: boleh kosong saat staging impor, tetapi wajib dilengkapi sebelum submit resmi; NIAGA_RETAIL bertanggung jawab melengkapi.
- Memetakan kolom spreadsheet Bot Daftung (NOAGENDA, NO_REGISTRASI, IDPEL, NAMA, ALAMAT, tarif/daya, transaksi, paket SAR, biaya, tanggal bayar, durasi, kriteria TMP, status, tanggal update).
- Memisahkan nomor agenda dan nomor registrasi; IDPEL sebagai external reference; status eksternal dipisahkan dari status internal.
- Memisahkan total biaya dari pembayaran terverifikasi; TGLBAYAR tidak dianggap bukti pembayaran final tanpa verifikasi.
- Menambahkan isu terbuka: strategi identitas pelanggan, unit daya, kontrak integrasi, payment verification, kamus status, kriteria TMP, formulir survei, dan SLA pause/resume.
- Belum ada migration atau integrasi yang diimplementasikan.


## v2.9 — 5 November 2026

- Mengonfirmasi satu customer internal DISTRIVA dapat memiliki banyak permohonan PB/PD/layanan.
- Menetapkan IDPEL sebagai external reference pada customer; satu IDPEL dapat terkait dengan banyak permohonan, bukan satu nomor per permohonan.
- Menetapkan No. Register (`PAYMENT_REGISTER`) dan No. Agenda (`AGENDA`) sebagai referensi eksternal pada masing-masing application, bukan identitas customer.
- Menegaskan ketiga nomor dapat belum tersedia pada saat permohonan awal dibuat dan ditambahkan saat diterbitkan sistem eksternal.
- Mempertahankan histori penerbitan ulang/koreksi dan melarang auto-merge customer ketika terjadi konflik IDPEL.
- Menyelaraskan schema T4.2.3, database design, ERD, decision log, finalized decisions, technical status, README, project context, dan manifest. Belum ada migration atau integrasi yang diimplementasikan.


## v3.0 — 5 November 2026

- Mengunci aturan sinkronisasi status Bot Daftung untuk permohonan existing: pencocokan berdasarkan No. Agenda yang cocok tepat satu record.
- Membatasi update otomatis hanya pada `DURASI_HARI_KERJA`, `STATUS_PERMOHONAN`, dan `TGL_UPDATE_PERMOHONAN`; seluruh atribut customer/application lain tidak boleh ditimpa oleh jalur ini.
- Menegaskan IDPEL bukan kunci pencocokan permohonan karena satu IDPEL dapat memiliki banyak permohonan.
- Menetapkan perlindungan terhadap data stale dan konflik timestamp, pemisahan timestamp sumber dengan `synced_at`, histori status, dan audit integrasi.
- Menyelaraskan schema T4.2.3, database design, ERD, decisions, finalized decisions, technical status, README, project context, dan manifest.
- Belum ada migration, connector, queue job, atau kode sinkronisasi yang diimplementasikan.

## v3.1 — 5 November 2026

Menambahkan aturan final pola unduhan Bot Daftung: range-based snapshot berdasarkan tanggal permohonan pertama kali dibuat, memuat data lama dan baru, batch overlap diperbolehkan, serta tidak ada penghapusan implisit. `TGL_UPDATE_PERMOHONAN` tetap menjadi acuan kebaruan status.


## v3.2 — 5 November 2026
- Menerapkan koreksi validasi T4.2.4 pada rancangan dokumen, workflow review dan Auto MTO.
- Menambahkan ERD gabungan T4.2.1–T4.2.4 dan DDL PostgreSQL baseline.
- Menambahkan composite FK lintas application/document/version/package/job/attempt/snapshot.
- Menambahkan snapshot actor rules pada review cycle dan relasi assignment ke actor snapshot.
- Menambahkan trigger konsistensi rantai versi dokumen, KHS identity/version, dan BOM header/item/material/formula.
- Menegaskan tidak ada migration atau eksekusi database; desain menunggu persetujuan.


## v3.2.1 — 5 November 2026

- Audit statis lanjutan T4.2.4: memperketat lineage extraction ke paket, item-source lintas paket, dan actor source snapshot.
- Menambahkan unique partial index untuk rule aktif dengan business key yang sama dalam satu template.
- Menambahkan PostgreSQL runtime test plan.
- Tidak ada perubahan pada keputusan bisnis T4.2.1–T4.2.3; tidak ada migration yang dijalankan.


## v3.2.2 — 5 November 2026 — PostgreSQL test fixture supplement

- Menambahkan dependency contract fixtures untuk T4.2.1, T4.2.2, dan contract-minimal T4.2.3.
- Menambahkan runner dengan database guard `distriva_t424_test` dan konfirmasi interaktif.
- Menegaskan fixture bukan migration produksi dan bukan implementasi penuh T4.2.1–T4.2.3.
- Runtime PostgreSQL belum dijalankan; status tetap NOT RUN/BLOCKED sampai pengguna menjalankan runner.


## v3.2.3 — 5 November 2026 — T4.2.4 PostgreSQL runtime evidence

- Mencatat runtime integration test T4.2.4 pada PostgreSQL 18.6, database disposable `distriva_t424_test`.
- Mencatat 32 tabel T4.2.4, 23 indeks eksplisit, 8 function, 10 trigger, serta katalog constraint.
- Mencatat positive relational flow PASS, 17/17 negative checks PASS, tiga concurrency uniqueness checks PASS, dan rollback atomik PASS.
- Memperbarui test plan agar mencatat bahwa `previous_version_id` lintas dokumen ditolak oleh trigger (`P0001`) sebelum composite FK.
- Menambahkan `test-evidence/2026-11-05-t424-runtime.md`.
- Memperbaiki path `DOCS_DIR` pada runner agar mengambil DDL dari root repository.
- Menegaskan bahwa fixture tetap contract-minimal; migration final T4.2.1–T4.2.3, Laravel policy, Python idempotency, queue retry, dan integrasi aplikasi belum diuji.
- Tidak ada migration pada `distriva_db`; tidak ada production migration approval.


## v3.3.0 — 5 November 2026 — T4.2.1 design review and Spatie integration proposal

- Meninjau dokumentasi T4.2.1 terhadap isi workspace aktual; tidak ditemukan source Laravel, Composer manifest, migration, seeder, atau test aplikasi.
- Memperjelas Spatie sebagai catalog-only untuk `roles`, `permissions`, dan `role_has_permissions`; proposal melarang user pivots/Teams/default permission resolver sebagai sumber authorization kedua.
- Menambahkan proposal append-only `user_role_assignment_histories` dan `authorization_change_histories`, ERD foundation yang diperluas, authorization/scope flow, migration dan seeder order, serta test matrix.
- Menegaskan unit wajib untuk role operasional termasuk VENDOR; akses vendor tetap memerlukan relasi vendor-company/project/WO.
- Menandai versi package/guard/permission keys, `btree_gist` provisioning, kode organisasi, dan owner approval sebagai hal yang belum terverifikasi/terbuka.
- Menyelaraskan README, role/access, database design, ERD, roadmap, decision log, technical status, Project Context, Master Prompt, kedua handoff, dan manifest.
- Tidak ada migration, seeder, source code, atau perubahan database yang dibuat/dijalankan. Persetujuan pemilik diminta sebelum implementation migration.


## v3.4.0 — 5 November 2026 — T4.2.1 implementation baseline

- Mencatat persetujuan pemilik atas desain integrasi T4.2.1 dan scaffold backend Laravel 13.40.0, Sanctum 4.3.3, Spatie Permission 8.3.2.
- Membuat migration UUID users/Sanctum, Spatie catalog-only tanpa user pivots, organizational units dan histories, scoped role assignments dan histories, authorization change histories, serta PostgreSQL constraints/triggers termasuk `btree_gist` prerequisite.
- Menambahkan model User/Role, guard canonical `web`, timezone konfigurasi bisnis `Asia/Jakarta`, RoleSeeder idempotent untuk 14 role dengan audit event, serta bootstrap unit tests.
- Verifikasi lokal: full suite 5/5 tests/10 assertions, PHP syntax, Pint, `route:list`, dan `composer validate --strict` lulus. Semua 11 migration di-up lalu di-rollback pada PostgreSQL disposable; RoleSeeder idempotency dan integrity smoke tests lulus.
- Uji awal menemukan urutan Laravel yang menambahkan self-FK organisasi sebelum PK; migration diperbaiki dengan menambahkan FK setelah tabel dibuat. Hasil final: tabel aplikasi di-rollback, tabel `migrations` kosong, dan `btree_gist` tetap terpasang setelah persetujuan eksplisit.
- Mencatat batas: Sanctum UUID end-to-end, concurrency stress, service/policy, assignment write path, permission catalog, dan cache invalidation belum diverifikasi/diimplementasikan. `install:api` sebelumnya gagal pada pemeriksaan SQLite karena PHP `pdo_sqlite` tidak tersedia; route API tetap terdaftar. Bukti runtime: `test-evidence/2026-11-05-t421-runtime.md`.
- Memperbarui README, role/access, database design, ERD, roadmap, decisions, technical status, local environment, foundation schema, design review, Project Context, Master Prompt, handoffs, manifest, dan paket dokumentasi. Paket v3.4.0 diregenerasi agar memuat bukti runtime PostgreSQL T4.2.1 dan checksum terbaru.

## v3.5.0 — 5 November 2026 — T4.2.1.1 ScopedAuthorizationService

- Menambahkan `ScopedAuthorizationService` dengan `user_role_assignments` sebagai satu-satunya sumber assignment dan Spatie `role_has_permissions` sebagai sumber grant permission.
- Menambahkan model/relasi `OrganizationalUnit` dan `UserRoleAssignment`, konteks/mode scope, dan pemeriksaan tanggal assignment inklusif pada timezone bisnis `Asia/Jakarta`.
- Menetapkan exact-unit sebagai default; akses baca UP3 ke ULP anak hanya melalui mode eksplisit. Assignment global `SYS_ADMIN` hanya dapat dipakai untuk konteks system, bukan target bisnis.
- Vendor fail-closed melalui `DenyUnverifiedVendorScopeAuthorizer` sampai relasi vendor-company/project/work-order tersedia; belum ada resolver domain vendor.
- Menambahkan 15 unit tests baru (20 assertions). Full suite lulus 20 tests/30 assertions; tidak ada migration atau database runtime untuk perubahan ini.
- Menyinkronkan README, role/access, roadmap, keputusan, status teknis, changelog, local environment, foundation schema, design review, ScopedAuthorizationService, Project Context, Master Prompt, AI handoff, test evidence, dan manifest.
- Dokumentasi ditambahkan secara aditif ke repository sebagai v3.5.0; tidak membuat ZIP baru sesuai arahan pemilik.

## v3.6.0 — 5 November 2026 — T4.2.1.2 Authorization Policy/Resource Scope Design

- Mengaudit dokumen baseline dan source aktual; memastikan belum ada Laravel Policy, business-resource scope query, atau route bisnis.
- Mencatat matrix desain resource/ability/role/scope yang disetujui sebagai baseline desain saja. Permission keys final, seeder, Policy, dan query implementation tetap menunggu gerbang persetujuan/ketergantungan domain.
- Mempertahankan assignment tunggal `user_role_assignments`, Spatie catalog-only, SAME_UNIT default, descendant-read hanya untuk baca, SYS_ADMIN tanpa akses bisnis implisit, dan vendor fail-closed.
- Mencatat dependency role Pengawas Jaringan, reviewer permohonan, approver final RKM, domain resource, serta relasi vendor/project/WO.
- Menambahkan design record dan audit evidence; memperbaiki status test README yang sebelumnya stale. Tidak ada perubahan kode, migration, database runtime, atau ZIP baru.

## v3.7.0 — 5 November 2026 — T4.2.1.2A Actor, Approval, SoD, and Scope Audit

- Mencatat pilihan desain bahwa fungsi Pengawas Jaringan berada pada `KONSTRUKSI_UP3` dengan kemampuan child-ULP WO verify/inspect yang spesifik; bukan role baru, bukan `UP3_DESCENDANT_READ`, dan belum diimplementasikan.
- Memperjelas RKM: ULP proposer (role konkret masih terbuka), `PERENCANAAN` AND `KONSTRUKSI_UP3` validator sebagai user berbeda, `UP3_MANAGER` final approver, submitter tidak final-approve versi sendiri, dan RKM terpisah dari procurement.
- Menetapkan SoD distinct-user untuk semua approver dalam langkah AND, submitter-versus-final-approver untuk versinya, serta progress submitter-versus-verifier; report mewarisi source permission/scope dan export terpisah per domain.
- Menambahkan D-AUTH-013 (saat itu tercatat sebagai D-040): setiap pemegang assignment efektif `KONSTRUKSI_UP3` pada UP3 terkait dapat verify/inspect seluruh WO child-ULP tanpa assignment WO/task tambahan; hanya aksi khusus itu yang diberikan.
- Menambahkan domain actor/approval matrix untuk application, survey, RKM, WO, progress/completion, meter, RAB/KKF/feasibility; SoD matrix; granular permission candidates; organizational scope matrix; implementasi gate dan test matrix.
- Memperbarui O-033–O-042. O-035, O-040, dan O-042 ditutup berdasarkan pilihan eksplisit dan dokumentasi; permission keys/grants tetap belum final.
- Menyinkronkan D-AUTH-013/O-042 ke dokumen workflow, keputusan, roadmap, technical status, Master Prompt, Project Context, AI-HANDOFF, dan audit evidence; meregenerasi checksum manifest v3.7.0.
- Static audit menemukan belum ada business resource model, Policy, query scope, middleware authorization bisnis, maupun route domain. Vendor tetap fail-closed; child-WO scope belum ada di service.
- Tidak ada perubahan source, migration, seeder, configuration, database, atau automated test. Git status tidak tersedia karena workspace bukan Git repository.
- Memperbarui dokumen terkait dan manifest secara aditif; tidak membuat ZIP.

## v3.7.1 — 5 November 2026 — Documentation Integrity & Decision ID Correction

- Mengaudit definisi dan referensi Decision ID/Open Issue ID di decision register, authorization design, handoff, changelog, dan dokumen terkait.
- Menetapkan namespace domain untuk keputusan T4.2.1 authorization (`D-AUTH-*`), master data (`D-MDM-*`), dan PB/PD (`D-PBPD-*`); mempertahankan D-001–D-026 yang unik dan tidak menggunakan ulang ID legacy.
- Menambahkan mapping old/new ID beserta domain, judul, dan referensi terdampak pada decision register; memperbarui referensi silang di seluruh dokumen terkait.
- Menegaskan baseline historis v3.6.0 dan addendum keputusan terbaru v3.7.0 pada dokumen authorization; permission keys/grants tetap belum final dan Policy/query scope/domain authorization belum diimplementasikan.
- Mengaudit status O-001–O-042; mempertahankan isu terbuka/parsial, memberi alasan/dependency pada blocker, serta tidak menutup issue berdasarkan rekomendasi.
- Menyelaraskan README, Master Prompt, AI-HANDOFF, changelog, manifest dan bukti audit dokumentasi. Hash manifest diregenerasi dan diverifikasi.
- Dokumentasi saja: tidak ada source, migration, seeder, Policy, query scope, database atau automated test yang diubah/dijalankan. Tidak membuat ZIP.

## v3.8.0 — 5 November 2026 — O-034 Resource Model Proposal Audit

- Mengaudit proposal resource/lifecycle O-034 terhadap foundation, master data, applications PB/PD, document/Auto MTO, authorization design, decision register, serta dokumen pendukung.
- Mempertahankan status dokumen 35 `PROPOSED` dan O-034 `OPEN/BLOCKING`; mencatat konflik/pertanyaan tanpa mengubah keputusan APPROVED.
- Membuat audit 36 dan readiness 37; memperbarui register O-034, Authorization Policy Design, AI-HANDOFF, README, Master Prompt, Technical Status, dan manifest.
- Memperbaiki referensi path T4.2.4 di dokumen 35 berdasarkan file aktual `26-T4.2.4-DOCUMENTS-AUTO-MTO-SCHEMA.md`.
- Manifest SHA-256 dan ukuran file diregenerasi dari file aktual. Tidak ada source, migration, seeder, Policy, query scope, API atau database yang diubah; application tests/database actions tidak dijalankan; tidak ada ZIP.

## v3.9.0 — 5 November 2026 — O-036/O-038/O-039/O-041 Decision Analysis

- Menganalisis keputusan baseline dan pertanyaan pemilik proses untuk application/RKM, survey/meter, Work Order, serta RAB/KKF/feasibility.
- Membuat dokumen 38–43 berisi actor/lifecycle matrices, opsi dan rekomendasi PROPOSED, cross-domain resource relation, dependency dan readiness.
- Memperbarui Decision Register, dokumen proposal/audit/readiness O-034, Technical Design Status, README, Master Prompt, AI-HANDOFF, dan manifest.
- Mempertahankan status O-036 PARTIAL/OPEN, O-038 OPEN, O-039/O-041 OPEN/BLOCKING, O-034 OPEN/BLOCKING; tidak ada keputusan bisnis baru yang diangkat menjadi APPROVED.
- Dokumentasi saja; tidak ada source code, migration, seeder, Policy, query scope, API, frontend, service Python, atau database yang diubah. Tidak ada application test atau migration yang dijalankan; tidak ada ZIP.

## v3.10.0 — 5 November 2026 — Owner Decision Register Audit and Integration

- Mengaudit draft `docs/44-OWNER-DECISION-REGISTER.md` terhadap keputusan terdahulu, schema T4.2.1–T4.2.4, authorization design dan analisis O-034/O-036/O-038/O-039/O-041.
- Memperjelas bahwa PENDING pada konfirmasi baseline tidak membatalkan keputusan existing; meluruskan tiga field WO yang keliru meminta konfirmasi ulang atas baseline approved.
- Mencatat D-018 sebagai historical/superseded oleh keputusan Discount Rate pada docs 08/16; D-021 sebagai keputusan awal yang diperluas oleh D-MDM-001. Tidak menghapus keputusan historis dan tidak menetapkan owner decision baru.
- Membuat audit 45; memperbarui register 15, owner register 44, proposal 35, analisis 38–43, Technical Status, README, Master Prompt, AI-HANDOFF dan manifest.
- `docs/README.md`/`docs/CHANGELOG.md` tidak tersedia; menggunakan `README.md` root dan dokumen changelog yang ada di `docs/18-CHANGELOG-AND-SUPERSEDED-DECISIONS.md`. Manifest yang ada adalah `PACKAGE-MANIFEST.json` di root.
- Dokumentasi saja; tidak ada source code, migration, seeder, Policy, query scope, API, frontend, service Python, atau database yang diubah. Application tests tidak dijalankan; tidak ada ZIP.

## v3.11.0 — 5 November 2026 — Open-Issue Resolution Recommendations for Owner Review

- Memperluas dokumen 34 dengan consolidated permission/action/role/scope/SoD/export matrix sebagai proposal; tidak ada permission identifier yang difinalkan atau role grant yang disetujui.
- Memperluas proposal O-034 pada dokumen 35 dengan resource inventory, ER/cardinality summary, lifecycle, constraints/indexes, transaction and version contract; status tetap `PROPOSED` dan O-034 `OPEN/BLOCKING`.
- Menambahkan rekomendasi role/lifecycle konkret pada dokumen 38–41, integrasi domain pada dokumen 42, serta disposition semua isu open/partial yang tercatat pada dokumen 43.
- Menemukan dan mengoreksi konflik historis di dokumen 16: T4.2.2 terbaru mendukung harga eksternal+internal per-UP3 (D-MDM-001) dan `UP3_MANAGER` menyetujui KHS/BOM (D-MDM-002); keputusan lama tetap ditandai superseded.
- Memperbarui dokumen 15–18, 34–45, `PROJECT-CONTEXT-FOR-AI.md`, README, Master Prompt, AI-HANDOFF dan root manifest. Owner Decision Register tetap draft/pending; tidak ada issue yang ditutup oleh rekomendasi.
- Documentation/design only. No application source, migration, database, seeder, Policy, query scope, API or production data changed; application tests not run; no ZIP.

## v3.12.0 — 5 November 2026 — Owner Decision Approval Pack

- Membuat `docs/46-OWNER-DECISION-APPROVAL-PACK.md` sebagai paket rapat untuk seluruh 37 issue OPEN/PARTIAL yang tercatat, dengan decision sheets prioritas untuk O-039/O-029/O-036/O-038/O-041/O-033/O-034/O-037.
- Memisahkan baseline APPROVED dari rekomendasi PROPOSED dan pilihan PENDING; decision IDs hanya usulan untuk dicatat setelah pemeriksaan uniqueness di register 44.
- Menambahkan pilihan, konsekuensi, kebutuhan bukti/otoritas, entry form, dependency matrix, dan empat approval gates berurutan; tidak mengarang owner, tanggal, tanda tangan atau keputusan.
- Memperbarui README, Project Context, Master Prompt, Technical Design Status, AI-HANDOFF dan root manifest agar menunjuk baseline dokumentasi v3.12.0. Register 44 dan status issue tidak diubah; keputusan baru tetap PENDING dan implementasi BLOCKED.
- Documentation-only. Tidak ada source code, migration, database, seeder, Policy, query scope, API, frontend atau data produksi yang diubah. Application tests tidak dijalankan; tidak ada ZIP.

## v3.13.0 — 5 November 2026 — Implementation Readiness Audit

- Mengaudit dokumen 15–18/22–27/34–46 serta backend, environment dan komponen repository aktual tanpa menghubungkan database. Status keseluruhan tetap `BLOCKED`; T4.2.1 foundation readiness tidak dianggap kesiapan domain atau produksi.
- Menambahkan laporan audit 47, remediation plan 48, readiness test matrix 49, dan implementation approval register 50. Keputusan owner/evidence tetap pending; tidak ada blocker bisnis ditutup.
- Menambahkan dua route-level feature tests tanpa database untuk guest denial dan UUID user pada Sanctum guard. Final suite `22 tests / 33 assertions PASS`; Pint dan Composer validation PASS. Bearer-token/database-backed E2E tidak dijalankan karena `pdo_sqlite` tidak tersedia dan target PostgreSQL disposable belum diotorisasi.
- Mengidentifikasi konflik historis pada `docs/16` section 9 tentang Pengawas Jaringan versus keputusan v3.7.0. Konflik dicatat untuk klarifikasi berwenang, tidak diedit atau diselesaikan sepihak.
- Memperbarui README, AI-HANDOFF, Project Context, Master Prompt, Technical Design Status, Decisions/Open Issues change log, dan root manifest ke v3.13.0. Tidak ada migration/database query, source domain, permission grant, Policy, query scope, API, frontend, atau Python service yang dibuat.
- Repository bukan Git worktree; status branch/diff tidak tersedia. Tidak ada ZIP.

## v3.14.0 — 5 November 2026 — KKF Approval-Matrix Confirmation Capture

- Mencatat klarifikasi bahwa approval matrix KKF existing tetap berlaku dan tidak ada perubahan yang diminta; redaksi awal yang dapat dibaca sebagai usulan alokasi approver berbeda tidak diadopsi, dan tidak ada approver, role, atau tahap baru yang ditambahkan.
- Identitas/jabatan/unit pemberi input, kewenangan formal, tanggal keputusan formal, dan bukti notulen/SOP/surat/delegasi belum tersedia. Catatan di dokumen 44 berstatus `PENDING` untuk verifikasi formal; bukan keputusan baru yang berstatus `APPROVED`.
- O-041 tetap `OPEN/BLOCKING`; aktor kalkulasi/review, lineage RAB-KKF, pricing/UOM, feasibility, serta bukti sumber masih terbuka. Readiness dan implementasi tetap `BLOCKED`.
- Memperbarui dokumen 15, 41, 44, 47, AI-HANDOFF, README, Project Context, Master Prompt, dan manifest. Dokumentasi saja; tidak ada perubahan source code, migration, database, seeder, Policy, query scope, API, atau data produksi. Test aplikasi tidak dijalankan; validasi dokumentasi dan checksum manifest dilakukan.

## v3.15.0 — 5 November 2026 — Backend Readiness Re-audit

- Membaca ulang seluruh 27 dokumen wajib pada prompt backend dan membandingkannya dengan source/config aktual. T4.2.1 tetap baseline implementasi terbatas; O-033/O-034/O-039/O-041 tetap `OPEN/BLOCKING`, dokumen 35 `PROPOSED`, dan implementasi domain tetap `BLOCKED`.
- Menemukan `backend/.env` memilih SQLite dengan `DB_PORT=3306`, sementara prompt dan `.env.example` mensyaratkan PostgreSQL 18.6 pada port 5432. Test database `distriva_backend_test` disebutkan tetapi belum diverifikasi; tidak ada database yang dihubungi.
- Menjalankan validasi non-database dengan `DB_CONNECTION=sqlite`, `DB_DATABASE=:memory:`, `DB_URL` kosong, dan `APP_ENV=testing`: suite 22 tests/33 assertions, Composer validation, Pint, dan API route listing lulus. Ini bukan bukti bearer-token persisted E2E atau PostgreSQL integration.
- Memperbarui audit 47, remediation plan 48, test matrix 49, approval register 50, technical status 17, README, AI-HANDOFF, Project Context, Master Prompt, decisions log 15, dan manifest; menambahkan test evidence `test-evidence/2026-11-05-backend-readiness-audit.md`.
- Tidak ada source code, `.env`, migration, seeder, permission grant, Policy, query scope, database, atau data produksi yang diubah. Tidak ada migration/rollback atau ZIP. Git status tidak tersedia karena workspace bukan Git worktree.


## v3.16.0 — Reorganisasi dokumentasi dan iterative development (6 November 2026)

- Menambahkan `docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md` sebagai panduan aktif tata cara dokumentasi dan pengembangan.
- Menata ulang README, roadmap, open-issues guidance, AI handoff, dan master prompt agar pengembangan dilakukan iteratif per modul.
- Menetapkan bahwa nama asli, tanda tangan, SK, surat tugas, dan dokumen fisik bukan prasyarat review/pengembangan internal proyek.
- Menegaskan bahwa open issue hanya memblokir bagian yang bergantung langsung padanya; issue dan keputusan substantif tidak otomatis ditutup.
- Menandai dokumen 44–50, 52, dan draft Doc 50 sebagai referensi historis, bukan gate administrasi aktif.
- Tidak mengubah source code, migration, database, permission grants, keputusan bisnis final, atau status issue.
- Tidak menjalankan PHP/Composer/npm tests atau koneksi database pada checkpoint dokumentasi ini.

## 6 November 2026 — Aktivasi akun dan pemulihan dengan OTP (menggantikan password awal dari administrator)

**Keputusan pemilik proyek:** penambahan pengguna tetap dilakukan administrator lewat web, tetapi **aktivasi awal** dan **pemulihan akun terblokir/lupa password** dilakukan pengguna sendiri dengan **kode OTP yang dikirim lewat email atau WhatsApp**.
**Menggantikan** dari `docs/16` (keamanan akun): "Password awal random, sekali pakai, dikirim melalui email dan WhatsApp bila tersedia; kedaluwarsa default 24 jam configurable; wajib diganti saat login pertama." Administrator tidak lagi menerbitkan atau mengetahui password apa pun. Implementasi sementara berbasis password awal (6 Nov 2026 pagi, `docs/55` versi lama) dihapus.
**Tetap berlaku** dari `docs/16`: recovery memakai OTP email/WhatsApp dan mengakhiri sesi aktif; lockout 5 gagal/15 menit; kebijakan password; idle timeout 30 menit.
**Pengecualian disengaja:** administrator pertama (bootstrap konsol) memakai password dari perintah `distriva:bootstrap-admin` karena belum ada kanal/akun yang dapat mengirim OTP. Detail: `docs/55`, `docs/56`.

