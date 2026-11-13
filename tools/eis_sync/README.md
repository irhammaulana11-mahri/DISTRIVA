# eis_sync — EIS → DISTRIVA

Mengambil data **LAYANAN › MONITORING PERMOHONAN (Detail)** dari EIS (Daftung) lalu mengunggahnya ke impor permohonan DISTRIVA.

> **Dari DISTRIVA:** tombol "Sinkronisasi EIS" pada halaman Permohonan (docs/82 §19.15) menjalankan alat ini untuk Anda dengan user/password EIS dan rentang daya dari pengaturan, termasuk jadwal otomatis; DISTRIVA memberi `DISTRIVA_TOKEN` berumur pendek sehingga `DISTRIVA_EMAIL`/`DISTRIVA_PASSWORD` tidak diperlukan. Cakupan: pelanggan baru semua daya berstatus Bayar, Cetak PK, PDL Awal, Peremajaan; permohonan yang sudah ada hanya diperbarui Hari Kerja dan Status.

## Siapkan
```
pip install -r requirements.txt && playwright install chromium
cp .env.example .env     # isi EIS_USERNAME, EIS_PASSWORD, DISTRIVA_URL, DISTRIVA_EMAIL, DISTRIVA_PASSWORD
```
**Kredensial hanya di `.env`** (berkas ini dan `eis_session.json` tidak boleh dibagikan). Sebelumnya kata sandi EIS tertulis langsung di `app/config.py` dan `app/session.py`; sudah dihapus dari kode, tetapi **ganti kata sandi EIS** karena pernah tertulis di kode dan tampil dalam percakapan.

## Pakai
| Perintah | Fungsi |
|---|---|
| `python main.py inspect` | login, buka menu, simpan HTML + tangkapan layar form ke `debug/` (untuk memperbaiki penunjuk elemen; tidak memuat data) |
| `python main.py cek [--dari D --sampai D]` | muat rentang itu dan **periksa tabelnya**: jumlah baris dan halaman, apakah halaman benar-benar dimuat ulang, kolom yang tampil, kolom wajib DISTRIVA, isian yang ditandai tidak valid; menyimpan `debug/cek_tabel.png`; tanpa unduhan dan tanpa unggahan |
| `python main.py export [--dari D --sampai D]` | unduh "Export Excel" rentang itu ke `downloads/` (bawaan: hari ini − `EIS_LOOKBACK_DAYS` s.d. hari ini, Jenis Mohon `PB/PD/PS`; `--jenis PB` atau `PD` untuk satu jenis) |
| `python main.py sync [...]` | export + unggah ke DISTRIVA sebagai **batch sementara** (belum mengubah permohonan) |
| `python main.py sync --konfirmasi` | ... lalu langsung diterapkan |
| `python main.py sync --sumber grid` | baca **tabel hasil di layar** halaman demi halaman (tanpa Export Excel) menjadi CSV yang diimpor DISTRIVA; judul kolom tabel dipetakan ke nama kolom ekspor; **belum teruji terhadap EIS** |
| `python main.py cek --metode http` · `export --metode http` · `sync --metode http` | ambil lewat **HTTP biasa seperti alur piutang** (tanpa peramban untuk data; peramban hanya untuk login bila cookie tersimpan sudah habis): `GET mohondetil.aspx`, lalu postback `btnCarirange` (Load Data) dan `btnExport` (Export Excel). Setiap langkah diverifikasi: server harus menjawab dengan tanggal yang diminta, tabel harus punya ringkasan "Page 1 of N", dan jawaban ekspor harus berupa berkas (halaman galat HTML disimpan ke `debug/`, tidak dianggap data). Bila alamat form berbeda, isi `EIS_MOHON_URL` di `.env` (alamat iframe tertulis oleh `python main.py cek` metode browser). |
| `python main.py sync --berkas FILE` | lewati EIS, unggah berkas hasil unduhan sebelumnya |
| `python main.py schedule --jam 18:13` | jalankan `sync` tiap hari |
| `python piutang.py` | alur lama (piutang → MongoDB), tidak berubah |

