import { it, expect } from "vitest";
import webpush from "web-push";
import { randomBytes } from "node:crypto";
import { productionConfigErrors } from "../scripts/production-config";
function config() {
  const keys = webpush.generateVAPIDKeys();
  return {
    NODE_ENV: "production",
    LOCAL_DEMO: "false",
    PUSH_ADAPTER: "webpush",
    PUBLIC_APP_URL: "https://medication.test",
    DATABASE_URL: "postgres://runtime:synthetic@db/medication",
    SUPABASE_URL: "https://auth.test",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-unit-test-only",
    VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: "mailto:operator@test.invalid",
    PUSH_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  };
}
it("rejects an unconfigured production process without exposing values", () => {
  const errors = productionConfigErrors({ NODE_ENV: "production" });
  expect(errors).toContain("DATABASE_URL is missing or a placeholder");
  expect(errors).toContain(
    "SUPABASE_SERVICE_ROLE_KEY is missing or a placeholder",
  );
});
it("checks config format while leaving real credential verification to staging", () =>
  expect(productionConfigErrors(config())).toEqual([]));
it("rejects insecure origin and development adapters", () => {
  const c = config();
  const errors = productionConfigErrors({
    ...c,
    PUBLIC_APP_URL: "http://medication.test",
    LOCAL_DEMO: "true",
    PUSH_ADAPTER: "simulated",
  });
  expect(errors).toContain("PUBLIC_APP_URL must be an HTTPS origin");
  expect(errors).toContain("LOCAL_DEMO is forbidden in production");
  expect(errors).toContain("PUSH_ADAPTER must be webpush in production");
});
it("rejects mismatched VAPID and short encryption keys", () => {
  const c = config();
  const other = webpush.generateVAPIDKeys();
  expect(
    productionConfigErrors({ ...c, VAPID_PRIVATE_KEY: other.privateKey }),
  ).toContain("VAPID keys are invalid or do not match");
  expect(
    productionConfigErrors({ ...c, PUSH_ENCRYPTION_KEY: "AA==" }),
  ).toContain("PUSH_ENCRYPTION_KEY must encode 32 bytes");
});
it("requires a separate strong cron secret for the Vercel runtime", () => {
  expect(productionConfigErrors({ ...config(), VERCEL: "1" })).toContain(
    "CRON_SECRET is missing or a placeholder",
  );
  expect(
    productionConfigErrors({ ...config(), VERCEL: "1", CRON_SECRET: "short" }),
  ).toContain("CRON_SECRET must contain at least 32 characters");
  expect(
    productionConfigErrors({
      ...config(),
      VERCEL: "1",
      CRON_SECRET: randomBytes(32).toString("base64url"),
    }),
  ).toEqual([]);
});
