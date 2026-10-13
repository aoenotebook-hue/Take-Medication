ALTER TABLE sync_operations ADD COLUMN device_id uuid;
ALTER TABLE sync_operations ADD COLUMN client_at timestamptz;
ALTER TABLE dose_events ADD COLUMN device_id uuid;
INSERT INTO schema_migrations VALUES(3);
