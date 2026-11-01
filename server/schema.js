// SQLite schema for the mock call center simulation.
//
// Design principle: everything below is *raw, append-only* data. No
// pre-aggregated or UI-specific tables. Analytics, charts, dashboards and any
// future tool (like JEV) compute their views on demand from the raw streams:
//
//   company 1--* call_center 1--* queue
//   company 1--* agent
//   agent  *--* call_center   (via agent_call_center; all a given agent's
//                              centers must belong to the SAME company)
//   agent  1--* agent_status  (append-only status events)
//   queue  1--* call          (raw call records, append-only)
//
// Timezone-awareness: companies and call centers carry an IANA timezone plus
// open_time/close_time (minutes since local midnight). Calls record both a
// UTC timestamp and the caller's local wall-clock time + UTC offset so the raw
// data stays queryable across timezones without any write-time derivation.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS company (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  timezone    TEXT    NOT NULL DEFAULT 'UTC',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS call_center (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  timezone      TEXT    NOT NULL DEFAULT 'UTC',
  open_time     INTEGER NOT NULL DEFAULT 540,   -- minutes since local midnight (09:00)
  close_time    INTEGER NOT NULL DEFAULT 1020,  -- (17:00)
  base_calls_per_hour INTEGER NOT NULL DEFAULT 30,
  days_of_week  TEXT    NOT NULL DEFAULT '1,2,3,4,5', -- ISO weekdays 1=Mon..7=Sun
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- A queue is a phone number / routing target. Most call centers have one, but
-- several are allowed so call records can carry an origin.
CREATE TABLE IF NOT EXISTS queue (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  call_center_id INTEGER NOT NULL REFERENCES call_center(id) ON DELETE CASCADE,
  number         TEXT    NOT NULL,              -- raw phone number / DID
  name           TEXT,                          -- e.g. "Billing", "Support"
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- An agent belongs to a company, and is associated with one or more of that
-- company's call centers via agent_call_center.
CREATE TABLE IF NOT EXISTS agent (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  avg_handle_seconds INTEGER NOT NULL DEFAULT 300,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_call_center (
  agent_id       INTEGER NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  call_center_id INTEGER NOT NULL REFERENCES call_center(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, call_center_id)
);

-- Raw, append-only agent status events. Each event has a start (from) and end
-- (to) timestamp in UTC; a NULL to means "still in this state".
-- Statuses: logged_out, available, on_call, wrap_up, on_break, training,
--           meal_break, offline (a coarse, extensible set).
CREATE TABLE IF NOT EXISTS agent_status (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id       INTEGER NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  call_center_id INTEGER REFERENCES call_center(id) ON DELETE CASCADE,
  status         TEXT    NOT NULL,
  from_ts        TEXT    NOT NULL,              -- ISO UTC
  to_ts          TEXT,                          -- ISO UTC, NULL = ongoing
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Raw, append-only call records. A call is initiated against a queue (which
-- identifies the call center). local_started_at and utc_offset_minutes
-- preserve the caller's local wall-clock without write-time aggregation.
CREATE TABLE IF NOT EXISTS call (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  call_center_id   INTEGER NOT NULL REFERENCES call_center(id) ON DELETE CASCADE,
  queue_id         INTEGER REFERENCES queue(id) ON DELETE SET NULL,
  agent_id         INTEGER REFERENCES agent(id) ON DELETE SET NULL,
  started_at       TEXT    NOT NULL,            -- ISO UTC (arrival time)
  local_started_at TEXT    NOT NULL,            -- ISO WITHOUT offset, caller local wall-clock
  utc_offset_min   INTEGER NOT NULL DEFAULT 0,  -- caller timezone offset at start, minutes
  answered_at      TEXT,                        -- ISO UTC, null if abandoned/voicemail
  ended_at         TEXT,                        -- ISO UTC
  wait_seconds     INTEGER,
  talk_seconds     INTEGER,
  outcome          TEXT    NOT NULL DEFAULT 'answered', -- answered | abandoned | voicemail
  topic            TEXT,
  mood             TEXT,            -- caller mood: calm | neutral | frustrated | angry
  persona          TEXT,            -- agent persona: empathetic | efficient | cheerful | formal
  product          TEXT,            -- product under discussion (may be null)
  satisfaction     INTEGER,                     -- 1..5 if surveyed
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Raw, append-only conversation turns. One call has many turns, ordered by
-- seq, each spoken by 'caller' | 'agent' | 'ivr'. offset_seconds is the
-- number of seconds after the call's started_at that the turn occurred.
CREATE TABLE IF NOT EXISTS call_turn (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id        INTEGER NOT NULL REFERENCES call(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,             -- 1-based order within the call
  speaker        TEXT    NOT NULL,             -- caller | agent | ivr
  text           TEXT    NOT NULL,
  offset_seconds INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_center_company     ON call_center(company_id);
CREATE INDEX IF NOT EXISTS idx_queue_center       ON queue(call_center_id);
CREATE INDEX IF NOT EXISTS idx_agent_company      ON agent(company_id);
CREATE INDEX IF NOT EXISTS idx_acc_agent          ON agent_call_center(agent_id);
CREATE INDEX IF NOT EXISTS idx_acc_center         ON agent_call_center(call_center_id);
CREATE INDEX IF NOT EXISTS idx_status_agent       ON agent_status(agent_id);
CREATE INDEX IF NOT EXISTS idx_status_center      ON agent_status(call_center_id);
CREATE INDEX IF NOT EXISTS idx_status_from        ON agent_status(from_ts);
CREATE INDEX IF NOT EXISTS idx_call_center        ON call(call_center_id);
CREATE INDEX IF NOT EXISTS idx_call_agent         ON call(agent_id);
CREATE INDEX IF NOT EXISTS idx_call_queue         ON call(queue_id);
CREATE INDEX IF NOT EXISTS idx_call_started       ON call(started_at);
CREATE INDEX IF NOT EXISTS idx_turn_call          ON call_turn(call_id);
CREATE INDEX IF NOT EXISTS idx_turn_seq           ON call_turn(call_id, seq);
`