import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { registerSW } from "virtual:pwa-register";
import "@fontsource/noto-sans-thai/400.css";
import "./style.css";
import { words, type Language } from "../../../packages/ui/src/i18n";
import {
  profileSchema,
  medicationSchema,
  regimenSchema,
  projectDose,
  type Regimen,
} from "../../../packages/domain/src";
import { db, clearPrivate, localView, type Snapshot } from "./storage";
import {
  describe,
  disclaimer,
  exportPdf,
  font,
  summaryRows,
  summarySections,
} from "./pdf";
import {
  allergyLabel,
  day,
  formNames,
  productNames,
  statusLabel,
  weekdayNames,
  weekdaysText,
  when,
} from "./format";
import { preparePhoto } from "./photo";
import {
  alertUser,
  buzz,
  playChime,
  setAlertPrefs,
  soundOn,
  unlockAudio,
  vibrateOn,
} from "./alert";
import {
  commonMedicines,
  foodOptions,
  formForUnit,
  mealIcons,
  mealNames,
  mealOf,
  periodOf,
  mealTime,
  MEALS,
  readLabel,
  units,
  type Meal,
} from "./autofill";
import type { Operation } from "../../api/src/service";
registerSW({ immediate: true });
const auth =
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
    ? createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY,
      )
    : null;
let token = sessionStorage.getItem("demo-token") || "",
  actor = sessionStorage.getItem("actor") || "";
// One device id per account on this browser, so a second account never
// collides with (or takes over) the first account's reminder binding.
let deviceId = "";
function selectDevice(who: string) {
  const key = "device-id:" + who;
  let id = localStorage.getItem(key);
  if (!id) {
    // The first account keeps the id it registered before ids were per-account.
    id = localStorage.getItem("device-id") || crypto.randomUUID();
    localStorage.removeItem("device-id");
    localStorage.setItem(key, id);
  }
  deviceId = id;
}
// Bumped on sign-in, sign-out and data reset; late async results from an
// older generation must not touch state or private storage.
let generation = 0;
async function dropBrowserSubscription() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await (await reg?.pushManager?.getSubscription())?.unsubscribe();
  } catch {
    /* best effort */
  }
}
async function api(path: string, body?: any, method = body ? "POST" : "GET") {
  const headers: any = { Authorization: "Bearer " + token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch("/api" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: "Server unavailable" }));
    throw Object.assign(new Error(e.error), {
      status: r.status,
      current: e.current,
    });
  }
  return r.json();
}
let localSequence = Date.now() * 1000;
// Opened from a reminder: "#notification=<id>" plus an optional quick reply.
const NOTICE =
  /^#notification=([a-f0-9-]{36})(?:&do=(taken|snooze10|snooze15))?$/;
let notice: { id: string; action?: string } | undefined;
function readNotice() {
  const m = location.hash.match(NOTICE);
  if (m) notice = { id: m[1], action: m[2] };
}
readNotice();
unlockAudio();
// Android/Chrome offer an install prompt; keep it for the install button.
let installPrompt: any = null;
const installListeners = new Set<() => void>();
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  installListeners.forEach((f) => f());
});
const standalone = () =>
  matchMedia("(display-mode: standalone)").matches ||
  (navigator as any).standalone === true;
