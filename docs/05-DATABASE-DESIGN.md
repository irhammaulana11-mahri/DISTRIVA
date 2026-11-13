# 05 — Database Design

## 1. Konvensi

- PostgreSQL.
- UUID primary key untuk tabel inti.
- Nama tabel plural snake_case.
- Timestamp `created_at`, `updated_at`; gunakan `deleted_at` hanya jika soft delete memang sesuai.
- Foreign key eksplisit dan indeks untuk kolom pencarian/filter.
- Nilai uang menggunakan `numeric(18,2)` atau presisi yang ditentukan; hindari float.
- Kuantitas material menggunakan `numeric(18,4)` agar meter dan pecahan satuan dapat ditangani.
- Satuan harus disimpan sebagai master, bukan teks bebas.
- Waktu disimpan konsisten (UTC di server); tanggal berlaku bisnis menggunakan tanggal lokal yang jelas.

## 2. Domain dan tabel

### A. Organisasi dan akses
- `up3`: `id`, `code`, `name`, `service_zone_id`, `is_active`.
- `ulps`: `id`, `up3_id`, `code`, `name`, `is_active`.
- `users`: data autentikasi.
- `user_units`: `user_id`, `unit_type`, `unit_id`, `is_primary`.
- `roles`, `permissions`, pivot Spatie.

### B. Pelanggan dan permohonan
- `customers`: `id`, `idpel`, `name`, alamat, tarif, daya, metadata terbatas.
- `customer_sync_logs`: sumber, external id, waktu, status, ringkasan error.
- `applications`: `id`, `up3_id`, `ulp_id`, `customer_id`, `agenda_no`, `application_type`, `submitted_at`, `status`, `source`, `created_by`.
- `application_surveys`: `application_id`, tanggal, petugas, hasil, koordinat/alamat sesuai kebijakan.
- `application_notes`: catatan dan visibility.
- `application_status_histories`: status lama/baru, aktor, alasan, waktu.

### C. Gambar dan dokumen
- `drawings`: identitas gambar per permohonan.
- `drawing_versions`: nomor versi, status, file id, checksum, revision note, uploader.
- `drawing_items`: jenis konstruksi, kode konstruksi, jumlah pasang/bongkar, unit, atribut.
- `attachments`: metadata file, storage key, MIME, checksum, ukuran, pemilik, relasi polymorphic atau relasi eksplisit.

### D. Master konstruksi, material, harga, BOM
- `construction_types`: kode, nama, kategori, status.
- `material_categories`: kategori material.
- `units`: kode satuan.
- `materials`: kode material, nama, kategori, satuan dasar, `inventory_scope`, status.
- `material_specifications`: material variant attributes; atau atribut spesifikasi terstruktur sesuai keputusan final.
- `khs_items`: kode KHS, uraian, satuan, berat, sumber awal.
- `bom_versions`: nomor versi, tanggal berlaku, status, sumber.
- `bom_items`: versi BOM, construction type, KHS/material, koefisien, basis, waste factor, aturan pembulatan.
- `contracts`: nomor, tanggal, masa berlaku, status, file sumber.
- `material_prices`: contract, KHS/material, harga dasar, transport, total, sumber.
- `service_prices`: contract, KHS, zona, harga pasang, harga bongkar.
- `service_zones`: kode dan nama zona; satu zona aktif ditetapkan per UP3.

### E. Tarif dan KKF
- `tariff_versions`: versi dokumen penetapan, nomor, tanggal, periode berlaku.
- `tariff_details`: golongan, rentang daya, jenis tarif, reguler/prabayar/LWBP/WBP, faktor, RM type, valid dates.
- `monthly_sales_reports`: ULP, periode, file, uploader, version.
- `monthly_sales_rows`: golongan, rentang daya, jam nyala, kWh, nilai sumber yang relevan.
- `ujl_rates`: golongan, rentang daya, Rp/VA, periode berlaku.
- `kkf_parameter_versions`: BPP, OM, susut, faktor beban, ROE, bunga, pajak, tahun proyeksi, parameter lain.
- `calculation_runs`: permohonan, drawing_version, run number, status, user, timestamps.
- `calculation_snapshots`: JSONB snapshot seluruh master/input/parameter/version ids.
- `rab_details`, `rab_summaries`, `kkf_results`, `feasibility_results`, `cashflow_details`, `calculation_documents`.

