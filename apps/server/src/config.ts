import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根目录（apps/server/src/config.ts 往上三级）。 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const VERSION = "0.1.0";

export interface ServerConfig {
  port: number;
  dataDir: string;
  /** QUIRENOTE_SECRET；为空时在数据目录生成 secret.key。 */
  secret: string | null;
  resetData: boolean;
  /** 后台任务并发数。 */
  jobConcurrency: number;
  /** 是否首次启动时写入示例 Notebook。 */
  seed: boolean;
}

/** 相对路径统一解析到仓库根目录，避免随进程 cwd 变化。 */
export function resolveDataDir(value: string | undefined): string {
  if (!value?.trim()) return join(REPO_ROOT, "data");
  return isAbsolute(value) ? resolve(value) : resolve(REPO_ROOT, value);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: Number(env.PORT) || 8787,
    dataDir: resolveDataDir(env.QUIRENOTE_DATA_DIR),
    secret: env.QUIRENOTE_SECRET?.trim() || null,
    resetData: env.QUIRENOTE_RESET_DATA === "1" || env.QUIRENOTE_RESET_DATA === "true",
    jobConcurrency: Math.max(1, Number(env.QUIRENOTE_JOB_CONCURRENCY) || 2),
    seed: env.QUIRENOTE_SEED !== "0",
  };
}

/**
 * 清空数据目录（QUIRENOTE_RESET_DATA=1）。安全检查：拒绝删除文件系统根、仓库根，
 * 以及符号链接 / 目录联接（只清空联接指向目录里的内容会误删别处数据，直接拒绝）。
 */
export function resetDataDir(dir: string): void {
  const abs = resolve(dir);
  const rel = relative(abs, REPO_ROOT);
  const containsRepo = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (abs === parse(abs).root || containsRepo) {
    throw new Error(`拒绝清空数据目录：${abs}`);
  }
  if (!existsSync(abs)) {
    mkdirSync(abs, { recursive: true });
    return;
  }
  if (lstatSync(abs).isSymbolicLink()) throw new Error(`数据目录是符号链接或目录联接，拒绝清空：${abs}`);
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    // 子项是联接时只删除联接本身，不跟随。
    if (lstatSync(p).isSymbolicLink()) rmSync(p, { force: true });
    else rmSync(p, { recursive: true, force: true });
  }
}
