# Project Context for AI Coding Assistants

> **Panduan kerja aktif v3.16.0:** baca `docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md`. Pengembangan berlangsung iteratif per modul. Nama asli, tanda tangan, SK/surat tugas, dan dokumen fisik bukan prasyarat review/pengembangan internal. Open issue hanya memblokir pekerjaan yang bergantung langsung padanya. Kontrol keamanan dan keselamatan database tetap wajib.

Baca `README.md`, `docs/16-FINALIZED-BUSINESS-DECISIONS.md`, `docs/17-T4-TECHNICAL-DESIGN-STATUS.md`, dan dokumen domain terkait sebelum mengubah kode DISTRIVA. Jika blueprint v1 bertentangan dengan keputusan final, ikuti dokumen keputusan terbaru dan catat koreksi.

## Identitas dan stack

- Nama: DISTRIVA — Distribution Management Platform.
- Backend: Laravel API, Modular Monolith.
- Frontend: React + Vite + Tailwind CSS.
- Database: PostgreSQL; source of truth transaksi internal.
- Authentication: Laravel Sanctum.
- Authorization: Spatie Permission + custom organizational scope.
- Queue/cache: Redis + Laravel Queue.
- Realtime: Laravel Reverb.
- Python services: Auto MTO dan Forecasting, keduanya berkomunikasi melalui API Laravel dan tidak mengakses PostgreSQL produksi secara langsung.
- Charts: Recharts.
- Storage: private external document storage, terpisah dari application server.
- Initial deployment: satu server Ubuntu tersedia untuk seluruh komponen aplikasi; storage dokumen terpisah.

## Aturan yang tidak boleh dilanggar

1. PD memakai delta daya (daya baru − daya lama); PB daya lama = 0.
2. Discount Rate adalah master parameter configurable; RWACC dihitung dan ditampilkan, bukan otomatis menggantikan Discount Rate.
3. Zona jasa ditetapkan per UP3.
4. KAJIAN terpisah dari RAB.
5. Satu sumber harga material yang konsisten.
6. Setiap perhitungan menyimpan snapshot versi master, input, parameter, dan hasil.
7. Aplikasi material eksternal adalah sumber kebenaran stok/gudang/alokasi/issue/transfer/retur/opname. Jangan membangun ulang modul inventory di DISTRIVA.
8. Forecast awal memprediksi volume/jenis pekerjaan dari histori permohonan, lalu mengonversi material melalui BOM. Jangan menyebutnya prediksi konsumsi aktual.
9. RKM diusulkan ULP, divalidasi UP3 Construction/planner, disetujui pejabat UP3; RKM bukan PO.
10. Jangan menghitung permohonan aktual dua kali sebagai pipeline/forecast.
11. Perubahan gambar/master membuat versi baru; jangan menimpa histori.
12. Auto MTO adalah ekstraksi kandidat. Petugas teknis ULP wajib memverifikasi sebelum kebutuhan material final.
13. KHS code adalah kunci utama matching; jangan menebak kode KHS yang tidak ditemukan.
14. Drawing, BOM, RAB/KKF dan approval terikat pada versi yang sama. Revisi memerlukan review ulang sesuai matriks.
15. SYS_ADMIN/UP3_ADMIN tidak otomatis memiliki kewenangan approval bisnis atau akses semua dokumen.
16. Integrasi eksternal tidak boleh menggunakan endpoint/payload rekaan. Tunggu kontrak teknis resmi.

## Workflow dan role

Gunakan katalog 14 role di `03-ROLES-AND-ACCESS.md` dan approval matrix T1/T3. Jangan menghidupkan kembali `KONSTRUKSI_ULP` atau `ASMAN_TEKNIK`.

## Cara bekerja

- Sebelum membuat migration, baca database design, ERD, decision log, dan finalized business decisions.
- Jangan mengimplementasikan modul stok internal; implementasikan adapter integrasi material.
- Buat migration kecil per domain dengan foreign key, index, constraint, UUID, audit dan versioning yang jelas.
- Buat test business rules, authorization scope, approval version binding, idempotency integrasi, dan calculation snapshots.
- Jangan menanam daftar material ULP hanya di frontend; aturan harus ditegakkan di backend.
- Jangan mengarang API integrasi, nilai tarif, harga kontrak, formula BOM, atau kewenangan approval.
- Dokumen status blueprint tidak berarti kode sudah diimplementasikan.


