# 57 — DISTRIVA Frontend Design & Implementation Report

## 1. Identifikasi Proyek & Baseline Source
- **Platform**: DISTRIVA (Distribution Management Platform) — Frontend Web UI
- **Versi Frontend**: `0.1.0` (selaras dengan `package.json`)
- **Versi Dokumentasi Baseline**: `3.16.0` (mengacu pada `PACKAGE-MANIFEST.json` dan dokumen 00–56)
- **Teknologi**:
  - React 19 (`^19.3.1`) & React DOM (`^19.3.1`)
  - React Router DOM v7 (`^7.18.5`)
  - Vite v8 (`^8.3.6`) dengan plugin `@vitejs/plugin-react`
  - Tailwind CSS v4 (`^4.3.4`) melalui `@tailwindcss/vite`
  - Vitest v5 (`^5.1.0`) dan Testing Library React (`^16.3.3`)
- **Backend API Authority**: Laravel 13.x API dengan Laravel Sanctum Bearer Token, guard `web`, otorisasi `ScopedAuthorizationService`, dan middleware `EnsureActiveAccount`.

---

## 2. Hasil Audit Awal & Kepatuhan Arsitektur
1. **Sumber Kebenaran**: Backend Laravel adalah satu-satunya sumber validasi, scope, dan otorisasi. Frontend bertindak sebagai client presentasi dan tidak pernah mengasumsikan hak akses secara implisit.
2. **Prinsip Fail-Closed**: Setiap rute modul atau kontrol aksi yang endpoint API atau hak otorisasi backend-nya belum terverifikasi ditutup atau dinonaktifkan secara aman.
3. **Penyimpanan Kredensial**: Token autentikasi disimpan secara aman di `sessionStorage` (otomatis dibersihkan saat tab/browser ditutup), tidak disimpan di `localStorage`, dan tidak pernah dicetak ke log konsol.
4. **Proteksi Password**: Password sementara tidak pernah ditampilkan kembali di antarmuka; sistem hanya mengabarkan kanal pengiriman (Email / WhatsApp) sesuai laporan delivery backend.
5. **Ketiadaan Data Palsu (No Mocking as Real Data)**: Modul yang belum memiliki endpoint backend aktif tidak diisi data palsu seolah-olah data produksi, melainkan disajikan melalui *Status Matriks Kesiapan*, *Workflow Explorer*, dan *Simulator Validasi Form* bertanda jelas non-produksi.

---

## 3. Keputusan Desain & Design System
- **Konsep Visual**: *Modern Enterprise SaaS* yang bersih, fungsional, dan data-dense, dirancang khusus untuk efisiensi operasional jaringan tenaga listrik.
- **Design Tokens (Tailwind v4 CSS-first)** diatur pada `frontend/src/index.css`:
  - **Brand Tokens**: `brand-50` hingga `brand-950` (palet biru operasional PLN).
  - **Sidebar Tokens**: `slate-900` dengan kontras tinggi, aksen `blue-600` untuk status aktif, dan teks `slate-400`.
  - **Status Semantik dengan Dot Indicator Menyala**:
    - *ACTIVE / APPROVED / SUCCESS*: Hijau Emerald (`bg-emerald-50 text-emerald-800 border-emerald-200/80`) dengan dot `bg-emerald-500` berkedip (pulsing).
    - *PENDING_ACTIVATION / PENDING_BACKEND / WARNING*: Amber (`bg-amber-50 text-amber-800 border-amber-200/80`) dengan dot `bg-amber-500`.
    - *SUSPENDED / REJECTED / ERROR*: Rose (`bg-rose-50 text-rose-800 border-rose-200/80`) dengan dot `bg-rose-500`.
    - *IN_PROGRESS*: Cyan (`bg-cyan-50 text-cyan-800 border-cyan-200/80`) dengan dot `bg-cyan-500`.
    - *INACTIVE / NEUTRAL*: Slate (`bg-slate-100 text-slate-700 border-slate-200`) dengan dot `bg-slate-400`.
- **Shared Components**:
  - `Button.jsx`: Dukungan varian `primary`, `secondary`, `danger`, `ghost` dengan indikator loading spinner dan focus ring.
  - `Card.jsx` & `CardHeader`: Wadah kontainer berstandar enterprise dengan pembatas border dan padding responsif.
  - `Skeleton.jsx`: Placeholder loading (*TableSkeleton* & *CardSkeleton*) bebas CLS (*Cumulative Layout Shift*).
  - `icons.jsx`: Koleksi ikon SVG inline mandiri (bebas dependensi eksternal tambahan).
  - `StatusBadge.jsx`: Label status terpadu dengan dot indicator semantik konsisten di seluruh modul.
  - `Alert.jsx`: Komponen notifikasi multi-varian (`error`, `warning`, `success`, `info`) dengan role aksesibilitas (`alert` / `status`).
  - `Pagination.jsx`: Kontrol navigasi data server-side dengan disabled state.
  - `ReasonDialog.jsx`: Dialog modal konfirmasi aksi berisiko dengan kolom alasan wajib audit.

