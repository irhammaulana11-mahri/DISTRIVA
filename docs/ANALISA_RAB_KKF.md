# Analisa MASTER RAB & KKF + MASTER TARIF & JAM NYALA

Dokumen ini adalah spesifikasi hasil bedah workbook, untuk dasar pembuatan versi web.
Sumber: `MASTER RAB & KKF.xlsx` (35 sheet, semua sudah dibuka) dan `MASTER TARIF & JAM NYALA.xlsx` (3 sheet).
Kasus contoh di file: pelanggan ANDREAS GUNAWAN, IDPEL 514531561929, perubahan daya B2 16,5 kVA → 33 kVA, ULP Jombang.

Semua angka "contoh" di bawah adalah hasil tersimpan (cached) di file, sudah saya cocokkan silang.

---

## 0. Keputusan bisnis (dikonfirmasi pemilik proses)

| # | Keputusan | Akibat untuk web |
|---|---|---|
| 1 | **Perubahan daya = selisih** (daya baru − daya lama). Energi tahunan dihitung dari selisih, bukan daya sesudah. | `kVA_hitung = daya_sesudah − daya_sebelum` (contoh 33 − 16,5 = 16,5 kVA). Untuk penyambungan baru, daya lama = 0. Dipakai di KAJIAN (`C16`), UTANG (`F19`), ARUS KAS, dan UJL/BP. File Excel sekarang memakai 33 kVA penuh (salah menurut keputusan ini). |
| 2 | **Discount rate = RWACC** (hasil blok WACC, contoh 4,25%). | Hapus 7,87% (`KAJIAN!Z45`) dan 7,78% (`KKF!H42`, `D67`). NPV, kriteria IRR, dan kesimpulan LAYAK semuanya memakai RWACC yang sama. |
| 3 | **Zona jasa ditentukan per UP3/cabang**, satu zona satu harga. | Zona jadi pengaturan master di tingkat UP3 (UP3 Mojokerto = Zona 2, sesuai file), bukan input per permohonan. |
| 4 | **KAJIAN** = analisa pemakaian kWh dan pendapatan dari pemakaian itu. | Di web diperlakukan sebagai modul "proyeksi pendapatan & kelayakan", terpisah dari modul RAB. |
| 5 | **Satu sumber harga material.** MDU dan KHS digabung menjadi satu tabel harga. | Hilangkan selisih MDU vs KHS (temuan `REKAP RINCI!U23` = −94.779). Material, asuransi 3‰ dan REKAP RINCI semuanya membaca tabel harga yang sama. |
| 6 | **Pembulatan hanya di total.** | Tidak ada `ROUNDUP(…,−2)` per baris; PPN 11% dan pembulatan dilakukan sekali pada total RAB. REKAP dan REKAP RINCI otomatis sama. |
| 7 | **Rp/kWh (TTL) dan jam nyala mengikuti MASTER TARIF apa adanya.** | Master tarif jadi satu-satunya sumber; tidak ada angka TTL/JN yang diketik di form. Selisih terhadap sheet `309` (B1 450/900, B3) dianggap koreksi data master, bukan logika web. |
| 8 | **Baris Rasio BP di KKF adalah kriteria** (kolom Kriteria `≥ 1`). | Dievaluasi seperti IRR/NPV/PBP: tampilkan status terpenuhi/tidak per baris. Kasus contoh: 0,29 → tidak terpenuhi. |
| 9 | **Parameter WACC dapat diubah** (ROE, bunga, pajak). | Nilai awal = nilai file (ROE 0,47%, bunga 7,78%, pajak 25%), disimpan di `param_kkf` dan bisa diedit admin; tiap hitungan menyimpan salinan parameter yang dipakai agar hasil lama bisa direproduksi. |
| 10 | **Kesimpulan LAYAK ditentukan banyak kriteria sekaligus** (rumus `KAJIAN!AH48`): `IRR > RWACC` **DAN** `NPV > 0` **DAN** (`PBP < 5 tahun` **ATAU** `PBP = 5 tahun 0 bulan`). | Daftar kriteria dibuat sebagai konfigurasi (bukan tertanam di kode) agar bisa ditambah. Rasio BP ditampilkan sebagai kriteria dengan status sendiri; masuk-tidaknya ke syarat LAYAK mengikuti konfigurasi (default: seperti rumus file, tidak ikut). |
| 11 | **Master tarif mencakup semua golongan, dengan tarif tetap dan tarif adjustment.** | `tarif_master` memakai kolom `jenis_tarif {tetap, adjustment}`, golongan R, S, B, I, P, T, C, L dan seterusnya. Periode berlaku mengikuti periode tarif (adjustment berubah berkala), dengan `berlaku_dari`/`berlaku_sampai`. Permohonan memakai tarif yang berlaku pada tanggal pengajuan. |
| 12 | **Rp/kWh dan jam nyala punya sumber dan siklus berbeda.** Rp/kWh mengikuti penetapan tarif (tetap, atau berubah saat ada penetapan baru). Jam nyala berubah tiap bulan mengikuti laporan penjualan. | Dua tabel terpisah: `tarif_rpkwh(golongan, daya, jenis_tarif, rp_per_kwh, berlaku_dari, berlaku_sampai)` dan `jam_nyala(golongan, daya, periode_bulan, jam_nyala, sumber_laporan)`. Permohonan mengambil Rp/kWh yang berlaku pada tanggal pengajuan dan jam nyala periode bulan terbaru (atau bulan yang dipilih). Catatan: di file sekarang kolom TTL dibuat dari laporan penjualan (`R/L`) lalu diketik; di web TTL tidak lagi diturunkan dari laporan. |
| 13 | **Sheet CONTROL adalah sheet bantu proses Google Apps Script** (status BUSY, email, waktu mulai, no agenda, nama; tombol simpan ke PDF). Bukan data bisnis. | Tidak dimigrasi sebagai entitas. Digantikan: autentikasi pengguna, tabel `proses_hitung(id, user, mulai, status, no_agenda)` untuk jejak/penguncian, dan ekspor PDF di server. `CONTROL!B4` (waktu mulai) hanya dipakai sebagai tanggal cetak. |
| 14 | **Data tarif (semua golongan dan daya, tetap/adjustment, riwayat Rp/kWh, UJL) diisi lewat upload**, bukan diketik di form. | Modul admin "Impor Tarif" (§10.1). Banyak daya per golongan, jadi file template memuat satu baris per (golongan, daya, jenis tarif). |
| 17 | **TTL = tarif yang ditetapkan, bukan hasil `309`.** Tarif adjustment berubah per triwulan (dokumen penetapan Direktur Utama); tarif lainnya tetap sampai pemerintah mengubahnya. Jam nyala tetap dari unggahan `309`. | Lihat §10.1 dan koreksi di §6.3. |
| 15 | **Jam nyala diisi dengan mengunggah file laporan penjualan format sheet `309`** tiap bulan. | Modul admin "Impor Laporan Penjualan" (§10.2). |
| 16 | **Harga kontrak (JASA, MDU, DPT, TIBET, TERM, KR MATERIAL) berlaku per masa kontrak, biasanya 2 tahun**, diisi lewat upload. | Harga disimpan per versi kontrak dengan `berlaku_dari`/`berlaku_sampai`; permohonan memakai versi yang berlaku pada tanggal pengajuan (§10.3). |

