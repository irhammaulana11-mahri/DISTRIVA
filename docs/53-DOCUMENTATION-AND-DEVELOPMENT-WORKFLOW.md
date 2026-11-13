# 53 — Panduan Dokumentasi dan Alur Pengembangan DISTRIVA

**Versi dokumentasi:** 3.16.0  
**Tanggal:** 6 November 2026  
**Status:** Berlaku sebagai aturan kerja proyek

## 1. Tujuan

Dokumentasi DISTRIVA harus membantu pengembangan dan menjaga konsistensi keputusan. Dokumentasi bukan proses administrasi yang menghambat analisis, coding, atau pengujian.

Pengembangan menggunakan pendekatan **iterative development per modul**. Tidak ada persyaratan nama asli, tanda tangan, SK, surat tugas, surat delegasi, atau dokumen fisik sebagai prasyarat internal untuk melakukan review dan pengembangan proyek.

## 2. Prinsip kerja

1. Keputusan dan hasil review dapat dicatat berdasarkan pembahasan proyek.
2. Catat peran/fungsi reviewer; nama orang bersifat opsional.
3. Bedakan fakta dari kode, keputusan bisnis, usulan desain, asumsi, dan pertanyaan yang belum terjawab.
4. Dokumen lama tetap disimpan sebagai riwayat; dokumen historis tidak otomatis menjadi gate aktif.
5. Open issue hanya memblokir bagian yang secara langsung bergantung padanya. Pekerjaan independen boleh berjalan.
6. Jangan mengubah keputusan bisnis yang sudah final secara diam-diam. Perubahan harus dicatat sebagai keputusan baru dan menjelaskan keputusan yang digantikan.
7. Jangan mengklaim fitur, test, migration, atau database sudah berhasil tanpa memeriksa bukti aktual.
8. Keamanan, authorization, audit trail, backup, integritas data, dan perlindungan data tetap wajib dijaga.

## 3. Sumber kebenaran

Urutan acuan:
1. Keputusan proyek terbaru yang eksplisit dan tercatat.
2. `docs/16-FINALIZED-BUSINESS-DECISIONS.md` untuk keputusan bisnis final.
3. `docs/15-DECISIONS-AND-OPEN-ISSUES.md` untuk status keputusan dan isu aktif.
4. Spesifikasi domain/modul yang relevan.
5. Desain arsitektur, database, API, dan technical status.
6. Source code, migration, konfigurasi, dan test sebagai bukti kondisi implementasi aktual.

Jika sumber bertentangan, jangan menebak. Tandai konflik, jelaskan dampaknya, lalu minta keputusan hanya untuk bagian yang terdampak.

## 4. Siklus pengembangan per modul

| Tahap | Aktivitas | Keluaran minimum |
|---|---|---|
| 1. Requirement | Pahami aktor, tujuan, alur, aturan, validasi, dan pengecualian | Requirement dan acceptance criteria |
| 2. Design | Rancang data, API, authorization, backend, frontend, dan integrasi | Desain ringkas dan keputusan teknis |
| 3. Review | Tinjau kebutuhan dan desain bersama peran terkait | Catatan review, keputusan, isu tersisa |
| 4. Implement | Kerjakan migration/model/service/controller/API/UI sesuai scope | Kode dan perubahan terukur |
| 5. Test | Jalankan test yang relevan dan regresi | Hasil test aktual dan bukti |
| 6. Verify | Cocokkan hasil dengan acceptance criteria | Status `VERIFIED` atau daftar gap |
| 7. Handoff | Perbarui status modul, keputusan, dan pekerjaan berikutnya | Catatan handoff |

Review tidak mensyaratkan formulir atau tanda tangan. Catatan sederhana cukup: tanggal, modul, aspek yang ditinjau, keputusan, reviewer berdasarkan peran (opsional), dan tindak lanjut.

## 5. Status standar

- `PROPOSED`: usulan, belum menjadi keputusan.
- `OPEN`: belum diputuskan atau belum dikerjakan.
- `IN_REVIEW`: sedang ditinjau.
- `DECIDED`: keputusan proyek telah dicatat.
- `IN_PROGRESS`: implementasi berlangsung.
- `IMPLEMENTED`: perubahan kode telah dibuat.
- `TESTED`: pengujian yang ditentukan telah dijalankan.
- `VERIFIED`: acceptance criteria terpenuhi.
- `BLOCKED`: bagian pekerjaan tertentu tidak dapat dilanjutkan karena dependensi yang disebutkan.
- `DEFERRED`: sengaja ditunda.
- `SUPERSEDED`: digantikan keputusan/desain lebih baru.

