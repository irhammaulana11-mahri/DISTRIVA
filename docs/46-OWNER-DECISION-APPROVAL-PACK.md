> **Catatan tata kelola v3.16.0 — dokumen historis/referensi:** Dokumen ini dipertahankan untuk menjaga jejak analisis dan audit pada saat penyusunannya. Persyaratan nama asli, verifikasi kewenangan formal, tanda tangan, SK/surat tugas, serta urutan gate administratif di dalamnya tidak berlaku sebagai prasyarat pengembangan internal DISTRIVA. Gunakan `docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md` sebagai panduan aktif. Status issue dan temuan teknis substantif dalam dokumen ini tidak otomatis berubah; verifikasi kembali relevansinya terhadap modul yang sedang dikerjakan.

---

# 46 — DISTRIVA OWNER DECISION APPROVAL PACK

**Project:** DISTRIVA — Distribution Management Platform  
**Source documentation baseline:** v3.11.0  
**Date prepared:** 5 November 2026  
**Status:** `DRAFT — OWNER REVIEW REQUIRED`  
**Conclusion:** `READY FOR OWNER REVIEW; IMPLEMENTATION BLOCKED`

## A. Cover and executive summary

### Purpose

This pack turns the open-issue analyses into meeting-ready choices for the authorized process owners of UP3 and ULP. It records existing approved decisions separately from proposals and leaves all owner decision fields `PENDING`.

The pack is not an approval record. A technical recommendation—even one marked `READY FOR OWNER REVIEW`—does not become an owner decision until the authorized decision-maker records the decision, rationale, date and evidence in [document 44](./44-OWNER-DECISION-REGISTER.md).

### Decision workload

The current Decision Register has **37 OPEN/PARTIAL issues** requiring owner, source-document, or environment decisions:

- Priority owner decision sheets: O-039, O-029, O-036, O-038, O-041, O-033, O-034 and O-037.
- Remaining material/finance/workflow/forecast issues: O-001–O-026, O-028, O-030 and O-031.
- No new decision is presumed approved. O-027, O-032, O-035, O-040 and O-042 remain closed only within their recorded scope.

Some OPEN issues require official data, contracts, SOPs or environment evidence rather than a meeting vote alone. Their decision sheets identify the required evidence and block affected implementation until it is available.

### Non-negotiable approved baseline

- PostgreSQL; Laravel; React + Vite; Python service as documented.
- `user_role_assignments` is the sole source of user-role-unit assignment. Spatie is the role/permission catalog, not a second assignment source.
- No new `Pengawas Jaringan` role.
- `SAME_UNIT` is the default. SYS_ADMIN has no automatic business access.
- RKM: ULP proposes; `PERENCANAAN` AND `KONSTRUKSI_UP3` validate as distinct users; `UP3_MANAGER` final-approves. Submitter cannot final-approve their own version. RKM approval does not start procurement.
- `MANAGER_ULP` is the drawing submission gate, not automatically application reviewer or RKM proposer.
- One active WO per application/work. `KONSTRUKSI_UP3` selects vendor; `ASMAN_KONSTRUKSI` approves/rejects vendor assignment and is the recorded final completion approver.
- Progress submitter and verifier are different users. Effective `KONSTRUKSI_UP3` assignment on the relevant UP3 permits only the approved child-ULP WO verify/inspect actions; it is not descendant-read or general mutation access.
- Survey is mandatory. Meter verification is a prerequisite for application `COMPLETED`.
- KKF normal approvers are `ASMAN_PERENCANAAN` AND `ASMAN_KONSTRUKSI`; PBP >5-year approvers are those two plus `ASMAN_NIAGA` and `UP3_MANAGER`, all distinct users. `UP3_MANAGER` is not a normal KKF approver.
- Export permission is separate per domain and inherits source scope. Apply SQL scope before pagination, sorting, count, aggregation and export.
- Vendor stays deny-all until the persisted account–company–project–approved assignment–WO relationship is complete and verified.
- Calculation and approved versions retain immutable history/snapshots. No decision here creates a second document, material, UOM, inventory, task, or assignment subsystem.

## B. Decision overview

“Owner” below means the functional process owner that must be identified/confirmed by DISTRIVA governance; it is not a claim that a particular office-holder has been authorized. Where authority is not established by existing documents, the table states `OWNER AUTHORITY TO BE CONFIRMED`.

| Priority | Issue | Domain | Business decision required | Team recommendation | Required decision authority | Status |
|---:|---|---|---|---|---|---|
| 1 | O-039 | Work Order | Create/review/approve/issue, change/hold/cancel, history and completion | Use existing roles; separate vendor-assignment approval from WO approval; one active WO | UP3 construction process owner; authority to confirm | OPEN/BLOCKING |
| 2 | O-029 | Vendor eligibility/access | Company/account verification, project/WO eligibility, revocation | Central verified vendor registry and fail-closed persisted relationship chain | Vendor/contract owner; authority to confirm | OPEN |
| 3 | O-036 | Application/RKM | Application administrative gate; ULP RKM preparer/submitter | `NIAGA_RETAIL` submits application; `MANAGER_ULP` admin gate and recommended RKM submitter | PB/PD and ULP/RKM process owners; confirm | PARTIAL/OPEN |
| 4 | O-038 | Survey/meter | Actors, evidence, SoD, lifecycle and replacement | `MANAGER_ULP` assignment/review; `TEKNIK` execution; distinct verifier; meter guard enforced | PB/PD and ULP technical process owners; confirm | OPEN |
| 5 | O-041 | RAB/KKF/feasibility/pricing/UOM | Calculation actors, lineage, financial source selection | `PERENCANAAN` calculation/review candidates; exact snapshots; no silent price/UOM choice | Finance/planning and ERP/material data owners; confirm | OPEN/BLOCKING |
| 6 | O-033 | Authorization | Final permission identifiers and role grants | Approve granular action matrix only after actor/resource decisions; no global business grants | Each process owner plus security/identity owner; confirm | OPEN/BLOCKING |
| 7 | O-034 | Resource model | Resource ownership, relations, cardinality, lifecycle, constraints | Review proposed model in doc 35; reuse T4.2.1–T4.2.4 resources | Process owners; technical/database approval authorities to confirm | OPEN/BLOCKING |
| 8 | O-037 | Reporting/dashboard | KPI definitions, visibility, sensitive fields, export | Source-scoped reports; per-domain export; mask sensitive data by default | Domain owners and security/data owner; confirm | PARTIAL/OPEN |
| 9 | O-001–O-007 | Material/inventory | SKU attributes, lots, meter traceability, stock and returns | ERP/material application remains operational source of truth; no DISTRIVA stock ledger | Material master/inventory process owner; confirm | OPEN |
| 10 | O-008–O-016 | RAB/KKF source data | Rounding, tax, tariff, contracts and templates | Effective-dated official sources; missing/ambiguous inputs block affected calculation | Finance/tax/contract owners; confirm | OPEN |
| 11 | O-017–O-021 | Workflow/integration | Application states, approval map, pipeline, API/SOP | Adopt only documented flows; signed integration contracts required | PB/PD, integration, and domain owners; confirm | OPEN |
| 12 | O-022–O-026 | Forecast/RKM | Forecast target, safety-stock boundary, RKM scope/amendment | Separate funnel scenarios; RKM is demand planning, not procurement | Forecast/RKM process owners; confirm | OPEN |
| 13 | O-028 | PostgreSQL deployment | Extension/constraint availability outside disposable test | Verify per target environment; no production assumption | Database/platform environment owner; confirm | PARTIAL/OPEN |
| 14 | O-030 | Organization codes | Retired code reuse and history | Do not recycle official code; retain history and issue new unit identity | Organizational master-data owner; confirm | OPEN |
| 15 | O-031 | Guard/permission catalog | Guard and final catalog | Preserve confirmed `web`; permission keys remain under O-033 | Security/identity owner; confirm | PARTIAL |

