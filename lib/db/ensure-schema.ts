import type Database from "better-sqlite3";

/**
 * Create the schema if it's missing, so running the app (`npm run dev`) just
 * works without a separate `db:push`/migration step. Idempotent and safe on an
 * existing database: tables/indexes use IF NOT EXISTS, and newer columns are
 * added only when absent. Keep this in sync with lib/db/schema.ts.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_login TEXT NOT NULL UNIQUE,
  display_name TEXT,
  forward_tag TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT,
  address TEXT,
  city TEXT,
  country TEXT,
  lat REAL,
  lng REAL,
  apple_place_id TEXT,
  apple_maps_url TEXT,
  geo_source TEXT,
  dedup_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS properties_city_idx ON properties (city);

CREATE TABLE IF NOT EXISTS stays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  property_id INTEGER REFERENCES properties(id),
  check_in TEXT,
  check_out TEXT,
  confirmation_no TEXT,
  room_type TEXT,
  total REAL,
  currency TEXT,
  channel TEXT,
  source TEXT NOT NULL,
  source_ref TEXT,
  raw_excerpt TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stays_user_idx ON stays (user_id);
CREATE INDEX IF NOT EXISTS stays_checkin_idx ON stays (check_in);

CREATE TABLE IF NOT EXISTS raw_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  subject TEXT,
  sender TEXT,
  received_at INTEGER,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  parse_json TEXT,
  resv_key TEXT,
  stay_id INTEGER REFERENCES stays(id),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS raw_user_external_idx ON raw_messages (user_id, external_id);
CREATE INDEX IF NOT EXISTS raw_user_resv_idx ON raw_messages (user_id, resv_key);

CREATE TABLE IF NOT EXISTS ingest_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL
);
`;

// Columns added after the initial schema — added to pre-existing tables.
const ADDED_COLUMNS: Record<string, Record<string, string>> = {
  raw_messages: {
    subject: "TEXT",
    sender: "TEXT",
    resv_key: "TEXT",
  },
};

export function ensureSchema(sqlite: Database.Database): void {
  sqlite.exec(DDL);
  for (const [table, cols] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set(
      (sqlite.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name),
    );
    for (const [col, type] of Object.entries(cols)) {
      if (!existing.has(col)) {
        sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
      }
    }
  }
}
