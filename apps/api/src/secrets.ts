import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
function key() {
  const k = process.env.PUSH_ENCRYPTION_KEY;
  if (!k) {
    if (process.env.NODE_ENV === "production")
      throw new Error("PUSH_ENCRYPTION_KEY required");
    return null;
  }
  const b = Buffer.from(k, "base64");
  if (b.length !== 32)
    throw new Error("PUSH_ENCRYPTION_KEY must encode 32 bytes");
  return b;
}
export function seal(value: any) {
  const k = key();
  if (!k) return { localUnencrypted: true, value };
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", k, iv);
  const bytes = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
  return {
    encrypted: true,
    iv: iv.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
    bytes: bytes.toString("base64"),
  };
}
export function unseal(value: any) {
  if (value.localUnencrypted) {
    if (process.env.NODE_ENV === "production")
      throw new Error("Unencrypted local subscription in production");
    return value.value;
  }
  if (!value.encrypted) {
    if (process.env.NODE_ENV === "production")
      throw new Error("Unencrypted subscription");
    return value;
  }
  const k = key();
  if (!k) throw new Error("Subscription encryption key unavailable");
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(value.iv, "base64"));
  d.setAuthTag(Buffer.from(value.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      d.update(Buffer.from(value.bytes, "base64")),
      d.final(),
    ]).toString(),
  );
}

/**
 * Compact encrypted token for short-lived links (compressed, then AES-GCM).
 * The content never appears in URLs or logs, and a forged or altered token
 * fails to open. Without a key (local development only) it is just compressed.
 */
export function sealToken(value: unknown): string {
  const raw = deflateRawSync(Buffer.from(JSON.stringify(value)));
  const k = key();
  if (!k) return "p" + raw.toString("base64url");
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", k, iv);
  const bytes = Buffer.concat([c.update(raw), c.final()]);
  return "e" + Buffer.concat([iv, c.getAuthTag(), bytes]).toString("base64url");
}
export function openToken(token: string): any {
  if (typeof token !== "string" || token.length < 2 || token.length > 40000)
    throw new Error("Invalid token");
  const body = Buffer.from(token.slice(1), "base64url");
  const k = key();
  let raw: Buffer;
  if (token[0] === "e" && k && body.length > 28) {
    const d = createDecipheriv("aes-256-gcm", k, body.subarray(0, 12));
    d.setAuthTag(body.subarray(12, 28));
    raw = Buffer.concat([d.update(body.subarray(28)), d.final()]);
  } else if (token[0] === "p" && !k && process.env.NODE_ENV !== "production")
    raw = body;
  else throw new Error("Invalid token");
  return JSON.parse(
    inflateRawSync(raw, { maxOutputLength: 300000 }).toString(),
  );
}
