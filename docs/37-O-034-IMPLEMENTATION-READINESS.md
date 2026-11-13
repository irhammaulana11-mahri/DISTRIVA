# 37 — O-034 Implementation Readiness

**Dokumentasi baseline:** v3.8.0  
**Tanggal:** 5 November 2026  
**Status kesiapan:** `BLOCKED` — desain resource tetap `PROPOSED`; belum boleh masuk migration.
**Update v3.11.0:** rekomendasi resource/cardinality/lifecycle pada dokumen 35 section 18 siap untuk owner review, tetapi tidak menutup dependency atau mengubah gate. Lihat dokumen 45 section 11–13. Implementasi tetap `BLOCKED`.

## 1. Ringkasan keputusan readiness

Dokumen 35 menyediakan usulan resource model/lifecycle yang berguna untuk review dan belum menjadi desain schema final. Audit dokumentasi selesai, tetapi audit bukan approval pemilik proses. O-034 tetap `OPEN/BLOCKING`.

**Tidak diizinkan saat ini:** membuat migration/tabel, mengubah model, Policy, query scope, seeder/permission grant, API, atau database. Perubahan tersebut memerlukan approval desain tersendiri dan dependensi yang dicantumkan di bawah.

## 2. Dependency matrix

| Dependency | Status saat ini | Dampak ke O-034 | Gate sebelum implementasi |
|---|---|---|---|
| T4.2.1 foundation | Baseline desain/implementasi tersedia; assignment source tunggal | Semua actor audit harus mereferensikan `users`, `roles`, `organizational_units`, `user_role_assignments`; jangan buat assignment alternatif | Rekonsiliasi tipe FK aktual dan assignment snapshots |
| T4.2.1.1 `ScopedAuthorizationService` | Fondasi ada; belum ada domain Policy/query scope | Tidak membuktikan resource authorization siap | Hanya pakai assignment source yang sudah disetujui; O-033 dan resource relation harus tutup dulu |
| T4.2.1.2/2A authorization matrix | Design baseline dan actor scope directions approved; permission keys/grants belum final | Vendor deny-all; child-WO special scope bukan existing mode | Tetapkan ability/permission IDs setelah O-034 actor/resource boundaries approved |
| T4.2.2 master data | Final pada level desain; implementasi/integrasi upstream tertentu belum final | `materials`, UOM, KHS/BOM dan material pricing menjadi referensi RKM/RAB/WO | Putuskan material UOM mapping, kode ERP per SKU, pricing source/priorities; jangan duplicate master |
| T4.2.3 applications PB/PD | Desain tersedia; domain migration belum menjadi final source untuk proposed tables | `applications` root, ULP scope, survey, meter precondition dan `requires_feasibility_study` | Rekonsiliasi PK/FK, application status, survey reuse dan meter completion condition |
| T4.2.4 documents/Auto MTO | DDL runtime PASS terbatas pada contract-minimal fixtures; bukan final upstream production integration | WO/RAB references perlu mengunci package/document versions dan MTO snapshots | Gunakan nama/PK/composite constraints aktual pada dokumen 26; jangan duplikasi document/MTO |
| O-036 | OPEN/PARTIAL | ULP RKM proposer role dan application reviewer belum ada | Keputusan owner sebelum workflow actor table/grants |
| O-038 | OPEN | Survey lifecycle/reviewer dan meter performer/verifier/SoD belum final | Keputusan owner sebelum meter/survey transition and authorization schema |
| O-039 | OPEN/BLOCKING | Work order creator/reviewer/issuer, approval, cardinality dan amendments belum ditentukan | Keputusan owner; resource lifecycle dan vendor/project relation harus cocok |
| O-041 | OPEN/BLOCKING | RAB runner/reviewer; KKF calculation/review; feasibility lifecycle/relationship belum final | Keputusan owner sebelum tables, workflow decisions, and calculation snapshots are frozen |
| O-033 | OPEN/BLOCKING | Permission identifiers and role grants unapproved | No seeder/Policy until explicit role-permission mapping approved |
| O-029 | OPEN | Vendor unit/company eligibility source and scope unresolved | Do not permit vendor; keep deny-all |
| O-037 | OPEN/PARTIAL | Per-report metric/role/field/export mapping remains open | Report/export implementation waits on source resource and allowlists |

## 3. Blockers dan keputusan bisnis yang diperlukan

### Blocking

