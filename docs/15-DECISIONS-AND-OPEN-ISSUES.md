# 15 — Decisions and Open Issues

> **Aturan kerja v3.16.0:** daftar issue ini adalah alat pengelolaan dependensi, bukan gerbang administrasi global. Status issue yang tercatat tidak berubah hanya karena aturan kerja diperbarui. Tentukan dampak setiap issue pada modul tertentu; pekerjaan yang tidak bergantung pada issue tersebut boleh dilanjutkan. Tidak diperlukan nama asli, tanda tangan, SK, surat tugas, atau dokumen fisik untuk mencatat keputusan internal proyek. Keputusan tetap harus eksplisit dan terdokumentasi. Lihat [`53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md`](53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md).

## 1. Keputusan yang sudah tercatat

| ID | Topik | Keputusan |
|---|---|---|
| D-001 | Nama proyek | DISTRIVA |
| D-002 | Backend | Laravel |
| D-003 | Frontend | React + Vite |
| D-004 | Database | PostgreSQL |
| D-005 | Forecast service | Python |
| D-006 | Forecast scope | Per ULP dan konsolidasi UP3 |
| D-007 | Forecast horizon | Bulanan, triwulanan, semesteran, tahunan |
| D-008 | Histori tersedia | Data permohonan; belum tersedia histori pemakaian material lengkap |
| D-009 | Forecasting strategy | Forecast pekerjaan dahulu, konversi ke material memakai BOM |
| D-010 | Approval RKM | Terpusat di UP3; ULP mengusulkan, UP3 Construction memvalidasi, pejabat berwenang menyetujui |
| D-011 | Warehouse | UP3 dan ULP |
| D-012 | ULP stock scope | kWh meter 1 phase, kabel 2×10, kabel 2×16, MCB pelanggan 1 phase |
| D-013 | Meter specification | Prabayar dan pascabayar |
| D-014 | Cable specification | 2×10 mm² dan 2×16 mm² |
| D-015 | MCB specification | Dibedakan berdasarkan rating ampere |
| D-016 | Other construction materials | Dikelola gudang UP3; kebutuhan ULP melalui alokasi/issue UP3 |
| D-017 | PB/PD delta | PD memakai daya baru dikurangi daya lama; PB daya lama = 0 |
| D-018 | Discount rate | RWACC untuk NPV, IRR threshold, dan kelayakan (keputusan awal; superseded oleh finalized decision pada docs 08/16: Discount Rate dipakai untuk NPV/kelayakan, RWACC hanya indikator) |
| D-019 | Service zone | Ditetapkan per UP3 |
| D-020 | KAJIAN | Analisis pemakaian kWh dan pendapatan, terpisah dari RAB |
| D-021 | Material pricing | Keputusan awal: sumber harga eksternal resmi dan snapshot run (scope jalur harga kemudian diperluas oleh D-MDM-001 untuk turut mendukung master harga internal per-UP3) |
| D-022 | Rounding | Pembulatan hanya pada total; detail final perlu disahkan |
| D-023 | Tariff vs jam nyala | Rp/kWh dari penetapan tarif; jam nyala dari laporan 309 bulanan |
| D-024 | Calculation history | Simpan snapshot versi master dan parameter pada setiap run |
| D-025 | RKM vs procurement | RKM approval terpisah dari PO/pengadaan |
| D-026 | Material SKU/varian | Setiap varian material yang digunakan harus memiliki kode SKU ERP tersendiri; satu kode ERP = satu record `materials`; tanpa kode terverifikasi belum menjadi master resmi |
| D-MDM-001 | Harga material T4.2.2 | Mendukung dua jalur: harga eksternal dan master harga internal per UP3 melalui `material_prices`; jenis harga/sumber wajib dibedakan; calculation run menyimpan snapshot harga terpilih |
| D-MDM-002 | Approval master KHS/BOM | `UP3_MANAGER` menjadi approver utama versi KHS dan BOM; versi approved immutable dan perubahan melalui versi baru |

### Klarifikasi supersession keputusan harga/perhitungan

- D-018 di atas dipertahankan sebagai rekaman historis. Acuan keputusan terbaru yang tercatat pada `08-RAB-KKF-ENGINE.md` dan `16-FINALIZED-BUSINESS-DECISIONS.md` adalah Discount Rate sebagai parameter NPV/kelayakan; RWACC dihitung sebagai indikator dan tidak otomatis menggantikan Discount Rate.
- D-021 di atas dipertahankan sebagai keputusan awal tentang sumber eksternal dan snapshot. Keputusan desain T4.2.2 `D-MDM-001` memperluas kemampuan harga dengan mendukung sumber eksternal dan master harga internal per-UP3; keduanya tidak dijumlahkan/dipilih otomatis. Prioritas/default dan otoritas pemilihan harga tetap OPEN.
- Klarifikasi ini merekam urutan dokumen yang sudah tersedia, tidak menciptakan persetujuan baru atau menutup O-041.

## 2. Open issues — perlu keputusan pemilik proses

### Material dan gudang
- O-001: Apakah merek/tipe kWh meter harus menjadi SKU berbeda?
- O-002: Apakah MCB perlu atribut curve, breaking capacity, merek, selain rating ampere?
- O-003: Apakah kabel perlu lot/roll/drum/serial dan bagaimana satuan stoknya?
- O-004: Apakah kWh meter harus dilacak serial number?
- O-005: Apakah ULP dapat menerima transfer fisik material UP3 atau hanya memakai mekanisme alokasi/issue UP3?
- O-006: Apakah stok negatif dilarang mutlak?
- O-007: Apakah retur material dari pekerjaan masuk gudang ULP atau UP3 berdasarkan kategori?

### RAB/KKF
- O-008: Sahkan aturan pembulatan final dan pastikan konsisten dengan dokumen resmi.
- O-009: Validasi PPN 11% terhadap ketentuan yang berlaku saat transaksi.
- O-010: Lengkapi tarif tetap semua golongan/daya.
- O-011: Pastikan aturan tarif berblok dan pemakaian LWBP untuk setiap golongan yang relevan.
- O-012: Lengkapi beberapa file laporan 309 dari bulan berbeda dan golongan berbeda.
- O-013: Dokumen kontrak final untuk JASA/MDU/DPT/TIBET/TERM/KR MATERIAL belum tersedia pada analisis sumber.
- O-014: Sahkan parameter WACC/KKF, BPP, OM, susut, faktor beban, dan horizon proyeksi.
- O-015: Sahkan aturan BP/UJL dan keterkaitannya dengan delta daya untuk seluruh skenario.
- O-016: Cocokkan kembali template output KKF, HPE, REKAP, REKAP RINCI, Formulir 5 dan Formulir 7.

