CREATE TABLE accounts (email TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT, google_sub TEXT UNIQUE, verified_at TEXT NOT NULL);
CREATE TABLE account_challenges (id TEXT PRIMARY KEY, email TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, hash TEXT NOT NULL, expires TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
ALTER TABLE sessions ADD COLUMN method TEXT NOT NULL DEFAULT 'legacy';
CREATE TABLE email_outbox (id TEXT PRIMARY KEY, workspace TEXT, recipient TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, created_at TEXT NOT NULL, sent_at TEXT, provider_id TEXT, error TEXT);
CREATE INDEX email_outbox_pending ON email_outbox(status,available_at);
CREATE TABLE demo_sessions (session_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, workspace TEXT NOT NULL, actor TEXT NOT NULL, today TEXT);
