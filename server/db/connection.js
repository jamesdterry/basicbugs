// Stage 1 wires up better-sqlite3 here. Stage 0 ships an empty stub so the
// directory exists and the import path is reserved.

export function getDb() {
  throw new Error('Database is not initialised yet — see Stage 1 in DEVELOPMENT.md.');
}
