# 42 — Cross-Domain Resource, Workflow, dan Authorization Matrix

**Design baseline:** v3.8.0; **latest owner-review recommendation:** v3.11.0, 5 November 2026  
**Status:** matriks sintesis; keputusan existing dipertahankan, hubungan usulan tetap `PROPOSED/OPEN`.

Decision capture dikelola di [Owner Decision Register, dokumen 44](./44-OWNER-DECISION-REGISTER.md); belum ada isian yang dapat dianggap sebagai owner approval.

## 1. Aturan lintas domain

- `user_role_assignments` satu-satunya sumber role/unit/status/validity assignment (D-AUTH-001); Spatie hanya catalog (D-AUTH-002).
- SAME_UNIT tetap scope default; SYS_ADMIN tidak otomatis memperoleh akses bisnis atau data lintas organisasi (D-AUTH-004/007).
- Role dari catalog aktif; nama role saja tidak membuktikan assignment efektif atau permission final. Permission IDs/grants menunggu O-033.
- Resource scope diturunkan dari relasi persisted, tidak dari request payload.
- Vendor fail-closed sampai relasi account-company-project-approved assignment-WO terverifikasi.
- AND approvers harus distinct users; submitter tidak final-approve versi sendiri. Progress submitter dan verifier berbeda (D-AUTH-010/012).
- `KONSTRUKSI_UP3` pada UP3 terkait hanya memperoleh child-ULP WO progress verify/inspect action scope (D-AUTH-009/013); tidak berarti read/mutate/approve umum.
- Export memerlukan permission terpisah dan mewarisi scope sumber; SQL filter sebelum pagination, sorting, count, aggregation, export (D-AUTH-011).
- RKM bukan PO/procurement, tidak otomatis membuat WO atau transaksi stok.

## 2. Resource relationship matrix

| Parent → Child | Cardinality / FK contract | Snapshot/version | Status | Authorization boundary / open point |
|---|---|---|---|---|
| Application → Survey | `applications` parent; survey identity/version dirancang di T4.2.3; jumlah survey per application belum dikunci | Survey result/version dan measurements; exact document version | Survey wajib, schema/actor mapping ada di design; lifecycle actor OPEN O-038 | Application ULP scope; survey assigner/surveyor/reviewer/approval OPEN |
| Application → RKM | RKM plan per UP3/periode; detail per ULP; direct application FK/source-demand relation belum disetujui | Forecast/pipeline/source demand snapshot per plan/version | RKM flow approved; detailed schema proposed | ULP detail berada pada parent UP3; concrete proposer role O-036; tidak ada auto-procurement |
| Application → RAB | Proposal satu/multiple runs per application | Run input/result/hash; drawing/MTO/BOM/prices/parameters/engine | Snapshot principle approved; schema/actors O-041 | Application scope; RAB runner/reviewer/standalone approval OPEN |
| Application → Feasibility | Conditional via `requires_feasibility_study`; number of study/scenarios OPEN | Versioned technical/financial inputs and result | Conditional need approved; linkage/lifecycle OPEN O-041 | Application scope; actor/approver OPEN |
| RAB → KKF | Exact run cardinality and whether one or multiple scenarios OPEN | KKF pins exact RAB run(s) and own formula/inputs snapshot (proposed) | KKF approvals approved; lineage OPEN O-041 | Version-specific; normal/PBP approval matrix; role keys pending O-033 |
| RAB → BOM/material | FK to actual T4.2.2 catalog/version plus calculation-line snapshots | SKU, KHS/BOM version, unit/conversion, selected actual price and source | Reuse/master principles approved; UOM/price priority open | No duplicate material/pricing master; no assumed `materials.unit_id` |
| RKM → WO | No approved direct FK or automatic creation | RKM approved version may not silently act as procurement/WO | No auto-PO/procurement is approved; direct relation OPEN | Do not grant WO issuance from RKM approval |
| Application/project → WO | One application/pekerjaan produces one active WO; historical/project cardinality details OPEN | Exact approved drawing/BOM/RAB references pinned; immutable amendment/change records | High-level relationship approved; detailed lifecycle O-039 | Scope from persisted WO→project/application→ULP→UP3 |
| Project → Vendor assignment → WO | Assignment selects company; WO uses approved, valid assignment; assignment cardinality/replacement scope OPEN | Assignment version, decision/validity snapshot | Select `KONSTRUKSI_UP3`, approve/reject `ASMAN_KONSTRUKSI` recorded; persisted model proposed | Vendor deny-all until full chain valid; O-029/O-039 |
| WO → Progress submissions → Verifications | WO receives versioned submissions; numbering/cumulative rules OPEN | Submission payload/evidence hash; verification decision binds submission | Submitter ≠ verifier approved; exact states OPEN | Vendor chain or authorized internal assignment; `KONSTRUKSI_UP3` verify child-ULP action scope |
| WO → Inspections → Completion decisions | Inspections and completion decision proposed; multiplicity/reinspection rules OPEN | Checklist/evidence/decision snapshot | `KONSTRUKSI_UP3` inspect special action; `ASMAN_KONSTRUKSI` completion role known | Inspector/final approver SoD open; completion preconditions need decision |
| Application/WO → Meter installation | Application is business prerequisite; optional WO link proposed; exact relation/cardinality OPEN | Meter identity/evidence/verification version | Verification before application `COMPLETED` required | Meter actors/SoD OPEN O-038; cannot infer WO linkage |
| T4.2.4 document/version → Survey/RAB/KKF/WO/Meter evidence | Reuse document logical identity/version/review cycle and snapshot; no duplicate files subsystem | Exact document/version IDs, hashes, workflow snapshots | T4.2.4 design; domain FK contracts require reconcile | All access through scoped document checks; export inherits source scope |

