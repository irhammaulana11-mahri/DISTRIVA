# 56 — Kanal Notifikasi (Email + WhatsApp)

**Tanggal:** 6 November 2026 · **Dasar:** `docs/54` D-7 (DECIDED: email dan WhatsApp, mana yang tersedia, keduanya dipakai bila terkonfigurasi) · **Status:** lapisan dan driver WhatsApp HTTP generik `IMPLEMENTED` dan `TESTED` (32 unit test dengan HTTP palsu); penyedia nyata **belum dikonfigurasi** (belum ada token/URL), jadi tidak ada pengiriman sungguhan yang terbukti.

## Perilaku (sesuai D-7)
Satu pesan dikirim ke **setiap kanal yang terkonfigurasi dan tersedia** bagi penerima. Kegagalan satu kanal tidak menggagalkan kanal lain. Pengiriman dianggap berhasil bila minimal satu kanal berhasil (`sendOrFail` melempar `NotificationFailed` bila tidak ada). Setiap hasil dilaporkan per kanal: terkirim / gagal (kelas exception) / dilewati (alasan).
- Email tersedia bila alamat valid **dan mailer bukan `log`** (mailer `log` hanya menulis ke berkas, sehingga dianggap tidak dapat mengirim: alasan `mailer_not_deliverable`). WhatsApp tersedia bila ada driver penyedia **dan** nomor valid (dinormalisasi ke bentuk internasional: `0812-3456-7890` → `6281234567890`; kode negara default `62`).
- Pesan bertanda `sensitive` (mis. password sementara) tidak pernah ditulis ke log. Log kegagalan hanya memuat nama kanal dan kelas exception — tanpa isi pesan, alamat, atau nomor.
- Kode: `App\Services\Notifications\*` (`NotificationDispatcher`, `MailChannel`, `WhatsAppChannel`, `PhoneNumber`, driver `WhatsApp\*`), `config/distriva_notifications.php`.

## Konfigurasi (`backend/.env`)
| Variabel | Arti | Nilai saat ini |
|---|---|---|
| `DISTRIVA_NOTIFY_CHANNELS` | Kanal aktif, dipisah koma | `mail,whatsapp` (default) |
| `MAIL_MAILER`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_SCHEME`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` | Penyedia email (Laravel mailer) | **`MAIL_MAILER=log`** dan host contoh → **email tidak benar-benar terkirim** |
| `DISTRIVA_WHATSAPP_DRIVER` | `null` (belum ada penyedia; kanal dilewati), `log` (pengembangan; tidak menulis nomor/teks) | `null` (default) |
| `DISTRIVA_WHATSAPP_COUNTRY_CODE` | Kode negara untuk nomor lokal | `62` |
Kredensial hanya di `.env`, tidak pernah di Git atau di dokumentasi.

## WhatsApp: Starsender (penyedia dipilih pemilik, 6 Nov 2026)
Format diambil dari dokumentasi resmi Starsender (`https://docs.starsender.online/docs/message-api/kirim-pesan`, dibaca 6 Nov 2026): `POST https://api.starsender.online/api/send`, header `Authorization: <API key device>` (tanpa `Bearer`), body JSON `messageType` (`text`), `to` (boleh diawali `0` atau kode negara), `body`; respons sukses `{"success": true, "data": {}, "message": "Success sent message"}`. **Tidak ditemukan di dokumentasi:** bentuk respons gagal dan kode HTTP-nya — karena itu `SUCCESS_PATH=success` dipakai agar balasan HTTP 200 dengan `success:false` tetap dianggap gagal. Profil ini sudah dimasukkan ke `backend/.env` (kecuali token) dan `backend/.env.example`; uji dengan Http palsu lulus (JSON, header kunci polos, pesan dengan tanda kutip/baris baru, `success:false` → gagal). **Belum diuji ke server Starsender asli.**
Yang harus Anda isi sendiri: `DISTRIVA_WHATSAPP_TOKEN` = API key dari menu *device* Starsender (perangkat/nomor harus berstatus terhubung). Nomor dikirim sebagai `62812…`.

