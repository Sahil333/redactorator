import { defineConfig } from "@playwright/test";

const appUrl = "http://127.0.0.1:4173";

// Tests run against the production build, so the Content Security Policy is the one that ships.
export default defineConfig({
  testDir: "tests/e2e",
  globalTeardown: "./tests/e2e/coverage.ts",
  use: { baseURL: appUrl, channel: "chrome" },
  webServer: {
    command: "pnpm build && pnpm preview",
    url: appUrl,
    reuseExistingServer: false,
  },
});
