import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "../db/client";
import {
  checkNewPin,
  hashPin,
  MAX_ATTEMPTS,
  normalizePhone,
  phoneEmail,
  pinMatches,
  providerPassword,
  verifyPinAttempt,
} from "../apps/api/src/pin-auth";
afterAll(async () => {
  await pool.end();
});
describe("phone + PIN sign-in", () => {
  it("normalizes Thai and international numbers", () => {
    expect(normalizePhone("081-234-5678")).toBe("+66812345678");
    expect(normalizePhone("02 123 4567")).toBe("+6621234567");
    expect(normalizePhone("+66 81 234 5678")).toBe("+66812345678");
    expect(normalizePhone("66812345678")).toBe("+66812345678");
    expect(normalizePhone("+1 (415) 555-0100")).toBe("+14155550100");
    for (const bad of ["", "12345", "0812", "abc", "+0123456789"])
      expect(() => normalizePhone(bad)).toThrow("Invalid phone number");
    expect(phoneEmail("+66812345678")).toMatch(/^p66812345678@/);
  });
  it("requires exactly four digits and rejects obvious PINs", () => {
    for (const ok of ["2580", "1357", "9024", "1123"])
      expect(() => checkNewPin(ok)).not.toThrow();
    for (const weak of ["0000", "7777", "1234", "4321", "6789", "3210"])
      expect(() => checkNewPin(weak)).toThrow("too easy");
    for (const bad of ["123", "12345", "12a4", ""])
      expect(() => checkNewPin(bad)).toThrow("exactly 4 digits");
  });
  it("stores only salted hashes bound to the phone number", async () => {
    const a = await hashPin("+66812345678", "2580");
    const b = await hashPin("+66812345678", "2580");
    expect(a).not.toContain("2580");
    expect(a).not.toBe(b);
    expect(await pinMatches("+66812345678", "2580", a)).toBe(true);
    expect(await pinMatches("+66812345678", "2581", a)).toBe(false);
    expect(await pinMatches("+66899999999", "2580", a)).toBe(false);
    expect(providerPassword("+66812345678")).not.toBe(
      providerPassword("+66899999999"),
    );
  });
  it("locks a number after repeated wrong PINs and records every failure", async () => {
    const phone = "+66" + String(Date.now()).slice(-9);
    const userId = randomUUID();
    await pool.query(
      "INSERT INTO pin_credentials(phone,user_id,pin_hash) VALUES($1,$2,$3)",
      [phone, userId, await hashPin(phone, "2580")],
    );
    const attempt = (pin: string) =>
      transaction((c) => verifyPinAttempt(c, { phone }, pin));
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const r: any = await attempt("1111");
      expect(r.error.status).toBe(401);
      expect(r.error.current.attemptsLeft).toBe(MAX_ATTEMPTS - i);
    }
    expect(((await attempt("1111")) as any).error.status).toBe(401);
    // Locked: even the correct PIN is refused until the wait ends.
    const locked: any = await attempt("2580");
    expect(locked.error.status).toBe(429);
    expect(
      new Date(locked.error.current.lockedUntil).getTime(),
    ).toBeGreaterThan(Date.now() + 14 * 60000);
    await pool.query(
      "UPDATE pin_credentials SET locked_until=now()-interval '1 second' WHERE phone=$1",
      [phone],
    );
    expect(await attempt("2580")).toEqual({ userId, phone });
    const row = (
      await pool.query("SELECT * FROM pin_credentials WHERE phone=$1", [phone])
    ).rows[0];
    expect(row.failed_attempts).toBe(0);
    expect(row.lock_count).toBe(0);
    // Unknown numbers and reset PINs fail like a wrong PIN.
    expect(
      (
        (await transaction((c) =>
          verifyPinAttempt(c, { phone: "+66800000001" }, "2580"),
        )) as any
      ).error.status,
    ).toBe(401);
    await pool.query("DELETE FROM pin_credentials WHERE phone=$1", [phone]);
  });
  it("escalates repeated lockouts", async () => {
    const phone = "+66" + String(Date.now() + 1).slice(-9);
    await pool.query(
      "INSERT INTO pin_credentials(phone,user_id,pin_hash,lock_count,failed_attempts) VALUES($1,$2,$3,2,$4)",
      [phone, randomUUID(), await hashPin(phone, "2580"), MAX_ATTEMPTS - 1],
    );
    await transaction((c) => verifyPinAttempt(c, { phone }, "1111"));
    const row = (
      await pool.query(
        "SELECT locked_until-now() AS wait FROM pin_credentials WHERE phone=$1",
        [phone],
      )
    ).rows[0];
    // Third lockout: 15 min × 2² = 60 minutes.
    expect(row.wait.hours ?? 0).toBe(0);
    expect(row.wait.minutes).toBeGreaterThanOrEqual(59);
    await pool.query("DELETE FROM pin_credentials WHERE phone=$1", [phone]);
  });
});