## 3. Workflow and authority matrix

| Domain/action | Actor/scope | Reviewer/approver & SoD | Decision status |
|---|---|---|---|
| Application create/update/submit | `NIAGA_RETAIL`, application ULP, required fields before submit | Application reviewer/return/final status actor unknown | Create/input role documented; review O-036 OPEN |
| Drawing package submission | `MANAGER_ULP`, package/application ULP | `PERENCANAAN` AND `KONSTRUKSI_UP3`, same version, distinct users | Approved for drawing only |
| Survey assign/execute/submit/review/approve | Role/actor unresolved; separate activities | Surveyor-reviewer SoD and formal approval unresolved | O-038 OPEN |
| RKM prepare/submit | ULP; exact proposer role unresolved | `PERENCANAAN` AND `KONSTRUKSI_UP3`, distinct; final `UP3_MANAGER`; submitter not final approver | RKM flow approved; role O-036 OPEN |
| Vendor select/assignment | `KONSTRUKSI_UP3` selects within eligible candidates | `ASMAN_KONSTRUKSI` approve/reject assignment; user-level separation not confirmed | Workflow recorded; relation/vendor auth blocked |
| WO create/review/approve/issue | Creator/reviewer/issuer not finalized; persisted scope | Separate WO approval/SoD not finalized | O-039 BLOCKING |
| Progress submit/verify | Vendor/internal submitter when authorized; matching WO scope | `KONSTRUKSI_UP3` special verify scope; submitter ≠ verifier | SoD and verify actor boundary approved |
| Inspect/complete | `KONSTRUKSI_UP3` inspect child-ULP WO; `ASMAN_KONSTRUKSI` final completion role | Inspector vs completion approver not decided | Role direction approved; detailed lifecycle OPEN |
| Meter install/evidence/verify | All actor roles OPEN | Installer/verifier SoD OPEN | Meter verification pre-completion approved; O-038 OPEN |
| RAB run/review/approve | Runner/reviewer and standalone approval OPEN | No approval inferred | O-041 BLOCKING |
| KKF run/approve | Runner/reviewer OPEN; approvers as matrix below | AND approvers distinct; submitter not final approver | Approval matrix approved |
| Feasibility run/review/approve | Actor and trigger OPEN | Relation to KKF and SoD OPEN | O-041 BLOCKING |
| Return/reject/cancel/amend/export | Domain-specific actors/states not generally inferable | Preserve evidence/version; export separate permission | Permission keys pending O-033; each lifecycle must be decided |

