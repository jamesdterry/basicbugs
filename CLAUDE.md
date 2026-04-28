# Basic Bugs

Open-source bug tracker aimed at consultants. Vanilla JS/CSS/HTML on a Node + Express server backed by SQLite (`better-sqlite3`). Deploys to fly.io.

## Stack & conventions

- **Server:** Node LTS, Express, `better-sqlite3`, bcrypt, nodemailer, helmet.
- **Client:** hand-rolled vanilla ESM modules (`<script type="module">`), single `app.css`. **No build step.**
- **Layout:** `server/{routes,services,db,middleware}`, `public/{lib,components,views}/`, `test/`, `scripts/`.
- **Frontend modules:** `public/lib/state.js` (event emitter + `h()` DOM helper), `public/lib/router.js` (hash router; add routes to its table, not ad-hoc), `public/lib/api.js` (`getJson`/`postJson`/etc — 401 auto-redirects to `/login.html`). Components are DOM-returning functions in `public/components/`; route views go in `public/views/`.
- **CSP:** helmet defaults block inline scripts/styles. No inline event handlers (`onclick=`), no inline `style=`, no `eval`/`new Function`. Bind events with `addEventListener` (or the `on*` keys in `h()`).
- **App shell auth:** `/` and `/index.html` are gated by `loadSessionFromCookie` (exported from `middleware/requireUser.js`); other static assets are public.
- **Migrations:** append-only `server/db/migrations/*.sql`; never edit a shipped migration.
- **Transactions:** any multi-table write runs inside `db.transaction(...)`.
- **Permissions:** enforced in services (not routes) so bulk/API paths reuse them.
- **History:** services resolve FK ids to display strings before writing `issue_history_changes`.
- **Tests:** vitest + supertest; integration tests use a fresh in-memory DB via `test/db.js`.

## Roles

Super admin (env `SUPER_ADMIN_EMAIL`) → developer → user → viewer.

## Reference

`DEVELOPMENT.md` — staged build plan (each stage is independently shippable).
`db.sql` — source schema (becomes `migrations/0001_initial.sql`).
