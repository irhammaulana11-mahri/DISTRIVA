# Prompt siap tempel — kategori material dua tingkat (kategori → subkategori) di halaman Kategori & Katalog Material (agen frontend)

Anda adalah agen frontend DISTRIVA (React/Vite di `frontend/`). Backend kini menyimpan kategori material dua tingkat (docs/62 §46): 10 kategori dan 63 subkategori dari master PLN ERP Rev2, dan **seluruh 1.254 material sudah berada pada subkategori**. Ubah halaman `src/pages/master-data/CategoriesPage.jsx` dan `MaterialsPage.jsx` agar menampilkan dan memakai struktur itu. Jangan mengubah backend.

## Kontrak API (sudah ada)
- `GET /api/master-data/categories` → `data[]` kini memuat `id, parent_id, code, name, description, is_active, parent_code, level` (1 = kategori, 2 = subkategori), `children_count`, `materials_count` (pada kategori = jumlah material seluruh subkategorinya). Kategori lama yang tidak terpakai sudah `is_active: false` (9 buah: KWH_METER, MCB_1_PHASE, MCB_3_PHASE, PENGHANTAR, BOX_APP, TRAFO, PHBTR, PENGAMAN, KUBIKEL) — jangan ditampilkan sebagai pilihan.
- `POST /api/master-data/categories` `{code, name, description?, parent_id?}` (izin `material_categories.manage`; kode huruf besar, angka, garis bawah; maksimum 30). Tanpa `parent_id` = kategori; dengan `parent_id` = subkategori. 422 bila induknya sebuah subkategori ("hanya dua tingkat") atau induk sudah dipakai langsung oleh material.
- `PATCH /api/master-data/categories/{id}` `{name?, description?, is_active?}` (induk tidak dapat dipindahkan; tampilkan kode dan induk sebagai teks tetap).
- `GET /api/master-data/materials?category_id=` — `category_id` sebuah **kategori** mengembalikan material seluruh subkategorinya; sebuah subkategori mengembalikan miliknya saja. Setiap material memuat `category: {id, code, name}` (subkategori).
- `PATCH /api/master-data/materials/{id}` `{category_id, reason}` menolak kategori induk dengan 422 "Pilih subkategori, bukan kategori induk" dan menolak kategori tidak aktif.

## Yang harus dibangun
1. **CategoriesPage sebagai pohon:** kategori sebagai baris induk yang dapat dibuka/ditutup (terbuka semua bila ada pencarian), subkategori di bawahnya diberi indentasi; kolom: kode, nama, jumlah subkategori (induk), jumlah material, status aktif. Pencarian menyaring kode/nama dan tetap menampilkan induk dari subkategori yang cocok. Badge "Nonaktif" untuk kategori tidak aktif (urutan: aktif dulu, nonaktif di bagian bawah atau dapat disembunyikan dengan sakelar "Tampilkan nonaktif").
2. **Tambah:** tombol "Tambah Kategori" dan, pada tiap kategori, "Tambah Subkategori" (drawer/dialog dengan kode, nama, deskripsi; `parent_id` terisi dan terkunci). Pesan 422/409 server tampil apa adanya. Sunting nama/deskripsi dan sakelar aktif/nonaktif seperti sekarang; hanya bila `can['material_categories.manage']`.
3. **MaterialsPage:** filter kategori berupa dua pilihan bertingkat atau satu pilihan berkelompok (kategori → subkategori); memilih kategori menyaring seluruh subkategorinya (kirim `category_id` kategori). Kolom/baris material menampilkan "Kategori › Subkategori" (teks kecil kategori di atas, subkategori di bawah). Dialog ubah kategori material hanya menawarkan **subkategori aktif** (dikelompokkan per kategori) atau kategori aktif yang tidak punya anak; alasan tetap wajib; pesan server tampil apa adanya.
4. Kartu atau angka ringkas di atas halaman Kategori: total kategori aktif, total subkategori aktif, material tanpa kategori (hitung dari `GET /materials?uncategorized=1` bila parameternya ada di kontrak, kalau tidak lewati kartu ini).

## Aturan
Hak akses ditentukan backend; jangan menebak. Jangan mengubah komponen bersama kecuali mutlak perlu. Jalankan seluruh `npx vitest run` dan `npx vite build`.

## Tes yang harus ada (vitest)
1. Daftar membentuk pohon dari `parent_id`: induk dengan anak, subkategori terindentasi, jumlah material induk dari server.
2. Pencarian menampilkan induk dari subkategori yang cocok; kategori nonaktif disembunyikan secara bawaan dan muncul dengan sakelar.
3. "Tambah Subkategori" mengirim `parent_id` induknya; 422 dari server tampil verbatim.
4. Filter kategori di MaterialsPage mengirim `category_id` yang dipilih; dialog ubah kategori hanya menawarkan daun yang aktif.
5. Tombol kelola tidak muncul tanpa `material_categories.manage`.

Selesai bila: vitest hijau seluruhnya, build berhasil, dan di aplikasi nyata halaman Kategori menampilkan 10 kategori dengan 63 subkategori dan jumlah material (mis. CAT_02 = 369, CAT_05 = 106).