## C. Decision sheets — priority issues

Decision IDs below are **proposed identifiers for recording a future owner decision**, not approval IDs already issued. Existing labels in document 44 (for example OD-039-01 through OD-039-06) identify pending questionnaire entries, not approvals; new O-039 identifiers continue after them. The O-029 sheet uses existing register entry `OD-039-06` as the canonical vendor eligibility/access decision because that entry already covers the O-029 dependency; do not create a duplicate vendor decision record. Confirm uniqueness and cross-issue references in document 44 before recording.

### O-039 — Work Order lifecycle and approval (priority 1)

**Proposed decision IDs:** `OD-039-07` through `OD-039-13`  
**Current issue status:** `OPEN/BLOCKING`  
**Decision authority:** UP3 construction process owner; exact authority/title and delegation `OWNER AUTHORITY TO BE CONFIRMED`.

#### 1. Business problem

The project has approved vendor-selection and completion boundaries, but a WO cannot be safely issued until creation, review, any independent approval, issuer, amendments, cancellation, progress, inspection and completion guards are explicit. Wrong sequencing can authorize a vendor or dispatch material on an unreviewed scope.

#### 2. Existing approved decisions

- At most one active WO per application/work.
- `KONSTRUKSI_UP3` selects the vendor; `ASMAN_KONSTRUKSI` approves or rejects the vendor assignment. This is not WO approval or issuance.
- `ASMAN_KONSTRUKSI` is the recorded final completion approver.
- Progress submitter and verifier must be different users.
- Effective `KONSTRUKSI_UP3` assignment at the relevant UP3 permits child-ULP WO verify/inspect actions only.
- Vendor access is deny-all until the persisted relationship chain is valid.
- A WO uses approved input versions; approved records are immutable. Material requirements go to the external material system only after approved and issued WO.

#### 3. Pending decisions

Creator/drafter; technical reviewer; whether a distinct approval is required; issuer; return/reject/hold/resume/cancel authority; historic and replacement WO cardinality; project-to-application relationship; vendor assignment reuse/switch; progress measurement/revision; inspector SoD; completion preconditions; rework/amendment workflow.

#### 4. Recommended decision

Approve the following as a proposed workflow, subject to owner confirmation:

| Responsibility | Recommended existing role | Unit/scope | Boundary |
|---|---|---|---|
| Draft/create WO | `KONSTRUKSI_UP3` | UP3 assignment; persisted application/project ULP determines work scope | May not issue own WO without separate approval |
| Review inputs/scope | `PERENCANAAN` | Relevant UP3 and exact WO version | Reviews source version/quantity; does not replace KKF or drawing approvals |
| WO approval | `ASMAN_KONSTRUKSI` | Exact WO version in relevant UP3 | Separate decision from vendor assignment approval |
| Issue | `ASMAN_KONSTRUKSI` after approval | Same persisted WO | Issue is separately audited; approved vendor assignment and required input versions must be valid |
| Vendor selection/assignment | Existing `KONSTRUKSI_UP3` / `ASMAN_KONSTRUKSI` | Exact project/WO relation | Existing decision; vendor eligibility O-029 must pass |
| Return/reject | Reviewer returns with reason; `ASMAN_KONSTRUKSI` rejects against approved criteria | Exact version | Rejection criteria and resubmission must be recorded |
| Hold/resume/cancel | `ASMAN_KONSTRUKSI` | Active WO | Reason and effects on vendor, progress and external material system audited |
| Progress submit/verify | Authorized vendor/internal submitter; verifier `KONSTRUKSI_UP3` under approved scope | Exact WO | Submitter ≠ verifier; vendor remains blocked until O-029 chain valid |
| Inspect/final completion | `KONSTRUKSI_UP3` inspect special scope; `ASMAN_KONSTRUKSI` final completion | Exact WO and child-ULP boundary | Inspector ≠ progress submitter; inspector/final approver separation recommended pending approval |

Recommended lifecycle: `DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → ISSUED → IN_PROGRESS → PENDING_INSPECTION → INSPECTED → PENDING_COMPLETION_APPROVAL → COMPLETED`. Return creates a revision; amendment/rework creates a new immutable version; hold/cancel/reject require reason and explicit transitions.

Recommended relationship: one logical project per application/work; no more than one active WO for that work. Historical WOs may be sequential after a terminal state. Each active WO version references one approved/effective vendor assignment. Progress is recorded by item/activity and reporting period; cumulative percentage is derived. Corrections create linked submissions, never overwrite verified progress. Completion requires verified final progress, passing inspection, required versioned evidence, applicable meter verification, and valid source versions/vendor assignment. Any material reconciliation prerequisite must be confirmed by SOP and external-system contract.

Database impact if approved: immutable WO/version and status history; explicit application/project/vendor-assignment FKs; version-pinned input references; append-only progress/verification/inspection/completion records; unique active-WO constraint; transactional distinct-user checks. Do not create a stock ledger or duplicate document subsystem.

#### 5. Alternative options

