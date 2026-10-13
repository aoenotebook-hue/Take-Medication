-- Metadata about supersession is separate from immutable regimen rows.
CREATE TABLE IF NOT EXISTS regimen_supersessions(regimen_id uuid PRIMARY KEY REFERENCES regimen_versions, replacement_id uuid REFERENCES regimen_versions, effective_at timestamptz NOT NULL);
INSERT INTO schema_migrations VALUES(2) ON CONFLICT DO NOTHING;