### Workflow dan organisasi
- O-017: Sahkan status permohonan dan matriks approval per jenis pekerjaan.
- O-018: Sahkan jabatan/role yang berhak approve gambar, kelayakan, work order, dan RKM.
- O-019: Definisikan status pipeline yang dipakai untuk forecasting.
- O-020: Definisikan integrasi Bot Daftung, autentikasi, API, dan format payload.
- O-021: Sahkan SOP vendor, work order, dan pencatatan progres.

### Forecast dan RKM
- O-022: Tetapkan target forecast: permohonan masuk, permohonan disetujui, pekerjaan terbit, atau pekerjaan selesai.
- O-023: Tetapkan definisi safety stock dan service level.
- O-024: Tetapkan apakah RKM merencanakan material, pekerjaan, anggaran, atau gabungan.
- O-025: Tentukan kebijakan bobot pipeline bila histori konversi belum cukup.
- O-026: Tetapkan mekanisme revisi/amendment RKM setelah disetujui.

## 3. Catatan sumber dan kehati-hatian

Dokumen aturan RAB/KKF ini merangkum analisis workbook `MASTER RAB & KKF.xlsx` (35 sheet) dan `MASTER TARIF & JAM NYALA.xlsx` (3 sheet), beserta keputusan proses yang telah dikonfirmasi dalam pembahasan. Beberapa nilai pada workbook merupakan contoh, bukan nilai default universal. Seluruh parameter dan ketentuan yang berdampak pada transaksi harus divalidasi terhadap dokumen resmi yang berlaku.

## 4. Change log

| Versi | Tanggal | Perubahan |
|---|---|---|
| 1.0 | 2026-11-04 | Blueprint awal DISTRIVA; merangkum ruang lingkup, arsitektur, proses, database konseptual, RAB/KKF, gudang, forecasting, dan RKM |
| 3.7.0 | 2026-11-05 | Mencatat keputusan aktor, approval, SoD, scope, serta status O-033–O-042 untuk T4.2.1.2A |
| 3.7.1 | 2026-11-05 | Koreksi namespace Decision ID, audit status O-001–O-042, dan validasi referensi; tidak mengubah keputusan bisnis |
| 3.8.0 | 2026-11-05 | Audit dan integrasi proposal O-034; O-034 tetap OPEN/BLOCKING, tanpa approval schema atau implementasi |
| 3.9.0 | 2026-11-05 | Analisis resolusi O-036/O-038/O-039/O-041; keputusan existing dipetakan, rekomendasi tetap PROPOSED dan issue belum ditutup |
| 3.10.0 | 2026-11-05 | Audit/integrasi Owner Decision Register; baseline dan pending decisions dipisahkan, konflik historis D-018/D-021 ditandai tanpa menghapus riwayat |
| 3.11.0 | 2026-11-05 | Paket rekomendasi siap review owner untuk open issues; koreksi supersession T4.2.2 di doc 16; status OPEN/PARTIAL dipertahankan |
| 3.12.0 | 2026-11-05 | Paket rapat keputusan owner dibuat; decision IDs dan pilihan baru tetap proposed/pending, tidak mengubah status issue |
| 3.13.0 | 2026-11-05 | Audit kesiapan implementasi dan matriks remediation/test/approval; issue owner dan status tidak diubah; konflik historis actor dicatat untuk klarifikasi |
| 3.14.0 | 2026-11-05 | Mencatat klarifikasi bahwa approval matrix KKF tidak berubah; redaksi awal yang berbeda tidak diadopsi, otoritas/bukti formal belum tersedia, O-041 tetap OPEN/BLOCKING |
| 3.15.0 | 2026-11-05 | Audit kesiapan backend sesuai Master Prompt; no-DB checks PASS, konfigurasi `.env` tidak cocok PostgreSQL target, test DB belum diverifikasi, seluruh blocker/approval tetap berlaku |


## 5. Keputusan T4.2.1 — 5 November 2026

| ID | Topik | Keputusan |
|---|---|---|
| D-AUTH-001 | Role assignment | Opsi A — Custom Scoped Assignment disetujui; `user_role_assignments` menjadi sumber kebenaran tunggal assignment pengguna |
| D-AUTH-002 | Spatie Permission | Digunakan untuk katalog `roles`, `permissions`, dan `role_has_permissions`; `model_has_roles` tidak digunakan sebagai sumber assignment pengguna |
| D-AUTH-003 | Scoped authorization | Custom `ScopedAuthorizationService` + Laravel Policies mengevaluasi permission role, unit, status akun, status assignment, dan tanggal berlaku |
| D-AUTH-004 | Assignment global | Hanya role `SYS_ADMIN` boleh tanpa unit pada katalog saat ini; role operasional wajib unit |
| D-AUTH-005 | Assignment history | Assignment dicabut dengan `is_active=false` atau diakhiri masa berlakunya; histori tidak dihapus |
| D-AUTH-006 | Overlap assignment | Rentang user-role-unit tidak boleh overlap; rencana enforcement PostgreSQL exclusion constraint dengan `btree_gist`, termasuk constraint terpisah untuk assignment global |
| D-AUTH-007 | Default organizational authorization scope | Akses default hanya pada unit assignment yang sama. Akses UP3 ke ULP anak hanya melalui konteks read-only eksplisit; tidak mewariskan mutasi/approval. Assignment global SYS_ADMIN tidak memberi akses bisnis implisit. |
| D-AUTH-008 | T4.2.1.2 Policy/resource matrix | Matrix pada `34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md` disetujui sebagai baseline desain. Persetujuan ini tidak menetapkan permission key final, tidak menyetujui seeder, dan tidak mengizinkan implementasi Policy/query scope. |
| D-AUTH-009 | KONSTRUKSI_UP3 child-WO verification/inspection | Tanpa role baru Pengawas Jaringan; `KONSTRUKSI_UP3` dapat melakukan verifikasi progres dan inspeksi WO pada ULP anak di UP3 assignment terkait hanya melalui kemampuan khusus. Bukan `UP3_DESCENDANT_READ`, bukan hak mutation atau approval lain. Scope tercatat sebagai desain; implementasi belum ada. |
| D-AUTH-010 | SoD workflow approval AND dan RKM | Semua approver pada langkah AND harus user berbeda; submitter tidak final-approve versinya sendiri. RKM: ULP mengusulkan; `PERENCANAAN` AND `KONSTRUKSI_UP3` validator; `UP3_MANAGER` final approver; tetap terpisah dari procurement. |
| D-AUTH-011 | Scope report/export | Report memakai permission dan organizational scope dari resource sumber; export memerlukan permission terpisah per domain. Tidak ada akses global atau bypass scope. |
| D-AUTH-012 | SoD progress verification | Semua submitter progres (vendor maupun internal) harus berbeda user dari verifier. |
| D-AUTH-013 | Actor boundary KONSTRUKSI_UP3 child-WO | Setiap user dengan assignment `KONSTRUKSI_UP3` efektif pada UP3 terkait dapat verify/inspect seluruh WO child-ULP; tidak perlu assignment tambahan per WO/task. Hanya aksi tersebut yang diperluas. |

