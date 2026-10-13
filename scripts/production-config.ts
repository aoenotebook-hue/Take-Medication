import { createECDH, timingSafeEqual } from "node:crypto";
export function productionConfigErrors(
  env: Record<string, string | undefined>,
) {
  const errors: string[] = [];
  if (env.NODE_ENV !== "production") return errors;
  const required = [
    "PUBLIC_APP_URL",
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
    "PUSH_ENCRYPTION_KEY",
  ];
  if (env.VERCEL) required.push("CRON_SECRET");
  for (const name of required) {
    const value = env[name];
    if (
      !value ||
      /replace-with|your-project|your-owned-domain|runtime-user:password/i.test(
        value,
      )
    )
      errors.push(name + " is missing or a placeholder");
  }
  if (env.LOCAL_DEMO === "true")
    errors.push("LOCAL_DEMO is forbidden in production");
  if (env.PUSH_ADAPTER === "simulated")
    errors.push("PUSH_ADAPTER must be webpush in production");
  if (env.VERCEL && env.CRON_SECRET && env.CRON_SECRET.length < 32)
    errors.push("CRON_SECRET must contain at least 32 characters");
  for (const name of ["PUBLIC_APP_URL", "SUPABASE_URL"])
    if (env[name]) {
      try {
        const url = new URL(env[name]);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          (name === "PUBLIC_APP_URL" &&
            (url.pathname !== "/" || url.search || url.hash))
        )
          errors.push(name + " must be an HTTPS origin");
      } catch {
        errors.push(name + " is invalid");
      }
    }
  if (env.DATABASE_URL) {
    try {
      const u = new URL(env.DATABASE_URL);
      if (!["postgres:", "postgresql:"].includes(u.protocol))
        errors.push("DATABASE_URL must use PostgreSQL");
    } catch {
      errors.push("DATABASE_URL is invalid");
    }
  }
  if (
    env.PUSH_ENCRYPTION_KEY &&
    Buffer.from(env.PUSH_ENCRYPTION_KEY, "base64").length !== 32
  )
    errors.push("PUSH_ENCRYPTION_KEY must encode 32 bytes");
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    try {
      const privateKey = Buffer.from(env.VAPID_PRIVATE_KEY, "base64url"),
        publicKey = Buffer.from(env.VAPID_PUBLIC_KEY, "base64url");
      const curve = createECDH("prime256v1");
      if (privateKey.length !== 32 || publicKey.length !== 65)
        throw new Error();
      curve.setPrivateKey(privateKey);
      if (!timingSafeEqual(curve.getPublicKey(), publicKey)) throw new Error();
    } catch {
      errors.push("VAPID keys are invalid or do not match");
    }
  }
  if (
    env.VAPID_SUBJECT &&
    !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(env.VAPID_SUBJECT)
  )
    errors.push("VAPID_SUBJECT must be a contact mailto or HTTPS URL");
  const freshness = Number(env.REMINDER_FRESHNESS_SECONDS || 900);
  if (!Number.isInteger(freshness) || freshness < 1 || freshness > 86400)
    errors.push("REMINDER_FRESHNESS_SECONDS is invalid");
  return [...new Set(errors)];
}
