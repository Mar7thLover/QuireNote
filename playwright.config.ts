import { defineConfig, devices } from "@playwright/test";

const dataDir = process.env.FOLIO_E2E_DATA_DIR ?? "./data-e2e";
// 设置 FOLIO_WEB 时直接复用已在运行的开发服务器（本地调试用）
const external = process.env.FOLIO_WEB;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: external ?? "http://localhost:5199",
    trace: "retain-on-failure",
    locale: "zh-CN",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      grepInvert: /@mobile/,
    },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: external
    ? undefined
    : [
        {
          command: "pnpm --filter @folio/server start",
          url: "http://localhost:8799/api/health",
          env: { PORT: "8799", FOLIO_DATA_DIR: dataDir, FOLIO_RESET_DATA: "1" },
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: "pnpm --filter @folio/web dev --port 5199 --strictPort",
          url: "http://localhost:5199",
          env: { FOLIO_API_TARGET: "http://localhost:8799" },
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