### Detail keputusan T4.2.1.2A (v3.7.0)

#### D-AUTH-009 — Scope khusus verifikasi/inspeksi WO child-ULP

- **Konteks:** daftar aktif memiliki 14 role, tidak memiliki Pengawas Jaringan; D-AUTH-007 membatasi descendant scope menjadi read-only.
- **Pilihan:** (A) menambah role baru; (B) menempatkan fungsi pada role aktif dengan hak umum lintas ULP; (C) memakai `KONSTRUKSI_UP3` untuk aksi child-WO verify/inspect yang spesifik, terpisah dari descendant-read. Pemilik memilih C.
- **Dampak workflow:** verifikasi progres dan inspeksi berlaku bagi WO di ULP anak dari UP3 assignment; tidak menciptakan approval final.
- **Dampak authorization:** perlu permission dan scope ability-specific; `UP3_DESCENDANT_READ` tidak boleh digunakan. Request tidak menetapkan unit/WO scope; Policy/service kelak harus menurunkan unit dari persisted WO→application→ULP→UP3.
- **Dampak database:** tidak menyetujui tabel/migration baru. Model WO/progress/inspection dan relasi tersimpan masih prasyarat.
- **Dampak test:** izinkan aksi terbatas pada child ULP; tolak sibling/cross-UP3, operasi bisnis lain, dan akses non-WO; uji predicate SQL sebelum agregasi/export.
- **Status:** pilihan role dan aksi disetujui sebagai arah bisnis; D-AUTH-013/O-042 menetapkan semua pemegang assignment efektif `KONSTRUKSI_UP3` pada UP3 terkait dapat melakukan verify/inspect WO child-ULP tanpa assignment tambahan per WO/task. Permission/schema/implementasi belum disetujui.

#### D-AUTH-010 — RKM validator dan final approval

- **Konteks:** RKM design menyebut ULP proposer, validator fungsi Perencanaan/Konstruksi, dan pejabat UP3; beberapa workflow memerlukan langkah AND. Role berbeda tidak cukup karena user dapat memegang beberapa role.
- **Pilihan:** (A) distinct users hanya pada RKM; (B) distinct users pada semua tahap AND, dan submitter tidak final-approve versinya sendiri. Pemilik memilih B.
- **Dampak workflow:** RKM tetap ULP → `PERENCANAAN` AND `KONSTRUKSI_UP3` → `UP3_MANAGER`; aturan user distinct juga berlaku pada drawing/KKF AND; submitter dilarang final-approve versi sendiri.
- **Dampak authorization:** approver actor IDs harus berbeda pada setiap approval group AND; service mengecek identitas user bukan hanya role; final decision harus memeriksa submitter-versus-approver untuk versi terkait.
- **Dampak database:** tidak menetapkan schema final; approval rows harus menyimpan version, user/role/unit snapshot, decision, actor IDs, timestamps, dan uniqueness/integrity yang cukup untuk distinct user.
- **Dampak test:** setiap AND step gagal bila satu user memenuhi dua role/slot; self-final-approval ditolak untuk versi yang disubmit; revisi membuka approval versi baru.
- **Status:** aturan desain disetujui; permission keys, schema/lifecycle dan implementasi tetap terbuka.

#### D-AUTH-011 — Report/export mewarisi scope sumber

- **Konteks:** export/dashboard dapat membocorkan data lintas unit bila memakai scope terpisah atau filter setelah data diambil.
- **Pilihan:** (A) scope report mengikuti resource sumber dan export memiliki permission per domain; (B) role/report global terpisah; (C) akses export global. Pemilik memilih A.
- **Dampak workflow:** setiap report menggunakan entitlement domain sumber; export adalah aksi tersendiri, bukan konsekuensi otomatis dari view.
- **Dampak authorization:** predicate resource yang sama harus diterapkan di query sebelum pagination/agregasi/export; tidak ada global bypass.
- **Dampak database:** tidak menyetujui tabel baru; butuh report definition/field allowlist dan scope query yang dapat diturunkan dari resource.
- **Dampak test:** cross-unit report/export negatif; query scope sebelum count/page/sort/aggregate; per-domain export permission dan kolom sensitif diuji.
- **Status:** arah scope disetujui; daftar report, field, role dan permission identifiers masih open.

#### D-AUTH-012 — Progress submitter dan verifier

- **Konteks:** verifikasi progress menentukan data resmi yang dapat menggerakkan completion; self-verification berisiko memanipulasi hasil.
- **Pilihan:** (1) submitter dan verifier selalu berbeda; (2) boleh sama dengan kontrol tambahan; (3) aturan berbeda untuk vendor/internal. Pemilik memilih 1.
- **Dampak workflow:** seluruh progress vendor maupun internal harus diverifikasi oleh user selain submitter sebelum resmi diterima.
- **Dampak authorization:** pemeriksaan menggunakan user ID aktor pada record versi progres; tidak cukup membandingkan role.
- **Dampak database:** schema progress harus menyimpan submitter/verifier dan revision/decision audit secara immutable; schema domain belum tersedia.
- **Dampak test:** tolak actor sama untuk submit dan verify pada semua source type; actor berbeda dapat memverifikasi hanya dalam scope WO yang valid.
- **Status:** SoD disetujui; evidence/version/audit schema serta model aktor progres vendor/internal tetap open.

