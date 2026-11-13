# 41 — O-041 RAB, KKF, dan Feasibility Lifecycle

**Design baseline:** v3.8.0; **latest owner-review recommendation:** v3.11.0, 5 November 2026; **register synchronization:** v3.14.0, 5 November 2026  
**Status issue:** `OPEN / BLOCKING`  
**Status dokumen:** prinsip dan approval yang sudah tercatat dipertahankan; actor dan schema lanjutan tetap `PROPOSED/OPEN`.

Owner Decision Register ada di [dokumen 44](./44-OWNER-DECISION-REGISTER.md). Isian OD-041 yang belum memiliki bukti keputusan owner tetap `PENDING`; baseline KKF approvals dan calculation snapshots tetap berlaku.

**Pembaruan v3.14.0:** klarifikasi akhir menyatakan tidak ada rencana mengganti approval matrix existing; baseline di bawah tetap digunakan. Redaksi awal yang dapat terbaca sebagai usulan pembagian approver berbeda tidak diadopsi sebagai keputusan. Karena identitas/kewenangan pemberi konfirmasi dan bukti formal belum disertakan, konfirmasi dicatat di register 44 sebagai `PENDING` untuk verifikasi formal, bukan sebagai keputusan baru atau perubahan matrix. O-041 tetap `OPEN / BLOCKING`; aktor/peran kalkulasi dan review, lineage, harga/UOM, serta feasibility masih memerlukan penyelesaian terpisah.

## 1. Ringkasan

Dokumentasi telah menetapkan prinsip snapshot perhitungan, sumber harga, dan approval KKF. Belum ditetapkan siapa yang menjalankan/review kalkulasi RAB atau KKF, apakah RAB memerlukan approval mandiri, bagaimana satu KKF mengunci run RAB tertentu, serta actor/lifecycle/cardinality feasibility dan relasinya terhadap KKF. O-041 tetap `OPEN / BLOCKING`.

## 2. RAB calculation

### 2.1 Yang sudah ditetapkan

- RAB menghitung material, jasa dan biaya relevan dengan pembulatan hanya pada total akhir.
- Calculation history menyimpan snapshot versi master dan parameter (D-024).
- Harga RAB berasal dari sumber eksternal resmi sesuai jenis; sumber, nilai dan snapshot pada calculation run disimpan (D-021).
- T4.2.2 mendukung jalur harga eksternal dan internal per-UP3 melalui `material_prices`, dengan `price_type`/`source_type` dibedakan; prioritas pemilihan harga final masih OPEN (D-MDM-001).
- Master material/SKU, UOM, KHS dan BOM direuse dari T4.2.2. Jangan buat master kedua; SKU ERP satu record per varian.
- Versi BOM/KHS approved immutable; perubahan berdampak quantity/spec memicu hitung ulang sesuai workflow drawing/MTO.
- Belum ada keputusan approval RAB mandiri; jangan membuat approval hanya karena calculation run selesai.

### 2.2 Process/lifecycle candidate

`QUEUED -> RUNNING -> SUCCEEDED | FAILED`; perubahan input menghasilkan run baru dan dapat menandai output sebelumnya `SUPERSEDED` hanya jika aturan/current pointer disetujui. Status run teknis berbeda dari status approval bisnis.

| Tahap | Actor | Keputusan |
|---|---|---|
| Siapkan/validasi input | Actor belum final | Rujuk application, drawing/MTO, BOM/KHS dan harga valid |
| Jalankan perhitungan | `OPEN — ROLE/ACTOR NOT FINALIZED` | Runner / permission belum ditetapkan |
| Review output | `OPEN — ROLE/ACTOR NOT FINALIZED` | Kebutuhan dan kedalaman review belum diputuskan |
| Approve RAB mandiri | Belum ada | Tidak boleh diasumsikan; perlu keputusan apakah RAB disetujui sendiri atau menjadi input workflow KKF/WO |
| Recalculate | Run baru | Snapshot historis tidak diubah; trigger & permission masih perlu ditetapkan |

### 2.3 Snapshot/version contract

Untuk reproducibility, satu run perlu mereferensikan/snapshot:

