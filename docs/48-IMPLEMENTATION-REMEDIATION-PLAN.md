> **Catatan tata kelola v3.16.0 — dokumen historis/referensi:** Dokumen ini dipertahankan untuk menjaga jejak analisis dan audit pada saat penyusunannya. Persyaratan nama asli, verifikasi kewenangan formal, tanda tangan, SK/surat tugas, serta urutan gate administratif di dalamnya tidak berlaku sebagai prasyarat pengembangan internal DISTRIVA. Gunakan `docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md` sebagai panduan aktif. Status issue dan temuan teknis substantif dalam dokumen ini tidak otomatis berubah; verifikasi kembali relevansinya terhadap modul yang sedang dikerjakan.

---

# 48 — DISTRIVA Implementation Remediation Plan

**Baseline:** v3.15.0
**Status:** `BLOCKED — staged work only; no implementation authorization recorded`  
**Purpose:** Order remediation by dependency without treating recommendations as business approval.

## 1. Execution rules

1. Follow the phase order and the four approval gates in docs 46/47.
2. Do not start a later phase while its entry criteria or required owner evidence are missing.
3. Use role/function owners, not invented names. Confirm delegated authority in the approval register.
4. Database work must name the exact disposable target and obtain explicit authorization. Never infer that `.env`, a local SQLite file, or a remembered PostgreSQL database is disposable.
5. Keep `user_role_assignments` as the only user-role-unit assignment source; Spatie remains a catalog. Do not add permission grants before O-033 approval.
6. Preserve vendor deny-all until the persisted vendor relationship chain and owner eligibility decision are approved and verified.
7. Record tests only as `PASS`, `FAIL`, `NOT RUN`, or `BLOCKED`, with exact environment and evidence.

## 2. Ordered implementation backlog