## Update T4.2.2 — 5 November 2026 (dokumentasi v2.6, historis)
T4.2.2 final pada level desain database. Keputusan awal v2.6 (harga eksternal saja dan `ASMAN_KONSTRUKSI` sebagai approver KHS/BOM) telah direvisi oleh v2.7 sebagaimana dicatat di bagian berikut; jangan gunakan v2.6 sebagai baseline berjalan. Belum ada migration, seeder, integrasi ERP, atau engine yang diimplementasikan.


## Revisi keputusan T4.2.2 pada v2.7
- Harga: BOTH — eksternal dan master internal per UP3; tabel `material_prices` termasuk desain. Aturan prioritas pemilihan harga dan approval perubahan harga internal masih terbuka.
- Approver versi master KHS/BOM: `UP3_MANAGER` (menggantikan keputusan v2.6 `ASMAN_KONSTRUKSI`).

## Status dokumentasi terintegrasi — v3.15.0
- T4.2.2 baseline yang berlaku adalah dual-source price design (external + internal UP3) dan `UP3_MANAGER` sebagai approver KHS/BOM. Price priority/default dan UOM mapping/conversion tetap open; lihat dokumen 23, D-MDM-001/002.
- Dokumen 45 menyatukan rekomendasi owner-review untuk O-033/O-034/O-036/O-037/O-038/O-039/O-041 dan issue terkait. Rekomendasi tidak menjadi keputusan owner; register 44 masih DRAFT/PENDING.
- Dokumen 46 adalah paket rapat owner: seluruh 37 issue OPEN/PARTIAL terwakili, dengan decision sheets prioritas, alternatif, evidence/authority, form pencatatan, dan empat approval gates. Pilihan serta OD IDs yang diusulkan belum disetujui; periksa keunikan ID dan catat keputusan hanya di register 44 setelah persetujuan/evidence resmi.
- Dokumen 47–50 melaporkan readiness aktual, backlog remediation, test evidence dan approval register. Suite non-database lulus 22/22 tests (33 assertions), tetapi bearer-token database E2E dan PostgreSQL integration belum berjalan; tidak ada koneksi database. Status readiness keseluruhan `BLOCKED`.
- Konflik historis: dokumen 16 section 9 menyebut Pengawas Jaringan sebagai verifier/inspector, sedangkan keputusan v3.7.0 melarang role baru dan menetapkan `KONSTRUKSI_UP3` untuk child-WO verify/inspect action-specific scope. Jangan implementasikan konflik ini sebelum klarifikasi/penandaan historis oleh otoritas dokumentasi/proses; lihat doc 47.
- O-034 tetap PROPOSED/OPEN/BLOCKING; tidak ada permission grants, domain migrations, policies, query scopes, atau database changes yang disetujui dari paket rekomendasi ini.
- Input 2026-11-05 menegaskan tidak ada perubahan approval matrix KKF yang diminta; matrix existing tetap baseline. Identitas/kewenangan pemberi input dan bukti formal belum tersedia; register 44 mencatatnya `PENDING` untuk verifikasi. O-041 tetap `OPEN/BLOCKING`, dan readiness tetap `BLOCKED`.
- Audit readiness v3.15.0 menemukan `.env` backend memilih SQLite dan port 3306, sedangkan target proyek PostgreSQL menggunakan port 5432. `distriva_backend_test` telah disebut sebagai target test tetapi keberadaan/akses/status disposable belum diverifikasi; tidak ada database yang dihubungi. Suite no-DB 22/22 (33 assertions), Composer, Pint, dan route listing PASS; detail ada pada `test-evidence/2026-11-05-backend-readiness-audit.md`. Domain implementation tetap `BLOCKED`.


