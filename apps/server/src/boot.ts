/** 组装服务：配置 → 上下文 → 任务处理函数 → 引导 provider → 种子数据 → 恢复任务。main.ts 与集成测试共用。 */
import { mkdirSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "./app";
import { resetDataDir, type ServerConfig } from "./config";
import { type AppContext, type ContextOptions, createContext } from "./context";
import { registerJobHandlers } from "./handlers";
import { seedIfEmpty } from "./seed";
import { bootstrapProvidersFromEnv, removeLegacyLocal, upgradeProviderModels } from "./services/providers";

export interface BootOptions extends ContextOptions {
  /** 用于引导 provider 的环境变量；不传则不引导（测试默认不读真实环境）。 */
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}

export interface Server {
  ctx: AppContext;
  app: Hono;
  close(): Promise<void>;
}

export async function boot(config: ServerConfig, opts: BootOptions = {}): Promise<Server> {
  const log = opts.log ?? (() => {});
  if (config.resetData) {
    resetDataDir(config.dataDir);
    log(`[quirenote] 已清空数据目录 ${config.dataDir}`);
  }
  mkdirSync(config.dataDir, { recursive: true });
  const ctx = createContext(config, opts);
  registerJobHandlers(ctx);
  if (await removeLegacyLocal(ctx)) log("[quirenote] 内置 local 模型已移除，原先分配给它的能力改为未配置");
  if (await upgradeProviderModels(ctx))
    log("[quirenote] 已为现有提供方补上新支持的能力（如 Claude 联网搜索）");
  if (opts.env) await bootstrapProvidersFromEnv(ctx, opts.env, (m) => log(`[quirenote] ${m}`));
  if (config.seed) {
    const seeded = await seedIfEmpty(ctx);
    if (seeded) log(`[quirenote] 已创建示例 Notebook ${seeded}`);
  }
  const resumed = await ctx.jobs.resume();
  if (resumed) log(`[quirenote] 恢复了 ${resumed} 个未完成的任务`);
  const app = createApp(ctx, { log, webDist: opts.env?.QUIRENOTE_WEB_DIST });
  return {
    ctx,
    app,
    async close() {
      ctx.jobs.stop();
      await ctx.store.close();
    },
  };
}
