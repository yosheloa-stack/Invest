CREATE TABLE IF NOT EXISTS users(id text PRIMARY KEY,email text NOT NULL UNIQUE,name text NOT NULL,password text NOT NULL,role text NOT NULL DEFAULT 'user',created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING;
PRAGMA user_version=2;
