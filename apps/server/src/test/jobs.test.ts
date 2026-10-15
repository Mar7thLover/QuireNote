import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../events";
import { JobQueue } from "../jobs";
import { createSqliteStore } from "../store/sqlite";
import type { Store } from "../store/types";

let store: Store;

function setup(concurrency = 2) {
  store = createSqliteStore(":memory:");
  const events = new EventBus();
  const seen: { status: string; progress: number }[] = [];
  events.subscribe((e) => {
    if (e.event === "job") seen.push(e.data as { status: string; progress: number });
  });
  return { queue: new JobQueue(() => store, events, concurrency), seen, events };
}

afterEach(async () => {
  await store?.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("job queue", () => {
  it("runs jobs, persists status and emits progress events", async () => {
    const { queue, seen } = setup();
    queue.register("echo", async (p, ctx) => {
      await ctx.progress(0.5, "halfway");
      return `got ${p.value}`;
    });
    const job = await queue.enqueue("echo", { value: 42 }, { notebookId: "nb_1", refId: "x" });
    expect(job.status).toBe("queued");
    const done = await queue.waitFor(job.id);
    expect(done).toMatchObject({
      status: "done",
      progress: 1,
      message: "got 42",
      notebookId: "nb_1",
      refId: "x",
    });
    expect(done).not.toHaveProperty("payload");
    const stored = await store.jobs.get(job.id);
    expect(stored?.status).toBe("done");
    expect(seen.map((s) => s.status)).toEqual(["queued", "running", "running", "done"]);
    expect(seen[2]!.progress).toBe(0.5);
  });

  it("marks failures as error with the message", async () => {
    const { queue } = setup();
    queue.register("boom", async () => {
      throw new Error("出错了");
    });
    const job = await queue.enqueue("boom", {});
    expect(await queue.waitFor(job.id)).toMatchObject({ status: "error", message: "出错了" });
  });

  it("respects the concurrency limit", async () => {
    const { queue } = setup(2);
    let running = 0;
    let peak = 0;
    queue.register("slow", async () => {
      running++;
      peak = Math.max(peak, running);
      await sleep(20);
      running--;
    });
    const jobs = await Promise.all(Array.from({ length: 6 }, () => queue.enqueue("slow", {})));
    await queue.idle();
    expect(peak).toBe(2);
    for (const j of jobs) expect((await store.jobs.get(j.id))?.status).toBe("done");
  });

  it("resumes unfinished jobs after a restart and fails unknown types", async () => {
    const first = setup();
    first.queue.register("work", async () => "ok");
    first.queue.stop();
    const j = await first.queue.enqueue("work", { n: 1 });
    const orphan = await first.queue.enqueue("gone", {});
    // 模拟重启：新的队列实例读取同一个 store。
    const events = new EventBus();
    const second = new JobQueue(() => store, events, 1);
    second.register("work", async (p) => `resumed ${p.n}`);
    expect(await second.resume()).toBe(1);
    expect(await second.waitFor(j.id)).toMatchObject({ status: "done", message: "resumed 1" });
    expect((await store.jobs.get(orphan.id))?.status).toBe("error");
  });
});
