# 54 — Draf Kontrak O-033 (Scope Foundation Administration)

**Tanggal:** 6 November 2026
**Status:** keputusan D-1…D-8 `DECIDED` pada 6 November 2026 (pemilik proyek memilih seluruh rekomendasi; lihat §6a). Isi kontrak §2–§5 berlaku untuk scope foundation administration. Implementasi bertahap mengikuti §8 — lihat `docs/55`.
**Cakupan:** hanya aksi administrasi fondasi (user, assignment, status akun, unit organisasi). Domain bisnis (aplikasi, WO, RKM, RAB/KKF, dst.) dan vendor **di luar** dokumen ini; O-033 untuk domain tersebut tetap `OPEN/BLOCKING`.
**Dasar:** doc 03 (role & scope), doc 16 (keputusan final), doc 34 §10.10 (kandidat key `users.*`, `role_assignments.*`), doc 46 (OD-033), doc 53 (alur kerja). Kode yang sudah ada: `AssignmentWriteService`, `AccountStatusService`, `OrganizationalUnitWriteService`, `ScopedAuthorizationService`.

---

## 1. Selisih antara implementasi saat ini dan keputusan final (doc 16) — perlu perhatian dahulu

Saat menyusun draf ini ditemukan bahwa beberapa keputusan final di doc 16 (bagian keamanan akun) **belum** atau **berbeda** dengan yang sudah diimplementasikan:

| # | Keputusan final doc 16 | Implementasi saat ini | Selisih |
|---|---|---|---|
| G-1 | Password minimal 8 karakter **dengan** huruf besar, huruf kecil, angka, simbol; tidak boleh memakai 5 password terakhir; tolak password umum/terbocorkan | Hanya minimal 8 karakter (instruksi pemilik proyek 6 Nov 2026: "standar saja") | **SELESAI 6 Nov 2026:** diterapkan sesuai doc 16 (kompleksitas, riwayat 5, daftar password umum, larangan memuat nama/email). Pengecekan terbocorkan (HIBP) tersedia tetapi nonaktif default. |
| G-2 | Login gagal maks 5 kali → akun dikunci 15 menit; CAPTCHA setelah beberapa kegagalan | **Lockout diimplementasikan 6 Nov 2026** (kolom `failed_login_attempts`, `locked_until`; 5 gagal → kunci 15 menit; respons 401 identik; reset saat sukses atau saat admin mengubah status). Throttle per IP tetap ada. **CAPTCHA belum ada** (butuh penyedia). | Lockout SESUAI; CAPTCHA BELUM ADA. |
| G-3 | Idle timeout default 30 menit, dapat dikonfigurasi | Idle timeout 30 menit, dikonfigurasi lewat env | Sesuai. |
| G-4 | MFA wajib untuk `SYS_ADMIN`, direkomendasikan untuk admin/pejabat | Tidak ada MFA | **BELUM ADA.** Menahan semua aksi tulis `SYS_ADMIN` (lihat §5). |
| G-5 | Password awal acak, sekali pakai, dikirim email/WhatsApp, kedaluwarsa 24 jam, wajib ganti saat login pertama | **DIGANTI oleh keputusan pemilik 6 Nov 2026** (docs/18): aktivasi awal dengan OTP email/WhatsApp, tanpa password dari administrator. Diimplementasikan: akun `PENDING_ACTIVATION`, undangan, OTP, kirim ulang undangan (docs/55, docs/56). Password bootstrap admin pertama tetap dari konsol. | SESUAI keputusan terbaru. |
| G-6 | Recovery via OTP email/WhatsApp; reset mengakhiri sesi aktif | **Diimplementasikan 6 Nov 2026** (`/aktivasi`, `/pemulihan`; membuka akun terkunci; mengakhiri semua sesi). | SESUAI. |
| G-7 | Mutasi staf oleh `UP3_ADMIN` berdasar dokumen mutasi/penugasan, tanpa approval `UP3_MANAGER`; assignment lama diakhiri, baru dibuat; Plt didukung dengan tanggal mulai/akhir | `assign`/`revoke` mendukung tanggal; dokumen penugasan opsional | Sesuai sebagian: dokumen belum diwajibkan di lapisan API. |

