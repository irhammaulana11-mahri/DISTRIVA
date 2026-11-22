#!/usr/bin/env bash
# Membuat backend/.env PRODUKSI (0600, di-ignore git) dengan APP_KEY baru (acak, tidak dicetak). Kredensial DB disalin dari berkas sumber
# (DB_ENV_SOURCE; isi: DB_HOST DB_PORT DB_DATABASE DB_USERNAME DB_PASSWORD, dibuat db-setup.sh). TIDAK menimpa .env yang sudah ada
# (APP_KEY lama harus tetap: kunci hilang = token MFA dan kata sandi terenkripsi tidak terbaca).
# Pemakaian:  PUBLIC_URL=https://distriva.contoh.id DB_ENV_SOURCE=$HOME/distriva-db.env deploy/production/bin/make-env.sh
# Env: PUBLIC_URL(wajib; alamat yang dibuka pengguna, diawali http:// atau https://)  DB_ENV_SOURCE(wajib)  DATA_ROOT(/srv/backup-data/distriva)
#      ENV_FILE(bawaan backend/.env)  BACKUP_DIR DOCS_DIR DIL_DIR (bila berbeda dari storage-setup.sh)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; SRC="${DB_ENV_SOURCE:?isi DB_ENV_SOURCE (berkas kredensial DB dari db-setup.sh)}"
URL="${PUBLIC_URL:?isi PUBLIC_URL, mis. https://distriva.contoh.id}"; OUT="${ENV_FILE:-$ROOT/backend/.env}"
DATA="${DATA_ROOT:-/srv/backup-data/distriva}"; DOCS="${DOCS_DIR:-$DATA/documents}"; BK="${BACKUP_DIR:-$DATA/backups}"; DIL="${DIL_DIR:-$DATA/dil-inbox}"
case "$URL" in http://*|https://*) ;; *) echo "PUBLIC_URL harus diawali http:// atau https://" >&2; exit 2;; esac
URL="${URL%/}"; SECURE=false; case "$URL" in https://*) SECURE=true;; esac
[ -r "$SRC" ] || { echo "sumber kredensial DB tidak ada: $SRC" >&2; exit 2; }
if [ -e "$OUT" ]; then echo "Sudah ada: $OUT, TIDAK ditimpa (APP_KEY lama harus tetap). Hapus manual hanya bila sengaja dan belum ada data." >&2; exit 0; fi
v(){ grep -E "^$1=" "$SRC" | head -1 | cut -d= -f2-; }
for k in DB_HOST DB_PORT DB_DATABASE DB_USERNAME DB_PASSWORD; do [ -n "$(v $k)" ] || { echo "variabel $k tidak ada di $SRC" >&2; exit 2; }; done
PHPBIN="$(command -v php || true)"; [ -n "$PHPBIN" ] || { echo "php tidak ditemukan" >&2; exit 2; }
KEY="base64:$(openssl rand -base64 32)"
umask 077
cat > "$OUT" <<ENV
# DISTRIVA produksi (dibuat $(date -u +%FT%TZ)); JANGAN di-commit. Variabel lain memakai nilai bawaan config/.
APP_NAME=DISTRIVA
APP_ENV=production
APP_KEY=$KEY
APP_DEBUG=false
APP_URL=$URL
APP_LOCALE=id
APP_FALLBACK_LOCALE=id
APP_FAKER_LOCALE=id_ID
BCRYPT_ROUNDS=12
LOG_CHANNEL=stack
LOG_STACK=daily
LOG_LEVEL=warning
DB_CONNECTION=pgsql
DB_HOST=$(v DB_HOST)
DB_PORT=$(v DB_PORT)
DB_DATABASE=$(v DB_DATABASE)
DB_USERNAME=$(v DB_USERNAME)
DB_PASSWORD=$(v DB_PASSWORD)
SESSION_DRIVER=database
SESSION_LIFETIME=120
SESSION_SECURE_COOKIE=$SECURE
CACHE_STORE=database
QUEUE_CONNECTION=database
FILESYSTEM_DISK=local
DISTRIVA_AUTHORIZATION_GUARD=web
DISTRIVA_BUSINESS_TIMEZONE=Asia/Jakarta
DISTRIVA_FRONTEND_URL=$URL
DISTRIVA_DOCUMENTS_ROOT=$DOCS
DISTRIVA_BACKUP_ROOT=$BK
DISTRIVA_DIL_INBOX=$DIL
DISTRIVA_PHP_BINARY=$PHPBIN
DISTRIVA_MIMS_VERIFY_SSL=true
DISTRIVA_NOTIFY_CHANNELS=mail,whatsapp
DISTRIVA_WHATSAPP_DRIVER=null
MAIL_MAILER=smtp
MAIL_HOST=
MAIL_PORT=587
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_FROM_ADDRESS=
MAIL_FROM_NAME="DISTRIVA"
ENV
chmod 600 "$OUT"
echo "Dibuat: $OUT (0600)."
echo "Sidik jari APP_KEY (bukan rahasia): $(printf %s "$KEY" | sha256sum | cut -c1-16)"
echo "WAJIB sekarang: simpan APP_KEY ke password manager + salinan offline di luar server dan di luar cadangan yang sama."
echo "Lalu isi MAIL_* (SMTP) di berkas itu. WhatsApp diatur dari menu Pengaturan > WhatsApp setelah login (SYS_ADMIN)."
