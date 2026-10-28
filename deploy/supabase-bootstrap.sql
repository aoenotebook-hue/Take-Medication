-- Generated from db/001.sql through db/009.sql by npm run build:bootstrap.
-- Run in the selected Supabase project's SQL editor. No synthetic patient data is seeded.
-- Existing numbered migrations are skipped; failures roll back the entire transaction.
BEGIN;
SELECT pg_advisory_xact_lock(846101);
CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY);
DO $medication_bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=1) THEN
CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY);
CREATE TABLE users(id uuid PRIMARY KEY, display_name text NOT NULL DEFAULT '', language text NOT NULL DEFAULT 'th');
CREATE TABLE patients(id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users, version integer NOT NULL DEFAULT 1, data jsonb NOT NULL, deleted_at timestamptz);
CREATE TABLE memberships(patient_id uuid REFERENCES patients, user_id uuid REFERENCES users, role text NOT NULL CHECK(role IN ('owner','editor','viewer')), revoked_at timestamptz, PRIMARY KEY(patient_id,user_id));
CREATE TABLE medications(id uuid PRIMARY KEY, patient_id uuid NOT NULL REFERENCES patients, version integer NOT NULL DEFAULT 1, data jsonb NOT NULL, deleted_at timestamptz);
CREATE TABLE regimen_versions(id uuid PRIMARY KEY, patient_id uuid NOT NULL REFERENCES patients, medication_id uuid NOT NULL REFERENCES medications, version integer NOT NULL, effective_at timestamptz NOT NULL, data jsonb NOT NULL, actor_id uuid NOT NULL REFERENCES users, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(medication_id,version), UNIQUE(medication_id,effective_at));
CREATE TABLE dose_occurrences(id uuid PRIMARY KEY, patient_id uuid NOT NULL REFERENCES patients, medication_id uuid REFERENCES medications, regimen_id uuid REFERENCES regimen_versions, slot_id text NOT NULL, local_date date NOT NULL, local_time text NOT NULL, timezone text NOT NULL, intended_at timestamptz NOT NULL, data jsonb NOT NULL, valid boolean NOT NULL DEFAULT true, UNIQUE(regimen_id,slot_id,local_date));
CREATE TABLE dose_events(id uuid PRIMARY KEY, patient_id uuid REFERENCES patients, occurrence_id uuid REFERENCES dose_occurrences, medication_id uuid REFERENCES medications, actor_id uuid REFERENCES users, action text NOT NULL CHECK(action IN ('taken','skipped','undo','resolve','as-needed')), base_event_ids jsonb NOT NULL, actual_at timestamptz, client_at timestamptz NOT NULL, received_at timestamptz DEFAULT now(), data jsonb NOT NULL);
CREATE TABLE devices(id uuid PRIMARY KEY, user_id uuid REFERENCES users, label text NOT NULL, revoked_at timestamptz, last_seen timestamptz DEFAULT now());
CREATE TABLE push_subscriptions(id uuid PRIMARY KEY, device_id uuid REFERENCES devices, endpoint_hash text UNIQUE NOT NULL, data jsonb NOT NULL, disabled_at timestamptz);
CREATE TABLE reminder_preferences(patient_id uuid REFERENCES patients, device_id uuid REFERENCES devices, enabled boolean NOT NULL, PRIMARY KEY(patient_id,device_id));
CREATE TABLE reminder_jobs(id uuid PRIMARY KEY, patient_id uuid REFERENCES patients, subscription_id uuid REFERENCES push_subscriptions, group_key text NOT NULL, revision text NOT NULL, occurrence_ids jsonb NOT NULL, kind text NOT NULL DEFAULT 'routine', due_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, state text NOT NULL DEFAULT 'queued', attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, lease_owner uuid, retry_at timestamptz, UNIQUE(patient_id,subscription_id,group_key,revision,kind));
CREATE INDEX due_jobs ON reminder_jobs(state,due_at,retry_at);
CREATE INDEX patient_occurrences ON dose_occurrences(patient_id,intended_at);
CREATE INDEX patient_medications ON medications(patient_id);
CREATE TABLE push_attempts(id bigserial PRIMARY KEY, job_id uuid REFERENCES reminder_jobs, attempted_at timestamptz DEFAULT now(), state text NOT NULL, status_code integer);
CREATE TABLE snoozes(id uuid PRIMARY KEY, patient_id uuid REFERENCES patients, occurrence_id uuid REFERENCES dose_occurrences, actor_id uuid REFERENCES users, created_at timestamptz DEFAULT now());
CREATE TABLE invitations(id uuid PRIMARY KEY, patient_id uuid REFERENCES patients, token_hash text UNIQUE NOT NULL, recipient text NOT NULL, role text NOT NULL CHECK(role IN ('editor','viewer')), expires_at timestamptz NOT NULL, consumed_at timestamptz, revoked_at timestamptz);
CREATE TABLE photos(id uuid PRIMARY KEY, patient_id uuid REFERENCES patients, medication_id uuid REFERENCES medications, storage_key text NOT NULL, mime text NOT NULL, size integer NOT NULL, bytes bytea, created_at timestamptz DEFAULT now());
CREATE TABLE sync_operations(actor_id uuid REFERENCES users, id uuid, result jsonb NOT NULL, PRIMARY KEY(actor_id,id));
CREATE TABLE change_feed(cursor bigserial PRIMARY KEY, patient_id uuid REFERENCES patients, resource_id uuid NOT NULL, kind text NOT NULL, tombstone boolean NOT NULL DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE audit_events(id bigserial PRIMARY KEY, patient_id uuid REFERENCES patients, actor_id uuid REFERENCES users, action text NOT NULL, target_id uuid NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE worker_health(id text PRIMARY KEY, heartbeat timestamptz NOT NULL, horizon_at timestamptz);
CREATE FUNCTION immutable_rows() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only record'; END; $$;
CREATE TRIGGER immutable_regimens BEFORE UPDATE ON regimen_versions FOR EACH ROW EXECUTE FUNCTION immutable_rows();
CREATE TRIGGER immutable_doses BEFORE UPDATE ON dose_events FOR EACH ROW EXECUTE FUNCTION immutable_rows();
CREATE TRIGGER immutable_audit BEFORE UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION immutable_rows();
INSERT INTO schema_migrations VALUES(1);

  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=2) THEN
-- Metadata about supersession is separate from immutable regimen rows.
CREATE TABLE IF NOT EXISTS regimen_supersessions(regimen_id uuid PRIMARY KEY REFERENCES regimen_versions, replacement_id uuid REFERENCES regimen_versions, effective_at timestamptz NOT NULL);
INSERT INTO schema_migrations VALUES(2) ON CONFLICT DO NOTHING;

  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=3) THEN
