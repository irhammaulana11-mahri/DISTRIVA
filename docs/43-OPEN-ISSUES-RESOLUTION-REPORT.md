# 43 — O-036/O-038/O-039/O-041 Resolution Analysis Report

**Documentation baseline:** v3.11.0 (integrated owner-review recommendation pack; prior analysis sources 38–43 retained)  
**Tanggal:** 5 November 2026  
**Status keseluruhan:** `READY FOR OWNER REVIEW / IMPLEMENTATION BLOCKED`  
**Cakupan:** analisis keputusan existing dan opsi/rekomendasi; tidak ada keputusan pemilik proses baru.

Keputusan owner dicatat pada [dokumen 44](./44-OWNER-DECISION-REGISTER.md). Register tersebut belum berisi keputusan owner yang disahkan. Bagian 8 menambahkan rekomendasi konkret untuk semua issue open/partial yang tercatat; rekomendasi tidak mengubah status issue.

## 1. Ringkasan eksekutif

Dokumen domain yang tersedia memberi sejumlah keputusan eksplisit yang dapat digunakan tanpa mengubahnya: RKM approval flow, KKF approval matrix, vendor selector/assignment approver, satu WO aktif per application/pekerjaan, progress submitter/verifier SoD, `KONSTRUKSI_UP3` child-WO special scope, final completion role, dan meter verification sebagai prasyarat application completion.

Namun, keempat issue belum seluruhnya terselesaikan:

| Issue | Status setelah audit | Kesimpulan |
|---|---|---|
| O-036 | `PARTIAL / OPEN` | RKM flow/final approver sudah ada; application reviewer dan role konkret ULP proposer belum diputuskan |
| O-038 | `OPEN` | Survey/meter structural fields dan completion prerequisite ada; actors, SoD, formal approval, lifecycle penuh, evidence rules belum ditentukan |
| O-039 | `OPEN / BLOCKING` | Vendor assignment roles, one active WO direction, progress/inspection/completion boundary tersedia; WO create/review/issue approval, cardinality detail, transitions/amend/cancel belum final |
| O-041 | `OPEN / BLOCKING` | Snapshot/reproducibility dan KKF approvers disetujui; RAB/KKF runners/reviewers, RAB approval, RAB↔KKF exact lineage, feasibility lifecycle/actors belum final |

O-034 tetap `OPEN/BLOCKING`, dokumen 35 tetap `PROPOSED`, dan implementation readiness tetap `BLOCKED`. Dokumen analisis tidak menutup issue atau mengizinkan migration.

## 2. Keputusan existing yang dipertahankan

1. PostgreSQL sebagai database.
2. `user_role_assignments` sebagai satu-satunya sumber assignment; Spatie catalog-only.
3. Tidak membuat role Pengawas Jaringan baru.
4. ULP mengusulkan RKM; `PERENCANAAN` AND `KONSTRUKSI_UP3` memvalidasi oleh user berbeda; `UP3_MANAGER` final approver; submitter tidak final-approve versi sendiri; RKM tidak membuat PO/procurement.
5. `NIAGA_RETAIL` menginput/melengkapi aplikasi; nomor telepon wajib sebelum submit.
6. `MANAGER_ULP` adalah gate submission paket gambar, bukan otomatis application reviewer atau RKM proposer.
7. Survey wajib; drawing/feasibility kondisional; meter verification dilakukan sebelum application `COMPLETED`.
8. Satu application/pekerjaan PB/PD menghasilkan satu WO aktif; WO berisi paket/tugas/material dari input approved.
9. `KONSTRUKSI_UP3` memilih vendor; `ASMAN_KONSTRUKSI` menyetujui/menolak vendor assignment. Hal ini bukan approval/issuance WO.
10. Vendor tetap deny-all sampai hubungan account/company/project/approved assignment/WO persisted dan verified.
11. Vendor/internal progress submitter berbeda dari verifier; `KONSTRUKSI_UP3` special scope untuk child-ULP WO verify/inspect.
12. `ASMAN_KONSTRUKSI` adalah final completion approver dalam keputusan yang tercatat; SoD inspector-vs-final approver belum disahkan.
13. KKF normal dan PBP >5 tahun menggunakan approver matrix yang tercantum di docs 16/34/35; AND users distinct; submitter tidak final-approve.
14. Calculation input, parameter, result, price selected dan historical versions harus dapat direproduksi; approved version immutable.
15. Export mempunyai permission domain terpisah dan mewarisi source scope; scope SQL diterapkan sebelum pagination/count/aggregation/export.

