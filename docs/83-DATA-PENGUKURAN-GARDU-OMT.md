# 83 — Data pengukuran gardu OMT 2022–2026: pemeriksaan, perbaikan, dan rencana pemuatan

Sumber: `tools/samples/omt-pengukuran 2022-1.csv … 2026-2.csv` (unduhan Maximo, seluruh Indonesia; UP3 Mojokerto = `Nama Unit` MOJOKERTO, 10 ULP). Alat: `tools/omt_sync` (`check` / `fix`).

## 1. Temuan (diperiksa terhadap berkas asli)
| # | Temuan | Berkas | Perbaikan |
|---|--------|--------|-----------|
| 1 | **Kolom bergeser / tanpa judul.** Judul 60 kolom (jurusan a–d, u), tetapi sebagian baris memuat **108** isian (jurusan a–p, u): 48 isian lebih banyak daripada judul. `nhf_idt` (judul terakhir) pada baris itu berisi data kolom lain; sisanya tanpa judul. | 2022-1, 2022-2, 2023-1 (34–39 % baris UP3 Mojokerto; 56 % baris seluruh Indonesia) | Tiap baris dibaca menurut lebarnya (60 = tata letak lama, 108 = baru) dan ditulis ke 108 kolom baku. Tidak ada baris dengan lebar lain. |
| 2 | **Format tanggal campuran**: `2024-06-30 05:54:38` (ISO) dan `6/29/2024 22:56` (bulan/hari/tahun, hasil simpan Excel). | 2023-2, 2024-1, 2025-2 memakai bulan/hari/tahun; lainnya ISO | Semua jadi `YYYY-MM-DD` dan `YYYY-MM-DD HH:MM:SS`. Tidak ada tanggal rusak; tanggal selalu sama dengan tanggal pada kolom waktu. |
| 3 | **965.329 baris kosong** (sisa Excel); data nyata hanya 83.246 baris. | 2023-2 | Dibuang. |
| 4 | **Duplikat** antar dan dalam berkas (mis. 30 Juni di dua berkas) — 231 baris. | semua | Dibuang; kunci = ULP + nama aset + waktu; berkas yang lebih baru menang. |
| 5 | **Data belum lengkap** untuk 2026 (lihat §2). | 2026-1, 2026-2 | Hanya dilaporkan; tidak ditebak. |

Hasil untuk UP3 Mojokerto: **48.464 pengukuran bersih**, 5.780 gardu, 2 Jan 2022 s.d. 9 Nov 2026, waktu lengkap (hanya 1 baris berjam 00:00:00). Tata letak lama 9.995 baris (2022 s.d. Juni 2023), baru 38.700 (sebelum 231 duplikat dibuang).

## 2. Cakupan: ULP yang belum lengkap (butir "tunggu semua ULP siap")
Rata-rata ±900 pengukuran per bulan untuk UP3. 2022 s.d. Desember 2025 lengkap untuk 10 ULP. Pada 2026:
- **JOMBANG**: Jan–Apr kosong, Mei 24, Jun 6, Jul 96, Agu–Okt kosong (biasanya ±135/bulan).
- **MOJOSARI**: Jan–Apr kosong, Mei 4, Jun–Okt kosong (biasanya ±100).
- **WARUJAYENG**: Jan–Apr kosong, Mei 8, Jun–Okt kosong (biasanya ±53).
- **KERTOSONO**: Feb–Mar kosong, Jan 14, Agu–Okt kosong. **MOJOAGUNG**: Jan kosong, Feb 16, Mar 2, Jun 6, Agu 13, Sep 19. **MOJOKERTO KOTA**: Jun 22, Jul 86, Agu–Okt kosong. **NGANJUK**: Agu 18, Okt 43.
- NGORO, PACET, PLOSO: lengkap (Nov = bulan berjalan). Laporan lengkap: `tools/omt_sync/out/laporan.txt` (jalankan `fix`).
**Yang perlu diunduh ulang**: pengukuran 2026 untuk JOMBANG, MOJOSARI, WARUJAYENG, KERTOSONO, MOJOAGUNG, MOJOKERTO KOTA, dan NGANJUK pada bulan di atas. Berkas baru cukup ditaruh di folder yang sama; alat ini menggabungkan dan membuang duplikat.

