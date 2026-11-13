# Frontend auth shell (React 19 + Vite 8 + Tailwind 4)
`npm test` (vitest, fetch mocked): PASS 8/8. `npm run build`: PASS.
Scope: login, logout, profile, forced + voluntary password change, protected routes, responsive sidebar/header/breadcrumb, loading/error/validation states. Menus only for existing, permission-free routes.
Token in sessionStorage (not localStorage); 401 on a tokened request clears the session; UI gating is UX only, backend enforces.
NOT RUN: live browser/E2E against the Laravel server (backend `.env` targets distriva_db, which has no application tables; no migration was authorized for it). Vite dev proxies /api -> http://127.0.0.1:8000.
