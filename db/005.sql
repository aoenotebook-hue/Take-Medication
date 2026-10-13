CREATE TABLE push_observations(id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES reminder_jobs, actor_id uuid NOT NULL REFERENCES users, device_id uuid NOT NULL REFERENCES devices, kind text NOT NULL CHECK(kind IN ('opened','test-seen')), observed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(job_id,actor_id,device_id,kind));
INSERT INTO schema_migrations VALUES(5);
