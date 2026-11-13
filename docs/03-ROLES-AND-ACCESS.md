# 03 — Roles and Access

## 1. Prinsip akses

DISTRIVA menggunakan RBAC + organizational scope. Role menentukan tindakan yang dapat dilakukan; `user_role_assignments` menentukan role tersebut berlaku pada unit mana dan selama kapan. Seluruh pemeriksaan dilakukan di backend melalui service/policy. Hak akses tidak boleh ditentukan hanya dari menu frontend.

## 2. Katalog role final

| Role | Lingkup penugasan | Tanggung jawab utama |
|---|---|---|
| `SYS_ADMIN` | Global; unit boleh NULL | Administrasi sistem dan konfigurasi global. **Keputusan pemilik 6 Nov 2026: role penuh** — memegang seluruh key master data termasuk persetujuan (pemisahan pembuat ≠ penyetuju tetap berlaku). **Wajib MFA (TOTP)**: token SYS_ADMIN tidak dapat memakai endpoint apa pun selain alur MFA sampai diverifikasi |
| `UP3_ADMIN` | UP3 | Administrasi pengguna/config dalam UP3 sesuai delegasi; bukan approver otomatis |
| `UP3_MANAGER` | UP3 | Pejabat manajerial dan approval sesuai matriks |
| `NIAGA_RETAIL` | UP3/ULP sesuai penugasan | Administrasi PB/PD dan data niaga |
| `TEKNIK` | UP3/ULP sesuai penugasan | Survei, gambar, dan tugas teknis yang diberikan |
| `ENGINEERING` | UP3 | Tim engineering/review teknis; berbeda dari pejabat Asman |
| `PERENCANAAN` | UP3 | Kajian kelayakan, perencanaan, RKM |
| `KONSTRUKSI_UP3` | UP3 | Operasional konstruksi dan koordinasi material melalui aplikasi eksternal |
| `VENDOR` | Unit wajib pada assignment, ditambah vendor company dan proyek/WO yang ditugaskan | Melihat dan memperbarui pekerjaan yang ditugaskan saja |
| `VIEWER` | UP3/ULP sesuai penugasan | Akses baca sesuai scope |
| `MANAGER_ULP` | ULP | Manajemen ULP dan persetujuan awal sesuai matriks |
| `ASMAN_PERENCANAAN` | UP3 | Review/approval perencanaan dan kelayakan sesuai kewenangan |
| `ASMAN_NIAGA` | UP3 | Review/approval niaga sesuai kewenangan |
| `ASMAN_KONSTRUKSI` | UP3 | Review/approval konstruksi dan WO sesuai kewenangan |

`KONSTRUKSI_ULP` tidak digunakan. `ASMAN_TEKNIK` telah diganti `ASMAN_KONSTRUKSI`. `ENGINEERING` tetap merupakan role terpisah. Role `VENDOR` perlu pemetaan scope khusus karena aksesnya dibatasi ke perusahaan/proyek yang ditugaskan; assignment unit saja tidak menggantikan relasi vendor dan proyek.

## 3. Model implementasi role — Opsi A disetujui

