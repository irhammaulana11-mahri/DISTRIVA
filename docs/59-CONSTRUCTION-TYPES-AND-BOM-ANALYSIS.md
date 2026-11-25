# 59 — Analisis Jenis Konstruksi dan BOM (iterasi 2B-2 / 2C) — baca-saja

**Tanggal:** 6 November 2026 · **Sumber:** `MASTER RAB & KKF.xlsx` (35 sheet; dibaca dengan pustaka standar, nilai cache + teks rumus; **tidak ada rumus/makro dieksekusi**) dan [`ANALISA_RAB_KKF.md`](./ANALISA_RAB_KKF.md) · **Status:** analisis; **tidak ada kode produksi, tabel, atau data yang diubah.** Alat: `tools/analysis/wb.py`, `tools/analysis/xl_eval.py` (hanya analisis).

## 1. Apa itu "jenis konstruksi" di data
- Sheet `GAMBAR` memuat **147 entri berlabel** (kolom label `T`/`W`/`Z`, jumlah Psg/Bkr di kolom sebelahnya) dalam 9 kelompok pekerjaan: SUTM 48, MVTIC 29, SUTR 18, SKTM 2, Kubikel 2, GTT Umum 18, GTT Khusus 15, Estetika 9, PBPD 6. Contoh label: `A3C 150`, `Tibet 11 / 200`, `TM 1`, `Trf. 100 kVA`, `Kubikel 1 Inc`, `SKTM (NA2XSEYBY 3X150)`.
- **Tidak ada kode** untuk jenis konstruksi — hanya label teks. Label yang sama muncul di kelompok berbeda (`Tibet 13 / 350`, `TM 1` ada di GTT Umum **dan** GTT Khusus) dan masing-masing punya BOM sendiri → identitas = **(kelompok, label)**, bukan label saja.
- Setiap kelompok punya satu sheet BOM (SUTM, MVTIC, SKTM, KUBIKEL, GTT KHUSUS, GTT UMUM, SUTR, `6,6-41,5 KVA`, `53-197 KVA`); sheet SKTR, SKSR, GD PSG DLM diberi warna merah dan menurut analisis awal tidak dirujuk REKAP (warisan; `GD PSG DLM` penuh `#N/A`).

## 2. Bentuk BOM yang sebenarnya
Setiap baris sheet BOM = satu **kode KHS** (kolom B) dengan volume pada kolom `H` (material) `I` (pasang) `J` (bongkar) `K` (retur) yang berupa **rumus**, bukan koefisien tertulis:
`TRUNC((GAMBAR!U6*1.02*3)/1)*1` · `+GAMBAR!U48` · `TRUNC((I11*1.01)/1)*1` (turunan dari baris lain) · `TRUNC(((I14+I12)/1000)/1)*1` · `IF(OR(…),…)` · `SUMIF(…)`.
Artinya BOM adalah **graf rumus** (baris dapat bergantung pada baris lain), bukan tabel sederhana "konstruksi × koefisien" seperti yang diasumsikan di [`ANALISA_RAB_KKF.md`](./ANALISA_RAB_KKF.md) §3.2 dan `docs/23` §2.7 (`bom_items.quantity`). Tabel `bom_formula_definitions` (AST terstruktur, tanpa `eval`) di docs/23 memang dirancang untuk ini.