| ID | Priority / task | Dependency | Responsible function | Current state | Acceptance criteria / required tests |
|---|---|---|---|---|---|
| A-01 | Baseline T4.2.1 audit and no-DB route tests | Approved T4.2.1 design; no DB writes | Backend engineering + QA | Audit complete; two route tests added | Full suite 22/22, 33 assertions; Pint and Composer validation pass; no permission/domain behavior introduced. |
| A-02 | PostgreSQL integration test harness for T4.2.1 migrations, Eloquent assignment query, constraints and triggers | Named authorized disposable PostgreSQL; extension provisioning permission; fixtures match 22–26 | DBA + backend engineering + QA | BLOCKED — `distriva_backend_test` named but existence/access/disposable status unverified; local `.env` is not PostgreSQL | Verify database identity/owner/disposable status before connect; up/down and integrity tests; rollback; no production target. |
| A-03 | Sanctum UUID bearer-token end-to-end | Authorized disposable DB supporting test migrations; PDO PostgreSQL or SQLite available; T4.2.1 token contract | Backend engineering + QA | NOT RUN — `pdo_sqlite` unavailable; PostgreSQL test DB not verified; `.env` mismatch remains | Create UUID user/token, call `/api/user` via bearer, assert authenticated response and UUID, assert guest/token rejection, clean ephemeral DB. |
| A-04 | Assignment expiry/inactive, role guard, same-unit and SYS_ADMIN tests | Existing service and approved assignment invariants | Backend engineering + QA | Covered in current 15 authorization tests; further cases only if gaps found | Verify inclusive date boundaries and inactive account/assignment/unit rejection; no user role pivots; SYS_ADMIN denied business context. |
| A-05 | Child-WO special action scope enforcement | O-033 final action identifiers; O-034 persisted WO/application/UP3/ULP relations; technical approval | Authorization engineering + domain owner | BLOCKED — no action-specific service/Policy/resource | Verify effective `KONSTRUKSI_UP3` assignment can only verify/inspect child-ULP WO; reject read/mutation/approval outside approved action; cross-UP3 denied. |
| A-06 | Assignment write service, append-only audit and cache invalidation | Approved T4.2.1 write-service contract and exact implementation authorization; authorized PG target for concurrency | Backend engineering + DBA + security reviewer | NOT IMPLEMENTED | Atomic assignment mutation + history event; all writes transactional; audit update/delete/truncate denied; cache invalidated after commit only; rollback leaves no partial change; concurrent overlap rejected. |
| B-01 | Resolve material/SKU/UOM/external price contract and official ERP references | O-001–O-007, O-029 where relevant; official ERP/material evidence | ERP/material-data owner + business owner | BLOCKED — evidence and decisions pending | Each used SKU/source/UOM maps to official identifier; unresolved/incompatible UOM or price blocks affected calculation; no duplicate master or inventory ledger. |
| B-02 | Resolve finance/tariff/contracts/calculation input evidence | O-008–O-016; official current tariff/tax/finance/contract data and test vectors | Finance/tax/contract owners | BLOCKED — official evidence pending | Effective dates and source/version persisted; approved examples reproduced; ambiguous/unsupported input blocks calculation; no invented formula/value. |
| C-01 | Reconcile application, task, survey, document and Auto MTO contracts | O-036/O-038 decisions; schemas 24/26; official API/SOP as applicable | PB/PD owner + document/MTO technical owner | BLOCKED | No duplicate application/task/document tables; exact PK/FK/version refs; approved status/actor matrix and evidence rules; migration-ready design reviewed. |
| D-01 | Finalize O-034 resource model/lifecycle and database design | O-029/O-036/O-038/O-039/O-041 outcomes; schemas 22–26 reconciled | Domain owners + Solution Architect + Database Architect | BLOCKED — doc 35 remains PROPOSED | Owner-approved resource ownership/cardinality/transitions; exact FKs/unique constraints/indexes; immutable snapshots/approval histories; concurrency/cancellation rules; no duplicated foundation/master/document/task/inventory model. |
| E-01 | Approve O-033 permission identifiers and role grants | O-034 resources and finalized actors; O-029 vendor chain; O-037 metrics; security review | Process owners + security/identity owner | BLOCKED | Explicit permission key, guard, role, action, resource precondition, scope, SoD and export rule for every grant; guard `web`; no implicit SYS_ADMIN access; vendor fail-closed. |
| E-02 | Implement domain Policies and SQL scopes | E-01 plus approved O-034 resource mappings | Authorization engineering + QA | BLOCKED | Persisted ownership is authoritative; filters occur before pagination/order/count/aggregate/export; negative cross-unit/UP3/vendor tests pass; child verify/inspect is action-specific, not descendant read. |
| F-01 | Implement domain workflows (application, survey, meter, RKM, WO, RAB, KKF, feasibility) | O-036/O-038/O-039/O-041 decisions, approved schema and O-033 grants | Domain engineering + each process owner | BLOCKED | State machines match signed SOP; transition guards and version binding enforced; AND approvers distinct; submitter cannot final-approve; progress submitter != verifier; meter guard enforced; no RKM procurement side effect. |
| G-01 | Implement React/Vite UI, navigation, API client and workflow/error/loading states | Stable, versioned API and approved UI/process requirements | Frontend engineering + product/process owners | BLOCKED — frontend directory empty | Auth expiry/error paths, authorization-aware navigation, loading/empty/error states, server remains enforcement authority; accessible UAT by role/unit. |
| G-02 | Implement Python forecast service | O-019/O-022–O-025 decisions, official data/API contract, model version policy | Forecast/data owner + Python engineering | BLOCKED — Python service directory empty | Validated input/output schema; model/data/version lineage; deterministic/idempotent requests; explicit error contract; no forecast confidence/weights without evidence. |
| H-01 | Integration, security, performance and UAT | Phases A–G for selected scope; owner-approved scenarios | QA/security/DBA/process owners | BLOCKED | Cross-domain flow, scope/SoD/export, concurrency, retries, performance and failure modes pass with retained evidence. |
| H-02 | Backup/restore and deployment rehearsal | Deployment architecture, approved environment, release/rollback plan | Operations/DBA/security | BLOCKED — deploy directory empty | Restore validated, migrations reversible or forward-recovery documented, secrets handled safely, monitoring/alerts verified, named environment signed off. |
| H-03 | Production release | All prior phases and explicit production authorization | Product/system owner + operations | BLOCKED | Production scope/database named; backup verified; rollback window/owner and deployment authorization recorded; no Level 3 claim substituted for production readiness. |

## 3. Phase gates

### Phase 1 — Foundation hardening

- **Includes:** A-01–A-06; tests for T4.2.1, assignment expiry/inactive assignment, unit boundaries, PostgreSQL integrity, Sanctum UUID, transaction/audit, concurrency and cache invalidation.
- **Dependencies:** approved T4.2.1 baseline; for database-backed work, named disposable PostgreSQL and explicit access approval.
- **Entry:** bounded code/test scope approved; test target verified as ephemeral; no business permission key required for foundation-only tests.
- **Exit:** current foundation suite and style checks pass; PostgreSQL migration/service/trigger tests and real Sanctum bearer-token test pass on approved disposable target; assignment write/audit/cache behavior is implemented only if its contract is approved.
- **Acceptance:** no production DB touched; no unresolved foundation integrity issue; test logs/evidence identify exact target and rollback.
- **Current:** partially evidenced; A-01 done, database tasks blocked/not run.

