# DISTRIVA

**Distribution Management Platform**

DISTRIVA adalah platform terpadu untuk pekerjaan distribusi PLN tingkat ULP/UP3: permohonan Pasang Baru (PB) dan Perubahan/Penambahan Daya (PD), survei dan gambar teknik, perhitungan RAB/KKF, persetujuan, pelaksanaan konstruksi, material, perencanaan RKM, serta analisa pengusahaan dan NKO.

> Nama proyek yang digunakan: **DISTRIVA**. Ketersediaan merek dagang, domain, dan persetujuan penggunaan identitas PLN belum diverifikasi.

## Struktur repository

```text
DISTRIVA/
├── backend/          # Laravel API (PHP, PostgreSQL)
├── frontend/         # React + Vite + Tailwind
├── database/         # fixture dan skrip PostgreSQL untuk pengujian
├── deploy/           # konfigurasi deployment
├── tools/            # skrip pendukung (sinkronisasi EIS, APKT, dll.)
├── test-evidence/    # bukti pengujian historis
├── docs/             # seluruh dokumentasi (single source of truth)
│   ├── README-REVISI.md   # daftar tugas frontend dari perubahan backend
│   ├── prompts/           # prompt peran untuk agen AI
│   └── NN-*.md            # kebutuhan, desain, kontrak API, handoff
├── CLAUDE.md         # aturan bersama untuk agen AI
└── README.md
```

## Mulai dari mana

1. [docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md](docs/53-DOCUMENTATION-AND-DEVELOPMENT-WORKFLOW.md): cara kerja dokumentasi dan pengembangan.
2. [docs/00-PROJECT-OVERVIEW.md](docs/00-PROJECT-OVERVIEW.md), [docs/PROJECT-CONTEXT-FOR-AI.md](docs/PROJECT-CONTEXT-FOR-AI.md), [docs/AI-HANDOFF.md](docs/AI-HANDOFF.md).
3. Spesifikasi modul yang sedang dikerjakan saja.
4. Agen frontend: [docs/README-REVISI.md](docs/README-REVISI.md), bagian **Terbuka**.

Urutan membaca lengkap untuk desain awal: dokumen 00, 01, 04, 03, 16 dan 18, 05 dan 06, modul 07–12, 13, 14, 17. Dokumen 34–52 adalah arsip analisis/audit, bukan gate aktif.

## Prinsip penting

- Satu database PostgreSQL sebagai sumber data utama; UUID sebagai primary key entitas inti.
- Laravel sebagai backend API; React + Vite sebagai frontend; Python dipisahkan sebagai layanan forecasting/Auto MTO.
- Hasil perhitungan RAB/KKF menyimpan snapshot versi data dan parameter yang digunakan.
- Forecasting menghasilkan rekomendasi, bukan keputusan pengadaan otomatis.
- Persetujuan RKM berada di tingkat UP3 dan berbeda dari proses PO/pengadaan.
- Hak stok ULP dibatasi di backend/database pada empat kelompok material yang telah ditetapkan.
- Keamanan, authorization, audit, backup, dan verifikasi target database wajib. Jangan menyimpan password atau token di repository.
- Dokumen ini bukan pengganti peraturan, standar teknik, atau keputusan pejabat berwenang.

## Riwayat

Riwayat versi dokumentasi dan keputusan yang digantikan ada di [docs/18-CHANGELOG-AND-SUPERSEDED-DECISIONS.md](docs/18-CHANGELOG-AND-SUPERSEDED-DECISIONS.md). Keputusan dan isu terbuka di [docs/15-DECISIONS-AND-OPEN-ISSUES.md](docs/15-DECISIONS-AND-OPEN-ISSUES.md).
