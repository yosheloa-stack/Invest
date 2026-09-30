CREATE TABLE IF NOT EXISTS robot_trades(id text PRIMARY KEY,symbol text NOT NULL,opened_at INTEGER NOT NULL,status text NOT NULL,body text NOT NULL);
CREATE INDEX IF NOT EXISTS robot_trades_time ON robot_trades(opened_at);
INSERT INTO schema_migrations(version) VALUES(3) ON CONFLICT DO NOTHING;
PRAGMA user_version=3;
