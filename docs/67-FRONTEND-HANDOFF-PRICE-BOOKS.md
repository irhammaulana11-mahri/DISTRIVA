# 67 — Serah-terima ke Agen Frontend: buku harga per kontrak (tahap 5A)

**Untuk:** agen frontend DISTRIVA · **Dari:** sesi backend · **Tanggal:** 7 November 2026 · **Kontrak API:** `docs/57-API-CONTRACT.md` ("Buku harga per kontrak"). Jangan mengubah backend; temuan ditulis di §5.
**Status backend:** selesai, lulus tes, dan **sudah diterapkan ke `distriva_db`** (7 Nov 2026): satu draf buku harga `f8d287b7-a07b-4f84-a67e-4f50b06f2759` (504 item, zona 1/2/3/5, zona 2 untuk UP3 Mojokerto) menunggu persetujuan UP3_MANAGER/SYS_ADMIN oleh pemilik lewat layar. Jangan menyetujuinya dari kode/skrip.

## 1. Konsep
Satu **buku harga** = harga satu kontrak: per item KHS ada **status material** (`PLN` = material disediakan PLN, tanpa harga, tidak masuk RAB; `PRICED` = vendor membeli, ada `material_price`) dan **harga jasa pasang/bongkar per zona** (workbook: zona 1, 2, 3, 5). **Zona ditetapkan per UP3 pada tiap buku** (kontrak baru boleh memakai zona lain). Siklus: DRAFT → APPROVED → INACTIVE; buku baru yang disetujui menutup yang lama; APPROVED tidak dapat diubah.

## 2. Halaman (di bawah master data, hak `master_data.view`)
- **Daftar** `/master-data/harga`: tabel buku (nama, referensi kontrak, berlaku dari/sampai, status, jumlah item, jumlah UP3 bertetapan zona). Badge "Menunggu persetujuan" untuk DRAFT. Tombol "Impor buku harga" bila `can['prices.manage']`.
- **Impor**: unggah CSV + `name`, `contract_reference?`, `valid_from` → **dry run** → ringkasan (`accepted_rows`, `rejected_rows`, `priced`, `pln`, `zones`) dan tabel `rows[]` dengan `messages` → "Terapkan" (201). 409 = ada baris tak valid; tampilkan `message` + baris bermasalah.
- **Detail** `/master-data/harga/:id`: header + riwayat (`events`); panel **Zona per UP3** (tabel `zones`; ubah hanya saat DRAFT dan `can['prices.manage']`: pilih UP3 (dari `GET /admin/units?type=UP3` atau sumber unit yang sudah ada), pilih zona dari `available_zones`, alasan wajib → `PUT …/zones`); tabel item berhalaman (`/items`, cari kode/nama, filter status material; kolom: kode, nama, status, harga material, harga pasang/bongkar per zona).
- **Persetujuan** (`can['prices.approve']`): alasan wajib → `POST …/approve {book_ids,reason}`; tampilkan 403 (pembuat tidak boleh) dan 409 (belum ada zona / KHS belum APPROVED / tabrakan rentang) apa adanya. "Nonaktifkan" (`retire`) untuk APPROVED dengan alasan dan konfirmasi.

## 3. Format angka dan CSV
Tampilkan rupiah dengan format Indonesia; **jangan membulatkan di klien**. Templat CSV yang dapat diunduh: kolom `kode,nama,status_material,harga_material,z1_pasang,z1_bongkar,z2_pasang,z2_bongkar,…` (`status_material` = `PLN` atau `HARGA`). Sediakan tombol "Unduh templat" memakai `utils/csvTemplates.js`.

## 4. Pengujian yang diminta
Vitest: daftar + filter status; impor dry run → terapkan → 409 menampilkan baris bermasalah; zona hanya dapat diubah pada DRAFT dan sesuai hak; persetujuan menampilkan 403/409; tombol mengikuti `can['prices.manage']`/`can['prices.approve']`.

## 5. Temuan frontend untuk backend
(isi bila kontrak kurang; jangan menebak.)
