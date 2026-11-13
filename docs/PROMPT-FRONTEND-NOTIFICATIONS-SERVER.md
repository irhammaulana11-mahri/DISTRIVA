# Prompt siap tempel — notifikasi dari server (lonceng membaca API, hapus notifikasi palsu) (agen frontend)

Anda adalah agen frontend DISTRIVA (React/Vite di `frontend/`). Backend kini punya kotak masuk notifikasi per pengguna (docs/62 §44). Tugas Anda: **lonceng notifikasi harus membaca dari API**, bukan `localStorage`, dan notifikasi contoh palsu dihapus. Jangan mengubah backend.

## Latar belakang (mengapa)
`src/features/notifications/NotificationContext.jsx` menyimpan semua notifikasi di `localStorage` (`distriva.notifications.v1`). Akibatnya `sendApprovalRequest` ("ada draf menunggu persetujuan") dan `sendDecisionNotice` ("disetujui/ditolak") hanya terlihat di browser yang sama dengan pelakunya; pengguna lain tidak pernah menerimanya. Dua notifikasi contoh (`seed-1` "Unit Kerja Terdaftar", `seed-2` "Keamanan Kredensial") juga tampil ke semua orang. Kini server yang membuat notifikasi saat kejadiannya benar-benar terjadi.

## Kontrak API (sudah ada, semua butuh sesi login; hanya data milik pemanggil)
- `GET /api/notifications?unread=1&per_page=30` → `{ data: [{ id, level, title, body, tag, link, read_at, created_at }], meta: { current_page, per_page, total, last_page, unread_count } }`. `level` ∈ `info | success | warning | error`. `per_page` maksimum 100 (lebih → 422). `link` adalah path di dalam aplikasi (mis. `/master-data/khs`) atau null. Urutan: terbaru dulu.
- `POST /api/notifications/{id}/read` → `{ data: { id, read: true } }`. Milik pengguna lain → **404** (bukan 403).
- `POST /api/notifications/read-all` → `{ data: { marked: N } }`.
- Nilai `tag` yang dikirim server (untuk chip/filter): `KHS`, `Konstruksi`, `BOM`, `Buku Harga`, `Buku Tarif`, `KKF`, `SR1`, `Permohonan`, `Survei`, `Gambar`, `MTO`, `RKM`, `Stok`, `Work Order`, `BASTP`, `Material`, `Alokasi`. `link` yang dikirim: `/master-data/khs`, `/master-data/constructions`, `/master-data/bom`, `/master-data/harga`, `/master-data/tariff-books`, `/master-data/kkf-parameters`, `/master-data/sr1-schedules`, `/permohonan`, `/survei/{id}`, `/gambar/{id}`, `/mto/{id}`, `/rkm/versions/{id}`, `/master-data/warehouses`, `/work-orders`, `/material-requests`. Level `error` juga dipakai untuk WO dibatalkan. Level `error` dipakai untuk RKM ditolak; `warning` untuk "menunggu keputusan Anda"/dikembalikan/stok menipis.
- Pemicu server (urgent, sudah ada): permohonan baru masuk, survei/gambar/MTO/RKM menunggu keputusan Anda atau dikembalikan/diterima/disetujui, stok menipis (satu pemberitahuan per gudang yang diperbarui selama belum dibaca — jangan membuat toast baru bila `id` sama sudah pernah ditampilkan), serta pemicu master data berikut.
- Pemicu master data: impor KHS / standar konstruksi / BOM / buku harga / buku tarif (ke pemegang izin approve: "N draf … menunggu persetujuan", level `warning`) dan persetujuan KHS / konstruksi / BOM / buku harga / buku tarif / parameter KKF / jadwal SR1 (ke pembuat draf, level `success`, isi memuat alasan). Pelaku aksi tidak diberi tahu soal aksinya sendiri.