- application + ULP dan PB/PD inputs;
- drawing/MTO package/version/snapshot dan item yang digunakan;
- BOM/KHS identity/version serta formula;
- `material_id`, SKU, unit, conversion rule yang disetujui;
- setiap harga terpilih: nilai, currency, `price_type`, source, UP3/global scope, validity, source document/batch/version;
- jasa/kontrak/zona dan parameter pajak/biaya yang berlaku;
- engine version, formula/configuration version, rounding policy;
- deterministic input/result snapshot hashes dan detail line/result.

Approved/historic run tidak boleh diperbarui ketika harga/master berubah; kalkulasi baru menghasilkan run baru. Jangan mengarang UOM FK ke `materials`: T4.2.2 masih mempertahankan `materials.unit VARCHAR(30)` sampai normalisasi ERP disetujui. Rekonsiliasi itu adalah syarat schema O-034.

### 2.4 Relation boundary

- Application → RAB run: proposal 35 mengusulkan satu/multiple runs per application; run number per application. Historical runs harus tetap dapat ditelusuri.
- RAB run → BOM/material/price: snapshot/references ke sumber yang dipakai, tidak menyalin master.
- RAB → KKF: versi RAB yang dipakai oleh KKF harus jelas; apakah satu run atau beberapa skenario masih OPEN.
- RAB → WO: WO wajib mengikat versi input yang approved sesuai dokumen 16; detail FK dan apakah RAB selalu wajib per WO harus diselaraskan pada O-039.
- RKM bukan approval RAB dan tidak memicu procurement/WO.

## 3. KKF calculation dan approval

### 3.1 Approval matrix — jangan diubah

| Kondisi | Approver wajib | Rule |
|---|---|---|
| Normal, PBP ≤5 tahun | `ASMAN_PERENCANAAN` AND `ASMAN_KONSTRUKSI` | Dua user berbeda |
| PBP >5 tahun | `ASMAN_PERENCANAAN` AND `ASMAN_NIAGA` AND `ASMAN_KONSTRUKSI` AND `UP3_MANAGER` | Empat user berbeda; justifikasi tertulis |
| Semua | Submitter vs final approval | Submitter tidak boleh final-approve versinya |

`UP3_MANAGER` bukan approver KKF normal. Dispensasi >5 tahun tidak mengubah hasil NPV/IRR/PBP. Approval terikat pada versi KKF; perubahan relevan memerlukan submission/approval ulang.

### 3.2 Lifecycle calculation vs decision

Pisahkan status teknis calculation (`QUEUED/RUNNING/SUCCEEDED/FAILED`) dari status versi bisnis (`DRAFT/SUBMITTED/UNDER_REVIEW/RETURNED/APPROVED/REJECTED/SUPERSEDED`). Nama status tetap kandidat kecuali approval matrix dan immutability rules yang telah tertulis.

| Tanggung jawab | Status actor |
|---|---|
| Menyiapkan input | Belum ditetapkan |
| Menjalankan KKF | Belum ditetapkan |
| Reviewer awal | Belum ditetapkan |
| Approver normal/PBP>5 | Role approved pada matrix |
| Return/reject/cancel | Transition actor/effect belum final |

### 3.3 Snapshot/lineage

KKF version harus dapat diulang dan mengikat setidaknya application inputs, selected RAB run(s), tarif, jam nyala, BPP, harga/kontrak, BOM/KHS, parameters, formula/engine/template, periode dan basis feasibility bila digunakan. Snapshot approval mengikat version dan hash. Parameter/formula historis tidak boleh berubah. Nilai teknis/methodology dan batas PBP tetap tunduk pada validasi dokumen resmi yang dicatat di docs 08/16.

**OPEN:** definisi batas PBP tepat 5 tahun; input, formula, rounding/regulatory value; apakah KKF memerlukan satu RAB run atau beberapa scenario; siapa runner/reviewer; workflow return/reject/cancel.

## 4. Feasibility study

### 4.1 Yang sudah ada

- `applications.requires_feasibility_study` tersedia di rancangan T4.2.3.
- Studi kelayakan bersifat kondisional; tidak semua PB/PD otomatis memerlukan studi.
- T4.2.3 memiliki status field dan dokumen 35 mengusulkan feasibility aggregate/version/decision records; proposal bukan schema approved.

### 4.2 Pertanyaan yang tetap OPEN

