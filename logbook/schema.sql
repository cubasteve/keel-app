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
  created_at   INTEGER NOT NULL,            -- unix seconds
  locked       INTEGER NOT NULL DEFAULT 0   -- 1 = finalized by admin, no longer editable
);
CREATE INDEX IF NOT EXISTS idx_log_boat ON log_entries(boat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_log_trip ON log_entries(trip_id);

-- Waitlist: members get an in-app notification when a day they waitlisted frees up.
CREATE TABLE IF NOT EXISTS waitlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day        TEXT    NOT NULL,            -- "YYYY-MM-DD" (ET calendar day)
  member     TEXT    NOT NULL,            -- wallet address
  created_at INTEGER NOT NULL,
  notified   INTEGER NOT NULL DEFAULT 0   -- 1 = already alerted that it opened
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wl_unique ON waitlist(member, day);
CREATE INDEX IF NOT EXISTS idx_wl_member ON waitlist(member);

-- Float plan + pre-departure checklist + check-in/out, one per trip.
CREATE TABLE IF NOT EXISTS floatplan (
  trip_id     TEXT PRIMARY KEY,
  member      TEXT NOT NULL,
  boat_id     INTEGER NOT NULL DEFAULT 0,
  checklist   TEXT,                       -- JSON {lifejackets:true, fuel:true, ...}
  souls       INTEGER,                    -- people aboard
  destination TEXT,
  eta_return  INTEGER,                    -- planned return (unix seconds)
  contact     TEXT,                       -- emergency contact
  status      TEXT NOT NULL DEFAULT 'planned', -- planned | departed | returned
  departed_at INTEGER,
  returned_at INTEGER,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fp_member ON floatplan(member);
CREATE INDEX IF NOT EXISTS idx_fp_status ON floatplan(status);