| Option | Benefits | Costs/risks | Process/system impact |
|---|---|---|---|
| A — Separate WO approval then issue (recommended) | Maker/checker boundary; issue cannot be mistaken for vendor approval | Additional approval step and cycle time; exact SoD needs enforcement | Separate approve/issue events and permissions; more audit states |
| B — No standalone WO approval; `ASMAN_KONSTRUKSI` issues after review | Fewer workflow steps | Combines authorization and issuance; easier to bypass independent review | No `work_orders.approve` action; issuance must enforce all review/input guards |
| C — Any relevant construction manager issues after review | Operational flexibility | Authority delegation and accountability unclear; broadens access | Requires explicit delegated assignment and audit rules; not recommended without SOP |

#### 6. Decision required in meeting

| Field | Owner entry |
|---|---|
| Choice / final decision | `PENDING` |
| Decision maker and position | |
| Unit | |
| Date (YYYY-MM-DD) | |
| Rationale | |
| Evidence (SOP/minutes/authority) | |
| Process, resource, authorization and schema impact | |
| Status | `PENDING` |

### O-029 — Vendor eligibility and access (priority 2)

**Register reference:** `OD-039-06` (existing pending vendor decision entry; shared with O-029).  
**Current issue status:** `OPEN`; vendor access remains deny-all.  
**Decision authority:** vendor registration/contract owner and UP3 construction process owner; exact authority `OWNER AUTHORITY TO BE CONFIRMED`.

#### 1. Business problem

A vendor role or organizational-unit assignment alone does not establish that a login belongs to the legal company selected for a specific project and WO. Without validated persisted links, vendor data access risks cross-company or cross-project disclosure.

#### 2. Existing approved decisions

- Centrally managed vendor master; one login account per vendor company; inactive vendors cannot receive new assignments.
- `KONSTRUKSI_UP3` selects; `ASMAN_KONSTRUKSI` approves/rejects assignment.
- Vendor must remain deny-all until account, company, project, approved assignment and WO relations are persisted and validated.
- No unit-only vendor authorization and no new role is implied.

#### 3. Pending decisions

Official company registry/source; verification authority and evidence; contract eligibility source and dates; vendor-to-project and assignment approvers; account suspension/revocation conditions; permitted vendor actions and data fields; whether vendors may install meters or submit only progress/evidence.

#### 4. Recommended decision

Require: verified legal company in centrally governed vendor master; active user-to-company link (one active company per login); in-force contract/eligibility for work type, project and period; project and ULP/UP3 boundary match; approved assignment to exact WO by existing roles; and active WO relation. `KONSTRUKSI_UP3` selects from eligible candidates; `ASMAN_KONSTRUKSI` approves/rejects assignment. Suspend/revoke access immediately when any company/account/contract/project/assignment/WO link becomes invalid. Derive company identity from authenticated persisted account relation, never request body.

System/database impact: vendor company, account-link history, eligibility evidence, project link, assignment decision/version and exact WO FK; temporal validation and audit. Policies/query scope must fail closed until every link is valid. No permission grants for VENDOR before O-033 and O-034 are approved.

#### 5. Alternatives

| Option | Benefits | Costs/risks | Process/system impact |
|---|---|---|---|
| A — Central vendor registry plus exact WO assignment (recommended) | Strong legal identity, project isolation, auditable revocation | Requires authoritative registry, contracts and verification process | Persisted company/account/eligibility/project/assignment/WO chain |
| B — Vendor login invited per WO by UP3 | Faster onboarding for limited pilots | Weak company-wide eligibility/history; invitation may be misdirected | Requires invitation security and verification; still deny access before company binding |
| C — Vendor access by role and UP3 unit only | Simple to administer | Unacceptably broad and not tied to company/project/WO | Conflicts with fail-closed baseline; would require formal superseding decision and security review; not recommended |

#### 6. Decision required

| Field | Owner entry |
|---|---|
| Choice / final decision | `PENDING` |
| Decision maker and position | |
| Unit | |
| Date (YYYY-MM-DD) | |
| Rationale | |
| Evidence (registry/contract/SOP/minutes) | |
| Company verification and revocation owner | |
| Status | `PENDING` |

### O-036 — Application and RKM actors (priority 3)

**Proposed decision IDs:** `OD-036-04` through `OD-036-08`  
**Current issue status:** `PARTIAL/OPEN`.  
**Decision authority:** authorized PB/PD process owner and ULP/RKM process owner; confirm titles and delegation.

#### 1. Business problem

Application intake is assigned to `NIAGA_RETAIL`, but administrative review, technical review, return/reject and “ready for next step” authority are not mapped. ULP is the RKM proposer, but the concrete preparer/submitter role is open.

#### 2. Existing approved decisions

- `NIAGA_RETAIL` inputs/completes applications; phone is required before official submission.
- Survey is mandatory; drawing and feasibility are conditional; external status is separate from internal status.
- `MANAGER_ULP` is the drawing-package submission gate only.
- RKM is proposed by ULP; `PERENCANAAN` AND `KONSTRUKSI_UP3` validate the same version as distinct users; `UP3_MANAGER` final-approves.
- Submitter cannot final-approve own version; RKM approval does not create PO/procurement.

#### 3. Pending decisions

Application administrative reviewer; whether separate technical application review is needed; return/reject and final status authority; whether application and survey reviewer may be the same; RKM preparer/submitter and delegation; whether preparer and submitter may be the same.

#### 4. Recommended decision

`NIAGA_RETAIL` creates/completes/submits the application; `MANAGER_ULP` checks administrative completeness within the application ULP, returns with reason, and marks `READY_FOR_SURVEY`. Do not add a generic technical application review: use the mandatory survey and conditional drawing/MTO processes. `MANAGER_ULP` may reject only against criteria explicitly approved in the relevant SOP; absent such criteria, return/hold rather than terminal reject. Recommend `MANAGER_ULP` as accountable RKM ULP submitter; a ULP preparer may be the same person. Existing distinct validators and final approval remain unchanged. Drawing submission remains its separate `MANAGER_ULP` gate.

System impact: explicit application state events and task/revision linkage; no duplicate review or task subsystem; RKM version submitter and ULP-origin detail; no cross-unit mutation. Approval and status transition actions require separate permission identifiers after O-033.

#### 5. Alternatives

| Option | Benefits | Costs/risks | Process/system impact |
|---|---|---|---|
| A — `MANAGER_ULP` administrative gate and RKM submitter (recommended) | Clear ULP accountability; uses existing role catalog | Adds manager workload; needs SOP for administrative reject | One administrative gate; distinct technical workflows remain |
| B — Task-assigned ULP delegate | Flexible workload and coverage | Delegation eligibility, expiration and audit must be defined | Persist assignment snapshot; permission cannot be inferred from role name |
| C — Central UP3 application reviewer | Consistent cross-ULP review | Adds queue/capacity and may duplicate technical review | UP3 scope and status authority need new workflow rules |

