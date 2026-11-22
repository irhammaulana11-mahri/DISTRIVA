#!/usr/bin/env bash
# Membuat database dan role DISTRIVA dengan kata sandi ACAK yang ditulis ke berkas 0600 (format DB_ENV_SOURCE untuk make-env.sh).
# Kata sandi TIDAK dicetak dan tidak melewati argumen proses (lewat stdin psql). Aman untuk server bersama: MENOLAK bila database/role sudah ada.
# Juga mengaktifkan ekstensi btree_gist di database ini (migrasi T4.2.1 membutuhkannya).
# Pemakaian (pengguna dengan sudo):  deploy/production/bin/db-setup.sh        DRY_RUN=1 untuk hanya mencetak langkah
# Env: DB_NAME(distriva_prod) DB_USER(distriva_app) DB_HOST(127.0.0.1) DB_PORT(5432) OUT($HOME/distriva-db.env) PSQL_CMD("sudo -u postgres psql")
# Lanjutan: DB_ENV_SOURCE="$OUT" deploy/production/bin/make-env.sh ; lalu hapus $OUT dengan shred -u.
set -euo pipefail
DB="${DB_NAME:-distriva_prod}"; USR="${DB_USER:-distriva_app}"; HOST="${DB_HOST:-127.0.0.1}"; PORT="${DB_PORT:-5432}"
OUT="${OUT:-$HOME/distriva-db.env}"; PSQL="${PSQL_CMD:-sudo -u postgres psql}"
for v in "$DB" "$USR"; do [[ "$v" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "nama tidak valid (huruf kecil, angka, garis bawah): $v" >&2; exit 2; }; done
say(){ printf '%s\n' "$*"; }
q(){ $PSQL -X -q -At -v ON_ERROR_STOP=1 "$@"; }
if [ "${DRY_RUN:-0}" = 1 ]; then
  say "[dry-run] akan memeriksa: database $DB dan role $USR belum ada"
  say "[dry-run] akan membuat role $USR (LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE, kata sandi acak 48 hex)"
  say "[dry-run] akan membuat database $DB (pemilik $USR), mencabut CONNECT dari PUBLIC, CREATE EXTENSION btree_gist"
  say "[dry-run] akan menulis $OUT (0600) berisi DB_HOST=$HOST DB_PORT=$PORT DB_DATABASE=$DB DB_USERNAME=$USR DB_PASSWORD=(acak)"
  exit 0
fi
[ ! -e "$OUT" ] || { echo "berkas keluaran sudah ada: $OUT (hapus manual dengan shred -u bila sengaja)" >&2; exit 2; }
q -d postgres -c "select 1" >/dev/null || { echo "tidak dapat menjalankan psql sebagai superuser (PSQL_CMD='$PSQL')" >&2; exit 2; }
ex_db="$(q -d postgres -c "select count(*) from pg_database where datname = '$DB'")"
ex_ro="$(q -d postgres -c "select count(*) from pg_roles where rolname = '$USR'")"
[ "$ex_db" = 0 ] || { echo "database $DB sudah ada: berhenti (tidak ada yang diubah)" >&2; exit 2; }
[ "$ex_ro" = 0 ] || { echo "role $USR sudah ada: berhenti (tidak ada yang diubah)" >&2; exit 2; }
PW="$(openssl rand -hex 24)"
say "membuat role $USR dan database $DB"
q -d postgres <<SQL >/dev/null
CREATE ROLE $USR LOGIN PASSWORD '$PW' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE $DB OWNER $USR;
REVOKE CONNECT ON DATABASE $DB FROM PUBLIC;
GRANT CONNECT ON DATABASE $DB TO $USR;
SQL
say "mengaktifkan btree_gist di $DB"
q -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS btree_gist" >/dev/null
( umask 077; cat > "$OUT" <<ENV
DB_HOST=$HOST
DB_PORT=$PORT
DB_DATABASE=$DB
DB_USERNAME=$USR
DB_PASSWORD=$PW
ENV
)
chmod 600 "$OUT"
say "SELESAI. Kredensial ditulis ke $OUT (0600), tidak dicetak."
say "Langkah berikut:"
say "  1. DB_ENV_SOURCE=$OUT deploy/production/bin/make-env.sh"
say "  2. shred -u $OUT"
