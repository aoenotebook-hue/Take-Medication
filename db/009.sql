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
