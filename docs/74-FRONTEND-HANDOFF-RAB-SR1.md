# Serah terima frontend — RAB dan jadwal harga SR 1 fasa (docs/62 §21, §23)
Backend sudah ada di kode dan di tes (RAB: run tersimpan per paket MTO yang disetujui; jadwal SR 1 fasa: versi DRAFT→APPROVED→INACTIVE). Kontrak lengkap: docs/57 bagian "RAB" dan "Jadwal harga SR 1 fasa". Dokumen cetak REKAP/REKAP RINCI: docs/70.
## 1. Halaman RAB (pada paket MTO yang disetujui, menu Auto MTO)
- Tombol **Hitung RAB (dry run)** → tampilkan hasil tanpa menyimpan (`POST /mto/{package}/rab-runs` dengan `dry_run`); tombol **Simpan run** (izin `rab.run`, PERENCANAAN). Tanggal acuan opsional (`date`).
- Hasil: tabel per kelompok pekerjaan (material, jasa, commissioning, K3L, asuransi, sub total, PPN 11 %, jumlah total), total keseluruhan, buku harga + zona yang dipakai, jadwal SR 1 fasa (bila ada), `snapshot_hash`, peringatan.
- Riwayat run (`GET /mto/{package}/rab-runs`) dan detail run (`GET /rab-runs/{id}`: baris per KHS). Tautan ke dokumen REKAP/REKAP RINCI (docs/70).
- 409 menjelaskan sumber yang belum ada (buku harga/zona/harga KHS/jadwal SR 1 fasa); tampilkan apa adanya.
## 2. Halaman jadwal harga SR 1 fasa (Master Data)
Daftar jadwal (status, berlaku dari), impor CSV (dry run → terapkan) mengikuti pola buku harga (docs/67), detail baris (jenis SERVICE/ITEM/INSURED/SUPPORT, kegiatan, basis ACTIVITY/TOTAL, koefisien, harga), Setujui/Nonaktifkan (`prices.approve`; pembuat tidak dapat menyetujui kecuali SYS_ADMIN), riwayat.
## 3. Tes Vitest
Tombol menurut izin (`rab.run`, `prices.manage`, `prices.approve`); dry run tidak menambah riwayat; format rupiah; galat 409 ditampilkan.
