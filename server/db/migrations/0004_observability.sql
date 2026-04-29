-- 0004_observability.sql — Stage 14: in-app error log + healthz write probe.
-- Connection-level PRAGMAs are set in connection.js; the migration runner
-- wraps each file in its own transaction.

-- Single-row table whose UPDATE doubles as a SQLite write probe for /healthz.
-- Reads alone don't tell us the journal is writable, so /healthz writes here.
CREATE TABLE _health (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  last_check  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO _health (id) VALUES (1);

-- Persisted 5xx + unhandled errors. Reviewed manually at #/admin/errors.
-- Pruned by the in-process pruner on a 24h cadence (default 30 days).
CREATE TABLE error_log (
  id          INTEGER PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  method      TEXT,
  route       TEXT,
  status      INTEGER,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message     TEXT,
  stack       TEXT
);
CREATE INDEX idx_error_log_created_at ON error_log (created_at DESC);
