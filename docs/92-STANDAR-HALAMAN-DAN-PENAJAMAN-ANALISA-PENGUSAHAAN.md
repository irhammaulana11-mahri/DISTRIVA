# 92 — Standar Halaman dan Penajaman Analisa Pengusahaan (rancangan)

Status: **rancangan disetujui pemilik (25 Nov 2026). Tahap 1 sisi backend selesai (target NKO, sumbangan ULP, diagnosis; kontrak di docs/91 `targets`, `contribution`, `diagnosis`). Tahap 2 (uji coba keandalan) sisi backend selesai: `detail` pada menu SAIDI/SAIFI, ENS, dan Gangguan (Pareto penyulang, gangguan berulang, komposisi penyebab dan cuaca, skor risiko dengan uji mundur); prakiraan cuaca BMKG belum; konteks cuaca historis bulanan (`detail.weather`, §8.1) sudah. Tahap 3 (uji coba piutang) sisi backend selesai: `detail` pada menu umur tunggakan, piutang pascabayar, dan pelunasan PRR/Ex PRR (roll-rate pelanggan, prakiraan calon PRR dengan uji mundur, umur BLTH pelunasan); prakiraan berbasis rupiah ditolak karena kalah dari cara naif. Tahap 4 (uji coba kWh Jual dan Pendapatan) sisi backend selesai: `detail` pemecahan perubahan tahunan menurut golongan dengan catatan otomatis, dan `events[]` penanda Idul Fitri; faktor Lebaran dan hari ditolak karena tidak memperbaiki prakiraan. Tahap 5 (uji coba RPT-RCT) sisi backend selesai: `detail` pada menu RPT-RCT gangguan dan keluhan (perbandingan ULP pada volume sebanding, riwayat, hubungan volume dengan waktu tanggap; tanpa prakiraan). Tahap 6 (uji coba anomali) sisi backend selesai: `detail` pada menu anomali gangguan dan keluhan (konsentrasi per ULP dengan uji kejadian jarang, komposisi kanal; tanpa prakiraan). Tahap 7 (uji coba kWh P2TL) sisi backend selesai: `detail` pada menu kWh P2TL (corong penetapan-realisasi-belum, tingkat realisasi per ULP, perkiraan realisasi dari penetapan yang lolos uji mundur). Tahap 8 (uji coba HPL Biaya BP) sisi backend selesai: `detail` pada menu HPL BP (kasus standar lawan besar, lama bayar, antrean menurut umur, prakiraan dengan rentang yang lolos uji mundur). Tahap 9 (Susut) sisi backend selesai tanpa menunggu masukan kWh beli: kWh beli diestimasi dari susut kumulatif realisasi NKO dan kWh jual 309, diprakirakan satu bulan sesudah realisasi terakhir, dengan uji mundur. Peringatan dini BMKG (`detail.early_warning`, §8.2) dan proksi susut teknis per gardu (`detail.technical` pada Susut, §6.10) sisi backend selesai. Sisi frontend dan tahap berikutnya belum.** Dokumen ini menetapkan arah; kontrak API tiap tahap ditulis di docs/91 dan dicatat di README-REVISI saat tahap itu dikerjakan backend. Berlaku untuk semua menu di bawah label **Analisa & Tren Pengusahaan** (katalog metrik docs/91 §1).

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
- **Prakiraan:** model musiman yang ada dipertahankan (kesalahan uji mundur 4,9% lawan 6,2% cara naif). **Hasil uji (26 Nov 2026, 81 titik dari 28 origin):** normalisasi jumlah hari per bulan tidak memperbaiki kWh (4,91%) dan penambahan efek Lebaran malah memperburuk (5,18%); jadi keduanya tidak dipakai. Pendorong lain (prakiraan pelanggan dari §6.1, suhu BMKG) menunggu data. Studi pada wilayah PLN menunjukkan suhu berpengaruh pada konsumsi rumah tangga.

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
- **Prakiraan:** jumlah pelanggan per kelas umur bulan depan dari roll-rate (termasuk calon PRR). **Hasil uji (26 Nov 2026):** dasar pelanggan mengalahkan cara naif (kesalahan 29,7% lawan 49,8%, 9 bulan uji mundur pada UP3), sedangkan dasar rupiah kalah jauh (86% lawan 23%) karena segelintir pelanggan besar; jadi hanya jumlah pelanggan yang diprakirakan. Hipotesis yang perlu diuji: Lebaran dan musim panen memengaruhi pembayaran di ULP agraris.

