# Basic Bugs

A simple, self-hostable bug tracker aimed at independent consultants and small teams. No SaaS, no per-seat pricing — bring your own server.

Built with vanilla JavaScript, CSS, and HTML on a Node + Express backend, backed by SQLite. No client build step.

## Status

Early development. See [DEVELOPMENT.md](DEVELOPMENT.md) for the staged build plan.

## Features (planned)

- Multi-project issue tracking with per-project statuses, categories, and priorities
- Role-based access (super admin / developer / user / viewer) per project
- Password and magic-link authentication
- Issue history with full change tracking and comments
- Attachments, @mentions, watching, and email notifications
- Saved filters, bulk edit, and full-text search
- API tokens for programmatic access

## Tech stack

- **Backend:** Node.js (LTS), Express, `better-sqlite3`
- **Frontend:** vanilla ESM modules, hand-written CSS — no framework, no bundler
- **Email:** nodemailer (any SMTP provider)
- **Deploy target:** fly.io with a persistent volume; runs anywhere Node + SQLite run

## Running locally

> Not yet runnable — see Stage 0 in [DEVELOPMENT.md](DEVELOPMENT.md). Once bootstrapped:

```bash
npm install
npm run migrate
npm start
```

Required environment variables: `PORT`, `DB_PATH`, `SUPER_ADMIN_EMAIL`, `SESSION_SECRET`, `BASE_URL`, `SMTP_*`, `ATTACHMENTS_DIR`.

## Contributing

Issues and pull requests are welcome. Please open an issue to discuss substantial changes before starting work.

## License

[MIT](LICENSE) © 2026 James Terry
