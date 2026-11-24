# README-REVISI — Daftar perubahan backend yang perlu ditindaklanjuti frontend

Satu pintu bagi agen frontend. Setiap progres cukup membaca berkas ini: bagian **Terbuka** menunjuk apa yang perlu dibuat atau diperbaiki beserta dokumen kontraknya. Detail API tidak ditulis di sini, tetapi di dokumen yang ditunjuk.

## Aturan pakai

**Agen backend** — setiap kali membuat atau mengubah backend yang menyentuh frontend (endpoint baru atau berubah, kolom respons, izin, perilaku, galat, data contoh):
1. Perbarui dokumen kontraknya (docs/NN atau PROMPT-FRONTEND-*) agar sesuai kode.
2. Tambahkan satu baris pada tabel **Terbuka** di sini (tanggal, commit, apa yang berubah, dokumen rujukan, kebutuhan frontend). Perubahan murni internal tanpa dampak ke frontend tidak perlu dicatat.
3. Jangan menghapus baris Terbuka milik orang lain; ubah statusnya hanya bila memang sudah dikerjakan.

**Agen frontend** — kerjakan baris Terbuka dari atas ke bawah, baca dokumen rujukannya, lalu pindahkan baris ke **Selesai** dengan commit dan catatan singkat (tes yang ditambah). Bila kontrak tidak jelas atau respons tidak sesuai dokumen, tulis temuan pada kolom Catatan baris itu supaya backend memperbaikinya, jangan menebak.

Status: `BARU` (belum disentuh), `SEBAGIAN` (sebagian dikerjakan), `BLOKIR` (menunggu backend atau keputusan pemilik).

## Terbuka

| # | Tanggal | Commit | Perubahan backend | Dokumen | Yang perlu dibuat/diperbaiki di frontend | Status | Catatan |
|---|---|---|---|---|---|---|---|
| 1 | 2026-11-24 | 78d243d | Modul **Analisa Pengusahaan**: `GET /pengusahaan/metrics` dan `GET /pengusahaan/metrics/{code}`; izin `pengusahaan.view` (juga di `GET /planning/access`) | docs/91 | Menu baru "Analisa Pengusahaan" dengan submenu per metrik dari `GET /metrics` (13 metrik tersedia, `susut` `available=false` tampil nonaktif). Satu pola halaman untuk semua: filter unit (dari `units`) dan rentang bulan; kartu ringkas (latest, MoM, YoY, kumulatif; warna mengikuti `polarity`); grafik `values` lawan `previous_year`; rincian (`breakdown`); tabel perbandingan ULP (`comparison`, hanya UP3); `insights`; penanda bulan kosong dari `coverage` dan penanda angka UP3 belum utuh dari `units_reporting`/`units_expected` (tambahan 2026-11-24, lihat docs/91 §3). Gerbang menu: kapabilitas `pengusahaan.view`. Halaman Analisa Gangguan dan Analisis Pelanggan yang ada tetap dipakai, menu Gangguan dan Pelanggan boleh menautkannya | BARU | `null` pada deret berarti tidak ada data, bukan nol. Respons keluhan memuat artefak data sumber (response time 0 pertengahan 2024–2025), jangan dianggap bug tampilan. Persentase perubahan dihitung setara (`comparison_basis`), jadi bisa tidak sama dengan selisih dua angka yang tampil; beri keterangan kecil pada kartu bila `comparison_basis` < `units_expected` |
| 2 | 2026-11-24 | 6e568cd | Masukan pembantu NKO dibuat umum: `GET /nko/inputs` memuat item `auxiliary=true` (kode `kwh-beli`, `e-min`, `pssd`, `prr-lunas`, `ex-prr-lunas`) dengan `group` "Masukan pembantu: ..." | docs/90 | Pastikan tabel masukan menampilkan dan menyimpan item pembantu lewat `PUT /inputs` (satuan: kWh untuk susut, Rp juta untuk pelunasan). Frontend sudah membaca `auxiliary`; verifikasi tampilannya untuk indikator susut dan pelunasan | SEBAGIAN | Diperiksa backend 2026-11-24 (4bc70bf+): tampilan dan penyimpanan butir pembantu sesuai kontrak, 32 butir muncul untuk Jombang. Perubahan backend: `PUT /inputs` kini melewati butir yang tidak berubah dan mengembalikan `changed`. Frontend: tampilkan pesan dari respons (mis. "Tidak ada perubahan masukan." bila `changed`=0). Opsional: kirim hanya butir yang diubah. Setelah itu pindahkan ke Selesai |
| 3 | 2026-11-24 | 0107373 | `GET /nko/gaps?year=&month=&up3_id=`: ringkasan kekurangan per unit (`KOSONG`, `BELUM_TERVALIDASI`) | docs/90 | Panel ringkasan kekurangan pada halaman NKO (jumlah per unit, daftar indikator, tautan ke masukan). Klien API sudah ada di `services/api.js` | SEBAGIAN | Diperiksa backend 2026-11-24: tab "Kekurangan Realisasi" sudah sesuai kontrak (ringkasan, filter, rincian per unit, tombol Buka Masukan). Respons UP3 Mojokerto 11 unit sekitar 0,5 detik. Lencana jumlah pada judul tab baru terisi setelah tab dibuka; bila ingin selalu tampil, muat `/nko/gaps` saat halaman dibuka. Setelah itu pindahkan ke Selesai |

## Selesai

| # | Tanggal | Perubahan | Dikerjakan frontend (commit) |
|---|---|---|---|
| - | - | (kosong) | - |

## Riwayat kontrak yang sudah ada (acuan)

- NKO/KPI: docs/89 (master definisi), docs/90 (perhitungan, masukan, koreksi beralasan, peringkat, API).
- Laporan EIS bulanan: docs/88. Data gangguan penyulang: docs/87.
- Analisa pengusahaan: docs/91.
- Prompt frontend sebelumnya: berkas `PROMPT-FRONTEND-*.md` di folder docs.
