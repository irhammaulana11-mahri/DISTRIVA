# PROMPT EKSEKUSI — Agen Frontend DISTRIVA: alur survei (dengan KKO), tanpa/dengan perluasan, lama hari layanan, dan rincian impor EIS

> Salin seluruh isi di bawah garis ini sebagai prompt untuk agen frontend. Kerjakan **setelah** `docs/PROMPT-FRONTEND-GARDU-PENGUKURAN.md` (halaman gardu dipecah di sana; panel KKO dan `SubstationPicker` yang dipakai di sini tidak berubah oleh prompt itu).

---

Kamu adalah agen frontend untuk DISTRIVA (React 19 + Vite + Tailwind di folder `frontend/`). Backend Laravel **sudah selesai dan teruji**; tugasmu membangun antarmuka untuk API yang sudah ada. **Jangan mengubah apa pun di `backend/`, `database/`, atau `tools/`.**

## Baca dulu (wajib, berurutan)
1. `docs/82-ALUR-SURVEI-KKO-KKF-DAN-IMPOR-EIS.md` — alur baru, aturan, dan keputusan pemilik (**seluruhnya wajib**).
2. `docs/57-API-CONTRACT.md` bagian **"Alur survei, KKO, KKF, dan impor EIS (docs/82)"**, lalu bagian survei (§3d), KKO, dan KKF yang sudah ada.
3. Kode yang ada (diubah, bukan ditulis ulang): `frontend/src/pages/applications/ApplicationsPage.jsx` (daftar, detail, impor), halaman/komponen survei di `frontend/src/pages/` (cari `SurveyPanel`/`Survey*`), `ApplicationKkoPanel.jsx`, `SubstationPicker.jsx`, panel KKF di `frontend/src/pages/` (cari `Kkf*`), `frontend/src/services/api.js`.

## Latar belakang (ringkas)
Survei sudah bernomor (`SRV-…`) dan sudah punya tiga penanda hasil. Yang baru: **KKO menjadi bagian survei**; survei **tanpa perluasan** diputuskan **Manager ULP saja** lalu permohonan **siap pasang**; KKF **tidak** terbit untuk yang tanpa perluasan; permohonan menampilkan **lama hari layanan** dari EIS; impor EIS menerima baris **baru** hanya berstatus **Bayar / Cetak PK**.

## Yang harus dikerjakan (urutan dan batas)
Kerjakan per bagian, jalankan `npm test` dan `npm run build` sebelum lanjut.

### A. Daftar dan detail permohonan
- **Lama hari layanan:** kolom/chip "N hari kerja" dari `service_days` (daftar dan detail); di detail tambahkan "per {tanggal `service_days_observed_at`}". Bila `null` tulis "-" (jangan 0). Jangan menambah batas warna atau perhitungan sendiri.
- **Survei:** tampilkan `survey_number` dan `survey_status` di daftar; di detail dari `data.survey` (`survey_number`, `status`, `outcome`, `accepted_at`).
- **Lencana "Siap pasang"** bila `ready_to_install` true (daftar dan detail), dengan penjelasan satu kalimat: "Survei tanpa perluasan telah diterima; status selanjutnya mengikuti data EIS". Tambahkan filter "Siap pasang" di daftar yang mengirim `ready_to_install=1` ke server (sudah didukung; jangan menyaring di klien).
- Lencana hasil survei: `NO_EXTENSION` = "Tanpa perluasan", `EXTENSION` = "Perlu perluasan", `null` = tidak ditampilkan.

### B. Formulir survei dengan KKO di dalamnya
- Di formulir survei (versi DRAFT oleh Teknik) tambahkan bagian **"Kondisi trafo dan jaringan (KKO)"** yang memuat `ApplicationKkoPanel` (pilih gardu lewat `SubstationPicker`, isian KKO, hasil pembebanan sebelum/sesudah) untuk permohonan survei itu. Satu KKO per permohonan; jangan membuat KKO kedua.
- **Hasil survei** sebagai satu pilihan yang jelas, bukan tiga penanda terpisah:
  - **Tanpa perluasan** (tidak ada JTR/JTM/trafo yang ditambah) → kirim `requires_network_extension=false`, `requires_drawing=false`, `requires_feasibility_study=false`.
  - **Perlu perluasan** → kirim `requires_network_extension=true`; `requires_drawing` dan `requires_feasibility_study` tetap dapat dipilih.
  Server menolak kombinasi lain dengan 409: tampilkan pesannya apa adanya.
