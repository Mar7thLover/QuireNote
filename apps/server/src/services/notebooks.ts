import { type Notebook, newId, nowIso } from "@quirenote/core";
import type { AppContext } from "../context";
import { deleteSourceCascade } from "../ingest/pipeline";
import type { NotebookRecord } from "../store/types";
import { deleteNotebookAssets } from "./assets";
import { deleteConversation } from "./chat";
import { deleteArtifact } from "./studio";

export async function withStats(ctx: AppContext, nb: NotebookRecord): Promise<Notebook> {
  const f = { notebookId: nb.id };
  const [sources, notes, artifacts, elements] = await Promise.all([
    ctx.store.sources.count(f),
    ctx.store.notes.count(f),
    ctx.store.artifacts.count(f),
    ctx.store.elements.count(f),
  ]);
  return { ...nb, stats: { sources, notes, artifacts, elements } };
}

export async function createNotebook(
  ctx: AppContext,
  input: { title: string; description?: string; icon?: string; color?: string; pinned?: boolean },
): Promise<NotebookRecord> {
  const ts = nowIso();
  const nb: NotebookRecord = {
    id: newId("nb"),
    ownerId: ctx.store.ownerId,
    title: input.title,
    description: input.description ?? "",
    icon: input.icon ?? "📓",
    color: input.color ?? "indigo",
    pinned: input.pinned ?? false,
    createdAt: ts,
    updatedAt: ts,
  };
  await ctx.store.notebooks.insert(nb);
  return nb;
}

/** 删除 Notebook 及其下的全部数据与文件。 */
export async function deleteNotebook(ctx: AppContext, id: string): Promise<boolean> {
  const { store } = ctx;
  const nb = await store.notebooks.get(id);
  if (!nb) return false;
  const f = { notebookId: id };
  for (const s of await store.sources.list(f)) await deleteSourceCascade(ctx, s.id);
  await store.chunks.deleteByNotebook(id);
  await store.contents.deleteByNotebook(id);
  for (const c of await store.conversations.list(f)) await deleteConversation(ctx, c.id);
  for (const a of await store.artifacts.list(f)) await deleteArtifact(ctx, a.id);
  await store.notes.deleteWhere(f);
  await store.elements.deleteWhere(f);
  await store.cards.deleteWhere(f);
  await store.reviewLogs.deleteWhere(f);
  await store.views.deleteWhere(f);
  await store.properties.deleteWhere(f);
  await store.undo.deleteWhere(f);
  await store.highlights.deleteWhere(f);
  await store.lore.deleteWhere(f);
  await deleteNotebookAssets(ctx, id);
  return store.notebooks.delete(id);
}
