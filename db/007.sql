CREATE TABLE scheduler_runs(id text PRIMARY KEY, lease_owner uuid NOT NULL, lease_until timestamptz NOT NULL);
CREATE TABLE scheduler_scans(medication_id uuid PRIMARY KEY REFERENCES medications ON DELETE CASCADE, checked_at timestamptz NOT NULL);
CREATE TABLE api_rate_limits(bucket text NOT NULL, key_hash text NOT NULL, hits integer NOT NULL, reset_at timestamptz NOT NULL, PRIMARY KEY(bucket,key_hash));
CREATE INDEX api_rate_limits_expiry ON api_rate_limits(reset_at);

-- The API owns authorization. Supabase REST/GraphQL clients must never bypass it.
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['schema_migrations','users','patients','memberships','medications','regimen_versions','regimen_supersessions','dose_occurrences','dose_events','devices','push_subscriptions','reminder_preferences','reminder_jobs','push_attempts','snoozes','invitations','photos','sync_operations','change_feed','audit_events','worker_health','account_deletions','push_observations','schedule_issues','scheduler_runs','scheduler_scans','api_rate_limits'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r);
      END IF;
    END LOOP;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['push_attempts_id_seq','change_feed_cursor_seq','audit_events_id_seq'] LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC',t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM %I',t,r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
INSERT INTO schema_migrations VALUES(7);
