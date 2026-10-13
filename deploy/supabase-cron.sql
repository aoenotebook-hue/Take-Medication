-- Apply as the trusted database administrator after Vault secrets and the
-- production URL are configured. No tokens are embedded in cron.job.command.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='medication_app_url') OR
     NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='medication_cron_secret') THEN
    RAISE EXCEPTION 'Configure medication_app_url and medication_cron_secret in Vault first';
  END IF;
END $$;
SELECT cron.schedule('medication-reminders','* * * * *',
  $job$ SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='medication_app_url') || '/api/internal/reminders',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='medication_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ); $job$);
SELECT cron.schedule('medication-retention','*/15 * * * *',
  $job$ SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='medication_app_url') || '/api/internal/maintenance',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='medication_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ); $job$);