## 3. Waktu pengukuran dan kapasitas trafo (diterapkan di DISTRIVA)
- **Waktu**: `substation_readings.measured_at` (timestamptz, WIB). Layar menampilkan **tanggal dan jam** (riwayat pembacaan, riwayat analisis, daftar pengukuran terakhir); form tambah pembacaan punya isian "Jam (opsional)"; API menerima `measured_at` selain `measured_on`. Beberapa pembacaan pada hari yang sama diperbolehkan bila jamnya berbeda; idempoten per (gardu, sumber, waktu); pembacaan lama yang hanya bertanggal tetap idempoten per hari.
- **Kapasitas pada saat pengukuran**: `substation_readings.capacity_kva`. Manajemen trafo mengubah kapasitas gardu antar tahun, jadi pembebanan pembacaan lama dihitung terhadap kapasitas **saat itu** (API menerima `capacity_kva`; tanpa itu dipakai kapasitas master saat pembacaan disimpan). Riwayat analisis menampilkan kapasitas tiap pembacaan dan penanda **"dari X"** bila berubah dari pembacaan sebelumnya (`capacity_change`).
- Catatan data: pada OMT, `Kapasitas Aset` **konstan per aset** selama 2022–2026 (tidak ada aset yang kapasitasnya berubah antar pembacaan), jadi unduhan ini memuat kapasitas **terkini** untuk semua tahun. Perubahan kapasitas riil baru terlihat dari master gardu (Maximo) atau dari pembacaan yang membawa `capacity_kva` sendiri.

## 4. Pemetaan kolom OMT → DISTRIVA (untuk pemuatan)
Nama Unit = UP3 · Nama ULP = ULP · Nama Penyulang → master penyulang · Nama Aset → kode gardu (kode pendek HD762 dilengkapi menjadi HD0762 dalam ULP yang sama, aturan sama dengan DIL) · Latitude/Longitude Aset → koordinat master · Konstruksi Aset (GTT1/GTT2/…) → jenis · Kapasitas Aset → kapasitas · Waktu Pengukuran → `measured_at` · Beban Trafo → `load_kva` (kVA) · Pembebanan Trafo → pecahan (0,61252 = 61,25 %) · `iar/ias/iat` dst. → arus per jurusan (a–p) dan total (u) · `vrn/vsn/vtn` → tegangan pangkal R/S/T · `vrs/vst/vtr` → tegangan antar fasa. Tegangan ujung tidak ada pada OMT.

## 5. Pemuatan ke DISTRIVA (dijalankan 10 November 2026)
Pemilik menyetujui memuat lebih dulu karena sebagian data (bulan 2026 yang kosong) sudah masuk lewat Maximo. Perintah (idempoten, aman diulang): `php artisan substations:load-omt tools/omt_sync/out/omt-pengukuran-bersih-mojokerto.csv [--dry-run] [--actor=email]`; layanan `OmtLoadService`, tes `OmtLoadTest`.
Aturan: kode aset dilengkapi (HD762 → HD0762); **master Maximo menang** (gardu yang sudah ada tidak ditimpa, hanya kapasitas/koordinat/penyulang yang kosong diisi); gardu yang belum ada dibentuk (ULP, koordinat bila valid di wilayah Indonesia, kapasitas, konstruksi, penyulang); penyulang dicocokkan menurut nama (spasi dan tanda baca diabaikan, `TEBU IRENG` = `TEBUIRENG`), yang belum ada dibentuk dengan kode singkatan otomatis dan pemilik UP3; pengukuran dimuat idempoten per gardu, sumber `IMPORT`, dan waktu, membawa kapasitas saat itu, beban (kVA), tegangan pangkal R/S/T, arus total dan arus tiap jurusan. "MOJOKERTO KOTA" pada OMT = ULP Mojokerto (51452).
**Hasil** (basis data dev; cadangan sebelum muat disimpan di scratchpad sesi):
| | sebelum | sesudah |
|---|---|---|
| Gardu | 971 (hanya ULP Jombang) | **5.902** (10 ULP: Jombang 972, Mojokerto 1.146, Nganjuk 741, Mojosari 643, Ngoro 529, Mojoagung 433, Ploso 410, Kertosono 384, Pacet 328, Warujayeng 316) |
| Penyulang | 14 | **130** (116 dibentuk dari nama OMT) |
| Pembacaan | 388 | **48.852** (48.464 baru, semuanya berjam) |
Tidak ada ULP tak dikenal, tidak ada gardu yang unitnya berbeda. Satu gardu tanpa koordinat dan satu tanpa kapasitas (OMT tidak memuatnya).
**Yang perlu dilengkapi dari Maximo**: nama dan alamat gardu yang dibentuk dari OMT (4.931 gardu, kolom nama kosong), kode penyulang resmi (116 kode hasil singkatan otomatis, mis. BANGSAL → BNGSL; koreksi lewat Master Penyulang), dan data 2026 yang masih kosong (§2). Mengimpor berkas gardu Maximo (format SEP2026) untuk ULP lain akan melengkapi nama/alamat tanpa membuat gardu ganda karena kunci = kode gardu.

