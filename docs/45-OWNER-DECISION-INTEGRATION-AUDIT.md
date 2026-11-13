> **Catatan tata kelola v3.16.0 — dokumen historis/referensi:** Dokumen ini dipertahankan untuk menjaga jejak analisis dan audit pada saat penyusunannya. Persyaratan nama asli, verifikasi kewenangan formal, tanda tangan, SK/surat tugas, serta urutan gate administratif di dalamnya tidak berlaku sebagai prasyarat pengembangan internal DISTRIVA. Gunakan `docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md` sebagai panduan aktif. Status issue dan temuan teknis substantif dalam dokumen ini tidak otomatis berubah; verifikasi kembali relevansinya terhadap modul yang sedang dikerjakan.

---

# 45 — OWNER DECISION INTEGRATION AND OPEN-ISSUE RESOLUTION PACK

**Project:** DISTRIVA — Distribution Management Platform  
**Documentation baseline:** v3.11.0  
**Audit date:** 5 November 2026  
**Conclusion:** **READY FOR OWNER REVIEW; IMPLEMENTATION BLOCKED — OWNER DECISIONS / SOURCE EVIDENCE PENDING**  
**Scope:** Documentation audit, integrated design recommendations and owner-approval preparation only; no application/database implementation.

## 1. Executive summary

The Owner Decision Register in [document 44](./44-OWNER-DECISION-REGISTER.md) is a draft decision-capture form. Its meeting-decision rows and approval/signature fields are blank, and its owner decisions remain `PENDING`. This v3.11.0 package provides concrete recommendations and impact/risk/owner sign-off paths; none is represented as an approved owner decision and none closes an issue or authorizes implementation.

Existing approved baselines remain in effect. Three entries that had requested pending confirmation for decisions already recorded as approved were clarified: one active WO per application/work, action-specific child-ULP WO verify/inspect scope for effective `KONSTRUKSI_UP3` assignments, and `ASMAN_KONSTRUKSI` as final completion approver. Their additional details remain open where indicated.

Two historical decision-register entries were clarified without deleting or rewriting their historical record: D-018's old RWACC wording is superseded by the later Discount Rate decision, and D-021's external-only price scope is expanded by D-MDM-001. Price-source priority/default and UOM conversion remain open. A further inconsistency was found in the v3.10 audit: section 14 of document 16 still contained those pre-revision T4.2.2 statements. Document 16 is now additively clarified against the later source docs 15/23 decisions D-MDM-001/002.

O-034 remains `OPEN/BLOCKING`, and its resource/lifecycle schema remains `PROPOSED`. O-033 and the owner-dependent issues O-036/O-038/O-039/O-041 remain open at their recorded statuses. The integrated recommendations are ready for owner review, but external official data/contracts and explicit owner authorization are still required for several decisions. The register does not approve any migration, model, permission grant, Policy, query scope, or other implementation.

## 2. Documents examined

