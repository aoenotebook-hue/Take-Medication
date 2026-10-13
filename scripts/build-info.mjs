import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
await writeFile(
  "dist/build-info.json",
  JSON.stringify({
    supabaseUrl: process.env.VITE_SUPABASE_URL || "",
    publicKeyHash: createHash("sha256")
      .update(process.env.VITE_SUPABASE_ANON_KEY || "")
      .digest("hex"),
  }) + "\n",
);