### Dampak angka pada kasus contoh (hitung ulang, input lain tidak berubah)

| Skenario | Energi/th | Net benefit/th | NPV (Rp juta) | IRR | PBP |
|---|---|---|---|---|---|
| File sekarang (33 kVA, 7,87%, NPV gaya Excel) | 46,332 MWh | 40,79 | 372,7 | 106,7% | 0 th 11 bln |
| 33 kVA, RWACC 4,25%, NPV standar | 46,332 MWh | 40,79 | 582,1 | 106,7% | 0 th 11 bln |
| **Selisih 16,5 kVA, RWACC 4,25%, NPV standar** | **23,166 MWh** | **19,85** | **263,7** | **51,9%** | **1 th 11 bln** |

Dengan keputusan di atas, kasus ini tetap LAYAK (IRR 51,9% > 4,25%, NPV positif, PBP 1,9 tahun < 5 tahun), tetapi angkanya jauh berbeda dari yang tercetak di file sekarang (IRR dan NPV turun, PBP naik dari 11 bulan menjadi 1 tahun 11 bulan).
Catatan: net benefit = pendapatan (1444,7 × kWh) − beli energi (BPP 540,98 × kWh) − O&M 2% × RAB; investasi RAB Rp54,173 juta, kas masuk t0 = BP Rp15,955 juta.

---

## 1. Gambaran besar

Satu permohonan PB/PD (penyambungan baru / perubahan daya) melewati dua mesin hitung:

```
                ┌────────────── MESIN 1: RAB ──────────────┐
 GAMBAR  ─►  sheet konstruksi  ─►  KHS (harga)  ─►  REKAP  ─► RAB (Rp 54.173.000)
 (input      (SUTM, GTT UMUM,      ▲ JASA/MDU/DPT/             │
 gambar)      SR-APP, dst.)        │ TERM/TIBET (kuning)      ▼
                                                         ISIAN KKF  ◄── input manual:
 MASTER TARIF & JN ──(salin manual)──►  D28, D29              │        BP, UJL, tarif/daya
                                                              ▼
                ┌────────────── MESIN 2: KKF ──────────────┐
                 KAJIAN (proyeksi 25 th, NPV/IRR/PBP/B-C)  ─► KKF (lembar cetak)
                 UTANG (Formulir 5) ─► ARUS KAS (Formulir 7)    PERBANDINGAN BP RAB
```

Output cetak: **KKF**, **PERBANDINGAN BP RAB (HPE)**, **REKAP** (RAB), plus formulir lampiran Edaran Direksi 0014.E/DIR/2020 (**UTANG** = Formulir 5, **ARUS KAS** = Formulir 7).

---

## 2. Inventaris 35 sheet

Warna tab: kuning = kelompok harga/kontrak (sesuai keterangan Anda), merah = tidak terhubung (usang), hijau = input gambar, biru muda = input data.

### 2.1 Sheet tampil (4 + 1)

| # | Sheet | Peran | Catatan |
|---|---|---|---|
| 1 | CONTROL | Status sesi: user email, start time (`B4`), no agenda (`B5`), nama (`B6`). | `B4` dipakai tanggal cetak ("Jombang, 04 November 2026"). Teks menyebut tombol "SIMPAN PERHITUNGAN KKF", tapi file `.xlsx` tidak punya macro. |
| 2 | KKF | Lembar cetak kajian kelayakan. | Murni tampilan: semua nilai = tarik dari ISIAN KKF, KAJIAN, REKAP. Hanya BPP (`H41`=552), discount rate (`H42`=7,78), ROE (`D66`=0,0047), bunga (`D67`=0,0778) yang diketik di sini. |
| 3 | PERBANDINGAN BP RAB | HPE: membandingkan BP terhadap RAB. | `E15`=KKF!H37 (BP), `F15`=REKAP!L24 (RAB), `G15`=E15/F15. |
| 4 | REKAP | Rekap RAB per jenis pekerjaan + PPN 11%. | Titik keluar mesin 1. |
| 5 | ISIAN KKF (tab cyan) | **Form input** data pelanggan + data pendukung. | Lihat §4. |

### 2.2 Sheet tersembunyi (sekarang terbuka)

| # | Sheet | Warna tab | Peran |
|---|---|---|---|
| 6 | GAMBAR | hijau | **Input utama RAB**: jumlah pasang/bongkar tiap tipe konstruksi (kolom U/V, X/Y, AA/AB). Juga nama, lokasi, ULP, penandatangan, pilihan TUNAI/PLN. |
| 7 | KAJIAN | kuning | Mesin finansial: proyeksi 2026–2051, NPV/IRR/PBP/B-C, blok WACC. Banyak sisa lama (kolom `AL`–`DW`, `#REF!`). |
| 8 | UTANG | – | Formulir 5: perhitungan ganti rugi pemutusan. |
| 9 | ARUS KAS | – | Formulir 7: monitoring arus kas bulanan pengembalian investasi. |
| 10 | TABEL 1 KKF | – | **Rusak** (`#REF!`); tidak dipakai. |
| 11 | REKAP RINCI | – | Memecah RAB per sumber material (MDU / DPT / Tiang Beton / Terminasi / KHS-Jasa). |
| 12 | VOL DPT | – | Rekap volume material DPT per jenis konstruksi. |
| 13 | SR 1 PHASE (2022) | biru | Rekap harga SR/APP 1 fasa (SKKI Pemasaran 2022). |
| 14–25 | SUTM, MVTIC, SKTM, GTT KHUSUS, GTT UMUM, KUBIKEL, SUTR, `6,6-41,5 KVA`, `53-197 KVA` (+ SKTR, SKSR, GD PSG DLM merah) | – | **Sheet konstruksi**: daftar BOM (bill of material) per jenis pekerjaan, tiap baris = 1 kode KHS. |
| 26 | VOL | kuning | Matriks volume per kode KHS × jenis konstruksi (rekap `SUMIF`). |
| 27 | JASA | kuning | **Harga satuan jasa pasang/bongkar per zona** + harga material PLN. |
| 28 | TERM | kuning | Harga kontrak terminasi/jointing kabel (material + pasang). |
| 29 | TIBET | kuning | Harga kontrak tiang beton (material + transport + pasang). |
| 30 | DPT | kuning | Harga material DPT (diambil dari KR MATERIAL + transport). |
| 31 | VOL KHS MAT | kuning | Rekap volume material per kode untuk kontrak. |
| 32 | KR MATERIAL | kuning | Lampiran kontrak rinci: harga satuan material. |
| 33 | MDU | kuning | Harga material MDU (HS + transport = total); dasar asuransi. |
| 34 | KHS | kuning | **Katalog/harga satuan master** (518 kode). Penghubung antara sheet konstruksi dan semua sheet harga. |
| 35 | konv-Rp | – | Konverter angka → terbilang, satu blok per sheet (`REKAP`, `SUTM`, …). |