## 6. Daftar penyulang pemilik (penyulang / rayon / gardu induk): nama GI pada master penyulang
Daftar lengkap pemilik ada di `tools/samples/penyulang-gi.csv` (kolom PENYULANG, RAYON, GARDU INDUK; 171 penyulang, tidak ada penyulang dengan dua GI berbeda). Perubahan:
- Kolom baru `distribution_feeders.gi_name` (migrasi `2026_11_18_100000`); `gi_code` tetap kode Maximo. Layar Master Penyulang menampilkan nama GI (kode di sampingnya), bisa dicari dan diubah.
- Perintah `php artisan feeders:load-gi tools/samples/penyulang-gi.csv [--dry-run] [--rename-typos] [--create-missing]`, idempoten, tiap perubahan tercatat di riwayat penyulang. Pencocokan menurut nama (spasi dan tanda baca diabaikan) atau bagian setelah garis bawah pada bentuk OMT (`MJA_BANCANG` = kode ULP + penyulang). `--rename-typos` mengganti **ejaan** penyulang yang hanya selisih 1–2 huruf dari nama resmi bila belum ada penyulang bernama resmi itu (tidak pernah menggabung). `--create-missing` membentuk penyulang resmi yang belum ada (kode disingkat otomatis, pemilik UP3, catatan memuat rayon), kecuali yang mirip penyulang yang sudah ada.
- **Hasil (dijalankan 10 Nov 2026)**: penyulang 130 → **177**; **175 terisi GI**. Lima ejaan diganti: ELKISI → ELKISHI, MOJOKRAPAK → MOJOKRAPYAK, MITRA SARUTA → MITRA SAROTA, SIKEPU → SIKEPUH, SONOPATIK → SENOPATIK. 47 penyulang resmi dibentuk (antara lain WIDAS, NGLIMAN, LOCERET, NGLUNDO, JAKER 1/2, penyulang khusus pelanggan seperti CHEIL JEDANG 1–3, SUNRISE 1–3, MEGASURYA 1–3, LIANG YING 1–3).
- **Keputusan pemilik**: nama resmi **BENTENG PANCASILA** (GI Sekar Putih; baris `BENTENG` pada CSV diganti) dan **GAYAM** (GI Mojoagung; penyulang `CATAK GAYAM`/CTKGY diganti namanya menjadi GAYAM, tercatat di riwayat). Setelah itu **seluruh 177 penyulang terisi GI-nya** dan tidak ada yang menunggu keputusan.

## 7. Kode gardu = No. GADIS; Master Penyulang menampilkan nama unit (19 November 2026)
- **Kode gardu yang dipakai orang adalah No. GADIS** (mis. GD514530003 untuk HD0001), bukan kode Maximo. API gardu menambah `display_code` = No. GADIS bila ada, jika tidak kode Maximo (HD…); `code` (Maximo) tetap kunci teknis impor dan pembacaan. Pencarian gardu menemukan keduanya. Dipakai di Master Gardu, Pengukuran Gardu, pemilih gardu KKO (kode yang tersimpan pada KKO baru juga No. GADIS), daftar gardu pada penyulang, dan pemilih gardu pada Master Pelanggan.
- **Batas data**: baru **799 dari 5.902 gardu** yang punya No. GADIS (dari berkas gardu Maximo ULP Jombang). Data OMT hanya memuat kode HD, dan No. GADIS **tidak dapat diturunkan dari kode HD** (HD0001 = GD514530003, HD0002 = GD514530279, tanpa pola). Gardu lain sementara tampil dengan kode HD; No. GADIS terisi saat berkas gardu Maximo (NO_GADIS) untuk ULP itu diimpor.
- **Master Penyulang**: kolom "Unit" kini menampilkan **nama unit (ULP) yang dilayani** saja (diturunkan dari gardunya, `served_units` pada daftar penyulang), tanpa kode dan tanpa cabang UP3. Filter tetap dua: **Cabang** (pemilik, UP3) dan **Unit** (ULP yang dilayani), keduanya berisi nama. Penyulang yang belum punya gardu menampilkan "-".

