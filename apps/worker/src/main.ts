import "dotenv/config";
import { refreshHorizon, enqueueJobs, dispatchOne, heartbeat } from "./worker";
if (
  process.env.NODE_ENV === "production" &&
  process.env.PUSH_ADAPTER === "simulated"
)
  throw new Error("Simulated push forbidden");
let lastHorizon = 0,
  stop = false;
process.on("SIGTERM", () => (stop = true));
process.on("SIGINT", () => (stop = true));
while (!stop) {
  try {
    if (Date.now() - lastHorizon > 86400000) {
      await refreshHorizon();
      lastHorizon = Date.now();
    }
    await enqueueJobs();
    for (let i = 0; i < 100 && (await dispatchOne()); i++) {}
    await heartbeat();
  } catch {
    console.error(
      "Worker cycle failed; inspect database/configuration. No patient details logged.",
    );
  }
  await new Promise((r) => setTimeout(r, 5000));
}
