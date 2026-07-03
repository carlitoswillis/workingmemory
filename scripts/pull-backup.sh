#!/bin/sh
# Pull a consistent snapshot of the HOSTED owner DB down to this machine
# (portfolio plan Phase 2 — the Mac is the backup destination, not a replica).
#
#   WM_URL=https://<app>.fly.dev OWNER_SECRET=... scripts/pull-backup.sh
#
# Snapshots land in backups/pull/<stamp>/wm.db (backups/ is gitignored; the
# pull/ subdir keeps them clear of the 2026-06-27 Supabase export dirs, which
# pruning must never touch). Keeps the newest $KEEP (default 30).
#
# Cron example (daily 09:15; put the two vars in ~/.wm-backup.env, chmod 600):
#   15 9 * * * cd $HOME/workspace/workingmemory && env $(cat $HOME/.wm-backup.env) ./scripts/pull-backup.sh >> backups/pull/backup.log 2>&1
set -eu

: "${WM_URL:?set WM_URL to the hosted instance, e.g. https://workingmemory-demo.fly.dev}"
: "${OWNER_SECRET:?set OWNER_SECRET (same value as the fly secret)}"
KEEP="${KEEP:-30}"

cd "$(dirname "$0")/.."
stamp=$(date +%Y%m%d-%H%M%S)
dir="backups/pull/$stamp"
mkdir -p "$dir"

curl -fsS -H "Authorization: Bearer $OWNER_SECRET" "$WM_URL/api/export" -o "$dir/wm.db"

# Verify the snapshot actually opens and is sane — a backup you haven't
# verified is a hope, not a backup.
node -e '
  const Database = require("better-sqlite3");
  const db = new Database(process.argv[1], { readonly: true });
  const ic = db.prepare("pragma integrity_check").get();
  if (ic.integrity_check !== "ok") { console.error("integrity_check failed:", ic); process.exit(1); }
  const items = db.prepare("select count(*) c from items").get().c;
  const events = db.prepare("select count(*) c from item_events").get().c;
  console.log(`ok — items=${items} item_events=${events}`);
' "$dir/wm.db"

# Prune: keep the newest $KEEP pulls (stamped dirs under backups/pull only).
total=$(ls -1d backups/pull/[0-9]*/ 2>/dev/null | wc -l | tr -d " ")
excess=$((total - KEEP))
if [ "$excess" -gt 0 ]; then
  ls -1d backups/pull/[0-9]*/ | sort | head -n "$excess" | while read -r old; do
    rm -rf "$old"
    echo "pruned $old"
  done
fi

echo "saved $dir/wm.db"
