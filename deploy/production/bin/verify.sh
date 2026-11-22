#!/usr/bin/env bash
# Gerbang verifikasi dari luar: memeriksa alamat nyata (atau lokal) sesudah pemasangan. Read-only; tidak mencetak rahasia.
# Pemakaian:  DISTRIVA_URL=https://distriva.contoh.id deploy/production/bin/verify.sh
#             VERIFY_LOCAL=1 DISTRIVA_DOMAIN=distriva.contoh.id deploy/production/bin/verify.sh      (di server: ke 127.0.0.1 dengan header Host)
# Env: DISTRIVA_URL | (VERIFY_LOCAL=1 + DISTRIVA_DOMAIN + LOCAL_PORT(80))   VERIFY_UPLOAD_MB(0; bila >0 mengirim berkas sebesar itu +1 MB, harus ditolak 413 hanya
#      bila lebih besar dari batas)   Kode keluar 1 bila ada GAGAL.
set -uo pipefail
F=0; ok(){ printf '[OK    ] %s\n' "$*"; }; bad(){ printf '[GAGAL ] %s\n' "$*"; F=$((F+1)); }
if [ "${VERIFY_LOCAL:-0}" = 1 ]; then DOM="${DISTRIVA_DOMAIN:?isi DISTRIVA_DOMAIN}"; BASE="http://127.0.0.1:${LOCAL_PORT:-80}"; HOSTH=(-H "Host: $DOM")
else BASE="${DISTRIVA_URL:?isi DISTRIVA_URL (mis. https://distriva.contoh.id)}"; BASE="${BASE%/}"; HOSTH=(); fi
c(){ curl -sS -m 30 -o /dev/null -w '%{http_code}' "${HOSTH[@]}" "$@" 2>/dev/null || echo 000; }
h(){ curl -sS -m 30 -D - -o /dev/null "${HOSTH[@]}" "$@" 2>/dev/null | tr -d '\r'; }

[ "$(c "$BASE/up")" = 200 ] && ok "/up (Laravel hidup) 200" || bad "/up tidak 200 (Laravel/PHP-FPM tidak menjawab)"
body="$(curl -sS -m 30 "${HOSTH[@]}" "$BASE/" 2>/dev/null || true)"
printf '%s' "$body" | grep -q 'id="root"' && ok "halaman utama dashboard termuat" || bad "halaman utama bukan dashboard (frontend belum disalin?)"
[ "$(c -H "Accept: application/json" "$BASE/api/scoped-units")" = 401 ] && ok "/api menolak tanpa login (401)" || bad "/api/scoped-units seharusnya 401 tanpa login"
[ "$(c "$BASE/spa/rute-tidak-ada")" = 200 ] && ok "rute SPA jatuh ke index.html" || bad "rute SPA tidak jatuh ke index.html"
[ "$(c "$BASE/.env")" != 200 ] && ok "/.env tidak dilayani" || bad "/.env DILAYANI: segera perbaiki"
hd="$(h "$BASE/")"
printf '%s' "$hd" | grep -qi '^x-content-type-options: nosniff' && ok "header X-Content-Type-Options" || bad "header X-Content-Type-Options tidak ada"
printf '%s' "$hd" | grep -qi '^server: .*[0-9]\.[0-9]' && bad "versi server terlihat di header Server" || ok "versi Nginx tidak diumumkan"
case "$BASE" in https://*)
  printf '%s' "$hd" | grep -qi '^strict-transport-security' && ok "HSTS aktif" || bad "HSTS tidak ada"
  httpurl="http://${BASE#https://}"; loc="$(h "$httpurl/" | grep -i '^location:' | head -1)"
  printf '%s' "$loc" | grep -qi 'https://' && ok "http dialihkan ke https" || bad "http tidak dialihkan ke https"
  host="${BASE#https://}"; host="${host%%/*}"
  exp="$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  if [ -n "$exp" ]; then d=$(( ($(date -d "$exp" +%s) - $(date +%s)) / 86400 )); [ "$d" -ge 14 ] && ok "sertifikat berlaku $d hari lagi" || bad "sertifikat tinggal $d hari"; else bad "sertifikat tidak terbaca"; fi ;;
esac
if [ "${VERIFY_UPLOAD_MB:-0}" -gt 0 ]; then
  n=$(( ${VERIFY_UPLOAD_MB} + 1 ))
  code="$(head -c "$(( n * 1024 * 1024 ))" /dev/zero | curl -sS -m 120 -o /dev/null -w '%{http_code}' "${HOSTH[@]}" -X POST -H 'Accept: application/json' -H 'Content-Type: application/octet-stream' --data-binary @- "$BASE/api/scoped-units" 2>/dev/null || echo 000)"
  case "$code" in 413) ok "unggahan ${n} MB ditolak 413 (batas Nginx bekerja)";; 401|405|404|422) ok "unggahan ${n} MB diterima Nginx dan dijawab $code (batas di atas ${n} MB)";; *) bad "unggahan ${n} MB dijawab $code";; esac
fi
printf '\nRingkasan: %s GAGAL.\n' "$F"; [ "$F" = 0 ]
