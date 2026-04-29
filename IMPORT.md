# Importing issues from a CSV export

`scripts/import-issues.js` reads a CSV exported from another bug tracker and
writes the rows into a target project. Source columns understood (header row,
case-insensitive):

```
Number, Subject, Status, Priority, Category, Milestone, Assignee,
Created, Opener, Last Updated, Last Updated By, Description
```

`Number`, `Milestone`, and `Last Updated By` are dropped. `Subject` /
`Description` / `Created` / `Opener` are required per row; rows missing any of
these are skipped and reported. Statuses, priorities, and categories are
matched per-project by name (case-insensitive); names that don't exist are
auto-created in the target project. Blank metadata cells fall back to that
project's default. `Opener` and `Assignee` are matched against existing
`users.name`; if no user matches, a placeholder user is created with email
`<slug>@imported.local`, marked disabled (cannot log in), and added as a
`user`-role member of the project. Original `Created` and `Last Updated`
timestamps are preserved on the issue and on the synthesized `creation`
history event.

The importer is **not idempotent for issues**. Re-running against the same CSV
will create a second copy of every row (each gets a fresh per-project number).
Users and metadata are de-duplicated by name, so re-running won't double those.

## Local dry-run first (always)

Before touching production, run `--dry-run` against a copy of the prod DB so
you see what will happen without writing anything.

```bash
# from your laptop
fly ssh sftp get /data/basicbugs.sqlite -a basicbugs   # pulls to ./basicbugs.sqlite
mv basicbugs.sqlite /tmp/import-preview.sqlite

nvm use 22
DB_PATH=/tmp/import-preview.sqlite \
  node scripts/import-issues.js \
  --csv /path/to/export.csv \
  --project "Beta Project" \
  --dry-run
```

`--project` accepts either a project id or a name (case-insensitive). Read the
log: it lists every placeholder user, every metadata row that would be
created, and any rows that would be skipped (with reasons).

## Run on the server

The fly.io machine runs the same Node process and has `scripts/import-issues.js`
at `/app/scripts/import-issues.js`. The DB lives at `/data/basicbugs.sqlite`.

### 1. Take a fresh snapshot

Litestream replicates continuously, but a discrete `VACUUM INTO` snapshot is a
cleaner rollback target if something goes wrong.

```bash
fly ssh console -a basicbugs -C 'node /app/scripts/backup.js'
```

Confirm it landed:

```bash
fly ssh console -a basicbugs -C 'node /app/scripts/restore.js --list' | head
```

### 2. Upload the CSV to the live volume

```bash
fly ssh sftp shell -a basicbugs
# at the sftp prompt:
put /local/path/to/export.csv /data/import.csv
quit
```

The `/data` mount is the persistent volume; anything outside it on the machine
is ephemeral and won't survive a deploy.

### 3. Dry-run on the server

```bash
fly ssh console -a basicbugs -C \
  'node /app/scripts/import-issues.js --csv /data/import.csv --project "Beta Project" --dry-run'
```

The dry-run wraps the import in a SQLite savepoint and rolls back at the end —
nothing is committed. The log shows what *would* be created. Verify:

- The `would import N issues; M skipped` count matches your expectations.
- Skip reasons (if any) are acceptable.
- Newly-created statuses / priorities / categories look right.
- Placeholder user emails look right.

If anything's off, fix the CSV (or the target project's metadata) and dry-run
again. Repeat until clean.

### 4. Commit the import

Drop `--dry-run`:

```bash
fly ssh console -a basicbugs -C \
  'node /app/scripts/import-issues.js --csv /data/import.csv --project "Beta Project"'
```

Litestream will replicate the new rows to S3 within ~1 second.

### 5. Verify in the UI

Open the project in basicbugs. Spot-check:

- Issue count matches.
- Created / updated timestamps reflect the original tracker.
- A few issues' `History` shows a single `creation` entry on the original date,
  attributed to the original opener.
- The new placeholder users show up under project members (disabled).

### 6. Clean up the upload

```bash
fly ssh console -a basicbugs -C 'rm /data/import.csv'
```

## Rolling back

If the import landed something wrong and the project is small / new, the
fastest fix is usually to delete or archive the imported issues from the UI.
For a full rollback, restore from the snapshot taken in step 1 — see
`BACKUPS.md` for the procedure.

## Notes

- Subjects > 200 chars are truncated; descriptions > 10,000 chars are
  truncated. Both are logged.
- Archived metadata of the same name as a CSV value gets unarchived (with a
  log line) so issues can be assigned to it.
- The script bypasses the notification path entirely — imported issues do not
  generate emails or in-app notifications.
- Placeholder users use the `imported.local` domain, which is reserved for
  this purpose. Don't change it; the email is also how the script avoids
  re-creating a user on a second run.