#### D-AUTH-013 — Actor assignment untuk verifikasi/inspeksi child-WO

- **Konteks:** scope child-WO telah dipilih, tetapi belum jelas apakah hak berlaku untuk semua pemegang role aktif pada UP3 atau hanya actor yang ditugaskan ke WO/task tertentu.
- **Pilihan:** (A) seluruh pemegang assignment efektif `KONSTRUKSI_UP3` pada UP3 terkait; (B) hanya pemegang role yang juga ditugaskan per WO/task. Pemilik memilih A.
- **Dampak workflow:** petugas Konstruksi UP3 yang memiliki assignment efektif dapat menangani seluruh WO di ULP anak dari UP3 tersebut; tidak diperlukan assignment tambahan per WO.
- **Dampak authorization:** cek assignment role/unit/status/masa berlaku tetap wajib; hak terbatas pada `work_progress.verify` dan `work_completion.inspect`. Tidak menggunakan `UP3_DESCENDANT_READ` dan tidak memberi approval atau mutation lain.
- **Dampak database:** tidak menyetujui schema baru; scope harus diturunkan melalui relasi persisted WO→application→ULP→UP3.
- **Dampak test:** semua holder efektif pada UP3 boleh aksi spesifik terhadap child-ULP WO; inactive/expired, cross-UP3, non-WO, dan aksi lain tetap deny.
- **Status:** pilihan actor boundary disetujui; permission key, resource model, Policy/query scope dan implementasi tetap belum disetujui.

### Open issues teknis T4.2.1
- O-027 CLOSED: baseline implementasi — Laravel 13.40.0, Spatie Permission 8.3.2, Sanctum 4.3.3 dikunci; migration Spatie dikustomisasi agar tidak membuat user pivots.
- O-028 PARTIAL/OPEN: `btree_gist` dan exclusion constraints berhasil diuji pada PostgreSQL disposable lokal dengan izin eksplisit; ketersediaan/privilege di environment lain/produksi belum diverifikasi.
- O-029 OPEN: usulan assignment role VENDOR memerlukan unit sesuai keputusan role operasional; unit bukan scope akses cukup. Vendor company dan proyek/WO harus diperiksa melalui relasi domain dan policy saat domain vendor difinalkan. Usulan ini bukan keputusan final.
- O-030 OPEN: Finalkan kebijakan perubahan kode resmi unit dan apakah kode lama dapat digunakan kembali setelah perubahan; histori tetap disimpan.
- O-031 PARTIAL: `guard_name=web` dikonfirmasi untuk baseline Laravel; permission keys final tetap menunggu matriks T4.4 dan tidak di-seed.
- O-032 CLOSED: pemilik menyetujui desain integrasi T4.2.1; migration/seeder dijalankan dan di-rollback pada target disposable yang disetujui.
- O-033 OPEN/BLOCKING: finalkan permission identifiers dan explicit role-permission grants untuk setiap ability sebelum seeder/Policy; bergantung pada pemetaan ability/aktor dan domain pada O-034/O-036–O-039/O-041. Kandidat v3.7.0 bukan key final.
- O-034 OPEN/BLOCKING: Sediakan dan setujui model/resource serta field persisted/lifecycle untuk application, drawing/MTO, calculation/KKF, work order/progress, meter, feasibility, dan RKM; belum ada domain model/migration backend. Proposal review: `docs/35-O-034-RESOURCE-MODEL-LIFECYCLE-SCHEMA.md` (PROPOSED); audit/readiness: docs 36–37; actor/lifecycle analysis: docs 38–43. Analisis tidak menutup issue atau mengizinkan migration.
- O-035 CLOSED pada v3.7.0: Tidak ada role Pengawas baru. `KONSTRUKSI_UP3` mendapat arah scope khusus verifikasi progres/inspeksi WO pada ULP anak UP3 terkait, bukan descendant-read atau approval/mutation lain. Implementasi tetap pending.
- O-036 OPEN/PARTIAL: Final approver RKM dipilih `UP3_MANAGER`; ULP tetap proposer dan validator `PERENCANAAN` AND `KONSTRUKSI_UP3` berbeda user. Reviewer aplikasi, kewenangan return/reject, serta role konkret ULP untuk prepare/submit RKM belum diputuskan. Analisis/opsi: `docs/38-O-036-APPLICATION-RKM-ACTOR-RESOLUTION.md`; tidak mengubah status.
- O-037 OPEN/PARTIAL: SAME_UNIT, descendant-read dan scope khusus child-WO telah dibedakan; mapping dashboard/report/export, metric, role dan kolom sensitif masih perlu keputusan.
- O-038 OPEN: Survey wajib; verifikasi pemasangan meter wajib sebelum application `COMPLETED`. Tetapkan survey assigner/surveyor/reviewer/formal approval dan SoD; meter installer/evidence submitter/verifier, SoD, replacement, cardinality, evidence, serta relasi application/WO. Analisis: `docs/39-O-038-SURVEY-METER-ACTOR-LIFECYCLE.md`; belum ada actor baru disetujui.
- O-039 OPEN/BLOCKING: Keputusan existing menetapkan satu WO aktif per application/pekerjaan, `KONSTRUKSI_UP3` memilih vendor, `ASMAN_KONSTRUKSI` approve/reject vendor assignment, dan `ASMAN_KONSTRUKSI` final completion. Tetapkan creator/reviewer/issuer/approval WO dan SoD, transition/amend/cancel, cardinality historis/project/assignment, progress rules dan completion preconditions. Analisis: `docs/40-O-039-WORK-ORDER-LIFECYCLE-APPROVAL.md`; vendor tetap fail-closed sampai relasi persisted valid.
- O-040 CLOSED untuk keputusan SoD pada v3.7.0: submitter progres (vendor maupun internal) wajib berbeda dari verifier. Evidence/version/audit schema tetap blocker O-034.
- O-041 OPEN/BLOCKING: Snapshot/reproducibility dan KKF approver matrix sudah ditetapkan; klarifikasi 2026-11-05 menyatakan tidak ada perubahan yang diminta. Redaksi awal yang dapat dibaca sebagai usulan matrix berbeda tidak diadopsi. Identitas/kewenangan dan bukti formal belum disertakan sehingga konfirmasi dicatat PENDING untuk verifikasi. Runner/reviewer RAB dan KKF, kebutuhan approval mandiri RAB, exact RAB-to-KKF lineage, feasibility trigger/actors/cardinality/lifecycle/link ke KKF, serta detail PBP/transition masih perlu keputusan. SoD distinct-user untuk langkah AND ditetapkan D-AUTH-010. Analisis: `docs/41-O-041-RAB-KKF-FEASIBILITY-LIFECYCLE.md`.
- O-042 CLOSED pada v3.7.0 oleh D-AUTH-013: setiap pemegang assignment `KONSTRUKSI_UP3` efektif pada UP3 terkait dapat verify/inspect seluruh WO child-ULP tanpa assignment tambahan per WO/task; aksi tetap terbatas.

