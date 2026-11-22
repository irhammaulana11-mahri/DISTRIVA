#!/usr/bin/env bash
# Memasang DISTRIVA ke Nginx dan PHP-FPM SISTEM (sudo). Idempoten; HANYA menambah berkas distriva*, situs dan kolam lain tidak diubah.
#  - kolam PHP-FPM "distriva": berjalan sebagai pengguna aplikasi (pemilik folder berkas dan cadangan), socket /run/php/distriva-fpm.sock,
#    batas unggah dan waktu proses dari variabel di bawah (Excel master penuh bisa >25 MB, batas aplikasi 60 MB)
#  - vhost Nginx: dashboard statis + /api ke Laravel, batas unggah sama dengan PHP
# Mode (satu per pemasangan; ulangi untuk berpindah):
#   sudo install-nginx.sh http    -> port 80 penuh tanpa TLS (jaringan internal) + jalur ACME untuk certbot
#   sudo install-nginx.sh https   -> TLS penuh dan pengalihan 80 ke 443 (butuh sertifikat di CERT_DIR; dibuat certbot)
#   sudo install-nginx.sh tunnel  -> untuk Cloudflare Tunnel: hanya mendengar 127.0.0.1:80 (TUNNEL_LISTEN), tanpa sertifikat
# Env: DISTRIVA_DOMAIN(wajib)  UPLOAD_MAX_MB(64)  PHP_MEMORY(512M)  PHP_MAX_EXEC(180)  FPM_MAX_CHILDREN(10)
#      CERT_DIR(/etc/letsencrypt/live/$DISTRIVA_DOMAIN)  HSTS_MAX_AGE(300; naikkan ke 31536000 setelah verify.sh lulus)  TUNNEL_LISTEN(127.0.0.1:80)
#      DRY_RUN=1 hanya mencetak apa yang akan dipasang
set -euo pipefail
[ "$(id -u)" = 0 ] || [ "${DRY_RUN:-0}" = 1 ] || { echo "jalankan dengan sudo" >&2; exit 1; }
mode="${1:?http|https|tunnel}"; D="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$D/../.." && pwd)"
if [ "$(id -u)" = 0 ]; then OWNER="${SUDO_USER:?jalankan lewat sudo (bukan sebagai root langsung)}"; asowner(){ sudo -u "$OWNER" "$@"; }; else OWNER="$(id -un)"; asowner(){ "$@"; }; fi
DOM="${DISTRIVA_DOMAIN:?isi DISTRIVA_DOMAIN, mis. distriva.contoh.id}"
[[ "$DOM" =~ ^[a-zA-Z0-9.-]+$ ]] || { echo "DISTRIVA_DOMAIN tidak valid: $DOM" >&2; exit 2; }
MB="${UPLOAD_MAX_MB:-64}"; [[ "$MB" =~ ^[0-9]+$ ]] && [ "$MB" -ge 1 ] || { echo "UPLOAD_MAX_MB harus angka" >&2; exit 2; }
PV="$(asowner php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')"
POOL="/etc/php/$PV/fpm/pool.d/distriva.conf"; SOCK=/run/php/distriva-fpm.sock; FPMSVC="php$PV-fpm"
WEB=/var/www/distriva-web; CONF=/etc/nginx/sites-available/distriva; LOCDIR=/etc/nginx/distriva
[ -d "/etc/php/$PV/fpm" ] || { echo "PHP-FPM $PV belum terpasang (apt install php$PV-fpm)" >&2; exit 2; }
[ -d "$ROOT/backend/public" ] || { echo "backend/public tidak ada di $ROOT" >&2; exit 2; }
PHPENV="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"      # PATH tetap dan bersih (bukan PATH pengguna); php, python3, pg_dump, Chrome ada di /usr/bin

pool_conf() { cat <<E2
; Dibuat install-nginx.sh. Kolam khusus DISTRIVA berjalan sebagai pengguna aplikasi agar berkas unggahan, cadangan, dan proses latar belakang
; (php artisan distriva:*-execute lewat nohup) memakai pemilik yang sama dengan cron schedule:run.
[distriva]
user = $OWNER
group = $OWNER
listen = $SOCK
listen.owner = www-data
listen.group = www-data
listen.mode = 0660
pm = dynamic
pm.max_children = ${FPM_MAX_CHILDREN:-10}
pm.start_servers = 2
pm.min_spare_servers = 2
pm.max_spare_servers = 4
pm.max_requests = 500
clear_env = no
env[PATH] = $PHPENV
php_admin_value[upload_max_filesize] = ${MB}M
php_admin_value[post_max_size] = ${MB}M
php_admin_value[memory_limit] = ${PHP_MEMORY:-512M}
php_admin_value[max_execution_time] = ${PHP_MAX_EXEC:-180}
php_admin_flag[display_errors] = off
php_admin_value[error_log] = $ROOT/backend/storage/logs/php-fpm-error.log
E2
}

