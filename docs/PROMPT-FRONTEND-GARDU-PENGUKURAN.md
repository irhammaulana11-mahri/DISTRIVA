# PROMPT EKSEKUSI — Agen Frontend DISTRIVA: pisahkan halaman Master Gardu (aset) dan Pengukuran Gardu (kondisi)

> Salin seluruh isi di bawah garis ini sebagai prompt untuk agen frontend. Kerjakan prompt ini **lebih dulu** daripada `docs/PROMPT-FRONTEND-PENYULANG-PELANGGAN.md` (keduanya menyentuh halaman gardu).

---

Kamu adalah agen frontend untuk DISTRIVA (React 19 + Vite + Tailwind di folder `frontend/`). Backend Laravel **sudah selesai dan teruji**; tugasmu merapikan antarmuka gardu yang sudah ada menjadi dua halaman. **Jangan mengubah apa pun di `backend/`, `database/`, atau `tools/`.**

## Latar belakang
Saat ini satu halaman (`SubstationsPage.jsx`) mencampur data aset dan data pengukuran. Data nyata: kolom aset hampir lengkap (971 gardu: nama, kapasitas, penyulang semua terisi; koordinat 970; merk trafo 923 dan tahun 928 dari 957 trafo), sedangkan pembacaan pengukuran hanya ada pada 388 gardu dan semuanya lama (2016–2024, berstatus kedaluwarsa). Dua pengguna berbeda: Perencanaan/Enjiniring mengelola **data induk**; Teknik ULP dan petugas survei memakai **pengukuran**. Karena itu dipisah (keputusan pemilik, docs/80 §15).

## Baca dulu (wajib, berurutan)
1. `docs/80-DESAIN-MASTER-GARDU-KKO.md` — **§12, §14, §15** (halaman yang ada, aturan analisis, dan alasan pemisahan).
2. `docs/57-API-CONTRACT.md` bagian **"Master gardu (docs/80)"** termasuk butir "Perluasan daftar gardu" dan "Analisis" — kontrak API yang sebenarnya.
3. Kode yang ada (dipecah, bukan ditulis ulang dari nol): `frontend/src/pages/master-data/SubstationsPage.jsx`, `SubstationAnalysis.jsx`, `SubstationImportModal.jsx`, `SubstationsPage.test.jsx`, `frontend/src/pages/applications/SubstationPicker.jsx` (tidak berubah), `frontend/src/services/api.js` (`substationsApi`), `frontend/src/layout/AppLayout.jsx`, `frontend/src/App.jsx`.

## Hasil yang diminta