### KKF approval matrix

| Condition | Required approvals |
|---|---|
| Normal / PBP ≤5 years | `ASMAN_PERENCANAAN` AND `ASMAN_KONSTRUKSI`, distinct users |
| PBP >5 years | `ASMAN_PERENCANAAN` AND `ASMAN_NIAGA` AND `ASMAN_KONSTRUKSI` AND `UP3_MANAGER`, all distinct |
| Submitter | Cannot final-approve same version |

## 4. Action, actor, scope, and SoD matrix

| Action | Application / RKM | Survey / Meter | WO / Vendor / Progress | RAB / KKF / Feasibility | Scope and reviewer/approver | SoD | Status |
|---|---|---|---|---|---|---|---|
| Create | Application: `NIAGA_RETAIL`; RKM: ULP actor not finalized | Survey/meter actor OPEN | WO creator OPEN; vendor company/project creator OPEN | Run/study creator OPEN | Resource's persisted ULP/UP3/application; no caller-supplied scope | No general create SoD approved | Application input role known; remainder OPEN |
| Submit | Application submit by `NIAGA_RETAIL` per design; RKM ULP proposer role OPEN | Survey result/evidence submitter OPEN; meter evidence submitter OPEN | Progress submitter vendor/internal only when valid relations/scope | Calculation/study submission actor OPEN | Exact resource/version; vendor only via verified relation | RKM submitter cannot final-approve own version; progress submitter ≠ verifier | Mixed; see issue status |
| Review | Application reviewer OPEN; RKM validators: `PERENCANAAN` AND `KONSTRUKSI_UP3` | Survey reviewer OPEN; meter verifier OPEN | WO reviewer OPEN; progress verifier `KONSTRUKSI_UP3` special scope | RAB/KKF/feasibility reviewer OPEN | Persisted version and organizational chain | AND reviewers distinct; progress verifier distinct from submitter | RKM/progress boundary approved; others OPEN |
| Return | Application/RKM actor and state semantics OPEN | Survey/meter actor and resubmission semantics OPEN | WO/progress return/rework actor/state OPEN | RAB/KKF/feasibility return actor/state OPEN | Resource version and reason required (recommended) | No additional generic SoD beyond applicable submitter rule | PROPOSED / OPEN |
| Reject | Application reviewer/final authority OPEN; RKM validators/UP3_MANAGER decisions within approved flow, return/reject semantics incomplete | Survey/meter rejection actor OPEN | Vendor assignment reject by `ASMAN_KONSTRUKSI`; WO reject authority OPEN; progress decision records proposed | KKF approvers may decide within approved matrix; calculation/study rejection lifecycle otherwise OPEN | Exact candidate/version, persisted resource scope | AND approvers distinct; submitter cannot final-approve same version | Some role decisions approved; transitions partly OPEN |
| Approve | Application final-status authority OPEN; RKM final `UP3_MANAGER` after both validations | Formal survey/meter approval OPEN | Vendor assignment `ASMAN_KONSTRUKSI`; WO approval separate/open; completion `ASMAN_KONSTRUKSI` | KKF fixed matrix; RAB standalone approval OPEN; feasibility approval OPEN | Exact resource/version; approval must not create procurement automatically | Distinct users for AND; submitter not final approver of own version | Approved only for named flows |
| Issue | Not a generic application/RKM action; RKM approval does not issue PO | Not applicable/OPEN for meter work instruction | WO issuer OPEN; approved vendor assignment ≠ WO issuance | Not applicable; calculation run is not issuance | WO exact approved inputs + valid vendor assignment are prerequisites per design direction | Creator/issuer separation OPEN | WO issue BLOCKING |
| Execute | Not applicable | Survey execution actor OPEN; meter installer OPEN | Vendor/internal execution only under validated WO assignment/scope | Calculation execution actor OPEN | Persisted application/WO; vendor chain fail-closed | Installer/submitter vs verifier not decided except progress rule | OPEN/BLOCKED |
| Verify | Application review/verification type OPEN; RKM validators as above | Survey review/approval and meter verification actors OPEN | Progress verifier: effective `KONSTRUKSI_UP3` assignment on parent UP3, child-ULP WO only | RAB/KKF/feasibility review actors OPEN | Persisted chain; action-specific child-WO scope, not descendant read | Progress submitter and verifier must differ | Progress scope approved; other verification OPEN |
| Inspect | Not applicable | Meter technical check actor OPEN | Effective `KONSTRUKSI_UP3` assignment on parent UP3, child-ULP WO only | Not applicable | WO/application persisted; action-specific inspect only | Inspector vs final completion approver not decided | Role/scope direction approved |
| Complete | Application completion status actor OPEN | Verifikasi pemasangan meter valid wajib sebelum application `COMPLETED`; meter actor OPEN | Final WO completion role `ASMAN_KONSTRUKSI` recorded; detailed guards OPEN | KKF/feasibility completion state semantics OPEN | Resource status transition requires persisted required preconditions | Inspector/final approver separation proposed, not approved | Partial / OPEN |
| Cancel | Application/RKM/survey/meter cancellation authority OPEN | Actor/effect OPEN | WO/vendor assignment cancel/revoke authority and downstream effects OPEN | RAB/KKF/feasibility cancel authority OPEN | Persisted resource and audit reason; vendor access revocation required | No cancel SoD rule finalized | OPEN |
| Amend | Application correction through version/revision concepts; exact authority OPEN; RKM amendment creates new version/revalidation | Survey/meter replacement/revision rules OPEN | WO amendment must preserve issued history and use change request; authority/effects OPEN | New calculation/version on input change; exact authority OPEN | Pin prior version and source snapshot; no in-place approved mutation | Existing approval must not silently carry forward | RKM version rule approved; other lifecycle specifics OPEN |
| Export | Source-domain role/permission mapping pending | Same source scope | Same source scope; vendor field access not assumed | Per-domain permission; no global bypass | Apply source predicate before pagination/count/aggregation/export | No additional export SoD decided; audit required | Scope/export principle approved; keys/open issue O-033/O-037 |

