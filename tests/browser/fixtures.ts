import { test as base, expect } from "@playwright/test";
import { createHash } from "node:crypto";

// Each scenario represents an independent device. Vite is the one trusted local
// proxy (see playwright.config.ts); keep the real 120/minute app limit intact
// without letting earlier scenarios consume another scenario's request budget.
export const test = base.extend({
  context: async ({ context }, use, info) => {
    const hash = createHash("sha256").update(info.testId).digest();
    await context.setExtraHTTPHeaders({
      "X-Forwarded-For": `198.18.${hash[0]}.${hash[1]}`,
    });
    await use(context);
  },
});
export { expect };
