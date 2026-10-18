import {
  catalogEntry,
  guessCapabilities,
  listCatalog,
  listModels,
  testConnection,
  transformStream,
} from "@quirenote/ai";
import {
  AgentProposal,
  Capability,
  ModelAssignment,
  ProviderHeadersPatch,
  ProviderInput,
  ProviderModel,
} from "@quirenote/core";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { validateCitations } from "../citations";
import type { AppContext } from "../context";
import { ApiError, badRequest, errorMessageOf } from "../errors";
import { msg } from "../messages";
import { applyProposal, proposeCommand, undoProposal } from "../services/agent";
import { gatherPassages } from "../services/passages";
import {
  createProvider,
  deleteProvider,
  effectiveAssignments,
  fillUnassigned,
  publicProvider,
  updateProvider,
  validateAssignment,
} from "../services/providers";
import { searchWeb } from "../services/research";
import { writingContext } from "../services/writing";
import { must, readJson } from "./util";

const TransformInput = z.object({
  notebookId: z.string(),
  action: z.enum([
    "explain",
    "rewrite",
    "expand",
    "translate",
    "summarize",
    "find_source",
    "quiz",
    "continue",
    "outline",
    "custom",
  ]),
  /** 正在编辑的笔记：续写、改写、扩写时带上这本 Notebook 的设定；章节还带前文提要和本章大纲。 */
  noteId: z.string().optional(),
  text: z.string().min(1),
  instruction: z.string().optional(),
  targetLang: z.string().optional(),
  /** 补充：限定参考资料。 */
  sourceIds: z.array(z.string()).optional(),
});

/** 需要参考资料的动作。 */
const NEEDS_SOURCES = new Set(["explain", "expand", "find_source", "quiz", "custom"]);

