/** 就地 AI 的 Agent：命令 → 提案（不落库）→ 用户确认后 apply → 可 undo。 */
import { proposeAgentOps } from "@quirenote/ai";
import {
  AgentOp,
  type AgentProposal,
  type Artifact,
  type Element,
  type Note,
  newId,
  nowIso,
} from "@quirenote/core";
import type { AppContext } from "../context";
import { ApiError, badRequest, notFound } from "../errors";
import { msg } from "../messages";
import { gatherPassages } from "./passages";

export async function proposeCommand(
  ctx: AppContext,
  input: { notebookId: string; instruction: string; noteIds?: string[]; selection?: string },
): Promise<AgentProposal> {
  if (!input.instruction?.trim()) throw badRequest(msg().emptyField("instruction"));
  const notes: { id: string; title: string; markdown: string }[] = [];
  for (const id of input.noteIds ?? []) {
    const n = await ctx.store.notes.get(id);
    if (n && n.notebookId === input.notebookId)
      notes.push({ id: n.id, title: n.title, markdown: n.markdown });
  }
  const mindmaps = (await ctx.store.artifacts.list({ notebookId: input.notebookId }))
    .filter((a) => a.data?.kind === "mindmap")
    .slice(0, 5)
    .map((a) => ({
      id: a.id,
      title: a.title,
      nodes: a.data?.kind === "mindmap" ? a.data.nodes.map((n) => ({ id: n.id, label: n.label })) : [],
    }));
  const { passages } = notes.length
    ? { passages: [] }
    : await gatherPassages(ctx, input.notebookId, { query: input.instruction, maxChars: 8_000 });
  return proposeAgentOps(await ctx.models.chat(), {
    instruction: input.instruction,
    notes,
    ...(input.selection ? { selection: input.selection } : {}),
    passages,
    mindmaps,
  });
}

type UndoEntry =
  | { type: "delete_note"; id: string }
  | { type: "restore_note"; note: Note }
  | { type: "delete_artifact"; id: string }
  | { type: "restore_artifact"; artifact: Artifact }
  | { type: "delete_element"; id: string };

