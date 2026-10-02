-- Private worker database; access is only through authenticated call handlers.
CREATE TABLE IF NOT EXISTS call_contacts (
 subject TEXT NOT NULL,
 contact_id TEXT NOT NULL,
 label TEXT NOT NULL,
 aliases TEXT NOT NULL DEFAULT '[]',
 number TEXT NOT NULL,
 source_ref TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('VERIFIED','PENDING','REVOKED')),
 verified_at TEXT,
 PRIMARY KEY(subject,contact_id)
);
CREATE TABLE IF NOT EXISTS call_command_evidence (
 request_id TEXT PRIMARY KEY,
 subject TEXT NOT NULL,
 contact_id TEXT NOT NULL,
 persona TEXT NOT NULL,
 purpose TEXT NOT NULL,
 source_ref TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(subject,contact_id) REFERENCES call_contacts(subject,contact_id)
);
