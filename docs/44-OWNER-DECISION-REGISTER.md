> **Catatan tata kelola v3.16.0 — dokumen historis/referensi:** Dokumen ini dipertahankan untuk menjaga jejak analisis dan audit pada saat penyusunannya. Persyaratan nama asli, verifikasi kewenangan formal, tanda tangan, SK/surat tugas, serta urutan gate administratif di dalamnya tidak berlaku sebagai prasyarat pengembangan internal DISTRIVA. Gunakan `docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md` sebagai panduan aktif. Status issue dan temuan teknis substantif dalam dokumen ini tidak otomatis berubah; verifikasi kembali relevansinya terhadap modul yang sedang dikerjakan.

---

# 44 — OWNER DECISION REGISTER
**Project:** DISTRIVA — Distribution Management Platform  
**Documentation checkpoint:** v3.14.0 (owner-input capture; formal authority evidence pending)
**Tanggal penyusunan:** 5 November 2026  
**Status:** `DRAFT — MENUNGGU KEPUTUSAN PEMILIK PROSES`  
**Tujuan:** Mencatat keputusan pemilik proses untuk menutup isu aktor, kewenangan, relasi, approval, dan lifecycle sebelum desain O-034 difinalisasi dan implementasi domain dimulai.

---

## 1. Petunjuk penggunaan

Dokumen ini disusun dari hasil diskusi dan dokumen analisis `docs/38` sampai `docs/43`, serta keputusan bisnis/teknis yang sudah tercatat sebelumnya.

**Aturan pengisian:**

1. Bagian **A — Keputusan yang sudah memiliki dasar keputusan** mencatat keputusan yang sudah berlaku pada sumber otoritatif. Kolom konfirmasi `PENDING` hanya berarti pemilik belum mengisi konfirmasi pada register ini; itu tidak membatalkan atau menurunkan status keputusan terdahulu.
2. Bagian **B — Keputusan yang masih terbuka** wajib diputuskan oleh pemilik proses yang berwenang. Pilih satu opsi atau tuliskan opsi lain beserta alasannya.
3. `PROPOSED` atau rekomendasi dari dokumen analisis bukan keputusan yang disetujui.
4. Setiap keputusan baru harus memiliki nama/jabatan pemberi keputusan, unit, tanggal, alasan, dan bukti pendukung (notulen, SOP, surat keputusan, atau referensi resmi).
5. Jika belum diputuskan, tulis `PENDING`; jangan mengisi berdasarkan asumsi tim pengembang.
6. Keputusan yang berdampak pada skema harus diperiksa terhadap kontrak T4.2.1–T4.2.4 sebelum O-034 dinyatakan final.

### Format pencatatan keputusan

| Field | Isi |
|---|---|
| ID keputusan | Contoh: `OD-036-01` |
| Issue terkait | O-036 / O-038 / O-039 / O-041 / dependency |
| Keputusan | Pilihan final atau `PENDING` |
| Pemilik keputusan | Nama dan jabatan |
| Unit | ULP / UP3 / lainnya |
| Tanggal keputusan | YYYY-MM-DD |
| Alasan | Dasar proses/bisnis/operasional |
| Bukti | Notulen, SOP, surat, atau dokumen rujukan |
| Dampak | Proses, role, relasi, status, schema, authorization |
| Status | `PENDING` / `APPROVED` / `REJECTED` / `SUPERSEDED` |

---

## 2. A — Keputusan terdahulu yang dipertahankan

Bagian ini merupakan baseline dari diskusi dan keputusan yang telah tercatat. Pemilik proses diminta mengonfirmasi apakah masih berlaku.