| Document | Audit use / result |
|---|---|
| [15 — Decision Register and Open Issues](./15-DECISIONS-AND-OPEN-ISSUES.md) | Compared issue status and historical decision notes; synchronized v3.10.0 status and references. |
| [16 — Finalized Business Decisions](./16-FINALIZED-BUSINESS-DECISIONS.md) | Authority for existing business baselines; v3.11.0 additively clarifies supersession of two stale T4.2.2 statements by D-MDM-001/002. |
| [22 — T4.2.1 Foundation Schema](./22-T4.2.1-FOUNDATION-SCHEMA.md) | Assignment/schema dependency; no proposed owner entry overrides its baseline. |
| [23 — T4.2.2 Master Data Schema](./23-T4.2.2-MASTER-DATA-SCHEMA.md) | Price/UOM dependency; dual price-source direction is retained, priority and UOM remain open. |
| [24 — T4.2.3 Applications PB/PD Schema](./24-T4.2.3-APPLICATIONS-PB-PD-SCHEMA.md) | Application and workflow dependency; actor/lifecycle details remain pending. |
| [26 — T4.2.4 Documents/Auto MTO Schema](./26-T4.2.4-DOCUMENTS-AUTO-MTO-SCHEMA.md) | Document/MTO contract dependency; register reference corrected to actual filename. |
| [34 — Authorization Policy Design](./34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md) | Authorization and organizational-scope baseline; no final permission keys/grants implied. |
| [35 — O-034 Resource Model and Lifecycle](./35-O-034-RESOURCE-MODEL-LIFECYCLE-SCHEMA.md) | Resource schema proposal; remains `PROPOSED`, not implementation-ready. |
| [36 — O-034 Documentation Audit](./36-O-034-DOCUMENTATION-AUDIT.md) and [37 — O-034 Implementation Readiness](./37-O-034-IMPLEMENTATION-READINESS.md) | Existing consistency and readiness findings; blockers remain. |
| [38 — O-036 Application/RKM Actor Resolution](./38-O-036-APPLICATION-RKM-ACTOR-RESOLUTION.md) | Actor recommendations remain proposals; concrete application reviewer and ULP RKM proposer remain open. |
| [39 — O-038 Survey/Meter Lifecycle](./39-O-038-SURVEY-METER-ACTOR-LIFECYCLE.md) | Survey and meter actors, evidence, and SoD remain pending. |
| [40 — O-039 Work Order Lifecycle](./40-O-039-WORK-ORDER-LIFECYCLE-APPROVAL.md) | Existing WO decisions retained; remaining transitions, actors, cardinality details and SoD remain open. |
| [41 — O-041 RAB/KKF/Feasibility Lifecycle](./41-O-041-RAB-KKF-FEASIBILITY-LIFECYCLE.md) | Existing KKF approvers and snapshot requirements retained; runner/reviewer, lineage and feasibility details remain open. |
| [42 — Cross-Domain Resource Workflow Matrix](./42-CROSS-DOMAIN-RESOURCE-WORKFLOW-MATRIX.md) | Cross-domain proposal checked; no recommendation treated as an owner decision. |
| [43 — Open Issues Resolution Report](./43-OPEN-ISSUES-RESOLUTION-REPORT.md) | Open-status summary; recommendations do not close issues. |
| [44 — Owner Decision Register](./44-OWNER-DECISION-REGISTER.md) | Full register audited, including existing baselines, pending questions, dependencies and blank decision/sign-off rows. |
| [AI-HANDOFF](./AI-HANDOFF.md), [root README](../README.md), [Master Prompt](../PROMPT_MASTER_DISTRIVA_AI_DEVELOPMENT.md), [Technical Design Status](./17-T4-TECHNICAL-DESIGN-STATUS.md), and [Change Log](./18-CHANGELOG-AND-SUPERSEDED-DECISIONS.md) | Synchronized to v3.11.0. |
| [PACKAGE-MANIFEST.json](../PACKAGE-MANIFEST.json) | Root manifest; prior v3.9.0 manifest did not include documents 44/45 and required refresh. |

`docs/README.md` and `docs/CHANGELOG.md` do not exist; the actual README is at repository root and the existing changelog is document 18. The actual T4.2.4 filename is document 26 as listed above.

## 3. Owner Decision Register audit

| Category | Finding | Status |
|---|---|---|
| Existing approved decisions | Part A identifies existing baselines and explicitly says an empty/pending confirmation does not revoke them. The referenced business decisions remain the authority. | `CONSISTENT` |
| Pending owner decisions | Part B questions for O-036, O-038, O-039 and O-041 remain unanswered; meeting records and signatures are blank. | `NEEDS OWNER CONFIRMATION` |
| WO active cardinality | A pending confirmation had conflicted with the recorded one-active-WO direction. The register now marks that direction existing while leaving historical/multiple-WO and replacement details open. | `CONFLICT` — corrected in v3.10.0 |
| Child-ULP verify/inspect scope | A pending confirmation had reopened the approved action-specific scope. The register now preserves the existing effective-assignment rule and limits it to those actions. | `CONFLICT` — corrected in v3.10.0 |
| Final WO completion approver | A pending confirmation had reopened the recorded `ASMAN_KONSTRUKSI` final-completion role. The baseline is now stated as existing; inspector/approver SoD remains open. | `CONFLICT` — corrected in v3.10.0 |
| KKF approver matrix | Exact normal and PBP >5-year approvers, distinct-user requirement, and exclusion of `UP3_MANAGER` from normal KKF approval are now stated as existing baselines. | `MISSING` — corrected in v3.10.0 |
| Discount Rate / RWACC | Register now preserves Discount Rate as the feasibility parameter and RWACC as an indicator; a change requires an explicit superseding decision. | `CONFLICT` — clarified in v3.10.0 |
| Price source | Both external and internal per-UP3 price sources remain supported by the later T4.2.2 decision. Default/priority and UOM mapping/conversion are unresolved. | `NEEDS OWNER CONFIRMATION` |
| Vendor authorization | No verified persisted company/project/assignment/WO relations are approved for access; deny-all remains. | `CONSISTENT` |
| Dependency coverage | O-033, O-029, O-034, T4.2.2, O-037, and O-036/O-038/O-039/O-041 dependencies are listed. Document 26 reference is corrected to the actual schema filename. | `CONSISTENT` |

