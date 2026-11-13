# 73 — BASTP (Berita Acara Serah Terima Pekerjaan): usulan desain untuk dikoreksi pemilik
**Status:** DIJAWAB DAN DIBANGUN (7 Nov 2026) — lihat §6 dan docs/62 §36. Bagian 1–5 di bawah adalah usulan awal; **jawaban pemilik di §6 yang berlaku**. Dokumen sumber yang menyinggung: docs/39 (O-038 meter), docs/40 (O-039 WO), docs/44 OD-038-05; tidak ada dokumen desain BASTP.

## 1. Tujuan dan tempat dalam alur
BASTP mencatat **penyerahan pekerjaan yang sudah selesai** dari pelaksana (vendor atau tim internal) kepada PLN, sebagai bukti formal yang menutup tahap 7 dan menjadi **syarat penyelesaian permohonan** (docs/40 §3.3: verifikasi pemasangan meter wajib sebelum permohonan `COMPLETED`). Urutan: WO `COMPLETED` (semua tugas terverifikasi 100 %, tahap 7) → BASTP disusun → diverifikasi → ditandatangani → permohonan dapat `COMPLETED`.

## 2. Isi BASTP (dokumen keluaran, gaya 5D: JSON + XLSX/cetak)
1. Kop PLN (UID Jawa Timur, UP3, ULP); judul; nomor BASTP; tanggal; kota.
2. Referensi: nomor permohonan, nama pelanggan, IDPEL, alamat, nomor WO (versi), nomor SPK/kontrak vendor, run RAB dan nilai.
3. **Uraian pekerjaan**: tugas WO (kelompok pekerjaan), satuan, volume, progres akhir terverifikasi.
4. **Realisasi material**: material dari WO (rencana) dan **jumlah terpasang** yang dilaporkan, selisih (sisa dikembalikan ke gudang).
5. **Pemasangan meter** (bila ada): nomor seri/ID meter, tipe (prabayar/pascabayar menurut PAKET_SAR), waktu pasang, pembacaan awal, pemasang, foto bukti.
6. **Bukti** (subsistem dokumen privat yang sudah ada): foto, berkas tanda tangan; disimpan sebagai referensi versi + hash, bukan salinan.
7. **Para pihak**: Pihak Pertama (PLN) = pejabat ULP yang menerima; Pihak Kedua = wakil pelaksana (nama dan jabatan diketik; untuk vendor tertaut ke perusahaan); saksi opsional.
8. Pernyataan serah terima dan catatan temuan/sisa pekerjaan (punch list).

## 3. Usulan alur, aktor, dan status
| Langkah | Aktor (usulan) | Status |
|---|---|---|
| Menyusun BASTP dari WO yang selesai | `TEKNIK` ULP | `DRAFT` |
| Mengajukan | `TEKNIK` yang menyusun | `SUBMITTED` |
| Memeriksa dan menerima/mengembalikan | `MANAGER_ULP` (pengguna lain dari penyusun) | `ACCEPTED` / `RETURNED` (alasan wajib) |
| Mengunggah berkas BASTP bertanda tangan | `MANAGER_ULP` atau `TEKNIK` | `SIGNED` (final) |
| Penutupan permohonan | `NIAGA_RETAIL` meminta; sistem memeriksa BASTP `SIGNED` dan verifikasi meter | permohonan `COMPLETED` |
Perubahan setelah `SIGNED` = BASTP koreksi (versi baru dengan alasan), bukan sunting. Satu BASTP aktif per WO; WO versi lain (amandemen) menurunkan BASTP-nya sendiri.

## 4. Data (rencana tabel, belum dibuat)
`bastp` (WO, versi, nomor, status, penyusun, pengaju, penerima, tanggal), `bastp_materials` (KHS, rencana, terpasang), `bastp_meters` (seri, tipe, waktu, pembacaan, pemasang), `bastp_documents` (referensi dokumen privat), `bastp_parties` (peran pihak, nama, jabatan), `bastp_events` (riwayat tak-berubah). Aturan integritas seperti tahap sebelumnya: satu BASTP hidup per WO, `SIGNED` beku (trigger), penerima ≠ penyusun (CHECK).

## 5. Pertanyaan untuk pemilik (jawab "iya" atau koreksi)
1. Apakah BASTP dibuat **setelah** WO `COMPLETED` (usulan), atau BASTP justru menjadi syarat WO selesai?
2. Aktor: TEKNIK ULP menyusun, MANAGER_ULP menerima — sesuai? Perlu pejabat UP3 (mis. KONSTRUKSI_UP3 atau ASMAN_KONSTRUKSI) ikut menandatangani untuk pekerjaan konstruksi (JTM/JTR/gardu)?
3. Apakah **realisasi material terpasang** dicatat di BASTP (dan sisanya dikembalikan ke gudang), atau cukup progres pekerjaan?
4. **Bukti meter**: data minimum (nomor seri, tipe, pembacaan awal, foto) dan siapa pemasangnya (TEKNIK internal atau vendor)? Apakah satu permohonan dapat punya lebih dari satu meter?
5. Apakah BASTP **menutup permohonan** secara otomatis atau tetap `NIAGA_RETAIL` yang meminta status `COMPLETED`?
6. Nomor BASTP dan nomor SPK/kontrak vendor: format resmi (mis. `…/BASTP/ULP-JBG/2026`)? Sumber nomor kontrak vendor?
7. Apakah berkas BASTP bertanda tangan dicetak dari sistem dan **dipindai/diunggah**, atau ada tanda tangan elektronik?

## 6. Jawaban pemilik (7 Nov 2026) — yang berlaku
1. **BASTP menjadi syarat WO `COMPLETED`** (bukan sesudahnya). 2. Aktor: TEKNIK ULP menyusun, MANAGER_ULP menerima; **KONSTRUKSI_UP3 dan ASMAN_KONSTRUKSI ikut menandatangani**. 3. **Realisasi material terpasang = lampiran BASTP.** 4. Bukti meter: **ID pelanggan, nomor kWh meter, foto**; pemasang = **vendor pelaksana**; **satu permohonan boleh lebih dari satu kWh meter**. 5. **Vendor mengajukan BASTP dan ASMAN_KONSTRUKSI menutupnya** (penutupan menyelesaikan WO). 6. Nomor: **`nomor urut/BASTP/tanggal-bulan/kode unit/tahun`**, contoh `00001/BASTP/07-11/51543/2026`. 7. **Tanda tangan elektronik** saja.
**Penerapan:** docs/62 §36 (alur, tabel, aturan), docs/57 "BASTP", docs/75 dan prompt frontend.
