# 38 — O-036 Application Reviewer dan RKM Proposer

**Design baseline:** v3.8.0; **latest owner-review recommendation:** v3.11.0, 5 November 2026  
**Status issue:** `PARTIAL / OPEN` — belum ada keputusan pemilik proses baru  
**Status dokumen:** analisis dan rekomendasi; tidak mengubah role catalog, approval, atau implementasi.

## 1. Ringkasan

Bagian RKM yang sudah diputuskan adalah alur: ULP mengusulkan; `PERENCANAAN` dan `KONSTRUKSI_UP3` memvalidasi versi yang sama sebagai AND oleh user berbeda; `UP3_MANAGER` memberi keputusan final; submitter tidak boleh menjadi final approver versinya; dan approval bukan PO/procurement. Role konkret ULP yang menyiapkan dan submit tetap belum ditetapkan.

Untuk aplikasi PB/PD, `NIAGA_RETAIL` menangani input/pelengkapan data dan nomor telepon sebelum submit. Namun, dokumen baseline tidak menetapkan reviewer kelengkapan aplikasi, reviewer teknis aplikasi, aktor return/reject, ataupun apakah ada gate formal sebelum survey. Approval gambar oleh `MANAGER_ULP` dan review gambar UP3 adalah workflow dokumen/gambar, bukan bukti bahwa role yang sama menjadi application reviewer.

**Tidak ada keputusan final baru dalam dokumen ini.** O-036 tetap terbuka.

Owner Decision Register ada di [dokumen 44](./44-OWNER-DECISION-REGISTER.md). Seluruh isian O-036 masih `PENDING`; opsi pada dokumen ini tidak menjadi keputusan tanpa bukti persetujuan owner.

## 2. Fakta baseline

| Fakta | Status | Acuan |
|---|---|---|
| PB/PD dibuat/dilengkapi oleh `NIAGA_RETAIL`; nomor telepon wajib sebelum submit resmi | Tercatat/approved pada desain T4.2.3 | docs 16, 24, 34 |
| Aplikasi dimiliki ULP; status workflow internal berbeda dari status eksternal Bot Daftung/EIS | Approved | docs 16, 24 |
| Survey wajib; drawing dan feasibility kondisional; cabang konstruksi mengikuti kebutuhan perluasan | Approved sebagai alur layanan | docs 16, 24 |
| `application_tasks`, assignments, reviews, revisions dan SLA sudah menjadi pola T3.3; jangan membuat mekanisme task kedua | Baseline desain | docs 24 |
| `MANAGER_ULP` menyetujui submission paket gambar sebelum review paralel UP3 | Approved untuk gambar saja | docs 16, 26 |
| `UP3_MANAGER` final approver RKM; ULP mengusulkan | Approved | D-010, D-AUTH-010, docs 12/15/34 |
| Role ULP konkret untuk prepare/submit RKM belum ditetapkan | OPEN | O-036 |
| Application admin/technical reviewer dan status decision actor belum ditetapkan | OPEN | O-036, docs 24/34 |

## 3. Application review

### 3.1 Alur yang dapat dinyatakan tanpa asumsi

1. Data manual atau hasil Bot Daftung masuk ke staging/application sesuai kontrak yang berlaku.
2. `NIAGA_RETAIL` melengkapi data wajib, termasuk nomor telepon, lalu melakukan submit sesuai izin yang kelak disahkan.
3. Nomor agenda/register, pembayaran terverifikasi, status eksternal, survey, drawing, feasibility dan konstruksi adalah tahapan/relasi terpisah; status eksternal tidak menggantikan status internal.
4. Survey wajib; review dan actor untuk survey belum ditetapkan (O-038).
5. Tidak ada dasar untuk menyamakan application reviewer, survey reviewer, drawing reviewer, atau RKM reviewer.

### 3.2 Opsi keputusan application reviewer