| ID | Area | Keputusan/baseline | Status |
|---|---|---|---|
| OD-BASE-01 | Database | PostgreSQL digunakan sebagai database utama. | `EXISTING` |
| OD-BASE-02 | Assignment | `user_role_assignments` adalah satu-satunya sumber assignment user-role-unit; Spatie Permission hanya menjadi katalog role/permission. | `EXISTING` |
| OD-BASE-03 | Role | Tidak membuat role baru `Pengawas Jaringan`. | `EXISTING` |
| OD-BASE-04 | RKM | ULP mengusulkan RKM; `PERENCANAAN` dan `KONSTRUKSI_UP3` melakukan validasi oleh dua user berbeda; `UP3_MANAGER` menjadi final approver. | `EXISTING` |
| OD-BASE-05 | RKM SoD | Pengusul/submitter tidak boleh menjadi final approver untuk versi yang sama. Persetujuan RKM tidak otomatis membuat PO atau memulai procurement. | `EXISTING` |
| OD-BASE-06 | Application | `NIAGA_RETAIL` menginput/melengkapi aplikasi; nomor telepon wajib tersedia sebelum submit. | `EXISTING` |
| OD-BASE-07 | Drawing | `MANAGER_ULP` menjadi gate pengajuan paket gambar. Keputusan ini tidak otomatis menjadikan `MANAGER_ULP` sebagai application reviewer atau RKM proposer. | `EXISTING` |
| OD-BASE-08 | Survey/meter | Survey wajib. Drawing/feasibility bersifat kondisional. Verifikasi meter merupakan prasyarat sebelum application berstatus `COMPLETED`. | `EXISTING` |
| OD-BASE-09 | Work Order | Arah desain saat ini: satu application/pekerjaan PB/PD menghasilkan satu WO aktif; WO memuat paket/tugas/material dari input yang telah disetujui. Detail cardinality historis tetap perlu diputuskan. | `EXISTING — DETAIL OPEN` |
| OD-BASE-10 | Vendor | `KONSTRUKSI_UP3` memilih vendor; `ASMAN_KONSTRUKSI` menyetujui/menolak vendor assignment. Ini bukan approval atau penerbitan WO. | `EXISTING` |
| OD-BASE-11 | Vendor access | Akses vendor tetap deny-all sampai relasi account, company, project, approved assignment, dan WO tersimpan serta tervalidasi. | `EXISTING` |
| OD-BASE-12 | Progress | Submitter progress dan verifier harus merupakan user berbeda. | `EXISTING` |
| OD-BASE-13 | Child-ULP WO | Setiap pemegang assignment `KONSTRUKSI_UP3` yang efektif pada UP3 terkait dapat melakukan tindakan verify progress/inspect untuk WO ULP di bawah UP3 tersebut melalui scope khusus per tindakan; bukan akses descendant-read umum dan tidak membutuhkan assignment WO/task tambahan. | `EXISTING` |
| OD-BASE-14 | Completion | `ASMAN_KONSTRUKSI` tercatat sebagai final completion approver. Pemisahan inspector dan final approver belum diputuskan. | `EXISTING — SoD OPEN` |
| OD-BASE-15 | KKF | KKF normal: `ASMAN_PERENCANAAN` AND `ASMAN_KONSTRUKSI`. PBP >5 tahun: `ASMAN_PERENCANAAN`, `ASMAN_NIAGA`, `ASMAN_KONSTRUKSI`, dan `UP3_MANAGER`; seluruh approver berbeda. `UP3_MANAGER` bukan approver KKF normal. | `EXISTING` |
| OD-BASE-16 | Approval SoD | Setiap approval AND harus dilakukan oleh user berbeda; submitter tidak boleh final-approve versinya sendiri. | `EXISTING` |
| OD-BASE-17 | Calculation history | Input, parameter, hasil, harga terpilih, dan versi master historis harus dapat direproduksi. Versi yang sudah disetujui bersifat immutable. | `EXISTING` |
| OD-BASE-18 | Report/export | Permission export terpisah per domain dan tetap mewarisi source scope. Scope SQL harus diterapkan sebelum pagination, sorting, count, agregasi, dan export. | `EXISTING` |
| OD-BASE-19 | Organizational scope | `SAME_UNIT` adalah default; akses UP3 ke ULP anak hanya untuk pembacaan eksplisit kecuali child-WO verify/inspect action-specific scope yang telah disetujui; `SYS_ADMIN` tidak mendapat akses bisnis otomatis. | `EXISTING` |
| OD-BASE-20 | RAB pricing/UOM | T4.2.2 mendukung jalur harga eksternal dan internal per-UP3; harga terpilih disnapshot. Prioritas/default pemilihan harga belum ditetapkan. `materials.unit` masih VARCHAR; UOM normalization/conversion belum ditetapkan. | `EXISTING — PRIORITY/UOM OPEN` |
| OD-BASE-21 | Vendor account | Master vendor dikelola pusat; satu akun login per perusahaan vendor; vendor nonaktif tidak menerima penugasan baru. Relasi/domain dan eligibility tetap menunggu O-029/O-039. | `EXISTING — RELATION OPEN` |

