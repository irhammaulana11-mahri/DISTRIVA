# 94 — Sinkronisasi Paralel Multi-UP3

Berlaku untuk lima jalur tarik data: `eis-sync` (EIS, piutang, APKT, AP2T), `outages/sync`, `customer-connections/sync` (DIL), `maximo-sync`, dan `stock-sync` (MIMS).

## 1. Cakupan per UP3

- UP3 yang boleh dipakai seseorang: UP3 tempat ia bertugas, atau induk ULP tempat ia bertugas, bila perannya memegang izin jalur itu (`eis_sync.manage`, `outages.sync` / `outages.view`, `customers.import`, `substations.sync`, `stock.import`). SYS_ADMIN: semua UP3.
- Semua endpoint jalur itu menerima `up3_id` (query atau body). Tanpa `up3_id`: satu-satunya UP3 pengguna, atau UP3 utama bila ia mencakup beberapa. UP3 utama = pemilik pengaturan sinkronisasi pertama (data sebelum migrasi); bila belum ada, UP3 dengan gardu terbanyak lalu ULP terbanyak. UP3 di luar cakupan: 404.
- Riwayat, run aktif, rincian run, pengaturan, peristiwa gangguan, berkas DIL, dan gudang MIMS dibatasi pada UP3 itu. Run UP3 lain: 404.

## 2. Data per UP3

| Hal | Perilaku |
|---|---|
| Akun per ULP | lihat §7 |
| Pengaturan (akun EIS, akun Maximo, sheet gangguan, tarik otomatis MIMS) | satu baris per UP3; UP3 baru mulai dengan nilai bawaan dan harus diisi sendiri |
| Jadwal otomatis | dijalankan per UP3 yang mengaktifkannya |
| Peristiwa gangguan | kunci `(up3_id, source_key)`; penandaan "hilang dari sheet" hanya pada UP3 yang disinkron |
| Sesi login alat EIS | satu berkas per UP3 (`EIS_COOKIE_FILE`) |
| Unduhan EIS | `storage/app/private/eis-sync/<run_id>`, dihapus setelah run selesai |
| Daftar mentah dan CSV Maximo | UP3 utama tetap di `tools/maximo_sync/raw` dan `out`; UP3 lain di `storage/app/private/maximo-sync/<up3_id>` |
| Berkas DIL di folder inbox | menurut kode ULP pada nama berkas; berkas tanpa kode yang dikenal menjadi urusan UP3 utama |
| Gudang MIMS | menurut unit gudang (UP3 itu atau ULP di bawahnya) |
| Token APKT dan MIMS | tersimpan per pengguna (tidak berubah). Token tempel menunggu antrean dalam bentuk terenkripsi pada baris run dan dihapus saat selesai; tidak masuk tabel antrean |

Data yang ada sebelum migrasi menjadi milik UP3 utama.

Ambang SAIDI pada halaman analisis gangguan dan menu pengusahaan masih dibaca dari pengaturan UP3 utama.

## 3. Kunci

Dua hal dipisahkan: **data** yang ditulis dan **sesi akun** di sistem sumber.

### Kunci data: (sumber, dataset, sasaran)

Selama run `QUEUED` atau `RUNNING`, tiap sasaran yang ditulisnya dikunci di tabel `sync_locks` (kunci primer, sehingga dua permintaan serentak tidak sama-sama lolos). Trigger database melepasnya begitu status run berubah, dari jalur mana pun. ULP berbeda dapat sinkron bersamaan; cakupan yang beririsan ditolak.

| source | dataset | sasaran |
|---|---|---|
| `eis` | `permohonan`, `piutang` | ULP |
| `apkt` | `saidi-saifi`, `rpt-rct-gangguan`, `rpt-rct-keluhan`, `anomali-gangguan`, `anomali-keluhan` | ULP |
| `ap2t` | `tagsus` | ULP |
| `maximo` | `inspeksi` | ULP yang dijangkau akunnya (§7) |
| `dil` | `pelanggan` | ULP menurut nama berkas (tanpa kode: UP3) |
| `mims` | `pull` | gudang |
| `gangguan` | `events` | UP3 (satu sheet per UP3) |