## Yang harus dibangun
1. `services/api.js`: tambahkan `notificationsApi` = `{ list(params), markRead(id), markAllRead() }`.
2. `NotificationContext.jsx`:
   - Daftar lonceng, `unreadCount`, `markAllAsRead`, `toggleRead`→`markRead` berasal dari API. Muat saat provider aktif (pengguna sudah login) dan **polling ringan** (mis. 60 detik, dihentikan saat tab tersembunyi, dibersihkan saat unmount/logout). `unreadCount` memakai `meta.unread_count` dari server, bukan hitungan lokal.
   - Hapus `DEFAULT_SEED_NOTIFICATIONS`, seluruh akses `localStorage` untuk notifikasi, event `distriva:notification_sync`, dan penyaringan sisi klien (`targetUserEmail`/`targetCapabilities`/`targetRoles`/`readBy`) — server sudah menyaring per penerima. Bersihkan sisa kunci `distriva.notifications.v1` di browser (hapus sekali, dalam try/catch).
   - `notify({ title, desc, tag, type })` **tetap ada** untuk toast umpan balik aksi (berhasil/gagal) — sekarang hanya toast, **tidak** disimpan ke daftar lonceng. Toast baru juga boleh muncul untuk notifikasi server yang baru tiba pada polling (hanya yang belum pernah ditampilkan; jangan memunculkan toast untuk seluruh isi saat pemuatan pertama).
   - `sendApprovalRequest` dan `sendDecisionNotice`: server kini membuat notifikasinya. Hapus semua pemanggilnya di halaman (cari dengan `grep -rn "sendApprovalRequest\|sendDecisionNotice" src`) lalu hapus fungsinya dari context dan dari nilai default context. Pemanggilan `notify(...)` untuk toast dipertahankan.
   - Pemetaan tampilan: `level` → tipe ikon/warna yang sudah ada (`info`, `success`, `warning`, `error`); `tag` → chip; `body` → deskripsi; waktu relatif dari `created_at` (hitung saat render, jangan simpan string "10 mnt lalu").
3. Lonceng (`layout/AppLayout.jsx`): klik notifikasi → tandai dibaca (`markRead`) lalu navigasi ke `link` bila ada (hanya path yang diawali `/`; abaikan nilai lain). Tombol "Tandai semua dibaca" memanggil `markAllRead`. Tampilkan status memuat, kosong ("Belum ada notifikasi"), dan galat (pesan server apa adanya, tanpa membuat toast berulang tiap polling).
4. Fail-safe: bila API gagal (jaringan/401/5xx) lonceng tetap tampil dengan daftar terakhir yang berhasil dimuat dan tidak melempar galat ke halaman; 401 mengikuti penanganan sesi yang sudah ada.

## Aturan
- Hak akses tetap ditentukan backend; jangan menyaring atau menebak penerima di klien.
- Tampilkan pesan server apa adanya; jangan menampilkan atau menyimpan token, OTP, atau kata sandi.
- Jangan mengubah komponen bersama (`ConfirmationModal`, `ReasonDialog`, `Modal`, `Button`, `Drawer`) selain yang mutlak perlu; jalankan seluruh suite sebelum selesai.
- Tes yang menyentuh notifikasi (`App.test.jsx`, `FrontendAuditFixes.test.jsx`, dll.) harus disesuaikan: mock `notificationsApi` bukan `localStorage`.

## Tes yang harus ada (vitest)
1. Lonceng memuat `GET /notifications` dan menampilkan `unread_count` dari server (bukan hitungan lokal).
2. Mengklik notifikasi memanggil `markRead(id)` lalu navigasi ke `link`; `link` tanpa awalan `/` tidak dinavigasi.
3. "Tandai semua dibaca" memanggil `markAllRead` dan menurunkan hitungan.
4. Tidak ada notifikasi contoh (`seed-*`) dan tidak ada akses `localStorage` kunci `distriva.notifications.v1` setelah dimuat.
5. `notify()` hanya menampilkan toast dan tidak menambah baris di daftar lonceng.
6. Polling: panggilan ulang terjadi sesuai interval (fake timers), berhenti saat unmount.
7. Galat API: lonceng tidak crash, daftar terakhir dipertahankan.

Selesai bila: `npx vitest run` hijau seluruhnya, `npx vite build` berhasil, dan di aplikasi nyata: impor draf oleh satu akun membuat notifikasi muncul di lonceng akun penyetuju (browser/perangkat berbeda) tanpa muat ulang manual lebih dari satu interval polling.
