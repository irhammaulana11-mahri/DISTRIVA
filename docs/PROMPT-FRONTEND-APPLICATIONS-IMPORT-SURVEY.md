# PROMPT EKSEKUSI — Agen Frontend DISTRIVA: Permohonan PB/PD, Impor EIS, Survey, Dokumen, Gambar Teknik, MTO

> Salin seluruh isi di bawah garis ini sebagai prompt untuk agen frontend.

---

Kamu adalah agen frontend untuk DISTRIVA (React 19 + Vite + Tailwind di folder `frontend/`). Backend Laravel **sudah selesai dan teruji**; tugasmu membangun antarmuka untuk API yang sudah ada. **Jangan mengubah apa pun di `backend/`, `database/`, atau `tools/`.**

## Baca dulu (wajib, berurutan)
1. `docs/63-FRONTEND-HANDOFF-APPLICATIONS-IMPORT-SURVEY.md` — rencana halaman, perilaku, dan tes yang diminta.
2. `docs/57-API-CONTRACT.md` bagian **§1, §3c (permohonan + impor), §3d (survey + dokumen), §3e (gambar teknik), §3f (MTO)** — kontrak API yang sebenarnya (endpoint, masukan, keluaran, kode galat).
3. `docs/61-FRONTEND-HANDOFF-BOM-AND-MFA-FIXES.md` — aturan umum, pola, dan perbaikan `MfaPage` (kerjakan perbaikan MFA itu lebih dulu bila belum).
4. Kode yang ada sebagai pola: `frontend/src/services/api.js`, `frontend/src/pages/master-data/*`, `frontend/src/features/*`, `frontend/src/App.jsx`, `frontend/src/features/modules/moduleRegistry.js`.

## Yang harus dikerjakan (urutan dan batas)
Kerjakan per bagian, jalankan tes + build sebelum lanjut, dan lapor singkat di akhir tiap bagian:
- **A. Permohonan PB/PD:** daftar + filter + paginasi, formulir (PB/PD, daya dengan satuan VA/kVA), detail (riwayat status, No. Agenda/Register, ajukan, batal).
- **B. Impor EIS:** wizard unggah → pratinjau (Baru/Cocok/Tidak berubah/Ditolak, errors, warnings, perubahan per kolom) → konfirmasi/buang → hasil.
- **C. Survey:** daftar survey per permohonan, penugasan, detail dengan stepper rantai persetujuan, form hasil survey (termasuk pengukuran dinamis), ajukan, keputusan setuju/tolak (tolak wajib alasan).
- **D. Dokumen/foto:** unggah beberapa berkas, galeri, pratinjau/unduh **lewat `fetch` dengan header `Authorization` lalu `Blob`** (jangan `<img src>` langsung ke API), hapus saat DRAFT.
- **E. Gambar teknik:** paket per permohonan (muncul bila survey `ACCEPTED` dengan penanda gambar), versi dengan satu berkas utama + lampiran, stepper rantai **normal** (Manager ULP → Review UP3 Perencanaan + Konstruksi → Asman Perencanaan + Asman Konstruksi → Disetujui) dan **diperluas** (tambah Asman Niaga lalu Manager UP3), keputusan setuju/tolak (satu penolakan = kembali ke penyusun, berkas diunggah ulang), tombol "wajibkan persetujuan diperluas", revisi pasca-disetujui. Format berkas DWG/DXF/Office tidak dapat dipratinjau (unduh saja).
- **F. MTO per versi gambar:** tabel jumlah pasang/bongkar per jenis konstruksi (dari daftar jenis konstruksi), alasan wajib setelah simpanan pertama, pratinjau kebutuhan material per kode KHS, verifikasi (TEKNIK) lalu setujui/tolak (Manager ULP; tolak wajib alasan), hubungan dengan persetujuan gambar (gerbang MTO), dan **tombol "Isi dari berkas gambar"** (`POST /mto/{id}/extract`, docs/63 §F butir 6; sumber Excel atau PDF hasil ekspor Excel, pilihan berkas lewat `document_id`, laporan juga memuat `pbpd`) dengan laporan terbaca/tidak dikenali/peringatan serta lencana sumber (`EXTRACTED`/`MANUAL`) dan angka `detected_*`.
- Perbarui menu dan `moduleRegistry.js` (PB/PD, Survey, Drawing, dan Auto MTO tahap 4A menjadi Aktif; RAB & KKF, RKM, SPK/WO, BASTP tetap "Menunggu backend").

## Aturan keras
- **Backend adalah satu-satunya penentu hak akses.** Tampilkan/sembunyikan tombol hanya dari `GET /applications/access`, `GET /surveys/access`, `GET /drawings/access`, `GET /mto/access`, dan `data.can` pada detail survey/gambar/MTO. Jangan menyimpulkan hak dari nama peran. Fail-closed bila API gagal.
- **Jangan menebak kontrak.** Bila endpoint/kolom tidak ada atau tidak jelas, **berhenti di bagian itu** dan tulis di docs/63 §9 (Temuan frontend untuk backend); lanjutkan bagian lain.
- **Jangan menghitung ulang aturan bisnis di klien** (delta daya, status berikutnya, kelengkapan, urutan persetujuan). Tampilkan nilai dan pesan dari server apa adanya (409/403/422 → pesan Indonesia dari `message`/`errors`).
- Token tetap di `sessionStorage`; jangan menulis token/kata sandi/data pelanggan ke log, tes, atau berkas. Untuk tes gunakan respons tiruan; **jangan memakai atau menyalin `tools/samples/GV.xls`** (data pribadi pelanggan) dan jangan membaca `tools/eis_sync/eis_session.json`.
- Semua teks antarmuka berbahasa Indonesia, aksesibel (label, fokus, kontras), responsif, konsisten dengan komponen yang ada (`Field`, `Alert`, `Card`).
- Jangan menambah dependensi baru tanpa alasan kuat; jika perlu, sebut di laporan.

## Selesai berarti
- Tes Vitest untuk skenario di docs/63 §7 lulus bersama seluruh tes yang sudah ada (`npm test`), dan `npm run build` sukses.
- Laporan akhir menyebut: halaman/rute yang dibuat, file yang berubah, hasil tes + build (angka sebenarnya), hal yang belum bisa dikerjakan beserta alasannya, dan temuan di docs/63 §9.