## 3. Rekomendasi `PROPOSED` — bukan keputusan

- Pisahkan application completeness review dari survey review dan drawing approval. Jangan gunakan approval gambar `MANAGER_ULP` sebagai dasar reviewer application.
- Pisahkan survey assignment, execution/submission, review dan formal approval; ikat review ke versi survey spesifik.
- Untuk RKM, pilih role ULP dari role aktif yang disahkan atau delegation/task rules yang dicatat; jangan menambah role otomatis.
- Gunakan lifecycle WO eksplisit, perubahan sebagai version/change request, status teknis calculation terpisah dari approval bisnis, dan exact source-version pinning.
- Pertahankan evidence dan keputusan historis secara immutable; definisikan reason/transition actor sebelum implementasi.
- Tetapkan actor, cardinality dan relationship contract pada meeting/decision record pemilik proses, bukan dalam source seeder atau migration.

Rekomendasi rinci dan opsi ada pada dokumen 38–42; tidak satu pun dianggap `APPROVED`.

## 4. Keputusan yang masih membutuhkan pemilik proses

### O-036

- Application reviewer (ULP atau UP3), tahap administrasi vs teknis, return/reject/final status authority.
- Apakah reviewer application boleh menjadi survey reviewer.
- Concrete role/authority ULP RKM preparer dan submitter; aturan delegasi; apakah preparer dan submitter harus berbeda.

### O-038

- Survey assigner, surveyor, reviewer, formal approver; SoD surveyor-reviewer.
- Apakah survey harus formal approved sebelum drawing/MTO.
- Meter installer, evidence submitter, verifier, completion decider; SoD.
- Evidence minimum, one/multiple installations, replacement/rework and meter-to-WO relation.

### O-039

- WO creator, reviewer, issuer, possible independent WO approver; SoD.
- Project/application/WO historical cardinality dan vendor assignment scope/replacement.
- Transition rules return/reject/hold/cancel/amend; progress cumulative/version/rework logic.
- Completion prerequisites, inspection SoD, material reconciliation and exact approved inputs.
- Vendor access revocation, eligibility source (O-029), link verified account-company-project-assignment-WO.

### O-041

- RAB runner/preparer/reviewer, apakah ada approval mandiri dan trigger.
- Selected price authority/priority dan material UOM mapping.
- KKF runner/reviewer dan exact RAB run(s)/feasibility version lineage.
- PBP boundary/financial methodology and return/reject/cancel transitions.
- Feasibility trigger, number of scenarios, actor, approval and relation to KKF.

## 5. Dependency matrix

| Dependency | Menghambat | Status |
|---|---|---|
| O-033 permission identifiers/role grants | Seeder, Policy dan ability authorization | `OPEN/BLOCKING` |
| O-034 resource model/lifecycle and exact schema | Domain migration/Policy/query scope | `OPEN/BLOCKING` |
| O-029 vendor eligibility/organizational boundary | Vendor persisted relationship and access | `OPEN`; deny-all retained |
| O-036 | Application/RKM actor matrix | `PARTIAL/OPEN` |
| O-038 | Survey/meter tables, transition and completion validation | `OPEN` |
| O-039 | WO/vendor/progress/inspection/issuance schema | `OPEN/BLOCKING` |
| O-041 | RAB/KKF/feasibility version and approval schema | `OPEN/BLOCKING` |
| T4.2.2 UOM/pricing priority | Calculation item FK/price snapshots | `OPEN` |
| T4.2.4 actual document/Auto MTO PK contracts | Resource FK/version snapshots | Must reconcile to document 26 |
| Owner approval | Close issues and update O-034 to final design | Not yet available |

## 6. O-034 readiness

**`BLOCKED` — no migration or domain implementation.**

Acceptance conditions remain: decisions above are recorded with source/owner/date; proposal 35 is revised and explicitly approved; relationship/cardinality/status/version authority reconciled with schema 22/23/24/26; duplicate conceptual schema in document 05 reconciled; composite FK/SoD/concurrency/transactions/rollback plan reviewed; manifest integrity checked. O-033 remains separate and permission keys/grants cannot be inferred from this analysis.

## 7. Dokumen keluaran dan sinkronisasi

- 38 — O-036 Application reviewer/RKM proposer.
- 39 — O-038 survey/meter actors and lifecycle.
- 40 — O-039 WO lifecycle, relation and approval boundary.
- 41 — O-041 RAB/KKF/feasibility lifecycle.
- 42 — Cross-domain resource/workflow/authorization matrix.
- 43 — this report and dependency/readiness summary.

