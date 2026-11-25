# 92 — Standar Halaman dan Penajaman Analisa Pengusahaan (rancangan)

Status: **rancangan disetujui pemilik (25 Nov 2026), belum dikerjakan.** Dokumen ini menetapkan arah; kontrak API tiap tahap ditulis di docs/91 dan dicatat di README-REVISI saat tahap itu dikerjakan backend. Berlaku untuk semua menu di bawah label **Analisa & Tren Pengusahaan** (katalog metrik docs/91 §1).

## 1. Tujuan

Begitu halaman dibuka, pengguna langsung tahu tiga hal tentang unitnya:

1. **Kondisi sekarang:** angka bulan terakhir, kumulatif tahun berjalan, dan apakah sesuai target.
2. **Penyebab:** ULP, komponen, penyulang, atau golongan mana yang menggerakkan angka itu.
3. **Arah ke depan:** prakiraan dan peluang mencapai target, serta apa yang perlu dikejar.

Semua menu memakai satu pola halaman dan satu susunan tab, supaya pengguna yang paham satu menu langsung paham menu lain.

## 2. Prinsip

- **Target lebih dulu.** Setiap angka yang punya target NKO dibandingkan dengan targetnya (tabel `kpi_targets`, 4.260 baris saat ini). Arah baik mengikuti `polarity` metrik.
- **Pecah sampai ke penyebab.** Perubahan UP3 dipecah per ULP; perubahan ULP dipecah per komponen (golongan, kelas umur, penyulang, kanal). Jumlah pecahan selalu sama dengan angka induknya.
- **Detail tetap ditampilkan.** Keputusan diambil di tingkat penyulang, gardu, desa, atau golongan, jadi setiap menu punya tabel detail bila sumbernya menyediakan.
- **Jujur tentang data.** Data belum lengkap, bulan berjalan, potret per tanggal tarik, dan sumber belum diverifikasi selalu ditandai (pola `warnings[]` docs/91).
- **Prakiraan berbasis pendorong.** Pola masa lalu tetap dipakai, tetapi ditambah faktor pendorong yang masuk akal per menu, dan akurasinya ditampilkan.

## 3. Tata letak standar

Dari atas ke bawah:

1. **Kepala halaman**
   - nama menu, pilihan unit (UP3 atau ULP), rentang bulan;
   - satu baris status data: "Data s.d. Okt 2026 · 10/10 ULP · ditarik 25 Nov 2026 18.49", ditambah tanda bulan berjalan atau belum lengkap;
   - tombol tarik data sumber menu itu (AP2T, APKT, EIS) dan Unduh Excel.
2. **Kartu status (4 kartu)**
   - **Nilai terakhir:** angka bulan terakhir dan perubahan dari bulan sebelumnya.
   - **Kumulatif lawan target:** realisasi tahun berjalan, target, dan persentase pencapaian.
   - **Lawan tahun lalu:** perubahan dibanding bulan yang sama dan kumulatif tahun lalu (hanya ULP setara, seperti `comparison_basis`).
   - **Laju yang dibutuhkan:** rata-rata bulanan yang harus dicapai sisa tahun agar target tercapai, dibanding laju sekarang.

   Warna hijau, kuning, atau merah menurut jarak ke target dan arah baik metrik. Menu tanpa target memakai perbandingan tahun lalu.
3. **Diagnosis (paling banyak 3 kalimat otomatis)**
   - apa yang berubah dan seberapa besar;
   - siapa penyebab terbesarnya (ULP atau komponen), dengan angka sumbangannya;
   - apa yang janggal: angka di luar kebiasaan, atau masalah data.
4. **Peringkat ULP:** heatmap ULP × bulan (12 bulan terakhir), warna menurut pencapaian target atau perubahan tahunan, dengan urutan ULP terburuk di atas.

## 4. Tab standar

Tab yang tidak berlaku untuk suatu menu disembunyikan, tidak ditampilkan kosong.

