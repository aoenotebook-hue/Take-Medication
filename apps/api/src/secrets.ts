import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
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
