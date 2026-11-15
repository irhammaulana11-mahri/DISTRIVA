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
3. **Skema.** `php artisan migrate --force`.
4. **Peran dan izin.** Jalankan seeder izin satu per satu: `php artisan db:seed --class=FoundationPermissionSeeder`, lalu `MasterDataPermissionSeeder`, `ApplicationPermissionSeeder`, `KkoPermissionSeeder`, `SurveyPermissionSeeder`, `MtoPermissionSeeder`, `RabPermissionSeeder`, `KkfPermissionSeeder`, `DrawingPermissionSeeder`, `SubstationPermissionSeeder`, `PlanningPermissionSeeder`, `BackupPermissionSeeder`. Tiap seeder memanggil `RoleSeeder` lebih dulu. Pada sistem yang sudah berjalan, jalankan seeder hanya bila ada kunci izin baru dan atas persetujuan pemilik.
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
- **Pilihan bagi pemilik (belum diputuskan):**
  1. Minta laporan penjualan tiap ULP (format lembar `309`), ekstrak per ULP dengan `runbook.py extract --ulp <kode ULP>`, lalu gabungkan menjadi satu buku tarif. Paling tepat karena jam nyala memang berbeda antar ULP.
  2. Sementara, pakai baris Jombang untuk semua ULP: ekstrak **tanpa** `--ulp` (baris berlaku umum). Cepat, tetapi jam nyala ULP lain hanya perkiraan; tandai di catatan buku tarif.
- **Cara memperbarui:** buku tarif **baru** lewat alur resmi (buku yang disetujui tidak diubah; buku lama ditutup sehari sebelum buku baru berlaku), pembuat dan penyetuju akun berbeda. Sesudahnya KKF yang sudah tersimpan tetap memakai angka lamanya; hitung ulang bila perlu.
- **Periksa sebelum impor:** jam nyala wajar (puluhan sampai ratusan jam per bulan; nilai ribuan menandakan satuan salah), harga rata-rata tidak nol, dan UJL terisi untuk tarif pascabayar (tanpa UJL biaya penyambungan pascabayar tidak bisa dihitung).

Setelah perubahan apa pun: `python3 tools/runbook.py tests`, lalu hitung ulang satu contoh permohonan dan bandingkan dengan Excel.

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