Sheet merah (SKTR, SKSR, GD PSG DLM) **tidak direferensikan** oleh REKAP. GD PSG DLM bahkan penuh `#N/A` (kode `GTT008` tidak ada di KHS). Aman dianggap warisan, tidak perlu masuk versi web (konfirmasi dulu).

> Tab KAJIAN dan VOL juga kuning. Menurut pemilik proses, KAJIAN adalah analisa pemakaian dan pendapatan dari pemakaian kWh. (Di file, VOL berisi matriks volume material per kode × jenis konstruksi, hasil `SUMIF`; bukan harga.)

---

## 3. Mesin 1: RAB (dari gambar sampai Rupiah)

### 3.1 Input: sheet GAMBAR

Tiap tipe konstruksi punya baris dengan kolom **Psg** (pasang) dan **Bkr** (bongkar):

| Kelompok | Uraian (col) | Psg | Bkr | Dipakai oleh |
|---|---|---|---|---|
| SUTM | `T6:T53` | `U` | `V` | sheet SUTM |
| MVTIC | `W6:W34` | `X` | `Y` | sheet MVTIC |
| SUTR | `W36:W53` | `X` | `Y` | sheet SUTR |
| SKTM | `T55:T56` | `U` | `V` | sheet SKTM |
| Kubikel | `W55:W56` | `X` | `Y` | sheet KUBIKEL |
| GTT Umum | `Z6:Z23` | `AA` | `AB` | sheet GTT UMUM |
| GTT Khusus | `Z25:Z39` | `AA` | `AB` | sheet GTT KHUSUS |
| Estetika | `Z41:Z49` | `AA` | `AB` | sheet SKSR/SKTR dll |
| **PBPD** (APP 3 fasa) | `Z51:Z56` (dropdown `AD3:AD15`) | `AA` | `AB` | sheet `6,6-41,5 KVA` dan `53-197 KVA` |

Sel kuning di GAMBAR = field yang diisi operator: `U1:V3` (nama, lokasi, ULP), `AB12`, `AA14`, `AB52`, `AA55` (jumlah), `U57` (no. gambar), `Z57` (tanggal), `T59/W59/Z59` (penanda tangan), `W65/Z65` (nama pejabat).

**Dropdown / validasi** (untuk form web):
- `Z51:Z56`: daftar `AD3:AD15` = 450–5500 VA, 6,6–16,5 kVA, 23, 33, 41,5, 53, 66, 82,5, 105, 131, 147, 164, 197 kVA.
- `S55` (dan `AI18:AJ20`): `TUNAI` atau `PLN`.
- `Z50`: pilihan jenis PBPD (`AM6:AM10`): TUNAI/PLN, PD 6,6–23, PD 6,6–41,5, PD 33–41,5, PD 53–197 kVA.

Isi contoh: ganti trafo GTT Umum 160 kVA → 250 kVA (`AB12`=1 bongkar, `AA14`=1 pasang) dan PBPD 6,6–16,5 kVA dibongkar (`AB52`=1), 23 kVA dipasang (`AA55`=1).

### 3.2 Sheet konstruksi (SUTM, GTT UMUM, SR-APP, dst.)

Struktur seragam. Header baris 7–8, data mulai baris 10. Kolom:

| Kolom | Isi | Rumus |
|---|---|---|
| A | nomor bagian (I, II, …) | – |
| B | **KODE KHS** | diketik (atau formula `IF(...)` pada sheet SR-APP) |
| C, E, F | uraian, satuan, berat | `VLOOKUP($B, KHS!$B:$I, 2/3/4)` (indeks di baris 6 sheet) |
| H, I, J, K | volume MAT / PSG / BKR / RETUR | `H = I`; `K = J`; `I`,`J` dari GAMBAR atau kelipatan baris induk (mis. `=I25*8`) |
| L, M, N | harga satuan material / pasang / bongkar | `VLOOKUP($B, KHS!$B:$I, 6/7/8)` |
| O | jumlah material | `IF(L="PLN","PLN",H*L)` |
| P, Q | jumlah jasa pasang / bongkar | `I*M`, `J*N` |
| R | total baris | `SUM(O:Q)` |
| U | "PRINT"/"HIDE" | `IF(OR(A<>"",SUM(H:J)>0,R>0),"PRINT","HIDE")` untuk menyembunyikan baris nol saat cetak |

**Pola BOM:** volume tiap baris adalah **jumlah konstruksi × koefisien tetap** (mis. konduktor SUTM: `TRUNC(GAMBAR!U6*1.02*3)` → panjang × 1,02 × 3 kawat; GTT: `=I25*3` arrester dll.). Koefisien ini ditanam di rumus, bukan tabel. Untuk web, ekstrak sebagai tabel `bom_item(konstruksi, kode_khs, koefisien, basis)`.

Bagian akhir tiap sheet konstruksi (contoh GTT UMUM, baris 224–245):
1. **Safety Cost K3L**: `R225 = H225 × M225`, volume `=H222`.
2. **Commisioning Test**: `R241 = R222`.
3. **Asuransi Material PLN (3 per mil)**: `L = ROUND(MDU!G × 3/1000, 0)` kali volume material MDU (`H = SUMIF` atas bagian atas).
4. Baris jumlah: `O239 = SUM(O10:O238)` (material), `P239`/`Q239` (jasa), `R240` asuransi, `R241` commissioning, `R242` safety, `R243 = SUM(R239:R242)`, `R244 = ROUND(R243×11%)`, `R245 = ROUNDUP(R243+R244, -2)`.

### 3.3 REKAP (titik gabung)

Satu baris per jenis pekerjaan (SUTM, MVTIC, SKTM, GTT Khusus, GTT Umum, Kubikel, SUTR, SR-APP 53–197, SR-APP 6,6–41,5, SR-APP 1P):

| Kolom | Isi | Sumber |
|---|---|---|
| D | volume | `H11`/`H10` sheet konstruksi |
| E | material | `O` (total) sheet konstruksi |
| F | jasa (BKR+PSG) | `P + Q` |
| G | commissioning | `R` baris commissioning |
| H | safety K3L | `R` baris safety |
| I | asuransi | `R` baris asuransi |
| J | `=SUM(E:I)` | |
| K | PPN 11% | `ROUND(J × 0.11, 0)` |
| L | total | `ROUNDUP(J+K, -2)` → **dibulatkan ke atas per baris, ratusan** |

`L24` = jumlah semua = **Rp54.173.000** (jumlah L per baris). Ini masuk ke `ISIAN KKF!D15` (nilai RAB).
Dibulatkan per baris, jadi hasilnya bisa beda tipis dengan REKAP RINCI (`AE25` = 54.172.911, selisih Rp89). Web harus menetapkan satu aturan pembulatan.

Contoh isi: GTT Umum Rp47.377.700 + SR-APP 3P 6,6–41,5 Rp6.795.300 = Rp54.173.000.

