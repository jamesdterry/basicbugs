# Contributing

## Local development

Requires **Node 22**. Use `nvm`:

```bash
nvm use 22       # or `nvm install 22` if you don't have it yet
npm install
npm run migrate
npm run dev
```

Default URL: `http://localhost:8080`. SMTP is not required for local dev — emails (magic links, invites) are logged to stdout as `[dev-email] {...}`.

Set a `SUPER_ADMIN_EMAIL` env var (or `.env` file) to claim super-admin status on first sign-in:

```bash
SUPER_ADMIN_EMAIL=you@example.com npm run dev
```

Then visit `/login.html`, request a magic link for that email, and copy the URL out of the dev console.

## Tests

```bash
npm test                   # vitest — unit + integration, in-memory SQLite
npm run e2e:install        # one-time: download chromium (~150 MB)
npm run e2e                # Playwright — file-backed SQLite + real browser
```

E2E specs run with `workers=1` in CI to avoid SQLite WAL contention. Local headed:

```bash
npm run e2e:headed
npm run e2e:ui             # the inspector
```

## Project conventions

These are enforced by review, not lint — read them before opening a PR.

- **No client build step.** Vanilla ESM modules served from `public/`. Scripts are loaded as `<script type="module">`. There is no Vite, esbuild, webpack — don't add one.
- **Append-only migrations.** New `server/db/migrations/NNNN_name.sql` per change. Never edit a shipped migration.
- **Service-layer transactions.** Any operation that writes to multiple tables runs inside `db.transaction(...)`.
- **Service-layer permissions.** Routes are thin; permission checks live in services so bulk paths and any future API token paths reuse the same logic.
- **Display-string history.** Services resolve foreign-key ids to display names before inserting `issue_history_changes`. Renaming a status later must not corrupt old history rows.
- **CSP-safe.** Helmet's defaults block inline scripts and styles. No inline event handlers (`onclick=`), no inline `style=`, no `eval` / `new Function`. Bind events with `addEventListener` or the `on*` keys in `h()`.
- **No comments unless the WHY is non-obvious.** Comments document hidden constraints, subtle invariants, or specific bug workarounds — not what the code does.
- **One PR per stage**, broken into 3–6 commits matching the numbered sub-steps in [DEVELOPMENT.md](DEVELOPMENT.md). Each commit independently shippable; `main` is always deployable.
- **Never push from an agent or script.** The maintainer pushes manually. Read-only git commands are always fine; commits happen on direct request only.

## Code layout

```
server/
  routes/      # express routers — thin, defer to services
  services/    # business logic, transactions, permission checks
  db/          # repositories (one per aggregate), migrations
  middleware/  # requireUser, requireProjectRole, requireSuperAdmin, csrf, rateLimit
public/
  lib/         # state, router, api (with CSRF), filters, debounce, relativeTime
  components/  # DOM-returning functions
  views/       # route views, including admin/
test/          # vitest + supertest, in-memory DB
e2e/           # Playwright + chromium, file-backed DB on :8081
scripts/       # CLI utilities (migrate, seed, backup, restore, ...)
```

## Filing issues

Bug reports are most useful when they include:

- Browser + OS.
- Steps to reproduce against `npm run dev`.
- A line from `#/admin/errors` if the bug surfaced as a 5xx.

For substantial proposals (new tables, new admin surfaces, schema changes), open an issue first to discuss. The bar for adding dependencies is high — vanilla solutions are preferred.

## License

MIT — see [LICENSE](LICENSE). Contributions are accepted under the same license.
