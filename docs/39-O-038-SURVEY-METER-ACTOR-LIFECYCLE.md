# 39 — O-038 Survey dan Meter Installation Actors/Lifecycle

**Design baseline:** v3.8.0; **latest owner-review recommendation:** v3.11.0, 5 November 2026  
**Status issue:** `OPEN`  
**Status dokumen:** analisis dan rekomendasi `PROPOSED`; tidak mengesahkan actor, SoD, atau lifecycle final.

Owner Decision Register ada di [dokumen 44](./44-OWNER-DECISION-REGISTER.md). Isian O-038 masih `PENDING`; rekomendasi dalam dokumen ini tidak mengisi atau menyetujui pilihan owner.

## 1. Ringkasan

Survey PB/PD wajib. T4.2.3 telah menyediakan aggregate survey, version hasil, measurements, assignment/surveyor/reviewer fields, dan penggunaan modul task/SLA yang sudah ada. Dokumen tersebut secara eksplisit menyatakan bahwa field actor bukan pemetaan role; assigner, surveyor, reviewer, formal approval, dan SoD belum ditetapkan.

Pemasangan meter harus diverifikasi sebelum application berstatus `COMPLETED`. Aktor pelaksana, evidence submitter, verifier, SoD, penggantian meter, pengulangan pemasangan, bukti wajib, serta relasi langsung/indirect ke WO belum diputuskan. Tidak ada rekomendasi di bawah ini yang mengubah fakta tersebut.

## 2. Survey lifecycle

### 2.1 Tahapan yang harus dibedakan

| Tahap | Arti | Actor/status baseline |
|---|---|---|
| Assignment | Membuat/menetapkan pekerjaan kunjungan survey, jadwal dan assignee | `assigned_to` tersedia dalam rancangan; role assigner dan assignment rule `OPEN` |
| Execution | Kunjungan dan pengambilan kondisi/measurement di lapangan | `surveyor_id` tersedia; role surveyor `OPEN` |
| Submission | Mengunci versi hasil, findings, recommendation, tanggal dan evidence untuk diperiksa | Mekanisme versi ada; uploader/submit authority dan kelengkapan evidence `OPEN` |
| Review | Memeriksa hasil/measurement dan meminta koreksi bila perlu | `reviewed_by` tersedia; reviewer dan SoD surveyor-reviewer `OPEN` |
| Approval | Keputusan formal yang mengizinkan downstream use | Kewajiban dan approver formal belum disetujui; jangan mengasumsikan `reviewed` sama dengan `approved` |

### 2.2 Lifecycle kandidat

`DRAFT -> ASSIGNED -> IN_PROGRESS -> SUBMITTED -> UNDER_REVIEW -> (RETURNED -> new version -> SUBMITTED) -> ACCEPTED`

Cabang `REJECTED`, `CANCELLED`, `RESCHEDULED`, dan `SUPERSEDED` belum ditentukan. Nama-nama ini adalah kandidat untuk diskusi, bukan enum final. Gunakan tabel task/assignment/review existing T3.3/T4.2.3; jangan membuat assignment/task subsystem kedua.

**Relasi downstream:** hasil survey menentukan kebutuhan drawing, perluasan jaringan, dan feasibility dalam data/version survey. Apakah hasil survey harus berstatus `APPROVED` formal sebelum drawing/MTO atau apakah acceptance/review cukup masih `OPEN`. Kondisi yang tercatat bahwa drawing/feasibility bersifat kondisional tetap berlaku.

## 3. Survey actor options

| Keputusan | Opsi | Kelebihan | Risiko/pertanyaan | Status |
|---|---|---|---|---|
| Assigner | Task dispatcher/otoritas ULP; atau task dispatcher di UP3 | Penugasan dapat mengikuti kapasitas dan cakupan unit | Tidak ada bukti delegasi/lokasi resmi; role dan unit scope belum diketahui | `PROPOSED` |
| Surveyor | Petugas teknis yang ditugaskan; `TEKNIK` hanya kandidat role, bukan mapping | Selaras dengan aktivitas teknis | Nama role tidak cukup sebagai dasar grant; kompetensi dan bukti penugasan belum ada | `PROPOSED` |
| Reviewer | Petugas lain pada unit/fungsi yang berwenang; dapat task-based | Review versi dan measurement terpisah dari eksekusi | Tidak ada role atau SoD surveyor-reviewer yang disetujui | `PROPOSED` |
| Formal approver | Tidak ada approval formal tambahan; atau pejabat/role yang ditetapkan SOP | Menghindari approval tambahan tanpa kebutuhan | Status downstream tidak dapat dipatok hingga diputuskan | `OPEN` |

**Rekomendasi teknis `PROPOSED`:** pisahkan assignment, execution/submission, review, dan formal approval sebagai event/state yang berbeda. Persistasikan actor/assignment snapshot untuk setiap tindakan, ikat review ke versi survey tertentu, dan simpan revisi sebagai versi baru. Jangan menetapkan `TEKNIK` atau `MANAGER_ULP` sebagai role survey tanpa persetujuan.