### Phase 2 — Master data and upstream contracts

- **Includes:** B-01 and B-02; ERP SKU, UOM, internal/external material-price source, official rates and external master references.
- **Dependencies:** O-001–O-016, O-029 as needed, signed ERP/finance/contract evidence, T4.2.2 reconciliation.
- **Entry:** authorized data owners and official source snapshots identified.
- **Exit:** accepted mapping tables/source versions, effective dates, currency/UOM conversions and source precedence; all unsupported/ambiguous values have fail-closed behavior.
- **Acceptance:** reproducible calculation test vectors and owner sign-off; no SKU alias conflation or shadow inventory/master.
- **Current:** blocked by owner and official evidence.

### Phase 3 — Application and document foundation

- **Includes:** C-01; application lifecycle, survey prerequisites, T4.2.4 document/evidence and Auto MTO references.
- **Dependencies:** O-036/O-038 decisions, schemas 24/26, approved status/SOP and any external contract.
- **Entry:** actor, review/return/reject, evidence and completion requirements approved; upstream identifiers reconciled.
- **Exit:** one persisted ownership path, version-pinned documents/MTO, explicit task/SLA reuse and no conflicting internal/external status.
- **Acceptance:** actor/SoD/state tests; same-application/version FK checks; meter prerequisite held until O-038 final.
- **Current:** blocked.

### Phase 4 — Domain resource model

- **Includes:** D-01; final O-034 schema after O-029/O-036/O-038/O-039/O-041.
- **Dependencies:** Phase 2/3 contracts as applicable; owner approval of resource ownership, cardinalities and lifecycle.
- **Entry:** relevant business decisions and official data/source references complete; technical and database review assigned.
- **Exit:** approved schema package, exact PK/FK/reference map, status transition tables, immutable version rules, unique constraints/indexes, transaction/concurrency design.
- **Acceptance:** ERD/schema review; referential/cardinality/immutable/history tests; no duplicated users, assignments, application, master, document, Auto MTO, tasks or inventory.
- **Current:** blocked; doc 35 is PROPOSED.

### Phase 5 — Authorization

- **Includes:** E-01/E-02; O-033 catalog/grants, Policies, SQL row scopes, report/export scope.
- **Dependencies:** Phase 4 persisted resource paths; O-029 vendor relation; actor decisions; O-037 metrics; security approval.
- **Entry:** every action has approved permission ID/role/guard/scope/SoD/precondition; no unresolved actor for the action.
- **Exit:** policy/query code uses persisted ownership; exports separate; scope is applied before pagination, sorting, count, aggregation and export.
- **Acceptance:** cross-unit/UP3/vendor leakage tests, child-action tests, AND distinct-user tests, SYS_ADMIN deny-by-default business tests, export allowlist/audit tests.
- **Current:** blocked; candidate matrix is not a grant.

### Phase 6 — Domain workflows

- **Includes:** F-01.
- **Dependencies:** Phases 2–5 and approved SOPs for each selected domain.
- **Entry:** owners approve actor, status, transitions, return/reject/cancel/rework/amendment and decision/version relation.
- **Exit:** immutable lifecycle events, transaction/locking/idempotency behavior, downstream guards and failure handling are implemented.
- **Acceptance:** O-036/O-038/O-039/O-041 matrices pass; no RKM procurement side effect; vendor remains deny-all until verified relation.
- **Current:** blocked.

### Phase 7 — Frontend

- **Includes:** G-01.
- **Dependencies:** stable approved APIs, authorization server enforcement, workflow and error contracts.
- **Entry:** API contract and screen/role requirements approved.
- **Exit:** all supported roles can complete assigned journeys; UI does not create authority and hides neither server errors nor access denials.
- **Acceptance:** cross-role UAT, accessibility, network/error/loading tests, no client-controlled ownership.
- **Current:** not started; directory empty.

### Phase 8 — Integration and UAT

- **Includes:** H-01–H-03.
- **Dependencies:** selected implementation phases complete; signed API contracts; approved non-production and production targets.
- **Entry:** release candidate, test data ownership and environment authorization confirmed.
- **Exit:** integration/security/performance/UAT, backup/restore and deployment rehearsal pass; production authorization separately recorded.
- **Acceptance:** evidence and incident/rollback plan accepted by named authorities; production approval not inferred from controlled implementation readiness.
- **Current:** blocked; no deployment files or UAT evidence.

## 4. Owner/authority assignments

The responsible roles above are functional suggestions for coordinating work, not proof of delegated authority. Document 50 must be completed with the actual authorized person/title, unit, date and evidence before approval gates are considered passed. No names or dates are prefilled.