#### 6. Decision required

| Field | Owner entry |
|---|---|
| Choice / final decision | `PENDING` |
| Decision maker and position | |
| Unit | |
| Date (YYYY-MM-DD) | |
| Rationale | |
| Evidence | |
| Application reviewer / return / reject | |
| RKM preparer / submitter / same-user rule | |
| Status | `PENDING` |

### O-038 — Survey and meter (priority 4)

**Proposed decision IDs:** `OD-038-06` through `OD-038-11`  
**Current issue status:** `OPEN`.  
**Decision authority:** PB/PD process owner and ULP technical owner; exact positions `OWNER AUTHORITY TO BE CONFIRMED`.

#### 1. Business problem

Survey is mandatory and meter verification gates completion, but the actors, evidence, return/rework, SoD, cardinality and relationship to WO are undefined. This prevents a reliable field-work lifecycle and completion check.

#### 2. Existing approved decisions

- Survey is mandatory; drawing/feasibility are conditional.
- Meter installation verification must precede application `COMPLETED`.
- Reuse T4.2.3 task/SLA and T4.2.4 document/version/evidence system.
- Vendor cannot be an installer with system access before O-029/O-039 relationships are approved.

#### 3. Pending decisions

Survey assigner, surveyor, reviewer and formal approver; evidence minimum; status/return/reject/reschedule; relation to drawing/Auto MTO. Meter assigner/installer/evidence submitter/verifier; SoD; meter-to-application/WO cardinality; replacement/rework/cancellation; completion decider.

#### 4. Recommended decision

Survey: `MANAGER_ULP` assigns and reviews; `TEKNIK` executes/submits; surveyor and reviewer are different users. No separate formal approver by default; `ACCEPTED` survey gates downstream technical work when survey results are needed. Revisions create new versions; evidence references T4.2.4 documents.

Meter: `MANAGER_ULP` assigns and verifies; `TEKNIK` installs/submits evidence; installer/evidence submitter differs from verifier. Vendor installation is not enabled by this recommendation. System enforces a valid verification before completion when meter installation is required. Recommend one current verified meter per service point with append-only installation/replacement attempts; relate directly to application and reference WO when construction requires it. Evidence candidate: meter serial/type, application/service point, date/time, reading/test as applicable, photos and authenticated installer; owner must confirm required evidence and privacy/retention.

#### 5. Alternatives

| Option | Benefits | Costs/risks | Process/system impact |
|---|---|---|---|
| A — `MANAGER_ULP` review/verification and `TEKNIK` execution (recommended) | Uses current roles; separates field work and acceptance | Workload/competency needs SOP | Versioned survey/meter attempts, distinct verifier, completion guard |
| B — Peer `TEKNIK` reviewer; manager only assigns | Technical peer check may improve technical review | Competence and escalation path must be named | Separate task roles; no new catalog role |
| C — Formal approver for every survey/meter event | Stronger formal control | Extra delay and approval burden; no current baseline requires it | Adds approval states, records and permission grants |

#### 6. Decision required

| Field | Owner entry |
|---|---|
| Choice / final decision | `PENDING` |
| Decision maker and position | |
| Unit | |
| Date (YYYY-MM-DD) | |
| Rationale/evidence | |
| Survey actors, lifecycle and evidence | |
| Meter actors, cardinality, evidence and replacement | |
| SoD and completion guard | |
| Status | `PENDING` |

### O-041 — RAB, KKF, feasibility, pricing and UOM (priority 5)

**Proposed decision IDs:** `OD-041-06` through `OD-041-13`  
**Current issue status:** `OPEN/BLOCKING`.  
**Decision authority:** finance/planning process owner; construction owner for applicable inputs; ERP/material-data owner for price/UOM; confirm titles and delegation.

#### 1. Business problem

Calculations must be reproducible, but calculation actors, RAB approval boundary, exact RAB-to-KKF/feasibility lineage, source-price priority, UOM mapping/conversion and some official financial parameters remain unresolved. Ambiguity changes financial output and makes migration constraints unsafe to finalize.

#### 2. Existing approved decisions

- Calculation history snapshots input, parameter, master versions and selected price; approved versions are immutable.
- T4.2.2 supports external and internal UP3 price sources; selected price is snapshotted. Priority/default and internal-price change authority remain open.
- ERP is source of material and UOM identity; `materials.unit` remains VARCHAR pending verified mapping.
- `Discount Rate` is the NPV/feasibility rate; RWACC is an indicator, not an automatic substitute.
- KKF normal and PBP >5 approver matrix is fixed as stated above; AND approvers distinct; submitter cannot final-approve own version.
- No approved standalone RAB approval requirement; RKM is not RAB approval.

#### 3. Pending decisions

RAB/KKF/feasibility input preparer, runner, reviewer, return/reject and approval; exact RAB run(s) pinned by KKF; feasibility trigger/scenarios/approval and KKF relation; price selection authority/priority; ERP UOM mapping and material-specific conversion approver; official parameters, tax/tariff/contracts and PBP boundary evidence.

#### 4. Recommended decision

Recommend `PERENCANAAN` as calculation runner for RAB/KKF/feasibility, `ASMAN_PERENCANAAN` as reviewer candidate, and no separate RAB business approval by default. Keep approved KKF matrix unchanged. One KKF version pins one exact approved RAB run; comparative scenarios are explicit child records. Feasibility is conditional, versioned and KKF pins the exact accepted scenario if the owner confirms it is a prerequisite.

For price priority, propose one valid approved UP3-internal price first, then one valid official external price. If none or multiple authoritative candidates exist at the selected priority, block and resolve—never silently choose latest, combine or sum. Alternative is external always wins or explicit per-calculation selection with reviewer approval. These are owner choices, not a decision already made.

For UOM, map only exact verified ERP codes; allow only approved material-specific effective-dated conversions. Unmapped/ambiguous/incompatible units block calculation. Snapshot material/source/unit/conversion, effective period, parameter, formula/engine version and result hash. Do not change T4.2.2’s `materials.unit` to FK without approved ERP mapping.

#### 5. Alternatives

| Decision | Option A (recommended) | Alternative(s) and consequence |
|---|---|---|
| RAB approval | No standalone approval; reviewed RAB is calculation output | Add business approval: adds workflow/actor/SoD and can delay KKF/WO |
| Price source | Internal UP3 then external fallback; ambiguity blocks | External always wins, or explicit operator selection with review; each changes financial result and audit needs |
| KKF lineage | One exact RAB run per KKF version; scenarios explicit | Multiple runs consolidated: requires allocation and aggregation formula approval |
| UOM | Exact mapping and approved conversion; unknown blocks | Permit manual one-off conversion only with documented dual check; higher operational flexibility/risk |
| Feasibility | Conditional, versioned scenarios, exact accepted scenario reference | One study only/no scenario comparison: simpler but less analytical flexibility |