**Konfirmasi pemilik proses untuk Bagian A:**  
- Status konfirmasi: `PENDING`  
- Nama/jabatan:  
- Unit:  
- Tanggal:  
- Catatan perubahan (jika ada):  

---

## 3. B — Keputusan terbuka O-036: Application dan RKM proposer

**Status issue:** `PARTIAL / OPEN`

### OD-036-01 — Penanggung jawab review kelengkapan aplikasi

Pilih satu opsi:

- [ ] `PENDING` — belum diputuskan.
- [ ] Opsi A — review administrasi dilakukan oleh role/unit ULP yang ditetapkan pemilik proses.
- [ ] Opsi B — review administrasi dilakukan oleh role/unit UP3 yang ditetapkan pemilik proses.
- [ ] Opsi C — review bertahap: pemeriksaan awal ULP, kemudian pemeriksaan/validasi UP3.
- [ ] Opsi lain:  

**Pertanyaan yang wajib dijawab:**  
1. Role konkret yang melakukan review:  
2. Apakah review bersifat administratif saja atau mencakup aspek teknis?  
3. Siapa yang berwenang mengembalikan aplikasi untuk perbaikan?  
4. Siapa yang berwenang menolak aplikasi?  
5. Siapa yang menetapkan status final aplikasi sebelum proses berikutnya?

### OD-036-02 — Pemisahan application reviewer dan survey reviewer

- [ ] `PENDING`
- [ ] Boleh dilakukan user yang sama.
- [ ] Wajib dilakukan user berbeda.
- [ ] Boleh sama hanya pada kondisi tertentu (jelaskan):  

Alasan/ketentuan:  

### OD-036-03 — Role konkret ULP sebagai RKM preparer/proposer/submitter

- [ ] `PENDING`
- [ ] Satu role ULP menyiapkan sekaligus submit RKM.
- [ ] Role preparer dan submitter berbeda.
- [ ] Menggunakan pejabat/role yang ditunjuk melalui delegasi formal.
- [ ] Opsi lain:  

Isi keputusan:
- Role preparer:  
- Role submitter:  
- Apakah preparer dan submitter harus berbeda:  
- Delegasi/pengganti yang diizinkan:  
- Bukti kewenangan:  

**Catatan batas:** `MANAGER_ULP` sebagai gate submission drawing tidak boleh dianggap otomatis sebagai RKM proposer tanpa keputusan eksplisit.

---

## 4. B — Keputusan terbuka O-038: Survey dan pemasangan/verifikasi meter

**Status issue:** `OPEN`

### OD-038-01 — Aktor proses survey

Tentukan masing-masing aktor berikut. Gunakan role yang sudah ada atau tuliskan jabatan/otoritas formal; jangan membuat role baru tanpa persetujuan.

| Tanggung jawab | Role/jabatan yang diputuskan | Unit | Status |
|---|---|---|---|
| Menugaskan surveyor (assigner) |  |  | `PENDING` |
| Melaksanakan survey (surveyor) |  |  | `PENDING` |
| Memeriksa hasil survey (reviewer) |  |  | `PENDING` |
| Persetujuan formal hasil survey (approver), jika diperlukan |  |  | `PENDING` |
| Mengembalikan/menolak hasil survey |  |  | `PENDING` |