`OPEN` means no final role or rule can be inferred from the current source documents. Even when an actor is known for a particular action, this does not imply a final permission identifier or role grant; O-033 remains blocking.

## 5. Cross-domain status and implementation gates

| Gate | Current status |
|---|---|
| Resource model O-034 | `OPEN/BLOCKING`, proposal 35 remains `PROPOSED` |
| Application/RKM proposer/reviewer | O-036 `PARTIAL/OPEN` |
| Survey/meter actors/lifecycle | O-038 `OPEN` |
| WO lifecycle/cardinality/issue | O-039 `OPEN/BLOCKING` |
| RAB/KKF/feasibility actors and lineage | O-041 `OPEN/BLOCKING` |
| Permission IDs/grants | O-033 `OPEN/BLOCKING` |
| Vendor identity/eligibility | O-029 `OPEN`; vendor access remains deny-all |
| UOM and price selection | T4.2.2 decisions needed before resource migration |

Before any migration: reconcile actual T4.2.1–T4.2.4 table/PK/FK contracts; decide unresolved cardinality/status authority; preserve version snapshots and audit; confirm all SoD; define transaction/concurrency behavior; get explicit owner approval of updated O-034. Analysis is not implementation approval.

## 7. Consolidated owner-review recommendation matrix — v3.11.0

All rows below are `PROPOSED / READY FOR OWNER APPROVAL` where a complete recommendation is available. They do not grant permission, close an issue, or amend an approved decision. Detailed role/permission identifiers are in section 10.10 of document 34; domain lifecycles are in documents 38–41; O-034 relation/constraint proposal is in document 35.

