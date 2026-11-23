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
| 12 | Asset & network data | Master gardu/penyulang/pelanggan, histori pengukuran OMT, kualitas data | Histori aset dan pengukuran tervalidasi |
| 13 | Reliability & outage | Integrasi histori gangguan APKT, relasi gangguan-aset, indikator keandalan | Histori dan rekap gangguan terverifikasi |
| 14 | Performance management / NKO | Master KPI, target, realisasi, formula, bobot, polaritas, ranking, checkpoint | NKO ULP/UP3 dapat direproduksi |
| 15 | Commercial / Pengusahaan | Pemetaan proses, indikator, sumber data, monitoring dan tindak lanjut | Modul pengusahaan berdasarkan definisi tervalidasi |
| 16 | Energy loss analytics | Analisis energi/susut per penyulang dan gardu sesuai titik ukur yang tersedia | Analisis dengan lineage dan kualitas data |
| 17 | Cross-domain dashboard | Konsolidasi KPI operasional, pengusahaan, gangguan, aset, susut dan PB/PD | Dashboard lintas domain terotorisasi |
| 18 | Hardening & deployment | Security, performance, backup/restore, observability, deployment | Release siap operasional |

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


## Perluasan roadmap: aturan urutan

Roadmap baru bukan berarti semua domain harus dibangun sekaligus. Setiap domain melewati:
1. Inventarisasi sumber data dan pemilik proses.
2. Pemetaan field, definisi, formula, periode, unit, dan kualitas data.
3. Klarifikasi hak akses, aktor, workflow, dan output.
4. Desain model data dan kontrak integrasi.
5. Implementasi import/adapter dan validasi.
6. Backend, API, frontend, report, dan dashboard.
7. Rekonsiliasi dengan sumber dan uji penerimaan.

Prioritas teknis awal yang disarankan:
- Pertahankan dan stabilkan domain yang telah berjalan.
- Manfaatkan master gardu/penyulang/pelanggan dan pengukuran OMT yang telah terdokumentasi sebagai fondasi analisis jaringan.
- Bangun histori gangguan APKT dan NKO setelah kontrak/format data serta rumus tervalidasi.
- Petakan Pengusahaan dari spreadsheet sumber sebelum menetapkan tabel atau workflow.
- Analisis susut penyulang/gardu dilakukan setelah ketersediaan titik ukur energi dan metode perhitungan disepakati.


## Perluasan roadmap platform terpadu (track tambahan)

Tabel tahap 0–12 di atas tetap menjadi roadmap baseline pengembangan yang sudah terdokumentasi. Domain berikut adalah perluasan lanjutan; bukan pengganti atau penomoran ulang tahap baseline. Pengembangan dilakukan setelah audit status aktual dan pemetaan sumber data.

| Track | Domain | Fondasi yang sudah ada | Pekerjaan tambahan |
|---|---|---|---|
| X1 | Asset & network analytics | Master gardu, penyulang, pelanggan, pengukuran OMT (`docs/80–83`) | Audit kualitas/kelengkapan, relasi historis, analisis beban dan kapasitas |
| X2 | Histori gangguan & keandalan | Master aset/jaringan dan struktur organisasi | Pemetaan APKT, histori kejadian, relasi ke gardu/penyulang, indikator keandalan sesuai data |
| X3 | NKO/KPI | Belum ditemukan spesifikasi NKO dalam baseline Markdown | Ekstraksi workbook, master indikator, formula/bobot/polaritas berversi, target dan realisasi periodik |
| X4 | Pengusahaan | Spreadsheet acuan pemilik belum terbaca pada saat revisi | Pemetaan proses, indikator, formula, sumber data, aktor, periode, dan output |
| X5 | Analisis energi/susut | Data gardu/penyulang dan histori pengukuran OMT | Pemetaan titik ukur energi, formula yang disetujui, rekonsiliasi dan analisis per penyulang/gardu |
| X6 | Dashboard lintas domain | Reporting/dashboard baseline perlu diverifikasi terhadap source terkini | Konsolidasi PB/PD, pengusahaan, NKO, gangguan, pengukuran, dan susut dengan scope serta definisi konsisten |

### Urutan dan dependency tambahan

1. **Audit baseline terlebih dahulu.** Verifikasi implementasi master gardu/penyulang/pelanggan dan pengukuran OMT berdasarkan `docs/80–83`, `docs/57`, source, test, dan database yang disetujui.
2. **NKO:** petakan workbook `REALISASI UP3 MJK&ULP 2026 REV 3` dan `TRP ULP&UP3 MJK 2026 REV 3`; formula, bobot, polaritas, pembulatan, batas nilai, periode, dan target harus diverifikasi terhadap aturan resmi.
3. **Pengusahaan:** belum dapat dispesifikasikan sebelum isi Google Sheets acuan diekspor/dibaca. Jangan mengarang tab, kolom, indikator atau alur.
4. **Histori gangguan:** peroleh kontrak API atau ekspor APKT, lalu petakan external ID, waktu kejadian/pulih, gangguan, aset, penyulang, pelanggan terdampak, dan status penanganan.
5. **Analisis susut:** jangan memulai formula final sebelum titik ukur energi masuk/keluar, periode, batas jaringan, data penjualan/energi, koreksi, serta metode rekonsiliasi disepakati.
6. **Dashboard lintas domain:** dilakukan setelah definisi indikator, periode, kualitas data, dan authorization scope masing-masing domain konsisten.

Tidak semua track harus menunggu track lain. Misalnya pemetaan workbook NKO dapat berjalan paralel dengan pengumpulan kontrak APKT. Namun, analisis susut per penyulang/gardu bergantung pada ketersediaan titik ukur dan metode yang tervalidasi.
