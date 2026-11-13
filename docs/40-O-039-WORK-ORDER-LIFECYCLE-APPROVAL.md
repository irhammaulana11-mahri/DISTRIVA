# 40 — O-039 Work Order Lifecycle dan Approval

**Design baseline:** v3.8.0; **latest owner-review recommendation:** v3.11.0, 5 November 2026  
**Status issue:** `OPEN / BLOCKING`  
**Status dokumen:** keputusan lama dipertahankan; lifecycle tambahan dan pilihan actor berlabel `PROPOSED`.

Owner Decision Register ada di [dokumen 44](./44-OWNER-DECISION-REGISTER.md). Isian baru O-039 masih `PENDING`; baseline approved yang dipertahankan tidak dibuka ulang oleh formulir tersebut.

## 1. Ringkasan keputusan

Keputusan yang sudah tersedia:

- Satu application/pekerjaan PB/PD menghasilkan **satu WO aktif**; WO berisi paket/tugas dan material dari drawing/BOM/RAB yang approved.
- WO mengacu pada versi approved; perubahan dilakukan melalui change request, bukan mengubah versi historis.
- Pemilihan vendor eligible dilakukan `KONSTRUKSI_UP3`; `ASMAN_KONSTRUKSI` approve/reject vendor assignment.
- Vendor tidak boleh mendapat akses sampai relasi account-company-project-approved assignment-WO valid dan persisted.
- WO yang di-issue harus memenuhi kontrak input approved yang diwajibkan; pengiriman material requirement ke sistem material hanya setelah WO disetujui `ASMAN_KONSTRUKSI` dan diterbitkan.
- Vendor/internal dapat menjadi progress submitter; submitter dan verifier harus berbeda user.
- Effective `KONSTRUKSI_UP3` assignee pada UP3 terkait dapat verify progress dan inspect WO child-ULP hanya pada action scope tersebut.
- `ASMAN_KONSTRUKSI` adalah final completion approver pada keputusan workflow yang ada.

Yang belum ditentukan: drafter/creator, reviewer WO, issuer, apakah terdapat approval WO terpisah dari vendor assignment/completion, SoD antar creator/reviewer/issuer, urutan/status penuh, cardinality sejarah, amendment/cancel, dan progress cumulative rules. O-039 tetap `OPEN / BLOCKING`.

## 2. WO process dan actor matrix

| Tahap/aksi | Actor yang diketahui | Keputusan/status |
|---|---|---|
| Create/draft WO | `OPEN — ROLE/ACTOR NOT FINALIZED` | Tidak boleh menyimpulkan dari vendor selector atau completion approver |
| Review WO content/input | `OPEN — ROLE/ACTOR NOT FINALIZED` | Perlu cakupan review teknis, scope/quantity dan versi sumber |
| Vendor candidate/select | `KONSTRUKSI_UP3` | Approved; selection reason/audit bila di luar rekomendasi |
| Vendor assignment approve/reject | `ASMAN_KONSTRUKSI` | Approved; assignment decision bukan approval/issue WO |
| WO approve/issue | Issuer/approver `OPEN` | Approval vendor assignment tidak otomatis mengesahkan atau menerbitkan WO |
| Execute | Vendor hanya dengan verified account + company/project/approved assignment/WO relations; actor internal juga dapat submit progress sesuai scope yang disetujui | Vendor tetap fail-closed sebelum relasi |
| Submit progress | Vendor/internal sesuai assignment/scope | Submitter berbeda dari verifier |
| Verify progress | `KONSTRUKSI_UP3` dengan UP3 assignment efektif yang sesuai | Hanya aksi spesifik pada child-ULP WO; submitter/verifier berbeda |
| Inspect | `KONSTRUKSI_UP3` dengan UP3 assignment efektif yang sesuai | Aksi khusus; bukan general descendant access |
| Final completion | `ASMAN_KONSTRUKSI` | Role workflow tercatat; preconditions detail dan batas unit masih perlu sinkronisasi |
| Return/reject/cancel/amend | `OPEN — ROLE/ACTOR NOT FINALIZED` | Transition/reason/effect tidak ditetapkan |

