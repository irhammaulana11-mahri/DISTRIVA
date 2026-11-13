# Serah terima frontend — BASTP (docs/62 §36, docs/73 §6)
Backend siap di kode (tes lulus); migrasi 190000 belum diterapkan ke `distriva_db`. Kontrak: docs/57 "BASTP".
## Alur dan tombol (pada halaman WO)
- Muncul bila WO `IN_PROGRESS` dan semua tugas terverifikasi 100 %: **Buat BASTP** (vendor penugasan WO, atau TEKNIK ULP dengan `bastp.prepare`).
- **Editor BASTP (DRAFT)**: (1) **Lampiran material terpasang** — tabel material WO dengan kolom rencana (baca-saja) dan terpasang (input), catatan; (2) **Bukti kWh meter** — daftar meter (ID pelanggan, nomor kWh meter; boleh banyak), per meter unggah **foto** (maksimal 10; gambar); simpan seluruh daftar sekaligus; (3) catatan. Tombol **Ajukan & tanda tangani** meminta **kata sandi akun** (tanda tangan elektronik).
- Setelah diajukan: isi baca-saja; status berjalan **SUBMITTED → ACCEPTED (MANAGER_ULP) → KONSTRUKSI_SIGNED (KONSTRUKSI_UP3) → CLOSED (ASMAN_KONSTRUKSI)**. Tiap peninjau melihat tombol hanya bila status sesuai dan ia memegang izinnya: **Terima & tanda tangani**, **Tanda tangani**, **Tutup & tanda tangani** (semuanya meminta kata sandi), serta **Kembalikan** (alasan wajib; pemegang kunci langkah berikutnya). Setelah dikembalikan: putaran +1, kembali DRAFT, nomor tetap; tampilkan alasan.
- **Penutupan menyelesaikan WO**; bila pelanggan belum berstatus PEREMAJAAN (EIS) atau ada tugas belum 100 % → 409, tampilkan apa adanya.
- Panel **Tanda tangan elektronik**: daftar per putaran (langkah, nama, peran, waktu, sidik jari 16 karakter). Tampilkan catatan bahwa ini bukan tanda tangan elektronik tersertifikasi.
- **Dokumen BASTP**: pratinjau/cetak/unduh XLSX dari `GET /bastp/{id}/document` (pola docs/70); nomor `00001/BASTP/07-11/kode-unit/2026` di kop.
## Portal vendor
Vendor melihat BASTP milik WO-nya dan dapat membuat, mengisi, mengunggah foto, dan mengajukan; tidak melihat nilai RAB. Foto dikirim sebagai multipart.
## Aturan UI dan tes
Tampilan menurut izin (`bastp.*`) dan relasi vendor, fail-closed; kata sandi tidak disimpan di klien; pesan 403/404/409/422 apa adanya (403 = kata sandi salah). Tes Vitest: tombol menurut status+izin, modal kata sandi, unggah foto, putaran setelah pengembalian, dokumen.
