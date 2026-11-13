# 66 — Serah-terima ke Agen Frontend: halaman BOM (persetujuan) + tambahan PBPD

**Untuk:** agen frontend DISTRIVA · **Dari:** sesi backend · **Tanggal:** 7 November 2026
**Sumber kebenaran API:** `docs/57-API-CONTRACT.md` (BOM di §3a, MTO di §3f). Jangan mengubah backend; bila kontrak kurang, tulis di §6.

## 1. Latar belakang
Spesifikasi halaman BOM sudah ada di **`docs/61` §3** (daftar, detail, impor, kalkulator) tetapi **belum dibangun** (folder `pages/master-data/` hanya berisi Kategori, Konstruksi, KHS, Material). Akibatnya persetujuan BOM kini hanya bisa lewat API. **Bangun halaman itu sekarang mengikuti docs/61 §3 + tambahan di dokumen ini.** Prioritas: **layar persetujuan** (daftar draf → detail → setujui dengan alasan), karena dua draf BOM PBPD menunggu persetujuan UP3_MANAGER.

## 2. Yang berubah sejak docs/61 (backend sudah selesai)
1. **Dua kelompok BOM baru:** `PBPD_6_41` (pasang baru/perubahan daya 6,6–41,5 kVA) dan `PBPD_53_197` (53–197 kVA). Total kelompok = 9. Nama tampilan usulan: "PBPD 6,6–41,5 kVA", "PBPD 53–197 kVA". Filter `group` pada daftar menerima kesembilan nilai.
2. **Kelompok PBPD tidak punya baris jenis konstruksi.** Di kalkulator, untuk kelompok `PBPD_*`: **jangan** memuat `/master-data/construction-types`, kirim `inputs` kosong (`[]` atau tanpa kunci); untuk kelompok lain `inputs` tetap wajib (422 bila kosong).
3. **Parameter kini punya tipe.** Setiap item `parameters[]` pada `GET /master-data/bom/{id}`: `{name, cell, description, default, group}` dan, untuk pilihan teks, juga **`type:"text"`** dan **`options:[…]`** (tanpa `type` = angka ≥ 0). Tampilan: `type:"text"` → dropdown dari `options` (ditambah pilihan kosong); angka → input angka. Nilai kosong boleh untuk teks. Nama PBPD: `PBPD:JENIS` (PBPD / PD …), `PBPD:PEMBAYARAN` (TUNAI/PLN; TUNAI = material dibeli vendor pelaksana), `PBPD:RENTANG_1..6` (rentang daya), `PBPD:PSG_1..6` (jumlah pasang baru/perubahan), `PBPD:BKR_1..6` (jumlah bongkar). Kelompokkan tampilannya sebagai 6 baris "rentang + Pasang + Bongkar", lalu Jenis pekerjaan dan Pembayaran.
4. **`params` pada `calculate` boleh berisi teks** (`{"PBPD:RENTANG_1":"23 kVA","PBPD:PSG_1":2}`); teks di luar `options` atau angka negatif → 422 (tampilkan `message`).
5. **Baris BOM dapat memiliki rumus kolom B** (kode KHS ditentukan rumus, bergantung pilihan rentang): pada `/lines`, `formulas` dapat memuat kunci **`B`** dan `khs_code` bisa `null`. Tampilkan "kode KHS ditentukan rumus" + teks rumus B (monospace). Pada hasil `calculate`, `khs_code` adalah kode **yang aktif** untuk masukan itu; `null` = baris tidak aktif (sembunyikan seperti baris 0).
6. **MTO** (`docs/57` §3f): `declared_params[]` sama (dengan `type`/`options`); `params` pada `PUT /mto/{id}/items` boleh berisi teks pilihan. `POST /mto/{id}/extract` kini menjawab juga `extraction.pbpd_applied` (bool) dan `extraction.pbpd_unmatched[]` (`label`, `reason`: `UNKNOWN_RANGE`/`TOO_MANY_ROWS`) — tampilkan sebagai peringatan "rentang daya tidak dikenali, pilih manual". Saat `pbpd_applied=false` blok PBPD hanya laporan (BOM PBPD belum disetujui).
7. Pilihan daya **7700 VA** = rentang `450-5500 VA` (harga sama); server memetakan otomatis.

## 3. Layar persetujuan (inti)
- Daftar: tampilkan **draf** menonjol (badge "Menunggu persetujuan") dengan `lines_count`, pembuat, tanggal berlaku, jumlah parameter.
- Detail draf → panel "Setujui": kolom **alasan wajib** (≤1000), tombol aktif bila `can['bom.approve']`. Kirim `POST /master-data/bom/versions/approve {version_ids:[id], reason}`; boleh pilih beberapa draf sekaligus (maks 50). **403** (mis. pembuat = penyetuju, atau tanpa hak) dan **409** (rumus bersiklus, kode KHS/jenis konstruksi belum APPROVED pada `valid_from`, tabrakan rentang) → tampilkan `message` apa adanya. Setelah sukses muat ulang daftar; versi APPROVED tampil tanpa tombol ubah.
- "Nonaktifkan" (`retire`) dengan alasan, hanya untuk APPROVED, hak `bom.approve`; konfirmasi eksplisit.
- Kalkulator (docs/61 §3.4) sebagai pratinjau sebelum menyetujui.

## 4. Data uji di `distriva_db` (baca saja)
Dua draf menunggu persetujuan: `PBPD_6_41` v1 (id `4a26a1ff-90ba-42ed-8559-9ccf1ca97020`, 19 baris, 20 parameter) dan `PBPD_53_197` v1 (id `9f241c1f-2bd5-42d1-98f4-a91d64c9bfe4`, 11 baris, 20 parameter), berlaku 2026-11-02, dibuat oleh ENGINEERING. Yang menyetujui: UP3_MANAGER (bukan pembuat). **Jangan menyetujui draf ini dari kode pengujian atau skrip; persetujuan dilakukan pemilik lewat layar.** Password akun milik pemilik — jangan ditulis di kode/dokumen.

## 5. Pengujian yang diminta
Vitest: daftar + filter 9 kelompok; detail menampilkan parameter bertipe teks sebagai dropdown dan rumus kolom B; kalkulator PBPD tidak memuat jenis konstruksi dan mengirim `params` teks; persetujuan mengirim payload benar, menampilkan 403/409; tombol mengikuti `can['bom.manage']`/`can['bom.approve']`; peringatan `pbpd_unmatched` pada hasil ekstraksi MTO.

## 6. Temuan frontend untuk backend
(isi bila kontrak kurang; jangan menebak.)
