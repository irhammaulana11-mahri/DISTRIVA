#!/usr/bin/env bash
# Memasang SATU baris cron untuk pengguna aplikasi (tanpa sudo): php artisan schedule:run tiap menit. Idempoten; tidak menyentuh baris cron lain.
# Penjadwal menjalankan cadangan harian, sinkronisasi EIS dan MIMS, pengingat tugas, dan forecast bulanan (docs/84 bagian 1).
# Pemakaian:  deploy/production/bin/cron-setup.sh        DRY_RUN=1 hanya mencetak baris yang akan dipasang      REMOVE=1 melepas baris ini
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; PHPBIN="$(command -v php)"; TAG="# distriva-schedule"
LINE="* * * * * cd $ROOT/backend && $PHPBIN artisan schedule:run >> /dev/null 2>&1 $TAG"
cur="$(crontab -l 2>/dev/null || true)"
if [ "${REMOVE:-0}" = 1 ]; then
  printf '%s\n' "$cur" | grep -vF "$TAG" | crontab - && echo "baris cron DISTRIVA dilepas"; exit 0
fi
if printf '%s\n' "$cur" | grep -qF "$TAG"; then echo "sudah terpasang:"; printf '%s\n' "$cur" | grep -F "$TAG"; exit 0; fi
if [ "${DRY_RUN:-0}" = 1 ]; then echo "[dry-run] akan menambahkan: $LINE"; exit 0; fi
{ [ -z "$cur" ] || printf '%s\n' "$cur"; printf '%s\n' "$LINE"; } | crontab -
echo "terpasang: $LINE"
echo "Detak penjadwal dicatat tiap menit; 'php artisan distriva:preflight' memberi FAIL bila lebih dari 3 menit tidak berdetak."