| Domain | Recommended owner/creator/reviewer/approver | Recommended cardinality and lifecycle | Authorization / SoD |
|---|---|---|---|
| Application | `NIAGA_RETAIL` create/submit; `MANAGER_ULP` administrative review, return/reject by approved criteria and `READY_FOR_SURVEY` | Existing application aggregate; status steps DRAFT/SUBMITTED/ADMIN_REVIEW/READY_FOR_SURVEY; survey remains mandatory | Same persisted ULP; reviewer/submitter separation recommended; no application technical gate duplicating survey |
| RKM | `MANAGER_ULP` accountable ULP submitter; preparation may be same person; existing UP3 validator/final roles | Plan per UP3/period; versioned details by source ULP; revisions repeat approvals | Existing two distinct AND validators; `UP3_MANAGER` final, submitter cannot final approve; no procurement |
| Survey | `MANAGER_ULP` assigns/reviews; `TEKNIK` executes/submits; no separate formal approval by default | Application-owned case; multiple version/attempt history; accepted survey before technical downstream when required | ULP scope; surveyor ≠ reviewer; no new role |
| Drawing/Auto MTO | Existing ULP submission gate `MANAGER_ULP`; `PERENCANAAN` AND `KONSTRUKSI_UP3` review existing versions | Reuse T4.2.4 document/package/version/snapshot tables | Existing AND distinct-user requirement; no duplicate document subsystem |
| Meter | `MANAGER_ULP` assigns/verifies; `TEKNIK` installs; vendor only after O-029 chain; system enforces completion guard | Multiple historical attempts/replacements, one current verified point per service point | Same application/WO persisted scope; installer ≠ verifier; child-WO special scope not extended to meter |
| Vendor/project | Centrally governed vendor owner; `KONSTRUKSI_UP3` selects; `ASMAN_KONSTRUKSI` approves assignment (existing) | Recommended 0..1 project per application/work; assignment history per WO/version, one effective approved assignment | Fail-closed until account→company→project→assignment→WO valid; no unit-only vendor scope |
| WO/progress/inspection/completion | `KONSTRUKSI_UP3` drafts; `PERENCANAAN` reviews inputs; `ASMAN_KONSTRUKSI` approves/issues/completes (proposal except existing final role) | One active WO per application/work; immutable versions; period/item progress; repeated inspection; append-only completion decisions | Existing child-ULP verify/inspect action scope only; submitter ≠ verifier; inspector ≠ final approver recommended |
| RAB | `TEKNIK`/`PERENCANAAN` prepare; `PERENCANAAN` runner; `ASMAN_PERENCANAAN` reviewer candidate; no standalone approval by default | Multiple immutable runs; each run snapshots input, selected prices/UOM, formulas and engine | Application scope; runner/reviewer separation recommended; export separate |
| KKF | `PERENCANAAN` runner; `ASMAN_PERENCANAAN` reviewer candidate; existing named approval matrix | Each version pins one RAB run; exact version/hash approvals; calculation job state separate | Existing normal/PBP AND approvers distinct; submitter not final approver |
| Feasibility | `PERENCANAAN` runner; `ASMAN_PERENCANAAN` reviewer/acceptance candidate | Conditional; versioned scenarios; KKF pins exact accepted scenario if required | Same application scope; acceptance authority remains owner decision |
| Price/UOM | `ASMAN_KONSTRUKSI`/data steward propose; `UP3_MANAGER` approve mapping/conversion candidates | Internal UP3 price preferred, external official fallback; block if ambiguous; exact effective approved UOM conversion only | Dedicated master permissions proposed; maker-checker; no implicit selection |
| Reports/export | Source-domain owner approves metrics/columns; source-domain roles only | Initial metrics and field inventory proposed in doc 34 | Apply source predicate before aggregation/export; separate per-domain export permission; mask sensitive fields by default |

This matrix is the recommended integrated design package for owner review. All recommended roles and status names not already in the approved baseline remain unapproved.