### F. Approval dan konstruksi
- `approval_requests`, `approval_steps`, `approval_histories`.
- `drawing_revisions`.
- `vendors`, `vendor_assignments`.
- `work_orders`, `work_progress`, `work_documents`, `material_usages`.

### G. Inventory
- `warehouses`: UP3/ULP, unit owner, code, status.
- `stock_movements`: warehouse, material, movement type, qty, source document, actor, timestamp.
- `stock_balances`: warehouse/material, on_hand, reserved, version/updated_at (cache/projection; ledger tetap sumber audit).
- `stock_transfers`, `stock_transfer_items`.
- `material_allocations`, `material_allocation_items`, `material_allocation_histories`.
- `stock_opname_sessions`, `stock_opname_items` (tahap lanjutan).

### H. Forecast dan RKM
- `historical_demand`: periode, UP3, ULP, tipe pekerjaan, jumlah aktual permohonan/pekerjaan, sumber.
- `forecast_models`: algoritma, konfigurasi, versi, metrik training.
- `forecast_runs`: scope, periode, horizon, model, run date, status.
- `forecast_work_results`: tipe pekerjaan, periode prediksi, nilai prediksi, lower/upper.
- `forecast_material_results`: material, periode, kebutuhan hasil BOM, stok dan gap (snapshot).
- `rkm_plans`: UP3, tahun, periode, versi, status, creator.
- `rkm_plan_details`: material/pekerjaan, ULP, qty usulan, forecast reference, stock context, final qty.
- `rkm_adjustments`: perubahan qty, alasan, aktor.
- `rkm_approvals`: keputusan, approver, waktu, catatan.
- `forecast_evaluations`: aktual vs forecast, MAE, RMSE, MAPE/WAPE dan catatan.

## 3. Relasi utama

- `up3 1—N ulps`
- `up3 1—N warehouses`; `ulp 1—N warehouses` untuk gudang ULP.
- `customers 1—N applications`
- `applications 1—N drawings`; `drawings 1—N drawing_versions`
- `drawing_versions 1—N calculation_runs`
- `calculation_runs 1—1 calculation_snapshots` dan `1—N rab_details`
- `construction_types 1—N bom_items`
- `bom_versions 1—N bom_items`
- `materials 1—N stock_movements` dan `1—N stock_balances`
- `forecast_runs 1—N forecast_work_results` dan `1—N forecast_material_results`
- `rkm_plans 1—N rkm_plan_details`; `rkm_plans 1—N rkm_approvals`

## 4. Constraints penting

- Unique `idpel` hanya jika aturan bisnis memastikan satu record customer per IDPEL; jika tidak, gunakan unique dengan status/validity yang sesuai.
- Unique `applications.agenda_no` dalam scope yang ditetapkan.
- Tidak boleh ada periode harga/tarif aktif yang tumpang tindih pada key yang sama.
- `qty > 0` untuk mutasi normal; koreksi stok memakai movement type khusus.
- Tidak boleh stok negatif kecuali kebijakan eksplisit mengizinkan.
- ULP stock movement dibatasi pada material yang eligible.
- Snapshot calculation tidak boleh diubah setelah final.
- RKM yang sudah disetujui tidak diedit langsung; perubahan membuat versi/amendment baru.
- Semua approval dan stock movement harus memiliki actor dan sumber dokumen.

## 5. Catatan desain

Daftar di atas adalah logical schema, bukan migration final. Sebelum membuat migration, finalkan atribut wajib, enumerasi status, relasi file, model spesifikasi material, aturan multi-warehouse, dan kebijakan stok negatif. Hindari menyimpan seluruh detail transaksi hanya di JSONB; JSONB digunakan untuk snapshot/audit, sementara data operasional penting tetap memiliki kolom dan relasi normal.

## Catatan rekonsiliasi T4 wajib

