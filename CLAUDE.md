# Aturan bersama agen AI DISTRIVA

Berlaku untuk semua agen (backend, frontend, dokumentasi). Aturan khusus Laravel ada di `backend/CLAUDE.md`.

## Bahasa
- Balasan, dokumen, dan pesan commit memakai bahasa Indonesia.

## Pembagian peran
- **Agen backend**: `backend/`, `docs/`, `tools/`. Tidak mengubah `frontend/`.
- **Agen frontend**: `frontend/`. Tidak mengubah `backend/`.
- Kebutuhan frontend dari perubahan backend hanya disampaikan lewat `docs/README-REVISI.md`.

## docs/README-REVISI.md
- Satu-satunya daftar tugas frontend. Jangan membuat salinan di tempat lain.
- Backend menambah baris di **Terbuka** setiap kali mengubah endpoint, kolom respons, izin, galat, atau perilaku yang terlihat frontend, dan memperbarui dokumen kontraknya (`docs/NN-*` atau `docs/PROMPT-FRONTEND-*`).
- Frontend memindahkan baris ke **Selesai** beserta nomor commit dan tes yang ditambah. Jangan menghapus baris Terbuka yang belum dikerjakan.

## Commit
- Commit hanya bila pengguna memintanya. Pengguna yang melakukan push.
- Stage berkas yang dikerjakan sendiri satu per satu (`git add <path>`). Jangan `git add -A` atau `git add .`, karena perubahan agen lain yang belum selesai ikut terbawa.
- Periksa `git diff --cached --stat` sebelum commit.

## Letak dokumen
- Root hanya berisi `README.md` dan `CLAUDE.md`. Dokumen lain di `docs/`; prompt peran agen di `docs/prompts/`.

## Keamanan
- Jangan menyimpan password, token, atau kredensial di repository atau log.