#### 6. Decision required

| Field | Owner entry |
|---|---|
| Choice / final decision | `PENDING` |
| Decision maker and position | |
| Unit | |
| Date (YYYY-MM-DD) | |
| Rationale | |
| Official parameter/source evidence | |
| RAB/KKF/feasibility actors and lineage | |
| Price priority/selection authority | |
| UOM source/conversion and approval | |
| Status | `PENDING` |

### O-033 — Authorization catalog and grants (priority 6)

**Proposed decision IDs:** `OD-033-01` through `OD-033-05`  
**Current issue status:** `OPEN/BLOCKING`.  
**Decision authority:** each domain process owner for business ability/grant, plus security/identity owner for guard/scope/catalog; exact authority `OWNER AUTHORITY TO BE CONFIRMED`.

#### 1. Business problem

Roles alone do not describe permitted actions or resource boundaries. A permission catalog without explicit role grants can silently broaden access, especially for UP3/ULP, vendors, child-WO actions and exports.

#### 2. Existing approved decisions

`user_role_assignments` is the sole assignment source; Spatie is catalog-only. Guard `web` is canonical baseline. SAME_UNIT default; SYS_ADMIN no automatic business permission. Child-ULP special verify/inspect is action-specific. Vendor deny-all. Exports are separate per domain and inherit source scope. AND SoD and progress submitter/verifier separation remain mandatory.

#### 3. Pending decisions

Final permission identifiers; explicit grants per role/guard; read/write/approval/export permissions; domain-level organizational scope; approval roles and conditions from O-034/O-036–O-041; reports and sensitive-field allowlists. No key in document 34 is final.

#### 4. Recommended decision

Review the candidate matrix in section 10.10 of [authorization design](./34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md) and approve each tuple: identifier, role, guard, action, scope, resource precondition and SoD. Do not create global business grants. Apply persisted SQL scope before collection pagination/sorting/count/aggregation/export. Keep `KONSTRUKSI_UP3` child action scope limited to verify/inspect; do not infer report access. Keep VENDOR deny-all pending valid persisted relations.

System impact: versioned catalog and explicit `role_has_permissions` grants only after approval; no user pivot assignment, no seeder before separate implementation authorization. Tests must include cross-UP3/ULP leakage, request-forged unit, inactive/expired assignment, vendor incomplete chain, AND distinct users, and export ordering.

#### 5. Alternative options

| Option | Benefits | Costs/risks | System effect |
|---|---|---|---|
| A — Granular action permissions and explicit grants (recommended) | Least privilege and auditable actions | Larger review matrix and maintenance cost | Fine-grained keys, policies and tests |
| B — Read/write/approve per domain | Smaller catalog | Can conflate unrelated actions and export; still requires resource scope | Simpler keys but higher risk of accidental overgrant |
| C — Role-only global access | Minimal setup | Conflicts with scoped assignment principles and is unsafe | Not acceptable absent superseding decision and security review |

#### 6. Decision required

| Field | Owner entry |
|---|---|
| Choice / final decision | `PENDING` |
| Decision maker and position | |
| Unit/domain | |
| Date (YYYY-MM-DD) | |
| Rationale | |
| Approved permission matrix reference/version | |
| Exceptions and expiry | |
| Status | `PENDING` |

### O-034 — Resource model and lifecycle (priority 7)

**Proposed decision IDs:** `OD-034-01` through `OD-034-08`  
**Current issue status:** `OPEN/BLOCKING`; resource schema remains `PROPOSED`.  
**Decision authority:** business process owners approve domain semantics; Solution Architect/Database Architect and designated technical approvers review technical design; authority titles must be confirmed.

#### 1. Business problem

Authorization and workflow cannot be reliably implemented without persisted resource ownership, parent/child relationships, cardinality, lifecycle, immutable version rules and auditable approvals. Existing T4.2.1–T4.2.4 resources must not be duplicated.

#### 2. Existing approved decisions

Reuse `users`, organization, `user_role_assignments`, `applications`, material/KHS/BOM/UOM, document/version/review and Auto MTO resources. UUID for business resources. Persisted resource context is authoritative; approved versions immutable; audit history append-only; RKM does not trigger procurement; no duplicate inventory/document/task subsystem.

#### 3. Pending decisions

RKM plan/period cardinality; project/application cardinality; WO history/replacement; vendor assignment history; survey/meter cardinality; RAB/KKF/feasibility linkage; creator/reviewer/approver for pending domains; exact FKs/composite constraints, indexes, cancellation retention and concurrency rules.

#### 4. Recommended decision

Use the integrated resource proposal in section 18 of [document 35](./35-O-034-RESOURCE-MODEL-LIFECYCLE-SCHEMA.md) as the review baseline, not as approved schema. It defines candidate ownership, cardinalities, lifecycle guards, immutable snapshots, FK/unique/index needs and transaction boundaries. Reuse T4.2.1–T4.2.4 actual tables; no second assignment, material, UOM, document/Auto MTO, task/SLA or inventory subsystem. Use explicit FKs rather than unchecked polymorphic IDs; validate same-application/project/version; use append-only status, approval and evidence histories. Finalize only after O-029/O-033/O-036/O-038/O-039/O-041 and upstream type/name reconciliation.

#### 5. Alternative options

| Option | Benefits | Costs/risks | System impact |
|---|---|---|---|
| A — Domain-specific aggregates and version tables (recommended) | Clear ownership and lifecycle; strong integrity | More tables/constraints and cross-domain coordination | Explicit FKs, snapshots and histories |
| B — Generic workflow/resource tables for all domains | Reuse workflow engine | Can erase domain invariants and SoD differences | Requires flexible polymorphic references and stricter validation |
| C — Store workflow state only on current resource row | Simple initial schema | Loses immutable decision and historical version binding | Not recommended; weak audit/reproducibility |

#### 6. Decision required

| Field | Owner entry |
|---|---|
| Choice / approved design revision | `PENDING` |
| Business decision makers / positions | |
| Technical design approvers | |
| Database design approver(s) | |
| Units | |
| Date (YYYY-MM-DD) | |
| Rationale and evidence | |
| Approved domains / exclusions / unresolved items | |
| Status | `PENDING` |

### O-037 — Reporting and dashboard (priority 8)

