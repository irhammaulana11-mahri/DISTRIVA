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

## Pengambilan dari Maximo (`cek`) — bagian UI belum diuji
Dari tangkapan jaringan 17 Nov 2026 alurnya sudah diketahui sampai laporan keluar:
1. **UI** (`POST /maximo/ui/maximo.jsp`, kejadian JSON `click`): klik nomor WO pada baris daftar → tekan tombol Run report (`RUNAREPORT_1281__QL-tbb`). Jawabannya membuka `openreport.jsp`.
2. **Laporan** (`report.py`, **sudah diuji** terhadap halaman asli dari tangkapan): `GET openreport.jsp` → form yang mengirim dirinya sendiri (memuat `__where__ibm__key` = WO terpilih) → penampil BIRT → SOAP `GetPage` → HTML laporan → `wo.parse`.
Nomor WO tidak dikirim di alamat laporan (`where=dummyWhere`); WO ditentukan oleh baris yang diklik pada sesi UI. Jadi satu sesi bekerja berurutan.

`client.py` (login, `uisessionid`/`csrftoken`, kejadian UI) disusun dari tangkapan tetapi **login dan halaman awal aplikasi tidak ikut tertangkap**, jadi belum teruji. Pakai:
```
pip install -r requirements.txt
cp .env.example .env        # isi MAXIMO_USERNAME dan MAXIMO_PASSWORD (berkas .env tidak di-commit)
python3 main.py cek --baris 0
```
`cek` menjalankan tiap langkah (login, buka aplikasi, klik baris, laporan) dan berhenti dengan pesan di langkah yang gagal. Belum ada: pindah halaman daftar, filter, dan penarikan massal (`ambil`) — id tombol halaman berikutnya belum tertangkap; dibuat setelah `cek` berhasil.
