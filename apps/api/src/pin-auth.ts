import {
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type pg from "pg";
import { HttpError } from "./service.js";

// Phone number + user-chosen 4-digit PIN. A PIN has only 10,000 values, so the
// protection is server-side: per-number lockout with escalating waits, per-IP
// rate limits, slow peppered hashes, and a Supabase password the user never sees.
const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const MAX_ATTEMPTS = 5;
const BASE_LOCK_MINUTES = 15;
const MAX_LOCK_MINUTES = 24 * 60;

/** Thai mobile/landline numbers ("081-234-5678", "+66 81 234 5678") or E.164. */
export function normalizePhone(input: string) {
  const raw = String(input || "").trim();
  const digits = raw.replace(/\D/g, "");
  let e164 = "";
  if (raw.startsWith("+")) e164 = "+" + digits;
  else if (/^0\d{8,9}$/.test(digits)) e164 = "+66" + digits.slice(1);
  else if (/^66\d{8,9}$/.test(digits)) e164 = "+" + digits;
  if (!/^\+[1-9]\d{7,14}$/.test(e164))
    throw new HttpError(422, "Invalid phone number");
  return e164;
}

/** Supabase accounts need an email; this address is never sent mail. */
export function phoneEmail(phone: string) {
  return (
    "p" +
    phone.replace(/\D/g, "") +
    "@" +
    (process.env.PHONE_LOGIN_EMAIL_DOMAIN ||
      "phone-login.take-medication.vercel.app")
  );
}

export function checkNewPin(pin: string) {
  if (!/^\d{4}$/.test(String(pin)))
    throw new HttpError(422, "PIN must be exactly 4 digits");
  const d = [...pin].map(Number);
  const step = d[1] - d[0];
  if (
    d.every((x) => x === d[0]) ||
    ((step === 1 || step === -1) && d.every((x, i) => x === d[0] + step * i))
  )
    throw new HttpError(422, "PIN is too easy to guess");
}

function secret() {
  const own = process.env.PIN_AUTH_SECRET;
  if (own) return Buffer.from(own);
  const fallback = process.env.PUSH_ENCRYPTION_KEY;
  if (!fallback) {
    if (process.env.NODE_ENV === "production")
      throw new HttpError(503, "PIN sign-in is not configured");
    return Buffer.from("local-development-only-pin-secret");
  }
  // Domain-separated key so this never equals the push encryption key itself.
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(fallback, "base64"),
      Buffer.alloc(0),
      "medication-pin-auth-v1",
      32,
    ),
  );
}

/** Strong Supabase password derived from the phone; only the server can compute it. */
export function providerPassword(phone: string) {
  return (
    createHmac("sha256", secret())
      .update("provider-password:" + phone)
      .digest("base64url") + "Aa1!"
  );
}

const pepper = (phone: string, pin: string) =>
  createHmac("sha256", secret())
    .update(phone + ":" + pin)
    .digest();

export async function hashPin(phone: string, pin: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(pepper(phone, pin), salt, 32, SCRYPT);
  return "scrypt$" + salt.toString("base64") + "$" + hash.toString("base64");
}

export async function pinMatches(phone: string, pin: string, stored: string) {
  const [kind, salt, hash] = String(stored || "").split("$");
  const expected = Buffer.from(hash || "", "base64");
  const actual = await scrypt(
    pepper(phone, String(pin)),
    Buffer.from(salt || "", "base64"),
    32,
    SCRYPT,
  );
  return (
    kind === "scrypt" &&
    expected.length === actual.length &&
    timingSafeEqual(expected, actual)
  );
}

/**
 * Checks a PIN with lockout. Run inside a transaction (the row lock serializes
 * concurrent guesses) and throw the returned error only after commit, so failed
 * attempts are recorded instead of rolled back.
 */
export async function verifyPinAttempt(
  c: pg.PoolClient,
  where: { phone: string } | { userId: string },
  pin: string,
): Promise<{ userId: string; phone: string } | { error: HttpError }> {
  const row = (
    await c.query(
      "phone" in where
        ? "SELECT * FROM pin_credentials WHERE phone=$1 FOR UPDATE"
        : "SELECT * FROM pin_credentials WHERE user_id=$1 FOR UPDATE",
      ["phone" in where ? where.phone : where.userId],
    )
  ).rows[0];
  // No PIN yet, or an administrator reset is pending ("reset:…").
  if (!row || !String(row.pin_hash || "").startsWith("scrypt$")) {
    // Same cost as a real check so timing does not reveal registered numbers.
    await hashPin("+0", "0000");
    return { error: new HttpError(401, "Wrong phone number or PIN") };
  }
  if (row.locked_until && row.locked_until > new Date())
    return {
      error: new HttpError(429, "Too many wrong PINs", {
        lockedUntil: row.locked_until,
      }),
    };
  if (await pinMatches(row.phone, pin, row.pin_hash)) {
    await c.query(
      "UPDATE pin_credentials SET failed_attempts=0,lock_count=0,locked_until=NULL,updated_at=now() WHERE phone=$1",
      [row.phone],
    );
    return { userId: row.user_id, phone: row.phone };
  }
  const failed = row.failed_attempts + 1;
  if (failed >= MAX_ATTEMPTS) {
    const minutes = Math.min(
      BASE_LOCK_MINUTES * 2 ** row.lock_count,
      MAX_LOCK_MINUTES,
    );
    await c.query(
      "UPDATE pin_credentials SET failed_attempts=0,lock_count=lock_count+1,locked_until=now()+($2*interval '1 minute'),updated_at=now() WHERE phone=$1",
      [row.phone, minutes],
    );
  } else
    await c.query(
      "UPDATE pin_credentials SET failed_attempts=$2,updated_at=now() WHERE phone=$1",
      [row.phone, failed],
    );
  return {
    error: new HttpError(401, "Wrong phone number or PIN", {
      attemptsLeft: Math.max(0, MAX_ATTEMPTS - failed),
    }),
  };
}
