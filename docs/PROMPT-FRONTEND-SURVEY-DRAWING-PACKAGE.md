# Prompt siap tempel — satu paket Survei + Gambar, satu rantai (agen frontend)

Anda agen frontend DISTRIVA (`frontend/`). Jangan ubah backend. Keputusan pemilik 8 Nov 2026 (docs/62 §48): **survei → upload gambar → persetujuan MULP → review Perencanaan & Konstruksi → Asman Perencanaan & Konstruksi → selesai**. Manager UP3 tidak lagi memutuskan survei/gambar.

## Perubahan kontrak backend
- Rantai survei kini 5 langkah: `ULP_MANAGER`, `REVIEW_PERENCANAAN`, `REVIEW_KONSTRUKSI`, `ASMAN_PERENCANAAN`, `ASMAN_KONSTRUKSI`. Langkah `UP3_MANAGER` **dihapus** (422 bila dikirim). Hapus dari tampilan rantai survei (`SurveyDetailView.jsx`: "RANTAI PERSETUJUAN") dan dari pemetaan stage/label; tahap setelah ASMAN langsung "Diterima". Stage `UP3_MANAGER` pada survei tidak muncul lagi.
- **Gambar dapat dibuat/diunggah sebelum survei disetujui** (`POST /applications/{id}/drawing`), asal hasil survei sudah **disimpan** dengan "memerlukan gambar = ya". Galat 409 yang mungkin: belum ada survei, penanda gambar belum diisi, atau survei menyatakan gambar tidak diperlukan — tampilkan pesan server apa adanya. Hapus anggapan "gambar hanya setelah survei DITERIMA" (teks kosong di tab Gambar Teknik: "Paket gambar dibuat bila hasil survei telah disetujui…" → "Paket gambar dibuat setelah hasil survei menyatakan memerlukan gambar; unggah sebelum Manager ULP menyetujui survei.").
- Urutan di UI Teknik ULP: isi & simpan survei (centang "Memerlukan Gambar") → buka tab Gambar Teknik, **Buka Paket Gambar**, isi judul + berkas utama, **ajukan paket gambar** → ajukan hasil survei. (MTO tetap disetujui Manager ULP sebelum Manager ULP menyetujui survei.)
- `GET /drawings/{id}` → tiap versi punya `with_survey` (bool) dan `survey_version_id`. Bila `with_survey` true: **sembunyikan tombol keputusan/eskalasi gambar** (`can.decide` kosong); tampilkan keterangan "Gambar ini diputuskan bersama survei (satu paket)" dengan tautan ke survei. Tahap gambar (stage) mengikuti tahap survei.
- **Gerbang MULP:** `POST /surveys/{id}/versions/{vid}/decisions` langkah `ULP_MANAGER` APPROVED dapat 409 ("Survey ini memerlukan gambar teknik: …" atau "MTO … belum disetujui"). Tampilkan pesan itu; di panel Manager ULP tampilkan daftar periksa: gambar diajukan? MTO disetujui?
- **Penolakan** di langkah mana pun mengembalikan survei **dan** gambar: dua draf baru; tampilkan alasan pada keduanya.
- Revisi gambar yang sudah disetujui: tombol revisi tetap; rantainya MULP → review → Asman (tanpa survei ulang), tanpa Manager UP3 kecuali persetujuan diperluas yang sudah ada.
- Cabang PBP (> 60 bulan) hanya pada persetujuan RAB/KKF; tidak ada di survei/gambar.

## Tes (vitest)
Rantai survei 5 langkah tanpa Manager UP3; tombol keputusan gambar tersembunyi saat `with_survey`; pesan galat gerbang MULP tampil; teks tab Gambar Teknik baru. `npx vitest run` dan `npx vite build` hijau.

## Tambahan: survei dibatalkan karena usulan dibatalkan
- Survei dengan `status = CANCELLED` dan `cancel_reason` berawalan "Usulan dibatalkan:" tampil di tab "Survei & Pengukuran" sebagai kartu abu-abu dengan lencana **Dibatalkan** dan alasannya; survei aktif tampil paling atas; tidak ada tombol tindakan pada survei dibatalkan (`can` kosong).
- Versi gambar `RETURNED` dengan `returned_at_step = PROPOSAL_CANCELLED` tampil "Dikembalikan: usulan dibatalkan" (bukan "dikembalikan oleh reviewer"); tidak ada draf baru.
- Teks unggah gambar utama: tulis format yang didukung, dan beri petunjuk "Unggah lembar GAMBAR Excel (xlsx/xls) atau PDF hasil ekspor Excel agar kebutuhan material terbaca otomatis; DWG/DXF/foto sebagai lampiran, jumlah diisi manual."

## Tambahan: usulan "Selesai tanpa perluasan"
- `proposals.status` kini bisa `COMPLETED_NO_EXTENSION` (selain `OPEN`/`CANCELLED`): tampilkan lencana hijau "Selesai tanpa perluasan" di daftar dan detail usulan, filter status ikut, tanpa tombol ubah anggota/batalkan; anggotanya berstatus lepas dan muncul sebagai permohonan biasa di tab Permohonan.
- Respons keputusan survei membawa `result.proposal_closed` (nomor usulan) bila keputusan terakhir menutup usulan: tampilkan toast "Usulan {nomor} selesai tanpa perluasan; anggotanya kini permohonan biasa".
- Form survei: label "Memerlukan Perluasan Jaringan" harus punya dua pilihan tegas Ya/Tidak (jangan biarkan kosong); beri keterangan: "Tidak = usulan ditutup setelah survei diterima".