### 3.1 Classification

**Existing approved baselines:** PostgreSQL; `user_role_assignments` as the sole assignment source with Spatie as catalog only; no new Pengawas Jaringan role; RKM ULP proposal and distinct `PERENCANAAN`/`KONSTRUKSI_UP3` validation with `UP3_MANAGER` final approval; no automatic procurement from RKM; one active WO per application/work; approved vendor-selection/assignment approval boundaries; progress submitter/verifier separation; action-specific child-ULP verification/inspection; `ASMAN_KONSTRUKSI` final completion approver; established KKF approvers; immutable/reproducible calculation versions; and export/source-scope rules.

**Pending owner decisions:** Application reviewer and return/reject authority; concrete ULP RKM preparer/submitter; survey/meter actors and evidence/SoD; WO creator/reviewer/issuer, transitions and historical cardinalities; RAB/KKF runners/reviewers, standalone RAB approval, RAB-to-KKF lineage, and feasibility actors/triggers/lifecycle; vendor eligibility and persisted relationships; price priority/default and UOM conversion; and final reports/exports detail.

**Proposed technical recommendations:** Analysis documents 35 and 38–43 contain proposals and options. They are not approved merely because they are documented or referenced by the owner register.

**Dependencies:** T4.2.1–T4.2.4 schema contracts; O-033 permission identifiers and role grants; O-029 vendor eligibility/relations; T4.2.2 price and UOM rules; O-037 report/export mapping; and owner decisions for O-036/O-038/O-039/O-041.

## 4. Decision and issue status

| Issue | Status after audit | Basis / remaining gate |
|---|---|---|
| O-033 | `OPEN/BLOCKING` | Permission identifiers and role-permission grants remain unapproved. |
| O-034 | `OPEN/BLOCKING` | Document 35 remains `PROPOSED`; resource schema, relations, lifecycle and dependencies require approval. |
| O-036 | `PARTIAL/OPEN` | Existing RKM final approver/validation direction retained; application reviewer and concrete ULP proposer decisions remain pending. |
| O-038 | `OPEN` | Survey/meter actors, evidence and SoD remain pending. |
| O-039 | `OPEN/BLOCKING` | Existing baselines retained; lifecycle, actor, cardinality and SoD details remain pending; vendor remains deny-all. |
| O-041 | `OPEN/BLOCKING` | KKF approvers and calculation reproducibility retained; other RAB/KKF/feasibility decisions remain pending. |
| O-035 / O-040 / O-042 | `CLOSED` (limited to recorded decisions) | Existing explicit decisions remain closed only for their documented scope; this audit does not broaden them. |

No issue was closed, reopened, or promoted based on a recommendation in this audit.

## 5. O-034 resource-model audit and implementation readiness

Document 35 is still a proposal covering application/RKM, vendor/project/assignment, WO/progress/inspection/completion, RAB calculation runs and price snapshots, KKF, feasibility, and meter installation/verification. Its relationships and lifecycle are not owner-approved merely because they appear in a schema proposal.

