# 11 — Forecasting and Machine Learning

## 1. Kondisi data saat ini

Data historis yang tersedia saat rancangan dibuat adalah **data permohonan**, belum tersedia histori realisasi pemakaian material yang lengkap.

Karena itu, strategi awal:
1. Forecast jumlah dan tipe pekerjaan/permohonan.
2. Konversi hasil forecast pekerjaan menjadi estimasi material menggunakan BOM.
3. Setelah data pemakaian aktual terkumpul dan kualitasnya memadai, evaluasi model demand material langsung.

Jangan melatih model material demand seolah-olah data permohonan adalah data konsumsi aktual.

## 2. Cakupan forecast

- Per ULP.
- Konsolidasi UP3.
- Horizon bulanan, triwulanan, semesteran, dan tahunan.
- Forecast berdasarkan tipe pekerjaan/permohonan.
- Forecast material berdasarkan BOM dan versi BOM yang dipilih.

## 3. Tahapan model

### Baseline
- Moving Average.
- Simple/Exponential Smoothing.
- Seasonal Naive bila pola musiman terlihat.

### Model lanjutan
- SARIMA/SARIMAX.
- XGBoost dengan fitur kalender, lag, rolling statistics, dan variabel relevan yang tersedia.
- Model lain hanya jika dibandingkan dengan baseline dan ada peningkatan terukur.

Data 24–36 bulan sangat membantu untuk mengenali pola musiman, tetapi bukan syarat mutlak untuk membuat baseline awal. Jika histori lebih pendek, tampilkan keterbatasan dan gunakan model sederhana.

## 4. Dataset

Minimal:
- periode;
- UP3;
- ULP;
- tipe permohonan/pekerjaan;
- jumlah permohonan aktual;
- status dan tanggal kejadian;
- fitur kalender;
- sumber data dan kualitas.

Hindari menghitung semua status sebagai permintaan yang sama. Definisi target harus ditetapkan: permohonan masuk, disetujui, menjadi pekerjaan, atau selesai.

## 5. Konversi pekerjaan ke material

`forecast_material_qty = Σ(forecast_work_qty × BOM_coefficient)` sesuai periode, konstruksi, material, dan versi BOM.

Perlu menangani:
- BOM basis per unit/per meter/per konfigurasi;
- faktor waste;
- pembulatan satuan pembelian;
- tipe pekerjaan yang tidak punya BOM lengkap;
- perubahan desain/standar;
- substitusi material yang diizinkan.

Hasil harus diberi label estimasi, bukan konsumsi aktual.

## 6. Evaluasi

Gunakan time-based split/backtesting, bukan random split biasa untuk deret waktu.

Metrik:
- MAE;
- RMSE;
- WAPE;
- MAPE hanya jika nilai aktual tidak nol/aman untuk rasio;
- bias forecast (over/under forecast).

Evaluasi per ULP, tipe pekerjaan, dan agregat UP3 jika jumlah data memadai.

## 7. Skenario dan ketidakpastian

Sediakan:
- baseline;
- konservatif;
- moderat;
- optimistis.

Bobot pipeline hanya dipakai bila probabilitas konversi memiliki bukti historis. Jika belum, skenario ditetapkan secara eksplisit oleh planner dan disimpan sebagai asumsi.

## 8. Output forecast

Setiap forecast run menyimpan:
- model dan versi;
- training window;
- tanggal run;
- scope;
- horizon;
- data cutoff;
- versi BOM;
- asumsi;
- prediksi point estimate dan rentang bila tersedia;
- metrik evaluasi;
- status review.

Forecast hanya memberi rekomendasi. Planner/pejabat tetap memvalidasi dan memutuskan RKM.

## Addendum keputusan forecasting final

