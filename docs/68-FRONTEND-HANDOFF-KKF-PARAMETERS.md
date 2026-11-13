# Serah terima frontend — pengaturan parameter KKF (docs/62 §25)
Backend siap di kode (tes lulus); **belum diterapkan ke `distriva_db`** sampai pemilik menyetujui migrasi `2026_11_07_130000` dan seeder izin. Kontrak lengkap: docs/57 bagian "Parameter KKF".

## 1. Halaman
Master data → **Parameter KKF**:
1. **Daftar** set (nama, berlaku dari/sampai, status, discount rate, BPP); filter status; penanda set yang sedang berlaku.
2. **Form buat/ubah draf**: nama, tanggal mulai berlaku, catatan, dan sembilan nilai. Tampilkan tarif sebagai **persen** (0,0778 → 7,78 %) tetapi kirim **pecahan**; BPP dalam Rp/kWh; horizon tahun; batas PBP bulan. Isi awal dari `defaults` pada `GET /kkf-parameters`.
3. **Detail**: nilai, riwayat (`events`), tombol **Setujui** / **Nonaktifkan** (hanya bila `can['kkf_params.approve']`), **Ubah** hanya untuk DRAFT dan `can['kkf_params.manage']`.
4. Set yang sudah disetujui tidak dapat diubah: untuk mengganti nilai, buat set baru dengan tanggal berlaku lebih baru (set lama otomatis ditutup).

## 2. Aturan UI
- Hak akses dari `GET /master-data/access` (`kkf_params.manage`, `kkf_params.approve`), fail-closed; pembuat tidak dapat menyetujui sendiri (backend 403 — tampilkan pesannya apa adanya).
- Pesan 403/404/409/422 ditampilkan apa adanya; 422 per field.
- Validasi sisi klien hanya bantuan: discount rate 0–100 %, faktor beban (0–100 %], horizon 1–50, dst. (batas backend ada di docs/57).

## 3. Tes Vitest
Konversi persen↔pecahan (7,78 ↔ 0.0778, tanpa galat pembulatan tampilan), tombol menurut izin, form mengirim hanya field yang diubah pada PUT, penanganan 409 (tanggal tidak setelah set aktif).