### 3.4 REKAP RINCI

Membongkar `REKAP` ke sumber material:
- `E` MDU material (`MDU!H97:P97`), `F` PPN 11%, `G` total.
- `H:J` DPT (`DPT!H47…`).
- `K:O` Tiang beton (TIBET), `P:T` Terminasi (TERM).
- `U` **tunai** = `REKAP!E − MDU − Tiang − Terminasi − DPT`; `V` jasa = `REKAP!F − jasa tiang − jasa terminasi`.
- `W/X/Y` commissioning / K3L / asuransi, `Z` subtotal, `AA` PPN 11%, `AC`=`Z+R+M+E`, `AD` PPN, `AE` total.

Header kolom `AA14` dan `AD14` menulis "× 10%" padahal rumusnya 0,11.
Nilai `U23` = **−94.779** (tunai negatif): harga material MDU (4.989.790) lebih besar dari material di REKAP (4.895.011). Artinya harga di MDU dan KHS tidak sinkron (lihat §6).

---

## 4. Sheet kuning: sumber harga satuan kontrak

### 4.1 JASA (harga jasa)

Baris 7–514 (≈508 kode). Kolom: `B` no, `C` nama material, `D` satuan, `E` harga material (angka atau teks `PLN`), lalu per zona pasang & bongkar:

| Zona | Pasang | Bongkar |
|---|---|---|
| 1 | F | G |
| 2 | H | I |
| 3 | J | K |
| 5 | L | M |

(Tidak ada zona 4. Catatan di sel `B2`: "Harga jasa sama dengan kontrak induk/tetap".)
Contoh: "Commisioning test GD" Zona 2 pasang 451.942, bongkar 271.166.

### 4.2 KHS (penghubung)

518 kode (`B`). Kolom: `C` uraian, `D` satuan, `E` berat, `F` sumber material (kosong / `MDU` 86 baris / `DPT` 38 / `PLN` 19), `G` harga material, `H` harga pasang, `I` harga bongkar.

- **`H` dan `I`** = `VLOOKUP($C, JASA!$C:$L, 6 / 7, FALSE)`. Dengan `C:L`, kolom ke-6 = `H` JASA dan ke-7 = `I` JASA, jadi **zona 2 terpasang permanen** (tidak ada pemilih zona). Konfirmasi: 451.942 cocok dengan Zona 2.
- **`G`** (material) ada 5 pola, dikendalikan sakelar `KHS!G2 = GAMBAR!S55` (TUNAI/PLN):

| Pola | Sumber `G` |
|---|---|
| ~370 baris | `JASA!E` (kolom ke-3) |
| 91 baris (MDU) | jika `G2="PLN"` → `JASA!E`, selain itu (TUNAI) → `MDU!G` |
| 38+4 baris (DPT) | jika PLN → `"PLN"`, selain itu → `DPT!G` |
| 8 baris (tiang) | jika PLN → `"PLN"`, selain itu → `TIBET!(kolom 5)` |
| 17 baris (terminasi) | jika PLN → `"PLN"`, selain itu → `TERM!(kolom 3–5)` |

Artinya: bila material **disediakan PLN**, harga material `"PLN"` → baris dikeluarkan dari RAB (`O="PLN"`); bila **tunai** (pelanggan bayar), harga kontrak dipakai.

Kolom `J`, `K` di KHS berisi salinan kode (`=B`); sheet MDU/DPT/TERM/TIBET mengambil kode dari KHS lewat `VLOOKUP(nama, KHS!C:K, …)` (dugaan: dipakai sebagai kunci balik).

### 4.3 Sheet harga material turunan

| Sheet | Isi | Rumus penting |
|---|---|---|
| KR MATERIAL | lampiran kontrak rinci (nama, satuan, volume kontrak, **harga satuan**) | data mentah |
| DPT | ≈41 material umum (bimetal, sleeve, konektor, …) | `E = VLOOKUP(nama, 'KR MATERIAL'!B:E, 4)`, `G = E + F(transport)`, `H…K = SUMIF(volume konstruksi) × G` |
| MDU | ≈91 material utama (trafo, LBS, panel, kabel) | `E` HS, `F` transport, `G = E+F`; baris 97 = total per jenis konstruksi |
| TIBET | 12 tiang beton | `G = E + F`; `H/I` pasang/bongkar; `J,K…` jumlah per konstruksi |
| TERM | 10 jointing/terminasi | `G = F × 0,6` (bongkar = 60% pasang), `H…` jumlah |
| VOL, VOL DPT, VOL KHS MAT | rekap volume per kode × konstruksi | `SUMIF` ke tiap sheet konstruksi |

Parameter ASURANSI: sel `F1 = 0,1` ("ROK") di sheet DPT/MDU/TERM/TIBET/VOL*; asuransi di sheet konstruksi 3 per mil (0,003).

---

## 5. Mesin 2: KKF

### 5.1 ISIAN KKF (input)

| Sel | Isi | Sumber di contoh |
|---|---|---|
| D4 | Nama | input |
| D5 | Jenis pengajuan | input (`PERUBAHAN DAYA`) |
| D6 | IDPEL | input (angka 12 digit) |
| D7/F7 | Tarif/daya sebelum | `B2` / 16,5 kVA |
| D8/F8 | Tarif/daya sesudah | `B2` / 33 kVA |
| D9 | Jenis perluasan | `TANPA PERLUASAN` |
| D10, D11 | Lokasi, ULP | input |
| **D15** | Nilai RAB | `='PERBANDINGAN BP RAB'!F16` → REKAP |
| D16 | Total biaya penyambungan | **diketik** 18.677.726 (= BP + UJL) |
| **D17** | Nilai BP | **diketik** 15.955.226 |
| **D18** | Nilai UJL | **diketik** 2.722.500 (= 165 Rp/VA × 16.500 VA) |
| D19 | Biaya estetika / sharing investasi | kosong |
| D20–D26 | DP BP, Cicilan 1–6 | kosong (dipakai ARUS KAS) |
| D27 | COD (tahun mulai) | `=YEAR(NOW())` |
| **D28** | Harga jual rata-rata | **diketik** 1444,7 ← MASTER TARIF kolom TTL |
| **D29** | Jam nyala rata-rata | **diketik** 117 ← MASTER TARIF kolom Jam Nyala |

Catatan: BP dan UJL diketik; BP 15.955.226 ≈ 966,98 Rp/VA × 16.500 VA. Rumus tarif BP/VA ada di `KAJIAN!I48` (937 / 969 / 775 …) tetapi **tidak dipakai** untuk mengisi BP (hanya referensi).

### 5.2 KAJIAN: proyeksi dan indikator

Baris 15–40 = tahun 2026 (t0) s.d. 2051 (25 tahun operasi). Parameter (kolom `I` dan `Z`):

