/** 首次启动：用 fixtures 种一个示例 Notebook（完成分块与 Embedding）。 */
import { type Note, newId, nowIso, type Source } from "@folio/core";
import { DEMO_NOTEBOOK, DEMO_NOTES, DEMO_SOURCES } from "@folio/core/fixtures";
import type { AppContext } from "./context";
import { parsePlain } from "./ingest/parsers";
import { processSource } from "./ingest/pipeline";
import { createNotebook } from "./services/notebooks";

export async function seedIfEmpty(ctx: AppContext): Promise<string | null> {
  const { store } = ctx;
  if (await store.settings.get("seeded")) return null;
  if ((await store.notebooks.count()) > 0) {
    await store.settings.set("seeded", true);
    return null;
  }
  const nb = await createNotebook(ctx, { ...DEMO_NOTEBOOK, pinned: true });
  for (const fx of DEMO_SOURCES) {
    const ts = nowIso();
    // PDF 类型的 fixture：\f 分页，直接以文本入库并带页偏移。
    const doc = parsePlain(fx.text, { formFeedPages: fx.kind === "pdf" });
    const src: Source = {
      id: newId("src"),
      ownerId: store.ownerId,
      notebookId: nb.id,
      kind: fx.kind,
      title: fx.title,
      status: "pending",
      error: null,
      selected: true,
      url: fx.url,
      mime:
        fx.kind === "pdf"
          ? "application/pdf"
          : fx.kind === "url"
            ? "text/html"
            : fx.kind === "markdown"
              ? "text/markdown"
              : "text/plain",
      size: Buffer.byteLength(fx.text),
      pageCount: doc.pageCount,
      charCount: doc.text.length,
      summary: "",
      hasFile: false,
      props: { demo: true },
      createdAt: ts,
      updatedAt: ts,
    };
    await store.sources.insert(src);
    await store.contents.put({
      sourceId: src.id,
      notebookId: nb.id,
      text: doc.text,
      pageOffsets: doc.pageOffsets,
    });
    await processSource(ctx, src.id, { reuseContent: true, localSummary: true });
  }
  for (const n of DEMO_NOTES) {
    const ts = nowIso();
    const note: Note = {
      id: newId("note"),
      ownerId: store.ownerId,
      notebookId: nb.id,
      title: n.title,
      doc: null,
      markdown: n.markdown,
      kind: n.title.startsWith("【") ? "card" : "note",
      tags: n.tags,
      pinned: false,
      origin: { type: "manual", refId: null, sourceId: null },
      props: {},
      createdAt: ts,
      updatedAt: ts,
    };
    await store.notes.insert(note);
  }
  await store.settings.set("seeded", true);
  return nb.id;
}
