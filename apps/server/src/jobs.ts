/** 进程内后台任务队列：可控并发，状态持久化到 jobs 表，变更通过事件总线推送。 */
import { type Job, newId, nowIso } from "@quirenote/core";
import { errorMessageOf } from "./errors";
import type { EventBus } from "./events";
import type { JobRecord, Store } from "./store/types";

export interface JobContext {
  job: Job;
  /** 更新进度（0–1）与说明。 */
  progress(progress: number, message?: string): Promise<void>;
}

/** 处理函数返回值作为完成时的 message。 */
export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<string | undefined>;

export function publicJob(r: JobRecord): Job {
  const { payload: _payload, ...job } = r;
  return job;
}

export class JobQueue {
  private handlers = new Map<string, JobHandler>();
  private queue: string[] = [];
  private running = 0;
  private waiters = new Map<string, ((job: Job) => void)[]>();
  private idleWaiters: (() => void)[] = [];
  private stopped = false;

  constructor(
    private readonly store: () => Store,
    private readonly events: EventBus,
    private readonly concurrency = 2,
  ) {}

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  async enqueue(
    type: string,
    payload: Record<string, unknown>,
    meta: { notebookId?: string | null; refId?: string | null; message?: string } = {},
  ): Promise<Job> {
    const ts = nowIso();
    const rec: JobRecord = {
      id: newId("job"),
      type,
      status: "queued",
      progress: 0,
      message: meta.message ?? "排队中",
      refId: meta.refId ?? null,
      notebookId: meta.notebookId ?? null,
      createdAt: ts,
      updatedAt: ts,
      payload,
    };
    await this.store().jobs.insert(rec);
    const job = publicJob(rec);
    this.events.emit("job", job);
    this.queue.push(rec.id);
    queueMicrotask(() => this.pump());
    return job;
  }

  /** 启动时恢复未完成的任务（重新排队）。 */
  async resume(): Promise<number> {
    const all = await this.store().jobs.list();
    let n = 0;
    for (const j of all) {
      if (j.status !== "queued" && j.status !== "running") continue;
      if (!this.handlers.has(j.type)) {
        await this.store().jobs.update(j.id, { status: "error", message: `未知任务类型：${j.type}` });
        continue;
      }
      await this.store().jobs.update(j.id, { status: "queued", message: "服务重启后重新排队" });
      this.queue.push(j.id);
      n++;
    }
    queueMicrotask(() => this.pump());
    return n;
  }

  waitFor(id: string): Promise<Job> {
    return new Promise((resolve) => {
      void this.store()
        .jobs.get(id)
        .then((j) => {
          if (j && (j.status === "done" || j.status === "error")) resolve(publicJob(j));
          else this.waiters.set(id, [...(this.waiters.get(id) ?? []), resolve]);
        });
    });
  }

  /** 等待队列清空（测试与关闭时使用）。 */
  idle(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  get pending(): number {
    return this.queue.length + this.running;
  }

  stop(): void {
    this.stopped = true;
  }

  private pump(): void {
    while (!this.stopped && this.running < this.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      this.running++;
      void this.run(id).finally(() => {
        this.running--;
        if (!this.running && !this.queue.length) {
          const ws = this.idleWaiters;
          this.idleWaiters = [];
          for (const w of ws) w();
        }
        this.pump();
      });
    }
  }

  private async update(id: string, patch: Partial<JobRecord>): Promise<Job | null> {
    const rec = await this.store().jobs.update(id, patch);
    if (!rec) return null;
    const job = publicJob(rec);
    this.events.emit("job", job);
    return job;
  }

  private async run(id: string): Promise<void> {
    const rec = await this.store().jobs.get(id);
    if (!rec) return;
    const handler = this.handlers.get(rec.type);
    let final: Job | null;
    if (!handler) {
      final = await this.update(id, { status: "error", message: `未知任务类型：${rec.type}` });
    } else {
      const started = await this.update(id, { status: "running", message: "进行中", progress: 0 });
      const ctx: JobContext = {
        job: started ?? publicJob(rec),
        progress: async (progress, message) => {
          await this.update(id, {
            progress: Math.max(0, Math.min(1, progress)),
            ...(message !== undefined ? { message } : {}),
          });
        },
      };
      try {
        const msg = await handler(rec.payload, ctx);
        final = await this.update(id, { status: "done", progress: 1, message: msg || "完成" });
      } catch (err) {
        final = await this.update(id, { status: "error", message: errorMessageOf(err).slice(0, 1000) });
      }
    }
    const ws = this.waiters.get(id) ?? [];
    this.waiters.delete(id);
    if (final) for (const w of ws) w(final);
  }
}