Rincian actor/approval/SoD/scope/candidate permission dan gate T4.2.1.2A ada pada addendum v3.7.0 di `docs/34-T4.2.1.2-AUTHORIZATION-POLICY-DESIGN.md`. Proposal resource O-034 dan readiness-nya dicatat terpisah pada dokumen 35–37. Issue tidak ditutup hanya karena ada rekomendasi; O-035, O-040 dan O-042 ditutup hanya untuk pilihan yang eksplisit dan terdokumentasi.

### Integrasi Owner Decision Register v3.10.0

- `docs/44-OWNER-DECISION-REGISTER.md` adalah formulir decision capture berstatus DRAFT; seluruh keputusan baru pada bagian B/D masih `PENDING` dan belum ada pengesahan owner yang tercatat.
- Register memuat konfirmasi ulang baseline pada bagian A. Status konfirmasi yang masih PENDING tidak membatalkan keputusan existing. Baris O-039 untuk satu WO aktif, child-ULP action-specific scope, dan final completion approver dipertahankan sebagai existing decisions; detail lainnya tetap terbuka.
- Konflik historis D-018/D-021 dicatat tanpa menghapus teks keputusan awal: docs 08/16 menetapkan Discount Rate sebagai rate kelayakan (RWACC indikator), sedangkan D-MDM-001 memperluas pricing untuk kedua jalur eksternal dan internal per-UP3. Harga default/priority tetap OPEN.
- Audit integritas dan daftar file diperbarui ada di `docs/45-OWNER-DECISION-INTEGRATION-AUDIT.md`. O-033, O-034, O-036, O-038, O-039, O-041 tidak ditutup atau dinaikkan statusnya.
- v3.11.0 menambahkan paket rekomendasi terintegrasi pada docs 34–45 untuk seluruh issue terbuka/partial. Rekomendasi membantu review owner tetapi tidak menutup issue atau menyetujui permission grant. O-009–O-015 dan O-020 masih memerlukan data/kontrak otoritatif; O-029, O-033, O-034, O-039, O-041 tetap blocking untuk implementasi.

### Register koreksi ID keputusan v3.7.1

ID legacy `D-001`–`D-026` dipertahankan karena unik dan tidak dialokasikan ulang. Seluruh keputusan baru menggunakan namespace domain; referensi tanpa namespace yang dulu ambigu telah dimigrasikan sesuai tabel ini. Nomor pada kolom Old ID hanya mengidentifikasi ID lama dan tidak lagi dipakai sebagai identitas keputusan lintas domain.

| Old ID | New ID | Domain | Decision title | Affected references |
|---|---|---|---|---|
| D-027 | D-MDM-001 | MDM | Harga material T4.2.2 | Decision table T4.2.2; references to internal/external material pricing |
| D-028 | D-MDM-002 | MDM | Approval master KHS/BOM | Decision table T4.2.2; references to `UP3_MANAGER` approval |
| D-027 | D-AUTH-001 | AUTH | Role assignment / custom scoped assignment | T4.2.1 decision table, authorization design, AI-HANDOFF |
| D-028 | D-AUTH-002 | AUTH | Spatie Permission catalog-only | T4.2.1 decision table, authorization design, AI-HANDOFF |
| D-029 | D-AUTH-003 | AUTH | Scoped authorization | T4.2.1 decision table and authorization references |
| D-030 | D-AUTH-004 | AUTH | Global assignment | T4.2.1 decision table and authorization references |
| D-031 | D-AUTH-005 | AUTH | Assignment history | T4.2.1 decision table and authorization references |
| D-032 | D-AUTH-006 | AUTH | Overlap assignment | T4.2.1 decision table and authorization references |
| D-033 | D-AUTH-007 | AUTH | Default organizational authorization scope | T4.2.1 decision table and child-WO scope rationale |
| D-034 | D-AUTH-008 | AUTH | T4.2.1.2 Policy/resource matrix | T4.2.1 decision table, AI-HANDOFF, authorization design |
| D-036 | D-AUTH-009 | AUTH | KONSTRUKSI_UP3 child-WO verify/inspect ability | Authorization decision table, detail, workflow and scope references |
| D-037 | D-AUTH-010 | AUTH | AND approval SoD and RKM workflow | Authorization decision table, SoD/RKM references |
| D-038 | D-AUTH-011 | AUTH | Report/export inherits source scope | Authorization decision table and report/export references |
| D-039 | D-AUTH-012 | AUTH | Progress submitter/verifier SoD | Authorization decision table and progress references |
| D-040 | D-AUTH-013 | AUTH | Child-WO actor boundary | Authorization decision table, O-042, changelog and handoffs |
| D-029 | D-PBPD-001 | PBPD | Customer phone required before submit | T4.2.3 decision heading and references |
| D-030 | D-PBPD-002 | PBPD | Agenda and registration identifiers are separate | T4.2.3 decision heading and references |
| D-031 | D-PBPD-003 | PBPD | Separate costs, payments, and external status | T4.2.3 decision heading and references |
| D-032 | D-PBPD-004 | PBPD | Preserve imported payload | T4.2.3 decision heading and references |
| D-033 | D-PBPD-005 | PBPD | Customer, IDPEL, and application cardinality | T4.2.3 decision heading and references |
| D-034 | D-PBPD-006 | PBPD | Register and agenda belong to application | T4.2.3 decision heading and references |
| D-035 | D-PBPD-007 | PBPD | Bot Daftung status update allowlist | T4.2.3 decision heading and references |