### 6.5 Pelunasan PRR dan Ex PRR (`pelunasan-prr`, `pelunasan-ex-prr`)

- **Data DISTRIVA:** pelunasan per BLTH dan komponen (AP2T, docs/88). Saldo PRR belum ada di DISTRIVA; perlu sumber saldo (dicari bersama pemilik).
- **Analisa:** **vintage**: peluang pelunasan menurut umur BLTH (makin tua makin kecil); tingkat pemulihan = pelunasan dibanding saldo PRR (setelah saldo tersedia); pencapaian target NKO PRR dan Ex PRR.
- **Prakiraan:** saldo PRR per umur × kurva peluang pelunasan per umur; sampai saldo tersedia, prakiraan pola bulanan.

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
  - peringatan dini tiga hari dari prakiraan cuaca BMKG per kelurahan (API terbuka; BMKG hanya memberi tiga hari, bukan tujuh);
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
- **Hasil tahap 5 (backend):** analisa disediakan, prakiraan ditunda. Uji pada data nyata (10 ULP, 24 bulan, korelasi dalam-ULP): volume WO hampir tidak berhubungan dengan RPT (r 0,06) dan RCT (r -0,01) pada gangguan; pada keluhan 0,16 dan 0,24 (juga di bawah ambang 0,3). Jadi "posko kewalahan" tidak didukung data, dan memprakirakan RPT dari volume tidak akan mengalahkan cara naif. Perbedaan antar ULP (mis. RCT Jombang dan Ploso jauh di atas yang lain) lebih bermakna dan sudah ditampilkan sebagai jarak ke ULP tercepat pada volume sebanding.

### 6.8 Anomali Gangguan dan Keluhan (`anomali-gangguan`, `anomali-keluhan`)

- **Analisa:** laju berulang dan rating negatif per kanal; rating negatif tanpa marking (ukuran NKO) terhadap ambang; kaitan pengaduan berulang dengan penyulang yang sering gangguan, dan kaitan rating negatif dengan RCT yang lama.
- **Prakiraan:** mengikuti prakiraan volume pengaduan dan RPT-RCT; peringatan bila laju mendekati ambang NKO.
- **Hasil tahap 6 (backend):** kejadian anomali sangat jarang (2026 sampai November: gangguan 40 berulang dan 104 rating negatif dari 189.242 WO; keluhan 19 dan 130 dari 20.580 WO; per ULP per bulan hanya 0 sampai beberapa), sehingga analisa dibuat tahunan dengan uji kejadian jarang (Poisson) terhadap porsi WO. Jombang ditandai untuk rating negatif di kedua menu (gangguan 33 lawan harapan 16,3; keluhan 47 lawan 21,0), dan Jombang juga yang RCT-nya terpanjang (§6.7); Mojoagung dan Ploso (gangguan berulang) dan Ngoro (keluhan berulang) ditandai tetapi dengan kejadian 5 sampai 7. Kaitan yang diuji dan **ditolak**: korelasi dalam-ULP antara RCT dan persen rating negatif 0,02 (220 pengamatan), sehingga "rating negatif karena RCT lama" tidak didukung per bulan; kaitan pengaduan berulang dengan penyulang sering gangguan tidak dapat diuji karena kejadian berulang terlalu sedikit. Prakiraan tidak disediakan.

### 6.9 kWh P2TL (`kwh-p2tl`)

- **Data DISTRIVA:** TAGSUS realisasi, TAGSUS belum realisasi (potret), penetapan TS P2TL di kontrol 309.
- **Analisa:**
  - corong penetapan → realisasi → belum realisasi, dan tingkat realisasi;
  - umur penetapan yang belum terealisasi;
  - kaitan P2TL dengan susut per ULP (setelah susut tersedia).