## Pengaturan email — apa yang harus diisi (tanpa uji kirim)
Semua di `backend/.env`. Periksa kelengkapan tanpa mengirim apa pun/menghubungi server: `php artisan distriva:notify-check`.
| Variabel | Arti | Isi / contoh | Dari mana |
|---|---|---|---|
| `MAIL_MAILER` | Jenis pengirim | `smtp` (**bukan** `log`/`array`) | tetap |
| `MAIL_HOST` | Alamat server SMTP | mis. `smtp.penyedia.co.id` | penyedia email / admin TI |
| `MAIL_PORT` | Port SMTP | `587` (STARTTLS) atau `465` (TLS langsung) | penyedia |
| `MAIL_SCHEME` | Mode TLS | kosong untuk port 587; `smtps` untuk port 465 | sesuai port |
| `MAIL_USERNAME` | Akun login SMTP | biasanya alamat email pengirim | penyedia |
| `MAIL_PASSWORD` | Password/app password SMTP | rahasia — hanya di `.env` | penyedia |
| `MAIL_FROM_ADDRESS` | Alamat pengirim yang tampil | alamat resmi, mis. `no-reply@domain-anda` (bukan `@example.com`) | domain instansi |
| `MAIL_FROM_NAME` | Nama pengirim | `DISTRIVA` | bebas |
Opsional: `MAIL_EHLO_DOMAIN` (nama host untuk salam SMTP bila server menolak default).
Catatan umum (pastikan dengan penyedia Anda; nilai ini bukan jaminan): akun Gmail/Google Workspace biasanya memerlukan *App Password* (verifikasi 2 langkah aktif) dan `smtp.gmail.com`; Microsoft 365 memerlukan SMTP AUTH diaktifkan oleh admin tenant. Agar email tidak masuk spam, minta admin domain menyiapkan SPF/DKIM untuk alamat pengirim. Alamat `MAIL_FROM_ADDRESS` sebaiknya sama dengan/diizinkan oleh akun SMTP.
Perintah `distriva:notify-check` memeriksa: mailer bukan `log`/`array`, host/port terisi dan bukan nilai contoh, kecocokan port–scheme (465↔`smtps`), username & password terisi (hanya dilaporkan "terisi/kosong"), alamat pengirim valid dan bukan `@example.com`, nama pengirim terisi. Untuk WhatsApp: driver `http`, URL `https://`, token terisi, body JSON valid memuat `{phone}` dan `{message}`, format `form|json`.

## Konfigurasi gateway HTTP (WhatsApp non-resmi)
Isi di `backend/.env` memakai data dari dokumentasi penyedia Anda (nilai di bawah hanya contoh bentuk, bukan fakta tentang penyedia mana pun):
```
DISTRIVA_WHATSAPP_DRIVER=http
DISTRIVA_WHATSAPP_URL=https://<host-penyedia>/<endpoint-kirim>
DISTRIVA_WHATSAPP_TOKEN=<token>                       # rahasia; hanya di .env
DISTRIVA_WHATSAPP_AUTH_HEADER=Authorization           # nama header auth sesuai penyedia
DISTRIVA_WHATSAPP_AUTH_PREFIX=                        # mis. "Bearer " bila diperlukan
DISTRIVA_WHATSAPP_BODY_FORMAT=form                    # form | json
DISTRIVA_WHATSAPP_BODY={"target":"{phone}","message":"{message}"}   # nama field sesuai penyedia
DISTRIVA_WHATSAPP_SUCCESS_PATH=status                 # opsional: kunci JSON penanda sukses
DISTRIVA_WHATSAPP_SUCCESS_VALUE=true
```
Placeholder: `{phone}` = `62812…`, `{phone_local}` = `0812…`, `{message}` = judul + isi. Pengiriman dianggap sukses bila HTTP 2xx dan (jika diisi) `SUCCESS_PATH` bernilai `SUCCESS_VALUE`. URL wajib `https://` (kecuali lingkungan lokal). Token dan isi respons gateway tidak pernah masuk exception atau log. Kanal otomatis *dilewati* (`provider_not_configured`) bila URL/token/body belum lengkap.

