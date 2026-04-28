# basicbugs — Development Plan

Each stage is independently shippable: the app boots, tests pass, and you can deploy to fly.io at any stage boundary. Stages are sized so you can pause for review between them. Within a stage, sub-steps are listed in dependency order.

---

## Stage 0 DONE — Project skeleton & deploy pipeline

**Goal:** an empty Express app deploys to fly.io and serves a "hello" page.

1. `npm init`; pin Node LTS in `.nvmrc` and `engines`.
2. Dependencies: `express`, `better-sqlite3`, `cookie-parser`, `bcrypt`, `nodemailer`, `helmet`, `compression`, `dotenv`. Dev: `vitest`, `supertest`, `eslint`, `prettier`.
3. Project layout:
   ```
   server/        index.js, app.js, config.js, logger.js
   server/db/     connection.js, migrate.js, migrations/
   server/routes/
   server/services/
   server/middleware/
   public/        index.html, app.js, app.css, /assets, /vendor
   test/
   scripts/       seed.js
   ```
4. `server/config.js` — read env vars (`PORT`, `DB_PATH`, `SUPER_ADMIN_EMAIL`, `SESSION_SECRET`, `BASE_URL`, `SMTP_*`, `ATTACHMENTS_DIR`). Fail fast on missing required vars in production.
5. Express app: `helmet`, `compression`, JSON body parser, static `public/`, health endpoint `GET /healthz`.
6. `Dockerfile` (Node slim, copy app, `npm ci --omit=dev`).
7. `fly.toml` with persistent volume for SQLite + attachments; `release_command` runs migrations.
8. CI workflow: lint, test, build Docker image.

**Verify:** `npm test` green; `fly deploy` succeeds; `/healthz` returns 200 from the deployed URL.

---

## Stage 1 DONE — Database layer & migrations

**Goal:** schema from `db.sql` is created via a migration runner; integration tests can spin up an isolated DB.

1. `server/db/connection.js` — opens `better-sqlite3`, sets `PRAGMA foreign_keys = ON; journal_mode = WAL; busy_timeout = 5000` on every connection. Singleton.
2. `server/db/migrate.js` — reads `migrations/*.sql` in order, tracks applied migrations in a `_migrations` table, runs unapplied ones in a transaction. Idempotent.
3. `migrations/0001_initial.sql` — contents of the approved `db.sql`.
4. `scripts/migrate.js` — CLI entry; called from `release_command` and `npm run migrate`.
5. Test helper `test/db.js` — creates a fresh in-memory DB, runs all migrations, returns the connection. Used by every integration test.
6. Repository modules per aggregate (start empty, fill in over later stages): `server/db/users.js`, `projects.js`, `issues.js`, `metadata.js`, `history.js`, `auth.js`, `sessions.js`. Each exports plain functions that take the `db` handle — no ORM.

**Verify:** `npm run migrate` against a fresh file creates all 11 tables; rerunning is a no-op; test helper produces a usable DB.

---

## Stage 2 DONE — Authentication

**Goal:** password + magic-link login work end-to-end, sessions are cookie-backed and revocable, super admin is recognized.

