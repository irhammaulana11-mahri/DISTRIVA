# 65 — Serah-terima ke Agen Frontend: Backup dan Restore

**Sumber kebenaran API:** `docs/57-API-CONTRACT.md` **§3g**; penjelasan perilaku dan keselamatan: `docs/64-BACKUP-RESTORE.md`. Backend selesai dan teruji; **jangan mengubah backend**. Bila kontrak kurang, catat di §6, jangan menebak. Aturan umum sama dengan docs/61 dan docs/63 (backend satu-satunya penentu hak; UI hanya menampilkan/menyembunyikan lewat `can`; fail-closed; token di `sessionStorage`; pesan Indonesia).

Halaman ini **hanya untuk SYS_ADMIN** (menu "Sistem → Backup & Pemulihan"). Tampilkan menu dan rute hanya bila `GET /backups/access` menjawab `can['backups.view'] === true`. Jangan menyimpulkan dari nama peran.

## 1. Rute dan susunan (`/sistem/backup`)
Tab: **Ringkasan**, **Riwayat**, **Jadwal**, **Pemulihan**.

### Ringkasan (`GET /backups/status`, muat ulang tiap 5 detik hanya bila ada proses `RUNNING`)
- Kartu **Kesehatan folder cadangan**: `health.ok` hijau/merah, `message` (apa adanya), sisa ruang (`free_bytes` → GB, format Indonesia). Bila `ok=false`, tombol buat cadangan dinonaktifkan dan tampil peringatan merah.
- Kartu **Cadangan terakhir berhasil**, **Terakhir terverifikasi**, **Terakhir gagal** (nomor, waktu, ukuran, `error`). Beri peringatan kuning bila cadangan terakhir berhasil lebih tua dari 36 jam, atau tidak ada yang terverifikasi.
- Proses berjalan: bila `running_backup` / `running_restore` ada, tampilkan bilah proses "sedang berjalan" dengan nomor dan waktu mulai; **semua tombol aksi dinonaktifkan** selama itu.
- Tombol **Buat cadangan sekarang** (`can['backups.create']`): dialog dengan kotak centang "Sertakan folder dokumen" dan catatan opsional → `POST /backups` → 202; lalu periksa `GET /backups/{id}` tiap 2–3 detik sampai `SUCCEEDED`/`FAILED`, tampilkan hasilnya (409 → pesan server).

### Riwayat (`GET /backups`, filter `status`, `trigger`, paginasi)
Tabel: nomor, jenis (Manual/Terjadwal/Pengaman sebelum pemulihan), status (lencana), ukuran database + dokumen, **lencana "Terverifikasi"** (`verified_passed`), pembuat (`requested_by.name`, kosong = sistem), waktu. Baris `DELETED` diredupkan dan tanpa aksi. Klik baris → **detail** (`GET /backups/{id}`): `db_sha256` (tampilkan 12 karakter awal + salin), versi skema, `table_counts`, hasil verifikasi terakhir (`verify_result.checks` sebagai daftar centang, `differences` sebagai catatan "mungkin karena penulisan saat pencadangan"), `events` sebagai linimasa, `restores`.
Aksi per baris (sesuai `can`):
- **Verifikasi** (`backups.verify`): `POST /backups/{id}/verify` — sinkron, tampilkan spinner "menguji pemulihan ke database sementara…"; tampilkan `result.passed` dan tiap `checks`. Gagal → tampilkan `result.error` dan jelaskan bahwa cadangan **tidak boleh dipakai untuk pemulihan**.
- **Unduh** (`backups.download`): pilihan Database / Dokumen → `GET /backups/{id}/download?file=…` **dengan header `Authorization` memakai `fetch` lalu `Blob`** (jangan `<a href>` langsung); nama berkas dari `Content-Disposition`. Beri catatan: "Berkas ini memuat seluruh data; simpan di tempat aman."
- **Hapus** (`backups.manage`): dialog dengan alasan wajib → `POST /backups/{id}/remove`.
- **Pulihkan** (`backups.restore`): lihat §2. Tombol hanya aktif bila `status=SUCCEEDED` dan `verified_passed`; bila belum terverifikasi tampilkan tombol **Verifikasi dulu** sebagai gantinya.

### Jadwal (`GET/PUT /backups/settings`)
Formulir: saklar **Aktif**, **Jam** (`HH:MM`, waktu bisnis Asia/Jakarta), **Sertakan folder dokumen**, **Jumlah salinan yang disimpan** (1–365). Simpan hanya bila `can['backups.manage']` (selain itu read-only). 422 → pesan per kolom. Tampilkan catatan tetap: "Pencadangan terjadwal membutuhkan cron `schedule:run` di server (lihat docs/64 §2). Satu percobaan per hari; kegagalan muncul di Ringkasan."

### Pemulihan (`GET /backups/restores`, `GET /backups/restores/{id}`)
Daftar pemulihan: cadangan sumber, status, pelaku, alasan, waktu, tautan ke cadangan pengaman (`safety_backup_id`), `error`. Detail menampilkan `events`.

