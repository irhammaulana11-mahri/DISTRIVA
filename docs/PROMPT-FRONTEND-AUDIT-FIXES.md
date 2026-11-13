# Prompt siap tempel — perbaikan dan penyesuaian frontend hasil audit (agen frontend)

Anda adalah agen frontend DISTRIVA (React/Vite di `frontend/`). Backend tahap 1–8 sudah lengkap; audit terhadap frontend (docs/77-FRONTEND-AUDIT-DAN-PERBAIKAN.md) menemukan delapan celah. Kerjakan berurutan A–H sesuai dokumen itu; kontrak API ada di `docs/57-API-CONTRACT.md`, perilaku di `docs/62` §30–38 dan serah terima `docs/71`–`docs/76`.

Ringkasan tugas:
- **A (kritis)** — panggil `GET /api/planning/access` di `AccessContext` dan gabungkan ke `can` (kunci `rab.*`, `kkf.*`, `allocations.*`, `proposals.*`, `rkm.*`, `wo.*`, `bastp.*`, `vendor.portal`); hapus daftar kunci SYS_ADMIN yang ditanam.
- **B** — panel alokasi: dua bagian terpisah (`PUT /allocations/{id}/materials` untuk `allocations.manage`, `PUT /allocations/{id}/poles` untuk `allocations.poles`) dan `POST /allocations/{id}/confirm` dengan `{part}`; hapus pemanggilan `/lines`.
- **C** — ganti tombol "Selesai" WO dengan tautan ke BASTP; hapus `workOrdersApi.complete` dan sesuaikan tes.
- **D** — tombol "Mulai Survey" dan "Buka Paket Gambar" untuk TEKNIK tanpa memilih petugas (`POST` tanpa `assigned_to`); penunjukan oleh MANAGER_ULP tetap opsional; edit draf tampil untuk setiap TEKNIK ULP.
- **E** — halaman daftar PB/PD memakai `GET /applications?listing=pbpd`, menampilkan `proposal_number` dan `source_type`.
- **F** — izinkan menu dan rute `/work-orders` bila `can['vendor.portal']` atau `can['wo.view']`.
- **G** — sembunyikan panel KKF per permohonan bila permohonan anggota usulan; tampilkan tautan ke usulan.
- **H** — perbarui `moduleRegistry` dan Beranda (status ACTIVE; modul BASTP dan usulan; langkah 5–8 menuju halaman nyata).

Aturan: hak akses ditentukan backend; UI hanya menampilkan/menyembunyikan menurut respons server (fail-closed). Pesan galat 403/404/409/422 ditampilkan apa adanya. Jangan mengubah backend. Perbarui atau tambah tes Vitest untuk setiap perubahan; jalankan `vitest run` dan `vite build`, dan laporkan hanya hasil yang benar-benar dijalankan.