- **Prakiraan:** penetapan dari pola bulanan dan target operasi; realisasi dari kurva penagihan penetapan menurut umurnya.
- **Hasil tahap 7 (backend):** realisasi bulan ≈ rasio kumulatif × penetapan bulan itu (rasio 2026 stabil 0,87 sampai 0,97, kumulatif 0,905). Uji mundur 7 bulan (Apr sampai Okt 2026): kesalahan model 3,6%, lawan 17,5% (rata-rata tiga bulan) dan 23,8% (naif); dipertahankan. Syarat: penetapan bulan itu sudah ada (setelah penutupan bulan), jadi dipakai untuk membaca capaian, bukan meramal bulan depan; riwayat penetapan yang sebanding baru 10 bulan (penetapan sebelum 2026 punya definisi lain dan dikeluarkan lewat batas rasio 0,5 sampai 1,5). Tingkat realisasi per ULP Jan sampai Okt 2026: Ploso 99,4%, Jombang 97,9%, Mojoagung 97,6% dan terendah Warujayeng 80,9%, Nganjuk 86,3%. Penetapan dikurangi realisasi (sekitar 190.000 kWh per bulan) jauh lebih besar dari "belum realisasi" (beberapa ribu kWh); selisih ini tidak tertutup oleh data yang ada dan dicatat di `notes[]`, perlu dijelaskan pemilik data (kemungkinan penetapan gugur atau terealisasi pada bulan lain). Kaitan dengan susut menunggu menu Susut.

### 6.10 Susut (`susut`)

- **Syarat:** masukan kWh beli, E-Min, PSSD per ULP per bulan (belum ada sumber otomatis; docs/91 §3a).
- **Analisa:**
  - rata-rata bergerak 12 bulan, karena susut bulanan berisik akibat waktu catat meter;
  - proksi **susut teknis** per gardu dari pengukuran gardu (beban lebih, beban tidak seimbang, tegangan jatuh);
  - **susut nonteknis** dikaitkan dengan P2TL;
  - ULP dan gardu dengan proksi terburuk sebagai daftar perhatian.
- **Prakiraan:** dari prakiraan kWh jual dan pola kWh beli.
- **Hasil tahap 9 (backend; keputusan pemilik 26 Nov 2026: kWh beli dibuat dari data susut yang ada):** satu-satunya data susut di sistem adalah realisasi susut kumulatif (%) Januari sampai September 2026 per ULP dan UP3 pada angka acuan workbook NKO (`kpi_reference_values`); tidak ada kWh beli, E-Min, atau PSSD. Dengan kWh jual 309 per ULP, kWh beli bersih (siap salur distribusi) per bulan diturunkan: beli kumulatif = jual kumulatif / (1 - susut kumulatif), beli bulan = selisihnya. Hasil turunan wajar: UP3 sekitar 460 sampai 540 GWh per bulan dengan susut bulanan 5,3 sampai 6,4%, per ULP 2,5 sampai 12,7%. Bulan setelah realisasi terakhir (Oktober) diprakirakan beli = jual / (1 - susut kumulatif terakhir): Oktober 554,8 GWh dengan susut 5,79% (gabungan ULP). Uji mundur 80 pengamatan ULP-bulan: kesalahan 0,62% (susut kumulatif bulan lalu), 0,61% (susut bulanan bulan lalu), lawan 5,33% bila kWh beli diprakirakan langsung dari beli bulan lalu; susut jauh lebih stabil daripada beli sehingga prakiraan lewat susut dipertahankan. **Batasan penting:** "kebenaran" uji mundur juga turunan, bukan meter, jadi yang terbukti hanya susut stabil; kecocokan dengan kWh beli sebenarnya bergantung pada kesamaan kWh jual 309 dengan kWh jual perhitungan susut resmi dan hanya dapat dipastikan setelah masukan kWh beli diisi. Satu bulan tak wajar ditandai otomatis: Ploso Mei 2026, kWh beli turunan 31,8 GWh (-32% dari median 46,9 GWh), kemungkinan 309 Mei Ploso tidak lengkap atau realisasi susut Mei dikoreksi. Perbandingan terhadap target (kumulatif Oktober, termasuk prakiraan): di atas target Warujayeng +1,81 poin, Mojoagung +0,96, Nganjuk +0,44, Mojosari +0,30; di bawah target Jombang, Kertosono, Mojokerto, Ploso. Proksi susut teknis per gardu dikerjakan pada tahap berikutnya (di bawah); kaitan susut nonteknis dengan P2TL belum dikerjakan.
- **Proksi susut teknis per gardu (26 Nov 2026, backend):** pengukuran gardu (OMT) hanya satu per gardu per tahun (sekitar 5.700 gardu tercatat 2026 dengan persen beban dan arus R, S, T; tegangan ujung hampir tidak ada sehingga tegangan jatuh tidak dihitung). Proksi: beban lebih (di atas 100%), beban tinggi (di atas 80%), ketidakseimbangan (rata-rata simpangan arus fasa terhadap rata-ratanya, ambang 25%), dan **indeks rugi tembaga relatif** = (beban/100)^2 x (1 + 3 x ketidakseimbangan^2), tanpa satuan. Uji terhadap susut kumulatif per ULP (10 ULP, Spearman): indeks 0,85 sampai 0,87, beban rata-rata berbobot kapasitas 0,81 sampai 0,84, beban lebih 0,59, ketidakseimbangan saja 0,38 sampai 0,48 (lemah). Jadi susut tinggi berkaitan dengan beban gardu tinggi, bukan terutama ketidakseimbangan; dengan 10 titik ini hanya petunjuk, dan susut juga memuat susut nonteknis yang tidak terlihat dari gardu. Pencilan data (beban sampai 457%, ketidakseimbangan 133% pada gardu satu fasa) ditandai `data_diragukan` dan dibatasi 200% dalam perhitungan. ULP dengan indeks tertinggi: Warujayeng 0,50, Nganjuk 0,46, Ngoro 0,43, Pacet 0,42. Ambang beban 80%, 100% dan ketidakseimbangan 25% disetujui pemilik (26 Nov 2026) sebagai ambang yang dipakai.