## Update T4.2.3 — v2.8
- Nomor telepon customer boleh kosong pada Bot Daftung staging, tetapi wajib dilengkapi oleh NIAGA_RETAIL sebelum submit permohonan resmi.
- Contoh feed Bot Daftung memiliki NOAGENDA, NO_REGISTRASI, IDPEL, NAMA, ALAMAT, TARIF_LAMA, DAYA_LAMA, TARIF_BARU, DAYA_BARU, JENIS_TRANSAKSI, PAKET_SAR, TOTALBIAYA, TGLBAYAR, DURASI_HARI_KERJA, KRITERIA_TMP, STATUS_PERMOHONAN, TGL_UPDATE_PERMOHONAN.
- NOAGENDA dan NO_REGISTRASI adalah external references terpisah; IDPEL adalah external customer reference, bukan PK customer.
- TOTALBIAYA bukan otomatis pembayaran; TGLBAYAR harus diverifikasi. Status dan durasi dari Bot Daftung/EIS AP2T adalah external status history, bukan workflow internal.
- Daya dari spreadsheet harus disimpan bersama satuan sumber. Contoh DAYA_BARU=900 tidak cukup untuk menyimpulkan VA/kVA.
- Strategi deduplikasi customer, API contract, payment provider, status dictionary, definisi TMP, formulir survei, dan SLA pause/resume masih open.
- Lihat `docs/24-T4.2.3-APPLICATIONS-PB-PD-SCHEMA.md`.


## Pembaruan T4.2.3 v2.9 — identitas PLN
- Satu customer internal DISTRIVA dapat memiliki banyak permohonan PB/PD/Ubah Nama/layanan lain.
- IDPEL adalah identitas pelanggan PLN dan disimpan di `customer_external_references`; satu IDPEL dapat terkait dengan banyak applications milik customer yang sama. Calon pelanggan PB boleh belum memiliki IDPEL.
- No. Register adalah referensi pembayaran (`PAYMENT_REGISTER`) dan No. Agenda adalah referensi proses layanan (`AGENDA`); keduanya melekat pada application, bukan customer.
- No. Register dan No. Agenda dapat belum tersedia saat permohonan awal dibuat, lalu ditambahkan ketika sistem eksternal menerbitkannya. Penerbitan ulang/koreksi harus mempertahankan histori.
- Konflik IDPEL yang tertaut pada customer berbeda harus masuk rekonsiliasi manual; jangan auto-merge.
- Nomor telepon tetap boleh kosong saat staging, tetapi wajib dilengkapi NIAGA_RETAIL sebelum submit resmi.


## T4.2.3 — keputusan sinkronisasi Bot Daftung v3.0
Untuk permohonan existing yang sudah ada di DISTRIVA, gunakan No. Agenda untuk menemukan application. Jika cocok tepat satu record, sinkronisasi Bot Daftung hanya boleh mengubah tiga kolom eksternal: `DURASI_HARI_KERJA`, `STATUS_PERMOHONAN`, dan `TGL_UPDATE_PERMOHONAN`. Tidak boleh menimpa kolom customer/application lain. IDPEL bukan kunci permohonan karena satu IDPEL dapat memiliki banyak permohonan. Pisahkan `source_updated_at` dari `synced_at`; tolak data stale dan karantina konflik timestamp sama dengan payload berbeda. Simpan histori status. Data baru tanpa No. Agenda masih memerlukan source ID atau strategi deduplikasi yang dikonfirmasi. Keputusan ini masih desain; belum ada implementasi.

## T4.2.3 — keputusan Bot Daftung v3.1

Bot Daftung tidak memiliki ID unik internal permohonan. File diunduh berdasarkan tanggal permohonan pertama kali dibuat dan dapat memuat data lama serta baru dalam rentang pilihan; batch dapat overlap. Untuk existing application yang dicocokkan tepat lewat No. Agenda, hanya `DURASI_HARI_KERJA`, `STATUS_PERMOHONAN`, `TGL_UPDATE_PERMOHONAN` yang boleh berubah. `TGL_UPDATE_PERMOHONAN` menentukan kebaruan status. `period_start`/`period_end` adalah filter tanggal pembuatan, bukan tanggal update status. Record yang tidak muncul pada batch berikutnya tidak dianggap dihapus/selesai. Data tanpa nomor eksternal masuk staging dan pemeriksaan kandidat; tidak auto-merge. Implementasi belum dilakukan.

## T4.2.1.2A — actor and authorization design status v3.7.0