Bentrok: **409** `{message, active_run_id, triggered_by {id,name}, scope {id,name,type}, conflicts [{id,name}]}`. `scope` adalah tingkat pemicu run yang sedang berjalan, jadi ULP yang datanya sedang ditarik UP3 membaca "… sedang disinkronkan oleh run UP3 …".

Satu permintaan bersifat semua atau tidak sama sekali: bila satu sasaran bentrok, tidak ada run yang didaftarkan.

Admin ULP hanya menarik ULP, berkas DIL, dan gudang ULP-nya. Pengecualian: data gangguan (satu sheet per UP3).

### Kunci sesi akun

EIS dan Maximo: run yang memakai **akun yang sama** dikerjakan bergantian; run berikutnya menunggu di antrean (bukan 409). Akun berbeda berjalan paralel.

### Batas per sistem sumber

Paling banyak sekian run sekaligus di seluruh DISTRIVA (`config/distriva.php` `sync.concurrency`, atau `DISTRIVA_SYNC_LIMIT_<SUMBER>`): EIS 2, Maximo 2, DIL 2, APKT 3, AP2T 3, MIMS 3, gangguan 3. Batas resmi dari sistem sumber belum diketahui, jadi angkanya sengaja kecil. Kelebihannya menunggu di antrean. Memakai kunci cache, jadi `CACHE_STORE` harus bersama antar-worker (database atau redis).

## 4. Antrean

| Antrean | Isi | Worker disarankan |
|---|---|---|
| `sync-light` | APKT, AP2T, MIMS, gangguan | 3–5 |
| `sync-heavy` | EIS (peramban), Maximo, DIL | 1–2 |

Koneksi antrean `sync_jobs` (database, tabel `jobs`, `retry_after` 90000 detik, lebih panjang dari run terpanjang).

**Worker wajib berjalan.** Tanpa worker, run tetap `QUEUED` dan dianggap gagal setelah dua hari. Contoh supervisor (sesuaikan jalur dan pengguna; harus pengguna yang sama dengan web agar dapat menulis `storage/` dan memakai venv alat):

```ini
[program:distriva-sync-light]
command=php /srv/distriva/backend/artisan queue:work sync_jobs --queue=sync-light --sleep=3 --timeout=90000 --memory=1024
numprocs=3
process_name=%(program_name)s_%(process_num)02d
user=www-data
autostart=true
autorestart=true
stopwaitsecs=3600

[program:distriva-sync-heavy]
command=php /srv/distriva/backend/artisan queue:work sync_jobs --queue=sync-heavy --sleep=5 --timeout=90000 --memory=1024
numprocs=1
process_name=%(program_name)s_%(process_num)02d
user=www-data
autostart=true
autorestart=true
stopwaitsecs=86400
```

Pengembangan: `php artisan queue:work sync_jobs --queue=sync-light,sync-heavy`. Setelah kode berubah: `php artisan queue:restart`.

Kedaluwarsa: run `RUNNING` melewati batas waktunya, atau run `QUEUED` yang job-nya sudah tidak ada di antrean setelah batas itu, ditandai `FAILED`.

## 5. Kontrak API

### Field tambahan pada setiap respons run

`scope {id,name,type}`, `account {id,name,type}` (akun yang dipakai: ULP atau UP3), `up3 {id, name}`, `triggered_by {id, name}` (null untuk jadwal tanpa pengguna), `state` (`QUEUED, RUNNING, SUCCEEDED, PARTIAL, FAILED`), `source`, `dataset`, `queue`, `queue_position` (hanya saat `QUEUED`, dihitung lintas sumber), `progress {done_units, total_units}` (null bila belum diketahui).

