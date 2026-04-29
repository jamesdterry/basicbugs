-- 0005_admin_audit.sql — Stage 14: durable record of super-admin actions.
-- Connection-level PRAGMAs are set in connection.js; the migration runner
-- wraps each file in its own transaction.
--
-- Written from inside the same db.transaction() as the mutation it records,
-- so every successful admin write has a paired audit row.

CREATE TABLE admin_audit (
  id                   INTEGER PRIMARY KEY,
  super_admin_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action               TEXT NOT NULL,
  target_type          TEXT,
  target_id            INTEGER,
  payload_json         TEXT,
  created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_admin_audit_created_at ON admin_audit (created_at DESC);
CREATE INDEX idx_admin_audit_actor      ON admin_audit (super_admin_user_id, created_at DESC);