| Area | Status | Readiness note |
|---|---|---|
| Foundation, users, organization and assignment | `APPROVED` baseline / `BLOCKED` for dependent implementation | Must preserve T4.2.1 assignment and organizational-scope contracts. |
| Applications and RKM | `PROPOSED` / `PENDING` | Existing workflow decisions remain; actor and resource lifecycle gaps in O-036 remain. |
| Survey and meter | `PENDING` | Required business gates exist, but actors, evidence, cardinality and SoD are unresolved. |
| Vendor company/project/assignment/WO | `BLOCKED` | O-029 and O-039 dependencies; no vendor access before valid persisted relations. |
| Work orders, progress, inspection and completion | `PROPOSED` / `PENDING` | Retain approved one-active-WO, submitter/verifier, special child-ULP scope, and final approver baselines; transitions and detailed cardinality remain open. |
| RAB, price snapshot, KKF and feasibility | `PROPOSED` / `PENDING` | Preserve calculation reproducibility and KKF approver decisions; price priority/UOM, lineage, actors and feasibility lifecycle remain open. |
| Documents, Auto MTO and material/master-data relations | `MUST RECONCILE` | Align PK/FK, version/snapshot semantics, and existing T4.2.2/T4.2.4 contracts before schema approval. |
| Authorization and audit | `BLOCKED` | O-033 permission identifiers/grants and domain policies are not final; scope must remain source-resource based and fail closed. |

**Implementation readiness: `BLOCKED`.** Do not create or run migrations, domain models, permission seeders, Policies, query scopes, or APIs until owner decisions are recorded with authority/date/evidence, schema dependencies reconcile, and O-034 is explicitly approved.

## 6. Conflicts, gaps and unresolved risks

1. Three form fields incorrectly implied previously decided WO baselines were undecided. They were corrected without changing the decisions; details remain open.
2. D-018's historical RWACC wording conflicts with the later Discount Rate baseline in docs 08/16. The old row is retained as historical, with a clarification note.
3. D-021's historical external-only pricing scope conflicts with later D-MDM-001, which supports both external and internal per-UP3 sources. The old row is retained as historical; source priority/default remains open.
4. The owner register does not contain a signed/dated decision record. Therefore no new owner decision can be inferred or used to close blockers.
5. O-034's proposed relationships and lifecycle still need explicit reconciliation with existing schemas and decisions. Potential duplicate responsibility, immutable version/snapshot boundaries, and actor/scope enforcement must be resolved before migration design is final.
6. User-provided manifest and schema locations in the task prompt differed from actual repository paths; links were corrected to the files that exist.

## 7. Files updated and unchanged

**Report file**

- `docs/45-OWNER-DECISION-INTEGRATION-AUDIT.md` existed from v3.10.0 and was expanded into this v3.11.0 integrated audit/recommendation pack; no duplicate report file was created.

**Updated**

- `docs/44-OWNER-DECISION-REGISTER.md` — corrected baseline wording and references; added pointer to v3.11.0 recommendations while all owner fields remain pending.
- `docs/15-DECISIONS-AND-OPEN-ISSUES.md` — v3.10 integration and v3.11 issue recommendation references; statuses remain open/partial.
- `docs/16-FINALIZED-BUSINESS-DECISIONS.md` — historical supersession clarification for T4.2.2 D-MDM-001/002.
- `docs/34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md` — proposed complete permission/action/role/scope matrix; grants not finalized.
- `docs/35-O-034-RESOURCE-MODEL-LIFECYCLE-SCHEMA.md`, readiness/audit docs 36–37, and analysis docs 38–43 — integrated owner-review recommendations; proposals remain proposals.
- `docs/17-T4-TECHNICAL-DESIGN-STATUS.md`, `docs/18-CHANGELOG-AND-SUPERSEDED-DECISIONS.md`, `docs/AI-HANDOFF.md`, `docs/PROJECT-CONTEXT-FOR-AI.md`, root `README.md`, and root `PROMPT_MASTER_DISTRIVA_AI_DEVELOPMENT.md`.
- Root `PACKAGE-MANIFEST.json` — v3.11.0 metadata, file entries, sizes and hashes refreshed.

**Not changed**

- Schemas 22–26: no approved schema changes; reconciled by references and proposal only. Document 16 was updated additively to correct historical T4.2.2 statements based on already recorded D-MDM decisions.
- Application source, migrations, seeders, policies, APIs, PostgreSQL/database, and test evidence: outside this documentation-only scope.
- `docs/README.md` and `docs/CHANGELOG.md`: absent; existing root README and document 18 used instead.

