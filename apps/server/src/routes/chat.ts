import { type Conversation, ModelChoice, newId, nowIso } from "@quirenote/core";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { AppContext } from "../context";
import { errorMessageOf } from "../errors";
import {
  assertLeafInConversation,
  defaultConversationTitle,
  deleteConversation,
  prepareSend,
  runChat,
} from "../services/chat";
import { getPreset } from "../services/presets";
import { validateModelChoice } from "../services/providers";
import { must, readJson } from "./util";

const SendInput = z.object({
  content: z.string().optional(),
  parentId: z.string().nullable().default(null),
  sourceIds: z.array(z.string()).optional(),
  regenerateOf: z.string().optional(),
});

export function chatRoutes(api: Hono, ctx: AppContext): void {
  const { store } = ctx;

  api.get("/notebooks/:nb/conversations", async (c) => {
    must(await store.notebooks.get(c.req.param("nb")), "notebook");
    const list = await store.conversations.list({ notebookId: c.req.param("nb") });
    return c.json(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  });

  api.post("/notebooks/:nb/conversations", async (c) => {
    const nb = c.req.param("nb");
    must(await store.notebooks.get(nb), "notebook");
    const input = await readJson(
      c,
      z.object({
        title: z.string().optional(),
        model: ModelChoice.nullable().optional(),
        presetId: z.string().nullable().optional(),
      }),
    );
    if (input.model) await validateModelChoice(ctx, "chat", input.model.providerId, input.model.model);
    if (input.presetId) must(await getPreset(ctx, input.presetId), "preset");
    const ts = nowIso();
    const conv: Conversation = {
      id: newId("conv"),
      ownerId: store.ownerId,
      notebookId: nb,
      title: input.title?.trim() || defaultConversationTitle(),
      activeLeafId: null,
      model: input.model ?? null,
      presetId: input.presetId ?? null,
      createdAt: ts,
      updatedAt: ts,
    };
    await store.conversations.insert(conv);
    return c.json(conv, 201);
  });

  api.get("/conversations/:id", async (c) =>
    c.json(must(await store.conversations.get(c.req.param("id")), "conversation")),
  );

  api.patch("/conversations/:id", async (c) => {
    const id = c.req.param("id");
    must(await store.conversations.get(id), "conversation");
    const patch = await readJson(
      c,
      z.object({
        title: z.string().min(1).optional(),
        activeLeafId: z.string().nullable().optional(),
        /** 切换该对话使用的模型；null 表示跟随全局对话分配。 */
        model: ModelChoice.nullable().optional(),
        /** 切换对话预设；null 表示跟随 Notebook 的默认预设。 */
        presetId: z.string().nullable().optional(),
      }),
    );
    if (patch.presetId) must(await getPreset(ctx, patch.presetId), "preset");
    if (patch.model) await validateModelChoice(ctx, "chat", patch.model.providerId, patch.model.model);
    if (patch.activeLeafId !== undefined)
      assertLeafInConversation(await store.messages.list({ refId: id }), patch.activeLeafId);
    return c.json(must(await store.conversations.update(id, patch), "conversation"));
  });

  api.delete("/conversations/:id", async (c) => {
    must(await store.conversations.get(c.req.param("id")), "conversation");
    await deleteConversation(ctx, c.req.param("id"));
    return c.json({ ok: true });
  });

  api.get("/conversations/:id/messages", async (c) => {
    must(await store.conversations.get(c.req.param("id")), "conversation");
    return c.json(await store.messages.list({ refId: c.req.param("id") }));
  });

  api.post("/conversations/:id/messages", async (c) => {
    const input = await readJson(c, SendInput);
    // 先校验（404 / 400 以普通 JSON 返回），再开始 SSE。
    const prepared = await prepareSend(ctx, c.req.param("id"), input);
    const abort = new AbortController();
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => abort.abort());
      const emit = async (event: string, data: unknown) => {
        if (stream.aborted || stream.closed) return;
        await stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      try {
        await runChat(ctx, prepared, input, emit, abort.signal);
      } catch (err) {
        await emit("error", { message: errorMessageOf(err) });
      }
    });
  });
}