## 3. Approved/known lifecycle conditions

### 3.1 Inputs dan issuance

WO harus terhubung ke application/work serta versi drawing/MTO/BOM/RAB yang berlaku dan approved sesuai kebutuhan pekerjaan. Nama/PK actual document/Auto MTO harus reuse T4.2.4. Referensi input harus mengikat versi immutable, bukan hanya “current” pointer.

Vendor assignment:

1. Candidate eligibility dipertimbangkan sesuai status, kontrak, tipe pekerjaan, cakupan UP3, kapasitas/sisa kontrak.
2. `KONSTRUKSI_UP3` memilih; pilihan di luar rekomendasi menyertakan alasan/audit.
3. `ASMAN_KONSTRUKSI` approve/reject assignment.
4. WO hanya dapat mengikat assignment approved yang masih efektif.
5. Vendor access dicabut/ditolak bila account/company/assignment/WO tidak aktif/valid; mekanisme revocation detail tetap perlu finalisasi O-029/O-039.

Tidak ada persetujuan bahwa vendor assignment approval sama dengan WO approval atau issuance.

### 3.2 Progress

- Submission harus terkait WO persisted, submitter assignment/account yang sah, event sequence yang idempotent, dan evidence versi/dokumen.
- Progress resmi adalah progress yang diverifikasi; submitter dan verifier wajib berbeda.
- Revision sebaiknya menjadi submission baru yang mereferensikan yang sebelumnya; jangan overwrite evidence/submission lama. Prinsip ini sejalan dengan immutability, tetapi detail aturan return/revision perlu persetujuan.
- Persentase kumulatif, pengukuran per item/volume, koreksi angka, duplikasi submission, offline capture dan aturan `REJECTED` vs `RETURNED` belum ditetapkan.
- `KONSTRUKSI_UP3` action-specific scope mencakup verify child-ULP WO pada UP3 assignment terkait; tidak memberi akses update/approval generik.

### 3.3 Inspection dan completion

- Inspection action child-ULP adalah kewenangan terbatas `KONSTRUKSI_UP3`.
- Final completion approver yang tercatat adalah `ASMAN_KONSTRUKSI`.
- Inspector vs final approver berbeda user hanya rekomendasi pada desain O-034, belum keputusan final.
- Verifikasi pemasangan meter wajib sebelum application `COMPLETED`.
- Apakah WO completion membutuhkan semua progress verified, inspection PASS, dokumen, meter, material reconciliation, atau approval tambahan harus diputuskan. Jangan menambah prasyarat di luar dokumen approved.

## 4. State transition matrix

Seluruh status tabel ini adalah **kandidat PROPOSED**, kecuali kondisi bisnis yang dicantumkan sebagai approved.

| Dari | Ke kandidat | Trigger/guard yang diusulkan | Status |
|---|---|---|---|
| DRAFT | SUBMITTED | Creator submit; required inputs reference snapshot valid | `PROPOSED`; actor OPEN |
| SUBMITTED | UNDER_REVIEW | Reviewer/queue menerima | `PROPOSED`; role OPEN |
| UNDER_REVIEW | RETURNED | Reason dan correction scope wajib | `PROPOSED`; actor OPEN |
| RETURNED | DRAFT/new version | Perubahan membuat immutable revision/new version | `PROPOSED`; policy OPEN |
| UNDER_REVIEW | REJECTED | Reason, terminality/resubmit rule belum diketahui | `PROPOSED`; actor OPEN |
| UNDER_REVIEW | APPROVED | WO approval stage jika memang diwajibkan | `OPEN`; approval WO belum diputuskan |
| APPROVED | ISSUED | Approved vendor assignment + approved input versions + issue authority | Guard arah disetujui; issuer OPEN |
| ISSUED | IN_PROGRESS | Execution mulai; vendor relation valid atau internal actor sah | `PROPOSED`; status model OPEN |
| IN_PROGRESS | PENDING_INSPECTION | Submission/final work evidence tersedia | `PROPOSED` |
| PENDING_INSPECTION | RETURNED/REWORK | Findings/reason; rework policy perlu definisi | `PROPOSED` |
| PENDING_INSPECTION | INSPECTED | Inspection decision tersimpan | Status/criteria OPEN |
| INSPECTED | COMPLETED | ASMAN_KONSTRUKSI final decision; all approved preconditions | Role known; exact preconditions OPEN |
| Any nonterminal | CANCELLED/ON_HOLD | Authorized actor, reason, vendor/material/progress effects | `OPEN` |
| ISSUED/IN_PROGRESS | AMENDED/new version | Approved change request; preserve prior version and decisions | `OPEN` |

