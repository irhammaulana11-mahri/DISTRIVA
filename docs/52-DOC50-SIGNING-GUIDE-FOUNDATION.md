> **SUPERSEDED (6 November 2026):** `docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md` menyatakan nama asli, tanda tangan, SK, dan surat tugas tidak lagi menjadi prasyarat. Dokumen ini dipertahankan sebagai riwayat dan bukan gate aktif. Yang tetap berlaku: backup sebelum migrate pada database utama dan larangan operasi destruktif.

> **Catatan tata kelola v3.16.0 — dokumen historis/referensi:** Dokumen ini dipertahankan untuk menjaga jejak analisis dan audit pada saat penyusunannya. Persyaratan nama asli, verifikasi kewenangan formal, tanda tangan, SK/surat tugas, serta urutan gate administratif di dalamnya tidak berlaku sebagai prasyarat pengembangan internal DISTRIVA. Gunakan `docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md` sebagai panduan aktif. Status issue dan temuan teknis substantif dalam dokumen ini tidak otomatis berubah; verifikasi kembali relevansinya terhadap modul yang sedang dikerjakan.

---

# 52 — Panduan Pengisian & Tanda Tangan Doc 50 (Scope: Foundation Auth + Assignment)

Panduan ini membantu pihak berwenang mengisi `docs/50-IMPLEMENTATION-APPROVAL-REGISTER.md` untuk **satu scope bounded**. Panduan ini bukan persetujuan. Nama, tanggal, tanda tangan, dan bukti diisi **oleh penyetuju sendiri**; tidak ada yang diisi otomatis.

## 0. Yang disetujui (ringkas)
Pekerjaan yang **sudah dibuat** dan meminta persetujuan retroaktif + izin lanjutan:
- Endpoint auth (`/api/auth/login`, `/auth/logout`, `/me`, `/me/password`), kebijakan password min 8, idle timeout token 30 menit.
- Service tulis: assignment, status akun, unit organisasi (tanpa endpoint HTTP).
- Guard database destruktif; tes PostgreSQL di `distriva_backend_test`; frontend auth.
Tidak termasuk: domain bisnis apa pun, permission key/grant (O-033), Policy, akses vendor, endpoint manajemen assignment, migrasi baru.
Dokumen pendukung: `docs/51-AUTH-API-FOUNDATION.md`, `docs/DRAFT-50-ENTRY-FOUNDATION-AUTH-ASSIGNMENT.md`, `test-evidence/2026-11-05-*.md`.

## 1. Langkah berurutan (doc 50 §1: proses bisnis → desain teknis → desain database → otorisasi)

### Langkah 1 — Tentukan siapa penyetuju
Doc 50 mewajibkan **otoritas yang terverifikasi**. Siapkan 4 peran (satu orang boleh merangkap hanya jika kewenangannya terbukti):
| Gate | Peran yang dibutuhkan | Bukti kewenangan |
|---|---|---|
| Proses bisnis | Pemilik proses akun/organisasi (mis. admin UP3 / pemilik sistem) | SK/penugasan atau surat delegasi |
| Desain teknis | Solution Architect + reviewer keamanan/otorisasi | Penugasan proyek |
| Desain database | Database Architect / DBA | Penugasan proyek |
| Otorisasi implementasi | Product/System owner | Surat penunjukan |
Catat: doc 50 melarang mengarang nama. Jika belum ada orangnya, tulis `PENDING` dan hentikan di sini.

### Langkah 2 — Isi §2 "Scope request" (bisa disalin dari draft)
| Field | Isi yang disarankan |
|---|---|
| Requested implementation scope | Lihat §0 di atas (daftar path di draft) |
| Explicit exclusions | Seluruh domain bisnis, O-033 grants, Policy, vendor, assignment HTTP endpoint, migrasi baru |
| Related issues / owner decision IDs | O-031 (guard `web`, parsial); tidak ada isu BLOCKING yang disentuh |
| Baseline design | Docs 22, 32, 33, 34 (T4.2.1) + docs 51 |
| Requested environment | Lokal/dev: `distriva_backend_test` (destruktif boleh), `distriva_db` (hanya `php artisan migrate` non-destruktif, jika disetujui) |
| Target database identity | Nama DB saja, **tanpa kredensial** |
| Data classification | Data uji sintetis; tanpa data produksi |
| Window | Tanggal mulai–selesai, diisi penyetuju |
| Rollback | Revert kode; tidak ada migrasi baru; DB test dapat dibuat ulang; backup `distriva_db` sebelum `migrate` (lihat Langkah 5) |
| Backup/snapshot + restore test | Diisi DBA setelah backup dites |

