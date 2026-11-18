import { defineConfig } from "vitest/config";

// Unit tests sit next to the code they test; browser tests in tests/e2e belong to Playwright.
export default defineConfig({
  test: {
    include: ["{app,engine}/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
  },
});