Audit found collisions for old IDs D-027 and D-028 across MDM/AUTH, and D-029–D-034 across PBPD/AUTH. D-035 is PBPD-only; D-036–D-040 are AUTH-only. Repeated mentions of a decision in matrices, changelog, or cross-document references are references, not additional decision definitions.

### Open issue status audit v3.7.1

- **OPEN:** O-001–O-026 remain unresolved process/business questions.
- **CLOSED:** O-027 (approved dependency baseline), O-032 (explicitly approved T4.2.1 integration/runtime scope), O-035 (no new Pengawas role and action-specific `KONSTRUKSI_UP3` direction), O-040 (distinct progress submitter/verifier), O-042 (D-AUTH-013 actor boundary).
- **PARTIAL / OPEN:** O-028 (disposable PostgreSQL evidence exists; non-disposable environment privileges remain unverified), O-031 (canonical `web` guard confirmed; permission catalog remains open), O-036 (RKM final approver/flow resolved; application reviewer and ULP proposer role remain open), O-037 (scope principles resolved; report-level metric/role/field details remain open).
- **OPEN:** O-029–O-030, O-033–O-034, O-038–O-039, O-041.
- **Blocking dependencies:** O-033 blocks permission seeder/Policy authorization against unapproved identifiers/grants; O-034 blocks resource Policies/query scopes until persisted domain models, lifecycle, and relationships exist; O-039 depends on O-034 for WO/vendor/approved-version relationships; O-041 depends on O-034 and unresolved KKF/feasibility lifecycle. No issue is closed by recommendation alone.
- The v3.9.0 analysis package is in `docs/38`–`docs/43`; it records existing decisions, proposed options, and owner questions. It does not change O-036/O-038/O-039/O-041 statuses or close O-034.

Open issue verifikasi tersisa: Sanctum UUID end-to-end, concurrency stress tests, Laravel Policies, PostgreSQL integration untuk query `ScopedAuthorizationService`, assignment/audit write path, cache invalidation, permission keys, kebijakan reuse kode organisasi, serta relasi/resolver vendor-company/project/WO. Fondasi service telah diimplementasikan dan unit-tested pada v3.5.0; runtime smoke evidence migration ada di `test-evidence/2026-11-05-t421-runtime.md`, sedangkan test service ada di `test-evidence/2026-11-05-t4211-authorization.md`. Hasil tersebut tidak menyatakan production readiness.


## Keputusan/rancangan T4.2.2 — 5 November 2026

**Arah desain yang digunakan:** ERP/aplikasi material adalah sumber kebenaran master material, satuan ERP, gudang, stok, dan transaksi. DISTRIVA tidak membangun ulang inventory. Kategori material internal dikelola DISTRIVA; kode ERP tidak boleh diciptakan atau ditebak. Satu kode/SKU ERP menjadi satu record material. KHS memakai kode sebagai kunci utama dan versi atribut terpisah. Konstruksi dan BOM juga berversi. Formula BOM harus terstruktur/terkontrol dan dievaluasi deterministik, bukan `eval()` atau kode bebas. Sinkronisasi memakai staging, preview, konfirmasi, retry/logging, dan change log; tidak mengubah saldo/transaksi stok.

**Masih terbuka:** format/API ERP dan autentikasi; daftar SKU aktual; master satuan; apakah setiap varian yang telah didaftarkan memiliki SKU sendiri; sumber/owner harga per UP3 dan kebutuhan tabel `material_prices`; formula lengkap per KHS/BOM dan otoritas persetujuannya; kebutuhan tabel `external_material_references`. Lihat `23-T4.2.2-MASTER-DATA-SCHEMA.md`.


## 3. Keputusan final T4.2.2 (5 November 2026)

- Opsi SKU: **ERP** — satu varian material satu kode SKU ERP tersendiri. Pertanyaan apakah setiap varian perlu menjadi record terpisah telah diputuskan; yang masih pending hanya verifikasi daftar kode aktual dari ERP.
- Harga: **BOTH** — mendukung harga dari sistem/dokumen eksternal dan master harga internal per UP3 melalui `material_prices`. Setiap record harus membedakan `price_type` dan `source_type`; calculation run menyimpan snapshot harga terpilih. Aturan prioritas dan approval perubahan harga internal masih terbuka.
- Approval KHS/BOM: **UP3_MANAGER** — menjadi approver utama versi master KHS dan BOM; versi approved immutable dan perubahan melalui versi baru. Delegasi/Plt dan pemetaan pejabat per UP3 perlu ditangani saat implementasi assignment.
- Formula KHS/BOM, kode satuan dan kontrak integrasi ERP masih memerlukan file/API aktual serta validasi terhadap workbook sumber.


## T4.2.3 — Keputusan dan isu (v2.9, 5 November 2026)

### Keputusan D-PBPD-001 — Nomor telepon pelanggan wajib sebelum submit
Data Bot Daftung boleh masuk staging tanpa nomor telepon. NIAGA_RETAIL wajib melengkapi dan memvalidasi nomor telepon sebelum permohonan menjadi resmi/diajukan. Nomor disimpan sebagai string dan dinormalisasi untuk komunikasi.

### Keputusan D-PBPD-002 — Agenda dan nomor registrasi terpisah
NOAGENDA dan NO_REGISTRASI disimpan sebagai dua referensi eksternal bertipe AGENDA dan REGISTER, bukan satu kolom atau nomor internal DISTRIVA.

### Keputusan D-PBPD-003 — Pemisahan data biaya, pembayaran, dan status eksternal
TOTALBIAYA disimpan sebagai total biaya permohonan; TGLBAYAR menjadi data pembayaran sumber yang perlu diverifikasi. Status Bot Daftung/EIS AP2T dan DURASI_HARI_KERJA disimpan sebagai histori eksternal, bukan status workflow internal.

### Keputusan D-PBPD-004 — Payload impor dipertahankan
Data Bot Daftung masuk staging, divalidasi, dipreview, dan payload sumber dipertahankan untuk audit. Tidak boleh overwrite data proses tanpa revisi/audit.

### OPEN T4.2.3
- Prosedur rekonsiliasi/merge customer lintas sumber dan penanganan konflik IDPEL masih perlu ditetapkan; kardinalitas customer–IDPEL–applications telah dikonfirmasi.
- Unit DAYA_LAMA/DAYA_BARU dan kontrak feed Bot Daftung belum diverifikasi.
- Kontrak pembayaran, aturan verifikasi manual, kamus status eksternal, kriteria TMP, formulir survei, dan pause/resume SLA masih perlu konfirmasi.


