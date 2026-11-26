# 85 — Runbook: menyiapkan DISTRIVA dari nol dan mengubah rumus, harga, atau tarif

Dibuat 15 November 2026. Dipakai bersama `tools/runbook.py` (skrip bantu) dan `docs/84-PANDUAN-DEPLOY-PRODUKSI.md` (produksi).

## 0. Prinsip
- **Python hanya menyiapkan data.** Perhitungan BOM, RAB, dan KKF dijalankan mesin rumus PHP di backend. Python membaca Excel master (hanya nilai tersimpan; rumus Excel tidak dieksekusi) dan menghasilkan CSV/JSON untuk **ditinjau manusia**.
- **Database hanya diisi lewat layanan resmi** (layar, API, atau perintah artisan) dengan pemisahan tugas: pembuat dan penyetuju harus akun berbeda (SYS_ADMIN dikecualikan). Tidak ada skrip yang menulis langsung ke tabel master.
- **`tools/runbook.py` tidak pernah menulis ke database** dan tidak menjalankan skrip penghapus. Ia hanya menulis ke `tools/output/regen/<waktu>/`, ke fixture tes golden, dan ke venv forecast bila diminta.
- Rahasia (token MIMS, sandi, `.env`) tidak disimpan di repo, dokumen, tes, atau log. Berkas `.mdb`/Excel sumber tidak di-commit.

## 1. Skrip bantu `tools/runbook.py` (hanya pustaka standar)
| Perintah | Fungsi | Menulis ke |
|---|---|---|
| `check` | periksa Python, php, composer, node, mdbtools, Chrome, venv forecast, Excel master, berkas peta kode, `.env`, artisan | tidak ada |
| `extract [--ulp 51453]` | ekstrak Excel (KHS, buku harga, konstruksi, BOM, tarif), terjemahkan kode lama ke baru, **bandingkan** dengan data yang berlaku, tulis `laporan.txt` | `tools/output/regen/<waktu>/` |
| `golden` | bangun ulang fixture golden BOM lalu jalankan tes rumus PHP | `backend/tests/fixtures/golden_bom.json.gz` |
| `forecast-venv [--install]` | periksa atau buat venv forecast (torch CPU, numpy, lightgbm) | `tools/forecast/.venv` |
| `preflight` | `php artisan distriva:preflight` (kesiapan produksi) | tidak ada |
| `tests [--full]` | tes Python forecast + tes PHP rumus; `--full` seluruh tes backend (±20 menit) | tidak ada |

Contoh: `python3 tools/runbook.py check`, lalu `python3 tools/runbook.py extract --ulp 51453`.

## 2. Hasil pemeriksaan `tools/rebuild/` — jangan dijalankan ulang
`rebuild/` adalah **bangun ulang sekali pakai** pada 9 November 2026 (keputusan pemilik, docs/62 §52) yang mengganti seluruh kode KHS ke kode baru (JTMR…, A…). Temuan:
1. **Destruktif.** `rebuild_clean.php` fase `wipe` menjalankan TRUNCATE pada semua tabel kecuali daftar yang dipertahankan (pengguna, unit, gudang, peran, izin, token, cadangan). Ada pengaman `REBUILD_DB`, tetapi tetap tidak boleh dijalankan pada database yang sedang dipakai.
2. **Bergantung pada potret masa lalu.** Fase `load` membaca `tools/output/rebuild/export.json` (potret database saat itu) dan keputusan pemilik di `peta_kode_lama_baru.csv`. `build_code_plan.py` butuh `openpyxl` dan `kkfsetuju_PABRIKBITINGMARJONO.xlsx`; jalur berkas ditulis tetap `/media/data/PROJECT/DISTRIVA`.
3. **CSV hasilnya sudah usang terhadap database.** `rebuild/*_new.csv` tidak memuat perbaikan sesudahnya: harga tiang beton (JTMR934 dst., docs/83 §8) tidak ada di `price_book_new.csv`, nilai MDU 3040331 dan A585 kosong di sana (docs/83 §10 menetapkannya di database). Mengimpor ulang dari CSV itu akan **mengembalikan data ke keadaan lama**.
4. **Kode lama vs baru.** Excel dan `tools/output/khs.csv` memakai **kode lama** (mis. `68`), database memakai **kode baru** (mis. `JTMR766`). Jangan impor keluaran `extract_*` langsung; terjemahkan dengan `tools/output/rebuild/peta_kode_lama_baru.csv` (`runbook.py extract` melakukannya untuk perbandingan).
5. **Yang masih berguna:** `rebuild/import_boms.php` (impor BOM `tools/output/bom_*.json` dengan terjemahan kode; **dry-run secara bawaan**, menolak bila `REBUILD_DB` tidak sama dengan database terhubung, butuh KHS dan jenis konstruksi berstatus APPROVED, hasil berstatus DRAFT). `build_sr1ph_bom.py` membangun BOM SR 1 fasa dari lembar `APP 1 PHASA` (stdlib).