**Proposed decision IDs:** `OD-037-01` through `OD-037-06`  
**Current issue status:** `PARTIAL/OPEN`.  
**Decision authority:** each domain owner for KPI semantics; security/data owner for visibility and sensitive fields; exact authority `OWNER AUTHORITY TO BE CONFIRMED`.

#### 1. Business problem

Managers need operational visibility across ULP/UP3, but dashboard aggregation, sensitive fields, descendant visibility, export formats and KPI definitions are not finalized. A correct row-level policy applied after aggregation is too late.

#### 2. Existing approved decisions

ULP sees its scope; UP3 sees consolidated child-ULP data per authorized scope; SYS_ADMIN has no automatic access to restricted business documents. Reports inherit source resource scope. Export requires separate per-domain permission, and SQL scope precedes pagination, sorting, count, aggregation and export.

#### 3. Pending decisions

KPI definitions/date basis; role visibility; aggregation and drill-down; sensitive columns; export allowlists/formats; reporting source and retention; whether reports may use child ULP data outside existing explicit scope.

#### 4. Recommended decision

Approve a first dashboard focused on counts/aging by application state, survey completion/return, drawing/MTO cycle time, RKM approval aging, WO active/progress/inspection/completion, RAB/KKF run/approval status, and meter verification blockers. Each metric must define numerator, denominator, date field, status mapping and source. Apply source scope in SQL before aggregation; default-mask sensitive customer/contact fields; separate view and export permission for each domain; record export actor, filters, count and file reference. Child-ULP WO verify/inspect access confers no report visibility.

#### 5. Alternative options

| Option | Benefits | Costs/risks | System impact |
|---|---|---|---|
| A — Operational KPIs, scoped drill-down, masked exports (recommended) | Useful management view with least privilege | Requires KPI ownership and data dictionary | Scoped queries, allowlists, export audit |
| B — Read-only dashboard, no exports in initial release | Lower disclosure risk and simpler approval | Offline analysis unavailable | No export keys/files initially |
| C — Broad UP3 descendant dashboard for all business rows | Convenient consolidated operations | Broader access than approved; can leak sensitive data | Requires explicit new scope decision; not implied by current rules |

#### 6. Decision required

| Field | Owner entry |
|---|---|
| Choice / final decision | `PENDING` |
| Domain/KPI owner and position | |
| Security/data approver | |
| Unit | |
| Date (YYYY-MM-DD) | |
| Metric dictionary/evidence | |
| Sensitive field/export allowlist | |
| Status | `PENDING` |

## D. Decision docket — all other OPEN/PARTIAL issues

Every issue below remains in the Decision Register and is represented in this pack. Recommendations are preparation for discussion only. For each row, the owner decision, rationale, evidence, decision maker, position, unit and date remain `PENDING` until recorded in the approval form in section E. Where no valid business choice can be made without external evidence, obtain that evidence first rather than selecting a default.

