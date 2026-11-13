# Prompt siap tempel — filter "Butuh SKU (material PLN)" di halaman Pemetaan Material SKU↔KHS (agen frontend)

Anda adalah agen frontend DISTRIVA (React/Vite di `frontend/`). Halaman `src/pages/master-data/KhsMaterialMapPage.jsx` ("Meja Kerja Pemetaan Material ERP ke KHS") kini menampilkan 182 KHS yang belum dipetakan, padahal **hanya 36** yang benar-benar butuh SKU ERP. Tambahkan filter dan ringkasan yang menunjukkan itu. Jangan mengubah backend.

## Mengapa
Buku harga membagi material: `PLN` = disediakan PLN dari gudangnya (tanpa harga, tidak masuk RAB), `PRICED` = dibeli vendor. SKU ERP hanya dipakai untuk stok/alokasi/RKM, jadi **hanya material `PLN` yang perlu dipetakan**; material `PRICED` tidak keluar dari gudang PLN. Memetakan 182 item membuang waktu dan mengundang pemetaan salah.

## Kontrak API (sudah ada)
- `GET /api/master-data/khs-material-map/workbench?filter=unmapped|mapped|all&used=1&supply=pln&search=&per_page=` — parameter baru **`supply=pln`** (hanya nilai `pln`; nilai lain → 422) menyaring KHS yang berstatus `PLN` pada buku harga yang berlaku hari ini. Setiap baris `data[]` kini memuat **`material_status`**: `"PLN"`, `"PRICED"`, atau `null` (KHS tidak ada di buku harga berlaku). Contoh data nyata: `?filter=unmapped&used=1&supply=pln` → `meta.total` = 36 (38 sebelum dua kubikel dikecualikan; tanpa `supply` = 182).
- `GET /api/master-data/khs-material-map/coverage` → `data` kini juga memuat `sku_needed_total` (KHS dipakai BOM berstatus PLN dan tidak dikecualikan, saat ini 41), `sku_needed_mapped` (5), `sku_needed_percent` (12.2), selain `khs_used_total/mapped/percent` yang sudah ada.

- **Pengecualian pemetaan** (KHS yang sengaja tidak dipetakan, mis. kubikel paket KHS 187 dan 189 yang diminta setelah pelanggan membayar): `POST /api/master-data/khs-material-map/exemptions` `{khs_code, reason}` → 201; `POST /api/master-data/khs-material-map/exemptions/{khs_code}/lift` `{reason}` → 200 (izin `khs.manage`; alasan wajib; 409 bila KHS sudah punya pemetaan, sudah dikecualikan, atau tidak sedang dikecualikan; KHS yang dikecualikan tidak bisa dipetakan: 409). Setiap baris `workbench` memuat `sku_exempt` (bool) dan `exempt_reason`; `supply=pln` **tidak** memuat yang dikecualikan; `coverage` memuat `sku_exempt_total` (saat ini 2) dan `sku_needed_*` sudah tanpa yang dikecualikan (saat ini **5 dari 41**, daftar PLN **36** baris).

## Yang harus dibangun
1. **Filter** di toolbar tabel: kotak centang/segmen **"Butuh SKU (material PLN)"** yang mengirim `supply=pln`; **aktif secara bawaan** bersama "Dipakai BOM Saja" dan status "Belum Dipetakan" (jadi halaman terbuka dengan 36 baris). Mematikannya menampilkan semua seperti sekarang. Pagination kembali ke halaman 1 saat filter berubah; hitungan "Total N item" mengikuti `meta.total`.
2. **Kartu ringkasan** teratas: ganti/awali kartu "Cakupan KHS BOM disetujui" dengan **"KHS PLN terpetakan"**: `sku_needed_mapped dari sku_needed_total` dan persentase `sku_needed_percent` (tampilkan "0 dari 0" bila total 0, bukan galat). Kartu lama (`khs_used_*`) boleh dipertahankan sebagai angka sekunder berlabel "semua KHS dipakai BOM".
3. **Badge pasokan** pada tiap baris dan panel detail: `PLN` (butuh SKU), `PRICED` (vendor — "tidak butuh SKU ERP"), atau tanpa badge bila `null`. Untuk baris `PRICED`, panel saran SKU tetap bisa dibuka tetapi tampilkan catatan netral: "Material ini dibeli vendor; pemetaan SKU biasanya tidak diperlukan."
4. Teks bantuan singkat di bawah toolbar (dapat ditutup, ingat pilihan di `localStorage` dalam try/catch): "Hanya material berstatus PLN yang perlu SKU ERP. Material vendor (PRICED) tidak keluar dari gudang PLN."
5. **Kecualikan / cabut pengecualian** (hanya bila `can['khs.manage']`): tombol "Kecualikan dari pemetaan" pada panel detail membuka dialog alasan (wajib) → `exemptions`; baris yang dikecualikan menampilkan badge "Dikecualikan" dengan alasannya dan tombol "Cabut pengecualian" (dialog alasan wajib → `…/lift`). Pesan 409 ditampilkan apa adanya. Tambahkan pilihan filter "Tampilkan yang dikecualikan" (tanpa `supply=pln`, status `Belum Dipetakan`) agar daftar pengecualian dapat ditinjau.
6. Pertahankan semua perilaku yang ada: saran kandidat dengan skor dan peringatan "Pemeriksaan Spesifikasi Wajib", pemetaan manual bebas, impor CSV, pesan 403/404/409/422 apa adanya. Satu KHS boleh punya beberapa SKU; satu SKU hanya satu KHS (pesan server ditampilkan verbatim).

## Aturan
Hak akses ditentukan backend; jangan menebak. Jangan mengubah komponen bersama kecuali mutlak perlu. Jalankan seluruh `npx vitest run` dan `npx vite build` sebelum selesai.

## Tes yang harus ada (vitest)
1. Halaman membuka dengan `supply=pln`, `used=1`, `filter=unmapped` terkirim ke `workbench` (periksa argumen mock).
2. Mematikan filter PLN memanggil ulang tanpa `supply` dan kembali ke halaman 1.
3. Kartu ringkasan menampilkan `sku_needed_mapped dari sku_needed_total` dan persentasenya; total 0 → "0 dari 0" tanpa galat.
4. Baris `PLN` dan `PRICED` menampilkan badge yang benar; `null` tanpa badge; panel detail `PRICED` menampilkan catatan netral.
5. Kesalahan server (mis. 422) ditampilkan verbatim; pilihan penutupan teks bantuan tersimpan dan tidak merusak render bila `localStorage` gagal.

6. Dialog kecualikan/cabut mengirim alasan, menolak kosong, dan menampilkan 409 verbatim; tombol tidak muncul tanpa `khs.manage`.

Selesai bila: vitest hijau seluruhnya, build berhasil, dan di aplikasi nyata halaman Pemetaan terbuka dengan 36 baris (bukan 182) dan kartu "5 dari 41".
