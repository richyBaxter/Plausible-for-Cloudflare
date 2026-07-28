-- Saved funnel definitions. Each funnel is a named, ordered list of steps
-- (page paths like '/pricing' or custom-event names like 'Signup'), stored as a
-- JSON array. The dashboard and the MCP `list_funnels` / `get_funnel` tools read
-- these so funnels can be defined once and reused.

CREATE TABLE IF NOT EXISTS funnels (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT    NOT NULL UNIQUE,
  steps   TEXT    NOT NULL,   -- JSON array of step strings
  created INTEGER NOT NULL
);