if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "[dry-run] mode=$mode domain=$DOM pengguna aplikasi=$OWNER PHP=$PV unggah=${MB}M"
  echo "[dry-run] kolam FPM: $POOL"; pool_conf | sed 's/^/    /'
  echo "[dry-run] vhost: $CONF (+ $LOCDIR/distriva-locations.conf), web root: $WEB"
  exit 0
fi

install -d -m 755 /var/www/certbot "$LOCDIR"
install -d -m 755 -o "$OWNER" -g "$OWNER" "$WEB"          # dimiliki pengguna aplikasi: release.sh menyalin frontend tanpa sudo
[ -e "$WEB/index.html" ] || printf '<!doctype html><title>DISTRIVA</title>' > "$WEB/index.html"
chmod o+x "$(dirname "$ROOT")" 2>/dev/null || true
install -d -m 775 -o "$OWNER" -g "$OWNER" "$ROOT/backend/storage/logs"

# --- PHP-FPM kolam ---
tmp="$(mktemp -d)"; pool_conf > "$tmp/distriva.pool"
[ -e "$POOL" ] && cp -p "$POOL" "$POOL.bak.$(date +%s)"
install -m 644 "$tmp/distriva.pool" "$POOL"
if ! "php-fpm$PV" -t >/dev/null 2>&1; then
  echo "php-fpm$PV -t GAGAL: mengembalikan kolam sebelumnya" >&2
  last="$(ls -1t "$POOL".bak.* 2>/dev/null | head -n1 || true)"; if [ -n "$last" ]; then cp -p "$last" "$POOL"; else rm -f "$POOL"; fi
  exit 1
fi
systemctl reload "$FPMSVC" 2>/dev/null || systemctl restart "$FPMSVC"
echo "PHP-FPM kolam distriva aktif (pengguna $OWNER, unggah ${MB}M)."

# --- Nginx ---
DISTRIVA_DOMAIN="$DOM" CERT_DIR="${CERT_DIR:-/etc/letsencrypt/live/$DOM}" UPLOAD_MAX="${MB}m" FPM_SOCK="$SOCK" WEB_ROOT="$WEB" BACKEND_PUBLIC="$ROOT/backend/public" \
  "$D/bin/render-nginx.sh" "$tmp" "$mode" "${HSTS_MAX_AGE:-300}"
if [ "$mode" = https ] && [ ! -r "${CERT_DIR:-/etc/letsencrypt/live/$DOM}/fullchain.pem" ]; then
  echo "sertifikat belum ada di ${CERT_DIR:-/etc/letsencrypt/live/$DOM}: pasang dulu mode http, jalankan certbot, lalu ulangi mode https" >&2; rm -rf "$tmp"; exit 2
fi
install -m 644 "$tmp/distriva-locations.conf" "$LOCDIR/distriva-locations.conf"
sed -i "s#$tmp#$LOCDIR#g" "$tmp/distriva.conf"; cp "$tmp/distriva.conf" "$CONF.new"; rm -rf "$tmp"
[ -e "$CONF" ] && cp -p "$CONF" "$CONF.bak.$(date +%s)"
mv "$CONF.new" "$CONF"; ln -sf "$CONF" /etc/nginx/sites-enabled/distriva
if ! nginx -t; then
  echo "nginx -t GAGAL: mengembalikan konfigurasi sebelumnya" >&2
  last="$(ls -1t "$CONF".bak.* 2>/dev/null | head -n1 || true)"
  if [ -n "$last" ]; then cp -p "$last" "$CONF"; else rm -f "$CONF" /etc/nginx/sites-enabled/distriva; fi
  exit 1
fi
systemctl reload nginx && echo "Nginx dimuat ulang (mode $mode)."
echo "Berikutnya: deploy/production/bin/release.sh   lalu   DISTRIVA_URL=... deploy/production/bin/verify.sh"