| Issue / proposed ID | Business question and recommendation for discussion | Alternative / consequence | Required authority and evidence | Status |
|---|---|---|---|---|
| O-001 / OD-001-01 | Should meter brand/type create distinct material variants? Recommend one official ERP SKU/record per verified variant; never infer SKU from label. | No separate variant only if ERP confirms same SKU/spec; otherwise master ambiguity. | Material master owner; official ERP SKU list. | OPEN |
| O-002 / OD-002-01 | MCB curve, breaking capacity and brand attributes. Recommend only source-backed ERP/SOP attributes, not speculative required columns. | Add specified attributes if safety/technical standard requires; impacts validation/schema. | Electrical technical/material owner; approved specification. | OPEN |
| O-003 / OD-003-01 | Cable lot/roll/drum/serial and stock unit. Recommend keep lot/stock tracking in external material system; DISTRIVA records demand in approved UOM; ULP TC 2×10/2×16 uses meters per baseline. | Add project evidence reference only if traceability SOP requires; do not create inventory. | Material/inventory process owner; ERP unit/traceability contract. | OPEN |
| O-004 / OD-004-01 | Meter serial traceability. Recommend record serial on installation/evidence and retain replacements as history, not a new inventory ledger. | Serial only for categories required by technical SOP; less data but weaker traceability. | Meter technical owner; installation SOP and ERP identity rules. | OPEN |
| O-005 / OD-005-01 | ULP physical receipt vs UP3 issue/allocation. Recommend external material application remains source of truth; DISTRIVA sends requirements only after approved/issued WO. | Permit transfer only if external system has an approved transaction and reconciliation contract. | Material/inventory owner; system integration contract. | OPEN |
| O-006 / OD-006-01 | Negative stock rule. Recommend no DISTRIVA stock balance; apply the authoritative rule in the external inventory system. | Local stock validation would duplicate system of record and is not recommended. | Inventory system owner; official stock policy. | OPEN |
| O-007 / OD-007-01 | Location/category for construction returns. Recommend external material application decides warehouse/location; DISTRIVA stores external reference/status only. | Domain-specific return routing if approved material SOP defines it. | Material/inventory owner; return SOP/API contract. | OPEN |
| O-008 / OD-008-01 | RAB rounding. Preserve recorded rule: round only final total; require official examples and signed calculation test cases before engine acceptance. | Any intermediate rounding changes output and requires superseding decision. | Finance/RAB process owner; approved workbook/contract examples. | OPEN |
| O-009 / OD-009-01 | PPN rate. Recommend effective-dated official tax rule; never treat 11% as timeless or hard-code without date. | No tax line where officially exempt; depends on transaction type. | Finance/tax authority; current regulation and effective dates. | OPEN |
| O-010 / OD-010-01 | Tariff table coverage. Load only official tariff/class/power/range entries with source/version; unsupported case blocks calculation. | Manual override requires recorded authority and review. | Tariff/finance owner; official tariff decision. | OPEN |
| O-011 / OD-011-01 | Block tariff/LWBP logic. Recommend parameterized rules by official class and effective period; no extrapolation. | Restrict unsupported class until full tariff rule is supplied. | Finance/tariff owner; official tariff tables. | OPEN |
| O-012 / OD-012-01 | 309 report sample coverage. Obtain multiple periods/classes; validate source mapping before use. | Delay automated import and use controlled manual source only if approved. | Data/report owner; representative source files and data dictionary. | OPEN |
| O-013 / OD-013-01 | JASA/MDU/DPT/TIBET/TERM/KR MATERIAL contracts. Recommend missing/expired signed rates block affected calculation. | Do not calculate affected components until contracts exist. | Contract/procurement and finance owners; signed current contracts/schedules. | OPEN |
| O-014 / OD-014-01 | WACC/KKF, BPP, O&M, loss/load factor, horizon. Keep values versioned/configurable; Discount Rate drives NPV/eligibility, RWACC indicator only. | Any alternative methodology must supersede recorded docs 08/16 decision expressly. | Finance/planning owner; approved model workbook and official parameter sources. | OPEN |
| O-015 / OD-015-01 | BP/UJL and delta-power scenarios. Recommend effective-dated formula/scenario rules with source traceability. | Unsupported scenario held for manual decision; no inferred formula. | Finance/customer-service owner; official BP/UJL rules. | OPEN |
| O-016 / OD-016-01 | Output templates. Use approved outputs KKF, HPE/Perbandingan BP-RAB, REKAP, REKAP RINCI; forms documented as unnecessary remain excluded unless formally changed. | Add output only with official template and owner approval. | Finance/document owner; approved templates/samples. | OPEN |
| O-017 / OD-017-01 | Application states and approval by work type. Recommend lifecycle in doc 38, survey gate, separate external status/payment; no unapproved technical application gate. | Alternative state map by PB/PD/work type; increases workflow variants. | PB/PD owner; approved SOP/status dictionary. | OPEN |
| O-018 / OD-018-01 | Roles for approval of drawings, feasibility, WO and RKM. Reuse only explicitly approved roles; decide remaining actors in sheets O-036/O-039/O-041. | New role is not recommended; any role change requires role-catalog approval and migration planning. | Relevant domain owners; organization/SOP matrix. | OPEN |
| O-019 / OD-019-01 | Forecast pipeline stage. Recommend separate forecast outputs for applications received/approved, WO issued and work completed; do not conflate. | Select one metric as primary while retaining the others as separate indicators. | Forecast/RKM owner; historical conversion data. | OPEN |
| O-020 / OD-020-01 | Bot Daftung/EIS/payment API, auth and payload. Recommend no endpoint/payload assumptions; require signed interface contract and security review. | Manual import only under approved temporary procedure. | System owners for each integration; API/auth/data contracts and test samples. | OPEN |
| O-021 / OD-021-01 | Vendor/WO/progress SOP. Adopt O-039 recommendations only after official SOP confirms actors, correction, and cancellation effects. | Hold vendor execution until SOP/contract available. | UP3 construction/vendor owner; signed SOP/contract. | OPEN |
| O-022 / OD-022-01 | Forecast target. Recommend publish separate funnel targets for incoming, approved applications, issued WO and completed WO. | Choose one management headline but preserve stage-specific measures. | Forecast/RKM owner; planning use case and historical data. | OPEN |
| O-023 / OD-023-01 | Safety stock/service level. Recommend keep inventory policy in external material system; DISTRIVA forecasts demand, not stock. | If owner needs stock recommendations, consume external policy via documented read-only contract. | Inventory/forecast owners; official service-level policy. | OPEN |
| O-024 / OD-024-01 | RKM planning scope. Recommend material/work demand by originating ULP and period; budget is a separate snapshot, never procurement authorization. | Material-only or combined work/material/budget planning; affects detail and consolidation. | RKM/planning owner; approved planning template and source data. | OPEN |
| O-025 / OD-025-01 | Pipeline weights with limited history. Recommend show unweighted scenarios and confidence limits until data supports calibrated probabilities. | Owner-set weights only with documented evidence and review cadence. | Forecast owner; historic conversion dataset and methodology. | OPEN |
| O-026 / OD-026-01 | RKM amendment after approval. Recommend new immutable version, repeat both validators and `UP3_MANAGER` approval; no mutation or procurement effect. | Restrict amendment to next planning cycle; less flexibility, simpler audit. | RKM owner; amendment SOP and material-planning cut-off. | OPEN |
| O-028 / OD-028-01 | `btree_gist`/exclusion constraint availability outside disposable test. Recommend verify extension privilege per named environment; do not infer production availability. | Use transactional alternative only after concurrency design and testing. | Database/platform owner; environment-specific capability evidence. | PARTIAL/OPEN |
| O-030 / OD-030-01 | Reuse of official unit codes. Recommend never recycle retired codes; retain old unit identity/history and assign new identity/code for reorganization. | Reuse only if PLN authoritative registry explicitly guarantees safe reuse and history semantics. | Organization master-data owner; official code policy. | OPEN |
| O-031 / OD-031-01 | Guard/catalog status. Preserve confirmed `web` guard; decide only final keys/grants under O-033. | No alternate guard absent an explicit auth architecture change. | Security/identity owner; approved permission matrix. | PARTIAL |

### Other issue decision-entry form

Create a separate decision record using the section E template for each issue below. Record the approved decision and supporting evidence in document 44 only after the authorized owner decides. Do not treat the proposed IDs as finalized until uniqueness is checked there.

| Issue | Proposed decision ID | Initial status |
|---|---|---|
| O-001 | `OD-001-01` | `PENDING` |
| O-002 | `OD-002-01` | `PENDING` |
| O-003 | `OD-003-01` | `PENDING` |
| O-004 | `OD-004-01` | `PENDING` |
| O-005 | `OD-005-01` | `PENDING` |
| O-006 | `OD-006-01` | `PENDING` |
| O-007 | `OD-007-01` | `PENDING` |
| O-008 | `OD-008-01` | `PENDING` |
| O-009 | `OD-009-01` | `PENDING` |
| O-010 | `OD-010-01` | `PENDING` |
| O-011 | `OD-011-01` | `PENDING` |
| O-012 | `OD-012-01` | `PENDING` |
| O-013 | `OD-013-01` | `PENDING` |
| O-014 | `OD-014-01` | `PENDING` |
| O-015 | `OD-015-01` | `PENDING` |
| O-016 | `OD-016-01` | `PENDING` |
| O-017 | `OD-017-01` | `PENDING` |
| O-018 | `OD-018-01` | `PENDING` |
| O-019 | `OD-019-01` | `PENDING` |
| O-020 | `OD-020-01` | `PENDING` |
| O-021 | `OD-021-01` | `PENDING` |
| O-022 | `OD-022-01` | `PENDING` |
| O-023 | `OD-023-01` | `PENDING` |
| O-024 | `OD-024-01` | `PENDING` |
| O-025 | `OD-025-01` | `PENDING` |
| O-026 | `OD-026-01` | `PENDING` |
| O-028 | `OD-028-01` | `PENDING` |
| O-030 | `OD-030-01` | `PENDING` |
| O-031 | `OD-031-01` | `PENDING` |

## E. Approval recording, authority and decision IDs

### Decision record template