### 6.11 HPL Biaya BP (`hpl-bp`)

- **Analisa:** porsi PB lawan PD, biaya ditetapkan lawan lunas, lama dari penetapan sampai lunas.
- **Prakiraan:** dari antrean permohonan yang sudah ditetapkan tetapi belum lunas, dikali laju pelunasan historis.
- **Hasil tahap 8 (backend):** (1) Rp bulanan didominasi sekitar 50 kasus besar (biaya 20 juta atau lebih) per bulan, 40 sampai 80% dari Rp (mis. Februari 2026 satu permohonan 14,2 miliar); median biaya tetap sekitar 863 ribu. Jadi lonjakan Rp bukan perubahan kegiatan. (2) Pembayaran cepat: median 1 hari, p90 4 hari dari dibuat; hampir semua yang membayar melakukannya dalam 30 hari. (3) Antrean "disetujui belum lunas" hari ini 1.037 permohonan: 580 hidup (umur 30 hari atau kurang, Rp 2,23 miliar) dan 457 kedaluwarsa (Rp 0,95 miliar, hampir pasti tidak akan lunas); antrean hanya menjelaskan beberapa hari ke depan karena arus permohonan baru yang dibayar dalam hitungan hari yang menentukan bulan. Karena itu prakiraan bulanan bukan dari antrean. (4) Prakiraan bulan depan = bagian standar (rata-rata tiga bulan) + median kasus besar 12 bulan dengan rentang kuartil. Uji mundur 30 bulan: kesalahan model 22,2% lawan 33,6% (naif) dan 27,0% (rata-rata tiga bulan); dipertahankan, selalu dengan rentang. Kolom `submitted_at` tidak terisi; tanggal permohonan memakai `source_created_at`, dan `paid_at` bertipe tanggal.

## 7. Faktor umum untuk semua menu

- **Kalender Lebaran: penanda, bukan faktor model.** Bulan Idul Fitri tercatat sekitar 6% di bawah tren per hari (0,943 sampai 0,929), tetapi uji mundur 2022 sampai 2026 tidak menunjukkan faktor Lebaran memperbaiki prakiraan: kWh jual 4,88% menjadi 5,18% (lebih buruk), pendapatan 4,92% menjadi 4,64% (membaik tipis, tidak meyakinkan dengan hanya 3 sampai 4 kejadian Lebaran). Karena itu bulan Idul Fitri hanya ditandai pada grafik (`events[]` pada respons metrik) dan tidak masuk model.
- **Kejadian tercatat (`events`).** Penyesuaian tarif, kawasan perumahan atau industri baru, pemadaman besar, dan perubahan aturan dicatat dengan tanggal, unit, dan alasan. Prakiraan membacanya; grafik menandainya.
- **Peluang mencapai target.** Prakiraan kumulatif akhir tahun dibandingkan dengan target NKO: "peluang tercapai 70%", berdasarkan rentang p10 sampai p90.
- **Akurasi yang terlihat.** Setiap prakiraan menampilkan akurasi uji mundur dan perbandingan dengan metode naif. Model sekarang (pola musiman dan tren teredam, rentang dari uji mundur 1 sampai 3 bulan) tetap menjadi dasar.
- **Hierarki konsisten.** Jumlah prakiraan ULP disamakan dengan prakiraan UP3.