**D-1 sudah diputuskan: ikuti doc 16.** (Pertanyaan semula: password policy G-1 — pakai doc 16 (kompleksitas + riwayat 5 + daftar password umum) atau catat keputusan baru "hanya minimal 8" yang menggantikannya? Rekomendasi: ikuti doc 16 karena instruksi "standar" dapat dibaca sebagai merujuk ke standar yang sudah ditetapkan; jika ingin tetap longgar, catat sebagai keputusan baru beserta alasannya.

---

## 2. Usulan katalog key (granular, guard `web`)

Mengikuti pilihan A di doc 46 (aksi granular). Nama mengikuti kandidat doc 34 §10.10; yang bertanda ★ adalah **tambahan baru** yang tidak ada di doc 34.

| Key | Aksi | Service yang dipanggil |
|---|---|---|
| `users.view` | Lihat daftar/detail user dalam scope | (baca) |
| `users.create` | Buat user baru (menunggu G-5) | belum ada |
| `users.update` | Ubah data profil user (nama, NIP, telepon) | belum ada ★ (service belum dibuat) |
| `users.change_status` ★ | Aktifkan / suspend / nonaktifkan akun | `AccountStatusService::change` |
| `role_assignments.view` ★ | Lihat assignment dan riwayatnya dalam scope | (baca) |
| `role_assignments.assign` | Buat assignment baru | `AssignmentWriteService::assign` |
| `role_assignments.end` | Akhiri assignment | `AssignmentWriteService::revoke` |
| `organizational_units.view` ★ | Lihat struktur UP3/ULP | (baca) |
| `organizational_units.create` ★ | Buat UP3/ULP | `OrganizationalUnitWriteService::create` |
| `organizational_units.update` ★ | Ubah nama/alamat/status aktif unit | `OrganizationalUnitWriteService::update` |
| `authorization_history.view` ★ | Lihat histori audit otorisasi | (baca) |

Catatan: doc 34 memakai `users.deactivate`; draf ini mengganti dengan `users.change_status` karena service menangani aktivasi, suspend, dan nonaktif sekaligus. Jika pemilik ingin memisahkan, pecah menjadi `users.suspend` / `users.deactivate` / `users.activate`.

## 3. Usulan grant (kandidat — bukan grant)

| Key | `UP3_ADMIN` | `SYS_ADMIN` | Role lain |
|---|---|---|---|
| `users.view` | ✔ scope UP3-nya | ✔ SYSTEM | — |
| `users.create` | ✔ (menunggu G-5) | ✔ (menunggu G-4, G-5) | — |
| `users.update` | ✔ | ✔ | — |
| `users.change_status` | ✔ (bukan akun sendiri) | ✔ (bukan akun sendiri) | — |
| `role_assignments.view/assign/end` | ✔ terbatas (§4) | ✔ hanya role sistem (opsi D-3) | — |
| `organizational_units.view` | ✔ | ✔ | `VIEWER`/lainnya: TBD |
| `organizational_units.create/update` | ✘ (opsi D-4) | ✔ | — |
| `authorization_history.view` | ✔ scope UP3-nya | ✔ | — |

Tidak ada role bisnis (`UP3_MANAGER`, `TEKNIK`, dst.) yang mendapat key administrasi. Sesuai doc 34 butir 55: tidak ada hak bisnis otomatis untuk `SYS_ADMIN`/`UP3_ADMIN`, dan sebaliknya.

## 4. Aturan scope dan pembatasan (usulan)

1. **Scope administrasi `UP3_ADMIN`:** assignment target harus berada di UP3 tempat `UP3_ADMIN` itu punya assignment efektif, atau di ULP anak UP3 tersebut. Mode ini **bukan** `UP3_DESCENDANT_READ` (hanya baca). Perlu mode scope baru khusus aksi administrasi (mis. `UP3_ADMIN_DELEGATION`), diterapkan hanya pada key di §2. Mode ini belum ada di `ScopedAuthorizationService`.
2. **Unit target diambil dari data tersimpan**, bukan dari request. Unit nonaktif ditolak.
3. **Anti-eskalasi:** `UP3_ADMIN` tidak boleh memberi `SYS_ADMIN`; tidak boleh memberi `UP3_ADMIN` di luar UP3-nya; tidak boleh memberi `VENDOR` (deny-all menunggu O-029).
4. **Anti-self-service:** actor tidak boleh meng-assign, mengakhiri, atau mengubah status untuk dirinya sendiri (sudah ada untuk status; assignment perlu ditambah).
5. **Perlindungan admin terakhir:** tidak boleh mengakhiri/menonaktifkan assignment atau akun terakhir yang efektif untuk `SYS_ADMIN` (global) dan `UP3_ADMIN` per UP3.
6. **Dokumen penugasan wajib** untuk `role_assignments.assign` oleh `UP3_ADMIN` (referensi `assignment_document`), sesuai doc 16. Alasan (`reason`) wajib untuk semua aksi (sudah ditegakkan service).
7. **Scope diterapkan sebelum** pagination, sorting, count, dan agregasi pada semua endpoint daftar.
8. **Actor harus akun ACTIVE** dan assignment actor efektif (sudah dicek pada service; assignment actor perlu diverifikasi efektif pada lapisan Policy).
9. **Aksi tulis `SYS_ADMIN` memerlukan MFA** (G-4). Sampai MFA ada, aksi tulis `SYS_ADMIN` tetap tidak diekspos.
10. Tidak ada operasi hapus (hard delete) user/assignment/unit; riwayat bersifat append-only.

## 5. Kontrak API (usulan, belum dibuat)

Semua di bawah `auth:sanctum` + `EnsureActiveAccount` + Policy yang memanggil `ScopedAuthorizationService`. Respons memakai allowlist field.

| Endpoint | Key | Catatan |
|---|---|---|
| `GET /api/users` | `users.view` | Scope SQL sebelum paginate; filter status/unit |
| `GET /api/users/{id}` | `users.view` | |
| `POST /api/users` | `users.create` | Menunggu G-5 (password awal) |
| `PATCH /api/users/{id}` | `users.update` | Service baru |
| `POST /api/users/{id}/status` | `users.change_status` | body: `status`, `reason` |
| `GET /api/users/{id}/assignments` | `role_assignments.view` | |
| `POST /api/role-assignments` | `role_assignments.assign` | body: `user_id`, `role_id`, `organizational_unit_id`, `valid_from`, `valid_until`, `reason`, `assignment_document` |
| `POST /api/role-assignments/{id}/end` | `role_assignments.end` | body: `reason` |
| `GET /api/organizational-units` | `organizational_units.view` | |
| `POST /api/organizational-units` | `organizational_units.create` | |
| `PATCH /api/organizational-units/{id}` | `organizational_units.update` | Kode/tipe/parent tidak dapat diubah (O-030) |
| `GET /api/authorization-history` | `authorization_history.view` | Hanya baca |

Kode error: 401 tidak terautentikasi; 403 tidak berwenang atau di luar scope; 404 untuk resource di luar scope (hindari membocorkan keberadaan); 409 pelanggaran aturan domain (overlap, hierarki); 422 validasi.

## 6. Keputusan yang dibutuhkan

| ID | Pertanyaan | Opsi | Rekomendasi | Yang tertahan jika belum diputuskan |
|---|---|---|---|---|
| D-1 | Password policy (G-1) | A: ikuti doc 16; B: hanya min 8 (keputusan baru yang menggantikan) | A | Tidak menahan endpoint lain; menentukan validasi |
| D-2 | Daftar key & nama (§2), termasuk `users.change_status` vs pecah tiga | A: seperti §2; B: pecah | A | Seeder katalog |
| D-3 | Siapa meng-assign `UP3_ADMIN` pertama dan `SYS_ADMIN`? | A: `SYS_ADMIN` boleh assign role sistem (`SYS_ADMIN`, `UP3_ADMIN`) saja; B: lewat seeder/CLI terkontrol saja | A (setelah MFA) | Bootstrap admin |
| D-4 | Opsi A — `SYS_ADMIN` membuat/mengubah unit | Endpoint tulis unit tertahan MFA. **Konfirmasi pemilik 6 Nov 2026: tetap opsi A.** Kode yang sempat memberi `organizational_units.create/update` juga kepada `UP3_ADMIN` (ditambahkan di luar sesi Claude Code) dikembalikan: kedua key kini hanya untuk `SYS_ADMIN`; endpoint dipertahankan sebagai jalur SYS_ADMIN dan tetap 403 sampai MFA tersedia. |
| D-5 | Batas scope `UP3_ADMIN` (§4.1) dan mode scope baru | A: UP3 sendiri + ULP anak (mutasi); B: UP3 sendiri saja | A | Policy & query scope |
| D-6 | Lockout akun G-2 dan MFA G-4, password awal G-5 | Dijadwalkan sebagai pekerjaan fondasi terpisah | G-2 lockout SELESAI; lanjut MFA / CAPTCHA | G-4 menahan `SYS_ADMIN` tulis; G-5 menahan `users.create` |
| D-7 | Kanal pengiriman password awal/OTP (email, WhatsApp) | Perlu penyedia dan kontrak | — | `users.create`, recovery |
| D-8 | Perlindungan admin terakhir (§4.5) | A: wajib; B: tidak | A | Service assignment/status |

## 6a. Keputusan (6 November 2026)

Pemilik proyek menyatakan: jalankan sesuai rekomendasi di dokumen ini; untuk D-7 gunakan email dan WhatsApp, mana yang tersedia.

| ID | Keputusan | Catatan |
|---|---|---|
| D-1 | Ikuti doc 16 | Diterapkan (password policy). |
| D-2 | Opsi A — katalog key seperti §2, `users.change_status` tidak dipecah | |
| D-3 | Opsi A — `SYS_ADMIN` boleh assign role sistem (`SYS_ADMIN`, `UP3_ADMIN`) saja, **setelah MFA tersedia** | Sampai MFA ada, aksi tulis `SYS_ADMIN` tidak diekspos. |
| D-4 | Opsi A — `SYS_ADMIN` membuat/mengubah unit | Endpoint tulis unit ikut tertahan MFA. **⚠ 6 Nov 2026:** kode di repo kini juga memberi `UP3_ADMIN` hak membuat/mengubah **ULP** (ditambahkan di luar sesi Claude Code) — penyimpangan dari D-4 yang menunggu konfirmasi pemilik; lihat AI-HANDOFF dan docs/57. |
| D-5 | Opsi A — `UP3_ADMIN` mencakup UP3 sendiri + ULP anak; mode scope baru khusus administrasi | |
| D-6 | Lockout selesai; berikutnya MFA, lalu CAPTCHA | |
| D-7 | **Email dan WhatsApp — gunakan keduanya, mana yang tersedia.** Pengiriman memakai semua kanal yang terkonfigurasi; kegagalan satu kanal tidak menggagalkan kanal lain; minimal satu kanal harus berhasil. Lapisan pengiriman sudah ada (`docs/56`). WhatsApp: penyedia API **non-resmi** (keputusan pemilik 6 Nov 2026; driver HTTP generik). Email: penyedia/SMTP belum dikonfigurasi. | Pengiriman nyata untuk `users.create`, password awal, OTP recovery menunggu penyedia. |
| D-8 | Opsi A — perlindungan admin terakhir wajib | |

## 7. Pengujian yang wajib saat diimplementasikan

Cross-UP3 (admin UP3-A tidak dapat menyentuh UP3-B); unit pada request dipalsukan; assignment actor kedaluwarsa/nonaktif; `UP3_ADMIN` memberi `SYS_ADMIN`/`VENDOR` (ditolak); self-assign; admin terakhir; `SYS_ADMIN` tanpa MFA (ditolak); daftar user tidak membocorkan jumlah/total di luar scope; 404 untuk resource di luar scope; riwayat append-only; reason/dokumen wajib; role tanpa grant tidak berwenang walau punya nama role; guard bukan `web`.

## 8. Urutan implementasi setelah keputusan (usulan)

1. Catat keputusan D-1…D-8 di doc 15/44.
2. ~~Lockout akun (G-2)~~ — selesai 6 Nov 2026 (migration `2026_11_06_090000`, belum dijalankan pada `distriva_db`).
3. Mode scope administrasi + Policy + query scope (tanpa endpoint tulis dulu), dengan test negatif lengkap.
4. Seed katalog key & grant hanya untuk baris yang disetujui.
5. Endpoint baca, lalu endpoint tulis, satu per satu dengan test.
6. MFA, lalu buka aksi tulis `SYS_ADMIN`; password awal & recovery setelah kanal pengiriman diputuskan.