- `roles` dan `permissions` adalah katalog Spatie Laravel Permission.
- `role_has_permissions` menghubungkan role ke permission.
- `user_role_assignments` adalah **sumber kebenaran tunggal** penugasan role pengguna. Kolom intinya: UUID `id`, `user_id`, BIGINT `role_id`, nullable UUID `organizational_unit_id`, `valid_from`, nullable `valid_until`, `is_active`, nullable `assigned_by`, `assignment_document`, timestamps.
- `model_has_roles` tidak digunakan untuk otorisasi DISTRIVA; jangan membuat alur penugasan kedua yang dapat berbeda dari `user_role_assignments`.
- Permission dihitung dari role pada assignment yang efektif. Custom `ScopedAuthorizationService` dan Laravel Policies memeriksa permission serta organizational scope.
- `roles.requires_unit_scope=false` hanya untuk `SYS_ADMIN`; 13 role lainnya wajib mempunyai unit. Pemeriksaan dilakukan server-side dan diperkuat constraint/trigger.
- Assignment lama dinonaktifkan/diakhiri masa berlakunya, tidak dihapus. Penugasan baru dibuat sebagai record baru.
- Jangan memasang `HasRoles` pada User atau menggunakan `assignRole`, `syncRoles`, direct-permission API, Spatie Teams, user pivots, atau default package permission resolver untuk assignment/otorisasi. `register_permission_check_method` dinonaktifkan; Policy memakai service DISTRIVA. Rincian integrasi ada di `22-T4.2.1-FOUNDATION-SCHEMA.md` dan `32-T4.2.1-DESIGN-REVIEW.md`.

## 4. Definisi assignment efektif

Assignment dapat digunakan jika:
1. `is_active = true`;
2. tanggal saat ini >= `valid_from`;
3. `valid_until IS NULL` atau tanggal saat ini <= `valid_until`;
4. akun user berstatus `ACTIVE`;
5. unit masih aktif jika role mensyaratkan unit;
6. role dan permission masih aktif/tersedia.

Satu pengguna dapat memiliki multi-role dan multi-unit. Rentang assignment untuk kombinasi user-role-unit tidak boleh overlap. Untuk global assignment (unit NULL), overlap dicegah secara terpisah. Validasi aplikasi dan constraint PostgreSQL harus konsisten.

## 5. Organizational scope

- UP3 dan ULP disimpan dalam satu tabel hierarkis `organizational_units`.
- UP3 memiliki `parent_id=NULL`; ULP menunjuk parent UP3.
- Pengguna ULP hanya mengakses ULP yang menjadi scope assignment, kecuali ada kewenangan lintas unit yang eksplisit.
- Pengguna UP3 dapat melihat konsolidasi unit di bawah UP3 sesuai role/permission dan matriks kewenangan; tidak otomatis memperoleh semua tindakan approval.
- Default pemeriksaan target adalah unit assignment yang sama. Akses baca UP3 ke ULP anak harus diminta eksplisit oleh Policy; akses mutasi/approval tidak diwariskan oleh hierarki.
- Penugasan lintas unit harus eksplisit dan diaudit.
- `SYS_ADMIN` tanpa unit memegang seluruh key yang diberikan di katalog (master data penuh sejak 6 Nov 2026); key domain bisnis berikutnya diberikan eksplisit per iterasi, selalu di balik MFA.
- Scope vendor memerlukan unit pada assignment operasional, lalu dibatasi lagi pada vendor company dan proyek/WO yang ditugaskan. Kecocokan unit saja tidak cukup.

## 6. Contoh permission

- `applications.view`, `applications.create`, `applications.update`, `applications.submit`
- `surveys.create`, `drawings.upload`, `drawings.revise`, `drawings.review`
- `calculations.run`, `calculations.view`, `calculations.export`
- `applications.review`, `applications.return`, `applications.approve`
- `vendors.assign`, `work_orders.manage`, `work_progress.update`
- `documents.view`, `documents.upload`, `documents.submit_review`, `documents.review`, `documents.approve`, `documents.download`
- `forecast.run`, `forecast.view`, `rkm.prepare`, `rkm.validate`, `rkm.approve`
- `users.manage`, `roles.assign`, `configuration.manage` sesuai lingkup dan approval

Daftar ini adalah contoh historis permission key konseptual, bukan permission catalog atau role grant. Hindari mengimplementasikan key generik seperti `work_orders.manage`, `applications.approve`, atau `rkm.approve` sebelum pemetaan granular v3.7.0 di `34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md` disetujui. Tidak ada permission key yang difinalkan/di-seed pada T4.2.1.2A.

## 7. Separation of duties

