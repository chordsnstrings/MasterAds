import { defineConfig } from "@playwright/test";

const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/adengine_e2e";
const API_PORT = 3105;
const WEB_PORT = 5273;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.03, animations: "disabled" },
  },
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "pnpm --filter @engine/core run e2e-seed && pnpm --filter @engine/api run start",
      port: API_PORT,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: E2E_DB,
        PORT: String(API_PORT),
        NODE_ENV: "test",
        PUBLIC_BASE_URL: `http://127.0.0.1:${API_PORT}`,
        LOG_LEVEL: "warn",
      },
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @engine/web exec vite --port ${WEB_PORT} --strictPort`,
      port: WEB_PORT,
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      timeout: 120_000,
    },
  ],
});
