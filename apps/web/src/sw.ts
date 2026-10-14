/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { createHandlerBoundToURL } from "workbox-precaching";
import { vibrations } from "./alert";
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
      const noVibrate = Boolean(
        await caches
          .open("prefs")
          .then((c) => c.match("/__prefs/no-vibrate"))
          .catch(() => undefined),
      );
      const th = p?.title === "แจ้งเตือนยา";
      const snooze = p?.snooze === true;
      const reminder = valid && !stale && typeof p.detail === "object";
      // Phones that support buttons on notifications get quick replies
      // (Android shows two; iPhone shows none and opens the app instead).
      const actions = reminder
        ? [
            { action: "taken", title: th ? "✓ ได้รับยาแล้ว" : "✓ Taken" },
            {
              action: "snooze10",
              title: th ? "⏰ เตือนอีก 10 นาที" : "⏰ In 10 min",
            },
            {
              action: "snooze15",
              title: th ? "⏰ เตือนอีก 15 นาที" : "⏰ In 15 min",
            },
          ].slice(
            0,
            typeof Notification !== "undefined"
              ? Number((Notification as any).maxActions) || 0
              : 0,
          )
        : [];
      const options: any = {
        body: stale
          ? "เปิดแอปเพื่อตรวจสอบรายการยาปัจจุบัน / Open to review your current medicines"
          : detail
            ? detail.body.slice(0, 1000)
            : th
              ? "เปิดแอปเพื่อตรวจสอบรายการยา"
              : "Open to review your current medication schedule",
        tag: valid ? p.tag : "medication-neutral",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { path: valid ? "/#notification=" + p.id : "/", id: p?.id },
        ...(actions.length ? { actions } : {}),
        // Ring and vibrate again for a repeat; stay on screen until answered.
        renotify: valid,
        requireInteraction: reminder,
        silent: false,
      };
      if (!noVibrate)
        options.vibrate = vibrations[snooze ? "snooze" : "reminder"];
      await self.registration.showNotification(
        stale
          ? "ยาของฉัน · แจ้งเตือนยา / Medication reminder"
          : detail
            ? detail.title.slice(0, 120)
            : th
              ? "แจ้งเตือนยา"
              : "Medication reminder",
        options,
      );
      // An open app plays its own sound and shows the answer buttons.
      if (valid && !stale) {
        const windows = await self.clients.matchAll({ type: "window" });
        for (const c of windows)
          c.postMessage({ type: "reminder", id: p.id, snooze });
      }
    })(),
  );
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const raw = e.notification.data?.path;
      let path =
        typeof raw === "string" && /^\/#notification=[a-f0-9-]{36}$/.test(raw)
          ? raw
          : "/";
      // A quick-reply button opens the app, which records the answer.
      if (path !== "/" && ["taken", "snooze10", "snooze15"].includes(e.action))
        path += "&do=" + e.action;
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
