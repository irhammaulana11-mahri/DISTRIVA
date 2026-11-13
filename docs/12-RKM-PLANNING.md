# 12 — RKM Planning

## 1. Tujuan

Menghasilkan rencana kebutuhan material dan pekerjaan untuk mendukung perencanaan UP3, dengan masukan dari ULP, histori permohonan, pipeline, forecast, dan kondisi stok.

## 2. Siklus perencanaan

- Bulanan.
- Triwulanan.
- Semesteran.
- Tahunan.

Periode dapat diperluas untuk perencanaan jangka lebih panjang jika kebijakan menghendaki.

## 3. Alur kewenangan

1. ULP menyiapkan kebutuhan dan data pendukung.
2. Sistem menampilkan actual demand, pipeline, forecast, dan posisi stok.
3. ULP mengajukan usulan RKM.
4. Planner/Construction UP3 melakukan validasi dan konsolidasi.
5. ULP melakukan revisi jika diminta.
6. Pejabat UP3 berwenang menyetujui RKM.
7. RKM yang disetujui menjadi baseline.
8. Pengadaan/PO berjalan pada proses terpisah.

## 4. Komponen perhitungan kebutuhan

Pisahkan komponen berikut:
- kebutuhan pekerjaan yang sudah disetujui;
- pipeline yang belum menjadi pekerjaan;
- forecast permohonan baru;
- stok on-hand;
- reserved/allocation;
- incoming supply yang telah dikonfirmasi;
- safety stock;
- kebutuhan bersih.

Rumus konseptual:

`net_requirement = max(0, gross_demand + safety_stock - available_stock - confirmed_incoming)`

Definisi `gross_demand` harus menghindari double counting antara actual, pipeline, dan forecast. Alokasi yang sudah mengurangi `available_stock` tidak boleh dikurangkan kembali.

## 5. Konsolidasi UP3

- RKM ULP digabung ke level UP3.
- Sistem mendeteksi duplikasi kebutuhan dan material.
- Planner dapat mengubah usulan dengan alasan.
- Perubahan kuantitas tersimpan pada `rkm_adjustments`.
- Snapshot stok dan forecast saat persetujuan disimpan untuk audit.

## 6. Approval

- Approval RKM terpisah dari approval permohonan.
- Approval RKM terpisah dari PO/pengadaan.
- Pejabat UP3 yang berwenang menyetujui.
- Setelah disetujui, perubahan dibuat sebagai versi/amendment, bukan mengubah dokumen yang sudah disahkan.

## 7. Laporan

- RKM per ULP.
- Konsolidasi RKM UP3.
- Perbandingan usulan vs hasil validasi vs persetujuan.
- Kebutuhan kotor, stok tersedia, incoming, dan kebutuhan bersih.
- Perbandingan forecast vs aktual.
- Daftar material kritis dan potensi kekurangan.

## Addendum tata kelola RKM

RKM diusulkan ULP, divalidasi fungsi Perencanaan/Konstruksi UP3, lalu disetujui pejabat UP3 berwenang. Satu RKM mengonsolidasikan kebutuhan ULP pada UP3 dan periode/tahun terkait. RKM bukan Purchase Order; approval RKM tidak otomatis membuat PO atau memulai pengadaan. Forecast menjadi masukan/rekomendasi, bukan keputusan otomatis.

## Addendum actor dan separation of duties v3.7.0

- Final approver dipilih `UP3_MANAGER`.
- `PERENCANAAN` dan `KONSTRUKSI_UP3` wajib memvalidasi usulan versi yang sama (AND) dan harus merupakan user berbeda.
- Submitter tidak boleh menjadi final approver atas usulan/versinya sendiri.
- ULP tetap menjadi pihak pengusul, tetapi role katalog konkret yang dapat menyiapkan dan submit RKM belum ditetapkan.
- Revisi/amendment membuat versi baru dan memerlukan validasi ulang; RKM tetap terpisah dari procurement. Detail approval actor/permission candidate dan implementasi blocker ada di dokumen 34.
