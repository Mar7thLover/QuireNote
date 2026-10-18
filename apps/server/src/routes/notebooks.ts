import {
  Manuscript,
  type Note,
  NotebookInput,
  NoteInput,
  newId,
  nowIso,
  Props,
  patchOf,
  RenderPack,
  type Source,
  type SourceContent,
} from "@quirenote/core";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../context";
import { badRequest } from "../errors";
import { mimeFromName } from "../files";
import { deleteSourceCascade, sourceFile } from "../ingest/pipeline";
import { msg } from "../messages";
import { retrieve } from "../retrieval";
import { createNotebook, deleteNotebook, withStats } from "../services/notebooks";
import { exportNotebook, importNotebook } from "../services/portability";
import { editSourceText, revertSourceText } from "../services/source-edit";
import { createFileSource, createJsonSource } from "../services/sources";
import { download, must, readJson, readUpload } from "./util";

const NotebookPatch = patchOf(NotebookInput).extend({
  pinned: z.boolean().optional(),
  aiInstructions: z.string().max(50_000).optional(),
  defaultPresetId: z.string().nullable().optional(),
  manuscript: Manuscript.optional(),
  render: RenderPack.optional(),
});

const JsonSource = z.object({
  kind: z.enum(["url", "text", "markdown", "youtube", "search"]),
  url: z.string().optional(),
  title: z.string().optional(),
  text: z.string().optional(),
});

const SourcePatch = z.object({
  title: z.string().min(1).max(200).optional(),
  selected: z.boolean().optional(),
  props: Props.optional(),
});

const HighlightInput = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  color: z.string().default("yellow"),
  note: z.string().optional(),
});

const RetrieveInput = z.object({
  query: z.string().min(1),
  sourceIds: z.array(z.string()).optional(),
  k: z.number().int().min(1).max(50).optional(),
});

const NotePatch = NoteInput.partial();

