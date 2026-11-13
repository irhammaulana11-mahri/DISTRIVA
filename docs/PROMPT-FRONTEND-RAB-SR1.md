# Prompt siap tempel — halaman RAB dan jadwal harga SR 1 fasa (agen frontend)

Anda adalah agen frontend DISTRIVA (React/Vite di `frontend/`). Bangun (1) **halaman RAB** pada paket MTO yang disetujui (hitung dry run, simpan run, hasil per kelompok pekerjaan, riwayat dan detail run, tautan ke dokumen REKAP/REKAP RINCI) dan (2) **halaman jadwal harga SR 1 fasa** di master data (daftar, impor CSV dry run → terapkan, detail baris, setujui/nonaktifkan). Baca dulu `docs/74-FRONTEND-HANDOFF-RAB-SR1.md`, bagian "RAB" dan "Jadwal harga SR 1 fasa" di `docs/57-API-CONTRACT.md`, dan ikuti pola halaman buku harga (`docs/67`).

Aturan: hak akses ditentukan backend; UI hanya menampilkan/menyembunyikan menurut izin efektif (`rab.view`, `rab.run`, `prices.manage`, `prices.approve`; fail-closed). Pesan galat 403/404/409/422 ditampilkan apa adanya. Jangan mengubah backend. Sertakan tes Vitest sesuai docs/74 §3 dan laporkan hanya hasil tes yang benar-benar dijalankan.