export async function applyProposal(
  ctx: AppContext,
  notebookId: string,
  proposal: AgentProposal,
): Promise<{ applied: { op: string; id: string }[]; undoToken: string }> {
  if (!(await ctx.store.notebooks.get(notebookId))) throw notFound("notebook");
  const ops = proposal.ops.map((op) => AgentOp.parse(op));
  // 先整体校验引用的对象，避免只应用一半。
  for (const op of ops) {
    if (op.op === "update_note" || op.op === "delete_note") {
      const n = await ctx.store.notes.get(op.noteId);
      if (!n || n.notebookId !== notebookId)
        throw new ApiError(400, "bad_proposal", msg().proposalNoteMissing(op.noteId));
    }
    if (op.op === "add_mindmap_node") {
      const a = await ctx.store.artifacts.get(op.artifactId);
      if (!a || a.notebookId !== notebookId || a.data?.kind !== "mindmap") {
        throw new ApiError(400, "bad_proposal", msg().proposalMindmapMissing(op.artifactId));
      }
      if (!a.data.nodes.some((n) => n.id === op.parentId))
        throw new ApiError(400, "bad_proposal", msg().proposalNodeMissing(op.parentId));
    }
  }
  const applied: { op: string; id: string }[] = [];
  const undo: UndoEntry[] = [];
  const ts = () => nowIso();
  for (const op of ops) {
    switch (op.op) {
      case "create_note": {
        const note: Note = {
          id: newId("note"),
          ownerId: ctx.store.ownerId,
          notebookId,
          title: op.title,
          doc: null,
          markdown: op.markdown,
          kind: "note",
          tags: [],
          pinned: false,
          origin: { type: "agent", refId: proposal.id, sourceId: null },
          props: {},
          createdAt: ts(),
          updatedAt: ts(),
        };
        await ctx.store.notes.insert(note);
        applied.push({ op: op.op, id: note.id });
        undo.push({ type: "delete_note", id: note.id });
        break;
      }
      case "update_note": {
        const prev = (await ctx.store.notes.get(op.noteId))!;
        // markdown 改了，Tiptap doc 需要由前端从 markdown 重建。
        await ctx.store.notes.update(op.noteId, {
          markdown: op.markdown,
          doc: null,
          ...(op.title ? { title: op.title } : {}),
        });
        applied.push({ op: op.op, id: op.noteId });
        undo.push({ type: "restore_note", note: prev });
        break;
      }
      case "delete_note": {
        const prev = (await ctx.store.notes.get(op.noteId))!;
        await ctx.store.notes.delete(op.noteId);
        applied.push({ op: op.op, id: op.noteId });
        undo.push({ type: "restore_note", note: prev });
        break;
      }
      case "create_table": {
        const art: Artifact = {
          id: newId("art"),
          ownerId: ctx.store.ownerId,
          notebookId,
          kind: "table",
          title: op.title,
          status: "ready",
          error: null,
          sourceIds: [],
          data: { kind: "table", table: op.table },
          props: { origin: "agent" },
          createdAt: ts(),
          updatedAt: ts(),
        };
        await ctx.store.artifacts.insert(art);
        ctx.events.emit("artifact", art);
        applied.push({ op: op.op, id: art.id });
        undo.push({ type: "delete_artifact", id: art.id });
        break;
      }
      case "add_mindmap_node": {
        const art = (await ctx.store.artifacts.get(op.artifactId))!;
        if (art.data?.kind !== "mindmap") break;
        const nodeId = newId("mm");
        const data = {
          ...art.data,
          nodes: [
            ...art.data.nodes,
            { id: nodeId, label: op.label, note: "", parentId: op.parentId, collapsed: false },
          ],
        };
        const updated = await ctx.store.artifacts.update(art.id, { data });
        if (updated) ctx.events.emit("artifact", updated);
        applied.push({ op: op.op, id: nodeId });
        undo.push({ type: "restore_artifact", artifact: art });
        break;
      }
      case "create_element": {
        const el: Element = {
          id: newId("el"),
          ownerId: ctx.store.ownerId,
          notebookId,
          type: op.type,
          name: op.name,
          definition: op.definition,
          aliases: [],
          refs: [],
          relations: [],
          mastery: 0,
          props: {},
          createdAt: ts(),
          updatedAt: ts(),
        };
        await ctx.store.elements.insert(el);
        applied.push({ op: op.op, id: el.id });
        undo.push({ type: "delete_element", id: el.id });
        break;
      }
    }
  }
  const token = newId("undo");
  await ctx.store.undo.insert({ id: token, notebookId, entries: undo, createdAt: ts(), updatedAt: ts() });
  return { applied, undoToken: token };
}

export async function undoProposal(ctx: AppContext, token: string): Promise<{ ok: boolean }> {
  const rec = await ctx.store.undo.get(token);
  if (!rec) throw notFound("undo");
  const entries = [...(rec.entries as UndoEntry[])].reverse();
  for (const e of entries) {
    switch (e.type) {
      case "delete_note":
        await ctx.store.notes.delete(e.id);
        break;
      case "restore_note": {
        if (await ctx.store.notes.get(e.note.id)) await ctx.store.notes.update(e.note.id, e.note);
        else await ctx.store.notes.insert(e.note);
        break;
      }
      case "delete_artifact":
        await ctx.store.artifacts.delete(e.id);
        break;
      case "restore_artifact": {
        const cur = await ctx.store.artifacts.get(e.artifact.id);
        if (cur) {
          const restored = await ctx.store.artifacts.update(e.artifact.id, { data: e.artifact.data });
          if (restored) ctx.events.emit("artifact", restored);
        }
        break;
      }
      case "delete_element":
        await ctx.store.elements.delete(e.id);
        break;
    }
  }
  await ctx.store.undo.delete(token);
  return { ok: true };
}
