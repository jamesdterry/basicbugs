# Backups (Litestream → Tigris)

basicbugs replicates `/data/basicbugs.sqlite` continuously to a Tigris
(S3-compatible) bucket on Fly.io via Litestream. Target RPO: **~1 second**.
Retention: **168 hours (7 days)** of point-in-time recovery.

In addition, `scripts/backup.js` runs daily and uploads a discrete
`VACUUM INTO` snapshot to the same bucket under `snapshots/` — single-file,
human-browseable, easy to download with `aws s3 cp`. Snapshot retention is
configurable via `BACKUP_SNAPSHOT_RETENTION_DAYS` (default 30).

Attachment files (`/data/attachments/<projectId>/<issueId>/<uuid>-<safeName>`)
are mirrored to the **same bucket** under an `attachments/` prefix via a
write-through in the app itself. See "Attachments" below.

Staging and production each have their own isolated bucket. Never point
both at the same bucket.

## Bucket layout

```
s3://${BUCKET_NAME}/db/                                   # Litestream WAL + snapshots
s3://${BUCKET_NAME}/snapshots/basicbugs-<UTC-iso>.sqlite  # daily VACUUM INTO snapshots
s3://${BUCKET_NAME}/attachments/<projectId>/<issueId>/<uuid>-<safeName>
```

## How it works

`docker-entrypoint.sh` is PID 1 in the container. On boot it decides between
three paths:

