# 09 — Approval, Drawing Revision, and Construction

## 1. Drawing lifecycle

- Satu permohonan dapat memiliki satu atau lebih drawing.
- Setiap perubahan file/gambar menghasilkan `drawing_versions` baru.
- Versi lama tetap tersedia sebagai histori dan tidak ditimpa.
- Calculation run mengacu ke versi gambar spesifik.
- Jika gambar direvisi setelah hitung, hasil hitung lama tetap terikat ke versi lama; run baru dibuat untuk versi baru.

## 2. Review

Reviewer konstruksi UP3 dapat:
- menyetujui gambar;
- meminta revisi dengan alasan terstruktur;
- memberi catatan teknis;
- meminta klarifikasi.

Semua keputusan disimpan di `approval_histories` dengan actor, timestamp, status, dan catatan.

## 3. Approval steps

Gunakan konfigurasi approval berdasarkan:
- jenis permohonan;
- nilai/kompleksitas pekerjaan;
- unit;
- aturan kewenangan yang berlaku.

Jangan menanam jabatan/nama pejabat ke kode aplikasi. Simpan konfigurasi role dan delegation.

## 4. Vendor dan work order

- Vendor dipilih sesuai prosedur/kontrak yang berlaku.
- `vendor_assignments` merekam vendor, dasar penugasan, tanggal, dan status.
- `work_orders` mengikat permohonan, gambar yang disetujui, vendor, dan ruang lingkup.
- `work_progress` mencatat tahapan, tanggal, bukti, dan catatan.
- `material_usages` mencatat pemakaian aktual per pekerjaan dan material.

## 5. Material aktual

Pemakaian material aktual wajib dicatat per work order untuk:
- rekonsiliasi rencana vs realisasi;
- evaluasi BOM;
- evaluasi forecast;
- histori konsumsi untuk model demand masa depan.

Data ini menjadi fondasi peningkatan forecasting material secara langsung pada fase berikutnya.

## Addendum review dan approval final T3.6/T3.13

- Manager ULP menyetujui paket gambar dan kebutuhan material sebelum masuk antrean UP3.
- Perencanaan dan Konstruksi UP3 memeriksa versi paket yang sama secara paralel; keduanya wajib approve. Jika salah satu meminta revisi, approval final terkunci dan kedua review kembali pending pada versi baru.
- Normal PBP <=5 tahun: ASMAN_PERENCANAAN dan ASMAN_KONSTRUKSI wajib approve; UP3_MANAGER bukan approver jalur normal.
- PBP >5 tahun: justifikasi tertulis ULP dan approval 4/4 ASMAN_PERENCANAAN, ASMAN_NIAGA, ASMAN_KONSTRUKSI, UP3_MANAGER. Dispensasi tidak mengubah NPV/IRR/PBP.
- Auto MTO adalah bantuan ekstraksi, bukan penetapan otomatis. Petugas teknis ULP memverifikasi seluruh item dan alasan koreksi wajib disimpan.


## Penegasan desain T4.2.4 v3.2
Approval Auto MTO (petugas teknis ULP memverifikasi, Manager ULP menyetujui snapshot) tidak menggantikan drawing approval. Drawing melalui Manager ULP sebagai gate submission, lalu review paralel Konstruksi UP3 dan Perencanaan UP3 atas versi yang sama. Jika salah satu meminta revisi, keduanya meninjau ulang versi terbaru; approval lama tetap histori. Persetujuan KKF normal/PBP>5 tetap mengikuti matriks T3.6.

## Catatan kewenangan konstruksi v3.7.0

Fungsi Pengawas Jaringan ditempatkan pada role `KONSTRUKSI_UP3`, tanpa menambah role baru. Role tersebut dapat memverifikasi progres dan melakukan inspeksi hanya untuk WO pada ULP anak dalam UP3 assignment-nya. Pengecualian mutation spesifik ini terpisah dari `UP3_DESCENDANT_READ`; tidak memberikan approval final atau akses mutation lain. Scope ini masih desain dan belum didukung model/Policy/query scope. Role pembuat, pemeriksa, dan penerbit WO tetap belum ditetapkan; approval vendor assignment tidak sama dengan approval/issue WO.

Aturan SoD v3.7.0 mewajibkan user berbeda untuk setiap approver pada langkah AND dan melarang submitter menjadi final approver versinya sendiri. Progress submitter (vendor maupun internal) juga harus berbeda user dari verifier. Setiap user dengan assignment efektif `KONSTRUKSI_UP3` pada UP3 terkait dapat melakukan verify/inspect seluruh WO child-ULP tanpa assignment tambahan per WO; akses tetap terbatas pada aksi tersebut.
