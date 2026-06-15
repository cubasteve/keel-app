-- KEEL digital logbook — D1 schema.
-- Apply: cd logbook && npx wrangler d1 execute keel-logbook --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS log_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT    NOT NULL,            -- 'trip' | 'maintenance'
  trip_id      TEXT,                        -- bytes32 hex (trip logs); NULL for maintenance
  boat_id      INTEGER NOT NULL DEFAULT 0,
  author       TEXT    NOT NULL,            -- wallet address recovered from the signature
  engine_hours REAL,                        -- cumulative engine hours reading
  fuel_pct     INTEGER,                     -- 0–100
  conditions   TEXT,                        -- e.g. "Sunny, 8–12 kt SW"
  notes        TEXT,
  issue        INTEGER NOT NULL DEFAULT 0,  -- 1 = flagged problem/damage
  photo_keys   TEXT,                        -- JSON array of R2 object keys
  created_at   INTEGER NOT NULL             -- unix seconds
);
CREATE INDEX IF NOT EXISTS idx_log_boat ON log_entries(boat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_log_trip ON log_entries(trip_id);
