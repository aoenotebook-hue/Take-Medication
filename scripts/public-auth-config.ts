export const selectedSupabaseUrl = "https://qfiplelamyjwvexosmii.supabase.co";

export function publicAuthConfig(env: Record<string, string | undefined>) {
  const first = (...names: string[]) =>
    names.map((name) => env[name]?.trim()).find(Boolean);
  const url =
    first(
      "VITE_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "PUBLIC_SUPABASE_URL",
      "SUPABASE_URL",
    ) || selectedSupabaseUrl;
  const key = first(
    "VITE_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
  );
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("Supabase frontend URL must be an HTTPS origin");
  if (!key)
    throw new Error(
      "Missing public Supabase key: set Production VITE_SUPABASE_ANON_KEY in Vercel, then redeploy",
    );
  let publicKey = key.startsWith("sb_publishable_");
  if (key.split(".").length === 3) {
    try {
      const claims = JSON.parse(
        Buffer.from(key.split(".")[1], "base64url").toString(),
      );
      publicKey = claims.role === "anon";
    } catch {
      publicKey = false;
    }
  }
  if (!publicKey)
    throw new Error(
      "Frontend requires a public publishable or anon key; secret/service-role keys are forbidden",
    );
  return { url: parsed.origin, key };
}