## 3. Bukti terukur
| Pengukuran | Hasil |
|---|---|
| Baris BOM (kode KHS numerik di kolom B) pada 9 sheet | **1.523** baris |
| Baris yang dapat ditelusuri ke ≥1 jenis konstruksi lewat rumus (transitif, via sel `GAMBAR`) | 1.410 (≈93%) |
| Bergantung pada **tepat satu** konstruksi / **beberapa** / **tidak ada** (butir tetap: K3L, commissioning, asuransi, dll.) | ≈1.320 / ≈98 / ≈105 |
| Jumlah konstruksi yang tercapai per sheet vs label di GAMBAR | SUTM 46/48, MVTIC 28/29, GTT Umum 18/18, GTT Khusus 15/15, SUTR 18/18, SKTM 2/2, Kubikel 2/2, PBPD 6 |
| Fungsi pada rumus volume (H–K) | `IF`, `OR`, `SUMIF`, `TRUNC`, `SUM`, `ROUNDUP`, `ROUND` + `+ − × ÷ ( )` dan perbandingan |
| **Reproduksi nilai cache oleh evaluator terkontrol (parser sendiri, tanpa `eval`)** | **5.891 dari 5.900 rumus cocok (99,85%)**: SUTM 2.258/2.258, MVTIC 1.688/1.688, GTT Umum 704/704, GTT Khusus 595/595, SUTR 443/443, SKTM 84/84, Kubikel 66/66, `6,6-41,5 KVA` 48/48, `53-197 KVA` 5/14 |
| Kode KHS yang dipakai sheet BOM | 211 dari 518; **0** kode yang tidak ada di katalog KHS; 307 kode KHS tidak dipakai sheet BOM mana pun |

**Batasan bukti (jujur):** (a) reproduksi hanya untuk **satu skenario** (nilai input contoh yang tersimpan di `GAMBAR`); itu membuktikan semantik rumus tercakup, bukan semua kombinasi input; (b) 9 selisih di sheet `53-197 KVA` (mis. `H11 = +I11` dihitung 1, tersimpan 0) berkaitan dengan percabangan `IF` atas pilihan dropdown PBPD — penyebabnya belum diselidiki (kemungkinan perbandingan teks/pilihan atau nilai tersimpan basi); (c) rumus bersama (`shared`) diperluas dengan menggeser referensi relatif — cocok pada 5.891 kasus, tetapi bukan pengurai Excel penuh; (d) kolom harga (L–R), blok K3L/asuransi/commissioning, dan sheet REKAP belum dianalisis; (e) sheet `SR 1 PHASE (2022)` tidak memiliki baris berkode numerik di kolom B (struktur berbeda) dan belum dianalisis.

## 4. Konsekuensi untuk desain
1. **2B-2 (jenis konstruksi)** dapat dikerjakan dengan aman: 147 entri berlabel, dengan asal data yang dapat ditelusuri (sheet, sel `GAMBAR`). Pemetaan konstruksi → KHS **dapat diturunkan dari rumus** (bukan diketik ulang) dan harus disajikan sebagai usulan yang diverifikasi manusia, termasuk 98 baris agregat (beberapa konstruksi) dan 105 butir tetap.
2. **2C (BOM)** layak: evaluator dengan tata bahasa kecil terbukti mereproduksi 99,85% rumus. Rekomendasi: simpan rumus sebagai AST JSON berversi, evaluator PHP deterministik (tanpa `eval`), dan **uji emas** dari workbook (kasus: input tersimpan → hasil tersimpan) sebagai syarat selesai — sesuai doc 16 ("rumus Excel direkonstruksi dan diuji terhadap contoh tervalidasi").
3. Satuan kuantitas BOM mengikuti satuan KHS (`unit_text`), yang belum dinormalisasi.

## 5. Keputusan pemilik (diperbarui 6 Nov 2026, setelah jawaban pemilik)
| ID | Status | Catatan |
|---|---|---|
| K-1 kode jenis konstruksi | **DIPUTUSKAN (pemilik):** jenis konstruksi **tidak punya kode resmi**; kode **material** memakai kode ERP. | DISTRIVA membuat kode internal `<KELOMPOK>-<NN>` (mis. `SUTM-05`); kolom `external_code` dicadangkan bila kelak ada kode resmi. Identitas alami tetap (kelompok, label). |
| K-2 cakupan | **DIPUTUSKAN (final, jawaban kedua):** hanya 7 kelompok — SUTM, MVTIC, SUTR, SKTM, KUBIKEL, GTT_UMUM, GTT_KHUSUS. **SKTR, SKSR, GD PSG DLM TIDAK dipakai untuk saat ini** (menggantikan jawaban pertama); PBPD iterasi terpisah. | Ketiga sheet rusak dan memakai kode lama tanpa padanan (§7); dikecualikan dari ekstraksi. Dapat dibuka lagi bila tabel padanan resmi tersedia. |
| K-3 pembulatan | **DIPUTUSKAN (pemilik):** pertahankan perilaku workbook (`TRUNC` per baris, REKAP bulat ke atas per baris); satu aturan target ditetapkan bersama keputusan RAB (O-041). | |
| K-4 tanggal berlaku KHS | **DIPUTUSKAN (pemilik):** mengikuti tanggal yang ditetapkan admin/engineer saat impor (`--valid-from`). | Tanggal adalah masukan manusia pada saat impor; bukan nilai bawaan sistem. |