## 8. Data luar dan syaratnya

Semua sumber luar diuji dulu di satu ULP sebelum dipakai luas. Lisensi dan kewajiban atribusi dicatat di halaman yang memakainya.

| Sumber | Untuk | Catatan |
|---|---|---|
| BMKG prakiraan cuaca (API terbuka, per kelurahan, 3 hari per 3 jam) | Peringatan dini gangguan (§6.6) | Wajib atribusi; pengambilan otomatis lewat API resmi. Historis curah hujan dan petir perlu diminta ke BMKG |
| BMKG data suhu | kWh jual (§6.2) | Ketersediaan historis bulanan per stasiun perlu dicek |
| Google Open Buildings v3 (statis, titik bangunan, tanpa akun) | Ruang tumbuh pelanggan (§6.1) | **Diuji, tidak dipakai** (§8.3). CC-BY 4.0 dan ODbL |
| Google Open Buildings Temporal (Earth Engine) | Ruang tumbuh pelanggan (§6.1) | Belum diuji (butuh akun Earth Engine). Potret tahunan 2016 sampai 2023; deteksi antar-tahun tidak selalu stabil. Hanya ini yang mengukur pertumbuhan bangunan |
| Tutupan lahan (ESA WorldCover, Dynamic World) | Alih fungsi sawah ke terbangun (§6.1) | Resolusi 10 m |
| BPS (proyeksi penduduk, luas panen per kecamatan) | Pelanggan (§6.1), piutang ULP agraris (§6.4) | Tahunan |
| Kawasan industri (Kemenperin, OpenStreetMap, RTRW kabupaten) | Pelanggan dan daya besar (§6.1) | Perlu kurasi manual |

Data spasial di atas umumnya tahunan dan kasar: gunanya untuk perencanaan 1 sampai 3 tahun (RKM, kapasitas gardu), bukan prakiraan bulanan.

### 8.1 Hasil uji coba cuaca historis (26 Nov 2026)

Uji: curah hujan dan embusan angin harian ERA5 (Open-Meteo archive, 1 Jan 2022 sampai 24 Nov 2026) pada titik pusat gardu tiap ULP, dibandingkan dengan jumlah gangguan penyulang per ULP per hari (`outage_events`). Cakupan: 10 ULP, 17.890 ULP-hari, 5.135 gangguan (rata-rata 0,287 per ULP-hari).

| Kelas curah hujan harian | Gangguan per ULP-hari | Permanen per ULP-hari |
|---|---|---|
| < 0,5 mm | 0,230 | 0,045 |
| 0,5 sampai 5 mm | 0,265 | 0,071 |
| 5 sampai 20 mm | 0,345 | 0,083 |
| 20 sampai 50 mm | 0,382 | 0,098 |

Temuan:
- **Hujan berpengaruh nyata tetapi sedang.** Hari hujan 20 mm atau lebih rata-rata 1,66 kali hari kering; setelah musim dikendalikan (dibandingkan dalam bulan kalender yang sama) rasionya 1,1 sampai 2,1 kali dan arahnya sama di 9 bulan yang diuji. Hujan hari sebelumnya jauh lebih lemah.
- **Daya prediksi harian lemah**: AUC hari bergangguan 0,56 (hujan), 0,54 (hujan kemarin); 0,5 berarti acak. Pada tingkat bulanan, korelasi hujan dengan jumlah gangguan UP3 0,63, turun menjadi 0,26 setelah pola musiman dihapus.
- **Embusan angin ERA5 tidak berguna** (AUC 0,50; gangguan per hari datar di semua kelas). Resolusi sekitar 25 km tidak menangkap angin kencang lokal.
- Cuaca ERA5 sesuai catatan petugas: gangguan yang dicatat "hujan" rata-rata terjadi pada hari 14,9 mm, yang tidak dicatat hujan 5,7 mm; gangguan karena petir terjadi pada hari rata-rata 16,2 mm (semua hari 6,8 mm).