## 8. Buku harga: tiang beton dan jointing termination (10 November 2026)
Masalah: RAB gagal "JTMR934 tidak ada di buku harga" padahal ada pada jenis konstruksi. Penyebab: buku harga dibangun dari "KHS JASA 2026" (`kkfsetuju_PABRIKBITINGMARJONO.xlsx`) yang mencatat tiang beton dengan kode lama dan nama yang tidak cocok dengan KHS; harga tiang beton sebenarnya ada pada lembar **TIBET** di `MASTER RAB & KKF.xlsx` (material, transport, jasa pasang, jasa bongkar).
Keputusan pemilik: nilai yang belum ada mengikuti `MASTER RAB & KKF.xlsx`; tiang beton **disediakan PLN/MDU tetapi RAB menghitung semuanya** (material + transport); harga jasa **sama untuk semua zona**.
Dilakukan lewat alur resmi (buku yang disetujui tidak diubah): **buku harga baru** "Kontrak jasa dan material" berlaku **10 Nov 2026**, salinan buku 2 Nov 2026 + 10 kode, disetujui; buku lama ditutup 9 Nov 2026. Isi: 523 item, 2.102 harga jasa, zona UP3 Mojokerto = 2 (tetap).
| Kode | Jenis | Nilai MDU (material + transport) | Pasang | Bongkar |
|---|---|---|---|---|
| JTMR934 | Tiang beton 9m–200 | 2.524.420 | 560.870 | 336.522 |
| JTMR935 | 9m–500 | 3.026.730 | 600.130 | 360.078 |
| JTMR618 | 11m–200 | 3.533.210 | 661.820 | 397.092 |
| JTMR622 | 12m–200 | 4.474.320 | 802.040 | 481.224 |
| JTMR619 | 12m–350 | 4.648.940 | 880.570 | 528.342 |
| JTMR620 | 13m–350 | 5.603.340 | 931.040 | 558.624 |
| JTMR621 | 13m–500 | 6.013.560 | 959.090 | 575.454 |
| JTMR933 | 14m–350 | 6.724.660 | 1.099.310 | 659.586 |
| JTMR941 | Jointing termination 24 kV 150 mm 1 core MVTIC | PLN, tanpa nilai di master | 896.400 | 537.840 |
| JTMR942 | Jointing termination 24 kV 240 mm 3 core XLPE | PLN, tanpa nilai di master | 896.400 | 537.840 |
Status material semuanya `PLN` dengan `insured_value` = nilai MDU (aturan RAB: material PLN/MDU dihitung pada nilai MDU). **Tetap tanpa harga** karena di master sendiri bernilai N/A: JTMR775, JTMR776 (konektor press) dan JTMR906, JTMR907 (preformed side tie); MTO yang memakainya masih akan ditolak RAB sampai ada nilainya. Peringatan lama `NO_PLN_VALUE` (mis. A585, 3040331) adalah kode lain yang juga belum bernilai MDU.

## 9. KKF: jam nyala buku tarif dikoreksi (10 November 2026)
Hasil KKF DISTRIVA berbeda jauh dari Excel master (IRR 27 juta persen, NPV Rp 72 miliar, PBP 0 tahun) karena **jam nyala pada buku tarif 1000 kali nilai sumber** (B2: 117.000 jam; sumber `MASTER TARIF & JAM NYALA.xlsx`: 117 jam), pada seluruh 204 baris. Energi terjual menjadi 7.413 MWh per tahun, seharusnya 7,4 MWh.
**Koreksi** (disetujui pemilik): buku tarif baru "Buku tarif & jam nyala ULP Jombang 2026" berlaku **10 Nov 2026**, jam nyala dibagi 1000 (rentang 41–240 jam), tarif rata-rata dan UJL tidak berubah; buku 2 Nov 2026 ditutup 9 Nov 2026. KKF yang sudah tersimpan tetap memakai angka lama (riwayat tidak ditulis ulang): **hitung ulang** KKF untuk mendapat angka benar.
Keputusan pemilik atas perbedaan aturan dengan Excel master (lembar KAJIAN):
- **Rumus IRR** mengikuti Excel: `IF(arus tahun 0 > 0, 100, IRR(arus tahun 0–25, tebakan 0,1) × 100)`; kriteria IRR > discount rate. Mesin DISTRIVA sudah memakai rumus ini (tidak ada perubahan).
- **Faktor beban KKF tetap 0,8** (aturan parameter KKF); Excel master memakai 1,0, itu penyebab IRR/PBP Excel lebih baik.
- **NPV: arus tahun ke-0 tidak ikut didiskon** (tetap seperti DISTRIVA); fungsi `NPV()` Excel mendiskon tahun ke-0 satu periode sehingga NPV Excel lebih kecil sekitar (1 + discount rate).
- Perkiraan setelah koreksi untuk permohonan PBPD-51453-2026-00326 (masukan KKF tersimpan: investasi Rp 30.793.700, BP Rp 6.405.400, jam nyala 117, faktor beban 0,8): RWACC 4,72 %, IRR 24,5 %, NPV ≈ Rp 40,9 juta, PBP 4 tahun 1 bulan, rasio BP 0,208. Selisih sisa terhadap Excel berasal dari nilai investasi RAB (Excel ≈ Rp 32,9 juta) dan faktor beban.

## 10. Nilai MDU material PLN (10 Nov 2026)

Pemilik menetapkan nilai MDU: **3040331 = Rp 21.700** dan **A585 = Rp 7.000**. Buku harga "Kontrak jasa dan material" 2026-11-10 diganti versi baru (isi 523 butir, hanya `insured_value` kedua kode yang bertambah). Versi lama berstatus INACTIVE (riwayat tetap). Faktor beban KKF tetap 0,8. Hitung ulang KKF diperlukan karena run lama memakai angka lama.