| Opsi | Tanggung jawab | Keuntungan | Risiko / yang perlu dikunci | Status |
|---|---|---|---|---|
| A — Gate administrasi di ULP | `MANAGER_ULP` memeriksa kelengkapan setelah `NIAGA_RETAIL` submit; keputusan teknis ditangani pada workflow survey/teknis terpisah | Dekat dengan unit pemilik aplikasi; pemisahan input dan gate jelas | Belum ada persetujuan bahwa Manager ULP mereview application; beda dari approval gambar yang memang sudah ditetapkan | `PROPOSED` |
| B — Review terpusat di UP3 | Fungsi yang ditunjuk UP3 menilai kelayakan administrasi/teknis | Konsistensi lintas ULP | Role, cakupan review, kapasitas, dan hubungan dengan survey/drawing belum ditetapkan | `PROPOSED` |
| C — Task-based assignment | Tahap kelengkapan/teknis menjadi task dengan assignee efektif per transaksi; role dan assignment rules ditetapkan pemilik proses | Dapat mendukung variasi PB/PD tanpa membuat role baru | Tidak menentukan role atau approval policy; membutuhkan definisi task template dan scope | `PROPOSED` |

**Rekomendasi teknis `PROPOSED`:** pisahkan pemeriksaan kelengkapan administrasi dari review teknis dan survey. Gunakan task/workflow yang sudah dirancang pada T4.2.3, jangan membuat reviewer universal atau mengasumsikan approval `MANAGER_ULP`. Pemilik proses tetap harus memilih opsi, menetapkan role/assignment, dan menentukan status transisi serta kewenangan return/reject.

### 3.3 Application review matrix

| Tahap/aksi | Actor yang diketahui | Rekomendasi / batas | Status |
|---|---|---|---|
| Create/update draft | `NIAGA_RETAIL` | Tetap pada ULP aplikasi persisted; assignment efektif wajib | Role tercatat; grant final mengikuti O-033 |
| Submit application | `NIAGA_RETAIL` melengkapi data wajib | Tidak menetapkan reviewer otomatis; nomor telepon wajib | Alur data tercatat; transisi/reviewer OPEN |
| Review kelengkapan | Belum ditentukan | Pilih opsi A/B/C di atas | `OPEN` |
| Return for correction | Belum ditentukan | Wajib reason, target task/field, dan audit; jangan menyamakan dengan status eksternal | `OPEN` |
| Reject / eligibility decision | Belum ditentukan | Perlu dasar SOP, finality, appeal/resubmit policy | `OPEN` |
| Survey assignment/review | Belum ditentukan; O-038 | Lihat dokumen 39 | `OPEN` |
| Drawing submission/review | `MANAGER_ULP` gate; `PERENCANAAN` AND `KONSTRUKSI_UP3` review atas versi sama | Hanya berlaku untuk drawing package | `APPROVED` |
| Final application status decision | Belum ditentukan | Tidak menyimpulkan dari drawing, payment, atau status eksternal | `OPEN` |

### 3.4 Apakah reviewer application sama dengan reviewer survey?

Tidak ada keputusan yang menyatakan sama atau berbeda. Desain T4.2.3 menyimpan `assigned_to`, `surveyor_id`, `reviewed_by` sebagai actor references, tetapi secara eksplisit tidak memetakan role. Secara teknis keduanya adalah aktivitas berbeda: reviewer application memeriksa record/proses aplikasi; reviewer survey menilai hasil teknis survey. **Rekomendasi:** pisahkan ability dan audit event; user dapat sama hanya jika pemilik proses mengizinkan dan tidak ada SoD yang berlaku. Ini `PROPOSED`, bukan rule.

## 4. RKM proposer matrix