---

## 4. Struktur Shell Aplikasi & Alur Bisnis
1. **End-to-End Distribution Workflow Pipeline Stepper (`HomePage.jsx`)**:
   - Visualisasi alur sekuensial 8 langkah rantai pasok pekerjaan penyambungan listrik PLN:
     `1. PB/PD` &rarr; `2. Survey` &rarr; `3. Drawing` &rarr; `4. Auto MTO` &rarr; `5. RAB & KKF` &rarr; `6. RKM` &rarr; `7. SPK/WO` &rarr; `8. BASTP`.
   - Masing-masing langkah dapat diklik langsung untuk membuka status kontrak dan alur lifecycle modul terkait.
2. **Kategori Filter Matriks Modul**:
   - Filter tab cepat di atas tabel matriks: `Semua`, `Fondasi Sistem`, `Operasional Jaringan`, `Perencanaan Sistem`, `Finansial & Investasi`, `Pelaksanaan Pekerjaan`, `Manajerial`, `Master Data`.
3. **Sidebar Responsif (`AppLayout.jsx`)**:
   - Header brand DISTRIVA dengan penanda visual.
   - Menu Utama: Beranda, Profil Akun, Ubah Password.
   - Menu Administrasi: Ditampilkan dinamis hanya jika server melaporkan capability (`users.view`, `organizational_units.view`).
   - Accordion Modul Distribusi: Memuat seluruh domain bisnis roadmap DISTRIVA.
   - Mobile Drawer: Otomatis menutup saat link diklik atau tombol `Escape` ditekan.
4. **Topbar**:
   - Breadcrumb dinamis (`DISTRIVA / {Halaman}`).
   - Indikator scope aktif: `Scope: SAME_UNIT`.
   - Ringkasan user (Nama & Badge Status Akun).
   - Tombol `Keluar` (Logout).
5. **Keyboard Shortcuts**:
   - Menekan tombol `/` pada halaman pengguna langsung memfokuskan kursor ke kolom pencarian `Cari nama / email`.

---

## 5. Matriks Audit Modul & Kesiapan Integrasi Endpoint

| Area / Modul | Status Frontend | Status Backend API | Aturan Akses & Keterangan |
|---|---|---|---|
| **Autentikasi & Sesi** | Selesai & Terintegrasi | Aktif (`/api/auth/*`, `/api/me`) | Token Sanctum, lockout proteksi, idle sliding expiry. |
| **MFA TOTP SYS_ADMIN** | Selesai & Terintegrasi Penuh (docs/57 §3b) | Aktif (`/api/auth/mfa/*`) | Pendaftaran TOTP RFC 6238, QR code SVG native, secret key manual, verifikasi token, 8 kode pemulihan darurat sekali tampil (copy & download .txt), proteksi 5 kali salah kunci 15 menit, konsol reset `distriva:mfa-reset`. |
| **Profil Pengguna** | Selesai & Terintegrasi | Aktif (`/api/me`) | Menampilkan data NIP, email, telepon, status akun, dan status MFA. |
| **Ubah Password** | Selesai & Terintegrasi | Aktif (`/api/me/password`) | Validasi 5 riwayat password, karakter kompleks, pembatalan token lain. |
| **Administrasi Pengguna** | Selesai & Terintegrasi | Aktif (`/api/admin/users*`) | Filter search/status, pagination server-side, shortcut `/`, re-issue kredensial, perubahan status akun. |
| **Unit Organisasi** | Selesai & Terintegrasi Penuh (CRUD) | Aktif (`/api/admin/organizational-units`) | Struktur hierarki unit PLN (UP3, ULP), filter tipe & pencarian, pagination server-side, Modal Tambah Unit, Modal Edit Unit (O-030 immutability), Modal Detail & Riwayat Audit (`organizational_unit_histories`), serta Aksi Nonaktifkan/Aktifkan via `ReasonDialog` (larangan hard delete). |
| **Master Data** | Selesai & Terintegrasi Penuh | Aktif (`/api/master-data/*`) | Katalog material ERP, KHS 518 item berversi, standar konstruksi & BOM, kategori & satuan, unduh template CSV impor. |
| **Aplikasi PB/PD** | Selesai & Terintegrasi Penuh (Tahap 1A, docs/57 §3c, docs/62) | Aktif (`/api/applications*`) | Pendaftaran agenda PB/PD, validasi input pelanggan & daya listrik, status DRAFT → SUBMITTED & pembatalan dengan audit log, penautan referensi eksternal (No. Agenda/Register), scope ULP. |
| **Survey Lapangan & Meter** | Informatif (Status & Tabs) | Menunggu Backend | Lifecycle siap (docs/39), rute API belum tersedia. |
| **Drawing & Desain Teknis** | Informatif (Status & Tabs) | Menunggu Backend | Spesifikasi dokumen siap (docs/09, docs/26), storage setup (docs/21). |
| **Kalkulasi Auto MTO** | Informatif (Status & Tabs) | Menunggu Backend | Desain token broker Python (docs/13, docs/26); integrasi Python belum dibekukan. |
| **RKM (Rencana Kerja Material)** | Informatif (Status & Tabs) | Menunggu Backend | Validasi stok gudang ULP (docs/10, docs/12), rute API belum tersedia. |
| **RAB & KKF Engine** | Informatif (Status & Tabs) | Menunggu Backend | Formula kelayakan finansial siap (docs/08, docs/41), rute API belum tersedia. |
| **Work Order (SPK Jaringan)** | Informatif (Status & Tabs) | Menunggu Backend | Workflow approval siap (docs/40), vendor deny-all (docs/34), rute API belum tersedia. |
| **Pelaporan Eksekutif** | Informatif (Status & Tabs) | Menunggu Backend | Endpoint agregasi manajerial belum aktif. |

