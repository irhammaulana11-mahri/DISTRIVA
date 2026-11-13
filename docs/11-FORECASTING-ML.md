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