## 7. Temuan tambahan: SKTR, SKSR, GD PSG DLM (dimasukkan ke cakupan oleh pemilik)
- **Rusak:** SKTR 284, SKSR 237, GD PSG DLM 575 sel berisi galat Excel (`#REF!`, `#N/A`). Rumus volume merujuk sel GAMBAR yang sudah tidak ada (`GAMBAR!#REF!*1.05`, `+GAMBAR!#REF!+GAMBAR!#REF!`): **hubungan konstruksi → baris BOM hilang dari rumus** dan tidak dapat ditelusuri otomatis. Uraian KHS semuanya `#N/A`.
- **Keluarga kode berbeda:** ketiganya memakai **71 kode bergaya lama** (`TM089`, `TR021`, `SR1PHS28`, `SR3PH026`, `CUB02`, `GTT008`, `VIP01`, …) di kolom B, **bukan** kode numerik 1–518 pada sheet KHS saat ini. Kode-kode itu **hanya** muncul di ketiga sheet ini (tidak ada di KHS, MDU, DPT, TERM, TIBET, maupun sheet BOM lain) dan **tidak ada tabel padanan** di workbook. Hanya satu kode numerik valid (`39`, Besi siku) yang tercampur di SKTR/SKSR.
- Sheet masih memuat jenis konstruksi yang jelas: blok *Estetika* di GAMBAR (`Z41:Z49`): Gardu Beton, SKTR (NYFGBY 4×70, 4×95), SKSR (NYFGBY 2×10, 4×6, 4×10, 4×16), MDP Cabang, MDP Pelayanan — 9 label.
- Konsekuensi: aturan docs/23 ("kode tidak ditemukan masuk review manual; jangan diganti kode mirip") berarti 70 dari 71 kode itu **tidak boleh** dipetakan tanpa tabel padanan resmi.
- **Dugaan yang perlu diverifikasi pemilik:** kode bergaya lama itu mungkin adalah kode resmi KHS/material pada aplikasi internal lain, sedangkan kode numerik 1–518 adalah penomoran internal workbook. Bila benar, **kode KHS yang akan diimpor ke `distriva_db` perlu dikaji ulang sekarang** (katalog 518 belum diimpor).

## 6. Rencana iterasi (setelah K-1 dan K-4 terjawab)
- **2B-2:** tabel `construction_types` (+versi) dan `construction_khs_mappings` (docs/23 §2.6) dengan kode/asal sesuai K-1; impor dari berkas CSV hasil alat ekstraksi (kelompok, label, sel GAMBAR, kode KHS, peran); draf → persetujuan `UP3_MANAGER` oleh orang lain (pola KHS); pemetaan agregat/tetap ditandai untuk ditinjau.
- **2C:** `bom_headers`/`bom_items`/`bom_formula_definitions` dengan AST; evaluator PHP; uji emas dari workbook (vektor dihasilkan alat analisis); penyelidikan 9 selisih PBPD.

## 8. Pembaruan 2C-1 (6 Nov 2026)
Mesin rumus produksi (PHP) mereproduksi **6.408 dari 6.408** rumus volume pada 9 sheet BOM, termasuk sel PBPD 53–197 kVA yang sebelumnya tidak cocok: penyebabnya sel kosong dibandingkan dengan `""` (Excel: sama). Lihat `docs/60`.