| Tab | Isi |
|---|---|
| **Ringkasan** | Bagian 3 butir 2 sampai 4 |
| **Tren** | Garis 12 bulan tahun ini lawan tahun lalu; kumulatif tahun berjalan lawan garis target; penanda kejadian (Lebaran, penyesuaian tarif, pemadaman besar) |
| **Rincian** | Komposisi menurut dimensi menu (golongan, komponen, kelas umur, BLTH, kanal) dalam bentuk Pareto: penyumbang terbesar dahulu, dengan persentase kumulatif |
| **Perbandingan ULP** | Tabel peringkat: nilai, % target, perubahan tahunan, **sumbangan ke perubahan UP3**, sparkline 12 bulan; kuartil sebagai pembanding antar-ULP |
| **Data** | Tabel unit × bulan yang bisa disalin dan diunduh; tabel detail tingkat bawah bila tersedia (penyulang, gardu, desa atau kecamatan, permohonan, golongan) |
| **Pendamping** | Hanya untuk menu dengan data pendamping atau rekonsiliasi (docs/91) |
| **Prakiraan** | Prakiraan dengan rentang p10 sampai p90, **peluang mencapai target**, faktor pendorong yang dipakai, dan akurasi uji mundur |
| **Histori sumber** | Matriks kelengkapan, berkas, dan sesi sinkron (docs/91 §3c) |

## 5. Tambahan data yang dibutuhkan dari backend (rancangan kontrak)

Rinciannya ditetapkan di docs/91 saat dikerjakan. Garis besarnya:

- **`target`** per metrik dan unit: target bulan dan kumulatif dari `kpi_targets` (bila ada), pencapaian %, laju bulanan yang dibutuhkan, laju sekarang, dan status (`aman`, `waspada`, `tertinggal`).
- **`diagnosis[]`**: kalimat otomatis dengan tingkat (`info`, `perhatian`, `kritis`), seperti `insights` sekarang tetapi berfokus pada penyebab dan target.
- **`contribution`**: sumbangan tiap ULP ke perubahan UP3 (bulanan, tahunan, kumulatif), dan sumbangan tiap komponen ke perubahan ULP.
- **`detail`**: tabel detail per menu (kolom dan baris), terpaginasi, dengan endpoint terpisah bila besar.
- **`forecast`** (diperluas): `target_probability`, `drivers[]` (faktor yang dipakai dan arah pengaruhnya), `backtest` (MAPE dan perbandingan dengan metode naif, yang sudah ada sebagian sebagai `quality.gain_vs_naive_pct`).
- **`events[]`**: kejadian tercatat yang memengaruhi angka (lihat §7).

## 6. Penajaman per menu

Kolom "Data DISTRIVA" menyebut data yang sudah ada; "Data luar" adalah calon yang perlu diverifikasi (§8).

### 6.1 Pelanggan dan Daya (`pelanggan`, `daya`)

- **Pertanyaan:** berapa penambahan bersih, dari mana, dan berapa yang hilang?
- **Data DISTRIVA:** laporan 309, permohonan PB/PD (status, tanggal, biaya), survei permohonan berkoordinat (`application_survey_versions.latitude/longitude`), gardu berkoordinat dan berkecamatan (`substations`, 6.293 gardu), DIL, `customer_connections.kecamatan`.
- **Analisa:**
  - penambahan bersih = PB tersambung − pelanggan berhenti (berhenti = PB tersambung − kenaikan 309);
  - antrean permohonan dan lama sambung per ULP (dari masuk sampai tersambung);
  - peta penambahan per kecamatan dan per wilayah gardu;
  - PD: porsi naik daya per golongan.
- **Prakiraan:**
  - 3 sampai 6 bulan: antrean permohonan × laju konversi historis × lama sambung (jauh lebih pasti daripada pola saja);
  - 1 sampai 3 tahun (perencanaan RKM dan kapasitas gardu): **ruang tumbuh** per wilayah gardu atau kecamatan = pertumbuhan bangunan dikurangi pelanggan yang sudah ada, ditambah kawasan perumahan dan industri baru.
- **Data luar:** Google Open Buildings Temporal (potret tahunan 2016 sampai 2023), tutupan lahan (alih fungsi sawah ke terbangun), proyeksi penduduk BPS per kecamatan, kawasan industri.

### 6.2 kWh Jual (`kwh-jual`)

- **Pertanyaan:** naik atau turun karena jumlah pelanggan, konsumsi per pelanggan, atau campuran golongan?
- **Data DISTRIVA:** 309 per golongan tarif, kontrol 309 (komponen: pascabayar TUL III-07, prabayar, PESTA, SPKLU, P2TL, pembatalan), permohonan PB.
- **Analisa:**
  - perubahan tahunan dipecah menjadi efek jumlah pelanggan, efek kWh per pelanggan, dan efek campuran golongan (jumlahnya sama dengan perubahan total);
  - porsi prabayar lawan pascabayar dan komponen lain dari kontrol 309;
  - golongan besar (I dan B) yang naik atau turun paling banyak, sebagai daftar perhatian.