---

## 6. Struktur Direktori Frontend yang Dipertahankan & Ditambahkan
```
frontend/
├── index.html
├── package.json
├── package-lock.json
├── vite.config.js
└── src/
    ├── App.jsx                        # Routing utama & Capability guards
    ├── App.test.jsx                   # Suite pengujian 32 test cases (PASS)
    ├── index.css                      # Tailwind v4 theme & CSS tokens
    ├── main.jsx                       # Entry point aplikasi
    ├── components/
    │   ├── Alert.jsx                  # Notifikasi multi-status
    │   ├── Button.jsx                 # [Ditambahkan] Tombol standar enterprise
    │   ├── Card.jsx                   # [Ditambahkan] Komponen Card & CardHeader
    │   ├── Components.test.jsx        # [Ditambahkan] Suite pengujian shared components & tabs (PASS)
    │   ├── Field.jsx                  # Input field dengan error server
    │   ├── icons.jsx                  # [Ditambahkan] Ikon SVG mandiri
    │   ├── Modal.jsx                  # Modal overlay dengan Escape listener
    │   ├── Pagination.jsx             # Kontrol pagination data
    │   ├── ReasonDialog.jsx           # Dialog audit reason
    │   ├── Skeleton.jsx               # [Ditambahkan] Skeleton loader (Table & Card)
    │   ├── Spinner.jsx                # Loading indicator
    │   └── StatusBadge.jsx            # [Disempurnakan] Badge status dengan dot indicator
    ├── design/
    │   └── tokens.js                  # [Ditambahkan] Token JavaScript design system
    ├── features/
    │   ├── admin/
    │   │   ├── AccessContext.jsx      # Provider kemampuan otorisasi server
    │   │   └── delivery.js            # Parser laporan delivery Email/WhatsApp
    │   ├── auth/
    │   │   └── AuthContext.jsx        # Provider sesi login & token
    │   └── modules/
    │       └── moduleRegistry.js      # [Ditambahkan] Registri domain, alur kerja, & matriks status
    ├── layout/
    │   └── AppLayout.jsx              # Shell aplikasi, Sidebar drawer, Topbar
    ├── pages/
    │   ├── ChangePasswordPage.jsx     # Form ganti password & policy checklist
    │   ├── HomePage.jsx               # [Disempurnakan] Pipeline stepper & category filter
    │   ├── LoginPage.jsx              # Form otentikasi pengguna
    │   ├── ModuleStatusPage.jsx       # [Ditambahkan] Halaman status, kontrak, lifecycle, & simulator
    │   ├── NotFoundPage.jsx           # Halaman 404 / Akses ditolak
    │   ├── ProfilePage.jsx            # Detail profil pengguna & sesi
    │   └── admin/
    │       ├── NewUserPage.jsx        # Pembuatan user & penetapan awal
    │       ├── UnitsPage.jsx          # [Disempurnakan] Daftar unit kerja organisasi & filter tipe/search
    │       └── UserDetailPage.jsx     # Detail akun, role assignments & status
    ├── services/
    │   └── api.js                     # Klien API terpusat
    └── test/
        └── setup.js                   # Konfigurasi testing Vitest
```

---

## 7. Instruksi Menjalankan Frontend

### Prasyarat:
- Node.js versi 18 atau lebih tinggi
- NPM versi 9 atau lebih tinggi

### Menjalankan Development Server:
```bash
cd frontend
npm install
npm run dev
```
Aplikasi berjalan pada `http://localhost:5173`. Request ke `/api/*` secara otomatis di-proxy ke backend Laravel (`http://127.0.0.1:8000`).

### Menjalankan Pengujian (Testing Suite):
```bash
cd frontend
npm test
```

### Menjalankan Production Build:
```bash
cd frontend
npm run build
```
Hasil build disimpan pada direktori `frontend/dist/`.

---

