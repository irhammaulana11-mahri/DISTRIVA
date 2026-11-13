# Serah terima frontend — dokumen keluaran RAB/KKF (docs/62 §28)
Backend selesai (tanpa migrasi). Kontrak: docs/57 "Dokumen keluaran".

## Halaman/komponen
- Pada riwayat run RAB: tombol **REKAP**, **REKAP RINCI** (lihat/cetak/unduh XLSX). Pada riwayat run KKF: **KKF**, **HPE**.
- Pratinjau dokumen dari JSON (`format=json`) dengan tata letak formulir PLN: kop (`header`), judul, data (`meta`), tabel (`sections[].columns/rows/footer`), pasangan label–nilai (`pairs`), terbilang, kota+tanggal (`place_date`), tanda tangan (`signatures`). Tabel RAB lebar: gulir horizontal di layar, lanskap A4 saat cetak.
- Tombol **Cetak** memakai `window.print()` dengan CSS cetak; tombol **Unduh XLSX** memanggil `?format=xlsx` (blob, dengan token).
- `conclusion` TIDAK LAYAK atau `extended_required` → tampilkan peringatan merah. `document_number` (KKF) tampil di kop dokumen, format `nomor urut/tahunbulan/kodeunit`; bila null tulis "Nomor belum ditetapkan".
- Pesan galat 403/404/422 ditampilkan apa adanya.

## Tes Vitest
Render semua `type`; format rupiah/persen; cetak menyembunyikan tombol; unduh XLSX mengirim token.
