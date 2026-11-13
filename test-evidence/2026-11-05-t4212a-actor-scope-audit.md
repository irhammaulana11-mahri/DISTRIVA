# T4.2.1.2A Actor, Approval, SoD, and Scope Audit Evidence

**Design baseline:** v3.7.0  
**Documentation integrity correction:** v3.7.1  
**Date:** 2026-11-05  
**Type:** Static documentation/source audit  
**Automated tests:** NOT RUN  
**Database/migrations:** NOT RUN  
**Git status:** UNAVAILABLE — `/media/data/PROJECT/DISTRIVA` is not detected as a Git repository.

## Scope inspected

Documentation:

- `PROMPT_MASTER_DISTRIVA_AI_DEVELOPMENT.md`, `README.md`, `PACKAGE-MANIFEST.json`
- `docs/03-ROLES-AND-ACCESS.md`, `docs/04-BUSINESS-WORKFLOW.md`
- `docs/05-DATABASE-DESIGN.md`, `docs/06-ERD.md`
- `docs/08-RAB-KKF-ENGINE.md`, `docs/09-APPROVAL-AND-DRAWING.md`
- `docs/12-RKM-PLANNING.md`, `docs/15-DECISIONS-AND-OPEN-ISSUES.md`
- `docs/16-FINALIZED-BUSINESS-DECISIONS.md`, `docs/17-T4-TECHNICAL-DESIGN-STATUS.md`
- `docs/18-CHANGELOG-AND-SUPERSEDED-DECISIONS.md`
- `docs/24-T4.2.3-APPLICATIONS-PB-PD-SCHEMA.md`
- `docs/26-T4.2.4-DOCUMENTS-AUTO-MTO-SCHEMA.md`
- `docs/34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md`, `docs/AI-HANDOFF.md`, `docs/PROJECT-CONTEXT-FOR-AI.md`

Source:

- Authorization service/context/mode/vendor authorizer under `backend/app/Services/Authorization/`
- `backend/app/Models/User.php`, `Role.php`, `UserRoleAssignment.php`, `OrganizationalUnit.php`
- `backend/database/seeders/RoleSeeder.php`
- `backend/routes/api.php`
- `backend/database/migrations/` listing
- `backend/tests/Unit/ScopedAuthorizationServiceTest.php`, `AuthorizationBootstrapTest.php`
- Backend model/controller/service/Policy file listings

## Findings

1. `ScopedAuthorizationService` supports `SYSTEM`, `SAME_UNIT`, and explicit `UP3_DESCENDANT_READ`. It does not implement child-WO verify/inspect modes.
2. The service uses `user_role_assignments`; Spatie remains catalog-only. The role seeder lists 14 roles, with unitless assignment limited to `SYS_ADMIN`.
3. The only API route is Sanctum-protected `/api/user`. No business resource model, controller, Policy, middleware, or query scope was found in the inspected backend paths.
4. Vendor authorization remains fail-closed: `DenyUnverifiedVendorScopeAuthorizer::allows()` returns false.
5. Existing authorization tests use in-memory model fixtures. They do not establish PostgreSQL/Eloquent query integration or business lifecycle enforcement.
6. Application/survey, drawing/MTO, calculation, RKM, vendor assignment, WO, progress, completion, and meter schemas appear in design documents, not in current business migrations/models.
7. User-selected SoD: every approver at an AND step is a distinct user; submitter cannot final-approve its own version; progress submitter and verifier must be distinct for vendor and internal progress.
8. User-selected reporting scope: dashboard/report uses source permission and scope; export requires a separate permission per domain. Report-specific metrics/roles/fields remain unresolved.
9. RKM validator roles, final approver, validator separation, submitter/final-approver separation, and procurement separation are recorded as selected design directions. The ULP proposer role remains unspecified.
10. Application review, survey actor roles, WO maker-checker-issuer roles, meter verifier, RAB runner/reviewer, and feasibility lifecycle remain unresolved.
11. The owner selected that every user with an effective `KONSTRUKSI_UP3` assignment on the relevant UP3 can verify/inspect all child-ULP WO without additional WO/task assignment; the actions remain narrow and do not imply other business permissions.
12. Workspace Git status could not be queried because the workspace is not a Git repository.

## Validation boundary

This evidence is a static audit only. No `php artisan test`, migration, seeder, database connection, database query, or source-code change was performed. Prior test outcomes documented in v3.5.0 are historical and are not a test result for this checkpoint.

## Result

Implementation gate: **BLOCKED**. Permission keys and role grants remain candidates; business resource lifecycle/schema and remaining actor decisions are prerequisites. Vendor stays deny-all. Documentation was updated additively to v3.7.0; no ZIP was created.

## Documentation integrity correction v3.7.1

- Decision registry audit found duplicated legacy decision IDs: D-027/D-028 across MDM and AUTH, and D-029–D-034 across PBPD and AUTH.
- Domain-qualified IDs and the old/new mapping were recorded in `docs/15-DECISIONS-AND-OPEN-ISSUES.md`; decision content was not changed.
- O-001–O-042 were checked for unique identifiers and status consistency. O-028, O-031, O-036, and O-037 remain partial/open; unresolved issues remain open; closures are tied to explicit decisions or completed evidence.
- The v3.6.0 authorization matrix is historical; the v3.7.0 T4.2.1.2A addendum is the latest decision record. Permission keys/grants remain unfinalized; Policies, query scopes, and domain authorization remain unimplemented.
- Validation was documentation/static-reference inspection only. No application tests, source edits, migrations, database operations, or ZIP creation occurred.
