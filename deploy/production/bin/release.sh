#!/usr/bin/env bash
# Rilis DISTRIVA di server produksi (TANPA sudo). Urutan: periksa -> build -> cadangan segar -> mode pemeliharaan -> migrasi -> cache -> frontend -> aktif -> preflight.
# Pemakaian (dari checkout git bersih pada tag/commit yang dirilis):  deploy/production/bin/release.sh
# Rilis PERTAMA (database kosong): FIRST_RUN=1 (melewati cadangan, menjalankan seeder izin satu per satu sesuai docs/85 §4).
# Rilis berikutnya: seeder izin HANYA bila ada kunci izin baru, atas persetujuan pemilik: SEED_PERMISSIONS=1.
# Env: WEB_ROOT(/var/www/distriva-web)  BACKUP_MAX_AGE_H(26)  FIRST_RUN(0)  SEED_PERMISSIONS(0)  SKIP_BACKUP(0)  ALLOW_DIRTY(0)  DRY_RUN(1 hanya mencetak langkah)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; BE="$ROOT/backend"; WEB="${WEB_ROOT:-/var/www/distriva-web}"; ENVF="$BE/.env"
say(){ printf '\n== %s\n' "$*"; }; die(){ echo "GAGAL: $*" >&2; exit 1; }
SEEDERS="FoundationPermissionSeeder MasterDataPermissionSeeder ApplicationPermissionSeeder KkoPermissionSeeder SurveyPermissionSeeder MtoPermissionSeeder RabPermissionSeeder KkfPermissionSeeder DrawingPermissionSeeder SubstationPermissionSeeder PlanningPermissionSeeder BackupPermissionSeeder SystemSettingsPermissionSeeder OutagePermissionSeeder"
if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "[dry-run] 1 periksa git bersih, backend/.env, APP_ENV=production"; echo "[dry-run] 2 composer install --no-dev -o; npm ci; npm run build"
  [ "${FIRST_RUN:-0}" = 1 ] || echo "[dry-run] 3 cadangan segar (maks ${BACKUP_MAX_AGE_H:-26} jam) atau distriva:backup --documents"
  echo "[dry-run] 4 artisan down; migrate --force"
  { [ "${FIRST_RUN:-0}" = 1 ] || [ "${SEED_PERMISSIONS:-0}" = 1 ]; } && echo "[dry-run] 5 seeder izin: $SEEDERS"
  echo "[dry-run] 6 config:cache route:cache event:cache; salin frontend/dist ke $WEB; artisan up; distriva:preflight"; exit 0
fi
cd "$ROOT"
say "1. Pemeriksaan"
[ -f "$ENVF" ] || die "backend/.env belum ada (jalankan make-env.sh)"
envv(){ grep -E "^$1=" "$ENVF" | head -1 | cut -d= -f2-; }
[ "$(envv APP_ENV)" = production ] || die "APP_ENV bukan production di backend/.env"
[ "$(envv APP_DEBUG)" = false ] || die "APP_DEBUG harus false di backend/.env"
if [ "${ALLOW_DIRTY:-0}" != 1 ]; then [ -z "$(git status --porcelain --untracked-files=no)" ] || die "ada perubahan lokal di berkas terlacak; rilis hanya dari commit bersih"; fi
echo "Commit: $(git rev-parse --short HEAD) $(git log -1 --format=%s)"
[ -d "$WEB" ] && [ -w "$WEB" ] || die "$WEB tidak dapat ditulis (jalankan install-nginx.sh sekali)"
say "2. Build"
( cd backend && composer install --no-dev --optimize-autoloader --no-interaction )
( cd frontend && npm ci --include=dev --no-audit --no-fund && npm run build )
[ -f frontend/dist/index.html ] || die "build frontend tidak menghasilkan dist/index.html"
say "3. Cadangan segar sebelum migrasi"
if [ "${FIRST_RUN:-0}" = 1 ] || [ "${SKIP_BACKUP:-0}" = 1 ]; then echo "dilewati (FIRST_RUN/SKIP_BACKUP)"; else
  BK="$(envv DISTRIVA_BACKUP_ROOT)"; [ -n "$BK" ] || BK="$BE/storage/app/private/backups"
  nb="$(find "$BK" -name '*.dump' -type f -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2- || true)"
  age=999999; [ -n "$nb" ] && age=$(( ($(date +%s) - $(stat -c %Y "$nb")) / 3600 ))
  if [ "$age" -le "${BACKUP_MAX_AGE_H:-26}" ]; then echo "cadangan terbaru berumur ${age} jam: $(basename "$nb")"
  else echo "cadangan terbaru berumur ${age} jam: membuat yang baru (artisan distriva:backup --documents)"; ( cd backend && php artisan distriva:backup --documents ) || die "cadangan gagal; rilis dihentikan"; fi
fi
say "4. Mode pemeliharaan dan migrasi"
( cd backend && php artisan down --retry=60 >/dev/null 2>&1 || true
  php artisan migrate --pretend --force 2>&1 | grep -E "^\s+[0-9]{4}_" | sed 's/^/   akan dijalankan: /' || true
  php artisan migrate --force ) || die "migrasi gagal; aplikasi TETAP dalam mode pemeliharaan. Perbaiki lalu 'cd backend && php artisan up'"
say "5. Seeder izin"
if [ "${FIRST_RUN:-0}" = 1 ] || [ "${SEED_PERMISSIONS:-0}" = 1 ]; then
  for s in $SEEDERS; do ( cd backend && php artisan db:seed --class="$s" --force >/dev/null ) && echo "  $s selesai" || die "seeder $s gagal"; done
else echo "dilewati (SEED_PERMISSIONS=1 hanya bila ada kunci izin baru)"; fi
say "6. Cache dan frontend"
( cd backend && php artisan config:cache && php artisan route:cache && php artisan event:cache )
rm -rf "$WEB"/assets "$WEB"/index.html && cp -r frontend/dist/. "$WEB"/ && chmod -R a+rX "$WEB"
say "7. Aktif kembali dan pemeriksaan"
( cd backend && php artisan up )
( cd backend && php artisan distriva:documents-check ) || echo "PERINGATAN: pemeriksaan folder dokumen melaporkan masalah (lihat di atas)"
( cd backend && php artisan distriva:preflight ) || echo "PERINGATAN: preflight melaporkan GAGAL; perbaiki sebelum dipakai (cron belum dipasang? jalankan cron-setup.sh)"
echo; echo "Rilis selesai. Berikutnya: DISTRIVA_URL=https://<domain> deploy/production/bin/verify.sh"