Keputusan:
1. Cuaca historis **tidak dipakai untuk prakiraan** jumlah gangguan (tidak lolos uji mundur seperti faktor Lebaran di §6.2, daya terlalu kecil).
2. (Selesai di backend, kontrak docs/91, butir README-REVISI 41) Dipakai sebagai **penjelasan**: pada bulan SAIDI/gangguan melonjak, tampilkan curah hujan bulanan dan jumlah hari hujan lebat (20 mm atau lebih) di samping, agar lonjakan bisa dibedakan dari penyebab non-cuaca. Tanpa mengubah angka metrik.
3. Dipakai sebagai **peringatan dini** hanya dari prakiraan BMKG 7 hari (hujan lebat di wilayah ULP), sebagai pengganda risiko penyulang yang sudah ada (§6.6), bukan prakiraan angka. Perlu diuji ulang bila data historis prakiraan terkumpul.
4. Lisensi: Open-Meteo archive gratis untuk non-komersial dengan atribusi; cukup untuk uji ini, penggunaan produksi perlu ditinjau ulang (langganan atau data BMKG). Data petir historis dan hujan stasiun perlu diminta ke BMKG dan bisa lebih tajam daripada ERA5.
5. Data bangunan (Open Buildings v3 statis) sudah diuji dan **tidak dipakai** (§8.3); versi temporal (Earth Engine) dan tutupan lahan (WorldCover, Dynamic World) belum diuji.

### 8.2 Peringatan dini BMKG (26 Nov 2026)

API publik BMKG (`api.bmkg.go.id/publik/prakiraan-cuaca?adm4=`) memberi prakiraan **tiga hari per tiga jam** per kelurahan/desa (bukan tujuh hari): suhu, curah hujan (`tp`, mm per tiga jam), kode cuaca, arah dan kecepatan angin. Dipetakan satu desa per ULP, dipilih yang terdekat dari titik pusat gardu ULP (jarak 0,4 sampai 3,3 km): Mojoagung 35.17.06.2007 (Gambiran), Mojokerto 35.76.03.1002 (Miji, Kota Mojokerto), Jombang 35.17.09.2007 (Kepatihan), Ngoro 35.17.03.2003 (Rejoagung, Ngoro, Jombang), Ploso 35.17.14.2008 (Jatibanjar), Mojosari 35.16.08.1006 (Sawahan), Pacet 35.16.03.2002 (Wiyu), Kertosono 35.18.08.2008 (Tembarak), Warujayeng 35.18.11.2002 (Sumberkepuh, Tanjunganom), Nganjuk 35.18.13.1001 (Jatirejo); disimpan di `config/distriva.php` (`weather.bmkg.locations`, kunci kode ULP). Data wilayah gardu tidak dipakai karena hanya ULP Jombang yang punya kelurahan (843 dari 6.293 gardu). Aturan tingkat: `waspada` bila hujan harian 20 mm atau lebih, hujan petir (kode 95 atau 97), atau hujan lebat (kode 63); `tinggi` bila 50 mm atau lebih atau hujan petir disertai 20 mm atau lebih. Hasil ditampilkan sebagai peringatan dan rasio historis gangguan (1,0; 1,15; 1,5; 1,66 menurut kelas hujan, dari uji ERA5 §8.1), **bukan prakiraan jumlah gangguan**. Dibuktikan pada API sungguhan 26 Nov 2026 (seluruh ULP normal, hujan harian 0 sampai 6,7 mm); tingkat peringatan belum diuji terhadap gangguan sesudah prakiraan karena riwayat prakiraan BMKG belum terkumpul. Penyulang prioritas diurut dari jumlah gangguan pada hari hujan lebat (ERA5) tiga tahun terakhir: riwayat, bukan jaminan. Atribusi BMKG wajib ditampilkan; cache satu jam per desa; kegagalan BMKG tidak merusak halaman.

### 8.3 Hasil uji coba data bangunan Open Buildings v3 (26 Nov 2026)