### A. Halaman **Master Gardu** (aset) — `/master-data/substations` (rute dan berkas yang ada), izin `substations.view`
- **Daftar** (kolom): kode, **nama / lokasi**, **alamat** (`address`), unit, **penyulang** (`feeder_code`), **kapasitas (kVA)**, **merk trafo** (`transformer_brand`), **tahun** (`transformer_year`) dengan **umur** (`transformer_age_years`, tulis "8 th"), **koordinat** (lintang, bujur; bila ada beri tautan "peta" ke `https://www.google.com/maps?q=<lat>,<lng>` dengan `target="_blank" rel="noopener noreferrer"`), kepemilikan, status. Penanda: Pelanggan, Nonaktif, Perlu ditinjau, "tanpa koordinat". Sel kosong ditulis "-" (jangan 0).
- **Filter** (dikirim ke server): pencarian `q`, unit, penyulang (`feeder_id`; daftar dari `GET /master-data/feeders` bila `can['feeders.view']`, kalau tidak sembunyikan), merk (`brand`), tahun dari/sampai (`year_from`, `year_to`), kapasitas min/maks (`capacity_min`, `capacity_max`), kecamatan, kepemilikan, status, "tanpa koordinat" (`has_coordinates=0`), perlu ditinjau.
- **Urut:** klik kepala kolom kode, nama, kapasitas, tahun → `sort` + `dir` ke server (jangan mengurutkan di klien). Tampilkan arah urut. Paginasi memakai `meta`.
- **Detail** (Drawer): data induk lengkap (alamat, wilayah, koordinat, kepemilikan, peruntukan, tipe, aset/lokasi/GADIS), **daftar trafo** (slot, kapasitas, merk, tahun, no. seri, fasa), **kartu pelanggan** bila `data.customers` ada (pelanggan aktif, daya tersambung kVA; bukan beban), **riwayat perubahan** (`data.history`: aksi, alasan, siapa, kapan, sebelum → sesudah), dan tombol **"Lihat pengukuran"** ke `/master-data/substation-measurements?open=<id>`.
- **Ubah data induk** hanya bila `can['substations.manage']`: formulir untuk nama, catatan lokasi (`area_note`), lintang, bujur, kapasitas, kepemilikan, peruntukan, tipe, kode penyulang, status, perlu ditinjau, dengan **alasan wajib** (min. 3 karakter) → `PATCH /master-data/substations/{id}`. Server hanya mencatat isian yang berubah; tampilkan pesan 409/422 apa adanya. Setelah berhasil muat ulang detail dan daftar.
- **Impor** (`SubstationImportModal`) tetap di halaman ini, tidak berubah.
- **Hapus dari halaman ini:** tab Analisis, form tambah pembacaan, kolom Pembebanan / Tegangan ujung / Pembacaan, filter pembacaan dan peringatan tegangan (pindah ke halaman B).

### B. Halaman **Pengukuran Gardu** (kondisi) — rute baru `/master-data/substation-measurements`, izin `substations.view`, berkas baru `SubstationMeasurementsPage.jsx`
- **Daftar:** kode, nama, penyulang, kapasitas, **pembebanan (%)** (`reading.loading_pct`), **tegangan pangkal terendah** dan **tegangan ujung** (`reading.end_voltage_v`; pangkal = nilai terkecil dari `reading.base_voltage_r_v|s_v|t_v`, tanpa menghitung ulang aturan: tampilkan saja), **tanggal pembacaan** dan usia (`reading.measured_on`, `age_days`), status pembacaan (Terkini / Kedaluwarsa / Belum ada), **peringatan** (`reading.flags` lewat `FlagChips`). Gardu tanpa pembacaan tetap muncul.
- **Filter ke server:** unit, penyulang, status pembacaan (`reading_status`), rentang pembebanan (`loading_min`, `loading_max`; sediakan pintasan ">80 % (overload)" dan "> 100 %"), peringatan (`alert`: Tegangan pangkal < 231 V `BASE_LOW`, Tegangan ujung rendah `END_LOW`, Fasa tidak seimbang `PHASE_UNBALANCED`, Drop tegangan tinggi `END_DROP`), pencarian. Urut default `sort=loading&dir=desc`; kolom pembebanan dan tanggal pembacaan dapat diurut (`loading`, `measured_on`).
- **Ringkasan kondisi data** di atas tabel: "N dari M gardu punya pembacaan terkini". Ambil N dari `meta.total` permintaan `reading_status=FRESH&per_page=1`, dan M dari permintaan tanpa filter itu. Karena pembacaan yang ada sekarang lama, banner ini akan menunjukkan angka kecil: **ini keadaan data, bukan kesalahan**; tulis penjelasan singkat ("pembacaan baru datang dari survei atau sinkronisasi Maximo").
- **Detail** (Drawer): pindahkan `SubstationAnalysis` (Riwayat, Keseimbangan, Tegangan, Proyeksi) ke sini tanpa mengubah perilakunya, lalu **form tambah pembacaan** (tegangan pangkal R/S/T, arus R/S/T, persen, tegangan ujung, baris per jurusan) yang sudah ada, hanya bila `can['substations.reading']` dan gardu `pickable`. Tombol **"Data induk"** ke `/master-data/substations?open=<id>`.
- Parameter `?open=<id>` pada kedua halaman membuka Drawer gardu itu saat halaman dimuat (dan menghapus parameter saat Drawer ditutup).