Skema database dalam dokumen ini adalah blueprint awal, bukan skema final. Sebelum migration dibuat, rekonsiliasikan dengan keputusan terbaru: organisasi hierarkis `organizational_units`, `user_role_assignments` multi-role/multi-unit, external material system sebagai source of truth (hapus asumsi ledger/saldo/transfer internal), document versioning, Auto MTO package/version, task/SLA, approval paralel, audit immutable, integration logs, dan configuration versioning. Jangan menjalankan migration v1 ke produksi tanpa review. Rincian keputusan ada di dokumen 16 dan 17.


## 3. Fondasi organisasi dan akses — rancangan T4.2 (draft 5 November 2026)

Bagian domain organisasi pada blueprint awal yang menyebut tabel terpisah `up3`, `ulps`, dan `user_units` adalah model konseptual lama. Acuan keputusan bisnis terbaru adalah satu tabel hierarkis `organizational_units` dan tabel `user_role_assignments`. Jangan membuat tabel `up3`/`ulps` terpisah tanpa keputusan perubahan.

### 3.1 `organizational_units`

Kolom draft: `id UUID PK`, `code VARCHAR(30) UNIQUE`, `name VARCHAR(150)`, `unit_type` (`UP3`/`ULP`), `parent_id UUID NULL FK` ke tabel yang sama, `address TEXT NULL`, `is_active BOOLEAN`, `created_at`, `updated_at`. UP3 wajib tanpa parent; ULP wajib memiliki parent bertipe UP3. Karena validasi tipe parent melibatkan baris lain, gunakan validasi service transaksional dan/atau trigger PostgreSQL; `CHECK` biasa tidak cukup. Unit yang memiliki histori/transaksi dinonaktifkan, bukan dihapus.

### 3.2 `organizational_unit_histories`

Draft kolom: `id UUID PK`, `organizational_unit_id UUID FK`, nilai unit sebelum/sesudah untuk `code`, `name`, `unit_type`, `parent_id`, dan `is_active`, `reason`, `changed_by UUID FK users`, `changed_at TIMESTAMPTZ`. Kode resmi PLN adalah business key; UUID tetap PK. Riwayat perubahan harus terlindungi dari perubahan/penghapusan oleh pengguna aplikasi biasa.

### 3.3 `users`

Draft kolom: `id UUID PK`, `nip VARCHAR(30) NULL UNIQUE`, `name VARCHAR(150)`, `email VARCHAR(150) UNIQUE`, `phone VARCHAR(30) NULL`, `password VARCHAR(255)`, `account_status`, `must_change_password`, `email_verified_at`, `last_login_at`, timestamps. NIP opsional; unique constraint PostgreSQL mengizinkan banyak NULL namun menolak nilai NIP duplikat. Status akun: `PENDING_ACTIVATION`, `ACTIVE`, `SUSPENDED`, `INACTIVE`.

### 3.4 Role dan assignment — T4.2.1

Opsi A / Custom Scoped Assignment telah disetujui. `user_role_assignments` adalah satu-satunya sumber kebenaran penugasan role pengguna; Spatie mengelola katalog `roles`, `permissions`, dan `role_has_permissions`. Permission efektif berasal dari role pada assignment yang valid. `roles.requires_unit_scope=false` hanya untuk `SYS_ADMIN`; 13 role lainnya wajib memiliki unit. Assignment: UUID PK, `user_id UUID FK`, `role_id BIGINT FK`, `organizational_unit_id UUID NULL FK`, `valid_from DATE`, `valid_until DATE NULL`, `is_active`, `assigned_by UUID NULL FK users`, `assignment_document`, timestamps. Assignment dicabut dengan status/masa berlaku, bukan dihapus.

`user_role_assignment_histories` menyimpan append-only event assignment dengan assignment FK, jenis perubahan, JSONB before/after, reason, actor user, optional actor assignment context, dan timestamp. Assignment dan histori perubahan ditulis dalam transaksi yang sama; snapshot tidak menyimpan credential/secret.

`authorization_change_histories` menyimpan perubahan status akun, metadata role, permission catalog, serta grant/revoke role-permission. Target terhubung melalui nullable FK user/role/permission yang kombinasi nullability-nya dibatasi menurut `event_type`; audit ditulis atomik dan append-only. Histori struktur unit tetap disimpan di `organizational_unit_histories`.

### 3.5 UUID dan kompatibilitas Spatie/Sanctum

