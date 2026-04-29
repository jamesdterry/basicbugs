# Operations

Day-2 reference for running basicbugs in production. Backup/restore lives in [BACKUPS.md](BACKUPS.md) — this doc covers the rest.

## Health monitoring

- `GET /healthz` — returns `200 {"status":"ok"}` if the server can complete a SQLite write (it bumps a row in the `_health` table). Returns `503 {"status":"error","error":"db_unavailable"}` if the write fails. Wire this to Fly's health check or any external uptime monitor.
- **In-app error log** — uncaught errors and 5xx responses are persisted in the `error_log` table. The super admin reviews them at `#/admin/errors` (sidebar entry "Errors"). Auto-pruned to 30 days by an in-process timer that runs every 24h.
- **Admin audit log** — every super-admin mutation is recorded in `admin_audit` and listed at `#/admin/audit`. No retention cap; manual purge only.

## Required environment variables

Production (`NODE_ENV=production`) refuses to boot without:

| Var | Purpose |
|---|---|
| `SESSION_SECRET` | Signs session cookies. Rotate by changing the secret + redeploying — every session is invalidated. |
| `SUPER_ADMIN_EMAIL` | Identifies the super admin. See "Rotating super admin" below. |
| `BASE_URL` | Public origin used in magic-link / reset-link / invite emails. |
| `DB_PATH` | Path to the SQLite file (Fly's volume: `/data/basicbugs.sqlite`). |
| `ATTACHMENTS_DIR` | On-disk attachment root. |

Optional:

- `PORT` (default `8080`)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — when unset, emails log to stdout (dev) and the app still works for password login.
- `LOG_LEVEL` — pino level (`info`, `warn`, `error`, `debug`). Default `info`.
- `BUCKET_NAME`, `AWS_*`, `AWS_ENDPOINT_URL_S3` — S3 / Tigris credentials for backups + attachment write-through. See BACKUPS.md.
- `BACKUP_SNAPSHOT_RETENTION_DAYS` — daily snapshot retention (default 30).

## Rotating `SUPER_ADMIN_EMAIL`

The super admin is identified by env var, not by a database flag. Rotation:

1. **Set the new email**:
   ```bash
   fly secrets set SUPER_ADMIN_EMAIL=new-admin@example.com -a basicbugs
   ```
   Fly redeploys; the new value takes effect on the next machine boot.

2. **Bootstrap the new admin's account**:
   - If the new email already has a user row in the database, nothing else is needed. Their next login (password or magic link) will identify them as super admin.
   - If the new email is new to the system, the magic-link route auto-creates the user row when the new super admin requests a sign-in link. Visit `/login.html`, request a magic link as the new email, follow the link.

3. **Confirm the old admin is no longer privileged**: log in as the old email and verify `#/admin/...` returns 403. The user row stays in the database — disable or delete it via the admin UI if appropriate.

There is no harm in leaving multiple historic super-admin user rows; only the email matching the env var is super admin at any moment.

## Recovering a locked-out admin

If the super admin loses access (lost device, expired magic-link, password unknown) and the SMTP path is broken or unmonitored:

**Option 1 — temporary alternate super admin**

If you control deploy access:

```bash
fly secrets set SUPER_ADMIN_EMAIL=recovery@example.com -a basicbugs
fly deploy -a basicbugs
```

Then log in as `recovery@example.com`:

1. Open `/login.html` in a fresh browser.
2. Request a magic link for `recovery@example.com` — the magic-link route auto-creates the user on first request when the address matches `SUPER_ADMIN_EMAIL`.
3. Check the inbox (or, if SMTP is broken, fall back to Option 2 below).
4. Once logged in as super admin, fix the original admin's account: send them a password reset, send a magic link, or transfer ownership by setting `SUPER_ADMIN_EMAIL` back.

**Option 2 — extract a magic link from the server logs**

When SMTP isn't configured the email service logs the would-be email to stdout as `[dev-email] ... { magicLinkUrl: "..." }`. To force a magic link without SMTP:

```bash
# Temporarily disable SMTP so the next attempt logs the link.
fly secrets unset SMTP_HOST -a basicbugs
fly deploy -a basicbugs

# Request the link from /login.html, then:
fly logs -a basicbugs | grep dev-email | tail -n 1
# copy the URL out of the log line, paste into a browser

# Re-enable SMTP afterwards:
fly secrets set SMTP_HOST=... -a basicbugs
fly deploy -a basicbugs
```

This is a break-glass path — only use it when SMTP delivery is genuinely failing.

**Option 3 — direct DB inspection**

If both the email and admin email fields are wrong and you need to find a session ID without going through the login flow:

```bash
fly ssh console -a basicbugs
sqlite3 /data/basicbugs.sqlite \
  "SELECT id, email, last_login_at FROM users ORDER BY last_login_at DESC LIMIT 10;"
```

Choose the right user, then proceed via Option 1 or 2 to log them in. **Do not edit the `users` table directly to change emails** — that breaks audit-log foreign keys and the super-admin matching is by env var anyway.

## Logging

The server emits structured pino logs:

- Production: one JSON line per request and per `logger.info/warn/error` call.
- Development: pretty-printed, single-line.
- Tests: silenced (`level: 'silent'`).

Fly captures stdout. For local development, just `npm run dev` and watch the terminal.

## Sessions

- Session cookie: `bb_session`, signed with `SESSION_SECRET`. `HttpOnly`, `SameSite=Lax`, `Secure` in production.
- TTL: 30 days, refreshed on every authenticated request (`last_seen_at` in the `sessions` table).
- Revoke a single session via `#/admin/sessions`.
- Revoke every session for a user via `#/admin/system` ("Sign out a user everywhere"). Use this if a session is suspected of compromise.
- Rotate `SESSION_SECRET` to invalidate **every** session at once — irrecoverable, all users must log in again.

## CSRF

State-changing requests under `/api/*` from authenticated sessions require an `X-CSRF-Token` header that matches the `bb_csrf` cookie (double-submit-cookie pattern). The cookie is minted on the first response from any endpoint and read by client JS. There is no CSRF on auth routes (`/auth/login`, `/auth/magic-link`, `/auth/forgot`, `/auth/reset`) because those run pre-session.

If a custom integration sends authenticated `POST`/`PATCH`/`PUT`/`DELETE` to `/api/*`, it must read the `bb_csrf` cookie and echo the value as `X-CSRF-Token`. A 403 response with body `{"error":"csrf"}` indicates the header is missing or stale.

## Common ops tasks

- **Check the most recent admin actions**: `#/admin/audit`.
- **See what crashed today**: `#/admin/errors` or `fly logs -a basicbugs | grep -E '"level":"(error|warn)"'`.
- **Trigger a daily snapshot off-cycle**: `fly ssh console -a basicbugs -C 'node /app/scripts/backup.js'`.
- **List bucketed snapshots**: `fly ssh console -a basicbugs -C 'node /app/scripts/restore.js --list'`.
- **Force every user to sign back in**: rotate `SESSION_SECRET` and redeploy.

## Disaster recovery

Full machine loss / volume loss / accidental drop: see [BACKUPS.md § Disaster recovery](BACKUPS.md#disaster-recovery-production).
