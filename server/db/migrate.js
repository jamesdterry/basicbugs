// Stage 1 implements the real migration runner. Stage 0 keeps a no-op so
// fly's release_command succeeds before any migrations exist.

export function runMigrations() {
  return { applied: [], skipped: [] };
}