## 8. Manifest validation

The root `PACKAGE-MANIFEST.json` was refreshed for v3.11.0. Validation checks:

- JSON parses successfully.
- Each manifest path is unique and resolves to an existing file.
- Each registered `size_bytes` equals the file's actual byte count.
- Each registered SHA-256 equals the hash of the current file contents.
- New audit/register entries are present.
- No sensitive credential, `.env`, or temporary file is included.

The manifest describes documentation/package inputs; its historical runtime evidence fields are not evidence of tests run during this documentation checkpoint.

## 9. Validation and boundaries

- Reviewed decision/status and cross-document references listed in section 2.
- Checked the relevant O-033/O-034/O-036/O-038/O-039/O-041 and D-018/D-021 status references.
- Checked local links/references and actual document paths; confirmed root manifest and actual T4.2.4 filename.
- Recomputed and verified package manifest sizes and SHA-256 hashes.
- Application tests: **not run** (documentation-only work).
- Migrations/database: **not run or changed**.
- Source code: **not changed**.
- Git status: unavailable because the workspace is not detected as a Git repository.

## 10. Required next steps

1. The authorized process owners complete document 44 with explicit decisions, decision-maker identity/role, unit, date, rationale, and evidence.
2. Reconcile only the newly approved decisions against documents 15, 16, 34–43 and schemas 22–26; retain pending entries where no decision exists.
3. Resolve O-033, O-029, O-036/O-038/O-039/O-041 dependencies and cross-check O-034 resource ownership, relationships, versioning, constraints and authorization scope.
4. Obtain explicit approval of the integrated O-034 design and implementation readiness before planning or executing migrations.
5. Keep vendor access fail-closed and keep application/database implementation blocked until the above gates are satisfied.

## 11. Integrated recommendation status

| Class | Issues / decision scope | Result |
|---|---|---|
| **A. CLOSED — existing signed/recorded scope only** | O-027, O-032, O-035, O-040, O-042 | Remain closed only for the precise previously documented decision. No scope expansion. |
| **B. READY FOR OWNER APPROVAL** | Recommendations O-004/005/017/019/021/022/024/025/026/030; O-033 permission identifiers/grants; O-034 resource relations/lifecycle proposal; O-036/O-037/O-038/O-039/O-041 domain responsibility proposals | Concrete recommendation, alternatives, constraints and owner functions are provided in documents 34, 35, 38–43. Issues remain open until signed approval/evidence. |
| **C. OPEN/BLOCKING — additional authority/source evidence required** | O-009–O-015 financial/tax/tariff/contracts/parameters; O-020 integration contracts; O-029 vendor eligibility/registry; O-033/O-034/O-039/O-041 implementation dependency gates | Architecture recommendations cannot replace official source data, signed contracts/SOP, permission-grant decision or schema approval. |
| **D. NON-BLOCKING to core design** | O-002/003/006/007/012/023/028; O-001 pending actual ERP SKU verification; O-016 template verification | Recommendations clarify ownership boundary, but upstream source samples, ERP contract or environment capability remain prerequisites for their respective implementation/validation. |

`READY FOR OWNER APPROVAL` is not a synonym for `CLOSED`, `APPROVED`, or production ready. The owner register remains `DRAFT/PENDING`.

## 12. Detailed recommended decisions for owner review

### 12.1 O-036 — application and RKM

Recommend `NIAGA_RETAIL` create/complete/submit the application, with `MANAGER_ULP` performing an administrative completeness gate, returning for corrections with reason, and marking the application `READY_FOR_SURVEY`. Do not add a separate generic technical application review; technical findings are handled in mandatory survey and conditional drawing/MTO workflows. `MANAGER_ULP` may reject only against explicit owner-approved criteria; absent such criteria, return/hold rather than terminal reject. RKM ULP draft/submitter recommendation is `MANAGER_ULP`; a preparer may be the same user. Existing `PERENCANAAN` AND `KONSTRUKSI_UP3` distinct validation, `UP3_MANAGER` final approval and no-procurement side effect remain unchanged. See [document 38](./38-O-036-APPLICATION-RKM-ACTOR-RESOLUTION.md).

