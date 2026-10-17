/** 小说写作：按大纲起草、一致性检查、章节摘要、稿件导出。 */
import { checkConsistency, draftChapterStream } from "@quirenote/ai";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { AppContext } from "../context";
import { badRequest, errorMessageOf } from "../errors";
import { msg } from "../messages";
import {
  bookToDocx,
  bookToEpub,
  bookToMarkdown,
  loadBook,
  manuscriptFilename,
  outlineText,
  summarizeChapter,
  writingContext,
} from "../services/writing";
import { download, must, readJson } from "./util";

export function writingRoutes(api: Hono, ctx: AppContext): void {
  const { store } = ctx;

  /** 按本章大纲起草正文（流式）：已有内容时接着写。 */
  api.post("/notebooks/:nb/writing/draft", async (c) => {
    const nb = c.req.param("nb");
    const { noteId } = await readJson(c, z.object({ noteId: z.string() }));
    const note = must(await store.notes.get(noteId), "note");
    const { notebook, background, chapter } = await writingContext(ctx, nb, noteId, note.markdown);
    if (!chapter) throw badRequest(msg().notChapter, "not_chapter");
    const outline = outlineText(chapter);
    if (!outline) throw badRequest(msg().emptyOutline, "empty_outline");
    const chat = await ctx.models.chat();
    const abort = new AbortController();
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => abort.abort());
      const emit = async (event: string, data: unknown) => {
        if (!stream.aborted && !stream.closed) await stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      let text = "";
      try {
        for await (const d of draftChapterStream(chat, {
          title: note.title,
          outline,
          background,
          existing: note.markdown,
          notebook,
        })) {
          if (abort.signal.aborted) break;
          text += d;
          await emit("delta", { text: d });
        }
        await emit("done", { text });
      } catch (err) {
        await emit("error", { message: errorMessageOf(err) });
      }
    });
  });

  /** 对照设定与前文检查本章。 */
  api.post("/notebooks/:nb/writing/check", async (c) => {
    const nb = c.req.param("nb");
    const { noteId } = await readJson(c, z.object({ noteId: z.string() }));
    const note = must(await store.notes.get(noteId), "note");
    if (!note.markdown.trim()) return c.json({ issues: [] });
    const { notebook, background } = await writingContext(ctx, nb, noteId, note.markdown);
    const r = await checkConsistency(await ctx.models.chat(), {
      title: note.title,
      outline: "",
      background,
      notebook,
      text: note.markdown,
    });
    // 只保留确实出自正文的摘录
    return c.json({
      issues: r.issues.filter((i) => i.quote.trim() && note.markdown.includes(i.quote.trim())),
    });
  });

  api.post("/notes/:id/summary", async (c) =>
    c.json({ summary: await summarizeChapter(ctx, c.req.param("id")) }),
  );

  api.get("/notebooks/:nb/manuscript/export", async (c) => {
    const book = await loadBook(ctx, c.req.param("nb"));
    const format = c.req.query("format");
    if (format === "docx")
      return download(
        bookToDocx(book),
        manuscriptFilename(book.title, ".docx"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
    if (format === "epub")
      return download(
        bookToEpub(book, c.req.query("lang")?.startsWith("en") ? "en" : "zh"),
        manuscriptFilename(book.title, ".epub"),
        "application/epub+zip",
      );
    return download(
      new TextEncoder().encode(bookToMarkdown(book)),
      manuscriptFilename(book.title, ".md"),
      "text/markdown",
    );
  });
}
