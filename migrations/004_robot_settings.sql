CREATE TABLE IF NOT EXISTS robot_settings(key text PRIMARY KEY,value text NOT NULL);
INSERT INTO schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;
PRAGMA user_version=4;
