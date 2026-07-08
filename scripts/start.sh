#!/bin/sh
# Container entrypoint (portfolio plan Phase 2).
#
# With LITESTREAM_REPLICA_URL set (plus LITESTREAM_ACCESS_KEY_ID /
# LITESTREAM_SECRET_ACCESS_KEY in the environment):
#   1. restore the owner DB from the replica if the volume is fresh
#      (self-heals from total volume loss), then
#   2. run the app under `litestream replicate -exec` so replication lives and
#      dies with the server process.
# Without it (e.g. a local docker run), just start the app.
#
# Demo boards are NOT replicated — they're disposable by design.
set -eu

: "${DATA_DIR:=/data}"
: "${PORT:=3000}"
OWNER_DB="$DATA_DIR/owner/wm.db"
mkdir -p "$DATA_DIR/owner" "$DATA_DIR/demo"

if [ -n "${LITESTREAM_REPLICA_URL:-}" ]; then
  # Config baked at /etc/litestream.yml (see litestream.yml + Dockerfile) resolves
  # the db path + replica URL AND carries the retention settings — the old
  # positional `db url` form has no way to set retention, which is why we ran on
  # pure defaults and the bucket accumulated a generation per cold start.
  # -if-replica-exists: an EMPTY bucket (very first boot, before any replication)
  # is not an error — without it, restore fails and set -e crash-loops the app.
  litestream restore -config /etc/litestream.yml -if-db-not-exists -if-replica-exists "$OWNER_DB"
  exec litestream replicate -config /etc/litestream.yml -exec "npx next start -p $PORT"
fi

exec npx next start -p "$PORT"