1. `services/passwords.js` — `hash(plain)`, `verify(plain, hash)` using bcrypt.
2. `services/tokens.js` — `generate()` returns `{raw, hash}` (32-byte random, SHA-256 hash). One-time-use enforced at consumption.
3. `services/sessions.js` — create, lookup-by-cookie, touch (`last_seen_at`), revoke, revoke-all-for-user. Cookie is `Secure`, `HttpOnly`, `SameSite=Lax`, signed with `SESSION_SECRET`.
4. `services/email.js` — nodemailer transport from `SMTP_*` env vars; if unconfigured (dev), log the would-be email to stdout. Templates: magic-link, password-reset, invite, notification (stub for now).
5. `routes/auth.js`:
   - `POST /auth/login` — email + password.
   - `POST /auth/magic-link` — email; always responds 200 (don't leak existence). If user exists, mint token, email link.
   - `GET /auth/verify?token=…` — consume magic token, create session, redirect.
   - `POST /auth/logout` — revoke current session, clear cookie.
   - `POST /auth/forgot` and `GET /auth/reset?token=…` + `POST /auth/reset`.
6. `middleware/requireUser.js` — load session from cookie, attach `req.user` (or 401). `middleware/requireSuperAdmin.js` — checks `req.user.email === SUPER_ADMIN_EMAIL` (case-insensitive).
7. **First-login bootstrap**: if `SUPER_ADMIN_EMAIL` matches an unknown email at magic-link request time, auto-create the user row.
8. Login page (`public/login.html` + `login.js`) — vanilla JS, two forms, post via `fetch`.
9. Rate limiting: per-IP and per-email throttle on login + magic-link (in-memory token bucket is fine for v1).

**Verify:** integration tests cover happy paths and the leakage cases; fresh deploy with `SUPER_ADMIN_EMAIL=you@x` lets you log in via magic link with no manual seeding.

---

## Stage 3 DONE — Projects, members, and per-project metadata

**Goal:** super admin can create projects, add members with roles, and the seeded metadata appears.

1. `db/projects.js` — create, rename, archive/unarchive, list (active / all), get-by-id.
2. `db/projectMembers.js` — add, remove, change role, list-for-project, list-for-user.
3. `services/metadata.js` — `seedDefaults(projectId)` inserts the spec's default statuses/categories/priorities inside a transaction; called atomically with project creation. CRUD for each metadata kind: create, rename, reorder, set-default, set-closed (status only), archive.
4. `middleware/requireProjectRole.js` — given `req.params.projectId`, looks up the user's role (super admin bypasses) and enforces a minimum role (`viewer < user < developer`).
5. Routes:
   - `POST /api/admin/projects`, `PATCH /api/admin/projects/:id`, `POST /api/admin/projects/:id/archive` (super admin only).
   - `GET /api/projects` — projects the current user can see.
   - `GET /api/projects/:id` — project detail incl. members and metadata.
   - `POST /api/admin/projects/:id/members`, `PATCH /api/admin/projects/:id/members/:userId`, `DELETE /api/admin/projects/:id/members/:userId`.
   - `GET/POST/PATCH/DELETE /api/projects/:id/metadata/:kind` — developer or super admin.
6. **App-layer invariants**: exactly one default per metadata kind per project (transactionally re-pointed on change); cannot archive the only non-archived row of a kind; cannot archive a status if it's the default.

**Verify:** integration tests for invariants; manual: create a project as super admin, see the six default statuses, three categories, five priorities exist; rename one and see uniqueness enforced.

---

## Stage 4 DONE — Issues (create, edit, history) & permissions matrix

**Goal:** developers/users/viewers can interact with issues at the right level; every save produces a correct history event.

1. `db/issues.js` — create (assigns `number = MAX(number)+1` per project inside a transaction), get-by-number, list-with-filters (paged), update, archive.
2. `db/history.js` — `record({issueId, userId, kind, note, changes})` writes the parent + child rows in a single transaction. `listForIssue(issueId)` returns events with their changes, reverse-chronological.
3. `services/issues.js`:
   - `createIssue` — validates referenced metadata belongs to the project; assignee (if set) is a project member; writes a `kind='creation'` history event.
   - `updateIssue(issueId, userId, patch, note)` — diffs old vs. new, writes one `kind='change'` event with N change rows; resolves IDs to display strings (`status_id` → status name) for `old_value`/`new_value`. No-op if nothing changed and note is empty.
   - `commentIssue(issueId, userId, body)` — writes `kind='comment'` event with no changes.
   - `archiveIssue` / `unarchiveIssue`.
4. **Permission matrix** (enforced in services, not routes, so bulk ops reuse it):
   - viewer: read only.
   - user: edit name, description, assignee; comment; cannot change status/priority/category.
   - developer: all of the above + status/priority/category + archive.
5. Routes under `/api/projects/:id/issues`: list (with query params for filters/sort/page), get, post, patch, post-comment, archive.
6. Filter parser: whitelisted fields, validates each value is a known metadata id for the project; safe SQL with parametrized `IN (...)`.

**Verify:** unit-test the permission matrix exhaustively; integration test that 5 sequential edits + 2 comments produce 7 history events with correct change rows and display strings; renaming a status afterward does not change old history.

---

## Stage 5 DONE — Frontend shell, project picker, and login UI

**Goal:** logged-in users see a project picker (or auto-redirect) and a navigable shell.

1. Decide on a tiny client framework — recommend none, just hand-rolled vanilla JS with template-literal rendering and a `state.js` event-emitter. No build step beyond optional minification.
2. `public/index.html` — single shell page, server returns it for any non-API route (SPA-style). Auth-gate at the server: unauthenticated requests for app routes redirect to `/login.html`.
3. `public/app.js` — hash-router (`#/projects/:id`, `#/projects/:id/issues/:n`, `#/admin/...`, `#/me`). Renders into `<main>`.
4. Components (plain functions returning DOM nodes): `TopBar`, `ProjectPicker`, `Toast`, `Modal`, `RoleBadge`.
5. Login + reset/forgot pages styled to match.
6. CSS: hand-written, mobile-first, CSS variables for theming. Single `app.css`.

**Verify:** click through login → picker → (single project? auto-redirect) → empty project page placeholder. All transitions under ~50ms locally.

---

## Stage 6 DONE — Issue list with filters, search, and last-used persistence

**Goal:** the daily-driver screen is fully functional.

1. `IssueList` component: filter bar + sortable table.
2. Filter state lives in a single object; changes emit a `filters-changed` event that:
   - Updates the URL (`#/projects/:id?status=…`).
   - Persists to `localStorage[`nopbug.filters.${userId}.${projectId}`]`.
   - Fires a debounced `GET /api/projects/:id/issues?…`.
3. On entry: read URL → fall back to `localStorage` → fall back to system default (open, non-closed statuses, priority desc).
4. "Reset to defaults" clears `localStorage` for this project; "Clear filters" only resets the in-memory filter object.
5. Column-header click toggles sort; default tiebreaker `updated_at DESC`.
6. Pagination: server returns `{items, page, pageSize, total, totalPages}`; pager controls replace load-more appends.
7. Empty states: no issues at all vs. no issues match filters (with "Clear filters" CTA).

**Verify:** apply a filter, reload, see it restored; share URL in another browser/profile, see same filter applied; create 50 issues and confirm sort + pagination behave.

---

Let's implement paging for issues rather than a load more that just adds to the total list.

Lint — clean (the two remaining errors are pre-existing in TopBar.js and spa.test.js, unrelated to this work)

A pre-existing flaky test in routes-issues.test.js ("user can patch name but not status") passes in isolation but occasionally flakes in the full file run — independent of this work.

## Interim step DONE — Playwright + chromium for agentic browser testing

Lets a real browser drive the SPA end-to-end (so future agentic sessions can verify UI behavior, and CI catches frontend regressions vitest+supertest can't see).

- `e2e/` — specs (`auth.setup`, `login`, `smoke`).
- `playwright.config.js` — chromium-only, three projects (`setup` → `authed`, plus `unauthed`); webServer spawns `npm run start:e2e` on port 8081 against `./data/e2e.sqlite`.
- `scripts/seed-e2e.js` — wipes + migrates + seeds developer + project + issue.
- New CI job runs `npm run e2e` and uploads `playwright-report/` on failure.

**Run locally:**

1. `npm run e2e:install` — one-time chromium download (~150 MB).
2. `npm run e2e` — full suite. Add `:ui` for the inspector, `:headed` for a visible browser.

---

## Stage 7 DONE — Issue detail, edit-with-history, and comments

**Goal:** the second-most-important screen.

1. `IssueDetail` component: top header (number + name), metadata sidebar, description block, history timeline.
2. Inline editing: clicking a field puts it in edit mode; multiple dirty fields accumulate in a pending-patch object.
3. **Save bar** appears when patch is non-empty: optional note textarea + Save / Discard. Submits to `PATCH /api/.../issues/:n` with `{patch, note}`.
4. **Comment box** is always visible; submits to `POST /api/.../issues/:n/comments`.
5. History timeline renderer: groups changes per event, formats `Field: old → new`, shows note/comment body, author + relative time.
6. After any save/comment, refetch the issue and re-render the timeline.
7. "New issue" modal reuses the same field components.
8. Archive button (developer-only), confirm modal.

**Verify:** make a multi-field edit + note; the timeline shows one event with all field rows and the note; comment-only entries appear correctly; viewers cannot edit.

---

## Stage 8 — Project settings & super-admin interface

**Goal:** the management surfaces.

1. **Project settings (#9)**: tabs for Members (read-only for non-super-admin), Statuses, Categories, Priorities, Danger zone. Drag-to-reorder uses HTML5 drag events; persists `sort_order` via `PATCH`.
2. **Admin shell (#10)** routes under `#/admin/...`, server-side gated by `requireSuperAdmin`.
3. **Admin Users (#11)**: table, edit name, disable/enable, send reset, send magic link, manage memberships modal (per-project role grid), invite-user form.
4. **Admin Projects (#12)**: list (incl. archived), create, rename, archive/unarchive, "Members" and "Metadata" actions.
5. **Admin Project Metadata (#17)**: same UI as project settings metadata tabs, plus "Reset to system defaults" and "Copy from another project".
6. **Admin Sessions (#13)** and **Admin System (#14)**: read-only views; revoke session / sign-out-everywhere.
7. **Profile (#16)**: edit name, change password, list+revoke own sessions.

**Verify:** super admin walks through: create user → invite via magic link → create project → add user as developer → user logs in, sees only that project, can edit issues per role.

---

## Stage 9 — Attachments

**Goal:** issues and comments can carry files.

1. New table `attachments` (migration `0002_attachments.sql`): `id`, `issue_id`, `issue_history_id` (nullable — set if attached to a comment/save event), `uploaded_by`, `filename`, `content_type`, `size_bytes`, `storage_path`, `created_at`, `archived_at`.
2. `services/attachments.js` — store under `${ATTACHMENTS_DIR}/${projectId}/${issueId}/${uuid}-${safeName}`. Validate size (configurable cap, default 25 MB) and MIME against an allowlist.
3. Routes: `POST /api/.../issues/:n/attachments`, `GET /api/attachments/:id` (streams, checks project access), `POST /api/attachments/:id/archive`.
4. Frontend: drag-and-drop zone in new-issue modal, issue detail header, and comment box. Thumbnail strip for images via `Content-Type` sniff; filename + size for others.
5. Permission: uploader and project developers can archive an attachment.

**Verify:** upload an image and a PDF; both render correctly; a viewer in a different project cannot fetch the file by guessing its id.

---

## Stage 10 — Notifications, @mentions, and watching

**Goal:** users get emailed on changes that matter to them.

1. New tables (`0003_notifications.sql`):
   - `issue_watchers (issue_id, user_id, created_at, PRIMARY KEY(issue_id, user_id))`
   - `notification_prefs (user_id, kind, enabled)` — kinds: `assigned_to_me`, `mentioned`, `watched_status_change`, `watched_any_change`
   - `notifications (id, user_id, issue_id, history_id, kind, created_at, read_at, emailed_at)` — in-app feed + delivery tracking
2. `services/mentions.js` — extract `@user` from text using a project-member name index.
3. `services/notifications.js` — given a history event, compute the recipient set (assignee, mentioned users, watchers minus author), respect each recipient's prefs, insert notification rows. Email worker batches and sends via the existing email service.
4. Auto-watch rules: on create, comment, or being assigned, the user is added to `issue_watchers`.
5. Frontend:
   - "Watch / Unwatch" toggle on issue detail.
   - Notification bell in top bar with unread count → dropdown.
   - Profile → Notifications tab for prefs.
   - Mention autocomplete in description / save-note / comment fields, fed by project members.
6. Email worker runs in-process on a 30-second interval; sends each unsent `notifications` row, sets `emailed_at`. Re-entrancy safe via a `WHERE emailed_at IS NULL` filter and per-row update.

**Verify:** assign issue to user B → B receives email and sees in-app notification; @mention user C in a comment → C also notified; opt out of `watched_any_change` and confirm silence.

---

## Stage 11 — Saved filters, bulk edit, full-text search

**Goal:** power-user features on the issue list.

1. **Saved filters** — migration `0004_saved_filters.sql`: `saved_filters (id, user_id, project_id, name, filter_json, is_default, created_at)`. Routes under `/api/projects/:id/filters`. UI: dropdown in filter bar with save/rename/delete/set-default. Personal default overrides last-used on entry.
2. **Bulk edit** — checkbox column on the list; floating action bar appears when ≥1 selected. Server endpoint `POST /api/projects/:id/issues/bulk` accepts `{ids, patch, note}` and applies the change per-issue, reusing the permission matrix and history service.
3. **FTS5** — migration `0005_fts.sql`: virtual table `issues_fts` over `name`, `description`, plus comment bodies via a triggered shadow content. Triggers on `issues` and `issue_history` keep the index current. Search input switches to FTS query when populated; falls back to LIKE if FTS5 isn't compiled in.

**Verify:** save a filter, set it default, reload, see it applied; bulk-archive 10 issues with a single note → 10 history events written; FTS finds matches in comments.

---

## Stage 12 — API tokens and activity feed

**Goal:** programmatic access and admin visibility.

1. Migration `0006_api_tokens.sql`: `api_tokens (id, user_id, name, token_hash, last_used_at, expires_at, created_at, revoked_at)`. Token format `nb_<32-byte-base64>`; only the hash stored.
2. `middleware/requireUser.js` accepts either a session cookie or `Authorization: Bearer nb_...`. Same permission model.
3. Routes: `/api/me/tokens` create/list/revoke; admin can list/revoke any user's tokens via `/api/admin/users/:id/tokens`.
4. **Activity feed** (`/admin/activity`): server endpoint joins `issue_history` across all projects with project + user filters and a date range; UI is a paginated list mirroring the issue history renderer.

**Verify:** mint a token, hit `/api/projects` with curl using `Bearer`, get the same data; admin filters activity by project and user.

---

## Stage 13 — Keyboard shortcuts and polish

**Goal:** snappy daily use.

1. Global `keydown` handler with a context-aware dispatch: bindings registered per active route.
2. Bindings per spec (#24); `?` opens a shortcut help overlay rendered from a single source-of-truth registry.
3. Polish: focus rings, accessible roles on custom interactive elements, loading skeletons, empty-state illustrations (CSS only), dark-mode CSS-variable toggle.
4. Performance pass: ensure issue list with 1000 issues is interactive; index-tune any slow queries observed.

**Verify:** every documented shortcut works; `?` shows accurate help; Lighthouse a11y score ≥ 95.

---

## Stage 14 — Hardening, ops, and 1.0

**Goal:** production-ready.

1. **Backups** — `scripts/backup.js` runs `VACUUM INTO` to a timestamped file, optionally uploads to S3-compatible storage if configured. Cron via fly machine schedule.
2. **Restore documented** — `scripts/restore.js` and a tested runbook.
3. **Observability** — request logging via pino, error reporter (Sentry-compatible env-var-driven), `/healthz` enriched with DB write check.
4. **CSRF** — double-submit-cookie pattern on all state-changing routes; API token requests are exempt.
5. **Audit log of admin actions** — table `admin_audit (id, super_admin_user_id, action, target_type, target_id, payload_json, created_at)` written by the admin routes.
6. **Docs** — `README.md` (run locally, deploy to fly, env vars), `OPERATIONS.md` (backup/restore, rotating SUPER_ADMIN_EMAIL, recovering a locked-out admin via env-var magic-link), `CONTRIBUTING.md`.
7. **License** — choose and add (MIT recommended).
8. **End-to-end smoke test** — Playwright script that runs against a fresh deploy: super admin login → create user → create project → user receives invite email (captured via SMTP test inbox) → user logs in → files an issue → super admin sees activity.

**Verify:** restore from backup into a fresh fly app; smoke test passes; security review checklist (OWASP top 10) walked through.

---

## Cross-cutting conventions (apply throughout)

- **Migrations are append-only** — new file per change, never edit a shipped migration.
- **Service-layer transactions** — any operation that writes to multiple tables runs inside `db.transaction(...)`.
- **Display-string history** — services always resolve FK ids to names before inserting `issue_history_changes`.
- **Permission checks in services** — routes are thin; bulk and API token paths reuse the same checks.
- **No client build step** — vanilla ESM modules served directly; `<script type="module">`. Optional minify in CI.
- **Tests per stage** — each stage adds integration tests covering its happy paths and at least one failure mode; CI gate is "all green".

---

## Suggested commit cadence

One PR per stage, broken into 3–6 commits matching the numbered sub-steps. Each PR includes its migrations, services, routes, and UI together so `main` is always deployable.
