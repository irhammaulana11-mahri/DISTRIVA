# Prompt siap tempel — Permohonan satu pintu: tab Usulan Perluasan, input manual yang dilengkapi kemudian, ringkasan impor EIS (agen frontend)

Anda adalah agen frontend DISTRIVA (React/Vite di `frontend/`). Keputusan pemilik 8 Nov 2026 (docs/62 §47): menu **Permohonan** menjadi satu pintu; usulan dikelola sebagai tab di dalamnya. Jangan mengubah backend.

## Keputusan pemilik
- Menu `Usulan Pelanggan (3 Fasa)` di sidebar dihapus; **Usulan Perluasan** menjadi tab di halaman Permohonan. Usulan perluasan = **satu atau beberapa pelanggan**, kajian dihitung dalam **satu proses**.
- Permohonan **manual** (input lewat aplikasi) langsung tampil di daftar. Saat dibuat **belum punya No. Agenda, No. Register, IDPEL**; ketiganya dilengkapi kemudian lewat sunting.
- Permohonan dari **sinkronisasi EIS** hanya pelanggan **3 fasa, daya ≥ 6.600 VA**.
- Petugas survei = role **TEKNIK tiap ULP** (tidak dipilih per pelanggan); yang dapat disurvei hanya pelanggan pada ULP-nya. MANAGER_ULP boleh menugaskan TEKNIK tertentu, tetapi itu **opsional**.

## Kontrak API (sudah ada)
- `POST /api/applications` (buat; `customer.idpel` opsional) → permohonan berstatus `DRAFT`, `source_type: MANUAL`; `PATCH /api/applications/{id}` `{customer:{idpel?, phone?, email?}, …}`; setelah status bukan `DRAFT` hanya `phone`, `email`, **`idpel`** yang dapat dilengkapi (selain itu 409 dengan pesan server); **IDPEL dapat diisi sekali** (yang sudah tercatat tidak diganti: 409; milik pelanggan lain: 409; permohonan batal/restitusi: 409).
- `POST /api/applications/{id}/external-references` `{reference_type: AGENDA|PAYMENT_REGISTER, reference_number}`; `AGENDA` menaikkan status ke `APPROVED`.
- `POST /api/applications/imports` (stage) → `data.counts` kini `{NEW, MATCHED, UNCHANGED, REJECT, OUT_OF_SCOPE}`; **`OUT_OF_SCOPE`** = baris pelanggan baru di bawah 6.600 VA yang **tidak diimpor** (dihitung saja, tidak masuk pratinjau). `data.total_rows` = seluruh baris berkas.
- Usulan: endpoint `/api/proposals…` seperti sekarang (minimal satu pelanggan).
- `GET /api/applications?listing=pbpd&lifecycle=active|history` — **`listing=pbpd` kini menampilkan permohonan manual dan permohonan EIS yang 3 fasa (≥ 6.600 VA)** (sebelumnya hanya manual; panggilan yang ada tetap berlaku; permohonan EIS berdaya kecil yang lama tetap tersimpan tetapi tidak dicantumkan). **`lifecycle`**: `active` = masih berjalan, `history` = selesai (`CONNECTION_DONE`), batal (`CANCELLED`), atau restitusi (`REFUNDED`); tanpa parameter = semuanya. Data awal EIS sudah masuk: 431 permohonan, 240 di antaranya riwayat (200 selesai, 38 batal, 2 restitusi).

