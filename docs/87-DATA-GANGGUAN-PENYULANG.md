# 87. Data Gangguan Penyulang: sinkronisasi, analisis, dan prakiraan

Dua menu: **Master Data › Aset Jaringan & Pelanggan › Data Gangguan (Sinkron)** (`/master-data/gangguan-sinkron`) dan **Laporan & Monitoring › Analisis Gangguan** (`/analisis-gangguan`). Izin: `outages.view` (lihat) dan `outages.sync` (ubah pengaturan, sinkron, pemetaan). Jalankan `OutagePermissionSeeder` pada sistem yang sudah berjalan (atas persetujuan pemilik); `release.sh` memuatnya untuk instalasi baru.

## 1. Sumber dan sinkronisasi
- Sumber: Google Sheet gangguan penyulang dan recloser, dibaca sebagai CSV per tab (GID). Sheet harus dibagikan "siapa saja dengan tautan dapat melihat". Alamat sheet disimpan di tabel pengaturan, tidak pernah ditampilkan kembali, dicatat di log, atau disimpan di repositori.
- Sinkron harian otomatis (jam diatur, penjadwal berjalan tiap menit dan memulai satu proses per hari saat jatuh tempo) atau manual lewat tombol "Sinkron sekarang". Proses berjalan sendiri di latar belakang; halaman memantau hasilnya.
- Idempoten: kunci sumber = sha1(menit | GI | penyulang | jenis peralatan); baris yang sama tidak digandakan, baris berubah diperbarui (hash baris), baris yang hilang dari sheet ditandai hilang (`source_removed_at`) hanya bila hasil bacaan masuk akal (minimal 50% dari yang tersimpan).
- Baris tanpa tanggal, jam, atau penyulang ditolak dan dihitung di riwayat. Nilai error sheet (#REF!, #N/A) dibaca kosong.
- Penyulang dicocokkan dengan master lewat nama/kode ternormalisasi (GI membedakan nama kembar). Yang belum cocok muncul di tabel "belum terpetakan" dan dapat dipetakan manual; pemetaan dipakai ulang pada sinkron berikutnya.
- ULP peristiwa: dari kolom RAYON ("ULP " + rayon), atau ULP mayoritas penyulang.

## 2. Definisi analisis
- Pelanggan terdampak per gangguan = semua pelanggan aktif penyulang (batas atas, terutama untuk recloser), dari potret DIL terakhir (`customer_connections` AKTIF lewat gardu ke penyulang).
- SAIFI = Σ(pelanggan penyulang × jumlah gangguan) / pelanggan aktif cakupan. SAIDI = Σ(pelanggan × menit) / pelanggan cakupan. CAIDI = SAIDI / SAIFI.
- Hanya gangguan sepanjang minimal **ambang menit** (bawaan 5, 0–120) yang dihitung; opsi "hanya permanen". Ambang diatur di halaman sinkron dan berlaku untuk analisis.
- Jumlah gangguan dan ENS per ULP menurut RAYON; SAIFI/SAIDI ULP memakai semua gangguan pada penyulang yang melayani pelanggannya.
- ENS dibaca apa adanya dari sheet (kWh). KPI membandingkan 12 bulan lengkap terakhir dengan 12 bulan sebelumnya; bulan berjalan tidak dipakai. Perubahan tahunan hanya untuk tahun lengkap berurutan.
- Cakupan: peran ULP melihat ULP-nya, UP3 melihat ULP di bawahnya, SYS_ADMIN semua (termasuk peristiwa tanpa ULP bila tanpa filter unit).
- Tab "Penyulang & gardu": 40 penyulang teratas dengan tren, pelanggan, jumlah gardu, kontribusi SAIFI/SAIDI; rincian menampilkan tren bulanan, penyebab, gangguan terakhir, dan gardu di bawahnya dengan pembebanan pengukuran terakhir (jumlah gardu ≥ 80% dan ≥ 100%).

## 3. Prakiraan (statistik, dihitung saat diminta)
- Butuh minimal 24 bulan lengkap. Indeks musiman dari tahun lengkap, level dari 12 bulan terakhir (tanpa musiman), tren teredam (φ = 0,9, maksimal 30% per 12 bulan).
- Backtest rolling-origin (horizon 1–3 bulan) menghasilkan rasio galat p10/p90 dan WAPE, dibandingkan dengan naif musiman (bulan sama tahun lalu); kualitas ditampilkan di halaman. Rentang 12 bulan menggabungkan galat bulanan secara kuadrat.
- Risiko penyulang: laju Poisson (0,65 × 12 bulan terakhir + 0,35 × 12 bulan sebelumnya): KRITIS ≥ 24, TINGGI ≥ 12, WASPADA ≥ 6, selain itu AMAN.

## 4. Operasional
- Perintah: `distriva:outage-sync-execute` (satu proses), `distriva:outage-sync-scheduled` (dipanggil penjadwal tiap menit).
- Sesi yang tidak pernah selesai (proses mati atau tidak pernah mulai) tidak mengunci tombol: bila berstatus Menunggu atau Berjalan lebih dari 13 menit, sesi ditandai Gagal ("Dihentikan: proses tidak selesai.") saat status dibaca atau sesi baru dimulai. Bila proses terpisah tidak dapat dimulai sama sekali, sesi langsung ditandai Gagal dengan alasannya ("Proses sinkronisasi tidak dapat dimulai: ...") dan galatnya dikembalikan ke pemanggil. Aturan yang sama berlaku untuk sinkron EIS (permohonan dan piutang; batas `DISTRIVA_EIS_SYNC_TIMEOUT` + 10 menit).
- Jika sheet tidak dapat dibaca (mis. tidak lagi dibagikan publik), riwayat mencatat pesan galat tanpa membocorkan alamat; data lama tidak berubah.
- Tes: `OutageSyncTest`, `OutageAnalysisTest` (backend), `Outage.test.jsx` (frontend).
