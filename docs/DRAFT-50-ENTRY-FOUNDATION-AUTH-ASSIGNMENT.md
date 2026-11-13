> **Catatan tata kelola v3.16.0 — dokumen historis/referensi:** Dokumen ini dipertahankan untuk menjaga jejak analisis dan audit pada saat penyusunannya. Persyaratan nama asli, verifikasi kewenangan formal, tanda tangan, SK/surat tugas, serta urutan gate administratif di dalamnya tidak berlaku sebagai prasyarat pengembangan internal DISTRIVA. Gunakan `docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md` sebagai panduan aktif. Status issue dan temuan teknis substantif dalam dokumen ini tidak otomatis berubah; verifikasi kembali relevansinya terhadap modul yang sedang dikerjakan.

---

# DRAFT — Doc 50 entry proposal: Foundation auth + assignment write (NOT an approval)
All approval fields are intentionally PENDING; fill and sign in doc 50 by an authorized person.
- Requested scope: backend/app/Http/Controllers/AuthController.php, routes/api.php (auth/login, auth/logout, me), AssignmentWriteService, EnsureActiveAccount, tests.
- Exclusions: any business-domain schema, permission keys/grants (O-033), Policies, vendor access, assignment-management HTTP endpoints, frontend.
- Environment: local; DB `distriva_backend_test` for tests (destructive allowed); `distriva_db` read-only/non-destructive migrations only.
- Rollback: code revert; no new migrations were added.
- Evidence: test-evidence/2026-11-05-phase2b-auth-and-assignment-write.md
- Business/technical/database/implementation approver, date, signature: PENDING