- **Prakiraan:** per golongan tarif lalu dijumlahkan, dengan pendorong prakiraan pelanggan (§6.1), penanda bulan Lebaran (§7), jumlah hari kerja, dan suhu (BMKG). Studi pada wilayah PLN menunjukkan suhu berpengaruh pada konsumsi rumah tangga.

### 6.3 Pendapatan (`pendapatan`)

- **Analisa:** perubahan dipecah menjadi efek volume (kWh), efek tarif rata-rata (Rp/kWh), dan efek campuran golongan; komponen pendapatan dari kontrol 309.
- **Prakiraan:** prakiraan kWh per golongan × tarif rata-rata golongan; penyesuaian tarif sebagai kejadian tercatat (§7).

### 6.4 Piutang Prabayar, Pascabayar, dan Umur (`piutang-prabayar`, `piutang-pascabayar`, `piutang-pascabayar-umur`)

- **Pertanyaan:** berapa tunggakan yang akan naik kelas umur dan menjadi PRR?
- **Data DISTRIVA:** UMURPIUTANG (tunggakan per kelas umur dan kogol), AKHIEPERIODE_EIS (saldo lewat tanggal 20 terhadap rekening baru), PIUTANGLPB_EIS.
- **Analisa:**
  - **roll-rate**: persentase tunggakan kelas umur n yang menjadi kelas n+1 bulan berikutnya (1 → 2 → 3 → lebih dari 3 bulan), per ULP dan per kogol; ini mengubah daftar umur piutang yang statis menjadi peringatan dini;
  - efektivitas penagihan: tunggakan awal bulan yang lunas dalam bulan itu;
  - kogol dan ULP dengan roll-rate tertinggi sebagai daftar perhatian.
- **Prakiraan:** saldo per kelas umur bulan depan = saldo sekarang × roll-rate (termasuk calon PRR). Hipotesis yang perlu diuji: Lebaran dan musim panen memengaruhi pembayaran di ULP agraris.

### 6.5 Pelunasan PRR dan Ex PRR (`pelunasan-prr`, `pelunasan-ex-prr`)

- **Data DISTRIVA:** pelunasan per BLTH dan komponen (AP2T, docs/88). Saldo PRR belum ada di DISTRIVA; perlu sumber saldo (dicari bersama pemilik).
- **Analisa:** **vintage**: peluang pelunasan menurut umur BLTH (makin tua makin kecil); tingkat pemulihan = pelunasan dibanding saldo PRR (setelah saldo tersedia); pencapaian target NKO PRR dan Ex PRR.
- **Prakiraan:** saldo PRR per umur × kurva peluang pelunasan per umur; sampai saldo tersedia, prakiraan pola bulanan dengan penanda Lebaran.

### 6.6 SAIDI dan SAIFI, ENS, Gangguan Penyulang (`saidi-saifi`, `ens`, `gangguan`)

- **Pertanyaan:** berapa sisa "anggaran" SAIDI tahun ini, penyulang mana yang menghabiskannya, dan kapan risiko naik?
- **Data DISTRIVA:** DIFI (APKT), gangguan penyulang (PMT dan recloser, durasi, penyebab, beban sebelum gangguan, cuaca tercatat), pengukuran gardu (beban), DIL per penyulang.
- **Analisa:**
  - **anggaran SAIDI dan SAIFI**: (target tahunan − realisasi kumulatif) ÷ sisa bulan, dibanding rata-rata bulanan sekarang;
  - Pareto penyulang penyumbang SAIDI, ENS, dan jumlah gangguan terbesar;
  - penyulang dengan gangguan berulang (misalnya 3 kali atau lebih dalam 30 hari);
  - porsi gangguan tidak terencana, pemeliharaan, dan bencana;
  - penyebab gangguan terbanyak per penyulang.
- **Prakiraan:**
  - jumlah gangguan per penyulang per bulan dengan pola musim hujan dan riwayat penyulang (model hitungan seperti Poisson);
  - peringatan dini mingguan dari prakiraan cuaca BMKG 7 hari per kelurahan (API terbuka);
  - riset gangguan distribusi menempatkan curah hujan, petir, dan angin sebagai faktor terkuat;
  - ENS = durasi × beban penyulang dari pengukuran gardu.
- **Data luar:** prakiraan BMKG (terbuka, wajib atribusi dan lewat API resmi); data historis curah hujan dan petir perlu diminta ke BMKG.

### 6.7 RPT-RCT Gangguan dan Keluhan (`rpt-rct-gangguan`, `rpt-rct-keluhan`)

