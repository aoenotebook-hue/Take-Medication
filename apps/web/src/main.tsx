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
import { exportPdf, summaryRows, font } from "./pdf";
import { preparePhoto } from "./photo";
import {
  commonMedicines,
  foodOptions,
  formForUnit,
  mealNames,
  mealOf,
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
const deviceId = localStorage.getItem("device-id") || crypto.randomUUID();
localStorage.setItem("device-id", deviceId);
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
const weekdayNames = {
  th: ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};
const formNames: Record<Language, Record<string, string>> = {
  th: {
    tablet: "ยาเม็ด",
    capsule: "แคปซูล",
    liquid: "ยาน้ำ",
    drops: "ยาหยอด",
    injection: "ยาฉีด",
    inhaler: "ยาสูดพ่น",
    topical: "ยาใช้ภายนอก",
    other: "อื่น ๆ",
  },
  en: {
    tablet: "Tablet",
    capsule: "Capsule",
    liquid: "Liquid",
    drops: "Drops",
    injection: "Injection",
    inhaler: "Inhaler",
    topical: "Topical",
    other: "Other",
  },
};
const productNames: Record<Language, Record<string, string>> = {
  th: {
    prescription: "ยาตามใบสั่งแพทย์",
    nonprescription: "ยาที่ซื้อเอง",
    supplement: "อาหารเสริม / สมุนไพร",
  },
  en: {
    prescription: "Prescription",
    nonprescription: "Non-prescription",
    supplement: "Supplement / herbal",
  },
};
function weekdaysText(days: number[], lang: Language) {
  if (days.length === 7) return words[lang].everyDay;
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => weekdayNames[lang][d - 1])
    .join(" ");
}
function when(iso: string | undefined, lang: Language, zone = "Asia/Bangkok") {
  if (!iso) return "—";
  const d = DateTime.fromISO(iso, { zone });
  return d.isValid
    ? d.setLocale(lang).toLocaleString(DateTime.DATETIME_MED)
    : iso;
}
function day(date: string | undefined, lang: Language) {
  if (!date) return "—";
  const d = DateTime.fromISO(date);
  return d.isValid ? d.setLocale(lang).toLocaleString(DateTime.DATE_MED) : date;
}
function statusLabel(status: string, lang: Language) {
  const t = words[lang] as Record<string, string>;
  return status === "unconfirmed"
    ? t.unconfirmed
    : t[status + "Status"] || t[status] || status;
}
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
    [settings, setSettings] = useState(false),
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
    [profileEdit, setProfileEdit] = useState(false),
    [caregiver, setCaregiver] = useState(false),
    [history, setHistory] = useState(false),
    [needsProfile, setNeedsProfile] = useState(false),
    [snoozing, setSnoozing] = useState(""),
    [prnFor, setPrnFor] = useState(""),
    [busy, setBusy] = useState(false);
  const t = words[lang];
  const L = (th: string, en: string) => (lang === "th" ? th : en);
  const syncing = useRef(false);
  const syncAgain = useRef<string | undefined>(undefined);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.style.fontSize = large ? "24px" : "20px";
    localStorage.setItem("language", lang);
    localStorage.setItem("large-text", large ? "1" : "0");
  }, [lang, large]);
  async function loadLocal(id = patient) {
    if (!id) return;
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
        if (!response.ok) throw new Error((await response.json()).error);
        await db.photos.update(p.id, { pending: false });
      }
      const snap = await api("/patients/" + id + "/snapshot");
      await db.snapshots.put({ key: actor + ":" + id, value: snap });
      setS(snap);
      setLang(snap.profile.data.language);
      setReachable(true);
      setMessage("");
      const opaque = location.hash.match(
        /^#notification=([a-f0-9-]{36})$/,
      )?.[1];
      if (opaque) {
        api("/push/observations", {
          jobId: opaque,
          deviceId,
          kind: "opened",
        }).catch(() => {});
        window.history.replaceState(null, "", "/");
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
        if (!(await db.photos.get(p.id))) {
          const r = await fetch("/api/photos/" + p.id, {
            headers: { Authorization: "Bearer " + token },
          });
          if (r.ok)
            await db.photos.put({
              id: p.id,
              patientId: id,
              blob: await r.blob(),
            });
        }
      }
    } catch (e: any) {
      setReachable(false);
      if (e.status === 403) {
        await clearPrivate();
        setS(undefined);
        setPatient("");
        setMessage(
          L(
            "สิทธิ์การเข้าถึงถูกยกเลิก ลบข้อมูลในเครื่องแล้ว",
            "Access revoked. Local app data cleared.",
          ),
        );
      } else setMessage(friendlyError(e, lang));
    } finally {
      syncing.current = false;
      const next = syncAgain.current;
      syncAgain.current = undefined;
      if (next && token) void sync(next);
    }
  }
  async function afterLogin() {
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
        const opaque = location.hash.match(
          /^#notification=([a-f0-9-]{36})$/,
        )?.[1];
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
      const { data } = auth.auth.onAuthStateChange((_e, session) => {
        if (session) {
          token = session.access_token;
          actor = session.user.id;
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
      } catch {
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
          "Offline sign-out: remote device removal is pending. Generic notifications may continue until you reconnect. Continue?",
        )
      )
        return;
      localStorage.setItem("pending-revocation", deviceId);
    }
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
    if (signed && localStorage.getItem("pending-revocation"))
      api("/devices/" + deviceId, undefined, "DELETE")
        .then(() => localStorage.removeItem("pending-revocation"))
        .catch(() => {});
  }, [signed, reachable]);
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
  async function dose(o: any, action: string) {
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
      if (
        /iPhone|iPad/.test(navigator.userAgent) &&
        !matchMedia("(display-mode: standalone)").matches
      )
        throw new Error(t.install);
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted")
        throw new Error(
          L(
            "ไม่ได้รับอนุญาต เปิดได้ที่ การตั้งค่า → การแจ้งเตือน → เพื่อนเรื่องยา บน iPhone",
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
  const languagePicker = (
    <label>
      {t.language}
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Language)}
      >
        <option value="th">ไทย</option>
        <option value="en">English</option>
      </select>
    </label>
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
        <div className="brand-mark" aria-hidden>
          ＋
        </div>
        <h1>เพื่อนเรื่องยา</h1>
        <p className="lead">
          {L(
            "ช่วยจำเวลาใช้ยา เก็บรายการยา และแสดงให้แพทย์ดูได้ง่าย",
            "Remember medicine times, keep your medicine list, and show it to your doctor.",
          )}
        </p>
        {languagePicker}
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
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          ＋ เพื่อนเรื่องยา
        </a>
        <button
          onClick={() => {
            setSettings(true);
            reconcile();
          }}
          aria-label={t.settings}
        >
          ☰ {t.settings}
        </button>
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
        <div
          className={
            "sync " + (pending.length ? "pending" : reachable ? "ok" : "off")
          }
          role="status"
        >
          <span>
            <span aria-hidden>
              {pending.length ? "⏳ " : reachable ? "✓ " : "⚠ "}
            </span>
            {pending.length ? t.pending : reachable ? t.synced : t.offline}
          </span>
          <button onClick={() => sync()}>{t.sync}</button>
        </div>
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
            const open = todays.filter(
              (o) => !["taken", "skipped"].includes(statusOf(o).status),
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
            const groups = [...new Set(open.map((o) => o.local_time))];
            const card = (o: any) => {
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
              return (
                <article
                  key={o.id}
                  className={"medicine-card status-" + p.status}
                >
                  <div className="card-body">
                    <Photo
                      photos={view.photos.filter(
                        (p) => p.medication_id === m.id,
                      )}
                    />
                    <div>
                      <h3>{m.data.name}</h3>
                      {m.data.strength && <p>{m.data.strength}</p>}
                      <p className="dose-amount">
                        {o.data.amount} {o.data.unit}
                        {r?.data.route ? " · " + r.data.route : ""}
                      </p>
                      {r?.data.food && <p>🍽 {r.data.food}</p>}
                      {r?.data.instructions && (
                        <p className="muted">{r.data.instructions}</p>
                      )}
                      <span className="badge">
                        {statusLabel(p.status, lang)}
                        {late ? " · " + L("เลยเวลาแล้ว", "past time") : ""}
                      </span>
                    </div>
                  </div>
                  {pendingRegimen && <p className="warning">{t.pending}</p>}
                  <div className="actions">
                    {p.status === "unconfirmed" ? (
                      snoozing === o.id ? (
                        <>
                          <span>{t.snoozeChoose}</span>
                          {[10, 30].map((minutes) => (
                            <button
                              key={minutes}
                              onClick={async () => {
                                setSnoozing("");
                                await queue("snooze", o.id, 0, {
                                  occurrenceId: o.id,
                                  minutes,
                                });
                              }}
                            >
                              {minutes} {t.minutes}
                            </button>
                          ))}
                          <button onClick={() => setSnoozing("")}>
                            {t.cancel}
                          </button>
                          <small>
                            {L(
                              "เป็นการเตือนซ้ำเท่านั้น ไม่ได้เปลี่ยนเวลาใช้ยา (สูงสุด 2 ครั้ง)",
                              "Reminder only; it does not change the prescribed time (at most twice).",
                            )}
                          </small>
                        </>
                      ) : (
                        <>
                          <button
                            className="primary"
                            disabled={future || locked}
                            onClick={() => dose(o, "taken")}
                          >
                            ✓ {t.taken}
                          </button>
                          <button
                            disabled={future || locked}
                            onClick={() => setSnoozing(o.id)}
                          >
                            {t.later}
                          </button>
                          <button
                            disabled={locked}
                            onClick={() => dose(o, "skipped")}
                          >
                            {t.skip}
                          </button>
                          {future && (
                            <small>
                              {L(
                                "บันทึกได้เมื่อถึงเวลา",
                                "You can record this when it is time",
                              )}
                            </small>
                          )}
                        </>
                      )
                    ) : p.status === "conflict" ? (
                      <>
                        <p>
                          {L(
                            "มีการบันทึกจาก 2 เครื่องไม่ตรงกัน เลือกสถานะที่ถูกต้อง:",
                            "Two devices recorded different results. Choose the correct status:",
                          )}
                        </p>
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
                      </>
                    ) : (
                      <button
                        disabled={view.role === "viewer"}
                        onClick={() => dose(o, "undo")}
                      >
                        {t.undo}
                      </button>
                    )}
                  </div>
                </article>
              );
            };
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
                          {nextGroup[0].local_time}
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
                <p className="muted">
                  {L(
                    "ตรวจสอบคำแนะนำก่อนใช้ยา",
                    "Review your instructions before using medicine",
                  )}
                </p>
                {groups.map((time) => (
                  <section key={time} className="time-group">
                    <h2 className="time-chip">
                      <span aria-hidden>🕒 </span>
                      {time}
                    </h2>
                    {open.filter((o) => o.local_time === time).map(card)}
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
                {done.length > 0 && (
                  <details className="done-group">
                    <summary>
                      {L("บันทึกแล้ว", "Already recorded")} ({done.length})
                    </summary>
                    {done.map(card)}
                  </details>
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
                      <h3>{m.data.name}</h3>
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
            <label>
              {t.search}
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
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
                  </option>
                ))}
              </select>
            </div>
            {view.medications
              .filter(
                (m) =>
                  [m.data.name, m.data.brand, m.data.purpose]
                    .join(" ")
                    .toLowerCase()
                    .includes(search.toLowerCase()) &&
                  (filter === "all" ||
                    (current(m.id)?.data.status || "draft") === filter),
              )
              .sort((a, b) => a.data.name.localeCompare(b.data.name))
              .map((m) => (
                <article className="medicine-card" key={m.id}>
                  <div className="card-body">
                    <Photo
                      photos={view.photos.filter(
                        (p) => p.medication_id === m.id,
                      )}
                    />
                    <div>
                      <h2>{m.data.name}</h2>
                      <p>{m.data.strength}</p>
                      <p>{current(m.id)?.data.instructions || t.draft}</p>
                      {current(m.id)?.data.slots.map((s: any) => (
                        <p key={s.id} className="dose-amount">
                          🕒 {s.time} · {s.amount} {s.unit}
                          {s.weekdays.length < 7
                            ? " · " + weekdaysText(s.weekdays, lang)
                            : ""}
                        </p>
                      ))}
                      <span className="badge">
                        {(t as any)[current(m.id)?.data.status] ||
                          current(m.id)?.data.status ||
                          t.draft}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => setDetail(m)}>{t.view}</button>
                </article>
              ))}
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
        ) : (
          <>
            <div className="heading">
              <h1>{t.doctor}</h1>
              <button
                onClick={async () => {
                  try {
                    await exportPdf(view, pending.length > 0);
                  } catch (e: any) {
                    setMessage(
                      L("สร้าง PDF ไม่สำเร็จ: ", "PDF export failed: ") +
                        e.message,
                    );
                  }
                }}
              >
                {t.pdf}
              </button>
            </div>
            <p className="warning">{t.summary}</p>
            <p>
              <strong>{view.profile.data.displayName}</strong> ·{" "}
              {L("วันเกิด", "DOB")}: {day(view.profile.data.dob, lang)}
            </p>
            <p>
              {t.allergy}:{" "}
              {(t as any)[view.profile.data.allergyStatus] ||
                view.profile.data.allergyStatus}
            </p>
            {view.profile.data.allergies.map((a: any, i: number) => (
              <p key={i}>
                {a.substance} · {a.reaction} · {a.source}
              </p>
            ))}
            <small>
              {L("ข้อมูล ณ", "Data as of")}:{" "}
              {when(view.serverAt, lang, view.profile.data.timezone)} ·{" "}
              {L("ทบทวนล่าสุด", "Last reviewed")}:{" "}
              {view.profile.data.reviewedAt
                ? when(
                    view.profile.data.reviewedAt,
                    lang,
                    view.profile.data.timezone,
                  )
                : t.unknown}
            </small>
            {summaryRows(view).map(({ medicine: m, current: r, future }) => (
              <article key={m.id}>
                <h2>{m.data.name}</h2>
                <p>
                  {[m.data.generic, m.data.brand, m.data.strength]
                    .filter(Boolean)
                    .join(" · ")}
                  {" · "}
                  {formNames[lang][m.data.form] || m.data.form} ·{" "}
                  {productNames[lang][m.data.productType] || m.data.productType}
                </p>
                <p>
                  {statusLabel(r?.data.status || "draft", lang)} ·{" "}
                  {r?.data.route || m.data.route}
                </p>
                <p>
                  {r?.data.instructions ||
                    L("ไม่มีคำแนะนำที่บันทึกไว้", "No instructions recorded")}
                </p>
                {r?.data.slots.map((x: any) => (
                  <p key={x.id}>
                    🕒 {x.time} · {x.amount} {x.unit} ·{" "}
                    {weekdaysText(x.weekdays, lang)}
                  </p>
                ))}
                <p>
                  {r?.data.food ? r.data.food + " · " : ""}
                  {day(r?.data.start, lang)} —{" "}
                  {r?.data.end ? day(r.data.end, lang) : "…"}
                </p>
                <p>
                  {m.data.purpose} · {t.source}:{" "}
                  {r?.data.source || m.data.source}
                </p>
                <span className="badge">
                  {m.data.verified
                    ? L("มีบันทึกการตรวจสอบ", "Verification recorded")
                    : L(
                        "ยังไม่ได้ตรวจสอบโดยผู้เชี่ยวชาญ",
                        "Not professionally verified",
                      )}
                </span>
                {r?.pending && <p className="warning">{t.pending}</p>}
                {future.map((f) => (
                  <p key={f.id}>
                    {t.future}:{" "}
                    {when(f.effective_at, lang, view.profile.data.timezone)} ·{" "}
                    {f.data.instructions}
                  </p>
                ))}
              </article>
            ))}
          </>
        )}
      </main>
      <nav aria-label="Main navigation">
        {[
          ["today", "◷", t.today],
          ["medicines", "▤", t.medicines],
          ["doctor", "▧", t.doctor],
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
      {editing && view && (
        <Modal
          title={
            (editing.version ? L("แก้ไขยา", "Edit medicine") : t.add) +
            " · " +
            view.profile.data.displayName
          }
          closeLabel={L("ปิด", "Close")}
          close={() => setEditing(undefined)}
        >
          <MedicineForm
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
          <Photo
            photos={view.photos.filter((p) => p.medication_id === detail.id)}
          />
          <p>
            {[
              detail.data.strength,
              formNames[lang][detail.data.form],
              detail.data.route,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {detail.data.purpose && (
            <p>
              {t.purpose}: {detail.data.purpose}
            </p>
          )}
          <p>{current(detail.id)?.data.instructions}</p>
          {current(detail.id)?.data.slots.map((x: any) => (
            <p key={x.id} className="dose-amount">
              🕒 {x.time} · {x.amount} {x.unit} ·{" "}
              {weekdaysText(x.weekdays, lang)}
            </p>
          ))}
          <p>
            {t.status}:{" "}
            <span className="badge">
              {statusLabel(current(detail.id)?.data.status || "draft", lang)}
            </span>
          </p>
          <div className="actions">
            <button
              className="primary"
              disabled={view.role === "viewer"}
              onClick={() => {
                setEditing(detail);
                setDetail(undefined);
              }}
            >
              ✎ {L("แก้ไขข้อมูลยา", "Edit medicine")}
            </button>
            {(
              [
                ["paused", L("พักการใช้ยา", "Pause")],
                ["active", L("กลับมาใช้ยา", "Resume")],
                ["stopped", L("หยุดใช้ยา", "Stop")],
              ] as const
            )
              .filter(([status]) => {
                const now = current(detail.id)?.data.status;
                return status === "paused"
                  ? now === "active" || now === "as-needed"
                  : status === "active"
                    ? now === "paused" || now === "stopped"
                    : now !== "stopped";
              })
              .map(([status, label]) => (
                <button
                  key={status}
                  disabled={view.role === "viewer" || !current(detail.id)}
                  onClick={async () => {
                    const r = current(detail.id)?.data;
                    if (
                      r &&
                      confirm(
                        label +
                          " " +
                          detail.data.name +
                          "? " +
                          L(
                            "การแจ้งเตือนจากเซิร์ฟเวอร์จะเปลี่ยนหลังซิงค์ข้อมูลแล้ว ประวัติเดิมยังเก็บไว้",
                            "Server reminders change after synchronization. History is kept.",
                          ),
                      )
                    ) {
                      try {
                        await queue("regimen", detail.id, detail.version, {
                          ...r,
                          status,
                          effectiveAt: new Date().toISOString(),
                          effectiveMode: "on-commit",
                          reason: status,
                        });
                      } catch {
                        /* queue reports storage failures */
                      }
                    }
                    setDetail(undefined);
                  }}
                >
                  {label}
                </button>
              ))}
          </div>
          <h2>{t.history}</h2>
          {[...view.regimens, ...(view.retiredRegimens || [])]
            .filter((r) => r.medication_id === detail.id)
            .sort(
              (a, b) => Date.parse(b.effective_at) - Date.parse(a.effective_at),
            )
            .map((r) => (
              <article key={r.id}>
                <p>
                  <strong>
                    {when(r.effective_at, lang, view.profile.data.timezone)}
                  </strong>{" "}
                  · {statusLabel(r.data.status, lang)}{" "}
                  {r.pending
                    ? L("(รอซิงค์)", "(pending)")
                    : r.replacement_id
                      ? L("(ถูกแทนที่แล้ว)", "(superseded)")
                      : ""}
                </p>
                <p>{r.data.instructions}</p>
                {(r.data.source || r.data.reason) && (
                  <p className="muted">
                    {[r.data.source, r.data.reason].filter(Boolean).join(" · ")}
                  </p>
                )}
              </article>
            ))}
        </Modal>
      )}
      {settings && view && (
        <Modal
          title={t.settings + " · " + view.profile.data.displayName}
          close={() => setSettings(false)}
          closeLabel={L("ปิด", "Close")}
        >
          <section className="settings-group">
            <h3>{L("การแสดงผล", "Display")}</h3>
            <label>
              {t.language}
              <select
                value={lang}
                onChange={(e) => {
                  setLang(e.target.value as Language);
                  if (view.role === "owner")
                    queue("profile", patient, view.profile.version, {
                      ...view.profile.data,
                      language: e.target.value,
                    }).catch(() => {});
                }}
              >
                <option value="th">ไทย</option>
                <option value="en">English</option>
              </select>
            </label>
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
            <p>{t.install}</p>
            <ol className="install-guide">
              <li>
                <span aria-hidden>↑</span>
                {L("Safari: กดปุ่มแชร์", "Safari: tap Share")}
              </li>
              <li>
                <span aria-hidden>＋</span>
                {L("เพิ่มไปยังหน้าจอโฮม", "Add to Home Screen")}
              </li>
              <li>
                <span aria-hidden>▣</span>
                {L("เปิดแอปจากไอคอนใหม่", "Open the app from the new icon")}
              </li>
            </ol>
            <ul className="checklist">
              {(
                [
                  [
                    matchMedia("(display-mode: standalone)").matches,
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
                    L("ลงทะเบียนกับเซิร์ฟเวอร์แล้ว", "Registered with server"),
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
              <li>
                {L("ซิงค์ล่าสุด", "Last server sync")}:{" "}
                {when(view.serverAt, lang, view.profile.data.timezone)}
              </li>
            </ul>
            <button className="primary" onClick={reminders}>
              {t.enable}
            </button>
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
                const job = (await db.meta.get("last-test:" + deviceId))?.value;
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
                  const data = await api("/account/export", {});
                  download(
                    JSON.stringify(data, null, 2),
                    "medication-account.json",
                    "application/json",
                  );
                } catch (e: any) {
                  setMessage(friendlyError(e, lang));
                }
              }}
            >
              {t.export}
            </button>
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
          />
        </Modal>
      )}
    </>
  );
}
function download(data: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Photo({ photos }: { photos: any[] }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let u = "";
    if (photos[0])
      db.photos.get(photos[0].id).then((p) => {
        if (p) {
          u = URL.createObjectURL(p.blob);
          setUrl(u);
        }
      });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [photos[0]?.id]);
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
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog ref={ref} onCancel={close}>
      <div className="heading">
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
  t,
  lang,
  medicine,
  regimen,
  all,
  onSave,
}: {
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
      start?.slots?.[0]?.amount || "",
    ),
    [unit, setUnitState] = useState<string>(start?.slots?.[0]?.unit || ""),
    [days, setDays] = useState<number[]>(
      start?.slots?.[0]?.weekdays || [1, 2, 3, 4, 5, 6, 7],
    ),
    [someDays, setSomeDays] = useState(
      (start?.slots?.[0]?.weekdays?.length || 7) < 7,
    );
  useEffect(() => {
    db.drafts.get(medicine.id).then((d) => {
      if (d && !medicine.proposed && d.value.v === 2) {
        setM(d.value.m);
        setR(d.value.r);
        setAmountState(d.value.amount);
        setUnitState(d.value.unit);
        setAsNeeded(d.value.asNeeded);
        setDays(d.value.days);
        setSomeDays(d.value.days.length < 7);
        if (d.value.file) setFile(d.value.file);
      }
    });
  }, []);
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
        value: { v: 2, m, r, amount, unit, asNeeded, days, file },
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
}: {
  patient: string;
  owner: boolean;
  api: typeof window.fetch | any;
  lang: Language;
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
            setMessage(
              L(
                "ยอมรับแล้ว ปิดแล้วเปิดแอปใหม่เพื่อเลือกผู้ป่วย",
                "Accepted. Reopen app to select patient.",
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