`status` lama tetap ada dengan nilai lama (`OK` untuk berhasil), agar layar yang ada tidak rusak.

Satuan progres: EIS permohonan = unit; APKT/AP2T = permintaan (bulan × ULP × laporan); gangguan = tab sheet; Maximo = work order (terisi saat selesai); DIL = berkas; MIMS = gudang.

### Endpoint

| Metode | Perubahan |
|---|---|
| `GET /sync/active` | baru: semua run antre/berjalan yang boleh dilihat pengguna, tertua lebih dulu (`id, status, created_at, started_at` + field tambahan) |
| `GET /eis-sync`, `GET /outages/sync`, `GET /maximo-sync`, `GET /master-data/customer-connections/sync` | menerima `up3_id`; memuat `up3_id` terpakai dan `up3s[]` |
| `POST …/runs` (kelima jalur) | menerima `up3_id`; 409 berbentuk seperti §3 |
| `PUT …/settings`, `GET /master-data/stock-sync/settings` | menerima `up3_id` |
| `GET /master-data/stock-sync/runs/active` | menerima `up3_id` |
| `GET /maximo-sync/runs`, `GET /eis-sync` | menerima `active=1` |
| `GET /master-data/stock-sync-runs`, `GET /master-data/stock-coverage` | hanya gudang UP3 pengguna |

## 6. Notifikasi

Saat run selesai, selesai sebagian, atau gagal dijalankan, pemicunya mendapat notifikasi aplikasi (tag `SINKRON`, tautan `/sinkronisasi`). Run yang ditandai gagal karena kedaluwarsa tidak mengirim notifikasi.

## 7. Akun per ULP (Maximo dan EIS)

Akun UP3 tetap di pengaturan sinkronisasi UP3 (`PUT …/settings`). ULP boleh punya akun sendiri; ULP tanpa akun sendiri memakai akun UP3. Alamat, rentang, dan jadwal tetap dari pengaturan UP3.

| Metode | Isi |
|---|---|
| `GET /sync/accounts?source=eis\|maximo&up3_id=` | per ULP yang boleh dikelola: `{unit_id, code, name, has_own_account, username, updated_at, updated_by}` |
| `PUT /sync/accounts` | `{source, unit_id, username, password?}`; password wajib untuk akun baru, tidak pernah dikembalikan |
| `DELETE /sync/accounts/{source}/{unit}` | ULP kembali memakai akun UP3 |

Izin `eis_sync.manage` (EIS) atau `substations.sync` (Maximo). Admin UP3 mengelola semua ULP di bawahnya, admin ULP hanya ULP-nya (selain itu 404).

**Pemecahan run.** Satu permintaan menghasilkan satu run per akun: tiap ULP berakun sendiri, lalu satu run akun UP3 untuk sisanya. Respons `POST …/runs`: `data` = run pertama (bentuk lama), `runs[]` = semuanya. APKT, AP2T, dan MIMS memakai token per pengguna, jadi tidak dipecah.

- **Maximo:** alat tidak dapat dibatasi per ULP, sehingga run akun UP3 menjangkau (dan mengunci) semua ULP tanpa akun sendiri. Admin ULP tanpa akun sendiri ditolak 409. Daftar mentah dan CSV disimpan per akun (`storage/app/private/maximo-sync/<ulp_id>`).
- **EIS:** run akun ULP memakai `--unit` ULP itu; sesi login disimpan per akun.
- **Jadwal otomatis** mengikuti jadwal UP3 dan menjalankan semua akun.