**Kesimpulan:** untuk server baru, **pulihkan cadangan** (§4, jalur A). Jalur membangun dari Excel hanya untuk perubahan (§5).

## 3. Excel induk: hanya `tools/samples/MASTER RAB & KKF.xlsx`
Keputusan pemilik 15 November 2026: **satu-satunya** salinan `MASTER RAB & KKF.xlsx` yang dipakai ada di `tools/samples/`. Salinan lama di akar proyek (8 Nov, belum direvisi) tidak dipakai dan sebaiknya dihapus agar tidak tertukar; `runbook.py check` memperingatkan selama berkas itu masih ada.
- Revisi 9 November mengganti nama lembar PBPD: `6,6-41,5 KVA` menjadi `APP LANGSUNG` dan `53-197 KVA` menjadi `APP TAK LANGSUNG`, dan menambah `APP 1 PHASA` (SR 1 fasa).
- `golden_vectors.py` disesuaikan dengan nama baru itu. Fixture `backend/tests/fixtures/golden_bom.json.gz` sudah dibangun ulang dari salinan ini dan tes golden lulus.
- `MASTER TARIF & JAM NYALA.xlsx` hanya punya satu salinan (akar proyek); skrip mencarinya di `tools/samples` lebih dulu, lalu di akar proyek.

## 4. Dari nol (server baru)
**Prasyarat sistem:** PHP 8.5 + ekstensi Laravel, Composer, PostgreSQL, Node 22, Python 3.10+, `mdbtools` (`sudo apt install mdbtools`, untuk DIL .mdb), Chromium atau Chrome (PDF).