- No new Pengawas Jaringan role. `KONSTRUKSI_UP3` is selected for action-specific progress verification and work inspection on child-ULP work orders under its UP3 assignment. This is not `UP3_DESCENDANT_READ` and is not implemented.
- RKM: ULP proposes; `PERENCANAAN` AND `KONSTRUKSI_UP3` validate as different users; `UP3_MANAGER` final-approves; submitter cannot final-approve its own version; RKM is separate from procurement. The concrete ULP proposer role remains open.
- All approvers in any workflow AND step must be different users; a submitter cannot final-approve its own version. Progress submitter and verifier must differ. Reports inherit the source permission/scope, with separate per-domain export permission.
- Permission keys/role grants remain proposals. Application reviewers, survey actors, WO creator/reviewer/issuer, meter verifier, RAB/KKF calculator/reviewer and feasibility lifecycle remain open.
- Every user with an effective `KONSTRUKSI_UP3` assignment on the relevant UP3 may verify/inspect all child-ULP WOs without an additional WO/task assignment; the capability is still limited to those actions and not implemented. Backend has no business resource models, Policies, SQL query scopes, or business routes. Vendor remains deny-all. Implementation gate BLOCKED.
- See `docs/34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md` and evidence `test-evidence/2026-11-05-t4212a-actor-scope-audit.md`.

## T4.2.1 — implementasi awal organisasi dan otorisasi v3.4.0

Desain Opsi A dan integrasi Spatie disetujui. `user_role_assignments` tetap satu-satunya sumber assignment; Spatie catalog-only untuk `roles`, `permissions`, dan `role_has_permissions`, tanpa user pivots, Teams, atau resolver permission default. Baseline Laravel 13.40.0, Sanctum 4.3.3, Spatie Permission 8.3.2, guard `web`, migration/schema PostgreSQL, model User/Role, dan RoleSeeder 14 role tersedia di `backend/`.

Pada baseline v3.4.0, full suite lulus 5/5 (10 assertions), seluruh migration T4.2.1 dan RoleSeeder dijalankan pada PostgreSQL disposable `distriva_db`, lalu di-rollback; `btree_gist` tetap terpasang atas izin eksplisit. Bukti migration ada di `test-evidence/2026-11-05-t421-runtime.md`.

## T4.2.1.1 — ScopedAuthorizationService v3.5.0

Model/relasi `OrganizationalUnit` dan `UserRoleAssignment`, `AuthorizationContext`, mode scope, dan `ScopedAuthorizationService` telah dibuat. Assignment hanya bersumber dari `user_role_assignments`; permission diperiksa lewat katalog Spatie dengan guard `web`. Service menerapkan user ACTIVE, assignment active/tanggal inklusif pada `Asia/Jakarta`, unit active, exact-unit default, mode eksplisit read-only UP3→ULP, serta SYS_ADMIN global system-only. Vendor scope memerlukan company/project/work-order context dan saat ini fail-closed karena domain relations belum tersedia.

Full test suite 20/20 (30 assertions), termasuk 15 unit tests baru (20 assertions), lulus; Pint, syntax, route list, Composer validation, dan container resolution lulus. Tidak ada migration atau query database untuk tahap service ini. Belum ada Policy, route/domain integration, PostgreSQL test atas query assignment, write/audit path, cache invalidation, permission keys final, concurrency, maupun Sanctum UUID end-to-end. Detail: `docs/33-T4.2.1.1-SCOPED-AUTHORIZATION.md`; evidence: `test-evidence/2026-11-05-t4211-authorization.md`.

## T4.2.1.2 — Policy/resource-scope design v3.6.0

Matrix resource/ability/role/scope disetujui sebagai baseline desain saja. Tidak ada permission key final, seeder, Policy/query scope, atau perubahan database yang disetujui/diimplementasikan pada checkpoint ini. Source audit tidak menemukan business resource model, business route, atau vendor/project/work-order relations. “Pengawas Jaringan”, reviewer permohonan, dan approver final RKM masih perlu pemetaan yang disetujui. Vendor tetap fail-closed; `user_role_assignments` tetap satu-satunya sumber assignment. Detail: `docs/34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md`; audit: `test-evidence/2026-11-05-t4212-design-audit.md`. Tes tidak dijalankan pada checkpoint desain ini; hasil terakhir sebelumnya 20/20 tests (30 assertions).
