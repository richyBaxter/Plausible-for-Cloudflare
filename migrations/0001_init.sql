-- Plausible-for-Cloudflare schema (D1 / SQLite).
--
-- Two tables:
--   events   — one row per pageview or custom event (powers page/goal breakdowns).
--   sessions — one row per visit, maintained on ingest with a 30-minute inactivity
--              window (powers unique visitors, bounce rate and visit duration).
--
-- Timestamps are Unix epoch seconds. No IP addresses are ever stored: visitors are
-- identified by a salted, daily-rotating, non-reversible hash (see src/identity.ts).

CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       INTEGER NOT NULL,
  name            TEXT    NOT NULL,          -- 'pageview' or a custom event name
  domain          TEXT    NOT NULL,
  user_id         TEXT    NOT NULL,
  session_id      TEXT    NOT NULL,
  hostname        TEXT,
  pathname        TEXT    NOT NULL,
  referrer        TEXT,
  referrer_source TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  country         TEXT,
  region          TEXT,
  city            TEXT,
  browser         TEXT,
  browser_version TEXT,
  os              TEXT,
  os_version      TEXT,
  device          TEXT,
  screen_size     TEXT,
  props           TEXT                        -- JSON string of custom properties
);

CREATE INDEX IF NOT EXISTS idx_events_domain_ts   ON events (domain, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_name        ON events (domain, name, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_path        ON events (domain, pathname, timestamp);

CREATE TABLE IF NOT EXISTS sessions (
  session_id      TEXT PRIMARY KEY,
  user_id         TEXT    NOT NULL,
  domain          TEXT    NOT NULL,
  start           INTEGER NOT NULL,
  last_activity   INTEGER NOT NULL,
  duration        INTEGER NOT NULL DEFAULT 0, -- seconds between first and last event
  is_bounce       INTEGER NOT NULL DEFAULT 1, -- 1 while a visit has <= 1 pageview
  pageviews       INTEGER NOT NULL DEFAULT 0,
  events          INTEGER NOT NULL DEFAULT 0,
  entry_page      TEXT,
  exit_page       TEXT,
  referrer        TEXT,
  referrer_source TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  country         TEXT,
  region          TEXT,
  city            TEXT,
  browser         TEXT,
  browser_version TEXT,
  os              TEXT,
  os_version      TEXT,
  device          TEXT,
  screen_size     TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_domain_start ON sessions (domain, start);
CREATE INDEX IF NOT EXISTS idx_sessions_user         ON sessions (user_id, domain, last_activity);