1. **Kode dan dependensi.** `git clone`; `cd backend && composer install`; `cd ../frontend && npm ci && npm run build`.
2. **Konfigurasi.** `cp backend/.env.example backend/.env`, isi database, `php artisan key:generate`. Atur `DISTRIVA_BACKUP_ROOT` di luar proyek, `APP_ENV=production`, `APP_DEBUG=false` (docs/84).
3. **Skema.** Aktifkan ekstensi PostgreSQL sekali per database (`CREATE EXTENSION IF NOT EXISTS btree_gist;` oleh pemilik database atau superuser; migrasi T4.2.1 berhenti dengan pesan jelas bila belum ada), lalu `php artisan migrate --force`. Uji pasang dari nol pada database kosong (22 Nov 2026): 104 migrasi selesai.
4. **Peran dan izin.** Jalankan seeder izin satu per satu: `php artisan db:seed --class=FoundationPermissionSeeder`, lalu `MasterDataPermissionSeeder`, `ApplicationPermissionSeeder`, `KkoPermissionSeeder`, `SurveyPermissionSeeder`, `MtoPermissionSeeder`, `RabPermissionSeeder`, `KkfPermissionSeeder`, `DrawingPermissionSeeder`, `SubstationPermissionSeeder`, `PlanningPermissionSeeder`, `BackupPermissionSeeder`, `SystemSettingsPermissionSeeder` (izin pengaturan WhatsApp, hanya SYS_ADMIN), `OutagePermissionSeeder` (izin data gangguan: `outages.view`, `outages.sync`), `EisReportPermissionSeeder` (izin laporan EIS: `eis_reports.view`, `eis_reports.import`), `NkoPermissionSeeder` (izin NKO/KPI: `nko.view`, `nko.calculate`, `nko.input`, `nko.rules.propose`, `nko.rules.approve`). Hasil uji dari nol: 122 izin, 14 peran, 439 hak, sama persis dengan database berjalan. Tiap seeder memanggil `RoleSeeder` lebih dulu. Pada sistem yang sudah berjalan, jalankan seeder hanya bila ada kunci izin baru dan atas persetujuan pemilik.
5. **Akun pertama.** `php artisan distriva:bootstrap-admin --role=UP3_ADMIN --email=... --name=... --unit-code=...` (atau `--role=SYS_ADMIN`; SYS_ADMIN butuh MFA).
6. **Python.** `python3 tools/runbook.py forecast-venv --install`, lalu `python3 tools/runbook.py check`.
7. **Master data — jalur A (disarankan): pulihkan cadangan** dari sistem yang berjalan (KHS, jenis konstruksi, BOM, buku harga, buku tarif, parameter KKF, SLA, beserta perbaikan terakhir). Lihat `docs/64-BACKUP-RESTORE.md`: `php artisan distriva:restore <nomor cadangan> --documents --reason="..." --as=<email SYS_ADMIN>`.
8. **Master data — jalur B (bila tanpa cadangan):** impor berurutan lewat layar atau API, tiap item DRAFT lalu disetujui akun lain: KHS → jenis konstruksi dan pemetaan → BOM → buku harga → buku tarif → parameter KKF → pengaturan SLA. Gunakan keluaran `extract` yang sudah diterjemahkan ke kode baru, **dan terapkan ulang perbaikan di docs/83 §8–10** (tiang beton, nilai MDU), karena itu tidak ada di CSV.
9. **Data operasional**, berurutan:
   1. Unit organisasi dan pengguna.
   2. Gardu dan penyulang: impor gardu Maximo, `php artisan feeders:load-gi tools/samples/penyulang-gi.csv`.
   3. Pengukuran gardu: `python3 tools/omt_sync/main.py fix "tools/samples/omt-pengukuran 20*.csv" --out tools/omt_sync/out`, lalu `php artisan substations:load-omt <csv bersih> --dry-run` dan tanpa `--dry-run`.
   4. Nomor GADIS: `python3 tools/dil_sync/gadis_pairs.py tools/samples/DIL_SALDO_MASK_UP_*.mdb --out tools/dil_sync/out/pasangan-gadis.csv`, lalu `php artisan substations:load-gadis <csv> --dry-run` dan tanpa `--dry-run`.
   5. Pelanggan: tombol **Sinkron DIL** (Master Pelanggan). Letakkan berkas di `backend/storage/app/dil-inbox` (docs/84, bagian Sinkron DIL).
   6. Permohonan: Sinkronisasi EIS (atur `lookback_days` panjang, sekitar 1.500 hari, untuk riwayat forecast).
   7. Stok dan dokumen MIMS: **Tarik Stok MIMS** (token ditempel pengguna, tidak disimpan di repo). Untuk forecast butuh riwayat 24 bulan ke atas.
10. **Forecast.** Jalankan forecast Beban Gardu, lalu Pelanggan & Material (layar Forecast), dan aktifkan jadwal bulanan bila perlu.
11. **Produksi.** Pasang cron `* * * * * php artisan schedule:run`, jalankan `python3 tools/runbook.py preflight`, dan ikuti docs/84.