## 4. Meter installation

### 4.1 Fakta dan batas

- Pemasangan meter adalah bagian proses PB/PD.
- Meter installation harus diverifikasi sebelum application `COMPLETED`.
- T4.2.3 tidak menetapkan siapa pelaksana, uploader bukti, verifier, atau completion decider khusus meter.
- Dokumen 35 mengusulkan `meter_installations`, evidence dan verification records dengan reference ke application dan optional WO; ini masih `PROPOSED`.
- Tidak ada keputusan yang menetapkan satu atau banyak pemasangan per application, penggantian meter, jenis bukti, maupun SoD installer/verifier.

### 4.2 Lifecycle kandidat

`PLANNED -> INSTALLED -> EVIDENCE_SUBMITTED -> PENDING_VERIFICATION -> VERIFIED`

Kandidat pengecualian: `RETURNED`, `REJECTED`, `REPLACEMENT_REQUIRED`, `CANCELLED`, `SUPERSEDED`. Perubahan meter setelah verified harus menambah installation/evidence history, bukan menimpa identitas/nilai historis. Seluruh label tersebut memerlukan persetujuan.

### 4.3 Actor responsibility matrix

| Aksi | Actor saat ini | Batas/keputusan |
|---|---|---|
| Menugaskan/menjadwalkan | `OPEN — ROLE/ACTOR NOT FINALIZED` | Unit dan trigger penugasan perlu SOP |
| Memasang meter | `OPEN — ROLE/ACTOR NOT FINALIZED` | Dapat internal/mitra/vendor hanya jika relasi dan aturan vendor sah |
| Mengirim evidence | `OPEN — ROLE/ACTOR NOT FINALIZED` | Actor harus terautentikasi; evidence mengacu versi dokumen |
| Verifikasi teknis | `OPEN — ROLE/ACTOR NOT FINALIZED` | T4.2.1.2A tidak menetapkan role meter verifier |
| Mengembalikan/menolak | `OPEN — ROLE/ACTOR NOT FINALIZED` | Reason dan jalur perbaikan belum ditetapkan |
| Menandai application completed | Transisi harus menunggu verifikasi pemasangan meter yang valid | Final application actor belum diputuskan pada O-036 |

### 4.4 Evidence requirements — rekomendasi

Belum ada daftar bukti wajib yang disetujui. Untuk ditinjau pemilik proses, evidence dapat mencakup identitas/serial meter, tanggal dan lokasi pemasangan, hasil uji/reading, foto terikat waktu/lokasi, dokumen pendukung, dan referensi WO bila relevan. Ini **bukan** daftar wajib final; kebutuhan privasi, keamanan, perangkat offline, metadata dan retention harus ditentukan terlebih dahulu.

## 5. SoD, verification, dan completion preconditions

- General aturan AND approval: approver berbeda user; berlaku pada workflow approval yang memang AND, bukan bukti bahwa meter memerlukan multi-approval.
- Tidak ada keputusan bahwa installer dan verifier harus berbeda. **Rekomendasi `PROPOSED`:** user-level separation installer/evidence submitter vs verifier untuk kontrol independen, menunggu persetujuan pemilik proses.
- Verifier harus memutuskan evidence/installation record yang spesifik; keputusan dan snapshot hash tidak menimpa versi sebelumnya.
- Aplikasi tidak dapat berstatus `COMPLETED` sebelum pemasangan meter memiliki verifikasi valid.
- Apakah semua progress/WO, payment, dokumen, inspection, atau completion approvals lain adalah precondition untuk application completion harus mengikuti workflow PB/PD resmi; dokumen ini tidak menambah syarat.
- Penggantian meter tidak boleh menghapus installation terdahulu; aturan membatalkan atau supersede verification lama perlu keputusan.

## 6. Pertanyaan pemilik proses

1. Siapa assigner, surveyor, reviewer, dan formal approver; apakah berbeda per PB/PD atau tipe pekerjaan?
2. Apakah surveyor dan reviewer wajib berbeda user?
3. Apakah approval survey formal diwajibkan sebelum drawing/MTO; atau review/acceptance cukup?
4. Bagaimana return/reject, revision number, reschedule, dan cancellation survey?
5. Siapa installer, evidence submitter, meter verifier, dan application completion decider?
6. Apakah installer dan verifier harus berbeda; apakah vendor dapat memasang meter?
7. Apa evidence minimum dan validasi serial/reading/lokasi yang diwajibkan?
8. Berapa banyak installation per application; bagaimana replacement, failed installation, dan re-verification?
9. Apakah meter installation selalu terkait WO, hanya terkait application, atau kondisional terkait keduanya?

O-038 tetap `OPEN` sampai keputusan aktor, lifecycle, evidence, serta completion rule tersebut dicatat eksplisit. Tidak ada grant/permission key yang difinalkan.

## 7. Paket rekomendasi untuk persetujuan owner — v3.11.0

