# Prompt siap tempel — halaman buku harga (agen frontend)

Anda adalah agen frontend DISTRIVA (React/Vite di `frontend/`). Bangun halaman **buku harga per kontrak** di bawah master data: daftar, impor CSV (dry run → terapkan), detail dengan zona per UP3 dan tabel item, serta layar persetujuan. Jangan mengubah backend. Baca berurutan: `docs/67-FRONTEND-HANDOFF-PRICE-BOOKS.md` (utama) dan `docs/57-API-CONTRACT.md` bagian "Buku harga per kontrak".

Aturan: hak akses ditentukan backend; UI hanya menampilkan/menyembunyikan menurut `can[...]` dari `GET /master-data/access` (`prices.manage`, `prices.approve`; fail-closed). Pesan galat 403/409/422 ditampilkan apa adanya. Format rupiah Indonesia, jangan membulatkan di klien. Jangan menulis password/token di kode, dan jangan menyetujui buku harga dari kode pengujian atau skrip — persetujuan dilakukan pemilik lewat layar.

Data uji di `distriva_db` (baca saja): satu draf buku harga `f8d287b7-a07b-4f84-a67e-4f50b06f2759` (504 item, zona 1/2/3/5, zona 2 untuk UP3 Mojokerto) menunggu persetujuan. Sertakan tes Vitest sesuai docs/67 §4. Laporkan hanya hasil tes yang benar-benar dijalankan; temuan kontrak ditulis di docs/67 §5, bukan ditebak.