`APPROVED` boleh dipakai untuk keputusan desain/bisnis yang memang sudah disepakati, tetapi jangan gunakan status itu untuk menyatakan deployment/operasi database telah dilakukan.

## 6. Penanganan open issue

Setiap issue harus memiliki:
- masalah/pertanyaan yang spesifik;
- modul atau keputusan yang terdampak;
- dampak jika belum diputuskan;
- pilihan sementara yang aman (jika ada);
- status dan langkah berikutnya.

Jangan menerapkan blocker global jika hanya satu fitur yang terdampak. Contoh: vendor access tetap deny-all sampai relasi dan aturan vendor selesai, tetapi pekerjaan master data yang tidak bergantung pada vendor dapat berlanjut.

## 7. Pengamanan implementasi dan database

Pendekatan iteratif bukan izin untuk melakukan operasi berisiko tanpa pemeriksaan. Sebelum migration atau perubahan database:
- identifikasi koneksi dan database target dari konfigurasi aktual;
- pastikan target sesuai lingkungan yang dimaksud;
- buat backup bila data yang ada perlu dipertahankan;
- uji migration pada database pengembangan/test terlebih dahulu;
- jangan menjalankan `migrate:fresh`, `db:wipe`, atau operasi destruktif pada database yang berisi data penting;
- catat migration, hasil, rollback/forward recovery, dan test;
- jangan menampilkan kredensial atau secret dalam dokumentasi.

Production deployment dan perubahan production data tetap memerlukan prosedur operasional yang sesuai. Peniadaan dokumen fisik dalam proyek ini tidak menghilangkan kewajiban keamanan dan kehati-hatian teknis.

## 8. Struktur dokumentasi

### Dokumen masuk utama
- `README.md`
- `docs/00-PROJECT-OVERVIEW.md`
- `docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md`
- `docs/PROJECT-CONTEXT-FOR-AI.md`
- `docs/AI-HANDOFF.md`

### Dokumen acuan lintas modul
- `docs/01-BUSINESS-REQUIREMENTS.md`
- `docs/02-SYSTEM-ARCHITECTURE.md`
- `docs/03-ROLES-AND-ACCESS.md`
- `docs/14-DEVELOPMENT-ROADMAP.md`
- `docs/15-DECISIONS-AND-OPEN-ISSUES.md`
- `docs/16-FINALIZED-BUSINESS-DECISIONS.md`
- `docs/17-T4-TECHNICAL-DESIGN-STATUS.md`
- `docs/18-CHANGELOG-AND-SUPERSEDED-DECISIONS.md`

### Spesifikasi modul
Baca dokumen 04–13 dan dokumen T4/issue terkait hanya sesuai modul yang sedang dikerjakan.

### Arsip analisis dan audit
Dokumen 34–52 tetap tersedia sebagai riwayat analisis, audit, dan rancangan sebelumnya. Dokumen tersebut bukan daftar gate administrasi yang wajib dipenuhi untuk setiap coding. Jika ada isi yang bertentangan dengan panduan ini, gunakan panduan ini untuk tata cara kerja, tetapi jangan mengubah keputusan bisnis/teknis substantif tanpa mencatat keputusan baru.

## 9. Format catatan keputusan

```text
ID:
Tanggal:
Modul:
Topik:
Keputusan:
Alasan:
Dampak:
Status:
Reviewer/peran (opsional):
Dokumen/kode terdampak:
Tindak lanjut:
```

## 10. Definisi selesai per modul

Modul dapat dinyatakan `VERIFIED` jika:
- acceptance criteria dipenuhi;
- authorization dan validasi sisi server diperiksa;
- test relevan lulus atau keterbatasannya dijelaskan;
- migration/API/UI konsisten;
- tidak ada issue kritis tersembunyi;
- dokumentasi modul dan AI handoff diperbarui.

Dokumen ini mengatur cara kerja proyek. Dokumen ini tidak mengklaim bahwa issue terbuka, desain yang masih proposal, atau fitur yang belum diuji otomatis menjadi selesai.