## 8. Laporan Hasil Verifikasi & Pengujian
- **Linter / Type Check**: **`PASS`** (Semua komponen JSX dan CSS valid).
- **Unit & Integration Test (Vitest)**: **`PASS`** (2 test files, **44 test cases lulus 100%**, 0 failed).
- **Production Build (`vite build`)**: **`PASS`** (Waktu build: 785ms, output: `dist/assets/index-CgNStord.js` [398.49 KB / gzip: 113.18 KB] & `dist/assets/index-BSnfWKBb.css` [54.46 KB / gzip: 9.40 KB]).
- **Backend PHPUnit Unit Tests**: **`PASS`** (81 tests, 157 assertions, 0 failed).
- **Integritas Backend & Database**: **ZERO DESTRUCTIVE DATABASE OPERATIONS**. Tidak ada `migrate:fresh`, `db:wipe`, atau modifikasi skema destruktif. Endpoint CRUD Unit Organisasi menggunakan write service `OrganizationalUnitWriteService` yang terisolasi dan mencatat histori audit secara append-only.

---

## 9. Penyempurnaan UI: Split-Screen Authentication Layout & User Header Dropdown
1. **Desain Halaman Login Split-Screen Enterprise (`LoginPage.jsx`)**:
   - Menerapkan tata letak *split-screen* modern (50/50 desktop):
     - **Sisi Kiri (Brand Panel)**: Latar belakang gradient biru PLN yang kaya (`from-blue-700 via-blue-600 to-indigo-800`), identitas logo DISTRIVA, judul besar *"Sistem Manajemen Distribusi & Operasional Jaringan"*, serta penjelasan komprehensif alur kerja operasional.
     - **Sisi Kanan (Form Panel)**: Wadah kartu mengambang putih (`rounded-3xl shadow-xl border border-slate-100`) dengan ikon login terpadu, judul *"Selamat Datang Kembali"*, input bergaya modern dengan ikon `IconMail` dan `IconLock`, kolom label uppercase (`ALAMAT EMAIL`, `KATA SANDI (PASSWORD)`), tombol submit *"Masuk ke Sistem"*, serta tautan terhubung *"Aktivasi akun baru"* dan *"Lupa password / akun terkunci?"*.
2. **Penyelarasan Menu Publik Terhubung (`OtpPage.jsx`)**:
   - Halaman **Aktivasi Akun Pegawai** (`/aktivasi`) dan **Pemulihan Akses Akun** (`/pemulihan`) kini mengadopsi struktur *split-screen* yang identik dan konsisten, lengkap dengan navigasi kembali ke halaman masuk.
3. **Penyatuan Menu Profil & Ubah Password (`ProfilePage.jsx`)**:
   - Menu *Profil* dan *Ubah Password* pada sidebar kiri dilebur menjadi satu halaman komprehensif: **`Profil & Keamanan Akun`** (`/profil`).
   - Menyediakan tab terpadu: **Informasi Profil** dan **Ubah Password & Keamanan** (lengkap dengan validasi Doc 16).
4. **Header User Profile Dropdown (`AppLayout.jsx`)**:
   - Menggantikan tombol logout statis dan teks biasa dengan **User Profile Dropdown** profesional di topbar.
   - Pemicu (*Trigger*): Avatar inisial dengan pulsing dot status aktif, nama pengguna, label status, dan panah bawah.
   - Menu panel mengambang: Menampilkan kartu info pengguna, tautan ke *Profil & Keamanan Akun*, *Ubah Password*, serta tombol *Keluar* merah lembut.
5. **Sidebar Ramping**:
   - Kategori *Menu Utama* pada sidebar kiri kini hanya memuat **Beranda**, menjadikan navigasi operasional lebih fokus dan bersih.

---

## 10. Fitur CRUD Unit Organisasi yang Diimplementasikan
1. **Pencegahan Mutasi Kolom Permanen (O-030)**: Kolom `code`, `unit_type`, dan `parent_id` bersifat immutable setelah dibuat. Form edit hanya mengizinkan perubahan `name`, `address`, dan `is_active`.
2. **Larangan Hard Delete (Doc 54 §4 Aturan 10)**: Tidak ada endpoint atau tombol DELETE fisik. Penutupan unit dilakukan melalui penonaktifan (`is_active: false`) dengan pencatatan alasan audit wajib.
3. **Pencatatan Audit Trail Transaksional**: Setiap pembuatan dan perubahan unit otomatis tercatat pada tabel `organizational_unit_histories` lengkap dengan nilai lama, nilai baru, timestamp, actor, dan alasan perubahan.
4. **Validasi Hierarki PLN**: Pembuatan unit tingkat UP3 dibatasi untuk `SYS_ADMIN` dan tidak boleh memiliki induk; unit tingkat ULP wajib memiliki induk UP3 yang aktif. Penonaktifan unit UP3 yang masih memiliki ULP anak yang aktif dicegah oleh sistem.
5. **Modal Terpadu**:
   - `CreateUnitModal`: Pembuatan unit baru dengan pemilihan tipe dan induk aktif.
   - `EditUnitModal`: Modifikasi nama dan alamat dengan notifikasi peringatan kolom immutable.
   - `UnitDetailModal`: Tampilan hierarki unit lengkap, daftar unit anak, dan linimasa riwayat audit dari `organizational_unit_histories`.
   - `ReasonDialog`: Dialog konfirmasi aksi penonaktifan/pengaktifan kembali unit dengan input alasan wajib.

