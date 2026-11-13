# Serah terima frontend — stok, tiang/KR, alokasi, RKM (docs/62 §30–31)
Backend siap di kode (tes lulus); migrasi 160000/170000 belum diterapkan ke `distriva_db`. Kontrak: docs/57.

## 1. Master data (menu Master Data)
- **Gudang**: daftar + tambah (`warehouses.manage` = peran Konstruksi/Gudang, yaitu KONSTRUKSI_UP3). **Stok**: per gudang daftar cuplikan; impor CSV (dry run → tabel baris/galat → terapkan) dengan tanggal; detail cuplikan; **posisi stok** (pilih gudang + tanggal).
- **Kontrak Rinci tiang** (`poles.manage` = PERENCANAAN): daftar (nomor KR; TM dan TR: total/teralokasi/sisa), tambah, ubah jumlah (alasan wajib), tutup, detail dengan riwayat.
## 2. Alokasi (pada halaman permohonan, setelah MTO disetujui)
Tombol buat alokasi; **dua bagian terpisah**: (a) **material selain tiang beton** (`allocations.manage`, KONSTRUKSI_UP3): kode KHS dari MTO, gudang, jumlah — tampilkan kebutuhan MTO dan stok tersedia; simpan; **Konfirmasi material**; (b) **tiang beton** (`allocations.poles`, PERENCANAAN): pilih KR, jenis TM/TR, jumlah — tampilkan sisa KR; simpan; **Konfirmasi tiang**. Tiap bagian hanya bisa diedit/dikonfirmasi oleh pemegang izinnya; bagian terkonfirmasi baca-saja dan langsung mereservasi; alokasi berstatus CONFIRMED bila kedua bagian terkonfirmasi; batalkan (alasan). 409 menjelaskan stok/KR yang kurang.
## 3. RKM (menu Perencanaan)
- Daftar rencana per periode dengan versinya. Detail versi per status: **COLLECTING** — tiap ULP: kaitkan paket MTO, isi pipeline/forecast, ajukan; PERENCANAAN: mulai validasi. **VALIDATING** — PERENCANAAN: sesuaikan kuantitas (alasan); keputusan per langkah (hanya langkah yang izinnya dimiliki): Setuju / Kembalikan / Tolak (alasan wajib). **APPROVED** — baca-saja + kebutuhan bersih beku + tombol Amandemen.
- Panel **Kebutuhan bersih** (UP3): per KHS kebutuhan kotor, sudah dialokasikan, stok tersedia, stok pengaman, pasokan masuk, kebutuhan bersih; per ULP.
- Pengguna ULP hanya melihat usulannya; ringkasan keputusan hanya untuk UP3.
## 4. Aturan UI dan tes
Tampilan menurut izin (`rkm.*`, `allocations.*`, `stock.import`, `poles.manage`) fail-closed; pesan 403/404/409/422 apa adanya. Tes Vitest: tombol menurut izin, alur status RKM, konfirmasi alokasi menampilkan 409, format angka.