## 5. Bila rumus, harga, atau tarif berubah
| Yang berubah | Langkah |
|---|---|
| **Rumus volume BOM di Excel** | 1) Taruh Excel baru di `tools/samples/` (§3). 2) `runbook.py extract`; baca `laporan.txt` (bagian BOM menunjukkan baris yang rumusnya berubah). 3) Tinjau `tools/output/regen/<waktu>/bom_*.json`, lalu salin yang disetujui ke `tools/output/`. 4) `REBUILD_DB=<nama database> BOM_DRY=1 php artisan tinker --execute="require 'tools/rebuild/import_boms.php';"`, periksa, lalu ulangi dengan `BOM_DRY=0`. 5) BOM berstatus DRAFT: setujui dengan akun lain. 6) `runbook.py golden` bila rumus pada lembar yang diuji golden berubah, lalu `runbook.py tests`. 7) Hitung ulang MTO/RAB/KKF yang sudah tersimpan; run lama tetap beku dengan angka lamanya. |
| **Mesin rumus PHP** (kode, bukan Excel) | Ubah kode backend, `runbook.py tests` (golden + BOM), lalu hitung ulang RAB/KKF yang terdampak. |
| **KHS** (kode, nama, satuan) | `extract` → periksa bagian KHS pada laporan (kode tanpa kode baru perlu keputusan pemilik) → impor lewat `tools/khs_admin.py` atau layar sebagai pengguna sendiri; penyetuju akun lain. |
| **Harga jasa/material** | `extract` → buku harga **baru** lewat alur resmi (buku yang disetujui tidak diubah; buku lama ditutup sehari sebelum buku baru berlaku, seperti docs/83 §8). |
| **Tarif dan jam nyala** | `extract --ulp <kode ULP>` (jam nyala dari satu ULP) → impor buku tarif baru. Perhatikan satuan jam nyala (docs/83 §9: pernah 1000 kali lipat). |
| **Parameter KKF** (discount rate, BPP, faktor beban 0,8) | Ubah lewat layar Parameter KKF (versi baru, disetujui); bukan dari Excel. |
| **Ambang forecast** (80 %, tingkat kVA) | `backend/config/distriva.php`, bagian `derived_demand`. |

### 5a. Master UJL dan jam nyala (buku tarif)
- **Tempatnya:** UJL dan jam nyala adalah kolom pada **buku tarif** (`tariff_books` / `tariff_book_rows`: tarif, daya VA, harga rata-rata Rp/kWh, `jam_nyala`, `ujl` per VA, dan ULP). KKF memilih satu baris menurut ULP permohonan, tarif, dan daya; tarif prabayar berakhiran T (B2T, R3T) memakai baris tarif dasarnya.
- **Sumbernya:** `MASTER TARIF & JAM NYALA.xlsx`, lembar `MASTER TARIF & JN` (harga rata-rata, jam nyala, UJL), `UJL`, dan `309` (laporan penjualan **satu ULP**, contoh berisi ULP Jombang). Jam nyala berasal dari laporan itu, jadi **per ULP**.
- **Keadaan sekarang (15 Nov 2026):** satu buku tarif berlaku, "Buku tarif & jam nyala ULP Jombang 2026" (berlaku 10 Nov), **204 baris, semuanya ULP Jombang**; jam nyala 41–240 jam, UJL terisi di 203 baris. Satuan jam nyala sudah dikoreksi (docs/83 §9).
- **Konsekuensi:** KKF untuk permohonan di **ULP selain Jombang gagal** dengan pesan "Buku tarif … tidak memuat tarif … untuk ULP ini", karena tidak ada baris untuk ULP itu dan belum ada baris berlaku umum (kolom ULP kosong).
- **Keputusan pemilik (15 Nov 2026):** untuk sementara **hanya ULP Jombang** yang dipakai; KKF untuk ULP lain belum didukung dan pesan galatnya sekarang menyebut bahwa data ULP itu belum diunggah. **Cara menambah atau memperbarui satu ULP** sudah disiapkan lewat Master Data → Impor dari Excel: pilih ULP asal laporan penjualan pada kartu "Excel Tarif & Jam Nyala", unggah, tinjau, terapkan sebagai DRAFT, setujui. Baris ULP lain dalam buku tarif tidak berubah; kartu menampilkan ULP mana yang sudah punya jam nyala dan UJL dan ULP mana yang belum, dan pemeriksaan memperingatkan bila ULP tidak dipilih padahal buku berlaku sudah memuat baris khusus per ULP. Ulangi untuk tiap ULP dengan laporan penjualannya sendiri (format lembar `309`).
- **Cara memperbarui:** buku tarif **baru** lewat alur resmi (buku yang disetujui tidak diubah; buku lama ditutup sehari sebelum buku baru berlaku), pembuat dan penyetuju akun berbeda. Sesudahnya KKF yang sudah tersimpan tetap memakai angka lamanya; hitung ulang bila perlu.
- **Periksa sebelum impor:** jam nyala wajar (puluhan sampai ratusan jam per bulan; nilai ribuan menandakan satuan salah), harga rata-rata tidak nol, dan UJL terisi untuk tarif pascabayar (tanpa UJL biaya penyambungan pascabayar tidak bisa dihitung).

