#!/usr/bin/env bash
set -Eeuo pipefail

DB_NAME="${DB_NAME:-distriva_t424_test}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-distriva_user}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DOCS_DIR="$(cd -- "$SCRIPT_DIR/../../.." && pwd)/docs"

if [[ "$DB_NAME" != "distriva_t424_test" ]]; then
  echo "Refusing to run: DB_NAME must be exactly distriva_t424_test (got: $DB_NAME)" >&2
  exit 20
fi

PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME")

echo "Target: host=$DB_HOST port=$DB_PORT db=$DB_NAME user=$DB_USER"
read -r -p "Type exactly '$DB_NAME' to confirm disposable database: " CONFIRM
[[ "$CONFIRM" == "$DB_NAME" ]] || { echo "Confirmation mismatch"; exit 21; }

"${PSQL[@]}" -f "$SCRIPT_DIR/00-guard-and-extensions.sql"
"${PSQL[@]}" -f "$SCRIPT_DIR/01-t421-foundation-dependency-fixture.sql"
"${PSQL[@]}" -f "$SCRIPT_DIR/02-t422-master-data-dependency-fixture.sql"
"${PSQL[@]}" -f "$SCRIPT_DIR/03-t423-application-dependency-fixture.sql"

# DDL is read from the checked-out documentation package; never silently copy an older variant.
DDL="$DOCS_DIR/27-T4.2.4-POSTGRESQL-DDL.sql"
[[ -f "$DDL" ]] || { echo "Missing DDL: $DDL" >&2; exit 22; }
"${PSQL[@]}" -f "$DDL"
"${PSQL[@]}" -f "$SCRIPT_DIR/04-t4224-ddl-and-fixture-data.sql"

echo "Fixture setup and T4.2.4 DDL completed. This is not the full negative-test suite."
echo "Continue manually with docs/28-T4.2.4-POSTGRESQL-TEST-PLAN.md."