- Pembuat usulan RKM tidak otomatis menjadi satu-satunya penyetuju.
- Approval gambar, approval kelayakan, approval WO, dan approval RKM adalah proses berbeda.
- UP3_ADMIN tidak otomatis memiliki kewenangan approval bisnis. SYS_ADMIN memegang key approval yang diberikan eksplisit (keputusan 6 Nov 2026), tidak pernah atas draf buatannya sendiri.
- Pemeriksaan separation of duties dilakukan pada service approval, bukan hanya role menu.
- Keputusan desain v3.7.0: seluruh approver pada langkah AND harus merupakan user berbeda; submitter tidak boleh menjadi final approver atas versinya sendiri. Submitter progres dan verifier wajib user berbeda. Pemeriksaan dilakukan berdasarkan user ID, bukan hanya role.
- Fungsi Pengawas Jaringan berada pada `KONSTRUKSI_UP3` untuk verifikasi progres dan inspeksi WO child-ULP yang spesifik; bukan role baru dan bukan akses descendant read/mutation umum. Implementasi khusus ini belum tersedia.

## 8. Audit dan keamanan

Setiap perubahan assignment mencatat aktor, role/unit pemberi, waktu, alasan, referensi dokumen, nilai sebelum/sesudah, dan status di `user_role_assignment_histories`. Perubahan role-permission serta status akun dicatat di `authorization_change_histories`; perubahan organisasi di `organizational_unit_histories`. Cache permission katalog Spatie dan scope DISTRIVA harus dibersihkan saat ada perubahan relevan. Password, OTP, token, dan credential tidak boleh masuk audit log.

## 9. Status

Desain T4.2.1 telah disetujui dan baseline schema/model/seeder tersedia di `backend/`; migration up/down, RoleSeeder idempotency, serta integrity smoke tests PASS pada PostgreSQL disposable. Semua tabel aplikasi telah di-rollback setelah pengujian.

Fondasi `ScopedAuthorizationService`, model/relasi `OrganizationalUnit` dan `UserRoleAssignment`, pemilihan tanggal bisnis `Asia/Jakarta`, pemeriksaan katalog permission Spatie, scope unit eksak, dan mode eksplisit read-only UP3→ULP telah diimplementasikan dan memiliki unit tests. Assignment tetap dibaca hanya dari `user_role_assignments`. `SYS_ADMIN` global terbatas pada konteks system; vendor fail-closed sampai relasi vendor-company/project/WO tersedia.

Authorization belum siap produksi: Policy dan pemanggil service belum dibuat; query assignment belum diuji melalui PostgreSQL setelah implementasi; vendor resolver konkret, assignment/unit write services, audit write path, permission keys final, cache invalidation, concurrency, dan Sanctum UUID end-to-end masih pending. Tidak ada migration atau koneksi database baru untuk perubahan v3.5.0. Detail ada di `33-T4.2.1.1-SCOPED-AUTHORIZATION.md`.

### T4.2.1.2A status (v3.7.0)

Setiap pemegang assignment efektif `KONSTRUKSI_UP3` pada UP3 terkait dapat melakukan verifikasi progres dan inspeksi seluruh WO child-ULP tanpa assignment tambahan per WO/task; scope khusus ini bukan `UP3_DESCENDANT_READ` dan belum diimplementasikan. RKM validator/final approver direction telah dipilih, tetapi role pengusul ULP belum diputuskan. Permission key/grants tetap kandidat dan tidak boleh di-seed. Lihat dokumen 34 dan O-033–O-042.

### T4.2.1.2 — Matrix desain Policy dan resource scope (v3.6.0)

Pemilik menyetujui matrix sebagai **baseline desain**, bukan persetujuan permission key final atau implementasi. Role kandidat mengikuti workflow terdokumentasi; role/action yang belum ditentukan tetap ditandai terbuka. Tidak ada permission key baru atau seeder. Detail per-resource, scope, dan dependency ada di `34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md`.