Setelah perubahan apa pun: `python3 tools/runbook.py tests`, lalu hitung ulang satu contoh permohonan dan bandingkan dengan Excel.

## 5b. Lewat layar: Master Data → Impor dari Excel (15 November 2026)
Bagian data dari `runbook.py` (ekstrak, bandingkan, muat) tersedia di aplikasi, jadi tidak perlu CLI untuk perubahan rutin.
1. **Unggah** `MASTER RAB & KKF.xlsx` (BOM dan buku harga) atau `MASTER TARIF & JAM NYALA.xlsx` (tarif, jam nyala, UJL; pilih ULP asal jam nyala, atau "semua ULP"). Hanya `.xlsx`, maksimal 60 MB (`DISTRIVA_MASTER_EXCEL_MAX_MB`), tanpa makro; berkas yang bukan zip Excel, berisi makro, atau mengembang tak wajar ditolak sebelum dibaca.
2. **Periksa** (otomatis, di latar belakang): ekstraktor yang sama dengan `tools/` membaca Excel di folder kerja pribadi `storage/app/master-excel/<id>/` dengan lingkungan minimal (tanpa kredensial aplikasi) dan batas waktu 300 detik. Hasilnya dibandingkan dengan data **yang disetujui**: BOM baris demi baris (per kelompok), buku harga per kode, buku tarif per ULP/tarif/daya. Kode KHS lama diterjemahkan lewat `peta_kode_lama_baru.csv`; kode tanpa terjemahan dilaporkan sebagai KHS baru dan tidak ikut diterapkan.
3. **Tinjau**: kartu per dataset menampilkan status (sama / ada perubahan / perlu dibereskan), jumlah, dan contoh sebelum → sesudah. Jam nyala yang tampak bukan jam per bulan (ribuan) menahan buku tarif.
4. **Terapkan sebagai DRAFT** per dataset, setelah konfirmasi. Yang dibuat hanya **perubahan**: BOM = versi DRAFT baru untuk kelompok terpilih; harga = buku harga DRAFT dari buku berlaku dengan harga yang berbeda ditimpa (status PLN/HARGA, nilai MDU, dan zona UP3 dipertahankan, sehingga perbaikan manual seperti docs/83 §8 tidak hilang); tarif = buku tarif DRAFT dari buku berlaku, baris ULP lain dipertahankan dan baris dari Excel menggantikan/menambah. Tiap dataset diterapkan sekali per berkas.
5. **Persetujuan tetap oleh akun lain** di halaman BOM / Buku Harga / Buku Tarif (pemisahan tugas tidak berubah; penyetuju diberi notifikasi). Tidak ada yang otomatis disetujui dan tidak ada data berstatus APPROVED yang diubah.