Jangan menjadikan nama status di atas enum production sebelum pemilik proses menyetujui transition table lengkap.

## 5. Cardinality dan relation proposals

| Relasi | Fakta/arah saat ini | Status dan batas |
|---|---|---|
| Application → active WO | Satu application/pekerjaan PB/PD menghasilkan satu WO aktif | Dinyatakan di docs 16. Apakah WO historis/cancelled/amended dapat lebih dari satu dan unique key-nya bagaimana masih perlu konfirmasi |
| Project → application | Project berakar pada application di proposal 35 | Cardinality satu atau banyak project per application belum disetujui |
| Project → WO | Project “contains” WO pada proposal | Satu project dapat memiliki beberapa WO belum diputuskan; tidak mengubah satu WO aktif per application |
| WO → vendor assignment | WO menggunakan approved assignment | Kardinalitas assignment history/switch vendor dan apakah assignment project-level/WO-level masih perlu keputusan |
| WO → item | Paket pekerjaan/material berisi item dari input approved | Snapshot item perlu source/version FK eksplisit; jangan gunakan polymorphic FK tanpa integritas |
| WO → progress submission | Satu/multiple submissions sepanjang pekerjaan adalah pola usulan | Submission numbering/version, approved cumulative semantics OPEN |
| WO → inspection/completion | Inspection precedes final completion pada proposal | Satu/multiple inspection dan reinspection rules OPEN |
| WO → meter | Proposal 35 memasukkan nullable meter verification reference pada completion | Meter dapat application-only atau terkait WO; O-038 OPEN |

Relasi bukan bukti bahwa tabel di proposal 35 sudah disetujui. Scope otoritatif harus diturunkan dari persisted WO→project/application→ULP→UP3.

## 6. Vendor relation model dan access boundary

Model konseptual tetap mengikuti dokumen 35, tanpa implementasi:

`users -> verified active vendor account -> vendor company -> approved vendor assignment -> project/WO`

Ketentuan:

- Company, project, assignment dan WO harus tersimpan dan konsisten; jangan menerima `vendor_company_id`, unit, atau WO scope sebagai klaim dari request.
- Account harus aktif/terverifikasi dan satu akun perusahaan sesuai keputusan terdahulu.
- Assignment harus approved, belum dicabut/superseded, dan terikat ke project/WO aktual.
- Batasi vendor ke WO yang ditugaskan; company membership saja tidak cukup.
- Revocation harus menghilangkan akses berikutnya tanpa menghapus audit/submission terdahulu.
- O-029 tentang vendor unit/eligibility source tetap OPEN; vendor authorization deny-all sampai relasi tervalidasi.

## 7. SoD dan approval matrix