**Risiko yang diterima pemilik dengan memilih jalur non-resmi:** nomor pengirim dapat diblokir WhatsApp, tidak ada jaminan layanan, dan isi pesan (termasuk password sementara/OTP) melewati pihak ketiga tanpa kontrak. Mitigasi yang disarankan: gunakan nomor khusus (bukan nomor pribadi/instansi utama); kirim password sementara **bersamaan lewat email** (sudah otomatis bila kedua kanal aktif); password awal wajib diganti saat login pertama (sudah) dan sebaiknya kedaluwarsa 24 jam (G-5, belum); jangan mengirim kredensial permanen; batasi frekuensi kirim. Opsi resmi tetap dapat dipasang kemudian dengan menambah satu kelas driver tanpa mengubah kode lain.

## Bukti transport nyata (lokal)
Pengiriman lewat jaringan diuji dengan penangkap pesan lokal: server SMTP minimal (`frontend/e2e/sinks/smtp_sink.py`, mailer `smtp` Laravel) dan gateway HTTP minimal (`wa_sink.py`, driver `http`). Terbukti: email tiba di SMTP dengan penerima dan isi benar; permintaan HTTP tiba dengan token, nomor ternormalisasi (`6281234567890`), dan pesan; email dan WhatsApp membawa password yang sama. **Ini bukan bukti bahwa penyedia nyata (server email Anda / gateway WhatsApp pilihan Anda) bekerja** — itu harus diuji dengan `distriva:notify-test` setelah `.env` diisi.

## Diagnostik kegagalan gateway (6 Nov 2026)
Insiden: pesan uji **sampai** di WhatsApp, tetapi `distriva:notify-test` melaporkan `[GAGAL] whatsapp: RuntimeException` — driver menolak balasan Starsender (cek `success_path`/status HTTP) padahal pengiriman terjadi, dan perintah hanya menampilkan nama kelas error. Perbaikan: kegagalan gateway kini berupa `GatewayFailure` (menandai pesan aman-tampil) dan `notify-test` mencetak `rincian:` berisi status HTTP, nilai field sukses yang diperiksa (dibersihkan ke karakter `A-Za-z0-9 _.-` dan dipotong 40 karakter) serta **nama** key tingkat atas — tidak pernah nilai field lain, isi pesan, nomor, URL, atau token. Rincian yang sama masuk log server; respons API admin tetap hanya memuat nama kanal. Pengecualian lain (bisa memuat URL/rahasia) tidak pernah diberi rincian.
**Akar masalah ditemukan (bug di driver, bukan di Starsender):** rincian menunjukkan balasan `HTTP 200, 'success' is true, keys [success, data, message]` — benar sesuai dokumentasi — tetapi `expected '1'`. Laravel `env()` mengubah `DISTRIVA_WHATSAPP_SUCCESS_VALUE=true` di `.env` menjadi boolean `true`; driver lama mengubahnya dengan `(string)` menjadi `'1'` lalu membandingkan dengan `'true'`. Perbaikan: kedua sisi dibandingkan dalam bentuk kanonik (`true/1/yes` ⇒ `true`, `false/0/no` ⇒ `false`, selain itu teks huruf kecil). Test lama lolos karena mengisi config dengan teks `'true'` langsung, tanpa melalui parsing `.env`; kini ada test regresi yang memuat `.env` sungguhan lewat Dotenv. **Tidak perlu mengubah `.env`.**

## Jebakan: jangan `source` berkas `.env` ke shell sebelum menjalankan artisan
`set -a; . ./.env` membuat bash mengolah ulang nilai (tanda kutip JSON hilang: `{"messageType":…}` menjadi `{messageType:…}`) dan variabel proses menimpa `.env` yang dibaca Laravel. Akibatnya `distriva:notify-check` melaporkan "DISTRIVA_WHATSAPP_BODY bukan JSON" padahal `.env` benar (salah-alarm 6 Nov 2026, dibuktikan: tanpa `source` hasilnya "konfigurasi lengkap"). Jalankan artisan langsung; Laravel membaca `.env` sendiri.

## Uji koneksi
`php artisan distriva:notify-check` — pengecekan statis, tidak mengirim dan tidak menghubungi server mana pun.

