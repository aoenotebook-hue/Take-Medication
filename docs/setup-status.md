# Setup status and remaining owner steps

Last updated: 13 October 2026.

## Already done

- **Supabase database** (`qfiplelamyjwvexosmii`): migrations 001–007 applied, RLS enabled on every app
  table with browser roles revoked (the API is the only way in), private `medication-photos` bucket
  (2 MB JPEG), restrictive storage policy, `immutable_rows()` search path pinned.
- **Vercel** (`aoe5/take-medication`): production environment variables present; functions pinned to
  `icn1` (Seoul) next to the database; production deployed from branch `claude/modest-feynman-62n4w4`.
- **Code fixes**: database TLS now trusts the Supabase root CA (every API call previously failed with
  500), DATE columns return as `YYYY-MM-DD` (the Today screen was always empty), and server errors log
  their error code.

## Steps only the owner can do

### 1. Merge the branch into `main`

Vercel deploys `main` automatically. Until the branch is merged, the next push to `main` would
redeploy the old, broken code.

### 2. Email sign-in (Supabase → Authentication)

1. **URL Configuration** → Site URL: `https://take-medication.vercel.app`.
2. **Emails → SMTP Settings**: enable custom SMTP (for example Resend, Brevo or Gmail SMTP). The
   built-in mailer only sends a few emails per hour, which is not enough for real patients.
3. **Emails → Templates** → *Magic Link* and *Confirm signup*: include the code so users can type it:

   ```html
   <h2>รหัสเข้าสู่ระบบ / Sign-in code</h2>
   <p style="font-size:28px;letter-spacing:4px"><strong>{{ .Token }}</strong></p>
   ```

4. Sign in with your own email at https://take-medication.vercel.app to confirm a code arrives.

### 3. Reminder scheduler (Supabase Cron)

Without this, the app works but no push reminders are sent.

1. In Vercel → Settings → Environment Variables, reveal and copy `CRON_SECRET`.
2. In Supabase → SQL Editor, run the following, pasting the secret where shown. Do not save the
   secret anywhere else.

   ```sql
   select vault.create_secret('https://take-medication.vercel.app', 'medication_app_url');
   select vault.create_secret('PASTE_CRON_SECRET_HERE', 'medication_cron_secret');
   ```

3. Then run the contents of [`deploy/supabase-cron.sql`](../deploy/supabase-cron.sql).
4. Check it after two minutes:

   ```sql
   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
   select status_code, created from net._http_response order by created desc limit 5;
   select * from worker_health;
   ```

   `status_code` should be `200`, and `worker_health.heartbeat` should update every minute.

### 4. Try it on the iPhone

Open the site in Safari → Share → Add to Home Screen → open from the new icon → Settings →
**Enable reminders** → **Send test notification** → **I saw the test notification**. See
[iphone-checklist.md](iphone-checklist.md) for the full test sheet.

### Before using real patient information

Review [known-issues.md](known-issues.md). A pharmacist or clinician should review the medicine
summary, and Thai-language wording and privacy (PDPA) obligations should be reviewed.
