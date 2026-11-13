# 61 — Serah-terima ke Agen Frontend: halaman BOM dan perbaikan MFA

**Untuk:** agen frontend DISTRIVA (React/Vite di `frontend/`) · **Dari:** sesi backend · **Tanggal:** 6 November 2026
**Sumber kebenaran API:** `docs/57-API-CONTRACT.md` §3a (master data, termasuk BOM) dan §3b (MFA). Backend sudah selesai dan diterapkan ke `distriva_db`; **jangan mengubah backend** — bila kontrak kurang, tulis temuan di akhir dokumen ini.
Aturan umum tetap: backend adalah satu-satunya penentu hak akses; UI hanya menampilkan/menyembunyikan berdasarkan `GET /master-data/access` (`can[...]`), fail-closed.

## 1. Perbaikan cepat (prioritas 1): halaman MFA
- `pages/MfaPage.jsx` memanggil `POST /auth/mfa/enroll` begitu dibuka, **tanpa memeriksa `mfaState.required`**. Untuk role selain SYS_ADMIN, backend menjawab **403 "MFA hanya untuk SYS_ADMIN"** dan halaman menampilkan galat di console (terlihat pada UP3_ADMIN).
- Perbaikan: bila `!mfaState?.required` atau `mfaState.verified` → `<Navigate to="/" replace />` dan **jangan** memanggil `enroll`. `enroll` hanya dipanggil saat `required && !enrolled`. Tambahkan tes: pengguna non-SYS_ADMIN yang membuka `/mfa` dialihkan tanpa memanggil `enroll`.
- Tidak ada perubahan lain pada alur MFA (sudah sesuai docs/57 §3b).

## 2. Perubahan hak akses yang berlaku sekarang
- **SYS_ADMIN memegang seluruh key master data** (lihat, kelola, setujui) — tetapi hanya di token yang sudah MFA-verified. Pembuat ≠ penyetuju tetap berlaku untuk semua orang (403).
- Key baru di `GET /master-data/access` → `can`: **`bom.manage`** (ENGINEERING, PERENCANAAN, SYS_ADMIN) dan **`bom.approve`** (UP3_MANAGER, SYS_ADMIN). Tombol impor/ubah memakai `bom.manage`; setujui/nonaktifkan memakai `bom.approve`.
- `construction_types.approve` dan `khs.approve` kini juga dipegang SYS_ADMIN.
- Hanya SYS_ADMIN yang membuat/mengubah unit organisasi (UP3_ADMIN tidak lagi; sembunyikan tombolnya mengikuti `can_write` dari `/admin/access`).

## 3. Yang perlu dibangun (prioritas 2): BOM per kelompok
Halaman master data lain (material, KHS, jenis konstruksi, kategori) **sudah ada**; BOM belum. Catatan: pemetaan konstruksi → KHS (di `ConstructionsPage`) **bukan** BOM. BOM = rumus kuantitas per baris KHS untuk satu kelompok (SUTM, MVTIC, SUTR, SKTM, KUBIKEL, GTT_UMUM, GTT_KHUSUS). Perbaiki deskripsi di `moduleRegistry.js` yang menyamakan keduanya.

Rute usulan (semua `RequireCapability capability="master_data.view"`): `/master-data/bom` (daftar), `/master-data/bom/:id` (detail), `/master-data/bom/:id/hitung` (kalkulator). Tambahkan fungsi di `services/api.js` (pola yang sama dengan `constructionTypes`):

| Fungsi | Endpoint |
|---|---|
| `boms({group,status})` | `GET /master-data/bom` |
| `bom(id)` | `GET /master-data/bom/{id}` (header + `events[]` + `parameters[]`) |
| `bomLines(id,{page,per_page})` | `GET /master-data/bom/{id}/lines` |
| `importBom(formData)` | `POST /master-data/bom/import` (multipart: `file` JSON, `valid_from`, `source_reference?`, `dry_run?`) |
| `updateBomDraft(id,body)` | `PATCH /master-data/bom/{id}` (`name?`,`description?`,`valid_from?`,`reason`) |
| `approveBom(body)` | `POST /master-data/bom/versions/approve` (`version_ids[]`,`reason`) |
| `retireBom(id,body)` | `POST /master-data/bom/{id}/retire` (`reason`) |
| `calculateBom(id,body)` | `POST /master-data/bom/{id}/calculate` |

### 3.1 Daftar (`/master-data/bom`)
Kartu/tabel per kelompok: versi aktif (`status=APPROVED`, `valid_from`, `valid_until`), jumlah baris, draf bila ada. Filter `group`, `status`. Status: DRAFT / APPROVED / INACTIVE. Tombol "Impor BOM" bila `can['bom.manage']`; "Setujui" bila `can['bom.approve']` dan draf bukan buatan pengguna ini (backend tetap menolak dengan 403 — tampilkan pesannya).

