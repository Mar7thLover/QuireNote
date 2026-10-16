import { defineConfig, devices } from "@playwright/test";

const dataDir = process.env.QUIRENOTE_E2E_DATA_DIR ?? "./data-e2e";
// 设置 QUIRENOTE_WEB 时直接复用已在运行的开发服务器（本地调试用）
const external = process.env.QUIRENOTE_WEB;

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
          // 假 OpenAI 兼容模型，替代真实模型服务（不需要 Key、结果确定）。
          command: "pnpm --filter @quirenote/server exec tsx ../../e2e/fake-llm.ts",
          url: "http://localhost:8798/v1/models",
          env: { PORT: "8798" },
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: "pnpm --filter @quirenote/server start",
          url: "http://localhost:8799/api/health",
          env: {
            PORT: "8799",
            QUIRENOTE_DATA_DIR: dataDir,
            QUIRENOTE_RESET_DATA: "1",
            OPENAI_COMPATIBLE_BASE_URL: "http://localhost:8798/v1",
            OPENAI_COMPATIBLE_CHAT_MODEL: "fake-chat",
            OPENAI_COMPATIBLE_EMBEDDING_MODEL: "fake-embed",
          },
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command: "pnpm --filter @quirenote/web dev --port 5199 --strictPort",
          url: "http://localhost:5199",
          env: { QUIRENOTE_API_TARGET: "http://localhost:8799" },
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
