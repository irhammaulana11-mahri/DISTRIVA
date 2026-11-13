# Foundation Auth + Assignment — verification run (2026-11-06)
## Environment
PHP 8.5.4, Composer 2.9.5, Node 22.22.3, npm 10.9.8, PostgreSQL 18.6, Chrome 156. Not a Git repository. `backend/bootstrap/cache` was missing and was recreated (empty). DB target for all tests/E2E: `distriva_backend_test` (guard in phpunit.xml + PostgresTestCase). `distriva_db`: read-only checks only; still contains only table `migrations`. No migration run on it.
## Baseline (before changes)
composer validate PASS · backend 66 tests/200 assertions PASS · Pint PASS · frontend 8/8 PASS · build PASS.
## Findings
| ID | Sev | Finding | Status |
|---|---|---|---|
| F-01 | P0 | `GET /api/user` used only `auth:sanctum` (no active-account check, raw model serialization) | Fixed: route removed; tests moved to `/api/me`; regression tests for SUSPENDED/INACTIVE/PENDING_ACTIVATION on all protected routes |
| F-02 | P1 | Write services did not verify the actor was an existing ACTIVE account | Fixed + test |
| F-03 | P1 | Expired/idle tokens were never purged | Fixed: daily `sanctum:prune-expired` (verified via `schedule:list`); needs a running scheduler |
| F-04 | P2 | `must_change_password` enforced only in frontend | Open (no domain routes yet); recorded in docs |
| F-05 | P2 | assign() does not check target account status or actor-assignment effectiveness | Open, recommendation: decide with O-033 contract |
| F-06 | P2 | Login tokens accumulate per login (no per-user cap) | Open, low risk with 30-min idle expiry + pruning |
## After changes
Backend `php artisan test`: PASS 73 tests / 222 assertions. Pint PASS. Frontend Vitest 8/8 PASS, `npm run build` PASS. `schedule:list` shows the prune job (run with CACHE_STORE=array because distriva_db has no cache tables).
Browser E2E (`frontend/e2e/auth-browser-e2e.mjs`, Chrome + playwright-core, Laravel :8089 on distriva_backend_test, Vite :5199): 14/14 PASS — guest redirect, generic login error, forced password change, token only in sessionStorage, reload restore, logout clears token, revoked token 401, stale token returns to login, login returns to requested page, mobile menu button. Two earlier runs had FAILs caused by script race/assumption errors (isVisible without wait; expected Home instead of the originally requested /profil), fixed in the script; no app defect was found.
Cleanup: servers stopped, test user/tokens deleted (0 users left in test DB).
## Acceptance
1 PASS · 2 PASS · 3 PASS (unit/feature + E2E) · 4 PASS · 5 PASS (no write endpoint exposed) · 6 PASS · 7 PASS · 8 PASS (Chrome, desktop+mobile button only; no visual review) · 9 PASS (no writes to distriva_db) · 10 PASS.
Overall: TESTED; open items F-04..F-06 and O-033 remain.

## Addendum — login lockout + DB time zone (2026-11-06)
Backend `php artisan test`: PASS 83 tests / 290 assertions (PostgreSQL `distriva_backend_test`); Pint PASS.
- `LoginLockoutTest` (9 tests): 5 failures lock 15 min (correct password also refused), 4 failures + success resets, lock expiry at 15 min, attempts during lock do not extend it, locked == unknown account response, per-account isolation, admin status change clears lock, non-ACTIVE with correct password not counted, DB CHECK rejects negative counter.
- Bug found by these tests (first run: 4 failures): PostgreSQL session zone Asia/Jakarta vs app UTC shifted every timestamptz written by Laravel by 7h. Fixed with pgsql `timezone=UTC`; regression test added. Earlier tests did not catch it because none compared an absolute instant.
- NOT done: CAPTCHA; concurrency stress of the lockout counter (row lock used, but not stress-tested); migration not applied to `distriva_db`.

## Addendum — password policy doc 16 (2026-11-06)
Backend: PASS 97 tests / 327 assertions (PostgreSQL `distriva_backend_test`), Pint PASS. Frontend: Vitest 9/9, build PASS. Browser E2E (Chrome): 16/16 PASS incl. weak-password step (all violations shown, stays on page).
`PasswordPolicyTest` (14 cases): each rule's message, common password with decoration/leet, strong accepted, email/name containment, last-5 window (5 most recent blocked, 6th back allowed), hashes only in history, API returns every violation and changes nothing, HIBP lookup makes no request by default.
Notes: password_histories migration (`2026_11_06_100000`) applied to the test DB only. Pre-existing users have no history rows: only their current password is checked on their first change. The denylist is a small bundled list (149 entries), not a full breached-password corpus. One test needed the throttle disabled (six password changes in one minute) — the throttle itself is covered by AuthApiTest.

## Addendum — admin endpoints + distriva_db migrate (2026-11-06)
Backend: PASS 118 tests / 425 assertions (`distriva_backend_test`), Pint PASS. `AdminEndpointsTest` (21): seeder idempotency + exact key/grant counts (6 keys, 12 grants, no grant for TEKNIK); 403 for no-grant users on every endpoint without id probing; expired/inactive assignment and suspended admin lose access; read scope before pagination (totals/last_page); assignments filtered to scope; filters cannot leave scope, LIKE wildcard escaped, per_page capped; assign inside scope (history + actor), document required, forged out-of-scope unit → 404, escalation/VENDOR/self/UP3_ADMIN-on-ULP → 403, overlap → 409; end in scope, out of scope/system/unknown → 404, self → 403, last admin → 409; status change inside scope (tokens revoked, history), partly-out-of-scope/system/self/unknown → 404/403, last admin → 409; SYS_ADMIN writes closed (MFA); delegation mode limited to admin keys and the UP3_ADMIN role.
Test-authoring errors fixed during the run (wrong expected counts; a too-loose `password` substring assertion) — no application defect. Earlier in this step a design bug was caught before commit: read endpoints used a wrapper that returned a JsonResponse on denial (would have been treated as a scope array); replaced by exception rendering in bootstrap/app.php. Also moved the grant check before validation to stop id probing.
DB operation on `distriva_db`: found 11 foundation tables (empty) and 0 data rows; pg_dump -Fc backup to ~/distriva-backups; restore verified in temp DB (identical counts) then dropped; `php artisan migrate` ran 2 pending migrations (DONE); verified columns/table; no seeding. Roles/permissions are NOT present in `distriva_db` yet.
NOT done: UI for admin, MFA, CAPTCHA, email/WhatsApp senders, first-admin bootstrap, seeding of `distriva_db`, load/stress testing.