// Plain-language messages for validation and sign-in errors instead of raw JSON.
function friendlyError(e: any, lang: Language): string {
  const th = lang === "th";
  if (Array.isArray(e?.issues)) {
    const messages = e.issues.map((i: any) => {
      const key = i.path?.[0],
        sub = i.path?.[2];
      if (key === "name")
        return th ? "กรุณาใส่ชื่อยา" : "Enter the medicine name";
      if (key === "displayName")
        return th ? "กรุณาใส่ชื่อผู้ป่วย" : "Enter the patient name";
      if (key === "confirmed") return words[lang].statusHelp;
      if (key === "end")
        return th
          ? "วันสิ้นสุดต้องไม่ก่อนวันที่เริ่ม"
          : "End date cannot be before the start date";
      if (key === "start" || key === "dob")
        return th ? "วันที่ไม่ถูกต้อง" : "Invalid date";
      if (key === "effectiveAt")
        return th
          ? "วันที่และเวลาที่มีผลไม่ถูกต้อง"
          : "Invalid effective date and time";
      if (key === "timezone")
        return th ? "เขตเวลาไม่ถูกต้อง" : "Invalid timezone";
      if (key === "slots") {
        if (sub === "time")
          return th ? "กรุณาใส่เวลาให้ครบทุกช่อง" : "Enter every time";
        if (sub === "amount")
          return th
            ? "ปริมาณต้องเป็นตัวเลขมากกว่า 0 เช่น 1, 0.5 หรือ 1/2"
            : "Amount must be a positive number such as 1, 0.5 or 1/2";
        if (sub === "unit")
          return th
            ? "กรุณาใส่หน่วย เช่น เม็ด หรือ มล."
            : "Enter a unit such as tablet or mL";
        if (sub === "weekdays")
          return th ? "เลือกอย่างน้อย 1 วัน" : "Choose at least one day";
        return th
          ? "มีเวลาใช้ยาซ้ำกัน กรุณาตรวจสอบ"
          : "Two times are the same; please check";
      }
      return i.message;
    });
    return [...new Set(messages)].join(" · ");
  }
  const message = String(e?.message || e || "");
  const known: Record<string, [string, string]> = {
    "Medication changed": [
      "ข้อมูลยานี้ถูกแก้ไขจากอีกเครื่องหนึ่ง กรุณาตรวจสอบแล้วบันทึกใหม่",
      "This medicine was changed on another device. Please review and save again.",
    ],
    "Regimen changed": [
      "วิธีใช้ยานี้ถูกแก้ไขจากอีกเครื่องหนึ่ง กรุณาตรวจสอบแล้วบันทึกใหม่",
      "These instructions were changed on another device. Please review and save again.",
    ],
    "Profile changed": [
      "ข้อมูลผู้ป่วยถูกแก้ไขจากอีกเครื่องหนึ่ง กรุณาลองใหม่",
      "The profile was changed on another device. Please try again.",
    ],
    "Occurrence replaced or stopped": [
      "เวลาใช้ยานี้ถูกเปลี่ยนหรือหยุดแล้ว",
      "This dose time was changed or stopped.",
    ],
    "Snooze unavailable": [
      "เตือนซ้ำไม่ได้แล้ว (เกินเวลาหรือครบ 2 ครั้ง)",
      "Remind later is no longer available for this dose.",
    ],
    "Future dose cannot be confirmed": [
      "ยังไม่ถึงเวลา บันทึกได้เมื่อถึงเวลา",
      "It is not time yet; record it when it is time.",
    ],
    "Record the reason for this regimen change": [
      "กรุณาใส่เหตุผลที่แก้ไข",
      "Please enter a reason for the change.",
    ],
    "Photo is too large; choose a smaller image": [
      "รูปใหญ่เกินไป กรุณาเลือกรูปที่เล็กลง",
      "Photo is too large; choose a smaller image.",
    ],
    "Unsupported image; export photo as JPEG": [
      "ไม่รองรับรูปนี้ กรุณาใช้รูป JPEG",
      "Unsupported photo; use a JPEG image.",
    ],
    "Sign in again and confirm DELETE": [
      "เพื่อความปลอดภัย กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่ก่อนลบบัญชี",
      "For safety, sign out and sign in again before deleting the account.",
    ],
    "Access denied": [
      "ไม่มีสิทธิ์ทำรายการนี้",
      "You do not have permission to do this.",
    ],
    "Too many requests": [
      "ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
      "Too many attempts. Please wait a moment and try again.",
    ],
  };
  if (known[message]) return known[message][th ? 0 : 1];
  if (message === "Wrong phone number or PIN") {
    const left = e?.current?.attemptsLeft;
    return (
      (th ? "เบอร์โทรหรือรหัส 4 หลักไม่ถูกต้อง" : "Wrong phone number or PIN") +
      (left === undefined
        ? ""
        : left > 0
          ? th
            ? ` (ลองได้อีก ${left} ครั้ง)`
            : ` (${left} tries left)`
          : th
            ? " ระบบล็อกชั่วคราวเพื่อความปลอดภัย"
            : ". Locked for a while for safety.")
    );
  }
  if (message === "Too many wrong PINs") {
    const until = e?.current?.lockedUntil
      ? DateTime.fromISO(e.current.lockedUntil).toFormat("HH:mm")
      : "";
    return th
      ? `ใส่รหัสผิดหลายครั้ง ล็อกไว้ชั่วคราว ลองใหม่ได้หลังเวลา ${until} น.`
      : `Too many wrong PINs. Try again after ${until}.`;
  }
  if (message === "Invalid phone number")
    return th
      ? "เบอร์โทรไม่ถูกต้อง เช่น 081-234-5678"
      : "Invalid phone number, e.g. 081-234-5678";
  if (message === "PIN must be exactly 4 digits")
    return th ? "รหัสต้องเป็นตัวเลข 4 หลัก" : "The PIN must be 4 digits";
  if (message === "PIN is too easy to guess")
    return th
      ? "รหัสนี้เดาง่ายเกินไป เช่น 1234 หรือ 0000 กรุณาเลือกใหม่"
      : "That PIN is too easy to guess (like 1234 or 0000). Choose another.";
  if (message === "This phone number is already registered")
    return th
      ? "เบอร์นี้สมัครไว้แล้ว กรุณาเข้าสู่ระบบ"
      : "This number is already registered. Please sign in.";
  if (/sign-in service unavailable/i.test(message))
    return th
      ? "ระบบเข้าสู่ระบบขัดข้องชั่วคราว กรุณาลองใหม่"
      : "Sign-in is temporarily unavailable. Please try again.";
  if (/expired|invalid.*(otp|token)|token.*invalid/i.test(message))
    return th
      ? "รหัสไม่ถูกต้องหรือหมดอายุ กรุณาขอรหัสใหม่"
      : "The code is wrong or expired. Please request a new code.";
  if (/rate limit|security purposes|too many/i.test(message))
    return th
      ? "ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่"
      : "Too many requests. Please wait a minute and try again.";
  if (/failed to fetch|network|server unavailable/i.test(message))
    return th
      ? "เชื่อมต่ออินเทอร์เน็ตไม่ได้ กรุณาลองใหม่"
      : "Cannot connect. Please check the internet and try again.";
  return message;
}
function App() {
  const [lang, setLang] = useState<Language>(
      localStorage.getItem("language") === "en" ? "en" : "th",
    ),
    [tab, setTab] = useState("today"),
    [signed, setSigned] = useState(Boolean(token)),
    [patients, setPatients] = useState<any[]>([]),
    [patient, setPatient] = useState(""),
    [s, setS] = useState<Snapshot>(),
    [pending, setPending] = useState<any[]>([]),
    [localPhotos, setLocalPhotos] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [reachable, setReachable] = useState(false),
    [editing, setEditing] = useState<any>(),
    [detail, setDetail] = useState<any>(),
    [filter, setFilter] = useState("active"),
    [search, setSearch] = useState(""),
    [devices, setDevices] = useState<any[]>([]),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [registering, setRegistering] = useState(false),
    [pin2, setPin2] = useState(""),
    [seen, setSeen] = useState(false),
    [registered, setRegistered] = useState(false),
    [permission, setPermission] = useState(
      typeof Notification !== "undefined"
        ? Notification.permission
        : "unsupported",
    ),
    [large, setLarge] = useState(localStorage.getItem("large-text") === "1"),
    [hideNames, setHideNamesState] = useState(
      localStorage.getItem("hide-notification-names") === "1",
    ),
    [profileEdit, setProfileEdit] = useState(false),
    [caregiver, setCaregiver] = useState(false),
    [history, setHistory] = useState(false),
    [needsProfile, setNeedsProfile] = useState(false),
    [drafts, setDrafts] = useState<any[]>([]),
    [snoozing, setSnoozing] = useState(""),
    [medView, setMedViewState] = useState<"time" | "medicine">(
      localStorage.getItem("medicine-view") === "time" ? "time" : "medicine",
    ),
    [todayView, setTodayViewState] = useState<"time" | "medicine">(
      localStorage.getItem("today-view") === "medicine" ? "medicine" : "time",
    ),
    [prnFor, setPrnFor] = useState(""),
    [busy, setBusy] = useState(false);
  const t = words[lang];
  const L = (th: string, en: string) => (lang === "th" ? th : en);
  const setMedView = (mode: "time" | "medicine") => {
    setMedViewState(mode);
    localStorage.setItem("medicine-view", mode);
  };
  const setTodayView = (mode: "time" | "medicine") => {
    setTodayViewState(mode);
    localStorage.setItem("today-view", mode);
  };
  // The service worker reads this flag when a reminder arrives.
  async function setHideNames(hide: boolean) {
    setHideNamesState(hide);
    localStorage.setItem("hide-notification-names", hide ? "1" : "0");
    try {
      const c = await caches.open("prefs");
      if (hide) await c.put("/__prefs/hide-names", new Response("1"));
      else await c.delete("/__prefs/hide-names");
    } catch {
      /* no Cache Storage: reminders keep the default */
    }
  }
  const syncing = useRef(false);
  const patientRef = useRef(patient);
  patientRef.current = patient;
  const syncMessage = useRef("");
  const inFlight = useRef(new Set<string>());
  // Display clock: re-render so due doses unlock and "next" stays current.
  // It never schedules server reminders; it only opens the answer sheet.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  const [snoozeWindow, setSnoozeWindow] = useState(3600);
  const snoozeChoices = (o: any) =>
    [10, 15].filter(
      (minutes) =>
        Date.now() + minutes * 60000 <
        Date.parse(o.intended_at) + snoozeWindow * 1000,
    );
  // The reminder sheet: big answer buttons for the doses of one reminder.
  const [alertGroup, setAlertGroup] = useState<{
    ids: string[];
    snooze?: boolean;
    action?: string;
  }>();
  const [noticeTick, setNoticeTick] = useState(0);
  const [alertSound, setAlertSound] = useState(soundOn());
  const [alertVibrate, setAlertVibrate] = useState(vibrateOn());
  const syncAgain = useRef<string | undefined>(undefined);
  useEffect(() => {
    window.scrollTo(0, 0);
    if (tab === "settings" && token) reconcile().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.style.fontSize = large ? "24px" : "20px";
    localStorage.setItem("language", lang);
    localStorage.setItem("large-text", large ? "1" : "0");
  }, [lang, large]);
  async function loadDrafts(id = patient) {
    const scope = actor + ":" + id;
    setDrafts(
      (await db.drafts.toArray())
        .filter((d) => d.value?.scope === scope && d.value?.isNew)
        .sort((a, b) => b.value.savedAt - a.value.savedAt),
    );
  }
  async function loadLocal(id = patient) {
    if (!id) return;
    await loadDrafts(id);
    const cached = await db.snapshots.get(actor + ":" + id);
    if (cached) setS(cached.value);
    setLocalPhotos(
      (await db.photos.where("patientId").equals(id).toArray())
        .map((p) => ({
          id: p.id,
          medication_id: p.medicationId,
          pending: p.pending,
        }))
        .filter((p) => p.medication_id),
    );
    setPending(
      await db.outbox
        .where("actor")
        .equals(actor)
        .and((o) => o.patientId === id)
        .toArray(),
    );
  }
  async function sync(id = patient) {
    if (!id || !token) return;
    const started = generation,
      who = actor;
    // A result is still wanted only if the same account and session remain.
    const current = () => started === generation && who === actor;
    if (syncing.current) {
      syncAgain.current = id;
      return;
    }
    syncing.current = true;
    try {
      const ops = (
        await db.outbox
          .where("actor")
          .equals(actor)
          .and((o) => o.patientId === id && o.state === "queued")
          .toArray()
      ).sort(
        (a, b) =>
          (a.sequence || Date.parse(a.clientAt) * 1000) -
          (b.sequence || Date.parse(b.clientAt) * 1000),
      );
      for (let i = 0; i < ops.length; i += 50) {
        const results = (
          await api("/sync/push", { operations: ops.slice(i, i + 50) })
        ).results;
        for (const r of results) {
          if (r.status === "acknowledged") await db.outbox.delete(r.id);
          else
            await db.outbox.update(r.id, {
              state: r.status,
              error: r.error,
              current: r.current,
            });
        }
      }
      const photoQueue = await db.photos
        .where("patientId")
        .equals(id)
        .filter((p) => Boolean(p.pending) && p.actor === actor)
        .toArray();
      for (const p of photoQueue) {
        const response = await fetch(
          "/api/patients/" +
            id +
            "/photos?medicationId=" +
            p.medicationId +
            "&photoId=" +
            p.id,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": p.blob.type,
            },
            body: p.blob,
          },
        );
        if (!response.ok)
          throw Object.assign(
            new Error(
              (await response.json().catch(() => ({}))).error ||
                "Photo upload failed",
            ),
            { status: response.status },
          );
        await db.photos.update(p.id, { pending: false });
      }
      const snap = await api("/patients/" + id + "/snapshot");
      if (!current()) return;
      await db.snapshots.put({ key: who + ":" + id, value: snap });
      // Another patient may have been chosen while this request was running.
      if (patientRef.current === id) setS(snap);
      // The patient's language is only a default; a chosen display language stays.
      if (!localStorage.getItem("language-chosen"))
        setLang(snap.profile.data.language);
      setReachable(true);
      setMessage((m) => (m === syncMessage.current ? "" : m));
      const opaque = location.hash.match(NOTICE)?.[1];
      if (opaque) {
        api("/push/observations", {
          jobId: opaque,
          deviceId,
          kind: "opened",
        }).catch(() => {});
        window.history.replaceState(window.history.state, "", "/");
      }
      setPending(
        await db.outbox
          .where("actor")
          .equals(actor)
          .and((o) => o.patientId === id)
          .toArray(),
      );
      await font().catch(() =>
        setMessage(
          "PDF assets are not yet cached / ไฟล์ PDF ยังไม่พร้อมใช้ออฟไลน์",
        ),
      );
      for (const p of snap.photos) {
        if (!current()) return;
        if (!(await db.photos.get(p.id))) {
          const r = await fetch("/api/photos/" + p.id, {
            headers: { Authorization: "Bearer " + token },
          });
          if (r.ok && current())
            await db.photos.put({
              id: p.id,
              patientId: id,
              blob: await r.blob(),
            });
        }
      }
    } catch (e: any) {
      if (!current()) return;
      setReachable(false);
      let text: string;
      if (e.status === 403) {
        await clearPrivate();
        setS(undefined);
        setPatient("");
        text = L(
          "สิทธิ์การเข้าถึงถูกยกเลิก ลบข้อมูลในเครื่องแล้ว",
          "Access revoked. Local app data cleared.",
        );
      } else if (e.status === 401)
        text = L(
          "หมดเวลาการเข้าสู่ระบบ กรุณาออกจากระบบแล้วเข้าใหม่ (ข้อมูลที่ยังไม่ซิงค์ยังอยู่ในเครื่อง)",
          "Your session expired. Please sign in again (unsynced changes stay on this phone).",
        );
      else text = friendlyError(e, lang);
      syncMessage.current = text;
      setMessage(text);
    } finally {
      syncing.current = false;
      const next = syncAgain.current;
      syncAgain.current = undefined;
      if (next && token) void sync(next);
    }
  }
  async function afterLogin() {
    generation++;
    selectDevice(actor);
    const old = (await db.meta.get("actor"))?.value;
    if (old && old !== actor) await clearPrivate();
    await db.meta.put({ key: "actor", value: actor });
    setSigned(true);
    // Best effort: ask the browser not to evict offline medicine data.
    navigator.storage?.persist?.().catch(() => {});
    // Previously authorized cached data should open before a slow/offline network request.
    if (!location.hash.startsWith("#notification=")) {
      const cached = (await db.snapshots.toArray()).filter((c) =>
        c.key.startsWith(actor + ":"),
      );
      if (cached.length) {
        setPatients(
          cached.map((c) => ({
            id: c.value.profile.id,
            data: c.value.profile.data,
          })),
        );
        setPatient(cached[0].value.profile.id);
        await loadLocal(cached[0].value.profile.id);
      }
    }
    try {
      api("/push/config")
        .then(
          (c) =>
            c.snoozeWindowSeconds && setSnoozeWindow(c.snoozeWindowSeconds),
        )
        .catch(() => {});
      const list = await api("/patients");
      const cachedProfiles = await db.snapshots.toArray();
      if (
        cachedProfiles.some(
          (c) =>
            c.key.startsWith(actor + ":") &&
            !list.some((p: any) => p.id === c.value.profile.id),
        )
      ) {
        await clearPrivate();
        await db.meta.put({ key: "actor", value: actor });
      }
      setPatients(list);
      if (list.length) {
        let selected = list[0].id;
        const opaque = location.hash.match(NOTICE)?.[1];
        if (opaque) {
          try {
            const resolved = await api("/push/resolve/" + opaque);
            if (list.some((p: any) => p.id === resolved.patientId))
              selected = resolved.patientId;
          } catch (e: any) {
            setMessage(e.message);
          }
        }
        setPatient(selected);
        await loadLocal(selected);
        await sync(selected);
      } else setNeedsProfile(true);
    } catch (e: any) {
      const keys = await db.snapshots.toArray();
      const local = keys.filter((x) => x.key.startsWith(actor + ":"));
      setPatients(
        local.map((x) => ({
          id: x.value.profile.id,
          data: x.value.profile.data,
        })),
      );
      if (local.length) {
        setPatient(local[0].value.profile.id);
        await loadLocal(local[0].value.profile.id);
      } else setMessage(friendlyError(e, lang));
    }
  }
  useEffect(() => {
    if (auth) {
      auth.auth.getSession().then(({ data }) => {
        if (data.session) {
          token = data.session.access_token;
          actor = data.session.user.id;
          afterLogin();
        } else if (token) afterLogin();
      });
      const { data } = auth.auth.onAuthStateChange((event, session) => {
        if (session) {
          token = session.access_token;
          actor = session.user.id;
        } else if (event === "SIGNED_OUT" && actor) {
          // Session ended elsewhere (expired, revoked): remove private data.
          generation++;
          token = "";
          actor = "";
          clearPrivate().finally(() => {
            setSigned(false);
            setS(undefined);
            setPatient("");
          });
        }
      });
      return () => data.subscription.unsubscribe();
    }
    if (token) afterLogin();
  }, []);
  useEffect(() => {
    const f = () => {
      if (document.visibilityState === "visible") {
        sync();
        reconcile();
      }
    };
    const online = () => sync();
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", f);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", f);
    };
  }, [patient]);
  async function reconcile() {
    setSeen(Boolean((await db.meta.get("test-seen:" + deviceId))?.value));
    if (typeof Notification !== "undefined")
      setPermission(Notification.permission);
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager?.getSubscription();
      try {
        const bindings = await api("/devices");
        setRegistered(
          Boolean(
            sub &&
            bindings.some(
              (d: any) => d.id === deviceId && !d.revoked_at && !d.disabled_at,
            ),
          ),
        );
        if (
          sub &&
          Notification.permission === "granted" &&
          (await db.meta.get("reminders:" + actor + ":" + patient))?.value
        )
          await api("/push-subscriptions", {
            deviceId,
            patientId: patient,
            label: "My phone",
            consent: true,
            subscription: sub.toJSON(),
          });
      } catch (e: any) {
        // 409: revoked remotely or turned off; only a new Enable tap restores it.
        if (e.status === 409)
          await db.meta.delete("reminders:" + actor + ":" + patient);
        setRegistered(false);
      }
    }
    try {
      setDevices(await api("/devices"));
    } catch {
      /* offline */
    }
  }
  async function queue(
    kind: Operation["kind"],
    resourceId: string,
    baseVersion: number,
    data: any,
  ) {
    const op = {
      id: crypto.randomUUID(),
      deviceId,
      patientId: patient,
      resourceId,
      baseVersion,
      kind,
      clientAt: new Date().toISOString(),
      data,
      actor,
      state: "queued",
      sequence: (localSequence = Math.max(
        localSequence + 1,
        Date.now() * 1000,
      )),
    };
    try {
      await db.outbox.add(op);
      await loadLocal();
      await sync();
    } catch (e: any) {
      setMessage(
        L("บันทึกในเครื่องไม่สำเร็จ: ", "Storage failed: ") + e.message,
      );
      throw e;
    }
  }
  async function logout() {
    if (navigator.onLine) {
      try {
        await api("/devices/" + deviceId, undefined, "DELETE");
      } catch (e: any) {
        if (e.status !== 404 && e.status !== 401) {
          setMessage(e.message);
          return;
        }
      }
    } else {
      if (
        !confirm(
          L(
            "ออฟไลน์อยู่: จะยกเลิกการแจ้งเตือนของเครื่องนี้เมื่อเชื่อมต่ออีกครั้ง ระหว่างนี้อาจยังได้รับการแจ้งเตือนทั่วไป ต้องการออกจากระบบหรือไม่",
            "Offline sign-out: removing this device's reminders waits until you reconnect. Generic notifications may continue. Continue?",
          ),
        )
      )
        return;
      localStorage.setItem(
        "pending-revocation",
        JSON.stringify({ actor, deviceId }),
      );
    }
    generation++;
    await dropBrowserSubscription();
    await clearPrivate();
    if (auth) await auth.auth.signOut();
    sessionStorage.clear();
    token = "";
    actor = "";
    setSigned(false);
    setS(undefined);
    setPatient("");
  }
  useEffect(() => {
    if (!message.startsWith("✓")) return;
    const timer = setTimeout(() => setMessage(""), 6000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (!signed) return;
    let pendingRevocation: { actor?: string; deviceId?: string } = {};
    try {
      pendingRevocation = JSON.parse(
        localStorage.getItem("pending-revocation") || "{}",
      );
    } catch {
      localStorage.removeItem("pending-revocation");
    }
    // Only the account that signed out offline may finish its own revocation.
    if (pendingRevocation.deviceId && pendingRevocation.actor === actor)
      api("/devices/" + pendingRevocation.deviceId, undefined, "DELETE")
        .then(() => localStorage.removeItem("pending-revocation"))
        .catch((e) => {
          if (e.status === 404) localStorage.removeItem("pending-revocation");
        });
  }, [signed, reachable]);
  async function removeMedicine(m: any) {
    if (
      !confirm(
        L(
          "ลบ “" +
            m.data.name +
            "” ออกจากรายการ? (ถ้าแพทย์สั่งหยุดยา ให้เปิดข้อมูลยาแล้วกด “หยุดใช้ยา” แทน เพื่อเก็บประวัติให้แพทย์ดู)",
          "Delete “" +
            m.data.name +
            "”? (If the doctor stopped it, open it and use Stop instead so the doctor can see it.)",
        ),
      )
    )
      return false;
    try {
      await api(
        "/patients/" + patient + "/medications/" + m.id,
        undefined,
        "DELETE",
      );
      // Drop queued edits for the removed medicine.
      await db.outbox
        .filter((o) => o.resourceId === m.id || o.data?.medicationId === m.id)
        .delete();
      await db.drafts.delete(m.id);
      await sync();
      setMessage("✓ " + L("ลบแล้ว: ", "Deleted: ") + m.data.name);
      return true;
    } catch (e: any) {
      setMessage(
        friendlyError(e, lang) +
          L(
            " (การลบต้องเชื่อมต่ออินเทอร์เน็ต)",
            " (deleting needs an internet connection)",
          ),
      );
      return false;
    }
  }
  const view = s
    ? localView(
        s,
        pending.filter((o) => o.state === "queued"),
      )
    : undefined;
  if (view)
    view.photos.push(
      ...localPhotos.filter((p) => !view.photos.some((x) => x.id === p.id)),
    );
  const current = (med: string) =>
    view?.regimens
      .filter(
        (r) =>
          r.medication_id === med && Date.parse(r.effective_at) <= Date.now(),
      )
      .at(-1);
  const doseStatus = (o: any) =>
    projectDose(view?.events.filter((e) => e.occurrence_id === o.id) || [])
      .status;
  // Doses of the latest reminder time that are due now and not yet answered.
  const dueGroup = () => {
    const now = Date.now();
    const due = (view?.occurrences || []).filter(
      (o) =>
        o.valid &&
        Date.parse(o.intended_at) <= now + 120000 &&
        Date.parse(o.intended_at) > now - snoozeWindow * 1000 &&
        doseStatus(o) === "unconfirmed",
    );
    const latest = due
      .map((o) => o.intended_at)
      .sort()
      .at(-1);
    return due.filter((o) => o.intended_at === latest).map((o) => o.id);
  };
  const announced = (key: string) => {
    try {
      // Kept on this phone so a dose rings in the app only once.
      const seen = JSON.parse(localStorage.getItem("announced") || "[]");
      if (seen.includes(key)) return true;
      localStorage.setItem(
        "announced",
        JSON.stringify([...seen, key].slice(-50)),
      );
    } catch {
      /* private mode: may announce twice */
    }
    return false;
  };
  function openAlert(
    ids: string[],
    extra: { snooze?: boolean; action?: string } = {},
  ) {
    const first = view?.occurrences.find((o) => ids.includes(o.id));
    if (first) announced(patient + ":" + first.intended_at);
    setAlertGroup({ ids, ...extra });
  }
  async function snooze(o: any, minutes: number) {
    await queue("snooze", o.id, 0, { occurrenceId: o.id, minutes });
    setMessage(
      L(
        `⏰ จะเตือนอีกครั้งใน ${minutes} นาที`,
        `⏰ We will remind you again in ${minutes} minutes`,
      ),
    );
  }
  // A reminder arrived while the app is open: ring, vibrate and show the sheet.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "reminder" || typeof e.data.id !== "string") return;
      alertUser(e.data.snooze ? "snooze" : "reminder");
      notice = { id: e.data.id };
      setNoticeTick((n) => n + 1);
    };
    const onHash = () => {
      readNotice();
      setNoticeTick((n) => n + 1);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    window.addEventListener("hashchange", onHash);
    return () => {
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  // Opened from a reminder (or its quick-reply button): show that reminder.
  useEffect(() => {
    if (!notice || !view || !token || !patient) return;
    const n = notice;
    notice = undefined;
    api("/push/resolve/" + n.id)
      .then((r) => {
        if (r.patientId !== patientRef.current) {
          if (!patients.some((p) => p.id === r.patientId)) return;
          notice = n;
          setS(undefined);
          patientRef.current = r.patientId;
          setPatient(r.patientId);
          loadLocal(r.patientId).then(() => sync(r.patientId));
          return;
        }
        if (r.occurrenceIds?.length)
          openAlert(r.occurrenceIds, { snooze: r.snooze, action: n.action });
      })
      .catch(() => {
        // Offline: answer the latest due reminder saved on this phone.
        const ids = dueGroup();
        if (ids.length) openAlert(ids, { action: n.action });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noticeTick, Boolean(view), patient]);
  // The app is open when a dose becomes due: ring and show the sheet once.
  useEffect(() => {
    if (!view || alertGroup || document.visibilityState !== "visible") return;
    const ids = dueGroup().filter((id) => {
      const o = view.occurrences.find((x) => x.id === id);
      return o && Date.parse(o.intended_at) > Date.now() - 600000;
    });
    if (!ids.length) return;
    const first = view.occurrences.find((o) => o.id === ids[0]);
    if (announced(patient + ":" + first.intended_at)) return;
    alertUser("reminder");
    setAlertGroup({ ids });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, Boolean(view), patient]);
  // A quick reply from the notification: record it once the data is ready.
  useEffect(() => {
    const g = alertGroup;
    if (!g?.action || !view) return;
    setAlertGroup({ ...g, action: undefined });
    const open = g.ids
      .map((id) => view.occurrences.find((o) => o.id === id))
      .filter((o) => o && o.valid && doseStatus(o) === "unconfirmed");
    if (!open.length) return;
    (async () => {
      if (g.action === "taken") {
        for (const o of open) await dose(o, "taken");
        setMessage(L("✓ บันทึกว่าได้รับยาแล้ว", "✓ Recorded as taken"));
        setAlertGroup(undefined);
      } else {
        const minutes = g.action === "snooze15" ? 15 : 10;
        if (snoozeChoices(open[0]).includes(minutes)) {
          await snooze(open[0], minutes);
          setAlertGroup(undefined);
        }
      }
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertGroup, Boolean(view)]);
  async function dose(o: any, action: string) {
    // One recorded action per tap: ignore repeats while the first is saving.
    if (inFlight.current.has(o.id)) return;
    inFlight.current.add(o.id);
    try {
      await recordDose(o, action);
    } finally {
      inFlight.current.delete(o.id);
    }
  }
  async function recordDose(o: any, action: string) {
    const heads = projectDose(
      view!.events.filter((e) => e.occurrence_id === o.id),
    ).heads;
    if (
      action === "taken" &&
      Date.now() - Date.parse(o.intended_at) > 86400000 &&
      !confirm(
        L(
          "บันทึกย้อนหลังสำหรับ " +
            day(o.local_date, lang) +
            " " +
            o.local_time +
            " ใช่หรือไม่",
          "Backdated record for " +
            day(o.local_date, lang) +
            " " +
            o.local_time +
            "?",
        ),
      )
    )
      return;
    const med = view!.medications.find((m) => m.id === o.medication_id);
    await queue("dose", o.id, 0, {
      occurrenceId: o.id,
      medicationId: med.id,
      action,
      baseEventIds: heads,
      actualAt: action === "taken" ? new Date().toISOString() : undefined,
      backdateConfirmed: true,
    });
  }
  async function reminders() {
    try {
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        typeof Notification === "undefined"
      )
        throw new Error(
          L(
            "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน ",
            "This browser does not support reminders. ",
          ) + t.install,
        );
      if (/iPhone|iPad/.test(navigator.userAgent) && !standalone())
        throw new Error(t.install);
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted")
        throw new Error(
          L(
            "ไม่ได้รับอนุญาต เปิดได้ที่ การตั้งค่า → การแจ้งเตือน → ยาของฉัน บน iPhone",
            "Permission denied. Turn it on in iPhone Settings → Notifications → this app.",
          ),
        );
      const config = await api("/push/config");
      if (!config.publicKey)
        throw new Error(
          L(
            "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าการแจ้งเตือน",
            "Reminders are not configured on the server",
          ),
        );
      const reg = await navigator.serviceWorker.ready;
      const pad = config.publicKey.replace(/-/g, "+").replace(/_/g, "/");
      const key = Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        }));
      await api("/push-subscriptions", {
        deviceId,
        patientId: patient,
        label: "My phone",
        consent: true,
        explicit: true,
        subscription: sub.toJSON(),
      });
      await db.meta.put({
        key: "reminders:" + actor + ":" + patient,
        value: true,
      });
      setRegistered(true);
      setMessage(
        L(
          "เปิดการแจ้งเตือนแล้ว กด “ส่งการแจ้งเตือนทดสอบ” เพื่อทดลอง",
          "Reminders enabled. Tap “Send test notification” to try it.",
        ),
      );
      await reconcile();
    } catch (e: any) {
      setMessage(friendlyError(e, lang));
    }
  }
  function chooseLanguage(next: Language) {
    localStorage.setItem("language-chosen", "1");
    setLang(next);
    const v = s;
    if (v && v.role === "owner" && v.profile.data.language !== next)
      queue("profile", patient, v.profile.version, {
        ...v.profile.data,
        language: next,
      }).catch(() => {});
  }
  const languagePicker = (
    <div className="lang-toggle" role="group" aria-label={t.language}>
      {(
        [
          ["th", "ไทย"],
          ["en", "EN"],
        ] as const
      ).map(([code, label]) => (
        <button
          key={code}
          lang={code}
          aria-pressed={lang === code}
          onClick={() => chooseLanguage(code)}
        >
          {label}
        </button>
      ))}
    </div>
  );
  const pinInput = (name: string, label: string, isNew: boolean) => (
    <label>
      {label}
      <input
        name={name}
        type="password"
        required
        inputMode="numeric"
        pattern="[0-9]{4}"
        maxLength={4}
        minLength={4}
        autoComplete={isNew ? "new-password" : "current-password"}
        className="code-input"
        value={name === "pin2" ? pin2 : code}
        onChange={(e) =>
          (name === "pin2" ? setPin2 : setCode)(
            e.target.value.replace(/\D/g, "").slice(0, 4),
          )
        }
      />
    </label>
  );
  if (!signed)
    return (
      <main className="welcome">
        <div className="welcome-top">{languagePicker}</div>
        <div className="brand-mark" aria-hidden>
          ＋
        </div>
        <h1>{L("ยาของฉัน", "My Medicine")}</h1>
        <p className="lead">
          {L(
            "ช่วยจำเวลาใช้ยา เก็บรายการยา และแสดงให้แพทย์ดูได้ง่าย",
            "Remember medicine times, keep your medicine list, and show it to your doctor.",
          )}
        </p>
        {!auth && (
          <button
            className="primary"
            onClick={async () => {
              try {
                token = (await api("/demo", {})).token;
                actor = "11111111-1111-4111-a111-111111111111";
                sessionStorage.setItem("demo-token", token);
                sessionStorage.setItem("actor", actor);
                await afterLogin();
              } catch (e: any) {
                setMessage(friendlyError(e, lang));
              }
            }}
          >
            {t.demo}
          </button>
        )}
        {auth ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (registering && code !== pin2) {
                setMessage(
                  L(
                    "รหัส 4 หลักทั้งสองช่องไม่ตรงกัน",
                    "The two PINs do not match",
                  ),
                );
                return;
              }
              setBusy(true);
              try {
                const r = await api(
                  registering ? "/auth/pin/register" : "/auth/pin/login",
                  { phone: email, pin: code },
                );
                const { error } = await auth.auth.setSession({
                  access_token: r.access_token,
                  refresh_token: r.refresh_token,
                });
                if (error) throw error;
                token = r.access_token;
                actor = r.user_id;
                setCode("");
                setPin2("");
                setMessage("");
                await afterLogin();
              } catch (e: any) {
                setMessage(friendlyError(e, lang));
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>
              {registering
                ? L("สมัครใช้งานครั้งแรก", "Create your account")
                : L("เข้าสู่ระบบ", "Sign in")}
            </h2>
            <label>
              {L("เบอร์โทรศัพท์", "Phone number")}
              <input
                name="phone"
                type="tel"
                required
                autoComplete="username"
                inputMode="tel"
                placeholder="08x-xxx-xxxx"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {pinInput(
              "pin",
              registering
                ? L("ตั้งรหัส 4 หลักของคุณเอง", "Choose your own 4-digit PIN")
                : L("รหัส 4 หลัก", "4-digit PIN"),
              registering,
            )}
            {registering && (
              <>
                {pinInput(
                  "pin2",
                  L("ใส่รหัส 4 หลักอีกครั้ง", "Type the PIN again"),
                  true,
                )}
                <p className="hint">
                  {L(
                    "จดรหัสไว้ในที่ปลอดภัย ห้ามใช้ 1234, 0000 หรือเลขเรียงกัน",
                    "Keep it somewhere safe. Avoid 1234, 0000 or digits in a row.",
                  )}
                </p>
              </>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? t.loading
                : registering
                  ? L("สมัครและเข้าสู่ระบบ", "Create account")
                  : t.signIn}
            </button>
            <button
              type="button"
              onClick={() => {
                setRegistering(!registering);
                setCode("");
                setPin2("");
                setMessage("");
              }}
            >
              {registering
                ? L("มีบัญชีแล้ว? เข้าสู่ระบบ", "Already registered? Sign in")
                : L(
                    "ใช้ครั้งแรก? สมัครด้วยเบอร์โทร",
                    "First time? Register with your phone",
                  )}
            </button>
            {!registering && (
              <details className="about">
                <summary>{L("ลืมรหัส 4 หลัก?", "Forgot your PIN?")}</summary>
                <p>
                  {L(
                    "เพื่อความปลอดภัย แอปไม่ส่งรหัสทาง SMS หรืออีเมล กรุณาติดต่อผู้ดูแลระบบเพื่อรีเซ็ตรหัส แล้วกด “ใช้ครั้งแรก” เพื่อตั้งรหัสใหม่ด้วยเบอร์เดิม ข้อมูลยาเดิมจะยังอยู่",
                    "For safety, the app does not send codes by SMS or email. Ask the app administrator to reset your PIN, then tap “First time?” to set a new PIN with the same number. Your medicine records stay.",
                  )}
                </p>
              </details>
            )}
          </form>
        ) : (
          <p>
            {L(
              "ยังไม่ได้ตั้งค่าการเข้าสู่ระบบ โหมดทดลองใช้ข้อมูลสมมติเท่านั้น",
              "Managed sign-in requires Supabase configuration. Demo uses synthetic data only.",
            )}
          </p>
        )}
        {message && (
          <p role="alert" className="warning">
            {message}
          </p>
        )}
        <InstallGuide lang={lang} />
        <details className="about">
          <summary>
            {L("ความเป็นส่วนตัวและข้อจำกัด", "Privacy and limits")}
          </summary>
          <p>{t.privacy}</p>
        </details>
      </main>
    );
  if (needsProfile)
    return (
      <main className="welcome">
        <div className="welcome-top">{languagePicker}</div>
        <h1>{t.firstProfile}</h1>
        <p>{t.firstProfileHelp}</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const displayName = String(
              new FormData(e.currentTarget).get("displayName") || "",
            ).trim();
            if (!displayName) return;
            setBusy(true);
            try {
              const p = await api("/patients", { displayName });
              setPatients([{ id: p.id, data: { displayName } }]);
              setPatient(p.id);
              setNeedsProfile(false);
              await sync(p.id);
            } catch (e: any) {
              setMessage(friendlyError(e, lang));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {L("ชื่อผู้ป่วย", "Patient name")}
            <input name="displayName" required autoComplete="name" />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? t.loading : t.start2}
          </button>
        </form>
        <details className="about">
          <summary>
            {L(
              "เป็นผู้ดูแลและมีรหัสเชิญ?",
              "Caring for someone with an invitation code?",
            )}
          </summary>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await api("/invitations/accept", {
                  token: String(f.get("token") || "").trim(),
                  agreed: f.get("agreed") === "on",
                });
                const list = await api("/patients");
                setPatients(list);
                if (list.length) {
                  setNeedsProfile(false);
                  patientRef.current = list[0].id;
                  setPatient(list[0].id);
                  await sync(list[0].id);
                }
              } catch (err: any) {
                setMessage(friendlyError(err, lang));
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="hint">
              {L(
                "ไม่ต้องสร้างข้อมูลผู้ป่วยของตัวเอง ใส่รหัสที่ได้รับจากผู้ป่วยได้เลย",
                "No need to create your own patient profile; enter the code you received.",
              )}
            </p>
            <label>
              {L("รหัสเชิญ", "Invitation code")}
              <input name="token" required autoComplete="off" />
            </label>
            <label className="check">
              <input type="checkbox" name="agreed" required />
              {L(
                "ฉันยินยอมเข้าถึงข้อมูลของผู้ป่วยนี้",
                "I agree to access this patient's information",
              )}
            </label>
            <button disabled={busy}>
              {L("ยอมรับคำเชิญ", "Accept invitation")}
            </button>
          </form>
        </details>
        {message && (
          <p role="alert" className="warning">
            {message}
          </p>
        )}
      </main>
    );
  return (
    <>
      <header>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("today");
          }}
        >
          <span aria-hidden>💊</span> {L("ยาของฉัน", "My Medicine")}
        </a>
        {(pending.length > 0 || !reachable) && (
          <button
            className={"sync-chip " + (pending.length ? "pending" : "off")}
            onClick={() => setTab("settings")}
          >
            {pending.length ? "⏳ " + t.pending : "⚠ " + t.offline}
          </button>
        )}
        {languagePicker}
      </header>
      <main>
        <section className="identity">
          <span>{t.profile}</span>
          <strong>{view?.profile.data.displayName || "…"}</strong>
          {patients.length > 1 && (
            <label>
              {L("เลือกผู้ป่วย", "Choose patient")}
              <select
                value={patient}
                onChange={async (e) => {
                  setS(undefined);
                  patientRef.current = e.target.value;
                  setPatient(e.target.value);
                  await loadLocal(e.target.value);
                  await sync(e.target.value);
                }}
              >
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.data.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <small>
            {DateTime.now()
              .setZone(view?.profile.data.timezone || "Asia/Bangkok")
              .setLocale(lang)
              .toLocaleString(DateTime.DATE_HUGE)}
          </small>
          {view &&
            Intl.DateTimeFormat().resolvedOptions().timeZone !==
              view.profile.data.timezone && (
              <p className="warning">
                {L(
                  `เขตเวลาของโทรศัพท์ (${Intl.DateTimeFormat().resolvedOptions().timeZone}) ต่างจากตารางยา (${view.profile.data.timezone}) เวลาในแอปยังเป็นเวลาของตารางยา หากต้องการเปลี่ยนให้แก้ไขยาแต่ละรายการ`,
                  `Phone timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}) differs from the schedule (${view.profile.data.timezone}). Times stay in the schedule timezone; edit a medicine to change it.`,
                )}
              </p>
            )}
        </section>
        {view && tab === "today" && <InstallGuide lang={lang} />}
        {view?.scheduleIssues?.map((issue) => (
          <p key={issue.medication_id} className="warning">
            {L("ต้องตรวจสอบเวลาใช้ยา", "Schedule requires review")}:{" "}
            {
              view.medications.find((m) => m.id === issue.medication_id)?.data
                .name
            }{" "}
            · {issue.reason}
          </p>
        ))}
        {message && (
          <p
            role="alert"
            className={
              (message.startsWith("✓") ? "success" : "warning") + " dismissible"
            }
          >
            <span>{message}</span>
            <button
              onClick={() => setMessage("")}
              aria-label={L("ปิดข้อความ", "Dismiss message")}
            >
              ×
            </button>
          </p>
        )}
        {pending
          .filter((o) => o.state !== "queued")
          .map((o) => (
            <article className="warning" key={o.id}>
              <strong>{t.conflict}</strong>
              <p>{friendlyError({ message: o.error }, lang)}</p>
              <pre>{JSON.stringify(o.current?.data, null, 2)}</pre>
              <div className="actions">
                <button
                  onClick={async () => {
                    await db.outbox.delete(o.id);
                    await loadLocal();
                  }}
                >
                  {L("ยกเลิกการแก้ไขในเครื่องนี้", "Discard local proposal")}
                </button>
                <button
                  onClick={() => {
                    const m = view?.medications.find(
                      (m) => m.id === o.resourceId,
                    );
                    if (m) {
                      setEditing({
                        ...m,
                        proposed: o.kind === "regimen" ? o.data : undefined,
                        conflictOpId: o.id,
                      });
                    }
                  }}
                >
                  {L("ตรวจสอบข้อมูลทั้งสองแบบ", "Review current and proposal")}
                </button>
              </div>
            </article>
          ))}
        {!view ? (
          <p>{needsProfile ? "" : t.loading}</p>
        ) : tab === "today" ? (
          (() => {
            const statusOf = (o: any) =>
              projectDose(view.events.filter((e) => e.occurrence_id === o.id));
            const todays = view.occurrences
              .filter(
                (o) =>
                  o.valid &&
                  o.local_date ===
                    DateTime.now().setZone(o.timezone).toISODate(),
              )
              .sort(
                (a, b) => Date.parse(a.intended_at) - Date.parse(b.intended_at),
              );
            const done = todays.filter((o) =>
              ["taken", "skipped"].includes(statusOf(o).status),
            );
            const next = view.occurrences
              .filter(
                (o) =>
                  o.valid &&
                  Date.parse(o.intended_at) > Date.now() &&
                  statusOf(o).status === "unconfirmed",
              )
              .sort(
                (a, b) => Date.parse(a.intended_at) - Date.parse(b.intended_at),
              );
            const nextGroup = next.filter(
              (o) => o.intended_at === next[0]?.intended_at,
            );
            const takenAt = (o: any, heads: string[]) => {
              const e = view.events.find((e) => heads.includes(e.id));
              return e?.actual_at
                ? DateTime.fromISO(e.actual_at)
                    .setZone(o.timezone)
                    .toFormat("HH:mm")
                : "";
            };
            const row = (o: any, mode: "time" | "medicine") => {
              const m = view.medications.find((m) => m.id === o.medication_id),
                r = s?.regimens.find((r) => r.id === o.regimen_id),
                p = statusOf(o);
              if (!m) return null;
              const future = Date.parse(o.intended_at) > Date.now();
              const late = !future && p.status === "unconfirmed";
              const pendingRegimen = pending.some(
                (x) => x.kind === "regimen" && x.resourceId === m.id,
              );
              const locked = view.role === "viewer" || pendingRegimen;
              const done = ["taken", "skipped"].includes(p.status);
              return (
                <div
                  key={o.id}
                  className={
                    "dose-row status-" +
                    p.status +
                    " period-" +
                    periodOf(o.local_time) +
                    (late ? " late" : "")
                  }
                >
                  <div className="dose-main">
                    {mode === "medicine" && (
                      <Period time={o.local_time} lang={lang} showTime />
                    )}
                    <div className="dose-text">
                      {mode === "time" && (
                        <span className="dose-name">
                          <button
                            className="name-link"
                            onClick={() => setDetail(m)}
                          >
                            {m.data.name}
                            {m.data.strength ? " " + m.data.strength : ""}
                          </button>
                          <Speak text={m.data.name} lang={lang} />
                        </span>
                      )}
                      <span className="dose-what">
                        {o.data.amount} {o.data.unit}
                        {r?.data.food ? " · " + r.data.food : ""}
                      </span>
                      {late && (
                        <span className="late-text">
                          {L("เลยเวลาแล้ว", "Past time")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="dose-act">
                    {p.status === "unconfirmed" ? (
                      snoozing === o.id ? (
                        <div className="snooze">
                          <span>{t.snoozeChoose}</span>
                          {snoozeChoices(o).map((minutes) => (
                            <button
                              key={minutes}
                              onClick={async () => {
                                setSnoozing("");
                                await snooze(o, minutes);
                              }}
                            >
                              {minutes} {t.minutes}
                            </button>
                          ))}
                          <button onClick={() => setSnoozing("")}>
                            {t.cancel}
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            className="primary take"
                            disabled={future || locked}
                            onClick={() => dose(o, "taken")}
                          >
                            {future
                              ? "⏰ " + o.local_time
                              : "✓ " + t.takenStatus}
                          </button>
                          <span className="dose-links">
                            {!future && snoozeChoices(o).length > 0 && (
                              <button
                                className="link-button"
                                disabled={locked}
                                onClick={() => setSnoozing(o.id)}
                              >
                                {t.later}
                              </button>
                            )}
                            <button
                              className="link-button"
                              disabled={locked}
                              onClick={() => dose(o, "skipped")}
                            >
                              {t.skip}
                            </button>
                          </span>
                        </>
                      )
                    ) : p.status === "conflict" ? (
                      <div className="snooze">
                        <span>
                          {L(
                            "บันทึกจาก 2 เครื่องไม่ตรงกัน:",
                            "Two devices disagree:",
                          )}
                        </span>
                        {["taken", "skipped", "unconfirmed"].map((status) => (
                          <button
                            key={status}
                            disabled={view.role === "viewer"}
                            onClick={() =>
                              queue("dose", o.id, 0, {
                                occurrenceId: o.id,
                                medicationId: m.id,
                                action: "resolve",
                                status,
                                baseEventIds: p.heads,
                              })
                            }
                          >
                            {statusLabel(status, lang)}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <>
                        <span className={"done-badge " + p.status}>
                          {p.status === "taken" ? "✓ " : "– "}
                          {statusLabel(p.status, lang)}
                          {done && p.status === "taken"
                            ? " " + takenAt(o, p.heads)
                            : ""}
                        </span>
                        <button
                          className="link-button"
                          disabled={view.role === "viewer"}
                          onClick={() => dose(o, "undo")}
                        >
                          {L("แก้ไข", "Correct")}
                        </button>
                      </>
                    )}
                  </div>
                  {pendingRegimen && (
                    <p className="hint warn-text">{t.pending}</p>
                  )}
                </div>
              );
            };
            const byMedicine = [...new Set(todays.map((o) => o.medication_id))]
              .map((id) => view.medications.find((m) => m.id === id))
              .filter(Boolean)
              .sort((a: any, b: any) =>
                a.data.name.localeCompare(b.data.name, undefined, {
                  numeric: true,
                }),
              );
            const periods = MEALS.filter((p) =>
              todays.some((o) => periodOf(o.local_time) === p),
            );
            const prn = view.medications.filter(
              (m) => current(m.id)?.data.status === "as-needed",
            );
            return (
              <>
                <div className="heading">
                  <h1>{t.today}</h1>
                  <button onClick={() => setHistory(!history)}>
                    {t.history}
                  </button>
                </div>
                {(todays.length > 0 || nextGroup.length > 0) && (
                  <section className="next-dose" aria-label={t.nextDose}>
                    {nextGroup.length ? (
                      <>
                        <span>{t.nextDose}</span>
                        <strong className="next-time">
                          <span aria-hidden>
                            {mealIcons[periodOf(nextGroup[0].local_time)]}{" "}
                          </span>
                          {mealNames[lang][periodOf(nextGroup[0].local_time)]}{" "}
                          <small>{nextGroup[0].local_time}</small>
                          {nextGroup[0].local_date !==
                          DateTime.now()
                            .setZone(nextGroup[0].timezone)
                            .toISODate()
                            ? " · " + day(nextGroup[0].local_date, lang)
                            : ""}
                        </strong>
                        <span>
                          {DateTime.fromISO(nextGroup[0].intended_at)
                            .setLocale(lang)
                            .toRelative()}{" "}
                          ·{" "}
                          {nextGroup
                            .map(
                              (o) =>
                                view.medications.find(
                                  (m) => m.id === o.medication_id,
                                )?.data.name,
                            )
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      </>
                    ) : (
                      <strong>{t.noMore}</strong>
                    )}
                    <span className="progress">
                      {t.progress}: {done.length} / {todays.length}
                    </span>
                  </section>
                )}
                {todays.length > 0 && (
                  <div
                    className="segmented"
                    role="group"
                    aria-label={L("แสดงรายการ", "Show list")}
                  >
                    {(
                      [
                        ["time", L("ตามเวลา", "By time")],
                        ["medicine", L("ตามยา", "By medicine")],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        aria-pressed={todayView === mode}
                        onClick={() => setTodayView(mode)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {todayView === "time"
                  ? periods.map((period) => {
                      const list = todays.filter(
                        (o) => periodOf(o.local_time) === period,
                      );
                      const allDone = list.every((o) =>
                        ["taken", "skipped"].includes(statusOf(o).status),
                      );
                      return (
                        <section
                          key={period}
                          className={
                            "time-group period-group period-" +
                            period +
                            (allDone ? " all-done" : "")
                          }
                        >
                          <h2 className="group-head">
                            <span>
                              <span aria-hidden>{mealIcons[period]} </span>
                              {mealNames[lang][period]}{" "}
                              <small className="group-time">
                                {[
                                  ...new Set(list.map((o) => o.local_time)),
                                ].join(", ")}
                              </small>
                            </span>
                            {allDone && (
                              <span className="group-done">
                                ✓ {L("ครบแล้ว", "Done")}
                              </span>
                            )}
                          </h2>
                          {list.map((o) => row(o, "time"))}
                        </section>
                      );
                    })
                  : byMedicine.map((m: any) => (
                      <section key={m.id} className="time-group">
                        <h2 className="group-head">
                          <span className="dose-name">
                            <button
                              className="name-link"
                              onClick={() => setDetail(m)}
                            >
                              💊 {m.data.name}
                              {m.data.strength ? " " + m.data.strength : ""}
                            </button>
                            <Speak text={m.data.name} lang={lang} />
                          </span>
                        </h2>
                        {todays
                          .filter((o) => o.medication_id === m.id)
                          .map((o) => row(o, "medicine"))}
                      </section>
                    ))}
                {!todays.length && (
                  <div className="empty">
                    {view.medications.length ? (
                      <p>
                        {L(
                          "วันนี้ไม่มียาที่ต้องใช้ตามเวลา",
                          "No scheduled medicines today",
                        )}
                      </p>
                    ) : (
                      <>
                        <p>{t.empty}</p>
                        <button
                          className="primary"
                          onClick={() => setTab("medicines")}
                        >
                          ＋ {t.add}
                        </button>
                      </>
                    )}
                  </div>
                )}
                {prn.length > 0 && <h2>{t.prn}</h2>}
                {prn.map((m) => {
                  const last = view.events
                    .filter(
                      (e) =>
                        e.action === "as-needed" && e.medication_id === m.id,
                    )
                    .sort(
                      (a, b) =>
                        Date.parse(b.actual_at || b.client_at) -
                        Date.parse(a.actual_at || a.client_at),
                    )[0];
                  return (
                    <article key={m.id} className="medicine-card">
                      <h3 className="dose-name">
                        {m.data.name}
                        <Speak text={m.data.name} lang={lang} />
                      </h3>
                      <p>{current(m.id)?.data.instructions}</p>
                      {current(m.id)?.data.prnMaximum && (
                        <p className="muted">
                          {L("สูงสุด", "Maximum")}:{" "}
                          {current(m.id)?.data.prnMaximum}
                        </p>
                      )}
                      <p className="muted">
                        {t.lastUsed}:{" "}
                        {last
                          ? when(
                              last.actual_at || last.client_at,
                              lang,
                              view.profile.data.timezone,
                            )
                          : "—"}
                      </p>
                      {prnFor === m.id ? (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const value = String(
                              new FormData(e.currentTarget).get("at") || "",
                            );
                            const at = new Date(value);
                            if (
                              isNaN(at.getTime()) ||
                              at.getTime() > Date.now() + 60000
                            ) {
                              setMessage(
                                L(
                                  "เวลาไม่ถูกต้อง (ต้องไม่เป็นเวลาในอนาคต)",
                                  "Invalid time (cannot be in the future)",
                                ),
                              );
                              return;
                            }
                            setPrnFor("");
                            await queue("dose", m.id, 0, {
                              occurrenceId: null,
                              medicationId: m.id,
                              action: "as-needed",
                              baseEventIds: [],
                              actualAt: at.toISOString(),
                            });
                          }}
                        >
                          <label>
                            {t.whenTaken}
                            <input
                              type="datetime-local"
                              name="at"
                              required
                              defaultValue={DateTime.now().toFormat(
                                "yyyy-MM-dd'T'HH:mm",
                              )}
                            />
                          </label>
                          <div className="actions">
                            <button className="primary">{t.recordNow}</button>
                            <button type="button" onClick={() => setPrnFor("")}>
                              {t.cancel}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          disabled={view.role === "viewer"}
                          onClick={() => setPrnFor(m.id)}
                        >
                          {t.prnRecord}
                        </button>
                      )}
                    </article>
                  );
                })}
                {history && (
                  <section>
                    <h2>{t.history}</h2>
                    {[...view.events]
                      .sort(
                        (a, b) =>
                          Date.parse(b.actual_at || b.client_at) -
                          Date.parse(a.actual_at || a.client_at),
                      )
                      .slice(0, 100)
                      .map((e) => {
                        const occurrence = view.occurrences.find(
                          (o) => o.id === e.occurrence_id,
                        );
                        const med = view.medications.find(
                          (m) =>
                            m.id ===
                            (e.medication_id || occurrence?.medication_id),
                        );
                        return (
                          <p key={e.id} className="history-row">
                            <strong>{med?.data.name || "—"}</strong> ·{" "}
                            {e.action === "as-needed"
                              ? t.prn
                              : e.action === "undo"
                                ? L("ยกเลิกบันทึก", "Undone")
                                : e.action === "resolve"
                                  ? L("แก้ไขข้อขัดแย้ง", "Resolved")
                                  : statusLabel(e.action, lang)}{" "}
                            ·{" "}
                            {when(
                              e.actual_at || e.client_at,
                              lang,
                              view.profile.data.timezone,
                            )}
                            {occurrence
                              ? " (" +
                                L("นัดเวลา ", "scheduled ") +
                                occurrence.local_time +
                                ")"
                              : ""}
                            {e.pending
                              ? " · " + L("รอส่งขึ้นเซิร์ฟเวอร์", "pending")
                              : ""}
                          </p>
                        );
                      })}
                    {!view.events.length && <p>—</p>}
                    <p className="muted">
                      {L(
                        "การบันทึกเป็นข้อมูลที่ผู้ใช้รายงานเอง ไม่ได้พิสูจน์ว่าใช้ยาจริง",
                        "Self-reported records do not prove administration.",
                      )}
                    </p>
                  </section>
                )}
              </>
            );
          })()
        ) : tab === "medicines" ? (
          <>
            <div className="heading">
              <h1>{t.medicines}</h1>
              <button
                className="primary"
                disabled={view.role === "viewer"}
                onClick={() =>
                  setEditing({ id: crypto.randomUUID(), version: 0 })
                }
              >
                ＋ {t.add}
              </button>
            </div>
            {drafts
              .filter((d) => !view.medications.some((m) => m.id === d.id))
              .map((d) => (
                <article className="med-row draft-row" key={d.id}>
                  <button
                    className="med-row-main"
                    onClick={() => setEditing({ id: d.id, version: 0 })}
                  >
                    <strong>
                      📝{" "}
                      {d.value.m?.name ||
                        L("ยาที่ยังไม่ได้ตั้งชื่อ", "Unnamed medicine")}
                    </strong>
                    <span>
                      {L(
                        "ร่างที่ยังไม่บันทึก · แตะเพื่อทำต่อ",
                        "Unsaved draft · tap to continue",
                      )}
                    </span>
                  </button>
                  <div className="row-actions">
                    <button
                      className="edit-btn"
                      onClick={() => setEditing({ id: d.id, version: 0 })}
                    >
                      ✎ {L("ทำต่อ", "Continue")}
                    </button>
                    <button
                      className="edit-btn delete-btn"
                      onClick={async () => {
                        if (confirm(L("ทิ้งร่างนี้?", "Discard this draft?"))) {
                          await db.drafts.delete(d.id);
                          await loadDrafts();
                        }
                      }}
                    >
                      🗑 {L("ทิ้ง", "Discard")}
                    </button>
                  </div>
                </article>
              ))}
            {(() => {
              const rows = summaryRows(view);
              const info = (id: string) => {
                const r = rows.find((x) => x.medicine.id === id);
                return r
                  ? describe(r, lang, view.profile.data.timezone)
                  : undefined;
              };
              const edit = (m: any) =>
                view.role !== "viewer" && (
                  <div className="row-actions">
                    <button
                      className="edit-btn"
                      aria-label={L("แก้ไข ", "Edit ") + m.data.name}
                      onClick={() => setEditing(m)}
                    >
                      ✎ {L("แก้ไข", "Edit")}
                    </button>
                    <button
                      className="edit-btn delete-btn"
                      aria-label={L("ลบ ", "Delete ") + m.data.name}
                      onClick={() => removeMedicine(m)}
                    >
                      🗑 {L("ลบ", "Delete")}
                    </button>
                  </div>
                );
              const shown = view.medications
                .filter(
                  (m) =>
                    [m.data.name, m.data.brand, m.data.generic, m.data.purpose]
                      .join(" ")
                      .toLowerCase()
                      .includes(search.toLowerCase()) &&
                    (filter === "all" ||
                      (current(m.id)?.data.status || "draft") === filter),
                )
                .sort((a, b) =>
                  a.data.name.localeCompare(b.data.name, undefined, {
                    numeric: true,
                  }),
                );
              const schedule = view.medications
                .filter((m) => current(m.id)?.data.status === "active")
                .flatMap((m) =>
                  current(m.id)!.data.slots.map((slot: any) => ({ m, slot })),
                )
                .sort(
                  (a, b) =>
                    a.slot.time.localeCompare(b.slot.time) ||
                    a.m.data.name.localeCompare(b.m.data.name, undefined, {
                      numeric: true,
                    }),
                );
              return (
                <>
                  {view.medications.length > 0 && (
                    <div
                      className="segmented"
                      role="group"
                      aria-label={L("แสดงรายการ", "Show list")}
                    >
                      {(
                        [
                          ["medicine", L("ตามยา", "By medicine")],
                          ["time", L("ตารางเวลาแต่ละวัน", "Daily schedule")],
                        ] as const
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          aria-pressed={medView === mode}
                          onClick={() => setMedView(mode)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  {medView === "medicine" ? (
                    <>
                      {view.medications.length > 4 && (
                        <label>
                          {t.search}
                          <input
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </label>
                      )}
                      <div className="filters">
                        <select
                          aria-label={t.status}
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          {[
                            "active",
                            "as-needed",
                            "draft",
                            "paused",
                            "stopped",
                            "all",
                          ].map((x) => (
                            <option key={x} value={x}>
                              {(t as any)[x] || x}
                              {" ("}
                              {
                                view.medications.filter(
                                  (m) =>
                                    x === "all" ||
                                    (current(m.id)?.data.status || "draft") ===
                                      x,
                                ).length
                              }
                              {")"}
                            </option>
                          ))}
                        </select>
                      </div>
                      {shown.map((m) => {
                        const it = info(m.id);
                        const status = current(m.id)?.data.status || "draft";
                        return (
                          <article className="med-row" key={m.id}>
                            <button
                              className="med-row-main"
                              onClick={() => setDetail(m)}
                              aria-label={t.view + " " + m.data.name}
                            >
                              <strong>{it?.title || m.data.name}</strong>
                              {it && it.slots.length > 0 && (
                                <PeriodChips
                                  slots={it.slots}
                                  weekdays={it.weekdays}
                                  lang={lang}
                                />
                              )}
                              {it?.how && <span>{it.how}</span>}
                              {status !== "active" && (
                                <span className={"badge status-" + status}>
                                  {statusLabel(status, lang)}
                                </span>
                              )}
                            </button>
                            <Speak text={m.data.name} lang={lang} />
                            {edit(m)}
                          </article>
                        );
                      })}
                      {view.medications.length > 0 && !shown.length && (
                        <p className="muted">
                          {L(
                            "ไม่มียาในกลุ่มนี้ ลองเลือก “ทั้งหมด”",
                            "Nothing here. Try “All”.",
                          )}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      {MEALS.filter((p) =>
                        schedule.some((x) => periodOf(x.slot.time) === p),
                      ).map((period) => {
                        const list = schedule.filter(
                          (x) => periodOf(x.slot.time) === period,
                        );
                        const many =
                          new Set(list.map((x) => x.slot.time)).size > 1;
                        return (
                          <section
                            key={period}
                            className={
                              "time-group period-group period-" + period
                            }
                          >
                            <h2 className="group-head">
                              <span>
                                <span aria-hidden>{mealIcons[period]} </span>
                                {mealNames[lang][period]}
                              </span>
                            </h2>
                            {list.map(({ m, slot }) => (
                              <article
                                className={"med-row period-" + period}
                                key={m.id + slot.time}
                              >
                                <button
                                  className="med-row-main"
                                  onClick={() => setDetail(m)}
                                >
                                  <strong>
                                    {m.data.name}
                                    {m.data.strength
                                      ? " " + m.data.strength
                                      : ""}
                                  </strong>
                                  <span>
                                    {slot.amount} {slot.unit}
                                    {current(m.id)?.data.food
                                      ? " · " + current(m.id)?.data.food
                                      : ""}
                                    {slot.weekdays.length < 7
                                      ? " · " +
                                        weekdaysText(slot.weekdays, lang)
                                      : ""}
                                    {many ? " · " + slot.time : ""}
                                  </span>
                                </button>
                                <Speak text={m.data.name} lang={lang} />
                                {edit(m)}
                              </article>
                            ))}
                          </section>
                        );
                      })}
                      {!schedule.length && (
                        <p className="muted">
                          {L(
                            "ยังไม่มียาที่ใช้ตามเวลา",
                            "No medicines with set times yet",
                          )}
                        </p>
                      )}
                    </>
                  )}
                </>
              );
            })()}
            {!view.medications.length && (
              <div className="empty">
                {t.empty}
                <p>
                  {L(
                    "กด “＋ เพิ่มยา” ด้านบน ไม่จำเป็นต้องมีรูปถ่าย",
                    "Tap “＋ Add medicine” above. A photo is optional.",
                  )}
                </p>
              </div>
            )}
          </>
        ) : tab === "settings" ? (
          <>
            <div className="heading">
              <h1>{t.settings}</h1>
            </div>
            <section className="settings-group">
              <h3>{L("การซิงค์ข้อมูล", "Sync")}</h3>
              <p
                className={
                  "sync " +
                  (pending.length ? "pending" : reachable ? "ok" : "off")
                }
                role="status"
              >
                <span aria-hidden>
                  {pending.length ? "⏳ " : reachable ? "✓ " : "⚠ "}
                </span>
                {pending.length ? t.pending : reachable ? t.synced : t.offline}
              </p>
              <p className="muted">
                {L("ซิงค์ล่าสุด", "Last server sync")}:{" "}
                {when(view.serverAt, lang, view.profile.data.timezone)}
              </p>
              <button className="primary" onClick={() => sync()}>
                🔄 {t.sync}
              </button>
            </section>
            <section className="settings-group">
              <h3>{L("การแสดงผล", "Display")}</h3>
              <label className="check">
                <input
                  type="checkbox"
                  checked={large}
                  onChange={(e) => setLarge(e.target.checked)}
                />
                {t.largeText} / Large text
              </label>
            </section>
            <section className="settings-group">
              <h3>{t.remindersOn}</h3>
              <InstallGuide lang={lang} always />
              <ul className="checklist">
                {(
                  [
                    [
                      standalone(),
                      L("ติดตั้งบนหน้าจอโฮม", "Installed on Home Screen"),
                    ],
                    [
                      permission === "granted",
                      L("อนุญาตการแจ้งเตือน", "Notifications allowed") +
                        (permission === "denied"
                          ? L(
                              " (ถูกปฏิเสธ — เปิดในการตั้งค่า iPhone)",
                              " (denied — change in iPhone Settings)",
                            )
                          : ""),
                    ],
                    [
                      registered,
                      L(
                        "ลงทะเบียนกับเซิร์ฟเวอร์แล้ว",
                        "Registered with server",
                      ),
                    ],
                    [
                      seen,
                      L(
                        "ยืนยันว่าเห็นการแจ้งเตือนทดสอบ",
                        "Test notification seen",
                      ),
                    ],
                  ] as const
                ).map(([ok, label]) => (
                  <li key={label} className={ok ? "ok" : "todo"}>
                    <span aria-hidden>{ok ? "✓" : "○"}</span> {label}
                    <span className="sr-only">
                      {ok
                        ? L(" — เรียบร้อย", " — done")
                        : L(" — ยังไม่เสร็จ", " — not done")}
                    </span>
                  </li>
                ))}
              </ul>
              <button className="primary" onClick={reminders}>
                {t.enable}
              </button>
              <h4>{L("เสียงและการสั่น", "Sound and vibration")}</h4>
              <label className="check">
                <input
                  type="checkbox"
                  checked={alertSound}
                  onChange={(e) => {
                    setAlertSound(e.target.checked);
                    setAlertPrefs(e.target.checked, alertVibrate);
                  }}
                />
                {L(
                  "เล่นเสียงเตือนเฉพาะของแอป",
                  "Play the app's own reminder sound",
                )}
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={alertVibrate}
                  onChange={(e) => {
                    setAlertVibrate(e.target.checked);
                    setAlertPrefs(alertSound, e.target.checked);
                  }}
                />
                {L("สั่นเมื่อเตือน", "Vibrate with reminders")}
              </label>
              <div className="actions">
                <button
                  onClick={() => {
                    playChime("reminder", true);
                    buzz("reminder", true);
                  }}
                >
                  🔔 {L("ฟังเสียงเตือน", "Hear reminder sound")}
                </button>
                <button
                  onClick={() => {
                    playChime("snooze", true);
                    buzz("snooze", true);
                  }}
                >
                  ⏰ {L("ฟังเสียงเตือนซ้ำ", "Hear repeat sound")}
                </button>
              </div>
              <p className="hint">
                {L(
                  "เสียงเฉพาะของแอปจะดังเมื่อเปิดแอปอยู่ เมื่อปิดแอป โทรศัพท์จะใช้เสียงแจ้งเตือนของเครื่อง บน iPhone ตั้งเสียงและการสั่นได้ที่ การตั้งค่า → การแจ้งเตือน → ยาของฉัน (iPhone ไม่ให้เว็บแอปสั่นเองหรือมีปุ่มตอบบนการแจ้งเตือน แตะการแจ้งเตือนเพื่อเปิดปุ่มตอบขนาดใหญ่)",
                  "The app's own sound plays while the app is open. When it is closed, the phone uses its notification sound. On iPhone, set sound and vibration in Settings → Notifications → My Medicine (iPhone does not let web apps vibrate or show answer buttons on the notification; tap the notification to open the large answer buttons).",
                )}
              </p>
              <h4>{L("ความเป็นส่วนตัวของการแจ้งเตือน", "Reminder privacy")}</h4>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!hideNames}
                  onChange={(e) => setHideNames(!e.target.checked)}
                />
                {L(
                  "แสดงชื่อยาและเวลาในการแจ้งเตือน",
                  "Show medicine names and time in reminders",
                )}
              </label>
              <p className="hint">
                {L(
                  "การแจ้งเตือนอาจเห็นได้บนหน้าจอล็อก ปิดตัวเลือกนี้หากไม่ต้องการให้ผู้อื่นเห็นชื่อยา",
                  "Reminders can be seen on the lock screen. Turn this off to hide medicine names on this phone.",
                )}
              </p>
              {registered && (
                <button
                  onClick={async () => {
                    try {
                      await api("/reminder-preferences", {
                        deviceId,
                        patientId: patient,
                        enabled: false,
                      });
                      await db.meta.delete(
                        "reminders:" + actor + ":" + patient,
                      );
                      await reconcile();
                      setMessage(
                        L(
                          "✓ ปิดการแจ้งเตือนของผู้ป่วยนี้บนเครื่องนี้แล้ว",
                          "✓ Reminders for this patient are off on this phone",
                        ),
                      );
                    } catch (e: any) {
                      setMessage(friendlyError(e, lang));
                    }
                  }}
                >
                  🔕{" "}
                  {L(
                    "ปิดการแจ้งเตือนบนเครื่องนี้",
                    "Turn reminders off on this phone",
                  )}
                </button>
              )}
              <button
                onClick={async () => {
                  try {
                    const r = await api("/push/test", {
                      deviceId,
                      patientId: patient,
                    });
                    await db.meta.put({
                      key: "last-test:" + deviceId,
                      value: r.id,
                    });
                    setMessage(
                      L(
                        "ส่งการแจ้งเตือนทดสอบแล้ว หากเห็นบนโทรศัพท์ให้กด “ฉันเห็นการแจ้งเตือนทดสอบแล้ว”",
                        "Test sent. If it appears on your phone, tap “I saw the test notification”.",
                      ),
                    );
                  } catch (e: any) {
                    setMessage(friendlyError(e, lang));
                  }
                }}
              >
                {t.test}
              </button>
              <button
                onClick={async () => {
                  const job = (await db.meta.get("last-test:" + deviceId))
                    ?.value;
                  if (!job) {
                    setMessage(
                      L("กรุณาส่งการแจ้งเตือนทดสอบก่อน", "Send a test first"),
                    );
                    return;
                  }
                  try {
                    await api("/push/observations", {
                      jobId: job,
                      deviceId,
                      kind: "test-seen",
                    });
                    setSeen(true);
                    await db.meta.put({
                      key: "test-seen:" + deviceId,
                      value: new Date().toISOString(),
                    });
                  } catch (e: any) {
                    setMessage(friendlyError(e, lang));
                  }
                }}
              >
                {t.seen}
              </button>
              <p className="muted">
                {L(
                  "ไม่รับประกันเวลาแจ้งเตือนที่แน่นอน โหมดโฟกัส/ปิดเสียง และอินเทอร์เน็ตมีผลต่อการแสดงผล การบันทึกขณะออฟไลน์ยังหยุดการแจ้งเตือนจากเซิร์ฟเวอร์ไม่ได้ทันที",
                  "No exact-time guarantee. Focus/silent mode and connectivity affect display. Offline dose logs cannot immediately stop server reminders.",
                )}
              </p>
              {devices.length > 0 && (
                <>
                  <h4>{L("อุปกรณ์ที่ลงทะเบียน", "Registered devices")}</h4>
                  {devices.map((d) => (
                    <p key={d.id} className="device-row">
                      <span>
                        {d.label}
                        {d.id === deviceId
                          ? L(" (เครื่องนี้)", " (this device)")
                          : ""}{" "}
                        ·{" "}
                        {d.revoked_at
                          ? L("ยกเลิกแล้ว", "revoked")
                          : L("ใช้งานอยู่", "registered")}
                      </span>
                      {!d.revoked_at && (
                        <button
                          onClick={async () => {
                            await api("/devices/" + d.id, undefined, "DELETE");
                            await reconcile();
                          }}
                        >
                          {L("ยกเลิกอุปกรณ์", "Revoke")}
                        </button>
                      )}
                    </p>
                  ))}
                </>
              )}
            </section>
            <section className="settings-group">
              <h3>{L("ผู้ป่วยและผู้ดูแล", "Patient and caregivers")}</h3>
              <button onClick={() => setProfileEdit(true)}>
                {t.profile} / {t.allergy}
              </button>
              <button onClick={() => setCaregiver(true)}>{t.caregiver}</button>
            </section>
            <section className="settings-group">
              <h3>{L("ความเป็นส่วนตัวและข้อมูล", "Privacy and data")}</h3>
              <p className="muted">{t.privacy}</p>
              <button
                disabled={view.role !== "owner"}
                onClick={async () => {
                  try {
                    // Save the server's streamed file as-is; no parse/re-encode.
                    const r = await fetch("/api/account/export", {
                      method: "POST",
                      headers: {
                        Authorization: "Bearer " + token,
                        "Content-Type": "application/json",
                      },
                      body: "{}",
                    });
                    if (!r.ok)
                      throw Object.assign(
                        new Error(
                          (await r.json().catch(() => ({}))).error ||
                            "Export failed",
                        ),
                        { status: r.status },
                      );
                    const url = URL.createObjectURL(await r.blob());
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "medication-account.json";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                  } catch (e: any) {
                    setMessage(friendlyError(e, lang));
                  }
                }}
              >
                {t.export}
              </button>
            </section>
            <section className="settings-group">
              <h3>{L("ล้างข้อมูล / เริ่มใหม่", "Reset")}</h3>
              <button
                onClick={async () => {
                  if (
                    pending.length &&
                    !confirm(
                      L(
                        "มีการแก้ไขที่ยังไม่ซิงค์ " +
                          pending.length +
                          " รายการ ถ้าโหลดใหม่จะหายไป ต้องการทำต่อหรือไม่",
                        pending.length +
                          " unsynced change(s) will be lost. Continue?",
                      ),
                    )
                  )
                    return;
                  await Promise.all([
                    db.snapshots.clear(),
                    db.outbox.clear(),
                    db.drafts.clear(),
                    db.photos.clear(),
                  ]);
                  setPending([]);
                  setTab("today");
                  await sync();
                  setMessage(
                    L(
                      "✓ โหลดข้อมูลใหม่จากเซิร์ฟเวอร์แล้ว",
                      "✓ Reloaded from the server",
                    ),
                  );
                }}
              >
                🔄{" "}
                {L("โหลดข้อมูลใหม่จากเซิร์ฟเวอร์", "Reload data from server")}
              </button>
              <p className="hint">
                {L(
                  "ใช้เมื่อข้อมูลในเครื่องดูไม่ถูกต้อง ข้อมูลในบัญชีไม่หาย",
                  "Use if this phone looks wrong. Your account data stays.",
                )}
              </p>
              {view.role === "owner" && (
                <>
                  <button
                    className="danger"
                    onClick={async () => {
                      if (
                        !confirm(
                          L(
                            "ล้างข้อมูลทั้งหมดของ “" +
                              view.profile.data.displayName +
                              "”? จะลบ: รายการยา ประวัติการใช้ยา ประวัติแพ้ยา รูปถ่าย และสิทธิ์ของผู้ดูแล (บัญชีและเบอร์โทรยังใช้เข้าสู่ระบบได้)",
                            "Clear all data for “" +
                              view.profile.data.displayName +
                              "”? This removes medicines, dose history, allergies, photos and caregiver access (your sign-in stays).",
                          ),
                        ) ||
                        !confirm(
                          L(
                            "ยืนยันอีกครั้ง: ข้อมูลจะถูกลบถาวรและกู้คืนไม่ได้",
                            "Confirm again: the data is deleted permanently and cannot be recovered.",
                          ),
                        )
                      )
                        return;
                      try {
                        const r = await api("/patients/" + patient + "/clear", {
                          confirm: "CLEAR",
                        });
                        await clearPrivate();
                        await db.meta.put({ key: "actor", value: actor });
                        setTab("today");
                        setPending([]);
                        setS(undefined);
                        setPatients([
                          {
                            id: r.id,
                            data: { ...view.profile.data, allergies: [] },
                          },
                        ]);
                        setPatient(r.id);
                        await sync(r.id);
                        setMessage(
                          L(
                            "✓ ล้างข้อมูลทั้งหมดแล้ว เริ่มใหม่ได้เลย",
                            "✓ All data cleared. You can start again.",
                          ),
                        );
                      } catch (e: any) {
                        setMessage(
                          friendlyError(e, lang) +
                            L(
                              " (ต้องเชื่อมต่ออินเทอร์เน็ต)",
                              " (needs an internet connection)",
                            ),
                        );
                      }
                    }}
                  >
                    🗑 {L("ล้างข้อมูลทั้งหมด", "Clear all data")}
                  </button>
                  <p className="hint">
                    {L(
                      "ลบรายการยา ประวัติ ประวัติแพ้ยา รูป และผู้ดูแลทั้งหมด แต่ยังเข้าสู่ระบบด้วยเบอร์และรหัสเดิมได้",
                      "Removes medicines, history, allergies, photos and caregivers. You keep your phone sign-in.",
                    )}
                  </p>
                </>
              )}
            </section>
            <section className="settings-group">
              <h3>{L("บัญชี", "Account")}</h3>
              {auth && <ChangePin lang={lang} />}
              <button onClick={logout}>{t.logout}</button>
              <button
                className="danger"
                disabled={view.role !== "owner"}
                onClick={async () => {
                  if (
                    prompt(
                      L(
                        "การลบบัญชีจะลบข้อมูลยาทั้งหมดและย้อนกลับไม่ได้ พิมพ์ DELETE เพื่อยืนยัน",
                        "Deleting the account removes all medicine records and cannot be undone. Type DELETE to confirm.",
                      ),
                    ) !== "DELETE"
                  )
                    return;
                  try {
                    await api("/account", { confirm: "DELETE" }, "DELETE");
                    await clearPrivate();
                    if (auth) await auth.auth.signOut();
                    sessionStorage.clear();
                    token = "";
                    actor = "";
                    setSigned(false);
                    setS(undefined);
                    setPatient("");
                  } catch (e: any) {
                    setMessage(friendlyError(e, lang));
                  }
                }}
              >
                {t.delete}
              </button>
            </section>
            <p className="credit">
              {L("พัฒนาโดย", "Developed by")}{" "}
              <strong>Sorawut Thamyongkit, M.D.</strong>
            </p>
          </>
        ) : (
          <>
            <div className="heading">
              <h1>{t.doctor}</h1>
            </div>
            <button
              className="primary share-pdf"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await exportPdf(
                    view,
                    pending.length > 0,
                    lang,
                  );
                  if (result === "downloaded")
                    setMessage(
                      L(
                        "✓ บันทึกไฟล์ PDF แล้ว ดูได้ในแอป “ไฟล์” หรือโฟลเดอร์ดาวน์โหลด",
                        "✓ PDF saved. Find it in Files or Downloads.",
                      ),
                    );
                } catch (e: any) {
                  setMessage(
                    L("สร้าง PDF ไม่สำเร็จ: ", "PDF export failed: ") +
                      e.message,
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy
                ? t.loading
                : "📄 " + L("ส่งหรือพิมพ์ PDF", "Share or print PDF")}
            </button>
            <p className="hint">
              {L(
                "ไฟล์มีข้อมูลส่วนตัว ส่งให้เฉพาะแพทย์หรือผู้ที่ไว้ใจเท่านั้น",
                "The file contains personal information; share it only with your doctor or people you trust.",
              )}
            </p>
            <section className="doctor-head">
              <h2>{view.profile.data.displayName}</h2>
              <p>
                {L("วันเกิด", "Date of birth")}:{" "}
                {day(view.profile.data.dob, lang)}
              </p>
              <p
                className={
                  "allergy " +
                  (view.profile.data.allergyStatus === "known" ? "known" : "")
                }
              >
                <strong>{t.allergy}:</strong>{" "}
                {allergyLabel(view.profile.data.allergyStatus, lang)}
                {view.profile.data.allergies
                  .map((a: any) =>
                    [a.substance, a.reaction && `(${a.reaction})`]
                      .filter(Boolean)
                      .join(" "),
                  )
                  .filter(Boolean)
                  .map((x: string) => " · " + x)}
                {view.profile.data.allergyStatus === "unknown" &&
                  view.role === "owner" && (
                    <button
                      className="link-button"
                      onClick={() => setProfileEdit(true)}
                    >
                      {L("บันทึกประวัติแพ้ยา", "Record allergies")}
                    </button>
                  )}
              </p>
              <small>
                {disclaimer[lang]} · {L("ข้อมูล ณ", "Data as of")}{" "}
                {when(view.serverAt, lang, view.profile.data.timezone)}
              </small>
            </section>
            {pending.length > 0 && <p className="warning">{t.pending}</p>}
            {summarySections(view, lang).map((g) => (
              <section key={g.title}>
                <h2 className="section-title">
                  {g.title} ({g.items.length})
                </h2>
                {g.items.map((it) => (
                  <article key={it.id} className="summary-item">
                    <h3 className="dose-name">
                      {it.title}
                      <Speak
                        text={
                          view.medications.find((m) => m.id === it.id)?.data
                            .name || ""
                        }
                        lang={lang}
                      />
                    </h3>
                    {it.how && <p className="dose-amount">{it.how}</p>}
                    {it.slots.length > 0 && (
                      <p>
                        <PeriodChips
                          slots={it.slots}
                          weekdays={it.weekdays}
                          lang={lang}
                          showTime
                        />
                      </p>
                    )}
                    {it.extra.map((x) => (
                      <p key={x} className="muted">
                        {x}
                      </p>
                    ))}
                    {it.flags.map((x) => (
                      <p key={x} className="warn-text">
                        ⚠ {x}
                      </p>
                    ))}
                  </article>
                ))}
              </section>
            ))}
            {!view.medications.length && <div className="empty">{t.empty}</div>}
          </>
        )}
      </main>
      <nav aria-label="Main navigation">
        {[
          ["today", "◷", t.today],
          ["medicines", "▤", t.medicines],
          ["doctor", "▧", t.doctor],
          ["settings", "⚙", t.settings],
        ].map(([id, icon, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <span aria-hidden>{icon}</span>
            {label}
          </button>
        ))}
      </nav>
      {alertGroup &&
        view &&
        (() => {
          const items = alertGroup.ids
            .map((id) => view.occurrences.find((o) => o.id === id))
            .filter((o) => o && o.valid);
          if (!items.length) return null;
          const first = items[0];
          const period = periodOf(first.local_time);
          const open = items.filter((o) => doseStatus(o) === "unconfirmed");
          const locked = view.role === "viewer";
          const close = () => setAlertGroup(undefined);
          const answerAll = async (action: "taken" | "skipped") => {
            for (const o of open) await dose(o, action);
            setMessage(
              action === "taken"
                ? L("✓ บันทึกว่าได้รับยาแล้ว", "✓ Recorded as taken")
                : L("บันทึกว่าข้ามมื้อนี้แล้ว", "Recorded as skipped"),
            );
            close();
          };
          return (
            <Modal
              title={
                (alertGroup.snooze
                  ? L("⏰ เตือนอีกครั้ง", "⏰ Reminder again")
                  : L("⏰ ถึงเวลาใช้ยา", "⏰ Medicine time")) +
                (patients.length > 1
                  ? " · " + view.profile.data.displayName
                  : "")
              }
              closeLabel={L("ปิด", "Close")}
              close={close}
            >
              <div className={"alert-sheet period-" + period}>
                <p className="alert-when">
                  <span aria-hidden>{mealIcons[period]} </span>
                  {mealNames[lang][period]} <small>{first.local_time}</small>
                </p>
                {items.map((o) => {
                  const m = view.medications.find(
                    (m) => m.id === o.medication_id,
                  );
                  const st = doseStatus(o);
                  return (
                    <div key={o.id} className="alert-item">
                      <div>
                        <span className="dose-name">
                          <strong>
                            {m?.data.name}
                            {m?.data.strength ? " " + m.data.strength : ""}
                          </strong>
                          {m && <Speak text={m.data.name} lang={lang} />}
                        </span>
                        <span className="dose-what">
                          {o.data.amount} {o.data.unit}
                          {current(o.medication_id)?.data.food
                            ? " · " + current(o.medication_id)?.data.food
                            : ""}
                        </span>
                      </div>
                      {st === "unconfirmed" ? (
                        open.length > 1 && (
                          <button
                            disabled={locked}
                            onClick={() => dose(o, "taken")}
                            aria-label={
                              L("ได้รับยาแล้ว ", "Taken ") +
                              (m?.data.name || "")
                            }
                          >
                            ✓
                          </button>
                        )
                      ) : (
                        <span className={"done-badge " + st}>
                          {st === "taken" ? "✓ " : "– "}
                          {statusLabel(st, lang)}
                        </span>
                      )}
                    </div>
                  );
                })}
                {open.length > 0 ? (
                  <div className="alert-actions">
                    <button
                      className="primary huge"
                      disabled={locked}
                      onClick={() => answerAll("taken")}
                    >
                      ✓ {t.takenStatus}
                      {open.length > 1 ? L(" ทั้งหมด", " (all)") : ""}
                    </button>
                    {snoozeChoices(first).map((minutes) => (
                      <button
                        key={minutes}
                        className="huge snooze-button"
                        disabled={locked}
                        onClick={async () => {
                          await snooze(open[0], minutes);
                          close();
                        }}
                      >
                        ⏰{" "}
                        {L(
                          `เตือนอีก ${minutes} นาที`,
                          `Remind me in ${minutes} min`,
                        )}
                      </button>
                    ))}
                    <button
                      className="link-button"
                      disabled={locked}
                      onClick={() => answerAll("skipped")}
                    >
                      {L("ข้ามมื้อนี้", "Skip this time")}
                    </button>
                  </div>
                ) : (
                  <p className="success">✓ {L("ตอบครบแล้ว", "All answered")}</p>
                )}
              </div>
            </Modal>
          );
        })()}
      {editing && view && (
        <Modal
          title={
            (editing.version ? L("แก้ไขยา", "Edit medicine") : t.add) +
            " · " +
            view.profile.data.displayName
          }
          closeLabel={L("ปิด", "Close")}
          close={() => {
            setEditing(undefined);
            loadDrafts();
          }}
        >
          <MedicineForm
            scope={actor + ":" + patient}
            t={t}
            lang={lang}
            medicine={editing}
            regimen={current(editing.id)?.data}
            all={view.medications}
            onSave={async (m, r, file) => {
              // Validate before any medication operations are committed locally.
              const prepared = file ? await preparePhoto(file) : undefined;
              if (editing.conflictOpId)
                await db.outbox.delete(editing.conflictOpId);
              let version = editing.version;
              if (!version) {
                await queue("medication", editing.id, 0, m);
                version = 1;
              } else if (JSON.stringify(m) !== JSON.stringify(editing.data)) {
                if (
                  (m.name !== editing.data.name ||
                    m.strength !== editing.data.strength ||
                    m.form !== editing.data.form) &&
                  !confirm(
                    L(
                      "เป็นการแก้คำสะกดหรือฉลากของยาตัวเดิมใช่หรือไม่ หากเป็นยาคนละตัว ให้กดยกเลิกแล้วเพิ่มยาใหม่",
                      "Is this only a spelling/label correction of the same medicine? For a different medicine, cancel and add a new record.",
                    ),
                  )
                )
                  return;
                await queue("medication", editing.id, version, {
                  ...m,
                  spellingCorrection: true,
                });
                version++;
              }
              await queue("regimen", editing.id, version, r);
              if (file) {
                if (
                  !["image/jpeg", "image/png", "image/webp"].includes(
                    file.type,
                  ) ||
                  file.size > 8 * 1024 * 1024
                )
                  throw new Error(
                    L(
                      "ใช้รูป JPEG, PNG หรือ WebP ขนาดไม่เกิน 8 MB",
                      "Use JPEG, PNG or WebP, at most 8 MB",
                    ),
                  );
                await db.photos.put({
                  id: crypto.randomUUID(),
                  patientId: patient,
                  medicationId: editing.id,
                  blob: prepared!,
                  pending: true,
                  actor,
                });
                await sync();
              }
              await db.drafts.delete(editing.id);
              setEditing(undefined);
              loadDrafts();
              setMessage(
                L("✓ บันทึกแล้ว: ", "✓ Saved: ") +
                  m.name +
                  (r.status === "draft"
                    ? L(
                        " (แบบร่าง ยังไม่แจ้งเตือน)",
                        " (draft, no reminders yet)",
                      )
                    : ""),
              );
            }}
          />
        </Modal>
      )}
      {detail && view && (
        <Modal
          title={detail.data.name + " · " + view.profile.data.displayName}
          close={() => setDetail(undefined)}
          closeLabel={L("ปิด", "Close")}
        >
          {(() => {
            const row = summaryRows(view).find(
              (x) => x.medicine.id === detail.id,
            );
            const it = row
              ? describe(row, lang, view.profile.data.timezone)
              : undefined;
            const status = current(detail.id)?.data.status || "draft";
            const records = view.events
              .filter(
                (e) =>
                  e.medication_id === detail.id &&
                  ["taken", "skipped", "as-needed"].includes(e.action),
              )
              .sort(
                (a, b) =>
                  Date.parse(b.actual_at || b.client_at) -
                  Date.parse(a.actual_at || a.client_at),
              )
              .slice(0, 7);
            const changeStatus = async (next: string, label: string) => {
              const r = current(detail.id)?.data;
              if (
                !r ||
                !confirm(
                  label +
                    " " +
                    detail.data.name +
                    "? " +
                    L(
                      "ประวัติเดิมยังเก็บไว้ การแจ้งเตือนจะเปลี่ยนหลังซิงค์",
                      "History is kept. Reminders change after syncing.",
                    ),
                )
              )
                return;
              try {
                await queue("regimen", detail.id, detail.version, {
                  ...r,
                  status: next,
                  effectiveAt: new Date().toISOString(),
                  effectiveMode: "on-commit",
                  reason: label,
                });
                setMessage("✓ " + label + ": " + detail.data.name);
              } catch {
                /* queue reports storage failures */
              }
              setDetail(undefined);
            };
            return (
              <>
                <div className="detail-top">
                  <Photo
                    photos={view.photos.filter(
                      (p) => p.medication_id === detail.id,
                    )}
                  />
                  <div>
                    {canSpeak() && (
                      <button
                        className="speak-wide"
                        onClick={() => speak(detail.data.name)}
                      >
                        🔊 {L("ฟังเสียงชื่อยา", "Hear the name")}
                      </button>
                    )}
                    {it?.how && <p className="dose-amount">{it.how}</p>}
                    {it && it.slots.length > 0 && (
                      <p>
                        <PeriodChips
                          slots={it.slots}
                          weekdays={it.weekdays}
                          lang={lang}
                        />
                      </p>
                    )}
                    <span className={"badge status-" + status}>
                      {statusLabel(status, lang)}
                    </span>
                  </div>
                </div>
                {it?.extra.map((x) => (
                  <p key={x} className="muted">
                    {x}
                  </p>
                ))}
                {it?.flags.map((x) => (
                  <p key={x} className="warn-text">
                    ⚠ {x}
                  </p>
                ))}
                {view.role !== "viewer" && (
                  <div className="detail-actions">
                    <button
                      className="primary"
                      onClick={() => {
                        setEditing(detail);
                        setDetail(undefined);
                      }}
                    >
                      ✎ {L("แก้ไขวิธีใช้ / เวลา", "Edit dose / times")}
                    </button>
                    {(status === "active" || status === "as-needed") && (
                      <button
                        onClick={() =>
                          changeStatus("paused", L("พักยาชั่วคราว", "Pause"))
                        }
                      >
                        ⏸ {L("พักยาชั่วคราว", "Pause")}
                      </button>
                    )}
                    {(status === "paused" || status === "stopped") && (
                      <button
                        onClick={() =>
                          changeStatus("active", L("กลับมาใช้ยา", "Resume"))
                        }
                      >
                        ▶ {L("กลับมาใช้ยา", "Resume")}
                      </button>
                    )}
                    {status !== "stopped" && current(detail.id) && (
                      <button
                        onClick={() =>
                          changeStatus("stopped", L("หยุดใช้ยา", "Stop"))
                        }
                      >
                        ⏹{" "}
                        {L(
                          "หยุดใช้ยา (แพทย์สั่งหยุด)",
                          "Stop (doctor stopped it)",
                        )}
                      </button>
                    )}
                    <button
                      className="danger"
                      onClick={async () => {
                        if (await removeMedicine(detail)) setDetail(undefined);
                      }}
                    >
                      🗑 {L("ลบ (เพิ่มผิด/ซ้ำ)", "Delete (mistake/duplicate)")}
                    </button>
                  </div>
                )}
                <h3>{L("บันทึกการใช้ยาล่าสุด", "Recent records")}</h3>
                {records.length ? (
                  records.map((e) => (
                    <p key={e.id} className="history-row">
                      {e.action === "as-needed"
                        ? t.prn
                        : statusLabel(e.action, lang)}{" "}
                      ·{" "}
                      {when(
                        e.actual_at || e.client_at,
                        lang,
                        view.profile.data.timezone,
                      )}
                    </p>
                  ))
                ) : (
                  <p className="muted">—</p>
                )}
                <details className="about">
                  <summary>
                    {L("ประวัติการเปลี่ยนแปลง", "Change history")}
                  </summary>
                  {[...view.regimens, ...(view.retiredRegimens || [])]
                    .filter((r) => r.medication_id === detail.id)
                    .sort(
                      (a, b) =>
                        Date.parse(b.effective_at) - Date.parse(a.effective_at),
                    )
                    .map((r) => (
                      <p key={r.id} className="history-row">
                        <strong>
                          {when(
                            r.effective_at,
                            lang,
                            view.profile.data.timezone,
                          )}
                        </strong>{" "}
                        · {statusLabel(r.data.status, lang)}
                        {r.pending
                          ? L(" (รอซิงค์)", " (pending)")
                          : r.replacement_id
                            ? L(" (ถูกแทนที่แล้ว)", " (superseded)")
                            : ""}
                        <br />
                        <small>
                          {[r.data.instructions, r.data.reason]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </p>
                    ))}
                </details>
              </>
            );
          })()}
        </Modal>
      )}
      {profileEdit && view && (
        <Modal
          title={t.profile + " · " + view.profile.data.displayName}
          close={() => setProfileEdit(false)}
        >
          <ProfileForm
            t={t}
            profile={view.profile.data}
            readonly={view.role !== "owner"}
            onSave={async (data) => {
              await queue("profile", patient, view.profile.version, data);
              setProfileEdit(false);
            }}
          />
        </Modal>
      )}
      {caregiver && (
        <Modal
          title={t.caregiver + " · " + view?.profile.data.displayName}
          close={() => setCaregiver(false)}
        >
          <Caregivers
            patient={patient}
            owner={view?.role === "owner"}
            api={api}
            lang={lang}
            onAccepted={async () => {
              const list = await api("/patients");
              setPatients(list);
            }}
          />
        </Modal>
      )}
    </>
  );
}
/** Colour-coded part of the day (morning, noon, evening, bedtime). */
function Period({
  time,
  lang,
  showTime = false,
  amount = "",
}: {
  time: string;
  lang: Language;
  showTime?: boolean;
  amount?: string;
}) {
  const p = periodOf(time);
  return (
    <span className={"period period-" + p}>
      <span aria-hidden>{mealIcons[p]} </span>
      {mealNames[lang][p]}
      {showTime && <small> {time}</small>}
      {amount && <span className="period-amount"> · {amount}</span>}
    </span>
  );
}
function PeriodChips({
  slots,
  lang,
  weekdays = "",
  showTime = false,
}: {
  slots: { time: string; amount?: string; unit?: string }[];
  lang: Language;
  weekdays?: string;
  showTime?: boolean;
}) {
  if (!slots.length) return null;
  const periods = slots.map((x) => periodOf(x.time));
  // Show the clock only when it is needed to tell two doses apart.
  const clash = periods.some((p, i) => periods.indexOf(p) !== i);
  return (
    <span className="periods">
      {slots.map((x) => (
        <Period
          key={x.time}
          time={x.time}
          lang={lang}
          showTime={showTime || clash}
          amount={x.amount ? x.amount + " " + (x.unit || "") : ""}
        />
      ))}
      {weekdays && <span className="period-days">{weekdays}</span>}
    </span>
  );
}
const canSpeak = () =>
  typeof window !== "undefined" &&
  "speechSynthesis" in window &&
  typeof SpeechSynthesisUtterance !== "undefined";
/** Reads a medicine name aloud, in English unless it is written in Thai. */
function speak(text: string) {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const thai = /[\u0E00-\u0E7F]/.test(text);
  const u = new SpeechSynthesisUtterance(text);
  u.lang = thai ? "th-TH" : "en-US";
  const voice = synth
    .getVoices()
    .find((v) => v.lang.replace("_", "-").startsWith(thai ? "th" : "en-US"));
  if (voice) u.voice = voice;
  u.rate = 0.75;
  synth.speak(u);
}
function Speak({ text, lang }: { text: string; lang: Language }) {
  if (!canSpeak() || !text?.trim()) return null;
  return (
    <button
      type="button"
      className="speak"
      aria-label={(lang === "th" ? "ฟังเสียงชื่อยา " : "Hear the name ") + text}
      title={lang === "th" ? "ฟังเสียงชื่อยา" : "Hear the name"}
      onClick={(e) => {
        e.stopPropagation();
        speak(text);
      }}
    >
      🔊
    </button>
  );
}
function Photo({ photos }: { photos: any[] }) {
  const [url, setUrl] = useState("");
  const id = photos[0]?.id;
  useEffect(() => {
    // Clear at once so another medicine's image never lingers, and ignore a
    // slow read that finishes after the photo or medicine changed.
    let alive = true,
      u = "";
    setUrl("");
    if (id)
      db.photos.get(id).then((p) => {
        if (alive && p) {
          u = URL.createObjectURL(p.blob);
          setUrl(u);
        }
      });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img className="photo" src={url} alt="Package or label — open to zoom" />
    </a>
  ) : (
    <div className="photo placeholder" aria-label="No package photo">
      ▤
    </div>
  );
}
let openModals = 0,
  pendingBack: ReturnType<typeof setTimeout> | undefined;
function Modal({
  title,
  close,
  closeLabel = "Close / ปิด",
  children,
}: {
  title: string;
  close: () => void;
  closeLabel?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.showModal();
    // The phone's Back gesture/button closes the pop-up instead of leaving the app.
    const depth = ++openModals;
    const state = { ...window.history.state, modalDepth: depth };
    if (pendingBack) {
      // One pop-up replaced another (details → edit): reuse its history entry.
      clearTimeout(pendingBack);
      pendingBack = undefined;
      window.history.replaceState(state, "");
    } else window.history.pushState(state, "");
    const onPop = () => {
      if ((window.history.state?.modalDepth || 0) < depth) closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      openModals--;
      if (window.history.state?.modalDepth === depth)
        pendingBack = setTimeout(() => {
          pendingBack = undefined;
          if (window.history.state?.modalDepth === depth) window.history.back();
        }, 0);
      dialog?.close();
      previous?.focus();
    };
  }, []);
  const back = document.documentElement.lang === "en" ? "Back" : "กลับ";
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        // A tap on the dimmed area outside the box also goes back.
        const r = ref.current?.getBoundingClientRect();
        if (
          e.target === ref.current &&
          r &&
          (e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom)
        )
          close();
      }}
    >
      <div className="heading modal-head">
        <button className="back-button" onClick={close}>
          ‹ {back}
        </button>
        <h2>{title}</h2>
        <button onClick={close} aria-label={closeLabel}>
          ✕
        </button>
      </div>
      {children}
    </dialog>
  );
}
function MedicineForm({
  scope,
  t,
  lang,
  medicine,
  regimen,
  all,
  onSave,
}: {
  scope: string;
  t: typeof words.en | typeof words.th;
  lang: Language;
  medicine: any;
  regimen: any;
  all: any[];
  onSave: (m: any, r: Regimen, f?: File) => Promise<void>;
}) {
  const L = (th: string, en: string) => (lang === "th" ? th : en);
  const editing = Boolean(medicine.data);
  const start = medicine.proposed || regimen;
  const [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [file, setFile] = useState<File>(),
    [preview, setPreview] = useState("");
  const [m, setM] = useState<any>(
    medicine.data || {
      name: "",
      generic: "",
      brand: "",
      strength: "",
      form: "tablet",
      route: "",
      purpose: "",
      productType: "prescription",
      source: "",
      verified: false,
    },
  );
  const [r, setR] = useState<any>({
    instructions: "",
    food: "",
    route: "",
    timezone: "Asia/Bangkok",
    start: DateTime.now().setZone("Asia/Bangkok").toISODate(),
    source: "",
    ...start,
    slots: (start?.slots || []).map((s: any) => ({
      ...s,
      meal: s.meal || mealOf(s.time),
    })),
    confirmed: false,
    reason: editing ? L("แก้ไขข้อมูลยา", "Updated medicine details") : "",
    effectiveAt: new Date().toISOString(),
    effectiveMode: "on-commit",
  });
  const [asNeeded, setAsNeeded] = useState(start?.status === "as-needed"),
    [amount, setAmountState] = useState<string>(
      start?.slots?.[0]?.amount || start?.prnAmount || "",
    ),
    [unit, setUnitState] = useState<string>(
      start?.slots?.[0]?.unit || start?.prnUnit || "",
    ),
    [days, setDays] = useState<number[]>(
      start?.slots?.[0]?.weekdays || [1, 2, 3, 4, 5, 6, 7],
    ),
    [someDays, setSomeDays] = useState(
      (start?.slots?.[0]?.weekdays?.length || 7) < 7,
    );
  useEffect(() => {
    db.drafts.get(medicine.id).then((d) => {
      if (
        d &&
        !medicine.proposed &&
        d.value.v === 2 &&
        d.value.scope === scope
      ) {
        setM(d.value.m);
        setR(d.value.r);
        setAmountState(d.value.amount);
        setUnitState(d.value.unit);
        setAsNeeded(d.value.asNeeded);
        setDays(d.value.days);
        setSomeDays(d.value.days.length < 7);
        if (d.value.file) setFile(d.value.file);
      } else touched.current = true;
      hydrated.current = true;
    });
  }, []);
  // Autosave shortly after each change, only once any saved draft has loaded
  // (so an empty new form never overwrites it).
  const hydrated = useRef(false);
  const touched = useRef(false);
  useEffect(() => {
    if (!hydrated.current) return;
    if (!touched.current) {
      touched.current = true;
      return;
    }
    const timer = setTimeout(() => void persist(), 800);
    return () => clearTimeout(timer);
  }, [m, r, amount, unit, asNeeded, days, file]);
  useEffect(() => {
    if (!file) return setPreview("");
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const persist = async () => {
    try {
      await db.drafts.put({
        id: medicine.id,
        value: {
          v: 2,
          scope,
          isNew: !editing,
          savedAt: Date.now(),
          m,
          r,
          amount,
          unit,
          asNeeded,
          days,
          file,
        },
      });
    } catch {
      setError(
        L(
          "บันทึกแบบร่างในเครื่องไม่สำเร็จ",
          "Could not keep a draft on this phone",
        ),
      );
    }
  };
  const updateM = (key: string, v: any) =>
    setM((old: any) => ({ ...old, [key]: v }));
  const updateR = (key: string, v: any) =>
    setR((old: any) => ({ ...old, [key]: v }));
  const setSlots = (fn: (slots: any[]) => any[]) =>
    setR((old: any) => ({ ...old, slots: fn(old.slots) }));
  const setAmount = (v: string) => {
    setAmountState(v);
    setSlots((slots) => slots.map((s) => ({ ...s, amount: v })));
  };
  const setUnit = (v: string) => {
    setUnitState(v);
    setSlots((slots) => slots.map((s) => ({ ...s, unit: v })));
    const derived = formForUnit(v);
    updateM("form", derived.form);
    setR((old: any) =>
      !old.route || old.autoRoute
        ? { ...old, route: derived.route[lang], autoRoute: true }
        : old,
    );
  };
  const setFood = (food: string) =>
    setR((old: any) => ({
      ...old,
      food,
      // Meal times still at their usual clock time follow the food choice.
      slots: old.slots.map((s: any) =>
        s.meal && s.time === mealTime(s.meal, old.food)
          ? { ...s, time: mealTime(s.meal, food) }
          : s,
      ),
    }));
  const setWeekdays = (next: number[]) => {
    setDays(next);
    setSlots((slots) => slots.map((s) => ({ ...s, weekdays: next })));
  };
  const newSlot = (meal?: Meal, time = "") => ({
    id: crypto.randomUUID(),
    time: meal ? mealTime(meal, r.food) : time,
    amount,
    unit,
    weekdays: days,
    meal,
  });
  const toggleMeal = (meal: Meal) =>
    setSlots((slots) =>
      slots.some((s) => s.meal === meal)
        ? slots.filter((s) => s.meal !== meal)
        : [...slots, newSlot(meal)],
    );
  const applyLabel = (text: string) => {
    const fill = readLabel(text);
    const found: string[] = [];
    if (fill.unit && !unit) {
      setUnit(fill.unit);
      found.push(fill.unit);
    }
    if (fill.amount && !amount) {
      setAmount(fill.amount);
      found.push(L("ครั้งละ ", "") + fill.amount);
    }
    if (fill.food && !r.food) {
      setFood(fill.food);
      found.push(fill.food);
    }
    if (fill.asNeeded && !asNeeded) {
      setAsNeeded(true);
      found.push(t.prn);
    }
    if (fill.interval && !r.prnInterval) updateR("prnInterval", fill.interval);
    if (fill.route && (!r.route || r.autoRoute)) {
      setR((old: any) => ({ ...old, route: fill.route, autoRoute: false }));
      found.push(fill.route);
    }
    if (fill.meals && !r.slots.length && !fill.asNeeded) {
      const food = fill.food || r.food;
      setR((old: any) => ({
        ...old,
        slots: fill.meals!.map((meal) => ({
          id: crypto.randomUUID(),
          time: mealTime(meal, food),
          amount: fill.amount || amount,
          unit: fill.unit || unit,
          weekdays: days,
          meal,
        })),
      }));
      found.push(fill.meals.map((x) => mealNames[lang][x]).join(" "));
    }
    setNote(
      found.length
        ? L("✨ เติมให้จากฉลาก: ", "✨ Filled from the label: ") +
            found.join(" · ") +
            L(" — โปรดตรวจสอบ", " — please check")
        : "",
    );
  };
  const route = r.route || formForUnit(unit).route[lang];
  const slots = [...r.slots].sort((a, b) => a.time.localeCompare(b.time));
  const summary = [
    m.name && m.name + (m.strength ? " " + m.strength : ""),
    amount && unit
      ? `${route} ${L("ครั้งละ", "")} ${amount} ${unit}`.replace(/\s+/g, " ")
      : "",
    asNeeded
      ? L("เมื่อมีอาการ", "when needed")
      : slots.length
        ? L(`วันละ ${slots.length} ครั้ง`, `${slots.length} times a day`)
        : "",
    r.food,
    asNeeded
      ? ""
      : slots
          .map(
            (s) =>
              (s.meal ? mealNames[lang][s.meal as Meal] + " " : "") + s.time,
          )
          .join(", "),
    !asNeeded && slots.length ? weekdaysText(days, lang) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const keepStatus = ["paused", "stopped", "reference"].includes(
    regimen?.status,
  )
    ? regimen.status
    : undefined;
  const sameName = all.find(
    (a) =>
      a.id !== medicine.id &&
      m.name.trim() &&
      a.data.name.trim().toLowerCase() === m.name.trim().toLowerCase(),
  );
  const save = async (asDraft: boolean) => {
    setError("");
    try {
      if (!m.name.trim())
        throw new Error(L("กรุณาใส่ชื่อยา", "Enter the medicine name"));
      if (!asDraft) {
        if (!amount || !unit)
          throw new Error(
            L(
              "กรุณาเลือกปริมาณและหน่วยที่ใช้ต่อครั้ง",
              "Choose the amount and unit per dose",
            ),
          );
        if (!asNeeded && !slots.length)
          throw new Error(
            L(
              "กรุณาเลือกเวลาใช้ยาอย่างน้อย 1 เวลา",
              "Choose at least one time",
            ),
          );
        if (!r.confirmed)
          throw new Error(
            L(
              "กรุณาติ๊กยืนยันว่าข้อมูลตรงกับฉลากหรือใบสั่งยา",
              "Tick the box to confirm the details match the label or prescription",
            ),
          );
      }
      const generated = summary.replace(
        m.name + (m.strength ? " " + m.strength : "") + " · ",
        "",
      );
      const med = medicationSchema.parse({
        ...m,
        name: m.name.trim(),
        route,
      });
      const reg = regimenSchema.parse({
        ...r,
        status: asDraft
          ? "draft"
          : keepStatus || (asNeeded ? "as-needed" : "active"),
        route,
        instructions: (r.instructions || "").trim() || generated,
        prnAmount: asNeeded ? amount || undefined : undefined,
        prnUnit: asNeeded ? unit || undefined : undefined,
        slots: asNeeded
          ? []
          : slots.map(({ meal, ...s }: any) => ({
              ...s,
              amount: s.amount || amount,
              unit,
            })),
        end: r.end || undefined,
      });
      setBusy(true);
      await onSave(med, reg, file);
    } catch (e: any) {
      setError(friendlyError(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const chip = (
    on: boolean,
    label: string,
    onClick: () => void,
    key?: string,
  ) => (
    <button
      type="button"
      key={key || label}
      className={on ? "chip on" : "chip"}
      aria-pressed={on}
      onClick={onClick}
    >
      {label}
    </button>
  );
  const text = (
    label: string,
    value: string,
    set: (v: string) => void,
    extra: any = {},
  ) => (
    <label>
      {label}
      <input
        value={value || ""}
        onChange={(e) => set(e.target.value)}
        onBlur={persist}
        {...extra}
      />
    </label>
  );
  return (
    <form
      className="med-form"
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      <div className="photo-row">
        {preview ? <img className="photo" src={preview} alt={t.photo} /> : null}
        <label className="file-button">
          📷 {L("ถ่ายรูปฉลาก", "Photo of label")}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setFile(e.target.files?.[0])}
          />
        </label>
        <label className="file-button">
          🖼 {L("เลือกรูป", "Choose photo")}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0])}
          />
        </label>
      </div>
      {text(t.name, m.name, (v) => updateM("name", v), {
        list: "medicine-names",
        autoComplete: "off",
        required: true,
      })}
      <datalist id="medicine-names">
        {[...new Set([...all.map((a) => a.data.name), ...commonMedicines])].map(
          (n) => (
            <option key={n} value={n} />
          ),
        )}
      </datalist>
      {sameName && (
        <p className="hint warn-text">
          {L(
            "มียาชื่อนี้อยู่แล้ว ตรวจสอบว่าไม่ซ้ำ",
            "A medicine with this name already exists; check it is not a duplicate",
          )}
        </p>
      )}
      {text(
        L("ความแรง (ถ้ามี)", "Strength (if any)"),
        m.strength,
        (v) => updateM("strength", v),
        {
          placeholder: L("เช่น 5 mg", "e.g. 5 mg"),
        },
      )}
      <label>
        {L("ข้อความบนฉลากยา (ถ้ามี)", "Label wording (optional)")}
        <textarea
          rows={2}
          value={r.instructions || ""}
          placeholder={L(
            "เช่น รับประทานครั้งละ 1 เม็ด วันละ 2 ครั้ง หลังอาหาร เช้า เย็น",
            "e.g. Take 1 tablet twice a day after meals",
          )}
          onChange={(e) => updateR("instructions", e.target.value)}
          onBlur={(e) => {
            applyLabel(e.target.value);
            persist();
          }}
        />
      </label>
      {note && <p className="hint filled">{note}</p>}
      <fieldset className="chips">
        <legend>{L("ใช้ครั้งละ", "Each dose")}</legend>
        <div className="chip-row">
          {["1/2", "1", "2"].map((a) =>
            chip(amount === a, a === "1/2" ? "½" : a, () => setAmount(a)),
          )}
          <input
            className="amount-input"
            aria-label={t.amount}
            inputMode="decimal"
            placeholder={L("อื่น", "other")}
            value={["1/2", "1", "2"].includes(amount) ? "" : amount}
            onChange={(e) => setAmount(e.target.value.trim())}
          />
        </div>
        <div className="chip-row">
          {units[lang].map((u) => chip(unit === u, u, () => setUnit(u)))}
          <input
            className="amount-input"
            aria-label={t.unit}
            placeholder={L("หน่วยอื่น", "other unit")}
            value={units[lang].includes(unit) ? "" : unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </div>
      </fieldset>
      <fieldset className="chips">
        <legend>{L("เวลาใช้ยา", "When")}</legend>
        <div className="chip-row">
          {MEALS.map((meal) =>
            chip(
              !asNeeded && r.slots.some((s: any) => s.meal === meal),
              mealNames[lang][meal],
              () => {
                setAsNeeded(false);
                toggleMeal(meal);
              },
            ),
          )}
          {chip(asNeeded, "🩹 " + t.prn, () => setAsNeeded(!asNeeded))}
        </div>
        {!asNeeded &&
          slots.map((s) => (
            <div className="slot-row" key={s.id}>
              <span>
                {s.meal ? mealNames[lang][s.meal as Meal] : L("เวลา", "Time")}
              </span>
              <input
                type="time"
                aria-label={t.time}
                value={s.time}
                onChange={(e) =>
                  setSlots((list) =>
                    list.map((x) =>
                      x.id === s.id ? { ...x, time: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                className="amount-input"
                aria-label={t.amount + " " + s.time}
                inputMode="decimal"
                value={s.amount}
                onChange={(e) =>
                  setSlots((list) =>
                    list.map((x) =>
                      x.id === s.id
                        ? { ...x, amount: e.target.value.trim() }
                        : x,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="link-button"
                aria-label={t.removeTime + " " + s.time}
                onClick={() =>
                  setSlots((list) => list.filter((x) => x.id !== s.id))
                }
              >
                ✕
              </button>
            </div>
          ))}
        {!asNeeded && (
          <button
            type="button"
            className="link-button"
            onClick={() =>
              setSlots((list) => [...list, newSlot(undefined, "")])
            }
          >
            ＋ {L("เวลาอื่น", "Another time")}
          </button>
        )}
      </fieldset>
      {!asNeeded && (
        <fieldset className="chips">
          <legend>{t.food}</legend>
          <div className="chip-row">
            {foodOptions[lang].map((f) =>
              chip(r.food === f, f, () => setFood(r.food === f ? "" : f)),
            )}
          </div>
          <div className="chip-row">
            {chip(!someDays, t.everyDay, () => {
              setSomeDays(false);
              setWeekdays([1, 2, 3, 4, 5, 6, 7]);
            })}
            {chip(someDays, L("บางวัน", "Some days"), () => setSomeDays(true))}
          </div>
          {someDays && (
            <div className="chip-row" role="group" aria-label={t.weekdays}>
              {weekdayNames[lang].map((name, d) =>
                chip(
                  days.includes(d + 1),
                  name,
                  () =>
                    setWeekdays(
                      days.includes(d + 1)
                        ? days.filter((x) => x !== d + 1)
                        : [...days, d + 1].sort((a, b) => a - b),
                    ),
                  "day" + d,
                ),
              )}
            </div>
          )}
        </fieldset>
      )}
      {asNeeded &&
        text(
          L("ใช้เมื่อ (ถ้าแพทย์ระบุ)", "Use when (if stated)"),
          r.prnIndication,
          (v) => updateR("prnIndication", v),
        )}
      <details className="advanced">
        <summary>
          {L("ข้อมูลเพิ่มเติม (ไม่บังคับ)", "More details (optional)")}
        </summary>
        {text(L("ชื่อสามัญ", "Generic name"), m.generic, (v) =>
          updateM("generic", v),
        )}
        {text(L("ยี่ห้อ", "Brand"), m.brand, (v) => updateM("brand", v))}
        {text(t.purpose, m.purpose, (v) => updateM("purpose", v), {
          placeholder: L("เช่น ความดัน เบาหวาน", "e.g. blood pressure"),
        })}
        <label>
          {t.productType}
          <select
            value={m.productType}
            onChange={(e) => updateM("productType", e.target.value)}
          >
            {Object.keys(productNames.en).map((x) => (
              <option key={x} value={x}>
                {productNames[lang][x]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.form}
          <select
            value={m.form}
            onChange={(e) => updateM("form", e.target.value)}
          >
            {Object.keys(formNames.en).map((x) => (
              <option key={x} value={x}>
                {formNames[lang][x]}
              </option>
            ))}
          </select>
        </label>
        {text(t.route, r.route || route, (v) =>
          setR((old: any) => ({ ...old, route: v, autoRoute: false })),
        )}
        {asNeeded && (
          <>
            {text(
              L("ห่างกันอย่างน้อย (ถ้าระบุ)", "Interval (if stated)"),
              r.prnInterval,
              (v) => updateR("prnInterval", v),
            )}
            {text(
              L("สูงสุดต่อวัน (ถ้าระบุ)", "Maximum (if stated)"),
              r.prnMaximum,
              (v) => updateR("prnMaximum", v),
            )}
          </>
        )}
        {text(t.start, r.start, (v) => updateR("start", v), { type: "date" })}
        {text(
          t.end + L(" (ถ้ามี)", " (optional)"),
          r.end,
          (v) => updateR("end", v),
          {
            type: "date",
          },
        )}
        {text(
          L("ได้รับยาจาก", "Prescribed by / source"),
          r.source,
          (v) => updateR("source", v),
          {
            placeholder: L(
              "เช่น รพ. / คลินิก / ร้านยา",
              "e.g. hospital, clinic, pharmacy",
            ),
          },
        )}
        {text(t.timezone, r.timezone, (v) => updateR("timezone", v))}
      </details>
      {summary && (
        <p className="summary-line" aria-live="polite">
          {summary}
        </p>
      )}
      {keepStatus && (
        <p className="hint">
          {L("สถานะยังคงเป็น", "Status stays")}: {statusLabel(keepStatus, lang)}
        </p>
      )}
      {editing &&
        text(L("เหตุผลที่แก้ไข", "Reason for change"), r.reason, (v) =>
          updateR("reason", v),
        )}
      <label className="check confirm-box">
        <input
          type="checkbox"
          checked={r.confirmed}
          onChange={(e) => updateR("confirmed", e.target.checked)}
        />
        {t.confirm}
      </label>
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
      <button className="primary save-button" disabled={busy}>
        {busy ? t.loading : "✓ " + t.save}
      </button>
      <button
        type="button"
        className="link-button"
        disabled={busy}
        onClick={() => save(true)}
      >
        {L(
          "บันทึกเป็นแบบร่าง (ยังไม่แจ้งเตือน)",
          "Save as draft (no reminders yet)",
        )}
      </button>
    </form>
  );
}
function Caregivers({
  patient,
  owner,
  api,
  lang,
  onAccepted,
}: {
  patient: string;
  owner: boolean;
  api: typeof window.fetch | any;
  lang: Language;
  onAccepted: () => Promise<void>;
}) {
  const [list, setList] = useState<any[]>([]),
    [message, setMessage] = useState("");
  const L = (th: string, en: string) => (lang === "th" ? th : en);
  const roleName = (role: string) =>
    role === "owner"
      ? L("เจ้าของ", "Owner")
      : role === "editor"
        ? L("ช่วยแก้ไขและบันทึกยาได้", "Editor (can record and edit)")
        : L("ดูได้อย่างเดียว", "Viewer (read only)");
  const load = () =>
    api("/patients/" + patient + "/memberships")
      .then(setList)
      .catch((e: any) => setMessage(e.message));
  useEffect(() => {
    if (owner) load();
  }, []);
  return (
    <>
      <p>
        {L(
          "ผู้ดูแลใช้บัญชีอีเมลของตนเอง สิทธิ์แก้ไขไม่ได้เปิดการแจ้งเตือนให้อัตโนมัติ ข้อมูลที่ดาวน์โหลดไปแล้วในเครื่องที่ออฟไลน์เรียกคืนไม่ได้",
          "Invited caregivers use their own account. Editing access does not enable reminders. Previously downloaded information cannot be recalled from offline devices.",
        )}
      </p>
      {owner && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const f = new FormData(e.currentTarget);
              const r = await api("/patients/" + patient + "/invitations", {
                recipient: f.get("email"),
                role: f.get("role"),
              });
              setMessage(
                L(
                  "ส่งรหัสเชิญนี้ให้ผู้ดูแลแบบส่วนตัว (ใช้ได้ครั้งเดียว ภายใน 48 ชั่วโมง): ",
                  "Share this single-use token privately (48 hours): ",
                ) + r.token,
              );
            } catch (e: any) {
              setMessage(friendlyError(e, lang));
            }
          }}
        >
          <h3>{L("เชิญผู้ดูแล", "Invite a caregiver")}</h3>
          <label>
            {L("เบอร์โทรของผู้ดูแล", "Caregiver phone number")}
            <input
              type="tel"
              inputMode="tel"
              name="email"
              placeholder="08x-xxx-xxxx"
              required
            />
          </label>
          <p className="hint">
            {L(
              "ผู้ดูแลต้องสมัครใช้งานด้วยเบอร์นี้ แล้วใส่รหัสเชิญ",
              "The caregiver registers with this number, then enters the invitation code.",
            )}
          </p>
          <label>
            {L("สิทธิ์", "Access")}
            <select name="role">
              <option value="viewer">{roleName("viewer")}</option>
              <option value="editor">{roleName("editor")}</option>
            </select>
          </label>
          <button className="primary">
            {L("สร้างรหัสเชิญ", "Create invitation")}
          </button>
        </form>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const f = new FormData(e.currentTarget);
            await api("/invitations/accept", {
              token: f.get("token"),
              agreed: f.get("agreed") === "on",
            });
            await onAccepted();
            setMessage(
              L(
                "ยอมรับแล้ว เลือกผู้ป่วยได้ที่ด้านบนของหน้าจอ",
                "Accepted. Choose the patient at the top of the screen.",
              ),
            );
          } catch (e: any) {
            setMessage(e.message);
          }
        }}
      >
        <h3>{L("ได้รับรหัสเชิญ?", "Received an invitation?")}</h3>
        <label>
          {L("รหัสเชิญ", "Invitation token")}
          <input name="token" required autoComplete="off" />
        </label>
        <label className="check">
          <input type="checkbox" name="agreed" required />
          {L(
            "ฉันยินยอมเข้าถึงข้อมูลของผู้ป่วยนี้",
            "I agree to access this profile",
          )}
        </label>
        <button>{L("ยอมรับคำเชิญ", "Accept invitation")}</button>
      </form>
      {list.some((m) => !m.revoked_at) && (
        <h3>{L("ผู้มีสิทธิ์เข้าถึง", "People with access")}</h3>
      )}
      {list
        .filter((m) => !m.revoked_at)
        .map((m, i) => (
          <p key={m.user_id} className="device-row">
            {m.role === "owner" ? "" : L("ผู้ดูแล ", "Caregiver ") + i + " · "}
            {roleName(m.role)}{" "}
            {m.role !== "owner" && (
              <>
                <button
                  onClick={async () => {
                    await api(
                      "/patients/" + patient + "/memberships/" + m.user_id,
                      { role: m.role === "viewer" ? "editor" : "viewer" },
                      "PATCH",
                    );
                    load();
                  }}
                >
                  {L("เปลี่ยนสิทธิ์", "Change access")}
                </button>
                <button
                  onClick={async () => {
                    if (
                      !confirm(
                        L(
                          "ยกเลิกสิทธิ์ของผู้ดูแลนี้?",
                          "Revoke this caregiver?",
                        ),
                      )
                    )
                      return;
                    await api(
                      "/patients/" + patient + "/memberships/" + m.user_id,
                      undefined,
                      "DELETE",
                    );
                    load();
                  }}
                >
                  {L("ยกเลิกสิทธิ์", "Revoke")}
                </button>
              </>
            )}
          </p>
        ))}
      <p role="status" style={{ overflowWrap: "anywhere" }}>
        {message}
      </p>
    </>
  );
}
function InstallGuide({
  lang,
  always = false,
}: {
  lang: Language;
  always?: boolean;
}) {
  const L = (th: string, en: string) => (lang === "th" ? th : en);
  const [, refresh] = useState(0);
  const [hidden, setHidden] = useState(() => {
    try {
      return (
        Number(localStorage.getItem("install-dismissed") || 0) >
        Date.now() - 7 * 86400000
      );
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const f = () => refresh((n) => n + 1);
    installListeners.add(f);
    return () => {
      installListeners.delete(f);
    };
  }, []);
  if (standalone()) return null;
  if (hidden && !always) return null;
  const ua = navigator.userAgent;
  const ios =
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const inApp = /Line\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(ua);
  const shareIcon = (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path
        d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
  const addIcon = (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M12 8v8M8 12h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
  return (
    <section
      className="install-card"
      aria-label={L("ติดตั้งแอป", "Install the app")}
    >
      <h2>
        📲 {L("เพิ่มแอปไว้ที่หน้าจอโฮม", "Add the app to your Home Screen")}
      </h2>
      <p>
        {L(
          "เปิดง่ายเหมือนแอปทั่วไป และจำเป็นสำหรับการแจ้งเตือนบน iPhone",
          "Opens like a normal app, and is needed for reminders on iPhone.",
        )}
      </p>
      {inApp ? (
        <p className="warning">
          {L(
            "ตอนนี้เปิดอยู่ในแอป LINE/Facebook กรุณากดเมนู ⋯ แล้วเลือก “เปิดใน Safari” (หรือเบราว์เซอร์) ก่อน",
            "You are inside LINE/Facebook. Tap the ⋯ menu and choose “Open in Safari” (or your browser) first.",
          )}
        </p>
      ) : installPrompt ? (
        <button
          className="primary"
          onClick={async () => {
            installPrompt.prompt();
            await installPrompt.userChoice.catch(() => {});
            installPrompt = null;
            refresh((n) => n + 1);
          }}
        >
          📲 {L("ติดตั้งแอป", "Install app")}
        </button>
      ) : ios ? (
        <ol className="install-steps">
          <li>
            <span className="step-icon">{shareIcon}</span>
            <span>
              {L("แตะปุ่ม", "Tap the")} <strong>{L("แชร์", "Share")}</strong>{" "}
              {L(
                "(สี่เหลี่ยมมีลูกศรชี้ขึ้น) ที่แถบด้านล่างของ Safari",
                "button (square with an up arrow) in Safari's bottom bar",
              )}
            </span>
          </li>
          <li>
            <span className="step-icon">{addIcon}</span>
            <span>
              {L("เลื่อนลงแล้วแตะ", "Scroll down and tap")}{" "}
              <strong>{L("เพิ่มไปยังหน้าจอโฮม", "Add to Home Screen")}</strong>
            </span>
          </li>
          <li>
            <span className="step-icon app-icon" aria-hidden="true">
              ＋
            </span>
            <span>
              {L("แตะ", "Tap")} <strong>{L("เพิ่ม", "Add")}</strong>{" "}
              {L(
                "แล้วเปิดแอปจากไอคอน “ยาของฉัน” ทุกครั้ง",
                "then always open the app from the new “My Medicine” icon",
              )}
            </span>
          </li>
        </ol>
      ) : (
        <p>
          {L(
            "เปิดเมนูของเบราว์เซอร์ (⋮) แล้วเลือก “ติดตั้งแอป” หรือ “เพิ่มลงในหน้าจอหลัก”",
            "Open the browser menu (⋮) and choose “Install app” or “Add to Home screen”.",
          )}
        </p>
      )}
      {!always && (
        <button
          className="link-button"
          onClick={() => {
            try {
              localStorage.setItem("install-dismissed", String(Date.now()));
            } catch {
              /* private mode */
            }
            setHidden(true);
          }}
        >
          {L("ไว้ทีหลัง", "Later")}
        </button>
      )}
      {ios && !inApp && !always && (
        <div className="install-arrow" aria-hidden="true">
          ⬇
        </div>
      )}
    </section>
  );
}
function ChangePin({ lang }: { lang: Language }) {
  const L = (th: string, en: string) => (lang === "th" ? th : en);
  const [open, setOpen] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button onClick={() => setOpen(true)}>
        🔑 {L("เปลี่ยนรหัส 4 หลัก", "Change PIN")}
      </button>
    );
  const digits = (e: React.FormEvent<HTMLInputElement>) => {
    e.currentTarget.value = e.currentTarget.value
      .replace(/\D/g, "")
      .slice(0, 4);
  };
  const pinField = (name: string, label: string, isNew: boolean) => (
    <label>
      {label}
      <input
        name={name}
        type="password"
        required
        inputMode="numeric"
        pattern="[0-9]{4}"
        maxLength={4}
        autoComplete={isNew ? "new-password" : "current-password"}
        className="code-input"
        onInput={digits}
      />
    </label>
  );
  return (
    <form
      className="confirm-box"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        if (f.get("newPin") !== f.get("newPin2")) {
          setMessage(
            L("รหัสใหม่ทั้งสองช่องไม่ตรงกัน", "The new PINs do not match"),
          );
          return;
        }
        setBusy(true);
        try {
          await api("/auth/pin/change", {
            currentPin: f.get("currentPin"),
            newPin: f.get("newPin"),
          });
          form.reset();
          setMessage(L("เปลี่ยนรหัสเรียบร้อยแล้ว", "PIN changed"));
        } catch (err: any) {
          setMessage(friendlyError(err, lang));
        } finally {
          setBusy(false);
        }
      }}
    >
      {pinField("currentPin", L("รหัสเดิม", "Current PIN"), false)}
      {pinField("newPin", L("รหัสใหม่ 4 หลัก", "New 4-digit PIN"), true)}
      {pinField("newPin2", L("ใส่รหัสใหม่อีกครั้ง", "New PIN again"), true)}
      {message && <p role="status">{message}</p>}
      <div className="actions">
        <button className="primary" disabled={busy}>
          {L("บันทึกรหัสใหม่", "Save new PIN")}
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          {L("ปิด", "Close")}
        </button>
      </div>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

function ProfileForm({
  t,
  profile,
  readonly,
  onSave,
}: {
  t: typeof words.en | typeof words.th;
  profile: any;
  readonly: boolean;
  onSave: (data: any) => Promise<void>;
}) {
  const [allergies, setAllergies] = useState<any[]>(profile.allergies),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const f = new FormData(e.currentTarget);
          const status = f.get("allergyStatus");
          const data = profileSchema.parse({
            ...profile,
            displayName: f.get("displayName"),
            dob: f.get("dob") || undefined,
            language: f.get("language"),
            timezone: f.get("timezone"),
            allergyStatus: status,
            allergies: status === "known" ? allergies : [],
            reviewedAt: new Date().toISOString(),
          });
          await onSave(data);
        } catch (e: any) {
          setError(friendlyError(e, t === words.th ? "th" : "en"));
        }
      }}
    >
      <label>
        {t.profile}
        <input name="displayName" defaultValue={profile.displayName} required />
      </label>
      <label>
        Date of birth / วันเกิด
        <input name="dob" type="date" defaultValue={profile.dob} />
      </label>
      <label>
        {t.language}
        <select name="language" defaultValue={profile.language}>
          <option value="th">ไทย</option>
          <option value="en">English</option>
        </select>
      </label>
      <label>
        {t.timezone}
        <input name="timezone" defaultValue={profile.timezone} required />
      </label>
      <p>
        Existing medicine schedules retain their own timezone. /
        ตารางยาเดิมยังใช้เขตเวลาที่บันทึกไว้
      </p>
      <label>
        {t.allergy}
        <select name="allergyStatus" defaultValue={profile.allergyStatus}>
          <option value="unknown">{t.unknown}</option>
          <option value="none-known">{t.none}</option>
          <option value="known">{t.known}</option>
        </select>
      </label>
      {allergies.map((a, i) => (
        <fieldset key={i}>
          <legend>
            {t.allergy} {i + 1}
          </legend>
          {[
            ["substance", "Substance / สารที่แพ้"],
            ["reaction", "Reaction / อาการ"],
            ["source", t.source],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={a[key]}
                onChange={(e) =>
                  setAllergies(
                    allergies.map((x, j) =>
                      j === i ? { ...x, [key]: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => setAllergies(allergies.filter((_, j) => j !== i))}
          >
            Remove / ลบ
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() =>
          setAllergies([
            ...allergies,
            { substance: "", reaction: "", source: "" },
          ])
        }
      >
        Add allergy / เพิ่มประวัติแพ้ยา
      </button>
      <p role="alert">{error}</p>
      <button disabled={readonly}>{t.save}</button>
    </form>
  );
}