### OD-038-02 — Urutan dan persetujuan survey

- [ ] `PENDING`
- [ ] Survey cukup diverifikasi reviewer; tidak memerlukan formal approval.
- [ ] Survey wajib mendapat formal approval sebelum drawing/Auto MTO.
- [ ] Survey wajib mendapat formal approval hanya untuk kondisi tertentu:  

Apakah drawing atau Auto MTO boleh dimulai sebelum survey disetujui?  
Keputusan:  

### OD-038-03 — Segregation of Duties (SoD) survey

- [ ] `PENDING`
- [ ] Surveyor dan reviewer wajib berbeda.
- [ ] Surveyor, reviewer, dan approver wajib berbeda.
- [ ] Kombinasi lain:  

Pengecualian/delegasi dan alasan:  

### OD-038-04 — Aktor pemasangan dan verifikasi meter

| Tanggung jawab | Role/jabatan yang diputuskan | Unit | Status |
|---|---|---|---|
| Menugaskan pemasangan meter |  |  | `PENDING` |
| Melaksanakan pemasangan (installer) |  |  | `PENDING` |
| Mengirim bukti pemasangan |  |  | `PENDING` |
| Memverifikasi bukti/hasil pemasangan |  |  | `PENDING` |
| Menetapkan bahwa syarat completion terpenuhi |  |  | `PENDING` |

### OD-038-05 — Evidence dan cardinality pemasangan meter

Tentukan:
- Bukti minimum pemasangan (foto, nomor meter, nomor pelanggan, koordinat, tanggal, berita acara, atau lainnya):  
- Apakah satu application dapat memiliki lebih dari satu pemasangan meter:  
- Apakah satu WO dapat memuat beberapa meter:  
- Relasi meter dengan application dan WO:  
- Proses penggantian, pembatalan, atau rework meter:  
- Apakah verifikasi meter harus dilakukan user berbeda dari installer/evidence submitter:  

Semua jawaban: `PENDING` sampai disahkan pemilik proses.

---

## 5. B — Keputusan terbuka O-039: Work Order, vendor, progress, inspection, completion

**Status issue:** `OPEN / BLOCKING`

### OD-039-01 — Aktor pembuatan, review, dan penerbitan WO

| Tanggung jawab | Role/jabatan | Unit | Status |
|---|---|---|---|
| Membuat/draft WO (creator) |  |  | `PENDING` |
| Review teknis/administratif WO |  |  | `PENDING` |
| Menyetujui WO (jika approval terpisah diperlukan) |  |  | `PENDING` |
| Menerbitkan WO (issuer) |  |  | `PENDING` |
| Mengembalikan/menolak WO |  |  | `PENDING` |
| Membatalkan WO |  |  | `PENDING` |

Tentukan apakah WO memerlukan approval formal terpisah dari review sebelum diterbitkan:  

### OD-039-02 — Cardinality dan relasi historis

Baseline cardinality yang sudah tercatat: **satu application/pekerjaan PB/PD menghasilkan satu WO aktif** (`EXISTING`). Tidak ada perubahan owner yang tercatat.
Detail yang tetap perlu keputusan:
- Apakah satu application dapat memiliki beberapa WO historis setelah WO sebelumnya selesai/dibatalkan:  
- Apakah satu project dapat memiliki beberapa application:  
- Apakah satu vendor assignment dapat berlaku untuk beberapa WO:  
- Apakah pergantian vendor membuat assignment baru dan menonaktifkan assignment sebelumnya:  
- Aturan untuk WO pengganti/revisi:  

### OD-039-03 — Perubahan, amendment, return, hold, cancel

Tentukan aturan untuk setiap transisi:

