# Prompt siap tempel — halaman BOM + persetujuan (agen frontend)

Anda adalah agen frontend DISTRIVA (React/Vite di `frontend/`). Bangun halaman BOM master data: daftar versi, detail, impor, kalkulator, dan **layar persetujuan**. Jangan mengubah backend. Baca berurutan: `docs/66-FRONTEND-HANDOFF-BOM-PAGES-AND-PBPD.md` (utama), `docs/61-FRONTEND-HANDOFF-BOM-AND-MFA-FIXES.md` §3 (rincian halaman), `docs/57-API-CONTRACT.md` (kontrak BOM §3a, MTO §3f).

Aturan: hak akses ditentukan backend; UI hanya menampilkan/menyembunyikan menurut `can[...]` dari `GET /master-data/access` (fail-closed). Pesan galat 403/409/422 ditampilkan apa adanya. Jangan mengevaluasi rumus di klien. Jangan menulis password/token di kode.

Cakupan: (1) daftar BOM dengan filter 9 kelompok (termasuk `PBPD_6_41`, `PBPD_53_197`) dan status; (2) detail dengan riwayat, parameter (tipe teks = dropdown `options`), baris + rumus H/I/J/K dan kolom B bila ada; (3) impor JSON (dry run → terapkan); (4) kalkulator (kelompok PBPD tanpa jenis konstruksi, `params` teks/angka); (5) layar persetujuan (alasan wajib, banyak draf sekaligus, nonaktifkan); (6) peringatan `pbpd_unmatched`/`pbpd_applied` pada hasil ekstraksi MTO bila halaman MTO sudah ada. Sertakan tes Vitest sesuai docs/66 §5. Laporkan hanya hasil tes yang benar-benar dijalankan; temuan kontrak ditulis di docs/66 §6, bukan ditebak.