Histori yang tersedia saat ini adalah histori permohonan/aplikasi, bukan histori aktual pemakaian material terstruktur. Tahap pertama memprediksi volume dan jenis pekerjaan per ULP serta konsolidasi UP3, kemudian mengonversi pekerjaan menjadi kebutuhan material menggunakan BOM yang berlaku. Jangan melatih atau menyebut model tahap pertama sebagai prediksi konsumsi material aktual. Baseline moving average/exponential smoothing; model SARIMA/XGBoost dapat dibandingkan bila jumlah dan kualitas data mencukupi. Simpan dataset window, horizon, model/version, parameter, metrik evaluasi, waktu dan status setiap run. Forecast adalah rekomendasi, bukan keputusan pengadaan.

## Addendum 14 Nov 2026 — beban gardu dan deep learning saja (keputusan pemilik)
- **Cakupan:** forecast tidak hanya material/pekerjaan, tetapi juga **beban gardu (trafo)**. **Hanya deep learning** (PyTorch) yang dipakai; tidak ada SARIMA/XGBoost/statistik sebagai alat prakiraan. "Pembacaan terakhir dibawa maju" hanya dipakai sebagai **tolok ukur evaluasi** (agar terlihat apakah jaringan saraf menambah nilai), bukan sebagai prakiraan.
- **Data nyata (distriva_db):** 48.852 pembacaan dari 5.902 gardu sejak 2022, tetapi hanya ±10 pembacaan per gardu (kebanyakan pembacaan tahunan). Karena deret per gardu terlalu pendek, dipakai **satu model bersama** untuk semua gardu. Permohonan baru berusia ±6 bulan (lonjakan impor awal EIS) sehingga **tidak cukup** untuk deep learning murni; kebutuhan pekerjaan/material diturunkan dari forecast beban gardu (tahap berikutnya, lihat bawah).
- **Model (`tools/forecast`, Python 3.14 + PyTorch CPU):** GRU atas ≤ 5 pembacaan terakhir + fitur statis (kapasitas, jumlah trafo, jumlah pelanggan dan daya tersambung dari DIL aktif, kemiringan beban, embedding ULP) + horizon; keluaran kuantil p10/p50/p90 (loss pinball, kuantil tidak pernah bersilang), ansambel 3 benih, rentang dikalibrasi agar mencakup 80 % hasil validasi. **Target** = beban kVA ÷ kapasitas trafo pada pembacaan terakhir (tahan terhadap penggantian trafo). Pembagian waktu: latih = target sebelum 1 Jul 2024, validasi s.d. 30 Jun 2025, uji sesudahnya; model produksi dilatih ulang pada semua data dengan jumlah epoch hasil validasi.
- **Hasil uji pertama (10 Nov 2026, 76.746 pasangan uji):** selisih rata-rata (MAE) **11,9 poin persen kapasitas**, WAPE 22,3 %, bias +1,2 poin; **hanya 7,4 % lebih baik** daripada pembacaan terakhir (3,9 % pada horizon < 1 tahun, 10,2 % pada 3–6 tahun); rentang p10–p90 mencakup 76,4 % hasil nyata (sasaran 80 %); gardu yang kemudian overload terdeteksi **47,6 %** dengan nilai tengah dan **79 %** dengan batas atas (p90). Kesimpulan: pembacaan gardu berisik (satu hari pengukuran), jadi prakiraan per gardu **indikatif**; paling berguna untuk menyaring gardu yang perlu disurvei, bukan sebagai keputusan. Tolok ukur ini ditampilkan apa adanya di halaman Forecast.
- **Hasil dan alur:** `php artisan distriva:forecast-execute` (dijalankan dari tombol "Jalankan forecast") mengekspor pembacaan ke CSV (tanpa nama/alamat), memanggil layanan Python, dan menyimpan hasil di `forecast_runs` (model, jendela data, parameter, metrik, asumsi, status telaah DRAFT/REVIEWED) dan `forecast_gardu_results` (beban p10/p50/p90 pada 1, 3, 5 tahun, perkiraan tanggal melewati 80 % dan 100 %). Telaah oleh orang lain daripada penjalan. Kunci izin baru (kelompok `planning`): `forecast.view`, `forecast.run` (PERENCANAAN, ENGINEERING, SYS_ADMIN), `forecast.review` (ASMAN_PERENCANAAN, UP3_MANAGER, SYS_ADMIN). Halaman `/forecast`.
- **Belum dibangun (butuh keputusan pemilik):** konversi gardu berisiko menjadi **pekerjaan** (sisip trafo / ganti trafo / tambah JTR) dan **material** lewat BOM. Perlu ditetapkan: jenis konstruksi mana untuk tiap pekerjaan, ambang yang memicu pekerjaan (mis. p50 ≥ 100 % dalam 3 tahun), dan kapasitas trafo pengganti.

