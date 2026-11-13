# Serah terima frontend — buku tarif dan run KKF (docs/62 §26)
Backend siap di kode; **belum diterapkan ke `distriva_db`** (migrasi 130000 dan 140000 + seeder izin menunggu persetujuan pemilik). Kontrak: docs/57 "Buku tarif" dan "Run KKF". Parameter KKF: docs/68.

## 1. Halaman buku tarif (master data)
Daftar buku (nama, berlaku dari/sampai, status, jumlah baris) · impor CSV (dry run → tabel baris dengan status/galat → terapkan) · detail dengan tabel baris (filter tarif, paginasi) dan riwayat · Setujui/Nonaktifkan hanya bila `can['tariffs.approve']`; impor hanya bila `can['tariffs.manage']`. Format CSV ditampilkan di halaman impor.

## 2. Panel KKF pada halaman permohonan (setelah RAB)
- Form: biaya estetika (opsional), dan **jenis kWh meter sebelumnya** (PRABAYAR/PASCABAYAR) hanya bila permohonan perubahan daya ke pascabayar (backend meminta lewat 409); jenis meter sekarang dibaca otomatis dari PAKET_SAR; biaya penyambungan **tidak diketik** — tampilkan nilai yang dipakai (total biaya EIS, dikurangi UJL bila pascabayar) dari `sources`/`inputs.connection_fee`; pilihan run RAB (default terbaru), tanggal (opsional). Tombol **Hitung (dry run)** menampilkan hasil tanpa menyimpan; **Simpan run** hanya untuk `can kkf.run`.
- Hasil: investasi, daya hitung, jam nyala, harga rata-rata, BPP, discount rate (tampilkan sumber: set parameter dan buku tarif), IRR, NPV, B/C, PBP (teks), rasio BP, RWACC, LAYAK/TIDAK LAYAK dan kriteria; tabel arus kas tahun 0–25; `snapshot_hash`.
- Bila `extended_required`: tampilkan peringatan bahwa gambar memerlukan persetujuan diperpanjang (ASMAN_NIAGA dan UP3_MANAGER). Jangan mengubah `extended_approval` gambar dari panel ini (menunggu keputusan pemilik).
- Riwayat run (nomor, tanggal, layak, NPV, IRR, PBP, run RAB) dan detail satu run (tak-berubah).
- Pesan 403/404/409/422 ditampilkan apa adanya (409 menjelaskan sumber yang belum ada: parameter, tarif, RAB, daya).

## 3. Tes Vitest
Impor dry run → galat per baris; tombol menurut izin; panel KKF menampilkan peringatan diperpanjang; dry run tidak menambah riwayat; format rupiah/persen.