| Kondisi | Siapa yang mengajukan | Siapa yang menyetujui | Dampak pada versi/WO aktif | Status |
|---|---|---|---|---|
| Return untuk perbaikan |  |  |  | `PENDING` |
| Reject |  |  |  | `PENDING` |
| Hold/suspend |  |  |  | `PENDING` |
| Resume |  |  |  | `PENDING` |
| Amendment/perubahan lingkup |  |  |  | `PENDING` |
| Cancel |  |  |  | `PENDING` |
| Rework |  |  |  | `PENDING` |

### OD-039-04 — Progress dan inspection

Konfirmasi:
- Progress dicatat kumulatif atau per periode/aktivitas:  
- Apakah progress yang sudah diverifikasi dapat direvisi; jika ya, bagaimana jejak revisinya:  
- Siapa yang melakukan inspection:  
- Apakah inspector wajib berbeda dari progress submitter:  
- Apakah inspector wajib berbeda dari final completion approver (`ASMAN_KONSTRUKSI`):  
- Scope child-ULP WO: baseline yang sudah diputuskan; setiap assignment efektif `KONSTRUKSI_UP3` pada UP3 terkait dapat verify progress/inspect child-ULP WO tanpa assignment WO/task tambahan, hanya untuk aksi tersebut. Perubahan terhadap baseline memerlukan keputusan superseding resmi, bukan pilihan pending di formulir ini.

### OD-039-05 — Syarat final completion WO

Tentukan seluruh prasyarat sebelum WO dinyatakan selesai:
- Progress akhir telah diverifikasi:  
- Inspection/lapangan telah disetujui:  
- Rekonsiliasi material keluar/terpakai/sisa/retur melalui aplikasi material eksternal (bukan ledger inventory DISTRIVA) merupakan prasyarat:  
- Evidence/dokumen wajib lengkap:  
- Meter verification (jika relevan):  
- Persetujuan final oleh `ASMAN_KONSTRUKSI` (baseline): `EXISTING DECISION — berlaku sampai ada keputusan superseding resmi`  
- Prasyarat lain:  

### OD-039-06 — Vendor eligibility dan akses

Dependency: **O-029 masih OPEN**.

- Sumber resmi kelayakan vendor:  
- Pihak yang mengesahkan company/vendor:  
- Pihak yang mengesahkan hubungan vendor dengan project:  
- Pihak yang mengesahkan assignment vendor ke WO:  
- Kondisi pencabutan akses vendor:  
- Bukti hubungan account–company–project–assignment–WO:  

Sampai keputusan dan relasi tersebut disahkan serta tersimpan, kebijakan **vendor deny-all tetap berlaku**.

---

## 6. B — Keputusan terbuka O-041: RAB, KKF, dan feasibility

**Status issue:** `OPEN / BLOCKING`

### OD-041-01 — Aktor RAB

| Tanggung jawab | Role/jabatan | Unit | Status |
|---|---|---|---|
| Menjalankan kalkulasi RAB (runner) |  |  | `PENDING` |
| Menyiapkan/mengoreksi input RAB |  |  | `PENDING` |
| Review hasil RAB |  |  | `PENDING` |
| Menyetujui RAB (jika diperlukan) |  |  | `PENDING` |
| Mengembalikan/menolak hasil RAB |  |  | `PENDING` |

Tentukan apakah RAB merupakan hasil kalkulasi teknis yang cukup direview, atau memerlukan approval bisnis formal tersendiri:  

### OD-041-02 — Harga material dan UOM

Dependency: T4.2.2.

- Prioritas sumber harga yang berlaku:  
- Apakah harga eksternal atau harga internal UP3 yang menjadi default:  
- Siapa yang berwenang memilih/mengesahkan sumber harga untuk suatu perhitungan:  
- Apakah harga yang dipilih disimpan sebagai snapshot pada calculation run: `YES — baseline reproducibility`  
- Sumber mapping UOM ERP:  
- Aturan konversi UOM dan pihak yang mengesahkan:  
- Perlakuan jika UOM ERP tidak memiliki mapping:  