### Langkah 3 — §3 Business process approval
Penyetuju bisnis menjawab: apakah aturan ini benar?
- Hanya akun status `ACTIVE` yang bisa login; pesan gagal login sama untuk semua sebab.
- Password min 8 karakter (instruksi owner 2026-11-05); token idle 30 menit.
- Perubahan assignment/status akun/unit wajib alasan, tercatat append-only, actor tidak boleh mengubah statusnya sendiri.
- Kode unit tidak dapat diubah (menunggu O-030).
Isi: nama, jabatan, bukti delegasi, unit, tanggal, rationale, nomor referensi. **Tanda tangan oleh yang bersangkutan.**

### Langkah 4 — §4 Technical design approval
Reviewer memeriksa: `docs/51`, kode di `backend/app` dan `frontend/src`, hasil test (66 backend / 8 frontend), keputusan Sanctum bearer, `user_role_assignments` sebagai satu-satunya sumber assignment, vendor deny-all. Isi reviewer, tanggal, bukti, referensi tanda tangan.

### Langkah 5 — §5 Database design approval
DBA memeriksa 11 migrasi T4.2.1 yang sudah ada dan hasil test integritas/konkurensi PostgreSQL. **Sebelum `migrate` ke `distriva_db` (opsional):**
1. Backup: `pg_dump -Fc distriva_db > distriva_db_$(date +%F).dump` (simpan di luar repo).
2. Uji restore ke database sementara, catat hasilnya.
3. Tulis di doc 50 bahwa operasi yang diizinkan hanya `migrate` (bukan `fresh`/`wipe`; guard kode juga menolaknya).
4. `btree_gist` di `distriva_db` sudah terpasang (disetujui sebelumnya).

### Langkah 6 — §6 Implementation authorization
Otorisator mengisi: scope + exclusions, rujukan tiga gate di atas, environment + pemilik, **operasi yang diizinkan** (read/test/migrate/seed), produksi = **TIDAK diotorisasi**, window, bukti backup/restore, langkah rollback + operator, kriteria penerimaan (test lulus: 66 backend, 8 frontend), nama/jabatan/unit, bukti delegasi, tanggal/tanda tangan.

### Langkah 7 — Catat di register dan perbarui status
- Isi `Approval record ID` (format bebas, mis. `APR-2026-001`) dan ubah status tiap gate dari `PENDING` ke `APPROVED` atau `REJECTED`.
- Jangan menghapus entri lama; revisi tercatat sebagai entri baru (doc 50 §8).
- Ubah §7 "Current gate disposition" hanya untuk scope ini; domain lain tetap `BLOCKED`.

## 2. Hal yang TIDAK boleh dilakukan
Mengisi nama/tanda tangan atas nama orang lain; memakai persetujuan ini untuk domain lain; memasukkan password/token/connection string di register; menganggap persetujuan ini sebagai izin produksi.

## 3. Setelah tanda tangan
Beri tahu pengembang: (a) nomor record, (b) operasi DB yang diizinkan. Baru setelah itu `migrate` ke `distriva_db` dan uji UI di browser dapat dilakukan.

## 4. Agenda owner berikutnya (paralel, tidak menunggu tanda tangan di atas)
Gunakan `docs/46-OWNER-DECISION-APPROVAL-PACK.md`. Urutan: O-039 → O-029 → O-036/O-038 → O-041 → O-034 → O-033 → O-037; data resmi O-001–O-016. Catat tiap keputusan di `docs/44-OWNER-DECISION-REGISTER.md` dengan penyetuju, tanggal, dan bukti.