**Alternative:** task-based ULP delegate instead of fixed `MANAGER_ULP` role; this requires delegation policy and assignment audit. **Impact:** application state and task boundary become explicit without new role or duplicate survey subsystem. **Risk if undecided:** no unapproved actor may return/reject or bypass mandatory survey. **Approvers:** authorized PB/PD and ULP/RKM process owners.

### 12.2 O-038 — survey and meter

Recommend `MANAGER_ULP` assign and review survey; `TEKNIK` executes/submits; reviewer is a distinct user; no separate formal survey approval unless SOP requires it. `ACCEPTED` survey gates technical downstream when survey-derived data is required. Recommend `MANAGER_ULP` assign/verify meter installation, `TEKNIK` install/upload evidence, installer and verifier distinct, and system-enforced verified-meter prerequisite before application completion. Vendor may install only after O-029/O-039 conditions. Preserve one current verified meter per service point with append-only installation/replacement attempts, using T4.2.4 evidence references, not duplicate document storage. See [document 39](./39-O-038-SURVEY-METER-ACTOR-LIFECYCLE.md).

**Alternative:** technical peer review by another `TEKNIK` assignee; formal approval only if owner mandates. **Impact:** prevents self-verification and keeps survey, meter, application and WO histories separate. **Risk if undecided:** hold survey-dependent MTO and application completion. **Approvers:** PB/PD process owner and ULP technical owner.

### 12.3 O-039/O-029 — work, vendor and completion

Recommend one logical construction project per application/work, at most one active WO at a time, sequential historical WOs after terminal close, immutable WO versions for amendments, and one currently effective approved vendor assignment per active WO version. `KONSTRUKSI_UP3` drafts/selects; `PERENCANAAN` reviews source inputs; `ASMAN_KONSTRUKSI` approves/issues and remains final completion approver. Keep WO approval/issue separate from vendor assignment approval. Progress is item/activity and reporting-period based; cumulative percentage is derived; corrections add submissions, never overwrite verified records. `KONSTRUKSI_UP3` child-ULP verify/inspect scope stays action-specific. Inspector is recommended distinct from submitter and final completion approver. Completion requires verified final progress, passing inspection, required versioned evidence, applicable meter verification, and valid source/version/vendor state; external material reconciliation is required only if approved SOP says so, and DISTRIVA does not maintain stock ledger. See [document 40](./40-O-039-WORK-ORDER-LIFECYCLE-APPROVAL.md).

Vendor eligibility recommendation: active legal company in centrally governed registry, verified user-account-to-company link, current contract/eligibility for project and period, UP3/project match, and approved assignment to exact WO. Revoke/suspend any failed link and deny immediately. Owner/source of vendor eligibility needs O-029 evidence.

**Alternative:** no separate WO approval stage; `ASMAN_KONSTRUKSI` authorizes issue after review. **Impact:** changes whether status and permission `work_orders.approve` exist, so explicit decision is essential. **Risk if undecided:** no WO issue, vendor access, or material dispatch. **Approvers:** UP3 construction, vendor/contract, and material integration owners.

### 12.4 O-041 and T4.2.2 — calculations, price and UOM

Recommend `PERENCANAAN` run RAB/KKF/feasibility; `ASMAN_PERENCANAAN` review; no standalone RAB approval by default; keep existing KKF approval matrix and distinct-user rules. One KKF version pins one exact approved RAB run; scenarios are explicit child records. Feasibility is conditional, versioned and may have multiple scenarios; KKF pins exact accepted scenario where required. `Discount Rate` is the feasibility/NPV threshold; RWACC remains an indicator.

Proposed deterministic price priority: one valid approved UP3-internal price for exact material/type/unit/date, otherwise one valid official external price; if none or multiple candidates at the selected priority, block and resolve manually. No silent latest/most-recent choice, combination or sum. UOM uses exact validated ERP code mapping and an approved material-specific effective-dated conversion; unknown or ambiguous mapping blocks calculation. Store all selected source/unit/conversion/parameter/engine values and hashes in immutable calculation snapshots. See [document 41](./41-O-041-RAB-KKF-FEASIBILITY-LIFECYCLE.md).