| Kombinasi aktor | Status |
|---|---|
| Progress submitter ≠ verifier | `APPROVED` (D-AUTH-012) |
| AND validators/approvers berbeda users | `APPROVED` (D-AUTH-010) |
| Vendor selector (`KONSTRUKSI_UP3`) ≠ assignment approver (`ASMAN_KONSTRUKSI`) | Role function berbeda; user-level separation untuk assignment ini belum ditegaskan, jangan diasumsikan |
| WO creator ≠ reviewer/issuer/approver | `OPEN` |
| Inspector ≠ final completion approver | `PROPOSED`, perlu keputusan |
| WO submitter ≠ final approver | Rule generic untuk submitter tidak final-approve versinya berlaku bila merupakan approval atas versi; implementasi spesifik WO/lifecycle belum lengkap |

## 8. Keputusan yang diperlukan untuk menutup O-039

1. Role/authority untuk create/draft, review, approve (jika terpisah), issue, return, reject, hold, cancel, amend.
2. Reviewer/issuer boundary; user-level SoD antar creator, reviewer, issuer dan approver.
3. Apakah WO memerlukan approval tahap mandiri serta hubungannya dengan approved vendor assignment dan final completion.
4. Cardinality project/application/active/historical WO, assignment versioning, pergantian vendor dan amendment.
5. Approved input list (drawing/MTO/BOM/RAB/KKF bila relevan), version pinning, required documents dan change request trigger.
6. Progress unit/cumulative calculation, rejection/return/revision, offline/duplicate handling.
7. Inspection rework/re-inspection, completion conditions, meter relation, material reconciliation, cancellation/hold consequences.
8. Vendor access revocation, project-to-WO permission boundary dan O-029 dependency.

O-039 tetap `OPEN / BLOCKING`; dokumen 40 menyediakan kontrak diskusi, bukan izin migration, Policy, query scope, atau permission seeder.

## 9. Paket rekomendasi untuk persetujuan owner — v3.11.0

Status: `READY FOR OWNER APPROVAL`; seluruh tambahan di bawah `PROPOSED`. Baseline satu WO aktif per application/work, vendor assignment approval terpisah, child-ULP action scope, progress SoD, dan final completion role tetap berlaku.

### 9.1 Actor responsibility recommendation

| Aksi | Role yang direkomendasikan | Guard / SoD |
|---|---|---|
| Create/draft WO | `KONSTRUKSI_UP3` | Hanya application/project persisted di UP3 assignment; referensi approved input/version wajib. |
| Technical review | `PERENCANAAN` | Review scope/cost references yang relevan; tidak menggantikan KKF approval atau drawing review. |
| WO approval | `ASMAN_KONSTRUKSI` | Keputusan eksplisit terpisah dari vendor assignment approval; distinct user dari creator/reviewer direkomendasikan. |
| Issue | `ASMAN_KONSTRUKSI` setelah approval tersimpan | Issuance adalah event tersendiri, atomic dengan status/history; tidak otomatis membuka akses vendor. |
| Return/reject | Reviewer/approver sesuai tahap | Return memerlukan reason dan correction scope; reject terminal hanya untuk kriteria resmi. |
| Hold/resume/cancel | `ASMAN_KONSTRUKSI` | Reason, status guard, dampak assignment/progress/material integration, audit; cancellation setelah issue memerlukan close/reconciliation eksternal. |
| Vendor select/assignment approval | `KONSTRUKSI_UP3` pilih; `ASMAN_KONSTRUKSI` approve/reject | Keputusan existing; tidak dianggap WO approval atau issue. Vendor deny-all sebelum relasi valid. |
| Progress submit/verify | Authorized vendor/internal submitter; verifier `KONSTRUKSI_UP3` pada special child-ULP action scope | Submitter dan verifier berbeda; assignment efektif dan persisted WO relasi wajib. |
| Inspection | `KONSTRUKSI_UP3` untuk child-ULP action scope | Inspector berbeda dari progress submitter; direkomendasikan berbeda dari final approver. |
| Final completion | `ASMAN_KONSTRUKSI` | Hanya setelah completion prerequisites; existing final role dipertahankan. |

