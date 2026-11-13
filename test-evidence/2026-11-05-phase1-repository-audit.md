# Phase 1 — Repository Audit & Readiness Matrix (2026-11-05)

Baseline docs v3.15.0. Read-only audit; no migration, seeder, or schema change was run. No Policy, model, route, or permission was added.

## Verified evidence (actual runs)
| Check | Result |
|---|---|
| `php artisan test` (PHP 8.5.4) | PASS 22 tests / 33 assertions (no-DB tests only) |
| Pint `--test` | PASS |
| `composer validate --strict` | PASS |
| `route:list` | 6 routes; only business-relevant one is `GET /api/user` |
| PostgreSQL server | 18.6 accepting on 127.0.0.1:5432; `pdo_pgsql` present, `pdo_sqlite` absent |
| DBs visible to `distriva_user` | `distriva_db`, `distriva_t424_test`. **`distriva_backend_test` does NOT exist** |
| `distriva_db` (read-only query) | only table `migrations`; extensions `plpgsql`, `btree_gist`; role has CREATEDB |

## Environment mismatches
1. `backend/.env`: `DB_CONNECTION=sqlite` (and port 3306) — not PostgreSQL. Must be changed to `pgsql`/5432 by the owner or with approval.
2. `phpunit.xml` forces SQLite `:memory:`, but `pdo_sqlite` is missing -> any DB-backed test cannot run. Needs a pgsql test connection pointing at `distriva_backend_test`.
3. `distriva_backend_test` must be created (not done; see instructions below).
4. `frontend/`, `python-service/`, `deploy/` are empty.
5. Workspace is not a git repository.

## Readiness matrix
| Area | Status |
|---|---|
| T4.2.1 foundation migrations (11), User/Role/OrgUnit/UserRoleAssignment models, RoleSeeder | Available (runtime-proven earlier on disposable DB, rolled back) |
| ScopedAuthorizationService + vendor deny-all authorizer | Available, unit-tested; not wired to any Policy |
| Sanctum UUID bearer E2E | Not run (needs PG test DB) — A-03 |
| PG integration tests for migrations/triggers/service | Not run — A-02 |
| Assignment write service + append-only audit + cache invalidation | Not implemented; requires contract approval — A-06 |
| Master data (T4.2.2), PB/PD (T4.2.3), Documents/MTO (T4.2.4) | Design only; upstream open issues; BLOCKED – IMPLEMENTATION AUTHORIZATION REQUIRED |
| Survey/Meter, WO, RAB/KKF/Feasibility, RKM | BLOCKED – OWNER DECISION REQUIRED (O-034/036/038/039/041) |
| Permission catalog/grants | BLOCKED – O-033 |
| Dashboard/export | BLOCKED – O-037 |
| Vendor access | BLOCKED – O-029 (stays deny-all) |
| Frontend / Python / deploy | Not started; blocked by stable API contracts / O-019,O-022–025 |
| Doc 50 approval register | Entirely PENDING -> `BELUM TERSEDIA – IMPLEMENTATION AUTHORIZATION REQUIRED` for every domain scope |

## Safe work available (Phase 2 foundation hardening), pending only environment actions
- A-02/A-03: PG integration harness + Sanctum E2E on `distriva_backend_test`.
- A-04: extra boundary tests (no DB needed).
- A-06: assignment write service — only after contract approval.

## Instructions to create the test DB (not executed)
```sql
-- as a role with CREATEDB (distriva_user has it)
CREATE DATABASE distriva_backend_test OWNER distriva_user;
\c distriva_backend_test
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- may need superuser
```