**Izin:** menyiapkan dan menerapkan memerlukan izin kelola dataset itu (`bom.manage`, `prices.manage`, `tariffs.manage`: ENGINEERING, PERENCANAAN, SYS_ADMIN). Penyetuju (UP3_MANAGER) tidak bisa menyiapkan.
**Belum dicakup (tahap berikut):** KHS baru, jenis konstruksi dan pemetaannya, dan BOM SR 1 fasa; semuanya butuh keputusan kode dan nama pilihan pemilik. Perintah operasional `runbook.py` (`check`, `golden`, `tests`, `forecast-venv`, `preflight`) **sengaja tidak** dibuka dari web (menjalankan tes atau memasang paket dari browser bukan fungsi aplikasi); tetap lewat terminal.
**Server:** perlu `python3` dan folder `tools/` beserta `tools/output/rebuild/peta_kode_lama_baru.csv` (lokasi dapat diubah dengan `DISTRIVA_MASTER_EXCEL_TOOLS` dan `DISTRIVA_MASTER_EXCEL_CODE_MAP`). Berkas Excel yang diunggah disimpan sampai dihapus dari layar.

## 5c. Template MASTER DISTRIVA untuk unit induk (18 November 2026)
Satu workbook yang dibuat DISTRIVA dari data yang **berlaku**, diisi unit induk, lalu diunggah kembali di layar yang sama (Impor dari Excel → kartu "MASTER DISTRIVA"). Tombol **Unduh template** memerlukan izin kelola BOM, harga, tarif, atau parameter KKF.
- **Lembar:** `PETUNJUK` (cara mengisi), `INFO` (versi template, berlaku sejak, dasar perubahan), `KHS` dan `STANDAR_KONSTRUKSI` (rujukan), `HARGA` (harga material dan jasa per zona), `TARIF` (harga rata-rata, jam nyala, UJL per ULP), `PARAMETER_KKF` (sembilan nilai), `ATURAN` (PPN, tarif asuransi, versi mesin KKF: hanya rujukan), `UJI_KKF` dan `UJI_RAB` (contoh hitung beserta hasil Excel), `GAMBAR` (masukan gambar pada sel yang sama dengan yang dirujuk rumus, jadi Excel menghitung sendiri), satu lembar per kelompok BOM (baris Excel = nomor urut BOM; B kode atau rumus, H-K rumus), dan `_PETA` (tersembunyi).
- **Rumus BOM** ditulis seperti di Excel, persis seperti yang tersimpan (rujukan sel pekerjaan asli), dengan fungsi yang dikenali mesin (`IF`, `OR`, `AND`, `SUM`, `SUMIF`, `TRUNC`, `ROUND`, `ROUNDUP`, `ABS`). Peta sel gambar tiap versi BOM disimpan di tabel `bom_input_maps`; untuk versi lama diisi dengan `php artisan bom:backfill-input-maps` dari `tools/output/bom_*.json`.
- **Pemeriksaan saat unggah:** susunan berkas (versi template, nomor baris tidak bergeser, isi sel angka/rumus, judul kolom, kode ULP) dilaporkan per sel. BOM dibandingkan dengan versi berlaku (tanpa perubahan bila tidak ada yang diubah), lalu **hasil hitung yang disimpan Excel dicocokkan dengan mesin hitung** untuk angka gambar yang sama; kelompok yang berubah hanya bisa diterapkan bila cocok.
- **Diterapkan terpisah sebagai DRAFT** per dataset (BOM, harga, tarif, parameter KKF), tanggal berlaku dan dasar perubahan dibawa dari lembar INFO, disetujui akun lain. Harga: status PLN/HARGA, nilai asuransi, dan zona dipertahankan; baris yang tidak ada di berkas tetap seperti yang berlaku.
- **Yang hanya dilaporkan, tidak diimpor:** aturan yang ada di program (PPN, asuransi, rumus KKF, pembulatan RAB). `UJI_KKF` (NPV tahun 0 tidak didiskon; `NPV()` Excel dikalikan 1 + diskonto) dan `UJI_RAB` membandingkan hasil Excel unit induk dengan mesin; beda berarti program perlu disesuaikan pengembang.
- **Batasan:** KHS dan standar konstruksi baru tetap didaftarkan lewat halamannya; baris harga/tarif tidak bisa dihapus atau ditambah lewat template; default parameter BOM (kolom keterangan `_PETA`) tidak bisa diubah dari berkas.

