# 36 — O-034 Documentation Audit

**Documentation baseline:** v3.8.0  
**Tanggal:** 5 November 2026  
**Status:** Audit dokumentasi; dokumen resource-model tetap `PROPOSED`.  
**Batas:** Tidak ada keputusan bisnis baru, perubahan source, migration, database, atau permission grant.

**Update integrasi:** v3.11.0 menambahkan rekomendasi terintegrasi pada dokumen 35 section 18 dan paket 45. Temuan audit historis di bawah tetap menjadi baseline; rekomendasi baru berstatus `PROPOSED` dan O-034 tetap `OPEN/BLOCKING`.

## 1. Ringkasan

Dokumen [35-O-034-RESOURCE-MODEL-LIFECYCLE-SCHEMA.md](./35-O-034-RESOURCE-MODEL-LIFECYCLE-SCHEMA.md) memberi rancangan resource, relasi, lifecycle, dan invariant lintas domain untuk O-034. Statusnya tepat `PROPOSED`, bukan `APPROVED`. O-034 tetap `OPEN/BLOCKING` sampai pemilik proses menyetujui model dan keputusan yang bergantung padanya selesai.

Secara arah, proposal konsisten dengan keputusan fondasi dan authorization yang sudah disetujui: assignment tunggal `user_role_assignments`, Spatie sebagai katalog, resource scope dari data persisted, vendor fail-closed, RKM bukan procurement, SoD distinct-user, versi/snapshot historis, serta query scope sebelum pagination/agregasi/export.

**Status keseluruhan: WARNING / BLOCKED.** Dokumen cukup untuk review terarah, belum cukup sebagai spesifikasi migration final. Ada ketidakselarasan referensi path, satuan material, keputusan proses terkait, dan beberapa detail constraint/lifecycle yang perlu diputuskan atau dirapikan. Tidak ada perubahan keputusan APPROVED.

## 2. Dokumen yang diperiksa

| Dokumen aktual | Hasil |
|---|---|
| `docs/15-DECISIONS-AND-OPEN-ISSUES.md` | O-034 masih OPEN/BLOCKING; status dan referensi diperjelas dalam integrasi v3.8.0. |
| `docs/22-T4.2.1-FOUNDATION-SCHEMA.md` | Identitas, organisasi, assignment, role dan audit histories harus diwarisi; tidak boleh dibuat ulang. |
| `docs/23-T4.2.2-MASTER-DATA-SCHEMA.md` | Material, SKU ERP, UOM, KHS/BOM dan harga harus direuse; hubungan UOM dan pricing tertentu masih terbuka. |
| `docs/24-T4.2.3-APPLICATIONS-PB-PD-SCHEMA.md` | `applications` adalah root PB/PD, unitnya ULP; survey, status, pembayaran dan task sudah dirancang. |
| `docs/26-T4.2.4-DOCUMENTS-AUTO-MTO-SCHEMA.md` | Reuse dokumen/version/review dan Auto MTO package/item/snapshot; path aktual berbeda dari nama yang dirujuk dokumen 35. |
| `docs/34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md` | Scope, SoD, actor boundary, vendor deny-all dan blocker authorization konsisten; tabel 10.7 ditautkan ke O-034. |
| `docs/35-O-034-RESOURCE-MODEL-LIFECYCLE-SCHEMA.md` | Resource proposal diperiksa per domain, lifecycle, constraint, snapshot, scope dan acceptance criteria. |
| `docs/AI-HANDOFF.md` | Dipertahankan historinya; status proposal, blocker, lokasi dokumen, dan next action ditambahkan. |
| `docs/05-DATABASE-DESIGN.md` | Menemukan tabel domain konseptual lama yang berpotensi bertumpang tindih nama/fungsi jika dianggap schema final. |
| `docs/07-MASTER-DATA-AND-BOM.md`, `docs/08-RAB-KKF-ENGINE.md`, `docs/09-APPROVAL-AND-DRAWING.md`, `docs/12-RKM-PLANNING.md`, `docs/16-FINALIZED-BUSINESS-DECISIONS.md`, `docs/17-T4-TECHNICAL-DESIGN-STATUS.md`, `docs/33-T4.2.1.1-SCOPED-AUTHORIZATION.md` | Referensi langsung untuk SKU/UOM, approval, SoD, actor, scope, status dan bukti teknis. |
| `PACKAGE-MANIFEST.json` | Format JSON dengan path, byte size, dan SHA-256 tersedia; diperbarui ke baseline v3.8.0. |

