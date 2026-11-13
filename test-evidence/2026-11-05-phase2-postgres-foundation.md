# Phase 2 — PostgreSQL foundation tests (A-02, A-03, A-04 partial)
Target: pgsql 127.0.0.1:5432 / `distriva_backend_test` (created by owner; btree_gist created by distriva_user — trusted extension). Guard in `tests/PostgresTestCase.php` aborts unless pgsql + that DB. `distriva_db` untouched (only `migrations` table).
Result: `php artisan test` PASS 40 tests / 93 assertions; Pint PASS.
- PostgresFoundationIntegrityTest: CHECKs, org hierarchy triggers, role-scope trigger, overlap exclusion constraints, append-only history, RESTRICT FKs.
- PostgresAuthorizationServiceTest: real-query same-unit, inclusive date bounds, inactive account/assignment/unit, UP3 descendant mode, SYS_ADMIN system-only, vendor deny-all, catalog permission.
- PostgresSanctumBearerTest: UUID user bearer token OK; missing/invalid/revoked rejected.
## Bug found & fixed
ScopedAuthorizationService eager-load closures were typed `Builder` but receive `Relation` -> TypeError on any real DB call. Fixed (Relation type); regression covered by the authorization tests.
## Not done
A-05 (blocked O-033/O-034), A-06 (contract not approved), concurrency stress, cache invalidation.

## Concurrency (added)
`tests/Feature/PostgresConcurrencyTest.php` — two real PDO sessions on `distriva_backend_test` (lock_timeout 400ms, committed data, cleanup in tearDown). Verified: overlapping assignment blocks (55P03) then fails with exclusion violation (23P01) after commit; non-overlapping do not block; duplicate unit code blocks then 23505; deactivating UP3 blocks against concurrent child ULP insert then trigger rejects (P0001); rolled-back insert leaves no rows.
Full suite: PASS 45 tests / 111 assertions (run twice; second run confirms no leftover data). Pint PASS.
