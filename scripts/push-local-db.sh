#!/bin/sh
# Cutover migration (portfolio plan Phase 1b/2): push a consistent snapshot of
# the LOCAL data/wm.db up to the hosted instance's owner DB. Also the
# disaster-recovery path — point SRC at any verified backup snapshot.
#
#   WM_URL=https://<app>.fly.dev OWNER_SECRET=... scripts/push-local-db.sh
#
# Prints local counts, uploads, and prints the server's post-import counts —
# eyeball that they match (that's the cutover verification step). If Litestream
# is already replicating on the host, restart the machine afterwards
# (`fly machine restart`) so it snapshots a fresh generation.
set -eu

: "${WM_URL:?set WM_URL to the hosted instance, e.g. https://workingmemory-demo.fly.dev}"
: "${OWNER_SECRET:?set OWNER_SECRET (same value as the fly secret)}"

cd "$(dirname "$0")/.."
SRC="${SRC:-data/wm.db}"
[ -f "$SRC" ] || { echo "no local DB at $SRC" >&2; exit 1; }

tmp="$(mktemp -d)/wm-snapshot.db"
trap 'rm -rf "$(dirname "$tmp")"' EXIT

# Consistent snapshot via the online-backup API — never copy a live WAL-mode
# file directly.
node -e '
  const Database = require("better-sqlite3");
  const db = new Database(process.argv[1], { readonly: true });
  db.backup(process.argv[2]).then(() => {
    const snap = new Database(process.argv[2], { readonly: true });
    const items = snap.prepare("select count(*) c from items").get().c;
    const events = snap.prepare("select count(*) c from item_events").get().c;
    console.log(`local snapshot: items=${items} item_events=${events}`);
  });
' "$SRC" "$tmp"

echo "uploading to $WM_URL/api/import …"
curl -fsS -X PUT -H "Authorization: Bearer $OWNER_SECRET" \
  --data-binary @"$tmp" "$WM_URL/api/import"
echo
echo "done — compare the counts above, then spot-check the board in a browser."