## 5d. Revisi Excel 18 November 2026 dan alur penyesuaian lewat web
**Perubahan di Excel (dibandingkan dengan ekstraksi 15 Nov).** Tujuh kelompok BOM tidak berubah. Tiga lembar APP berubah susunan:
- **APP LANGSUNG (`PBPD_6_41`) dan APP TAK LANGSUNG (`PBPD_53_197`)** kini memilih barang menurut **daya permohonan** dari `ISIAN KKF` (F8 = daya sesudah, F7 = daya sebelum, kVA), bukan menurut daftar rentang `GAMBAR!AD3:AD15` dan `AM6:AM10` (daftar itu sudah kosong). Jumlahnya hanya dari satu baris gambar (`AA53/AB53`, `AA54/AB54`). Kode KHS di kolom B kini angka tetap, bukan `IF(rentang, kode, "")`.
- **APP 1 PHASA (`SR1PH`)** hanya memuat SDES-1 (jumlah = `GAMBAR!AA51 + AA52`); SDES-2 dan parameter `SR1:SDES2` tidak ada lagi; kabel twisted dikalikan 35 (dulu 30). Harga tetap dari buku harga (harga yang tertanam di lembar tidak dipakai). `SR1PH` kini ikut dibaca dari `MASTER RAB & KKF.xlsx` oleh `tools/extract_bom_json.py` (lembar `APP 1 PHASA`: jumlah pelanggan dari `G11`, jumlah bahan = k × total pelanggan; bahan dikenali dari namanya lewat tabel `SR1PH_CODES`, harga tidak dibaca). Nama bahan yang belum ada di tabel itu, atau bentuk jumlah yang berbeda, masuk daftar tinjau dan baris itu tidak diimpor.
- **Mesin rumus:** fungsi **`ABS`** ditambahkan. Daya permohonan menjadi dua parameter BOM, **`PERMOHONAN:DAYA_BARU_KVA`** dan **`PERMOHONAN:DAYA_LAMA_KVA`** (sel semu `GAMBAR!AC53` dan `AC54`). Nilainya **tidak diketik**: `MtoService` mengisinya dari permohonan saat MTO dihitung (VA diubah ke kVA; pasang baru berdaya lama 0; tanpa daya baru, bawaan BOM dipakai).
- **Paritas:** hasil Excel yang dihitung ulang di LibreOffice pada lima skenario daya cocok dengan mesin (540 dari 540 sel pada dua kelompok PBPD, 28 dari 28 pada SR1PH). Fixture golden (`golden_bom.json.gz`, `golden_bom_import.json.gz`) dibangun ulang dari berkas ini; `golden_pbpd.json.gz` sengaja dibiarkan (menguji fitur parameter teks, konstanta, dan rumus kolom B).
- **Hal lain yang ditemukan:** BPP dan diskonto dalam Excel tidak konsisten (sheet KKF 552 dan 7,78%, sheet KAJIAN 540,98 dan 7,87%); keputusan pemilik: **552 dan 7,78%**. KKF tetap memakai **selisih daya** (Excel memakai daya baru total). NPV Excel = NPV mesin ÷ (1 + diskonto) karena `NPV()` Excel ikut mendiskon tahun 0; IRR dan payback sama persis. Rujukan `#REF!` ada di KKF (3 sel), KAJIAN (342), TABEL 1 KKF (247), dan REKAP (1).

**Ukuran berkas.** Sheet `GD PSG DLM` di Excel induk membawa jutaan sel kosong berformat (A1:XFA507) sehingga berkas 25 MB. Hapus kolom dan baris kosong di bawah data terakhir (Delete, bukan Clear) lalu simpan; ukuran turun ke sekitar 2 MB. Batas unggah di server harus dinaikkan: PHP-FPM `post_max_size` dan `upload_max_filesize` (bawaan 8M dan 2M) serta Nginx `client_max_body_size`, lalu muat ulang layanan. Batas aplikasi 60 MB (`DISTRIVA_MASTER_EXCEL_MAX_MB`).

