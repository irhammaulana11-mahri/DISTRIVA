# Phase 2B — Auth API + AssignmentWriteService (foundation only)
Target: `distriva_backend_test`. Full suite PASS 56 tests / 161 assertions; Pint PASS. `distriva_db` untouched.
## Implemented
- `POST /api/auth/login` (throttle 5/min, identical 401 for unknown/bad password/non-ACTIVE, token + must_change_password flag), `POST /api/auth/logout` (revokes current token), `GET /api/me`. Group middleware `EnsureActiveAccount` rejects tokens of non-ACTIVE accounts (403). No permission endpoint (`/me/permissions` needs O-033).
- `AssignmentWriteService::assign/revoke` per doc 32 section 5: one transaction for change + append-only history (before/after, reason required, actor, actor_assignment ownership check); `AuthorizationScopeChanged` event only after commit; DB overlap/rule errors translated to `AssignmentRuleViolation` with no partial rows.
## Deliberately NOT done
- No HTTP endpoint for assignment management and no authorization of the actor inside the service: who may assign depends on O-033 permission keys. Callers must authorize first.
- No cache layer exists; event is the hook for future invalidation.
- No password change/reset endpoint, account-status write path (authorization_change_histories) or organizational-unit write service yet.

## Addendum — remaining foundation write paths
Full suite PASS 61 tests / 186 assertions; Pint PASS (target `distriva_backend_test`).
- `AccountStatusService` (users.account_status + authorization_change_histories USER_STATUS_CHANGED, tokens revoked when not ACTIVE, no self-change, no no-op, reason required, event after commit).
- `OrganizationalUnitWriteService` (create/update name/address/is_active + organizational_unit_histories; code/type/parent immutable pending O-030; DB hierarchy/duplicate errors -> domain errors, no partial history).
- `POST /api/me/password` (current password check, confirmed, throttled, clears must_change_password, revokes other tokens). Password strength rule (min 8) is a placeholder: no policy in docs.
All services require callers to authorize the actor first (O-033); no HTTP endpoints for them.