Format tanggal: `dd/mm/yyyy` atau `yyyy-mm-dd`. Berkas "Export Excel" EIS sama dengan format yang dibaca DISTRIVA (44 kolom: `NOAGENDA`, `TGLMOHON`, `IDPEL`, `NAMA`, … `UNITTUJUAN`, `PAKETSLO`, `PLTS_ATAP`); DISTRIVA hanya memakai PASANG BARU dan PERUBAHAN DAYA, jenis lain ditolak pada pratinjau.

## Rentang panjang
EIS menolak mengekspor hasil yang sangat besar (rentang 1 Mei - 9 Nov 2026 = 44.901 baris menjawab dengan halaman tabel, bukan berkas), dan DISTRIVA hanya menerima berkas sampai 5 MB / 20.000 baris (~1,3 KB per baris, jadi ~3.800 baris). Karena itu metode **http** memecah rentang otomatis: potongan awal 14 hari, lalu dibagi dua berulang sampai tiap potongan <= `EIS_MAX_ROWS_PER_FILE` (3.000) baris dan <= `EIS_MAX_FILE_BYTES`; potongan kosong dilewati; tidak ada hari yang terlewat atau terhitung dua kali. Hasilnya satu berkas dan satu batch sementara per potongan; pakai `--konfirmasi` untuk menerapkan semuanya (tiap batch yang diterapkan mengirim pemberitahuan "permohonan baru masuk" ke ULP terkait).

## Permohonan lama yang belum selesai
Status sebuah permohonan hanya diperbarui bila baris EIS-nya ikut terunduh, dan unduhan dipilih menurut **tanggal mohon**. Karena itu permohonan yang lebih tua dari rentang dan sudah Peremajaan di EIS bisa tertinggal "belum selesai" di DISTRIVA. Pengamannya: (1) rentang bawaan 180 hari (`EIS_LOOKBACK_DAYS`); (2) setelah tiap `sync`, DISTRIVA (`GET /api/applications/imports/stale`) melaporkan permohonan yang **masih berjalan** tetapi diajukan sebelum awal rentang; (3) dengan `--konfirmasi`, alat menarik otomatis rentang tepat dari tanggal terlama itu sampai sehari sebelum rentang (paling jauh `EIS_MAX_BACKFILL_DAYS`=730 hari), lalu memeriksa ulang dan melaporkan sisanya (yang memang belum selesai di EIS). `--tanpa-lengkapi` mematikan penarikan otomatis.

## Batas unggah yang sebenarnya
Batas DISTRIVA 5 MB / 20.000 baris, tetapi PHP yang menjalankannya membatasi lagi: `upload_max_filesize` bawaan hanya **2 MB** (berkas 2,8 MB menjawab 422 "The file failed to upload"). Karena itu `sync --metode http` login dulu, membaca batas efektif server dari `GET /api/applications/imports/limits` (yang terkecil dari batas DISTRIVA, `upload_max_filesize`, dan `post_max_size`), lalu memotong berkas <= 90 % batas itu (dan <= ~1.400 byte per baris x jumlah baris). Server web di depan (mis. nginx `client_max_body_size`, bawaan 1 MB) tidak terlihat dari DISTRIVA: bila menjawab 413, naikkan batasnya. **Lebih cepat bila batas PHP dinaikkan** (berkas lebih besar, lebih sedikit unggahan): ubah `upload_max_filesize = 8M` dan `post_max_size = 10M` di `/etc/php/8.5/cli/php.ini` (atau jalankan `PHP_INI_SCAN_DIR=:$HOME/php-conf.d php artisan serve --port=8001` dengan berkas `99-upload.ini` berisi dua baris itu) lalu mulai ulang `php artisan serve`. Alat membaca ulang batasnya tiap kali jalan. Token DISTRIVA kedaluwarsa bila diam 30 menit, jadi alat login ulang sebelum mengunggah (pengunduhan rentang panjang bisa lebih lama).