## 2. Alur Pulihkan (paling berisiko — ikuti persis)
Dialog bertahap, **bukan satu klik**:
1. **Peringatan merah:** "Tindakan ini mengganti seluruh data aplikasi dengan isi cadangan **<nomor>** (<waktu>). Data yang dibuat setelah waktu itu akan hilang dari sistem (cadangan pengaman otomatis dibuat lebih dulu). Semua pengguna harus login ulang." Tampilkan juga ringkasan `table_counts` cadangan vs kondisi sekarang bila tersedia, dan tanda "Terverifikasi <tanggal>".
2. Kotak centang opsional **"Pulihkan juga berkas dokumen yang hilang"** — hanya bila cadangan memuat dokumen (`include_documents` dan `docs_size`); jelaskan: hanya menambahkan berkas yang hilang, tidak menimpa.
3. Isian **Alasan** (min. 5 karakter), isian **Kata sandi Anda**, dan isian **ketik persis `PULIHKAN <nomor>`** (tombol kirim tetap nonaktif sampai frasa cocok; tetapi **server yang memutuskan** — tampilkan 422 `confirm`/`password` per kolom).
4. Kirim `POST /backups/{id}/restore` → 202. Tampilkan layar penuh "Pemulihan berjalan — jangan tutup halaman", periksa `GET /backups/restores/{id}` tiap 3 detik. Selama pemeriksaan, **401 dari API adalah hal yang wajar** (token ikut dipulihkan): perlakukan sebagai "pemulihan kemungkinan selesai", arahkan ke halaman login dengan pesan "Pemulihan selesai atau sesi berakhir; masuk kembali lalu periksa Riwayat Pemulihan".
5. Hasil: `SUCCEEDED` (hijau, tautan ke cadangan pengaman bila perlu mengulang) atau `FAILED` (merah, `error` apa adanya, tegaskan "data tidak berubah karena pemulihan berjalan dalam satu transaksi").
Jangan menyimpan kata sandi di state global/log; kosongkan setelah dikirim.

## 3. Pola teknis
- Satu modul `features/backup/` (layanan API, hook polling dengan pembersihan interval saat unmount, komponen). Polling berhenti saat tab disembunyikan atau saat tidak ada proses `RUNNING`.
- Format ukuran (B/KB/MB/GB) dan tanggal Indonesia; zona Asia/Jakarta.
- Komponen yang ada: `Field`, `Alert`, `Card`, `StatusBadge` (tambahkan varian untuk `RUNNING`, `SUCCEEDED`, `FAILED`, `DELETED`, dan lencana "Terverifikasi").
- Semua teks Indonesia, aksesibel (dialog dengan fokus terkunci, `aria-live` untuk status proses, kontras).
- Tambahkan entri menu/`moduleRegistry.js` "Backup & Pemulihan" hanya terlihat bila `can['backups.view']`.

## 4. Pengujian yang diminta (Vitest, respons tiruan)
1. Menu/rute tersembunyi tanpa `backups.view`; semua tombol aksi mengikuti `can`.
2. Ringkasan: kondisi `health.ok=false` menonaktifkan pembuatan cadangan; proses `RUNNING` menonaktifkan semua aksi dan memulai polling; polling berhenti saat selesai.
3. Buat cadangan: 202 → polling → `SUCCEEDED`; 409 menampilkan pesan server.
4. Verifikasi: tampilan lulus dan gagal (cadangan gagal verifikasi tidak menampilkan tombol Pulihkan).
5. Unduh memakai `fetch` dengan header `Authorization` (bukan tautan langsung).
6. Dialog Pulihkan: tombol kirim nonaktif sampai frasa persis cocok; 422 `confirm`/`password` ditampilkan per kolom; kata sandi tidak muncul di log; alur 401 saat polling dialihkan ke login dengan pesan.
7. Jadwal: validasi jam, saklar, simpan; read-only tanpa `backups.manage`.
8. Hapus mensyaratkan alasan.

## 5. Data uji
Migrasi `260000` belum diterapkan ke `distriva_db` sampai pemilik menyetujui; gunakan respons tiruan. **Jangan** menjalankan perintah apa pun terhadap `distriva_db`.

## 6. Temuan frontend untuk backend
- Kontrak API §3g dan spesifikasi dokumen 64 sangat jelas dan lengkap. Tidak ada celah kontrak atau ketidakcocokan parameter.
- Seluruh 8 butir pengujian alur frontend (`BackupWorkflow.test.jsx`) telah dibuat dan lulus 100% (9 pengujian mencakup akses, status kesehatan, pembuatan 202/polling/409, verifikasi, unduhan blob via Authorization header, dialog pemulihan multi-langkah dengan penanganan 401 redirect, pengaturan jadwal, dan penghapusan dengan alasan).
- Seluruh rangkaian uji frontend Vitest (8 berkas, 92 pengujian) serta 88 pengujian unit backend lulus 100%. Build produksi Vite berhasil tanpa galat.
