import { expect, it } from "vitest";
import {
  publicAuthConfig,
  selectedSupabaseUrl,
} from "../scripts/public-auth-config";
const publishable = "sb_publishable_synthetic_public_key_for_tests";
const jwt = (role: string) =>
  "synthetic." +
  Buffer.from(JSON.stringify({ role })).toString("base64url") +
  ".signature";
it("maps standard integration variables to Vite's public authentication config", () => {
  expect(
    publicAuthConfig({
      NEXT_PUBLIC_SUPABASE_URL: selectedSupabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
    }),
  ).toEqual({ url: selectedSupabaseUrl, key: publishable });
  expect(publicAuthConfig({ SUPABASE_ANON_KEY: jwt("anon") })).toEqual({
    url: selectedSupabaseUrl,
    key: jwt("anon"),
  });
});
it("prioritizes explicitly configured Vite public values", () => {
  expect(
    publicAuthConfig({
      VITE_SUPABASE_ANON_KEY: publishable,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("anon"),
    }),
  ).toEqual({ url: selectedSupabaseUrl, key: publishable });
});
it("rejects missing keys without falling back to a privileged backend credential", () => {
  expect(() =>
    publicAuthConfig({ SUPABASE_SERVICE_ROLE_KEY: jwt("service_role") }),
  ).toThrow("Missing public Supabase key");
});
it("rejects privileged and malformed keys without disclosing their values", () => {
  for (const key of [
    "sb_secret_synthetic_backend_secret",
    jwt("service_role"),
    "synthetic.not-json.signature",
    "not-a-key",
  ]) {
    try {
      publicAuthConfig({ VITE_SUPABASE_ANON_KEY: key });
      throw new Error("Unexpectedly accepted");
    } catch (e: any) {
      expect(e.message).toContain("secret/service-role keys are forbidden");
      expect(e.message).not.toContain(key);
    }
  }
});
it("rejects insecure origins and embedded credentials", () => {
  for (const url of [
    "http://test.invalid",
    "https://user:password@test.invalid",
    "https://test.invalid/path",
  ])
    expect(() =>
      publicAuthConfig({
        VITE_SUPABASE_URL: url,
        VITE_SUPABASE_ANON_KEY: publishable,
      }),
    ).toThrow("HTTPS origin");
});
