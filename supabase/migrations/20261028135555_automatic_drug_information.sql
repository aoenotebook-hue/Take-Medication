CREATE TABLE medication_information_automatic(
 medication_id uuid PRIMARY KEY REFERENCES medications ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES patients ON DELETE CASCADE,
 identity_key text NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','matched','not-found','needs-review','unavailable')),
 card jsonb,
 checked_at timestamptz NOT NULL DEFAULT now(),
 retry_at timestamptz NOT NULL DEFAULT now(),
 mapping_id text
);
CREATE INDEX medication_information_automatic_patient ON medication_information_automatic(patient_id);
CREATE INDEX medication_information_automatic_retry ON medication_information_automatic(retry_at);
ALTER TABLE medication_information_automatic ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE medication_information_automatic FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON TABLE public.medication_information_automatic FROM %I',r);
  END IF;
 END LOOP;
END $$;
INSERT INTO schema_migrations VALUES(10);
