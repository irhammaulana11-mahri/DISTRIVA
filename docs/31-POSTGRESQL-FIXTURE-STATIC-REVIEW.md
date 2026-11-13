# 31 — PostgreSQL Fixture Static Review

**Versi:** 3.2.2  
**Tanggal:** 5 November 2026  
**Status:** STATIC REVIEW ONLY — runtime belum dijalankan.

## Hasil pemeriksaan

- [x] File fixture dipisahkan per dependency T4.2.1, T4.2.2, T4.2.3.
- [x] Fixture T4.2.3 diberi label contract-minimal karena desainnya masih memiliki isu terbuka.
- [x] Tipe ID users/organizational_units/materials/KHS/BOM/applications menggunakan UUID sesuai dokumen.
- [x] `roles.id` menggunakan BIGINT sesuai desain Spatie.
- [x] `materials.unit` menggunakan VARCHAR(30), tidak diasumsikan sebagai FK.
- [x] KHS identity dan KHS version dipisahkan.
- [x] `bom_headers` digunakan sebagai identitas versi BOM.
- [x] Guard mencegah runner/cleanup dijalankan pada database selain `distriva_t424_test`.
- [x] Password tidak disimpan di script; koneksi psql dapat meminta password secara interaktif.
- [x] Tidak ada fixture schema yang diklaim sebagai migration produksi.

## Batasan yang ditemukan

1. Fixture sengaja hanya menyediakan tabel dan kolom dependency yang dibutuhkan DDL T4.2.4; bukan keseluruhan T4.2.1–T4.2.3.
2. Trigger bisnis untuk hierarki organisasi, role scope, validasi application ULP, exclusion temporal, dan aturan domain belum direplikasi seluruhnya. Tujuan fixture adalah FK/DDL integration test, bukan uji seluruh domain.
3. Data uji belum mengisi seluruh jalur Auto MTO. Data tambahan harus dibuat berdasarkan test plan dan DDL yang berhasil dieksekusi.
4. Perlu audit ulang DDL T4.2.4 terhadap seluruh composite FK dan unique key sebelum runtime.
5. Runner tidak otomatis menjalankan test plan lengkap; hanya setup fixture, apply DDL, dan seed awal.

## Status

Tidak ada klaim PASS runtime. Semua item di atas merupakan pemeriksaan file secara statis.