## Yang harus dibangun
1. **Satu pintu.** Hapus item sidebar "Usulan Pelanggan (3 Fasa)". Halaman Permohonan memiliki tab **"Permohonan"** dan **"Usulan Perluasan"** (URL `/permohonan?tab=usulan`); `/usulan` mengarahkan ke tab itu, `/usulan/:id` tetap sebagai halaman detail. Ganti semua teks "Usulan Banyak Pelanggan (3 Fasa)" / "Usulan Pelanggan (3 Fasa)" menjadi **"Usulan Perluasan"**, dengan deskripsi "Satu atau beberapa pelanggan dikaji dalam satu proses: survei, gambar, MTO, RAB, alokasi, SPK, dan KKF gabungan." Perbarui breadcrumb dan judul halaman.
1b. **Riwayat disembunyikan secara bawaan** (keputusan pemilik, pilihan A): daftar Permohonan memanggil `lifecycle=active` bila belum dipilih lain; tambahkan pilihan segmen "Aktif | Riwayat | Semua" (Semua = tanpa `lifecycle`). Chip hitungan menampilkan jumlah per pilihan bila tersedia. Keadaan kosong pada tab Aktif menyebut "Tidak ada permohonan aktif. Lihat Riwayat untuk permohonan yang sudah selesai atau dibatalkan."
2. **Input manual.** Tombol "Permohonan Baru" (hanya `applications.create`) tanpa mewajibkan No. Agenda/No. Register/IDPEL; permohonan baru langsung terlihat di daftar (status Draf). Pisahkan tombol **"Impor EIS"** (hanya `applications.import`) dari "Permohonan Baru".
3. **Melengkapi data kemudian.** Pada baris dan detail permohonan, tampilkan chip kekurangan bila ada: "Belum ada No. Agenda", "Belum ada No. Register", "Belum ada IDPEL", masing-masing dengan tombol "Lengkapi" yang membuka isian singkat (No. Agenda dan No. Register → `external-references`; IDPEL → `PATCH customer.idpel`). Setelah tersimpan chip hilang. IDPEL yang sudah ada tampil sebagai teks tetap (tanpa sunting). Setelah status bukan Draf, sunting nama/alamat/daya dinonaktifkan dan dijelaskan: "Hanya telepon, email, IDPEL, No. Agenda, dan No. Register yang dapat dilengkapi." Pesan 409/422 server tampil apa adanya.
4. **Ringkasan impor EIS.** Tampilkan `OUT_OF_SCOPE` pada ringkasan batch: "N pelanggan di bawah 6.600 VA tidak diimpor (di luar cakupan 3 fasa)" dan jelaskan bahwa permohonan yang sudah terdaftar tetap diperbarui. Tanpa error bila nilainya 0 atau kunci tidak ada.
5. **Keadaan kosong yang berguna.** Daftar kosong: untuk peran yang boleh membuat/mengimpor tampilkan dua tombol "Permohonan Baru" dan "Impor EIS" dengan satu kalimat bahwa data EIS hanya memuat pelanggan 3 fasa ≥ 6.600 VA; untuk peran lain: "Belum ada permohonan di ULP Anda."
6. **Usulan Perluasan.** Tab usulan: tombol "Buat Usulan Perluasan" yang boleh memilih **satu atau beberapa** pelanggan (tidak ada batas minimal kedua); dari tab Permohonan tambahkan kotak centang pada baris yang memenuhi syarat sehingga "Buat usulan dari yang dipilih" membuka pembuatan usulan dengan pelanggan terpilih. Baris permohonan yang sudah menjadi anggota usulan menampilkan tanda "Bagian dari usulan {nomor}" yang menautkan ke detail usulan.
7. **Survei dan usulan menunggu No. Agenda** (keputusan pemilik): tindakan "Mulai Survei" dan memilih permohonan untuk usulan hanya tersedia pada status Disetujui (No. Agenda sudah terbit), Dibayar, atau Cetak PK. Pada permohonan manual berstatus Draf/Diajukan, nonaktifkan tindakan itu dan tampilkan alasan: "Survei dan usulan dapat dimulai setelah No. Agenda terbit." Chip "Belum ada No. Agenda" menjadi penanda utamanya; tampilkan pesan server apa adanya bila tetap ditolak.
8. **Survei.** Pastikan layar survei tidak mewajibkan memilih petugas: TEKNIK ULP memulai langsung; pemilihan petugas hanya ditawarkan kepada MANAGER_ULP dan bersifat opsional.

## Aturan
Hak akses ditentukan backend; jangan menebak. Jangan mengubah komponen bersama kecuali mutlak perlu. Jalankan seluruh `npx vitest run` dan `npx vite build`; sesuaikan tes yang menyebut nama menu lama.

## Tes yang harus ada (vitest)
1. Sidebar tidak memuat "Usulan Pelanggan (3 Fasa)"; `/usulan` menampilkan tab Usulan Perluasan di halaman Permohonan.
2. "Impor EIS" dan "Permohonan Baru" terpisah dan mengikuti izin; keadaan kosong menampilkan tombol yang sesuai izin.
3. Chip "Belum ada IDPEL/No. Agenda/No. Register" muncul bila kosong, "Lengkapi" mengirim endpoint yang benar dan chip hilang; 409 server tampil verbatim.
4. Ringkasan batch menampilkan `OUT_OF_SCOPE` bila > 0 dan tidak error bila tidak ada.
5. Permohonan Draf/Diajukan tanpa No. Agenda: tindakan survei dan usulan nonaktif dengan alasan; setelah No. Agenda dilengkapi menjadi aktif.
6. Pembuatan usulan menerima satu pelanggan; tanda "Bagian dari usulan" tampil dan menaut.

Selesai bila: vitest hijau seluruhnya, build berhasil, dan di aplikasi nyata menu Permohonan satu pintu dengan tab Usulan Perluasan.
