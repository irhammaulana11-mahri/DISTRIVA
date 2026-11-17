# maximo_sync — WO inspeksi gardu Maximo → pembacaan gardu DISTRIVA

Mengubah respons laporan cetak **Work Order Tracking (T&D)** (`plusdwoprint_trk_U.rptdesign`, jawaban SOAP BIRT `GetUpdatedObjects` berisi HTML, seperti `tools/samples/detailpengukuran.json`) menjadi CSV bersih, lalu memuatnya sebagai pembacaan gardu. **Tidak ada akses jaringan atau login di alat ini**; berkas respons disimpan dulu (lihat "Yang belum ada" di bawah).

```
python3 main.py parse "../samples/wo/*.json" --out out          # satu baris per WO -> out/maximo-wo-pengukuran.csv
python3 tests/test_wo.py
php artisan substations:load-maximo-wo tools/maximo_sync/out/maximo-wo-pengukuran.csv [--dry-run] [--actor=email]
```

## Isi satu WO dan pemetaannya
| Di laporan | Di CSV / pembacaan |
|---|---|
| `100536365: INSPEKSI GARDU HD0744`, Location, Status, Work Type, Owner, HI Value / Numeric / Total, Actual Start / Finish | `wonum`, `description`, `gardu` (HD0744), `location`, `status`, `work_type`, `owner`, `hi_*`, `actual_*` |
| Pengukuran per jurusan (tugas "… LVCABLE JURUSAN A") `BEBAN-R/S/T/N` (puncak) | `iar ias iat ian` (jurusan A), `icr …` (jurusan C), nama kolom sama dengan OMT → arus per jurusan pembacaan |
| `BEBAN-*-NORMAL` | dibaca tetapi tidak dimuat (sama dengan puncak pada contoh; pembacaan memakai beban puncak) |
| `R-0 / S-0 / T-0` Tegangan Pangkal per jurusan | `vrn vsn vtn` = **terendah** dari semua jurusan per fasa (penanda tegangan pangkal rendah memakai minimum) |
| `RATINGNHFUSER/S/T` per jurusan | `nhf_iar …` (teks, mis. `L : 125`); belum dimuat |
| `PEMBEBANANTRAFO` (%) | `pembebanan_trafo_pct` → persen pembebanan pembacaan (kVA dihitung dari kapasitas gardu saat itu) |
| `KETIDAKSEIMBANGANPHASA`, `BESARARUSNETRALTR`, `PENTANAHAN` | `imbalance_pct`, `neutral_pct`, `grounding_ohm`; belum dimuat (DISTRIVA menghitung sendiri) |
| waktu | `measured_at` = pengukuran lapangan **paling awal** (jurusan), bukan jam perhitungan baris tingkat gardu |

Arus gardu = jumlah arus semua jurusan (aturan pembacaan DISTRIVA bila arus gardu tidak ada). Pembacaan masuk dengan sumber `IMPORT`, idempoten per gardu dan waktu; **gardu yang belum ada di master hanya dilaporkan** (tidak dibentuk, beda dengan muat OMT).

## Pengambilan dari Maximo (teruji 17 Nov 2026)
Alurnya (dari tangkapan jaringan, lalu diuji langsung ke server):
1. **UI** (`POST /maximo/ui/maximo.jsp`, kejadian JSON): login form → buka `plusdwotrk` → isi kolom filter daftar (`setvalue` + `filterrows`; kolom: 1 Work Order, 2 Description, 8 Status, 11 Reported Date, 15 Status Date) → klik nomor WO (`<tabel>_tdrow_[C:1]_ttxt-lb[R:n]`) → tombol Run report (`RUNAREPORT_1281__QL-tbb`). Halaman berikutnya: `<tabel>-ti7`.
2. **Laporan** (`report.py`): `GET openreport.jsp` → form kirim-sendiri (memuat `__where__ibm__key` = WO terpilih) → penampil BIRT → SOAP `GetPage` → HTML laporan → `wo.parse`. Nomor WO tidak ada di alamat laporan (`where=dummyWhere`); WO ditentukan oleh baris yang diklik pada sesi UI.

```
pip install -r requirements.txt
cp .env.example .env          # isi MAXIMO_USERNAME dan MAXIMO_PASSWORD (berkas .env tidak di-commit)
python3 main.py cek --baris 0                      # satu WO dari awal sampai terbaca
python3 main.py ambil --maks 20                    # uji kecil (daftar dibaca penuh dulu)
python3 main.py ambil --sejak 17/11/2025           # tahun penuh: terbaru per gardu, mentah ke raw/, lalu CSV ke out/
python3 main.py ambil --sejak 16/11/2026           # harian: hanya WO selesai sejak tanggal itu
python3 main.py ambil --pekerja 3                  # sesi login paralel (lihat catatan)
```
`ambil`: membaca seluruh daftar terfilter (Description "INSPEKSI GARDU", Status COMP, tanggal status ≥ `--sejak`; bawaan 365 hari), memilih **WO terbaru per gardu** (`--semua` = semuanya), melewati yang sudah ada di `raw/` (dapat dilanjutkan bila terputus), mengambil laporan tiap WO (mencoba ulang dengan login baru, maksimal 3 kali; yang tetap gagal ke `out/gagal.txt`), lalu `parse` ke `out/maximo-wo-pengukuran.csv` yang dimuat dengan `php artisan substations:load-maximo-wo`.

Ukuran nyata (17 Nov 2026): 7.873 WO selesai sejak 17/11/2025 pada 5.844 gardu → **5.844 WO** bila terbaru per gardu. Daftar dibaca per halaman 20 baris (± 394 halaman). Uji 3 WO: 27 detik termasuk login dan membaca daftar; per WO ± 4–9 detik (saring, klik, laporan) berurutan.
**Catatan sesi paralel:** satu sesi bekerja berurutan; `--pekerja N` membuka N login dengan akun yang sama. Belum diuji apakah Maximo ini mengizinkan beberapa sesi per akun atau mengakhiri sesi lama; coba `--pekerja 2` dengan `--maks 20` dulu.
