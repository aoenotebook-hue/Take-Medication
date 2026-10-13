CREATE TABLE account_deletions(user_id uuid PRIMARY KEY REFERENCES users, requested_at timestamptz NOT NULL DEFAULT now(), provider_deleted_at timestamptz);
INSERT INTO schema_migrations VALUES(4);