| Sel | Nilai | Arti |
|---|---|---|
| `I44` | 1,0 | faktor beban |
| `I45` | 0,0234 | susut distribusi |
| `I46` | 540,98 | BPP / transfer price (Rp/kWh) |
| `I47` | `='ISIAN KKF'!D28` | harga jual rata-rata |
| `Z44` | 0,02 | biaya O&M = 2% × investasi per tahun |
| `Z45` | 0,0787 | discount rate (7,87%) |
| `Z47`, `Z48` | 30, 12 | hari/bulan, bulan/tahun |
| `AB53` → `Z49` | 117 | jam nyala/bulan (dari ISIAN KKF!D29) |
| `Z46` | `AB53/Z47` = 3,9 | jam nyala/hari |

Per tahun `t ≥ 1` (baris 16–40):
- `C16` = `'ISIAN KKF'!F8/1000` → daya MW (0,033).
- `I` (energi terjual MWh) = `C × I44 × Z46 × Z47 × Z48` = 0,033 × 1 × 3,9 × 30 × 12 = **46,332 MWh** (≡ `kVA × JN × 12`).
- `L = I + J`; `H = L/(1−I45)` (energi disalurkan; tidak dipakai di NPV).
- `Z` (beli energi, juta Rp) = `Y × L / 1000` dengan `Y = I46`.
- `AA` (O&M) = `$P$15 × Z44`.
- `AB` (jumlah biaya) = `Z + AA + P` (P = investasi, hanya di t0).
- `AG` (pendapatan) = `AF × I / 1000` dengan `AF = I47`.
- `AH` (revenue) = `AC + AE + AG`; **t0**: `AC15 = (BP + estetika)/1e6` (BP dianggap kas masuk tahun 0).
- `AI` (net benefit) = `AH − AB`; `AJ` kumulatif.

Indikator:
| Indikator | Rumus | Hasil contoh |
|---|---|---|
| NPV (juta Rp) | `NPV(Z45, AI15:AI40)` | 372,73 |
| IRR | `IF(AI15>0,100, IRR(AI15:AI40,0.1)×100)` | 106,72 % |
| B/C | `NPV(Z45,AH)/NPV(Z45,AB)` | 2,195 |
| PBP | bulan ke-n saat `AJ` positif: `DV` tahun, `DW` bulan | 0 th 11 bln |
| Kesimpulan | `IF(AND(AH44>AA45, AH45>0, OR(DV44<5, AND(DV44=5, DW44=0))), "LAYAK","TIDAK LAYAK")`, yaitu IRR > `AA45` (= 7,87), NPV > 0, PBP < 5 th (atau tepat 5 th 0 bln). Dengan keputusan §0 no. 2, `AA45` diganti RWACC (`AH43`). | **LAYAK** |
| RWACC/WACC | blok `B119:C126`: `DER=(P15−AC15)/AC15`, `Equity=C119/(1+DER)`, `Debt=…`, `WACC = Eq/Tot×ROE + (1−0,25)×Debt/Tot×bunga`; ROE 0,0047, bunga 0,0778 | 4,2549 % |

### 5.3 KKF (cetak)

| Sel | Sumber |
|---|---|
| E11:E16 | ISIAN KKF |
| E18 JTM `=(REKAP!D14+D15+D16)/1000` Kms; E19 gardu `=D17+D18+D19`; E20 JTR `=D20/1000`; E21 APP `=D21+D22+D23` | REKAP |
| E25 anggaran biaya | ISIAN KKF!D15 |
| H37, H38, H39, H40, H43 | BP, UJL, estetika, JN, harga jual (ISIAN KKF); `H41` BPP **diketik 552**; `H42` discount **diketik 7,78** |
| E49 RWACC | `ROUND(D69,2)` (blok WACC lokal di `D62:D69`, identik dengan KAJIAN) |
| E50/E51/E52 | `KAJIAN!AH44`, `AH45×1e6`, `AH47` |
| E53 Rasio BP | `(H37+H39)/E25` = 0,2945 (kriteria ≥ 1) |
| I49 kesimpulan | `KAJIAN!AH48` |
| H61 tanggal | `TEXT(CONTROL!B4,"dd mmmm yyyy")` |

### 5.4 UTANG (Formulir 5) dan ARUS KAS (Formulir 7)

- UTANG: `Hutang = Investasi − BP` = 38.217.774. Tahun 1–5: `kWh = JN × 12 × 'ISIAN KKF'!F8` (46.332), `Pendapatan = kWh × harga`, `Biaya = KAJIAN!AB16 × 1e6`, `Margin = Pendapatan − Biaya`, `Sisa hutang kumulatif` (positif di tahun 1 → PBP < 1 tahun).
- ARUS KAS: jadwal bulanan; baris `Penerimaan BP` + `DP BP` + `Cicilan 1..6` + `Penerimaan Rp. PTL (kWh/12 × tarif)` − `Biaya produksi kWh`; `Net Cash` kumulatif per bulan.
- Header ARUS KAS tertulis **"UP3 MALANG"**, sedangkan lembar lain UP3 MOJOKERTO.

---

## 6. MASTER TARIF & JAM NYALA ⇄ RAB & KKF

### 6.1 Struktur master

| Sheet | Isi |
|---|---|
| `309` | Laporan Penjualan Tenaga Listrik versi pusat, ULP Jombang, **Februari 2026**. Per golongan: VA/pelanggan, kWh/pelanggan (`I`), Rp/kWh (`J`), **jam nyala** (`K`), kWh (`L`), biaya beban (`N`), biaya pemakaian (`O`), jumlah Rp (`R`), Rp/kWh (`S`). |
| `UJL` | Rp/VA UJL per golongan/batas daya (`D`), No 1–33. |
| `MASTER TARIF & JN` | Per tarif/daya: `TARIF` (B1/B2/B3), `DAYA` (VA), `JAM NYALA` (**formula** → `'309'!K43/45/47/48/49/51`), `TTL` (harga jual rata-rata, **diketik**), `UJL` (**formula** → `UJL!D14…D18`). Daya yang sama dalam satu golongan diisi ulang dengan `=$C$9` dll. |

Hanya golongan **B1, B2, B3** yang ada di master ini (40 baris). Golongan lain (R, S, I, P …) belum tersedia.

### 6.2 Contoh nilai master (golongan B)

| Tarif | Daya | JN | TTL | UJL (Rp/VA) |
|---|---|---|---|---|
| B1 | 450 | 137 | 535 | 80 |
| B1 | 900 | 149 | 630 | 80 |
| B1 | 1.300 | 120 | 966 | 132 |
| B1 | 2.200–5.500 | 92 | 1.100 | 130 |
| B2 | 6.600–197.000 | **117** | **1.444,7** | **165** |
| B3 | ≥ 210.000 | 152 | 1.035,78 | 200 |

### 6.3 Titik sambung ke RAB & KKF

| Dari master | Ke | Cara |
|---|---|---|
| JN (B2 = 117) | `ISIAN KKF!D29` → `KKF!H40`, `KAJIAN!AB53/Z49`, `UTANG!E19` | **salin manual** (tidak ada link/macro) |
| TTL (B2 = 1444,7) | `ISIAN KKF!D28` → `KKF!H43`, `KAJIAN!I47`, `UTANG!J13` | **salin manual** |
| UJL (B2 = 165 Rp/VA) | `ISIAN KKF!D18` | **diketik**. Contoh: 165 × 16.500 VA = 2.722.500 (selisih daya) |