- **Data DISTRIVA:** APKT per ULP per bulan (dengan dan tanpa clear temper untuk gangguan), jumlah WO.
- **Analisa:**
  - hubungan volume WO dengan RPT dan RCT per ULP (apakah posko kewalahan saat volume naik);
  - porsi WO clear temper dan trennya;
  - jarak setiap ULP ke ULP terbaik pada volume sebanding;
  - jarak ke ambang NKO (response time tanpa clear temper).
- **Prakiraan:** volume WO mengikuti prakiraan gangguan (§6.6); RPT dan RCT diprakirakan dari volume dan riwayat ULP.

### 6.8 Anomali Gangguan dan Keluhan (`anomali-gangguan`, `anomali-keluhan`)

- **Analisa:** laju berulang dan rating negatif per kanal; rating negatif tanpa marking (ukuran NKO) terhadap ambang; kaitan pengaduan berulang dengan penyulang yang sering gangguan, dan kaitan rating negatif dengan RCT yang lama.
- **Prakiraan:** mengikuti prakiraan volume pengaduan dan RPT-RCT; peringatan bila laju mendekati ambang NKO.

### 6.9 kWh P2TL (`kwh-p2tl`)

- **Data DISTRIVA:** TAGSUS realisasi, TAGSUS belum realisasi (potret), penetapan TS P2TL di kontrol 309.
- **Analisa:**
  - corong penetapan → realisasi → belum realisasi, dan tingkat realisasi;
  - umur penetapan yang belum terealisasi;
  - kaitan P2TL dengan susut per ULP (setelah susut tersedia).
- **Prakiraan:** penetapan dari pola bulanan dan target operasi; realisasi dari kurva penagihan penetapan menurut umurnya.

### 6.10 Susut (`susut`)

- **Syarat:** masukan kWh beli, E-Min, PSSD per ULP per bulan (belum ada sumber otomatis; docs/91 §3a).
- **Analisa:**
  - rata-rata bergerak 12 bulan, karena susut bulanan berisik akibat waktu catat meter;
  - proksi **susut teknis** per gardu dari pengukuran gardu (beban lebih, beban tidak seimbang, tegangan jatuh);
  - **susut nonteknis** dikaitkan dengan P2TL;
  - ULP dan gardu dengan proksi terburuk sebagai daftar perhatian.
- **Prakiraan:** dari prakiraan kWh jual dan pola kWh beli.

### 6.11 HPL Biaya BP (`hpl-bp`)

- **Analisa:** porsi PB lawan PD, biaya ditetapkan lawan lunas, lama dari penetapan sampai lunas.
- **Prakiraan:** dari antrean permohonan yang sudah ditetapkan tetapi belum lunas, dikali laju pelunasan historis.

## 7. Faktor umum untuk semua menu

- **Kalender Lebaran.** Lebaran bergeser sekitar 11 hari per tahun, sehingga pola musiman 12 bulan biasa salah menempatkan lonjakannya. Prakiraan memakai penanda bulan Lebaran (dan bulan sebelumnya) sebagai faktor tersendiri; grafik tren menandainya.
- **Kejadian tercatat (`events`).** Penyesuaian tarif, kawasan perumahan atau industri baru, pemadaman besar, dan perubahan aturan dicatat dengan tanggal, unit, dan alasan. Prakiraan membacanya; grafik menandainya.
- **Peluang mencapai target.** Prakiraan kumulatif akhir tahun dibandingkan dengan target NKO: "peluang tercapai 70%", berdasarkan rentang p10 sampai p90.
- **Akurasi yang terlihat.** Setiap prakiraan menampilkan akurasi uji mundur dan perbandingan dengan metode naif. Model sekarang (pola musiman dan tren teredam, rentang dari uji mundur 1 sampai 3 bulan) tetap menjadi dasar.
- **Hierarki konsisten.** Jumlah prakiraan ULP disamakan dengan prakiraan UP3.

## 8. Data luar dan syaratnya

Semua sumber luar diuji dulu di satu ULP sebelum dipakai luas. Lisensi dan kewajiban atribusi dicatat di halaman yang memakainya.

