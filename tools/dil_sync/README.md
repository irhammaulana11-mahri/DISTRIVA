# dil_sync — muat DIL ke master pelanggan DISTRIVA (docs/81)

Membaca DIL (`.mdb` lewat `mdb-export` dari mdbtools, atau CSV), hanya kolom yang dibutuhkan master, lalu mengirim per 1.000 baris ke `POST /api/master-data/customer-connections/batches/{id}/items` (idempoten per IDPEL).
**NIK, NPWP, telepon, email, alamat, dan koordinat tidak pernah dibaca.** Nama yang belum bertopeng disamarkan sebelum dikirim.

```
pip install -r requirements.txt            # requests, python-dotenv
sudo apt install mdbtools                  # hanya untuk berkas .mdb
cp .env.example .env                       # DISTRIVA_URL, DISTRIVA_EMAIL, DISTRIVA_PASSWORD
python main.py inspect SUMBER.mdb --table NAMA_TABEL            # ringkasan agregat saja
python main.py load SUMBER.mdb --table NAMA_TABEL --units 51453 --dry-run
python main.py load SUMBER.mdb --table NAMA_TABEL --units 51453  # tanpa --units = semua ULP dalam cakupan akun
```
Akun: Niaga Retail UP3, Perencanaan, atau Enjiniring (kunci `customers.import`). SYS_ADMIN memerlukan MFA sehingga tidak dapat dipakai untuk muat otomatis.
Pelanggan yang gardunya belum ada di master tetap disimpan dan tertaut otomatis saat gardunya diimpor. Tes: `python3 -I tests/test_dil.py`.
