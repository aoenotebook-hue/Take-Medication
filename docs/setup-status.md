# Setup status and remaining owner steps

Last updated: 13 October 2026.

## Already done

- **Supabase database** (`qfiplelamyjwvexosmii`): migrations 001–008 applied, RLS enabled on every app
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

### 2. Sign-in: phone number + 4-digit PIN

Patients register with their phone number and choose their own 4-digit PIN. No email or SMS
is sent, so no SMTP or email template setup is needed. The server stores only salted scrypt
hashes and locks a number for 15 minutes after 5 wrong PINs; each repeat lockout doubles the
wait, up to 24 hours. Logins are also limited to 20 attempts per 15 minutes per connection.

Optional: in Vercel add a `PIN_AUTH_SECRET` environment variable (a long random string) _before
anyone registers_. Without it, a key derived from `PUSH_ENCRYPTION_KEY` is used. Adding, changing
or removing `PIN_AUTH_SECRET`, or changing `PUSH_ENCRYPTION_KEY`, after people have registered
makes every existing PIN stop working.

Because every sign-in goes through the Vercel server, raise Supabase → Authentication →
Rate Limits → "sign-ups and sign-ins" if many people sign in at the same time.

**Security setting — do this once:** Supabase → Authentication → Sign In / Providers →
turn **off** "Allow new users to sign up" (keep the Email provider itself enabled). The app
creates accounts through its own server, so this does not affect registration. The API already
refuses any account that is not a phone + PIN account, and registration removes look-alike
accounts created directly with the public key; this setting also stops them being created.

**Clear all data** (Settings → ล้างข้อมูลทั้งหมด, owner only) permanently removes the patient's
medicines, dose history, allergies, photos and caregiver access, and starts an empty profile
with the same name. The phone number and PIN keep working.

**Unlock a number** (Supabase → SQL Editor):

```sql
update pin_credentials set failed_attempts = 0, locked_until = null where phone = '+66812345678';
```

**Forgotten PIN.** Check the person's identity first (in person or by a call you trust), then
run the following, with their number in the last line. It shows a one-time **reset code**:
give it to the person privately. They tap "ใช้ครั้งแรก? สมัครด้วยเบอร์โทร", enter the same
number and a new PIN; the app then asks for the reset code. Their medicine records stay.
The code works for 24 hours and is cancelled after 5 wrong tries. Running this also signs
the number out on every phone. Without the code nobody can take over the account, even
if they know the number.

```sql
with c as (select upper(substr(md5(gen_random_uuid()::text), 1, 8)) as code)
update pin_credentials
set pin_hash = 'reset:' || encode(sha256(convert_to((select code from c), 'UTF8')), 'hex'),
    failed_attempts = 0, locked_until = null, updated_at = now()
where phone = '+66812345678'
returning (select code from c) as reset_code;
```

Phone numbers are stored in international form: 081-234-5678 becomes `+66812345678`.

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