Nama `docs/26-T4.2.4-DATABASE-SCHEMA-DOKUMEN-AUTO-MTO.md` yang ditulis di sumber 35 **tidak ditemukan**. File aktual adalah `docs/26-T4.2.4-DOCUMENTS-AUTO-MTO-SCHEMA.md`; referensi sumber 35 dikoreksi ke path aktual.

## 3. Hasil konsistensi per area

| Area O-034 | Status | Temuan |
|---|---|---|
| Foundation, users, roles, units, assignments | PASS | Reuse foundation T4.2.1; actor decision menyimpan FK assignment dan snapshot role/unit. Jangan membuat sumber assignment kedua. |
| Applications dan surveys | PASS / OPEN | `applications` dan `application_surveys`/versions sudah ada pada desain T4.2.3. Survey actor/formal review tetap O-038; tidak boleh menggandakan application atau survey subsystem tanpa keputusan. |
| Material, SKU, UOM, KHS/BOM | WARNING | Tidak ada tabel master material baru pada proposal. D-026 menetapkan satu SKU ERP per varian. Namun T4.2.2 masih mempertahankan `materials.unit VARCHAR(30)` dan menyatakan normalisasi ke `units_of_measure` belum diputuskan; O-034 memakai `unit_id` pada detail. |
| Documents dan Auto MTO | PASS / WARNING | Konsep reuse sesuai T4.2.4: dokumen/logical identity, immutable file versions, MTO package dan snapshot. Nama snapshot/PK dan composite FK wajib dicocokkan dengan skema 26 saat migration design. |
| RKM | PASS / WARNING | Flow ULP → `PERENCANAAN` AND `KONSTRUKSI_UP3` → `UP3_MANAGER`, distinct users, submitter/final approver berbeda, tanpa PO/procurement sesuai D-AUTH-010 dan D-010/D-025. Concrete ULP proposer tetap O-036. `planning_basis_snapshot` disebut perlu hash tetapi kolom `snapshot_hash` tidak terlihat pada daftar `rkm_plan_versions`; lengkapi atau jelaskan di revisi proposal. |
| Vendor/company/account/project/assignment | PASS / BLOCKED | Fail-closed chain persisted sesuai authorization. Eligibility, source/owner, account verification, assignment cardinality dan user-level selector/approver separation belum final; O-029/O-039 tetap terbuka. |
| WO/items/status/progress/inspection/completion | PASS / BLOCKED | Scope child-ULP verify/inspect oleh effective `KONSTRUKSI_UP3` konsisten dengan D-AUTH-009/013 dan O-042. Maker/reviewer/issuer, approval boundary, lifecycle, jumlah WO dan amendment tetap O-039. Inspection-versus-completion SoD belum diputuskan; jangan mengangkat rekomendasi menjadi keputusan. |
| RAB calculation runs/pricing snapshots | PASS / BLOCKED | Snapshot hasil dan harga yang benar-benar dipakai konsisten dengan D-021, D-MDM-001 dan T4.2.2. Runner/reviewer, prioritas harga, formula/parameter dan approval RAB tetap terbuka pada O-041/T4.2.2. |
| KKF cases/versions/approval | PASS / WARNING | Matrix normal ≤5 tahun dan PBP >5 tahun tercantum sesuai keputusan; approver pada langkah AND berbeda dan versi/snapshot harus sama. Formula/PBP definition, runner/reviewer, return/cancel dan integrasi RAB/feasibility masih O-041. |
| Feasibility | PASS / BLOCKED | `requires_feasibility_study` sudah ada pada application. Relasi studi ke KKF, jumlah skenario, actor, lifecycle dan kondisi wajib masih O-041; proposal dengan benar tidak mengunci keputusan. |
| Meter installation/evidence/verification | PASS / OPEN | T4.2.3 mensyaratkan verifikasi sebelum COMPLETED; dokumen 35 mengusulkan reuse dokumen/version. Pelaksana, verifier, SoD, kardinalitas dan condition policy tetap O-038. |
| Versioning, audit, transactions | WARNING | Prinsip append-only, immutable approved version, snapshot hash dan atomic transaction sesuai arah. Perlu pastikan semua decision table menyimpan version/cycle dan definisi “current” tunggal; sebagian tabel header/version sama-sama memiliki `status`. |
| Constraints/indexes | WARNING | Composite FK, same-parent/same-application validation, distinct-user, status transitions dan uniqueness disadari. Pilihan implementasi DB vs transactional service, key/index aktual, serta concurrency tests belum final. |
| Authorization and reporting | PASS / BLOCKED | Resource scope harus diturunkan dari persisted relations; SQL predicate sebelum pagination/sorting/count/aggregation/export. Permission IDs/grants tidak difinalkan; Policy/query scope belum ada. |

## 4. Konflik, duplikasi, dan koreksi dokumentasi

