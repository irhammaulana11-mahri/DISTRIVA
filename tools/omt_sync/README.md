# omt_sync — periksa dan perbaiki unduhan pengukuran gardu (OMT)

Membaca `omt-pengukuran *.csv` (unduhan Maximo), memperbaiki pergeseran kolom, format tanggal, baris kosong, dan duplikat, lalu menulis satu CSV bersih untuk satu UP3 beserta laporan cakupan per ULP per bulan. **Berkas asli tidak diubah.**

```
python3 main.py check "../samples/omt-pengukuran 20*.csv"               # hanya laporan (UP3 MOJOKERTO)
python3 main.py fix   "../samples/omt-pengukuran 20*.csv" --out out     # + out/omt-pengukuran-bersih-mojokerto.csv dan out/laporan.txt
python3 main.py fix   ... --unit ""                                      # semua unit (besar)
python3 -I tests/test_omt.py
```
Detail temuan dan aturan: `docs/83-DATA-PENGUKURAN-GARDU-OMT.md`. Pemuatan ke DISTRIVA: `php artisan substations:load-omt` (backend), lihat bagian 5 pada dokumen itu.
