#!/usr/bin/env bash
# One-command setup from a fresh clone (GATE G13).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ installing dependencies"
pnpm install

echo "→ creating databases (adengine, adengine_test, adengine_e2e)"
export PGPASSWORD="${PGPASSWORD:-postgres}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
for db in adengine adengine_test adengine_e2e; do
  psql -h "$PGHOST" -U "$PGUSER" -tc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
    || psql -h "$PGHOST" -U "$PGUSER" -c "CREATE DATABASE $db"
done

echo "→ migrating + seeding the dev database"
pnpm migrate
pnpm seed

echo "→ installing Playwright chromium (for pnpm e2e:ui)"
pnpm --filter @engine/web exec playwright install chromium || true

echo "✓ setup complete — try: pnpm check && pnpm e2e:full"
