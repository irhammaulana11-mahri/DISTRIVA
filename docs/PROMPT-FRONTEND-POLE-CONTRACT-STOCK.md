# Prompt siap tempel — Kontrak Rinci tiang: baris material, pasokan stok, plotting per material (agen frontend)

Anda adalah agen frontend DISTRIVA (React/Vite di `frontend/`). Backend kini mengaitkan Kontrak Rinci (KR) dengan stok (docs/62 §49): KR memuat baris material tiang, menambah pasokan, dan plotting tiang mengurangi sisanya. Jangan mengubah backend.

## Keputusan pemilik
- KR memuat **baris material tiang** (material KHS + tipe TM/TR + jumlah); satu KR bisa banyak jenis tiang.
- KR menjadi **pasokan tambahan** sampai stok ERP (MIMS) memuat material itu; setelah itu stok ERP yang berlaku (tidak dihitung dua kali).
- Plotting tetap **per KR**; gudang hanya **keterangan**.

## Kontrak API (sudah ada)
- `POST /api/master-data/pole-contracts` `{kr_number, description?, lines:[{khs_item_id, pole_type:"TM"|"TR", quantity}]}`; bila `lines` dikirim, `qty_tm`/`qty_tr` dihitung server (jangan dikirim). Tanpa `lines`, `qty_tm` dan `qty_tr` wajib seperti sebelumnya. `PUT …/{id}` `{description?, lines? (mengganti SELURUH baris), reason}`; baris tidak boleh di bawah yang sudah diplot atau dihapus bila sudah diplot (409). Material ganda dalam satu KR → 409. Izin `poles.manage`.
- `GET /api/master-data/pole-contracts` dan `/{id}`: setiap KR memuat `tm|tr {total, allocated, remaining}` dan `lines[] {khs_item_id, khs_code, khs_name, pole_type, total, allocated, remaining, in_erp_stock}`.
- `PUT /api/allocations/{id}/poles` `{poles:[{pole_contract_id, pole_type, quantity, khs_item_id?, warehouse_id?}]}`: **`khs_item_id` wajib bila KR punya baris** dan harus baris KR itu dengan tipe yang sama (409). `warehouse_id` opsional (keterangan). Konfirmasi melebihi sisa → 409. `GET /allocations/{id}` memuat per baris tiang `khs_item_id`, `khs_code`, `warehouse_id`, `warehouse_code`.
- `GET /api/master-data/stock-position` memuat per KHS `kr_supply` dan `available_with_kr` (= `available + kr_supply`). `kr_supply` bernilai 0 untuk baris KR yang `in_erp_stock = true`.

## Yang harus dibangun
1. **Form KR** (halaman Kontrak Rinci): ganti isian TM/TR dengan tabel baris material (pilih material KHS, tipe TM/TR, jumlah; tambah/hapus baris). Total TM dan TR ditampilkan otomatis dari baris (hanya baca). Pada mode sunting kirim seluruh baris beserta alasan wajib; tampilkan pesan 409 apa adanya. KR lama tanpa baris tetap bisa disunting seperti sekarang (isian TM/TR) dan boleh ditambah baris.
2. **Detail KR:** tabel baris dengan kolom Material, Tipe, Total, Terplot, Sisa, dan badge "Sudah masuk stok ERP" bila `in_erp_stock` (jelaskan: "Stok ERP sudah memuat material ini; KR tidak lagi dihitung sebagai pasokan tambahan.").
3. **Plotting tiang di alokasi:** untuk KR yang punya baris, pilih **material tiang** dari baris KR (menyaring tipe TM/TR otomatis) lalu isi jumlah; tampilkan sisa per baris. Pilihan gudang opsional berlabel "Keterangan gudang asal". Untuk KR tanpa baris, perilaku lama. Tampilkan kode material dan kode gudang pada baris yang sudah tersimpan.
4. **Posisi stok:** pada tampilan stok per KHS tambahkan kolom/angka "Pasokan KR" (`kr_supply`) dan "Tersedia + KR" (`available_with_kr`) dengan keterangan singkat; jangan mengganti `available`.

## Aturan
Hak akses ditentukan backend; jangan menebak. Pesan server apa adanya. Jangan mengubah komponen bersama kecuali mutlak perlu. Jalankan seluruh `npx vitest run` dan `npx vite build`.

## Tes yang harus ada (vitest)
1. Form KR mengirim `lines` tanpa `qty_tm`/`qty_tr`; total dihitung dari baris; 409 material ganda tampil verbatim.
2. Sunting KR mengirim seluruh baris dan alasan; ditolak tanpa alasan; 409 "di bawah yang sudah dialokasikan" tampil verbatim.
3. Detail KR menampilkan sisa per baris dan badge "Sudah masuk stok ERP" hanya bila `in_erp_stock`.
4. Plotting: KR berbaris mewajibkan memilih material tiang dan mengirim `khs_item_id` (dan `warehouse_id` bila dipilih); KR tanpa baris tidak mewajibkannya.
5. Posisi stok menampilkan `kr_supply` dan `available_with_kr` tanpa mengubah `available`.

Selesai bila: vitest hijau, build berhasil, dan di aplikasi nyata membuat KR berbaris menambah "Pasokan KR" pada posisi stok, serta mengonfirmasi plotting mengurangi sisanya.
