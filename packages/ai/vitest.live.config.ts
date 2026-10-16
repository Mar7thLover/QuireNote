import { defineConfig } from "vitest/config";

/** 真实模型测试（pnpm test:live）：只跑 *.live.ts，调用真实 API，超时放宽。默认的 pnpm test 不包含它们。 */
export default defineConfig({
  test: {
    include: ["src/**/*.live.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