Kunci pencarian di web: `(golongan, daya_sesudah)` → `JN`, `TTL`, `UJL`. Untuk B2 (6.600–197.000 VA) semua daya sama. Untuk B1 dan B3 tergantung daya.

**Koreksi atas analisa sebelumnya.** Dengan terbitnya dokumen *Penetapan Penyesuaian Tarif (Tariff Adjustment) Juli–September 2026* (§10.1), terbukti bahwa kolom **TTL master adalah tarif yang ditetapkan, bukan rata-rata hasil penjualan (`R/L`) dari sheet `309`**:
- B2: TTL 1.444,7 = penetapan B-2/TR **1.444,70** ✔ (`R/L` 309 = 1.444,8 hanya kebetulan dekat).
- B3: TTL 1.035,78 = penetapan B-3/TM,TT **Blok LWBP 1.035,78** ✔. Selisih terhadap `R/L` 309 (1.142) bukan galat; angka 309 adalah rata-rata realisasi.
- B1 (450 VA 535, 900 VA 630, 1.300 VA 966, 2.200–5.500 VA 1.100) tidak ada di dokumen adjustment ⇒ **tarif tetap** (tidak ikut penyesuaian triwulan).
Hanya **jam nyala** yang berasal dari `309`.

---

## 7. Temuan (sudah diperbarui setelah semua sheet dibuka)

### 7.1 Berdampak ke hasil hitung

1. **Daya PBPD tidak sama.** ISIAN KKF `F8` = 33 kVA, sedangkan GAMBAR `AA55` memasang **23 kVA** (`AA56` untuk 33 kVA kosong). Sheet `6,6-41,5 KVA` memilih kabel/MCB berdasarkan pilihan itu (23 kVA → NFA2X 4×16 mm, 20 m; 33 kVA → NFA2X 4×25 mm, 30 m). RAB bisa kurang bila 33 kVA yang benar.
2. **Harga MDU ≠ harga KHS.** `REKAP RINCI!U23` = −94.779 (tunai negatif). Penyebab: `MDU!G` (HS+transport) berbeda dari `KHS!G` untuk item SR-APP yang sama. Dua sumber harga yang mestinya satu.
3. **Zona jasa terkunci Zona 2** (indeks kolom `6/7` di KHS). Sesuai keputusan §0, zona memang per UP3, jadi ini boleh dipertahankan, tetapi di web dijadikan pengaturan UP3 yang eksplisit, bukan indeks kolom tertanam.
4. **Tiga angka suku bunga berbeda (keputusan: pakai RWACC, lihat §0):** discount rate `KAJIAN!Z45` = 7,87% (dipakai NPV dan kriteria LAYAK), `KKF!H42` = 7,78% (tampil), RWACC `KKF!E49` = 4,25% (tampil sebagai kriteria IRR "> 4,25 %"). Keputusan LAYAK sebenarnya memakai 7,87%.
5. **BPP berbeda:** `KKF!H41` = 552, `KAJIAN!I46` = 540,98 (yang masuk hitungan; juga UTANG/ARUS KAS).
6. **NPV `NPV(Z45, AI15:AI40)`** mendiskonto sel t0 (`AI15`) satu periode juga. NPV standar = `AI15 + NPV(r, AI16:AI40)`. Akibatnya seluruh NPV terbagi (1+7,87%): NPV 372,73 juta di file = NPV standar ÷ 1,0787 (jadi sedikit konservatif), tetapi tidak standar.
7. **Rasio BP 0,29 (< 1)** tidak mempengaruhi kesimpulan LAYAK; kriteria `≥ 1` tidak punya status lulus/gagal.
8. **Pembulatan** per baris (`ROUNDUP(…,−2)`) membuat REKAP (54.173.000) ≠ REKAP RINCI (54.172.911).
9. **Energi memakai daya sesudah (33 kVA penuh)** di KAJIAN (`C16`), UTANG (`F19`) dan ARUS KAS, padahal keputusan §0 adalah selisih (16,5 kVA), sama seperti dasar UJL dan BP. Pendapatan di file terhitung 2× lipat dari seharusnya. Perlu diperbaiki di web.

### 7.2 Data master

10. ~~TTL B3 dan B1 tidak cocok dengan `309`~~ **dicabut**: TTL memang mengikuti penetapan tarif, bukan `309` (lihat §6.3 dan §10.1).
11. `309` berisi angka berformat ID rusak (mis. `1.445` dibaca 1,445). Ini masalah untuk impor jam nyala (§10.2), bukan untuk TTL.
12. Jam nyala = Februari 2026; TTL B2/B3 = penetapan yang berlaku saat file dibuat. Master tidak mencatat periode berlaku maupun nomor/tanggal penetapan.
13. Master hanya berisi golongan B.

### 7.3 Kualitas workbook

14. `konv-Rp` (terbilang) sekarang `#VALUE!` di berbagai sel, dan versi sebelumnya menampilkan terbilang salah ("Lima Ratus Empat Puluh Satu Milyar…" untuk Rp54.173.000). Di web ganti dengan fungsi `terbilang()`.
15. `TABEL 1 KKF` penuh `#REF!`; `KAJIAN` banyak `#REF!` (tabel GI/feeder lama, kolom `AL:DW`), tidak mempengaruhi hasil.
16. `KHS` memuat `#REF!` di kolom `B` sheet TERM/TIBET; `GTT UMUM!G225` `#REF!`.
17. REKAP: nomor urut uraian tidak teratur (1, 2, 6, 3, 8, 9, 4); `REKAP!D18` (volume GTT Umum) = `'GTT UMUM'!H25` yang diketik 0, padahal 1 trafo dipasang dan biayanya Rp47,4 juta.
18. Label: "Jam Nyala Minimum" (`KKF!B40`) tetapi nilainya rata-rata; "Rp bn" (`KKF!E62`, `E64`, `E65`) padahal Rupiah; "UP3 MALANG" di ARUS KAS; "× 10%" di REKAP RINCI.
19. `KKF!E14` Tarif/Daya hanya menampilkan "sebelum".
20. Tidak ada macro. Tombol "SIMPAN PERHITUNGAN KKF" tidak ada; fungsi simpan/PDF harus dibangun di web.

---

## 8. Usulan model data untuk versi web

### 8.1 Entitas

