# E2E auth smoke (live HTTP, curl)
Server: `php artisan serve` on 127.0.0.1:8089 with `DB_DATABASE=distriva_backend_test` (`distriva_db` NOT used; port 8000 was occupied by another process).
Results: bad login 401 (generic message) · login 200 (token, must_change_password=true, UUID user id, email case-insensitive) · /me 200 · /me without token 401 · change password 200 · logout 200 · /me after logout 401 · login with the new password 200.
Cleanup: server stopped; the E2E user and tokens deleted from the test DB.
NOT covered: browser-driven UI run (frontend tests use a mocked fetch).
