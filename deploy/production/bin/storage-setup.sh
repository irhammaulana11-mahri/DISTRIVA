#!/usr/bin/env bash
# Menyiapkan folder penyimpanan DISTRIVA di luar proyek (sudo): berkas unggahan (dokumen), cadangan, dan kotak masuk DIL.
# Bawaan: /srv/backup-data/distriva/{documents,backups,dil-inbox}, dimiliki pengguna yang menjalankan sudo (pengguna aplikasi/PHP-FPM kolam distriva).
# Idempoten, tidak menghapus apa pun. Tidak memindahkan berkas lama: lihat README bagian "Memindahkan berkas yang sudah ada".
# Pemakaian:  sudo deploy/production/bin/storage-setup.sh          DRY_RUN=1 untuk hanya mencetak langkah
# Env: DATA_ROOT(/srv/backup-data/distriva)  BACKUP_DIR(bawaan $DATA_ROOT/backups; isi bila cadangan di drive lain)
#      DOCS_DIR(bawaan $DATA_ROOT/documents)  DIL_DIR(bawaan $DATA_ROOT/dil-inbox)
set -euo pipefail
[ "$(id -u)" = 0 ] || [ "${DRY_RUN:-0}" = 1 ] || { echo "jalankan dengan sudo" >&2; exit 1; }
if [ "$(id -u)" = 0 ]; then OWNER="${SUDO_USER:?jalankan lewat sudo (bukan sebagai root langsung)}"; else OWNER="$(id -un)"; fi
DATA="${DATA_ROOT:-/srv/backup-data/distriva}"
DOCS="${DOCS_DIR:-$DATA/documents}"; BK="${BACKUP_DIR:-$DATA/backups}"; DIL="${DIL_DIR:-$DATA/dil-inbox}"
for p in "$DATA" "$DOCS" "$BK" "$DIL"; do
  case "$p" in /|/etc*|/usr*|/bin*|/var/www*|*..*) echo "lokasi tidak aman: $p" >&2; exit 2;; /*) ;; *) echo "harus path absolut: $p" >&2; exit 2;; esac
done
parent="$(dirname "$DATA")"
if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "[dry-run] pemilik: $OWNER"
  for p in "$DOCS" "$BK" "$DIL"; do echo "[dry-run] install -d -m 750 -o $OWNER -g $OWNER $p"; done
  mountpoint -q "$parent" 2>/dev/null && echo "[dry-run] $parent adalah titik mount" || echo "[dry-run] catatan: $parent bukan titik mount (drive terpisah belum terpasang?)"
  exit 0
fi
mountpoint -q "$parent" 2>/dev/null || echo "CATATAN: $parent bukan titik mount; berkas akan masuk ke drive tempat folder itu berada. Pastikan itu yang Anda maksud."
install -d -m 755 -o "$OWNER" -g "$OWNER" "$DATA"
for p in "$DOCS" "$BK" "$DIL"; do install -d -m 750 -o "$OWNER" -g "$OWNER" "$p"; echo "siap: $p"; done
t="$DOCS/.tulis-uji.$$"; sudo -u "$OWNER" sh -c "echo uji > '$t' && rm -f '$t'" && echo "uji tulis oleh $OWNER: BERHASIL" || { echo "uji tulis oleh $OWNER GAGAL" >&2; exit 1; }
df -h "$DATA" | tail -n1
echo
echo "Langkah berikut:"
echo "  DATA_ROOT=$DATA deploy/production/bin/make-env.sh   (menulis DISTRIVA_DOCUMENTS_ROOT, DISTRIVA_BACKUP_ROOT, DISTRIVA_DIL_INBOX ke backend/.env)"
[ "$(df -P "$DATA" | awk 'NR==2{print $1}')" != "$(df -P "$BK" | awk 'NR==2{print $1}')" ] || echo "PERHATIAN: cadangan dan berkas aktif di drive yang sama; salin cadangan ke drive/mesin lain (BACKUP_DIR=...)."