**Alternatives:** external official always wins; or an authorized operator selects a source per calculation with review. **Impact:** selected branch directly changes financial results. **Risk if undecided:** no authoritative RAB/KKF result for ambiguous inputs. **Approvers:** finance/planning, construction where relevant, and ERP/material data owners. Do not treat this proposal as a change to `D-MDM-001`.

### 12.5 O-033/O-037 — authorization/reporting

Document 34 section 10.10 proposes granular identifiers and candidate role mappings for every domain, including separate domain export keys. Owner must sign each identifier/role/scope/precondition grant. No key or grant is final. O-037 recommends source-scope metrics for applications, survey, drawing/MTO, RKM, WO/progress/inspection, RAB/KKF/feasibility and meter; apply SQL predicates before count, aggregation, pagination, sorting and export; mask sensitive fields by default; no global export; special child-ULP WO action rights do not imply report visibility.

**Alternative:** start with view-only reports and defer export identifiers until data classification is approved. **Impact:** restricts initial release but reduces disclosure risk. **Risk if undecided:** no export/report access beyond already authorized domain reads. **Approvers:** each domain owner and security/identity owner.

## 13. Cross-document conflict and issue audit

### 13.1 Conflict found and corrected

The v3.10.0 audit left [document 16](./16-FINALIZED-BUSINESS-DECISIONS.md) unchanged, but its T4.2.2 section still stated external-only material pricing and `ASMAN_KONSTRUKSI` as KHS/BOM approver. These were earlier decisions and conflict with later decision entries in docs 15/23: D-MDM-001 supports external plus internal UP3 pricing; D-MDM-002 sets `UP3_MANAGER` as KHS/BOM approver. Document 16 now marks the older wording historical/superseded and states the current design baseline. The unresolved price priority/UOM remain open; no new business decision was created.

### 13.2 Issue coverage

All open/partial issues in the current Decision Register were included in [document 43](./43-OPEN-ISSUES-RESOLUTION-REPORT.md), including O-001–O-026 and O-028–O-041. Existing closed O-027/O-032/O-035/O-040/O-042 remain unchanged. The issue statuses themselves remain open/partial where owner evidence is missing; recommendations are not closures.

### 13.3 Resource authorization and database contract

O-034 proposal document 35 now adds a consolidated owner-review inventory, proposed cardinality/ER summary, lifecycle guards, indexes/constraints and transaction/version contract. It explicitly reuses T4.2.1–T4.2.4 resources: no duplicate organization/user/material/UOM/document/Auto MTO/task/SLA/inventory subsystems. Cross-document proposals are summarized in document 42. Every candidate resource action remains subject to persisted actor assignment and source-resource scope; vendor remains deny-all until full domain relations are verified.

## 14. Files updated in v3.11.0

- `docs/16-FINALIZED-BUSINESS-DECISIONS.md`: additive clarification that old T4.2.2 price/approver statements are superseded by recorded D-MDM-001/002.
- `docs/34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md`: consolidated proposed permission/action/role/scope/SoD/export matrix and O-037 report definition recommendations; no grants finalized.
- `docs/35-O-034-RESOURCE-MODEL-LIFECYCLE-SCHEMA.md`: proposed resource inventory, cardinality, lifecycle, constraints/index/transaction contract; remains `PROPOSED`.
- `docs/38`–`docs/41`: concrete role/lifecycle/SoD/pricing/UOM recommendation packs, pending owner decisions.
- `docs/42-CROSS-DOMAIN-RESOURCE-WORKFLOW-MATRIX.md` and `docs/43-OPEN-ISSUES-RESOLUTION-REPORT.md`: integrated recommendation matrix and all-open-issue disposition.
- `docs/44-OWNER-DECISION-REGISTER.md`: link to recommendation pack; owner fields stay pending.
- `docs/45` (this report), Decision Register, Technical Status, README, Master Prompt, AI-HANDOFF, changelog and root package manifest: baseline synchronized to v3.11.0.

`docs/16` was changed only to reconcile already recorded later decisions, not to adopt any recommendation in this pack. No source code, migration, database, seeder, Policy, query scope, API, production data, or test evidence was changed.
