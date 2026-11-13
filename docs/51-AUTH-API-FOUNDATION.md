# 51 — Foundation Auth API & Write Services (implementation status)

**Scope:** foundation only (T4.2.1). No business-domain endpoint, permission key (O-033) or domain schema is included. Dokumen ini adalah catatan status implementasi; verifikasi kode dan test aktual tetap diperlukan. Persetujuan tanda tangan Doc 50 bukan prasyarat pengembangan internal menurut tata kelola v3.16.0.

## Endpoints (prefix `/api`, JSON, Sanctum bearer token)
| Method / path | Auth | Description |
|---|---|---|
| `POST /auth/login` | none, throttle 5/min | Body `email`, `password`, optional `device_name`. 200 → `token`, `token_type`, `must_change_password`, `user`. 401 (identical message) for unknown email, wrong password, or non-ACTIVE account. 422 validation. 429 throttled. |
| `POST /auth/logout` | bearer | Revokes the current token. |
| `GET /me` | bearer, ACTIVE account | Returns `user` (id, nip, name, email, phone, account_status, must_change_password). |
| `POST /me/password` | bearer, ACTIVE, throttle 5/min | Body `current_password`, `password`, `password_confirmation`. 422 if the current password is wrong, the new one is unconfirmed, equal to the current one, or violates the password policy (see Policies). Clears `must_change_password`; revokes all other tokens. |

`GET /api/user` (skeleton, tanpa pengecekan akun aktif) telah **dihapus** (6 Nov 2026); `/api/me` adalah satu-satunya kontrak profil (allowlist field). Non-ACTIVE accounts holding a token get 403 on every protected route; status changes revoke tokens. `/me/permissions` is not implemented (needs O-033).

## Administration endpoints
See `docs/55-FOUNDATION-ADMIN-IMPLEMENTATION-STATUS.md` (`/api/admin/*`).

## Services (no HTTP exposure; callers must authorize the actor — O-033)
- `AssignmentWriteService::assign/revoke` → `user_role_assignments` + `user_role_assignment_histories`, reason required, event after commit.
- `AccountStatusService::change` → `users.account_status` + `authorization_change_histories`, tokens revoked when not ACTIVE, no self-change.
- `OrganizationalUnitWriteService::create/update` → `organizational_units` + `organizational_unit_histories`; code/type/parent immutable (O-030 open).
- Semua service menolak actor yang tidak ada atau bukan `ACTIVE` (`AssignmentRuleViolation`).
- Domain error: `AssignmentRuleViolation`. Event: `AuthorizationScopeChanged` (hook for future cache invalidation).

## Policies (owner instruction, 2026-11-05)
- **Password (DECIDED = docs/16):** min 8 characters with upper, lower, digit and symbol; not equal to any of the last 5 passwords (`password_histories`, hashes only; current password + 5 most recent history rows); common-password denylist (`resources/data/common-passwords.txt`, compared with the password and its letters-only core, so `Password1!` is rejected); must not contain the e-mail local part or a name part of 4+ letters. All violations are returned together in Indonesian (422). Optional breached lookup (`DISTRIVA_PASSWORD_CHECK_BREACHED`, default off) calls the external HaveIBeenPwned API. Code: `App\Services\PasswordPolicy`, `App\Rules\StrongPassword`. Setting `password_min_length`/`password_history_count` via env.
- **Token expiry:** 30-minute **idle** timeout (`distriva.token_idle_minutes`, env `DISTRIVA_TOKEN_IDLE_MINUTES`). Login tokens get `expires_at = now + 30 min`; every authenticated request extends it (written at most about once a minute). A token unused for 30 minutes is rejected with 401 and the frontend returns to login. The owner said "around 30 minutes"; this was read as idle timeout, not a hard 30-minute cap — say so if an absolute cap is wanted. Tokens created outside login (e.g. tests) have no expiry. Expired tokens are purged daily by the scheduled `sanctum:prune-expired --hours=24` (requires a running scheduler: `php artisan schedule:work` / cron).

## Account lockout (doc 16)
5 consecutive wrong passwords lock the account for 15 minutes (`distriva.login_max_attempts`, `distriva.login_lockout_minutes`; columns `users.failed_login_attempts`, `users.locked_until`, migration `2026_11_06_090000_add_login_lockout_to_users_table`). While locked even the correct password is refused and attempts do not extend the lock. All failure causes (unknown email, wrong password, non-ACTIVE, locked) return the identical 401 body (no account enumeration). The counter resets on success, when the lock expires, or when an admin changes the account status. Attempts are serialized with a row lock. Non-ACTIVE accounts with a correct password are not counted. The per-IP throttle (5/min) remains. CAPTCHA is not implemented.

## Database time zone
`config/database.php` pgsql `timezone` = `UTC` (env `DB_TIMEZONE`). Before 2026-11-06 the PostgreSQL session used the server zone (Asia/Jakarta) while the app used UTC, so every `timestamptz` written through Laravel was stored 7 hours early (history `changed_at`, assignment/unit timestamps). No business data existed; test DB only. Regression test: `PostgresFoundationIntegrityTest::timestamptz_values_written_by_the_app_are_the_correct_instant`.

## Safety guard
`App\Support\DestructiveDatabaseGuard`, registered on Artisan `CommandStarting`: `migrate:fresh|refresh|reset|rollback` and `db:wipe` are refused unless the target database is in `config('distriva.disposable_databases')` (= `distriva_backend_test`). The main database `distriva_db` is therefore protected.

## Frontend
`frontend/` (React + Vite + Tailwind): login, profile, change password, protected routes. Token kept in `sessionStorage`. Dev proxy `/api` → `127.0.0.1:8000`.

## Test evidence
`test-evidence/2026-11-05-phase2-postgres-foundation.md`, `...phase2b-auth-and-assignment-write.md`, `...phase9a-frontend-auth.md`, `...e2e-auth-smoke.md`.
Backend: 83 tests / 290 assertions (PostgreSQL `distriva_backend_test`). Frontend: 8 Vitest tests + 14 browser E2E checks (`frontend/e2e/auth-browser-e2e.mjs`, Chrome via playwright-core). Details: `test-evidence/2026-11-06-foundation-auth-assignment.md`.

## Known limitations
Not implemented although decided in doc 16: CAPTCHA, MFA for SYS_ADMIN, password history/complexity, temporary password, OTP recovery (see doc 54 §1); `must_change_password` is enforced only by the frontend (no domain routes exist yet — enforce server-side when the first one is added); no absolute session cap or refresh-token flow; no CORS config (dev uses the proxy; production topology undecided).
