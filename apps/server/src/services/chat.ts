/** 带引用的对话：消息树、分支、重新生成；SSE 事件 user → start → delta* → citations → done。 */
import { buildCitationPrompt, type ChatTurn, streamChat, truncate } from "@quirenote/ai";
import { type Conversation, type Message, newId, nowIso } from "@quirenote/core";
import { validateCitations } from "../citations";
import type { AppContext } from "../context";
import { ApiError, badRequest, errorMessageOf, notFound } from "../errors";
import { loreForChat } from "./lorebook";
import { activeSources, gatherNotes, gatherPassages } from "./passages";

export const DEFAULT_CONVERSATION_TITLE = "新对话";

/** 检索模式下每轮对话送给模型的资料片段总字数上限。 */
const CHAT_CONTEXT_CHARS = 12_000;
/**
 * 资料总量不超过这个字数时，整份交给模型阅读，不做检索：概括、对比、跨资料的问题都答得完整，
 * 而且资料部分每轮不变，可以命中提示词缓存。没有 Embedding 时上限更高，代替向量检索。
 */
const FULL_CONTEXT_CHARS = { withEmbedding: 20_000, withoutEmbedding: 60_000 };
/** 笔记也算资料：有勾选资料时笔记最多给这么多字，没有资料时给得多一些。 */
const NOTES_WITH_SOURCES = 20_000;
const NOTES_ALONE = 60_000;

export interface SendMessageInput {
  content?: string;
  parentId: string | null;
  sourceIds?: string[];
  regenerateOf?: string;
}

export type ChatEmit = (
  event: "user" | "start" | "delta" | "citations" | "done" | "error",
  data: unknown,
) => Promise<void>;