```
permohonan(id, nama, idpel, jenis_pengajuan, tarif_sebelum, daya_sebelum_va,
           tarif_sesudah, daya_sesudah_va, jenis_perluasan, lokasi, ulp,
           bp, ujl, estetika, dp_bp, cicilan[1..6], cod_tahun,
           mode_material{TUNAI|PLN}, zona{1|2|3|5}, no_gambar, tanggal,
           pejabat{manager, spv_teknik, digambar})

gambar_item(permohonan_id, kelompok, kode_konstruksi, qty_psg, qty_bkr)
   -- kelompok ∈ SUTM, MVTIC, SUTR, SKTM, KUBIKEL, GTT_UMUM, GTT_KHUSUS, ESTETIKA, PBPD

katalog_khs(kode, uraian, satuan, berat, sumber_material{JASA|MDU|DPT|TIBET|TERM|PLN})
harga_jasa(kode, zona, pasang, bongkar)            -- sheet JASA
harga_material(kode, sumber, hs, transport, total) -- MDU, DPT, TIBET, TERM, KR MATERIAL
bom_item(konstruksi, kode_khs, koefisien, basis)   -- rumus-rumus baris sheet konstruksi
tarif_rpkwh(golongan, daya_va, jenis_tarif{tetap|adjustment}, rp_per_kwh, berlaku_dari, berlaku_sampai)
jam_nyala(golongan, daya_va, periode_bulan, jam_nyala, sumber_laporan)
ujl(golongan, daya_va, rp_per_va, berlaku_dari)
param_kkf(discount_rate, bpp, om_pct, susut, faktor_beban, roe, bunga, pajak, tahun_proyeksi)
```

### 8.2 Alur hitung (fungsi murni, mudah diuji)

1. `hargaSatuan(kode, mode, zona)` → `{material|"PLN", pasang, bongkar}`.
2. `hitungKonstruksi(jenis, gambar_item[])` → baris RAB (material, jasa psg/bkr, subtotal) + commissioning + K3L + asuransi (`ROUND(harga_MDU × 0,003)`).
3. `rekapRAB()` → tiap jenis: `subtotal`, `ppn = round(0,11 × subtotal)`, `total = ceilTo100(subtotal + ppn)`; RAB = jumlah.
4. `lookupTarif(tarif, daya)` → JN, TTL, UJL (ganti salin manual dengan pencarian otomatis).
5. `proyeksiKKF()` → 25 tahun: energi, biaya, pendapatan, net benefit; `NPV` (perbaiki dengan t0 tidak didiskonto), `IRR`, `B/C`, `PBP`, `LAYAK/TIDAK`.
6. `wacc()` → DER, ekuitas, utang, WACC.
7. `formulir5()` dan `formulir7()`.
8. Output: PDF (KKF, HPE, REKAP, REKAP RINCI, Formulir 5, Formulir 7).

### 8.3 Aturan bisnis

Sudah diputuskan (§0): energi dari selisih daya, discount rate = RWACC, zona per UP3.

Tidak ada lagi keputusan bisnis yang terbuka. Sudah diterima: dokumen penetapan tarif adjustment Juli–September 2026 (§10.1). Yang masih dibutuhkan saat membangun:
1. Daftar **tarif tetap** semua golongan dan daya (S, R-1 450/900 VA, B-1, I-1, I-2, dst.) untuk melengkapi template §10.1.
2. Beberapa file laporan `309` dari bulan berbeda, termasuk golongan selain B (untuk menguji pembacaan, §10.2).
3. Dokumen kontrak **belum ada**. Format impor §10.3 sementara mengikuti sheet JASA/MDU/DPT/TIBET/TERM/KR MATERIAL di file sekarang; finalkan setelah dokumen kontrak tersedia.

---

## 9. Lampiran: peta ketergantungan antar sheet (jumlah referensi rumus)

```
GAMBAR ─► SUTM, MVTIC, SKTM, SKTR, SKSR, KUBIKEL, SUTR, GTT UMUM, GTT KHUSUS,
          6,6-41,5 KVA, 53-197 KVA, SR 1 PHASE, REKAP RINCI
KHS ◄── sheet konstruksi (SUTM 3.371, MVTIC 2.541, GTT UMUM 1.079, GTT KHUSUS 925, SUTR 690, …)
KHS ─► JASA (1.961), MDU (91), DPT (42), TERM (19), TIBET (16)
MDU ─► sheet konstruksi (asuransi), KR MATERIAL;  DPT ─► KR MATERIAL
VOL, VOL DPT, VOL KHS MAT ─► (SUMIF atas semua sheet konstruksi) ─► JASA
konstruksi ─► REKAP ─► REKAP RINCI
REKAP ─► PERBANDINGAN BP RAB ─► ISIAN KKF!D15
ISIAN KKF ─► KKF, KAJIAN, UTANG, ARUS KAS
KAJIAN ─► KKF (IRR, NPV, PBP, LAYAK), UTANG (BPP, harga jual, biaya)
UTANG ─► ARUS KAS
konv-Rp ─► REKAP, tiap sheet konstruksi (terbilang)
```

Sheet tidak terhubung: SKTR, SKSR, GD PSG DLM, TABEL 1 KKF (rusak).


---

## 10. Spesifikasi modul impor (admin)

Prinsip umum: setiap impor membuat **versi baru** (tidak menimpa), menyimpan nama file, pengunggah, dan waktu, menampilkan **pratinjau dan daftar galat sebelum disimpan**, dan permohonan lama tetap memakai versi yang berlaku saat dihitung.

### 10.1 Impor tarif

**Sumber nyata (contoh diterima):** *Penetapan Penyesuaian Tarif Tenaga Listrik (Tariff Adjustment)*, Direktur Utama PLN, Jakarta 01 Juli 2026, **berlaku Juli–September 2026 (triwulan)**. Berupa PDF hasil pindai.

Isi tabel penetapan (Rp/kWh; kolom Reguler dan Pra Bayar):

| Gol. tarif | Batas daya | Reguler (biaya pemakaian) | Pra bayar | Biaya beban |
|---|---|---|---|---|
| R-1/TR | 900 VA-RTM | 1.352,00 | 1.352,00 | RM1 |
| R-1/TR | 1.300 VA | 1.444,70 | 1.444,70 | RM1 |
| R-1/TR | 2.200 VA | 1.444,70 | 1.444,70 | RM1 |
| R-2/TR | 3.500–5.500 VA | 1.699,53 | 1.699,53 | RM1 |
| R-3/TR, TM | ≥ 6.600 VA | 1.699,53 | 1.699,53 | RM1 |
| B-2/TR | 6.600 VA–200 kVA | **1.444,70** | 1.444,70 | RM1 |
| B-3/TM, TT | > 200 kVA | LWBP **1.035,78**, WBP = K × 1.035,78, kVArh 1.114,74 | – | RM2 |
| I-3/TM | > 200 kVA | LWBP 1.035,78, WBP = K × 1.035,78, kVArh 1.114,74 | – | RM2 |
| I-4/TT | ≥ 30.000 kVA | WBP dan LWBP 996,74, kVArh 996,74 | – | RM3 |
| P-1/TR | 6.600 VA–200 kVA | 1.699,53 | 1.699,53 | RM1 |
| P-2/TM | > 200 kVA | LWBP 1.415,01, WBP = K × 1.415,01, kVArh 1.522,88 | – | RM2 |
| P-3/TR | – | 1.699,53 | 1.699,53 | RM1 |
| L/TR, TM, TT | – | WBP dan LWBP = N × 1.644,52, kVArh N × 1.644,52 | – | – |