1. **O-034 — resource schema/lifecycle:** owner approval of aggregate boundaries, cardinalities, lifecycle, relationship contracts, and immutable snapshots.
2. **O-039 — Work Order:** maker/reviewer/issuer/final approval boundary; actor separation; one-to-many project/application/WO and assignment scope; issue amendment/cancellation effects.
3. **O-041 — calculations/feasibility:** RAB calculation/review responsibility; KKF runner/reviewer and version/source relationships; feasibility trigger, lifecycle, and KKF linkage.
4. **O-033 — authorization catalog:** permission IDs and explicit role grants; no implementation from descriptive ability labels.

### Open, not to be silently inferred

- **O-036:** concrete ULP role submitting RKM; application review actor/status workflow.
- **O-038:** survey assignment/review and meter installation actors, formal decision, and SoD.
- **O-029:** vendor account/contract/eligibility source, unit requirement, vendor assignment approval SoD.
- **O-037:** report metrics, data fields, roles, export allowlist.
- **T4.2.2:** material UOM normalization; price source priority and authority.
- **RKM:** number of plans per period, period overlap, source of forecast/stock snapshot, rejected/returned/amendment/cancel transitions.
- **KKF:** exact PBP input/unit/boundary, calculation inputs/formula, `RETURNED`/`REJECTED` transition semantics.
- **Feasibility:** one or multiple scenarios per application and whether KKF pins a specific approved version.
- **Meter:** cardinality per application/WO, mandatory condition, evidence capture, performer/verifier relation.

O-035, O-040, dan O-042 tetap `CLOSED` sesuai basis keputusan yang sudah tercatat; tidak ada keputusan baru pada dokumen ini.

## 4. Risiko jika implementasi dimulai terlalu dini

- Tabel atau foreign key duplikat terhadap `applications`, `application_surveys`, document versions, Auto MTO package/snapshots, material/KHS/BOM, users, atau organization foundation.
- Data sumber authorization menyimpang dari `user_role_assignments`, atau Spatie user pivot menjadi sumber assignment kedua.
- Status header/version menjadi sumber kebenaran ganda dan dapat divergen.
- `materials.unit` (teks) dan `units_of_measure` (FK) tidak dapat divalidasi tanpa aturan konversi ERP.
- Vendor memperoleh akses berbasis role/unit meski company/project/approved assignment/WO chain tidak valid.
- Perubahan/approval menimpa input lama; RAB/KKF tidak dapat direproduksi karena snapshot nilai/parameter/sumber tidak lengkap.
- Approver AND yang sama dapat mengisi beberapa slot, atau submitter memutuskan versinya sendiri.
- RKM approval menimbulkan efek procurement/stock yang tidak disetujui.
- Generic workflow atau tabel approval membuat drawing, MTO, KKF, RKM, WO, dan meter menjadi satu proses yang kehilangan aturan domain.
- Report/export memproses pagination atau agregasi sebelum filter scope dan membocorkan lintas unit.

## 5. Syarat sebelum masuk tahap migration

Tidak ada migration sebelum seluruh syarat wajib ini dipenuhi:

1. Pemilik proses menyetujui dokumen 35 secara eksplisit, per domain, dengan versi/tanggal approval.
2. O-036, O-038, O-039, dan O-041 diselesaikan sejauh diperlukan untuk schema/lifecycle yang akan dimigrasikan; bagian yang tetap terbuka tidak boleh dimasukkan sebagai final.
3. O-029 vendor relation and eligibility boundary is resolved enough to persist trustworthy relation; until then vendor remains deny-all.
4. O-033 permission identifiers/grants tetap dikelola terpisah; migration resource tidak boleh diam-diam mengseed permission.
5. Semua FK diarahkan pada nama tabel/PK aktual dari 22/23/24/26; composite FK untuk same-application/project/package/version disepakati.
6. Table overlap dengan schema lama `05-DATABASE-DESIGN.md` direkonsiliasi; pilih satu sumber model dan tandai daftar lama sebagai konseptual/historis jika memang bukan target schema.
7. Material SKU/UOM, snapshot pricing, KKF/RAB lineage, dan dokumen/MTO version references diselesaikan tanpa membuat master data kedua.
8. Setiap lifecycle memiliki source status tunggal, daftar transisi eksplisit, terminal/revision rules, dan immutable approval record.
9. SoD constraints, approval version binding, row locking/concurrency semantics, dan transaction boundaries ditetapkan.
10. Index/unique/exclusion/check/composite constraints ditinjau dengan query aktual; data retention/hard-delete rules jelas.
11. Migration sequence, rollback safety, and PostgreSQL disposable integration test plan disetujui; target database harus secara eksplisit diidentifikasi dan disposable.
12. Setelah approval, desain migration dibuat terpisah dan reversible; migration tidak dijalankan sampai ada persetujuan eksekusi target.

## 6. Checklist approval desain