---

## 11. Known Limitations & Langkah Pengembangan Selanjutnya
1. **Penyelesaian Endpoint Domain Operasional**: Modul-modul bisnis seperti Master Data, PB/PD, Survey, Drawing, Auto MTO, RKM, RAB/KKF, dan Work Order masih menunggu rute API resmi di backend Laravel sesuai rancangan dokumen 13, 24, 26, 38, 39, 40, dan 41.
2. **Koneksi Engine Python (Auto MTO & Forecasting)**: Menunggu pembekuan token broker terisolasi di sisi backend Laravel.
3. **Penyempurnaan Integrasi Backend**: Setelah endpoint backend diimplementasikan oleh tim backend, form simulator pada masing-masing modul dapat langsung dialihkan ke panggilan API langsung melalui `services/api.js`.

---

## 12. Peningkatan Tampilan Layar Penuh, Notifikasi & Mode Gelap/Terang
1. **Lebar Konten Layar Penuh (Edge-to-Edge Fluid Layout)**:
   - Menghapus pembatas statis `max-w-7xl mx-auto` pada kontainer `<main>` di `AppLayout.jsx`.
   - Menggantinya dengan layout dinamis responsif `w-full px-4 sm:px-6 lg:px-8 py-5`, sehingga tata letak kartu, matriks, dan tabel merentang mendekati batas pinggir layar sesuai preferensi tampilan pada referensi Gambar 1.
2. **Pengalih Mode Gelap / Terang (Dark / Light Mode Toggle)**:
   - Dilengkapi tombol ikon (`IconSun` / `IconMoon`) di header kanan atas.
   - Menggunakan konfigurasi CSS Tailwind v4 via `@custom-variant dark (&:where(.dark, .dark *));` pada `index.css`.
   - Terintegrasi dengan deteksi preferensi sistem (`prefers-color-scheme`) dan persistensi `localStorage.getItem('distriva.theme')`.
   - Komponen antarmuka (`AppLayout`, `Card`, `HomePage`, `UnitsPage`, `UsersPage`, dll.) telah dilengkapi token styling gelap (`dark:bg-slate-900`, `dark:border-slate-800`, `dark:text-slate-100`, `dark:hover:bg-slate-800`).
3. **Pusat Notifikasi Operasional (Notifications Center)**:
   - Tombol bel notifikasi (`IconBell`) dengan penanda numerik (*badge*) untuk item belum dibaca.
   - Panel mengambang interaktif (*Dropdown Panel*) yang menampilkan status notifikasi sistem (contoh: pembaruan hierarki unit organisasi, rotasi keamanan kredensial, dan otorisasi sesi).
   - Fitur "Tandai semua dibaca" dan interaktivitas klik per item untuk mengubah status baca secara instan.
   - Aksesibilitas penuh: penutupan otomatis saat klik di luar area (*click-outside*) atau saat tombol `Escape` ditekan.

---

## 13. Standarisasi Layout Halaman Tabel Baku (Standardized Table Layout)
Mengikuti acuan desain antarmuka enterprise modern (`10.5.119.251:8081/branches`), seluruh halaman bertabel di DISTRIVA distandarisasi ke dalam struktur visual yang konsisten:
1. **Header Halaman di Luar Kartu (*Outer Page Header*)**:
   - *Eyebrow / Kicker*: Teks kategori kecil huruf besar (`text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400`).
   - *Judul Halaman*: Tipografi tegas dan berbobot (`text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100`).
   - *Deskripsi / Subtitle*: Penjelasan fungsi dan boundary otorisasi operasional yang jelas.
   - *Tombol Aksi Utama*: Tombol hijau/emerald modern (`+ Tambah Unit`, `+ Tambah pengguna`) di sisi kanan atas sejajar dengan judul.
2. **Kartu Tabel Baku (*Main Standardized Table Card*)**:
   - Kontainer membulat halus (`rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs`).
   - *Toolbar Pencarian & Filter Terpadu*:
     - Kolom input pencarian dengan ikon kaca pembesar (`IconSearch`) di sisi dalam sebelah kiri.
     - Dropdown filter status/tipe yang rapi dengan sudut membulat.
     - Tombol *Reset* dan tombol muat ulang data (`IconRefresh`).
