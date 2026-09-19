-- API-00: schema ban đầu (docs/WORK-BREAKDOWN.md mục 4.7). Chỉ metadata, không có cột nhị phân (bất biến I9).
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('visitor', 'admin')),
  username TEXT UNIQUE,
  display_name TEXT,
  password_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ended_at TEXT,
  ip TEXT,
  user_agent TEXT,
  consent_at TEXT,
  consent_version TEXT,
  display_name TEXT
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT
);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX events_session_ts ON events(session_id, ts);
CREATE INDEX sessions_created ON sessions(created_at);
