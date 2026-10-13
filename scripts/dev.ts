import { spawn } from "node:child_process";
import "dotenv/config";
const run = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn(args[0], args.slice(1), { stdio: "inherit" });
    p.on("exit", (c) =>
      c === 0 ? resolve() : reject(new Error(args[0] + " failed")),
    );
  });
await run(["docker", "compose", "up", "-d", "--wait", "db"]);
await run(["npm", "run", "migrate"]);
await run(["npm", "run", "seed"]);
const children = [
  ["npx", "vite", "--config", "apps/web/vite.config.ts", "--host", "0.0.0.0"],
  ["npm", "run", "start:api"],
  ["npm", "run", "start:worker"],
].map((a) =>
  spawn(a[0], a.slice(1), {
    stdio: "inherit",
    env: { ...process.env, LOCAL_DEMO: process.env.LOCAL_DEMO || "true" },
  }),
);
process.on("SIGINT", () => {
  children.forEach((c) => c.kill());
  process.exit();
});