Jangan mengasumsikan prioritas sumber harga atau konversi UOM sebelum disahkan.

### OD-041-03 — Aktor dan review KKF

| Tanggung jawab | Role/jabatan | Unit | Status |
|---|---|---|---|
| Menjalankan kalkulasi KKF |  |  | `PENDING` |
| Menyiapkan/mengoreksi input KKF |  |  | `PENDING` |
| Review hasil KKF |  |  | `PENDING` |
| Mengembalikan/menolak KKF |  |  | `PENDING` |

**Matriks approver yang sudah tercatat tetap menjadi baseline yang berlaku.** Formulir ini tidak membuka ulang keputusan tersebut; perubahan hanya dapat dilakukan melalui keputusan pemilik proses baru dengan bukti dan status superseding yang jelas:

- KKF normal: `ASMAN_PERENCANAAN` AND `ASMAN_KONSTRUKSI`.
- PBP lebih dari 5 tahun: `ASMAN_PERENCANAAN`, `ASMAN_NIAGA`, `ASMAN_KONSTRUKSI`, dan `UP3_MANAGER`; empat user berbeda.
- `UP3_MANAGER` bukan approver KKF normal.
- Approver AND harus user berbeda; submitter tidak boleh final-approve versinya sendiri.

**Konfirmasi yang diterima pada 2026-11-05:** tidak ada rencana mengganti approval matrix yang telah disepakati; matrix existing tetap menjadi baseline. Perubahan hanya dapat dipertimbangkan setelah kebutuhan bisnis diklarifikasi dan disetujui pemilik proses yang berwenang. Aktor/tahapan yang masih `OPEN/PARTIAL` harus diselesaikan terpisah sebelum implementasi.

Pesan awal menggunakan redaksi yang dapat dibaca sebagai usulan pembagian approver berbeda, tetapi klarifikasi berikutnya secara eksplisit menyatakan tidak ada rencana mengubah matrix. Redaksi awal itu tidak diadopsi sebagai keputusan atau perubahan.

Identitas/jabatan/unit pemberi konfirmasi, tanggal keputusan formal, dan rujukan notulen/SOP/surat/delegasi tidak diberikan. Karena itu, konfirmasi ini dicatat sebagai input percakapan dan **belum diverifikasi sebagai persetujuan owner formal**. Status perubahan terhadap matriks: `PENDING — tidak ada perubahan yang diminta; baseline existing tetap tercatat, menunggu verifikasi otoritas untuk konfirmasi formal`.

Paket rekomendasi teknis v3.11.0 untuk membantu pemilik proses memutuskan tersedia pada [dokumen 45](./45-OWNER-DECISION-INTEGRATION-AUDIT.md). Seluruh rekomendasi di sana tetap `PROPOSED`; jangan mengubah status menjadi `APPROVED` tanpa pengesahan dan bukti.

### OD-041-04 — Hubungan RAB, KKF, dan feasibility

Tentukan:
- Apakah satu KKF mengacu pada satu RAB run atau dapat mengacu pada beberapa RAB run:  
- Apakah KKF wajib mengunci ID dan versi RAB yang digunakan:  
- Apakah feasibility mengacu pada satu KKF atau beberapa skenario KKF:  
- Apakah perubahan RAB membuat KKF/feasibility perlu dihitung ulang:  
- Bagaimana menjaga hubungan ke versi input, parameter, harga, dan master data yang digunakan:  

Baseline: hasil kalkulasi harus reproducible; versi yang disetujui immutable.

### OD-041-05 — Feasibility: trigger, aktor, dan lifecycle

- Pemicu pembuatan feasibility:  
- Role pembuat/runner:  
- Role reviewer:  
- Role approver:  
- Jumlah skenario yang diperbolehkan:  
- Kriteria kelayakan dan parameter Discount Rate:  
- RWACC tetap indikator dan tidak otomatis menggantikan Discount Rate: `EXISTING BASELINE`; perubahan memerlukan keputusan superseding resmi.
- Relasi feasibility dengan application/RAB/KKF:  
- Aturan return/reject/recalculate/cancel:  

