# Prompt siap tempel — dokumen keluaran RAB/KKF (agen frontend)

Anda adalah agen frontend DISTRIVA (React/Vite di `frontend/`). Bangun pratinjau, cetak, dan unduh XLSX untuk dokumen keluaran: REKAP dan REKAP RINCI (dari run RAB), KKF dan HPE (dari run KKF). Baca dulu `docs/70-FRONTEND-HANDOFF-OUTPUT-DOCUMENTS.md` dan bagian "Dokumen keluaran" di `docs/57-API-CONTRACT.md`. Tempatkan tombolnya pada riwayat run RAB dan run KKF yang sudah ada.

Aturan: hak akses ditentukan backend (`rab.view`, `kkf.view`); tampilkan galat 403/404/422 apa adanya. Jangan mengubah backend. Dokumen dirender dari JSON generik (`sections` dengan `columns/rows/footer` atau `pairs`), bukan dari templat per-dokumen yang di-hardcode. Sertakan tes Vitest sesuai docs/70 dan laporkan hanya hasil tes yang benar-benar dijalankan.
