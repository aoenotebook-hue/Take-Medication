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
    throw Object.assign(new Error(e.error), { status: r.status });
  }
  return r.json();
}
let localSequence = Date.now() * 1000;
function App() {
  const [lang, setLang] = useState<Language>("th"),
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
    [byTime, setByTime] = useState(false),
    [devices, setDevices] = useState<any[]>([]),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [otpSent, setOtpSent] = useState(false),
    [seen, setSeen] = useState(false),
    [registered, setRegistered] = useState(false),
    [permission, setPermission] = useState(
      typeof Notification !== "undefined"
        ? Notification.permission
        : "unsupported",
    ),
    [large, setLarge] = useState(false),
    [profileEdit, setProfileEdit] = useState(false),
    [caregiver, setCaregiver] = useState(false),
    [history, setHistory] = useState(false);
  const t = words[lang];
  const syncing = useRef(false);
  const syncAgain = useRef<string | undefined>(undefined);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.style.fontSize = large ? "24px" : "20px";
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
        setMessage("Access revoked. Local app data cleared.");
      } else setMessage(e.message);
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
      } else {
        const displayName = prompt(t.profile);
        if (displayName) {
          const p = await api("/patients", { displayName });
          setPatient(p.id);
          await sync(p.id);
        }
      }
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
      } else setMessage(e.message);
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
      setMessage("Storage failed: " + e.message);
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
        "Backdated record for " + o.local_date + " " + o.local_time + "?",
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
          "This browser does not support reminders. " + t.install,
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
          "Permission denied. Change notification permission in phone settings.",
        );
      const config = await api("/push/config");
      if (!config.publicKey)
        throw new Error("VAPID keys are not configured on the server");
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
      await reconcile();
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  if (!signed)
    return (
      <main className="welcome">
        <div className="brand-mark">＋</div>
        <h1>เพื่อนเรื่องยา</h1>
        <p>Medication Companion</p>
        <p>{t.privacy}</p>
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
                setMessage(e.message);
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
              try {
                if (!otpSent) {
                  const { error } = await auth.auth.signInWithOtp({
                    email,
                    options: { shouldCreateUser: true },
                  });
                  if (error) throw error;
                  setOtpSent(true);
                } else {
                  const { data, error } = await auth.auth.verifyOtp({
                    email,
                    token: code,
                    type: "email",
                  });
                  if (error) throw error;
                  token = data.session!.access_token;
                  actor = data.user!.id;
                  await afterLogin();
                }
              } catch (e: any) {
                setMessage(e.message);
              }
            }}
          >
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {otpSent && (
              <label>
                One-time code
                <input
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                />
              </label>
            )}
            <button>{t.login}</button>
          </form>
        ) : (
          <p>
            Managed sign-in requires Supabase configuration. Demo uses synthetic
            data only.
          </p>
        )}
        <p role="alert">{message}</p>
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
              {t.profile}
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
              .toLocaleString(DateTime.DATE_FULL)}{" "}
            · {view?.profile.data.timezone}
          </small>
          {view &&
            Intl.DateTimeFormat().resolvedOptions().timeZone !==
              view.profile.data.timezone && (
              <p className="warning">
                Device: {Intl.DateTimeFormat().resolvedOptions().timeZone}.
                Schedule stays in {view.profile.data.timezone}. Edit a future
                regimen to change timezone.
              </p>
            )}
        </section>
        <div className="sync" role="status">
          {pending.length ? t.pending : reachable ? t.synced : t.offline}
          <button onClick={() => sync()}>{t.sync}</button>
        </div>
        {view?.scheduleIssues?.map((issue) => (
          <p key={issue.medication_id} className="warning">
            Schedule requires review / ต้องตรวจสอบเวลา: {issue.reason} ·{" "}
            {
              view.medications.find((m) => m.id === issue.medication_id)?.data
                .name
            }
          </p>
        ))}
        {message && (
          <p role="alert" className="warning">
            {message}
            <button onClick={() => setMessage("")}>×</button>
          </p>
        )}
        {pending
          .filter((o) => o.state !== "queued")
          .map((o) => (
            <article className="warning" key={o.id}>
              <strong>{t.conflict}</strong>
              <p>{o.error}</p>
              <pre>{JSON.stringify(o.current?.data, null, 2)}</pre>
              <button
                onClick={async () => {
                  await db.outbox.delete(o.id);
                  await loadLocal();
                }}
              >
                Discard local proposal
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
                Review current and proposal
              </button>
            </article>
          ))}
        {!view ? (
          <p>Loading cached patient data…</p>
        ) : tab === "today" ? (
          <>
            <div className="heading">
              <h1>{t.today}</h1>
              <button onClick={() => setHistory(!history)}>{t.history}</button>
            </div>
            <p className="muted">
              {lang === "th"
                ? "ตรวจสอบคำแนะนำก่อนใช้ยา"
                : "Review your instructions before using medicine"}
            </p>
            <p>
              {lang === "th" ? "กลุ่มเวลาถัดไป" : "Next scheduled group"}:{" "}
              {view.occurrences
                .filter(
                  (o) =>
                    o.valid &&
                    Date.parse(o.intended_at) > Date.now() &&
                    projectDose(
                      view.events.filter((e) => e.occurrence_id === o.id),
                    ).status === "unconfirmed",
                )
                .sort(
                  (a, b) =>
                    Date.parse(a.intended_at) - Date.parse(b.intended_at),
                )[0]?.local_time || "—"}
            </p>
            {view.occurrences
              .filter(
                (o) =>
                  o.valid &&
                  o.local_date ===
                    DateTime.now().setZone(o.timezone).toISODate(),
              )
              .sort((a, b) => {
                const recorded = (o: any) =>
                  ["taken", "skipped"].includes(
                    projectDose(
                      view.events.filter((e) => e.occurrence_id === o.id),
                    ).status,
                  );
                return (
                  Number(recorded(a)) - Number(recorded(b)) ||
                  Date.parse(a.intended_at) - Date.parse(b.intended_at)
                );
              })
              .map((o) => {
                const m = view.medications.find(
                    (m) => m.id === o.medication_id,
                  ),
                  r = s?.regimens.find((r) => r.id === o.regimen_id),
                  p = projectDose(
                    view.events.filter((e) => e.occurrence_id === o.id),
                  );
                if (!m) return null;
                const future = Date.parse(o.intended_at) > Date.now();
                const pendingRegimen = pending.some(
                  (x) => x.kind === "regimen" && x.resourceId === m.id,
                );
                return (
                  <details
                    key={o.id}
                    open={p.status === "unconfirmed" || p.status === "conflict"}
                    className="dose-detail"
                  >
                    <summary>
                      {o.local_time} · {m.data.name} ·{" "}
                      {p.status === "unconfirmed"
                        ? t.unconfirmed
                        : (t as any)[p.status] || p.status}
                    </summary>
                    <article className="medicine-card">
                      <div className="time-chip">
                        {o.local_time} · {o.timezone}
                      </div>
                      <div className="card-body">
                        <Photo
                          photos={view.photos.filter(
                            (p) => p.medication_id === m.id,
                          )}
                        />
                        <div>
                          <h2>{m.data.name}</h2>
                          <p>{m.data.strength}</p>
                          <strong>
                            {o.data.amount} {o.data.unit} · {r?.data.route}
                          </strong>
                          <p>{r?.data.food}</p>
                          <p>{r?.data.instructions}</p>
                          <span className="badge">
                            {p.status === "unconfirmed"
                              ? t.unconfirmed
                              : p.status}
                          </span>
                        </div>
                      </div>
                      {pendingRegimen && <p className="warning">{t.pending}</p>}
                      <div className="actions">
                        {p.status === "unconfirmed" ? (
                          <>
                            <button
                              className="primary"
                              disabled={
                                future ||
                                view.role === "viewer" ||
                                pendingRegimen
                              }
                              onClick={() => dose(o, "taken")}
                            >
                              {t.taken}
                            </button>
                            <button
                              disabled={
                                view.role === "viewer" || pendingRegimen
                              }
                              onClick={() => dose(o, "skipped")}
                            >
                              {t.skip}
                            </button>
                            <button
                              disabled={
                                future ||
                                view.role === "viewer" ||
                                pendingRegimen
                              }
                              onClick={async () => {
                                const minutes =
                                  prompt(
                                    "Reminder only: 10 or 30 minutes (maximum twice; expires 15 minutes after scheduled time)",
                                  ) || "";
                                if (["10", "30"].includes(minutes))
                                  await queue("snooze", o.id, 0, {
                                    occurrenceId: o.id,
                                    minutes: Number(minutes),
                                  });
                              }}
                            >
                              {t.later}
                            </button>
                          </>
                        ) : p.status === "conflict" ? (
                          <button
                            onClick={async () => {
                              const status = prompt(
                                "Review both device records. Resolved status: taken, skipped, unconfirmed",
                              );
                              if (
                                ["taken", "skipped", "unconfirmed"].includes(
                                  status || "",
                                )
                              )
                                await queue("dose", o.id, 0, {
                                  occurrenceId: o.id,
                                  medicationId: m.id,
                                  action: "resolve",
                                  status,
                                  baseEventIds: p.heads,
                                });
                            }}
                          >
                            Review dose conflict
                          </button>
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
                  </details>
                );
              })}
            {!view.occurrences.some(
              (o) =>
                o.valid &&
                o.local_date === DateTime.now().setZone(o.timezone).toISODate(),
            ) && <div className="empty">{t.empty}</div>}
            <h2>{t.prn}</h2>
            {view.medications
              .filter((m) => current(m.id)?.data.status === "as-needed")
              .map((m) => (
                <article key={m.id}>
                  <h3>{m.data.name}</h3>
                  <p>{current(m.id)?.data.instructions}</p>
                  <button
                    disabled={view.role === "viewer"}
                    onClick={async () => {
                      const at = prompt(
                        "Actual administration time (ISO timestamp)",
                        new Date().toISOString(),
                      );
                      if (at)
                        await queue("dose", m.id, 0, {
                          occurrenceId: null,
                          medicationId: m.id,
                          action: "as-needed",
                          baseEventIds: [],
                          actualAt: at,
                        });
                    }}
                  >
                    {t.prnRecord}
                  </button>
                </article>
              ))}
            {history && (
              <section>
                <h2>{t.history}</h2>
                {view.events.map((e) => (
                  <p key={e.id}>
                    {e.action} · {e.actual_at || e.client_at} · {e.id}{" "}
                    {e.pending ? "(pending)" : ""}
                  </p>
                ))}
                <p>Self-reported records do not prove administration.</p>
              </section>
            )}
          </>
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
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="filters">
              <button onClick={() => setByTime(!byTime)}>
                {byTime ? t.bytime : t.bymedicine}
              </button>
              <select
                aria-label={t.status}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {[
                  "active",
                  "as-needed",
                  "paused",
                  "stopped",
                  "draft",
                  "reference",
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
              .sort((a, b) =>
                byTime
                  ? (current(a.id)?.data.slots[0]?.time || "").localeCompare(
                      current(b.id)?.data.slots[0]?.time || "",
                    )
                  : a.data.name.localeCompare(b.data.name),
              )
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
                      <p>
                        {current(m.id)
                          ?.data.slots.map(
                            (s: any) =>
                              s.time + " · " + s.amount + " " + s.unit,
                          )
                          .join(" / ")}
                      </p>
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
                <p>Manual entry works without a photo.</p>
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
                    setMessage("PDF export failed: " + e.message);
                  }
                }}
              >
                {t.pdf}
              </button>
            </div>
            <p className="warning">{t.summary}</p>
            <p>
              {view.profile.data.displayName} ·{" "}
              {view.profile.data.dob || "DOB: —"}
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
              Snapshot: {view.serverAt} · Review:{" "}
              {view.profile.data.reviewedAt || "Unknown"} · {view.role}
            </small>
            {summaryRows(view).map(({ medicine: m, current: r, future }) => (
              <article key={m.id}>
                <h2>{m.data.name}</h2>
                <p>
                  {m.data.generic} {m.data.brand} · {m.data.strength} ·{" "}
                  {m.data.form} · {m.data.productType}
                </p>
                <p>
                  {r?.data.status || t.draft} · {r?.data.route || m.data.route}
                </p>
                <p>{r?.data.instructions || "Unknown instructions"}</p>
                <p>
                  {r?.data.slots
                    .map(
                      (x: any) =>
                        `${x.time} · ${x.amount} ${x.unit} · days ${x.weekdays.join(",")}`,
                    )
                    .join(" / ")}
                </p>
                <p>
                  {r?.data.food} · {r?.data.start} — {r?.data.end || "—"} ·{" "}
                  {r?.data.timezone}
                </p>
                <p>
                  {m.data.purpose} · {t.source}:{" "}
                  {r?.data.source || m.data.source}
                </p>
                <span className="badge">
                  {m.data.verified
                    ? "Verification recorded"
                    : "Unverified / ยังไม่ตรวจสอบ"}
                </span>
                {r?.pending && <p className="warning">{t.pending}</p>}
                {future.map((f) => (
                  <p key={f.id}>
                    {t.future}: {f.effective_at} · {f.data.instructions}
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
          title={t.review + " · " + view.profile.data.displayName}
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
                    "Is this only a spelling/label correction of the same medicine? For a different medicine, cancel and add a new record.",
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
                  throw new Error("Use JPEG, PNG or WebP, at most 8 MB");
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
            }}
          />
        </Modal>
      )}
      {detail && view && (
        <Modal
          title={detail.data.name + " · " + view.profile.data.displayName}
          close={() => setDetail(undefined)}
        >
          <Photo
            photos={view.photos.filter((p) => p.medication_id === detail.id)}
          />
          <p>
            {detail.data.strength} · {detail.data.route}
          </p>
          <p>{current(detail.id)?.data.instructions}</p>
          <button
            disabled={view.role === "viewer"}
            onClick={() => {
              setEditing(detail);
              setDetail(undefined);
            }}
          >
            {t.review}
          </button>
          {["paused", "active", "stopped"].map((status) => (
            <button
              key={status}
              disabled={view.role === "viewer" || !current(detail.id)}
              onClick={async () => {
                const r = current(detail.id)?.data;
                if (
                  r &&
                  confirm(
                    `${status}: server reminders change only after synchronization. Confirm?`,
                  )
                )
                  await queue("regimen", detail.id, detail.version, {
                    ...r,
                    status,
                    effectiveAt: new Date().toISOString(),
                    effectiveMode: "on-commit",
                    reason: status,
                  });
                setDetail(undefined);
              }}
            >
              {(t as any)[status]}
            </button>
          ))}
          <h2>{t.history}</h2>
          {[...view.regimens, ...(view.retiredRegimens || [])]
            .filter((r) => r.medication_id === detail.id)
            .sort(
              (a, b) => Date.parse(a.effective_at) - Date.parse(b.effective_at),
            )
            .map((r) => (
              <article key={r.id}>
                <p>
                  {r.effective_at} · {r.data.status}{" "}
                  {r.pending
                    ? "Pending"
                    : r.replacement_id
                      ? "Superseded / ถูกแทนที่"
                      : ""}
                </p>
                <p>{r.data.instructions}</p>
                <p>
                  {r.data.source} · {r.data.reason} · {r.actor_id}
                </p>
              </article>
            ))}
        </Modal>
      )}
      {settings && view && (
        <Modal
          title={t.settings + " · " + view.profile.data.displayName}
          close={() => setSettings(false)}
        >
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
                  });
              }}
            >
              <option value="th">ไทย</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={large}
              onChange={(e) => setLarge(e.target.checked)}
            />
            Large text / ตัวอักษรใหญ่
          </label>
          <button onClick={() => setProfileEdit(true)}>{t.profile}</button>
          <button onClick={() => setCaregiver(true)}>{t.caregiver}</button>
          <h2>{t.enable}</h2>
          <p>{t.install}</p>
          <ol className="install-guide">
            <li>
              <span aria-hidden>↑</span>Safari: Share / แชร์
            </li>
            <li>
              <span aria-hidden>＋</span>Add to Home Screen /
              เพิ่มไปยังหน้าจอโฮม
            </li>
            <li>
              <span aria-hidden>▣</span>Open the new icon / เปิดจากไอคอนใหม่
            </li>
          </ol>
          <ol>
            <li>
              Home Screen / หน้าจอโฮม:{" "}
              {matchMedia("(display-mode: standalone)").matches
                ? "installed"
                : "not detected"}
            </li>
            <li>Permission / การอนุญาต: {permission}</li>
            <li>
              Subscription / การลงทะเบียน:{" "}
              {registered
                ? "registered on server / ลงทะเบียนบนเซิร์ฟเวอร์แล้ว"
                : "not registered"}
            </li>
            <li>
              Test / ทดสอบ:{" "}
              {seen
                ? "user confirmed / ผู้ใช้ยืนยันแล้ว"
                : "not confirmed / ยังไม่ยืนยัน"}
            </li>
            <li>Server sync: {view.serverAt}</li>
          </ol>
          <button onClick={reminders}>{t.enable}</button>
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
                  "Test " +
                    r.state +
                    " — provider acceptance does not prove display.",
                );
              } catch (e: any) {
                setMessage(e.message);
              }
            }}
          >
            {t.test}
          </button>
          <button
            onClick={async () => {
              const job = (await db.meta.get("last-test:" + deviceId))?.value;
              if (!job) {
                setMessage("Send a test first / ส่งทดสอบก่อน");
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
                setMessage(e.message);
              }
            }}
          >
            {t.seen}
          </button>
          <p>
            No exact-time guarantee. Focus/silent mode and connectivity affect
            display. Offline dose logs cannot immediately stop server reminders.
          </p>
          {devices.map((d) => (
            <p key={d.id}>
              {d.label} · {d.revoked_at ? "revoked" : "registered"}{" "}
              <button
                onClick={async () => {
                  await api("/devices/" + d.id, undefined, "DELETE");
                  await reconcile();
                }}
              >
                Revoke
              </button>
            </p>
          ))}
          <p>{t.privacy}</p>
          <button
            onClick={async () => {
              const result = await navigator.storage?.persist?.();
              setMessage(
                "Storage persistence: " +
                  Boolean(result) +
                  "; this is not a backup.",
              );
            }}
          >
            Request persistent storage
          </button>
          <button
            disabled={view.role !== "owner"}
            onClick={async () => {
              const data = await api("/account/export", {});
              download(
                JSON.stringify(data, null, 2),
                "medication-account.json",
                "application/json",
              );
            }}
          >
            {t.export}
          </button>
          <button
            disabled={view.role !== "owner"}
            onClick={async () => {
              if (
                prompt("Sign in again first. Type DELETE to delete account") !==
                "DELETE"
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
                setMessage(e.message);
              }
            }}
          >
            {t.delete}
          </button>
          <button onClick={logout}>{t.logout}</button>
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
  children,
}: {
  title: string;
  close: () => void;
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
        <button onClick={close} aria-label="Close">
          ×
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
  const [step, setStep] = useState(0),
    [error, setError] = useState(""),
    [file, setFile] = useState<File>();
  const [m, setM] = useState(
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
  const [r, setR] = useState<any>(
    medicine.proposed || {
      ...regimen,
      status: regimen?.status || "draft",
      instructions: regimen?.instructions || "",
      food: regimen?.food || "",
      route: regimen?.route || "",
      timezone: regimen?.timezone || "Asia/Bangkok",
      start:
        regimen?.start || DateTime.now().setZone("Asia/Bangkok").toISODate(),
      end: regimen?.end,
      slots: regimen?.slots || [],
      confirmed: false,
      source: regimen?.source || "",
      reason: "",
      effectiveAt: new Date().toISOString(),
      effectiveMode: "on-commit",
    },
  );
  useEffect(() => {
    db.drafts.get(medicine.id).then((d) => {
      if (d && !medicine.proposed) {
        setM(d.value.m);
        setR(d.value.r);
        if (d.value.file) setFile(d.value.file);
      }
    });
  }, []);
  const updateM = (key: string, v: any) =>
    setM((old: any) => ({ ...old, [key]: v }));
  const updateR = (key: string, v: any) =>
    setR((old: any) => ({ ...old, [key]: v }));
  const persist = async () => {
    try {
      await db.drafts.put({ id: medicine.id, value: { m, r, file } });
    } catch {
      setError("Draft storage failed. Keep original instructions.");
    }
  };
  const field = (label: string, key: string, target = "m", type = "text") => (
    <label>
      {label}
      <input
        type={type}
        value={(target === "m" ? m : r)[key] || ""}
        onChange={(e) =>
          target === "m"
            ? updateM(key, e.target.value)
            : updateR(key, e.target.value)
        }
        onBlur={persist}
      />
    </label>
  );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (step < 4) {
          await persist();
          setStep(step + 1);
          return;
        }
        try {
          const med = medicationSchema.parse(m),
            reg = regimenSchema.parse({
              ...r,
              route: r.route || m.route,
              end: r.end || undefined,
            });
          if (
            all.some(
              (a) =>
                a.id !== medicine.id &&
                a.data.name === m.name &&
                a.data.strength === m.strength,
            ) &&
            !confirm(
              "Possible duplicate name/strength. Review before continuing. Save anyway?",
            )
          )
            return;
          await onSave(med, reg, file);
        } catch (e: any) {
          setError(e.message);
        }
      }}
    >
      <p>
        {step + 1} / 5 · {[t.photo, t.name, t.amount, t.time, t.review][step]}
      </p>
      {step === 0 ? (
        <>
          <label>
            {t.photo}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </label>
          <label>
            Camera / กล้อง
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </label>
          <p>
            Optional. JPEG, PNG or WebP, 8 MB maximum. HEIC: export as JPEG.
          </p>
        </>
      ) : step === 1 ? (
        <>
          {field(t.name, "name")}
          {field(
            lang === "th" ? "ชื่อสามัญ (ถ้าทราบ)" : "Generic name (if known)",
            "generic",
          )}
          {field(
            lang === "th" ? "ยี่ห้อ (ถ้าทราบ)" : "Brand (if known)",
            "brand",
          )}
          {field(t.strength, "strength")}
          <label>
            Form
            <select
              value={m.form}
              onChange={(e) => updateM("form", e.target.value)}
            >
              {[
                "tablet",
                "capsule",
                "liquid",
                "drops",
                "injection",
                "inhaler",
                "topical",
                "other",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Product type
            <select
              value={m.productType}
              onChange={(e) => updateM("productType", e.target.value)}
            >
              {["prescription", "nonprescription", "supplement"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          {field(t.purpose, "purpose")}
          {field(t.source, "source")}
        </>
      ) : step === 2 ? (
        <>
          {field(t.route, "route")}
          {field(t.instructions, "instructions", "r")}
          {field(t.food, "food", "r")}
          <p>
            Copy original instructions. The app does not convert concentrations
            or assess splitting suitability.
          </p>
        </>
      ) : step === 3 ? (
        <>
          <label>
            {t.status}
            <select
              value={r.status}
              onChange={(e) => updateR("status", e.target.value)}
            >
              {[
                "draft",
                "active",
                "as-needed",
                "reference",
                "paused",
                "stopped",
              ].map((x) => (
                <option value={x} key={x}>
                  {(t as any)[x] || x}
                </option>
              ))}
            </select>
          </label>
          {field(t.start, "start", "r", "date")}
          {field(t.end, "end", "r", "date")}
          {field(t.timezone, "timezone", "r")}
          <label>
            {t.effective}
            <select
              value={r.effectiveMode || "at-time"}
              onChange={(e) => updateR("effectiveMode", e.target.value)}
            >
              <option value="on-commit">
                When the server confirms / เมื่อเซิร์ฟเวอร์ยืนยัน
              </option>
              <option value="at-time">
                Selected date and time / วันที่และเวลาที่เลือก
              </option>
            </select>
          </label>
          {r.effectiveMode !== "on-commit" &&
            field(t.effective + " (ISO, UTC or offset)", "effectiveAt", "r")}
          {r.slots.map((s: any, i: number) => (
            <fieldset key={s.id}>
              <legend>Slot {i + 1}</legend>
              {[
                ["time", t.time, "time"],
                ["amount", t.amount, "text"],
                ["unit", t.unit, "text"],
              ].map(([key, label, type]) => (
                <label key={key}>
                  {label}
                  <input
                    type={type}
                    value={s[key]}
                    onChange={(e) =>
                      updateR(
                        "slots",
                        r.slots.map((x: any, j: number) =>
                          j === i ? { ...x, [key]: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
              ))}
              <label>
                Weekdays (1 Monday — 7 Sunday)
                <input
                  value={s.weekdays.join(",")}
                  onChange={(e) =>
                    updateR(
                      "slots",
                      r.slots.map((x: any, j: number) =>
                        j === i
                          ? {
                              ...x,
                              weekdays: e.target.value.split(",").map(Number),
                            }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  updateR(
                    "slots",
                    r.slots.filter((_: any, j: number) => j !== i),
                  )
                }
              >
                Remove slot
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() =>
              updateR("slots", [
                ...r.slots,
                {
                  id: crypto.randomUUID(),
                  time: "",
                  amount: "",
                  unit: "",
                  weekdays: [1, 2, 3, 4, 5, 6, 7],
                },
              ])
            }
          >
            Add exact time / เพิ่มเวลา
          </button>
          {r.status === "as-needed" && (
            <>
              {field(
                "Clinician indication (if supplied)",
                "prnIndication",
                "r",
              )}
              {field("Interval (if supplied)", "prnInterval", "r")}
              {field("Maximum (if supplied)", "prnMaximum", "r")}
              <p>No routine reminders; no safety calculations.</p>
            </>
          )}
        </>
      ) : (
        <>
          <h3>
            {m.name} · {m.strength}
          </h3>
          {medicine.data && (
            <p>
              Before: {regimen?.instructions} ·{" "}
              {regimen?.slots
                .map((s: any) => s.time + " " + s.amount + " " + s.unit)
                .join(", ")}
            </p>
          )}
          <p>
            {r.instructions} · {m.route} · {r.food}
          </p>
          <p>
            {r.slots
              .map(
                (s: any) =>
                  `${s.time}: ${s.amount} ${s.unit} (${s.weekdays.join(",")})`,
              )
              .join(" / ")}
          </p>
          <p>
            {r.start} — {r.end || "—"} · {r.timezone} · {r.status}
          </p>
          <p>
            {t.effective}:{" "}
            {r.effectiveMode === "on-commit"
              ? "When the server confirms / เมื่อเซิร์ฟเวอร์ยืนยัน"
              : r.effectiveAt}
          </p>
          {field(t.source, "source", "r")}
          {field("Reason for change", "reason", "r")}
          <label>
            <input
              type="checkbox"
              checked={r.confirmed}
              onChange={(e) => updateR("confirmed", e.target.checked)}
            />
            {t.confirm}
          </label>
          <p>This is patient confirmation, not professional verification.</p>
        </>
      )}
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
      <div className="actions">
        {step > 0 && (
          <button type="button" onClick={() => setStep(step - 1)}>
            ← Back
          </button>
        )}
        <button className="primary">{step === 4 ? t.save : t.next}</button>
      </div>
      <button
        type="button"
        onClick={async () => {
          await persist();
          setError("Draft saved on this phone");
        }}
      >
        {t.draft}
      </button>
    </form>
  );
}
function Caregivers({
  patient,
  owner,
  api,
}: {
  patient: string;
  owner: boolean;
  api: typeof window.fetch | any;
}) {
  const [list, setList] = useState<any[]>([]),
    [message, setMessage] = useState("");
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
        Invited caregivers use their own account. Editing access does not enable
        reminders. Previously downloaded information cannot be recalled from
        offline devices.
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
                "Share this single-use token privately (48 hours): " + r.token,
              );
            } catch (e: any) {
              setMessage(e.message);
            }
          }}
        >
          <label>
            Email
            <input type="email" name="email" required />
          </label>
          <label>
            Role
            <select name="role">
              <option>viewer</option>
              <option>editor</option>
            </select>
          </label>
          <button>Create invitation</button>
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
            setMessage("Accepted. Reopen app to select patient.");
          } catch (e: any) {
            setMessage(e.message);
          }
        }}
      >
        <label>
          Invitation token
          <input name="token" required />
        </label>
        <label>
          <input type="checkbox" name="agreed" required />I agree to access this
          profile
        </label>
        <button>Accept invitation</button>
      </form>
      {list.map((m) => (
        <p key={m.user_id}>
          {m.user_id} · {m.role}{" "}
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
                Change role
              </button>
              <button
                onClick={async () => {
                  await api(
                    "/patients/" + patient + "/memberships/" + m.user_id,
                    undefined,
                    "DELETE",
                  );
                  load();
                }}
              >
                Revoke
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
          setError(e.message);
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
