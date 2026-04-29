# Basic Bugs

A simple, self-hostable bug tracker aimed at independent consultants and small teams. No SaaS, no per-seat pricing — bring your own server.

Built with vanilla JavaScript, CSS, and HTML on a Node + Express backend, backed by SQLite. No client build step.

## Features

- Multi-project issue tracking with per-project statuses, categories, and priorities
- Role-based access (super admin / developer / user / viewer) per project
- Password and magic-link authentication
- Issue history with full change tracking and threaded comments
- Attachments (drag-and-drop, MIME-validated, size-capped)
- @mentions, watching, and email notifications
- Saved filters, full-text search (FTS5)
- Continuous backups via Litestream + daily SQLite snapshots; attachment mirror to S3-compatible storage
- Super-admin audit log and in-app error log

## Tech stack

- **Backend:** Node 22, Express, `better-sqlite3`, pino
- **Frontend:** vanilla ESM modules, hand-written CSS — no framework, no bundler
- **Email:** nodemailer (any SMTP provider; logs to stdout when unconfigured)
- **Deploy target:** fly.io with a persistent volume; runs anywhere Node + SQLite run

## Running locally

```bash
nvm use 22
npm install
npm run migrate
npm run dev
```

Set `SUPER_ADMIN_EMAIL=you@example.com` (env or `.env`) to claim super-admin on first sign-in. Visit `/login.html`, request a magic link, copy the URL from the terminal (`[dev-email] ...`).

Required environment variables in production: `SESSION_SECRET`, `SUPER_ADMIN_EMAIL`, `BASE_URL`, `DB_PATH`, `ATTACHMENTS_DIR`. Optional: `PORT`, `SMTP_*`, `LOG_LEVEL`. See [OPERATIONS.md](OPERATIONS.md) for the full list and rotation procedures.

## Tests

```bash
npm test                   # vitest — unit + integration
npm run e2e:install        # one-time chromium install
npm run e2e                # Playwright + chromium
```

## Documentation

- [DEVELOPMENT.md](DEVELOPMENT.md) — staged build plan
- [OPERATIONS.md](OPERATIONS.md) — production ops, env vars, super-admin rotation, lockout recovery
- [BACKUPS.md](BACKUPS.md) — Litestream + snapshot setup, restore procedures, drill runbook
- [CONTRIBUTING.md](CONTRIBUTING.md) — local dev, conventions, PR cadence

## License

[MIT](LICENSE) © 2026 James Terry
