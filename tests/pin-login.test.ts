import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { pool } from "../db/client";
import { createHash } from "node:crypto";
import { hashPin, providerPassword } from "../apps/api/src/pin-auth";

// A fake Supabase whose account for the phone was deleted in the dashboard.
const accounts = new Map<string, { id: string; password: string }>();
const calls: string[] = [];
vi.mock("../apps/api/src/auth", async (importOriginal) => {
  const real: any = await importOriginal();
  return {
    ...real,
    supabase: () => ({
      auth: {
        signInWithPassword: async ({ email, password }: any) => {
          calls.push("signIn");
          const a = accounts.get(email);
          return a && a.password === password
            ? {
                data: {
                  session: {
                    access_token: "access-" + a.id,
                    refresh_token: "refresh",
                    user: { id: a.id },
                  },
                },
                error: null,
              }
            : { data: { session: null }, error: { message: "Invalid login" } };
        },
        admin: {
          getUserById: async (id: string) => {
            calls.push("getUserById");
            const found = [...accounts.values()].some((a) => a.id === id);
            return { data: { user: found ? { id } : null }, error: null };
          },
          createUser: async (attrs: any) => {
            calls.push("createUser");
            accounts.set(attrs.email, {
              id: attrs.id,
              password: attrs.password,
            });
            return { data: { user: { id: attrs.id } }, error: null };
          },
          updateUserById: async (id: string, attrs: any) => {
            calls.push("updateUserById");
            accounts.set(attrs.email, { id, password: attrs.password });
            return { data: { user: { id } }, error: null };
          },
          deleteUser: async () => ({ error: null }),
        },
      },
    }),
  };
});
let server: Server, base: string;
const phone = "+66" + String(Date.now()).slice(-9);
const userId = randomUUID();
beforeAll(async () => {
  process.env.VITEST = "true";
  const { app } = await import("../apps/api/src/server");
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = "http://127.0.0.1:" + (server.address() as any).port;
  await pool.query(
    "INSERT INTO pin_credentials(phone,user_id,pin_hash) VALUES($1,$2,$3)",
    [phone, userId, await hashPin(phone, "2580")],
  );
});
afterAll(async () => {
  await pool.query("DELETE FROM pin_credentials WHERE phone=$1", [phone]);
  server?.close();
  await pool.end();
});
const login = (pin: string) =>
  fetch(base + "/api/auth/pin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, pin }),
  });
it("correct PIN restores a provider account deleted in the dashboard, keeping the same id", async () => {
  const r = await login("2580");
  expect(r.status).toBe(200);
  expect((await r.json()).user_id).toBe(userId);
  expect(calls).toEqual(["signIn", "getUserById", "createUser", "signIn"]);
  const restored = [...accounts.values()][0];
  expect(restored).toEqual({ id: userId, password: providerPassword(phone) });
});
it("wrong PIN never touches the provider account", async () => {
  calls.length = 0;
  expect((await login("1111")).status).toBe(401);
  expect(calls).toEqual([]);
});

const register = (pin: string, resetCode?: string) =>
  fetch(base + "/api/auth/pin/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, pin, resetCode }),
  });
it("after an administrator reset only the holder of the reset code can set a new PIN", async () => {
  const code = "A1B2C3D4";
  await pool.query(
    "UPDATE pin_credentials SET pin_hash=$2,updated_at=now() WHERE phone=$1",
    [phone, "reset:" + createHash("sha256").update(code).digest("hex")],
  );
  // The old PIN no longer works and the number cannot simply be re-registered.
  expect((await login("2580")).status).toBe(401);
  const without = await register("3691");
  expect(without.status).toBe(401);
  expect((await without.json()).current).toEqual({ resetCodeRequired: true });
  expect((await register("3691", "WRONG123")).status).toBe(401);
  const ok = await register("3691", code.toLowerCase());
  expect(ok.status).toBe(200);
  expect((await ok.json()).user_id).toBe(userId);
  expect((await login("3691")).status).toBe(200);
  // A reset done the old way (no code) never lets a stranger in.
  await pool.query("UPDATE pin_credentials SET pin_hash=NULL WHERE phone=$1", [
    phone,
  ]);
  const legacy = await register("4826");
  expect(legacy.status).toBe(409);
  expect((await legacy.json()).current).toEqual({ resetCodeRequired: true });
});