- Trigger formal untuk `requires_feasibility_study`, otoritas mengubah flag, serta kondisi wajib.
- Apakah satu application dapat memiliki beberapa studi/scenario atau hanya satu aggregate dengan versi.
- Actor penyusun, calculation runner, reviewer teknis/finansial dan approver.
- Apakah approval formal diperlukan, dan apakah approver mengikuti KKF matrix atau workflow terpisah.
- Apakah KKF harus mengacu pada version/result feasibility yang approved; apakah reference tunggal, banyak scenario, atau snapshot.
- Recalculation/revision/return/reject/cancel semantics dan effect pada KKF/RAB/approval terdahulu.

### 4.3 Rekomendasi `PROPOSED`

Jadikan feasibility sebagai aggregate/version terpisah yang hanya diwajibkan jika flag dan business condition yang disetujui terpenuhi; ikat KKF ke exact approved feasibility version/result bila keputusan pemilik proses menyatakan hasil itu input KKF. Jangan memilih actor atau memakai approval KKF sebagai approval feasibility tanpa persetujuan. Persistasikan snapshot/hash per versi dan jangan menimpa keputusan lama.

## 5. Calculation responsibility matrix

| Action | RAB | KKF | Feasibility |
|---|---|---|---|
| Prepare input | `OPEN` | `OPEN` | `OPEN` |
| Run/calculate | `OPEN` | `OPEN` | `OPEN` |
| Review | `OPEN` | `OPEN` | `OPEN` |
| Return/revise | Workflow/actor belum final | Workflow/actor belum final; same-version approval rule | Workflow/actor belum final |
| Approve | Approval mandiri tidak diputuskan | Matrix approved di atas | Belum ditetapkan |
| Export | Export permission terpisah per domain; source scope inherited | Sama | Sama |

Tidak ada permission key final. Role/assignment scope harus memakai catalog role yang disetujui dan `user_role_assignments`; keys/grants menunggu O-033.

## 6. Keputusan pemilik proses yang diperlukan

1. Tetapkan runner, preparer, reviewer RAB dan apakah ada approval mandiri beserta trigger.
2. Tetapkan source-of-price selection priority/authority dan aturan ketika kandidat harga ganda/tidak ada.
3. Rekonsiliasi material UOM/konversi ERP, snapshot harga serta validitas satuan.
4. Tetapkan runner/reviewer KKF dan kaitan exact RAB run(s) terhadap KKF version.
5. Sahkan PBP boundary, formula/input/parameter dan transition return/reject/cancel.
6. Tetapkan kondisi feasibility, cardinality, actor, approval, relasi KKF dan revision effects.
7. Pastikan setiap version/approval mengikat snapshot/hash dan source lineage yang immutable.

O-041 tetap `OPEN / BLOCKING`. Approval KKF yang sudah disepakati tidak membuka izin migration atau menetapkan runner/reviewer.

## 7. Paket rekomendasi untuk persetujuan owner — v3.11.0

Status: `READY FOR OWNER APPROVAL`; tidak mengubah KKF approval matrix yang sudah disetujui. Seluruh aktor, priority dan transition baru berstatus `PROPOSED`.

### 7.1 RAB and KKF responsibility recommendation

| Tanggung jawab | Rekomendasi actor | Rule |
|---|---|---|
| Menyiapkan input RAB/KKF | `TEKNIK` ULP untuk MTO/application evidence; `PERENCANAAN` UP3 untuk parameter finance | Hanya input persisted/approved; perubahan input menghasilkan run baru. |
| Menjalankan RAB dan KKF | `PERENCANAAN` UP3 | Runner permission berbeda dari approval; run snapshot dan calculation engine version wajib. |
| Review RAB/KKF | `ASMAN_PERENCANAAN` | Reviewer memeriksa reproducibility, input/parameter, exception; distinct dari runner direkomendasikan. |
| RAB standalone approval | Tidak diperlukan secara default | RAB adalah calculation output/input KKF/WO; jangan menambah approval stage tanpa owner mandate. |
| KKF final approval | Existing matrix | Normal: `ASMAN_PERENCANAAN` AND `ASMAN_KONSTRUKSI`; PBP >5 tahun menambahkan `ASMAN_NIAGA` AND `UP3_MANAGER`; semua user berbeda dan submitter bukan final approver. |
| Return/reject | `ASMAN_PERENCANAAN` untuk input/calculation correction; final approver matrix untuk business rejection | Reasoned return/rejection; versi dan run lama tetap immutable. |

