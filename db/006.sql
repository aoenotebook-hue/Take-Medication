CREATE TABLE schedule_issues(medication_id uuid PRIMARY KEY REFERENCES medications,patient_id uuid REFERENCES patients,reason text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_migrations VALUES(6);
