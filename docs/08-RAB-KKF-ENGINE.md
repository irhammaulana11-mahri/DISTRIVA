# 08 — RAB & KKF Calculation Engine

## 1. Prinsip umum

RAB dan KKF merupakan dua mesin yang saling terhubung tetapi memiliki fungsi berbeda:
- RAB: menghitung material, jasa, biaya tambahan, PPN, dan total investasi.
- KAJIAN/KKF: menganalisis energi, pendapatan, biaya, arus kas, dan kelayakan investasi.

Setiap calculation run harus deterministik dan menyimpan snapshot.

## 2. Input utama

- Data pelanggan dan IDPEL.
- Jenis pengajuan: PB atau PD.
- Tarif/daya sebelum dan sesudah.
- Jenis perluasan.
- ULP dan UP3.
- Mode material: TUNAI atau PLN (perlu konfirmasi istilah dan dampak final).
- Jenis konstruksi.
- Kuantitas pasang dan bongkar.
- Versi gambar.
- Tarif, jam nyala, UJL, harga kontrak, BOM, zona, dan parameter KKF.

## 3. Keputusan bisnis yang telah dikonfirmasi

1. **Perubahan daya dihitung dari selisih**: `daya_hitung = daya_sesudah - daya_sebelum`. Untuk PB, daya_sebelum = 0. Contoh 16,5 kVA ke 33 kVA menghasilkan 16,5 kVA untuk perhitungan energi dan komponen yang menggunakan delta.
2. **Discount rate = RWACC**. NPV, kriteria IRR, dan kesimpulan kelayakan memakai RWACC yang sama.
3. **Zona jasa ditetapkan per UP3**, bukan per permohonan.
4. **KAJIAN** adalah analisis pemakaian kWh dan pendapatan, terpisah dari RAB.
5. **Satu sumber harga material**. MDU dan KHS diselaraskan; semua komponen membaca sumber harga material yang konsisten.
6. **Pembulatan satu kali pada total**. Hilangkan pembulatan per baris yang menyebabkan REKAP dan REKAP RINCI berbeda. Detail implementasi pembulatan harus disahkan.
7. Rp/kWh mengikuti master tarif yang ditetapkan; jam nyala mengikuti laporan penjualan bulanan 309.
8. Rasio BP ditampilkan sebagai kriteria ≥ 1 dan statusnya ditunjukkan. Secara default, rasio BP tidak menjadi syarat akhir LAYAK kecuali konfigurasi menyatakan sebaliknya.
9. Parameter WACC (ROE, bunga, pajak, dan lainnya) dapat diubah oleh admin berwenang; setiap run menyimpan snapshot.
10. Default LAYAK: `IRR > RWACC AND NPV > 0 AND (PBP < 5 tahun OR PBP = 5 tahun 0 bulan)`. Kriteria harus configurable dengan audit.
11. Tarif tetap dan adjustment memiliki periode berlaku.
12. Tarif Rp/kWh dan jam nyala memiliki sumber/siklus berbeda.
13. Sheet CONTROL bukan entitas bisnis; digantikan autentikasi, proses logging, dan export PDF.
14. Tarif dan UJL diimpor dari template yang divalidasi.
15. Jam nyala diimpor dari laporan penjualan format 309 tiap bulan.
16. Harga kontrak jasa/material diimpor per masa kontrak dan dibuat versi baru.
17. Untuk tarif berblok, analisis workbook menyebut penggunaan LWBP untuk TTL KKF; penerapan untuk golongan lain yang berblok perlu dikonfirmasi secara resmi.

## 4. Mesin RAB

Alur konseptual:
1. Baca gambar dan item konstruksi.
2. Ambil BOM versi yang berlaku.
3. Hitung volume material berdasarkan koefisien dan basis.
4. Ambil harga material dari satu sumber harga.
5. Ambil harga jasa pasang/bongkar menurut zona UP3.
6. Terapkan mode material PLN/TUNAI sesuai aturan.
7. Hitung commissioning, K3L, asuransi (analisis workbook menyebut 3‰), dan komponen lain.
8. Hitung PPN 11% sesuai ketentuan yang berlaku pada periode dan kebijakan yang disahkan.
9. Terapkan aturan pembulatan yang disepakati sekali pada total.
10. Simpan detail, ringkasan, dan snapshot.

**Catatan:** persentase PPN 11% adalah angka yang ditemukan pada workbook analisis; validasi terhadap ketentuan yang berlaku harus dilakukan sebelum produksi.

## 5. Mesin KKF/KAJIAN

Komponen yang teridentifikasi:
- faktor beban;
- susut distribusi;
- BPP/transfer price;
- harga jual rata-rata/tarif;
- jam nyala;
- O&M;
- investasi;
- BP, UJL, estetika/sharing;
- proyeksi energi, biaya, pendapatan, net benefit;
- NPV, IRR, B/C, PBP;
- RWACC/WACC.

