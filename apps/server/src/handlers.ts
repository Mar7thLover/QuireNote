/** 注册后台任务处理函数。 */
import { autoHighlights } from "@quirenote/ai";
import { newId, nowIso } from "@quirenote/core";
import type { AppContext } from "./context";
import { notFound } from "./errors";
import { embedMissing, processSource } from "./ingest/pipeline";
import { runExtractJob } from "./services/elements";
import { runResearchJob } from "./services/research";
import { renderArtifactMedia, runArtifactJob } from "./services/studio";

export function registerJobHandlers(ctx: AppContext): void {
  const { jobs } = ctx;

  jobs.register("ingest", async (p, { progress }) => {
    const src = await processSource(ctx, String(p.sourceId), {
      reuseContent: p.reuseContent === true,
      progress: (x, m) => progress(x, m),
    });
    return `「${src.title}」已就绪`;
  });

  jobs.register("reindex", async (p, { progress }) => {
    const notebookId = typeof p.notebookId === "string" ? p.notebookId : undefined;
    if (p.clear !== false) await ctx.store.chunks.clearEmbeddings(notebookId ? { notebookId } : {});
    const n = await embedMissing(ctx, notebookId ? { notebookId } : {}, (done, total) =>
      progress(done / Math.max(1, total), `Embedding ${done}/${total}`),
    );
    const key = await ctx.models.embeddingKey();
    return key ? `已为 ${n} 个分块重建向量（${key}）` : "未配置 Embedding 模型，检索只用关键词";
  });

  jobs.register("artifact", async (p, { progress }) =>
    runArtifactJob(ctx, p as { artifactId: string; instructions?: string; autoTitle?: boolean }, progress),
  );

  jobs.register("artifact_media", async (p, { progress }) =>
    renderArtifactMedia(ctx, String(p.artifactId), progress),
  );

  jobs.register("extract_elements", async (p, { progress }) =>
    runExtractJob(
      ctx,
      p as { notebookId: string; sourceIds?: string[]; noteIds?: string[]; conversationId?: string },
      progress,
    ),
  );

  jobs.register("auto_highlight", async (p, { progress }) => {
    const sourceId = String(p.sourceId);
    const src = await ctx.store.sources.get(sourceId);
    const content = await ctx.store.contents.get(sourceId);
    if (!src || !content) throw notFound("资料全文");
    await progress(0.1, "AI 标注中");
    const hs = await autoHighlights(await ctx.models.chat(), content.text);
    // 替换掉上一次的 AI 标注，保留用户自己的高亮。
    for (const h of await ctx.store.highlights.list({ refId: sourceId }))
      if (h.by === "ai") await ctx.store.highlights.delete(h.id);
    for (const h of hs) {
      const ts = nowIso();
      await ctx.store.highlights.insert({
        id: newId("hl"),
        sourceId,
        notebookId: src.notebookId,
        start: h.start,
        end: h.end,
        color: "yellow",
        note: h.note,
        by: "ai",
        createdAt: ts,
        updatedAt: ts,
      });
    }
    ctx.events.emit("source", src);
    return `标注了 ${hs.length} 处重点`;
  });

  jobs.register("research", async (p, { progress }) =>
    runResearchJob(ctx, p as { notebookId: string; question: string; rounds?: number }, progress),
  );
}