| ID | Temuan | Dampak/status |
|---|---|---|
| AUD-01 | Referensi dokumen T4.2.4 pada bagian sumber dokumen 35 tidak cocok dengan nama file aktual. | Dikoreksi ke `26-T4.2.4-DOCUMENTS-AUTO-MTO-SCHEMA.md`. |
| AUD-02 | Tabel konsep lama pada `05-DATABASE-DESIGN.md` menyebut `vendors`, `work_progress`, `work_documents`, `material_usages`, `calculation_runs`, `rab_details`, `kkf_results`, dan `feasibility_results`; proposal 35 memakai domain tables yang lebih rinci dan berbeda nama. | Belum ada migration/domain implementation; ini bukan bukti tabel runtime duplikat. Tandai daftar lama sebagai blueprint konseptual/historis sebelum implementasi agar tidak dibaca sebagai tambahan schema final. Tidak diubah menjadi keputusan baru. |
| AUD-03 | `materials.unit` belum FK UOM di T4.2.2, sementara RKM/RAB/WO proposal memakai FK `unit_id`. | Tetap OPEN; tetapkan konversi, validasi kesetaraan, dan sumber unit sebelum schema final. Jangan mengasumsikan `materials.unit_id`. |
| AUD-04 | RKM versi menyebut snapshot hash wajib tetapi definisi kolom tidak mencantumkannya. | Perbaiki/konfirmasi di proposal; tidak mengubah approval flow. |
| AUD-05 | Beberapa table identity dan version mengulang `status`; sumber status otoritatif dan aturan sinkronisasi belum ditentukan. | Perlu keputusan desain teknis sebelum migration agar tidak ada status ganda yang divergen. |
| AUD-06 | `rkm_validation_decisions` memakai `decision` termasuk `REJECTED`/`RETURNED`; keputusan yang disepakati menetapkan validator dan final approver tetapi detail efek return/reject/cancel belum dirinci. | Perlakukan status/transition sebagai PROPOSED dan buka untuk persetujuan; jangan grant atau implementasikan aksi transisi berdasar inferensi. |
| AUD-07 | `05-DATABASE-DESIGN.md` memiliki konsep generik `calculation_runs`/`calculation_snapshots` dan domain RAB/KKF terpisah dari rancangan 35. | Rekonsiliasi terhadap schema 35 dan 26 sebelum menentukan tabel final; jangan membuat dua snapshot/calculation subsystem. |
| AUD-08 | O-034 mencatat `ASMAN_KONSTRUKSI` final completion, sementara detail batas scope/SoD disebut belum dikonfirmasi. | Tidak konflik dengan keputusan final approver yang terdokumentasi; yang belum disetujui adalah scope/SoD/pra-syarat detail. |

Tidak ditemukan usulan untuk membuat role Pengawas baru, menaruh user assignment di Spatie, memberi akses vendor sebelum relasi persisted valid, memakai satu SKU ERP untuk beberapa varian, mengubah versi approved, menggabungkan report scope, atau memicu procurement dari approval RKM.

## 5. Keputusan APPROVED yang dipertahankan

- PostgreSQL adalah database; domain/business IDs menggunakan UUID sesuai T4.2.1.
- `user_role_assignments` adalah satu-satunya sumber assignment; Spatie tetap katalog role/permission.
- Aplikasi PB/PD adalah root proses dan menyimpan ULP; struktur UP3/ULP diwarisi dari organisasi.
- Setiap varian resmi material memerlukan kode ERP/SKU tersendiri; tidak membuat master duplikat atau menebak SKU.
- KHS/BOM approved oleh `UP3_MANAGER` dan immutable; proposal 35 hanya mereferensikan master.
- RKM diajukan ULP, divalidasi `PERENCANAAN` AND `KONSTRUKSI_UP3`, final approval `UP3_MANAGER`; approver AND harus distinct users; submitter tidak final-approve versinya sendiri; RKM bukan procurement/PO.
- Progress submitter dan verifier berbeda user.
- Effective `KONSTRUKSI_UP3` assignee pada UP3 terkait dapat melakukan verify progress dan inspect WO child-ULP, hanya untuk aksi tersebut, tanpa assignment per WO/task.
- Vendor tetap deny-all sampai relasi account-company-project-approved assignment-WO valid dan persisted.
- KKF normal: `ASMAN_PERENCANAAN` AND `ASMAN_KONSTRUKSI`; PBP >5 tahun: ditambah `ASMAN_NIAGA` AND `UP3_MANAGER`; AND approvers distinct; `UP3_MANAGER` bukan approver KKF normal.
- Report/export mengikuti source scope; export memerlukan permission terpisah per domain.
- Query scope diterapkan sebelum pagination, sorting, count, aggregation dan export.