Catatan di dokumen:
- **Rekening Minimum (RM):** RM1 = 40 jam nyala × daya tersambung (kVA) × biaya pemakaian; RM2 = 40 × kVA × biaya LWBP; RM3 = 40 × kVA × biaya WBP dan LWBP. Jam nyala = kWh per bulan ÷ kVA tersambung.
- `K` = faktor perbandingan WBP/LWBP (1,4 ≤ K ≤ 2) ditetapkan Direksi; `N` = faktor golongan L. Kelebihan kVArh dikenakan bila faktor daya rata-rata < 0,85.
- Golongan **tidak ada di dokumen** (S, R-1 450/900 VA non-RTM, B-1, I-1, I-2, dll.) = **tarif tetap**, hanya berubah bila pemerintah menetapkan ulang.

Cocok dengan master saat ini: B-2 = 1.444,70 dan B-3 LWBP = 1.035,78 (§6.3).

**Aturan pengambilan TTL untuk KKF:** pakai Rp/kWh reguler; untuk golongan berblok (B-3, I-3, P-2) pakai **LWBP** (sesuai master saat ini). Pastikan ini aturan resmi untuk golongan lain berblok (WBP = K × LWBP tidak dipakai).

**Model data tarif:**

| Kolom | Contoh |
|---|---|
| golongan | B-2/TR |
| batas daya (bawah/atas, VA) | 6600 – 200000 |
| jenis_tarif | tetap / adjustment |
| rp_kwh_reguler | 1444,70 |
| rp_kwh_prabayar | 1444,70 (kosong bila tidak ada) |
| rp_kwh_lwbp, faktor_wbp (K/N), rp_kvarh | 1035,78 / K / 1114,74 (golongan berblok) |
| rm_tipe | RM1 / RM2 / RM3 (rekening minimum 40 jam) |
| ujl_rp_va | 165 |
| berlaku_dari, berlaku_sampai | 2026-07-01, 2026-09-30 |
| dokumen_penetapan | nomor, tanggal (01-07-2026), berkas PDF terlampir |

Aturan: periode untuk (golongan, batas daya, jenis tarif) yang sama tidak boleh tumpang tindih. Tarif adjustment diperbarui tiap triwulan; tarif tetap cukup diimpor sekali dan tanpa tanggal akhir. Tarif adjustment yang sudah lewat tetap disimpan agar permohonan lama dapat dihitung ulang. Sumber awal UJL: sheet `UJL` (33 baris).

**Cara memasukkan data:** dokumen asli berupa PDF pindai, jadi impor tarif sebaiknya memakai **template Excel/CSV** yang diisi admin (satu baris per golongan dan batas daya, sesuai tabel di atas), dengan PDF penetapan diunggah sebagai lampiran bukti. Pembacaan otomatis dari PDF pindai tidak disarankan sebagai jalur utama.

### 10.2 Impor laporan penjualan (format `309`)

Dari kondisi sheet `309` di file contoh:
- Periode ada di `B6` ("BULAN : Februari 2026"); `B7` = pembukuan ("PLUS"); judul pusat/UID/UP3/ULP di `D1:D4`. Simpan periode, ULP.
- Baris data mulai baris 15. Kolom: `B` label golongan/daya, `F` VA per pelanggan, `I` kWh per pelanggan, `J` Rp/kWh, **`K` jam nyala**, `L` kWh, `M` kVArh, `N` biaya beban, `O` biaya pemakaian, `P` kVArh, `Q` TTLB, `R` jumlah Rp, `S` Rp/kWh.
- Baris "JUMLAH …" (subtotal per golongan) dan baris sub-tingkat "II", "III" di bawah daya tertentu (umumnya nol) harus dikenali dan dilewati/dibawa ke baris induknya.
- **Format angka Indonesia:** titik sebagai pemisah ribuan, koma desimal, dan sebagian nilai tersimpan sebagai teks atau sudah salah baca (`1.445` terbaca 1,445; `13.209` terbaca 13,209). Parser tidak boleh memakai `parseFloat` langsung. Cara aman: jam nyala dan jumlah kWh/Rp dihitung ulang dari kolom `L`, `O`, `R` (angka lengkap) atau dinormalisasi memakai aturan pemisah ribuan, lalu diperiksa silang (`R/L ≈ S`, `L/jumlah pelanggan ≈ I`).
- Pemetaan label → (golongan, rentang daya): mis. `B.2 / 6.600 VA s.d 200 kVA` → B2, 6.600–200.000 VA; `B.3 / > 200 kVA s.d <30.000 kVA` → B3. Satu baris laporan berlaku untuk seluruh rentang daya (sama seperti master B2 sekarang: 6.600–197.000 VA satu nilai). Tabel pemetaan ini dibuat sekali dan dipakai ulang tiap impor.
- Hasil: `jam_nyala(golongan, rentang_daya, periode_bulan, jam_nyala, ulp, versi_file)`. Bulan yang sudah ada boleh diganti (versi baru) dengan konfirmasi.
- Validasi: jam nyala wajar (mis. 0–720), periode belum ada, jumlah baris golongan sesuai. Catatan: periode di sheet contoh hanya Februari 2026 (28 hari), jadi jam nyala bulan pendek bisa lebih rendah; tampilkan periode yang dipakai di KKF.

### 10.3 Impor harga kontrak

| Data | Sheet asal | Kolom kunci |
|---|---|---|
| Jasa pasang/bongkar per zona | JASA | kode/nama material, satuan, pasang & bongkar tiap zona (Z1, Z2, Z3, Z5) |
| Material MDU | MDU | nama, satuan, HS, transport |
| Material DPT | DPT + KR MATERIAL | nama, satuan, harga satuan kontrak, transport |
| Tiang beton | TIBET | nama, HS, transport, pasang, bongkar |
| Terminasi/jointing | TERM | nama, HS, pasang |

- Satu **kontrak** = nomor, tanggal mulai, tanggal akhir (umumnya 2 tahun), dan seluruh harganya (satu paket versi).
- Sesuai keputusan satu sumber harga: semua tabel material (MDU, DPT, TIBET, TERM, KR MATERIAL) digabung menjadi satu `harga_material(kontrak_id, kode_khs, sumber, hs, transport, total)`, kunci = kode KHS, bukan nama teks (di Excel kuncinya nama dan sering tidak cocok).
- Harga jasa: `harga_jasa(kontrak_id, kode_khs, zona, pasang, bongkar)`; zona yang dipakai ditentukan pengaturan UP3 (§0 no. 3).
- Bongkar TERM = 60% × pasang (`G = F×0,6`) dan bongkar SR-APP/PSG = 60% (`AI3 = AH3×0,6`): pertahankan sebagai aturan yang bisa diubah, jangan tertanam.
- Validasi saat impor: semua kode KHS ada, tidak ada harga kosong/`N/A`, masa kontrak tidak tumpang tindih dengan kontrak aktif lain, peringatan bila kontrak yang berlaku hampir habis.
- Permohonan menyimpan `kontrak_id` yang dipakainya sehingga RAB lama tetap dapat dicetak ulang dengan harga lama.
