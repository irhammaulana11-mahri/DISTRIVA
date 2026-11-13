# 30 — PostgreSQL Dependency Test Fixtures (DISTRIVA v3.2.2)

**Tanggal:** 5 November 2026  
**Tujuan:** menyediakan dependency contract fixture untuk menguji DDL T4.2.4 di database PostgreSQL disposable.  
**Status:** DISIAPKAN; belum dieksekusi pada PostgreSQL pengguna.

## Penting: batas validitas

File fixture ini bukan migration Laravel, bukan schema produksi, dan bukan klaim bahwa T4.2.1–T4.2.3 telah diimplementasikan. Fixture dibuat hanya untuk memenuhi target FK yang secara eksplisit direferensikan DDL T4.2.4, menggunakan tipe key dan nama tabel/kolom yang didukung dokumen v3.2.1.

- T4.2.1: dependency fixture mengacu `22-T4.2.1-FOUNDATION-SCHEMA.md`.
- T4.2.2: dependency fixture mengacu `23-T4.2.2-MASTER-DATA-SCHEMA.md`.
- T4.2.3: dependency fixture adalah **contract-minimal**, bukan schema penuh. Dokumen T4.2.3 masih memiliki isu terbuka; fixture ini hanya menguji kompatibilitas FK T4.2.4.
- T4.2.4: DDL diambil dari `27-T4.2.4-POSTGRESQL-DDL.sql` yang berada dalam checkout dokumentasi yang sama.

Tidak boleh memakai fixture ini untuk menjalankan aplikasi, membuat migration produksi, atau menyimpulkan bahwa seluruh domain dependency sudah tervalidasi.

## Isi

| File | Fungsi |
|---|---|
| `00-guard-and-extensions.sql` | Guard database dan extension yang dibutuhkan |
| `01-t421-foundation-dependency-fixture.sql` | Users, organizational units, roles, permissions, role assignments |
| `02-t422-master-data-dependency-fixture.sql` | Materials, units, KHS, construction, BOM |
| `03-t423-application-dependency-fixture.sql` | Customers, customer references, applications |
| `04-t4224-ddl-and-fixture-data.sql` | Data sintetis untuk target T4.2.4 |
| `05-run-test-suite.sh` | Runner dengan guard dan konfirmasi nama database |
| `06-cleanup.sql` | Reset schema public; destructive, hanya database test |

## Prasyarat

- PostgreSQL yang didukung oleh DDL (target desain saat ini PostgreSQL 18).
- `psql` tersedia.
- User database memiliki `LOGIN`, `CREATEDB` untuk membuat database, dan hak `CREATE` pada schema yang dipakai.
- Database bernama tepat `distriva_t424_test`.
- Dokumentasi dan fixture berada dalam satu repository/package dengan struktur direktori yang dipertahankan.

Buat database disposable sebagai user yang memiliki CREATEDB:

```bash
createdb -h 127.0.0.1 -p 5432 -U distriva_user -W distriva_t424_test
```

Jika role belum memiliki privilege yang diperlukan, minta administrator mengaturnya. Jangan meminta password dikirim melalui chat.

## Menjalankan

Dari root repository:

```bash
DB_NAME=distriva_t424_test \
DB_HOST=127.0.0.1 \
DB_PORT=5432 \
DB_USER=distriva_user \
bash database/testing/postgresql/05-run-test-suite.sh
```

Runner:
1. menolak nama database selain `distriva_t424_test`;
2. menampilkan target koneksi;
3. meminta konfirmasi nama database;
4. menjalankan guard dan fixture T4.2.1–T4.2.3;
5. menjalankan DDL T4.2.4 dari folder `docs/`;
6. menambahkan data sintetis minimal.

`04-t4224-ddl-and-fixture-data.sql` harus dijalankan setelah DDL T4.2.4 berhasil dibuat. Jika gagal, catat output error lengkap tanpa mengubah FK/constraint agar lolos.

## Catatan kompatibilitas yang harus ditinjau

1. Fixture roles memakai `BIGINT` sesuai desain Spatie; pastikan DDL T4.2.4 memakai tipe yang sama.
2. `materials.unit` tetap `VARCHAR(30)` sesuai T4.2.2; FK Auto MTO memakai `units_of_measure`.
3. KHS identity dan version dipisah.
4. `bom_headers` merupakan row versi BOM.
5. `applications.organizational_unit_id` mereferensikan `organizational_units` dan fixture ULP menggunakan parent UP3.
6. T4.2.3 belum final penuh. Fixture ini tidak memutuskan isu Bot Daftung, payment, external references, atau workflow.

## Status pengujian

Pada saat dokumen dibuat, belum ada koneksi PostgreSQL dari sesi penyusunan ini. Karena itu:
- Fixture SQL: disiapkan.
- Shell runner: disiapkan dan diperiksa secara statis.
- Eksekusi PostgreSQL: NOT RUN.
- FK/trigger runtime test: NOT RUN.
- Negative test suite: belum otomatis dijalankan; ikuti test plan T4.2.4.
