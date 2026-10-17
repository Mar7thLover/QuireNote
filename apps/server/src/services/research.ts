/** 联网搜索与深度研究：多轮检索 → 抓取正文 → 作为 search 资料导入 → 生成报告。 */
import { defaultModel, type ModelRef, researchQueries, type SearchResult, webSearch } from "@quirenote/ai";
import { newId, nowIso, type Source } from "@quirenote/core";
import type { AppContext } from "../context";
import { ApiError, badRequest } from "../errors";
import { fetchUrl } from "../ingest/parsers";
import { processSource, sourceFileDir } from "../ingest/pipeline";
import { createArtifact } from "./studio";

export async function searchModel(ctx: AppContext, providerId?: string): Promise<ModelRef> {
  if (providerId) {
    const rt = await ctx.models.runtime(providerId);
    const assigned = await ctx.models.assignment("search");
    const model = assigned?.providerId === providerId ? assigned.model : "";
    return {
      provider: rt,
      model: model || defaultModel(rt.kind, "search") || "web",
    };
  }
  return ctx.models.require("search", "联网搜索");
}

export async function searchWeb(
  ctx: AppContext,
  query: string,
  providerId?: string,
): Promise<SearchResult[]> {
  if (!query?.trim()) throw badRequest("query 不能为空");
  return webSearch(await searchModel(ctx, providerId), query.trim(), { maxResults: 8 });
}

/** 新建一个 search 类资料（文本直接入库），返回处理后的 Source。 */
export async function addSearchSource(
  ctx: AppContext,
  notebookId: string,
  input: { title: string; url: string | null; text: string },
  opts: { process?: boolean } = {},
): Promise<Source> {
  const ts = nowIso();
  const src: Source = {
    id: newId("src"),
    ownerId: ctx.store.ownerId,
    notebookId,
    kind: "search",
    title: input.title.slice(0, 200) || input.url || "搜索结果",
    status: "pending",
    error: null,
    selected: true,
    url: input.url,
    mime: "text/markdown",
    size: Buffer.byteLength(input.text),
    pageCount: null,
    charCount: input.text.length,
    summary: "",
    hasFile: true,
    props: {},
    createdAt: ts,
    updatedAt: ts,
  };
  await ctx.store.sources.insert(src);
  await ctx.files.put(`${sourceFileDir(src.id)}/content.md`, new TextEncoder().encode(input.text));
  ctx.events.emit("source", src);
  if (opts.process) return processSource(ctx, src.id);
  return src;
}

export async function runResearchJob(
  ctx: AppContext,
  payload: { notebookId: string; question: string; rounds?: number },
  progress: (p: number, m?: string) => Promise<void>,
): Promise<string> {
  const rounds = Math.max(1, Math.min(5, payload.rounds ?? 2));
  const search = await searchModel(ctx);
  const chat: ModelRef = await ctx.models.chat();
  const seen = new Map<string, SearchResult>();
  for (let r = 1; r <= rounds; r++) {
    await progress(((r - 1) / rounds) * 0.6, `第 ${r}/${rounds} 轮检索`);
    const queries = await researchQueries(
      chat,
      payload.question,
      r,
      [...seen.values()].map((s) => ({ title: s.title, snippet: s.snippet })),
    );
    for (const q of queries) {
      const results = await webSearch(search, q, { maxResults: 6, withContent: true });
      for (const res of results) if (!seen.has(res.url)) seen.set(res.url, res);
    }
  }
  if (!seen.size) throw new ApiError(400, "no_results", "没有搜索到结果，请换个问题");
  const picked = [...seen.values()].slice(0, rounds * 5);
  const sourceIds: string[] = [];
  let i = 0;
  for (const res of picked) {
    i++;
    await progress(0.6 + 0.3 * (i / picked.length), `导入 ${i}/${picked.length}`);
    let text = res.content?.trim() ?? "";
    let title = res.title;
    if (text.length < 400) {
      // 只有摘要：尝试抓取正文，失败就用摘要。
      try {
        const { doc } = await fetchUrl(res.url, ctx.fetch);
        if (doc.text.length > text.length) text = doc.text;
        if (doc.title) title = title || doc.title;
      } catch {
        /* 用摘要 */
      }
    }
    if (!text) text = res.snippet;
    if (!text.trim()) continue;
    try {
      const src = await addSearchSource(
        ctx,
        payload.notebookId,
        { title, url: res.url, text: `# ${title}\n\n${text}` },
        { process: true },
      );
      sourceIds.push(src.id);
    } catch {
      /* 单个结果失败不影响整体 */
    }
  }
  if (!sourceIds.length) throw new ApiError(400, "no_results", "搜索结果都无法导入");
  await progress(0.92, "生成研究报告");
  const report = await createArtifact(ctx, payload.notebookId, {
    kind: "report",
    sourceIds,
    instructions: `围绕研究问题撰写报告：${payload.question}`,
    title: `研究报告：${payload.question}`.slice(0, 120),
  });
  return `导入 ${sourceIds.length} 份资料，报告 ${report.id} 生成中`;
}