Decision Register retains current issue statuses. `16-FINALIZED-BUSINESS-DECISIONS.md` is not changed because no new owner-approved business decision was received. No application test was run.

## 8. All-open-issue disposition and recommendation — v3.11.0

This table covers every open/partial issue recorded in document 15 at this checkpoint. Statuses are preserved unless the documented baseline itself resolves the exact scope. `READY FOR OWNER APPROVAL` describes a complete recommendation, not an approved decision or CLOSED issue.

| Issue | Current status | Concrete recommendation / required evidence | Classification |
|---|---|---|---|
| O-001 | OPEN | One ERP SKU per distinct material variant; confirm actual ERP codes before creating official master rows. Do not split by name alone. | OPEN — ERP data needed |
| O-002 | OPEN | Keep MCB curve/breaking-capacity/brand as source attributes only when official ERP/SOP supplies them; no speculative mandatory columns. | NON-BLOCKING — owner/spec source |
| O-003 | OPEN | DISTRIVA does not manage inventory lots; preserve cable quantities in approved UOM and delegate lot/roll/drum to external material system. TC 2×10/2×16 in ULP uses meter per existing baseline. | NON-BLOCKING — external-system confirmation |
| O-004 | OPEN | Record meter serial per installation/evidence event; verify source uniqueness and replacement lifecycle; do not make a separate meter inventory module. | READY FOR OWNER APPROVAL |
| O-005 | OPEN | Keep warehouse stock/transfer/issue truth in external material application; DISTRIVA sends requirements after approved+issued WO. | READY FOR OWNER APPROVAL / integration contract open |
| O-006 | OPEN | No DISTRIVA stock balance means negative-stock policy belongs to source inventory system; do not implement a local stock control. | NON-BLOCKING for domain schema |
| O-007 | OPEN | Route physical return to the external material system by its category/location policy; DISTRIVA stores external reference/status only. | NON-BLOCKING — integration/SOP evidence |
| O-008 | OPEN | Retain approved rounding only at final total; require official finance examples and signed workbook validation before releasing calculation engine. | PARTIAL / READY FOR OWNER APPROVAL |
| O-009 | OPEN | PPN rate must be effective-dated from official tax source; never hard-code 11% as timeless rule. Finance/legal must supply effective regulation. | OPEN/BLOCKING for regulated calculation |
| O-010 | OPEN | Load official effective tariff table by class/power and retain source document/version. | OPEN/BLOCKING for affected RAB/KKF |
| O-011 | OPEN | Use tariff-block/LWBP rules only from official tariff table; unsupported class blocks calculation rather than defaulting. | OPEN/BLOCKING for affected calculation |
| O-012 | OPEN | Obtain multi-month/multi-class 309 source samples; record data provenance and validate parsing before production. | NON-BLOCKING to schema; blocking validation |
| O-013 | OPEN | Use current signed contract/schedule for JASA/MDU/DPT/TIBET/TERM/KR MATERIAL; missing or expired rate blocks affected line calculation. | OPEN/BLOCKING for affected RAB |
| O-014 | OPEN | Keep parameter values/versioned and require official finance owner approval for WACC/BPP/OM/loss/load factor/horizon. Discount Rate remains the NPV threshold; RWACC indicator only. | OPEN/BLOCKING for KKF |
| O-015 | OPEN | Model BP/UJL rules as effective-dated parameter/formula versions by scenario; authoritative owner evidence required. | OPEN/BLOCKING for affected KKF |
| O-016 | OPEN | Use currently finalized output list and exclude forms identified as unnecessary; validate exact templates against approved official samples before closing. | PARTIAL / READY FOR OWNER APPROVAL |
| O-017 | OPEN | Adopt O-036/O-038 lifecycle proposal; no workflow status/approval grant until owner confirms transition matrix. | READY FOR OWNER APPROVAL, issue stays open |
| O-018 | OPEN | Reuse explicit drawing/RKM/KKF/WO decisions; approve remaining actor map in docs 38–41 without creating roles. | PARTIAL; tied to O-036–O-041 |
| O-019 | OPEN | Forecast separately by funnel stage; primary committed-work target = issued WO, with submitted/approved applications reported as separate scenarios. Calibrate only with historic conversion. | READY FOR OWNER APPROVAL |
| O-020 | OPEN | No endpoint/payload assumptions; require signed interface contract and credentials/security review for Bot Daftung/EIS/payment integrations. | OPEN/BLOCKING for integration |
| O-021 | OPEN | Adopt WO/vendor/progress proposal in doc 40; official vendor SOP and external material interface are still required. | READY FOR OWNER APPROVAL / evidence dependency |
| O-022 | OPEN | Expose distinct targets for received applications, approved applications, issued WO, completed WO; avoid one ambiguous forecast target. | READY FOR OWNER APPROVAL |
| O-023 | OPEN | Safety stock/service level remain in external inventory system; DISTRIVA forecast may provide demand inputs only. | NON-BLOCKING to DISTRIVA core |
| O-024 | OPEN | RKM records material/work demand by originating ULP and period; budget is a separate summary/snapshot, never procurement authorization. | READY FOR OWNER APPROVAL |
| O-025 | OPEN | Until enough history exists, publish unweighted scenarios and confidence limits; do not apply undocumented pipeline probabilities. | READY FOR OWNER APPROVAL |
| O-026 | OPEN | Approved RKM amendment creates immutable next version and repeats both validations and UP3_MANAGER approval; no old-version mutation. | READY FOR OWNER APPROVAL |
| O-028 | PARTIAL/OPEN | Maintain disposable PostgreSQL evidence; production/environment extension privileges remain environment deployment prerequisite, not design approval. | NON-BLOCKING for owner design; implementation gate |
| O-029 | OPEN | Central vendor registry; verify legal company/account, active agreement, project scope and approved WO assignment. Access is deny-all until full persisted chain and owner-authorized eligibility exist. | OPEN/BLOCKING |
| O-030 | OPEN | Never recycle official unit code; retain retired code as historical alias on old UUID, issue new UUID/code on reorganization. Validate with organization master owner. | READY FOR OWNER APPROVAL |
| O-031 | PARTIAL | Preserve canonical `web` guard; final permission identifiers/grants are O-033 and remain unseeded. | PARTIAL; O-033 blocking |
| O-033 | OPEN/BLOCKING | Review identifier/action matrix in doc 34 section 10.10; sign every role-scope grant. No key is final and no seed/Policy work is authorized. | READY FOR OWNER APPROVAL, remains BLOCKING |
| O-034 | OPEN/BLOCKING | Review schema/resource/cardinality/lifecycle proposal in doc 35 section 18 and actor docs 38–41; approve only after contracts 22–26 reconcile. | READY FOR OWNER APPROVAL, remains BLOCKING |
| O-036 | PARTIAL/OPEN | Review actor/lifecycle recommendation in doc 38 section 7; existing RKM decisions stay fixed. | READY FOR OWNER APPROVAL |
| O-037 | OPEN/PARTIAL | Adopt source-scoped metrics and export matrix in doc 34 section 10.10; approve exact KPI definitions, fields, visibility and retention. | READY FOR OWNER APPROVAL |
| O-038 | OPEN | Review survey/meter actor, evidence, cardinality and SoD proposal in doc 39 section 7. | READY FOR OWNER APPROVAL |
| O-039 | OPEN/BLOCKING | Review WO actor, version/cardinality, transitions, vendor and completion proposal in doc 40 section 9. | READY FOR OWNER APPROVAL, remains BLOCKING |
| O-041 | OPEN/BLOCKING | Review calculation actors, lineage, feasibility, price priority and UOM proposal in doc 41 section 7; official finance/ERP evidence required. | READY FOR OWNER APPROVAL, remains BLOCKING |

Closed issues O-027, O-032, O-035, O-040, and O-042 remain closed only within their documented decisions. No issue was closed by a recommendation. Financial/source-data blockers (O-009–O-015) cannot be resolved by architecture prose alone.

### 8.1 Owner roles required

| Decision group | Required approver(s) |
|---|---|
| Application/RKM/survey/meter | Authorized PB/PD process owner, ULP process owner, and relevant UP3 technical owner |
| WO/vendor/project | UP3 construction process owner, vendor/contract owner, and material-system owner for integration boundary |
| RAB/KKF/feasibility/pricing | Finance/planning process owner, construction owner where applicable, ERP/material data owner for price/UOM |
| Authorization and reporting | Business process owners for each domain plus security/identity owner for guard/scope/grant matrix |
| Unit-code continuity | Organizational master-data owner |

Titles are functional approval roles only; no individual, signature, date, meeting or organization mandate is asserted here. Record evidence in document 44.
