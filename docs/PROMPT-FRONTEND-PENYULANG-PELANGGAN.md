# PROMPT EKSEKUSI — Agen Frontend DISTRIVA: Master Penyulang, Master Pelanggan, dan tautan ke Master Gardu

> Salin seluruh isi di bawah garis ini sebagai prompt untuk agen frontend.

---

Kamu adalah agen frontend untuk DISTRIVA (React 19 + Vite + Tailwind di folder `frontend/`). Backend Laravel **sudah selesai dan teruji**; tugasmu membangun antarmuka untuk API yang sudah ada. **Jangan mengubah apa pun di `backend/`, `database/`, atau `tools/`.**

## Baca dulu (wajib, berurutan)
1. `docs/81-DESAIN-MASTER-PENYULANG-PELANGGAN.md` — rantai hubungan, aturan data, dan hal yang harus dipahami pembaca data (**§4 wajib**).
2. `docs/57-API-CONTRACT.md` bagian **"Master gardu (docs/80)"** dan **"Master penyulang dan master pelanggan (docs/81)"** — kontrak API yang sebenarnya.
3. `docs/80-DESAIN-MASTER-GARDU-KKO.md` §12–§14 — halaman gardu yang sudah ada dan pola yang dipakai.
4. Kode yang ada sebagai pola (tiru, jangan menciptakan gaya baru): `frontend/src/pages/master-data/SubstationsPage.jsx`, `SubstationAnalysis.jsx`, `SubstationImportModal.jsx`, `SubstationsPage.test.jsx`, `frontend/src/services/api.js` (`substationsApi`, `qs`), `frontend/src/layout/AppLayout.jsx` (menu `masterDataNav`), `frontend/src/App.jsx` (rute + `RequireCapability`), `frontend/src/features/admin/AccessContext.jsx`, komponen `Drawer`, `Alert`, `TableFooter`, `EmptyState`, `Button`.

## Yang harus dikerjakan (urutan dan batas)
Kerjakan per bagian, jalankan `npm test` dan `npm run build` sebelum lanjut, dan lapor singkat di akhir tiap bagian.

### A. API client
Tambahkan di `services/api.js` (`feedersApi`, `connectionsApi`): daftar, detail, buat/ubah penyulang, daftar/detail pelanggan, `link`. **Tidak ada fungsi unggah DIL di UI**: DIL dimuat oleh alat `tools/dil_sync`, bukan dari browser. Perluas `substationsApi.list` bila perlu (parameter `feeder_id` sudah didukung server).

### B. Halaman Master Penyulang (`/master-data/feeders`, izin `feeders.view`, menu "Master Penyulang")
- **Daftar:** kode, nama, GI (+ nomor trafo GI), **unit pemilik**, jumlah gardu, kapasitas (kVA), status. Filter: pencarian, unit pemilik, "dilayani unit" (`serves_unit_id`), GI, status. Paginasi memakai `meta`. Klik baris membuka detail.
- **Detail (Drawer lebar):**
  1. Ringkasan: pemilik, GI, status, catatan.
  2. **ULP yang dilayani** (`served_units`): tabel per ULP (gardu, kVA). Tandai bila lebih dari satu ULP ("melintasi N ULP").
  3. **Pembebanan penyulang** (`loading`): tampilkan `loading_pct` dengan keterangan cakupan "dari X gardu yang punya beban terukur"; bila `loading_pct` null tulis "belum ada beban terukur" — **jangan mengisi angka**.
  4. **Pelanggan** (`customers`): pelanggan aktif dan **"daya tersambung"** (kVA). Beri catatan kecil bahwa daya tersambung bukan beban dan tidak dibandingkan dengan kapasitas trafo (docs/81 §4).
  5. **Daftar gardu** penyulang ini: pakai `substationsApi.list({feeder_id})`, dengan tautan ke detail gardu.
  6. **Riwayat perubahan** (`history`): aksi (AUTO/CREATED/UPDATED), alasan, siapa, kapan, dan perubahan sebelum → sesudah.
- **Tambah / ubah** hanya bila `can['feeders.manage']`: formulir (kode hanya saat tambah, nama, GI, nomor trafo GI, **unit pemilik** dari daftar UP3/ULP aktif, status, catatan) dengan **alasan wajib** (min. 3 karakter). Tampilkan pesan 409/422 dari server apa adanya ("Tidak ada perubahan", "Unit pemilik di luar cakupan Anda", "Penyulang X sudah ada").

### C. Halaman Master Pelanggan (`/master-data/customers`, izin `customers.view`, menu "Master Pelanggan")
- **Daftar:** IDPEL, nama, unit, tarif, daya (VA), jenis layanan, status (AKTIF/BONGKAR/HAPUS/PROSES dengan lencana berbeda), gardu (kode, tautan), penyulang (kode), kelurahan. Filter: pencarian (angka = awalan IDPEL; huruf = nama atau no. meter), unit, penyulang, gardu, tarif, status, jenis layanan, **"belum tertaut ke gardu"** (`linked=0`). Paginasi dengan `meta` (jutaan baris: **jangan memuat semua, jangan menghitung total sendiri**).
- **Nama:** bila `name_masked` true, tampilkan nama apa adanya (bertopeng `ABC*****`) dengan lencana kecil "tersamar". **Jangan mencoba membuka atau menebak nama asli.**
- **Detail (Drawer):** semua isian, sumber tautan gardu (`link_source`: DIL = dari file DIL lewat nomor GADIS, DIL_KODE = dari file DIL lewat kode gardu pendek yang dilengkapi (tampilkan "kode dilengkapi" agar petugas tahu ini hasil pencocokan kode), KKO = dari survei, MANUAL = diputuskan petugas; MANUAL dengan gardu kosong berarti tautan sengaja dilepas, bukan "belum tertaut"), `gardu_ref` (nomor gardu dari DIL, tampilkan bila belum tertaut: "menunggu gardu masuk master"), dan permohonan terkait (`applications`).
- **Perbaiki tautan gardu** hanya bila `can['customers.manage']`: pilih gardu lewat pencarian gardu (pola yang sama dengan `SubstationPicker`, tetapi **hanya gardu di ULP pelanggan itu**: kirim `organizational_unit_id` pelanggan) lalu `PATCH …/link`; tombol "Lepas tautan" mengirim `substation_id: null`. Server menolak gardu beda ULP dengan 409: tampilkan pesannya.