Workbook contoh memproyeksikan 2026–2051 (25 tahun). Jadikan horizon sebagai parameter yang dapat dikonfigurasi, dengan default sesuai ketetapan proses.

### Perubahan daya
Untuk PD, energi dihitung menggunakan delta daya, bukan daya akhir penuh. Pastikan konsisten pada KAJIAN, UTANG, ARUS KAS, UJL/BP sesuai aturan bisnis yang telah diputuskan.

### NPV
Gunakan konvensi NPV standar: arus kas tahun ke-0 tidak didiskontokan; secara konseptual `NPV = CF0 + Σ(CFt / (1+r)^t)` untuk t ≥ 1.

### WACC
Simpan input dan hasil WACC/RWACC. Nilai contoh workbook (ROE 0,47%, bunga 7,78%, pajak 25%) adalah nilai awal dari file, bukan nilai universal; harus diverifikasi dan dapat diubah melalui versi parameter.

## 6. Master tarif dan jam nyala

Pisahkan:
- `tariff_details`: tarif Rp/kWh, jenis tetap/adjustment, golongan, batas daya, reguler/prabayar/LWBP/WBP/faktor dan periode berlaku.
- `monthly_sales_reports` dan `monthly_sales_rows`: jam nyala per ULP/periode dari file 309.

Aturan impor 309:
- Periode dan ULP dibaca dari metadata file.
- Kenali subtotal dan baris turunan agar tidak dihitung ganda.
- Parser angka Indonesia harus menangani titik ribuan dan koma desimal; jangan menggunakan `parseFloat` langsung.
- Lakukan validasi silang terhadap total kWh, jumlah rupiah, dan jam nyala.
- Simpan file sumber dan versi impor.

## 7. Output dokumen

Target keluaran:
- KKF
- HPE / Perbandingan BP-RAB
- REKAP
- REKAP RINCI
- Formulir 5 (UTANG)
- Formulir 7 (ARUS KAS)

Template final harus diperiksa dan disetujui pemilik proses sebelum PDF produksi.

## 8. Pengujian wajib

- PB dengan daya lama 0.
- PD dengan delta daya positif.
- Perubahan daya yang tidak valid (daya akhir <= daya awal) sesuai aturan.
- PLN vs TUNAI.
- Semua kelompok konstruksi dan kombinasi pasang/bongkar.
- Periode kontrak/tarif/BOM berbeda.
- NPV t0 tidak didiskonto.
- RWACC konsisten di NPV/IRR/kelayakan.
- Pembulatan total konsisten antara REKAP dan REKAP RINCI.
- Re-run dengan snapshot sama menghasilkan hasil sama.

## Addendum keputusan perhitungan final

- Discount Rate adalah master parameter configurable dengan nilai awal dari workbook. RWACC dihitung dan ditampilkan sebagai indikator, tetapi tidak otomatis menggantikan Discount Rate.
- Pembulatan hanya pada total akhir RAB; tidak ada pembulatan antara per baris/subtotal/komponen.
- Asuransi dan K3L menggunakan basis total RAB pekerjaan/material sebelum PPN; tarif configurable dan perlu verifikasi formal.
- O&M default 2% dari investasi RAB, configurable; horizon default 25 tahun, configurable.
- NPV menggunakan Discount Rate dan tidak mendiskontokan Year 0; IRR memakai seluruh arus kas Year 0–25; B/C = PV benefit/PV cost; PBP interpolasi bulan.
- Kriteria default LAYAK: IRR > Discount Rate AND NPV > 0 AND PBP <= 5 tahun. Rasio BP >= 1 ditampilkan tetapi tidak otomatis menjadi syarat final LAYAK pada logika workbook yang dianalisis.
- Output: KKF, HPE/Perbandingan BP-RAB, REKAP, REKAP RINCI. Formulir 5 dan 6 tidak diperlukan.
- Setiap kalkulasi menyimpan snapshot seluruh versi master, parameter, input dan hasil. Lihat dokumen 16 untuk detail.

## Catatan actor authorization v3.7.0

Role yang menjalankan kalkulasi RAB/KKF, melakukan review awal, serta keputusan apakah RAB memerlukan approval mandiri belum ditetapkan. Matriks approval KKF yang telah dipilih tidak berubah: normal PBP ≤5 tahun memakai `ASMAN_PERENCANAAN` AND `ASMAN_KONSTRUKSI`; PBP >5 tahun memakai empat approver pada matriks T3.6. Sesuai aturan SoD v3.7.0, semua approver pada langkah AND harus user berbeda dan submitter tidak final-approve versinya. Hubungan lifecycle studi feasibility terpisah dengan KKF juga belum final. Tidak ada permission key final. Lihat O-041 dan dokumen 34.