Pertanyaan: apakah "bangunan belum terlayani" (bangunan dekat gardu dikurangi pelanggan dasar gardu itu) memprediksi penambahan pelanggan per gardu? Data: titik bangunan Open Buildings v3 sel S2 `2e79` (11,4 juta baris, publik tanpa akun; 3,5 sampai 4,0 juta bangunan berkonfiden 0,70 atau lebih di wilayah gardu), 5.855 gardu PLN berkoordinat, pelanggan aktif per gardu (DIL September 2026, 1,42 juta), dan penambahan 2025 sampai 2026 = permohonan PB tersambung yang dihubungkan ke gardu lewat IDPEL (55.847 dari 68.485, 82%). Pelanggan dasar = pelanggan aktif dikurangi penambahan. Tiap bangunan ditetapkan ke gardu terdekat dalam radius tertentu.

| Prediktor penambahan per gardu (n 5.252) | Spearman | 10% gardu teratas menangkap (acak 9,9%) |
|---|---|---|
| Pelanggan dasar (ukuran gardu) | 0,84 | 27,8% |
| Bangunan dekat gardu | 0,57 | 19,6% sampai 20,2% |
| **Bangunan belum terlayani** | **-0,06 sampai -0,26** | **10,7% (radius 1 km), 7,4% (0,5 km, bangunan 30 m2 atau lebih)** |
| Bangunan per pelanggan | -0,60 | 0,5% |