Entitas bisnis dan `users` memakai UUID. Master `roles` dan `permissions` memakai BIGINT; `role_has_permissions` menghubungkan role dan permission. Migration Spatie harus disesuaikan agar hanya membuat katalog serta relasi role-permission; `model_has_roles` dan `model_has_permissions` tidak dibuat. `User` tidak memakai trait `HasRoles`, Spatie Teams tidak digunakan, dan `register_permission_check_method` dinonaktifkan agar resolver default tidak menjadi jalur otorisasi kedua. Laravel Policy memanggil service DISTRIVA untuk memeriksa assignment, permission, dan scope.

Baseline yang dipasang: Laravel 13.40.0, Sanctum 4.3.3, Spatie Permission 8.3.2, guard `web`; migration custom hanya membuat katalog dan role-permission pivot. Sanctum migration memakai UUID morph key. Unit tests memverifikasi konfigurasi/model, tetapi token UUID end-to-end masih perlu diuji pada PostgreSQL.

### 3.6 Constraint, indeks, dan aturan integritas final T4.2.1

**Organisasi**
- `organizational_units.code` unique; `unit_type` dibatasi `UP3`/`ULP`.
- `UP3` wajib `parent_id IS NULL`; `ULP` wajib memiliki parent.
- FK `parent_id` self-reference menggunakan `ON DELETE RESTRICT`.
- Karena tipe parent harus diperiksa lintas baris, validasi parent UP3 untuk ULP dilakukan oleh service transaksional dan trigger PostgreSQL (atau mekanisme setara yang diuji). `CHECK` biasa tidak dapat memeriksa tipe baris parent.
- Tambahkan indeks `organizational_units(parent_id)` dan `organizational_units(unit_type, is_active)`.
- Unit yang sudah direferensikan transaksi/assignment tidak dihapus; nonaktifkan dan simpan histori.

**Pengguna**
- `users.email` unique; normalisasi email ke lowercase pada aplikasi dan/atau unique index pada `lower(email)`.
- `users.nip` nullable dan unique bila diisi; gunakan unique index parsial `WHERE nip IS NOT NULL` atau unique biasa PostgreSQL yang mengizinkan beberapa NULL.
- Status akun dibatasi ke `PENDING_ACTIVATION`, `ACTIVE`, `SUSPENDED`, `INACTIVE`.
- Jangan menyimpan password plaintext, OTP, token, atau secret di audit log.

**Role assignment**
- FK `user_id`, `role_id`, `organizational_unit_id`, dan `assigned_by` memakai `ON DELETE RESTRICT` (untuk `assigned_by`, kebijakan nullifikasi dapat dipertimbangkan jika akun aktor harus dihapus; akun operasional sebaiknya dinonaktifkan, bukan dihapus).
- `valid_from` wajib; `valid_until` nullable; jika terisi harus `valid_until >= valid_from`.
- Assignment operasional harus memiliki unit; `SYS_ADMIN` boleh tanpa unit. Validasi kecocokan `roles.requires_unit_scope` dengan nullability unit harus dijalankan di service transaksional dan diperkuat trigger PostgreSQL agar tidak dapat dilewati lewat jalur tulis lain.
- Hanya assignment dengan `is_active = true` dan tanggal saat ini berada dalam rentang berlaku yang efektif. `is_active=false` mencabut assignment tanpa menghapus histori.
- Indeks pencarian: `(user_id, is_active)`, `(organizational_unit_id, is_active)`, `(role_id, is_active)`, serta `(user_id, organizational_unit_id)`.
- Cegah rentang assignment tumpang tindih untuk kombinasi user-role-unit. Rekomendasi PostgreSQL: aktifkan extension `btree_gist`, lalu exclusion constraint menggunakan `user_id WITH =`, `role_id WITH =`, `organizational_unit_id WITH =`, dan `daterange(valid_from, COALESCE(valid_until, 'infinity'::date), '[]') WITH &&` untuk assignment berscope, dengan predicate `WHERE (is_active = true)`. Untuk assignment global (unit NULL), gunakan exclusion constraint terpisah tanpa dimensi unit dan predicate yang sama. Pastikan strategi mengizinkan assignment baru setelah assignment lama berakhir; status aktif dan tanggal berlaku tetap dievaluasi oleh service.
- `assignment_document` menyimpan nomor/referensi dokumen penugasan sampai relasi ke modul dokumen resmi ditetapkan; jangan mengarang FK ke tabel dokumen yang belum dirancang.
- Simpan setiap create/update/deactivate assignment ke `user_role_assignment_histories` di transaksi yang sama, termasuk actor assignment context bila tersedia.
- Catat perubahan status akun dan permission catalog/role mapping pada `authorization_change_histories`; catat perubahan kode/nama unit pada `organizational_unit_histories`.