| Sumber | Untuk | Catatan |
|---|---|---|
| BMKG prakiraan cuaca (API terbuka, per kelurahan, 7 hari) | Peringatan dini gangguan (§6.6) | Wajib atribusi; pengambilan otomatis lewat API resmi. Historis curah hujan dan petir perlu diminta ke BMKG |
| BMKG data suhu | kWh jual (§6.2) | Ketersediaan historis bulanan per stasiun perlu dicek |
| Google Open Buildings Temporal | Ruang tumbuh pelanggan (§6.1) | Potret tahunan 2016 sampai 2023, Asia Tenggara, CC-BY 4.0 dan ODbL; deteksi antar-tahun tidak selalu stabil |
| Tutupan lahan (ESA WorldCover, Dynamic World) | Alih fungsi sawah ke terbangun (§6.1) | Resolusi 10 m |
| BPS (proyeksi penduduk, luas panen per kecamatan) | Pelanggan (§6.1), piutang ULP agraris (§6.4) | Tahunan |
| Kawasan industri (Kemenperin, OpenStreetMap, RTRW kabupaten) | Pelanggan dan daya besar (§6.1) | Perlu kurasi manual |

Data spasial di atas umumnya tahunan dan kasar: gunanya untuk perencanaan 1 sampai 3 tahun (RKM, kapasitas gardu), bukan prakiraan bulanan.

## 9. Tahapan

1. **Standar halaman (semua menu):** kartu status dengan target NKO dan laju yang dibutuhkan, diagnosis, peringkat ULP, sumbangan ULP, susunan tab standar. Backend menambah `target`, `diagnosis`, `contribution`; frontend menyusun ulang halaman.
2. **Uji coba 1, Keandalan:** anggaran SAIDI dan SAIFI, Pareto penyulang, penyulang gangguan berulang, skor risiko penyulang. Data cuaca BMKG menyusul.
3. **Uji coba 2, Piutang:** roll-rate per kelas umur dan kogol, prakiraan calon PRR, vintage pelunasan PRR.
4. **Uji coba 3, kWh Jual dan Pendapatan:** pemecahan volume, tarif, dan campuran; penanda Lebaran pada prakiraan.
5. **Menu lain** (RPT-RCT, anomali, P2TL, HPL BP) mengikuti pola yang sama.
6. **Data luar:** uji di satu ULP (bangunan dan tutupan lahan untuk pelanggan; BMKG untuk keandalan), lalu diputuskan dipakai luas atau tidak.

## 10. Keputusan terbuka

- Sumber saldo PRR dan Ex PRR (untuk tingkat pemulihan, §6.5).
- Sumber otomatis kWh beli, E-Min, PSSD (untuk susut, §6.10).
- Ambang warna kartu status: jarak ke target berapa persen yang dianggap waspada dan tertinggal.
- Definisi "gangguan berulang" penyulang (jumlah dan rentang hari).
- Urutan uji coba bila berbeda dari §9.

## Rujukan

- BMKG: [data cuaca terbuka](https://github.com/infoBMKG/data-cuaca), [ketentuan penggunaan](https://ppsdm.bmkg.go.id/term-of-use).
- Google: [Open Buildings Temporal V1 (Earth Engine)](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1?hl=en), [Open Buildings Temporal](https://sites.research.google/gr/open-buildings/temporal).
- Gangguan dan cuaca: [Doostan dan Chowdhury, IEEE Access 2020](https://doaj.org/article/1dd7b4f1cb094d5f80a4ecb07f31e064), [model risiko penyulang berbasis cuaca](https://par.nsf.gov/servlets/purl/10110827), [Iowa State, gangguan akibat angin dan hujan](https://wzy.ece.iastate.edu/CV/c237.pdf), [peringatan dini gangguan badai](https://arxiv.org/pdf/2508.12408v1).
- Piutang: [roll-rate piutang](https://www.atlantis-press.com/article/126028260.pdf), [McKinsey, piutang tak tertagih utilitas](https://www.mckinsey.com/no/our-insights/getting-a-grip-on-bad-debt-practical-steps-to-help-utilities-boost-their-resilience), [KPMG, analitik arus kas utilitas](https://kpmg.com/us/en/home/insights/2020/04/advanced-analytics-for-sustaining-cash-flow-and-customers.html).
- Konsumsi dan suhu: [ITB dan PLN, kenyamanan termal dan konsumsi rumah tangga Bandung](https://gcs.itb.ac.id/proceeding-igsc/index.php/igsc/article/download/656/305/4037), [CDD dan konsumsi listrik (JISI 2024)](https://doaj.org/article/1275a9792ed64b44837b6556a5b780ca), [LBNL, prakiraan permintaan Indonesia](https://escholarship.org/content/qt3973p55v/qt3973p55v.pdf?t=pq1rbm).