- [ ] RKM plan/version/detail/decision schema dan source snapshots approved.
- [ ] Vendor company/account/project/vendor assignment relation and eligibility approved.
- [ ] Work Order cardinality, lifecycle, actor/approval boundaries, inputs and amendments approved.
- [ ] Progress, verification, inspection, completion, evidence and audit model approved.
- [ ] RAB run/items/input-price/parameter/result snapshot model approved.
- [ ] KKF case/version and already-approved NORMAL/PBP>5 approver matrix preserved.
- [ ] Feasibility scope, condition, lifecycle, actor and KKF relation approved.
- [ ] Meter installation/evidence/verifier and completion precondition approved.
- [ ] UOM mapping, ERP SKU identity, and material/KHS/BOM snapshot lineage approved.
- [ ] Document and Auto MTO actual table/PK/version references verified against T4.2.4.
- [ ] `user_role_assignments` sole source, Spatie catalog-only, and vendor fail-closed retained.
- [ ] Distinct-user AND and progress submitter/verifier SoD retained.
- [ ] Query scope ordering and report/export source-scope inheritance retained.
- [ ] O-034 closed only after actual owner approval and documented acceptance evidence.

## 7. Tahap pekerjaan berikutnya

1. Pemilik proses meninjau [dokumen proposal 35](./35-O-034-RESOURCE-MODEL-LIFECYCLE-SCHEMA.md), [audit 36](./36-O-034-DOCUMENTATION-AUDIT.md), dan readiness 37.
2. Putuskan pertanyaan OPEN dengan decision records yang eksplisit; jangan memperlakukan opsi yang diusulkan sebagai keputusan.
3. Revisi proposal 35, update register, dan minta persetujuan desain O-034.
4. Setelah O-034 dan dependensi schema disetujui, rencanakan migration secara terpisah. Permission catalog/Policy tetap menunggu O-033 dan pekerjaan authorization terkait.

**Kesimpulan:** O-034 `OPEN/BLOCKING`; implementation readiness `BLOCKED`. File proposal tidak memberi izin implementasi.

## 8. Addendum dependency analysis v3.9.0

Dokumen 38–43 menganalisis keputusan terdokumentasi dan pertanyaan pemilik proses untuk O-036/O-038/O-039/O-041. Status dependency saat checkpoint ini:

- O-036 `PARTIAL/OPEN`: workflow RKM/final approver tersedia; application reviewer dan role ULP proposer belum final.
- O-038 `OPEN`: survey dan meter actor, SoD, lifecycle, evidence, cardinality dan relationship belum final; meter verification prerequisite tetap berlaku.
- O-039 `OPEN/BLOCKING`: beberapa kewenangan vendor/progress/inspection/completion dan satu WO aktif sudah memiliki dasar; creator/reviewer/issuer, WO approval boundary, lifecycle lengkap dan relationship/cardinality masih belum final.
- O-041 `OPEN/BLOCKING`: KKF approval matrix dan snapshot principles dipertahankan; calculation actors, RAB approval, exact RAB/KKF/feasibility lineage dan feasibility actors belum final.

Addendum ini tidak menyatakan blocker terselesaikan. Migration gate pada bagian 5–7 tetap berlaku; O-034 masih `PROPOSED` dan implementation readiness tetap `BLOCKED`.

## 9. Readiness reassessment v3.11.0

| Area | Recommendation readiness | Approval/implementation status |
|---|---|---|
| Resource inventory, versioning, FK/index, transaction contract | `READY FOR OWNER REVIEW` via doc 35 section 18 | `PROPOSED`; no schema approval |
| Application/RKM/survey/meter actor/lifecycle | `READY FOR OWNER REVIEW` via docs 38/39 | `OPEN`; no owner decision |
| WO/vendor/project/progress/inspection/completion | `READY FOR OWNER REVIEW` via doc 40 | `OPEN/BLOCKING`; vendor remains deny-all |
| RAB/KKF/feasibility/price/UOM | `READY FOR OWNER REVIEW` via doc 41 | `OPEN/BLOCKING`; finance/ERP source evidence still required |
| Permission identifiers/grants | Candidate matrix in doc 34 section 10.10 | O-033 `OPEN/BLOCKING`; no final key or grant |
| Cross-domain consistency | Proposed matrix in doc 42; all open issues disposition in doc 43 | Needs owner sign-off and source-contract reconciliation |

This package is sufficiently concrete for a final design review meeting but **not** for migration readiness. Owner decisions must be recorded in document 44 with authority/date/evidence. Any unresolved choice stays `OPEN`; no proposal is promoted to approved by this readiness addendum.
