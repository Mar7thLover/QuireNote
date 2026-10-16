import { join } from "node:path";
import type { ServerConfig } from "./config";
import { createCipher, type KeyCipher, loadOrCreateSecret } from "./crypto";
import { EventBus } from "./events";
import { DiskFileStore, type FileStore } from "./files";
import { JobQueue } from "./jobs";
import { ModelResolver } from "./models";
import { createSqliteStore } from "./store/sqlite";
import type { Store } from "./store/types";

export interface AppContext {
  config: ServerConfig;
  store: Store;
  files: FileStore;
  events: EventBus;
  jobs: JobQueue;
  cipher: KeyCipher;
  models: ModelResolver;
  /** 资料导入（URL / YouTube / 深度研究抓取正文）用的 fetch，测试时可替换。 */
  fetch: typeof fetch;
  /** ffmpeg 可执行文件路径；undefined 表示尚未探测。 */
  ffmpeg?: string | null;
}

export interface ContextOptions {
  /** 注入给所有 AI provider 的 fetch（测试用）。 */
  aiFetch?: typeof fetch;
  /** 导入用 fetch（测试用）。 */
  fetch?: typeof fetch;
  /** 用内存数据库（测试用）。 */
  memoryDb?: boolean;
}

export function createContext(config: ServerConfig, opts: ContextOptions = {}): AppContext {
  const store = createSqliteStore(opts.memoryDb ? ":memory:" : join(config.dataDir, "quirenote.db"));
  const files = new DiskFileStore(join(config.dataDir, "files"));
  const events = new EventBus();
  const cipher = createCipher(loadOrCreateSecret(config.dataDir, config.secret));
  const jobs = new JobQueue(() => store, events, config.jobConcurrency);
  const models = new ModelResolver(store, cipher, opts.aiFetch);
  return { config, store, files, events, jobs, cipher, models, fetch: opts.fetch ?? globalThis.fetch };
}
