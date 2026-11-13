# PROMPT EKSEKUSI — Agen Frontend DISTRIVA: Backup dan Restore

> Salin seluruh isi di bawah garis ini sebagai prompt untuk agen frontend.

---

Kamu adalah agen frontend untuk DISTRIVA (React 19 + Vite + Tailwind di folder `frontend/`). Backend Laravel **sudah selesai dan teruji**; tugasmu membangun halaman **Backup & Pemulihan** untuk API yang sudah ada. **Jangan mengubah apa pun di `backend/`, `database/`, atau `tools/`, dan jangan menjalankan perintah apa pun terhadap database.**

## Baca dulu (wajib, berurutan)
1. `docs/65-FRONTEND-HANDOFF-BACKUP-RESTORE.md` — susunan halaman, perilaku, alur Pulihkan, dan tes yang diminta.
2. `docs/57-API-CONTRACT.md` bagian **§1 dan §3g** — kontrak API yang sebenarnya (endpoint, masukan, keluaran, kode galat).
3. `docs/64-BACKUP-RESTORE.md` — aturan keselamatan dan arti tiap fitur (supaya teks peringatan di UI akurat).
4. Pola yang ada: `frontend/src/services/api.js`, `frontend/src/features/*`, `frontend/src/pages/master-data/*`, `frontend/src/App.jsx`, `frontend/src/features/modules/moduleRegistry.js`, `frontend/src/components/StatusBadge.jsx`.

## Yang harus dikerjakan
Halaman `/sistem/backup` dengan empat tab: **Ringkasan** (kesehatan folder, cadangan terakhir, peringatan usia/verifikasi, tombol buat cadangan, proses berjalan), **Riwayat** (tabel + filter + paginasi + detail dengan linimasa; aksi Verifikasi, Unduh, Hapus, Pulihkan), **Jadwal** (formulir pengaturan), **Pemulihan** (riwayat pemulihan). Alur **Pulihkan** adalah dialog bertahap dengan peringatan merah, alasan, kata sandi, dan frasa ketik `PULIHKAN <nomor>`, lalu layar proses berjalan dengan polling dan penanganan 401 yang wajar (token ikut dipulihkan). Detail lengkap di docs/65 §1–§3.

## Aturan keras
- **Backend satu-satunya penentu hak akses.** Menu, rute, dan tombol mengikuti `GET /backups/access` (`can`). Jangan menyimpulkan hak dari nama peran; fail-closed bila API gagal.
- **Jangan menebak kontrak.** Bila endpoint/kolom tidak ada atau tidak jelas, berhenti di bagian itu dan tulis di docs/65 §6; lanjutkan bagian lain.
- **Jangan memindahkan aturan keselamatan ke klien:** validasi frasa/kata sandi/verifikasi hanyalah kemudahan UI; server yang memutuskan. Tampilkan pesan 409/403/422 dari server apa adanya.
- Unduhan **harus** lewat `fetch` dengan header `Authorization` lalu `Blob` (tidak boleh `<a href>`/`<img src>` langsung). Kata sandi pengguna tidak boleh masuk log, state global, atau berkas tes; kosongkan setelah dikirim.
- Polling harus dibersihkan saat unmount dan berhenti bila tidak ada proses `RUNNING`.
- Token tetap di `sessionStorage`. Untuk tes gunakan respons tiruan; jangan memakai data nyata, jangan membaca `tools/eis_sync/eis_session.json`.
- Semua teks antarmuka berbahasa Indonesia, aksesibel (dialog dengan fokus terkunci, `aria-live` untuk status proses), responsif, konsisten dengan komponen yang ada. Jangan menambah dependensi baru tanpa alasan kuat; bila perlu, sebut di laporan.

## Selesai berarti
- Tes Vitest untuk skenario di docs/65 §4 lulus bersama seluruh tes yang sudah ada (`npm test`), dan `npm run build` sukses.
- Laporan akhir menyebut: halaman/rute yang dibuat, file yang berubah, hasil tes + build (angka sebenarnya), hal yang belum bisa dikerjakan beserta alasannya, dan temuan di docs/65 §6.
