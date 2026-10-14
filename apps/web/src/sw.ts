/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { createHandlerBoundToURL } from "workbox-precaching";
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any[] };
self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//],
  }),
);
self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("push", (e) => {
  e.waitUntil(
    (async () => {
      let p: any;
      try {
        p = e.data?.json();
      } catch {
        /* neutral fallback */
      }
      const valid =
        p?.schema === 1 &&
        typeof p.id === "string" &&
        /^[a-f0-9-]{36}$/.test(p.id) &&
        typeof p.tag === "string";
      const stale =
        !valid ||
        !Number.isFinite(Date.parse(p.expiresAt)) ||
        Date.parse(p.expiresAt) < Date.now();
      // The patient can choose to keep medicine names off the lock screen.
      const hidden = Boolean(
        await caches
          .open("prefs")
          .then((c) => c.match("/__prefs/hide-names"))
          .catch(() => undefined),
      );
      const detail =
        !stale &&
        !hidden &&
        typeof p.detail?.title === "string" &&
        typeof p.detail?.body === "string"
          ? p.detail
          : undefined;
      await self.registration.showNotification(
        stale
          ? "ยาของฉัน · แจ้งเตือนยา / Medication reminder"
          : detail
            ? detail.title.slice(0, 120)
            : p.title !== "แจ้งเตือนยา"
              ? "Medication reminder"
              : "แจ้งเตือนยา",
        {
          body: stale
            ? "เปิดแอปเพื่อตรวจสอบรายการยาปัจจุบัน / Open to review your current medicines"
            : detail
              ? detail.body.slice(0, 1000)
              : p.title === "แจ้งเตือนยา"
                ? "เปิดแอปเพื่อตรวจสอบรายการยา"
                : "Open to review your current medication schedule",
          tag: valid ? p.tag : "medication-neutral",
          icon: "/icon-192.png",
          data: { path: valid ? "/#notification=" + p.id : "/" },
        },
      );
    })(),
  );
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const raw = e.notification.data?.path;
      const path =
        typeof raw === "string" && /^\/#notification=[a-f0-9-]{36}$/.test(raw)
          ? raw
          : "/";
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const c of windows) {
        const w = c as WindowClient;
        if (new URL(w.url).origin === self.location.origin) {
          await w.navigate(path);
          await w.focus();
          return;
        }
      }
      await self.clients.openWindow(path);
    })(),
  );
});
