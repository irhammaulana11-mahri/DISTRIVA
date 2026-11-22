#!/usr/bin/env bash
# Render templat vhost ke <dir>/distriva.conf dan <dir>/distriva-locations.conf.
# Pemakaian: render-nginx.sh <direktori-keluaran> <mode: http|https|tunnel> [HSTS_MAX_AGE]
# Env: DISTRIVA_DOMAIN(wajib) CERT_DIR WEB_ROOT BACKEND_PUBLIC FPM_SOCK UPLOAD_MAX(64m) TUNNEL_LISTEN(127.0.0.1:80)
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)"; ROOT="$(cd "$D/../.." && pwd)"
out="${1:?direktori keluaran}"; mode="${2:?http|https|tunnel}"; hsts="${3:-300}"
DOM="${DISTRIVA_DOMAIN:?isi DISTRIVA_DOMAIN}"; WEB="${WEB_ROOT:-/var/www/distriva-web}"; PUB="${BACKEND_PUBLIC:-$ROOT/backend/public}"
SOCK="${FPM_SOCK:-/run/php/distriva-fpm.sock}"; UP="${UPLOAD_MAX:-64m}"; CERT="${CERT_DIR:-/etc/letsencrypt/live/$DOM}"
mkdir -p "$out"; LOC="$out/distriva-locations.conf"; hs=""
[ "$mode" = https ] && hs="add_header Strict-Transport-Security \"max-age=$hsts\" always;"
sed -e "s#@UPLOAD_MAX@#$UP#g" -e "s#@WEB_ROOT@#$WEB#g" -e "s#@BACKEND_PUBLIC@#$PUB#g" -e "s#@FPM_SOCK@#$SOCK#g" -e "s#@HSTS@#$hs#g" "$D/nginx/distriva-locations.conf.tpl" > "$LOC"
case "$mode" in
  http)   srv="server {
    listen 80;
    listen [::]:80;
    server_name $DOM;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    include $LOC;
}" ;;
  tunnel) TL="${TUNNEL_LISTEN:-127.0.0.1:80}"; case "$TL" in 80) L="listen 80; listen [::]:80;";; *) L="listen $TL;";; esac
          srv="server {
    $L
    server_name $DOM;
    include $LOC;
}" ;;
  https)  srv="server {
    listen 80;
    listen [::]:80;
    server_name $DOM;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name $DOM;
    ssl_certificate $CERT/fullchain.pem;
    ssl_certificate_key $CERT/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    include $LOC;
}" ;;
  *) echo "mode: http|https|tunnel" >&2; exit 1 ;;
esac
awk -v s="$srv" '{ if ($0=="@SERVERS@") print s; else print $0 }' "$D/nginx/distriva.conf.tpl" > "$out/distriva.conf"