| Aktivitas | Batas keputusan yang sudah ada | Yang belum ditetapkan |
|---|---|---|
| Menyusun kebutuhan per ULP | ULP menyiapkan data; RKM mengonsolidasikan demand beberapa ULP pada UP3 | Apakah `MANAGER_ULP` atau staf operasional yang mengompilasi/menyusun |
| Submit usulan versi | ULP adalah proposer | Role katalog, mandat delegasi, dan apakah submitter harus sama dengan preparer |
| Validasi Planning | `PERENCANAAN` UP3 | User harus berbeda dari validator Konstruksi |
| Validasi Construction | `KONSTRUKSI_UP3` UP3 | User harus berbeda dari validator Planning |
| Final decision | `UP3_MANAGER` | Tidak boleh submitter versi yang sama |
| Revision/amendment | Versi baru; validasi dan approval ulang | Hak actor ULP melakukan revisi/submit versi baru tetap mengikuti role proposer yang diputuskan |

### Opsi role ULP untuk RKM

| Opsi | Dampak | Catatan |
|---|---|---|
| A — `MANAGER_ULP` sebagai submitter | Akuntabilitas unit jelas; dapat menjadi gate internal | Belum ada keputusan bahwa Manager ULP menyusun/submit RKM; dapat membebani peran |
| B — `NIAGA_RETAIL` sebagai submitter operasional | Memakai role catalog aktif yang dekat dengan proses layanan | Tidak ada bukti role ini bertanggung jawab atas perencanaan material; tidak direkomendasikan tanpa SOP |
| C — Staf ULP yang didelegasikan lewat assignment/task | Tidak menambah role baru dan mendukung preparer/submitter berbeda | Harus ada kebijakan penunjukan dan audit; belum ada mekanisme business delegation yang disetujui |

**Rekomendasi `PROPOSED`:** pemilik proses menetapkan satu role/otoritas submit ULP dari role aktif yang ada, atau secara eksplisit menyetujui mekanisme delegate/task tanpa menciptakan role baru. Jangan seed role/permission baru. Pemisahan preparer dan submitter dapat menjadi kontrol tambahan, tetapi belum menjadi SoD yang disetujui.

## 5. Submission dan approval boundary

- RKM ULP submit bukan approval; status submit tidak boleh menyiratkan validasi.
- Dua validator AND bertindak atas versi yang sama dan harus berbeda user.
- Final approval `UP3_MANAGER` terjadi hanya setelah dua validasi lengkap; submitter tidak boleh final-approve versinya.
- Return/reject/cancel dan konsekuensi cycle belum sepenuhnya ditetapkan; simpan sebagai pertanyaan terbuka.
- RKM approval tidak membuat PO, vendor assignment, atau WO.
- Akses/permission key belum final sampai O-033 diselesaikan; assignment hanya dari `user_role_assignments`.

## 6. Keputusan pemilik proses yang diperlukan

1. Pilih lokasi dan role application reviewer, termasuk apakah review administratif dan teknis terpisah.
2. Tetapkan return, reject, resubmit, dan final application status authority.
3. Putuskan apakah application reviewer boleh sekaligus survey reviewer.
4. Tetapkan role ULP yang dapat prepare dan submit RKM, termasuk delegasi dan audit.
5. Tegaskan apakah preparer dan submitter RKM harus berbeda; SoD yang sudah disetujui hanya melarang submitter menjadi final approver versi sendiri.
6. Konfirmasi apakah setiap jenis aplikasi membutuhkan gate application formal sebelum survey, tanpa mengubah status survey wajib.

Sampai keputusan tersebut dicatat pada Decision Register, O-036 tetap `PARTIAL / OPEN`. Rekomendasi dokumen ini bukan keputusan yang menutup issue.

## 7. Paket rekomendasi untuk persetujuan owner — v3.11.0

Status paket: `READY FOR OWNER APPROVAL`; semua pilihan di tabel adalah `PROPOSED`, bukan permission grant atau keputusan final.

### 7.1 Actor-responsibility yang direkomendasikan