`php artisan distriva:notify-test --email=alamat@domain --phone=0812…` mengirim pesan uji yang tidak sensitif dan menampilkan hasil per kanal serta peringatan bila mailer `log`/`array`. Catatan: `[OK] mail` dengan mailer `log` hanya berarti pesan ditulis ke log, bukan terkirim.

## Yang dibutuhkan agar pengiriman nyata (keputusan/aksi pemilik)
1. **Email:** pilih penyedia dan isi `MAIL_*`. Laravel mendukung SMTP umum (server email instansi, Gmail/Google Workspace dengan app password, dll.) serta Mailgun, Postmark, Amazon SES, dan Resend. Tidak ada perubahan kode bila memakai SMTP; mailer API tertentu mungkin perlu paket tambahan. Tentukan alamat pengirim resmi dan pastikan SPF/DKIM agar tidak masuk spam.
2. **WhatsApp — KEPUTUSAN 6 Nov 2026: penyedia API non-resmi.** Penyedia spesifik belum disebut, sehingga dibuat driver HTTP generik (`DISTRIVA_WHATSAPP_DRIVER=http`) yang dikonfigurasi sepenuhnya dari dokumentasi penyedia (lihat bagian *Konfigurasi gateway HTTP*). Teks opsi di bawah dipertahankan sebagai latar keputusan.
   (Opsi semula) pilih penyedia — lalu satu kelas driver (`WhatsAppDriver::send($phone, $text)`) ditulis dan didaftarkan di `config('distriva_notifications.whatsapp.drivers')`. Opsi umum:
   - **WhatsApp Business Cloud API (Meta) atau BSP resmi** (mis. Twilio): resmi, tetapi pesan yang dimulai bisnis umumnya harus memakai *template* yang disetujui dan nomor bisnis terverifikasi; ada biaya per percakapan.
   - **Gateway lokal tidak resmi** (berbasis sesi WhatsApp Web): mudah dan murah, tetapi berisiko pemblokiran nomor, tidak ada jaminan layanan, dan melanggar ketentuan WhatsApp — **tidak disarankan untuk mengirim kredensial**.
   Rekomendasi: jalur resmi untuk pesan yang membawa password/OTP. Keputusan ada pada pemilik.
3. Setelah penyedia terpasang: jalankan `distriva:notify-test` ke nomor/email Anda sendiri dan catat hasil di test-evidence.

## Pesan yang dikirim sistem (keputusan OTP, 6 Nov 2026)
- **Undangan aktivasi** (saat admin membuat pengguna / kirim ulang): `sensitive=false`; memuat tautan `DISTRIVA_FRONTEND_URL/aktivasi` dan alamat email; tidak memuat password maupun kode.
- **Kode OTP** (aktivasi/pemulihan): `sensitive=true` (tidak pernah di-log); 6 digit, berlaku `DISTRIVA_OTP_TTL_MINUTES` (10); dikirim ke **semua kanal tersedia** dengan kode yang sama; dikirim setelah respons HTTP selesai. Bila tidak ada kanal yang berhasil, hanya peringatan log (tanpa kode) yang dicatat dan pengguna tetap melihat jawaban netral.
- Pengaturan: `DISTRIVA_FRONTEND_URL`, `DISTRIVA_OTP_TTL_MINUTES`, `DISTRIVA_OTP_MAX_ATTEMPTS`, `DISTRIVA_OTP_RESEND_COOLDOWN`, `DISTRIVA_OTP_MAX_REQUESTS_PER_HOUR`.

## (Riwayat) Pekerjaan yang kini dapat dilanjutkan (menunggu penyedia untuk uji nyata)
Password awal sekali pakai dengan kedaluwarsa 24 jam (G-5) + `users.create`; OTP recovery (G-6); MFA bila memilih OTP lewat kanal ini. Semuanya memakai `NotificationDispatcher::sendOrFail` dengan `Message(sensitive: true)`.

## Batasan
Belum ada antrean (queue) — pengiriman sinkron; `QUEUE_CONNECTION=database` sudah ada sehingga dapat dipindah ke job. Belum ada retry/backoff, rate limit per penerima, atau pencatatan status pengiriman (sengaja: tidak menyimpan isi pesan). Tidak ada opt-out per pengguna.
