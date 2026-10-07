import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const PORT = process.env.UAT_PORT ?? "8091";
const AUTH_STATE = ".auth/uat-user.json";

export default defineConfig({
  testDir: "./tests/uat",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: process.env.UAT_BASE_URL ?? `http://127.0.0.1:${PORT}`,
    storageState: existsSync(AUTH_STATE) ? AUTH_STATE : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