Semua field di atas `PENDING` sampai ada keputusan pemilik proses.

---

## 7. C — Dependency lintas-issue yang harus diputuskan

| ID | Dependency | Keputusan yang diperlukan | Status |
|---|---|---|---|
| OD-DEP-01 | O-033 Authorization | Daftar permission identifier final dan role-permission grants yang disetujui. | `OPEN / BLOCKING` |
| OD-DEP-02 | O-029 Vendor | Kelayakan vendor, batas organisasi, dan relasi account/company/project/assignment/WO. | `OPEN`; deny-all |
| OD-DEP-03 | O-034 Resource model | Persetujuan final resource, relasi, cardinality, lifecycle, status, versioning, dan schema. | `OPEN / BLOCKING` |
| OD-DEP-04 | T4.2.2 UOM/pricing | ERP UOM mapping, conversion, source-price priority/default, dan otoritas pemilihan harga. Kedua jalur harga (eksternal dan internal per-UP3) tetap tersedia sesuai keputusan T4.2.2. | `OPEN` |
| OD-DEP-05 | T4.2.4 Documents/Auto MTO | Rekonsiliasi PK/FK dan version snapshot dengan kontrak dokumen/Auto MTO aktual `docs/26-T4.2.4-DOCUMENTS-AUTO-MTO-SCHEMA.md`. | `MUST RECONCILE` |
| OD-DEP-06 | Reports/dashboard O-037 | Metrik, role, kolom sensitif, dan mapping export per domain. | `PARTIAL / OPEN` |
| OD-DEP-07 | O-036/O-038/O-039/O-041 | Isi keputusan aktor, transition, cardinality, SoD spesifik, dan lineage di bagian B; O-036/O-038/O-039/O-041 tetap open sampai keputusan owner terdokumentasi. | `PENDING OWNER DECISION` |

---

## 8. D — Ringkasan keputusan rapat

| No. | ID keputusan | Keputusan final | Pemilik keputusan (nama/jabatan) | Unit | Tanggal | Bukti/notulen | Status |
|---:|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  |  | `PENDING` |
| 2 |  |  |  |  |  |  | `PENDING` |
| 3 |  |  |  |  |  |  | `PENDING` |
| 4 |  |  |  |  |  |  | `PENDING` |
| 5 |  |  |  |  |  |  | `PENDING` |

### Pengesahan

| Peran | Nama/jabatan | Tanda tangan/paraf | Tanggal |
|---|---|---|---|
| Pemilik proses ULP |  |  |  |
| Pemilik proses UP3 |  |  |  |
| Perwakilan Perencanaan |  |  |  |
| Perwakilan Konstruksi |  |  |  |
| Perwakilan Niaga (jika terkait) |  |  |  |
| Penanggung jawab sistem/produk |  |  |  |

---

## 9. Gate setelah keputusan pemilik proses

Dokumen ini **tidak** memberikan persetujuan implementasi. Setelah keputusan diisi dan disahkan:

1. Perbarui `docs/15-DECISIONS-AND-OPEN-ISSUES.md` dengan ID keputusan, pemilik, tanggal, dan referensi bukti.
2. Perbarui dokumen analisis terkait (`docs/38`–`docs/43`) hanya pada bagian yang benar-benar diputuskan.
3. Revisi `docs/35-O-034-RESOURCE-MODEL-LIFECYCLE-SCHEMA.md` menjadi versi final setelah seluruh dependency yang relevan terselesaikan.
4. Rekonsiliasi relasi, cardinality, status, versioning, dan FK dengan schema T4.2.1–T4.2.4.
5. Perbarui authorization design untuk O-033 sebelum membuat permission seeder/Policy/query scope.
6. Lakukan review desain, migration plan, constraint, SoD, concurrency, transaksi, audit trail, dan rollback.
7. Minta persetujuan eksplisit untuk implementasi/migration pada target database yang disebutkan secara jelas.