**Pengaturan UP3** (akun UP3, alamat, jadwal) untuk EIS, Maximo, data gangguan, dan tarik otomatis MIMS hanya dapat diubah dari tingkat UP3 atau SYS_ADMIN (403 untuk pengguna ULP). `GET /eis-sync`, `GET /maximo-sync`, dan `GET /master-data/stock-sync/settings` memuat `can_manage_settings`; `GET /outages/sync` memuat `can.settings`. SYS_ADMIN tidak dapat mengaktifkan sinkronisasi otomatis EIS (tidak dapat memberi verifikasi MFA); aktifkan dari akun Niaga Retail UP3.

`eis_sync.manage` berlaku turun dari UP3 (keputusan pemilik 27 Nov 2026): Niaga Retail tingkat UP3 menyinkronkan semua ULP di bawahnya. Sebelumnya akun itu ditolak 403.

## 8. Memuat daftar UP3 dan ULP

```bash
php artisan distriva:units-load "../tools/samples/kode up3 dan ulp.txt"                                   # uji coba
php artisan distriva:units-load "../tools/samples/kode up3 dan ulp.txt" --apply --by=<email SYS_ADMIN>    # simpan
```

Berkas: unduhan daftar unit (`lUnitAp`, `lUnitUp`); kodenya sama dengan yang dipakai MIMS. Hanya menambah kode yang belum ada; unit lama tidak diubah (beda nama dilaporkan). Nama yang sudah dipakai diberi akhiran nama UP3, karena impor NKO mencocokkan unit menurut nama. Yang diambil: kode, nama, induk, alamat kantor. Tiap unit tercatat di riwayat unit. Di server baru, jalankan `migrate` lebih dulu.

Dimuat ke database dev 27 Nov 2026: 14 UP3 dan 104 ULP baru (total 16 UP3, 114 ULP). Gudang MIMS (plant, storage location) UP3 selain Mojokerto belum ada datanya.


## 9. Kode unit di sistem sumber

Kode ULP sama di semua sumber (EIS, AP2T, APKT, MIMS): kode unit. Kode UP3:

| Sumber | Kode UP3 |
|---|---|
| EIS, AP2T, MIMS | kode unit (mis. `51MJK`) |
| APKT | angka tersendiri (Mojokerto `149`), disimpan di `organizational_units.apkt_id`, diisi `distriva:units-load` dari bagian "KODE UNIT APKT" |

Sinkron memakai kode UP3 pemicu: APKT (`idUp3` dan nama UP3), AP2T (`unitap`), alat EIS (`EIS_UP3_CODE`). UP3 utama tetap memakai konfigurasi bila datanya kosong; UP3 lain tanpa id APKT ditolak 409. MIMS tarik stok memakai plant dan storage location gudang (`5118` = plant Mojokerto).

ULP `51309` (Ngantang) dan `51770` (Prenduan) tidak ada di daftar APKT.

Gudang MIMS: dimuat 27 Nov 2026 ke database dev untuk 16 UP3, 130 gudang (satu per UP3 dan ULP). Sumbernya `GET /project-i-agodist-api//func_getstorloc_bylogin/{plant}&8/`, dibaca dengan `php artisan distriva:mims-storloc-probe {plant}` (token tersimpan, hanya baca, hasil di `storage/app/private/mims/`), lalu dimasukkan lewat impor gudang resmi (`POST /master-data/warehouses/import`). MIMS sering lambat: plant yang habis waktu perlu diulang.

| Plant | UP3 | Plant | UP3 |
|---|---|---|---|
| 5111 | Pasuruan | 5119 | Madura |
| 5112 | Situbondo | 5120 | Surabaya Utara |
| 5113 | Banyuwangi | 5121 | Surabaya Selatan |
| 5114 | Jember | 5122 | Bojonegoro |
| 5115 | Malang | 5123 | Sidoarjo |
| 5116 | Kediri | 5124 | Gresik |
| 5117 | Madiun | 5125 | Ponorogo |
| 5118 | Mojokerto | 5127 | Surabaya Barat |

Perintah `distriva:mims-sync-stock` (jadwal harian, memakai token server) menarik **semua** gudang aktif, jadi kini 130 gudang.