Temuan:
- **Pada tingkat gardu data bangunan statis tidak menambah daya prediksi**: bangunan belum terlayani sama atau lebih buruk daripada acak, dan hasilnya sama pada radius 1 km dan 0,5 km serta setelah membuang bangunan kecil; bangunan per pelanggan justru berlawanan arah (gardu yang paling "tidak terlayani" paling sedikit bertambah). Penjelasan yang masuk akal: banyak bangunan bukan hunian (kandang, gudang, bangunan sawah; rata-rata 1,5 bangunan per pelanggan di seluruh wilayah, 1,2 setelah membuang yang kecil), dan pembagian ke gardu terdekat kasar.
- **Pada tingkat ULP dan kecamatan hubungannya tinggi (ULP 0,87; kecamatan 0,97) tetapi hanya mencerminkan ukuran wilayah**: pelanggan dasar saja memberi 0,88 dan 0,99, jadi tidak ada informasi tambahan.
- **Keputusan:** data bangunan statis tidak dipakai untuk prakiraan atau daftar "ruang tumbuh"; prediktor penambahan tetap ukuran pelanggan dasar dan antrean permohonan (§6.1). Yang belum teruji dan satu-satunya yang mengukur pertumbuhan: Open Buildings Temporal (perubahan jumlah bangunan 2019 ke 2023 per gardu dibandingkan penambahan 2025 sampai 2026), yang butuh akun Earth Engine; layak dicoba bila pemilik membuat akun. Tutupan lahan (WorldCover, Dynamic World) juga statis atau tahunan dan butuh pemrosesan raster; tidak diuji.
- **Catatan data (dikoreksi pemilik, 26 Nov 2026):** tanggal penyalaan sebenarnya ada di DIL (`TGLNYALA_PB`, terisi pada seluruh baris, mis. 103.853 dari 103.853 baris ULP Mojoagung Desember 2024) tetapi `customer_connections.energized_on` kosong untuk semua 1,45 juta pelanggan karena **galat baca**: `mdb-export` mengeluarkan tanggal bertipe tanggal-waktu Access dalam format `MM/DD/YY` (mis. `02/18/19`) kecuali diberi `-T`, sedangkan parser hanya mengenali ISO dan `DD/MM/YYYY`, sehingga semuanya menjadi kosong. Diperbaiki: pemanggilan `mdb-export` kini memakai `-T "%Y-%m-%d %H:%M:%S"` (layanan sinkron dan `tools/dil_sync`), dan kedua parser membaca `MM/DD/YY` (tahun 00 sampai 29 = 2000an, 30 sampai 99 = 1900an). **Perlu sinkron ulang DIL** (berkas bulan terakhir ada di kotak masuk DIL, bukan di komputer ini) agar `energized_on` terisi; setelah itu uji data bangunan dapat diulang dengan penambahan 2024 sampai 2026 dari tanggal penyalaan seluruh pelanggan (cakupan 100%, bukan 82% lewat permohonan PB). Uji di atas memakai permohonan PB yang dihubungkan ke gardu lewat IDPEL.
- **Uji ulang dengan tanggal nyala DIL (26 Nov 2026, setelah sinkron ulang DIL):** pelanggan dasar = pelanggan aktif bertanggal nyala sampai 31 Des 2023 (sejajar dengan potret bangunan 2023; 1.327.293) dan penambahan = bertanggal nyala 2024 sampai September 2026 (94.622), cakupan seluruh pelanggan. Hasilnya sama: per gardu (5.208 gardu) pelanggan dasar Spearman 0,87 dan 10% teratas menangkap 28,6% penambahan; bangunan 0,58 dan 19,8% sampai 20,2%; **bangunan belum terlayani -0,05 sampai -0,26 dan 10,7% (radius 1 km) atau 7,4% (0,5 km, bangunan 30 m2 atau lebih), tidak lebih baik daripada acak (10,0%)**; bangunan per pelanggan -0,63. ULP (10) 0,88 dan kecamatan (12) 0,97 untuk belum terlayani, tetapi pelanggan dasar saja 0,92 dan 0,99. Keputusan §8.3 tetap: data bangunan statis tidak dipakai.
- **Tanggal nyala dan tanggal peremajaan permohonan PB (26 Nov 2026):** setelah sinkron ulang `energized_on` terisi untuk 1.448.093 dari 1.448.097 pelanggan (438 bertanggal 1901-01-01, anggap tidak diketahui). Dibandingkan lewat IDPEL pada 166.808 permohonan PB, tanggal peremajaan (status `PEREMAJAAN` pada riwayat status eksternal) sama dengan tanggal nyala DIL pada 77% (selisih paling lama 3 hari pada 98,8%, 30 hari pada 99,96%, median 0). Jumlah per tahun hampir sama (2024: 37.193 lawan 37.642; 2025: 35.456 lawan 36.087) dan bulanan 2026 juga (Januari 2.905 lawan 2.921; September 3.666 lawan 3.673). PD tidak sebanding (tanggal nyala DIL adalah penyalaan awal pelanggan, bukan tanggal naik daya). Tanggal peremajaan PB lebih segar (sampai November) dan punya riwayat sejak 2022; tanggal nyala DIL mencakup riwayat lebih lama dan pelanggan tanpa permohonan. **Keputusan pemilik (26 Nov 2026): tanggal sambung PB dan tanggal naik daya PD disimpan pada `applications.completed_at`** dari tanggal pertama `PEREMAJAAN`: diisi otomatis saat impor EIS (hanya bila kosong; penutupan WO internal tidak ditimpa) dan dibackfill untuk data lama (PB 174.316 dan PD 141.659 terisi; seluruh permohonan berstatus tersambung di luar usulan kini bertanggal). **Pengecualian:** permohonan yang masuk usulan penambahan jaringan tidak diisi dari EIS, `completed_at`-nya mengikuti rancangan awal (saat BASTP ditutup); saat ini ada 4 permohonan dalam 3 usulan terbuka, dan satu PB tersambung di antaranya yang terlanjur terisi dikosongkan kembali. Dari PB yang terhubung ke DIL, hanya 68 dari sekitar 167 ribu berselisih lebih dari 30 hari dari tanggal nyala.

## 9. Tahapan

1. **Standar halaman (semua menu):** kartu status dengan target NKO dan laju yang dibutuhkan, diagnosis, peringkat ULP, sumbangan ULP, susunan tab standar. Backend menambah `target`, `diagnosis`, `contribution`; frontend menyusun ulang halaman.
2. **Uji coba 1, Keandalan:** anggaran SAIDI dan SAIFI, Pareto penyulang, penyulang gangguan berulang, skor risiko penyulang. Data cuaca BMKG menyusul.
3. **Uji coba 2, Piutang:** roll-rate per kelas umur dan kogol, prakiraan calon PRR, vintage pelunasan PRR.
4. **Uji coba 4, kWh Jual dan Pendapatan:** pemecahan perubahan menurut pelanggan, kWh per pelanggan, campuran golongan, volume, dan tarif; catatan otomatis efek dasar rendah dan pergeseran golongan; penanda Idul Fitri (selesai di backend, lihat docs/91 `detail`).
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
