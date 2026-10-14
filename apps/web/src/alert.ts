// Sound and vibration for reminders while the app is open. Notifications that
// arrive while the app is closed use the phone's own notification sound.
export type AlertKind = "reminder" | "snooze";

let audio: AudioContext | undefined;
/** Browsers only allow sound after a tap, so prepare it on the first tap. */
export function unlockAudio() {
  const start = () => {
    try {
      const Ctx =
        window.AudioContext || (window as any).webkitAudioContext || undefined;
      if (!Ctx) return;
      audio ||= new Ctx();
      if (audio.state === "suspended") audio.resume().catch(() => {});
    } catch {
      /* no Web Audio */
    }
  };
  window.addEventListener("pointerdown", start, { passive: true });
  window.addEventListener("keydown", start);
}

const pref = (key: string) => {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
};
export const soundOn = () => pref("alert-sound");
export const vibrateOn = () => pref("alert-vibrate");
export async function setAlertPrefs(sound: boolean, vibrate: boolean) {
  localStorage.setItem("alert-sound", sound ? "1" : "0");
  localStorage.setItem("alert-vibrate", vibrate ? "1" : "0");
  // The service worker reads this when a notification arrives.
  try {
    const c = await caches.open("prefs");
    if (vibrate) await c.delete("/__prefs/no-vibrate");
    else await c.put("/__prefs/no-vibrate", new Response("1"));
  } catch {
    /* no Cache Storage */
  }
}

// Reminder: a rising four-note bell, twice. Snooze: a two-note "ding-dong", three times.
const tunes: Record<AlertKind, { notes: number[]; repeat: number }> = {
  reminder: { notes: [523.25, 659.25, 783.99, 1046.5], repeat: 2 },
  snooze: { notes: [783.99, 587.33], repeat: 3 },
};
export const vibrations: Record<AlertKind, number[]> = {
  reminder: [500, 200, 500, 200, 900],
  snooze: [200, 100, 200, 100, 200, 100, 600],
};

export function playChime(kind: AlertKind, force = false) {
  if (!force && !soundOn()) return false;
  try {
    const Ctx =
      window.AudioContext || (window as any).webkitAudioContext || undefined;
    if (!Ctx) return false;
    audio ||= new Ctx();
    if (audio.state === "suspended") audio.resume().catch(() => {});
    const { notes, repeat } = tunes[kind];
    const step = 0.22;
    let t = audio.currentTime + 0.05;
    for (let r = 0; r < repeat; r++) {
      for (const f of notes) {
        for (const [mult, level] of [
          [1, 0.35],
          [2, 0.08],
        ]) {
          const osc = audio.createOscillator();
          const gain = audio.createGain();
          osc.type = "sine";
          osc.frequency.value = f * mult;
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(level, t + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + step * 2.2);
          osc.connect(gain).connect(audio.destination);
          osc.start(t);
          osc.stop(t + step * 2.4);
        }
        t += step;
      }
      t += 0.35;
    }
    return true;
  } catch {
    return false;
  }
}

export function buzz(kind: AlertKind, force = false) {
  if (!force && !vibrateOn()) return false;
  try {
    return Boolean(navigator.vibrate?.(vibrations[kind]));
  } catch {
    return false;
  }
}

export function alertUser(kind: AlertKind) {
  playChime(kind);
  buzz(kind);
}