| Aksi | Rekomendasi actor/role existing | Batas dan SoD |
|---|---|---|
| Membuat/melengkapi draft | `NIAGA_RETAIL` | Hanya application ULP dari assignment efektif; telepon wajib sebelum submit. |
| Review administratif | `MANAGER_ULP` | Cek kelengkapan, identitas, pembayaran/reference prerequisite yang memang berlaku; return/reject harus beralasan dan audited. |
| Review teknis application | Tidak menjadi gate kedua yang terpisah | Temuan teknis dinilai melalui survey wajib dan workflow drawing/MTO kondisional. Hindari duplikasi review dan role baru. |
| Return | `MANAGER_ULP` | Reason dan daftar koreksi wajib; membuat revision/task baru, bukan menghapus histori. |
| Reject | Rekomendasi: `MANAGER_ULP` hanya untuk kriteria administratif yang disahkan; keputusan teknis ditahan sampai survey/review teknis | Terminal reject, dasar SOP, dan hak resubmit harus disetujui owner. Jika kriteria tidak eksplisit, return/hold alih-alih reject. |
| Status sebelum downstream | `MANAGER_ULP` menandai `READY_FOR_SURVEY` setelah cek administratif | Bukan `COMPLETED`; sistem menjaga survey wajib dan cabang drawing/feasibility kondisional. |
| Survey | Mengikuti actor recommendation dokumen 39 | Technical evidence/review berada pada survey aggregate, bukan application reviewer generik. |
| Drawing submission gate | `MANAGER_ULP` | Keputusan existing untuk gambar saja; submission gate tidak menjadikan role ini technical reviewer atau RKM proposer otomatis. |
| RKM prepare dan submit ULP | Rekomendasi: `MANAGER_ULP` sebagai accountable submitter; staf ULP berassignment dapat menyiapkan draft/task | Preparer boleh user yang sama dengan submitter; distinct-user rule yang sudah disetujui tetap mewajibkan dua validator berbeda dan submitter berbeda dari `UP3_MANAGER` final approver. |
| RKM validation/final | `PERENCANAAN` AND `KONSTRUKSI_UP3` pada versi yang sama; `UP3_MANAGER` final | Sudah menjadi baseline. Approval bukan PO/procurement. |

### 7.2 Lifecycle recommendation

Application: `DRAFT -> SUBMITTED -> ADMIN_REVIEW -> READY_FOR_SURVEY`; `ADMIN_REVIEW -> RETURNED -> SUBMITTED` melalui revisi/audit; terminal `REJECTED` hanya jika kriteria resmi disahkan. Survey tetap wajib sebelum proses technical downstream yang memerlukannya. Setelah survey, drawing dan feasibility dibuat hanya jika kondisi bisnisnya terpenuhi. Payment verification, status eksternal, meter verification, dan application status tetap merupakan guard terpisah. Application `COMPLETED` tidak ditetapkan oleh reviewer aplikasi.

RKM version: `DRAFT -> SUBMITTED -> VALIDATING`; kedua validator memberi keputusan atas versi sama sebagai AND. Return salah satu validator menghasilkan revisi baru dan pengulangan validasi; rejection/final approval diputuskan oleh `UP3_MANAGER`. Version approved immutable dan tidak memicu procurement.

### 7.3 Alternatif, dampak, risiko, dan pengesah

- **Alternatif A (direkomendasikan):** `MANAGER_ULP` sebagai application admin gate dan RKM accountable submitter; `NIAGA_RETAIL` tetap data preparer; survey/drawing teknis berjalan sebagai workflow terpisah. Memakai role yang sudah ada, dekat dengan pemilik ULP, dan mencegah duplikasi technical review.
- **Alternatif B:** penugasan task-based di ULP tanpa fixed role. Fleksibel, tetapi membutuhkan aturan delegation, eligibility, assignment auditing, dan permission boundary tambahan.
- Jika tidak diputuskan: aplikasi tidak boleh melompati gate yang belum ditetapkan; return/reject dan RKM submit permission tetap fail-closed.
- **Pengesah:** pemilik proses layanan PB/PD dan pemilik proses ULP/RKM; final approval harus dicatat pada dokumen 44 dengan jabatan, unit, tanggal, alasan, dan bukti.