### Keputusan D-PBPD-005 — Kardinalitas customer, IDPEL, dan permohonan
Satu customer internal DISTRIVA dapat memiliki banyak permohonan. IDPEL adalah identitas pelanggan PLN yang disimpan sebagai external reference pada customer; satu IDPEL dapat terkait dengan banyak permohonan PB/PD/layanan. IDPEL bukan PK dan bukan nomor aplikasi.

### Keputusan D-PBPD-006 — Register dan Agenda melekat pada permohonan
No. Register digunakan untuk referensi pembayaran (`PAYMENT_REGISTER`), sedangkan No. Agenda digunakan untuk agenda proses layanan (`AGENDA`). Keduanya disimpan sebagai external reference pada `application_external_references`, per permohonan, dan boleh belum tersedia ketika permohonan baru dibuat. Satu customer/IDPEL dapat memiliki banyak register/agenda melalui banyak permohonan. Riwayat penerbitan ulang/koreksi dipertahankan.

### OPEN T4.2.3 setelah v2.9
- Prosedur rekonsiliasi/merge jika IDPEL yang sama sudah tertaut ke lebih dari satu customer; tidak boleh auto-merge.
- Satuan daya pada feed, kontrak API Bot Daftung, payment verification, status dictionary, definisi TMP, formulir survei, dan pause/resume SLA masih perlu konfirmasi.


### Keputusan D-PBPD-007 — Allowlist pembaruan status Bot Daftung (v3.0)
Untuk permohonan yang sudah ada di DISTRIVA dan ditemukan melalui No. Agenda yang cocok tepat satu record, sinkronisasi Bot Daftung hanya boleh memperbarui `DURASI_HARI_KERJA`, `STATUS_PERMOHONAN`, dan `TGL_UPDATE_PERMOHONAN`. Kolom customer/application lain tidak boleh ditimpa oleh jalur ini. Update eksternal tidak mengubah workflow internal. Histori sebelum/sesudah dan `synced_at` wajib dicatat. Data stale ditolak; konflik timestamp sama dengan nilai berbeda dikarantina.

### OPEN T4.2.3 setelah v3.0
- ID unik Bot Daftung untuk permohonan baru yang belum memiliki No. Agenda.
- Format/t zona waktu `TGL_UPDATE_PERMOHONAN`, kamus `STATUS_PERMOHONAN`, dan aturan nilai `DURASI_HARI_KERJA`.
- Kontrak API/file dan autentikasi Bot Daftung.
- Rekonsiliasi customer/IDPEL, satuan daya, verifikasi pembayaran, definisi TMP, formulir survei, serta pause/resume SLA.

## Addendum v3.1 — Bot Daftung

**Ditetapkan:** rentang download berdasarkan tanggal permohonan pertama kali dibuat; data lama dan baru dapat muncul bersama; batch overlap diperbolehkan; tidak ada penghapusan implisit dari ketidakmunculan record.

**Masih terbuka:** inklusivitas batas tanggal, format/timezone `TGL_UPDATE_PERMOHONAN`, kamus status, validasi durasi, cakupan keunikan No. Agenda/Register, dan kontrak API/file.


## T4.2.4 — keputusan desain v3.2

Ditetapkan: satu dokumen logis memiliki banyak versi immutable; pointer current hanya pada `application_documents`; paket Auto MTO dapat berisi banyak file; Python memakai temporary token via API; kegagalan diproses per file; workflow per kategori/tahap; actor rule disnapshot per review cycle; Auto MTO approval ULP terpisah dari drawing review UP3; KHS/BOM/material/satuan memakai master T4.2.2; aplikasi memakai `applications` T4.2.3; RAB/KKF approval tetap T3.6.

Koreksi validasi: composite FK mengikat versi ke dokumen, package ke aplikasi/dokumen, job-file ke job/package/file-version, token ke attempt/job-file, result/extraction ke attempt, verification ke item/requirement dalam package, approval ke snapshot package. Trigger memeriksa kecocokan KHS version dan BOM item/header/material/formula. Snapshot/versi/approval dilindungi dari mutasi.

Masih terbuka: API token Python, CAD parser support, ukuran file, antivirus, dokumen wajib per tahap, actor rules lengkap kategori selain drawing, retensi arsip, daftar simbol dan output Auto MTO. Migration menunggu persetujuan.


## Audit T4.2.4 v3.2.1 — 5 November 2026

Keputusan teknis yang diterapkan: extraction menyimpan package_id agar lineage hasil pemrosesan dapat divalidasi sampai paket; relasi item-source mengunci item dan extraction pada package yang sama; actor snapshot memvalidasi sumber actor terhadap workflow stage asal; rule aktif dalam template memiliki unique key index.

Isu terbuka: (1) uji eksekusi SQL pada PostgreSQL lokal/disposable belum dilakukan; (2) overlap rule lintas template berdasarkan effective date dan prioritas harus diputuskan sebelum constraint temporal final; (3) scope/otorisasi reviewer terhadap `user_role_assignments` tetap harus diuji di Laravel policy/transaction; (4) uji concurrency penomoran versi/cycle/job belum dilakukan.


## Keputusan proyek — kebijakan Auth foundation — 6 November 2026

Status: token 30 menit idle `DECIDED` (sesuai doc 16); password policy `DECIDED` = doc 16; hapus `/api/user` `DECIDED`.
- Kebijakan password: **mengikuti `docs/16`** (keputusan final) — min 8 karakter dengan huruf besar, huruf kecil, angka, simbol; tidak sama dengan 5 password terakhir; tolak password umum (daftar lokal) dan yang memuat nama/bagian email; pengecekan password terbocorkan (HIBP, panggilan eksternal) tersedia tetapi nonaktif default. Instruksi sebelumnya (6 Nov 2026, "standar saja, minimal 8") digantikan atas persetujuan pemilik proyek yang meminta penerapan policy doc 16 (6 Nov 2026); konflik D-1 di `docs/54` selesai.
- Masa berlaku token API: idle timeout 30 menit (sliding). Pembacaan "sekitar 30 menit" sebagai idle timeout, bukan batas absolut; ubah bila diinginkan batas absolut.
- Route skeleton `GET /api/user` dihapus; `/api/me` menjadi kontrak profil tunggal.
- Open: O-033 (permission key/grant) tetap menahan endpoint administrasi assignment/status/unit. Enforcement `must_change_password` di sisi server untuk route non-auth dicatat sebagai tindak lanjut saat route domain pertama dibuat.
Detail: `docs/51-AUTH-API-FOUNDATION.md`.