Status: `READY FOR OWNER APPROVAL`; role/action mapping dan aturan di bawah `PROPOSED`, tidak mengubah baseline survey wajib dan meter verification prerequisite.

### 7.1 Survey

| Aksi | Rekomendasi role existing | Kontrol |
|---|---|---|
| Assign/reschedule | `MANAGER_ULP` | Hanya pada application ULP yang sama; assignment dan alasan perubahan dicatat. |
| Execute/submit survey | `TEKNIK` dengan assignment survey/application efektif | Measurement dan bukti dikunci pada survey version; vendor tidak diberi akses dari rekomendasi ini. |
| Review/return | `MANAGER_ULP` | Reviewer berbeda dari surveyor; keputusan mengikat version/hash dan menyertakan alasan. |
| Formal approval | Tidak menambah approval terpisah; `ACCEPTED` oleh reviewer menjadi gate downstream | Menghindari approval duplikat. Jika owner menghendaki approval pejabat terpisah, tetapkan sebagai keputusan tambahan. |
| Reject/cancel | `MANAGER_ULP` hanya untuk kriteria resmi; selain itu return untuk koreksi | Terminal rejection dan reschedule harus mengikuti SOP; jangan menghapus versi lama. |

Lifecycle rekomendasi: `DRAFT -> ASSIGNED -> IN_PROGRESS -> SUBMITTED -> UNDER_REVIEW -> ACCEPTED`; `UNDER_REVIEW -> RETURNED -> new version -> SUBMITTED`; cabang `REJECTED/CANCELLED/RESCHEDULED` hanya aktif setelah aturan dan authority disahkan. Drawing/Auto MTO teknis hanya dimulai setelah survey `ACCEPTED` bila drawing diperlukan; Auto MTO approval tetap mengikuti T4.2.4 dan bukan survey approval.

Evidence yang direkomendasikan: survey date, ULP/application reference, lokasi layanan, pengukuran/temuan, rekomendasi kebutuhan jaringan, surveyor/assignment snapshot, foto/dokumen melalui subsystem T4.2.4 beserta checksum/version, dan reviewer decision. Geotag atau data pribadi tambahan harus memiliki dasar tujuan/retention dan tidak diwajibkan sebelum owner menyetujui.

### 7.2 Meter installation

| Aksi | Rekomendasi role/actor | Guard |
|---|---|---|
| Assign/jadwalkan | `MANAGER_ULP` | Application dan service point persisted. |
| Install dan upload evidence | `TEKNIK` internal; vendor hanya setelah O-029/O-039 relasi formal valid | Identitas pelaksana berasal dari authenticated assignment/account, bukan request payload. |
| Verify/return | `MANAGER_ULP` | Berbeda user dari installer/evidence submitter; keputusan mengacu installation attempt dan evidence version. `KONSTRUKSI_UP3` child-WO special scope tidak diperluas ke meter. |
| Application completion guard | Sistem memvalidasi installation verification; `NIAGA_RETAIL` dapat meminta transisi, tetapi tidak dapat bypass guard | Syarat meter berlaku bila pemasangan diperlukan; hanya verifikasi sah yang membuka syarat meter. |

Evidence minimum yang direkomendasikan untuk ratifikasi: meter serial/ID dan tipe, service/application reference, waktu instalasi, hasil/reading yang berlaku, foto bukti, installer identity, serta dokumen berita acara jika SOP mewajibkan. Gunakan private document subsystem; simpan referensi version/hash, jangan menyalin file/blob ke tabel meter.

Cardinality yang direkomendasikan: satu application memiliki satu meter point aktif per titik layanan, tetapi dapat memiliki banyak installation attempts/replacements historis; hanya satu installation verified yang current per titik layanan. Bila WO konstruksi terkait, installation mereferensikan WO yang sama; bila tidak, application saja. Replacement/rework membuat record baru dan supersede current pointer setelah verifikasi, bukan overwrite. Constraint partial unique/current pointer perlu direview di O-034.

### 7.3 SoD, alternatives, and owner gate

- Surveyor dan survey reviewer direkomendasikan berbeda user; formal approver terpisah tidak direkomendasikan kecuali SOP meminta.
- Meter installer/evidence submitter dan verifier wajib direkomendasikan berbeda user; completion check otomatis tidak menggantikan pemeriksaan evidence.
- Alternatif actor survey: `TEKNIK` lain sebagai reviewer, bukan `MANAGER_ULP`; alternatif meter: pejabat teknis ULP yang ditunjuk secara formal, tanpa membuat role katalog baru.
- Dampak: memperjelas owner ULP, mencegah self-verification, memakai task/SLA dan dokumen yang sudah tersedia, serta tidak membuat subsistem survey/document kedua.
- Risiko bila tidak diputuskan: survey/MTO dan application completion ditahan; meter verification tidak dapat diotorisasi.
- **Pengesah:** pemilik proses layanan PB/PD dan pemilik teknis ULP; keputusan evidence/retention juga memerlukan pengelola data/dokumen yang berwenang. O-038 tetap `OPEN` sampai bukti persetujuan dicatat.