/** 从某条消息沿 parent 向上直到根，返回从根开始的路径。 */
export function pathTo(messages: Message[], leafId: string | null): Message[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const out: Message[] = [];
  let cur = leafId ? byId.get(leafId) : undefined;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** 校验请求并准备好用户消息（新建或复用）。抛出的 ApiError 应在开始 SSE 之前返回给客户端。 */
export async function prepareSend(
  ctx: AppContext,
  conversationId: string,
  input: SendMessageInput,
): Promise<{ conv: Conversation; user: Message; isNewUser: boolean; history: Message[] }> {
  const conv = await ctx.store.conversations.get(conversationId);
  if (!conv) throw notFound("对话");
  const all = await ctx.store.messages.list({ refId: conversationId });
  if (input.regenerateOf) {
    const target = all.find((m) => m.id === input.regenerateOf);
    if (!target) throw notFound("要重新生成的消息");
    if (target.role !== "assistant") throw badRequest("只能重新生成助手消息");
    const user = all.find((m) => m.id === target.parentId);
    if (user?.role !== "user") throw badRequest("找不到这条回答对应的提问");
    return { conv, user, isNewUser: false, history: pathTo(all, user.id).slice(0, -1) };
  }
  const content = input.content?.trim();
  if (!content) throw badRequest("消息内容不能为空");
  if (input.parentId !== null && !all.some((m) => m.id === input.parentId)) {
    throw badRequest("parentId 不属于该对话");
  }
  const user: Message = {
    id: newId("msg"),
    conversationId,
    parentId: input.parentId,
    role: "user",
    content,
    citations: [],
    model: null,
    status: "done",
    createdAt: nowIso(),
  };
  return { conv, user, isNewUser: true, history: pathTo(all, input.parentId) };
}

export type PreparedSend = Awaited<ReturnType<typeof prepareSend>>;

/** 执行一次发送 / 重新生成。prepared 来自 prepareSend（路由先校验，再开始 SSE）。 */
export async function runChat(
  ctx: AppContext,
  prepared: PreparedSend,
  input: SendMessageInput,
  emit: ChatEmit,
  signal?: AbortSignal,
): Promise<Message | null> {
  const { conv, user, isNewUser, history } = prepared;
  const conversationId = conv.id;
  const { store } = ctx;
  if (isNewUser) {
    await store.messages.insert(user);
    await emit("user", user);
  }

  const chat = await ctx.models.chat(conv.model ?? null);
  const sources = await activeSources(ctx, conv.notebookId, input.sourceIds);
  // 短追问（"为什么？"）结合上一轮提问检索。
  const prevUser = [...history].reverse().find((m) => m.role === "user");
  const query = user.content.length < 12 && prevUser ? `${prevUser.content} ${user.content}` : user.content;
  const sourceIds = sources.map((s) => s.id);
  const total = sources.length ? await totalChunkChars(ctx, sourceIds) : 0;
  const fullLimit = (await ctx.models.embeddingKey())
    ? FULL_CONTEXT_CHARS.withEmbedding
    : FULL_CONTEXT_CHARS.withoutEmbedding;
  // 资料不多：整份按原文顺序给模型。资料多：先放检索命中的片段，再用每份资料的均匀抽样补足，
  // 「这几份资料分别讲了什么」这类概括性提问关键词命中不了任何片段，没有补足时模型会拿到空资料。
  const fromSources = !sources.length
    ? { passages: [], citable: [] }
    : total <= fullLimit
      ? await gatherPassages(ctx, conv.notebookId, { sourceIds, maxChars: total })
      : await gatherPassages(ctx, conv.notebookId, {
          sourceIds,
          query,
          k: 8,
          maxChars: CHAT_CONTEXT_CHARS,
          order: "relevance",
        });
  // 笔记也算资料：接在资料片段后面编号，同样可以引用；没有勾选资料时给得多一些。
  const fromNotes = await gatherNotes(ctx, conv.notebookId, {
    query,
    maxChars: sources.length ? NOTES_WITH_SOURCES : NOTES_ALONE,
    startAt: fromSources.passages.length + 1,
  });
  const passages = [...fromSources.passages, ...fromNotes.passages];
  const citable = [...fromSources.citable, ...fromNotes.citable];

  // 知识书：按本次提问和最近几条消息触发；Notebook 说明随系统提示词一起给模型。
  const [nb, lore] = await Promise.all([
    store.notebooks.get(conv.notebookId),
    loreForChat(ctx, conv.notebookId, history, user.content),
  ]);

  const assistant: Message = {
    id: newId("msg"),
    conversationId,
    parentId: user.id,
    role: "assistant",
    content: "",
    citations: [],
    ...(lore.used.length ? { lore: lore.used } : {}),
    model: `${chat.provider.id}:${chat.model}`,
    status: "streaming",
    createdAt: nowIso(),
  };
  await store.messages.insert(assistant);
  await emit("start", { id: assistant.id });

  const turns: ChatTurn[] = history
    .filter((m) => m.role !== "system" && m.content.trim() && m.status !== "error")
    .slice(-12)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  turns.push({ role: "user", content: user.content });
  insertAtDepth(turns, lore.atDepth);
  const prompt = buildCitationPrompt(passages, user.content, {
    instructions: nb?.aiInstructions,
    loreBefore: lore.before,
    loreAfter: lore.after,
  });

  let text = "";
  try {
    for await (const delta of streamChat(chat, {
      system: prompt.system,
      ...(prompt.tail ? { systemTail: prompt.tail } : {}),
      messages: turns,
      ...(signal ? { abortSignal: signal } : {}),
    })) {
      if (signal?.aborted) break;
      text += delta;
      await emit("delta", { text: delta });
    }
  } catch (err) {
    const message = errorMessageOf(err);
    const failed = await store.messages.update(assistant.id, { content: text, status: "error" });
    await setLeaf(ctx, conv, assistant.id, user.content);
    await emit("error", { message, messageId: assistant.id });
    return failed;
  }

  const { text: cleaned, citations } = validateCitations(text, citable);
  const final = (await store.messages.update(assistant.id, { content: cleaned, citations, status: "done" }))!;
  await setLeaf(ctx, conv, assistant.id, user.content);
  await emit("citations", citations);
  await emit("done", final);
  return final;
}

/**
 * 「指定深度」的知识书条目插到倒数第 depth 条消息之前（0 = 最后）。
 * system 身份用一条带标记的 user 消息表达；深度 0 的 assistant 会变成预填，模型不接受，按 user 处理。
 */
export function insertAtDepth(
  turns: ChatTurn[],
  items: { depth: number; role: "system" | "user" | "assistant"; content: string }[],
): void {
  for (const it of [...items].sort((a, b) => b.depth - a.depth)) {
    const at = Math.max(0, turns.length - it.depth);
    const role = it.role === "assistant" && it.depth > 0 ? "assistant" : "user";
    const content = it.role === "system" || role !== it.role ? `【背景设定】\n${it.content}` : it.content;
    turns.splice(it.depth === 0 ? turns.length : at, 0, { role, content });
  }
}

async function totalChunkChars(ctx: AppContext, sourceIds: string[]): Promise<number> {
  let total = 0;
  for (const id of sourceIds) for (const c of await ctx.store.chunks.listBySource(id)) total += c.text.length;
  return total;
}

async function setLeaf(
  ctx: AppContext,
  conv: Conversation,
  leafId: string,
  firstQuestion: string,
): Promise<void> {
  const patch: Partial<Conversation> = { activeLeafId: leafId };
  if (conv.title === DEFAULT_CONVERSATION_TITLE || !conv.title.trim())
    patch.title = truncate(firstQuestion.replace(/\s+/g, " "), 40);
  await ctx.store.conversations.update(conv.id, patch);
}

/** 删除对话及其全部消息。 */
export async function deleteConversation(ctx: AppContext, id: string): Promise<void> {
  await ctx.store.messages.deleteWhere({ refId: id });
  await ctx.store.conversations.delete(id);
}

export function assertLeafInConversation(messages: Message[], leafId: string | null): void {
  if (leafId !== null && !messages.some((m) => m.id === leafId)) {
    throw new ApiError(400, "bad_request", "activeLeafId 不属于该对话");
  }
}