## Alamat DISTRIVA
`DISTRIVA_URL` harus menunjuk ke backend Laravel. `php artisan serve` pindah ke port 8001, 8002, ... bila 8000 dipakai program lain; di mesin pengembangan ini 8000 dipakai aplikasi pencetak HP, sehingga login DISTRIVA dijawab "400 - Bad Request". Alat kini menamai server yang menjawab bila bukan DISTRIVA.

## Range Daya
Akhir Range Daya wajib terisi di halaman EIS (jika kosong, form menolak diposting dan tabel tetap kosong tanpa pesan). Alat mengisinya dengan rentang lebar yang berarti "semua": `EIS_DAYA_MIN=0` dan `EIS_DAYA_MAX=99999999` (VA) di `.env`.

## Pengecekan tabel
Setelah Load Data alat memeriksa tabel dan **tidak lagi menyimpulkan "tidak ada data" bila halaman tidak dimuat ulang** (itu berarti pemuatan tidak berjalan; form dan tangkapan layar disimpan di `debug/load_gagal.*`). Ringkasan jumlah baris juga dibandingkan dengan jumlah baris yang diterima DISTRIVA pada `sync` (peringatan bila berbeda).

## Basis data
Alur permohonan **tidak membuka koneksi basis data**: data masuk ke PostgreSQL DISTRIVA (`distriva_db`) lewat API impor, sehingga aturan impor, pemetaan status, dan catatan perubahan DISTRIVA tetap berlaku (menulis langsung ke PostgreSQL akan melewati semuanya). `MONGO_URI` hanya untuk alur piutang lama (`python piutang.py`).

## Metadata saja
Impor DISTRIVA hanya mewajibkan empat kolom (`NOAGENDA`, `NAMA`, `JENIS_TRANSAKSI`, `UNITTUJUAN`); kolom lain opsional, kolom yang tidak ada diabaikan, dan nilai kosong tidak pernah menghapus data. Jadi berkas berisi metadata saja (mis. ditambah `STATUS_PERMOHONAN`, `TGL_UPDATE_PERMOHONAN`, `TOTALBIAYA`) tetap dapat diimpor.

## Akun DISTRIVA
Pakai akun **NIAGA_RETAIL yang ditugaskan di UP3** (keputusan pemilik 9 Nov 2026): izin `applications.import` untuk akun UP3 berlaku bagi **semua ULP aktif di bawah UP3-nya**, sehingga satu akun cukup untuk seluruh UP3 Mojokerto dan tidak memerlukan MFA (berbeda dengan SYS_ADMIN). Akun itu tetap **tidak** dapat membuat atau mengubah permohonan secara manual di ULP (itu tetap per-ULP). Isi `DISTRIVA_EMAIL` dan `DISTRIVA_PASSWORD` di `.env` dengan akun tersebut; akun harus sudah diaktifkan (kata sandi sudah diganti).

## Penunjuk elemen
Halaman EIS (`mohondetil.aspx`, form Coolite/ExtJS dengan grid DevExpress di dalam iframe) dibaca dari HTML yang disimpan `inspect`, dan kontrolnya diakses lewat **id**: `tgl1` / `tgl2` (Range Mohon, format d/m/Y), `cboJenis` (tampilan `PB/PD/PS` bernilai `SEMUA`, atau `PB`, `PD`, `PS`), `cboAsal` (SEMUA), `btnCarirange` (Load Data, memuat ulang halaman), `btnExport` (Export Excel), dan grid `GV` (10 baris per halaman; `window.GV.GotoPage`). Bila halaman berubah, jalankan `inspect` lagi atau timpa tombolnya dengan `EIS_SEL_LOAD` / `EIS_SEL_EXPORT` (selektor CSS) di `.env`. Menu: LAYANAN › MONITORING PERMOHONAN (Detil).

## Tes tanpa jaringan
`python -m unittest discover -s tests`
