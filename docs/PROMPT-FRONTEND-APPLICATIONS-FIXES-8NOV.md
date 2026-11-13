# Prompt siap tempel — perbaikan Permohonan & Survei (agen frontend)

Anda agen frontend DISTRIVA (`frontend/`). Jangan ubah backend. Tiga perbaikan:

## 1. Kolom daya/tarif di daftar Permohonan (`pages/applications/ApplicationsPage.jsx`)
`GET /api/applications` kini juga mengirim `old_tariff_code`, `new_tariff_code`, `new_power_value`, `new_power_unit` (`kVA`/`VA`, nilai string desimal) di samping `delta_power_kva`.
- Tampilkan **Tarif & Daya Baru** (mis. `B2T · 13,2 kVA`; `-` bila kosong) sebagai kolom sendiri.
- Kolom yang sekarang "Daya / Tarif" (`Δ x kVA`) diberi judul **Selisih Daya**.
- Modal usulan perluasan sudah memakai `new_tariff_code`/`new_power_*`; samakan format tampilannya. Ganti teks info modal: bukan lagi "hanya 3 fasa ≥ 6,6 kVA", tetapi "semua pelanggan berstatus mohon, disetujui, bayar, atau cetak PK, berapa pun daya dan tarifnya, pada ULP Anda yang belum masuk usulan aktif lainnya".

## 2. Penamaan No. Register
Satu istilah di seluruh UI: **"No. Register"** (artinya sama dengan Payment Register). Cari `grep -rni "payment register" src` dan seragamkan label, placeholder, tooltip, dan pesan galat. Nilai teknis `PAYMENT_REGISTER` (kode API) **tidak** diubah.

## 3. Ajukan hasil survei menyimpan isi form (`pages/surveys/SurveyDetailView.jsx`)
Masalah: surveyor mengisi form lalu langsung menekan "Ajukan Hasil Survei" tanpa "Simpan Draf"; server hanya memeriksa draf tersimpan (kosong), sehingga muncul "Hasil survey belum lengkap; lengkapi: tanggal survey, temuan, …" padahal form terisi.
Backend kini: `POST /api/surveys/{id}/versions/{vid}/submit` menerima **isi form yang sama dengan PATCH draf** (opsional), memvalidasinya (422 bila tidak sah), menyimpannya dan mengajukannya dalam satu langkah.
- `handleSubmitSurvey` mengirim payload yang sama dengan `handleSaveDraft` (bangun sekali di fungsi bersama) ke `surveyApi.submit(surveyId, versionId, payload)`; perbarui `services/api.js` agar `submit` meneruskan body.
- Pesan galat server ditampilkan apa adanya; setelah berhasil muat ulang survei.
- Tombol "Simpan Draf" tidak boleh tampak berputar terus: pastikan `savingDraft` kembali `false` (di screenshot tombol terlihat dalam keadaan memuat).
- Tes vitest: submit mengirim isi form; galat 409/422 tampil; "No. Register" konsisten.

Selesai bila `npx vitest run` hijau dan `npx vite build` berhasil.
