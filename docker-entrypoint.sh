#!/bin/sh
# Container entrypoint for basicbugs.
#
# Behaviour:
#   1. If Litestream creds are missing (local `docker run` without Tigris),
#      run Node directly. No replication, no gate. Dev-only path.
#   2. If /data/basicbugs.sqlite exists, start Litestream + Node normally.
#   3. If /data/basicbugs.sqlite is MISSING, refuse to boot unless a human
#      has created the sentinel file /data/.allow-restore. The container
#      stays up (sleep loop) so SSH works — the operator arms the gate
#      then `fly machine restart` re-enters the script cleanly.
#      Litestream never auto-restores on its own. See BACKUPS.md for the
#      manual procedure.
#
# The gate prevents two failure modes:
#   a) A volume mounted under the wrong app / a swapped volume would
#      silently self-heal, masking a real incident.
#   b) If the replica is ALSO empty (first-ever deploy scenario), an
#      auto-restore would be a no-op and Node would create a fresh DB
#      under the same bucket path — starting a new generation on top of
#      a real replica. Forcing a human decision closes both.
set -e

DB_PATH="${DB_PATH:-/data/basicbugs.sqlite}"
SENTINEL_PATH="/data/.allow-restore"
LITESTREAM_CONFIG="/app/litestream.yml"

# 1. Local-dev bypass. Keep `docker run` working without Fly creds.
if [ -z "${BUCKET_NAME:-}" ] || [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
  echo "[entrypoint] Litestream env vars not set — running without replication."
  echo "[entrypoint] Applying migrations..."
  node /app/scripts/migrate.js
  exec node server/index.js
fi

# 2. Fail-closed restore gate.
if [ ! -f "$DB_PATH" ]; then
  if [ ! -f "$SENTINEL_PATH" ]; then
    echo "FATAL: $DB_PATH missing and $SENTINEL_PATH absent." >&2
    echo "Refusing to auto-restore or start with an empty database." >&2
    echo "Operator: SSH in, verify this is the intended app/volume, then:" >&2
    echo "  touch $SENTINEL_PATH && fly machine restart <id>" >&2
    echo "See BACKUPS.md for the full restore procedure." >&2
    # Best-effort operator alert. The script exits 0 on any failure
    # (unset SMTP, broken SMTP, 15s timeout) so this never blocks boot.
    node /app/scripts/alert-email.js gate-fired \
      || echo "[entrypoint] alert email call failed (continuing)."
    # Sleep forever instead of exiting: if we exit 1, Fly's restart policy
    # crash-loops us and eventually auto-stops the machine, making SSH a
    # race. Staying "started" (but failing the /healthz check because Node
    # never booted) keeps SSH rock-solid so the operator can arm the gate
    # at their own pace, then `fly machine restart` to re-enter this
    # script cleanly. Still fail-closed: Node is never started, no writes
    # happen, the replica is untouched.
    while true; do sleep 3600; done
  fi

  echo "[entrypoint] Sentinel present — attempting Litestream restore..."
  litestream restore -if-replica-exists \
    -config "$LITESTREAM_CONFIG" "$DB_PATH"

  if [ -f "$DB_PATH" ]; then
    echo "[entrypoint] Restore complete — $(wc -c < "$DB_PATH") bytes."
    # Best-effort success alert. Only send when we actually restored
    # something — not on the first-ever-deploy empty-replica path.
    node /app/scripts/alert-email.js restore-complete \
      || echo "[entrypoint] alert email call failed (continuing)."
  else
    echo "[entrypoint] No existing replica; Node will create a fresh DB."
  fi

  # Re-arm the gate: sentinel is single-use. Subsequent reboots must
  # not silently re-restore.
  rm -f "$SENTINEL_PATH"
fi

# 3. Apply pending migrations. Idempotent — `_migrations` tracks applied
# files, so this is a no-op when up to date. Runs here (not as Fly's
# release_command) because Fly's release_command machine does not reliably
# mount the persistent volume for single-volume apps; running on the live
# machine guarantees migrations land on /data.
echo "[entrypoint] Applying migrations..."
node /app/scripts/migrate.js

# 4. Replicate + run. `litestream replicate -exec` supervises Node:
# SIGTERM → node exits → Litestream flushes final WAL → Litestream exits.
echo "[entrypoint] Starting Node under Litestream supervision..."
exec litestream replicate -config "$LITESTREAM_CONFIG" -exec "node server/index.js"