export function notebookRoutes(api: Hono, ctx: AppContext): void {
  const { store } = ctx;
  const getNotebook = async (id: string) => must(await store.notebooks.get(id), "notebook");

  // ───── Notebook ─────
  api.get("/notebooks", async (c) => {
    const list = await store.notebooks.list();
    const withS = await Promise.all(list.map((n) => withStats(ctx, n)));
    withS.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    return c.json(withS);
  });

  api.post("/notebooks", async (c) => {
    const input = await readJson(c, NotebookInput.extend({ pinned: z.boolean().optional() }));
    return c.json(await withStats(ctx, await createNotebook(ctx, input)), 201);
  });

  api.get("/notebooks/:nb", async (c) => c.json(await withStats(ctx, await getNotebook(c.req.param("nb")))));

  api.patch("/notebooks/:nb", async (c) => {
    await getNotebook(c.req.param("nb"));
    const patch = await readJson(c, NotebookPatch);
    const updated = must(await store.notebooks.update(c.req.param("nb"), patch), "notebook");
    return c.json(await withStats(ctx, updated));
  });

  api.delete("/notebooks/:nb", async (c) => {
    must((await deleteNotebook(ctx, c.req.param("nb"))) || null, "notebook");
    return c.json({ ok: true });
  });

  api.get("/notebooks/:nb/export", async (c) => {
    const { zip, filename } = await exportNotebook(ctx, c.req.param("nb"));
    return download(zip, filename, "application/zip");
  });

  api.post("/import", async (c) => {
    const { file } = await readUpload(c);
    return c.json(await importNotebook(ctx, new Uint8Array(await file.arrayBuffer())), 201);
  });

  // ───── Sources ─────
  api.get("/notebooks/:nb/sources", async (c) => {
    await getNotebook(c.req.param("nb"));
    return c.json(await store.sources.list({ notebookId: c.req.param("nb") }));
  });

  api.post("/notebooks/:nb/sources", async (c) => {
    const nb = c.req.param("nb");
    await getNotebook(nb);
    const ct = c.req.header("content-type") ?? "";
    let src: Source;
    if (ct.includes("multipart/form-data")) {
      const { file, form } = await readUpload(c);
      src = await createFileSource(ctx, nb, file, typeof form.title === "string" ? form.title : undefined);
    } else {
      src = await createJsonSource(ctx, nb, await readJson(c, JsonSource));
    }
    return c.json(src, 201);
  });

  api.get("/sources/:id", async (c) => c.json(must(await store.sources.get(c.req.param("id")), "source")));

  api.patch("/sources/:id", async (c) => {
    must(await store.sources.get(c.req.param("id")), "source");
    const patch = await readJson(c, SourcePatch);
    const updated = must(await store.sources.update(c.req.param("id"), patch), "source");
    ctx.events.emit("source", updated);
    return c.json(updated);
  });

  api.delete("/sources/:id", async (c) => {
    must(await store.sources.get(c.req.param("id")), "source");
    await deleteSourceCascade(ctx, c.req.param("id"));
    return c.json({ ok: true });
  });

  api.get("/sources/:id/content", async (c) => {
    const id = c.req.param("id");
    const src = must(await store.sources.get(id), "source");
    const content = await store.contents.get(id);
    const highlights = await store.highlights.list({ refId: id });
    const body: SourceContent = {
      sourceId: src.id,
      text: content?.text ?? "",
      pageOffsets: content?.pageOffsets ?? [0],
      highlights: highlights.map((h) => ({
        id: h.id,
        start: h.start,
        end: h.end,
        color: h.color,
        note: h.note,
        by: h.by,
      })),
    };
    return c.json(body);
  });

  api.get("/sources/:id/file", async (c) => {
    const src = must(await store.sources.get(c.req.param("id")), "source");
    const f = must(await sourceFile(ctx, src.id), "sourceFile");
    const name = f.path.split("/").pop() ?? "file";
    return download(
      f.data,
      name,
      src.mime && !src.mime.startsWith("text/html") ? src.mime : mimeFromName(name),
      true,
    );
  });

  api.get("/sources/:id/chunks", async (c) => {
    must(await store.sources.get(c.req.param("id")), "source");
    return c.json(await store.chunks.listBySource(c.req.param("id")));
  });

  api.post("/sources/:id/highlights", async (c) => {
    const id = c.req.param("id");
    const src = must(await store.sources.get(id), "source");
    const input = await readJson(c, HighlightInput);
    if (input.end <= input.start) throw badRequest(msg().highlightRange);
    const content = await store.contents.get(id);
    if (content && input.end > content.text.length) throw badRequest(msg().highlightOutOfRange);
    // 与已有的用户高亮重叠时合并成一条（取并集、用新颜色、保留批注），不叠加重复的高亮。
    const overlapping = (await store.highlights.list({ refId: id })).filter(
      (h) => h.by === "user" && h.start < input.end && h.end > input.start,
    );
    const notes = [...overlapping.map((h) => h.note), input.note ?? ""].map((n) => n.trim()).filter(Boolean);
    const ts = nowIso();
    const h = {
      id: newId("hl"),
      sourceId: id,
      notebookId: src.notebookId,
      start: Math.min(input.start, ...overlapping.map((x) => x.start)),
      end: Math.max(input.end, ...overlapping.map((x) => x.end)),
      color: input.color,
      note: [...new Set(notes)].join("\n"),
      by: "user" as const,
      createdAt: ts,
      updatedAt: ts,
    };
    for (const old of overlapping) await store.highlights.delete(old.id);
    await store.highlights.insert(h);
    return c.json(
      {
        id: h.id,
        start: h.start,
        end: h.end,
        color: h.color,
        note: h.note,
        by: h.by,
        replaced: overlapping.map((x) => x.id),
      },
      201,
    );
  });

  /** 编辑全文：高亮随文本移动，原文被删改的高亮会被删除；之后后台重建索引。 */
  api.put("/sources/:id/content", async (c) => {
    const { text } = await readJson(c, z.object({ text: z.string().max(5_000_000) }));
    return c.json(await editSourceText(ctx, c.req.param("id"), text));
  });

  /** 恢复到第一次编辑前的原文。 */
  api.post("/sources/:id/content/revert", async (c) =>
    c.json(await revertSourceText(ctx, c.req.param("id"))),
  );

  api.patch("/sources/:id/highlights/:hid", async (c) => {
    const h = must(await store.highlights.get(c.req.param("hid")), "highlight");
    if (h.sourceId !== c.req.param("id")) throw badRequest(msg().highlightWrongSource);
    const patch = await readJson(
      c,
      z.object({ color: z.string().min(1).optional(), note: z.string().optional() }),
    );
    const next = (await store.highlights.update(h.id, patch))!;
    return c.json({
      id: next.id,
      start: next.start,
      end: next.end,
      color: next.color,
      note: next.note,
      by: next.by,
    });
  });

  api.delete("/sources/:id/highlights/:hid", async (c) => {
    const h = must(await store.highlights.get(c.req.param("hid")), "highlight");
    if (h.sourceId !== c.req.param("id")) throw badRequest(msg().highlightWrongSource);
    await store.highlights.delete(h.id);
    return c.json({ ok: true });
  });

  api.post("/sources/:id/auto-highlight", async (c) => {
    const src = must(await store.sources.get(c.req.param("id")), "source");
    if (src.status !== "ready") throw badRequest(msg().sourceNotReady);
    const job = await ctx.jobs.enqueue(
      "auto_highlight",
      { sourceId: src.id },
      { notebookId: src.notebookId, refId: src.id, message: msg().job.autoHighlight },
    );
    return c.json(job, 202);
  });

  /** 补充：重新解析资料（解析失败后重试，或更换模型后重建）。 */
  api.post("/sources/:id/reprocess", async (c) => {
    const src = must(await store.sources.get(c.req.param("id")), "source");
    const job = await ctx.jobs.enqueue(
      "ingest",
      { sourceId: src.id },
      { notebookId: src.notebookId, refId: src.id, message: msg().job.reparse(src.title) },
    );
    return c.json(job, 202);
  });

  // ───── 检索 ─────
  api.post("/notebooks/:nb/retrieve", async (c) => {
    const nb = c.req.param("nb");
    await getNotebook(nb);
    const input = await readJson(c, RetrieveInput);
    const { results, warning } = await retrieve(store, nb, input.query, {
      ...(input.sourceIds ? { sourceIds: input.sourceIds } : {}),
      k: input.k ?? 8,
      ...(await ctx.models.retrieval()),
    });
    return c.json(warning ? { results, warning } : { results });
  });

  // ───── Notes ─────
  api.get("/notebooks/:nb/notes", async (c) => {
    await getNotebook(c.req.param("nb"));
    const notes = await store.notes.list({ notebookId: c.req.param("nb") });
    notes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    return c.json(notes);
  });

  api.post("/notebooks/:nb/notes", async (c) => {
    const nb = c.req.param("nb");
    await getNotebook(nb);
    const input = await readJson(c, NoteInput);
    const ts = nowIso();
    const note: Note = {
      id: newId("note"),
      ownerId: store.ownerId,
      notebookId: nb,
      title: input.title,
      doc: input.doc ?? null,
      markdown: input.markdown ?? "",
      kind: input.kind ?? "note",
      tags: input.tags ?? [],
      pinned: input.pinned ?? false,
      origin: input.origin ?? { type: "manual", refId: null, sourceId: null },
      props: input.props ?? {},
      createdAt: ts,
      updatedAt: ts,
    };
    await store.notes.insert(note);
    return c.json(note, 201);
  });

  api.get("/notes/:id", async (c) => c.json(must(await store.notes.get(c.req.param("id")), "note")));

  api.patch("/notes/:id", async (c) => {
    must(await store.notes.get(c.req.param("id")), "note");
    const patch = await readJson(c, NotePatch);
    return c.json(must(await store.notes.update(c.req.param("id"), patch as Partial<Note>), "note"));
  });

  api.delete("/notes/:id", async (c) => {
    must((await store.notes.delete(c.req.param("id"))) || null, "note");
    await store.shares.deleteWhere({ refId: c.req.param("id") });
    return c.json({ ok: true });
  });
}