- **Alasan tanpa perluasan** (`no_extension_reason`, teks): tampilkan kolomnya saat "Tanpa perluasan" dipilih. Beri petunjuk: "Wajib diisi bila KKO menunjukkan pembebanan > 100 % setelah beban baru, tegangan rendah, atau keputusan TIDAK LAYAK". **Jangan menghitung sendiri apakah wajib**; kirim apa adanya dan tampilkan 409 dari server.
- Ringkasan KKO di atas tombol Ajukan (nilai dari server: kelas sebelum/sesudah, tanda tegangan rendah, keputusan). Bila KKO belum tercatat tampilkan peringatan; **tombol Ajukan tetap aktif** (server yang menolak dengan "KKO belum dicatat…").
- Detail survei yang sudah diajukan menampilkan `kko_snapshot` (angka KKO saat diajukan, label "saat survei diajukan") dan `no_extension_reason`.

### C. Rantai persetujuan survei
- Gunakan `versions[].short_chain`. Bila **true**: stepper hanya satu langkah **Manager ULP** → "Diterima"; langkah review UP3 dan Asman tidak ditampilkan. Bila false: rantai penuh seperti sekarang. Jangan menyimpulkan dari penanda; pakai `short_chain` dan `outcome`.
- Setelah keputusan Manager ULP pada versi tanpa perluasan, `result.survey_status` = `ACCEPTED`: perbarui tampilan dan lencana "Siap pasang".
- Tombol keputusan tetap hanya dari `data.can` (jangan menyimpulkan hak dari peran).

### D. KKF
- Panel KKF: bila `GET /applications/{id}/kkf-preview` mengembalikan `blockers` berisi pesan tanpa perluasan, tampilkan pesan itu sebagai keterangan ("KKF tidak diterbitkan: survei menyatakan tanpa perluasan") dan **sembunyikan/nonaktifkan tombol Terbitkan KKF**. Server tetap menolak dengan 409 jika dipaksa.

### E. Rincian impor EIS
- Ringkasan batch (wizard impor): di samping "di luar cakupan" tampilkan rincian `OUT_OF_SCOPE_STATUS` ("status baru belum Bayar/Cetak PK") dan `OUT_OF_SCOPE_POWER` ("daya di bawah batas"). Tampilkan rincian hanya bila ada nilainya; `OUT_OF_SCOPE` tetap jumlah keduanya.
- Pada pratinjau perubahan baris `MATCHED`, `service_days` tampil sebagai "Lama hari kerja: lama → baru" (nama kolom ramah, bukan `service_days`).

## Aturan keras
- **Backend satu-satunya penentu hak akses dan aturan.** Tampilkan/sembunyikan tombol hanya dari `can` (`GET /applications/access`, `data.can` survei) dan dari nilai respons. Jangan menghitung sendiri: siap pasang, hasil survei, kewajiban alasan, kewajiban KKO, rantai pendek, KKF boleh/tidak, cakupan impor. Fail-closed bila API gagal.
- **Jangan menebak kontrak.** Bila endpoint/kolom tidak ada atau tidak jelas, **berhenti di bagian itu** dan tulis di bagian "Temuan frontend untuk backend" di akhir `docs/82`; lanjutkan bagian lain.
- Nilai kosong/`null` ditampilkan "-" atau penjelasan; **0 bukan "tidak ada"**.
- `Alert` **tidak meneruskan `data-testid`**: bungkus dengan `div` ber-`data-testid` bila perlu diuji. Jangan menulis tes yang hanya memeriksa "elemen tidak ada" tanpa membuktikan elemen itu dapat muncul.
- Token tetap di `sessionStorage`; jangan menulis token atau data pelanggan ke log atau tes. Jangan membaca atau menyalin `tools/samples/*` (berisi data pribadi) dan `tools/eis_sync/eis_session.json`; tes memakai respons tiruan berdata rekaan.
- Semua teks antarmuka berbahasa Indonesia, aksesibel (label, fokus, kontras), responsif, memakai komponen yang ada. Jangan menambah dependensi tanpa alasan kuat.

## Selesai berarti
- Tes Vitest (respons tiruan) untuk: daftar menampilkan lama hari layanan dan "-" bila kosong; lencana siap pasang dan hasil survei sesuai respons; formulir survei mengirim tiga penanda yang benar untuk "Tanpa perluasan" dan "Perlu perluasan" serta `no_extension_reason`; 409 server (KKO belum dicatat, kombinasi tidak sah, alasan wajib) tampil apa adanya dan form tidak kehilangan isiannya; stepper satu langkah bila `short_chain` true dan penuh bila false; keputusan Manager ULP yang menghasilkan `ACCEPTED` memperbarui lencana; panel KKF menyembunyikan tombol saat `blockers` memuat pesan tanpa perluasan; ringkasan impor menampilkan rincian hanya bila bernilai; pratinjau `MATCHED` menampilkan perubahan lama hari kerja. Seluruh tes yang sudah ada tetap lulus (`npm test`) dan `npm run build` sukses.
- Laporan akhir menyebut: halaman/komponen yang diubah, file yang berubah, hasil tes + build (angka sebenarnya), hal yang belum bisa dikerjakan beserta alasannya, dan temuan yang ditulis di docs/82.