Approval desain O-034 tidak termasuk dalam pekerjaan audit ini.

## 6. Open issues yang masih memerlukan keputusan

| Issue | Status | Yang diperlukan |
|---|---|---|
| O-034 | OPEN / BLOCKING | Persetujuan model/resource/lifecycle O-034 setelah rekonsiliasi teknis dan keputusan dependensi. |
| O-036 | OPEN / PARTIAL | Concrete ULP RKM proposer role dan application reviewer. |
| O-038 | OPEN | Survey assigner/surveyor/reviewer/formal approval; meter actor dan SoD. |
| O-039 | OPEN / BLOCKING | WO creator/reviewer/issuer/approval, cardinality, lifecycle/amendment dan hubungan approved inputs/vendor assignment. |
| O-041 | OPEN / BLOCKING | RAB runner/reviewer/approval, KKF calculation/review/lifecycle, feasibility relation/actors. |
| O-033 | OPEN / BLOCKING | Permission identifiers dan role grants; tidak boleh final sebelum actor/resource matrix disetujui. |
| O-029 | OPEN | Vendor assignment unit/company/project/contract source dan authorization beyond unit. |
| T4.2.2 pricing/UOM | OPEN | Prioritas harga dan otoritas harga internal; material UOM normalization/ERP code mapping. |
| O-037 | OPEN / PARTIAL | Pemetaan metric/report/role/field dan export allowlist. |

O-035, O-040, dan O-042 tetap `CLOSED` sesuai keputusan terdokumentasi; audit ini tidak mengubah statusnya.

## 7. Rekomendasi

1. Pemilik proses meninjau proposal 35 bersama laporan readiness 37; putuskan pertanyaan bisnis yang dirujuk O-036/O-038/O-039/O-041 secara terpisah.
2. Revisi proposal 35 untuk membedakan tegas keputusan APPROVED, struktur PROPOSED, dan lifecycle/actor OPEN; tambahkan `snapshot_hash` atau perjelas ketentuan hash RKM, dan definisikan status header/version yang otoritatif.
3. Rekonsiliasi material UOM, table legacy `05-DATABASE-DESIGN.md`, table names/keys Auto MTO T4.2.4, dan FK composite terhadap dokumen schema aktual.
4. Setelah persetujuan eksplisit, perbarui register/status O-034; baru setelah itu siapkan desain migration per domain. Tidak ada migration dalam checkpoint ini.

## 8. Acceptance criteria untuk audit integrasi

- [x] Dokumen 35 diperlakukan sebagai `PROPOSED`, bukan `APPROVED`.
- [x] Keputusan APPROVED tidak diubah; vendor fail-closed dan RKM tetap terpisah dari procurement.
- [x] Path dokumen T4.2.4 diverifikasi terhadap file yang ada dan referensinya dikoreksi.
- [x] O-034 dan dependensi O-036/O-038/O-039/O-041 dicatat tetap terbuka.
- [x] AI-HANDOFF dan manifest direkonsiliasi.
- [x] Tidak ada kode, migration, seeder, policy, atau database yang diubah.
- [ ] Pemilik proses menyetujui proposal 35 — **belum dilakukan; O-034 tetap OPEN/BLOCKING**.

## 9. Validasi dan batas

Manifest v3.8.0 berisi SHA-256 dan byte size file aktual; daftar path unik, semua file yang tercantum ada, dan tidak ada `.env` terdaftar. Ini validasi dokumentasi, bukan test aplikasi atau database.

Status Git tidak tersedia karena workspace bukan repositori Git. Tidak ada automated application test yang dijalankan.

## 10. Addendum analisis O-036/O-038/O-039/O-041 — v3.9.0

Analisis lanjutan tersedia pada dokumen 38–43. Sejumlah keputusan terdokumentasi untuk RKM, KKF, vendor assignment, WO aktif, progress/inspection scope, dan meter completion prerequisite berhasil dipetakan tanpa perubahan. Reviewer aplikasi, concrete RKM proposer, survey/meter actors, WO creator/reviewer/issuer/lifecycle lengkap, RAB/KKF runner/reviewer, serta feasibility relation masih memerlukan keputusan pemilik proses.

O-036 tetap `PARTIAL/OPEN`; O-038 tetap `OPEN`; O-039 dan O-041 tetap `OPEN/BLOCKING`. Dokumen 35 tetap `PROPOSED`, O-034 tetap `OPEN/BLOCKING`, dan readiness tetap `BLOCKED`. Laporan v3.8.0 di atas adalah snapshot historis audit O-034; analisis ini tidak mengubah hasil historis atau mengizinkan migration.
