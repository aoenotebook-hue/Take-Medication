-- Phone number + user-chosen 4-digit PIN sign-in. Only salted scrypt hashes are stored.
-- pin_hash NULL means an administrator reset the PIN; the owner sets a new one on next registration.
CREATE TABLE pin_credentials(phone text PRIMARY KEY, user_id uuid UNIQUE NOT NULL, pin_hash text, failed_attempts integer NOT NULL DEFAULT 0, lock_count integer NOT NULL DEFAULT 0, locked_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE pin_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pin_credentials FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.pin_credentials FROM %I',r);
    END IF;
  END LOOP;
END $$;
INSERT INTO schema_migrations VALUES(8);
