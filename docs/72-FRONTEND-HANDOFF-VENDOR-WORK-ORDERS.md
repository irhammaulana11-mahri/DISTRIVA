# Serah terima frontend — vendor dan SPK/WO (docs/62 §32)
Backend siap di kode (tes lulus); migrasi 180000 belum diterapkan ke `distriva_db`. Kontrak: docs/57 "Vendor dan WO/SPK".
## Halaman internal
- **Master vendor** (Master Data): perusahaan (kode, nama, status), tautkan akun vendor (pilih pengguna berperan VENDOR), nonaktifkan akun, tangguhkan perusahaan. Hanya `vendors.manage`.
- **WO pada permohonan** (setelah MTO disetujui dan RAB dijalankan): buat WO → pilih vendor + catatan alasan → ajukan → ASMAN_KONSTRUKSI: **Terbitkan (menyetujui WO dan vendor)** atau **Kembalikan** (alasan). Tampilkan tugas (satuan, volume, nilai), material, riwayat, daftar versi. Tombol menurut izin: `wo.create` (buat, pilih vendor, ajukan, amandemen), `wo.issue`, `wo.progress_submit`, `wo.progress_verify`, `wo.complete` (selesai, batal; alasan wajib).
- **Progres**: per tugas tampilkan progres terverifikasi, antrean pengajuan (persen kumulatif, catatan), tombol Verifikasi/Kembalikan (alasan). **WO tidak lagi diselesaikan dengan tombol sendiri**: WO selesai ketika ASMAN_KONSTRUKSI menutup BASTP (docs/75); hapus/ganti tombol "Selesai" dengan tautan ke BASTP. Tampilkan status eksternal permohonan (PEREMAJAAN) dan pesan 409 apa adanya.
## Portal vendor (pengguna berperan VENDOR)
Daftar `GET /work-orders` (hanya milik perusahaannya), detail tanpa nilai RAB, **formulir progres kumulatif** per tugas (persen 0–100, catatan) dengan `submission_key` unik per pengajuan (UUID dibuat klien; kirim ulang kunci yang sama aman). Tampilkan status tiap pengajuan (menunggu/terverifikasi/dikembalikan + alasan).
## Aturan UI dan tes
Fail-closed menurut izin; pesan 403/404/409/422 apa adanya. Tes Vitest: tombol menurut izin, idempotensi `submission_key`, vendor tidak melihat nilai, alur status WO.
