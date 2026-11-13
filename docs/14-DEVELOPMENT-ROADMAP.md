# 14 — Development Roadmap DISTRIVA

**Versi dokumentasi:** 3.16.0  
**Metode:** Iterative development per modul  
**Panduan proses:** [`53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md`](53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md)

## Prinsip roadmap

Roadmap menunjukkan urutan dan dependensi, bukan gate administrasi global. Setiap tahap dapat dipecah menjadi beberapa iterasi kecil. Isu terbuka hanya menahan pekerjaan yang bergantung langsung pada isu tersebut. Jangan menunda modul independen hanya karena ada issue domain lain yang belum selesai.

## Urutan pengembangan

| Tahap | Area | Cakupan utama | Keluaran |
|---|---|---|---|
| 0 | Project foundation | Repository, environment, dokumentasi, coding convention, CI/test dasar | Proyek dapat dijalankan dan diuji |
| 1 | Foundation & authorization | Auth, user, role catalog, UP3/ULP, assignment, scoped authorization, audit | Login dan akses dasar teruji |
| 2 | Master data | Material, SKU, UOM, KHS, BOM, tarif, harga, parameter | Master data tervalidasi dan berversi |
| 3 | PB/PD applications | Sinkronisasi permohonan, PB/PD, status, riwayat, validasi | Alur permohonan teruji |
| 4 | Survey & drawing | Survey, hasil survey, gambar, revisi, review | Dokumen teknis berversi |
| 5 | Auto MTO | Ekstraksi dokumen/gambar, kandidat BOM, verifikasi petugas, snapshot | Hasil MTO tervalidasi |
| 6 | RKM planning | Perencanaan volume pekerjaan dan kebutuhan material per ULP/UP3 | RKM dan konsolidasi |
| 7 | RAB/KKF & feasibility | Perhitungan, snapshot, pembanding workbook, PDF | Perhitungan dapat direproduksi |
| 8 | Work order & execution | WO, approval, vendor, progres, verifikasi | Pelaksanaan terlacak |
| 9 | Warehouse integration | Integrasi/read-only sumber material eksternal, alokasi dan pemakaian sesuai batas sistem | Sinkronisasi material teruji |
| 10 | Forecasting | Forecast volume pekerjaan, konversi BOM, evaluasi model | Forecast dan metrik |
| 11 | Dashboard & reporting | KPI, rekap, filter, export, scope enforcement | Pelaporan sesuai hak akses |
| 12 | Hardening & deployment | Security, performance, backup/restore, observability, deployment | Release siap operasional |

## Status awal berdasarkan snapshot source v3.15.0

Status berikut adalah catatan audit pada 5 November 2026, bukan hasil pemeriksaan runtime baru atas lingkungan pengguna:
- Backend Laravel dan frontend React/Vite tersedia di paket.
- Foundation T4.2.1 memiliki migrations/models/service/test yang tercatat dalam audit sebelumnya.
- Policy/query scopes, transactional assignment write path, PostgreSQL service integration, dan persisted Sanctum E2E pernah dicatat belum lengkap atau belum diverifikasi.
- Master data, PB/PD, dokumen, dan domain lain memiliki spesifikasi desain; keberadaan implementasi harus diperiksa per fitur.
- Python service directories tidak terdapat pada paket source ini.
- Database tidak diperiksa atau diubah dalam reorganisasi dokumentasi ini.

## Cara memulai satu iterasi

1. Pilih satu modul dan tujuan kecil yang dapat diuji.
2. Baca requirement dan dokumen spesifik modul.
3. Audit file source, migration, route, model, test, serta konfigurasi yang relevan.
4. Tulis acceptance criteria dan dependensi yang benar-benar diperlukan.
5. Review keputusan yang berdampak; catat pertanyaan yang belum terjawab.
6. Implementasikan hanya scope iterasi.
7. Jalankan test yang relevan dan regresi.
8. Perbarui status, open issue, changelog, dan AI handoff.

## Aturan dependensi

- O-033 permission/action catalog menahan implementasi permission grant/Policy yang bergantung pada key final; tidak otomatis menahan pekerjaan UI atau domain yang tidak memerlukan perubahan authorization.
- O-034 resource lifecycle/schema menahan model/Policy/query scope untuk resource yang belum memiliki kontrak data; tidak otomatis menahan modul lain.
- O-029 vendor relationship menahan vendor access; tetap fail-closed sampai relasi dan aturan diverifikasi.
- O-036/O-038/O-039/O-041 hanya menahan bagian aplikasi/RKM, survey/meter, work order, dan RAB/KKF/feasibility yang membutuhkan keputusan tersebut.
- UOM, pricing precedence, dan sumber data eksternal harus diputuskan sebelum perhitungan yang bergantung padanya dinyatakan final.
- Database migration hanya dijalankan setelah target, dampak, backup, dan rencana pemulihan diperiksa. Ini kontrol keselamatan teknis, bukan persyaratan dokumen fisik.

## Definisi selesai

Tahap/iterasi selesai ketika acceptance criteria terpenuhi, test relevan memiliki hasil tercatat, authorization dan integritas data diperiksa, serta dokumentasi dan handoff diperbarui. Fitur yang belum diverifikasi harus tetap berstatus `IMPLEMENTED` atau `TESTED`, bukan `VERIFIED`.