### 3.2 Detail (`/master-data/bom/:id`)
Header (kelompok, versi, berlaku, status, pembuat/penyetuju), **riwayat** (`events`), **parameter** (`parameters[]`: `name`, `description`, `default`), tabel baris berhalaman (`/lines`): `sequence` (= nomor baris workbook), `khs_code`, `description`, empat rumus `formulas.H/I/J/K` = Material / Pasang / Bongkar / Retur (teks asli workbook, tampilkan monospace; **jangan dievaluasi di klien**).
Aksi: ubah draf (`bom.manage`, hanya DRAFT), setujui/nonaktifkan (`bom.approve`). Versi APPROVED tidak dapat diubah (409 bila dicoba) — tampilkan "buat versi baru lewat impor".

### 3.3 Impor
Berkas JSON hasil `tools/extract_bom_json.py` (satu kelompok per berkas). Alur: pilih berkas + `valid_from` → **dry run** (`dry_run=1`) → tampilkan ringkasan `data` (`accepted_lines`, `rejected_lines`, `with_khs`, `formula_cells`, `parameters`) dan `problems[]` (`where` + `messages[]`) → tombol "Terapkan" (tanpa `dry_run`) → 201. **409** = ada baris yang tak dapat diterjemahkan (seluruh impor dibatalkan) atau sudah ada draf untuk kelompok itu: tampilkan `message` dan `problems`. `valid_from` ditentukan admin/engineer (bukan nilai bawaan sistem).

### 3.4 Kalkulator (`/master-data/bom/:id/hitung`)
Perhitungan murni (tidak menyimpan). Form:
1. Daftar jenis konstruksi kelompok itu: `GET /master-data/construction-types?group=<KELOMPOK>&per_page=100` → untuk setiap jenis (`code`, `name`) dua kolom angka **Pasang (psg)** dan **Bongkar (bkr)**, ≥ 0, kosong = 0.
2. Kolom **Parameter** dari `bom.parameters[]` (mis. `COMMISSIONING:SUTM` = volume commissioning test, diambil dari halaman gambar); nilai bawaan = `default`.
3. Kirim `{inputs:[{code,psg,bkr}], params:{<name>:<angka>}}` (hanya baris yang diisi; maks 500 input). 422 bila kode bukan milik kelompok itu, angka negatif, atau parameter tidak dideklarasikan.
4. Hasil `data.lines[]`: `sequence`, `khs_code`, `description`, `material`, `install`, `remove`, `return`. Sembunyikan baris yang keempat nilainya 0 secara bawaan (toggle "tampilkan semua"); format angka Indonesia, jangan membulatkan di klien (pembulatan `TRUNC` sudah dilakukan server pada jumlah agregat per baris — keputusan K-3).
5. Teks bantuan: "Pembulatan mengikuti perilaku workbook (dipotong ke bawah per baris)."

### 3.5 Halaman gambar (nanti, bukan sekarang)
Modul gambar/survei belum ada di backend. Kalkulator di atas adalah pengganti sementara; saat halaman gambar dibuat, ia akan mengirim jumlah pasang/bongkar tiap konstruksi dan `params` (termasuk `COMMISSIONING:<KELOMPOK>`) ke endpoint `calculate` yang sama. Jangan membuat kontrak baru.

## 4. Pengujian yang diminta
Tes Vitest/Testing Library untuk: pengalihan `/mfa` non-SYS_ADMIN; daftar BOM + filter; detail dengan parameter dan rumus; impor dry run → terapkan → 409 menampilkan `problems`; kalkulator mengirim payload yang benar (`inputs`, `params`) dan menampilkan galat 422; tombol bergantung `can['bom.manage']`/`can['bom.approve']`.

## 5. Data uji di `distriva_db` (baca saja)
7 BOM APPROVED: SUTM v2, MVTIC v2, SKTM v2, KUBIKEL v2, GTT_UMUM v2, GTT_KHUSUS v2 (berlaku 2026-11-02, masing-masing 1 parameter `COMMISSIONING:<KELOMPOK>`, nilai bawaan 0) dan SUTR v1. Versi 1 dari enam kelompok pertama sudah ditutup (`valid_until` 2026-11-01). Akun uji: ENGINEERING `analuammahri@gmail.com`, UP3_MANAGER `irham.maulana@pln.co.id` (password milik pemilik; jangan ditulis di kode atau dokumen).

## 6. Temuan frontend untuk backend
(isi di sini bila kontrak kurang atau membingungkan; jangan menebak.)
