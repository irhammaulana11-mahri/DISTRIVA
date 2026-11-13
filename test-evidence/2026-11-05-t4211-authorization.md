# T4.2.1.1 Scoped Authorization Test Evidence

**Date:** 5 November 2026  
**Scope:** Initial `ScopedAuthorizationService`, assignment/org models, authorization context, and default vendor denial.  
**Database:** No database connection or query was made. Tests use persisted-state model doubles/in-memory assignment fixtures.

## Test results

| Check | Command | Result |
|---|---|---|
| Scoped authorization unit tests | `cd backend && php artisan test --filter=ScopedAuthorizationServiceTest` | PASS — 15 tests, 20 assertions |
| Full Laravel test suite | `cd backend && php artisan test` | PASS — 20 tests, 30 assertions |
| PHP formatting | `cd backend && ./vendor/bin/pint --test` | PASS |
| PHP syntax | `find app tests -name '*.php' -print0 \| xargs -0 -n1 php -l` from `backend/` | PASS |
| Container binding | `php artisan tinker --execute='$service = app(App\Services\Authorization\ScopedAuthorizationService::class); echo get_class($service).PHP_EOL;'` | PASS — service resolved |
| Route registration | `php artisan route:list` | PASS |
| Composer manifest | `composer validate --strict` | PASS |

## Coverage

Tests cover active account, active/status/date-valid assignment, inclusive dates, active unit, multi-role/multi-unit matching, same-user assignment, canonical guard, permission existence, exact-unit default, explicit UP3-child-ULP read mode, SYS_ADMIN system-only behavior, complete vendor scope inputs, and fail-closed vendor verification.

## Limitations

- The unit test service subclass supplies in-memory assignments; it does not execute the Eloquent assignment query or prove database relationships.
- PostgreSQL integration for `effectiveAssignments()`, Policy/route integration, concurrent revocation, Sanctum UUID authentication, and production behavior are NOT RUN.
- The `.env` database target was not queried. No migration or database mutation occurred.
- This evidence does not establish production readiness.