### C. Menu, rute, judul
- `App.jsx`: rute baru dengan `RequireCapability capability="substations.view"`.
- `AppLayout.jsx`: item menu **"Pengukuran Gardu"** tepat di bawah "Master Gardu", **tanpa** `profiles` (izin server yang menentukan), plus judul di peta judul halaman. Ubah label "Master Gardu" bila perlu agar jelas bahwa itu data induk.
- `SubstationPicker` dan panel KKO **tidak berubah**.

## Aturan keras
- **Backend satu-satunya penentu hak akses.** Tampilkan/sembunyikan hanya dari peta `can` di `AccessContext` (`substations.view|import|manage|reading`, `feeders.view`). Jangan menyimpulkan hak dari nama peran. Muat ulang halaman setelah login ulang agar peta izin terbaca.
- **Jangan menebak kontrak.** Bila endpoint/kolom tidak ada atau tidak jelas, **berhenti di bagian itu**, tulis di bagian "Temuan frontend untuk backend" di akhir `docs/80`, lanjutkan bagian lain.
- **Jangan menghitung aturan bisnis di klien** (umur, alamat gabungan, pembebanan, peringatan, status pembacaan, urutan). Semuanya datang dari server. **Nilai 0 bukan "tidak ada"; kosong/`null` ditampilkan "-"**, dan jangan menampilkan angka karangan bila nilainya kosong.
- Daftar besar: paginasi dan urutan dari server; debounce pencarian ketik (≥ 300 ms); batalkan hasil permintaan lama saat filter berubah.
- `Alert` **tidak meneruskan `data-testid`**: bungkus dengan `div` ber-`data-testid` bila perlu diuji. Jangan menulis tes yang hanya memeriksa "elemen tidak ada" tanpa membuktikan elemen itu dapat muncul.
- Token tetap di `sessionStorage`; jangan menulis token atau kata sandi ke log atau tes. Jangan membaca atau menyalin `tools/samples/*` selain bila memang diperlukan sebagai bentuk data; untuk tes pakai respons tiruan berdata rekaan.
- Semua teks antarmuka berbahasa Indonesia, aksesibel (label, fokus, kontras), responsif, memakai komponen yang ada. Jangan menambah dependensi (termasuk pustaka peta; peta gardu adalah tahap berikutnya, di luar prompt ini) tanpa alasan kuat; jika perlu, sebut di laporan.

## Selesai berarti
- **Pecah tes yang ada:** `SubstationsPage.test.jsx` kini mencampur keduanya; pindahkan tes analisis, form pembacaan, dan filter tegangan ke `SubstationMeasurementsPage.test.jsx`, dan jangan mengurangi cakupan.
- Tes baru (respons tiruan, `vi.mock('../../services/api.js')`):
  - Master Gardu: kolom alamat, merk, tahun + umur, koordinat dengan tautan peta, "-" bila kosong; tiap filter baru dan `sort`/`dir` dikirim ke server; form ubah mewajibkan alasan, menampilkan pesan server, dan tersembunyi tanpa `substations.manage`; riwayat perubahan tampil; tombol "Lihat pengukuran" menuju URL yang benar; tab/analisis dan form pembacaan tidak ada lagi di halaman ini.
  - Pengukuran Gardu: kolom dan penanda peringatan; filter `reading_status`, `loading_min`, `alert`, dan urut default `loading desc` dikirim ke server; ringkasan "N dari M gardu"; gardu tanpa pembacaan tetap tampil; analisis dan form pembacaan bekerja (seperti tes lama) dan form tersembunyi tanpa `substations.reading`; `?open=<id>` membuka Drawer.
- Seluruh tes yang sudah ada tetap lulus (`npm test`) dan `npm run build` sukses.
- Laporan akhir menyebut: halaman/rute yang dibuat atau diubah, file yang berubah, hasil tes + build (angka sebenarnya), hal yang belum bisa dikerjakan beserta alasannya, dan temuan yang ditulis di docs/80.
