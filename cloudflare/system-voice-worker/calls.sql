CREATE TABLE calls (
  request_id TEXT PRIMARY KEY, subject TEXT, call_sid TEXT UNIQUE,
  direction TEXT NOT NULL, persona TEXT NOT NULL, purpose TEXT,
  state TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE stream_tickets (
  ticket TEXT PRIMARY KEY, call_sid TEXT NOT NULL, persona TEXT NOT NULL,
  expires_at INTEGER NOT NULL, claimed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE call_events (
  event_id TEXT PRIMARY KEY, call_sid TEXT NOT NULL, kind TEXT NOT NULL,
  evidence TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX call_events_call ON call_events(call_sid, created_at);
