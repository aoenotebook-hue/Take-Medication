import { createClient } from "@supabase/supabase-js";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import { HttpError } from "./service";
const demoKey = randomBytes(32);
export const demoEnabled = () =>
  process.env.LOCAL_DEMO === "true" && process.env.NODE_ENV !== "production";
export const supabase = () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new HttpError(503, "Managed authentication/storage not configured");
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
};
export async function demoToken() {
  return new SignJWT({ demo: true })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("11111111-1111-4111-a111-111111111111")
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(demoKey);
}
export async function authenticate(token: string) {
  if (!token) throw new HttpError(401, "Sign in required");
  if (demoEnabled()) {
    try {
      const p = (await jwtVerify(token, demoKey)).payload;
      if (p.demo && p.sub)
        return {
          id: p.sub,
          email: "demo@example.invalid",
          authTime: Date.now(),
        };
    } catch {
      /* managed token below */
    }
  }
  const { data, error } = await supabase().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sign in required");
  return {
    id: data.user.id,
    email: data.user.email || "",
    authTime: new Date(data.user.last_sign_in_at || 0).getTime(),
  };
}
