import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 390, height: 844 },
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
  },
  webServer: [
    {
      command:
        "LOCAL_DEMO=true TRUST_PROXY=1 PORT=3001 PUBLIC_APP_URL=http://localhost:4173 npm run start:api",
      url: "http://localhost:3001/api/health",
      reuseExistingServer: false,
    },
    {
      command: "npx vite preview --config apps/web/vite.config.ts --port 4173",
      url: "http://localhost:4173",
      reuseExistingServer: false,
    },
  ],
  workers: 1,
});