**Riwayat organisasi**
- `organizational_unit_histories` menyimpan perubahan kode, nama, tipe, parent, dan status aktif sebelum/sesudah beserta alasan, aktor, dan waktu. Aplikasi tidak menyediakan operasi edit/hapus histori; akses tulis hanya melalui service perubahan organisasi. Trigger/audit tambahan dapat dipakai untuk memperkuat immutability.

### 3.7 Strategi otorisasi Opsi A (Custom Scoped Assignment)

1. Akun selain `ACTIVE` tidak memperoleh akses operasional.
2. `ScopedAuthorizationService` mengambil assignment yang aktif dan berlaku pada tanggal bisnis (Asia/Jakarta), permission role melalui `role_has_permissions`, serta unit organisasi yang aktif.
3. Laravel Policies check permission and target-resource scope; list queries apply scope before pagination. A permission-only check without a target context does not authorize access to business records.
4. Scope follows the explicit role/unit matrix. UP3-to-ULP visibility does not grant approval automatically. `SYS_ADMIN` without a unit receives no implicit business-document access. A vendor also needs a matching vendor-company/project/WO relation.
5. Deny missing/expired/inactive assignments, inactive user/unit, missing permission, and scope mismatch.
6. Invalidate Spatie catalog cache and separate DISTRIVA scope cache on role-permission, assignment, account, and unit changes.
7. Assignment writes go through a transaction service that writes `user_role_assignments` and append-only history; never use Spatie user-role APIs or pivots.

### 3.8 Status implementasi

Desain Opsi A telah disetujui dan baseline Laravel T4.2.1 tersedia di `backend/`, termasuk migration schema/integrity, model User/Role, serta RoleSeeder. Migration up/down, RoleSeeder idempotency, dan integrity smoke tests telah PASS pada PostgreSQL disposable `distriva_db`; semua tabel aplikasi di-rollback, sementara `btree_gist` tetap terpasang. Hasil ini bukan validasi produksi atau concurrency stress test. `ScopedAuthorizationService`, policy, assignment write service, dan permission catalog belum diimplementasikan. Bukti dan batas verifikasi ada di `test-evidence/2026-11-05-t421-runtime.md` dan `32-T4.2.1-DESIGN-REVIEW.md`.


## T4.2.2 — Master data (rancangan konseptual, 5 November 2026)

Domain master data menggunakan tabel kategori dan material ERP, satuan/konversi, KHS berversi, konstruksi berversi, BOM berversi, formula terstruktur, staging sinkronisasi, dan change log. Rincian atribut, constraint, indeks, dan isu terbuka berada di `23-T4.2.2-MASTER-DATA-SCHEMA.md`.

Tabel yang diusulkan: `material_categories`, `materials`, `units_of_measure`, `material_unit_conversions`, `khs_items`, `khs_item_versions`, `construction_types`, `construction_type_versions`, `construction_khs_mappings`, `bom_headers`, `bom_items`, `bom_formula_definitions`, `material_sync_logs`, `material_sync_staging`, `material_change_logs`; `material_prices` bersifat opsional dan belum disetujui.

Prinsip: ERP adalah sumber kebenaran material dan satuannya; DISTRIVA tidak mengelola stok. Formula BOM dievaluasi oleh calculation engine dengan ekspresi terkontrol, bukan `eval()`. Kode KHS menjadi kunci pencocokan; ketidakcocokan perlu review manual. Seluruh versi master yang dipakai transaksi harus dapat direproduksi. Rancangan T4.2.2 masih draft untuk review dan belum menjadi migration.


## 4. T4.2.2 — Master data: keputusan final desain (5 November 2026)

Rincian skema final desain terdapat pada `23-T4.2.2-MASTER-DATA-SCHEMA.md`. Keputusan yang mengikat:

- Satu SKU/varian yang digunakan DISTRIVA harus memiliki kode ERP tersendiri; setiap kode ERP menjadi satu record `materials`. Varian tanpa kode ERP terverifikasi belum boleh menjadi master resmi.
- ERP/aplikasi material tetap source of truth untuk identitas material, satuan ERP, stok, dan transaksi. Kategori adalah klasifikasi internal DISTRIVA.
- Harga material mendukung dua jalur: sumber eksternal dan master harga internal per UP3 melalui `material_prices`. Setiap record membedakan `price_type` dan `source_type`; harga tidak dijumlahkan atau dipilih otomatis. Calculation run menyimpan snapshot harga, lingkup, jenis, sumber, periode/versi, dan nilai yang digunakan. Aturan prioritas harga masih perlu diputuskan. Harga stok ERP tidak otomatis menjadi harga RAB.
- `UP3_MANAGER` adalah approver utama versi master KHS dan BOM. Versi yang disetujui immutable; perubahan dibuat sebagai versi baru. Approval dicatat dengan aktor, role/unit, waktu, keputusan, dan catatan.
- KHS dan BOM menggunakan versi serta masa berlaku; formula BOM berupa ekspresi terstruktur yang dievaluasi secara deterministik, bukan kode bebas atau `eval()`.
- `material_prices` termasuk dalam desain T4.2.2 untuk mendukung harga internal per UP3 sekaligus pencatatan harga eksternal. Harga persediaan ERP, harga kontrak, harga KHS, dan harga referensi RAB tetap dibedakan; aturan pemilihan harga untuk setiap komponen RAB perlu ditetapkan.

T4.2.2 selesai pada level desain. Belum ada migration, seeder, import ERP, sinkronisasi, maupun calculation engine yang diimplementasikan. Detail SKU aktual, kode satuan ERP, kontrak API, dan formula BOM lengkap tetap menunggu data sumber.

> Catatan rekonsiliasi blueprint: bagian master/inventory lama yang mengusulkan `inventory_scope`, tabel gudang, saldo, movement, transfer, atau stok internal tidak menjadi mandat implementasi DISTRIVA. Aplikasi material eksternal tetap mengelola persediaan.


## 4. T4.2.3 — Desain terbaru domain permohonan PB/PD (v2.8)

Bagian ini menjadi acuan terbaru untuk domain pelanggan dan permohonan; rancangan lama yang menyimpan IDPEL langsung sebagai identitas pelanggan atau menggabungkan agenda/registrasi pada satu kolom dinyatakan superseded.

- `customers`: `id UUID`, `customer_number` unik, `name`, `phone`, `email`, timestamps. Nomor telepon wajib sebelum submit permohonan resmi; boleh belum ada pada staging impor. NIAGA_RETAIL melengkapi nomor telepon sebelum submit.
- `customer_external_references`: identitas eksternal seperti IDPEL disimpan sebagai string, bukan PK pelanggan. Strategi deduplikasi/master identity masih open.
- `applications`: `application_number`, PB/PD, `transaction_type`, `customer_id`, ULP `organizational_unit_id`, sumber, alamat layanan, tarif/daya lama-baru dengan unit sumber, `delta_power_kva`, paket SAR, total biaya, kriteria TMP, conditional flags, current internal status, timestamps.
- Bot Daftung: `application_import_batches` dan `application_import_staging`; payload JSONB dipertahankan, validasi dan preview sebelum menjadi aplikasi resmi, idempotensi berdasarkan source reference yang stabil.
- Agenda dan registrasi: dua record `application_external_references` dengan `reference_type` AGENDA dan REGISTER; nomor disimpan VARCHAR.
- Status eksternal: `application_external_status_histories` dan `external_status_mappings`; tidak menggantikan status internal.
- Pembayaran: `application_payments`; `TOTALBIAYA` adalah total biaya, bukan bukti pembayaran. `TGLBAYAR` perlu verifikasi. `REGISTRATION_PAID` hanya setelah payment terverifikasi.
- Survei: `application_surveys`, `application_survey_versions`, `application_survey_measurements`; dokumen/foto dikelola modul dokumen.
- Task/SLA memakai tabel yang telah dirancang pada T3.3, tidak membuat task engine duplikat.

