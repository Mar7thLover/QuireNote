import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { VERSION } from "../config";
import type { AppContext } from "../context";
import { badRequest } from "../errors";
import type { BusEvent } from "../events";
import { mimeFromName, safeName } from "../files";
import { publicJob } from "../jobs";
import { overview, recordNoteOpened, usageSummary } from "../services/insights";
import { backupAll, restoreAll } from "../services/portability";
import { MEDIA_DIR } from "../services/studio";
import { download, fileResponse, must, readUpload } from "./util";

const SETTING_KEY = /^[a-zA-Z0-9_.-]{1,64}$/;

export function systemRoutes(api: Hono, ctx: AppContext): void {
  const { store } = ctx;

  api.get("/health", (c) => c.json({ ok: true, version: VERSION }));

  // ───── Jobs ─────
  api.get("/jobs", async (c) => {
    const notebookId = c.req.query("notebookId");
    const jobs = await store.jobs.list(notebookId ? { notebookId } : {});
    return c.json(
      jobs
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 200)
        .map(publicJob),
    );
  });

  /** 补充：单个任务。 */
  api.get("/jobs/:id", async (c) => c.json(publicJob(must(await store.jobs.get(c.req.param("id")), "任务"))));

  // ───── SSE 事件 ─────
  api.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const queue: BusEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = ctx.events.subscribe((e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ event: "ready", data: JSON.stringify({ ok: true, version: VERSION }) });
      while (!stream.aborted && !stream.closed) {
        while (queue.length) {
          const e = queue.shift()!;
          await stream.writeSSE({ event: e.event, data: JSON.stringify(e.data) });
        }
        // 15 秒心跳，防止代理断开空闲连接。
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 15_000);
          wake = () => {
            clearTimeout(t);
            wake = null;
            resolve();
          };
        });
        if (!queue.length && !stream.aborted) await stream.write(": ping\n\n");
      }
      unsubscribe();
    }),
  );

  // ───── Settings ─────
  api.get("/settings/:key", async (c) => {
    const key = c.req.param("key");
    if (!SETTING_KEY.test(key)) throw badRequest("非法的设置键");
    return c.json(await store.settings.get(key));
  });

  api.put("/settings/:key", async (c) => {
    const key = c.req.param("key");
    if (!SETTING_KEY.test(key)) throw badRequest("非法的设置键");
    let value: unknown;
    try {
      value = JSON.parse((await c.req.text()) || "null");
    } catch {
      throw badRequest("请求体不是合法 JSON", "invalid_json");
    }
    await store.settings.set(key, value);
    return c.json(value);
  });

  // ───── 首页：用量、写作、最近打开 ─────
  api.get("/usage/summary", async (c) => c.json(await usageSummary(ctx)));

  api.get("/overview", async (c) => c.json(await overview(ctx)));

  api.post("/notes/:id/opened", async (c) => {
    must(await store.notes.get(c.req.param("id")), "笔记");
    await recordNoteOpened(ctx, c.req.param("id"));
    return c.json({ ok: true });
  });

  // ───── Admin ─────
  api.get("/admin/stats", async (c) => {
    const [
      dbBytes,
      filesBytes,
      notebooks,
      sources,
      chunks,
      notes,
      artifacts,
      elements,
      jobs,
      embeddingModel,
    ] = await Promise.all([
      store.sizeBytes(),
      ctx.files.sizeBytes(),
      store.notebooks.count(),
      store.sources.count(),
      store.chunks.count(),
      store.notes.count(),
      store.artifacts.count(),
      store.elements.count(),
      store.jobs.list(),
      ctx.models.embeddingKey(),
    ]);
    const embedded = embeddingModel ? await store.chunks.embeddedCount({ model: embeddingModel }) : 0;
    return c.json({
      dbBytes,
      filesBytes,
      notebooks,
      sources,
      chunks,
      embedded,
      notes,
      artifacts,
      elements,
      pendingJobs: jobs.filter((j) => j.status === "queued" || j.status === "running").length,
      embeddingModel,
    });
  });

  api.post("/admin/reindex", async (c) => {
    let body: { notebookId?: string } = {};
    try {
      const text = await c.req.text();
      body = text.trim()
        ? (z.object({ notebookId: z.string().optional() }).parse(JSON.parse(text)) as typeof body)
        : {};
    } catch {
      throw badRequest("请求体无效");
    }
    if (body.notebookId) must(await store.notebooks.get(body.notebookId), "Notebook");
    const job = await ctx.jobs.enqueue(
      "reindex",
      { ...(body.notebookId ? { notebookId: body.notebookId } : {}), clear: true },
      { notebookId: body.notebookId ?? null, message: "重建 Embedding 索引" },
    );
    return c.json(job, 202);
  });

  api.get("/admin/backup", async () => {
    const { zip, filename } = await backupAll(ctx);
    return download(zip, filename, "application/zip");
  });

  api.post("/admin/restore", async (c) => {
    const { file } = await readUpload(c);
    return c.json(await restoreAll(ctx, new Uint8Array(await file.arrayBuffer())));
  });

  // ───── 生成的媒体 ─────
  api.get("/files/:name", async (c) => {
    const name = safeName(c.req.param("name"));
    const data = must(await ctx.files.get(`${MEDIA_DIR}/${name}`), "文件");
    return fileResponse(c, data, mimeFromName(name));
  });
}