| State on boot | Outcome |
|---|---|
| `BUCKET_NAME` / `AWS_ACCESS_KEY_ID` unset | Run `node server/index.js` directly. Local `docker run` without Fly creds. |
| `/data/basicbugs.sqlite` exists | `exec litestream replicate -exec "node server/index.js"`. Normal path. |
| DB missing, `/data/.allow-restore` absent | **Refuse to start Node.** Log "FATAL", then sleep forever so the container stays up and SSH remains reachable. Health check fails (Node isn't listening). Operator intervenes at leisure. |
| DB missing, `/data/.allow-restore` present | Run `litestream restore -if-replica-exists`, delete the sentinel (single-use), then `replicate + exec node`. |

The sentinel gate is deliberate. Auto-restore would (a) silently self-heal
when a volume is mounted under the wrong app, masking an incident, and
(b) on a first-ever deploy where the replica is also empty, let Node start
a new generation on top of what might be a real replica. Forcing a human
decision closes both.

## Files

- `litestream.yml` — replication config (retention, sync/snapshot intervals,
  target path). No credentials — env-var expansion only.
- `docker-entrypoint.sh` — the gate logic above plus
  `litestream replicate -exec "node server/index.js"`.
- `Dockerfile` — installs pinned Litestream `v0.3.13`, copies and chmods the
  entrypoint.
- `server/db/connection.js` — sets `journal_mode = WAL` (Litestream prerequisite).
- `server/services/backup.js` — S3 client wrapper used by the write-through
  and by all backup/restore scripts.
- `scripts/backup.js` — daily `VACUUM INTO` snapshot + upload + prune.
- `scripts/restore.js` — download a snapshot from S3 to a local file.
- `scripts/sync-attachments.js` — reconcile on-disk attachments → S3.
- `scripts/restore-attachments.js` — download attachments S3 → on-disk.
- `scripts/alert-email.js` — best-effort SMTP alert on `gate-fired` /
  `restore-complete`.

Credentials come from env vars that `fly storage create` injects:
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`,
`AWS_REGION`, `BUCKET_NAME`.

## First-time setup

Run once per environment.

### Staging

```
fly storage create -a basicbugs-staging
fly deploy -c fly.staging.toml -a basicbugs-staging
```

If staging's volume is empty (e.g. auto-stop machine had no prior DB),
expect the gate to fire on the first boot. That's correct:

```
fly ssh console -a basicbugs-staging
touch /data/.allow-restore
exit
fly machine restart <id> -a basicbugs-staging
```

Since the bucket is also empty on first deploy, the restore is a no-op
and Node creates a fresh DB. Litestream starts replicating generation 1
from there.

### Production

```
# 1. Belt-and-braces manual snapshot first (keep off-box for 24h).
fly ssh console -a basicbugs -C \
  "sqlite3 /data/basicbugs.sqlite '.backup /data/prod-pre-litestream.db'"
fly ssh sftp get /data/prod-pre-litestream.db -a basicbugs

# 2. Provision the bucket and deploy.
fly storage create -a basicbugs
fly deploy -a basicbugs
```

Prod's volume has the live DB, so the gate does not fire. Replication
begins immediately on boot.

### One-time attachment backfill

The write-through only mirrors *new* attachments. Existing files are not
copied automatically. After the first deploy with creds, run once:

```
fly ssh console -a basicbugs -C 'node /app/scripts/sync-attachments.js'
```

Idempotent — safe to re-run any time.

### Daily snapshot schedule

Run `scripts/backup.js` once per day from an external scheduler. The
recommended pattern is a GitHub Actions workflow that calls
`flyctl ssh console`:

```yaml
# .github/workflows/backup.yml
name: Daily backup
on:
  schedule:
    - cron: '0 7 * * *'   # 07:00 UTC
  workflow_dispatch:
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl ssh console -a basicbugs -C 'node /app/scripts/backup.js'
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

This runs in-process on the live machine, avoiding the single-volume
mount conflict that a Fly scheduled-machine cron would hit.

## Verify replication is healthy

```
fly ssh console -a <app>
litestream snapshots -config /app/litestream.yml /data/basicbugs.sqlite
litestream wal       -config /app/litestream.yml /data/basicbugs.sqlite
```

Expect at least one snapshot and WAL segments dated within ~1 minute of
any recent write. Also:

```
fly logs -a <app> | grep -i litestream
sqlite3 /data/basicbugs.sqlite 'PRAGMA journal_mode;'   # → wal
```

Snapshots:

```
fly ssh console -a <app> -C 'node /app/scripts/restore.js --list'
```

Lists `snapshots/` keys with timestamps and sizes.

## Manual restore (the only way to restore the live DB)

Restore is **never** automatic. An operator must explicitly arm the gate.
Applies to drills and real incidents alike.

```
fly ssh console -a <app>
ls -la /data/basicbugs.sqlite        # confirm DB is genuinely missing.
                                     # If it's there, STOP — investigate.
touch /data/.allow-restore
exit
fly machine restart <machine-id> -a <app>
fly logs -a <app>                    # watch for "Restore complete"
```

After a successful restore, the entrypoint removes the sentinel
automatically. Subsequent reboots take the normal path.

If a restore should NOT proceed (wrong app, wrong volume, incident
still being triaged): **do nothing**. The machine stays unhealthy,
Litestream stays off, the replica is untouched. Either arm the gate
later or restore into a fresh volume out-of-band.

### Restoring from a daily snapshot instead of Litestream

Useful if the Litestream replica was corrupted by post-incident writes
before the gate fired, or if you want to restore to "yesterday morning"
rather than "as of last second". This bypasses Litestream entirely.

```
fly ssh console -a <app>
node /app/scripts/restore.js --list                       # pick a key
node /app/scripts/restore.js --key=snapshots/basicbugs-<iso>.sqlite \
                              --out=/data/basicbugs.sqlite \
                              --force
# Then exit and restart so Litestream re-bases on the new DB:
fly machine restart <id> -a <app>
```

Litestream will start a new generation from this DB on its next replicate.
The old generation in the bucket remains for the configured retention.

## Restore drill — staging only

Proves the whole path end-to-end. **Do not run on production.**

```
# 1. Create a distinctive test issue ("backup-drill-2026-04-29") via the
#    staging UI. Wait ≥5 seconds for Litestream to ship the WAL segment.

# 2. Destroy the live DB:
fly ssh console -a basicbugs-staging
pkill -TERM litestream                       # clean flush
rm /data/basicbugs.sqlite /data/basicbugs.sqlite-wal /data/basicbugs.sqlite-shm
exit

# 3. Confirm the gate fires:
fly logs -a basicbugs-staging                # expect "FATAL"
                                             # machine stays `started` with
                                             # failing health check — SSH works.

# 4. Arm and reboot:
fly ssh console -a basicbugs-staging
touch /data/.allow-restore
exit
fly machine restart <id> -a basicbugs-staging

# 5. Verify the test issue is back and the sentinel was consumed:
fly ssh console -a basicbugs-staging -C \
  "sqlite3 /data/basicbugs.sqlite 'SELECT name FROM issues ORDER BY id DESC LIMIT 1;'"
fly ssh console -a basicbugs-staging -C "ls /data/.allow-restore"
# should say "No such file or directory"
```

Run this quarterly.

## Disaster recovery (production)

Full machine loss, volume corruption, accidental `DROP TABLE`:

```
# 1. Stop the app so any replicating process doesn't overwrite the replica
#    with post-incident state.
fly scale count 0 -a basicbugs

# 2. Provision a fresh volume (if the old one is gone):
fly volumes create basicbugs_data -r iad -n 1 -a basicbugs

# 3. Bring back one machine; the gate will fire.
fly scale count 1 -a basicbugs

# 4. Arm the gate:
fly ssh console -a basicbugs
touch /data/.allow-restore
exit

# 5. Restart; entrypoint runs `litestream restore`.
fly machine restart <id> -a basicbugs

# 6. Restore attachments:
fly ssh console -a basicbugs -C 'node /app/scripts/restore-attachments.js'

# Optional: restore to a specific point in time instead of the latest
# Litestream state (if the incident was caused by bad data, not data loss).
# SSH in with the sentinel in place, then INSTEAD of restarting, run:
#   litestream restore -config /app/litestream.yml \
#     -timestamp 2026-04-23T18:00:00Z /data/basicbugs.sqlite
#   rm /data/.allow-restore
# Then restart. The entrypoint sees the DB is present and skips the gate.
```

### Restoring to a local machine (for debugging)

```
brew install benbjohnson/litestream/litestream

# Pull the same creds Fly injected into the app:
fly ssh console -a <app> -C 'env' | grep -E 'AWS_|BUCKET_NAME'
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
       AWS_ENDPOINT_URL_S3=... AWS_REGION=... BUCKET_NAME=...

litestream restore -config /path/to/repo/litestream.yml \
  -o ./restored.db /data/basicbugs.sqlite
```

Or grab a daily snapshot directly with `aws-cli` / `mc` / etc. — they're
single-file `.sqlite` objects under `snapshots/`.

## Operator email alerts

The entrypoint sends a best-effort email to `SUPER_ADMIN_EMAIL` at two
moments:

| Event | When it fires | Subject |
|---|---|---|
| `gate-fired` | DB missing and sentinel absent — machine is now idling, waiting for you to intervene. | `[<app>] Database missing — manual restore required` |
| `restore-complete` | `litestream restore` finished, DB is present, Node is about to boot. | `[<app>] Database restore complete` |

Both use the same SMTP config that invite/notification emails already use
(`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`,
`SMTP_FROM`). No new secrets.

**Required env vars for alerts to fire**: `SMTP_HOST`, `SMTP_FROM`,
`SUPER_ADMIN_EMAIL`. If any are missing, the helper script logs a warning
to stderr and exits 0 — boot continues either way. Alerts are **never**
load-bearing; the entrypoint logs remain the source of truth.

**To silence alerts** (e.g. during a planned drill): `fly secrets unset
SUPER_ADMIN_EMAIL -a <app>` and redeploy, then set it back afterwards.

## Credential rotation

Tigris keys can be rotated via the Tigris console or by re-running
`fly storage create -a <app> --yes` (which generates fresh credentials and
updates the Fly secrets in place). After rotation:

```
fly deploy -a <app>       # picks up the new env vars
```

Litestream will pause briefly during the deploy, then resume with the new
credentials on the next machine boot. No data loss — the WAL catches up
on restart.

## Attachments

`/data/attachments/<projectId>/<issueId>/<uuid>-<safeName>` (max 25 MB
per file, validated MIME types — see `server/services/attachments.js`)
is replicated to the **same Tigris bucket** as the database under a
separate key prefix:

```
s3://${BUCKET_NAME}/db/                   # Litestream
s3://${BUCKET_NAME}/snapshots/...         # daily VACUUM INTO
s3://${BUCKET_NAME}/attachments/<rel>     # this section
```

No new credentials — the Litestream env vars are reused.

**Automatic backup (write-through).** `server/services/attachments.js` PUTs
the validated bytes to Tigris immediately after the local volume write
+ DB INSERT succeed. Best-effort: if the S3 call fails (timeout, transient
5xx), a warning is logged but the upload still succeeds for the user.
The reconcile script below closes any gap later.

**Manual restore.** Deliberate; never automatic. After volume loss, SSH
into the machine and run:

```
fly ssh console -a <app>
node /app/scripts/restore-attachments.js
```

The script lists `attachments/*` in the bucket and downloads each into
`/data/attachments/...`. Idempotent — safe to re-run. No sentinel gate
(unlike the DB): a missing attachment file does not block boot, and the
attachment download route returns 410 Gone for missing files, so the
failure modes the DB gate closes off don't apply here.

**Reconcile (volume → Tigris).** Run this when the application logs show
a write-through failure, or as a periodic safety net:

```
fly ssh console -a <app>
node /app/scripts/sync-attachments.js
node /app/scripts/sync-attachments.js --dry-run    # report only
```

It walks `/data/attachments` recursively and PUTs any local file whose
key is missing or whose size differs. Skips files that already match.
Not scheduled — operator-invoked only. Attachments are immutable
(each upload gets a fresh UUID), so a size match is a sound shortcut.

**Silencing write-through** (e.g. during a planned migration where you
don't want new attachments shipping to Tigris): `fly secrets unset
BUCKET_NAME -a <app>` and redeploy, then set it back afterwards. The
entrypoint's local-dev bypass kicks in whenever `BUCKET_NAME` is
absent, so the app still serves attachments from the volume — but
Litestream also stops in that mode, so only use this for genuine
dev/debug scenarios.

## Operational notes

- **WAL mode is permanent.** Once set on the DB file, it stays set across
  reboots. Modern `sqlite3` CLI opens DBs in WAL transparently.
- **Single-writer invariant.** `litestream replicate` must not run from
  two machines against the same bucket path. Fly's single-volume mount
  invariant enforces this — do not scale horizontally without redesigning
  replication.
- **Auto-stop is fine.** `auto_stop_machines = 'stop'` in `fly.toml` is
  compatible with Litestream: Fly sends SIGTERM, Litestream's exec
  supervisor propagates it to Node, Node exits, Litestream flushes the
  final WAL segment, then exits cleanly.
- **Graceful shutdown matters.** Don't replace the entrypoint with anything
  that bypasses `litestream replicate -exec`.
- **Never inline credentials in `litestream.yml`.** The env-var expansion
  pattern is intentional — rotation must keep working.
- **Snapshots vs Litestream.** Use Litestream for "as of last second"
  recovery (most incidents). Use a daily snapshot for "as of yesterday
  morning" recovery (logical bug investigations) or for a quick local
  dev seed without exposing live creds.
- **CPU architecture.** The Dockerfile fetches `linux-amd64` Litestream.
  If you ever schedule basicbugs on Fly ARM machines, change to
  `linux-arm64` in the Dockerfile.

## Not in scope

- Multi-region or hot-standby DB. basicbugs runs single-primary; failover
  is replica-restore.
- Automatic deletion of attachments on archive. Archive only flips
  `archived_at`; the file (local + S3) stays. Hard-delete is a future stage.