**Larangan sampai gate terpenuhi:**
- Jangan membuat migration, model domain, seeder permission, Policy, query scope, API, atau mengubah database berdasarkan opsi `PROPOSED`.
- Jangan mengubah status issue menjadi `CLOSED` hanya karena dokumen ini telah dibuat atau diisi sebagian.
- Jangan menjalankan migration pada database yang belum diidentifikasi dan disetujui.

---

## 10. Referensi dokumen

- `docs/15-DECISIONS-AND-OPEN-ISSUES.md`
- `docs/16-FINALIZED-BUSINESS-DECISIONS.md`
- `docs/22-T4.2.1-FOUNDATION-SCHEMA.md`
- `docs/23-T4.2.2-MASTER-DATA-SCHEMA.md`
- `docs/24-T4.2.3-APPLICATIONS-PB-PD-SCHEMA.md`
- `docs/26-T4.2.4-DOCUMENTS-AUTO-MTO-SCHEMA.md`
- `docs/34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md`
- `docs/35-O-034-RESOURCE-MODEL-LIFECYCLE-SCHEMA.md`
- `docs/36-O-034-DOCUMENTATION-AUDIT.md`
- `docs/37-O-034-IMPLEMENTATION-READINESS.md`
- `docs/38-O-036-APPLICATION-RKM-ACTOR-RESOLUTION.md`
- `docs/39-O-038-SURVEY-METER-ACTOR-LIFECYCLE.md`
- `docs/40-O-039-WORK-ORDER-LIFECYCLE-APPROVAL.md`
- `docs/41-O-041-RAB-KKF-FEASIBILITY-LIFECYCLE.md`
- `docs/42-CROSS-DOMAIN-RESOURCE-WORKFLOW-MATRIX.md`
- `docs/43-OPEN-ISSUES-RESOLUTION-REPORT.md`
- `docs/AI-HANDOFF.md`
- `docs/18-CHANGELOG-AND-SUPERSEDED-DECISIONS.md`
- `README.md` (repository root)
- `PACKAGE-MANIFEST.json` (repository root; not under `docs/`)

---

**Catatan status:** Dokumen ini adalah register untuk mengumpulkan keputusan pemilik proses. Pada checkpoint v3.11.0, O-036 tetap `PARTIAL/OPEN`, O-038 `OPEN`, O-039 dan O-041 `OPEN/BLOCKING`, O-034 `OPEN/BLOCKING`, dan readiness implementasi tetap `BLOCKED` sampai keputusan serta persetujuan formal diterima. Rekomendasi docs 34–45 bukan approval.

### Riwayat dan integrasi audit v3.10.0

- 2026-11-05: Audit integritas menemukan tiga baris “PENDING CONFIRMATION” (WO aktif, child-ULP verify/inspect scope, dan final completion role) yang bertentangan dengan baseline keputusan yang sudah tercatat pada `docs/16-FINALIZED-BUSINESS-DECISIONS.md`, `docs/34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md`, dan dokumen 35. Baris tersebut diluruskan sebagai keputusan existing; hanya detail historis/transisi/SoD yang masih terbuka.
- Matriks KKF dipertegas dengan seluruh role yang sudah disetujui dan tidak diminta untuk dikonfirmasi ulang sebagai baseline.
- Ditambahkan dependency UOM/pricing, O-036/O-038/O-039/O-041, dan referensi schema aktual. Tidak ada perubahan keputusan bisnis, role, permission, atau implementasi.

### Integrasi rekomendasi v3.11.0

- Ditambahkan rujukan ke paket rekomendasi konkret di docs 34–45 untuk membantu owner mengesahkan O-033/O-034/O-036/O-037/O-038/O-039/O-041 serta dependency terkait.
- Tidak ada opsi yang dipilih, status owner yang diisi, signature atau approval yang dibuat; seluruh pending fields tetap pending.