Use a unique ID in the form `OD-[ISSUE]-[SEQUENCE]`. IDs shown in this pack are proposed only; check document 44 for collisions before writing. Do not overwrite or renumber historical records. A decision is not `APPROVED` unless all required fields and evidence exist.

| Required field | Meeting entry |
|---|---|
| Decision ID | Proposed ID from issue sheet |
| Issue | |
| Decision statement (one testable rule) | |
| Decision maker | |
| Position/title | |
| Unit | |
| Decision date (YYYY-MM-DD) | |
| Rationale | |
| Evidence reference (minutes/SOP/letter/official data) | |
| Impact: process/resource/authorization/database/API | |
| Status (`PENDING` initial) | `PENDING` |

### Approval authority matrix

Roles below are functional process/technical responsibilities. They do not prove that the office-holder has formal delegation to approve. Confirm the organization’s authority matrix before recording approval.

| Approval type | Decision owner / process | Technical reviewer | Final authority | Evidence |
|---|---|---|---|---|
| Business process | PB/PD, ULP, UP3 construction, planning, vendor, finance or material owner relevant to issue | Domain analyst/process analyst | `OWNER AUTHORITY TO BE CONFIRMED` | Approved SOP, formal minutes, delegation or official process document |
| Technical design | Relevant domain process owners and solution architect | Solution Architect; Authorization Architect for permission/scope | `OWNER AUTHORITY TO BE CONFIRMED` | Versioned architecture/design review approval |
| Database design | Domain owners for semantics and Database Architect for integrity/operations | Database Architect and relevant upstream schema owner | `OWNER AUTHORITY TO BE CONFIRMED` | Approved ERD/schema, FK/constraint/index review |
| Implementation authorization | Product/system owner and operational environment owner | Engineering/DBA readiness review | `OWNER AUTHORITY TO BE CONFIRMED`; target and environment must be explicit | Written authorization naming scope, target database/environment, and rollback window |

No person, signature, title beyond documented roles, meeting date, approval evidence or delegated authority is invented in this pack.

### Four approval gates

1. **GATE 1 — BUSINESS PROCESS APPROVAL:** authorized process owner approves actors, responsibilities, workflow, approval rules and SoD.
2. **GATE 2 — TECHNICAL DESIGN APPROVAL:** Solution Architect and relevant technical owners approve resource boundaries, lifecycle, relationships, cardinality, authorization and integrations.
3. **GATE 3 — DATABASE DESIGN APPROVAL:** Database Architect and authorized reviewers approve schema, FKs, constraints, indexes, versioning, audit and concurrency.
4. **GATE 4 — IMPLEMENTATION AUTHORIZATION:** authorized party explicitly permits implementation for a named scope and environment/database target.

No gate can be skipped because AI or an analyst recommends a design. A decision at one gate does not imply approval at the next.

## F. Dependencies and implementation gate

| Dependency | Needed before | Current boundary |
|---|---|---|
| O-029 vendor eligibility and persisted relation | Vendor login access, assignment policies, vendor WO/progress actions | Vendor remains deny-all |
| O-033 permission identifiers and grants | Permission seeder, Policies and authorization scope implementation | Candidate keys are not final; no grants |
| O-034 resource/lifecycle approval | Domain migrations/models/query scopes | Document 35 remains `PROPOSED`; no migration |
| O-036 application/RKM actors | Application/RKM transition and permission grants | Existing approved RKM flow preserved; actor details pending |
| O-038 survey/meter actor/evidence decisions | Survey/meter lifecycle and completion validation | Survey mandatory and meter verification prerequisite preserved |
| O-039 WO lifecycle and vendor boundary | WO schema, issue/dispatch, vendor access, completion | One-active-WO and existing role boundaries preserved |
| O-041 financial source and lineage decisions | Authoritative RAB/KKF/feasibility output | Ambiguous data/source blocks affected calculation |
| T4.2.2 ERP SKU/UOM/pricing and official finance sources | Calculation migrations/engine | Exact UOM/pricing rules and source evidence remain open |
| T4.2.4 actual table/PK/version references | Document/evidence FK design | Reuse actual document subsystem; no duplicate |
| O-037 metrics/data classification | Dashboard/report/export | Source scope before aggregation/export |
| O-020 interface contracts | External integration implementation | No endpoint or payload assumption |
| O-028 target capability | Deployment/migration using exclusion constraints | Verify only for named approved target |

**Implementation status remains `BLOCKED`.** This document authorizes no code, migration, database change, API, frontend, seeder, Policy, query scope, production data change or test run.

## G. Source documents and validation

Primary sources: [Decision Register](./15-DECISIONS-AND-OPEN-ISSUES.md), [Finalized Business Decisions](./16-FINALIZED-BUSINESS-DECISIONS.md), [Authorization Design](./34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md), [O-034 resource proposal](./35-O-034-RESOURCE-MODEL-LIFECYCLE-SCHEMA.md), [O-036](./38-O-036-APPLICATION-RKM-ACTOR-RESOLUTION.md), [O-038](./39-O-038-SURVEY-METER-ACTOR-LIFECYCLE.md), [O-039](./40-O-039-WORK-ORDER-LIFECYCLE-APPROVAL.md), [O-041](./41-O-041-RAB-KKF-FEASIBILITY-LIFECYCLE.md), [cross-domain matrix](./42-CROSS-DOMAIN-RESOURCE-WORKFLOW-MATRIX.md), [open-issue report](./43-OPEN-ISSUES-RESOLUTION-REPORT.md), [owner register](./44-OWNER-DECISION-REGISTER.md), [integration audit](./45-OWNER-DECISION-INTEGRATION-AUDIT.md), [AI-HANDOFF](./AI-HANDOFF.md), [Technical Design Status](./17-T4-TECHNICAL-DESIGN-STATUS.md), and root `PACKAGE-MANIFEST.json` (dihapus 2026-11-25). Schema contracts 22–26 and project context are additional references recorded in those sources.

Validation completed for this document:

- Reviewed current issue/status register and v3.11.0 recommendation pack.
- Kept O-027/O-032/O-035/O-040/O-042 closed only within recorded scope.
- Represented all OPEN/PARTIAL issues: O-001–O-026, O-028–O-031, O-033–O-034 and O-036–O-039/O-041.
- Distinguished approved facts from proposals and required external evidence.
- Preserved no-new-role, sole assignment source, vendor fail-closed, approved scope/SoD and immutable version baselines.
- No approval, signature, named decision-maker, date or evidence was fabricated.

**Final status: `READY FOR OWNER REVIEW; IMPLEMENTATION BLOCKED`.**