## Keputusan proyek — O-033 scope foundation administration — 6 November 2026

Status: `DECIDED` untuk scope foundation administration saja (user, assignment, status akun, unit organisasi). O-033 untuk domain bisnis tetap `OPEN/BLOCKING`.
Pemilik proyek memilih seluruh rekomendasi D-2…D-8 di `docs/54` dan menetapkan D-7: kanal pengiriman = email dan WhatsApp, mana yang tersedia (keduanya dipakai bila terkonfigurasi). Detail dan tabel keputusan: `docs/54` §6a. Implementasi: `docs/55`.

## Keputusan proyek — aktivasi dan pemulihan dengan OTP — 6 November 2026

Status: `DECIDED` (pemilik proyek). Pembuatan pengguna tetap lewat web oleh administrator; **aktivasi awal** dan **akun terblokir/lupa password** memakai OTP email/WhatsApp. Menggantikan bagian "password awal" di `docs/16` (dicatat di `docs/18`). Parameter: OTP 6 digit, berlaku 10 menit, 5 tebakan salah membatalkan kode, jeda kirim ulang 60 detik, maksimal 5 permintaan/jam per alamat email, satu kode aktif per pengguna dan tujuan. Akun baru berstatus `PENDING_ACTIVATION` tanpa password. Akun `SUSPENDED`/`INACTIVE` tidak dapat memakai OTP (keputusan administrator). Lihat `docs/55`, `docs/56`.
Temuan teknis yang diperbaiki bersamaan: pembatas laju tanpa nama (`throttle:N,1`) berbagi satu penghitung per IP untuk semua rute (login, ganti password, OTP saling mengunci); diganti pembatas bernama per tujuan.

## Keputusan proyek — otorisasi master data — 6 November 2026

Status: `DECIDED` (pemilik proyek menerima usulan). `ENGINEERING` dan `PERENCANAAN` mengelola master data (import material, kategori, satuan, KHS draf); `UP3_MANAGER` menyetujui versi KHS aktif, selalu orang berbeda dari pembuat; membaca: 11 role bisnis; `SYS_ADMIN`/`UP3_ADMIN`/`VENDOR` tanpa hak. Data bersifat pusat (tanpa scope unit). Detail dan batas implementasi: `docs/58`.
Catatan jujur: key `master_data.*`, `materials.*`, `khs.*` hanya mencakup scope master data; O-033 untuk domain lain tetap `OPEN`.


## Keputusan proyek — jenis konstruksi, cakupan, dan unit organisasi — 6 November 2026

Status: `DECIDED` (pemilik proyek). (1) Jenis konstruksi tidak punya kode resmi → kode internal `<KELOMPOK>-<NN>`; kode material = kode ERP; kode KHS = angka seperti di Excel. (2) Cakupan 7 kelompok (SUTM, MVTIC, SUTR, SKTM, KUBIKEL, GTT_UMUM, GTT_KHUSUS); SKTR, SKSR, GD PSG DLM tidak dipakai untuk saat ini; PBPD iterasi terpisah. (3) Pembulatan workbook dipertahankan (K-3). (4) Tanggal berlaku KHS/jenis konstruksi ditetapkan admin saat impor (K-4). (5) D-4 opsi A ditegaskan ulang: hanya `SYS_ADMIN` membuat/mengubah unit organisasi; `UP3_ADMIN` tidak; akun SYS_ADMIN dibuat lewat `distriva:bootstrap-admin --role=SYS_ADMIN`. Flag `DISTRIVA_SYSTEM_WRITES_REQUIRE_MFA` dikembalikan `true` oleh pemilik. Tes dikunci ke `true` di `phpunit.xml`.

## Keputusan proyek — SYS_ADMIN role penuh dan MFA — 6 November 2026

Status: `DECIDED` (pemilik proyek). Menggantikan: "SYS_ADMIN tidak punya akses bisnis" (docs/03, docs/16) untuk **master data**. SYS_ADMIN kini memegang seluruh key master data (lihat, kelola, setujui). Pengaman: (1) **MFA TOTP (RFC 6238) wajib** — token SYS_ADMIN hanya dapat memakai `/auth/mfa/*`, `/me`, logout, ganti password sampai diverifikasi; kode pemulihan sekali pakai; kode TOTP tidak dapat diputar ulang; 5 kode salah mengunci faktor 15 menit; reset hilang perangkat lewat konsol `distriva:mfa-reset`. (2) Pembuat ≠ penyetuju tetap (API dan CHECK database). (3) Flag `DISTRIVA_SYSTEM_WRITES_REQUIRE_MFA=true` (bawaan) = MFA ditegakkan; `false` hanya untuk pengembangan. Menutup D-3/D-4 bagian "menunggu MFA". Hanya SYS_ADMIN yang membuat/mengubah unit (D-4 A).

## Keputusan proyek — status permohonan PB/PD, sinkronisasi EIS, dan impor — 6 November 2026

Status: `DECIDED` (pemilik proyek). (1) Pemetaan status EIS → internal: DISETUJUI→APPROVED, SUDAH BAYAR→PAID, CETAK PK→PK_PRINTED, PDL AWAL→CONNECTION_IN_PROGRESS, PEREMAJAAN→CONNECTION_DONE, BATAL→CANCELLED, RESTITUSI→REFUNDED. (2) Input manual: DRAFT; No. Agenda terisi → APPROVED. (3) **Menggantikan** aturan "sinkronisasi hanya 3 kolom" (docs/16): jika No. Agenda sudah ada, sinkronisasi otomatis boleh memperbarui IDPEL, nama, alamat, tarif, daya, dan data lain yang dibutuhkan (dengan log perubahan). (4) Satuan daya sumber = VA; `UNITTUJUAN` = kode unit; hanya PASANG BARU dan PERUBAHAN DAYA; impor oleh NIAGA_RETAIL (ULP-nya) / SYS_ADMIN. Detail: docs/62 §7.
