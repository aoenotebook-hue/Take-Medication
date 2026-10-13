import webpush from "web-push";
export function validateEndpoint(endpoint: string) {
  const u = new URL(endpoint);
  const allowed = (
    process.env.PUSH_ALLOWED_HOSTS ||
    "web.push.apple.com,fcm.googleapis.com,updates.push.services.mozilla.com"
  ).split(",");
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !allowed.includes(u.hostname) ||
    u.hash
  )
    throw Object.assign(new Error("Unsupported push service endpoint"), {
      status: 422,
    });
}
export async function sendPush(subscription: any, payload: any, ttl: number) {
  validateEndpoint(subscription.endpoint);
  if (ttl <= 0) throw new Error("Expired push");
  if (process.env.PUSH_ADAPTER === "simulated") {
    if (process.env.NODE_ENV === "production")
      throw new Error("Simulated push forbidden in production");
    return { statusCode: 202, simulated: true };
  }
  if (
    !process.env.VAPID_PUBLIC_KEY ||
    !process.env.VAPID_PRIVATE_KEY ||
    !process.env.VAPID_SUBJECT
  )
    throw Object.assign(new Error("VAPID configuration missing"), {
      statusCode: 401,
    });
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  return webpush.sendNotification(subscription, JSON.stringify(payload), {
    TTL: ttl,
    urgency: "normal",
    timeout: 10000,
  });
}