ALTER TABLE sync_operations ADD COLUMN device_id uuid;
ALTER TABLE sync_operations ADD COLUMN client_at timestamptz;
ALTER TABLE dose_events ADD COLUMN device_id uuid;
INSERT INTO schema_migrations VALUES(3);

  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=4) THEN
CREATE TABLE account_deletions(user_id uuid PRIMARY KEY REFERENCES users, requested_at timestamptz NOT NULL DEFAULT now(), provider_deleted_at timestamptz);
INSERT INTO schema_migrations VALUES(4);

  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=5) THEN
CREATE TABLE push_observations(id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES reminder_jobs, actor_id uuid NOT NULL REFERENCES users, device_id uuid NOT NULL REFERENCES devices, kind text NOT NULL CHECK(kind IN ('opened','test-seen')), observed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(job_id,actor_id,device_id,kind));
INSERT INTO schema_migrations VALUES(5);

  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=6) THEN
CREATE TABLE schedule_issues(medication_id uuid PRIMARY KEY REFERENCES medications,patient_id uuid REFERENCES patients,reason text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_migrations VALUES(6);

  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=7) THEN
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

  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=8) THEN
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

  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=9) THEN
CREATE TABLE medication_information_matches(
  medication_id uuid PRIMARY KEY REFERENCES medications ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients ON DELETE CASCADE,
  identity_key text NOT NULL,
  card jsonb NOT NULL,
  actor_id uuid NOT NULL REFERENCES users,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX medication_information_patient ON medication_information_matches(patient_id);
ALTER TABLE medication_information_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE medication_information_matches FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.medication_information_matches FROM %I',r);
    END IF;
  END LOOP;
END $$;
INSERT INTO schema_migrations VALUES(9);

  END IF;
END $medication_bootstrap$;
-- Require API authorization for private photos even if another bucket uses broad policies.
DO $medication_storage$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL AND
     EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AND
     EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    DROP POLICY IF EXISTS medication_photos_api_only ON storage.objects;
    CREATE POLICY medication_photos_api_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
      USING(bucket_id<>'medication-photos') WITH CHECK(bucket_id<>'medication-photos');
  END IF;
END $medication_storage$;
COMMIT;
