#!/usr/bin/env bash
# Pemeriksa READ-ONLY sebelum memasang DISTRIVA di server: tidak mengubah apa pun, tidak memakai sudo, tidak mencetak rahasia.
# Pemakaian:  deploy/production/bin/preflight.sh | tee preflight.txt        (ulangi sampai tidak ada GAGAL)
# Env: DATA_ROOT(/srv/backup-data/distriva)  DISTRIVA_DOMAIN(opsional; nama host)  SERVER_IP(opsional; dibandingkan dengan DNS)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; DATA="${DATA_ROOT:-/srv/backup-data/distriva}"
W=0; F=0
ok(){ printf '[OK      ] %s\n' "$*"; }; warn(){ printf '[PERINGATAN] %s\n' "$*"; W=$((W+1)); }; bad(){ printf '[GAGAL   ] %s\n' "$*"; F=$((F+1)); }
sec(){ printf '\n== %s\n' "$*"; }
have(){ command -v "$1" >/dev/null 2>&1; }

sec "1. Pengguna"
if [ "$(id -u)" = 0 ]; then bad "dijalankan sebagai root: pasang dan jalankan aplikasi sebagai pengguna biasa (sudo hanya untuk langkah bertanda sudo)"; else ok "pengguna $(id -un)"; fi

sec "2. PHP (dibutuhkan >= 8.3)"
if have php; then
  v="$(php -r 'echo PHP_VERSION;')"
  if php -r 'exit(version_compare(PHP_VERSION,"8.3.0",">=")?0:1);'; then ok "php $v ($(command -v php))"; else bad "php $v terlalu lama (butuh >= 8.3)"; fi
  miss=""; for e in pdo_pgsql pgsql mbstring xml dom curl zip gd fileinfo openssl ctype tokenizer intl bcmath; do php -m | grep -qix "$e" || miss="$miss $e"; done
  [ -z "$miss" ] && ok "ekstensi PHP lengkap" || bad "ekstensi PHP belum ada:$miss"
else bad "php tidak ditemukan"; fi
have composer && ok "composer $(composer --version 2>/dev/null | awk '{print $3}')" || bad "composer tidak ditemukan"

sec "3. Node dan Python"
if have node; then n="$(node -p 'process.versions.node.split(".")[0]')"; [ "$n" -ge 22 ] && ok "node $(node -v)" || bad "node $(node -v) (butuh >= 22)"; else bad "node tidak ditemukan"; fi
have npm && ok "npm $(npm -v)" || bad "npm tidak ditemukan"
if have python3; then python3 -c 'import sys; sys.exit(0 if sys.version_info>=(3,10) else 1)' && ok "python $(python3 -V 2>&1 | awk '{print $2}')" || bad "python3 terlalu lama (butuh >= 3.10)"; else bad "python3 tidak ditemukan"; fi
[ -x "$ROOT/tools/forecast/.venv/bin/python" ] && ok "venv forecast ada" || warn "venv forecast belum ada (forecast tidak jalan): python3 tools/runbook.py forecast-venv --install"
have mdb-export && ok "mdbtools ada" || warn "mdbtools belum ada (sinkron DIL .mdb): sudo apt install mdbtools"
if have google-chrome || have chromium || have chromium-browser; then ok "Chrome/Chromium untuk PDF ada"; else warn "Chrome/Chromium tidak ada (PDF 503, XLSX tetap jalan)"; fi
have pdftotext && ok "pdftotext ada" || warn "pdftotext tidak ada (poppler-utils)"

sec "4. PostgreSQL"
have psql && ok "psql $(psql --version | awk '{print $3}')" || bad "psql tidak ditemukan"
have pg_dump && have pg_restore && ok "pg_dump dan pg_restore ada (cadangan)" || bad "pg_dump/pg_restore tidak ada (cadangan tidak jalan)"
if have pg_isready; then pg_isready -q -h 127.0.0.1 && ok "PostgreSQL menjawab di 127.0.0.1" || warn "PostgreSQL tidak menjawab di 127.0.0.1:5432"; fi

sec "5. Nginx dan PHP-FPM"
if have nginx; then ok "$(nginx -v 2>&1)"; else bad "nginx tidak ditemukan"; fi
pv="$(have php && php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' || true)"
if [ -n "$pv" ] && [ -d "/etc/php/$pv/fpm" ]; then ok "PHP-FPM $pv terpasang"; else bad "PHP-FPM untuk PHP ${pv:-?} tidak ditemukan (sudo apt install php$pv-fpm)"; fi
if have ss; then
  for p in 80 443; do ss -ltn "( sport = :$p )" 2>/dev/null | grep -q LISTEN && ok "port $p dipakai (Nginx atau lainnya): periksa tidak bentrok" || warn "port $p belum didengarkan siapa pun"; done
fi

sec "6. Penyimpanan berkas unggahan dan cadangan ($DATA)"
parent="$(dirname "$DATA")"
if [ -d "$DATA" ]; then
  [ -w "$DATA" ] && ok "$DATA dapat ditulis" || bad "$DATA ada tetapi tidak dapat ditulis oleh $(id -un) (jalankan storage-setup.sh)"
elif [ -d "$parent" ]; then warn "$DATA belum ada (jalankan: sudo deploy/production/bin/storage-setup.sh)"
else warn "$parent belum ada atau drive belum terpasang (jalankan storage-setup.sh setelah drive siap)"; fi
chk="$DATA"; [ -d "$chk" ] || chk="$parent"; [ -d "$chk" ] || chk="/"
free="$(df -Pk "$chk" | awk 'NR==2{printf "%d", $4/1048576}')"; [ "$free" -ge 20 ] && ok "ruang kosong ${free} GB di $chk" || warn "ruang kosong hanya ${free} GB di $chk"
[ "$(df -P "$chk" | awk 'NR==2{print $1}')" = "$(df -P / | awk 'NR==2{print $1}')" ] && warn "$chk berada di drive yang sama dengan sistem (/); cadangan sebaiknya di drive lain"

sec "7. Penjadwal dan DNS"
if have systemctl; then systemctl is-active --quiet cron 2>/dev/null || systemctl is-active --quiet crond 2>/dev/null && ok "layanan cron aktif" || warn "layanan cron tidak aktif (schedule:run butuh cron)"; fi
if [ -n "${DISTRIVA_DOMAIN:-}" ]; then
  ip="$(getent ahostsv4 "$DISTRIVA_DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')"
  if [ -z "$ip" ]; then warn "DNS $DISTRIVA_DOMAIN belum menjawab"
  elif [ -n "${SERVER_IP:-}" ] && [ "$ip" != "$SERVER_IP" ]; then warn "DNS $DISTRIVA_DOMAIN -> $ip (bukan $SERVER_IP; wajar bila lewat Cloudflare/tunnel)"
  else ok "DNS $DISTRIVA_DOMAIN -> $ip"; fi
fi

sec "8. Kode"
if have git && [ -d "$ROOT/.git" ]; then
  [ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ] && ok "checkout git bersih ($(git -C "$ROOT" rev-parse --short HEAD))" || warn "ada perubahan lokal di berkas terlacak (release.sh menolak)"
fi
[ -f "$ROOT/backend/.env" ] && ok "backend/.env sudah ada (make-env.sh tidak menimpa)" || ok "backend/.env belum ada (dibuat oleh make-env.sh)"

printf '\nRingkasan: %s GAGAL, %s peringatan.\n' "$F" "$W"
[ "$F" = 0 ]