### D. Tautan antar halaman (inti "saling terhubung")
> **Urutan kerja:** bagian D menyentuh halaman gardu. Kerjakan **setelah** `docs/PROMPT-FRONTEND-GARDU-PENGUKURAN.md` selesai (halaman gardu dipecah di sana: detail aset ada di Master Gardu `SubstationsPage.jsx`, bukan di Pengukuran Gardu). Bila prompt itu belum dikerjakan, lewati D dan kerjakan A–C dulu.
- **Detail gardu** (`SubstationsPage.jsx`): tampilkan penyulangnya (kode, tautan ke detail penyulang) dan kartu **Pelanggan** dari `data.customers` (pelanggan aktif, daya tersambung kVA, pelanggan besar ≥ 6.600 VA) dengan tautan "Lihat pelanggan gardu ini" ke daftar pelanggan terfilter `substation_id`. Tampilkan hanya bila `can['customers.view']` / `can['feeders.view']`.
- **Daftar gardu:** tambahkan filter penyulang (dari `feedersApi.list`) dan kolom penyulang.
- **Panel KKO** (`ApplicationKkoPanel.jsx`): respons `PUT /applications/{id}/kko` kini memuat `customer_link`. Setelah menyimpan, tampilkan satu baris info sesuai `result`: `linked`/`created` → "IDPEL {idpel} ditautkan ke gardu ini"; `kept_manual` → "Tautan pelanggan yang diperbaiki manual dipertahankan"; `ambiguous_idpel` → "Pemohon punya lebih dari satu IDPEL: tautkan manual di Master Pelanggan"; `no_idpel`/`no_customer`/null → tidak menampilkan apa pun. **Jangan memperlakukan hasil ini sebagai galat**: KKO tetap berhasil.
- Menu: tambahkan "Master Penyulang" dan "Master Pelanggan" di `masterDataNav` **tanpa** `profiles` (izin server yang menentukan), judul halaman di peta judul `AppLayout`, dan rute di `App.jsx` dengan `RequireCapability`.

## Aturan keras
- **Backend satu-satunya penentu hak akses.** Tampilkan/sembunyikan hanya dari peta `can` yang sudah dimuat `AccessContext` (kunci `feeders.view|manage`, `customers.view|import|manage` dikirim lewat `GET /applications/access`). Jangan menyimpulkan hak dari nama peran. Muat ulang halaman setelah login ulang agar peta izin baru terbaca.
- **Jangan menebak kontrak.** Bila endpoint/kolom tidak ada atau tidak jelas, **berhenti di bagian itu** dan tulis di bagian "Temuan frontend untuk backend" di akhir `docs/81`; lanjutkan bagian lain.
- **Jangan menghitung aturan bisnis di klien** (pembebanan penyulang, kelas, ULP yang dilayani, tautan). Tampilkan nilai dari server. Nilai kosong/`null` ditampilkan "-" atau penjelasan; **nilai 0 bukan "tidak ada"**.
- **Privasi:** jangan menampilkan, menyimpan, atau mengunggah NIK, NPWP, telepon, email, alamat jalan, atau koordinat pelanggan (API memang tidak mengirimnya). Jangan membaca, menyalin, atau memakai `tools/samples/DIL_SALDO_MASK_202210_51MJK.mdb`, `tools/samples/GV.xls`, atau `tools/eis_sync/eis_session.json`. Untuk tes gunakan respons tiruan dengan data rekaan.
- Token tetap di `sessionStorage`; jangan menulis token/kata sandi ke log atau tes.
- `Alert` **tidak meneruskan `data-testid`**: bungkus dengan `div` ber-`data-testid` bila perlu diuji (jangan menulis tes yang hanya memeriksa "elemen tidak ada" tanpa membuktikan elemen itu dapat muncul).
- Semua teks antarmuka berbahasa Indonesia, aksesibel (label, fokus, kontras), responsif, memakai komponen yang ada. Jangan menambah dependensi tanpa alasan kuat; jika perlu, sebut di laporan.
- Daftar besar: selalu paginasi dari server; debounce pencarian ketik (≥ 300 ms); batalkan hasil permintaan lama saat filter berubah.

## Selesai berarti
- Tes Vitest (respons tiruan, `vi.mock('../../services/api.js')`) untuk: daftar + filter penyulang dikirim ke server; detail penyulang (ULP dilayani, pembebanan null → penjelasan, daftar gardu, riwayat); formulir penyulang mewajibkan alasan dan menampilkan pesan server; tombol tulis tersembunyi tanpa izin; daftar pelanggan + filter `linked=0`; nama bertopeng menampilkan lencana; perbaikan tautan hanya menawarkan gardu se-ULP dan mengirim `substation_id` (juga `null`); kartu pelanggan pada detail gardu; info `customer_link` pada panel KKO untuk tiap `result`. Seluruh tes yang sudah ada tetap lulus (`npm test`) dan `npm run build` sukses.
- Laporan akhir menyebut: halaman/rute yang dibuat, file yang berubah, hasil tes + build (angka sebenarnya), hal yang belum bisa dikerjakan beserta alasannya, dan temuan yang ditulis di docs/81.