## Addendum 14 Nov 2026 (2) — pelanggan baru, VA, dan material (keputusan pemilik)
- **Cakupan tambahan:** selain beban gardu, forecast mencakup **pertumbuhan pelanggan**, **VA** (tambahan daya tersambung), dan **kebutuhan material**, tetap **deep learning saja**. Material diramalkan dari **pemakaian aktual MIMS per material** (langsung) dan, bila ada pemetaan dari pemilik, juga diturunkan dari pelanggan/VA/gardu berisiko lewat BOM ("keduanya").
- **Model bulanan (`tools/forecast/distriva_forecast/monthly.py`):** satu GRU kuantil bersama untuk semua deret (pelanggan baru per ULP, kVA baru per ULP, pemakaian per ULP × material); tiap deret diskalakan menurut tingkatnya sendiri sehingga material kecil dan ULP besar belajar bersama; 12 bulan riwayat → 12 bulan prakiraan p10/p50/p90 (loss pinball, masking bulan yang belum ada); ansambel 3 benih; pembagian waktu: uji = 6 bulan terakhir, validasi = 6 bulan sebelumnya. Tolok ukur evaluasi: rata-rata 12 bulan terakhir (bukan prakiraan).
- **Definisi data (O-022):** pelanggan baru = permohonan **PB** per bulan permohonan (tidak termasuk batal, restitusi, draf); VA = jumlah kenaikan daya (`delta_power_kva` positif, PB+PD); material = pengeluaran MIMS, satu reservasi dihitung sekali pada bulan dokumen pertamanya. **Hanya bulan penuh** (bulan berjalan dibuang). Pelanggan/VA hanya mencakup **permohonan yang tercatat di DISTRIVA** (cakupan impor EIS), bukan seluruh 1,4 juta pelanggan DIL; DIL hanya satu potret (Mar 2026; ULP 51453 juga Okt 2022) sehingga belum menjadi deret waktu.
- **Penjaga kecukupan data:** deret diprakirakan hanya bila ≥ 24 bulan riwayat dan ≥ 6 bulan beraktivitas, dan perlu ≥ 150 jendela latih. Bila tidak, run berakhir **INSUFFICIENT** dengan cakupan data (bulan, jumlah deret, yang memenuhi) dan pesan, tanpa angka. **Keadaan nyata (14 Nov 2026):** pelanggan/VA 6 bulan (sejak Mei 2026), material 10 bulan (sejak Jan 2026), 0 dari 154 deret memenuhi syarat → belum ada prakiraan. Yang perlu ditarik pengguna: EIS dengan `lookback_days` jauh lebih panjang (kini 180), pengeluaran MIMS bertahap per ≤ 366 hari, dan DIL bulanan lama bila ada.
- **Alur:** tombol "Jalankan forecast" di tab Pelanggan & daya / Material (jenis run `DEMAND`; satu run per jenis pada satu waktu); tabel `forecast_series_results` (12 bulan p10/p50/p90 + jumlah 3/6/12 bulan; rentang jumlah = jumlah rentang bulanan, sengaja lebar). Halaman `/forecast` kini bertab: Beban gardu · Pelanggan & daya (VA) · Material.
- **Belum dibangun (butuh keputusan pemilik):** material **turunan** (pelanggan baru → SR/APP per pelanggan; VA/gardu berisiko → trafo/JTR) lewat BOM: perlu pemetaan jenis konstruksi per pekerjaan, ambang pemicu pekerjaan dari gardu, dan kapasitas trafo pengganti.