RAB menghasilkan banyak calculation runs per application dan tiap run memiliki unique sequence serta immutable `input_snapshot`, `result_snapshot`, hash, engine/formula/config version, actor/time. Setiap KKF version mengunci tepat satu approved RAB run sebagai baseline; skenario perbandingan harus berupa scenario records yang masing-masing menunjuk satu run, bukan mengganti referensi diam-diam. Jika owner memilih multi-run consolidation, explicit allocation/aggregation rules harus disahkan terlebih dahulu.

KKF lifecycle recommendation: `DRAFT -> CALCULATED -> SUBMITTED -> UNDER_REVIEW -> (RETURNED -> new version -> SUBMITTED) -> APPROVED/REJECTED`; calculation job state (`QUEUED/RUNNING/SUCCEEDED/FAILED`) dipisahkan dari business status. PBP >5 branch wajib seluruh 4 approvals distinct; approval melekat pada exact version/hash. Batas 5 tahun dan formula tetap mengikuti authoritative business decision dan tidak boleh ditafsirkan ulang oleh aplikasi.

### 7.2 Feasibility recommendation

- Trigger hanya ketika `applications.requires_feasibility_study=true` sesuai rule resmi; perubahan flag harus menyimpan actor/reason/source.
- Satu application dapat memiliki beberapa scenario per study version, masing-masing versioned dan pinned to exact application/RAB input; satu KKF version menunjuk tepat satu approved feasibility scenario jika feasibility menjadi prasyarat KKF.
- `PERENCANAAN` menyiapkan/menjalankan; `ASMAN_PERENCANAAN` review dan memutuskan acceptance/return. Usulan ini menggunakan role yang ada, tetapi kewenangan formal perlu owner sign-off.
- Feasibility lifecycle: `DRAFT -> CALCULATED -> SUBMITTED -> UNDER_REVIEW -> ACCEPTED`; return membuat version baru; reject/cancel hanya dengan reason dan aturan resubmit. Recalculation selalu membuat immutable result baru.
- Discount Rate adalah threshold yang dipakai untuk NPV/kelayakan sesuai baseline dokumen 08/16; RWACC hanya indikator dan tidak menggantikan Discount Rate. Tidak menyetujui threshold RWACC baru.

### 7.3 Pricing/UOM recommendation

Deterministic selection proposal untuk diratifikasi:
1. Untuk `material_id + price_type + UP3 + calculation date + UOM` yang sama, gunakan satu record `APPROVED/ACTIVE` internal UP3 yang valid bila tepat satu tersedia.
2. Jika tidak ada internal UP3 candidate, gunakan satu external official candidate yang valid untuk jenis harga yang sama.
3. Jika tidak ada atau lebih dari satu candidate otoritatif pada prioritas yang sama, block/hold calculation dan minta data resolution; tidak ada silent fallback, sum, atau arbitrary latest-price selection.
4. Seluruh input selected price, source, source reference, scope, validity dates, currency, UOM/conversion, master version, and rule version disimpan dalam run snapshot.

UOM: ERP unit code adalah source value; map hanya melalui exact validated ERP code to `units_of_measure`. Konversi hanya melalui approved, material-specific, effective-dated factor. Rekomendasi: `UP3_MANAGER` menyetujui conversion/master mapping setelah data steward memvalidasi sumber ERP; role mapping memerlukan owner approval. Unmapped/ambiguous/incompatible unit blocks the calculation. Jangan menebak berdasar label atau mengubah `materials.unit VARCHAR(30)` menjadi FK sebelum source mapping disetujui.

### 7.4 Alternative, impacts, and approval

- Harga alternatif: (A) internal UP3 wins then external fallback (recommended for local applicability); (B) external official always wins; (C) explicit per-calculation selection by authorized operator with reviewer approval. Pilihan berdampak langsung pada nilai RAB/KKF dan harus disahkan pemilik proses finance/procurement/material.
- UOM alternatif: reject unmapped (recommended fail-closed) atau allow manual conversion only after documented approval. Fail-closed mencegah kalkulasi unit mismatch.
- Risiko tanpa keputusan: RAB/KKF/feasibility tidak boleh dinyatakan authoritative; migration field constraints cannot be finalized.
- O-041 remains `OPEN/BLOCKING` until owner evidence, official parameter/source records, and relation/cardinality decisions are recorded.