### 9.2 Cardinality, versioning, and transition recommendation

- Satu application/pekerjaan memiliki paling banyak satu WO aktif. Banyak WO historis diperbolehkan secara berurutan hanya setelah yang sebelumnya `COMPLETED`, `CANCELLED`, atau terminal sesuai SOP; tidak ada dua active WO sekaligus.
- Rekomendasi project: satu logical construction project per application/work; beberapa application tidak digabung pada satu project kecuali ada keputusan owner dan unit/scope yang sama dibuktikan. Project boleh tidak ada jika tidak ada pekerjaan konstruksi.
- Project dapat menampung WO historis pengganti/revisi tetapi tetap mengikuti satu active WO per application/work.
- Satu WO version mengikat satu vendor assignment approved yang efektif. Vendor switch membuat assignment version/record baru; assignment lama dicabut/ditutup sesudah pergantian disetujui. Satu assignment tidak dipakai lintas WO pada baseline rekomendasi.
- Amendment mengunci version lama dan membuat WO revision/new version; perubahan material/quantity mengirim ulang review/approval dan memerlukan RAB/KKF recalculation bila mempengaruhi investasi.
- Progress disimpan per WO item/activity dan periode; kuantitas verified adalah sumber perhitungan cumulative percent. Report cumulative dihitung sistem, bukan nilai kumulatif bebas dari submitter. Verified submission immutable; koreksi membuat submission/adjustment baru dengan referensi ke record lama dan reason.
- Minimal lifecycle: `DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> ISSUED -> IN_PROGRESS -> PENDING_INSPECTION -> INSPECTED -> PENDING_COMPLETION_APPROVAL -> COMPLETED`. Return mengulang melalui revision; reject/cancel/hold/rework hanya dengan aktor, alasan, dan guard yang ditetapkan.

### 9.3 Completion, vendor, and SoD recommendation

Completion guard yang direkomendasikan: required progress final telah diverifikasi; inspection terakhir `PASS`; seluruh evidence/dokumen wajib versi terkini; meter verification valid jika pemasangan meter diperlukan; WO dan source versions tidak superseded; vendor/account/project/assignment masih valid; dan status rekonsiliasi material dari aplikasi eksternal tersedia jika diwajibkan SOP. DISTRIVA tidak membuat ledger inventory dan tidak menyatakan saldo/retur sendiri.

Vendor eligibility rekomendasi: active centrally governed vendor company, account terverifikasi terhubung ke tepat satu company aktif, kelayakan/kontrak berlaku untuk pekerjaan dan periode, project/UP3 scope cocok, assignment approved untuk company dan WO yang sama. Revoke/suspend account, company, contract, project relation atau assignment segera menutup akses vendor. Sumber registrasi dan pemilik keputusan eligibility tetap `OPEN` O-029.

### 9.4 Alternatives, impact, and owner sign-off

- **Direkomendasikan:** `KONSTRUKSI_UP3` draft, `PERENCANAAN` review input, `ASMAN_KONSTRUKSI` approval dan issue; terpisah dari vendor assignment decision. Maker-checker antar actor user berbeda untuk approval WO. Ini memakai role existing dan memperjelas audit tanpa role baru.
- **Alternatif:** tidak ada WO approval terpisah; `ASMAN_KONSTRUKSI` finalizes issuance setelah review. Lebih sederhana tetapi mencampur issuance authorization dan approval, sehingga perlu eksplisit disahkan.
- Dampak database: WO identity + immutable version/snapshot, status history, source version references, distinct vendor assignment history, progress/inspection/completion records; composite FK/partial unique active guard diperlukan.
- Risiko tidak diputuskan: issue/activation vendor dan pengiriman material harus ditahan.
- **Pengesah:** pemilik proses konstruksi UP3, pemilik vendor/kontrak, serta pemilik aplikasi/material integration untuk guard lintas sistem. O-029/O-039/O-034 tetap open sampai keputusan tercatat.