export function aiRoutes(api: Hono, ctx: AppContext): void {
  const { store } = ctx;

  // ───── 就地 AI ─────
  api.post("/ai/transform", async (c) => {
    const input = await readJson(c, TransformInput);
    must(await store.notebooks.get(input.notebookId), "notebook");
    const chat = await ctx.models.chat();
    const { passages, citable } = NEEDS_SOURCES.has(input.action)
      ? await gatherPassages(ctx, input.notebookId, {
          query: `${input.instruction ?? ""} ${input.text}`.slice(0, 2000),
          sourceIds: input.sourceIds ?? null,
          k: 6,
          fill: false,
        })
      : { passages: [], citable: [] };
    const writing =
      input.noteId && ["continue", "rewrite", "expand", "custom"].includes(input.action)
        ? await writingContext(ctx, input.notebookId, input.noteId, input.text)
        : null;
    const abort = new AbortController();
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => abort.abort());
      const emit = async (event: string, data: unknown) => {
        if (!stream.aborted && !stream.closed) await stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      let text = "";
      try {
        for await (const d of transformStream(chat, {
          ...input,
          passages,
          ...(writing ? { notebook: writing.notebook, background: writing.background } : {}),
        })) {
          if (abort.signal.aborted) break;
          text += d;
          await emit("delta", { text: d });
        }
        const { text: cleaned, citations } = validateCitations(text, citable);
        await emit("citations", citations);
        await emit("done", { text: cleaned, model: `${chat.provider.id}:${chat.model}` });
      } catch (err) {
        await emit("error", { message: errorMessageOf(err) });
      }
    });
  });

  api.post("/ai/command", async (c) => {
    const input = await readJson(
      c,
      z.object({
        notebookId: z.string(),
        instruction: z.string().min(1),
        noteIds: z.array(z.string()).optional(),
        selection: z.string().optional(),
      }),
    );
    must(await store.notebooks.get(input.notebookId), "notebook");
    return c.json(await proposeCommand(ctx, input));
  });

  api.post("/ai/apply", async (c) => {
    const input = await readJson(c, z.object({ notebookId: z.string(), proposal: AgentProposal }));
    return c.json(await applyProposal(ctx, input.notebookId, input.proposal));
  });

  api.post("/ai/undo", async (c) => {
    const { undoToken } = await readJson(c, z.object({ undoToken: z.string() }));
    return c.json(await undoProposal(ctx, undoToken));
  });

  // ───── 搜索与研究 ─────
  api.post("/search/web", async (c) => {
    const input = await readJson(
      c,
      z.object({ query: z.string().min(1), providerId: z.string().optional() }),
    );
    return c.json({ results: await searchWeb(ctx, input.query, input.providerId) });
  });

  api.post("/notebooks/:nb/research", async (c) => {
    const nb = c.req.param("nb");
    must(await store.notebooks.get(nb), "notebook");
    const input = await readJson(
      c,
      z.object({ question: z.string().min(1), rounds: z.number().int().min(1).max(5).optional() }),
    );
    // 提前检查是否配置了搜索，避免任务排队后才失败。
    await ctx.models.require("search", "research");
    const job = await ctx.jobs.enqueue(
      "research",
      { notebookId: nb, question: input.question, rounds: input.rounds ?? 2 },
      { notebookId: nb, message: msg().job.research(input.question.slice(0, 40)) },
    );
    return c.json(job, 202);
  });

  // ───── Providers ─────
  api.get("/providers/catalog", (c) => c.json(listCatalog()));

  api.get("/providers", async (c) => c.json((await store.providers.list()).map(publicProvider)));

  api.post("/providers", async (c) => {
    const input = await readJson(c, ProviderInput);
    const rec = await createProvider(ctx, input);
    // 新提供方能做、但还没分配的对话 / 联网搜索 / 插图，直接用它补上（前端会刷新能力分配）。
    if (rec.keyEnc || !catalogEntry(rec.kind).requiresKey) await fillUnassigned(ctx, rec);
    return c.json(publicProvider(rec), 201);
  });

  api.patch("/providers/:id", async (c) => {
    const patch = await readJson(
      c,
      z.object({
        name: z.string().optional(),
        baseUrl: z.string().nullable().optional(),
        apiKey: z.string().nullable().optional(),
        enabled: z.boolean().optional(),
        models: z.array(ProviderModel).max(500).optional(),
        headers: ProviderHeadersPatch.nullable().optional(),
      }),
    );
    return c.json(publicProvider(await updateProvider(ctx, c.req.param("id"), patch)));
  });

  api.delete("/providers/:id", async (c) => {
    must((await deleteProvider(ctx, c.req.param("id"))) || null, "provider");
    return c.json({ ok: true });
  });

  api.post("/providers/:id/test", async (c) => {
    const id = c.req.param("id");
    must(await store.providers.get(id), "provider");
    let rt: Awaited<ReturnType<typeof ctx.models.runtime>>;
    try {
      rt = await ctx.models.runtime(id);
    } catch (err) {
      return c.json({ ok: false, latencyMs: 0, error: errorMessageOf(err) });
    }
    return c.json(await testConnection(rt));
  });

  /** 向服务查询可用模型并推测用途（用于「从服务拉取」），不改动已登记的模型列表。 */
  api.get("/providers/:id/models", async (c) => {
    const id = c.req.param("id");
    const p = must(await store.providers.get(id), "provider");
    try {
      const ids = await listModels(await ctx.models.runtime(id));
      return c.json(ids.map((m) => ({ id: m, label: null, capabilities: guessCapabilities(p.kind, m) })));
    } catch (err) {
      throw new ApiError(502, "list_models_failed", errorMessageOf(err));
    }
  });

  // ───── 模型分配 ─────
  api.get("/models/assignments", async (c) => c.json(await effectiveAssignments(ctx)));

  api.put("/models/assignments", async (c) => {
    const a = await readJson(c, ModelAssignment);
    await validateAssignment(ctx, a);
    const before = await ctx.models.embeddingKey();
    await store.assignments.set(a);
    if (a.capability === "embedding" && (await ctx.models.embeddingKey()) !== before) {
      // 换了 Embedding 模型：所有 Notebook 重建索引（期间检索退回关键词）。
      await ctx.jobs.enqueue("reindex", { clear: true }, { message: msg().job.embeddingChanged });
    }
    return c.json(await effectiveAssignments(ctx));
  });

  /** 清除某能力的分配（回到未配置）。 */
  api.delete("/models/assignments/:capability", async (c) => {
    const cap = Capability.safeParse(c.req.param("capability"));
    if (!cap.success) throw badRequest(msg().unknownCapability);
    const before = await ctx.models.embeddingKey();
    await store.assignments.delete(cap.data);
    if (cap.data === "embedding" && (await ctx.models.embeddingKey()) !== before) {
      await ctx.jobs.enqueue("reindex", { clear: true }, { message: msg().job.embeddingChanged });
    }
    return c.json(await effectiveAssignments(ctx));
  });
}