**Alur lewat web**
1. Unggah di Impor dari Excel (kartu *Excel RAB & KKF* untuk BOM dan harga; *MASTER DISTRIVA* untuk semua kelompok BOM, harga, tarif, dan parameter KKF; *Excel Tarif & Jam Nyala* untuk tarif).
2. Baca kartu; terapkan hanya dataset yang berubah (hasilnya DRAFT). Tanggal berlaku draf harus **sesudah** versi aktif; ubah lewat tombol *Ubah* bila perlu.
3. Setujui dengan akun lain (`bom.approve` / `prices.approve`; pembuat tidak bisa menyetujui drafnya sendiri). Versi lama ditutup sehari sebelum tanggal berlaku versi baru.
4. Hitung ulang permohonan yang masih berjalan; uji satu contoh.

**Fitur penunjang**
- **Batalkan draf BOM** (`POST /master-data/bom/{id}/discard`, status `DISCARDED`): draf salah tidak dihapus (riwayat append-only), tidak bisa disetujui atau diubah, nomor versinya tidak dipakai ulang. Izin: kelola atau setujui BOM. Draf harga, tarif, dan parameter KKF belum punya tombol ini.
- **Selisih nilai MDU** dari Excel hanya **dilaporkan** di kartu Buku harga (tidak ditimpa; tombol *Buat buku harga DRAFT* tetap hanya aktif bila harga material atau jasa berubah).
- **Buat draf dari buku berlaku** (`POST /master-data/price-books/from-active`, halaman Buku Harga dan pintasan di kartu Impor): draf berisi salinan buku yang berlaku (item, harga jasa per zona, zona UP3); alasan wajib; tetap disetujui akun lain.
- **Ubah MDU per barang di draf** (`PATCH /master-data/price-books/{id}/items/{kode}/insured`, tombol *Ubah* pada kolom *Nilai MDU*): alasan wajib; riwayat mencatat nilai sebelum dan sesudah (peristiwa `MDU_SET`); buku yang sudah disetujui tidak bisa diubah. Nilai kosong menghapus MDU.
- Keputusan MDU 18 November: dari 31 barang yang nilainya berbeda dari Excel, 13 mengikuti Excel (KWh meter modem JTMR810, delapan lemari APP A489–A496, A413, A427, JTMR556, JTMR557) dan 18 tetap pada nilai kontrak (KHS JASA 2026). Dasar: nilai database sebelumnya mengikuti berkas kontrak, bukan Excel master.

**Belum lewat web:** KHS baru, jenis konstruksi, dan pemetaannya; perubahan rumus KKF, REKAP, atau aturan RAB (hanya terdeteksi lewat `UJI_KKF` dan `UJI_RAB`, perbaikannya di program).

## 6. Daftar periksa akhir
- [ ] `runbook.py check` tanpa GAGAL; `runbook.py preflight` tanpa FAIL.
- [ ] `runbook.py tests` hijau (Python forecast, golden, BOM).
- [ ] Master data berstatus APPROVED (KHS, konstruksi, BOM, harga, tarif, parameter KKF).
- [ ] Satu permohonan contoh: BOM → RAB → KKF cocok dengan Excel (selisih yang diketahui ada di docs/59 dan docs/83 §9).
- [ ] Cadangan pertama berhasil dan uji restore lulus.

## 7. Yang tidak boleh
- Menjalankan `rebuild_clean.php` (fase `wipe`) pada database berjalan.
- Mengimpor `tools/output/khs.csv` atau keluaran `extract_*` apa adanya (kode lama).
- Menyimpan token MIMS, sandi, atau `.env` di repo, dokumen, tes, atau log.
- Meng-commit `.mdb`, Excel sumber, atau hasil `tools/output/regen/`.

## 8. Hal yang belum diverifikasi
- Fase `load` pada `rebuild_clean.php` terhadap database kosong **belum dicoba**; karena itu jalur A (cadangan) yang direkomendasikan.
- Urutan seeder izin di §4 langkah 4 mengikuti daftar seeder yang ada; belum diuji pada database kosong baru.