3. **Struktur & Tipografi Tabel**:
   - Header tabel menggunakan teks abu-abu terang huruf besar dengan tracking lebar (`text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider`) dan indikator arah.
   - Kolom entitas utama menyajikan nama tebal dengan kode/identitas di bawahnya secara rapi.
   - Kolom status menyajikan badge pil bulat bersinar (`StatusBadge`).
   - Kolom aksi menyajikan jajaran ikon minimalis (`IconEye` untuk Detail, `IconPencil` untuk Edit, `IconPower` untuk Nonaktifkan/Aktifkan).
4. **Footer Paginasi Baku (*Standardized Pagination Footer*)**:
   - Sisi kiri: Ringkasan `Menampilkan X–Y dari Z`.
   - Sisi kanan: Pilihan `Per halaman [ 10 ⌄ ]`, tombol `Sebelumnya`, indikator `Hal. A/B`, dan tombol `Berikutnya`.
   - Diimplementasikan seragam pada [`UnitsPage.jsx`](file:///media/data/PROJECT/DISTRIVA/frontend/src/pages/admin/UnitsPage.jsx), [`UsersPage.jsx`](file:///media/data/PROJECT/DISTRIVA/frontend/src/pages/admin/UsersPage.jsx), [`HomePage.jsx`](file:///media/data/PROJECT/DISTRIVA/frontend/src/pages/HomePage.jsx), dan [`Pagination.jsx`](file:///media/data/PROJECT/DISTRIVA/frontend/src/components/Pagination.jsx).

---

## 14. Standarisasi Slide-Over Drawer Preview & Edit serta Badge Notifikasi CRUD Terpadu

Sesuai arahan perbaikan antarmuka pengguna untuk interaksi yang lebih modern, cepat, dan tidak mengganggu alur kerja (*unobtrusive workflow*):

1. **Komponen Baku Slide-over Drawer (`Drawer.jsx`)**:
   - Menggantikan modal *dialog popup* di tengah layar yang menutup pandangan tabel.
   - Drawer meluncur halus (*slide-in-from-right*) dari sisi kanan layar dengan *backdrop blur* halus.
   - Dilengkapi *eyebrow*, *title*, *subtitle*, tombol penutup silang (Esc), area isi dengan *smooth scrolling*, dan *footer* aksi yang terkunci di bagian bawah.
   - Mematuhi standar aksesibilitas WAI-ARIA (`role="dialog"`, `aria-modal="true"`) dan kompatibel penuh dengan pengujian Vitest.
2. **Penyatuan Baku Preview & Edit melalui Drawer**:
   - **Preview Detail Unit (`UnitDetailDrawer`)**: Menampilkan rincian hierarki unit kerja (Pusat, UID, UP3, ULP), unit induk, unit anak, dan *timeline* audit trail mutasi unit (`organizational_unit_histories`) dalam format vertikal yang bersih.
   - **Edit Unit Kerja (`EditUnitDrawer`)**: Menampilkan formulir pembaruan nama dan alamat unit, peringatan prinsip append-only O-030 (kode unit, tipe, dan induk bersifat permanen/immutable), serta kolom wajib input alasan perubahan audit.
3. **Pemberitahuan Badge Notifikasi pada Seluruh Proses CRUD**:
   - Dibangun melalui [`NotificationContext.jsx`](file:///media/data/PROJECT/DISTRIVA/frontend/src/features/notifications/NotificationContext.jsx) dengan hook `useNotifications()`.
   - Setiap aksi CRUD di seluruh aplikasi memicu dua saluran notifikasi secara *real-time*:
     1. **Floating Toast Badge**: Muncul mengambang di pojok kanan atas dengan penanda warna (*emerald* untuk sukses, *amber* untuk peringatan/nonaktif, *blue* untuk info), tag modul, pesan deskriptif, dan *auto-dismiss* dalam 4.5 detik.
     2. **Pusat Notifikasi Header**: Angka lencana (*badge counter*) pada ikon bel bertambah secara otomatis, dan daftar notifikasi diperbarui secara langsung.
   - Diterapkan pada seluruh proses:
     - **Unit Organisasi**: Tambah unit baru, ubah nama/alamat via drawer, serta deaktifasi / reaktifasi unit.
     - **Pengguna**: Pendaftaran pengguna baru dan penyiapan surat undangan aktivasi.
     - **Manajemen Akses & Penugasan**: Perubahan status akun pengguna, penetapan penugasan peran/unit baru, pengakhiran masa penugasan, dan pengiriman ulang kode aktivasi.
     - **Keamanan Kredensial**: Pembaruan kata sandi akun pada halaman profil.

---

## 15. Standarisasi Drawer Pengguna, Ikon Aksi Dinamis (Delete vs Nonaktif), dan Modal Konfirmasi Reusable

Sesuai permintaan penyempurnaan alur kerja pengguna:

1. **Aktivasi CRUD Menu Unit Organisasi**:
   - Backend `config/distriva_permissions.php` mengizinkan `UP3_ADMIN` dan `SYS_ADMIN` untuk `organizational_units.create` dan `organizational_units.update` dalam cakupan hierarki (UP3 mengelola ULP anak).
   - Seluruh 3 aksi unit kerja distandarisasi menggunakan Drawer:
     - **Tambah Unit**: `CreateUnitDrawer`
     - **Edit Unit**: `EditUnitDrawer`
     - **Preview Unit**: `UnitDetailDrawer`
   - Tombol `+ Tambah Unit`, `Edit`, dan `Status` dijamin selalu aktif dan siap digunakan.

2. **Ikon Aksi Dinamis Menu Pengguna (`UsersPage.jsx`)**:
   - **Preview** (`IconEye`): Membuka `UserPreviewDrawer`.
   - **Edit** (`IconPencil`): Membuka `UserEditDrawer`.
   - **Delete** (`IconTrash`): Ditampilkan secara otomatis jika pengguna **belum tertaut** dengan data/transaksi tabel lain (contoh: akun berstatus `PENDING_ACTIVATION` tanpa penugasan). Membuka modal konfirmasi hapus permanen.
   - **Nonaktif** (`IconPower`): Ditampilkan secara otomatis jika pengguna **sudah tertaut** dengan data penugasan atau hierarki organisasi. Membuka modal konfirmasi nonaktif yang mewajibkan input alasan untuk audit log (kepatuhan O-030).

3. **Drawer Khusus Menu Pengguna (Fungsi, Tampilan, dan Tombol Dibedakan)**:
   - **`UserPreviewDrawer`**: Tampilan profil informatif *read-only*, rincian NIP, kontak, kredensial, daftar penugasan aktif/berakhir (`user_role_assignments`), dan tautan ke halaman detail lengkap. Tombol footer: "Tutup" dan "Ubah Data".
   - **`UserEditDrawer`**: Formulir pembaruan profil (Nama, NIP, Phone, Status Akun) dengan email yang terkunci *read-only*, serta kolom alasan perubahan. Tombol footer: "Batal" dan "Simpan Perubahan".
   - **`UserCreateDrawer`**: Formulir pendaftaran pengguna baru, email kedinasan, penugasan peran & unit awal, dokumen SK, dan penjelasan kebijakan aktivasi mandiri via OTP (Doc 16). Tombol footer: "Batal" dan "Daftarkan & Kirim Undangan".

4. **Komponen Modal Konfirmasi Reusable (`ConfirmationModal.jsx`)**:
   - Komponen modal serbaguna yang dapat digunakan di semua halaman untuk konfirmasi tindakan destruktif maupun operasional.
   - Mendukung varian:
     - `danger`: Untuk penghapusan (aksen merah, ikon `IconTrash`).
     - `warning`: Untuk penonaktifan status (aksen oranye/amber, ikon `IconPower`, input alasan audit wajib).
     - `info`: Untuk tindakan konfirmasi umum.

---

## 16. Integrasi Frontend Modul Master Data & Standar Konstruksi (T4.2.2)

Pada tanggal 6 November 2026, modul **Master Data & Standar Konstruksi** yang telah selesai di backend berhasil diintegrasikan secara penuh ke dalam antarmuka frontend DISTRIVA:

### 1. Halaman & Fitur yang Diintegrasikan
- **Katalog Material ERP (`/master-data/materials`)**:
  - Tabel master SKU terpusat dengan filter pencarian kode/nama, filter 9 kategori, filter status aktif, dan filter khusus material belum terpetakan (*unmapped*).
  - **Slide-over Drawer Detail**: Menampilkan rincian SKU, spesifikasi teknis, sistem sumber (ERP), dan *timeline* riwayat audit perubahan (`change_logs`).
  - **Slide-over Drawer Edit**: Pembaruan kategori standar dan status aktif dengan kewajiban pengisian alasan audit (O-030).
  - **Two-Phase Staging Import**: Pratinjau batch impor CSV sebelum komit ke master (menampilkan jumlah Insert, Update, Unchanged, Rejected, serta persetujuan perubahan satuan).
- **Katalog Harga Satuan / KHS (`/master-data/khs`)**:
  - Tabel 518 item KHS standar PLN dengan pengurutan numerik alami (1–518), status versi aktif, dan indikator draf tertunda.
  - **Detail & Riwayat Versi**: Menampilkan versi aktif, riwayat versi lama, dan lini masa peristiwa per versi (`khs_version_events`).
  - **Koreksi Draf**: Pengeditan draf versi oleh tim Engineering/Perencanaan sebelum approval.
  - **Persetujuan SoD**: Modal persetujuan versi resmi KHS khusus `UP3_MANAGER` (menegakkan aturan bahwa pembuat draf tidak dapat menyetujui versinya sendiri).
  - **Impor KHS CSV**: Mendukung mode uji coba (*Dry Run*) dan penetapan tanggal mulai berlaku (`valid_from`).
- **Standar Konstruksi Distribusi & BOM (`/master-data/constructions`)**:
  - Filter kelompok tab: SUTM, MVTIC, SUTR, SKTM, Kubikel, GTT Umum, GTT Khusus, Estetika, PBPD.
  - Tampilan jumlah komponen KHS per jenis konstruksi.
  - **Detail & BOM Preview**: Menampilkan tabel pemetaan kebutuhan komponen KHS (`sequence`, `khs_code`, `khs_name`, `khs_unit`, `relation`, `note`).
  - Persetujuan versi standar konstruksi.
- **Kategori & Satuan Pengukuran (`/master-data/categories`)**:
  - Tab navigasi untuk 9 kategori material standar distribusi dan satuan pengukuran (*Units of Measure*).
  - Formulir Drawer penambahan dan pengeditan kategori dan satuan.

### 2. Status Verifikasi
- **Vitest Frontend**: **50 / 50 test lulus** (termasuk test suite baru `MasterData.test.jsx`).
- **Vite Production Build**: **Berhasil tanpa error** dalam 743ms.
- **Backend PHPUnit**: **81 / 81 test lulus**.
- **Backup Archive**: Diperbarui pada `DISTRIVA-frontend-v0.1.0-2026-11-06.zip`.

---

## 17. Integrasi Frontend Permohonan PB/PD Tahap 1A (docs/57 §3c, docs/62)

Pada tanggal 6 November 2026, antarmuka **Permohonan Pelanggan (PB/PD)** Tahap 1A diimplementasikan dan diverifikasi sesuai spesifikasi kontrak API `docs/57 §3c` dan arsitektur `docs/24` serta `docs/62`:

### 1. Halaman & Fitur Utama (`/permohonan`)
- **Tabel Permohonan Terstandarisasi**:
  - Tampilan *flush edge-to-edge* dengan header konsisten, penanda nomor agenda dan tipe layanan (`PB` / `PD`), nama pelanggan, unit kerja ULP, alamat lokasi layanan, delta daya kVA, status operasional, dan timestamp.
  - **Toolbar Filter & Pencarian**: Pencarian multi-kunci (nomor permohonan, nama pelanggan, IDPEL, nomor agenda eksternal), filter jenis layanan (PB/PD), filter status (`DRAFT`, `SUBMITTED`, `CANCELLED`), dan filter unit ULP dengan shortcut keyboard `/`.
  - **Paginasi Baku Enterprise**: Dilengkapi kontrol paginasi lengkap (`Menampilkan from-to dari total`), pemilih data per halaman (`10`, `25`, `50`, `100`), dan navigasi halaman sebelumnya/berikutnya.
- **Drawer Formulir Permohonan Baru (`ApplicationCreateDrawer`)**:
  - Pemilihan unit ULP terotorisasi (berdasarkan `create_units` dari `/api/applications/access`).
  - Toggle segmented `Pasang Baru (PB)` vs `Perubahan Daya (PD)` dengan default jenis transaksi otomatis.
  - Input data pelanggan: nama lengkap, nomor telepon (disimpan string, wajib sebelum diajukan ke survey), email, dan ID Pelanggan (IDPEL).
  - Alamat lengkap persil/lokasi penyambungan.
  - Spesifikasi tarif dan daya:
    - Untuk PB: tarif baru, nilai daya baru, dan satuan (`VA` / `kVA`).
    - Untuk PD: tarif & daya lama + tarif & daya baru, dengan kalkulasi delta daya kVA otomatis di backend.
    - Parameter teknis & TMP: kriteria durasi layanan (mis. `05 Hari`), estimasi total biaya, serta checkbox kebutuhan teknis (Drawing, Kajian Kelayakan Finansial, Perluasan Jaringan).
- **Drawer Detail Permohonan & Audit Trail (`ApplicationDetailDrawer`)**:
  - Informasi pelanggan dan rincian daya/tarif.
  - Penautan referensi eksternal (Nomor Agenda atau Nomor Register Pembayaran AP2T/EIS).
  - Linimasa riwayat status *append-only* dari tabel `application_status_histories`.
  - Aksi langsung: Pengajuan ke tahap Survey Lapangan (`POST /api/applications/{id}/submit`) untuk status `DRAFT`.
  - Pembatalan permohonan dengan input alasan audit log wajib via `ReasonDialog` (`POST /api/applications/{id}/cancel`).

### 2. Status Verifikasi
- **Vitest Frontend**: **61 / 61 test lulus** (4 test files: `App.test.jsx`, `Components.test.jsx`, `MasterData.test.jsx`, `ApplicationsPage.test.jsx`).
- **PHPUnit Backend**: **88 / 88 test lulus** (201 assertions).
- **Vite Production Build**: **Berhasil dalam 908ms**.
- **Bundle File Arsip**: Diperbarui pada `DISTRIVA-frontend-v0.1.0-2026-11-06.zip`.