Detail kolom, mapping spreadsheet, constraint, indeks, dan isu terbuka: `docs/24-T4.2.3-APPLICATIONS-PB-PD-SCHEMA.md`.


## T4.2.3 — Identitas pelanggan dan referensi permohonan (keputusan v2.9)

- `customers` adalah master identitas internal DISTRIVA. Satu customer dapat memiliki banyak `applications`.
- IDPEL disimpan pada `customer_external_references` dan menjadi identitas pelanggan PLN; satu IDPEL dapat terkait dengan banyak permohonan PB/PD/layanan. IDPEL tidak menjadi PK dan tidak disalin sebagai identitas utama pada setiap application.
- No. Register pembayaran (`PAYMENT_REGISTER`) dan No. Agenda (`AGENDA`) disimpan pada `application_external_references`, karena keduanya mengacu pada permohonan/proses tertentu.
- Ketiga nomor boleh belum tersedia saat permohonan awal dibuat. Referensi ditambahkan ketika diterbitkan sistem eksternal. Penerbitan ulang/koreksi dicatat sebagai histori, bukan overwrite tanpa jejak.
- Konflik IDPEL/customer masuk proses rekonsiliasi manual terkontrol; tidak ada auto-merge. Detail skema pada `24-T4.2.3-APPLICATIONS-PB-PD-SCHEMA.md`.


### Sinkronisasi status Bot Daftung — keputusan v3.0

Untuk permohonan existing, record dicari melalui No. Agenda (`application_external_references.reference_type = AGENDA`). Jika cocok tepat satu application, jalur status-sync hanya mengubah tiga atribut eksternal: `service_days` (DURASI_HARI_KERJA), `external_status` (STATUS_PERMOHONAN), dan `source_updated_at` (TGL_UPDATE_PERMOHONAN). Tidak boleh ada mass update terhadap kolom customer/application lain. IDPEL tidak digunakan sebagai kunci pencocokan permohonan karena satu IDPEL dapat memiliki banyak permohonan. Update yang lebih lama ditolak sebagai stale; konflik timestamp sama dengan isi berbeda dikarantina; setiap update disimpan dalam `application_external_status_histories` dan `external_sync_logs`. Waktu `synced_at` dibedakan dari timestamp sumber. Detail: `docs/24-T4.2.3-APPLICATIONS-PB-PD-SCHEMA.md` bagian 13.

## Addendum T4.2.3 v3.1 — metadata batch Bot Daftung

`application_import_batches` menyimpan `period_start` dan `period_end` sebagai rentang tanggal permohonan pertama kali dibuat, terpisah dari `downloaded_at`, `imported_at`, serta `TGL_UPDATE_PERMOHONAN`. Batch dapat berisi data lama dan baru dan dapat overlap. Ketidakmunculan record pada batch berikutnya bukan instruksi penghapusan atau perubahan status.


## 6. Rekonsiliasi T4.2.4 — v3.2 (acuan terbaru)

Blueprint awal pada bagian 2–5 di atas bersifat historis/logis dan tidak boleh dipakai sebagai migration langsung. Untuk organisasi, akses, master data, dan aplikasi PB/PD, gunakan spesifikasi tabel pada dokumen 22–24. Untuk dokumen, versi, review dan Auto MTO, gunakan dokumen 26 dan DDL baseline dokumen 27.

Koreksi penting v3.2:
- Tidak ada tabel inventory/stock ledger internal DISTRIVA; aplikasi material eksisting adalah source of truth.
- `organizational_units` dan `user_role_assignments` menggantikan tabel `up3`, `ulps`, `user_units` lama.
- `materials.unit` masih VARCHAR(30); relasi satuan perhitungan menggunakan `units_of_measure` sesuai domain.
- KHS identity/version dipisah; BOM version adalah row `bom_headers`.
- Dokumen memiliki logical identity dan immutable versions; tidak menggunakan `drawings`/`drawing_versions` sebagai modul terpisah.
- Approval drawing dan Auto MTO dipisahkan; generic document workflow tidak menggantikan approval RAB/KKF.
- Tabel, FK composite, trigger, dan indeks T4.2.4 dirinci pada dokumen 27.
